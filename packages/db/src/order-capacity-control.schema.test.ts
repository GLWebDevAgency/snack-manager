import { Mongoose } from 'mongoose';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OrderCapacityDaySchema } from './order-capacity.schema';
import { TenantSchema } from './schemas';

const db = new Mongoose();
const Day = db.model('CapacityClosedDayUnit', OrderCapacityDaySchema.clone().set('bufferCommands', false));
const Tenant = db.model('CapacityTenantControlUnit', TenantSchema);
const tenantId = '507f1f77bcf86cd799439011';
const uuid = '11111111-1111-4111-8111-111111111111';
const slot = () => ({ at: new Date('2030-05-02T16:00:00.000Z'), kitchenCapacity: 2, deliveryCapacity: 1 });
const day = (changes: Record<string, unknown> = {}) => new Day({ tenantId, day: '2030-05-02', slots: [slot()], ...changes });
const intent = (changes: Record<string, unknown> = {}) => ({ operationId: uuid, day: '2030-05-02', sourceRevision: 0,
  planHash: 'a'.repeat(64), slots: [slot()], closedReason: null, ...changes });
const control = (changes: Record<string, unknown> = {}) => ({ version: 1, state: 'seeding', configRevision: 0,
  bootstrapId: uuid, cutoverAt: new Date('2030-05-01T12:00:00Z'), dayIntent: null, ...changes });
const tenant = (capacityControl?: unknown) => new Tenant({ _id: tenantId, slug: 'capacity-fixture', name: 'Recette capacité',
  address: 'Adresse publique', phones: ['0000000000'], ...(capacityControl === undefined ? {} : { capacityControl }) });
afterEach(() => vi.restoreAllMocks());

describe('journée fermée explicite sans place fictive', () => {
  it('préserve une journée historique non vide, sans sourceRevision inventée', () => {
    const document = day();
    expect(document.validateSync()).toBeUndefined();
    expect(document.get('closedReason')).toBeNull();
    expect(document.get('sourceRevision')).toBeUndefined();
    expect(document.state).toBe('seeding');
  });
  it.each(['no_service', 'exceptional_closure'])('accepte zéro créneau seulement avec raison %s', (closedReason) => {
    const document = day({ slots: [], closedReason, sourceRevision: 0 });
    expect(document.validateSync()).toBeUndefined();
    expect(document.get('closedReason')).toBe(closedReason);
    expect(document.state).toBe('seeding');
  });
  it.each([
    { slots: [], closedReason: null }, { slots: [], closedReason: 'unknown' },
    { slots: [slot()], closedReason: 'no_service' }, { slots: [slot()], closedReason: 'exceptional_closure' },
  ])('refuse la contradiction fermeture/grille avec validateSync : %j', (patch) => {
    expect(day(patch).validateSync()).toBeDefined();
  });
  it('validateSync refuse aussi une grille située dans un autre jour Paris', () => {
    expect(day({ slots: [{ ...slot(), at: new Date('2030-05-02T22:00:00Z') }] }).validateSync()).toBeDefined();
  });
  it.each([-1, 0.5, Number.MAX_SAFE_INTEGER + 1, Infinity, NaN, null])('refuse sourceRevision %s', (sourceRevision) => {
    expect(day({ sourceRevision }).validateSync()).toBeDefined();
  });
  it.each(['closedReason', 'sourceRevision'])('la propriété %s est immuable, y compris par update', async (field) => {
    expect(OrderCapacityDaySchema.path(field).options.immutable).toBe(true);
    await expect(Day.updateOne({ tenantId }, { $set: { [field]: field === 'closedReason' ? 'no_service' : 2 } },
      { overwriteImmutable: true })).rejects.toThrow(/immuable/);
  });
});

describe('contrôle privé de capacité — opt-in explicite', () => {
  it('ne crée aucun contrôle sur un établissement existant ou nouveau sans opt-in', () => {
    expect(tenant().get('capacityControl')).toBeUndefined();
    expect(Tenant.hydrate({ _id: tenantId, slug: 'old', name: 'Ancien' }).get('capacityControl')).toBeUndefined();
    expect(TenantSchema.path('capacityControl').options.select).toBe(false);
    expect(TenantSchema.path('capacityControl').options.default).toBeUndefined();
  });
  it.each(['seeding', 'active', 'blocked'])('accepte seulement un contrôle explicitement complet : %s', (state) => {
    const document = tenant(control({ state }));
    expect(document.validateSync()).toBeUndefined();
    expect(document.get('capacityControl.state')).toBe(state);
    expect(document.get('capacityControl.dayIntent')).toBeNull();
  });
  it.each(['version', 'state', 'configRevision', 'bootstrapId', 'cutoverAt'])('ne génère pas la propriété obligatoire %s', (field) => {
    const candidate: Record<string, unknown> = control(); delete candidate[field];
    expect(tenant(candidate).validateSync()).toBeDefined();
  });
  it.each([
    { version: 2 }, { state: 'ready' }, { configRevision: -1 }, { configRevision: 0.5 },
    { configRevision: Number.MAX_SAFE_INTEGER + 1 }, { bootstrapId: 'not-a-uuid' }, { cutoverAt: new Date('invalid') },
  ])('refuse un contrôle invalide %j', (patch) => expect(tenant(control(patch)).validateSync()).toBeDefined());
  it('ne sérialise pas le contrôle même juste après sa création, mais garde les propriétés publiques', () => {
    const document = tenant(control({ dayIntent: intent() }));
    expect(document.get('capacityControl.dayIntent.planHash')).toBe('a'.repeat(64));
    for (const serialized of [document.toObject(), document.toJSON(), JSON.parse(JSON.stringify(document))]) {
      expect(serialized).not.toHaveProperty('capacityControl');
      expect(serialized).toMatchObject({ slug: 'capacity-fixture', name: 'Recette capacité', address: 'Adresse publique', phones: ['0000000000'] });
    }
    const expectedPublic = document.toObject({ transform: false });
    delete expectedPublic.capacityControl;
    expect(document.toObject()).toEqual(expectedPublic);
  });
  it.each([null, 'no_service', 'exceptional_closure'])('accepte une intention complète avec fermeture %s', (closedReason) => {
    const document = tenant(control({ dayIntent: intent({ closedReason, slots: closedReason ? [] : [slot()] }) }));
    expect(document.validateSync()).toBeUndefined();
    expect(document.get('capacityControl.dayIntent.operationId')).toBe(uuid);
  });
  it.each(['operationId', 'day', 'sourceRevision', 'planHash', 'slots'])('une intention ne génère pas le champ obligatoire %s', (field) => {
    const candidate: Record<string, unknown> = intent(); delete candidate[field];
    expect(tenant(control({ dayIntent: candidate })).validateSync()).toBeDefined();
  });
  it('accepte les bornes entières sûres et exactement 1000 créneaux', () => {
    const slots = Array.from({ length: 1000 }, (_, index) => ({ ...slot(), at: new Date(Date.UTC(2030, 4, 2, 0, 0, index)) }));
    expect(day({ sourceRevision: Number.MAX_SAFE_INTEGER, slots }).validateSync()).toBeUndefined();
    expect(tenant(control({ configRevision: Number.MAX_SAFE_INTEGER,
      dayIntent: intent({ sourceRevision: Number.MAX_SAFE_INTEGER, slots }) })).validateSync()).toBeUndefined();
  });
  it.each([
    { operationId: 'not-a-uuid' }, { day: '2030-02-30' }, { planHash: 'short' },
    { sourceRevision: -1 }, { sourceRevision: 0.5 }, { sourceRevision: Number.MAX_SAFE_INTEGER + 1 },
    { slots: [] }, { slots: [], closedReason: 'unknown' }, { closedReason: 'no_service' },
    { slots: [slot(), slot()] },
    { slots: [{ ...slot(), at: new Date('2030-05-02T22:00:00Z') }] },
    { slots: [{ ...slot(), kitchenCapacity: 0 }] }, { slots: [{ ...slot(), deliveryCapacity: 51 }] },
    { slots: Array.from({ length: 1001 }, (_, index) => ({ ...slot(), at: new Date(Date.UTC(2030, 4, 2, 0, 0, index)) })) },
  ].map((patch, index) => ({ patch, index })))('validateSync bloque une intention incohérente : cas $index', ({ patch }) => {
    expect(tenant(control({ dayIntent: intent(patch) })).validateSync()).toBeDefined();
  });
  it.each([
    control({ order: { clientId: uuid } }), control({ dayIntent: intent({ customer: { name: 'Ne pas stocker' } }) }),
    control({ dayIntent: intent({ slots: [{ ...slot(), clientId: uuid }] }) }),
  ])('refuse les champs étrangers au contrôle au lieu de stocker des commandes/clients', (candidate) => {
    expect(tenant(candidate).validateSync()).toBeDefined();
  });
  it.each(['capacityControl', 'capacityControl.dayIntent'])('une requête validée remplaçant %s contrôle toute la grille avant transport', async (path) => {
    const transport = vi.spyOn(Tenant.collection, 'updateOne').mockResolvedValue({ acknowledged: true,
      matchedCount: 1, modifiedCount: 1, upsertedCount: 0, upsertedId: null });
    const value = (dayIntent: ReturnType<typeof intent>) => path === 'capacityControl' ? control({ dayIntent }) : dayIntent;
    await expect(Tenant.updateOne({ _id: tenantId }, { $set: { [path]: value(intent({ closedReason: 'no_service' })) } },
      { runValidators: true })).rejects.toThrow();
    expect(transport).not.toHaveBeenCalled();
    await Tenant.updateOne({ _id: tenantId }, { $set: { [path]: value(intent({ slots: [], closedReason: 'no_service' })) } }, { runValidators: true });
    expect(transport).toHaveBeenCalledOnce();
  });
});
