import { LoyaltyWebProcessingSchema } from './loyalty-web-intent.schema';
/** Scheduling projection only. The canonical gain identity stays in the old
 * immutable earn receipt and original POS fields, never in a fabricated owner. */
export const LoyaltyPosCompensationProcessingSchema = LoyaltyWebProcessingSchema.clone();
export function posCompensationWake(order: { channel?: string; loyaltyMemberId?: string | null; loyaltyEarnOperationId?: string | null;
  loyaltyEarnState?: string | null; loyaltyPosCompensationProcessing?: unknown }, now: Date): Record<string, unknown> {
  if (order.channel !== 'pos' || !order.loyaltyMemberId || !order.loyaltyEarnOperationId || order.loyaltyEarnState !== 'completed') return {};
  return order.loyaltyPosCompensationProcessing == null
    ? { loyaltyPosCompensationProcessing: { state: 'pending', dirty: true, attempts: 0, leaseToken: null, leaseUntil: null,
      nextAttemptAt: now, lastError: null, observationId: null, financialFingerprint: null, orderVersion: null, refundSyncVersion: null,
      observedAt: null, awardedUnits: null, reversedUnits: null } }
    : { 'loyaltyPosCompensationProcessing.dirty': true, 'loyaltyPosCompensationProcessing.nextAttemptAt': now };
}
