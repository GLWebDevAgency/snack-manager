import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { counterRefundProjection, type CounterRefundSnapshot, type CounterRefundOperation } from './order-counter-refund.policy';

const actor = { sub: '507f1f77bcf86cd799439031', kind: 'user' as const, role: 'owner' as const };
function sale(): CounterRefundSnapshot {
  return { _id: '507f1f77bcf86cd799439011', tenantId: '507f1f77bcf86cd799439021', clientId: randomUUID(),
    createdAt: new Date('2030-01-01T12:00:01Z'), __v: 1, channel: 'pos', type: 'emporter',
    totals: { subtotal: 1000, total: 1000, deliveryFee: 0, discount: null },
    payment: { method: 'counter', tender: 'cash', status: 'paid', cashReceived: 1500, changeGiven: 500,
      stripePaymentIntentId: null, refundedCents: 0, pendingRefundCents: 0, refundSyncVersion: 0, refunds: [] },
    paymentFlow: { version: 1, origin: 'created_v1', phase: 'open', attempt: null, close: null },
    statusHistory: [{ status: 'new', by: actor.sub, at: new Date('2030-01-01T12:00:00Z') }],
    counterCollection: null, counterRefundFlow: null, refundFlow: null,
  } as unknown as CounterRefundSnapshot;
}
function reservation(row: CounterRefundSnapshot) {
  const operation: CounterRefundOperation = { operationId: randomUUID(), amountCents: 400, reason: 'Retour produit', tender: 'cash',
    allocation: { version: 1, merchandiseCents: 400, deliveryCents: 0 }, actor, approver: actor, state: 'prepared',
    preparedAt: new Date('2030-01-01T12:05:00Z'), startedAt: null, disburseExpiresAt: null, confirmedAt: null,
    resolvedAt: null, attestation: null, resolution: null };
  row.counterRefundFlow = { version: 1, paymentProofHash: counterRefundProjection(row).paymentProofHash, operations: [operation] };
  row.payment.pendingRefundCents = 400;
  return operation;
}
describe('counter refund evidence policy', () => {
  it('accepts exact creation and collection snapshots, while keeping the original tender', () => {
    const row = sale(); expect(counterRefundProjection(row)).toMatchObject({ tender: 'cash', originalPaidCents: 1000 });
    row.counterCollection = { operationId: randomUUID(), amountCents: 1000, tender: 'cash', actor,
      collectedAt: new Date('2030-01-01T12:02:00Z'), cashReceivedCents: 1500, changeGivenCents: 500 };
    row.channel = 'online'; row.type = 'pickup';
    expect(counterRefundProjection(row).proof.payment.kind).toBe('counter_collection');
  });
  it.each([
    (row: CounterRefundSnapshot) => { row.payment.cashReceived = 1499; },
    (row: CounterRefundSnapshot) => { row.payment.status = 'pending'; },
    (row: CounterRefundSnapshot) => { row.payment.method = 'online'; },
    (row: CounterRefundSnapshot) => { row.channel = 'online'; },
    (row: CounterRefundSnapshot) => { row.type = 'delivery'; },
    (row: CounterRefundSnapshot) => { row.clientId = 'not-an-id'; },
    (row: CounterRefundSnapshot) => { row.statusHistory = []; },
    (row: CounterRefundSnapshot) => { row.statusHistory[0]!.by = null; },
    (row: CounterRefundSnapshot) => { row.statusHistory[0]!.at = new Date('2031-01-01T00:00:00Z'); },
    (row: CounterRefundSnapshot) => { row.paymentFlow = null; },
    (row: CounterRefundSnapshot) => { row.paymentFlow!.origin = 'legacy_unknown'; },
    (row: CounterRefundSnapshot) => { row.payment.stripePaymentIntentId = 'pi_unproven'; },
  ])('refuses a bare paid status or an incoherent original receipt %#', corrupt => {
    const row = sale(); corrupt(row); expect(() => counterRefundProjection(row)).toThrow('payment_proof_missing');
  });
  it('does not promise a physical refund to unsupported meal-voucher tender', () => {
    const row = sale(); row.payment.tender = 'meal_voucher';
    expect(() => counterRefundProjection(row)).toThrow('unsupported_tender');
  });
  it.each([
    (row: CounterRefundSnapshot) => { row.payment.refundedCents = 1; },
    (row: CounterRefundSnapshot) => { row.payment.pendingRefundCents = 1; },
    (row: CounterRefundSnapshot) => { row.payment.refunds = [{ id: 're_synthetic', amountCents: 1, status: 'succeeded' }] as never; },
    (row: CounterRefundSnapshot) => { row.refundFlow = { operations: [{}] }; },
    (row: CounterRefundSnapshot) => { row.totals.subtotal++; },
  ])('rejects forged counters, mixed-provider flows or a changed price basis %#', corrupt => {
    const row = sale(); corrupt(row); expect(() => counterRefundProjection(row)).toThrow('financial_conflict');
  });
  it('requires exact cumulative allocation and unchanged original receipt on every observation', () => {
    const row = sale(), operation = reservation(row);
    expect(counterRefundProjection(row)).toMatchObject({ pendingRefundCents: 400, confirmedRefundedCents: 0,
      remaining: { merchandiseCents: 600, deliveryCents: 0 } });
    row.__v = 42; row.payment.refundSyncVersion = 8;
    const before = counterRefundProjection(row).proof;
    row.__v = 99; row.payment.refundSyncVersion = 10;
    expect(counterRefundProjection(row).proof).toEqual(before);
    operation.allocation.deliveryCents = 1;
    expect(() => counterRefundProjection(row)).toThrow('financial_conflict');
    operation.allocation.deliveryCents = 0; row.payment.cashReceived = 2000; row.payment.changeGiven = 1000;
    expect(() => counterRefundProjection(row)).toThrow('financial_conflict');
  });
  it('refuses an invented no-effect receipt before the physical permission expires', () => {
    const row = sale(), operation = reservation(row); row.payment.pendingRefundCents = 0;
    Object.assign(operation, { state: 'not_executed', startedAt: new Date('2030-01-01T12:05:01Z'),
      disburseExpiresAt: new Date('2030-01-01T12:10:01Z'), resolvedAt: new Date('2030-01-01T12:10:00Z'),
      resolution: { actor, reason: 'Aucun geste ni paiement en cours' } });
    expect(() => counterRefundProjection(row)).toThrow('financial_conflict');
    operation.resolvedAt = new Date('2030-01-01T12:10:01Z');
    expect(counterRefundProjection(row).remaining.merchandiseCents).toBe(1000);
  });
});
