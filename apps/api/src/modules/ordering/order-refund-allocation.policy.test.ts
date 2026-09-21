import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { RefundOperation, RefundSnapshot } from './order-refund-flow.policy';
import { refundAllocationProjection } from './order-refund-allocation.policy';

const parts = (merchandiseCents: number, deliveryCents: number) => ({ version: 1 as const, merchandiseCents, deliveryCents });
function order(): RefundSnapshot {
  return { _id: '507f1f77bcf86cd799439011', tenantId: '507f1f77bcf86cd799439022',
    totals: { subtotal: 1000, deliveryFee: 200, total: 1200 },
    payment: { method: 'online', status: 'paid', stripePaymentIntentId: 'pi_allocation', refunds: [] },
    refundFlow: { version: 1, operations: [] } };
}
function refund(row: RefundSnapshot, id: string, amount: number, status = 'succeeded', allocation?: ReturnType<typeof parts>) {
  row.payment.refunds!.push({ id, amountCents: amount, status });
  if (allocation) row.refundFlow!.allocations = [...row.refundFlow!.allocations ?? [],
    { operationId: randomUUID(), refundId: id, allocation, reason: 'Ventilation vérifiée', actorId: 'owner', recordedAt: new Date() }];
}
function reserve(row: RefundSnapshot, amountCents: number, allocation?: ReturnType<typeof parts>, state: RefundOperation['state'] = 'creating') {
  row.refundFlow!.operations.push({ operationId: randomUUID(), amountCents, allocation, reason: 'Produit manquant', actorId: 'owner',
    environment: 'test', paymentIntentId: 'pi_allocation', accountId: null, idempotencyKey: randomUUID(), preparedAt: new Date(), state });
}

describe('allocation prouvée des remboursements produits/livraison', () => {
  it('ne suppose aucun prorata pour un partiel sans ventilation', () => {
    const row = order(); refund(row, 're_unknown', 150);
    expect(refundAllocationProjection(row)).toMatchObject({ basis: parts(1000, 200), remaining: null,
      allocationCapacity: parts(1000, 200), confirmedRefundedEligibleCents: null,
      unallocated: [{ refundId: 're_unknown', amountCents: 150, providerStatus: 'succeeded', canAllocate: true }] });
  });
  it('cumule confirmés, réservations et pending pour les limites, mais seulement confirmés pour les points', () => {
    const row = order(); refund(row, 're_products', 300, 'succeeded', parts(300, 0));
    refund(row, 're_mixed', 100, 'pending', parts(50, 50)); reserve(row, 150, parts(100, 50));
    expect(refundAllocationProjection(row)).toMatchObject({ remaining: parts(550, 100),
      confirmedRefundedEligibleCents: 300, pendingRefundCents: 250, unallocated: [] });
  });
  it.each(['failed', 'canceled'])('ne débite ni ne réserve un remboursement %s', status => {
    const row = order(); refund(row, 're_failed', 300, status, parts(300, 0)); reserve(row, 150, parts(150, 0), 'withdrawn');
    expect(refundAllocationProjection(row)).toMatchObject({ remaining: parts(1000, 200),
      confirmedRefundedEligibleCents: 0, pendingRefundCents: 0, unallocated: [] });
  });
  it('déduit l’assiette intégralement corrigée lorsque plusieurs partiels couvrent la totalité', () => {
    const row = order(); refund(row, 're_one', 500); refund(row, 're_two', 700);
    expect(refundAllocationProjection(row)).toMatchObject({ remaining: parts(0, 0),
      confirmedRefundedEligibleCents: 1000, unallocated: [], proof: { fullyRefunded: true } });
  });
  it('ne traite pas total confirmé+pending comme un remboursement total acquis', () => {
    const row = order(); refund(row, 're_one', 500); refund(row, 're_two', 700, 'pending');
    expect(refundAllocationProjection(row)).toMatchObject({ remaining: null,
      confirmedRefundedEligibleCents: null, pendingRefundCents: 700, proof: { fullyRefunded: false } });
  });
  it('déduit sans ambiguïté un remboursement sans frais exclus', () => {
    const row = order(); row.totals = { subtotal: 1200, total: 1200 };
    refund(row, 're_partial', 250); reserve(row, 50);
    expect(refundAllocationProjection(row)).toMatchObject({ remaining: parts(900, 0),
      confirmedRefundedEligibleCents: 250, pendingRefundCents: 50, unallocated: [] });
  });
  it('prend le produit après remise et ne transforme pas la livraison en points', () => {
    const row = order(); row.totals = { subtotal: 1200, discount: { amount: 200 }, deliveryFee: 200, total: 1200 };
    refund(row, 're_delivery', 200, 'succeeded', parts(0, 200));
    expect(refundAllocationProjection(row)).toMatchObject({ basis: parts(1000, 200), remaining: parts(1000, 0), confirmedRefundedEligibleCents: 0 });
  });
  it.each([parts(100, 0), parts(0, 300), parts(-1, 301), parts(300.5, -0.5)])('refuse une preuve incohérente %j', allocation => {
    const row = order(); refund(row, 're_invalid', 300, 'succeeded', allocation);
    expect(() => refundAllocationProjection(row)).toThrow('Ventilation');
  });
  it('refuse une somme par poste impossible malgré un total monétaire valide', () => {
    const row = order(); refund(row, 're_a', 800, 'succeeded', parts(800, 0)); refund(row, 're_b', 300, 'pending', parts(300, 0));
    expect(() => refundAllocationProjection(row)).toThrow('Ventilation');
  });
  it('refuse un reçu de ventilation sans remboursement observé', () => {
    const row = order(); refund(row, 're_a', 100, 'succeeded', parts(100, 0)); row.payment.refunds = [];
    expect(() => refundAllocationProjection(row)).toThrow('Ventilation');
  });
  it('refuse une identité réutilisée entre remboursement et ventilation historique', () => {
    const row = order(); reserve(row, 100, parts(100, 0));
    refund(row, 're_allocated', 100, 'succeeded', parts(100, 0));
    row.refundFlow!.allocations![0]!.operationId = row.refundFlow!.operations[0]!.operationId;
    expect(() => refundAllocationProjection(row)).toThrow('Ventilation');
  });
  it('un abandon ne ventile rien et ne remplace pas la preuve financière', () => {
    const row = order(); refund(row, 're_allocated', 100);
    const before = refundAllocationProjection(row);
    row.refundFlow!.allocations = [{ operationId: randomUUID(), refundId: 're_allocated', state: 'withdrawn',
      allocation: parts(100, 0), actorId: 'owner', reason: 'Répartition abandonnée', recordedAt: new Date() }];
    expect(refundAllocationProjection(row)).toEqual(before);
    refund(row, 're_another', 100, 'succeeded', parts(100, 0));
    row.refundFlow!.allocations!.push({ ...row.refundFlow!.allocations![1]!, refundId: 're_allocated', operationId: randomUUID() });
    expect(refundAllocationProjection(row)).toMatchObject({ remaining: parts(800, 200), confirmedRefundedEligibleCents: 200, unallocated: [] });
  });
  it('ne reconstitue pas une assiette historique dont les totaux sont contradictoires', () => {
    const row = order(); row.totals.subtotal = 999;
    expect(refundAllocationProjection(row)).toMatchObject({ basis: null, remaining: null, confirmedRefundedEligibleCents: null });
  });
  it('produit la même preuve malgré l’ordre des lignes fournisseur et ne modifie pas le snapshot', () => {
    const row = order(); refund(row, 're_b', 100, 'succeeded', parts(100, 0)); refund(row, 're_a', 100, 'succeeded', parts(0, 100));
    const before = structuredClone(row); const first = refundAllocationProjection(row);
    expect(row).toEqual(before);
    row.payment.refunds!.reverse(); row.refundFlow!.allocations!.reverse();
    expect(refundAllocationProjection(row).proof).toEqual(first.proof);
  });
});
