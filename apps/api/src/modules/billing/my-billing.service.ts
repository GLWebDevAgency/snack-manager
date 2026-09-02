import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  TENANT_ACCOUNT_STATUS_LABELS,
  billingIdentityMismatch,
  billingIdentityOf,
  buildInvoiceDocument,
  customerParty,
  formatEuros,
  invoiceTotals,
  invoiceView,
  isAccessBlocked,
  isBillable,
  statutEffectif,
  type CompteLu,
  isTenantVisibleInvoice,
  nextInvoiceDue,
  planLabel,
  abonnementMensuelCents,
  offreClient,
  summarizeOutstanding,
  type BillingHistoryQuery,
  type BillingPlan,
  type CrmInvoice,
  type InvoiceDocument,
  type InvoiceParty,
  type InvoiceStatus,
  type MyBilling,
  type StoredInvoice,
  type TenantAccountStatus,
  type JwtPayload,
  type TenantBillingIdentity,
} from '@sm/contracts';
import type { Invoice, Tenant } from '@sm/db';
import { AuditService } from '../audit/audit.module';
import { IssuerConfig } from './issuer.config';

/** Historique du gérant : la plus récente échéance en tête, `_id` départage. */
const HISTORY_ORDER = { dueAt: -1, _id: -1 } as const;

/** Ce qui reste dû : la créance la plus VIEILLE d'abord — c'est elle qui tombe. */
const DUE_ORDER = { dueAt: 1, _id: 1 } as const;

/** Statuts stockés d'une facture qui reste à encaisser. */
const DUE_STATUSES: readonly InvoiceStatus[] = ['envoyee', 'en_retard'];

/**
 * L'ABONNEMENT ET LES FACTURES, VUS PAR CELUI QUI PAIE.
 *
 * `docs/specs/contraintes-business.md` §5 (FAQ #17) promet au gérant, depuis le
 * premier argumentaire commercial : « Back-office → Abonnement : toutes les
 * factures en PDF, le détail de votre formule ». Les factures existaient déjà
 * (`crm/billing.service.ts`), mais pour NOUS seulement — le restaurateur, lui,
 * ne voyait rien. Ce service rend la promesse tenable.
 *
 * ─── CE QU'IL NE FAIT PAS, ET POURQUOI ───
 *
 * Il n'appelle PAS `BillingService.tenantBilling()`, alors que la fiche qu'elle
 * rend est presque la bonne. Cette méthode journalise chaque ouverture dans le
 * REGISTRE D'ADMINISTRATION (`recordDetailView`) : le registre de nos gestes à
 * NOUS sur le compte d'un client. Y écrire « Consultation de la fiche » signée
 * du restaurateur mêlerait, dans le seul document qu'on relit en cas de litige,
 * ses visites et nos suspensions. Un registre qui se trompe sur l'auteur d'un
 * geste ne vaut plus rien.
 *
 * La logique de VUE, elle, est intégralement réutilisée : `invoiceView`,
 * `nextInvoiceDue` et `summarizeOutstanding` vivent dans @sm/contracts et
 * disent la même chose des deux côtés. C'est la seule garantie qui compte ici :
 * le jour où le gérant lirait « Payée » là où l'équipe lit « En retard », la
 * conversation ne serait plus rattrapable.
 *
 * ─── ISOLATION ───
 *
 * Toute requête porte `tenantId` — celui du JETON, transmis par le contrôleur,
 * jamais lu dans l'URL. Aucune méthode de ce service n'accepte de désigner un
 * établissement autrement. Une facture est une donnée financière : en lire une
 * du voisin serait une fuite, pas un défaut d'affichage.
 */
@Injectable()
export class MyBillingService {
  constructor(
    @InjectModel('Invoice') private readonly invoices: Model<Invoice>,
    @InjectModel('Tenant') private readonly tenants: Model<Tenant>,
    private readonly issuerConfig: IssuerConfig,
    private readonly audit: AuditService,
  ) {}

  /**
   * L'ÉCRAN « ABONNEMENT » EN UN APPEL : formule, prochaine échéance, ardoise,
   * historique téléchargeable.
   *
   * DEUX REQUÊTES, ET C'EST DÉLIBÉRÉ. `limit` tronque l'HISTORIQUE AFFICHÉ ; il
   * ne doit jamais tronquer ce qui reste dû. Une somme qui rétrécit parce qu'on
   * a demandé moins de lignes serait un mensonge — et sur cet écran-là, c'est le
   * mensonge qui coûte le plus cher : le gérant règle le montant qu'il y lit.
   */
  async mine(
    tenantId: string,
    query: BillingHistoryQuery,
    now: Date = new Date(),
  ): Promise<MyBilling> {
    const tenant = await this.requireTenant(tenantId);
    const oid = tenant._id as Types.ObjectId;

    const [historyRows, dueRows] = await Promise.all([
      this.invoices.find({ tenantId: oid }).sort(HISTORY_ORDER).limit(query.limit).lean(),
      this.invoices
        .find({ tenantId: oid, status: { $in: DUE_STATUSES } })
        .sort(DUE_ORDER)
        .lean(),
    ]);

    const invoices = historyRows
      .map((raw) => invoiceView(raw as StoredInvoice, now))
      .filter(isTenantVisibleInvoice);
    const due = dueRows.map((raw) => invoiceView(raw as StoredInvoice, now));

    const plan = planOf(tenant);
    const status = accountStatusOf(tenant, now);
    // La MÊME règle que la facturation de l'équipe (`isBillable`,
    // @sm/contracts) : elle était recopiée ici, c'est-à-dire écrite deux fois
    // pour le même client. Le jour où l'une des deux aurait bougé, il aurait
    // lu « aucun prélèvement » sur l'écran même où nous lui préparions une
    // facture.
    const billable = isBillable(status);
    // L'offre ENTIÈRE, pas la formule seule : c'est le montant que le
    // restaurateur voit sur son écran « Abonnement », et il doit être celui
    // qu'on lui prélève. Il lisait 159 € là où on facturait 238 €.
    const offre = offreClient(tenant);
    const mrrCents = abonnementMensuelCents(offre, now);

    return {
      tenant: { id: String(tenant._id), name: String(tenant.name ?? ''), slug: String(tenant.slug ?? '') },
      subscription: {
        plan,
        planLabel: planLabel(plan),
        mrrCents,
        mrrLabel: formatEuros(mrrCents),
        founderSeat: tenant.founderSeat === true,
        founderUntil: iso(tenant.founderUntil as Date | null) ?? null,
        accountStatus: status,
        accountStatusLabel: TENANT_ACCOUNT_STATUS_LABELS[status],
        accessBlocked: isAccessBlocked(status),
        since: iso(tenant.createdAt) ?? now.toISOString(),
        billable,
      },
      nextDue: nextInvoiceDue(
        due,
        // L'offre ENTIÈRE et la date de signature : la projection décide
        // elle-même du montant à SA date — une remise fondateur qui s'éteint
        // d'ici là, un engagement annuel dont ce mois n'est pas l'anniversaire.
        { offre, mrrCents, signeLe: (tenant.createdAt as Date | undefined) ?? null },
        billable,
        now,
      ),
      outstanding: summarizeOutstanding(due, now),
      invoices,
      // Les manques ne dépendent que de l'émetteur et du client — jamais du
      // montant d'une pièce. Ils se calculent donc même quand le client n'a
      // encore aucune facture : c'est justement le moment où il reste du temps
      // pour les collecter.
      legalGaps: [...this.documentFor(BLANK_INVOICE, tenant).gaps],
      identity: billingIdentityOf(tenant.billing),
      // Écrire passe par le garde GLOBAL, qui refuse un compte suspendu. Le
      // dire ici évite au formulaire de proposer un bouton qui répondrait 403.
      identityEditable: !isAccessBlocked(status),
      generatedAt: now.toISOString(),
    };
  }

  /**
   * LE GÉRANT SAISIT SA PROPRE IDENTITÉ DE FACTURATION.
   *
   * C'est LUI qui connaît son SIRET, sa forme juridique et l'adresse de son
   * siège — nous ne les avons jamais demandés à l'inscription, et les chercher
   * à sa place reviendrait à se tromper à sa place sur une pièce qu'il
   * présentera à son comptable.
   *
   * ÉCRITURE CHIRURGICALE (`$set` champ par champ) plutôt qu'un remplacement du
   * sous-document : `tenants` porte le menu, les horaires, les domaines et le
   * statut de compte, et une écriture large sur ce document-là est exactement
   * la façon dont on perd un réglage sans s'en apercevoir.
   *
   * Aucune ligne au journal d'administration : ce registre consigne NOS gestes
   * sur le compte d'un client. Y écrire les siens mêlerait, dans le seul
   * document qu'on relit en cas de litige, ses saisies et nos suspensions.
   */
  async updateIdentity(
    tenantId: string,
    identity: TenantBillingIdentity,
    actor?: JwtPayload,
  ): Promise<TenantBillingIdentity> {
    const tenant = await this.requireTenant(tenantId);

    // La cohérence SIRET ↔ TVA porte sur DEUX champs : `zod` valide chacun
    // séparément, cette règle-ci les confronte. Un SIREN différent entre les
    // deux, c'est un copier-coller depuis le dossier d'un autre — invisible à
    // l'œil nu sur une facture, et faux pour toujours.
    const mismatch = billingIdentityMismatch(identity);
    if (mismatch) throw new BadRequestException(mismatch);

    /*
     * L'ÉTAT D'AVANT, FIGÉ AVANT L'ÉCRITURE.
     *
     * `billingIdentityOf` construit un objet neuf de chaînes : le lire APRÈS
     * le `updateOne` rendrait la valeur nouvelle si le document en mémoire
     * partage un sous-objet avec ce que la base vient d'écrire. La transition
     * serait alors « 73282932000074 → 73282932000074 », c'est-à-dire un
     * registre qui ment sans que rien ne le signale.
     */
    const avant = billingIdentityOf(tenant.billing);

    const $set: Record<string, string> = {};
    for (const [key, value] of Object.entries(identity)) {
      $set[`billing.${key}`] = value;
    }
    await this.tenants.updateOne({ _id: tenant._id }, { $set });

    /*
     * JOURNALISÉ : c'est ce qui s'imprime sur les factures que le restaurant
     * émet, et l'écriture est un REMPLACEMENT (`PUT`) — une chaîne vide y
     * signifie « effacé ». Un SIRET disparu d'une facture ne se retrouve pas
     * dans un `$set` d'hier ; il se retrouve dans le registre.
     *
     * L'état d'AVANT part au journal en même temps que le nouveau : ce sont
     * quelques champs textuels, pas un document, et la transition est ce qui
     * se relit. `requireTenant` l'a déjà lu — aucune requête de plus.
     */
    await this.audit.log({
      tenantId,
      actor,
      action: 'tenant.billing_identity',
      meta: { avant, apres: identity },
    });

    return identity;
  }

  /**
   * UNE FACTURE, PRÊTE À IMPRIMER.
   *
   * Le filtre porte l'établissement EN PLUS de l'identifiant de pièce : un
   * `_id` deviné — ou copié depuis le back-office interne — ne doit pas ouvrir
   * la facture d'un autre restaurant. Même précaution que sur la révocation
   * d'appareil, et pour un motif plus grave : ici, c'est une somme d'argent et
   * un nom d'entreprise.
   *
   * Les BROUILLONS sont introuvables par cette route (404), au même titre qu'une
   * facture d'un autre tenant. Une pièce jamais envoyée n'existe pas pour le
   * client : la lui rendre annoncerait un prélèvement qui n'a pas été décidé.
   */
  async document(tenantId: string, invoiceId: string, now: Date = new Date()): Promise<InvoiceDocument> {
    const tenant = await this.requireTenant(tenantId);
    if (!Types.ObjectId.isValid(invoiceId)) throw new NotFoundException('Facture introuvable');

    const raw = await this.invoices
      .findOne({ _id: new Types.ObjectId(invoiceId), tenantId: tenant._id })
      .lean();
    if (!raw) throw new NotFoundException('Facture introuvable');

    const invoice = invoiceView(raw as StoredInvoice, now);
    if (!isTenantVisibleInvoice(invoice)) throw new NotFoundException('Facture introuvable');

    return this.documentFor(invoice, tenant as RawTenant);
  }

  /**
   * Le régime de TVA n'est PAS un paramètre : il est porté par la pièce
   * elle-même (`invoice.totals`, figé à l'émission). Voir `buildInvoiceDocument`.
   */
  private documentFor(invoice: CrmInvoice, tenant: RawTenant): InvoiceDocument {
    return buildInvoiceDocument(invoice, this.issuerConfig.issuer(), customerOf(tenant));
  }

  private async requireTenant(tenantId: string): Promise<RawTenant> {
    if (!Types.ObjectId.isValid(tenantId)) throw new NotFoundException('Établissement introuvable');
    const raw = await this.tenants.findById(new Types.ObjectId(tenantId)).lean();
    if (!raw) throw new NotFoundException('Établissement introuvable');
    return raw as RawTenant;
  }
}

// ─── Conversions ───

type RawTenant = Tenant & { _id: unknown; createdAt?: Date };

const iso = (value: Date | string | null | undefined): string | null =>
  value ? new Date(value).toISOString() : null;

// `null` = client Atelier seul : sa page abonnement dit « Sans formule » et
// ne projette aucune échéance théorique.
const planOf = (tenant: RawTenant): BillingPlan | null =>
  (tenant.plan ?? null) as BillingPlan | null;

/**
 * Statut de compte, absence comprise, et EFFECTIF à l'instant `now`.
 *
 * Les établissements créés avant le champ `account` n'en ont pas en base, et
 * `.lean()` ne matérialise pas les défauts Mongoose : l'absence vaut « essai »
 * — jamais une anomalie.
 *
 * `statutEffectif` (@sm/contracts) et non la colonne, pour que le gérant lise
 * SUR SON PROPRE ÉCRAN ce que notre équipe lit du sien. Le jour où son essai
 * s'achève, sa page « Abonnement » annonce le prélèvement à venir au lieu de
 * répéter « Essai — rien à facturer » jusqu'à ce qu'un humain bascule le
 * champ à la main. Découvrir le prélèvement sur son relevé bancaire est
 * exactement ce qu'on ne veut pas.
 */
function accountStatusOf(tenant: RawTenant, now: Date): TenantAccountStatus {
  return statutEffectif(tenant.account as CompteLu | undefined, now);
}

/**
 * LE CLIENT, TEL QU'IL S'EST DÉCLARÉ.
 *
 * Ce qu'il a saisi (`tenants.billing` : raison sociale, forme juridique, SIRET,
 * TVA, adresse de facturation) l'emporte sur ce que nous savions de lui. À
 * défaut, on retombe sur son ENSEIGNE et l'adresse de son ÉTABLISSEMENT : elles
 * sont exactes, simplement moins précises qu'un siège social — et une adresse
 * d'établissement juste vaut mieux qu'un emplacement vide.
 *
 * Ce qu'il n'a pas saisi et que nous ne savons pas reste `null`, s'imprime en
 * emplacement et remonte dans `legalGaps`. Rien n'est comblé.
 */
function customerOf(tenant: RawTenant): InvoiceParty {
  return customerParty(billingIdentityOf(tenant.billing), {
    name: String(tenant.name ?? ''),
    address: String(tenant.address ?? ''),
  });
}

/**
 * Pièce fictive servant UNIQUEMENT à énumérer les mentions manquantes quand le
 * client n'a encore aucune facture. Elle ne sort jamais d'ici et n'est jamais
 * rendue : seuls ses `gaps` sont lus, et ceux-ci ne dépendent que des parties
 * et du régime de TVA.
 */
const BLANK_INVOICE: CrmInvoice = {
  _id: '',
  tenantId: '',
  number: '',
  kind: 'abonnement',
  kindLabel: 'Abonnement',
  label: '',
  period: { key: '1970-01', start: '', end: '', label: '' },
  amountCents: 0,
  amountLabel: formatEuros(0),
  totals: invoiceTotals(0, null),
  status: 'brouillon',
  statusLabel: 'Brouillon',
  storedStatus: 'brouillon',
  issuedAt: null,
  dueAt: new Date(0).toISOString(),
  paidAt: null,
  method: null,
  methodLabel: null,
  cancelledAt: null,
  cancelReason: '',
  reminders: { count: 0, last: null },
  overdueDays: 0,
  dueCents: 0,
  dueTtcCents: 0,
};
