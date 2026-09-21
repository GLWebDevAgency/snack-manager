import { describe, expect, it } from 'vitest';
import type { CounterRefundJournal } from '@sm/contracts';
import { reconcileCounterRefundSummary } from './journal-refunds';
import { zFromJournal, type DayEntry } from './pos-state';
const entry: DayEntry = { clientId: 'local', localNumber: 1, serverId: 'a'.repeat(24), serverNumber: 1,
  mode: 'emporter', method: 'especes', paid: true, total: 1200, discount: 200, items: 1, at: 1 };
const view: CounterRefundJournal = { orderId: entry.serverId!, enabled: true, available: true, unavailableReason: null,
  observedAt: '2026-09-21T12:00:00.000Z', tender: 'cash', originalPaidCents: 1000, refundedCents: 250,
  pendingRefundCents: 150, remainingCents: 600, basis: { merchandiseCents: 1000, deliveryCents: 0 },
  remaining: { merchandiseCents: 600, deliveryCents: 0 }, canResolveNoEffect: false, operations: [] };
describe('canonical counter refund to local journal', () => {
  it('preserves the gross sale, discounts and reserves while deducting only the confirmed refund', () => {
    const result = reconcileCounterRefundSummary([entry], view);
    expect(result[0]).toMatchObject({ total: 1200, discount: 200, refundedCents: 250 });
    expect(zFromJournal(result)).toMatchObject({ collected: 1000, refunded: 250, netCollected: 750, cash: 750, ca: 750 });
    expect(entry).not.toHaveProperty('refundedCents');
  });
  it('never imports other sales, matches exact order and paid amount, and rejects malformed receipts', () => {
    expect(reconcileCounterRefundSummary([], view)).toEqual([]);
    for (const local of [{ ...entry, serverId: 'b'.repeat(24) }, { ...entry, total: 1300 }, { ...entry, paid: false }]) {
      expect(reconcileCounterRefundSummary([local], view)).toEqual([local]);
    }
    expect(() => reconcileCounterRefundSummary([entry], { ...view, refundedCents: -1 })).toThrow();
  });
  it('cannot undo a confirmed partial or historical full refund on a delayed read or reload', () => {
    const partial = reconcileCounterRefundSummary([entry], view);
    const delayed = { ...view, refundedCents: 0, remainingCents: 850, remaining: { merchandiseCents: 850, deliveryCents: 0 } };
    expect(reconcileCounterRefundSummary(JSON.parse(JSON.stringify(partial)), delayed)[0]?.refundedCents).toBe(250);
    const legacy = { ...entry, refunded: true as const };
    expect(zFromJournal(reconcileCounterRefundSummary([legacy], view))).toMatchObject({ collected: 1000, refunded: 1000, netCollected: 0, ca: 0 });
  });
});
