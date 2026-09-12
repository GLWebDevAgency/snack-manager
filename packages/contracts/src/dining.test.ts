import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { DiningAddOrderSchema, DiningTableCreateSchema, DiningTableUpdateSchema } from './index';

const body = () => {
  const operationId = randomUUID();
  return { operationId, expectedRevision: 3, order: { clientId: operationId, channel: 'pos', type: 'surplace',
    lines: [{ productId: '507f1f77bcf86cd799439012', qty: 1 }], payment: { method: 'counter', tender: null } } };
};
describe('authenticated table service contracts', () => {
  it('accepts an unpaid immutable kitchen ticket, same UUID, without prices', () => {
    expect(DiningAddOrderSchema.parse(body()).order.lines[0]).toEqual({ productId: '507f1f77bcf86cd799439012', qty: 1, options: [], removed: [] });
  });
  it.each(['card', 'cash', 'meal_voucher'])('refuses a payment at admission (%s)', (tender) => {
    const input = body(); input.order.payment.tender = tender as never;
    expect(DiningAddOrderSchema.safeParse(input).success).toBe(false);
  });
  it('refuses another client UUID, online/phone channels and non-dining fulfillments', () => {
    const input = body();
    for (const changes of [{ clientId: randomUUID() }, { channel: 'online' }, { channel: 'phone' }, { type: 'emporter' }]) {
      expect(DiningAddOrderSchema.safeParse({ ...input, order: { ...input.order, ...changes } }).success).toBe(false);
    }
  });
  it('bounds physical capacity and rejects empty table patches without defaults', () => {
    expect(DiningTableCreateSchema.safeParse({ operationId: randomUUID(), label: '1', seats: 0 }).success).toBe(false);
    expect(DiningTableUpdateSchema.safeParse({ operationId: randomUUID(), expectedRevision: 1 }).success).toBe(false);
    expect(DiningTableUpdateSchema.parse({ operationId: randomUUID(), expectedRevision: 1, active: false })).not.toHaveProperty('seats');
  });
});
