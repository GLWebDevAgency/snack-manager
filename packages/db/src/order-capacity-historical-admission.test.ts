import { Mongoose, Types } from 'mongoose';
import { describe, expect, it } from 'vitest';
import { PublicOrderAdmissionSchema } from './schemas';
import { ORDER_CAPACITY_INDEXES } from './order-capacity.schema';

const odm = new Mongoose();
odm.set('autoCreate', false); odm.set('autoIndex', false);
const Admission = odm.model('HistoricalAdmissionSchemaTest', PublicOrderAdmissionSchema.clone().set('bufferCommands', false));
const TENANT = new Types.ObjectId('507f1f77bcf86cd799439011');
const ORDER = new Types.ObjectId('507f1f77bcf86cd799439012');
const SLOT = new Date('2030-05-02T09:00:00.000Z');
const IMPORTED_AT = new Date('2030-05-01T08:00:00.000Z');
const BOOTSTRAP = '11111111-1111-4111-8111-111111111111';
const immutability = /admission historique.*immuable/i;
const PRIVATE_FIELDS = ['proofHash', 'payloadHash', 'validationOwner', 'snapshot', 'rejection'];
function fixture(overrides: Record<string, unknown> = {}) {
  return { _id: 'c'.repeat(64), tenantId: TENANT, clientId: 'ancien-ticket:caisse:41', version: 1,
    kind: 'historical', channel: 'phone', state: 'created', orderId: ORDER, slot: SLOT,
    capacity: { slot: SLOT, kitchenSeat: 0 },
    historicalImport: { version: 1, bootstrapId: BOOTSTRAP, importedAt: IMPORTED_AT }, ...overrides };
}
const make = (overrides: Record<string, unknown> = {}) => new Admission(fixture(overrides));

describe('admission historique — vrai schéma Mongoose, sans connexion ni migration', () => {
  it.each(['online', 'pos', 'phone'])('accepte un import terminal du canal %s, avec siège atomique et clientId ancien non UUID', async (channel) => {
    const doc = make({ channel });
    expect(doc.validateSync()).toBeUndefined();
    await expect(doc.validate()).resolves.toBeUndefined();
    const raw = doc.toObject({ transform: false });
    expect(raw).toMatchObject({ kind: 'historical', state: 'created', clientId: 'ancien-ticket:caisse:41',
      capacity: { slot: SLOT, kitchenSeat: 0 }, historicalImport: { bootstrapId: BOOTSTRAP } });
    for (const field of PRIVATE_FIELDS) expect(raw).not.toHaveProperty(field);
  });

  it('accepte une preuve de restitution sans siège, sans prétendre prouver l’annulation de l’Order ici', async () => {
    const doc = make({ capacity: { slot: SLOT, releasedAt: new Date('2030-05-02T10:00:00.000Z') } });
    expect(doc.validateSync()).toBeUndefined();
    await expect(doc.validate()).resolves.toBeUndefined();
  });
  it('accepte les deux sièges d’une livraison importée', () => {
    expect(make({ capacity: { slot: SLOT, kitchenSeat: 0, deliverySeat: 0 } }).validateSync()).toBeUndefined();
  });
  it.each(['validating', 'committing', 'rejected'])('refuse une admission historique en état %s', (state) => {
    expect(make({ state }).validateSync()).toBeDefined();
  });
  it.each([0, 2, null])('refuse la version %s', (version) => expect(make({ version }).validateSync()).toBeDefined());
  it.each([{ channel: undefined }, { channel: null }, { channel: 'kds' }, { clientId: '' }, { clientId: '   ' },
    { orderId: undefined }, { orderId: null }, { orderId: 'invalid' }, { slot: undefined }, { slot: null },
    { slot: new Date(NaN) }, { _id: 'not-an-admission-id' }])('refuse une identité historique incomplète %j', (changes) => {
    expect(make(changes).validateSync()).toBeDefined();
  });
  it.each(PRIVATE_FIELDS.flatMap((field) => [
    { field, value: field === 'snapshot' ? { _id: ORDER } : field === 'rejection' ? 'abandoned' : 'a'.repeat(64) },
    { field, value: null },
  ]))('refuse le champ interdit $field = $value, y compris null', ({ field, value }) => {
    expect(make({ [field]: value }).validateSync()).toBeDefined();
  });
  it.each([undefined, null, {}, { slot: SLOT }, { slot: SLOT, deliverySeat: 0 },
    { slot: SLOT, kitchenSeat: 0, releasedAt: IMPORTED_AT }, { slot: SLOT, deliverySeat: 0, releasedAt: IMPORTED_AT },
    { slot: SLOT, kitchenSeat: -1 }, { slot: SLOT, kitchenSeat: 100 }, { slot: SLOT, kitchenSeat: 0.5 },
    { slot: SLOT, kitchenSeat: 0, deliverySeat: 50 }, { slot: SLOT, releasedAt: new Date(NaN) },
    { slot: new Date(SLOT.getTime() + 1), kitchenSeat: 0 },
  ].map((capacity) => ({ capacity })))('refuse une réservation manquante ou incohérente $capacity', ({ capacity }) => {
    expect(make({ capacity }).validateSync()).toBeDefined();
  });
  it.each([undefined, null, {}, { version: 2, bootstrapId: BOOTSTRAP, importedAt: IMPORTED_AT },
    { version: 1, bootstrapId: 'invalid', importedAt: IMPORTED_AT }, { version: 1, bootstrapId: BOOTSTRAP, importedAt: null },
    { version: 1, bootstrapId: BOOTSTRAP, importedAt: new Date(NaN) },
  ].map((historicalImport) => ({ historicalImport })))('refuse une provenance manquante ou incohérente $historicalImport', ({ historicalImport }) => {
    expect(make({ historicalImport }).validateSync()).toBeDefined();
  });

  it('préserve les défauts et preuves obligatoires des anciennes admissions C01 sans kind', async () => {
    const doc = new Admission({ _id: 'd'.repeat(64), tenantId: TENANT, clientId: 'legacy-public-key', version: 1,
      state: 'validating', slot: SLOT, proofHash: 'a'.repeat(64), payloadHash: 'b'.repeat(64) });
    expect(doc.validateSync()).toBeUndefined();
    await expect(doc.validate()).resolves.toBeUndefined();
    expect(doc.toObject({ transform: false })).toMatchObject({ kind: 'public', snapshot: null, rejection: null, validationOwner: null });
    expect(doc.get('historicalImport')).toBeUndefined();
    doc.set('proofHash', undefined);
    expect(doc.validateSync()?.errors.proofHash).toBeDefined();
  });
  it.each(['public', 'legacy', 'staff'])('ne permet pas la provenance historique sur le genre %s', (kind) => {
    expect(make({ kind, proofHash: 'a'.repeat(64), payloadHash: 'b'.repeat(64) }).validateSync()).toBeDefined();
  });
  it('cache la provenance et les sièges dans les deux sérialisations publiques', () => {
    const doc = make();
    expect(PublicOrderAdmissionSchema.path('historicalImport').options).toMatchObject({ select: false, immutable: true });
    for (const output of [doc.toObject(), doc.toJSON()]) {
      for (const field of ['kind', 'channel', 'capacity', 'historicalImport', ...PRIVATE_FIELDS]) expect(output).not.toHaveProperty(field);
    }
    expect(JSON.stringify(doc)).not.toContain(BOOTSTRAP);
  });
  it.each(ORDER_CAPACITY_INDEXES)('partage l’index unique $name sans collection ou place historique séparée', ({ name, field }) => {
    const index = PublicOrderAdmissionSchema.indexes().find(([, options]) => options.name === name);
    expect(index?.[0]).toEqual({ tenantId: 1, 'capacity.slot': 1, [`capacity.${field}`]: 1 });
    expect(index?.[1]).toMatchObject({ unique: true, partialFilterExpression: { [`capacity.${field}`]: { $type: 'number' } } });
    expect(index?.[1]).not.toHaveProperty('expireAfterSeconds');
  });

  it.each([
    ['orderId', ORDER.toHexString().replace(/2$/, '3')], ['slot', new Date(SLOT.getTime() + 1)],
    ['clientId', 'other-client'], ['state', 'validating'], ['proofHash', 'a'.repeat(64)],
    ['capacity.kitchenSeat', 1],
  ])('refuse la mutation persistée de %s par document.validate()', async (path, value) => {
    const doc = Admission.hydrate(fixture());
    doc.set(path as string, value);
    await expect(doc.validate()).rejects.toThrow(immutability);
  });
  it('le sous-document de provenance rejette aussi une modification imbriquée via son garde ODM', async () => {
    const doc = Admission.hydrate(fixture());
    doc.set('historicalImport.bootstrapId', '22222222-2222-4222-8222-222222222222');
    await expect(doc.validate()).rejects.toThrow(/bootstrapId.*immutable/);
    expect(doc.get('historicalImport.bootstrapId')).toBe(BOOTSTRAP);
  });
  it('save(validateBeforeSave:false) ne réécrit pas la place historique', async () => {
    const doc = Admission.hydrate(fixture()); doc.set('capacity.kitchenSeat', 1);
    await expect(doc.save({ validateBeforeSave: false })).rejects.toThrow(immutability);
  });
  it('refuse la suppression par document avant tout transport', async () => {
    await expect(Admission.hydrate(fixture()).deleteOne()).rejects.toThrow(immutability);
  });
  it.each(['save', 'deleteOne'] as const)('un document sans genre privé chargé ne peut pas contourner le garde par %s', async (operation) => {
    const { kind: _kind, historicalImport: _provenance, capacity: _capacity, ...publicFields } = fixture();
    const doc = Admission.hydrate(publicFields, { kind: 0, historicalImport: 0, capacity: 0,
      proofHash: 0, payloadHash: 0, validationOwner: 0, snapshot: 0 });
    expect(doc.isSelected('kind')).toBe(false);
    doc.set('slot', new Date(SLOT.getTime() + 1));
    await expect(operation === 'save' ? doc.save({ validateBeforeSave: false }) : doc.deleteOne()).rejects.toThrow(immutability);
  });
});
