import { randomInt, randomUUID } from 'node:crypto';
import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  ATELIER_ONCE_CENTS,
  ATELIER_ONCE_KEYS,
  ATELIER_ONCE_LABELS,
  ATELIER_PRESENCE_LABEL,
  MODULE_ORDERING_SETUP_CENTS,
  PLAN_LABELS,
  SOCIAL_CADENCE_LABELS,
  FOUNDER_SEATS_TOTAL,
  LeadProposalSchema,
  finRemiseFondateur,
  remiseFondateurContrat,
  proposalCents,
  chiffrageFondateur,
  prixFondateurCents,
  servicesCents,
  yearlyCents,
  type JwtPayload,
  type LeadConvert,
  type LeadConversion,
  type LeadProposal,
} from '@sm/contracts';
import { commerceMonthlyCents } from '@sm/contracts/commerce';
import type { Lead, Tenant, User } from '@sm/db';
import type { SecretHasher } from '@sm/domain/src/ports';
import { SECRET_HASHER } from '../../infrastructure/tokens';
import { AdminService } from './admin.service';
import { BillingService } from './billing.service';
import { TRIAL_DAYS } from './signals.service';

/**
 * SIGNER — le geste qui transforme une carte du pipeline en restaurant réel.
 *
 * En un appel : le tenant (essai de TRIAL_DAYS jours, échéance POSÉE en base),
 * le compte gérant (mot de passe généré, stocké en empreinte, remis une fois),
 * la place fondateur s'il y a lieu, la trace sur le lead et la ligne au
 * journal d'administration. Avant ce service, tout cela était des écritures
 * Mongo à la main et un script CLI contre la production.
 *
 * Ordre d'écriture et rattrapage : le tenant d'abord, le compte ensuite. Si
 * le compte échoue (e-mail pris entre la vérification et l'écriture), le
 * tenant orphelin est SUPPRIMÉ avant de relancer l'erreur — un restaurant sans
 * gérant dans le parc serait un mensonge que la liste des clients répéterait.
 */

const DAY_MS = 86_400_000;

type SignedTerms = Pick<
  LeadProposal,
  'plan' | 'onlineOrdering' | 'onlineDelivery' | 'standaloneLoyalty' | 'billing' | 'services'
> & { founderSeat: boolean };

/**
 * Mot de passe lisible AU TÉLÉPHONE : trois groupes de quatre, alphabet sans
 * ambiguïté (ni 0/O, ni 1/l/I) — le même que les codes d'appairage, pour les
 * mêmes raisons. ~62 bits : largement au-dessus de ce qu'un guichet de
 * connexion sans limite de débit mérite, et il se change à la première visite.
 */
const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';

export function generatePassword(pick: (max: number) => number = randomInt): string {
  const group = () =>
    Array.from({ length: 4 }, () => ALPHABET[pick(ALPHABET.length)]).join('');
  return `${group()}-${group()}-${group()}`;
}

@Injectable()
export class ConversionService {
  constructor(
    @InjectModel('Lead') private readonly leads: Model<Lead>,
    @InjectModel('Tenant') private readonly tenants: Model<Tenant>,
    @InjectModel('User') private readonly users: Model<User>,
    @Inject(SECRET_HASHER) private readonly hasher: SecretHasher,
    private readonly admin: AdminService,
    private readonly billing: BillingService,
  ) {}

  async convert(
    actor: JwtPayload,
    leadId: string,
    body: LeadConvert,
    now: Date = new Date(),
  ): Promise<LeadConversion> {
    if (!Types.ObjectId.isValid(leadId)) throw new NotFoundException('Lead introuvable');
    const lead = await this.leads.findById(leadId).lean();
    if (!lead) throw new NotFoundException('Lead introuvable');
    if (!lead.proposal) {
      throw new ConflictException(
        'Aucune proposition posée sur ce lead — posez la formule ou les services avant de signer.',
      );
    }

    /**
     * LE SERVEUR SIGNE CE QUI EST EN BASE, JAMAIS CE QUE LE NAVIGATEUR RACONTE.
     *
     * Le corps ne fournit que l'identité technique du futur restaurant. Les
     * termes commerciaux ont déjà été posés sur le lead et ont servi au
     * devis : les reprendre du corps permettrait à une requête modifiée de
     * changer l'offre, la remise et les premières factures au dernier geste.
     * Le parseur remet aussi les défauts des propositions historiques.
     */
    const parsedProposal = LeadProposalSchema.safeParse({
      plan: lead.proposal.plan ?? null,
      onlineOrdering: Boolean(lead.proposal.onlineOrdering),
      onlineDelivery: Boolean(lead.proposal.onlineDelivery),
      standaloneLoyalty: Boolean(lead.proposal.standaloneLoyalty),
      billing: lead.proposal.billing ?? 'mensuel',
      services: lead.proposal.services ?? {},
      note: lead.proposal.note ?? '',
    });
    if (!parsedProposal.success) {
      throw new ConflictException(
        'La proposition enregistrée est incohérente — corrigez-la avant de signer.',
      );
    }
    const proposal = parsedProposal.data;
    const terms: SignedTerms = {
      plan: proposal.plan,
      onlineOrdering: proposal.onlineOrdering,
      onlineDelivery: proposal.onlineDelivery,
      standaloneLoyalty: proposal.standaloneLoyalty,
      billing: proposal.billing,
      services: proposal.services,
      founderSeat: lead.founderSeatReserved === true,
    };

    const email = body.ownerEmail.toLowerCase();
    if (await this.tenants.findOne({ slug: body.slug }).lean()) {
      throw new ConflictException(`Le slug « ${body.slug} » est déjà pris`);
    }
    if (await this.users.findOne({ email }).lean()) {
      throw new ConflictException(`L’e-mail « ${email} » a déjà un compte`);
    }

    /**
     * LES DIX PLACES SONT UNE PROMESSE PUBLIQUE, PAS UN COMPTEUR D'AFFICHAGE.
     *
     * La landing annonce « dix places fondateur », le CRM affiche le décompte
     * restant — et rien, côté serveur, n'empêchait d'en signer une onzième. La
     * rareté était donc un argument de vente que le logiciel ne tenait pas :
     * c'est le genre d'écart qui se découvre le jour où un client compte.
     *
     * Le contrôle est ici et non au schéma parce qu'il dépend de l'ÉTAT du
     * parc, pas de la forme du corps. Course possible entre deux conversions
     * simultanées : à ce rythme de signature, une revue humaine du décompte
     * vaut mieux qu'un verrou distribué — et le refus, lui, tient dans le cas
     * qui se produit vraiment.
     */
    if (terms.founderSeat) {
      const prises = await this.tenants.countDocuments({ founderSeat: true });
      if (prises >= FOUNDER_SEATS_TOTAL) {
        throw new ConflictException(
          `Les ${FOUNDER_SEATS_TOTAL} places fondateur sont prises — ce client se signe au tarif public.`,
        );
      }
    }

    const password = generatePassword();
    const passwordHash = await this.hasher.hash(password);
    const trialEndsAt = new Date(now.getTime() + TRIAL_DAYS * DAY_MS);

    const { onceCents, monthlyCents } = servicesCents(terms.services);
    const tenant = await this.tenants.create({
      slug: body.slug,
      name: lead.restaurantName,
      // LE CONTACT SUIT LE CLIENT. Il était recueilli à la prospection puis
      // perdu à la signature : la fiche client n'avait plus de numéro à
      // composer, et le commercial rouvrait le pipeline pour retrouver ce
      // qu'il venait de signer.
      contact: {
        name: lead.contact?.name ?? '',
        phone: lead.contact?.phone ?? '',
        email: lead.contact?.email ?? '',
      },
      plan: terms.plan,
      founderSeat: terms.founderSeat,
      // L'offre signée EN ENTIER, pas seulement sa formule. Le module et
      // l'engagement se perdaient ici : le devis les chiffrait, les brouillons
      // les facturaient, et le client naissait sans eux — après quoi toute la
      // facturation récurrente retombait sur `plan` seul et sous-facturait.
      onlineOrdering: terms.onlineOrdering,
      onlineDelivery: terms.onlineDelivery === true,
      standaloneLoyalty: terms.standaloneLoyalty === true,
      billingCycle: terms.billing,
      // La place fondateur donne le DROIT, cette date donne le TERME, et le
      // montant ci-dessous donne la PORTÉE. Les trois sont posés ici une fois
      // pour toutes : la remise d'un client se lit sur son contrat, jamais sur
      // l'horloge du serveur ni sur l'offre qu'il possède aujourd'hui.
      founderUntil: terms.founderSeat ? finRemiseFondateur(now) : null,
      // LA REMISE EST FIGÉE AU CONTRAT SIGNÉ, et c'est tout l'enjeu.
      //
      // Un taux appliqué à l'offre courante remiserait aussi le service ajouté
      // le onzième mois, et donnerait à un fondateur le moyen de relancer sa
      // remise en changeant d'offre — ce que le CRM permet en un clic. Le
      // montant, lui, ne bouge plus : le dû grossit, la remise non, et le
      // supplément se paie plein tarif de lui-même.
      founderDiscountCents: terms.founderSeat
        ? remiseFondateurContrat({
            plan: terms.plan,
            onlineOrdering: terms.onlineOrdering,
            onlineDelivery: terms.onlineDelivery === true,
            standaloneLoyalty: terms.standaloneLoyalty === true,
            atelier: terms.services,
          })
        : null,
      account: {
        status: 'trial',
        since: now,
        reason: `Créé depuis le pipeline (lead « ${lead.restaurantName} »)`,
        suspendedAt: null,
        trialEndsAt,
      },
      // L'Atelier signé vit sur le client : la fiche répond à « qui a quoi ? »
      // sans fouiller la facturation. Rien de vendu → null, pas un sous-objet
      // de faux — l'absence doit se lire comme une absence.
      atelier: onceCents > 0 || monthlyCents > 0 ? { ...terms.services, signedAt: now } : null,
    });

    try {
      await this.users.create({
        email,
        passwordHash,
        role: 'owner',
        tenantId: tenant._id,
        name: body.ownerName,
      });
    } catch (cause) {
      await this.tenants.deleteOne({ _id: tenant._id });
      throw cause;
    }

    // Le lead passe « signé », la réservation s'éteint : la place fondateur
    // vit désormais sur le TENANT — la compter encore côté pipeline la
    // vendrait deux fois (voir `CrmService.overview`).
    await this.leads.updateOne(
      { _id: lead._id },
      {
        $set: { stage: 'signe', founderSeatReserved: false },
        $push: {
          touches: {
            at: now,
            type: 'autre',
            note: `Converti en restaurant « ${body.slug} » — essai jusqu'au ${trialEndsAt.toLocaleDateString('fr-FR')}.`,
          },
        },
      },
    );

    await this.admin.recordTenantCreation(actor, String(tenant._id), {
      slug: body.slug,
      // Le journal se lit seul : « aucune » dit mieux que null qu'un client
      // Atelier seul vient d'entrer au parc.
      plan: terms.plan ?? 'aucune',
      founderSeat: terms.founderSeat,
      leadId: String(lead._id),
      ownerEmail: email,
    });

    const draftInvoices = await this.draftFirstInvoices(
      actor,
      String(tenant._id),
      terms,
      trialEndsAt,
    );

    return {
      tenantId: String(tenant._id),
      slug: body.slug,
      name: lead.restaurantName,
      ownerEmail: email,
      password,
      trialEndsAt: trialEndsAt.toISOString(),
      draftInvoices,
    };
  }

  /**
   * Les premières factures, EN BROUILLON, dérivées des termes signés — plus
   * personne ne les recompose de tête dans Facturation. Datées de la fin
   * d'essai : rien n'est dû pendant les TRIAL_DAYS jours, et un brouillon ne
   * crée pas de créance ; l'équipe l'émet d'un geste le moment venu (ou
   * l'annule si l'essai ne se confirme pas).
   *
   * Best-effort ASSUMÉ : le tenant existe, le mot de passe est affiché — un
   * pépin de facturation ne doit pas faire croire que la signature a échoué.
   * `draftInvoices: 0` le dit à l'écran, et les brouillons se posent alors à
   * la main, comme avant.
   */
  private async draftFirstInvoices(
    actor: JwtPayload,
    tenantId: string,
    terms: SignedTerms,
    trialEndsAt: Date,
  ): Promise<number> {
    const publie = proposalCents({
      plan: terms.plan,
      onlineOrdering: terms.onlineOrdering,
      onlineDelivery: terms.onlineDelivery === true,
      standaloneLoyalty: terms.standaloneLoyalty === true,
      services: terms.services,
    });
    // Le devis a promis moitié prix ; les premières factures doivent porter le
    // même montant. Un client qui reçoit une pièce contredisant le document
    // qu'il vient de signer appelle — et il a raison.
    const prix = terms.founderSeat ? chiffrageFondateur(publie) : publie;
    const mention = terms.founderSeat ? ' — offre fondateur, moitié prix' : '';
    // Les pièces ponctuelles se chiffrent une à une : la remise s'applique
    // donc à chacune, et non au total — c'est ce qui la rend lisible sur la
    // facture que le client reçoit.
    const remise = (cents: number) => (terms.founderSeat ? prixFondateurCents(cents) : cents);
    const period = `${trialEndsAt.getFullYear()}-${String(trialEndsAt.getMonth() + 1).padStart(2, '0')}`;
    const moduleFacture = commerceMonthlyCents(terms) > 0;
    const moduleLibelle = terms.onlineDelivery
      ? (terms.plan === 'boost' ? 'option livraison restaurant' : 'module commande en ligne + livraison restaurant, fidélité incluse')
      : terms.onlineOrdering
        ? 'module commande en ligne, fidélité incluse'
        : 'module fidélité';

    let poses = 0;
    try {
      // La pièce d'abonnement n'existe que si du LOGICIEL est vendu : une
      // signature Atelier seul (site, réseaux…) n'a rien à abonner — sans
      // formule, le module éventuel est tout l'abonnement.
      if (terms.plan || moduleFacture) {
        await this.billing.issue(actor, tenantId, {
          kind: 'abonnement',
          period,
          draft: true,
          dueAt: trialEndsAt,
          amountCents:
            terms.billing === 'annuel' ? yearlyCents(prix.monthlyCents) : prix.monthlyCents,
          label:
            (terms.plan
              ? `Abonnement ${PLAN_LABELS[terms.plan]}` +
                (moduleFacture ? ` + ${moduleLibelle}` : '')
              : `Abonnement — ${moduleLibelle}`) +
            (terms.billing === 'annuel' ? ' — annuel, douze mois payés dix' : '') +
            mention,
        });
        poses += 1;
      }

      // Les mensuels de l'Atelier sur leur propre pièce, JAMAIS annualisés :
      // sans engagement, un service humain ne se facture pas d'avance —
      // les mêler à un abonnement annuel contredirait le devis.
      if (prix.servicesMonthlyCents > 0) {
        const libelles = [
          ...(terms.services.presenceInternet ? [ATELIER_PRESENCE_LABEL] : []),
          ...(terms.services.reseauxSociaux
            ? [SOCIAL_CADENCE_LABELS[terms.services.reseauxSociaux]]
            : []),
        ];
        await this.billing.issue(actor, tenantId, {
          kind: 'option',
          period,
          draft: true,
          dueAt: trialEndsAt,
          amountCents: prix.servicesMonthlyCents,
          label: `Atelier (mensuel, sans engagement) — ${libelles.join(' ; ')}${mention}`,
        });
        poses += 1;
      }

      // L'intégration sur site existant COMPREND la mise en service — la
      // pièce de 55 € ne se pose que quand le module vit sur NOTRE page.
      if (moduleFacture && terms.plan !== 'boost' && !terms.services.integrationCommande) {
        await this.billing.issue(actor, tenantId, {
          kind: 'mise_en_place',
          period,
          draft: true,
          dueAt: trialEndsAt,
          amountCents: remise(MODULE_ORDERING_SETUP_CENTS),
          label: `Mise en service — ${moduleLibelle}${mention}`,
        });
        poses += 1;
      }

      // Une pièce PAR service ponctuel : le site se suit (et se relance)
      // indépendamment de l'identité visuelle — une somme unique les rendrait
      // indistincts au premier impayé.
      for (const cle of ATELIER_ONCE_KEYS) {
        if (!terms.services[cle]) continue;
        await this.billing.issue(actor, tenantId, {
          kind: 'autre',
          period,
          draft: true,
          dueAt: trialEndsAt,
          amountCents: remise(ATELIER_ONCE_CENTS[cle]),
          label: `${ATELIER_ONCE_LABELS[cle]}${mention}`,
        });
        poses += 1;
      }
    } catch {
      // Journalisé par la facturation quand elle a pu ; l'écran affichera
      // le compte réellement posé.
    }
    return poses;
  }

  /**
   * Nouveau mot de passe pour le gérant d'un restaurant — le geste qui
   * remplace `set-password.ts` lancé contre la production à chaque oubli.
   * Même fabrication, même remise unique, et la trace au journal.
   */
  async resetOwnerPassword(
    actor: JwtPayload,
    tenantId: string,
  ): Promise<{ ownerEmail: string; password: string }> {
    if (!Types.ObjectId.isValid(tenantId)) throw new NotFoundException('Établissement introuvable');
    const owner = await this.users
      .findOne({ tenantId: new Types.ObjectId(tenantId), role: 'owner' })
      .lean();
    if (!owner) throw new NotFoundException('Aucun compte gérant sur cet établissement');

    const password = generatePassword();
    const passwordHash = await this.hasher.hash(password);
    await this.users.updateOne(
      { _id: owner._id },
      {
        $set: {
          passwordHash,
          // Même écriture Mongo que le secret : aucun instant ne peut exposer
          // le nouveau mot de passe avec l'ancienne génération encore valide.
          sessionVersion: randomUUID(),
        },
      },
    );

    await this.admin.recordOwnerReset(actor, tenantId, owner.email);
    return { ownerEmail: owner.email, password };
  }
}
