import { describe, expect, it } from 'vitest';
import { canAssignDeliveryMission, canDispatchDeliveryMission, deliveryPaymentReady, type DeliveryMissionState } from './delivery-mission';

const ready: DeliveryMissionState = {
  type: 'delivery', orderStatus: 'ready', hasAddress: true, operatorId: 'courier', dispatched: false,
  paymentStatus: 'paid', refundedCents: 0, pendingRefundCents: 0, paymentPhase: 'settled',
};
const state = (patch: Partial<DeliveryMissionState>) => ({ ...ready, ...patch });
const code = (result: ReturnType<typeof canDispatchDeliveryMission>) => result.ok ? null : result.error.code;

describe('la mission de livraison, indépendamment du transport et de la base', () => {
  it.each(['new', 'preparing', 'ready'])('peut être affectée pendant %s, sans encaisser ni préparer', orderStatus => {
    expect(canAssignDeliveryMission(state({ orderStatus, paymentStatus: 'pending', operatorId: null })).ok).toBe(true);
  });
  it.each(['pickup', 'dine_in', 'take_away'])('ne transforme pas %s en livraison', type => {
    expect(code(canAssignDeliveryMission(state({ type })))).toBe('delivery.mission.invalid');
    expect(code(canDispatchDeliveryMission(state({ type })))).toBe('delivery.mission.invalid');
  });
  it('exige une adresse pour affecter et partir', () => {
    expect(code(canAssignDeliveryMission(state({ hasAddress: false })))).toBe('delivery.mission.invalid');
    expect(code(canDispatchDeliveryMission(state({ hasAddress: false })))).toBe('delivery.mission.invalid');
  });
  it.each(['delivered', 'cancelled', 'unknown'])('ferme les mutations pour %s', orderStatus => {
    expect(code(canAssignDeliveryMission(state({ orderStatus })))).toBe('delivery.mission.closed');
    expect(code(canDispatchDeliveryMission(state({ orderStatus })))).toBe('delivery.mission.closed');
  });
  it('n’autorise ni réaffectation ni deuxième départ une fois en route', () => {
    expect(code(canAssignDeliveryMission(state({ dispatched: true })))).toBe('delivery.mission.departed');
    expect(code(canDispatchDeliveryMission(state({ dispatched: true })))).toBe('delivery.mission.departed');
  });
  it('requiert une affectation et une préparation terminée', () => {
    expect(code(canDispatchDeliveryMission(state({ operatorId: null })))).toBe('delivery.mission.unassigned');
    for (const orderStatus of ['new', 'preparing']) {
      expect(code(canDispatchDeliveryMission(state({ orderStatus })))).toBe('delivery.mission.not_ready');
    }
  });
  it.each([null, 'settled'])('autorise le départ payé sans blocage connu (phase %s)', paymentPhase => {
    expect(canDispatchDeliveryMission(state({ paymentPhase })).ok).toBe(true);
  });
  it.each(['pending', 'refunded', 'unknown'])('ne confond pas %s avec un paiement confirmé', paymentStatus => {
    expect(code(canDispatchDeliveryMission(state({ paymentStatus })))).toBe('delivery.mission.payment_blocked');
  });
  it.each(['open', 'closing', 'closed', 'counter_ready', 'review_required', 'unknown'])('échoue fermé pour la phase %s', paymentPhase => {
    expect(deliveryPaymentReady(state({ paymentPhase }))).toBe(false);
  });
  it.each([1, -1, Number.NaN, Number.POSITIVE_INFINITY])('refuse un compteur remboursé ou incohérent %s', value => {
    expect(deliveryPaymentReady(state({ refundedCents: value }))).toBe(false);
    expect(deliveryPaymentReady(state({ pendingRefundCents: value }))).toBe(false);
  });
  it('reste pure : elle ne modifie ni le paiement ni le statut', () => {
    const frozen = Object.freeze({ ...ready });
    expect(canDispatchDeliveryMission(frozen).ok).toBe(true);
    expect(frozen).toEqual(ready);
  });
});
