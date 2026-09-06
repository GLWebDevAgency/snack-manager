import { z } from 'zod';

/** 32 octets CSPRNG générés et persistés côté navigateur AVANT le premier POST. */
export const PublicOrderRecoveryProofSchema = z.string().regex(/^[a-f0-9]{64}$/);
export const RecoverPublicOrderSchema = z.object({
  clientId: z.uuid(),
  recoveryProof: PublicOrderRecoveryProofSchema,
}).strict();
export type RecoverPublicOrder = z.infer<typeof RecoverPublicOrderSchema>;

/** Reçu minimal, pas un profil client ni une confirmation de paiement implicite. */
export const PublicOrderRecoveryReceiptSchema = z.object({
  _id: z.string().min(1),
  number: z.number().int().nonnegative(),
  status: z.enum(['new', 'preparing', 'ready', 'delivered', 'cancelled']),
  type: z.enum(['pickup', 'delivery']),
  trackingToken: z.string().min(1),
  payment: z.object({
    method: z.enum(['online', 'counter']),
    status: z.enum(['pending', 'paid', 'refunded']),
  }).strict(),
  totals: z.object({ total: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER) }).strict(),
  pickup: z.object({ slot: z.iso.datetime() }).strict().nullable(),
}).strict();
export type PublicOrderRecoveryReceipt = z.infer<typeof PublicOrderRecoveryReceiptSchema>;

export const PublicOrderRejectionReasonSchema = z.enum(['unavailable', 'slot_unavailable', 'invalid_order', 'abandoned']);
export type PublicOrderRejectionReason = z.infer<typeof PublicOrderRejectionReasonSchema>;
export const PublicOrderRecoveryResultSchema = z.discriminatedUnion('state', [
  z.object({ state: z.literal('created'), order: PublicOrderRecoveryReceiptSchema }).strict(),
  z.object({ state: z.literal('pending') }).strict(),
  z.object({ state: z.literal('rejected'), code: z.literal('ORDER_ATTEMPT_REJECTED'), reason: PublicOrderRejectionReasonSchema, message: z.string() }).strict(),
]);
export type PublicOrderRecoveryResult = z.infer<typeof PublicOrderRecoveryResultSchema>;
