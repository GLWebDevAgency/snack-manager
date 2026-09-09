import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { CreatePublicOrderSchema, CustomerCreateOrderRequestSchema, CustomerOrdersQuerySchema,
  CustomerOrdersPageSchema, CustomerOrderDetailResponseSchema, customerAccountRequestLimit, customerAccountResponseLimit } from './index';
const summary = { _id: 'a'.repeat(24), number: 12, createdAt: '2026-09-09T12:00:00.000Z', status: 'ready', type: 'pickup',
  pickupSlot: null, totalCents: 1290, payment: { method: 'counter', status: 'pending', refundedCents: 0, pendingRefundCents: 0 } };
describe('customer orders strict authority and projection contracts', () => {
  it('reuses the public order DTO exactly, with a durable proof mandatory for account creation', () => {
    const body = { clientId: randomUUID(), recoveryProof: 'a'.repeat(64), turnstileToken: 'fixture',
      lines: [{ productId: 'a'.repeat(24), qty: 1 }], payment: { method: 'counter' },
      pickup: { slot: '2026-09-09T12:00:00.000Z', customerName: 'Fixture', customerPhone: '0612345678' } };
    expect(CustomerCreateOrderRequestSchema.parse(body)).toEqual(CreatePublicOrderSchema.parse(body));
    expect(CustomerCreateOrderRequestSchema.safeParse({ ...body, recoveryProof: undefined }).success).toBe(false);
    for (const key of ['accountId', 'customerOwner', 'parentRef', 'tenantRef', 'price', 'status', 'loyaltyMemberId']) {
      expect(CustomerCreateOrderRequestSchema.safeParse({ ...body, [key]: 'forged' }).success).toBe(false);
    }
  });
  it.each([0, 31, 1.2, '20'])('refuses invalid page limit %s', limit => {
    expect(CustomerOrdersQuerySchema.safeParse({ filter: 'all', limit, cursor: null }).success).toBe(false);
  });
  it('does not accept an owner, phone or raw filter in a history request', () => {
    const input = { filter: 'active', limit: 20, cursor: null };
    expect(CustomerOrdersQuerySchema.safeParse(input).success).toBe(true);
    for (const field of ['accountId', 'tenantId', 'phone', '$where', 'trackingToken']) {
      expect(CustomerOrdersQuerySchema.safeParse({ ...input, [field]: 'forged' }).success).toBe(false);
    }
  });
  it('keeps financial state separate from a kitchen-ready status and excludes personal selectors', () => {
    const page = { expiresAt: Date.now() + 60_000, orders: [summary], nextCursor: null };
    expect(CustomerOrdersPageSchema.parse(page).orders[0]?.payment.status).toBe('pending');
    for (const field of ['trackingToken', 'customerOwner', 'phone', 'address', 'stripePaymentIntentId']) {
      expect(CustomerOrdersPageSchema.safeParse({ ...page, orders: [{ ...summary, [field]: 'private' }] }).success).toBe(false);
    }
  });
  it('requires a complete detail projection rather than treating a summary as a ticket', () => {
    expect(CustomerOrderDetailResponseSchema.safeParse({ expiresAt: Date.now() + 60_000, order: summary }).success).toBe(false);
  });
  it('separates bounded order creation and detail response budgets', () => {
    expect(customerAccountRequestLimit('order-create')).toBe(65_536);
    expect(customerAccountRequestLimit('orders')).toBe(4096);
    expect(customerAccountResponseLimit('orders')).toBe(65_536);
    expect(customerAccountResponseLimit('order-detail')).toBe(1_048_576);
  });
});
