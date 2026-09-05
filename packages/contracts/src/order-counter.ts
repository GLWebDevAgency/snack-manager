import { z } from 'zod';

const cents = z.number().int().min(0).max(100_000_000);
const common = {
  operationId: z.uuid({ version: 'v4' }),
  /** A freshness check only. The order stored by the server owns the amount. */
  expectedTotalCents: cents,
};

/** An explicit observation at the till, never a new sale or a Stripe request. */
export const CollectOrderPaymentSchema = z.discriminatedUnion('tender', [
  z.object({ ...common, tender: z.literal('cash'), cashReceivedCents: cents }).strict(),
  z.object({ ...common, tender: z.literal('card') }).strict(),
  z.object({ ...common, tender: z.literal('meal_voucher') }).strict(),
]);
export type CollectOrderPayment = z.infer<typeof CollectOrderPaymentSchema>;

