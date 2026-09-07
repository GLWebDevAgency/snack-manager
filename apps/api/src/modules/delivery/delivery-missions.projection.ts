import { DeliveryMissionViewSchema, type DeliveryMissionView, type DeliveryMissionRefusalCode } from '@sm/contracts';
import { ordering } from '@sm/domain';
import type { Types } from 'mongoose';

export interface MissionOperation {
  operationId: string; fingerprint: string; action: 'assign' | 'unassign' | 'dispatch';
  outcome: 'applied' | 'rejected'; refusalCode: DeliveryMissionRefusalCode | null; reason: string | null;
  revision: number; at: Date; actorKind: 'user' | 'staff' | 'delivery'; actorId: string;
  actorRole: string | null; actorName: string | null;
  previousOperatorId: Types.ObjectId | null; operatorId: Types.ObjectId | null;
}
export interface MissionAssignment {
  operatorId: Types.ObjectId; assignmentId: string; operatorName: string;
  assignedAt: Date; assignedBy: string;
}
export interface MissionRecord {
  version: 1; revision: number; assignment: MissionAssignment | null; operations: MissionOperation[];
}
export interface MissionOrder {
  _id: Types.ObjectId; tenantId: Types.ObjectId; __v?: number; number: number; createdAt: Date;
  type: string; status: string;
  pickup?: { slot?: Date; customerName?: string; customerPhone?: string | null } | null;
  delivery?: { address?: { line1: string; line2?: string; postalCode: string; city: string; country?: string };
    instructions?: string | null; dispatchedAt?: Date | null; deliveredAt?: Date | null } | null;
  lines: { name: string; variantName?: string | null; qty: number }[];
  payment: { status: string; refundedCents?: number; pendingRefundCents?: number };
  paymentFlow?: { phase?: string } | null;
  deliveryMission?: MissionRecord | null;
}

/** Projection positive : aucun prix, token, PI, note libre cuisine ou meta. */
export const MISSION_PROJECTION = {
  _id: 1, tenantId: 1, __v: 1, number: 1, createdAt: 1, type: 1, status: 1,
  pickup: 1, 'delivery.address': 1, 'delivery.instructions': 1, 'delivery.dispatchedAt': 1,
  'delivery.deliveredAt': 1, 'lines.name': 1, 'lines.variantName': 1, 'lines.qty': 1,
  'payment.status': 1, 'payment.refundedCents': 1, 'payment.pendingRefundCents': 1,
  'paymentFlow.phase': 1, deliveryMission: 1,
} as const;

export function missionState(row: MissionOrder): ordering.DeliveryMissionState {
  return {
    type: row.type, orderStatus: row.status, hasAddress: !!row.delivery?.address,
    operatorId: row.deliveryMission?.assignment ? String(row.deliveryMission.assignment.operatorId) : null,
    dispatched: !!row.delivery?.dispatchedAt, paymentStatus: row.payment.status,
    refundedCents: row.payment.refundedCents ?? 0, pendingRefundCents: row.payment.pendingRefundCents ?? 0,
    paymentPhase: row.paymentFlow?.phase ?? null,
  };
}

export function missionView(row: MissionOrder, canAssign: boolean, operatorAvailable: boolean): DeliveryMissionView {
  const state = missionState(row);
  const assignment = row.deliveryMission?.assignment;
  return DeliveryMissionViewSchema.parse({
    id: String(row._id), number: row.number, createdAt: new Date(row.createdAt).toISOString(),
    scheduledAt: row.pickup?.slot ? new Date(row.pickup.slot).toISOString() : null,
    orderStatus: row.status, revision: row.deliveryMission?.revision ?? 0,
    operator: assignment ? { id: String(assignment.operatorId), name: assignment.operatorName } : null,
    assignmentId: assignment?.assignmentId ?? null,
    assignedAt: assignment ? new Date(assignment.assignedAt).toISOString() : null,
    dispatchedAt: row.delivery?.dispatchedAt ? new Date(row.delivery.dispatchedAt).toISOString() : null,
    paymentReady: ordering.deliveryPaymentReady(state),
    canAssign: canAssign && ordering.canAssignDeliveryMission(state).ok,
    canDispatch: operatorAvailable && ordering.canDispatchDeliveryMission(state).ok,
    customer: { name: row.pickup?.customerName ?? '', phone: row.pickup?.customerPhone ?? null },
    address: row.delivery?.address,
    instructions: row.delivery?.instructions ?? null,
    items: row.lines.map(line => ({ name: line.name, variantName: line.variantName ?? null, qty: line.qty })),
  });
}
