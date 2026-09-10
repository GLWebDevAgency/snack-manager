import { Schema } from 'mongoose';

const options = { _id: false, strict: 'throw' as const };
const text = { type: String, cast: false };
const presentText = { ...text, required: true, validate: (value: string) => value.trim().length > 0 };
const cents = { type: Number, cast: false, required: true, min: 1, max: 100_000_000, validate: Number.isSafeInteger };
const date = { type: Date, cast: false, validate: (value: Date | null) => value === null || Number.isFinite(value.getTime()) };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Observation fournisseur seulement : aucune interprétation du statut ni
 * reconstitution d'un remboursement à partir du paiement courant. */
const RefundProofSchema = new Schema({
  id: presentText,
  amount: cents,
  currency: { ...text, enum: ['eur'], required: true },
  payment_intent: presentText,
  status: { ...text, enum: ['pending', 'requires_action', 'succeeded', 'failed', 'canceled'], required: true },
  metadata: { type: new Schema({ operationId: text, orderId: text, tenantId: text, requestedBy: text, reason: text }, options) },
}, options);

const RefundOperationSchema = new Schema({
  operationId: { ...presentText, validate: (value: string) => value.length === 36 && uuid.test(value) },
  amountCents: cents,
  reason: { ...presentText, minlength: 3, maxlength: 200 },
  actorId: presentText,
  environment: { ...text, enum: ['test', 'live'], required: true },
  paymentIntentId: presentText,
  accountId: { ...text, validate: (value: string | null) => value === null || value.trim().length > 0 },
  idempotencyKey: presentText,
  preparedAt: { ...date, required: true },
  requestStartedAt: date,
  state: { ...text, enum: ['prepared', 'creating', 'known', 'review_required'], required: true },
  refund: { type: RefundProofSchema },
  providerCheckedAt: date,
  reviewReason: text,
}, options);

/** Journal privé préparé AVANT le premier appel fournisseur. Aucun défaut
 * n'invente de version, opération, horodatage ou preuve pour l'historique.
 * La monotonie des opérations et les transitions CAS appartiennent au service,
 * pas à une validation ODM incapable d'observer la version Mongo précédente. */
export const OrderRefundFlowSchema = new Schema({
  version: { type: Number, cast: false, enum: [1], required: true },
  operations: { type: [RefundOperationSchema], required: true, default: undefined, castNonArrays: false,
    validate: { validator: (rows: unknown[]) => rows.length <= 128, message: 'Journal de remboursement trop volumineux.' } },
}, options);
