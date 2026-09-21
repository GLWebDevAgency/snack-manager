import { z } from 'zod';

export const OwnerOrderCancelSchema = z.object({
  password: z.string().min(1).max(256),
  reason: z.string().trim().min(3).max(200),
}).strict();
export type OwnerOrderCancel = z.infer<typeof OwnerOrderCancelSchema>;

const refundCents = z.number().int().nonnegative().max(100_000_000);
export const OrderRefundAllocationSchema = z.strictObject({
  version: z.literal(1), merchandiseCents: refundCents, deliveryCents: refundCents,
}).refine(value => value.merchandiseCents + value.deliveryCents <= 100_000_000, 'Ventilation hors limites');
export type OrderRefundAllocation = z.infer<typeof OrderRefundAllocationSchema>;

export const OrderRefundRequestSchema = OwnerOrderCancelSchema.extend({
  amountCents: z.number().int().positive().max(100_000_000),
  operationId: z.uuid(),
  // Absent/null only for immutable requests prepared by an older client.
  allocation: OrderRefundAllocationSchema.nullable().optional(),
}).strict().refine(value => !value.allocation || value.allocation.merchandiseCents + value.allocation.deliveryCents === value.amountCents, 'La ventilation doit correspondre au montant');
export type OrderRefundRequest = z.infer<typeof OrderRefundRequestSchema>;

/** HTTP compatibility boundary: old tabs cannot initiate financial mutations
 * without the durable client protocol. This is not an authorization proof and
 * is stripped before the immutable business request reaches the service. */
export const OrderRefundMutationRequestSchema = OrderRefundRequestSchema.safeExtend({
  clientProtocolVersion: z.literal(2),
}).strict();
export type OrderRefundMutationRequest = z.infer<typeof OrderRefundMutationRequestSchema>;

export type OrderRefundSummary = {
  refundedCents: number;
  pendingRefundCents: number;
  remainingCents: number;
  status: 'none' | 'partial' | 'pending' | 'refunded';
  refunds: { id: string; amountCents: number; status: string }[];
};

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
  allocation: OrderRefundAllocationSchema.nullable().optional(),
  state: z.enum(['prepared', 'creating', 'review_required', 'known', 'withdrawn']),
  providerStatus: z.enum(['pending', 'requires_action', 'succeeded', 'failed', 'canceled']).nullable(),
  canResume: z.boolean(),
  preparedAt: z.iso.datetime(),
}).superRefine((value, ctx) => {
  if ((value.allocation && value.allocation.merchandiseCents + value.allocation.deliveryCents !== value.amountCents)
    || (value.state === 'known') !== (value.providerStatus !== null)
    || (value.canResume && ['known', 'review_required', 'withdrawn'].includes(value.state))) {
    ctx.addIssue({ code: 'custom', message: 'État de remboursement incohérent' });
  }
});
export type OrderRefundOperationView = z.infer<typeof OrderRefundOperationViewSchema>;

export const OrderRefundAllocationRequestSchema = OwnerOrderCancelSchema.extend({
  operationId: z.uuid(),
  allocation: OrderRefundAllocationSchema.refine(value => value.merchandiseCents + value.deliveryCents > 0, 'Montant requis'),
  clientProtocolVersion: z.literal(2),
}).strict();
export type OrderRefundAllocationRequest = z.infer<typeof OrderRefundAllocationRequestSchema>;

export const OrderRefundAllocationReceiptSchema = z.strictObject({
  state: z.enum(['recorded', 'withdrawn']).default('recorded'),
  operationId: z.uuid(), refundId: z.string().min(1).max(255),
  allocation: OrderRefundAllocationSchema.refine(value => value.merchandiseCents + value.deliveryCents > 0, 'Montant requis'),
  reason: z.string().trim().min(3).max(200), recordedAt: z.iso.datetime(),
});
export type OrderRefundAllocationReceipt = z.infer<typeof OrderRefundAllocationReceiptSchema>;

export const OrderRefundJournalSchema = z.strictObject({
  orderId: z.string().regex(/^[a-f0-9]{24}$/),
  enabled: z.boolean(),
  summary: OrderRefundSummarySchema,
  operations: z.array(OrderRefundOperationViewSchema).max(128),
  allocation: z.strictObject({
    basis: OrderRefundAllocationSchema.nullable(),
    remaining: OrderRefundAllocationSchema.nullable(),
    capacity: OrderRefundAllocationSchema.nullable(),
    unallocated: z.array(z.strictObject({
      refundId: z.string().min(1).max(255), amountCents: refundCents.positive(),
      providerStatus: z.enum(['pending', 'requires_action', 'succeeded', 'failed', 'canceled']),
      canAllocate: z.boolean(),
    })).max(10_000),
  }),
  allocations: z.array(OrderRefundAllocationReceiptSchema).max(10_000),
}).superRefine((value, ctx) => {
  if (value.operations.some(operation => operation.orderId !== value.orderId || (!value.enabled && operation.canResume))
    || new Set(value.allocations.map(receipt => receipt.operationId.toLowerCase())).size !== value.allocations.length
    || new Set(value.allocations.filter(receipt => receipt.state === 'recorded').map(receipt => receipt.refundId)).size !== value.allocations.filter(receipt => receipt.state === 'recorded').length
    || new Set(value.allocation.unallocated.map(refund => refund.refundId)).size !== value.allocation.unallocated.length
    || new Set(value.operations.map(operation => operation.operationId.toLowerCase())).size !== value.operations.length) {
    ctx.addIssue({ code: 'custom', message: 'Journal de remboursement incohérent' });
  }
  const { basis, remaining, capacity } = value.allocation;
  if ([remaining, capacity].some(limits => limits && (!basis || limits.merchandiseCents > basis.merchandiseCents || limits.deliveryCents > basis.deliveryCents))) {
    ctx.addIssue({ code: 'custom', message: 'Limites de ventilation incohérentes' });
  }
});
export type OrderRefundJournal = z.infer<typeof OrderRefundJournalSchema>;
