import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  EMPTY_PARTY,
  MODULE_ORDERING_CENTS,
  MODULE_ORDERING_SETUP_CENTS,
  PLAN_LABELS,
  PLAN_MRR_CENTS,
  SM_VAT_RATE_PERCENT,
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
  const moduleFacture = proposal.onlineOrdering && proposal.plan !== 'boost';
  const planLibelle =
    `Abonnement ${PLAN_LABELS[proposal.plan]} — caisse, cuisine, écrans` +
    (proposal.plan === 'boost' ? ', commande en ligne comprise' : '');

  const lignes: DevisLigne[] = [];
  if (proposal.billing === 'annuel') {
    const mensuel = PLAN_MRR_CENTS[proposal.plan] + (moduleFacture ? MODULE_ORDERING_CENTS : 0);
    lignes.push({
      designation:
        planLibelle +
        (moduleFacture ? ' + module commande en ligne' : '') +
        ' — engagement annuel, douze mois payés dix',
      recurrence: 'par an',
      montantHtCents: yearlyCents(mensuel),
    });
  } else {
    lignes.push({
      designation: planLibelle,
      recurrence: 'par mois',
      montantHtCents: PLAN_MRR_CENTS[proposal.plan],
    });
    if (moduleFacture) {
      lignes.push({
        designation: 'Module commande en ligne — page de commande, encaissement et suivi',
        recurrence: 'par mois',
        montantHtCents: MODULE_ORDERING_CENTS,
      });
    }
  }
  if (moduleFacture) {
    lignes.push({
      designation: 'Mise en service du module commande en ligne',
      recurrence: 'une fois',
      montantHtCents: MODULE_ORDERING_SETUP_CENTS,
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
      `Essai de ${TRIAL_DAYS} jours offert à l'ouverture du compte — la facturation démarre à l'issue de l'essai.`,
      ...(proposal.billing === 'annuel'
        ? ['Engagement annuel : douze mois de service, dix facturés — deux mois offerts.']
        : []),
      'Matériel non compris — l’application fonctionne sur vos tablettes et votre imprimante.',
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
        'Aucune proposition posée sur ce lead — posez le plan et l’engagement avant de générer le devis.',
      );
    }
    const doc = buildDevisDocument(
      lead,
      {
        plan: lead.proposal.plan as LeadProposal['plan'],
        onlineOrdering: Boolean(lead.proposal.onlineOrdering),
        billing: (lead.proposal.billing ?? 'mensuel') as LeadProposal['billing'],
        note: lead.proposal.note ?? '',
      },
      this.issuer.issuer(),
      now,
    );
    return { buffer: renderDevisPdf(doc), number: doc.number };
  }
}
