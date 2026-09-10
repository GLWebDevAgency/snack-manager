import type { DeliveryMissionResult, DeliveryMissionsView, DeliveryMissionView } from './delivery-missions';
import type { DeliverySessionView } from './delivery-operators';

/** Opt-in all the way from the browser: already-open v1 clients parse strict views. */
export const DELIVERY_VIEW_VERSION_HEADER = 'X-SM-Delivery-View';
export const DELIVERY_VIEW_VERSION = '2';

/** Explicit v1 projections keep a rolling API/BFF/browser deployment compatible. */
export function deliverySessionForVersion(view: DeliverySessionView, version: unknown): DeliverySessionView {
  if (version === DELIVERY_VIEW_VERSION) return view;
  return {
    operatorId: view.operatorId, name: view.name, restaurantName: view.restaurantName,
    restaurantSlug: view.restaurantSlug, expiresAt: view.expiresAt,
  };
}

export function deliveryMissionForVersion(view: DeliveryMissionView, version: unknown): DeliveryMissionView {
  if (version === DELIVERY_VIEW_VERSION) return view;
  return {
    id: view.id, number: view.number, createdAt: view.createdAt, scheduledAt: view.scheduledAt,
    orderStatus: view.orderStatus, revision: view.revision, operator: view.operator,
    assignmentId: view.assignmentId, assignedAt: view.assignedAt, dispatchedAt: view.dispatchedAt,
    paymentReady: view.paymentReady, canAssign: view.canAssign, canDispatch: view.canDispatch,
    customer: view.customer, address: view.address, instructions: view.instructions, items: view.items,
  };
}

export function deliveryMissionsForVersion(view: DeliveryMissionsView, version: unknown): DeliveryMissionsView {
  if (version === DELIVERY_VIEW_VERSION) return view;
  return { missions: view.missions.map(mission => deliveryMissionForVersion(mission, version)), nextCursor: view.nextCursor };
}

export function deliveryMissionResultForVersion(view: DeliveryMissionResult, version: unknown): DeliveryMissionResult {
  if (version === DELIVERY_VIEW_VERSION) return view;
  return { ...view, mission: deliveryMissionForVersion(view.mission, version) };
}
