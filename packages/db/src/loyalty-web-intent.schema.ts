import { Query, Schema } from 'mongoose';

export type LoyaltyWebIntent = { version: 1; operationId: string };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** Private protocol marker. Absence on an old ticket never authorizes adoption. */
export function validLoyaltyWebIntent(value: unknown): value is LoyaltyWebIntent {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const plain = 'toObject' in value && typeof value.toObject === 'function' ? value.toObject({ transform: false }) : value;
  return Object.keys(plain).length === 2 && plain.version === 1 && typeof plain.operationId === 'string' && UUID.test(plain.operationId);
}

const intent = new Schema<LoyaltyWebIntent>({
  version: { type: Number, enum: [1], required: true, immutable: true, cast: false },
  operationId: { type: String, match: UUID, required: true, immutable: true, cast: false },
}, { _id: false, strict: 'throw' });

export function loyaltyWebIntentField() {
  return { type: intent, default: null, immutable: true, select: false,
    validate: { validator: function (this: { channel?: unknown; customerSaleAttribution?: unknown }, value: unknown) {
      if (value == null) return true;
      const update = this instanceof Query ? this.getUpdate() : null;
      const inserted = update && !Array.isArray(update) ? update.$setOnInsert : null;
      const attribution = (inserted?.customerSaleAttribution ?? this.customerSaleAttribution) as { decision?: unknown } | null;
      return validLoyaltyWebIntent(value) && (inserted?.channel ?? this.channel) === 'online' && attribution?.decision === 'attributed';
    }, message: 'Intention fidélité web invalide.' } };
}

/** Mutable scheduling state is deliberately outside the immutable intent. */
export const LoyaltyWebProcessingSchema = new Schema({
  state: { type: String, enum: ['pending', 'processing', 'completed', 'reconciliation_required'], required: true },
  dirty: { type: Boolean, required: true, default: true },
  attempts: { type: Number, default: 0, min: 0, validate: Number.isSafeInteger },
  leaseToken: { type: String, default: null },
  leaseUntil: { type: Date, default: null },
  nextAttemptAt: { type: Date, default: null },
  lastError: { type: String, default: null },
  observationId: { type: String, default: null },
  financialFingerprint: { type: String, default: null },
  orderVersion: { type: Number, default: null },
  refundSyncVersion: { type: Number, default: null },
  observedAt: { type: Date, default: null },
  awardedUnits: { type: Number, default: null, min: 0, validate: (value: number | null) => value === null || Number.isSafeInteger(value) },
  reversedUnits: { type: Number, default: null, min: 0, validate: (value: number | null) => value === null || Number.isSafeInteger(value) },
}, { _id: false, strict: 'throw' });
