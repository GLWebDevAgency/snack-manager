import { describe, expect, it } from 'vitest';
import { CreateOrderSchema, CreatePublicOrderSchema } from '@sm/contracts';
import { orderAdmissionId } from '../orders/order-admission-identity';
import { planCapacityBootstrap } from './order-capacity-bootstrap';
import type { BootstrapAdmissionEvidence, BootstrapOrderEvidence, CapacityBootstrapInput } from './order-capacity-bootstrap.types';

const TENANT = '507f1f77bcf86cd799439011';
const SLOT = '2030-05-02T09:00:00.000Z';
const request = {
  clientId: '11111111-1111-4111-8111-111111111111',
  lines: [{ productId: 'produit-de-recette', qty: 1 }],
  payment: { method: 'counter' },
};
const pickup = { slot: SLOT, customerName: 'Client de recette', customerPhone: '0600000000' };

function input(overrides: Partial<BootstrapOrderEvidence>): CapacityBootstrapInput {
  return {
    tenantId: TENANT, cutoverAt: new Date('2030-05-02T16:00:00.000Z'), sourceRevision: 7,
    settings: { hours: [], closures: [], settings: { slotCapacity: 4, slotIntervalMin: 30 }, delivery: { slotCapacity: 2 } },
    orders: [{ orderId: '000000000000000000000001', tenantId: TENANT, clientId: 'ticket-historique',
      channel: 'pos', type: 'surplace', status: 'new', slot: null, publicRecovery: null, ...overrides }],
    admissions: [],
  };
}

describe('bootstrap — absence de créneau légitime ou preuve de vente incohérente', () => {
  it.each(['new', 'preparing', 'ready', 'delivered'])('une livraison %s sans créneau ne disparaît pas silencieusement de l’analyse', (status) => {
    const report = planCapacityBootstrap(input({ channel: 'online', type: 'delivery', status }));
    expect(report).toMatchObject({ mode: 'analysis_only', canActivate: false, requiresExclusiveRescan: true, status: 'blocked' });
    expect(report.issues).toContainEqual(expect.objectContaining({ code: 'invalid_order', source: 'order', index: 0 }));
    expect(report.occupants).toEqual([]);
  });

  it.each(['new', 'preparing', 'ready', 'delivered'])('un retrait public prouvé %s sans créneau est une incohérence, pas un ancien ticket staff', (status) => {
    const report = planCapacityBootstrap(input({ channel: 'online', type: 'pickup', status,
      publicRecovery: { version: 1, proofHash: 'a'.repeat(64), payloadHash: 'b'.repeat(64) } }));
    expect(report).toMatchObject({ mode: 'analysis_only', canActivate: false, requiresExclusiveRescan: true, status: 'blocked' });
    expect(report.issues).toContainEqual(expect.objectContaining({ code: 'invalid_order', source: 'order', index: 0 }));
    expect(report.occupants).toEqual([]);
  });

  it.each(['surplace', 'emporter'])('une vente POS %s sans créneau reste légitimement hors capacité réservée', (type) => {
    const report = planCapacityBootstrap(input({ type }));
    expect(report).toMatchObject({ status: 'reviewed', canActivate: false, occupants: [], issues: [] });
  });

  it('le contrat de livraison exige un créneau, indépendamment de la projection analysée', () => {
    const delivery = { address: { line1: '12 rue des Tests', postalCode: '75001', city: 'Paris', country: 'FR' } };
    const complete = { ...request, channel: 'online', type: 'delivery', payment: { method: 'online' }, delivery, pickup };
    expect(CreateOrderSchema.safeParse(complete).success).toBe(true);
    const missing = CreateOrderSchema.safeParse({ ...complete, pickup: undefined });
    expect(missing.success).toBe(false);
    if (!missing.success) expect(missing.error.issues).toContainEqual(expect.objectContaining({ path: ['pickup'] }));
  });

  it('le parcours public de retrait exige pickup, même sans preuve de reprise C01', () => {
    const complete = { ...request, pickup, turnstileToken: 'jeton-de-recette' };
    expect(CreatePublicOrderSchema.safeParse(complete).success).toBe(true);
    const missing = CreatePublicOrderSchema.safeParse({ ...complete, pickup: undefined });
    expect(missing.success).toBe(false);
    if (!missing.success) expect(missing.error.issues).toContainEqual(expect.objectContaining({ path: ['pickup'] }));
  });

  it('le canal online seul ne prouve pas historiquement une origine publique : le contrat staff permet encore un retrait sans créneau', () => {
    expect(CreateOrderSchema.safeParse({ ...request, channel: 'online', type: 'pickup' }).success).toBe(true);
    expect(planCapacityBootstrap(input({ channel: 'online', type: 'pickup' })))
      .toMatchObject({ status: 'reviewed', canActivate: false, occupants: [], issues: [] });
  });
});

describe('bootstrap — identité globale des snapshots engagés', () => {
  function candidates(sharedOrderId: boolean): CapacityBootstrapInput {
    const admissions: BootstrapAdmissionEvidence[] = ['candidat-a', 'candidat-b'].map((clientId, index) => {
      const publicRecovery = { version: 1, proofHash: (index ? 'c' : 'a').repeat(64), payloadHash: (index ? 'd' : 'b').repeat(64) };
      const snapshot: BootstrapOrderEvidence = {
        orderId: (sharedOrderId ? 1 : index + 1).toString(16).padStart(24, '0'),
        tenantId: TENANT, clientId, channel: 'online', type: 'pickup', status: 'new', slot: new Date(SLOT), publicRecovery,
      };
      return { ...publicRecovery, admissionId: orderAdmissionId(TENANT, clientId), tenantId: TENANT, clientId,
        kind: 'public', channel: 'online', state: 'committing', orderId: snapshot.orderId, slot: new Date(SLOT), snapshot };
    });
    return { ...input({}), orders: [], admissions,
      settings: { hours: [{ day: 4, lunch: { open: '11:00', close: '12:00' }, dinner: null }], closures: [],
        settings: { slotCapacity: 4, slotIntervalMin: 30 }, delivery: { slotCapacity: 2 } } };
  }

  it('signale deux clients revendiquant le même orderId sans choisir un snapshot gagnant', () => {
    const report = planCapacityBootstrap(candidates(true));
    expect(report).toMatchObject({ status: 'blocked', canActivate: false, requiresExclusiveRescan: true });
    expect(report.issues).toContainEqual(expect.objectContaining({ code: 'admission_identity_mismatch', source: 'admission' }));
    expect(report.occupants).toHaveLength(2);
    expect(new Set(report.occupants.map((occupant) => occupant.orderId)).size).toBe(1);
    expect(new Set(report.occupants.map((occupant) => occupant.admissionId)).size).toBe(2);
    expect(report.days.flatMap((day) => day.slots).find((slot) => slot.at === SLOT)?.kitchenUsed).toBe(2);
  });

  it('deux orderId distincts restent seulement à matérialiser, sans faux conflit d’identité', () => {
    const report = planCapacityBootstrap(candidates(false));
    expect(report).toMatchObject({ status: 'blocked', canActivate: false, requiresExclusiveRescan: true });
    expect(report.issues.map((issue) => issue.code)).toEqual(['materialization_required', 'materialization_required']);
    expect(report.occupants).toHaveLength(2);
    expect(new Set(report.occupants.map((occupant) => occupant.orderId)).size).toBe(2);
    expect(report.days.flatMap((day) => day.slots).find((slot) => slot.at === SLOT)?.kitchenUsed).toBe(2);
  });
});
