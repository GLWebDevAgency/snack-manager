import { z } from 'zod';

export const OwnerOrderCancelSchema = z.object({
  password: z.string().min(1).max(256),
  reason: z.string().trim().min(3).max(200),
}).strict();
export type OwnerOrderCancel = z.infer<typeof OwnerOrderCancelSchema>;

export const OrderRefundRequestSchema = OwnerOrderCancelSchema.extend({
  amountCents: z.number().int().positive().max(100_000_000),
  operationId: z.uuid(),
}).strict();
export type OrderRefundRequest = z.infer<typeof OrderRefundRequestSchema>;

/** HTTP compatibility boundary: old tabs cannot initiate financial mutations
 * without the durable client protocol. This is not an authorization proof and
 * is stripped before the immutable business request reaches the service. */
export const OrderRefundMutationRequestSchema = OrderRefundRequestSchema.extend({
  clientProtocolVersion: z.literal(1),
}).strict();
export type OrderRefundMutationRequest = z.infer<typeof OrderRefundMutationRequestSchema>;

export type OrderRefundSummary = {
  refundedCents: number;
  pendingRefundCents: number;
  remainingCents: number;
  status: 'none' | 'partial' | 'pending' | 'refunded';
  refunds: { id: string; amountCents: number; status: string }[];
};

const refundCents = z.number().int().nonnegative().max(100_000_000);
export const OrderRefundSummarySchema = z.strictObject({
  refundedCents: refundCents,
  pendingRefundCents: refundCents,
  remainingCents: refundCents,
  status: z.enum(['none', 'partial', 'pending', 'refunded']),
  refunds: z.array(z.strictObject({ id: z.string().min(1).max(255), amountCents: refundCents.positive(), status: z.string().min(1).max(64) })).max(10_000),
});

/** Private owner projection. No provider credentials, Connect account, payment
 * intent, actor identity or provider metadata leave the financial journal. */
export const OrderRefundOperationViewSchema = z.strictObject({
  orderId: z.string().regex(/^[a-f0-9]{24}$/),
  operationId: z.uuid(),
  amountCents: refundCents.positive(),
  reason: z.string().trim().min(3).max(200),
  state: z.enum(['prepared', 'creating', 'review_required', 'known', 'withdrawn']),
  providerStatus: z.enum(['pending', 'requires_action', 'succeeded', 'failed', 'canceled']).nullable(),
  canResume: z.boolean(),
  preparedAt: z.iso.datetime(),
}).superRefine((value, ctx) => {
  if ((value.state === 'known') !== (value.providerStatus !== null)
    || (value.canResume && ['known', 'review_required', 'withdrawn'].includes(value.state))) {
    ctx.addIssue({ code: 'custom', message: 'État de remboursement incohérent' });
  }
});
export type OrderRefundOperationView = z.infer<typeof OrderRefundOperationViewSchema>;

export const OrderRefundJournalSchema = z.strictObject({
  orderId: z.string().regex(/^[a-f0-9]{24}$/),
  enabled: z.boolean(),
  summary: OrderRefundSummarySchema,
  operations: z.array(OrderRefundOperationViewSchema).max(128),
}).superRefine((value, ctx) => {
  if (value.operations.some(operation => operation.orderId !== value.orderId || (!value.enabled && operation.canResume))
    || new Set(value.operations.map(operation => operation.operationId.toLowerCase())).size !== value.operations.length) {
    ctx.addIssue({ code: 'custom', message: 'Journal de remboursement incohérent' });
  }
});
export type OrderRefundJournal = z.infer<typeof OrderRefundJournalSchema>;
