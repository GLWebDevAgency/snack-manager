import { describe, expect, it } from 'vitest';
import { parseCustomerOrderDetail, parseCustomerOrderReorder, parseCustomerOrdersPage } from './orders-response';

const now = 1_800_000_000_000, lifetime = 604_800_000, orderId = 'a'.repeat(24);
const parsers = [
  ['list', (expiresAt: number, maximum?: number) => parseCustomerOrdersPage({ expiresAt, orders: [], nextCursor: null },
    { filter: 'all', limit: 8, cursor: null }, now, maximum)],
  ['detail', (expiresAt: number, maximum?: number) => parseCustomerOrderDetail({ expiresAt, order: {
    _id: orderId, number: 1, createdAt: '2026-09-09T12:00:00.000Z', status: 'ready', type: 'pickup', pickupSlot: null,
    totalCents: 150, payment: { method: 'counter', status: 'paid', refundedCents: 0, pendingRefundCents: 0 },
    totals: { subtotal: 150, deliveryFee: 0, discount: null, total: 150 }, lines: [], note: null, statusHistory: [], delivery: null,
  } }, orderId, now, maximum)],
  ['reorder', (expiresAt: number, maximum?: number) => parseCustomerOrderReorder({ expiresAt, orderId, number: 1, lines: [] }, orderId, now, maximum)],
] as const;

describe.each(parsers)('private %s response clock boundaries', (_name, parse) => {
  it.each([35, 30_000])('accepts a server clock %i ms ahead without rewriting its deadline', skew => {
    const expiresAt = now + lifetime + skew;
    expect(parse(expiresAt).expiresAt).toBe(expiresAt);
    expect(parse(expiresAt, expiresAt).expiresAt).toBe(expiresAt);
  });
  it.each([30_001, 60_000])('rejects implausible future skew %i ms', skew => {
    expect(() => parse(now + lifetime + skew)).toThrow();
  });
  it('never adds clock tolerance to an existing session deadline', () => {
    expect(() => parse(now + 60_001, now + 60_000)).toThrow();
    expect(parse(now + 60_000, now + 60_000).expiresAt).toBe(now + 60_000);
  });
  it.each([now - 1, now])('still refuses an expired response at %i', expiresAt => {
    expect(() => parse(expiresAt)).toThrow();
  });
});
