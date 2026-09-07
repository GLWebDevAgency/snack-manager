import { DeliveryHandoffStateSchema, type DeliveryHandoffAction, type DeliveryHandoffRefusalCode, type DeliveryHandoffState } from '@sm/contracts';
import { ordering } from '@sm/domain';
import type { Types } from 'mongoose';

export interface HandoffOperation {
  operationId: string; intentFingerprint: string; fingerprint: string | null;
  action: DeliveryHandoffAction; outcome: 'applied' | 'rejected' | 'abandoned'; refusalCode: DeliveryHandoffRefusalCode | null;
  revision: number; expectedRevision: number; expectedMissionRevision: number; at: Date;
  actorKind: 'user' | 'staff' | 'delivery'; actorId: string; actorRole: string | null; actorName: string | null; reason: string | null;
}
export interface HandoffProof { id: string; sealed: string; createdAt: Date; expiresAt: Date; failedAttempts: number; assignmentId: string | null }
export interface HandoffRecord {
  version: 1; revision: number; proof: HandoffProof | null;
  incident: { code: 'customer_absent' | 'unreachable' | 'address_issue' | 'proof_unavailable' | 'customer_refused'; reportedAt: Date; actorKind: string; actorId: string } | null;
  completed: { at: Date; method: 'pin' | 'qr' | 'override'; operationId: string; actorKind: string; actorId: string } | null;
  operations: HandoffOperation[];
}
export interface HandoffOrder {
  _id: Types.ObjectId; tenantId: Types.ObjectId; __v?: number; type: string; status: string; channel: string; clientId: string;
  payment: { status: string; refundedCents?: number; pendingRefundCents?: number };
  paymentFlow?: { phase?: string } | null;
  delivery?: { address?: unknown; dispatchedAt?: Date | null; deliveredAt?: Date | null } | null;
  deliveryMission?: { version: number; revision: number; assignment: { operatorId: Types.ObjectId; assignmentId: string } | null } | null;
  publicRecovery?: { version: number; proofHash: string } | null;
  deliveryHandoff?: HandoffRecord | null;
}

/** Internal lean reads exclude names, phones, items, prices and provider IDs. */
export const HANDOFF_PROJECTION = {
  _id: 1, tenantId: 1, __v: 1, type: 1, status: 1, channel: 1, clientId: 1,
  'delivery.address': 1, 'delivery.dispatchedAt': 1, 'delivery.deliveredAt': 1,
  'payment.status': 1, 'payment.refundedCents': 1, 'payment.pendingRefundCents': 1,
  'paymentFlow.phase': 1, 'deliveryMission.version': 1, 'deliveryMission.revision': 1,
  'deliveryMission.assignment.operatorId': 1, 'deliveryMission.assignment.assignmentId': 1,
  'publicRecovery.version': 1, 'publicRecovery.proofHash': 1,
  deliveryHandoff: 1,
} as const;

export const emptyHandoff = (): HandoffRecord => ({ version: 1, revision: 0, proof: null, incident: null, completed: null, operations: [] });
export function eligibility(row: HandoffOrder) {
  // A persisted consumption remains terminal even if a legacy writer has
  // left the generic status inconsistent. Never reuse an already consumed epoch.
  if (row.deliveryHandoff?.completed || row.delivery?.deliveredAt) return 'closed' as const;
  return ordering.deliveryHandoffEligibility({ type: row.type, hasAddress: !!row.delivery?.address, orderStatus: row.status,
    dispatched: !!row.delivery?.dispatchedAt, operatorId: row.deliveryMission?.assignment ? String(row.deliveryMission.assignment.operatorId) : null,
    paymentStatus: row.payment.status, refundedCents: row.payment.refundedCents ?? 0,
    pendingRefundCents: row.payment.pendingRefundCents ?? 0, paymentPhase: row.paymentFlow?.phase ?? null });
}
export function proofAvailability(row: HandoffOrder, now = Date.now()) {
  const proof = row.deliveryHandoff?.proof;
  if (proof && proof.assignmentId !== (row.deliveryMission?.assignment?.assignmentId ?? null)) return 'proof_unavailable' as const;
  return ordering.deliveryProofAvailability(proof ? { expiresAt: new Date(proof.expiresAt).getTime(), failedAttempts: proof.failedAttempts } : null, now);
}
export function handoffView(row: HandoffOrder, manager: boolean): DeliveryHandoffState {
  const state = row.deliveryHandoff;
  const ready = !eligibility(row);
  return DeliveryHandoffStateSchema.parse({
    missionId: String(row._id), revision: state?.revision ?? 0, missionRevision: row.deliveryMission?.revision ?? 0, orderStatus: row.status,
    proof: state?.proof ? { id: state.proof.id, expiresAt: new Date(state.proof.expiresAt).toISOString(), locked: state.proof.failedAttempts >= 5 } : null,
    incident: state?.incident ? { code: state.incident.code, reportedAt: new Date(state.incident.reportedAt).toISOString() } : null,
    canHandoff: ready && !state?.incident && !proofAvailability(row),
    canOverride: manager && ready && !!state?.incident,
    canRotate: manager && ready && row.channel === 'online' && !!row.publicRecovery,
  });
}
