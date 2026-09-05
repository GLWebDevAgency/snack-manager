import { Schema, type InferSchemaType } from 'mongoose';
import { SM_INVOICE_VAT } from '@sm/contracts';

/** Instantané privé figé AVANT toute réservation de numéro. Pas de secret Stripe. */
export const InvoiceSnapshotSchema = new Schema({
  _id: { type: Schema.Types.ObjectId, required: true },
  tenantId: { type: Schema.Types.ObjectId, required: true },
  kind: { type: String, enum: ['abonnement', 'mise_en_place', 'option', 'autre', 'avoir'], required: true },
  label: { type: String, required: true },
  period: { type: new Schema({ start: { type: Date, required: true }, end: { type: Date, required: true } }, { _id: false }), required: true },
  amountCents: { type: Number, required: true },
  vat: { type: new Schema({ ratePercent: { type: Number, required: true, min: 0 }, amountsAre: { type: String, enum: ['ht', 'ttc'], required: true } }, { _id: false }), required: true, default: () => ({ ...SM_INVOICE_VAT }) },
  status: { type: String, enum: ['brouillon', 'envoyee', 'en_retard', 'payee', 'annulee'], required: true },
  issuedAt: { type: Date, default: null },
  dueAt: { type: Date, required: true },
  paidAt: { type: Date, default: null },
  method: { type: String, enum: ['prelevement', 'virement', 'carte', 'cheque', null], default: null },
}, { versionKey: false });
export type InvoiceSnapshot = InferSchemaType<typeof InvoiceSnapshotSchema>;

/** Une réservation de numéro au maximum par année ; reprise sans bail expirant. */
export const InvoicePendingSchema = new Schema({
  snapshot: { type: InvoiceSnapshotSchema, required: true },
  number: { type: String, required: true },
}, { _id: false });
export type InvoicePending = InferSchemaType<typeof InvoicePendingSchema>;

/** L'unicité native de `_id` arbitre la période, sans toucher aux anciennes factures. */
export const InvoiceIssuanceSchema = new Schema({
  _id: { type: String, required: true },
  snapshot: { type: InvoiceSnapshotSchema, required: true },
}, { timestamps: true, versionKey: false });
export type InvoiceIssuance = InferSchemaType<typeof InvoiceIssuanceSchema>;
