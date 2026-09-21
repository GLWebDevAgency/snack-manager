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

function zeroReward() {
  const row = loyaltyWebFixture(), attribution = row.customerSaleAttribution!;
  if (attribution.decision !== 'attributed') throw new Error('Attributed fixture required');
  row.totals.discount = { amount: 1000 }; row.totals.total = 0;
  attribution.basis = { policyVersion: 'merchandise-net-v1', eligiblePurchaseCents: 0, excludedChargeCents: 0, chargedTotalCents: 0 };
  row.counterCollection = null;
  row.paymentFlow = { version: 1, origin: 'created_v1', phase: 'open', attempt: null, close: null };
  row.loyaltyReward = { version: 1, reservationId: randomUUID(), clientId: row.clientId, owner: attribution.owner,
    memberId: attribution.memberId, programId: attribution.programId, rulesVersion: attribution.rulesVersion,
    pricingHash: 'a'.repeat(64), benefit: { rewardId: randomUUID(), name: 'Récompense de recette', costUnits: 10,
      kind: 'fixed_discount', amountCents: 1000, productRef: null, policy: 'one-reward-no-promotion-v1' } };
  row.loyaltyRewardProcessing = { state: 'consumed', zeroPaid: true, orderVersion: row.__v };
  return row;
}

function cancelledZeroReward() {
  const row = zeroReward();
  const at = new Date('2030-01-01T12:00:00Z'), actor = '507f1f77bcf86cd799439099';
  row.status = 'cancelled'; row.statusHistory = [{ status: 'cancelled', at, by: actor }];
  row.paymentFlow!.phase = 'closed';
  row.paymentFlow!.close = { operationId: randomUUID(), destination: 'cancel_order',
    reason: 'Annulation avant retrait', requestedBy: actor, requestedAt: at };
  return row;
}

describe('web loyalty observation — historical server proof only', () => {
  it('accepts a zero total only from its exact consumed reward receipt, without inventing a cash or card payment', () => {
    const row = zeroReward(), observed = loyaltyWebObservation(row);
    expect(observed.observation).toMatchObject({ paidAndDelivered: true, eligibleRefundedCents: 0, pendingRefundCents: 0,
      proof: { payment: { kind: 'zero_total_reward', amountCents: 0, rewardAmountCents: 1000 } } });
    expect(observed.attribution.basis.eligiblePurchaseCents).toBe(0);
    row.__v!++;
    expect(loyaltyWebObservation(row).observation.financialFingerprint).toBe(observed.observation.financialFingerprint);
  });
  it.each([
    (row: LoyaltyWebObservedOrder) => { row.loyaltyReward = null; },
    (row: LoyaltyWebObservedOrder) => { row.loyaltyRewardProcessing = null; },
    (row: LoyaltyWebObservedOrder) => { row.loyaltyRewardProcessing!.state = 'reserved'; },
    (row: LoyaltyWebObservedOrder) => { row.loyaltyRewardProcessing!.state = 'reversed'; },
    (row: LoyaltyWebObservedOrder) => { row.loyaltyRewardProcessing!.zeroPaid = false; },
    (row: LoyaltyWebObservedOrder) => { row.loyaltyRewardProcessing!.orderVersion = row.__v! + 1; },
    (row: LoyaltyWebObservedOrder) => { (row.loyaltyReward as { memberId: string }).memberId = randomUUID(); },
    (row: LoyaltyWebObservedOrder) => { (row.loyaltyReward as { clientId: string }).clientId = randomUUID(); },
    (row: LoyaltyWebObservedOrder) => { (row.loyaltyReward as { rulesVersion: number }).rulesVersion = 2; },
    (row: LoyaltyWebObservedOrder) => { (row.loyaltyReward as { owner: { accountId: string } }).owner = { ...(row.loyaltyReward as { owner: { accountId: string } }).owner, accountId: randomUUID() }; },
    (row: LoyaltyWebObservedOrder) => { (row.loyaltyReward as { benefit: { amountCents: number } }).benefit.amountCents = 999; },
    (row: LoyaltyWebObservedOrder) => { row.payment.stripePaymentIntentId = 'pi_conflicting'; },
    (row: LoyaltyWebObservedOrder) => { row.payment.pendingRefundCents = 1; },
  ])('does not infer a settled zero total from a partial, foreign or inconsistent reward proof %#', corrupt => {
    const row = zeroReward(); corrupt(row);
    expect(() => loyaltyWebObservation(row)).toThrow('payment_proof_invalid');
  });

  it('keeps a canonically cancelled offered order pending before and after reward restitution', () => {
    const row = cancelledZeroReward(), before = loyaltyWebObservation(row);
    expect(before.observation).toMatchObject({ paidAndDelivered: false, eligibleRefundedCents: 0,
      pendingRefundCents: 0, proof: { handoff: null, payment: { kind: 'zero_total_reward' } } });
    row.loyaltyRewardProcessing!.state = 'reversed'; row.__v!++;
    expect(loyaltyWebObservation(row).observation.financialFingerprint).toBe(before.observation.financialFingerprint);
  });
  it.each([
    (row: LoyaltyWebObservedOrder) => { row.paymentFlow!.close = null; },
    (row: LoyaltyWebObservedOrder) => { row.paymentFlow!.close!.destination = 'counter'; },
    (row: LoyaltyWebObservedOrder) => { row.paymentFlow!.close!.operationId = 'invalid'; },
    (row: LoyaltyWebObservedOrder) => { row.paymentFlow!.close!.requestedBy = ''; },
    (row: LoyaltyWebObservedOrder) => { row.paymentFlow!.close!.requestedAt = new Date(NaN); },
    (row: LoyaltyWebObservedOrder) => { row.paymentFlow!.close!.reason = ''; },
    (row: LoyaltyWebObservedOrder) => { row.paymentFlow!.phase = 'open'; },
    (row: LoyaltyWebObservedOrder) => { row.paymentFlow!.origin = 'legacy_unknown'; },
    (row: LoyaltyWebObservedOrder) => { row.paymentFlow!.version = 2; },
    (row: LoyaltyWebObservedOrder) => { row.loyaltyRewardProcessing!.zeroPaid = false; },
    (row: LoyaltyWebObservedOrder) => { row.loyaltyRewardProcessing!.state = 'reserved'; },
    (row: LoyaltyWebObservedOrder) => { row.status = 'delivered'; },
  ])('rejects a cancelled paid-zero order without its canonical closure and consumed proof %#', corrupt => {
    const row = cancelledZeroReward(); corrupt(row);
    expect(() => loyaltyWebObservation(row)).toThrow('payment_proof_invalid');
  });
  it('accepts a later earn-rule publication while keeping the original reservation version', () => {
    const row = zeroReward(), attribution = row.customerSaleAttribution!;
    if (attribution.decision !== 'attributed') throw new Error('Attributed fixture required');
    attribution.rulesVersion++;
    expect(loyaltyWebObservation(row).observation.paidAndDelivered).toBe(true);
    expect((row.loyaltyReward as { rulesVersion: number }).rulesVersion).toBe(1);
  });
  it.each(['memberId', 'programId'] as const)('does not use version independence to accept a foreign %s', field => {
    const row = zeroReward(), attribution = row.customerSaleAttribution!;
    if (attribution.decision !== 'attributed') throw new Error('Attributed fixture required');
    attribution.rulesVersion++; attribution[field] = randomUUID();
    expect(() => loyaltyWebObservation(row)).toThrow('payment_proof_invalid');
  });

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
