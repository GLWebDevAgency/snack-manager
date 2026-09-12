import { Schema, type InferSchemaType } from 'mongoose';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
/** A release may arrive before a delayed pricing insert. Its tombstone must
 * survive without a snapshot and must never be replaced by $setOnInsert. */
export const DiningOrderPricingSchema = new Schema({
  _id: { type: String, required: true },
  tenantId: { type: Schema.Types.ObjectId, required: true },
  operationId: { type: String, required: true, match: uuid },
  sessionId: { type: String, default: null, match: uuid },
  payloadHash: { type: String, default: null, match: /^[a-f0-9]{64}$/ },
  snapshot: { type: Schema.Types.Mixed, default: null },
  released: { type: Boolean, required: true, default: false },
}, { timestamps: true });
export type DiningOrderPricingRecord = InferSchemaType<typeof DiningOrderPricingSchema>;
