import { randomUUID } from 'node:crypto';
import type { Model } from 'mongoose';
import type { Order } from '@sm/db';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LoyaltyPosCompensationProcessor } from './loyalty-pos-compensation.processor';
import { loyaltyPosObservation } from './loyalty-pos-observation';
import type { LoyaltyHistoricalSaleService } from './loyalty-historical-sale.service';
import { historicalSaleAttributionFingerprint, type HistoricalPosSaleSettlementInput, type HistoricalSaleSettlementResult } from './loyalty-historical-sale.types';
vi.mock('./loyalty-pos-observation', async original => ({ ...await original<typeof import('./loyalty-pos-observation')>(), loyaltyPosObservation: vi.fn() }));
const tenant = 'a'.repeat(24), client = randomUUID(), op = randomUUID(), member = randomUUID();
function input(): HistoricalPosSaleSettlementInput {
  return { tenantRef: tenant, clientId: client, earnOperationId: op, attribution: { version: 1, decision: 'pos_receipt', tenantRef: tenant, clientId: client,
    memberId: member, programId: randomUUID(), rulesVersion: 1, rule: { mechanism: 'points', minimumPurchaseCents: 0, maximumUnitsPerPurchase: null, spendStepCents: 100, unitsPerStep: 1 },
    basis: { policyVersion: 'legacy-pos-total-v1', eligiblePurchaseCents: 1000, chargedTotalCents: 1000, excludedChargeCents: 0 },
    receipt: { id: randomUUID(), operationId: op, ledgerEntryId: randomUUID(), awardedUnits: 10, externalRef: `pos-order:${client}`, requestFingerprint: 'a'.repeat(64) } },
    observation: { observationId: randomUUID(), orderVersion: 2, refundSyncVersion: 1, financialFingerprint: 'b'.repeat(64), eligibleRefundedCents: 300, pendingRefundCents: 0, paidAndDelivered: true, proof: {} } };
}
const claimed = () => ({ _id: 'b'.repeat(24), tenantId: tenant, channel: 'pos', clientId: client, loyaltyMemberId: member, loyaltyEarnOperationId: op,
  loyaltyEarnState: 'completed', __v: 2, payment: { refundSyncVersion: 1, refundedCents: 300 },
  loyaltyPosCompensationProcessing: { attempts: 1, leaseToken: randomUUID(), leaseUntil: new Date(Date.now() + 60_000) } });
function recorded(i: HistoricalPosSaleSettlementInput): HistoricalSaleSettlementResult {
  return { kind: 'recorded', replayed: false, receipt: { saleId: randomUUID(), earnOperationId: op, observationId: i.observation.observationId,
    financialFingerprint: i.observation.financialFingerprint, attributionFingerprint: historicalSaleAttributionFingerprint(i.attribution), version: 2,
    initialUnits: 10, reversedUnits: 3, waivedUnits: 0, retainedUnits: 7, dueUnits: 0, earnReceiptId: i.attribution.receipt.id, earnLedgerEntryId: i.attribution.receipt.ledgerEntryId } };
}
function harness(rows: unknown[] = [claimed()]) {
  const i = input(); vi.mocked(loyaltyPosObservation).mockResolvedValue(i);
  const query = { select: vi.fn().mockReturnThis(), read: vi.fn().mockReturnThis(), maxTimeMS: vi.fn().mockReturnThis(), lean: vi.fn(async () => rows.shift() ?? null) };
  const scan = { select: vi.fn().mockReturnThis(), read: vi.fn().mockReturnThis(), readConcern: vi.fn().mockReturnThis(), maxTimeMS: vi.fn().mockReturnThis(),
    sort: vi.fn().mockReturnThis(), limit: vi.fn().mockReturnThis(), lean: vi.fn(async (): Promise<unknown[]> => []) };
  const orders = { findOneAndUpdate: vi.fn((_f: unknown, _u: unknown, _o: unknown) => query), find: vi.fn(() => scan),
    updateOne: vi.fn(async (_f: unknown, _u: unknown, _o: unknown) => ({ modifiedCount: 1 })) };
  const service = { readHistoricalSale: vi.fn(async (): Promise<HistoricalSaleSettlementResult> => ({ kind: 'pending', reason: 'not_observed', receipt: null })),
    settlePosSale: vi.fn(async () => recorded(i)) };
  return { i, query, scan, orders, service, worker: new LoyaltyPosCompensationProcessor(orders as unknown as Model<Order>, service as unknown as LoyaltyHistoricalSaleService) };
}
beforeEach(() => { vi.stubEnv('LOYALTY_POS_COMPENSATION_ENABLED', 'true'); vi.mocked(loyaltyPosObservation).mockReset(); });
afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); });
describe('POS compensation scheduler', () => {
  it.each([undefined, '', 'false', 'TRUE', '1'])('is closed under %s, without Mongo claim or SQL read', async flag => {
    vi.stubEnv('LOYALTY_POS_COMPENSATION_ENABLED', flag); const f = harness();
    expect((await f.worker.drain()).claimed).toBe(0); expect(f.orders.findOneAndUpdate).not.toHaveBeenCalled(); expect(f.service.readHistoricalSale).not.toHaveBeenCalled();
  });
  it('reads receipt first and fences the exact POS identity, lease and both financial versions', async () => {
    const row = claimed(), f = harness([row]); expect(await f.worker.drain()).toEqual({ claimed: 1, completed: 1, retried: 0, reconciliation: 0 });
    expect(f.service.readHistoricalSale.mock.invocationCallOrder[0]).toBeLessThan(f.service.settlePosSale.mock.invocationCallOrder[0]!);
    expect(f.orders.updateOne.mock.calls[0]?.[0]).toMatchObject({ _id: row._id, tenantId: tenant, loyaltyMemberId: member, loyaltyEarnOperationId: op,
      loyaltyEarnState: 'completed', __v: 2, 'payment.refundSyncVersion': 1, 'loyaltyPosCompensationProcessing.leaseToken': row.loyaltyPosCompensationProcessing.leaseToken });
    expect(f.orders.findOneAndUpdate.mock.calls[0]?.[0]).toMatchObject({ channel: 'pos', loyaltyEarnState: 'completed' });
  });
  it('repairs an exact known receipt without entering the wallet writer again', async () => {
    const f = harness(); f.service.readHistoricalSale.mockResolvedValue(recorded(f.i));
    expect((await f.worker.drain()).completed).toBe(1); expect(f.service.settlePosSale).not.toHaveBeenCalled();
  });
  it('stops before mutation if the flag closes during SQL read', async () => {
    const f = harness(); f.service.readHistoricalSale.mockImplementation(async () => { vi.stubEnv('LOYALTY_POS_COMPENSATION_ENABLED', 'false'); return { kind: 'pending', reason: 'not_observed', receipt: null }; });
    expect((await f.worker.drain()).retried).toBe(1); expect(f.service.settlePosSale).not.toHaveBeenCalled();
  });
  it('defers superseded Mongo ACK without publishing completion', async () => {
    const f = harness(); f.orders.updateOne.mockResolvedValueOnce({ modifiedCount: 0 });
    expect((await f.worker.drain()).retried).toBe(1);
    expect(f.orders.updateOne.mock.calls[1]?.[1]).toMatchObject({ $set: { 'loyaltyPosCompensationProcessing.lastError': 'financial_snapshot_changed', 'loyaltyPosCompensationProcessing.dirty': true } });
  });
  it('hides dependency errors and does not call settle when read failed', async () => {
    const f = harness(); f.service.readHistoricalSale.mockRejectedValue(new Error('private connection and phone'));
    expect((await f.worker.drain()).retried).toBe(1); expect(f.service.settlePosSale).not.toHaveBeenCalled();
    expect(JSON.stringify(f.orders.updateOne.mock.calls)).not.toContain('private connection');
  });
  it('does not clear a receipt from another observation', async () => {
    const f = harness(), old = recorded(f.i); old.receipt!.observationId = randomUUID(); f.service.readHistoricalSale.mockResolvedValue(old);
    expect((await f.worker.drain()).retried).toBe(1); expect(f.service.settlePosSale).not.toHaveBeenCalled();
  });
  it('keeps explicit resolution parked and fallback periodically re-reads it after lost operator ACK', async () => {
    const f = harness([]), row = claimed(); f.scan.lean.mockResolvedValue([{ ...row, loyaltyPosCompensationProcessing: { state: 'reconciliation_required', dirty: false, orderVersion: 2, refundSyncVersion: 1 } }]);
    await f.worker.drain(); await f.worker.drain(); expect(f.scan.limit).toHaveBeenCalledWith(50); expect(f.orders.find).toHaveBeenCalledTimes(1);
    expect(f.orders.updateOne).toHaveBeenCalledTimes(1);
  });
  it('does not poll unchanged completed entries or adopt a pristine old POS gain', async () => {
    const f = harness([]), row = claimed(); f.scan.lean.mockResolvedValue([
      { ...row, loyaltyPosCompensationProcessing: { state: 'completed', dirty: false, orderVersion: 2, refundSyncVersion: 1 } },
      { ...row, payment: { refundedCents: 0, pendingRefundCents: 0 }, loyaltyPosCompensationProcessing: null },
    ]);
    await f.worker.drain(); expect(f.orders.updateOne).not.toHaveBeenCalled();
  });
  it('initializes the complete scheduler on a null legacy field instead of writing into null', async () => {
    const f = harness([]); f.scan.lean.mockResolvedValue([{ ...claimed(), loyaltyPosCompensationProcessing: null }]);
    await f.worker.drain(); expect(f.orders.updateOne.mock.calls[0]?.[1]).toMatchObject({ $set: { loyaltyPosCompensationProcessing: { state: 'pending', dirty: true, attempts: 0 } } });
  });
  it('bounds each drain to 25 claims', async () => {
    const f = harness(Array.from({ length: 30 }, claimed)); expect((await f.worker.drain()).claimed).toBe(25); expect(f.orders.find).not.toHaveBeenCalled();
  });
});
