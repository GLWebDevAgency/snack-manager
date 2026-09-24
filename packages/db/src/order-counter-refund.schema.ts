import { Schema } from 'mongoose';

const actor = new Schema({
  sub: { type: String, required: true, match: /^[a-f0-9]{24}$/ },
  kind: { type: String, enum: ['user', 'staff'], required: true },
  role: { type: String, enum: ['owner', 'cogerant', 'gerant', 'caisse'], required: true },
}, { _id: false, strict: 'throw' });
const cents = { type: Number, min: 0, max: 100_000_000, validate: Number.isSafeInteger, required: true };
const operation = new Schema({
  operationId: { type: String, required: true }, amountCents: { ...cents, min: 1 },
  reason: { type: String, required: true, minlength: 3, maxlength: 200 },
  tender: { type: String, enum: ['cash', 'card'], required: true },
  allocation: { type: new Schema({ version: { type: Number, enum: [1], required: true },
    merchandiseCents: cents, deliveryCents: cents }, { _id: false, strict: 'throw' }), required: true },
  actor: { type: actor, required: true }, approver: { type: actor, required: true },
  state: { type: String, enum: ['prepared', 'started', 'confirmed', 'withdrawn', 'not_executed'], required: true },
  preparedAt: { type: Date, required: true }, startedAt: { type: Date, default: null },
  disburseExpiresAt: { type: Date, default: null },
  confirmedAt: { type: Date, default: null }, resolvedAt: { type: Date, default: null },
  attestation: { type: String, enum: ['cash_returned', 'terminal_refund_confirmed', null], default: null },
  resolution: { type: new Schema({ actor: { type: actor, required: true },
    reason: { type: String, required: true, minlength: 3, maxlength: 200 } }, { _id: false, strict: 'throw' }), default: null },
}, { _id: false, strict: 'throw' });
export const OrderCounterRefundFlowSchema = new Schema({
  version: { type: Number, enum: [1], required: true },
  paymentProofHash: { type: String, required: true, match: /^[a-f0-9]{64}$/ },
  operations: { type: [operation], required: true, validate: (value: unknown[]) => Array.isArray(value) && value.length <= 128 },
}, { _id: false, strict: 'throw' });
