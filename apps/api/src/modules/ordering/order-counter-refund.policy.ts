import { createHash } from 'node:crypto';
import { COUNTER_REFUND_DISBURSE_WINDOW_MS, CounterRefundIntentSchema, type CounterRefundIntent, type JwtPayload } from '@sm/contracts';
import type { Order } from '@sm/db';
import { canCollectOrderAtCounter } from './order-payment-lifecycle.service';

export type CounterRefundActor = Pick<JwtPayload, 'sub' | 'kind' | 'role'>;
export type CounterRefundOperation = CounterRefundIntent & {
  actor: CounterRefundActor; approver: CounterRefundActor;
  state: 'prepared' | 'started' | 'confirmed' | 'withdrawn' | 'not_executed';
  preparedAt: Date; startedAt: Date | null; confirmedAt: Date | null; resolvedAt: Date | null;
  disburseExpiresAt: Date | null;
  attestation: 'cash_returned' | 'terminal_refund_confirmed' | null;
  resolution: { actor: CounterRefundActor; reason: string } | null;
};
export type CounterRefundFlow = { version: 1; paymentProofHash: string; operations: CounterRefundOperation[] };
export type CounterRefundSnapshot = Pick<Order, 'channel' | 'type' | 'totals' | 'payment' | 'paymentFlow' | 'counterCollection'> & {
  _id: unknown; tenantId: unknown; clientId: string; createdAt: Date; __v?: number;
  statusHistory: readonly { status?: string | null; at?: Date | null; by?: string | null }[];
  counterRefundFlow?: CounterRefundFlow | null;
  refundFlow?: { operations?: unknown[] } | null;
  loyaltyWebIntent?: { version: number } | null;
  loyaltyMemberId?: string | null; loyaltyEarnOperationId?: string | null; loyaltyEarnState?: string | null;
  loyaltyPosCompensationProcessing?: unknown;
};
export class CounterRefundProofError extends Error {
  constructor(readonly reason: 'payment_proof_missing' | 'unsupported_tender' | 'financial_conflict') { super(reason); }
}
const fail = (reason: CounterRefundProofError['reason']): never => { throw new CounterRefundProofError(reason); };
const id = (value: unknown) => typeof value === 'string' && /^[a-f0-9]{24}$/.test(value);
const cents = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= 100_000_000;
const date = (value: unknown): value is Date => value instanceof Date && Number.isSafeInteger(value.getTime());
const uuid = (value: unknown) => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const actorValid = (actor: CounterRefundActor) => actor && id(actor.sub) && ['user', 'staff'].includes(actor.kind)
  && ['owner', 'cogerant', 'gerant', 'caisse'].includes(actor.role);
export const sameCounterRefundActor = (left: CounterRefundActor, right: CounterRefundActor) => left.sub === right.sub && left.kind === right.kind;

function paymentProof(order: CounterRefundSnapshot) {
  if (!id(String(order._id)) || !id(String(order.tenantId)) || !cents(order.totals.total)
    || order.payment.method !== 'counter' || !['paid', 'refunded'].includes(order.payment.status)
    || !canCollectOrderAtCounter(order)) return fail('payment_proof_missing');
  const tender = order.payment.tender;
  if (tender !== 'cash' && tender !== 'card') return fail('unsupported_tender');
  const receipt = order.counterCollection;
  if (receipt) {
    if (!uuid(receipt.operationId) || receipt.amountCents !== order.totals.total || receipt.tender !== tender
      || !date(receipt.collectedAt) || !actorValid(receipt.actor as CounterRefundActor)) return fail('payment_proof_missing');
    if (tender === 'cash' && (!cents(receipt.cashReceivedCents) || !cents(receipt.changeGivenCents)
      || receipt.cashReceivedCents - receipt.changeGivenCents !== receipt.amountCents
      || order.payment.cashReceived !== receipt.cashReceivedCents || order.payment.changeGiven !== receipt.changeGivenCents)) return fail('payment_proof_missing');
    return { kind: 'counter_collection' as const, tenantId: String(order.tenantId), orderId: String(order._id),
      operationId: receipt.operationId, amountCents: receipt.amountCents, tender, at: receipt.collectedAt.toISOString(),
      actor: { sub: receipt.actor.sub, kind: receipt.actor.kind },
      cashReceivedCents: receipt.cashReceivedCents ?? null, changeGivenCents: receipt.changeGivenCents ?? null };
  }
  // Existing POS sales were paid in the atomic creation snapshot. Require its
  // genuine actor/time/client ID and untouched payment flow, never invent a
  // counterCollection receipt for an old document with only `paid` set.
  if (!Array.isArray(order.statusHistory)) return fail('payment_proof_missing');
  const initial = order.statusHistory.filter(row => row.status === 'new');
  if (order.channel !== 'pos' || !uuid(order.clientId) || !date(order.createdAt)
    || order.paymentFlow?.origin !== 'created_v1' || order.paymentFlow.phase !== 'open'
    || order.paymentFlow.attempt || order.paymentFlow.close || order.payment.stripePaymentIntentId
    || initial.length !== 1 || !id(initial[0]?.by) || !date(initial[0]?.at)
    || initial[0]!.at.getTime() > order.createdAt.getTime()) return fail('payment_proof_missing');
  if (tender === 'cash' && (!cents(order.payment.cashReceived) || !cents(order.payment.changeGiven)
    || order.payment.cashReceived - order.payment.changeGiven !== order.totals.total)) return fail('payment_proof_missing');
  return { kind: 'pos_creation' as const, tenantId: String(order.tenantId), orderId: String(order._id), clientId: order.clientId,
    amountCents: order.totals.total, tender, at: initial[0]!.at.toISOString(), actorRef: initial[0]!.by,
    cashReceivedCents: order.payment.cashReceived ?? null, changeGivenCents: order.payment.changeGiven ?? null };
}

/** Exact server evidence, not a provider success. `confirmed` means the
 * responsible operator attested the physical refund under this protocol. */
export function counterRefundProjection(order: CounterRefundSnapshot) {
  const payment = paymentProof(order);
  const subtotal = order.totals.subtotal, discount = order.totals.discount?.amount ?? 0, delivery = order.totals.deliveryFee ?? 0;
  if (!cents(subtotal) || !cents(discount) || discount > subtotal || !cents(delivery)
    || subtotal - discount + delivery !== order.totals.total
    || order.refundFlow?.operations?.length || order.payment.refunds?.length) return fail('financial_conflict');
  const basis = { merchandiseCents: subtotal - discount, deliveryCents: delivery };
  const paymentProofHash = createHash('sha256').update(JSON.stringify({ payment, basis })).digest('hex');
  const flow = order.counterRefundFlow;
  if (flow && (flow.version !== 1 || flow.paymentProofHash !== paymentProofHash || !Array.isArray(flow.operations)
    || flow.operations.length > 128)) return fail('financial_conflict');
  const remaining = { ...basis };
  let confirmedRefundedCents = 0, pendingRefundCents = 0, confirmedRefundedEligibleCents = 0;
  const seen = new Set<string>();
  const operations = (flow?.operations ?? []).map(operation => {
    const parsed = CounterRefundIntentSchema.safeParse({ operationId: operation.operationId, amountCents: operation.amountCents,
      reason: operation.reason, tender: operation.tender, allocation: operation.allocation });
    if (!parsed.success || operation.tender !== payment.tender || seen.has(operation.operationId.toLowerCase())
      || !actorValid(operation.actor) || !actorValid(operation.approver)
      || !(operation.approver.kind === 'user' && operation.approver.role === 'owner'
        || operation.approver.kind === 'staff' && operation.approver.role === 'gerant')
      || !date(operation.preparedAt)) return fail('financial_conflict');
    seen.add(operation.operationId.toLowerCase());
    const started = ['started', 'confirmed', 'not_executed'].includes(operation.state);
    if (started !== date(operation.startedAt) || started !== date(operation.disburseExpiresAt)
      || (started && operation.disburseExpiresAt!.getTime() !== operation.startedAt!.getTime() + COUNTER_REFUND_DISBURSE_WINDOW_MS)
      || (started && operation.startedAt!.getTime() < operation.preparedAt.getTime())
      || (operation.state === 'confirmed') !== date(operation.confirmedAt)
      || (['withdrawn', 'not_executed'].includes(operation.state)) !== date(operation.resolvedAt)
      || !['prepared', 'started', 'confirmed', 'withdrawn', 'not_executed'].includes(operation.state)
      || (operation.state === 'confirmed' ? operation.attestation !== (payment.tender === 'cash' ? 'cash_returned' : 'terminal_refund_confirmed') : operation.attestation !== null)
      || (operation.state === 'not_executed' ? !operation.resolution || operation.resolution.actor.kind !== 'user'
        || operation.resolution.actor.role !== 'owner' || !id(operation.resolution.actor.sub) || typeof operation.resolution.reason !== 'string' || operation.resolution.reason.trim().length < 3
        || operation.resolution.reason.length > 200 || operation.resolvedAt!.getTime() < operation.disburseExpiresAt!.getTime() : operation.resolution !== null)) return fail('financial_conflict');
    if (operation.confirmedAt && operation.confirmedAt.getTime() < operation.startedAt!.getTime()
      || operation.resolvedAt && operation.resolvedAt.getTime() < (operation.startedAt ?? operation.preparedAt).getTime()) return fail('financial_conflict');
    if (['prepared', 'started', 'confirmed'].includes(operation.state)) {
      remaining.merchandiseCents -= operation.allocation.merchandiseCents;
      remaining.deliveryCents -= operation.allocation.deliveryCents;
      if (operation.state === 'confirmed') {
        confirmedRefundedCents += operation.amountCents;
        confirmedRefundedEligibleCents += operation.allocation.merchandiseCents;
      } else pendingRefundCents += operation.amountCents;
    }
    return { ...parsed.data, actor: operation.actor, approver: operation.approver, state: operation.state,
      preparedAt: operation.preparedAt.toISOString(), startedAt: operation.startedAt?.toISOString() ?? null,
      disburseExpiresAt: operation.disburseExpiresAt?.toISOString() ?? null,
      confirmedAt: operation.confirmedAt?.toISOString() ?? null, resolvedAt: operation.resolvedAt?.toISOString() ?? null,
      attestation: operation.attestation, resolution: operation.resolution };
  }).sort((left, right) => left.operationId.localeCompare(right.operationId));
  if (remaining.merchandiseCents < 0 || remaining.deliveryCents < 0
    || (order.payment.refundedCents ?? 0) !== confirmedRefundedCents
    || (order.payment.pendingRefundCents ?? 0) !== pendingRefundCents
    || (order.payment.status === 'refunded') !== (confirmedRefundedCents === order.totals.total && order.totals.total > 0)
    || !cents(order.payment.refundSyncVersion ?? 0)) return fail('financial_conflict');
  return { originalPaidCents: order.totals.total, tender: payment.tender, basis, remaining, paymentProofHash,
    confirmedRefundedCents, pendingRefundCents, confirmedRefundedEligibleCents,
    refundSyncVersion: order.payment.refundSyncVersion ?? 0,
    proof: { version: 1, payment, basis, operations } };
}
