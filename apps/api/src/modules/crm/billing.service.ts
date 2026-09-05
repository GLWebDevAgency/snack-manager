import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  BILLING_JOURNAL,
  INSTALL_FEE_CENTS,
  SM_INVOICE_VAT,
  TENANT_ACCOUNT_STATUS_LABELS,
  billingPeriod,
  defaultInvoiceLabel,
  formatEuros,
  invoiceCounterId,
  invoiceVatOf,
  invoiceView,
  isAccessBlocked,
  isBillable,
  statutEffectif,
  essaiEchuLe,
  type CompteLu,
  formatInvoiceNumber,
  LEGACY_INVOICE_VAT,
  monthKey,
  nextInvoiceDue,
  planLabel,
  planMrrCents,
  type BillingRun,
  type BillingRunReport,
  mrrNormaliseCents,
  offreClient,
  echeanceDuMois,
  shiftMonthKey,
  summarizeOutstanding,
  type BillingHistoryQuery,
  type BillingPlan,
  type CrmBillingOverdue,
  type CrmInvoice,
  type CrmOutstanding,
  type CrmOverdueInvoice,
  type CrmTenantBilling,
  type InvoiceAmountBasis,
  type InvoiceCancel,
  type InvoiceCredit,
  type InvoiceIssue,
  type InvoiceKind,
  type InvoicePay,
  type InvoicePaymentMethod,
  type InvoiceReminderCreate,
  type InvoiceStatus,
  type JwtPayload,
  type StoredInvoice,
  type StoredInvoiceVat,
  type TenantAccountStatus,
} from '@sm/contracts';
import type { Counter, Invoice, Tenant } from '@sm/db';
import { AdminService } from './admin.service';
import { demoSeedEnabled } from '../../common/demo-seed';
import { InvoiceCheckoutGateway } from '../billing/invoice-checkout.gateway';

/**
 * Historique d'un client, échéance la plus récente en tête.
 *
 * `_id` départage les ex æquo, exactement comme le journal d'administration :
 * deux factures peuvent porter la même échéance (l'abonnement du mois et la
 * mise en place, émis le même jour), et `dueAt` seul laisserait alors l'ordre
 * d'affichage au hasard du moteur.
 */
const HISTORY_ORDER = { dueAt: -1, _id: -1 } as const;

/** File de recouvrement : la créance la plus VIEILLE d'abord. */
const RECOVERY_ORDER = { dueAt: 1, _id: 1 } as const;

/** Statuts stockés d'une facture qui reste à encaisser. */
const DUE_STATUSES: readonly InvoiceStatus[] = ['envoyee', 'en_retard'];

/**
 * Filtre des CRÉANCES : émises, ni réglées ni annulées — et JAMAIS un avoir.
 *
 * Un avoir porte le statut stocké « envoyée » (émis, pas encore remboursé ni
 * imputé), mais ce n'est pas une créance : personne ne nous le doit, c'est nous
 * qui le devons. Le laisser passer ici, c'est une pièce négative dans l'ardoise,
 * un « prochain prélèvement » absurde sur la fiche, et une ligne de la file de
 * recouvrement qui ferait décrocher le téléphone pour rembourser plus vite.
 */
const DUE_FILTER = {
  status: { $in: DUE_STATUSES },
  kind: { $ne: 'avoir' },
} as const;

/**
 * Tolérance sur une date de règlement « dans le futur » : cinq minutes.
 *
 * Une horloge de poste de travail dérive, et refuser un encaissement parce que
 * le navigateur a deux minutes d'avance serait une friction absurde au
 * téléphone avec un client. Au-delà, c'est une faute de saisie.
 */
const FUTURE_TOLERANCE_MS = 5 * 60_000;

/** Garde-fou du jeu de démonstration : au-delà, l'ancrage est aberrant. */
const SEED_MAX_MONTHS = 36;

/**
 * FACTURATION — savoir qui paie, qui doit, et depuis quand.
 *
 * Ce service est le pendant comptable d'`AdminService` : celui-ci COUPE
 * l'accès, celui-là dit POURQUOI on aurait le droit de le couper. Sans lui,
 * « impayé » restait une affirmation dans une conversation Slack, et l'axe
 * « paiement » du score de santé répondait « abonnement à jour » à tout le
 * monde faute de chiffre à lire.
 *
 * QUATRE RÈGLES LE STRUCTURENT.
 *
 * 1. NUMÉROTATION CONTINUE ET SANS TROU. Chaque numéro sort d'une séquence
 *    annuelle atomique tenue dans `counters`. Si l'écriture de la facture
 *    échoue après la réservation, le numéro est RENDU (et seulement s'il est
 *    encore le dernier tiré) : c'est la seule façon de garantir qu'un « 0007 »
 *    manquant n'existe pas. Voir `withInvoiceNumber`.
 *
 * 2. JAMAIS DE SUPPRESSION. Une facture erronée s'annule avec un motif ; une
 *    facture réglée ne s'annule pas du tout — elle appelle un avoir. Le numéro
 *    reste consommé dans les deux cas.
 *
 * 3. TOUT GESTE PASSE PAR LE JOURNAL D'ADMINISTRATION, SOUS SON PROPRE NOM.
 *    Émettre, encaisser, annuler s'écrivent au MÊME endroit que les suspensions
 *    et les révocations (`AdminService.recordInvoiceGesture`), parce que c'est
 *    la même histoire qui se raconte : « relancé le 3, facture émise le 5,
 *    encaissée le 12, suspendu le 20 » ne se lit que dans un fil unique. Mais
 *    chacun porte son ACTION dédiée (`invoice.issue`, `invoice.pay`,
 *    `invoice.cancel`) et l'identifiant de la pièce : ces gestes passaient par
 *    `addNote`, donc sous « Note interne », et un encaissement de 139 € affiché
 *    comme un commentaire libre est un journal qui ment sur la nature du geste
 *    — au moment précis (un litige) où on lui demande de ne pas mentir.
 *
 * 4. LE RETARD SE CALCULE, IL NE SE STOCKE PAS. Aucune méthode ici n'écrit
 *    `en_retard` : le statut effectif est déduit de l'échéance à chaque lecture.
 *    La file des impayés ne peut donc pas être périmée, et aucune tâche de nuit
 *    n'est nécessaire pour qu'elle soit juste.
 *
 * Le cloisonnement (`@Roles('sm_admin')`) est posé sur le contrôleur : ce
 * service est TRANS-TENANT par construction — `overdue()` balaie le parc
 * entier — et n'a aucun garde-fou interne contre un appelant mal cadré.
 *
 * RESPECT DES CLIENTS DE NOS CLIENTS : rien ici ne lit une commande ni ne
 * remonte un consommateur. L'argent dont il est question va du restaurateur
 * VERS Snack Manager.
 */
@Injectable()
export class BillingService {
  constructor(
    @InjectModel('Invoice') private readonly invoices: Model<Invoice>,
    @InjectModel('Tenant') private readonly tenants: Model<Tenant>,
    @InjectModel('Counter') private readonly counters: Model<Counter>,
    private readonly admin: AdminService,
    @Optional() private readonly checkout?: InvoiceCheckoutGateway,
  ) {}

  // ─── Lecture : la fiche facturation d'un client ───

  /**
   * ABONNEMENT EN COURS, PROCHAINE ÉCHÉANCE, HISTORIQUE, TOTAL DÛ.
   *
   * La consultation est JOURNALISÉE, comme la fiche « compte » et la fiche de
   * santé : ouvrir le dossier financier d'un client est un accès à ses données,
   * pas un geste neutre.
   *
   * L'ardoise (`outstanding`) est calculée sur une requête SÉPARÉE de
   * l'historique : `limit` tronque l'affichage, il ne doit jamais tronquer le
   * total dû. Un montant qui rétrécit parce qu'on a demandé moins de lignes
   * serait un mensonge, et c'est ce chiffre qui déclenche une suspension.
   */
  async tenantBilling(
    actor: JwtPayload,
    tenantId: string,
    query: BillingHistoryQuery,
    now: Date = new Date(),
  ): Promise<CrmTenantBilling> {
    await this.ensureSeeded();
    const tenant = await this.requireTenant(tenantId);
    const id = String(tenant._id);
    await this.admin.recordDetailView(actor, id);

    const [history, dueRows] = await Promise.all([
      this.invoices
        .find({ tenantId: tenant._id })
        .sort(HISTORY_ORDER)
        .limit(query.limit)
        .lean(),
      this.invoices
        .find({ tenantId: tenant._id, ...DUE_FILTER })
        .sort(RECOVERY_ORDER)
        .lean(),
    ]);

    const invoices = history.map((raw) => toInvoiceView(raw as RawInvoice, now));
    const due = dueRows.map((raw) => toInvoiceView(raw as RawInvoice, now));
    const outstanding = summarizeOutstanding(due, now);

    const plan = planOf(tenant);
    const status = accountStatusOf(tenant, now);
    const billable = isBillable(status);

    return {
      tenantId: id,
      name: String(tenant.name ?? ''),
      slug: String(tenant.slug ?? ''),
      subscription: {
        plan,
        planLabel: planLabel(plan),
        mrrCents: mrrOf(tenant, now),
        mrrLabel: formatEuros(mrrOf(tenant, now)),
        founderSeat: tenant.founderSeat === true,
        founderUntil: iso(tenant.founderUntil as Date | null) ?? null,
        accountStatus: status,
        accountStatusLabel: TENANT_ACCOUNT_STATUS_LABELS[status],
        accessBlocked: isAccessBlocked(status),
        since: iso(tenant.createdAt) ?? now.toISOString(),
        billable,
      },
      nextDue: nextDueFor(
        due,
        {
          offre: offreClient(tenant),
          mrrCents: mrrOf(tenant, now),
          signeLe: (tenant.createdAt as Date | undefined) ?? null,
        },
        billable,
        now,
      ),
      outstanding,
      invoices,
      generatedAt: now.toISOString(),
    };
  }

  /**
   * PORTE D'ENTRÉE DE L'AXE « PAIEMENT » du score de santé.
   *
   * Exposée pour que `HealthService` cesse de deviner : il lui suffit
   * d'injecter ce service, d'appeler cette méthode et de passer le résultat à
   * `paiementAxis(status, outstanding)` (@sm/contracts) — même forme de retour
   * que l'actuel `scorePaiement`, donc un remplacement d'argument et non une
   * réécriture. Le fichier de `HealthService` n'est pas modifié ici : la ligne
   * exacte à changer est signalée au rapport.
   *
   * Ne lit QUE les factures encore dues : la requête reste courte même sur un
   * client avec trois ans d'historique.
   */
  async outstandingFor(tenantId: string, now: Date = new Date()): Promise<CrmOutstanding> {
    await this.ensureSeeded();
    const oid = toObjectId(tenantId, 'Établissement introuvable');
    const rows = await this.invoices
      .find({ tenantId: oid, ...DUE_FILTER })
      .sort(RECOVERY_ORDER)
      .lean();
    return summarizeOutstanding(
      rows.map((raw) => toInvoiceView(raw as RawInvoice, now)),
      now,
    );
  }

  // ─── Lecture : la file de recouvrement du parc ───

  /**
   * TOUS LES IMPAYÉS DU PARC, du plus ancien au plus récent.
   *
   * Sans pagination, volontairement, comme la file de travail de
   * `/crm/signals` : une liste de créances qu'on feuillette n'est plus une
   * liste de créances. Sa longueur est bornée par la taille du parc, et si elle
   * devient illisible, c'est le parc qui va mal — pas la route.
   *
   * Seules les factures ÉCHUES y figurent. Une facture envoyée hier, échéance
   * le 1er du mois prochain, n'est pas un impayé : la mêler aux vraies créances
   * ferait décrocher le téléphone pour rien et diluerait le seul signal qui
   * justifie une suspension.
   */
  async overdue(now: Date = new Date()): Promise<CrmBillingOverdue> {
    await this.ensureSeeded();

    const [rows, tenants] = await Promise.all([
      this.invoices.find({ ...DUE_FILTER }).sort(RECOVERY_ORDER).lean(),
      // Le parc tient en quelques centaines de lignes : une passe complète coûte
      // moins qu'un `$in` reconstruit à chaque appel, et `listClients` fait déjà
      // le même choix.
      this.tenants
        .find({}, { name: 1, slug: 1, plan: 1, account: 1 })
        .lean(),
    ]);

    const byTenant = new Map(tenants.map((t) => [String(t._id), t as RawTenant]));

    const invoices: CrmOverdueInvoice[] = [];
    for (const raw of rows) {
      const view = toInvoiceView(raw as RawInvoice, now);
      if (view.status !== 'en_retard') continue;
      const tenant = byTenant.get(view.tenantId);
      const plan = tenant ? planOf(tenant) : null;
      const status = tenant ? accountStatusOf(tenant, now) : ('trial' as TenantAccountStatus);
      invoices.push({
        ...view,
        tenant: {
          id: view.tenantId,
          name: String(tenant?.name ?? ''),
          slug: String(tenant?.slug ?? ''),
          plan,
          planLabel: planLabel(plan),
          accountStatus: status,
          accountStatusLabel: TENANT_ACCOUNT_STATUS_LABELS[status],
          accessBlocked: isAccessBlocked(status),
        },
      });
    }

    const totalCents = invoices.reduce((sum, i) => sum + i.dueCents, 0);
    return {
      generatedAt: now.toISOString(),
      count: invoices.length,
      tenants: new Set(invoices.map((i) => i.tenantId)).size,
      totalCents,
      totalLabel: formatEuros(totalCents),
      // La liste est déjà triée par échéance croissante : la plus vieille est en tête.
      oldestDays: invoices[0]?.overdueDays ?? 0,
      invoices,
    };
  }

  // ─── Écritures : les gestes ───

  /**
   * LA FACTURATION DU MOIS, POUR TOUT LE PARC, EN UN GESTE.
   *
   * Rien n'émettait l'abonnement du mois suivant : ni écran, ni planificateur.
   * Cette passe le fait, et rend un compte rendu qui dit aussi ce qu'elle n'a
   * PAS fait — un geste de masse qui ne rendrait qu'un nombre laisserait
   * l'équipe deviner pourquoi trois clients manquent à l'appel.
   *
   * IDEMPOTENTE par construction : `issue` refuse déjà un doublon d'abonnement
   * sur la même période, et ce refus est ici traduit en « déjà facturé »
   * plutôt qu'en erreur. Relancer la passe est donc sans danger — c'est même
   * le mode d'emploi : on la relance après avoir corrigé ce qui bloquait.
   *
   * Un client sans rien de récurrent est sauté : facturer 0 € produirait une
   * pièce que personne ne peut ni payer ni comprendre.
   */
  async runMensuel(
    actor: JwtPayload,
    body: BillingRun,
    now: Date = new Date(),
  ): Promise<BillingRunReport> {
    const period = billingPeriod(body.period ?? monthKey(now));
    const tenants = (await this.tenants.find({}).sort({ slug: 1 }).lean()) as RawTenant[];

    const emises: BillingRunReport['emises'][number][] = [];
    const ignores: BillingRunReport['ignores'][number][] = [];

    for (const tenant of tenants) {
      const nom = String(tenant.name ?? '');
      const slug = String(tenant.slug ?? '');

      // ── L'ESSAI ÉCHU SE CLÔT ICI, ET NULLE PART AILLEURS ──
      //
      // Le dépôt n'a pas de planificateur et n'en veut pas (voir
      // `BillingRunSchema`) : cette passe est le seul geste qui parcourt déjà
      // tout le parc, et c'est au moment où l'on facture que la colonne doit
      // cesser de mentir. La vérité, elle, n'a pas attendu — `statutEffectif`
      // la rend depuis le terme, partout, sans écrire.
      //
      // AVANT le test de facturabilité, et c'est tout l'objet : sans cette
      // ligne, `isBillable('trial')` sauterait précisément le client qu'on
      // vient de faire entrer en facturation. `acterFinEssai` ne touche que
      // les essais réellement échus et se protège lui-même du doublon.
      const echuLe = essaiEchuLe(tenant.account as CompteLu | undefined, now);
      if (echuLe) await this.admin.acterFinEssai(actor, String(tenant._id), echuLe);

      if (!isBillable(accountStatusOf(tenant, now))) {
        ignores.push({ slug, name: nom, raison: 'non_facturable' });
        continue;
      }
      if (mrrOf(tenant, now) <= 0) {
        ignores.push({ slug, name: nom, raison: 'rien_a_facturer' });
        continue;
      }
      // L'ENGAGEMENT SIGNÉ DÉCIDE DU MONTANT ET DU RYTHME.
      //
      // `billingCycle` était écrit à la signature, affiché sur la fiche, et lu
      // par aucun calcul : un client ayant signé « douze mois payés dix »
      // recevait douze mensualités pleines — vingt pour cent de trop, sans
      // qu'aucun écran ne le signale. Vendre un engagement qu'on ne sait pas
      // facturer est pire que ne pas le vendre.
      const du = duDuMois(tenant, period, now);
      if (du === null) {
        ignores.push({ slug, name: nom, raison: 'hors_echeance_annuelle' });
        continue;
      }
      try {
        const piece = await this.issue(
          actor,
          String(tenant._id),
          {
            kind: 'abonnement',
            period: period.key,
            label: du.label,
            amountCents: du.cents,
            draft: body.draft,
          },
          now,
        );
        emises.push({
          tenantId: String(tenant._id),
          slug,
          name: nom,
          number: piece.number,
          amountCents: piece.amountCents,
          amountLabel: piece.amountLabel,
        });
      } catch (cause) {
        // Le seul refus attendu est le doublon : `issue` protège déjà contre
        // deux abonnements sur la même période. Tout autre échec doit remonter
        // — une passe qui avale ses erreurs ferait croire le parc à jour.
        if (cause instanceof ConflictException) {
          ignores.push({ slug, name: nom, raison: 'deja_facture' });
          continue;
        }
        throw cause;
      }
    }

    const totalCents = emises.reduce((somme, e) => somme + e.amountCents, 0);
    return {
      period: { key: period.key, label: period.label },
      draft: body.draft,
      emises,
      ignores,
      totalCents,
      totalLabel: formatEuros(totalCents),
    };
  }

  /**
   * ÉMETTRE une facture.
   *
   * Corps vide = le cas courant : « facture le mois en cours au tarif de sa
   * formule ». Les champs ne servent qu'aux exceptions — régularisation d'un
   * mois passé, geste commercial, option.
   *
   * REFUS DE LA DOUBLE FACTURATION : un client ne peut pas recevoir deux
   * abonnements pour le même mois. C'est la seule erreur de cette surface qui
   * coûte de l'argent au client et de la confiance à l'éditeur ; une annulation
   * a posteriori ne rattrape pas le prélèvement déjà passé. Les autres natures
   * (mise en place, option) ne sont pas concernées : rien n'interdit deux
   * options sur le même mois.
   */
  async issue(
    actor: JwtPayload,
    tenantId: string,
    body: InvoiceIssue,
    now: Date = new Date(),
  ): Promise<CrmInvoice> {
    const tenant = await this.requireTenant(tenantId);
    const plan = planOf(tenant);
    const period = billingPeriod(body.period ?? monthKey(now));
    const kind = body.kind;

    if (kind === 'abonnement') {
      const twin = await this.invoices
        .findOne({ tenantId: tenant._id, kind, 'period.start': period.start, status: { $ne: 'annulee' } })
        .lean();
      if (twin) {
        throw new ConflictException(
          `${tenant.name ?? 'Ce client'} a déjà une facture d’abonnement pour ${period.label} (${String((twin as RawInvoice).number)}).`,
        );
      }
    }

    const scheduled = kind === 'abonnement' && body.amountCents === undefined ? duDuMois(tenant, period, now) : null;
    if (kind === 'abonnement' && body.amountCents === undefined && !scheduled) {
      throw new ConflictException('Aucune échéance d’abonnement pour cette période. Un montant exceptionnel doit être explicite.');
    }
    const amountCents = body.amountCents ?? scheduled?.cents
      ?? (kind === 'mise_en_place' ? INSTALL_FEE_CENTS : mrrOf(tenant, now));

    // La pièce porte-t-elle autre chose que la seule formule ? Le libellé par
    // défaut cesse alors de la nommer : « Abonnement Complet » sur un montant
    // qui n'est pas celui de Complet fait appeler le client — et il a raison.
    // Vrai du module, des services de l'Atelier, et de la remise fondateur.
    const composite = kind === 'abonnement' && amountCents !== planMrrCents(plan);

    const raw = await this.writeInvoice({
      tenantId: tenant._id as Types.ObjectId,
      kind,
      label: body.label || (composite ? scheduled?.label : undefined) || defaultInvoiceLabel(kind, plan, period, composite),
      period,
      amountCents,
      status: body.draft ? 'brouillon' : 'envoyee',
      issuedAt: body.draft ? null : now,
      dueAt: body.dueAt ?? period.start,
    });

    const view = toInvoiceView(raw, now);
    await this.admin.recordInvoiceGesture(actor, String(tenant._id), {
      action: 'invoice.issue',
      invoiceId: view._id,
      summary: BILLING_JOURNAL.issued(view),
      meta: {
        number: view.number,
        kind: view.kind,
        period: view.period.key,
        amountCents: view.amountCents,
        dueAt: view.dueAt,
        // Le statut STOCKÉ, pas l'effectif : un brouillon préparé le 19 août
        // pour janvier ne s'est pas « émis en retard », il n'est pas parti.
        storedStatus: view.storedStatus,
      },
    });
    return view;
  }

  /**
   * ÉMETTRE UN BROUILLON — le faire passer chez le client.
   *
   * Un brouillon était une impasse : préparé, il n'avait aucune route pour
   * partir — l'équipe le laissait mourir ou le recréait en émission directe,
   * consommant un SECOND numéro de la séquence pour la même prestation. Ce
   * geste ferme l'impasse : la pièce garde son numéro et passe « envoyée »,
   * datée du jour où elle part réellement (`issuedAt`), pas du jour où elle a
   * été préparée.
   *
   * SEUL un brouillon s'envoie. Les refus nomment l'état réel de la pièce :
   * l'équipe doit comprendre ce qui s'est passé (quelqu'un l'a déjà émise ?
   * réglée ?), pas relire un « statut invalide » générique.
   */
  async send(
    actor: JwtPayload,
    tenantId: string,
    invoiceId: string,
    now: Date = new Date(),
  ): Promise<CrmInvoice> {
    const tenant = await this.requireTenant(tenantId);
    const current = await this.requireInvoice(tenant._id, invoiceId);

    if (current.status === 'payee') {
      throw new ConflictException(
        `La facture ${current.number} est déjà réglée : elle n’a plus rien d’un brouillon.`,
      );
    }
    if (current.status === 'annulee') {
      throw new ConflictException(
        `La facture ${current.number} est annulée : elle ne s’émet plus.`,
      );
    }
    if (current.status !== 'brouillon') {
      throw new ConflictException(`La facture ${current.number} est déjà émise.`);
    }

    const raw = await this.invoices.findOneAndUpdate({
      _id: current._id, tenantId: current.tenantId, status: 'brouillon',
    }, { $set: { status: 'envoyee', issuedAt: now } }, { new: true }).lean();
    if (!raw) throw new ConflictException('La facture a changé. Actualisez avant de l’émettre.');

    const view = toInvoiceView(raw, now);
    await this.admin.recordInvoiceGesture(actor, String(tenant._id), {
      action: 'invoice.send',
      invoiceId: view._id,
      summary: BILLING_JOURNAL.sent(view),
      meta: {
        number: view.number,
        kind: view.kind,
        period: view.period.key,
        amountCents: view.amountCents,
        dueAt: view.dueAt,
      },
    });
    return view;
  }

  /**
   * RELANCER — tracer le geste de recouvrement, sur la PIÈCE et au journal.
   *
   * L'échelle de relance que l'écran affiche (rappeler à J+8, relancer par
   * écrit à J+15, mettre en demeure à J+30) ne valait rien tant que « déjà
   * relancé ? » se répondait de mémoire : deux personnes rappelaient le même
   * gérant à un jour d'écart, et un litige ne pouvait pas prouver la relance.
   * La relance s'écrit donc DEUX fois, comme tout geste de cette surface : sur
   * la facture (ce que la file relit vite) et au journal (`invoice.remind`,
   * avec l'auteur — ce qu'un litige relit lentement).
   *
   * Une facture réglée ou annulée ne se relance pas : il n'y a plus rien à
   * réclamer. Un brouillon non plus — rien n'est parti chez le client, on ne
   * relance pas une somme qu'on n'a jamais demandée.
   */
  async remind(
    actor: JwtPayload,
    tenantId: string,
    invoiceId: string,
    body: InvoiceReminderCreate,
    now: Date = new Date(),
  ): Promise<CrmInvoice> {
    const tenant = await this.requireTenant(tenantId);
    const current = await this.requireInvoice(tenant._id, invoiceId);

    if (current.status === 'payee') {
      throw new ConflictException(
        `La facture ${current.number} est réglée : il n’y a plus rien à relancer.`,
      );
    }
    if (current.status === 'annulee') {
      throw new ConflictException(
        `La facture ${current.number} est annulée : elle ne se relance pas.`,
      );
    }
    if (current.status === 'brouillon') {
      throw new ConflictException(
        `La facture ${current.number} est un brouillon : émettez-la avant de la relancer.`,
      );
    }

    // `$push`, jamais une réécriture du tableau : deux relances simultanées
    // (deux membres de l'équipe sur le même dossier) doivent survivre toutes
    // les deux, pas s'écraser l'une l'autre.
    const raw = await this.invoices
      .findOneAndUpdate(
        { _id: current._id },
        { $push: { reminders: { at: now, channel: body.channel, note: body.note } } },
        { new: true },
      )
      .lean();
    if (!raw) throw new NotFoundException('Facture introuvable');

    const view = toInvoiceView(raw as RawInvoice, now);
    await this.admin.recordInvoiceGesture(actor, String(tenant._id), {
      action: 'invoice.remind',
      invoiceId: view._id,
      summary: BILLING_JOURNAL.reminded(view, body.channel, body.note),
      meta: {
        number: view.number,
        kind: view.kind,
        period: view.period.key,
        amountCents: view.amountCents,
        channel: body.channel,
      },
    });
    return view;
  }

  /**
   * ENCAISSER, avec un moyen et une date.
   *
   * Un brouillon ne s'encaisse pas : il n'est jamais parti chez le client, et
   * marquer « payée » une pièce qu'il n'a pas reçue rendrait l'historique
   * incompréhensible au premier rapprochement bancaire. Une facture annulée non
   * plus. Une facture déjà réglée renvoie un conflit plutôt que d'écraser
   * silencieusement le moyen et la date du premier règlement.
   */
  async pay(
    actor: JwtPayload,
    tenantId: string,
    invoiceId: string,
    body: InvoicePay,
    now: Date = new Date(),
  ): Promise<CrmInvoice> {
    const tenant = await this.requireTenant(tenantId);
    const current = await this.requireInvoice(tenant._id, invoiceId);

    if (current.status === 'payee') {
      throw new ConflictException(`La facture ${current.number} est déjà réglée.`);
    }
    if (current.status === 'annulee') {
      throw new ConflictException(`La facture ${current.number} est annulée : elle ne s’encaisse pas.`);
    }
    if (current.status === 'brouillon') {
      throw new ConflictException(
        `La facture ${current.number} est un brouillon : émettez-la avant de l’encaisser.`,
      );
    }

    const paidAt = body.paidAt ?? now;
    if (paidAt.getTime() > now.getTime() + FUTURE_TOLERANCE_MS) {
      throw new BadRequestException('Une date de règlement ne peut pas être dans le futur.');
    }

    const raw = await this.manualSettlement(current, {
      status: 'payee',
      paidAt,
      method: body.method,
    });

    const view = toInvoiceView(raw, now);
    await this.admin.recordInvoiceGesture(actor, String(tenant._id), {
      action: 'invoice.pay',
      invoiceId: view._id,
      summary: BILLING_JOURNAL.paid(view, body.method, paidAt, body.note),
      meta: {
        number: view.number,
        kind: view.kind,
        period: view.period.key,
        amountCents: view.amountCents,
        method: body.method,
        paidAt: paidAt.toISOString(),
      },
    });
    return view;
  }

  /**
   * ANNULER avec un motif — JAMAIS supprimer.
   *
   * Une facture RÉGLÉE ne s'annule pas : l'argent est encaissé, la pièce est
   * partie en comptabilité, et la corriger appelle un avoir, pas une gomme.
   * Le refus est explicite plutôt que silencieux — l'équipe doit apprendre le
   * geste juste, pas contourner celui qui ne marche pas.
   */
  async cancel(
    actor: JwtPayload,
    tenantId: string,
    invoiceId: string,
    body: InvoiceCancel,
    now: Date = new Date(),
  ): Promise<CrmInvoice> {
    const tenant = await this.requireTenant(tenantId);
    const current = await this.requireInvoice(tenant._id, invoiceId);

    if (current.status === 'payee') {
      throw new ConflictException(
        `La facture ${current.number} est réglée : elle se corrige par un avoir, pas par une annulation.`,
      );
    }
    if (current.status === 'annulee') {
      throw new ConflictException(`La facture ${current.number} est déjà annulée.`);
    }

    const raw = await this.manualSettlement(current, {
      status: 'annulee',
      cancelledAt: now,
      cancelReason: body.reason,
    });

    const view = toInvoiceView(raw, now);
    await this.admin.recordInvoiceGesture(actor, String(tenant._id), {
      action: 'invoice.cancel',
      invoiceId: view._id,
      summary: BILLING_JOURNAL.cancelled(view, body.reason),
      meta: {
        number: view.number,
        kind: view.kind,
        period: view.period.key,
        amountCents: view.amountCents,
        cancelReason: body.reason,
      },
    });
    return view;
  }

  /**
   * L'AVOIR — corriger une facture RÉGLÉE, sans jamais la toucher.
   *
   * C'est le geste vers lequel le refus d'annulation renvoyait sans qu'il
   * existe (« elle se corrige par un avoir, pas par une annulation ») : le
   * non-payé s'annule, le payé s'avoise. L'argent est encaissé, la pièce est
   * partie en comptabilité — la correction est donc une NOUVELLE pièce, qui
   * porte tout ce que la première a dit, en négatif :
   *
   *  · un numéro de la MÊME séquence annuelle — un avoir est une pièce
   *    comptable comme une autre, une seconde numérotation serait un second
   *    registre à défendre au contrôle ;
   *  · le montant OPPOSÉ, au MÊME régime de TVA que l'origine — un avoir au
   *    taux du jour sur une facture au taux d'hier ne solderait pas la TVA
   *    déclarée ;
   *  · la MÊME période — c'est cette prestation-là qu'on rembourse.
   *
   * STATUT « ENVOYÉE », PAS « PAYÉE » : un avoir émis est une dette de NOTRE
   * côté. Il ne devient « payé » que remboursé au client ou imputé sur une
   * facture suivante — l'encaissement existant (`pay`) sait déjà le marquer.
   * Et il n'entre jamais dans la file de recouvrement : voir `DUE_FILTER`.
   */
  async credit(
    actor: JwtPayload,
    tenantId: string,
    invoiceId: string,
    body: InvoiceCredit,
    now: Date = new Date(),
  ): Promise<CrmInvoice> {
    const tenant = await this.requireTenant(tenantId);
    const origin = await this.requireInvoice(tenant._id, invoiceId);

    if (origin.kind === 'avoir') {
      throw new ConflictException(
        `${origin.number} est déjà un avoir : il ne se corrige pas par un second avoir.`,
      );
    }
    if (origin.status !== 'payee') {
      throw new ConflictException(
        `La facture ${origin.number} n’est pas réglée : c’est une annulation qu’il lui faut — l’avoir est réservé aux factures réglées.`,
      );
    }

    // Le régime de TVA est LU SUR L'ORIGINE, jamais sur la constante du jour.
    // Une pièce d'avant le champ `vat` est lue au défaut documenté
    // (`LEGACY_INVOICE_VAT`) — le régime sous lequel elle a réellement été
    // facturée. Les `??` sont une formalité de type : `invoiceVatOf` ne rend
    // jamais de moitié de régime.
    const { config } = invoiceVatOf((origin.vat ?? null) as StoredInvoiceVat);
    const vat = {
      ratePercent: config.ratePercent ?? LEGACY_INVOICE_VAT.ratePercent,
      amountsAre: (config.amountsAre ?? LEGACY_INVOICE_VAT.amountsAre) as InvoiceAmountBasis,
    };

    const raw = await this.writeInvoice({
      tenantId: tenant._id as Types.ObjectId,
      kind: 'avoir',
      label: `Avoir sur ${String(origin.number)} — ${body.reason}`,
      period: {
        start: new Date(origin.period.start),
        end: new Date(origin.period.end),
      },
      amountCents: -Number(origin.amountCents ?? 0),
      status: 'envoyee',
      issuedAt: now,
      // L'« échéance » d'un avoir n'est pas une créance à dater : elle sert à
      // situer la pièce dans le temps — et c'est elle qui choisit l'ANNÉE de la
      // séquence de numérotation. Un avoir émis aujourd'hui se numérote dans la
      // séquence d'aujourd'hui, même s'il rembourse un mois de l'an dernier.
      dueAt: now,
      vat,
    });

    const view = toInvoiceView(raw, now);
    await this.admin.recordInvoiceGesture(actor, String(tenant._id), {
      action: 'invoice.credit',
      invoiceId: view._id,
      summary: BILLING_JOURNAL.credited(view, String(origin.number), body.reason),
      meta: {
        number: view.number,
        kind: view.kind,
        period: view.period.key,
        amountCents: view.amountCents,
        // Le lien machine vers la pièce corrigée : c'est lui qui permet de
        // remonter du négatif au réglé six mois plus tard.
        originNumber: String(origin.number),
      },
    });
    return view;
  }

  // ─── Numérotation ───

  /**
   * Réserve un numéro, écrit la facture, et REND le numéro si l'écriture rate.
   *
   * L'ordre inverse — écrire puis numéroter — laisserait une pièce sans numéro
   * en cas d'incident. Celui-ci laisse, dans le pire des cas, un numéro rendu à
   * la séquence : la restitution est CONDITIONNÉE à ce qu'aucune autre facture
   * ne soit passée entre-temps (`{ _id, seq }`), sans quoi on décrémenterait un
   * compteur déjà consommé par quelqu'un d'autre et deux factures finiraient
   * par porter le même numéro. Entre un trou et un doublon, on choisit le trou
   * — et cette condition-là ne se déclenche que si deux émissions se croisent
   * ET que l'une échoue, ce qui n'arrive pas sur une séquence tirée par des
   * humains au téléphone.
   */
  private async writeInvoice(input: {
    tenantId: Types.ObjectId;
    kind: InvoiceKind;
    label: string;
    period: { start: Date; end: Date };
    amountCents: number;
    status: InvoiceStatus;
    issuedAt: Date | null;
    dueAt: Date;
    paidAt?: Date | null;
    method?: InvoicePaymentMethod | null;
    /** Régime imposé — l'AVOIR recopie celui de sa pièce d'origine. */
    vat?: { ratePercent: number; amountsAre: InvoiceAmountBasis };
  }): Promise<RawInvoice> {
    const year = input.dueAt.getUTCFullYear();
    const counterId = invoiceCounterId(year);
    const seq = await this.nextSequence(counterId);

    try {
      const created = await this.invoices.create({
        tenantId: input.tenantId,
        number: formatInvoiceNumber(year, seq),
        kind: input.kind,
        label: input.label,
        period: { start: input.period.start, end: input.period.end },
        amountCents: input.amountCents,
        // LE RÉGIME EST FIGÉ SUR LA PIÈCE, ici et nulle part ailleurs. Écrit à
        // l'émission plutôt que relu à l'impression : une facture de l'an
        // dernier ne se recalcule pas au taux de cette année. `SM_INVOICE_VAT`
        // dit que nos tarifs sont HORS TAXES et que la TVA est de 20 % ; le
        // montant ci-dessus est donc un montant HT, et la facture le dira.
        // Seul l'AVOIR impose un régime : celui de sa pièce d'origine.
        vat: input.vat ?? { ...SM_INVOICE_VAT },
        status: input.status,
        issuedAt: input.issuedAt,
        dueAt: input.dueAt,
        paidAt: input.paidAt ?? null,
        method: input.method ?? null,
        cancelledAt: null,
        cancelReason: '',
      });
      return created.toObject() as RawInvoice;
    } catch (err) {
      await this.counters
        .findOneAndUpdate({ _id: counterId, seq }, { $inc: { seq: -1 } })
        .catch(() => null);
      throw err;
    }
  }

  private async nextSequence(counterId: string): Promise<number> {
    const doc = await this.counters.findOneAndUpdate(
      { _id: counterId },
      { $inc: { seq: 1 } },
      { new: true, upsert: true },
    );
    return doc?.seq ?? 1;
  }

  // ─── Accès ───

  private async requireTenant(tenantId: string): Promise<RawTenant> {
    const oid = toObjectId(tenantId, 'Établissement introuvable');
    const raw = await this.tenants.findById(oid).lean();
    if (!raw) throw new NotFoundException('Établissement introuvable');
    return raw as RawTenant;
  }

  /**
   * Le filtre porte AUSSI le tenant, comme la révocation d'appareil : un
   * identifiant de facture deviné ne doit pas permettre d'encaisser la pièce
   * d'un autre restaurant, même depuis un compte d'équipe.
   */
  private async requireInvoice(tenantId: unknown, invoiceId: string): Promise<RawInvoice> {
    const oid = toObjectId(invoiceId, 'Facture introuvable');
    const raw = await this.invoices.findOne({ _id: oid, tenantId }).lean();
    if (!raw) throw new NotFoundException('Facture introuvable');
    return raw as RawInvoice;
  }

  /** Ferme Stripe AVANT le règlement/annulation manuel puis compare l'état lu.
   * Une session expirée localement peut déjà être payée côté Stripe : l'horloge
   * seule n'est donc jamais suffisante. Le CAS protège aussi une nouvelle session.
   */
  private async manualSettlement(current: RawInvoice, $set: Record<string, unknown>): Promise<RawInvoice> {
    const sessionId = current.stripeCheckoutSessionId;
    if (sessionId) {
      if (!this.checkout) throw new ConflictException('Rapprochement Stripe requis avant ce geste.');
      let session = await this.checkout.retrieve(sessionId);
      if (session.status === 'open') {
        try { await this.checkout.expire(sessionId); }
        catch { throw new ConflictException('Paiement Stripe en cours : actualisez avant de poursuivre.'); }
        session = await this.checkout.retrieve(sessionId);
      }
      if (session.status !== 'expired' || session.payment_status === 'paid') {
        throw new ConflictException('Paiement Stripe en cours ou confirmé : attendez le rapprochement.');
      }
    }
    const raw = await this.invoices.findOneAndUpdate({
      _id: current._id, tenantId: current.tenantId, status: current.status,
      stripeCheckoutSessionId: sessionId ?? null,
    }, { $set }, { new: true }).lean();
    if (!raw) throw new ConflictException('La facture a changé. Actualisez avant de poursuivre.');
    return raw as RawInvoice;
  }

  // ─── Jeu de démonstration ───

  private seeding: Promise<void> | null = null;

  /**
   * Écrit l'historique de facturation de démonstration si — et seulement si —
   * la collection est VIDE. La promesse est mémorisée : deux requêtes
   * simultanées au démarrage ne doivent pas insérer la série deux fois.
   *
   * Même garde-fou que `CrmService.ensureSeeded` : une amorce ratée ne doit
   * jamais faire tomber la vue, au pire la fiche s'affiche sans historique.
   */
  private ensureSeeded(): Promise<void> {
    // Jamais en production : voir `demoSeedEnabled`. Des factures inventées
    // dans un registre comptable seraient bien pires que des leads fictifs.
    if (!demoSeedEnabled()) return Promise.resolve();
    this.seeding ??= (async () => {
      if ((await this.invoices.countDocuments({})) > 0) return;
      await this.seedDemo();
    })().catch(() => {
      this.seeding = null;
    });
    return this.seeding;
  }

  /**
   * L'HISTORIQUE DE CLASS'FOOD — notre unique client réel.
   *
   * Ce qui est écrit, et pourquoi ce n'est pas une fiction :
   *
   *  · une MISE EN PLACE de 290 € réglée par virement le jour de la mise en
   *    service (docs/specs/contraintes-business.md §6.8) ;
   *  · un ABONNEMENT mensuel au tarif de sa formule pour chaque mois écoulé
   *    depuis son arrivée, RÉGLÉ par prélèvement — le premier le jour de la
   *    mise en service, les suivants le 1er du mois (« prélèvement mensuel
   *    constant », FAQ #17) ;
   *  · l'abonnement du MOIS PROCHAIN, émis et en attente de prélèvement au 1er.
   *    C'est la facture « en cours », et son échéance est TOUJOURS dans le
   *    futur, quel que soit le jour où l'amorce tourne.
   *
   * AUCUN IMPAYÉ N'EST FABRIQUÉ. L'outil doit savoir AFFICHER un retard, pas en
   * inventer un sur le seul restaurant qui nous fait confiance : une capture
   * d'écran de démonstration finit toujours par circuler. La file
   * `/crm/billing/overdue` sort donc vide, et c'est le bon résultat.
   *
   * L'amorce n'écrit RIEN au journal d'administration : personne n'a émis ces
   * factures, elles décrivent un passé. Une ligne « Facture SM-2026-0001 émise »
   * signée d'un compte d'équipe serait un faux dans un registre dont toute la
   * valeur tient à ce qu'il ne ment pas.
   */
  private async seedDemo(now: Date = new Date()): Promise<void> {
    const tenant = (await this.tenants.findOne({ slug: 'classfood' }).lean()) as RawTenant | null;
    if (!tenant) return;

    const arrival = tenant.createdAt ? new Date(tenant.createdAt) : now;
    if (arrival.getTime() > now.getTime()) return;

    const plan = planOf(tenant);
    // Même source que la facturation réelle : l'amorce de démonstration doit
    // montrer les mêmes montants que ceux qu'on prélève, sinon elle ment.
    const mrr = mrrOf(tenant, now);
    const tenantOid = tenant._id as Types.ObjectId;
    const firstKey = monthKey(arrival);
    const currentKey = monthKey(now);

    // 1. Mise en place, réglée à la signature.
    const firstPeriod = billingPeriod(firstKey);
    await this.writeInvoice({
      tenantId: tenantOid,
      kind: 'mise_en_place',
      label: defaultInvoiceLabel('mise_en_place', plan, firstPeriod),
      period: firstPeriod,
      amountCents: INSTALL_FEE_CENTS,
      status: 'payee',
      issuedAt: arrival,
      dueAt: arrival,
      paidAt: arrival,
      method: 'virement',
    });

    // 2. Un abonnement par mois écoulé, réglé par prélèvement.
    let key = firstKey;
    for (let guard = 0; guard < SEED_MAX_MONTHS; guard += 1) {
      const period = billingPeriod(key);
      // Le premier mois est prélevé le jour de la mise en service, les suivants
      // au 1er : c'est le « prélèvement mensuel constant » promis au client.
      const debited = key === firstKey ? arrival : period.start;
      await this.writeInvoice({
        tenantId: tenantOid,
        kind: 'abonnement',
        label: defaultInvoiceLabel('abonnement', plan, period),
        period,
        amountCents: mrr,
        status: 'payee',
        issuedAt: debited,
        dueAt: debited,
        paidAt: debited,
        method: 'prelevement',
      });
      if (key === currentKey) break;
      key = shiftMonthKey(key, 1);
    }

    // 3. Le mois prochain : émis, échéance au 1er — la facture « en cours ».
    const next = billingPeriod(shiftMonthKey(currentKey, 1));
    await this.writeInvoice({
      tenantId: tenantOid,
      kind: 'abonnement',
      label: defaultInvoiceLabel('abonnement', plan, next),
      period: next,
      amountCents: mrr,
      status: 'envoyee',
      issuedAt: now,
      dueAt: next.start,
    });
  }
}

// ─── Conversions ───

type RawTenant = Tenant & { _id: unknown; createdAt?: Date };
type RawInvoice = Invoice & { _id: unknown; createdAt?: Date };

/**
 * Un `:id` d'URL n'est pas forcément un ObjectId : sans ce garde-fou, Mongoose
 * lève une CastError et l'équipe reçoit un 500 au lieu d'un 404. Même règle
 * que dans `AdminService`.
 */
function toObjectId(id: string, message: string): Types.ObjectId {
  if (!Types.ObjectId.isValid(id)) throw new NotFoundException(message);
  return new Types.ObjectId(id);
}

const iso = (d: Date | string | null | undefined): string | null =>
  d ? new Date(d).toISOString() : null;

// `null` = client Atelier seul : aucun abonnement logiciel à facturer.
const planOf = (tenant: RawTenant): BillingPlan | null =>
  (tenant.plan ?? null) as BillingPlan | null;

/**
 * Ce qu'un client paie chaque mois : formule + module + services mensuels.
 *
 * Toute la facturation lisait `planOf` seul, et sous-facturait donc tout
 * client ayant acheté autre chose qu'une formule. `.lean()` ne matérialise pas
 * les défauts Mongoose : sur un tenant d'avant ces champs, `onlineOrdering`
 * arrive `undefined` et `atelier` absent — `abonnementMensuelCents` les traite
 * comme « non vendu », donc l'ancien parc retombe sur sa formule sans lever.
 */
/**
 * CE QUI EST DÛ CE MOIS-CI — montant et libellé, ou `null` si rien ne l'est.
 *
 * Un client au mois doit sa mensualité entière. Un client à l'année ne doit son
 * LOGICIEL qu'une fois l'an, à son mois anniversaire, pour dix mensualités ; ses
 * services de l'Atelier, eux, restent mensuels — sans engagement, ils ne
 * s'annualisent jamais, et c'est déjà ce que le devis promet au client (« douze
 * mois de service, dix facturés » n'apparaît que sur la part logicielle).
 *
 * `null` ne veut donc pas dire « rien à facturer » mais « pas ce mois-ci » : la
 * passe le distingue à l'écran, sans quoi un client annuel disparaîtrait du
 * compte rendu onze mois sur douze et passerait pour oublié.
 */
function duDuMois(
  tenant: RawTenant,
  period: { key: string; label: string },
  now: Date,
): { cents: number; label: string } | null {
  // La RÈGLE vient des contrats (`echeanceDuMois`), pas d'ici. Elle était
  // recopiée dans ce fichier — filtre annuel compris — alors que la projection
  // d'échéance appliquait la sienne : deux écritures de la même règle qui
  // doivent rendre le même montant, et qui finissent par annoncer un chiffre
  // et en facturer un autre. Ce service ne compose plus que le LIBELLÉ.
  const { cents, lignes } = echeanceDuMois(
    offreClient(tenant),
    billingPeriod(period.key).start,
    (tenant.createdAt as Date | undefined) ?? null,
    now,
  );
  if (cents <= 0) return null;

  const parts = lignes.map((l) =>
    l.cadence === 'annuel'
      ? 'abonnement annuel (douze mois, dix facturés)'
      : l.nature === 'logiciel'
        ? 'abonnement'
        : 'services',
  );
  const majuscule = (t: string): string => t.charAt(0).toUpperCase() + t.slice(1);
  return { cents, label: `${majuscule(parts.join(' et '))} — ${period.label}` };
}

/**
 * Le MRR d'un client — NORMALISÉ, pas sa mensualité faciale.
 *
 * La distinction ne se voyait pas tant que personne n'avait signé à l'année :
 * « douze mois payés dix » rapporte un sixième de moins par mois que ce que le
 * tarif affiche, et sommer les mensualités faciales gonflait le MRR du parc
 * d'autant. C'est le pendant, côté PILOTAGE, du défaut que `billingCycle`
 * portait côté facturation.
 */
const mrrOf = (tenant: RawTenant, now: Date = new Date()): number =>
  mrrNormaliseCents(offreClient(tenant), now);

/**
 * Statut de compte, absence comprise, et EFFECTIF à l'instant `now`.
 *
 * Les établissements créés avant le champ `account` n'en ont pas en base et
 * `.lean()` ne matérialise pas les défauts Mongoose : ils sont traités comme
 * des comptes d'essai — jamais comme une anomalie.
 *
 * `statutEffectif` (@sm/contracts) et non la colonne : un essai dont le terme
 * est passé vaut `active`, donc facturable. C'est le trou que cette lecture
 * ferme — `isBillable` exclut `trial`, aucun planificateur ne closait l'essai,
 * et un restaurant signé que personne ne basculait à la main n'était jamais
 * facturé. La colonne, elle, se réconcilie dans `runMensuel`.
 *
 * `now` est OBLIGATOIRE et non défauté à `new Date()` : chaque appelant de ce
 * fichier travaille déjà à un instant donné (les tests en dépendent), et un
 * défaut silencieux ferait diverger la fiche de la passe qui la suit.
 */
function accountStatusOf(tenant: RawTenant, now: Date): TenantAccountStatus {
  return statutEffectif(tenant.account as CompteLu | undefined, now);
}

/**
 * Document Mongo → forme d'API, statut effectif recalculé à l'instant `now`.
 *
 * Simple alias d'`invoiceView` (@sm/contracts). Cette conversion vivait ici en
 * double, recopiée à l'identique de la surface du gérant ; les deux ont
 * désormais une seule source. Ce n'est pas de la coquetterie : le jour où le
 * gérant lirait « Payée » là où l'équipe lit « En retard » — ou 139 € là où
 * l'équipe lit 166,80 € —, la conversation ne serait plus rattrapable.
 */
const toInvoiceView = (raw: RawInvoice, now: Date): CrmInvoice =>
  invoiceView(raw as StoredInvoice, now);

/**
 * La prochaine échéance — même fonction que celle du gérant (`nextInvoiceDue`),
 * pour la même raison que ci-dessus.
 */
const nextDueFor = nextInvoiceDue;
