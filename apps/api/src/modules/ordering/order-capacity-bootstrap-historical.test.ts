import { describe, expect, it } from 'vitest';
import { orderAdmissionId, internalOrderAdmissionBinding } from '../orders/order-admission-identity';
import { planCapacityBootstrap } from './order-capacity-bootstrap';
import type { BootstrapAdmissionEvidence, BootstrapOrderEvidence, CapacityBootstrapInput } from './order-capacity-bootstrap.types';

const TENANT = '507f1f77bcf86cd799439011';
const SLOT = new Date('2030-05-02T09:00:00.000Z');
const DAY = '2030-05-02';
const PROVENANCE = { version: 1, bootstrapId: '11111111-1111-4111-8111-111111111111', importedAt: new Date('2030-05-02T08:00:00.000Z') };
const PROOF = { version: 1, proofHash: 'a'.repeat(64), payloadHash: 'b'.repeat(64) };
function order(patch: Partial<BootstrapOrderEvidence> = {}): BootstrapOrderEvidence {
  return { orderId: '000000000000000000000001', tenantId: TENANT, clientId: 'pre-import:legacy-key',
    channel: 'phone', type: 'pickup', status: 'new', slot: SLOT, ...patch };
}
function historical(row = order(), patch: Partial<BootstrapAdmissionEvidence> = {}): BootstrapAdmissionEvidence {
  return { admissionId: orderAdmissionId(TENANT, row.clientId), tenantId: TENANT, clientId: row.clientId,
    version: 1, kind: 'historical', channel: row.channel, state: 'created', orderId: row.orderId, slot: row.slot!,
    historicalImport: PROVENANCE, capacity: { slot: row.slot!, kitchenSeat: 0, ...(row.type === 'delivery' ? { deliverySeat: 0 } : {}) }, ...patch };
}
function input(row: BootstrapOrderEvidence, claim: BootstrapAdmissionEvidence): CapacityBootstrapInput {
  return { tenantId: TENANT, cutoverAt: new Date('2030-05-02T08:00:00.000Z'), sourceRevision: 3,
    settings: { hours: [{ day: 4, lunch: { open: '11:00', close: '12:00' } }], settings: { slotIntervalMin: 30, slotCapacity: 2 } },
    orders: [row], admissions: [claim], frozenDays: [{ tenantId: TENANT, day: DAY, state: 'ready', sourceRevision: 3,
      closedReason: null, slots: [{ at: SLOT, kitchenCapacity: 2, deliveryCapacity: 1 }] }] };
}
function checked(row = order(), claim = historical(row)) {
  const result = planCapacityBootstrap(input(row, claim));
  expect(result).toMatchObject({ canActivate: false, requiresExclusiveRescan: true, mode: 'analysis_only' });
  expect(JSON.stringify(result)).not.toMatch(/proofHash|payloadHash|historicalImport|validationOwner|pre-import:legacy-key/);
  return result;
}
function blocked(row: BootstrapOrderEvidence, claim: BootstrapAdmissionEvidence, code: string) {
  const result = checked(row, claim);
  expect(result.status).toBe('blocked');
  expect(result.issues).toEqual(expect.arrayContaining([expect.objectContaining({ code })]));
  return result;
}

describe('analyse historique importée : provenance sans adoption de preuve publique', () => {
  it.each(['online', 'phone', 'pos'].flatMap((channel) => ['pickup', 'delivery', 'surplace', 'emporter'].map((type) => ({ channel, type }))))(
    'reconnaît une occupation unique $channel/$type déjà importée', ({ channel, type }) => {
      const row = order({ channel, type });
      const report = checked(row);
      expect(report.issues).toEqual([]);
      expect(report.occupants).toEqual([{ orderId: row.orderId, admissionId: historical(row).admissionId,
        channel, type, slot: SLOT.toISOString(), source: 'order' }]);
      expect(report.days[0]?.slots[0]).toMatchObject({ kitchenUsed: 1, deliveryUsed: type === 'delivery' ? 1 : 0 });
    });

  it.each(['preparing', 'ready', 'delivered'])('ne libère pas les sièges historiques pour le statut %s', (status) => {
    const result = checked(order({ status }));
    expect(result.issues).toEqual([]);
    expect(result.days[0]?.slots[0]?.kitchenUsed).toBe(1);
  });

  it.each([
    ['snapshot null', { snapshot: null }], ['snapshot résiduel', { snapshot: order() }],
    ['validationOwner null', { validationOwner: null }], ['validationOwner présent', { validationOwner: 'private-owner' }],
    ['rejection null', { rejection: null }], ['rejection présente', { rejection: 'unavailable' }],
    ['proofHash synthétique', { proofHash: PROOF.proofHash }], ['payloadHash synthétique', { payloadHash: PROOF.payloadHash }],
    ['capacité absente', { capacity: undefined }], ['capacité null', { capacity: null }],
    ['provenance absente', { historicalImport: undefined }], ['version non supportée', { version: 2 }],
    ['phase non terminale', { state: 'committing' }], ['phase rejetée', { state: 'rejected' }],
  ])('refuse une identité historique falsifiée : %s', (_name, patch) => {
    const row = order();
    blocked(row, historical(row, patch as Partial<BootstrapAdmissionEvidence>), 'invalid_admission');
  });

  it.each([
    { version: 2 }, { bootstrapId: 'not-a-uuid' }, { bootstrapId: '11111111-1111-1111-8111-111111111111' },
    { importedAt: null }, { importedAt: new Date(NaN) }, { importedAt: '2030-05-02T08:00:00.000Z' },
  ])('refuse une provenance malformée %j sans la normaliser', (patch) => {
    const row = order();
    blocked(row, historical(row, { historicalImport: { ...PROVENANCE, ...patch } as never }), 'invalid_admission');
  });

  it.each(['public', 'legacy', 'staff'])('ne tolère pas une provenance historical sur une admission %s', (kind) => {
    const row = order({ channel: kind === 'staff' ? 'phone' : 'online', ...(kind === 'public' ? { publicRecovery: PROOF } : {}) });
    blocked(row, historical(row, { kind, proofHash: PROOF.proofHash, payloadHash: PROOF.payloadHash,
      snapshot: null, validationOwner: null, rejection: null }), 'invalid_admission');
  });

  it.each([
    { kitchenSeat: undefined }, { kitchenSeat: -1 }, { kitchenSeat: 0.5 }, { kitchenSeat: 100 },
    { releasedAt: new Date(NaN), kitchenSeat: undefined }, { releasedAt: null, kitchenSeat: undefined },
    { releasedAt: new Date(), kitchenSeat: 0 }, { deliverySeat: 50 },
  ])('refuse une capacité historique structurellement corrompue même ancienne : %j', (patch) => {
    const at = new Date('2029-05-02T09:00:00.000Z');
    const row = order({ slot: at });
    blocked(row, historical(row, { capacity: { slot: at, kitchenSeat: 0, ...patch } as never }), 'invalid_admission');
  });

  it('refuse le rattachement d’un historique à une Order possédant une preuve client', () => {
    const row = order({ channel: 'online', publicRecovery: PROOF });
    blocked(row, historical(row), 'recovery_binding_mismatch');
  });

  it.each([
    { orderId: '000000000000000000000002' }, { channel: 'pos' }, { slot: new Date('2030-05-02T09:30:00.000Z') },
  ])('refuse le lien historique vers une autre identité réelle %j', (patch) => {
    const row = order();
    blocked(row, historical(row, { ...patch, ...(patch.slot ? { capacity: { slot: patch.slot, kitchenSeat: 0 } } : {}) }), 'admission_identity_mismatch');
  });

  it('ne considère pas created comme preuve que l’Order existe', () => {
    const row = order();
    const report = planCapacityBootstrap({ ...input(row, historical(row)), orders: [] });
    expect(report.status).toBe('blocked');
    expect(report.issues).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'missing_order' })]));
  });

  it('accepte la libération durable seulement pour une Order annulée', () => {
    const row = order({ status: 'cancelled' });
    const claim = historical(row, { capacity: { slot: SLOT, releasedAt: new Date() } });
    expect(checked(row, claim)).toMatchObject({ issues: [], occupants: [] });
    blocked(order(), claim, 'invalid_capacity_claim');
  });

  it('signale l’annulation encore non libérée sans compter une fausse vente active', () => {
    const row = order({ status: 'cancelled' });
    const result = blocked(row, historical(row), 'capacity_release_required');
    expect(result.occupants).toEqual([]);
  });

  it('refuse la dimension livraison manquante ou ajoutée sur le mauvais type', () => {
    const delivery = order({ type: 'delivery' });
    blocked(delivery, historical(delivery, { capacity: { slot: SLOT, kitchenSeat: 0 } }), 'invalid_capacity_claim');
    const pickup = order();
    blocked(pickup, historical(pickup, { capacity: { slot: SLOT, kitchenSeat: 0, deliverySeat: 0 } }), 'invalid_capacity_claim');
  });

  it('ne devient jamais une origine de requête acceptée par la fabrique de binding', () => {
    expect(() => internalOrderAdmissionBinding('historical' as never, TENANT, { channel: 'phone' } as never)).toThrow();
  });
});
