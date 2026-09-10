import { ConflictException, ServiceUnavailableException } from '@nestjs/common';
import type { OrderRefundSummary } from '@sm/contracts';
import { refundSummary, type ProviderRefund } from './order-refunds.policy';

export type RefundProof = ProviderRefund & { currency: string; payment_intent: string };
export type RefundOperation = {
  operationId: string; amountCents: number; reason: string; actorId: string;
  environment: 'test' | 'live'; paymentIntentId: string; accountId: string | null;
  idempotencyKey: string; preparedAt: Date; requestStartedAt?: Date | null;
  state: 'prepared' | 'creating' | 'known' | 'review_required';
  refund?: RefundProof | null; providerCheckedAt?: Date | null; reviewReason?: string | null;
};
export type RefundFlow = { version: 1; operations: RefundOperation[] };
export type StoredRefund = { id: string; amountCents: number; status: string; operationId?: string | null; reason?: string };
export type RefundSnapshot = {
  _id: unknown; tenantId: unknown; __v?: number; totals: { total: number };
  payment: {
    method: string; status: string; stripePaymentIntentId?: string | null; stripeAccountId?: string | null;
    refundSyncVersion?: number; refundedCents?: number; pendingRefundCents?: number; refunds?: StoredRefund[];
  };
  paymentFlow?: { attempt?: { environment: string } | null } | null;
  refundFlow?: RefundFlow | null;
};
const PROVIDER_STATES = new Set(['pending', 'requires_action', 'succeeded', 'failed', 'canceled']);
export const MAX_REFUND_OPERATIONS = 128;
// Well inside Stripe's minimum 24-hour retention. Never extend on a retry.
export const REFUND_RECOVERY_WINDOW_MS = 60 * 60 * 1000;

export function refundUnavailable(): never {
  throw new ServiceUnavailableException('Remboursement en cours de vérification. Conservez la même demande ; ne créez pas une nouvelle opération.');
}

export function assertRefundProof(order: RefundSnapshot, row: RefundProof, operation?: RefundOperation): void {
  if (typeof row.id !== 'string' || !row.id || !Number.isSafeInteger(row.amount) || row.amount <= 0 || row.amount > order.totals.total
    || row.currency !== 'eur' || row.payment_intent !== order.payment.stripePaymentIntentId
    || !row.status || !PROVIDER_STATES.has(row.status)) refundUnavailable();
  if (operation && (row.amount !== operation.amountCents
    || (operation.refund && operation.refund.id !== row.id)
    || row.metadata?.operationId !== operation.operationId || row.metadata?.reason !== operation.reason
    || row.metadata?.requestedBy !== operation.actorId || row.metadata?.orderId !== String(order._id)
    || row.metadata?.tenantId !== String(order.tenantId))) refundUnavailable();
}

/** Absence in a list is not negative proof. Retain every previously observed
 * refund and every unresolved local reservation; replace only an observed ID.
 * The caller fences both observation and projection with the document version. */
export function refundProjection(order: RefundSnapshot, incoming: readonly RefundProof[] = []): {
  flow: RefundFlow | null; rows: StoredRefund[]; summary: OrderRefundSummary;
} {
  const flow = order.refundFlow ? structuredClone(order.refundFlow) : null;
  if (flow && (flow.version !== 1 || flow.operations.length > MAX_REFUND_OPERATIONS)) refundUnavailable();
  const rows = new Map<string, StoredRefund>((order.payment.refunds ?? []).map((row) => [row.id, { ...row }]));
  for (const operation of flow?.operations ?? []) {
    if (operation.refund) {
      assertRefundProof(order, operation.refund, operation);
      const proof = operation.refund;
      rows.set(proof.id, { id: proof.id, amountCents: proof.amount, status: proof.status!,
        operationId: operation.operationId, reason: operation.reason });
    }
  }
  // Older rows may carry a financial aggregate without its individual proof.
  // A list (even a complete empty list) cannot explain that discrepancy. Do
  // not turn missing historical evidence into newly refundable money.
  const before = refundSummary(order.totals.total, [...rows.values()].map((row) => ({
    id: row.id, amount: row.amountCents, status: row.status,
  })));
  const reservedLocally = (flow?.operations ?? []).filter(operation => !operation.refund)
    .reduce((sum, operation) => sum + operation.amountCents, 0);
  if ((order.payment.refundedCents ?? 0) > before.refundedCents
    || (order.payment.pendingRefundCents ?? 0) > before.pendingRefundCents + reservedLocally) {
    throw new ConflictException('Historique de remboursement incomplet : rapprochement requis avant toute nouvelle demande.');
  }
  const observed = new Set<string>();
  for (const proof of incoming) {
    assertRefundProof(order, proof);
    if (observed.has(proof.id)) refundUnavailable();
    observed.add(proof.id);
    const previous = rows.get(proof.id);
    if (previous && previous.amountCents !== proof.amount) refundUnavailable();
    const operation = flow?.operations.find((entry) => entry.operationId === proof.metadata?.operationId || entry.refund?.id === proof.id);
    if (operation) {
      assertRefundProof(order, proof, operation);
      // The Stripe SDK returns a complete object (charge, timestamps, balances,
      // etc.). Persist only our correlated receipt, never an SDK object shape.
      operation.refund = { id: proof.id, amount: proof.amount, currency: proof.currency,
        payment_intent: proof.payment_intent, status: proof.status, metadata: {
          operationId: operation.operationId, orderId: String(order._id), tenantId: String(order.tenantId),
          requestedBy: operation.actorId, reason: operation.reason,
        } };
      operation.state = 'known'; operation.providerCheckedAt = new Date(); operation.reviewReason = null;
    }
    rows.set(proof.id, { id: proof.id, amountCents: proof.amount, status: proof.status!,
      operationId: proof.metadata?.operationId ?? previous?.operationId ?? null,
      reason: proof.metadata?.reason ?? previous?.reason ?? '' });
  }
  const summary = refundSummary(order.totals.total, [...rows.values()].map((row) => ({
    id: row.id, amount: row.amountCents, status: row.status,
  })));
  for (const operation of flow?.operations ?? []) {
    if (!operation.refund) summary.pendingRefundCents += operation.amountCents;
  }
  if (!Number.isSafeInteger(summary.pendingRefundCents) || summary.refundedCents + summary.pendingRefundCents > order.totals.total) {
    throw new ConflictException('Preuves de remboursement incohérentes : rapprochement requis.');
  }
  summary.remainingCents = Math.max(0, order.totals.total - summary.refundedCents - summary.pendingRefundCents);
  if (summary.pendingRefundCents > 0) summary.status = 'pending';
  return { flow, rows: [...rows.values()], summary };
}
