import { DomainError } from '../shared/errors';
import { err, ok, type Result } from '../shared/result';

export class DeliveryMissionRefused extends DomainError {
  constructor(readonly code: string, message: string) { super(message); }
}

/** État connu de la commande ; ne prétend pas consulter Stripe en temps réel. */
export interface DeliveryMissionState {
  readonly type: string;
  readonly orderStatus: string;
  readonly hasAddress: boolean;
  readonly operatorId: string | null;
  readonly dispatched: boolean;
  readonly paymentStatus: string;
  readonly refundedCents: number;
  readonly pendingRefundCents: number;
  readonly paymentPhase: string | null;
}

export function deliveryPaymentReady(state: DeliveryMissionState): boolean {
  return state.paymentStatus === 'paid'
    && state.refundedCents === 0 && state.pendingRefundCents === 0
    && (state.paymentPhase === null || state.paymentPhase === 'settled');
}

function activeDelivery(state: DeliveryMissionState): Result<void, DeliveryMissionRefused> {
  if (state.type !== 'delivery' || !state.hasAddress) {
    return err(new DeliveryMissionRefused('delivery.mission.invalid', 'Cette commande ne peut pas devenir une mission de livraison.'));
  }
  if (!['new', 'preparing', 'ready'].includes(state.orderStatus)) {
    return err(new DeliveryMissionRefused('delivery.mission.closed', 'Cette commande est terminée ou annulée. Actualisez les missions.'));
  }
  return ok(undefined);
}

/** Affecter ne prépare pas, n'encaisse pas et ne fait pas partir la commande. */
export function canAssignDeliveryMission(state: DeliveryMissionState): Result<void, DeliveryMissionRefused> {
  const active = activeDelivery(state);
  if (!active.ok) return active;
  if (state.dispatched) {
    return err(new DeliveryMissionRefused('delivery.mission.departed', 'La commande est déjà partie. Contactez le responsable pour organiser sa prise en charge.'));
  }
  return ok(undefined);
}

export function canDispatchDeliveryMission(state: DeliveryMissionState): Result<void, DeliveryMissionRefused> {
  const active = activeDelivery(state);
  if (!active.ok) return active;
  if (!state.operatorId) {
    return err(new DeliveryMissionRefused('delivery.mission.unassigned', 'Affectez un livreur avant de confirmer le départ.'));
  }
  if (state.dispatched) {
    return err(new DeliveryMissionRefused('delivery.mission.departed', 'Le départ est déjà confirmé. Actualisez la mission.'));
  }
  if (state.orderStatus !== 'ready') {
    return err(new DeliveryMissionRefused('delivery.mission.not_ready', 'La cuisine doit marquer la commande prête avant le départ.'));
  }
  if (!deliveryPaymentReady(state)) {
    return err(new DeliveryMissionRefused('delivery.mission.payment_blocked', 'Le paiement est en attente ou doit être vérifié par le restaurant. Ne partez pas avec cette commande.'));
  }
  return ok(undefined);
}
