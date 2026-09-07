import { z } from 'zod';
import { PublicOrderRejectionReasonSchema } from './order-recovery';

const objectId = z.string().regex(/^[a-f0-9]{24}$/i);
const identity = { tenantId: objectId, clientId: z.uuid(), channel: z.literal('phone') };

/** Same immutable body for initial creation, observation and abandonment.
 * Keep existing order defaults; do not normalize names/notes only on replay. */
export const StaffPhoneOrderAttemptRequestSchema = z.object({
  clientId: z.uuid(), channel: z.literal('phone'), type: z.literal('pickup'),
  lines: z.array(z.object({
    productId: objectId, variantKey: z.string().min(1).max(120).optional(),
    options: z.array(z.object({ groupKey: z.string().min(1).max(120), choiceKey: z.string().min(1).max(120) }).strict()).max(30).default([]),
    removed: z.array(z.string().trim().min(1).max(60)).max(20).default([]),
    note: z.string().max(200).optional(), qty: z.number().int().positive().max(50).default(1),
  }).strict()).min(1).max(50),
  payment: z.object({ method: z.literal('counter'), tender: z.null().optional() }).strict(),
  pickup: z.object({ slot: z.iso.datetime(), customerName: z.string().min(1).max(120), customerPhone: z.string().max(32).optional() }).strict(),
  note: z.string().max(500).optional(), promoCode: z.string().trim().min(1).max(24).optional(),
}).strict();
export type StaffPhoneOrderAttemptRequest = z.infer<typeof StaffPhoneOrderAttemptRequestSchema>;

/** Authenticated staff receipt. The POS additionally verifies the entire
 * immutable request against the returned lines before clearing its journal. */
export const StaffPhoneOrderReceiptSchema = z.object({
  _id: objectId, ...identity, type: z.literal('pickup'), number: z.number().int().positive(),
  status: z.enum(['new', 'preparing', 'ready', 'delivered', 'cancelled']),
  pickup: z.object({ slot: z.iso.datetime(), customerName: z.string(), customerPhone: z.string().nullable().optional() }).passthrough(),
  lines: z.array(z.object({ productId: objectId, qty: z.number().int().positive() }).passthrough()).min(1),
  totals: z.object({ total: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER) }).passthrough(),
  trackingToken: z.string().min(1),
  payment: z.object({ method: z.literal('counter'), status: z.enum(['pending', 'paid', 'refunded']),
    tender: z.enum(['cash', 'card', 'meal_voucher']).nullable().optional() }).passthrough(),
}).passthrough();

export const StaffOrderAttemptResultSchema = z.discriminatedUnion('state', [
  z.object({ ...identity, state: z.literal('pending') }).strict(),
  z.object({ ...identity, state: z.literal('created'), order: StaffPhoneOrderReceiptSchema }).strict(),
  z.object({ ...identity, state: z.literal('rejected'), code: z.literal('ORDER_ATTEMPT_REJECTED'),
    reason: PublicOrderRejectionReasonSchema, message: z.string().min(1) }).strict(),
]).superRefine((value, context) => {
  if (value.state === 'created' && (value.order.tenantId !== value.tenantId || value.order.clientId !== value.clientId)) {
    context.addIssue({ code: 'custom', message: 'Le reçu appartient à une autre tentative.', path: ['order'] });
  }
});
export type StaffOrderAttemptResult = z.infer<typeof StaffOrderAttemptResultSchema>;
