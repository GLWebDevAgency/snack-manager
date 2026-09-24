import { createHash } from 'node:crypto';
import { CustomerSaleAttributionSchema, type CustomerSaleAttribution } from '@sm/contracts';
import { validLoyaltyWebIntent, type LoyaltyWebIntent } from '@sm/db';
import { loyalty } from '@sm/domain';
import { counterRefundProjection, type CounterRefundSnapshot, type CounterRefundFlow } from '../ordering/order-counter-refund.policy';
import { OrderRewardSnapshotSchema } from './order-reward.store';
import { refundAllocationProjection } from '../ordering/order-refund-allocation.policy';
import { HISTORICAL_SALE_PROOF_MAX_BYTES, historicalSaleFinancialFingerprint, type HistoricalSaleJson, type HistoricalSaleSettlementInput } from './loyalty-historical-sale.types';

type RefundOrder = Parameters<typeof refundAllocationProjection>[0];
export type LoyaltyWebObservedOrder = RefundOrder & {
  _id: unknown; tenantId: unknown; clientId: string; channel: string; type: string; status: string; __v?: number;
  createdAt?: Date; counterRefundFlow?: CounterRefundFlow | null; loyaltyReward?: unknown;
  loyaltyRewardProcessing?: { state?: string; zeroPaid?: boolean; orderVersion?: number } | null;
  customerOwner?: unknown; customerSaleAttribution?: CustomerSaleAttribution | null; loyaltyWebIntent?: LoyaltyWebIntent | null; loyaltyMemberId?: string | null;
  statusHistory?: readonly { status?: string; at?: Date; by?: string | null }[];
  counterCollection?: { operationId: string; amountCents: number; tender: string; collectedAt: Date } | null;
  paymentFlow?: { version: number; origin?: string; phase: string; providerStatus?: string | null;
    close?: { operationId: string; destination?: string; reason: string; requestedBy: string; requestedAt: Date } | null;
    attempt?: {
    id: string; accountId?: string | null; environment: string; amountCents: number; currency: string;
    metadata: { orderId: string; tenantId: string; orderNumber: string }; requestStartedAt?: Date | null;
  } | null } | null;
  delivery?: { deliveredAt?: Date | null } | null;
  deliveryHandoff?: { completed?: { operationId: string; at: Date; method: string; actorId: string; actorKind: string } | null;
    operations: readonly { operationId: string; at: Date; action: string; outcome: string; actorId: string; actorKind: string }[] } | null;
};

export class LoyaltyWebObservationError extends Error {
  constructor(readonly code: 'invalid_web_intent' | 'attribution_conflict' | 'payment_proof_invalid' | 'handoff_proof_invalid' | 'refund_allocation_conflict' | 'financial_proof_too_large') {
    super(code);
  }
}
const id = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{24}$/.test(value);
const uuid = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value);
const instant = (value: unknown): string | null => value instanceof Date && Number.isSafeInteger(value.getTime()) ? value.toISOString() : null;
const invalid = (code: ConstructorParameters<typeof LoyaltyWebObservationError>[0]): never => { throw new LoyaltyWebObservationError(code); };

function paymentProof(order: LoyaltyWebObservedOrder): HistoricalSaleJson {
  if (!['paid', 'refunded'].includes(order.payment.status)) return null;
  if (order.totals.total === 0) {
    const parsed = OrderRewardSnapshotSchema.safeParse(order.loyaltyReward);
    const snapshot = parsed.success ? parsed.data : null;
    const attribution = order.customerSaleAttribution;
    const flow = order.paymentFlow, close = flow?.close;
    const cancelled = order.status === 'cancelled';
    const cancellationProven = cancelled && flow?.phase === 'closed' && close?.destination === 'cancel_order'
      && uuid(close.operationId) && id(close.requestedBy) && instant(close.requestedAt) !== null
      && typeof close.reason === 'string' && close.reason.trim().length > 0;
    const lifecycleProven = flow?.version === 1 && flow.origin === 'created_v1'
      && (cancelled ? cancellationProven && ['consumed', 'reversed'].includes(order.loyaltyRewardProcessing?.state ?? '')
        : flow.phase === 'open' && !close && order.loyaltyRewardProcessing?.state === 'consumed');
    if (!snapshot || !attribution || attribution.decision !== 'attributed'
      || snapshot.clientId !== order.clientId || snapshot.owner.tenantRef !== String(order.tenantId)
      || snapshot.owner.parentRef !== attribution.owner.parentRef || snapshot.owner.accountId !== attribution.owner.accountId
      || snapshot.memberId !== attribution.memberId || snapshot.programId !== attribution.programId
      // Reservation commits before attribution is captured. A publication in
      // between may advance the earn rule without changing the canonical
      // account/member/program or the historical reward debit. Zero earns no
      // units under either rule; SQL still validates the exact attributed rule.
      || snapshot.rulesVersion > attribution.rulesVersion
      || snapshot.benefit.amountCents !== order.totals.discount?.amount || (order.totals.discount as { promotionId?: unknown } | null)?.promotionId != null
      || !lifecycleProven || order.loyaltyRewardProcessing?.zeroPaid !== true
      || !Number.isSafeInteger(order.loyaltyRewardProcessing.orderVersion) || order.loyaltyRewardProcessing.orderVersion! > order.__v!
      || order.loyaltyRewardProcessing.orderVersion! < 0 || order.payment.status !== 'paid'
      || flow?.attempt || order.payment.stripePaymentIntentId
      || order.counterCollection || order.counterRefundFlow?.operations.length
      || (order.payment.refundedCents ?? 0) !== 0 || (order.payment.pendingRefundCents ?? 0) !== 0
      || order.payment.refunds?.length || order.refundFlow?.operations.length) return invalid('payment_proof_invalid');
    // This private marker is written only after the canonical PG consume
    // receipt. A canonical cancellation stays unpaid-and-undelivered for
    // earning, before and after restitution; replay does not mint a zero earn.
    // Neither branch represents a card/cash transfer or a positive gain.
    return { kind: 'zero_total_reward', reservationId: snapshot.reservationId,
      pricingHash: snapshot.pricingHash, amountCents: 0, rewardAmountCents: snapshot.benefit.amountCents,
      ...(cancelled ? { closure: { operationId: close!.operationId, destination: 'cancel_order', at: instant(close!.requestedAt) } } : {}) };
  }
  if (order.payment.method === 'counter') {
    const receipt = order.counterCollection;
    if (!receipt || !uuid(receipt.operationId) || receipt.amountCents !== order.totals.total
      || !['cash', 'card', 'meal_voucher'].includes(receipt.tender) || !instant(receipt.collectedAt)
      || (order.paymentFlow && !['open', 'counter_ready'].includes(order.paymentFlow.phase))) return invalid('payment_proof_invalid');
    // Preserve the historical payment proof. New counter refunds require
    // their separate durable attestation journal, never synthetic Stripe rows.
    if (!order.counterRefundFlow && (order.payment.status === 'refunded' || (order.payment.refundedCents ?? 0) !== 0
      || (order.payment.pendingRefundCents ?? 0) !== 0 || order.payment.refunds?.length
      || order.refundFlow?.operations.length)) return invalid('refund_allocation_conflict');
    return { kind: 'counter', operationId: receipt.operationId, amountCents: receipt.amountCents,
      tender: receipt.tender, collectedAt: instant(receipt.collectedAt) };
  }
  const flow = order.paymentFlow, attempt = flow?.attempt;
  if (order.payment.method !== 'online' || !flow || flow.version !== 1 || flow.phase !== 'settled'
    || flow.providerStatus !== 'succeeded' || !attempt || !attempt.id || !instant(attempt.requestStartedAt)
    || !['test', 'live'].includes(attempt.environment) || attempt.currency !== 'eur' || attempt.amountCents !== order.totals.total
    || attempt.metadata.orderId !== String(order._id) || attempt.metadata.tenantId !== String(order.tenantId)
    || !order.payment.stripePaymentIntentId || (attempt.accountId ?? null) !== (order.payment.stripeAccountId ?? null)) return invalid('payment_proof_invalid');
  return { kind: 'stripe', intentId: order.payment.stripePaymentIntentId, accountId: attempt.accountId ?? null,
    attemptId: attempt.id, environment: attempt.environment, amountCents: attempt.amountCents,
    currency: attempt.currency, requestStartedAt: instant(attempt.requestStartedAt) };
}

function handoffProof(order: LoyaltyWebObservedOrder): HistoricalSaleJson {
  if (order.status !== 'delivered') return null;
  const history = order.statusHistory?.filter(row => row.status === 'delivered') ?? [];
  if (history.length !== 1 || !instant(history[0]?.at) || !id(history[0]?.by)) return invalid('handoff_proof_invalid');
  if (order.type === 'delivery') {
    const receipt = order.deliveryHandoff?.completed;
    const operations = order.deliveryHandoff?.operations.filter(row => row.operationId === receipt?.operationId) ?? [];
    const operation = operations[0];
    if (!receipt || !uuid(receipt.operationId) || !instant(receipt.at) || !['pin', 'qr', 'override'].includes(receipt.method)
      || operations.length !== 1 || !operation || operation.outcome !== 'applied'
      || operation.action !== (receipt.method === 'override' ? 'override' : 'handoff')
      || instant(operation.at) !== instant(receipt.at) || instant(order.delivery?.deliveredAt) !== instant(receipt.at)
      || instant(history[0]?.at) !== instant(receipt.at) || history[0]?.by !== receipt.actorId
      || operation.actorId !== receipt.actorId || operation.actorKind !== receipt.actorKind) return invalid('handoff_proof_invalid');
    return { kind: 'delivery', operationId: receipt.operationId, method: receipt.method, at: instant(receipt.at) };
  }
  if (order.type !== 'pickup') return invalid('handoff_proof_invalid');
  return { kind: 'pickup', at: instant(history[0]?.at), actorRef: history[0]!.by! };
}

/** Stable identity excludes polling, leases and Mongo version counters. */
function observationId(tenant: string, client: string, fingerprint: string): string {
  const bytes = createHash('sha256').update(`loyalty-web-observation-v1\0${tenant}\0${client}\0${fingerprint}`).digest().subarray(0, 16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x50; bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** No provider request or current membership lookup. Every proof is the exact
 * server-priced ticket read on the Mongo primary with majority concern. */
export function loyaltyWebObservation(order: LoyaltyWebObservedOrder): HistoricalSaleSettlementInput {
  const tenantRef = String(order.tenantId);
  if (!id(tenantRef) || !id(String(order._id)) || !uuid(order.clientId) || order.channel !== 'online'
    || !validLoyaltyWebIntent(order.loyaltyWebIntent) || order.loyaltyMemberId
    || !Number.isSafeInteger(order.__v) || order.__v! < 0
    || !Number.isSafeInteger(order.payment.refundSyncVersion) || order.payment.refundSyncVersion! < 0) return invalid('invalid_web_intent');
  const parsed = CustomerSaleAttributionSchema.safeParse(order.customerSaleAttribution);
  if (!parsed.success || parsed.data.decision !== 'attributed') return invalid('attribution_conflict');
  const attribution = parsed.data;
  const owner = order.customerOwner as { parentRef?: unknown; tenantRef?: unknown; accountId?: unknown } | null;
  if (attribution.tenantRef !== tenantRef || attribution.clientId !== order.clientId || !owner
    || owner.parentRef !== attribution.owner.parentRef || owner.tenantRef !== tenantRef || owner.accountId !== attribution.owner.accountId) return invalid('attribution_conflict');
  const totals = order.totals as { subtotal?: number; discount?: { amount?: number } | null; deliveryFee?: number; total: number };
  const basis = loyalty.deriveLoyaltySaleBasis({ subtotalCents: totals.subtotal!, discountCents: totals.discount?.amount ?? 0,
    deliveryFeeCents: totals.deliveryFee ?? 0, totalCents: totals.total });
  if (!basis.ok || basis.value.eligiblePurchaseCents !== attribution.basis.eligiblePurchaseCents
    || basis.value.excludedChargeCents !== attribution.basis.excludedChargeCents
    || basis.value.chargedTotalCents !== attribution.basis.chargedTotalCents) return invalid('attribution_conflict');
  const payment = paymentProof(order), handoff = handoffProof(order);
  let allocation: { confirmedRefundedEligibleCents: number | null; pendingRefundCents: number; proof: unknown };
  try {
    allocation = order.payment.method === 'counter' && order.counterRefundFlow
      ? counterRefundProjection(order as unknown as CounterRefundSnapshot) : refundAllocationProjection(order);
  } catch { return invalid('refund_allocation_conflict'); }
  const financial = { attribution, eligibleRefundedCents: allocation.confirmedRefundedEligibleCents,
    pendingRefundCents: allocation.pendingRefundCents, paidAndDelivered: payment !== null && handoff !== null,
    proof: { version: 1, orderId: String(order._id), payment, handoff, allocation: allocation.proof } as HistoricalSaleJson };
  // Preserve the complete immutable SQL observation or stop explicitly. Never
  // truncate refund history or misclassify a permanent size limit as downtime.
  if (Buffer.byteLength(JSON.stringify(financial.proof)) > HISTORICAL_SALE_PROOF_MAX_BYTES) return invalid('financial_proof_too_large');
  const financialFingerprint = historicalSaleFinancialFingerprint(financial);
  return { tenantRef, clientId: order.clientId, earnOperationId: order.loyaltyWebIntent.operationId, attribution,
    observation: { observationId: observationId(tenantRef, order.clientId, financialFingerprint), financialFingerprint,
      orderVersion: order.__v!, refundSyncVersion: order.payment.refundSyncVersion!,
      eligibleRefundedCents: financial.eligibleRefundedCents, pendingRefundCents: financial.pendingRefundCents,
      paidAndDelivered: financial.paidAndDelivered, proof: financial.proof } };
}
