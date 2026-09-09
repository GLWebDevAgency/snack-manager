import { z } from 'zod';
import { CreatePublicOrderSchema } from './order-input';
import { DeliveryAddressSchema } from './delivery';
import { PublicOrderRejectionReasonSchema } from './order-recovery';

const id = z.string().regex(/^[a-f0-9]{24}$/);
const money = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const date = z.iso.datetime();
const status = z.enum(['new', 'preparing', 'ready', 'delivered', 'cancelled']);
const payment = z.strictObject({ method: z.enum(['online', 'counter']), status: z.enum(['pending', 'paid', 'refunded']),
  refundedCents: money, pendingRefundCents: money });
const totals = z.strictObject({ subtotal: money, deliveryFee: money, discount: z.strictObject({ amount: money, reason: z.string().max(500) }).nullable(), total: money });
export const CustomerOrdersCursorSchema = z.strictObject({ createdAt: date, id });
export const CustomerOrdersQuerySchema = z.strictObject({ filter: z.enum(['all', 'active', 'past']), limit: z.number().int().min(1).max(30),
  cursor: CustomerOrdersCursorSchema.nullable() });
export type CustomerOrdersQuery = z.infer<typeof CustomerOrdersQuerySchema>;
export const CustomerOrderDetailRequestSchema = z.strictObject({ orderId: id });
// Same public DTO; only the durable recovery proof becomes mandatory.
export const CustomerCreateOrderRequestSchema = CreatePublicOrderSchema
  .refine(value => typeof value.recoveryProof === 'string', 'Une preuve de reprise est requise.');
export const CustomerOrderSummarySchema = z.strictObject({ _id: id, number: z.number().int().nonnegative(), createdAt: date,
  status, type: z.enum(['pickup', 'delivery']), pickupSlot: date.nullable(), totalCents: money, payment });
export type CustomerOrderSummary = z.infer<typeof CustomerOrderSummarySchema>;
export const CustomerOrdersPageSchema = z.strictObject({ expiresAt: z.number().int().positive(),
  orders: z.array(CustomerOrderSummarySchema).max(30), nextCursor: CustomerOrdersCursorSchema.nullable() });
export type CustomerOrdersPage = z.infer<typeof CustomerOrdersPageSchema>;
export const CustomerOrderLineSchema = z.strictObject({ name: z.string().min(1).max(300), variantName: z.string().max(300).nullable(),
  qty: z.number().int().min(1).max(999), unitPrice: money, lineTotal: money,
  options: z.array(z.strictObject({ name: z.string().max(300), priceDelta: z.number().int().min(-Number.MAX_SAFE_INTEGER).max(Number.MAX_SAFE_INTEGER) })).max(100),
  removed: z.array(z.string().max(300)).max(100), note: z.string().max(1000).nullable() });
export const CustomerOrderDetailSchema = CustomerOrderSummarySchema.extend({ totals,
  lines: z.array(CustomerOrderLineSchema).max(100), note: z.string().max(1000).nullable(),
  statusHistory: z.array(z.strictObject({ status, at: date })).max(100),
  delivery: z.strictObject({ dispatchedAt: date.nullable(), deliveredAt: date.nullable(), estimatedMinutes: z.number().int().nonnegative() }).nullable() });
export type CustomerOrderDetail = z.infer<typeof CustomerOrderDetailSchema>;
export const CustomerOrderDetailResponseSchema = z.strictObject({ expiresAt: z.number().int().positive(), order: CustomerOrderDetailSchema });
export const CustomerOrderCreatedSchema = z.strictObject({ _id: id, number: z.number().int().nonnegative(), status,
  type: z.enum(['pickup', 'delivery']), payment: payment.omit({ refundedCents: true, pendingRefundCents: true }), totals,
  pickup: z.strictObject({ slot: date, customerName: z.string().max(300) }).nullable(), trackingToken: z.string().min(1).max(512),
  delivery: z.strictObject({ address: DeliveryAddressSchema, instructions: z.string().max(300).optional(),
    zoneId: z.string().max(40), zoneName: z.string().max(100), feeCents: money, estimatedMinutes: z.number().int().nonnegative(),
    dispatchedAt: date.nullable(), deliveredAt: date.nullable(), driverName: z.string().max(120).nullable() }).nullable() });
export type CustomerOrderCreated = z.infer<typeof CustomerOrderCreatedSchema>;
export const CustomerOrderCreateResponseSchema = z.discriminatedUnion('state', [
  z.strictObject({ state: z.literal('created'), expiresAt: z.number().int().positive(), order: CustomerOrderCreatedSchema }),
  z.strictObject({ state: z.literal('rejected'), expiresAt: z.number().int().positive(), reason: PublicOrderRejectionReasonSchema, message: z.string().max(300) }),
]);
export type CustomerOrderCreateResponse = z.infer<typeof CustomerOrderCreateResponseSchema>;
