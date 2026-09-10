import { z } from 'zod';
import { CustomerOrderReorderLineSchema } from './customer-orders';

/** One guest receipt authorizes a minimal source for a new basket review.
 * It never authorizes private account history, payment or another order. */
export const GuestOrderReorderResponseSchema = z.strictObject({
  tenantSlug: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,127}$/),
  orderId: z.string().regex(/^[a-f0-9]{24}$/),
  number: z.number().int().nonnegative(),
  lines: z.array(CustomerOrderReorderLineSchema).max(100),
});
export type GuestOrderReorderResponse = z.infer<typeof GuestOrderReorderResponseSchema>;
