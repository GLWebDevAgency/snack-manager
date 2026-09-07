import { deliveryPaymentReady, type DeliveryMissionState } from './delivery-mission';

export type DeliveryHandoffEligibility = 'invalid' | 'closed' | 'not_departed' | 'payment_blocked' | null;

/** Applies to normal proof handoff AND a manager exception; no payment/dispatch bypass. */
export function deliveryHandoffEligibility(state: DeliveryMissionState): DeliveryHandoffEligibility {
  if (state.type !== 'delivery' || !state.hasAddress) return 'invalid';
  if (state.orderStatus === 'delivered' || state.orderStatus === 'cancelled') return 'closed';
  if (state.orderStatus !== 'ready' || !state.dispatched) return 'not_departed';
  if (!deliveryPaymentReady(state)) return 'payment_blocked';
  return null;
}

/** Clock injected by the caller; invalid timestamps/counters fail closed. */
export function deliveryProofAvailability(proof: { expiresAt: number; failedAttempts: number } | null, now: number): 'proof_unavailable' | 'proof_expired' | 'proof_locked' | null {
  if (!proof || !Number.isFinite(now) || !Number.isFinite(proof.expiresAt)
    || !Number.isSafeInteger(proof.failedAttempts) || proof.failedAttempts < 0) return 'proof_unavailable';
  if (proof.failedAttempts >= 5) return 'proof_locked';
  if (proof.expiresAt <= now) return 'proof_expired';
  return null;
}
