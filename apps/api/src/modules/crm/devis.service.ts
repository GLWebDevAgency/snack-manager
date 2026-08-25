import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  ATELIER_ONCE_CENTS,
  ATELIER_ONCE_KEYS,
  ATELIER_ONCE_LABELS,
  ATELIER_PRESENCE_CENTS,
  ATELIER_PRESENCE_LABEL,
  EMPTY_PARTY,
  LeadServicesSchema,
  MODULE_ORDERING_CENTS,
  MODULE_ORDERING_SETUP_CENTS,
  PLAN_LABELS,
  PLAN_MRR_CENTS,
  SM_VAT_RATE_PERCENT,
  SOCIAL_CADENCE_CENTS,
  SOCIAL_CADENCE_LABELS,
  issuerGaps,
  yearlyCents,
  type InvoiceParty,
  type LeadProposal,
} from '@sm/contracts';
import type { Lead } from '@sm/db';
import { renderDevisPdf, type DevisDocument, type DevisLigne } from '../billing/devis-pdf';
import { IssuerConfig } from '../billing/issuer.config';
import { TRIAL_DAYS } from './signals.service';

/**
 * LE DEVIS DU PIPELINE — l'étape « Proposition » rendue opposable.
 *
 * La proposition posée sur le lead dit plan, module et engagement ; ce service
 * la transforme en document que le prospect peut lire, montrer à son associé
 * et signer. Tout se DÉRIVE : les montants de la grille (@sm/contracts),
 * l'identité d'émetteur de l'environnement (la même que les factures — un
 * devis et la facture qui le suit doivent porter la même maison), la validité
 * de l'usage (trente jours). La note interne de la proposition ne s'imprime
 * JAMAIS : « attend son associé » ne regarde pas l'associé.
 */

const VALIDITE_JOURS = 30;
const DAY_MS = 86_400_000;

/** Composition pure — testable sans Nest ni Mongo. */
export function buildDevisDocument(
  lead: Pick<Lead, 'restaurantName' | 'contact'> & { _id: unknown },
  proposal: LeadProposal,
  issuer: InvoiceParty,
  now: Date,
): DevisDocument {
  // Le LOGICIEL d'abord — s'il est vendu. Depuis l'Atelier, une proposition
  // peut ne porter AUCUNE formule : le devis n'affiche alors que les services
  // (et le module éventuel reste sa seule ligne d'abonnement).
  const plan = proposal.plan;
  const moduleFacture = proposal.onlineOrdering && plan !== 'boost';
  const planLibelle = plan
    ? `Abonnement ${PLAN_LABELS[plan]} — caisse, cuisine, écrans` +
      (plan === 'boost' ? ', commande en ligne comprise' : '')
    : null;
  const moduleLibelle = 'Module commande en ligne — page de commande, encaissement et suivi';

  const lignes: DevisLigne[] = [];
  if (proposal.billing === 'annuel' && (plan || moduleFacture)) {
    const mensuel = (plan ? PLAN_MRR_CENTS[plan] : 0) + (moduleFacture ? MODULE_ORDERING_CENTS : 0);
    lignes.push({
      designation:
        (planLibelle ?? moduleLibelle) +
        (planLibelle && moduleFacture ? ' + module commande en ligne' : '') +
        ' — engagement annuel, douze mois payés dix',
      recurrence: 'par an',
      montantHtCents: yearlyCents(mensuel),
    });
  } else {
    if (plan && planLibelle) {
      lignes.push({
        designation: planLibelle,
        recurrence: 'par mois',
        montantHtCents: PLAN_MRR_CENTS[plan],
      });
    }
    if (moduleFacture) {
      lignes.push({
        designation: moduleLibelle,
        recurrence: 'par mois',
        montantHtCents: MODULE_ORDERING_CENTS,
      });
    }
  }
  // L'Atelier — les mensuels d'abord, jamais annualisés : sans engagement,
  // ils restent « par mois » même quand le logiciel part à l'année.
  const services = proposal.services;
  if (services.presenceInternet) {
    lignes.push({
      designation: ATELIER_PRESENCE_LABEL,
      recurrence: 'par mois',
      montantHtCents: ATELIER_PRESENCE_CENTS,
    });
  }
  if (services.reseauxSociaux) {
    lignes.push({
      designation: SOCIAL_CADENCE_LABELS[services.reseauxSociaux],
      recurrence: 'par mois',
      montantHtCents: SOCIAL_CADENCE_CENTS[services.reseauxSociaux],
    });
  }
  // L'intégration sur site existant COMPREND la mise en service : jamais les
  // deux lignes sur le même devis.
  if (moduleFacture && !services.integrationCommande) {
    lignes.push({
      designation: 'Mise en service du module commande en ligne',
      recurrence: 'une fois',
      montantHtCents: MODULE_ORDERING_SETUP_CENTS,
    });
  }
  for (const cle of ATELIER_ONCE_KEYS) {
    if (!services[cle]) continue;
    lignes.push({
      designation: ATELIER_ONCE_LABELS[cle],
      recurrence: 'une fois',
      montantHtCents: ATELIER_ONCE_CENTS[cle],
    });
  }

  const jour = (d: Date) =>
    `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;

  return {
    // Reproductible à la journée : rééditer le devis du jour ne crée pas une
    // « nouvelle » pièce, changer la proposition un autre jour, si.
    number: `DEV-${jour(now)}-${String(lead._id).slice(-4)}`,
    issuedAt: now.toISOString(),
    validUntil: new Date(now.getTime() + VALIDITE_JOURS * DAY_MS).toISOString(),
    issuer,
    customer: { ...EMPTY_PARTY, name: lead.restaurantName },
    contactLine: [lead.contact?.name, lead.contact?.phone, lead.contact?.email]
      .filter(Boolean)
      .join(' · '),
    lignes,
    vatRatePercent: SM_VAT_RATE_PERCENT,
    conditions: [
      `Devis valable ${VALIDITE_JOURS} jours à compter de son émission. Montants exprimés hors taxes.`,
      // L'essai ne parle que du LOGICIEL : sur un devis services seuls, la
      // ligne promettrait un essai d'un produit qui n'y figure pas.
      ...(plan || proposal.onlineOrdering
        ? [
            `Essai de ${TRIAL_DAYS} jours offert à l'ouverture du compte — la facturation démarre à l'issue de l'essai.`,
          ]
        : []),
      ...(proposal.billing === 'annuel' && (plan || moduleFacture)
        ? ['Engagement annuel : douze mois de service, dix facturés — deux mois offerts.']
        : []),
      ...(services.presenceInternet || services.reseauxSociaux
        ? ['Services de l’Atelier : sans engagement, résiliables à tout moment, jamais facturés d’avance.']
        : []),
      ...(services.siteVitrine || services.refonteSite
        ? ['Site : la maquette est présentée et validée AVANT la mise en chantier — rien ne part sans votre accord sur pièce.']
        : []),
      // La ligne matériel parle de l'application : hors sujet sur un devis
      // qui ne vend que des services de l'Atelier.
      ...(plan || proposal.onlineOrdering
        ? ['Matériel non compris — l’application fonctionne sur vos tablettes et votre imprimante.']
        : []),
    ],
    gaps: issuerGaps(issuer),
  };
}

@Injectable()
export class DevisService {
  constructor(
    @InjectModel('Lead') private readonly leads: Model<Lead>,
    private readonly issuer: IssuerConfig,
  ) {}

  /** Le devis d'un lead, en PDF — refuse tant qu'aucune proposition n'est posée. */
  async pdf(leadId: string, now: Date = new Date()): Promise<{ buffer: Buffer; number: string }> {
    const lead = await this.leads.findById(leadId).lean();
    if (!lead) throw new NotFoundException('Lead introuvable');
    if (!lead.proposal) {
      throw new ConflictException(
        'Aucune proposition posée sur ce lead — posez la formule ou les services avant de générer le devis.',
      );
    }
    const doc = buildDevisDocument(
      lead,
      {
        plan: (lead.proposal.plan ?? null) as LeadProposal['plan'],
        onlineOrdering: Boolean(lead.proposal.onlineOrdering),
        billing: (lead.proposal.billing ?? 'mensuel') as LeadProposal['billing'],
        // Les propositions d'avant l'Atelier : le schéma pose les défauts.
        services: LeadServicesSchema.parse(lead.proposal.services ?? {}),
        note: lead.proposal.note ?? '',
      },
      this.issuer.issuer(),
      now,
    );
    return { buffer: renderDevisPdf(doc), number: doc.number };
  }
}
