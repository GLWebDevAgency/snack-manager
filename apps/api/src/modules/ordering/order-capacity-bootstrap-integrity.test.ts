import { describe, expect, it } from 'vitest';
import { orderAdmissionId } from '../orders/order-admission-identity';
import { planCapacityBootstrap } from './order-capacity-bootstrap';
import type {
  BootstrapAdmissionEvidence,
  BootstrapOrderEvidence,
  CapacityBootstrapInput,
} from './order-capacity-bootstrap.types';

const TENANT = '507f1f77bcf86cd799439011';
const ORDER = '507f1f77bcf86cd799439012';
const CLIENT = 'integrity:historical-client-key';
const PAST = new Date('2030-05-01T09:00:00.000Z');
const FUTURE = new Date('2030-05-02T09:00:00.000Z');
const RECOVERY = { version: 1, proofHash: 'a'.repeat(64), payloadHash: 'b'.repeat(64) };

function order(overrides: Partial<BootstrapOrderEvidence> = {}): BootstrapOrderEvidence {
  return {
    orderId: ORDER, tenantId: TENANT, clientId: CLIENT,
    channel: 'online', type: 'pickup', status: 'new', slot: FUTURE,
    publicRecovery: RECOVERY, ...overrides,
  };
}

function admission(overrides: Partial<BootstrapAdmissionEvidence> = {}): BootstrapAdmissionEvidence {
  return {
    admissionId: orderAdmissionId(TENANT, CLIENT), tenantId: TENANT, clientId: CLIENT,
    ...RECOVERY, kind: 'public', channel: 'online', state: 'created', slot: PAST,
    orderId: ORDER, snapshot: null, capacity: null, ...overrides,
  };
}

function input(overrides: Partial<CapacityBootstrapInput> = {}): CapacityBootstrapInput {
  return {
    tenantId: TENANT, cutoverAt: new Date('2030-05-02T16:00:00.000Z'), sourceRevision: 0,
    settings: {
      hours: Array.from({ length: 7 }, (_, index) => ({ day: index + 1, lunch: { open: '11:00', close: '12:00' }, dinner: null })),
      settings: { slotIntervalMin: 30, slotCapacity: 4 }, delivery: { slotCapacity: 2 },
    },
    orders: [], admissions: [], ...overrides,
  };
}

describe('planCapacityBootstrap — intégrité des références entre ancien et futur', () => {
  it('ne masque pas un snapshot engagé futur derrière le créneau ancien de son admission', () => {
    const evidence = admission({ state: 'committing', snapshot: order() });

    const result = planCapacityBootstrap(input({ admissions: [evidence] }));

    expect(result.status).toBe('blocked');
    expect(result.issues).toContainEqual(expect.objectContaining({
      code: 'admission_identity_mismatch', source: 'admission', admissionId: evidence.admissionId,
    }));
    expect(result.canActivate).toBe(false);
  });

  it('ne masque pas une place future derrière une admission et une commande anciennes', () => {
    const evidence = admission({ capacity: { slot: FUTURE, kitchenSeat: 0 } });

    const result = planCapacityBootstrap(input({
      orders: [order({ slot: PAST })], admissions: [evidence],
    }));

    expect(result.status).toBe('blocked');
    expect(result.issues).toContainEqual(expect.objectContaining({
      code: 'invalid_capacity_claim', source: 'admission', admissionId: evidence.admissionId,
    }));
    expect(result.canActivate).toBe(false);
  });

  it('signale aussi une réservation future contradictoire sur une admission ancienne rejetée', () => {
    const evidence = admission({
      state: 'rejected', orderId: null, capacity: { slot: FUTURE, kitchenSeat: 0 },
    });

    const result = planCapacityBootstrap(input({ admissions: [evidence] }));

    expect(result.status).toBe('blocked');
    expect(result.issues).toContainEqual(expect.objectContaining({
      code: 'terminal_admission_conflict', source: 'admission', admissionId: evidence.admissionId,
    }));
  });

  it('conserve hors occupation future une commande et sa preuve entièrement anciennes et cohérentes', () => {
    const result = planCapacityBootstrap(input({
      orders: [order({ slot: PAST })],
      admissions: [admission({ capacity: { slot: PAST, kitchenSeat: 0 } })],
    }));

    expect(result.status).toBe('reviewed');
    expect(result.issues).toEqual([]);
    expect(result.occupants).toEqual([]);
    expect(result.canActivate).toBe(false);
    expect(result.requiresExclusiveRescan).toBe(true);
  });

  it('signale une commande publique protégée sans admission mais conserve son occupation réelle', () => {
    const result = planCapacityBootstrap(input({ orders: [order()] }));

    expect(result.status).toBe('blocked');
    expect(result.issues).toContainEqual(expect.objectContaining({
      code: 'missing_admission', source: 'order', orderId: ORDER,
    }));
    expect(result.occupants).toEqual([{
      orderId: ORDER, admissionId: null, channel: 'online', type: 'pickup',
      slot: FUTURE.toISOString(), source: 'order',
    }]);
    expect(result.days.flatMap((day) => day.slots).find((slot) => slot.at === FUTURE.toISOString()))
      .toMatchObject({ kitchenUsed: 1, deliveryUsed: 0 });
  });

  it('conserve la compatibilité d’une commande historique future sans aucune preuve publique', () => {
    const result = planCapacityBootstrap(input({ orders: [order({ publicRecovery: null })] }));

    expect(result.status).toBe('reviewed');
    expect(result.issues).toEqual([]);
    expect(result.occupants).toHaveLength(1);
  });

  it('signale le snapshot résiduel d’une admission created sans recompter ni réinitialiser l’Order', () => {
    const persisted = order({ status: 'delivered' });
    const evidence = admission({ slot: FUTURE, snapshot: order() });

    const result = planCapacityBootstrap(input({ orders: [persisted], admissions: [evidence] }));

    expect(result.status).toBe('blocked');
    expect(result.issues).toContainEqual(expect.objectContaining({
      code: 'terminal_admission_conflict', source: 'admission', admissionId: evidence.admissionId,
    }));
    expect(result.occupants).toEqual([{
      orderId: ORDER, admissionId: evidence.admissionId, channel: 'online', type: 'pickup',
      slot: FUTURE.toISOString(), source: 'order',
    }]);
    expect(result.days.flatMap((day) => day.slots).find((slot) => slot.at === FUTURE.toISOString()))
      .toMatchObject({ kitchenUsed: 1, deliveryUsed: 0 });
    expect(persisted.status).toBe('delivered');
    expect(evidence.snapshot?.status).toBe('new');
  });

  it.each([null, undefined])('accepte le snapshot acquitté %s d’une admission created', (snapshot) => {
    const result = planCapacityBootstrap(input({
      orders: [order()], admissions: [admission({ slot: FUTURE, snapshot })],
    }));

    expect(result.status).toBe('reviewed');
    expect(result.issues).toEqual([]);
    expect(result.occupants).toHaveLength(1);
    expect(result.occupants[0]?.source).toBe('order');
    expect(result.canActivate).toBe(false);
  });

  it.each([
    ['date ISO non normalisée', FUTURE.toISOString()],
    ['date invalide', new Date(NaN)],
    ['date absente', undefined],
    ['date null', null],
  ])('ne masque pas un snapshot avec %s derrière une ancienne admission', (_name, corruptSlot) => {
    // Simulation explicite d’une projection persistée corrompue à la frontière
    // d’entrée ; les fixtures ordinaires restent entièrement typées.
    const snapshot = { ...order(), slot: corruptSlot } as unknown as BootstrapOrderEvidence;
    const evidence = admission({ state: 'committing', snapshot });

    const result = planCapacityBootstrap(input({ admissions: [evidence] }));

    expect(result.status).toBe('blocked');
    expect(result.issues.some((issue) => issue.source === 'admission'
      && issue.admissionId === evidence.admissionId)).toBe(true);
    expect(result.canActivate).toBe(false);
  });

  it.each([
    ['date ISO non normalisée', FUTURE.toISOString()],
    ['date invalide', new Date(NaN)],
    ['date absente', undefined],
    ['date null', null],
  ])('ne masque pas une réservation avec %s derrière une ancienne admission', (_name, corruptSlot) => {
    const capacity = { slot: corruptSlot, kitchenSeat: 0 } as unknown as NonNullable<BootstrapAdmissionEvidence['capacity']>;
    const evidence = admission({ capacity });

    const result = planCapacityBootstrap(input({
      orders: [order({ slot: PAST })], admissions: [evidence],
    }));

    expect(result.status).toBe('blocked');
    expect(result.issues).toContainEqual(expect.objectContaining({
      code: 'invalid_capacity_claim', source: 'admission', admissionId: evidence.admissionId,
    }));
    expect(result.canActivate).toBe(false);
  });
});
