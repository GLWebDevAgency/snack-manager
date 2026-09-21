import { ConflictException } from '@nestjs/common';
import type { OrderRefundAllocation } from '@sm/contracts';
import { loyalty } from '@sm/domain';
import { refundProjection, type RefundSnapshot } from './order-refund-flow.policy';

export type RefundAllocationReceipt = {
  operationId: string; refundId: string; allocation: OrderRefundAllocation;
  state?: 'recorded' | 'withdrawn';
  actorId: string; reason: string; recordedAt: Date;
};
const active = new Set(['succeeded', 'pending', 'requires_action']);
const invalid = (): never => { throw new ConflictException('Ventilation des remboursements incohérente : rapprochement requis.'); };
const allocation = (merchandiseCents: number, deliveryCents: number): OrderRefundAllocation =>
  ({ version: 1, merchandiseCents, deliveryCents });

export function allocationMatches(a: OrderRefundAllocation | null | undefined, b: OrderRefundAllocation | null | undefined): boolean {
  return (!a && !b) || (!!a && !!b && a.version === b.version
    && a.merchandiseCents === b.merchandiseCents && a.deliveryCents === b.deliveryCents);
}

export function assertAllocation(value: OrderRefundAllocation, amount: number): void {
  if (!value || value.version !== 1 || ![value.merchandiseCents, value.deliveryCents, amount]
    .every(v => Number.isSafeInteger(v) && v >= 0)
    || BigInt(value.merchandiseCents) + BigInt(value.deliveryCents) !== BigInt(amount)) invalid();
}

/** Server-priced basis, never inferred from a refund's free-text reason. */
export function orderRefundBasis(order: RefundSnapshot): OrderRefundAllocation | null {
  const result = loyalty.deriveLoyaltySaleBasis({ subtotalCents: order.totals.subtotal!,
    discountCents: order.totals.discount?.amount ?? 0, deliveryFeeCents: order.totals.deliveryFee ?? 0,
    totalCents: order.totals.total });
  return result.ok ? allocation(result.value.eligiblePurchaseCents, result.value.excludedChargeCents) : null;
}

/** Only two individual allocations can be deduced without an owner decision:
 * no delivery charge, or a single refund of the entire original charge. */
function deduced(basis: OrderRefundAllocation | null, amount: number): OrderRefundAllocation | null {
  if (!basis) return null;
  if (basis.deliveryCents === 0) return allocation(amount, 0);
  return amount === basis.merchandiseCents + basis.deliveryCents ? basis : null;
}

/** Pure observation. Never writes, reads Stripe, releases a reservation or
 * invents a prorata. The returned proof has a stable order for hashing. */
export function refundAllocationProjection(order: RefundSnapshot) {
  const financial = refundProjection(order);
  const basis = orderRefundBasis(order);
  const receipts = order.refundFlow?.allocations ?? [];
  const recorded = receipts.filter(receipt => receipt.state !== 'withdrawn');
  if (receipts.length > 128 || new Set(receipts.map(r => r.operationId)).size !== receipts.length
    || new Set(recorded.map(r => r.refundId)).size !== recorded.length
    || receipts.some(receipt => financial.flow?.operations.some(operation => operation.operationId === receipt.operationId))) invalid();
  const rows = financial.rows.map(row => {
    const operation = financial.flow?.operations.find(op => op.refund?.id === row.id);
    const receipt = recorded.find(r => r.refundId === row.id);
    if (receipt && operation?.allocation && !allocationMatches(receipt.allocation, operation.allocation)) invalid();
    const explicit = operation?.allocation ?? receipt?.allocation ?? null;
    if (explicit) assertAllocation(explicit, row.amountCents);
    const inferred = deduced(basis, row.amountCents);
    if (explicit && inferred && !allocationMatches(explicit, inferred)) invalid();
    const parts = explicit ?? inferred;
    return { refundId: row.id, amountCents: row.amountCents, providerStatus: row.status,
      allocation: parts, allocationSource: explicit ? 'owner' as const : inferred ? 'deduced' as const : null };
  }).sort((a, b) => a.refundId.localeCompare(b.refundId));
  if (recorded.some(r => !rows.some(row => row.refundId === r.refundId))) invalid();
  const reservations = (financial.flow?.operations ?? [])
    .filter(op => !op.refund && op.state !== 'withdrawn')
    .map(op => {
      if (op.allocation) assertAllocation(op.allocation, op.amountCents);
      const parts = op.allocation ?? deduced(basis, op.amountCents);
      return { operationId: op.operationId, amountCents: op.amountCents, allocation: parts };
    }).sort((a, b) => a.operationId.localeCompare(b.operationId));
  let usedMerchandise = 0; let usedDelivery = 0; let confirmedEligible = 0;
  let missing = false; let confirmedMissing = false;
  for (const row of rows) {
    if (!active.has(row.providerStatus)) continue;
    if (!row.allocation) { missing = true; if (row.providerStatus === 'succeeded') confirmedMissing = true; continue; }
    usedMerchandise += row.allocation.merchandiseCents; usedDelivery += row.allocation.deliveryCents;
    if (row.providerStatus === 'succeeded') confirmedEligible += row.allocation.merchandiseCents;
  }
  for (const row of reservations) {
    if (!row.allocation) { missing = true; continue; }
    usedMerchandise += row.allocation.merchandiseCents; usedDelivery += row.allocation.deliveryCents;
  }
  if (!Number.isSafeInteger(usedMerchandise) || !Number.isSafeInteger(usedDelivery)
    || (basis && (usedMerchandise > basis.merchandiseCents || usedDelivery > basis.deliveryCents))) invalid();
  // Several unallocated partials can together prove a full refund. Only the
  // cumulative basis is deducible; no individual allocation is fabricated.
  const fullyRefunded = !!basis && order.totals.total > 0 && financial.summary.refundedCents === order.totals.total;
  const remaining = !basis ? null : fullyRefunded ? allocation(0, 0)
    : missing ? null : allocation(basis.merchandiseCents - usedMerchandise, basis.deliveryCents - usedDelivery);
  const unallocated = fullyRefunded ? [] : rows.filter(row => active.has(row.providerStatus) && !row.allocation)
    .map(row => ({ refundId: row.refundId, amountCents: row.amountCents,
      providerStatus: row.providerStatus as 'pending' | 'requires_action' | 'succeeded', canAllocate: !!basis }));
  return {
    basis, remaining, unallocated,
    confirmedRefundedEligibleCents: !basis ? null : fullyRefunded ? basis.merchandiseCents
      : confirmedMissing ? null : confirmedEligible,
    pendingRefundCents: financial.summary.pendingRefundCents,
    // Safe upper bounds for allocating one unknown receipt. Other unknown
    // receipts remain unallocated and block new refunds until accounted for.
    allocationCapacity: basis ? allocation(basis.merchandiseCents - usedMerchandise, basis.deliveryCents - usedDelivery) : null,
    proof: { version: 1 as const, basis, rows, reservations, fullyRefunded,
      receipts: recorded.map(r => ({ operationId: r.operationId, refundId: r.refundId, allocation: r.allocation }))
        .sort((a, b) => a.refundId.localeCompare(b.refundId)) },
  };
}
