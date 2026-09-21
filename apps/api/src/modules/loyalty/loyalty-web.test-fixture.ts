import { randomUUID } from 'node:crypto';
import { Types } from 'mongoose';
import type { LoyaltyWebObservedOrder } from './loyalty-web-observation';

/** Synthetic server receipt. No provider, phone, token or card fixture. */
export function loyaltyWebFixture(): LoyaltyWebObservedOrder {
  const tenantRef = new Types.ObjectId().toHexString(), orderId = new Types.ObjectId(), clientId = randomUUID();
  const owner = { parentRef: `AC${'a'.repeat(32)}`, tenantRef, accountId: randomUUID() };
  const at = new Date('2030-01-01T12:00:00Z');
  return {
    _id: orderId, tenantId: new Types.ObjectId(tenantRef), __v: 2, clientId, channel: 'online', type: 'pickup', status: 'delivered',
    customerOwner: owner, customerSaleAttribution: { version: 1, tenantRef, clientId, owner, capturedAt: at.getTime() - 3600_000,
      decision: 'attributed', memberId: randomUUID(), membershipOperationId: randomUUID(), programId: randomUUID(), rulesVersion: 1,
      rule: { mechanism: 'points', minimumPurchaseCents: 0, maximumUnitsPerPurchase: null, spendStepCents: 100, unitsPerStep: 1 },
      basis: { policyVersion: 'merchandise-net-v1', eligiblePurchaseCents: 1000, excludedChargeCents: 0, chargedTotalCents: 1000 } },
    loyaltyWebIntent: { version: 1, operationId: randomUUID() }, loyaltyMemberId: null,
    totals: { subtotal: 1000, discount: null, deliveryFee: 0, total: 1000 },
    payment: { method: 'counter', status: 'paid', refundedCents: 0, pendingRefundCents: 0, refundSyncVersion: 0, refunds: [] },
    counterCollection: { operationId: randomUUID(), amountCents: 1000, tender: 'cash', collectedAt: at },
    paymentFlow: { version: 1, phase: 'open', attempt: null },
    statusHistory: [{ status: 'delivered', at, by: new Types.ObjectId().toHexString() }],
    refundFlow: null,
  };
}
