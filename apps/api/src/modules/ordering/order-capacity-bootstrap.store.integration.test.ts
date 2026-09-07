import { randomUUID } from 'node:crypto';
import mongoose, { Types, type Connection, type Model, type Query } from 'mongoose';
import { MODELS } from '@sm/db';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { OrderAdmissionJournal } from '../orders/order-admission-journal';
import { orderAdmissionId } from '../orders/order-admission-identity';
import { OrderCapacityBootstrapReader } from './order-capacity-bootstrap.reader';
import { OrderCapacityBootstrapStore, type CapacityBootstrapApplyInput } from './order-capacity-bootstrap.store';

const TENANT = '507f1f77bcf86cd799439011';
const OTHER = '507f1f77bcf86cd799439022';
const SLOT = new Date('2030-05-02T09:00:00.000Z');
const CUTOVER = new Date('2030-05-02T08:00:00.000Z');
const BOOTSTRAP = '11111111-1111-4111-8111-111111111111';
const RUN_ID = randomUUID();
const PROOF = { version: 1, proofHash: 'a'.repeat(64), payloadHash: 'b'.repeat(64) };
const PRIVATE = '+kind +channel +proofHash +payloadHash +capacity +snapshot +validationOwner +historicalImport';

export function capacityBootstrapTestDatabase(raw: string): string {
  const url = new URL(raw);
  if (url.protocol !== 'mongodb:' || !['127.0.0.1', 'localhost'].includes(url.hostname)
    || url.username || url.password || url.search || url.hash
    || !/^\/snackmanager_bootstrap_test_[a-z0-9_]{1,20}$/i.test(url.pathname)) throw new Error('Base bootstrap de recette locale isolée requise.');
  url.pathname += `_${randomUUID().replaceAll('-', '').slice(0, 10)}`;
  return url.toString();
}
const uri = process.env.ORDER_CAPACITY_BOOTSTRAP_TEST_MONGO_URL
  ? capacityBootstrapTestDatabase(process.env.ORDER_CAPACITY_BOOTSTRAP_TEST_MONGO_URL) : null;
const integration = uri ? describe : describe.skip;
describe('garde cible bootstrap réel', () => {
  const credentials = new URL('mongodb://localhost/snackmanager_bootstrap_test_ci');
  credentials.username = 'synthetic'; credentials.password = 'synthetic';
  it.each(['mongodb://remote.example/snackmanager_bootstrap_test_ci', 'mongodb+srv://localhost/snackmanager_bootstrap_test_ci',
    'mongodb://localhost/snackmanager', 'mongodb://localhost/admin', 'mongodb://localhost/snackmanager_bootstrap_test_ci?replicaSet=live',
    'mongodb://localhost/snackmanager_bootstrap_test_ci#fragment', credentials.toString()])('refuse %s sans I/O', (value) => {
    expect(() => capacityBootstrapTestDatabase(value)).toThrow();
  });
  it('alloue une base UUID différente à chaque invocation', () => {
    const target = 'mongodb://127.0.0.1:27037/snackmanager_bootstrap_test_local';
    expect(capacityBootstrapTestDatabase(target)).not.toBe(capacityBootstrapTestDatabase(target));
  });
});
function models(db: Connection) {
  return { tenants: db.model(MODELS.Tenant.name, MODELS.Tenant.schema, MODELS.Tenant.collection),
    days: db.model(MODELS.OrderCapacityDay.name, MODELS.OrderCapacityDay.schema, MODELS.OrderCapacityDay.collection),
    orders: db.model(MODELS.Order.name, MODELS.Order.schema, MODELS.Order.collection),
    admissions: db.model(MODELS.PublicOrderAdmission.name, MODELS.PublicOrderAdmission.schema, MODELS.PublicOrderAdmission.collection) };
}
type Models = ReturnType<typeof models>;
type Document = mongoose.mongo.Document;
function input(patch: Record<string, unknown> = {}): CapacityBootstrapApplyInput {
  return { tenantId: TENANT, cutoverAt: CUTOVER, bootstrapId: BOOTSTRAP, writersStopped: true, writerRevision: 'c'.repeat(40), ...patch } as CapacityBootstrapApplyInput;
}
function barrier() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => { release = resolve; });
  return { promise, release };
}
function interceptUpdate<T>(model: Model<T>, match: (update: Document) => boolean, effect: (run: () => Promise<unknown>) => Promise<unknown>): Model<T> {
  let armed = true;
  return new Proxy(model, { get(target, key) {
    const value = Reflect.get(target, key, target);
    if (key !== 'updateOne') return typeof value === 'function' ? value.bind(target) : value;
    return (...args: unknown[]) => {
      const query = Reflect.apply(value, target, args) as Query<unknown, T>;
      const run = query.exec.bind(query);
      query.exec = async () => {
        if (!armed || !match(args[1] as Document)) return run();
        armed = false; return effect(run);
      };
      return query;
    };
  } });
}
function interceptCreate<T>(model: Model<T>, effect: (run: () => Promise<unknown>) => Promise<unknown>): Model<T> {
  let armed = true;
  return new Proxy(model, { get(target, key) {
    const value = Reflect.get(target, key, target);
    if (key !== 'create') return typeof value === 'function' ? value.bind(target) : value;
    return (...args: unknown[]) => {
      const run = () => Reflect.apply(value, target, args) as Promise<unknown>;
      if (!armed) return run();
      armed = false; return effect(run);
    };
  } });
}

integration('bootstrap durable — deux connexions, vraies écritures isolées et reprises', () => {
  let dbA: Connection; let dbB: Connection; let a: Models; let b: Models; let owned = false;
  const redis = { publish: vi.fn().mockResolvedValue(1) };
  async function assertOwned() {
    if (!uri || !owned || dbA.name !== new URL(uri).pathname.slice(1)
      || !/^snackmanager_bootstrap_test_[a-z0-9_]+_[a-f0-9]{10}$/i.test(dbA.name)
      || !await dbA.db!.collection('_test_run').findOne({ runId: RUN_ID })) throw new Error('Nettoyage bootstrap refusé : base non possédée.');
  }
  function store(set = a, db = dbA, override: Partial<Models> = {}) {
    const selected = { ...set, ...override };
    return new OrderCapacityBootstrapStore(selected.tenants, selected.days, selected.admissions, selected.orders,
      new OrderCapacityBootstrapReader(db.db!), new OrderAdmissionJournal(selected.admissions, selected.orders, redis as never));
  }
  async function tenant(tenantId = TENANT, patch: Document = {}) {
    await a.tenants.collection.insertOne({ _id: new Types.ObjectId(tenantId), name: 'Test isolé', slug: `test-${tenantId}`,
      hours: Array.from({ length: 7 }, (_, index) => ({ day: index + 1, lunch: { open: '11:00', close: '12:00' }, dinner: null })),
      closures: [], settings: { slotIntervalMin: 30, slotCapacity: 10 }, delivery: { slotCapacity: 3 }, ...patch } as never);
  }
  function order(index = 1, patch: Document = {}) {
    return new a.orders({ _id: new Types.ObjectId(index.toString(16).padStart(24, '0')), tenantId: TENANT, clientId: `old-ticket:${index}`,
      number: index, channel: 'phone', type: 'pickup', status: 'new', trackingToken: `stable-token-${index}`,
      lines: [], totals: { subtotal: 1250, total: 1250 }, payment: { method: 'counter', status: 'pending' },
      pickup: { slot: SLOT, customerName: 'Fixture', customerPhone: '0600000000' },
      statusHistory: [{ status: 'new', at: CUTOVER, by: 'fixture' }], createdAt: CUTOVER, updatedAt: CUTOVER, ...patch }).toObject({ transform: false });
  }
  async function insertOrder(index = 1, patch: Document = {}) {
    const row = order(index, patch);
    await a.orders.collection.insertOne(row as never);
    return row;
  }
  function admission(row: ReturnType<typeof order>, patch: Document = {}) {
    return { _id: orderAdmissionId(TENANT, row.clientId), tenantId: new Types.ObjectId(TENANT), clientId: row.clientId,
      version: 1, kind: 'public', channel: 'online', proofHash: PROOF.proofHash, payloadHash: PROOF.payloadHash,
      state: 'created', slot: row.pickup!.slot, orderId: row._id, snapshot: null, validationOwner: null, rejection: null, ...patch };
  }
  async function control() { return (await a.tenants.findById(TENANT).select('+capacityControl').lean())?.capacityControl; }
  async function snapshots() {
    return Promise.all(Object.values(a).map(async (model) => ({ name: model.collection.name,
      docs: await model.collection.find().sort({ _id: 1 }).toArray(), indexes: await model.collection.indexes() })));
  }
  beforeAll(async () => {
    dbA = await mongoose.createConnection(uri!, { autoCreate: false, autoIndex: false, monitorCommands: true }).asPromise();
    expect(await dbA.db!.listCollections({}, { nameOnly: true }).toArray()).toEqual([]);
    await dbA.db!.collection('_test_run').insertOne({ runId: RUN_ID }); owned = true;
    dbB = await mongoose.createConnection(uri!, { autoCreate: false, autoIndex: false }).asPromise();
    a = models(dbA); b = models(dbB);
    for (const model of Object.values(a)) await model.createCollection();
    await a.orders.createIndexes();
  }, 20_000);
  beforeEach(async () => {
    await assertOwned(); vi.restoreAllMocks(); redis.publish.mockClear();
    for (const model of Object.values(a)) await model.collection.deleteMany({});
    await tenant();
  });
  afterAll(async () => {
    vi.restoreAllMocks();
    try { if (owned) { await assertOwned(); await dbA.dropDatabase(); } }
    finally { await Promise.all([dbA?.close(), dbB?.close()]); }
  });

  it.each(['online', 'phone', 'pos'])('importe %s sans modifier le ticket, son prix, numéro ou jeton', async (channel) => {
    const row = await insertOrder(1, { channel });
    const result = await store().apply(input());
    expect(result).toMatchObject({ state: 'active', orders: 1 });
    expect(await a.orders.collection.findOne({ _id: row._id })).toEqual(row);
    const imported = await a.admissions.findById(orderAdmissionId(TENANT, row.clientId)).select(PRIVATE).lean();
    expect(imported).toMatchObject({ state: 'created', kind: 'historical', channel,
      capacity: { slot: SLOT, kitchenSeat: 0 }, historicalImport: { version: 1, bootstrapId: BOOTSTRAP } });
    for (const field of ['proofHash', 'payloadHash', 'snapshot', 'validationOwner', 'rejection']) expect(imported).not.toHaveProperty(field);
    expect((await control())?.state).toBe('active');
    expect(await store(b, dbB).apply(input())).toMatchObject({ state: 'already_active' });
    expect(await a.orders.collection.findOne({ _id: row._id })).toEqual(row);
    expect(await a.admissions.countDocuments()).toBe(1);
  });

  it.each([null, [], false, 0, new Date(), new Map()])('refuse limits=%j avant le premier write', async (limits) => {
    const before = await snapshots();
    await expect(store().apply(input({ limits }))).rejects.toThrow();
    expect(await snapshots()).toEqual(before);
  });

  it('canonise le tenant hex avant de calculer une clé historique', async () => {
    const row = await insertOrder();
    await expect(store().apply(input({ tenantId: TENANT.toUpperCase() }))).resolves.toMatchObject({ state: 'active', tenantId: TENANT });
    expect(await a.admissions.findById(orderAdmissionId(TENANT, row.clientId))).not.toBeNull();
  });

  it.each([undefined, null])('importe une ancienne admission C01 avec capacité %j sans changer sa preuve', async (capacity) => {
    const row = await insertOrder(1, { channel: 'online', publicRecovery: PROOF });
    await a.admissions.collection.insertOne(admission(row, capacity === undefined ? {} : { capacity }) as never);
    await expect(store().apply(input())).resolves.toMatchObject({ state: 'active' });
    expect(await a.admissions.findById(orderAdmissionId(TENANT, row.clientId)).select(PRIVATE).lean())
      .toMatchObject({ kind: 'public', proofHash: PROOF.proofHash, payloadHash: PROOF.payloadHash, capacity: { kitchenSeat: 0 } });
    expect(await a.orders.collection.findOne({ _id: row._id })).toEqual(row);
  });

  it.each([undefined, null])('réconcilie une ancienne C01 annulée avec capacité %j sans créer de siège', async (capacity) => {
    const row = await insertOrder(1, { channel: 'online', status: 'cancelled', publicRecovery: PROOF });
    await a.admissions.collection.insertOne(admission(row, capacity === undefined ? {} : { capacity }) as never);
    await expect(store().apply(input())).resolves.toMatchObject({ state: 'active', orders: 0 });
    const restored = await a.admissions.findById(orderAdmissionId(TENANT, row.clientId)).select(PRIVATE).lean();
    expect(restored?.capacity?.releasedAt).toBeInstanceOf(Date);
    expect(restored?.capacity).not.toHaveProperty('kitchenSeat');
    expect(await a.orders.collection.findOne({ _id: row._id })).toEqual(row);
  });

  it('ne compte pas 151 restitutions antérieures comme 151 places occupées', async () => {
    const rows = Array.from({ length: 151 }, (_, index) => order(index + 1, { channel: 'online', status: 'cancelled', publicRecovery: PROOF }));
    await a.orders.collection.insertMany(rows as never);
    await a.admissions.collection.insertMany(rows.map((row) => admission(row, { capacity: { slot: SLOT, releasedAt: CUTOVER } })) as never);
    await insertOrder(152);
    await expect(store().apply(input())).resolves.toMatchObject({ state: 'active', orders: 1 });
  }, 20_000);

  it('deux workers du même bootstrap acquittent la même activation sans écriture après active', async () => {
    const reached = barrier(); const release = barrier();
    const held = interceptCreate(a.days, async (run) => { reached.release(); await release.promise; return run(); });
    const delayed = store(a, dbA, { days: held }).apply(input());
    const outcome = delayed.then((value) => ({ value }), (error: unknown) => ({ error }));
    try {
      await reached.promise;
      await expect(store(b, dbB).apply(input())).resolves.toMatchObject({ state: 'active' });
    } finally { release.release(); }
    expect(await outcome).toMatchObject({ value: { state: 'already_active' } });
    expect((await control())?.state).toBe('active');
    expect(await a.days.countDocuments()).toBe(1);
  });

  it('matérialise un ancien committing C01 sans recalculer son prix ni recréer son identité', async () => {
    const row = order(1, { channel: 'online', publicRecovery: PROOF, totals: { subtotal: 1550, discount: { amount: 300, reason: 'Ancienne promotion' }, total: 1250 } });
    await a.admissions.collection.insertOne(admission(row, { state: 'committing', snapshot: row }) as never);
    expect(await a.orders.countDocuments()).toBe(0);
    await expect(store().apply(input())).resolves.toMatchObject({ state: 'active', orders: 1 });
    expect(await a.orders.collection.findOne({ _id: row._id })).toMatchObject({ _id: row._id, number: row.number,
      totals: row.totals, payment: row.payment, trackingToken: row.trackingToken, publicRecovery: PROOF });
    expect(await a.admissions.findById(orderAdmissionId(TENANT, row.clientId)).select(PRIVATE).lean())
      .toMatchObject({ kind: 'public', proofHash: PROOF.proofHash, state: 'created', snapshot: null, capacity: { kitchenSeat: 0 } });
    await store(b, dbB).apply(input());
    expect(await a.orders.countDocuments()).toBe(1);
  });

  it('la fermeture validating interdit définitivement le vieux CAS committing retardé', async () => {
    const row = order(1, { channel: 'online', publicRecovery: PROOF });
    const draft = admission(row, { state: 'validating', orderId: null, validationOwner: randomUUID() });
    await a.admissions.collection.insertOne(draft as never);
    await expect(store().apply(input())).resolves.toMatchObject({ state: 'active', orders: 0 });
    const late = await b.admissions.updateOne({ _id: draft._id, state: 'validating', validationOwner: draft.validationOwner },
      { $set: { state: 'committing', orderId: row._id, snapshot: row } });
    expect(late.modifiedCount).toBe(0);
    expect(await a.admissions.findById(draft._id).lean()).toMatchObject({ state: 'rejected', rejection: 'unavailable' });
    expect(await a.orders.countDocuments()).toBe(0);
  });

  it.each(['seeding', 'active'] as const)('réconcilie une réponse perdue APRÈS la transition Tenant %s', async (phase) => {
    const row = await insertOrder();
    const wrapped = interceptUpdate(a.tenants,
      (update) => phase === 'seeding' ? update.$set?.capacityControl?.state === 'seeding' : update.$set?.['capacityControl.state'] === 'active',
      async (run) => { await run(); throw new Error('lost durable acknowledgement'); });
    await expect(store(a, dbA, { tenants: wrapped }).apply(input())).resolves.toMatchObject({ state: 'active' });
    expect(await a.orders.collection.findOne({ _id: row._id })).toEqual(row);
    expect(await a.admissions.countDocuments()).toBe(1);
  });

  it.each(['seeding', 'active'] as const)('reprend via une seconde connexion une interruption AVANT la transition Tenant %s', async (phase) => {
    const row = await insertOrder();
    const wrapped = interceptUpdate(a.tenants,
      (update) => phase === 'seeding' ? update.$set?.capacityControl?.state === 'seeding' : update.$set?.['capacityControl.state'] === 'active',
      async () => { throw new Error('not acknowledged'); });
    await expect(store(a, dbA, { tenants: wrapped }).apply(input())).rejects.toThrow();
    expect((await control())?.state).not.toBe('active');
    await expect(store(b, dbB).apply(input())).resolves.toMatchObject({ state: 'active' });
    expect(await a.orders.collection.findOne({ _id: row._id })).toEqual(row);
    expect(await a.admissions.countDocuments()).toBe(1);
  });

  it.each(['day', 'admission'] as const)('réconcilie la réponse perdue APRÈS insertion %s sans doublon', async (entity) => {
    const row = await insertOrder();
    const effect = async (run: () => Promise<unknown>) => { await run(); throw new Error('lost insert response'); };
    const override = entity === 'day' ? { days: interceptCreate(a.days, effect) } : { admissions: interceptCreate(a.admissions, effect) };
    await expect(store(a, dbA, override).apply(input())).resolves.toMatchObject({ state: 'active' });
    expect(await a.orders.collection.findOne({ _id: row._id })).toEqual(row);
    expect(await a.admissions.countDocuments()).toBe(1);
    expect(await a.days.countDocuments()).toBe(1);
  });

  it.each(['day', 'admission'] as const)('reprend après interruption AVANT insertion %s depuis une autre instance', async (entity) => {
    const row = await insertOrder();
    const effect = async () => { throw new Error('process interrupted'); };
    const override = entity === 'day' ? { days: interceptCreate(a.days, effect) } : { admissions: interceptCreate(a.admissions, effect) };
    await expect(store(a, dbA, override).apply(input())).rejects.toThrow();
    expect((await control())?.state).toBe('seeding');
    await expect(store(b, dbB).apply(input())).resolves.toMatchObject({ state: 'active' });
    expect(await a.orders.collection.findOne({ _id: row._id })).toEqual(row);
    expect(await a.admissions.countDocuments()).toBe(1);
  });

  it('une ancienne insertion historique perdue et retardée ne double pas celle du helper', async () => {
    const row = await insertOrder();
    let lateInsert: (() => Promise<unknown>) | undefined;
    const held = interceptCreate(a.admissions, async (run) => { lateInsert = run; throw new Error('request still uncertain'); });
    await expect(store(a, dbA, { admissions: held }).apply(input())).rejects.toThrow();
    await expect(store(b, dbB).apply(input())).resolves.toMatchObject({ state: 'active' });
    const before = await snapshots();
    await expect(lateInsert!()).rejects.toMatchObject({ code: 11000 });
    expect(await snapshots()).toEqual(before);
    expect(await a.orders.collection.findOne({ _id: row._id })).toEqual(row);
  });

  it('réconcilie la perte de réponse du CAS d’ajout de capacité C01', async () => {
    const row = await insertOrder(1, { channel: 'online', publicRecovery: PROOF });
    await a.admissions.collection.insertOne(admission(row) as never);
    const held = interceptUpdate(a.admissions, (update) => Boolean(update.$set?.capacity?.kitchenSeat === 0),
      async (run) => { await run(); throw new Error('capacity acknowledgement lost'); });
    await expect(store(a, dbA, { admissions: held }).apply(input())).resolves.toMatchObject({ state: 'active' });
    expect(await a.orders.collection.findOne({ _id: row._id })).toEqual(row);
  });

  it('une annulation concurrente conserve seeding jusqu’à restitution vérifiée au rejeu', async () => {
    const row = await insertOrder();
    const wrapped = interceptCreate(a.admissions, async (run) => {
      const result = await run();
      await b.orders.collection.updateOne({ _id: row._id }, { $set: { status: 'cancelled' } });
      return result;
    });
    await expect(store(a, dbA, { admissions: wrapped }).apply(input())).rejects.toThrow();
    expect((await control())?.state).toBe('seeding');
    await expect(store(b, dbB).apply(input())).resolves.toMatchObject({ state: 'active', orders: 0 });
    const claim = await a.admissions.findById(orderAdmissionId(TENANT, row.clientId)).select(PRIVATE).lean();
    expect(claim?.capacity?.releasedAt).toBeInstanceOf(Date);
    expect(claim?.capacity).not.toHaveProperty('kitchenSeat');
    expect(await a.orders.collection.findOne({ _id: row._id })).toEqual({ ...row, status: 'cancelled' });
  });

  it('importe ensemble cuisine et livraison sans dépasser l’une des dimensions', async () => {
    await insertOrder(1, { type: 'delivery', channel: 'online' });
    await insertOrder(2, { channel: 'phone' });
    await expect(store().apply(input())).resolves.toMatchObject({ state: 'active', orders: 2 });
    const claims = await a.admissions.find().select(PRIVATE).sort({ clientId: 1 }).lean();
    expect(claims[0]?.capacity).toMatchObject({ kitchenSeat: 0, deliverySeat: 0 });
    expect(claims[1]?.capacity).toMatchObject({ kitchenSeat: 1 });
    expect(claims[1]?.capacity).not.toHaveProperty('deliverySeat');
  });

  it('inclut les dates futures hors horizon public et préserve leurs plans gelés au rejeu', async () => {
    const row = await insertOrder(1, { pickup: { slot: new Date('2031-05-02T09:00:00.000Z'), customerName: 'Fixture', customerPhone: '0600000000' } });
    await expect(store().apply(input())).resolves.toMatchObject({ state: 'active', days: 2, orders: 1 });
    const before = await a.days.collection.find().sort({ day: 1 }).toArray();
    await a.tenants.collection.updateOne({ _id: new Types.ObjectId(TENANT) }, { $set: { 'settings.slotCapacity': 50, 'capacityControl.configRevision': 1 } });
    await expect(store(b, dbB).apply(input())).resolves.toMatchObject({ state: 'already_active' });
    expect(await a.days.collection.find().sort({ day: 1 }).toArray()).toEqual(before);
    expect(await a.orders.collection.findOne({ _id: row._id })).toEqual(row);
  });

  it.each(['off_grid', 'overbook', 'missing_public', 'missing_order'] as const)('bloque %s au preflight sans aucun write de bootstrap', async (kind) => {
    if (kind === 'off_grid') await insertOrder(1, { pickup: { slot: new Date(SLOT.getTime() + 60_000), customerName: 'Fixture', customerPhone: '0600000000' } });
    if (kind === 'overbook') {
      await a.tenants.collection.updateOne({ _id: new Types.ObjectId(TENANT) }, { $set: { 'settings.slotCapacity': 1 } });
      await insertOrder(1); await insertOrder(2);
    }
    if (kind === 'missing_public') await insertOrder(1, { channel: 'online', publicRecovery: PROOF });
    if (kind === 'missing_order') {
      const row = order(1, { channel: 'online', publicRecovery: PROOF });
      await a.admissions.collection.insertOne(admission(row) as never);
    }
    const before = await snapshots();
    await expect(store().apply(input())).rejects.toThrow();
    expect(await snapshots()).toEqual(before);
    expect(await control()).toBeUndefined();
  });

  it.each([{ maxDocuments: 1 }, { maxBytes: 1 }, { maxDays: 1 }])('refuse un scan incomplet plafonné %j avant écriture', async (limits) => {
    await insertOrder(1); await insertOrder(2, { pickup: { slot: new Date('2031-05-02T09:00:00.000Z') } });
    const before = await snapshots();
    await expect(store().apply(input({ limits }))).rejects.toThrow();
    expect(await snapshots()).toEqual(before);
  });

  it('ne prend pas possession d’une génération différente déjà seeding', async () => {
    const interrupted = interceptCreate(a.days, async () => { throw new Error('interrupted'); });
    await expect(store(a, dbA, { days: interrupted }).apply(input())).rejects.toThrow();
    const before = await snapshots();
    await expect(store(b, dbB).apply(input({ bootstrapId: randomUUID() }))).rejects.toThrow();
    expect(await snapshots()).toEqual(before);
    expect((await control())?.state).toBe('seeding');
  });

  it('n’importe et ne modifie aucune commande d’un autre restaurant', async () => {
    await tenant(OTHER);
    const foreign = await insertOrder(2, { tenantId: OTHER });
    await insertOrder(1);
    await expect(store().apply(input())).resolves.toMatchObject({ state: 'active', orders: 1 });
    expect(await a.orders.collection.findOne({ _id: foreign._id })).toEqual(foreign);
    expect(await a.admissions.countDocuments({ tenantId: OTHER })).toBe(0);
    expect(await a.days.countDocuments({ tenantId: OTHER })).toBe(0);
    expect((await a.tenants.findById(OTHER).select('+capacityControl').lean())?.capacityControl).toBeUndefined();
  });

  it('borne aussi les snapshots complets de reprise, pas seulement leur projection de lecture', async () => {
    const row = order(1, { channel: 'online', publicRecovery: PROOF, note: 'synthetic'.repeat(2_000) });
    await a.admissions.collection.insertOne(admission(row, { state: 'committing', snapshot: row }) as never);
    const preview = await new OrderCapacityBootstrapReader(dbA.db!).read({ tenantId: TENANT, cutoverAt: CUTOVER, limits: { maxBytes: 4_000 } });
    expect(preview.scan.complete).toBe(true);
    await expect(store().apply(input({ limits: { maxBytes: 4_000 } }))).rejects.toMatchObject({ reason: 'admission_byte_limit' });
    expect((await control())?.state).toBe('seeding');
    expect(await a.orders.countDocuments()).toBe(0);
    expect(await a.admissions.findById(orderAdmissionId(TENANT, row.clientId)).select(PRIVATE).lean()).toMatchObject({ state: 'committing', snapshot: { note: row.note } });
  });

  it('les mutations critiques émises au vrai Mongo attendent majorité et journal', async () => {
    await insertOrder();
    const commands: { name: string; command: Document }[] = [];
    const listener = (event: mongoose.mongo.CommandStartedEvent) => {
      if (['insert', 'update'].includes(event.commandName)) commands.push({ name: event.commandName, command: event.command });
    };
    dbA.getClient().on('commandStarted', listener);
    try { await store().apply(input()); }
    finally { dbA.getClient().off('commandStarted', listener); }
    expect(commands.map((value) => value.name)).toContain('insert');
    expect(commands.map((value) => value.name)).toContain('update');
    for (const { command } of commands) expect(command.writeConcern, `durabilité ${command.insert ?? command.update}`)
      .toMatchObject({ w: 'majority', j: true, wtimeout: 10_000 });
  });
});
