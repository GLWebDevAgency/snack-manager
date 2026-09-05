import { BadRequestException, ConflictException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import {
  INVOICE_KINDS, INVOICE_PAYMENT_METHODS, STORED_INVOICE_STATUSES,
  formatInvoiceNumber, invoiceCounterId,
} from '@sm/contracts';
import type { Counter, Invoice, InvoicePending, InvoiceSnapshot } from '@sm/db';
import { Model, Types } from 'mongoose';

type WrittenInvoice = Invoice & { _id: unknown };
const MAX_NUMBERING_PASSES = 32;
/** Un timeout est une issue inconnue : on reprend la même réservation, jamais seq--. */
const DURABLE_WRITE = { writeConcern: { w: 'majority' as const, j: true, wtimeout: 10_000 } };
const validDate = (value: unknown): value is Date => value instanceof Date && Number.isFinite(value.getTime());
const optionalDate = (value: unknown): boolean => value == null || validDate(value);
const validId = (value: unknown): boolean => value instanceof Types.ObjectId
  || (typeof value === 'string' && /^[a-fA-F0-9]{24}$/.test(value));

/** Synchrone : le writer de période l'utilise AVANT de créer son propre claim. */
export function validateInvoiceSnapshot(snapshot: InvoiceSnapshot): void {
  if (!snapshot || !validId(snapshot._id) || !validId(snapshot.tenantId)
    || !INVOICE_KINDS.includes(snapshot.kind) || !STORED_INVOICE_STATUSES.some((status) => status === snapshot.status)
    || typeof snapshot.label !== 'string' || !snapshot.label.trim()
    || !validDate(snapshot.period?.start) || !validDate(snapshot.period?.end)
    || snapshot.period.end <= snapshot.period.start
    || !validDate(snapshot.dueAt) || snapshot.dueAt.getUTCFullYear() < 1000 || snapshot.dueAt.getUTCFullYear() > 9999
    || !optionalDate(snapshot.issuedAt) || !optionalDate(snapshot.paidAt)
    || !Number.isSafeInteger(snapshot.amountCents)
    || !snapshot.vat || !Number.isFinite(snapshot.vat.ratePercent) || snapshot.vat.ratePercent < 0
    || !['ht', 'ttc'].includes(snapshot.vat.amountsAre)
    || (snapshot.method != null && !INVOICE_PAYMENT_METHODS.includes(snapshot.method))) {
    throw new BadRequestException('Instantané de facture invalide : aucune réservation n’a été effectuée.');
  }
}

function copySnapshot(snapshot: InvoiceSnapshot): InvoiceSnapshot {
  return {
    _id: new Types.ObjectId(String(snapshot._id)), tenantId: new Types.ObjectId(String(snapshot.tenantId)),
    kind: snapshot.kind, label: snapshot.label, amountCents: snapshot.amountCents,
    period: { start: new Date(snapshot.period.start), end: new Date(snapshot.period.end) },
    vat: { ratePercent: snapshot.vat.ratePercent, amountsAre: snapshot.vat.amountsAre },
    status: snapshot.status, dueAt: new Date(snapshot.dueAt),
    issuedAt: snapshot.issuedAt == null ? null : new Date(snapshot.issuedAt),
    paidAt: snapshot.paidAt == null ? null : new Date(snapshot.paidAt), method: snapshot.method ?? null,
  };
}

const duplicateKey = (error: unknown): boolean =>
  !!error && typeof error === 'object' && 'code' in error && error.code === 11000;

function sameDate(left: unknown, right: Date): boolean {
  return validDate(left) && left.getTime() === right.getTime();
}

/** Les états de règlement/envoi/annulation changent après émission, pas ces valeurs. */
function assertSameInvoice(invoice: WrittenInvoice, snapshot: InvoiceSnapshot, number?: string): void {
  const year = snapshot.dueAt.getUTCFullYear();
  const sequence = Number(invoice.number?.slice(`SM-${year}-`.length));
  if (!Number.isSafeInteger(sequence) || sequence < 1 || invoice.number !== formatInvoiceNumber(year, sequence)
    || (number !== undefined && invoice.number !== number)
    || String(invoice._id) !== String(snapshot._id) || String(invoice.tenantId) !== String(snapshot.tenantId)
    || invoice.kind !== snapshot.kind || invoice.label !== snapshot.label || invoice.amountCents !== snapshot.amountCents
    || !sameDate(invoice.period?.start, snapshot.period.start) || !sameDate(invoice.period?.end, snapshot.period.end)
    || !sameDate(invoice.dueAt, snapshot.dueAt)
    || invoice.vat?.ratePercent !== snapshot.vat.ratePercent || invoice.vat?.amountsAre !== snapshot.vat.amountsAre) {
    throw new ConflictException('La facture ne correspond pas à sa réservation. Rapprochement requis avant de poursuivre.');
  }
}

/**
 * Un numéro réservé porte son travail restant dans LE MÊME document Counter.
 * Toute instance peut terminer ce travail ; aucune expiration de bail, aucun
 * décrément ne peut réattribuer un numéro après une réponse réseau perdue.
 * Tous les écrivains de la séquence doivent utiliser ce protocole.
 */
@Injectable()
export class InvoiceNumberingService {
  constructor(
    @InjectModel('Invoice') private readonly invoices: Model<Invoice>,
    @InjectModel('Counter') private readonly counters: Model<Counter>,
  ) {}

  async write(input: InvoiceSnapshot): Promise<WrittenInvoice> {
    validateInvoiceSnapshot(input);
    // Ne pas retenir les objets Date/nested du demandeur pendant les await.
    const snapshot = copySnapshot(input);
    const year = snapshot.dueAt.getUTCFullYear();
    const counterId = invoiceCounterId(year);
    try {
      await this.counters.updateOne({ _id: counterId }, {
        $setOnInsert: { _id: counterId, seq: 0, pendingInvoice: null },
      }, { upsert: true, ...DURABLE_WRITE });
    } catch (error) {
      // Deux initialisations peuvent se croiser ; seul _id arbitre. Une panne
      // quelconque n'est pas assimilée à cette collision connue.
      if (!duplicateKey(error)) throw error;
    }

    for (let pass = 0; pass < MAX_NUMBERING_PASSES; pass += 1) {
      // CRITIQUE : lire Counter AVANT Invoice. Si Invoice est lu absent puis
      // qu'un concurrent la termine, un compteur lu après permettrait de lui
      // réserver un second numéro. Ici le CAS de l'ancienne seq échoue.
      const counter = await this.counters.findById(counterId).read('primary').lean();
      if (!counter || !Number.isSafeInteger(counter.seq) || counter.seq < 0) {
        throw new ConflictException('Compteur de factures incohérent. Rapprochement requis.');
      }
      if (counter.pendingInvoice != null) {
        await this.materialize(counterId, counter.seq, counter.pendingInvoice);
        continue;
      }

      const existing = await this.invoices.findById(snapshot._id).read('primary').lean() as WrittenInvoice | null;
      if (existing) {
        assertSameInvoice(existing, snapshot);
        return existing;
      }
      if (!Number.isSafeInteger(counter.seq + 1)) {
        throw new ConflictException('La séquence de facturation a atteint sa limite.');
      }
      const pending: InvoicePending = { snapshot, number: formatInvoiceNumber(year, counter.seq + 1) };
      // Pas d'upsert : une défaite CAS ne doit jamais créer un autre compteur.
      await this.counters.updateOne({ _id: counterId, seq: counter.seq, pendingInvoice: null }, {
        $inc: { seq: 1 }, $set: { pendingInvoice: pending },
      }, { runValidators: true, ...DURABLE_WRITE });
      // Réussite, défaite ou aide d'un autre writer : relire toute la situation.
    }
    throw new ServiceUnavailableException('La numérotation est occupée. Réessayez la même demande.');
  }

  private async materialize(counterId: string, seq: number, pending: InvoicePending): Promise<void> {
    try { validateInvoiceSnapshot(pending.snapshot); }
    catch { throw new ConflictException('Réservation de facture invalide. Rapprochement requis.'); }
    const year = pending.snapshot.dueAt.getUTCFullYear();
    if (seq < 1 || counterId !== invoiceCounterId(year) || pending.number !== formatInvoiceNumber(year, seq)) {
      throw new ConflictException('Numéro réservé incohérent. La réservation est conservée pour rapprochement.');
    }
    const now = new Date();
    try {
      await this.invoices.updateOne({ _id: pending.snapshot._id }, { $setOnInsert: {
        ...copySnapshot(pending.snapshot), number: pending.number,
        cancelledAt: null, cancelReason: '', createdAt: now, updatedAt: now,
      } }, { upsert: true, runValidators: true, timestamps: false, ...DURABLE_WRITE });
    } catch (error) {
      // Une collision n'est un rejeu QUE si la relecture ci-dessous le prouve.
      // Une I/O échouée laisse pending intact, même si l'insertion a réussi.
      if (!duplicateKey(error)) throw error;
    }
    const invoice = await this.invoices.findById(pending.snapshot._id).read('primary').lean() as WrittenInvoice | null;
    if (!invoice) {
      throw new ConflictException('La facture réservée n’a pas pu être matérialisée. Rapprochement requis.');
    }
    assertSameInvoice(invoice, pending.snapshot, pending.number);
    // Un helper ancien ne doit pas effacer le travail d'un numéro suivant.
    // Aucun statut de facture n'est réécrit, même s'il a été annulé ou payé.
    await this.counters.updateOne({
      _id: counterId, seq, 'pendingInvoice.snapshot._id': pending.snapshot._id,
      'pendingInvoice.number': pending.number,
    }, { $set: { pendingInvoice: null } }, DURABLE_WRITE);
  }
}
