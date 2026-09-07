import { describe, expect, it } from 'vitest';
import { deliveryHandoffEligibility, deliveryProofAvailability } from './delivery-handoff';
import type { DeliveryMissionState } from './delivery-mission';

const state: DeliveryMissionState = { type: 'delivery', orderStatus: 'ready', hasAddress: true, operatorId: 'driver', dispatched: true,
  paymentStatus: 'paid', refundedCents: 0, pendingRefundCents: 0, paymentPhase: 'settled' };
describe('delivery handoff eligibility', () => {
  it('requires payment, readiness and actual departure, also for a historical manager override', () => {
    expect(deliveryHandoffEligibility(state)).toBeNull();
    expect(deliveryHandoffEligibility({ ...state, operatorId: null })).toBeNull(); // ownership is a separate access boundary
  });
  it.each([
    [{ type: 'pickup' }, 'invalid'], [{ hasAddress: false }, 'invalid'],
    [{ orderStatus: 'delivered' }, 'closed'], [{ orderStatus: 'cancelled' }, 'closed'],
    [{ orderStatus: 'preparing' }, 'not_departed'], [{ orderStatus: 'unexpected' }, 'not_departed'], [{ dispatched: false }, 'not_departed'],
    [{ paymentStatus: 'pending' }, 'payment_blocked'], [{ paymentStatus: 'refunded' }, 'payment_blocked'],
    [{ refundedCents: 1 }, 'payment_blocked'], [{ pendingRefundCents: 1 }, 'payment_blocked'],
    [{ refundedCents: -1 }, 'payment_blocked'], [{ refundedCents: NaN }, 'payment_blocked'],
    [{ paymentPhase: 'closing' }, 'payment_blocked'], [{ paymentPhase: 'review_required' }, 'payment_blocked'],
  ] as const)('fails closed for %j', (patch, code) => expect(deliveryHandoffEligibility({ ...state, ...patch })).toBe(code));
  it('permits only absent historical phase or settled, not an open bank flow', () => {
    expect(deliveryHandoffEligibility({ ...state, paymentPhase: null })).toBeNull();
    expect(deliveryHandoffEligibility({ ...state, paymentPhase: 'open' })).toBe('payment_blocked');
  });
});
describe('delivery proof expiry and failed attempts', () => {
  it('expires at the exact boundary', () => {
    expect(deliveryProofAvailability({ expiresAt: 100, failedAttempts: 4 }, 99)).toBeNull();
    expect(deliveryProofAvailability({ expiresAt: 100, failedAttempts: 4 }, 100)).toBe('proof_expired');
    expect(deliveryProofAvailability({ expiresAt: 100, failedAttempts: 5 }, 99)).toBe('proof_locked');
  });
  it.each([null, { expiresAt: NaN, failedAttempts: 0 }, { expiresAt: 100, failedAttempts: -1 }, { expiresAt: 100, failedAttempts: 0.5 }])('rejects invalid stored state %j', proof => {
    expect(deliveryProofAvailability(proof, 1)).toBe('proof_unavailable');
  });
  it('rejects an invalid server clock', () => expect(deliveryProofAvailability({ expiresAt: 100, failedAttempts: 0 }, NaN)).toBe('proof_unavailable'));
});
