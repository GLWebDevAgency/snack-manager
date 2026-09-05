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

export type OrderRefundSummary = {
  refundedCents: number;
  pendingRefundCents: number;
  remainingCents: number;
  status: 'none' | 'partial' | 'pending' | 'refunded';
  refunds: { id: string; amountCents: number; status: string }[];
};
