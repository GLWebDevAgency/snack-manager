import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { DeliveryAddressSchema } from './delivery';
import { DIRECTIONS } from './marque';
import { DeliverySessionViewSchema, type DeliverySessionView } from './delivery-operators';
import {
  DeliveryMissionResultSchema, DeliveryMissionsViewSchema, DeliveryMissionViewSchema,
  type DeliveryMissionResult, type DeliveryMissionView,
} from './delivery-missions';
import {
  DELIVERY_VIEW_VERSION, deliverySessionForVersion, deliveryMissionForVersion,
  deliveryMissionsForVersion, deliveryMissionResultForVersion,
} from './delivery-view-version';

// Frozen wire schemas from 6109c3c: do not derive the allowed keys from the current views.
const id = z.string().regex(/^[a-f0-9]{24}$/);
const revision = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const at = z.iso.datetime();
const legacySession = z.object({
  operatorId: id, name: z.string().min(1).max(160), restaurantName: z.string().min(1).max(160),
  restaurantSlug: z.string().min(1).max(100), expiresAt: at,
}).strict();
const legacyMission = z.object({
  id, number: z.number().int().positive(), createdAt: at, scheduledAt: at.nullable(),
  orderStatus: z.enum(['new', 'preparing', 'ready', 'delivered', 'cancelled']), revision,
  operator: z.object({ id, name: z.string().min(1).max(160) }).strict().nullable(),
  assignmentId: z.uuid().nullable(), assignedAt: at.nullable(), dispatchedAt: at.nullable(),
  paymentReady: z.boolean(), canAssign: z.boolean(), canDispatch: z.boolean(),
  customer: z.object({ name: z.string().max(160), phone: z.string().max(40).nullable() }).strict(),
  address: DeliveryAddressSchema, instructions: z.string().max(300).nullable(),
  items: z.array(z.object({ name: z.string().max(200), variantName: z.string().max(200).nullable(), qty: z.number().int().positive() }).strict()).max(200),
}).strict();
const legacyPage = z.object({ missions: z.array(legacyMission).max(50), nextCursor: id.nullable() }).strict();
const legacyResultBase = z.object({ operationId: z.uuid(), appliedRevision: revision, replay: z.boolean(), mission: legacyMission }).strict();
const legacyResult = z.discriminatedUnion('outcome', [
  legacyResultBase.extend({ outcome: z.literal('applied'), refusalCode: z.null() }).strict(),
  legacyResultBase.extend({ outcome: z.literal('rejected'), refusalCode: z.literal('delivery.mission.not_ready') }).strict(),
]);

const oid = '665f0d0a1c2b3d4e5f6a7b01';
const operationId = 'b0b336b8-d64b-4a0e-b3d3-e30aa158ba8d';
const timestamp = '2026-09-10T12:00:00.000Z';
const session: DeliverySessionView = {
  operatorId: oid, name: 'Nora', restaurantName: 'Restaurant', restaurantSlug: 'restaurant',
  expiresAt: timestamp, brand: DIRECTIONS.nuit, restaurantAddress: '1 rue de la Recette', restaurantPhones: ['0102030405'],
};
const mission: DeliveryMissionView = {
  id: oid, number: 12, createdAt: timestamp, scheduledAt: null, orderStatus: 'ready', revision: 1,
  operator: { id: oid, name: 'Nora' }, assignmentId: operationId, assignedAt: timestamp, dispatchedAt: null,
  deliveredAt: null, paymentSummary: { totalCents: 1490, method: 'online', status: 'paid', tender: 'online' },
  paymentReady: true, canAssign: true, canDispatch: true, customer: { name: 'Recette', phone: null },
  address: { line1: '1 rue de la Recette', postalCode: '75001', city: 'Paris', country: 'FR' },
  instructions: null, items: [{ name: 'Kebab', variantName: null, qty: 1 }],
};
const page = { missions: [mission], nextCursor: oid };
const results: DeliveryMissionResult[] = [
  { operationId, appliedRevision: 1, replay: false, mission, outcome: 'applied', refusalCode: null },
  { operationId, appliedRevision: 1, replay: true, mission, outcome: 'rejected', refusalCode: 'delivery.mission.not_ready' },
];

describe('delivery view rolling-deployment compatibility', () => {
  it('demonstrates why the old strict clients cannot receive enriched responses', () => {
    expect(legacySession.safeParse(session).success).toBe(false);
    expect(legacyMission.safeParse(mission).success).toBe(false);
    expect(legacyPage.safeParse(page).success).toBe(false);
    for (const result of results) expect(legacyResult.safeParse(result).success).toBe(false);
  });

  it.each([undefined, null, '', '1', '3', ' 2 ', '2, 2', 2, ['2']])('keeps old clients operational without an exact opt-in (%j)', version => {
    expect(legacySession.safeParse(deliverySessionForVersion(session, version)).success).toBe(true);
    expect(legacyMission.safeParse(deliveryMissionForVersion(mission, version)).success).toBe(true);
    const projectedPage = deliveryMissionsForVersion(page, version);
    expect(legacyPage.safeParse(projectedPage).success).toBe(true);
    expect(projectedPage.nextCursor).toBe(oid);
    for (const result of results) {
      const projected = deliveryMissionResultForVersion(result, version);
      expect(legacyResult.safeParse(projected).success).toBe(true);
      expect({ ...projected, mission: result.mission }).toEqual(result);
    }
  });

  it('preserves modern fields only for an explicit version 2 request', () => {
    expect(deliverySessionForVersion(session, DELIVERY_VIEW_VERSION)).toEqual(session);
    expect(deliveryMissionForVersion(mission, DELIVERY_VIEW_VERSION)).toEqual(mission);
    expect(deliveryMissionsForVersion(page, DELIVERY_VIEW_VERSION)).toEqual(page);
    for (const result of results) expect(deliveryMissionResultForVersion(result, DELIVERY_VIEW_VERSION)).toEqual(result);
  });

  it('allows a new browser to use an old API/BFF during deployment or rollback', () => {
    expect(DeliverySessionViewSchema.safeParse(deliverySessionForVersion(session, undefined)).success).toBe(true);
    expect(DeliveryMissionViewSchema.safeParse(deliveryMissionForVersion(mission, undefined)).success).toBe(true);
    expect(DeliveryMissionsViewSchema.safeParse(deliveryMissionsForVersion(page, undefined)).success).toBe(true);
    for (const result of results) expect(DeliveryMissionResultSchema.safeParse(deliveryMissionResultForVersion(result, undefined)).success).toBe(true);
  });

  it('does not erase modern data while serving concurrent legacy requests', () => {
    const original = structuredClone({ session, page, results });
    deliverySessionForVersion(session, undefined);
    deliveryMissionsForVersion(page, undefined);
    for (const result of results) deliveryMissionResultForVersion(result, undefined);
    expect({ session, page, results }).toEqual(original);
  });
});
