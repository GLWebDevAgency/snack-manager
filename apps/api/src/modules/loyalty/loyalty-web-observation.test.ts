import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { loyaltyWebObservation, LoyaltyWebObservationError, type LoyaltyWebObservedOrder } from './loyalty-web-observation';
import { loyaltyWebFixture } from './loyalty-web.test-fixture';
import { HISTORICAL_SALE_PROOF_MAX_BYTES } from './loyalty-historical-sale.types';

function online(order = loyaltyWebFixture()) {
  order.payment.method = 'online'; order.payment.stripePaymentIntentId = 'pi_synthetic'; order.payment.stripeAccountId = 'acct_synthetic';
  order.counterCollection = null;
  order.paymentFlow = { version: 1, phase: 'settled', providerStatus: 'succeeded', attempt: {
    id: randomUUID(), accountId: 'acct_synthetic', environment: 'test', amountCents: 1000, currency: 'eur',
    metadata: { orderId: String(order._id), tenantId: String(order.tenantId), orderNumber: '1' }, requestStartedAt: new Date('2030-01-01T11:55:00Z'),
  } };
  return order;
}

describe('web loyalty observation — historical server proof only', () => {
  it('accepts the immutable receipt of collection at the counter and the handoff separately', () => {
    const row = loyaltyWebFixture(), input = loyaltyWebObservation(row);
    expect(input).toMatchObject({ tenantRef: String(row.tenantId), clientId: row.clientId,
      observation: { paidAndDelivered: true, eligibleRefundedCents: 0, pendingRefundCents: 0,
        proof: { payment: { kind: 'counter', amountCents: 1000 }, handoff: { kind: 'pickup' } } } });
    expect(JSON.stringify(input)).not.toContain('customerPhone');
  });
  it('keeps the exact observation on unrelated Mongo version changes', () => {
    const row = online(), before = loyaltyWebObservation(row);
    row.__v! += 4; row.payment.refundSyncVersion! += 1;
    const after = loyaltyWebObservation(row);
    expect(after.observation.observationId).toBe(before.observation.observationId);
    expect(after.observation.financialFingerprint).toBe(before.observation.financialFingerprint);
    expect(after.observation.orderVersion).toBe(before.observation.orderVersion + 4);
    expect(after.observation.refundSyncVersion).toBe(before.observation.refundSyncVersion + 1);
  });
  it.each(['new', 'preparing', 'ready', 'cancelled'])('never treats kitchen status %s as handoff', status => {
    const row = online(); row.status = status; row.statusHistory = [];
    expect(loyaltyWebObservation(row).observation.paidAndDelivered).toBe(false);
  });
  it('never treats a bank attempt as received money', () => {
    const row = online(); row.payment.status = 'pending'; row.paymentFlow!.phase = 'open'; row.paymentFlow!.providerStatus = 'processing';
    expect(loyaltyWebObservation(row).observation.paidAndDelivered).toBe(false);
  });
  it.each([
    (r: LoyaltyWebObservedOrder) => { r.counterCollection = null; },
    (r: LoyaltyWebObservedOrder) => { r.counterCollection!.amountCents++; },
    (r: LoyaltyWebObservedOrder) => { r.counterCollection!.collectedAt = new Date(NaN); },
    (r: LoyaltyWebObservedOrder) => { r.paymentFlow!.phase = 'review_required'; },
  ])('does not infer collection from a paid flag without its coherent receipt %#', corrupt => {
    const row = loyaltyWebFixture(); corrupt(row);
    expect(() => loyaltyWebObservation(row)).toThrow('payment_proof_invalid');
  });
  it.each([
    (r: LoyaltyWebObservedOrder) => { r.paymentFlow!.attempt!.amountCents++; },
    (r: LoyaltyWebObservedOrder) => { r.paymentFlow!.attempt!.accountId = 'acct_other'; },
    (r: LoyaltyWebObservedOrder) => { r.paymentFlow!.attempt!.metadata.tenantId = '507f1f77bcf86cd799439099'; },
    (r: LoyaltyWebObservedOrder) => { r.paymentFlow!.attempt!.metadata.orderId = '507f1f77bcf86cd799439099'; },
    (r: LoyaltyWebObservedOrder) => { r.paymentFlow!.attempt!.requestStartedAt = null; },
    (r: LoyaltyWebObservedOrder) => { r.paymentFlow!.providerStatus = 'processing'; },
    (r: LoyaltyWebObservedOrder) => { r.paymentFlow!.phase = 'review_required'; },
  ])('rejects an online proof outside the priced sale scope %#', corrupt => {
    const row = online(); corrupt(row);
    expect(() => loyaltyWebObservation(row)).toThrow('payment_proof_invalid');
  });
  it('uses delivery handoff completed AND its exact applied journal operation, without copying sealed proof', () => {
    const row = online(), at = row.statusHistory![0]!.at!, actorId = row.statusHistory![0]!.by!, operationId = randomUUID();
    row.type = 'delivery'; row.delivery = { deliveredAt: at };
    row.deliveryHandoff = { completed: { at, method: 'qr', operationId, actorId, actorKind: 'delivery' },
      operations: [{ at, operationId, actorId, actorKind: 'delivery', action: 'handoff', outcome: 'applied' }] };
    expect(loyaltyWebObservation(row).observation).toMatchObject({ paidAndDelivered: true, proof: { handoff: { kind: 'delivery', operationId } } });
    row.deliveryHandoff.operations[0]!.outcome = 'rejected';
    expect(() => loyaltyWebObservation(row)).toThrow('handoff_proof_invalid');
  });
  it('a full confirmed refund preserves payment proof and supplies a full eligible correction', () => {
    const row = online(); row.payment.status = 'refunded'; row.payment.refundedCents = 1000;
    row.payment.refunds = [{ id: 're_full', amountCents: 1000, status: 'succeeded' }];
    expect(loyaltyWebObservation(row).observation).toMatchObject({ paidAndDelivered: true, eligibleRefundedCents: 1000, pendingRefundCents: 0 });
  });
  it('pending refunds are not a confirmed correction', () => {
    const row = online(); row.payment.pendingRefundCents = 400;
    row.payment.refunds = [{ id: 're_pending', amountCents: 400, status: 'pending' }];
    expect(loyaltyWebObservation(row).observation).toMatchObject({ eligibleRefundedCents: 0, pendingRefundCents: 400 });
  });
  it('does not infer a cash refund from counters without an actual refund journal', () => {
    const row = loyaltyWebFixture(); row.payment.refundedCents = 300;
    row.payment.refunds = [{ id: 'not-a-cash-receipt', amountCents: 300, status: 'succeeded' }];
    expect(() => loyaltyWebObservation(row)).toThrow('refund_allocation_conflict');
  });
  it.each(['failed', 'canceled'])('does not compensate a %s provider refund', status => {
    const row = online(); row.payment.refunds = [{ id: 're_not_applied', amountCents: 1000, status }];
    expect(loyaltyWebObservation(row).observation).toMatchObject({ eligibleRefundedCents: 0, pendingRefundCents: 0 });
  });
  it('retains a complete proof at exactly 64 KiB and closes larger UTF-8 evidence without truncating it', () => {
    const row = online(); row.payment.refunds = [{ id: 're_failed', amountCents: 1, status: 'failed' }];
    const bytes = Buffer.byteLength(JSON.stringify(loyaltyWebObservation(row).observation.proof));
    row.payment.refunds[0]!.id += 'x'.repeat(HISTORICAL_SALE_PROOF_MAX_BYTES - bytes);
    expect(Buffer.byteLength(JSON.stringify(loyaltyWebObservation(row).observation.proof))).toBe(HISTORICAL_SALE_PROOF_MAX_BYTES);
    row.payment.refunds[0]!.id += 'é';
    expect(() => loyaltyWebObservation(row)).toThrow('financial_proof_too_large');
    expect(row.payment.refunds[0]!.id.endsWith('é')).toBe(true);
  });
  it('partial refund with delivery fee stays unallocated instead of inventing a prorata', () => {
    const row = online(); row.totals.subtotal = 800; row.totals.deliveryFee = 200;
    const attribution = row.customerSaleAttribution as { basis: { eligiblePurchaseCents: number; excludedChargeCents: number } };
    attribution.basis.eligiblePurchaseCents = 800; attribution.basis.excludedChargeCents = 200;
    row.payment.refundedCents = 400; row.payment.refunds = [{ id: 're_partial', amountCents: 400, status: 'succeeded' }];
    expect(loyaltyWebObservation(row).observation.eligibleRefundedCents).toBeNull();
  });
  it.each([
    (r: LoyaltyWebObservedOrder) => { r.loyaltyWebIntent = null; },
    (r: LoyaltyWebObservedOrder) => { r.customerSaleAttribution = null; },
    (r: LoyaltyWebObservedOrder) => { r.customerOwner = null; },
    (r: LoyaltyWebObservedOrder) => { r.loyaltyMemberId = randomUUID(); },
    (r: LoyaltyWebObservedOrder) => { r.totals.total++; },
    (r: LoyaltyWebObservedOrder) => { r.__v = -1; },
    (r: LoyaltyWebObservedOrder) => { r.statusHistory = []; },
  ])('closes corrupt or historical-unadmitted sales without adopting an identity %#', corrupt => {
    const row = online(); corrupt(row); expect(() => loyaltyWebObservation(row)).toThrow(LoyaltyWebObservationError);
  });
});
