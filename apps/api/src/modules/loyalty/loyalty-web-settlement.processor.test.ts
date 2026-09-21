import { randomUUID } from 'node:crypto';
import type { Order } from '@sm/db';
import type { Model } from 'mongoose';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LoyaltyHistoricalSaleService } from './loyalty-historical-sale.service';
import { historicalSaleAttributionFingerprint, type HistoricalSaleSettlementInput, type HistoricalSaleSettlementResult } from './loyalty-historical-sale.types';
import { loyaltyWebObservation } from './loyalty-web-observation';
import { LoyaltyWebSettlementProcessor } from './loyalty-web-settlement.processor';
import { loyaltyWebFixture } from './loyalty-web.test-fixture';

const claimed = () => ({ ...loyaltyWebFixture(), loyaltyWebProcessing: { attempts: 1, leaseToken: randomUUID(), leaseUntil: new Date(Date.now() + 60_000) } });
function recorded(input: HistoricalSaleSettlementInput): HistoricalSaleSettlementResult {
  return { kind: 'recorded', replayed: false, receipt: { saleId: randomUUID(), earnOperationId: input.earnOperationId,
    observationId: input.observation.observationId, financialFingerprint: input.observation.financialFingerprint,
    attributionFingerprint: historicalSaleAttributionFingerprint(input.attribution), version: 1, initialUnits: 10,
    reversedUnits: 0, waivedUnits: 0, retainedUnits: 10, dueUnits: 0, earnReceiptId: randomUUID(), earnLedgerEntryId: randomUUID() } };
}
function harness(rows: unknown[]) {
  const query = { select: vi.fn().mockReturnThis(), read: vi.fn().mockReturnThis(), maxTimeMS: vi.fn().mockReturnThis(), lean: vi.fn(async () => rows.shift() ?? null) };
  const scan = { sort: vi.fn().mockReturnThis(), limit: vi.fn().mockReturnThis(), select: vi.fn().mockReturnThis(),
    read: vi.fn().mockReturnThis(), readConcern: vi.fn().mockReturnThis(), maxTimeMS: vi.fn().mockReturnThis(), lean: vi.fn(async (): Promise<unknown[]> => []) };
  const orders = { findOneAndUpdate: vi.fn((_filter: unknown, _update: unknown, _options: unknown) => query),
    find: vi.fn((_filter: unknown) => scan),
    updateOne: vi.fn(async (_filter: unknown, _update: unknown, _options: unknown) => ({ modifiedCount: 1 })) };
  const writer = { readHistoricalSale: vi.fn(async (): Promise<HistoricalSaleSettlementResult> => ({ kind: 'pending', reason: 'not_observed', receipt: null })),
    settleHistoricalSale: vi.fn(async (input: HistoricalSaleSettlementInput) => recorded(input)) };
  return { orders, writer, query, scan, processor: new LoyaltyWebSettlementProcessor(orders as unknown as Model<Order>, writer as unknown as LoyaltyHistoricalSaleService) };
}
beforeEach(() => vi.stubEnv('LOYALTY_WEB_SETTLEMENT_ENABLED', 'true'));
afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); });

describe('web settlement scheduler — closed by default, durable reconciliation', () => {
  it.each([undefined, '', 'false', '1', 'TRUE'])('does not claim or call SQL under closed/non-exact flag %s', flag => {
    vi.stubEnv('LOYALTY_WEB_SETTLEMENT_ENABLED', flag); const f = harness([claimed()]);
    return f.processor.drain().then(result => {
      expect(result.claimed).toBe(0); expect(f.orders.findOneAndUpdate).not.toHaveBeenCalled(); expect(f.writer.readHistoricalSale).not.toHaveBeenCalled();
    });
  });
  it('reads SQL before settling and fences ACK on financial version plus its owned lease', async () => {
    const row = claimed(), f = harness([row]);
    expect(await f.processor.drain()).toEqual({ claimed: 1, completed: 1, reconciliation: 0, retried: 0 });
    expect(f.writer.readHistoricalSale.mock.invocationCallOrder[0]).toBeLessThan(f.writer.settleHistoricalSale.mock.invocationCallOrder[0]!);
    expect(f.writer.settleHistoricalSale).toHaveBeenCalledExactlyOnceWith(loyaltyWebObservation(row));
    expect(f.orders.updateOne).toHaveBeenCalledWith(expect.objectContaining({ _id: row._id, tenantId: row.tenantId, __v: row.__v,
      'payment.refundSyncVersion': 0, 'loyaltyWebProcessing.leaseToken': row.loyaltyWebProcessing.leaseToken }),
    expect.objectContaining({ $set: expect.objectContaining({ 'loyaltyWebProcessing.state': 'completed', 'loyaltyWebProcessing.leaseToken': null }) }),
    expect.objectContaining({ timestamps: false, writeConcern: { w: 'majority', j: true, wtimeout: 10_000 } }));
    expect(f.orders.findOneAndUpdate.mock.calls[0]?.[0]).toMatchObject({ 'loyaltyWebIntent.version': 1 });
    expect(JSON.stringify(f.orders.findOneAndUpdate.mock.calls[0])).toContain('completed');
    expect(JSON.stringify(f.orders.findOneAndUpdate.mock.calls[0])).toContain('leaseUntil');
  });
  it('repairs SQL-committed/Mongo-ACK-lost directly from the exact receipt, including zero gain', async () => {
    const row = claimed(), f = harness([row]); const receipt = recorded(loyaltyWebObservation(row));
    receipt.receipt!.initialUnits = 0; receipt.receipt!.retainedUnits = 0; receipt.receipt!.earnLedgerEntryId = null;
    f.writer.readHistoricalSale.mockResolvedValue(receipt);
    expect((await f.processor.drain()).completed).toBe(1);
    expect(f.writer.settleHistoricalSale).not.toHaveBeenCalled();
    expect(f.orders.updateOne.mock.calls[0]?.[1]).toMatchObject({ $set: { 'loyaltyWebProcessing.awardedUnits': 0 } });
  });
  it('does not settle after receipt read failure or expose a dependency message', async () => {
    const row = claimed(), f = harness([row]); f.writer.readHistoricalSale.mockRejectedValue(new Error('secret URL private phone'));
    expect((await f.processor.drain()).retried).toBe(1); expect(f.writer.settleHistoricalSale).not.toHaveBeenCalled();
    const writes = JSON.stringify(f.orders.updateOne.mock.calls);
    expect(writes).toContain('dependency_unavailable'); expect(writes).not.toContain('secret URL');
    expect(writes).not.toContain('loyaltyWebIntent.operationId":"null');
  });
  it('does not publish a stale success when the refund wins before Mongo acknowledgement', async () => {
    const row = claimed(), f = harness([row]); f.orders.updateOne.mockResolvedValueOnce({ modifiedCount: 0 });
    expect(await f.processor.drain()).toMatchObject({ completed: 0, retried: 1 });
    expect(f.orders.updateOne).toHaveBeenCalledTimes(2);
    expect(f.orders.updateOne.mock.calls[1]?.[0]).toMatchObject({ 'loyaltyWebProcessing.leaseToken': row.loyaltyWebProcessing.leaseToken });
    expect(f.orders.updateOne.mock.calls[1]?.[1]).toMatchObject({ $set: { 'loyaltyWebProcessing.state': 'pending', 'loyaltyWebProcessing.lastError': 'financial_snapshot_changed' } });
  });
  it('retains allocation/pending states as resumable cases with no manufactured receipt', async () => {
    const row = claimed(), f = harness([row]);
    f.writer.settleHistoricalSale.mockResolvedValue({ kind: 'pending', reason: 'refund_pending', receipt: null });
    expect((await f.processor.drain()).retried).toBe(1);
    expect(f.orders.updateOne.mock.calls[0]?.[1]).toMatchObject({ $set: { 'loyaltyWebProcessing.state': 'pending', 'loyaltyWebProcessing.lastError': 'refund_pending' } });
  });
  it('does not adopt an unadmitted order or a changed customer attribution', async () => {
    const row = claimed(); row.loyaltyWebIntent = null; const f = harness([row]);
    expect((await f.processor.drain()).reconciliation).toBe(1);
    expect(f.writer.readHistoricalSale).not.toHaveBeenCalled(); expect(f.writer.settleHistoricalSale).not.toHaveBeenCalled();
  });
  it('does not acknowledge a receipt for a different observation', async () => {
    const row = claimed(), f = harness([row]); const receipt = recorded(loyaltyWebObservation(row));
    receipt.receipt!.observationId = randomUUID(); f.writer.readHistoricalSale.mockResolvedValue(receipt);
    expect((await f.processor.drain()).retried).toBe(1);
    expect(f.writer.settleHistoricalSale).not.toHaveBeenCalled();
    expect(f.orders.updateOne.mock.calls[0]?.[1]).toMatchObject({ $set: { 'loyaltyWebProcessing.lastError': 'observation_superseded' } });
  });
  it('a shutdown of the flag during preflight blocks a new SQL mutation', async () => {
    const row = claimed(), f = harness([row]); f.writer.readHistoricalSale.mockImplementation(async () => {
      vi.stubEnv('LOYALTY_WEB_SETTLEMENT_ENABLED', 'false'); return { kind: 'pending', reason: 'not_observed', receipt: null };
    });
    expect((await f.processor.drain()).retried).toBe(1); expect(f.writer.settleHistoricalSale).not.toHaveBeenCalled();
  });
  it.each(['completed', 'pending'])('bounds fallback reads and never wakes an unchanged %s sale', async state => {
    const row = claimed(), f = harness([]);
    f.scan.lean.mockResolvedValue([{ ...row, loyaltyWebProcessing: { state, dirty: false, orderVersion: row.__v, refundSyncVersion: 0 } }]);
    await f.processor.drain(); await f.processor.drain();
    expect(f.orders.find).toHaveBeenCalledTimes(1); expect(f.scan.limit).toHaveBeenCalledWith(50);
    expect(f.orders.updateOne).not.toHaveBeenCalled(); expect(f.writer.readHistoricalSale).not.toHaveBeenCalled();
  });
  it.each([1, 2, 5, 6, 50])('backs off a mutable pending case, attempt=%i, within 30 seconds and 15 minutes', async attempts => {
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2030-01-01T12:00:00Z'));
    const row = claimed(); row.loyaltyWebProcessing.attempts = attempts; const f = harness([row]);
    f.writer.settleHistoricalSale.mockResolvedValue({ kind: 'pending', reason: 'program_inactive', receipt: null });
    await f.processor.drain();
    expect(f.orders.updateOne.mock.calls[0]?.[1]).toMatchObject({ $set: {
      'loyaltyWebProcessing.dirty': true,
      'loyaltyWebProcessing.nextAttemptAt': new Date(Date.now() + Math.min(900_000, 30_000 * 2 ** (attempts - 1))),
    } });
  });
  it.each([null, 0, 10, 'absent'] as const)('parks cancellation only with an exact receipt proving no initial gain: %s', async initialUnits => {
    const row = claimed(); row.status = 'cancelled'; const f = harness([row]);
    const known = recorded(loyaltyWebObservation(row)).receipt!;
    f.writer.settleHistoricalSale.mockResolvedValue({ kind: 'pending', reason: 'payment_or_handoff_pending',
      receipt: initialUnits === 'absent' ? null : { ...known, initialUnits } });
    await f.processor.drain();
    const parked = initialUnits === null;
    expect(f.orders.updateOne.mock.calls[0]?.[1]).toMatchObject({ $set: {
      'loyaltyWebProcessing.state': 'pending', 'loyaltyWebProcessing.dirty': !parked,
      'loyaltyWebProcessing.nextAttemptAt': parked ? null : expect.any(Date),
    } });
  });
  it('wakes a parked pending case only on a changed business version, without calling SQL in the scan', async () => {
    const row = claimed(), f = harness([]);
    f.scan.lean.mockResolvedValue([{ ...row, loyaltyWebProcessing: { state: 'pending', dirty: false, orderVersion: row.__v! - 1, refundSyncVersion: 0 } }]);
    await f.processor.drain();
    expect(f.orders.find.mock.calls[0]?.[0]).toMatchObject({ 'loyaltyWebProcessing.state': { $in: ['pending', 'completed', 'reconciliation_required'] } });
    expect(f.orders.updateOne.mock.calls[0]?.[1]).toMatchObject({ $set: { 'loyaltyWebProcessing.dirty': true } });
    expect(f.writer.readHistoricalSale).not.toHaveBeenCalled(); expect(f.writer.settleHistoricalSale).not.toHaveBeenCalled();
  });
  it('eventually re-reads a reconciliation with unchanged finances to recover a SQL resolution whose Mongo wake was lost', async () => {
    const row = claimed(), f = harness([]);
    f.scan.lean.mockResolvedValue([{ ...row, loyaltyWebProcessing: { state: 'reconciliation_required', dirty: false, orderVersion: row.__v, refundSyncVersion: 0 } }]);
    await f.processor.drain();
    expect(f.orders.updateOne.mock.calls[0]?.[0]).toMatchObject({ 'loyaltyWebProcessing.state': 'reconciliation_required', 'loyaltyWebProcessing.dirty': false });
    expect(f.orders.updateOne.mock.calls[0]?.[1]).toMatchObject({ $set: { 'loyaltyWebProcessing.dirty': true } });
    expect(f.writer.settleHistoricalSale).not.toHaveBeenCalled();
  });
});
