import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { CustomerOrderReorderRequestSchema, CustomerOrderReorderResponseSchema } from './customer-orders';
import { CustomerAccountActionSchema, CustomerAccountBrowserRequests, CustomerAccountEnvelopes,
  CustomerAccountResponses, customerAccountRequestLimit, customerAccountResponseLimit } from './customer-account';

const line = { productId: 'a'.repeat(24), name: 'Burger', variantKey: 'large', variantName: 'Grand', qty: 2,
  unitPrice: 1250, options: [{ groupKey: 'sauce', choiceKey: 'mustard' }], removed: ['Oignon'] };
const result = { expiresAt: 2_000_000_000_000, orderId: 'b'.repeat(24), number: 17, lines: [line] };
describe('private reorder source, additive strict contract', () => {
  it('accepts only an order identifier from the browser', () => {
    expect(CustomerOrderReorderRequestSchema.parse({ orderId: result.orderId })).toEqual({ orderId: result.orderId });
    expect(CustomerOrderReorderRequestSchema.safeParse({ orderId: result.orderId, accountId: randomUUID() }).success).toBe(false);
  });
  it('accepts the exact bounded source and explicit legacy nulls', () => {
    expect(CustomerOrderReorderResponseSchema.parse(result)).toEqual(result);
    expect(CustomerOrderReorderResponseSchema.parse({ ...result, lines: [{ ...line,
      productId: null, variantKey: null, variantName: null, options: [{ groupKey: null, choiceKey: null }] }] }).lines[0]?.productId).toBeNull();
  });
  it.each(['note', 'trackingToken', 'recoveryProof', 'address', 'payment', 'pickup', 'image', 'customerOwner'])('rejects extra private field %s at either level', key => {
    expect(CustomerOrderReorderResponseSchema.safeParse({ ...result, [key]: 'forbidden' }).success).toBe(false);
    expect(CustomerOrderReorderResponseSchema.safeParse({ ...result, lines: [{ ...line, [key]: 'forbidden' }] }).success).toBe(false);
  });
  it.each([{ productId: 'legacy' }, { variantKey: '' }, { qty: 0 }, { qty: 1000 }, { qty: 1.5 }, { unitPrice: -1 },
    { unitPrice: 1.5 }, { options: [{ groupKey: 'sauce', choiceKey: 'mustard', name: 'not needed' }] }])('rejects malformed source %#', patch => {
    expect(CustomerOrderReorderResponseSchema.safeParse({ ...result, lines: [{ ...line, ...patch }] }).success).toBe(false);
  });
  it('requires the signed browser and exact publication alongside the session', () => {
    expect(CustomerAccountActionSchema.parse('order-reorder')).toBe('order-reorder');
    const request = { orderId: result.orderId };
    const envelope = { browserRef: randomUUID(), browserSecret: 'A'.repeat(43), sessionToken: 'B'.repeat(42) + 'A',
      expectedOperationId: randomUUID(), expectedCheckId: randomUUID(), request };
    expect(CustomerAccountBrowserRequests['order-reorder'].parse(request)).toEqual(request);
    expect(CustomerAccountEnvelopes['order-reorder'].parse(envelope)).toEqual(envelope);
    for (const field of ['browserRef', 'browserSecret', 'sessionToken', 'expectedOperationId', 'expectedCheckId'] as const) {
      expect(CustomerAccountEnvelopes['order-reorder'].safeParse({ ...envelope, [field]: undefined }).success).toBe(false);
    }
    expect(CustomerAccountResponses['order-reorder'].parse(result)).toEqual(result);
    expect(customerAccountRequestLimit('order-reorder')).toBe(4096);
    expect(customerAccountResponseLimit('order-reorder')).toBe(1_048_576);
  });
});
