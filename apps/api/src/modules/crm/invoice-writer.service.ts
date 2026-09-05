import { ConflictException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { billingPeriod, monthKey, SM_INVOICE_VAT, type InvoiceAmountBasis, type InvoiceKind, type InvoicePaymentMethod, type InvoiceStatus } from '@sm/contracts';
import type { Invoice, InvoiceIssuance, InvoiceSnapshot } from '@sm/db';
import { InvoiceNumberingService, validateInvoiceSnapshot } from './invoice-numbering.service';

export interface InvoiceWriteInput {
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
  vat?: { ratePercent: number; amountsAre: InvoiceAmountBasis };
}

type WrittenInvoice = Invoice & { _id: unknown };
const JOURNALED_WRITE = { w: 'majority', j: true, wtimeout: 10_000 } as const;

/** Seul ce refus signifie « déjà facturé » dans une passe mensuelle. */
export class DuplicateInvoiceException extends ConflictException {
  constructor(invoice: { number: string }) {
    super(`Ce client a déjà une facture d’abonnement pour cette période (${invoice.number}). Actualisez son historique.`);
  }
}

function duplicateKey(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 11000;
}

/**
 * Point d'entrée unique de création. Une période réserve un identifiant de pièce,
 * pas un bail : une panne ne rend JAMAIS cette période disponible par l'horloge.
 * La reprise matérialise la même pièce ; l'API invite ensuite à relire l'historique.
 * Les options/avoirs/installations restent multiples et partagent le numéroteur.
 */
@Injectable()
export class InvoiceWriterService {
  constructor(
    @InjectModel('Invoice') private readonly invoices: Model<Invoice>,
    @InjectModel('InvoiceIssuance') private readonly issuances: Model<InvoiceIssuance>,
    private readonly numbering: InvoiceNumberingService,
  ) {}

  async write(input: InvoiceWriteInput): Promise<WrittenInvoice> {
    const candidate: InvoiceSnapshot = {
      ...input,
      _id: new Types.ObjectId(),
      tenantId: new Types.ObjectId(String(input.tenantId)),
      period: { start: new Date(input.period.start), end: new Date(input.period.end) },
      vat: { ...(input.vat ?? SM_INVOICE_VAT) },
      dueAt: new Date(input.dueAt),
      issuedAt: input.issuedAt ? new Date(input.issuedAt) : null,
      paidAt: input.paidAt ? new Date(input.paidAt) : null,
      method: input.method ?? null,
    };
    validateInvoiceSnapshot(candidate);
    if (candidate.kind !== 'abonnement') return this.numbering.write(candidate);

    const period = billingPeriod(monthKey(candidate.period.start));
    if (+candidate.period.start !== +period.start || +candidate.period.end !== +period.end) {
      throw new ServiceUnavailableException('Période de facturation non canonique : émission refusée.');
    }
    const key = `${candidate.tenantId}:abonnement:${period.key}`;

    for (let attempt = 0; attempt < 16; attempt += 1) {
      await this.checkHistory(candidate);
      let reservation: InvoiceIssuance | null;
      try {
        reservation = await this.issuances.findOneAndUpdate(
          { _id: key }, { $setOnInsert: { snapshot: candidate } },
          { upsert: true, new: true, runValidators: true, writeConcern: JOURNALED_WRITE },
        ).lean();
      } catch (error) {
        // Deux upserts simultanés peuvent se heurter à l'unicité native `_id`.
        if (!duplicateKey(error)) throw error;
        continue;
      }
      if (!reservation) throw new ServiceUnavailableException('Réservation de facture indisponible.');
      let snapshot = await this.committedReservation(key, reservation);
      if (!snapshot) continue;
      this.assertScope(snapshot, candidate);

      const previous = await this.invoices.findOne({ _id: snapshot._id, tenantId: snapshot.tenantId })
        .read('primary').readConcern('majority').maxTimeMS(10_000).lean();
      if (previous && String(snapshot._id) !== String(candidate._id)) {
        if (previous.status !== 'annulee') throw new DuplicateInvoiceException(previous);
        // Une facture annulée est terminale. Un ancien helper ne peut pas
        // l'écraser (setOnInsert) ni remplacer à nouveau cette génération.
        const replaced = await this.issuances.findOneAndUpdate(
          { _id: key, 'snapshot._id': snapshot._id }, { $set: { snapshot: candidate } },
          { new: true, runValidators: true, writeConcern: JOURNALED_WRITE },
        ).lean();
        if (!replaced) continue;
        snapshot = await this.committedReservation(key, replaced);
        if (!snapshot) continue;
        this.assertScope(snapshot, candidate);
      }

      // L'historique est relu SOUS réservation. Aucun index unique n'est
      // imposé aux anciennes factures, et une ambiguïté est un incident.
      await this.checkHistory(candidate, snapshot._id);
      const written = await this.numbering.write(snapshot);
      if (written.status === 'annulee' || String(snapshot._id) !== String(candidate._id)) {
        // Un repreneur ne présente pas comme nouvelle la facture d'une autre
        // tentative, même si la première réponse a été perdue après écriture.
        throw new DuplicateInvoiceException(written);
      }
      return written;
    }
    throw new ServiceUnavailableException('Émissions concurrentes : actualisez avant de réessayer.');
  }

  /**
   * Le findOneAndUpdate d'un claim existant peut être un no-op. Son résultat
   * n'est pas notre preuve de lecture majoritaire : on relit avec un find,
   * sans appliquer readConcern à une commande d'écriture non compatible.
   * Une autre génération ou un snapshot pas encore visible fait réessayer,
   * jamais matérialiser l'ancien travail capturé sur un primaire perdu.
   */
  private async committedReservation(key: string, expected: InvoiceIssuance): Promise<InvoiceSnapshot | null> {
    const committed = await this.issuances.findById(key)
      .read('primary').readConcern('majority').maxTimeMS(10_000).lean();
    if (!committed || String(committed.snapshot?._id) !== String(expected.snapshot?._id)) return null;
    return committed.snapshot as InvoiceSnapshot;
  }

  private assertScope(snapshot: InvoiceSnapshot, candidate: InvoiceSnapshot): void {
    validateInvoiceSnapshot(snapshot);
    if (String(snapshot.tenantId) !== String(candidate.tenantId) || snapshot.kind !== 'abonnement'
      || +snapshot.period.start !== +candidate.period.start || +snapshot.period.end !== +candidate.period.end) {
      throw new ServiceUnavailableException('Réservation de facture incohérente : rapprochement requis.');
    }
  }

  private async checkHistory(snapshot: InvoiceSnapshot, allowedId?: Types.ObjectId): Promise<void> {
    const active = await this.invoices.find({
      tenantId: snapshot.tenantId, kind: 'abonnement', 'period.start': snapshot.period.start,
      status: { $ne: 'annulee' },
    }).limit(2).read('primary').readConcern('majority').maxTimeMS(10_000).lean();
    if (active.length > 1) {
      throw new ServiceUnavailableException('Plusieurs abonnements actifs pour cette période : rapprochez les factures existantes avant toute émission.');
    }
    if (active[0] && String(active[0]._id) !== String(allowedId)) throw new DuplicateInvoiceException(active[0]);
  }
}
