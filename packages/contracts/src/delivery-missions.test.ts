import { describe, expect, it } from 'vitest';
import { DeliveryMissionAssignSchema, DeliveryMissionDispatchSchema, DeliveryMissionResultSchema,
  DeliveryMissionViewSchema, DeliveryMissionsQuerySchema, DeliveryMissionsViewSchema } from './delivery-missions';

const id = '665f0d0a1c2b3d4e5f6a7b01';
const operationId = 'b0b336b8-d64b-4a0e-b3d3-e30aa158ba8d';
const dispatch = { operationId, expectedRevision: 0 };
const view = {
  id, number: 12, createdAt: '2026-09-07T12:00:00.000Z', scheduledAt: null, orderStatus: 'ready', revision: 1,
  operator: { id, name: 'Nora' }, assignmentId: operationId, assignedAt: '2026-09-07T12:00:00.000Z', dispatchedAt: null,
  paymentReady: true, canAssign: true, canDispatch: true, customer: { name: 'Recette', phone: null },
  address: { line1: '1 rue de la Recette', postalCode: '75001', city: 'Paris', country: 'FR' },
  instructions: null, items: [{ name: 'Kebab', variantName: null, qty: 1 }],
};

describe('contrats stricts des missions', () => {
  it('demande explicitement une révision même pour une première affectation', () => {
    expect(DeliveryMissionDispatchSchema.safeParse(dispatch).success).toBe(true);
    expect(DeliveryMissionDispatchSchema.safeParse({ operationId }).success).toBe(false);
    for (const expectedRevision of [-1, 0.1, Number.MAX_SAFE_INTEGER + 1, '1', null]) {
      expect(DeliveryMissionDispatchSchema.safeParse({ operationId, expectedRevision }).success).toBe(false);
    }
  });
  it('interdit un tenant, un prénom libre ou un secret dans une commande de départ', () => {
    for (const extra of ['tenantId', 'driverName', 'token', 'status']) {
      expect(DeliveryMissionDispatchSchema.safeParse({ ...dispatch, [extra]: 'untrusted' }).success).toBe(false);
    }
  });
  it('lie la sélection à la révision de l’accès et motive la désaffectation', () => {
    const assignment = { ...dispatch, operatorId: id, expectedOperatorRevision: 2, reason: 'Mission du jour' };
    expect(DeliveryMissionAssignSchema.safeParse(assignment).success).toBe(true);
    expect(DeliveryMissionAssignSchema.safeParse({ ...assignment, operatorId: null, expectedOperatorRevision: null }).success).toBe(true);
    expect(DeliveryMissionAssignSchema.safeParse({ ...assignment, expectedOperatorRevision: null }).success).toBe(false);
    expect(DeliveryMissionAssignSchema.safeParse({ ...assignment, operatorId: null }).success).toBe(false);
    for (const reason of ['', '  ', 'ab', 'a'.repeat(201)]) {
      expect(DeliveryMissionAssignSchema.safeParse({ ...assignment, reason }).success).toBe(false);
    }
  });
  it('ne rend que la projection dédiée et borne chaque page', () => {
    expect(DeliveryMissionViewSchema.safeParse(view).success).toBe(true);
    for (const secret of ['trackingToken', 'paymentIntentId', 'deliveryMission', 'tenantId', 'payment']) {
      expect(DeliveryMissionViewSchema.safeParse({ ...view, [secret]: 'private' }).success).toBe(false);
    }
    expect(DeliveryMissionsViewSchema.safeParse({ missions: Array(50).fill(view), nextCursor: null }).success).toBe(true);
    expect(DeliveryMissionsViewSchema.safeParse({ missions: Array(51).fill(view), nextCursor: null }).success).toBe(false);
    expect(DeliveryMissionsQuerySchema.safeParse({ after: id }).success).toBe(true);
    expect(DeliveryMissionsQuerySchema.safeParse({ tenantId: id }).success).toBe(false);
    expect(DeliveryMissionsQuerySchema.safeParse({ after: ['bad', id] }).success).toBe(false);
  });
  it('distingue une action appliquée d’un refus terminal acquitté', () => {
    const result = { operationId, appliedRevision: 1, replay: false, mission: view };
    expect(DeliveryMissionResultSchema.safeParse({ ...result, outcome: 'applied', refusalCode: null }).success).toBe(true);
    expect(DeliveryMissionResultSchema.safeParse({ ...result, outcome: 'rejected', refusalCode: 'delivery.mission.not_ready' }).success).toBe(true);
    expect(DeliveryMissionResultSchema.safeParse({ ...result, outcome: 'rejected', refusalCode: null }).success).toBe(false);
    expect(DeliveryMissionResultSchema.safeParse({ ...result, outcome: 'applied', refusalCode: 'delivery.mission.not_ready' }).success).toBe(false);
    expect(DeliveryMissionResultSchema.safeParse({ ...result, outcome: 'rejected', refusalCode: '<untrusted>' }).success).toBe(false);
    expect(DeliveryMissionResultSchema.safeParse(result).success).toBe(false);
  });
});
