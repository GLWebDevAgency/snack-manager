import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import mongoose from 'mongoose';
import { MODELS } from '@sm/db';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { orderAdmissionId } from '../orders/order-admission-identity';
import { OrderCapacityBootstrapReader } from './order-capacity-bootstrap.reader';
import { orderCapacityCalendarPlanHash } from './order-capacity-control';

const TENANT = '507f1f77bcf86cd799439011';
const OTHER_TENANT = '507f1f77bcf86cd799439021';
const DAY = '2030-05-02';
const SLOT = new Date('2030-05-02T09:00:00.000Z');
const CUTOVER = new Date('2030-05-02T16:00:00.000Z');
const PROOF = 'a'.repeat(64);
const PAYLOAD = 'b'.repeat(64);
const RUN_ID = randomUUID();
const PRIVATE_SENTINEL = 'fixture-privee-ne-doit-pas-sortir';
const { MongoClient, ObjectId } = mongoose.mongo;
type Db = mongoose.mongo.Db;
type Document = mongoose.mongo.Document;
type Command = { name: string; command: Document };
const collections = [MODELS.Tenant.collection, MODELS.Order.collection,
  MODELS.PublicOrderAdmission.collection, MODELS.OrderCapacityDay.collection];

/** Cette suite possède une base UUID locale, jamais une base applicative. */
export function capacityReaderTestDatabase(raw: string): string {
  const url = new URL(raw);
  if (url.protocol !== 'mongodb:' || !['localhost', '127.0.0.1'].includes(url.hostname)
    || url.username || url.password || url.search || url.hash
    || !/^\/snackmanager_reader_test_[a-z0-9_]{1,20}$/i.test(url.pathname)) {
    throw new Error('ORDER_CAPACITY_READER_TEST_MONGO_URL doit cibler une base isolée locale snackmanager_reader_test_ sans options.');
  }
  url.pathname += `_${randomUUID().replaceAll('-', '').slice(0, 10)}`;
  return url.toString();
}
const uri = process.env.ORDER_CAPACITY_READER_TEST_MONGO_URL
  ? capacityReaderTestDatabase(process.env.ORDER_CAPACITY_READER_TEST_MONGO_URL) : null;
const integration = uri ? describe : describe.skip;

describe('cible Mongo du lecteur C15', () => {
  const credentials = new URL('mongodb://localhost/snackmanager_reader_test_ci');
  credentials.username = 'synthetic'; credentials.password = 'synthetic';
  it.each([
    'mongodb://remote.example/snackmanager_reader_test_ci',
    'mongodb+srv://localhost/snackmanager_reader_test_ci',
    'mongodb://localhost/snackmanager', 'mongodb://localhost/admin',
    'mongodb://localhost/snackmanager_reader_test_ci?replicaSet=production',
    'mongodb://localhost/snackmanager_reader_test_ci#fragment', credentials.toString(),
  ])('refuse %s sans connexion', (value) => expect(() => capacityReaderTestDatabase(value)).toThrow());
  it('alloue une base différente pour chaque exécution', () => {
    const first = capacityReaderTestDatabase('mongodb://127.0.0.1:27036/snackmanager_reader_test_ci');
    const second = capacityReaderTestDatabase('mongodb://127.0.0.1:27036/snackmanager_reader_test_ci');
    expect(first).not.toBe(second);
    expect(first).toMatch(/^mongodb:\/\/127\.0\.0\.1:27036\/snackmanager_reader_test_ci_[a-f0-9]{10}$/);
  });
});

function tenant(overrides: Document = {}): Document {
  return { _id: new ObjectId(TENANT),
    hours: Array.from({ length: 7 }, (_, index) => ({ day: index + 1,
      lunch: { open: '11:00', close: '12:00' }, dinner: null })),
    settings: { slotIntervalMin: 30, slotCapacity: 4 }, delivery: { slotCapacity: 2 }, closures: [],
    capacityControl: { version: 1, state: 'active', configRevision: 7,
      bootstrapId: '11111111-1111-4111-8111-111111111111', cutoverAt: CUTOVER, dayIntent: null },
    contact: { email: PRIVATE_SENTINEL }, stripeAccountId: PRIVATE_SENTINEL, ...overrides };
}
function order(index = 1, overrides: Document = {}): Document {
  return { _id: new ObjectId(index.toString(16).padStart(24, '0')), tenantId: new ObjectId(TENANT),
    clientId: `fixture-ticket-${index}`, channel: 'online', type: 'pickup', status: 'new',
    pickup: { slot: SLOT, customerName: PRIVATE_SENTINEL, customerPhone: PRIVATE_SENTINEL },
    trackingToken: PRIVATE_SENTINEL, lines: [{ name: PRIVATE_SENTINEL, price: 1_234 }],
    delivery: { address: PRIVATE_SENTINEL }, payment: { privateProof: PRIVATE_SENTINEL },
    publicRecovery: { version: 1, proofHash: PROOF, payloadHash: PAYLOAD }, ...overrides };
}
function admission(row: Document, overrides: Document = {}): Document {
  return { _id: orderAdmissionId(TENANT, row.clientId), tenantId: new ObjectId(TENANT),
    clientId: row.clientId, version: 1, kind: 'public', channel: 'online', state: 'created',
    slot: SLOT, orderId: row._id, proofHash: PROOF, payloadHash: PAYLOAD,
    snapshot: null, capacity: null, validationOwner: PRIVATE_SENTINEL, ...overrides };
}
function historical(row: Document, overrides: Document = {}): Document {
  return { _id: orderAdmissionId(TENANT, row.clientId), tenantId: new ObjectId(TENANT), clientId: row.clientId,
    version: 1, kind: 'historical', channel: row.channel, state: 'created', slot: row.pickup.slot, orderId: row._id,
    capacity: { slot: row.pickup.slot, kitchenSeat: 0, ...(row.type === 'delivery' ? { deliverySeat: 0 } : {}) },
    historicalImport: { version: 1, bootstrapId: '11111111-1111-4111-8111-111111111111', importedAt: new Date('2030-05-02T08:00:00.000Z') },
    ...overrides };
}
function frozen(overrides: Document = {}): Document {
  return { _id: new ObjectId(), tenantId: new ObjectId(TENANT), day: DAY, state: 'ready',
    sourceRevision: 3, closedReason: null,
    slots: [{ at: SLOT, kitchenCapacity: 2, deliveryCapacity: 1 }], ...overrides };
}

/** Seule la frontière de transport est injectée ; chaque document vient du vrai curseur Mongo. */
function intercept(db: Db, hooks: {
  beforeAggregate?: (collection: string) => void;
  afterNext?: (collection: string, row: Document | null) => Promise<void>;
  closed?: (collection: string) => void;
}): Db {
  return new Proxy(db, { get(target, property) {
    const value = Reflect.get(target, property, target);
    if (property !== 'collection') return typeof value === 'function' ? value.bind(target) : value;
    return (name: string) => {
      const collection = target.collection(name);
      return new Proxy(collection, { get(model, key) {
        const member = Reflect.get(model, key, model);
        if (key !== 'aggregate') return typeof member === 'function' ? member.bind(model) : member;
        return (...args: unknown[]) => {
          hooks.beforeAggregate?.(name);
          const cursor = Reflect.apply(member, model, args) as mongoose.mongo.AggregationCursor<Document>;
          const next = cursor.next.bind(cursor);
          const close = cursor.close.bind(cursor);
          cursor.next = async () => {
            const row = await next();
            await hooks.afterNext?.(name, row);
            return row;
          };
          cursor.close = async (...options) => { hooks.closed?.(name); await close(...options); };
          return cursor;
        };
      } });
    };
  } });
}

integration('lecteur bootstrap C15 — vrai Mongo, zéro écriture du lecteur', () => {
  let writer: InstanceType<typeof MongoClient>;
  let reader: InstanceType<typeof MongoClient>;
  let writeDb: Db; let readDb: Db;
  let ownsDatabase = false;
  const commands: Command[] = [];
  const observedRows: Document[] = [];

  async function owned() {
    if (!ownsDatabase || !uri || writeDb.databaseName !== new URL(uri).pathname.slice(1)
      || !/^snackmanager_reader_test_[a-z0-9_]+_[a-f0-9]{10}$/i.test(writeDb.databaseName)
      || !await writeDb.collection('_test_run').findOne({ runId: RUN_ID })) {
      throw new Error('Nettoyage lecteur interdit : base UUID de recette non possédée.');
    }
  }
  async function read(db = readDb, limits?: Parameters<OrderCapacityBootstrapReader['read']>[0]['limits']) {
    const result = await new OrderCapacityBootstrapReader(db).read({ tenantId: TENANT, cutoverAt: CUTOVER, limits });
    expect(result).toMatchObject({ mode: 'read_only_analysis', canActivate: false,
      requiresExclusiveRescan: true, scan: { consistency: 'non_atomic' } });
    expect(JSON.stringify(result)).not.toContain(PRIVATE_SENTINEL);
    expect(JSON.stringify(result)).not.toMatch(/proofHash|payloadHash|trackingToken|customerPhone|validationOwner/);
    return result;
  }
  async function stored() {
    const names = (await writeDb.listCollections({}, { nameOnly: true }).toArray()).map((entry) => entry.name).sort();
    return Promise.all(names.map(async (name) => ({ name,
      documents: await writeDb.collection(name).find().sort({ _id: 1 }).toArray(),
      indexes: await writeDb.collection(name).listIndexes().toArray() })));
  }
  function incomplete(result: Awaited<ReturnType<typeof read>>, code?: string, source?: string) {
    expect(result.scan.complete).toBe(false);
    expect(result.report).toBeNull();
    expect(result.issues.length).toBeGreaterThan(0);
    if (code) expect(result.issues).toEqual([expect.objectContaining({ code, ...(source ? { source } : {}) })]);
  }
  function blocked(result: Awaited<ReturnType<typeof read>>, code: string) {
    expect(result.scan.complete).toBe(true);
    expect(result.issues).toEqual([]);
    expect(result.report?.status).toBe('blocked');
    expect(result.report?.issues).toEqual(expect.arrayContaining([expect.objectContaining({ code })]));
  }

  beforeAll(async () => {
    if (!uri) throw new Error('Cible locale absente.');
    writer = new MongoClient(uri, { serverSelectionTimeoutMS: 5_000 });
    await writer.connect(); writeDb = writer.db();
    expect(await writeDb.listCollections({}, { nameOnly: true }).toArray()).toEqual([]);
    await writeDb.collection('_test_run').insertOne({ runId: RUN_ID }); ownsDatabase = true;
    // Aucun modèle Mongoose compilé : ni hooks, ni autoCreate/autoIndex. Le
    // monitoring précède connect() et reste actif pendant toute la recette.
    reader = new MongoClient(uri, { monitorCommands: true, serverSelectionTimeoutMS: 5_000 });
    reader.on('commandStarted', (event) => commands.push({ name: event.commandName, command: event.command }));
    reader.on('commandSucceeded', (event) => {
      const reply = event.reply as { cursor?: { firstBatch?: Document[]; nextBatch?: Document[] } };
      const cursor = reply.cursor;
      if (cursor) observedRows.push(...(cursor.firstBatch ?? cursor.nextBatch ?? []));
    });
    await reader.connect(); readDb = reader.db();
  }, 15_000);
  beforeEach(async () => {
    await owned();
    const present = new Set((await writeDb.listCollections({}, { nameOnly: true }).toArray()).map((entry) => entry.name));
    // Uniquement les quatre collections de fixtures de NOTRE base UUID. Leur
    // absence est reproduite avant chaque cas, indépendamment de l'ordre Vitest.
    for (const name of collections) if (present.has(name)) await writeDb.collection(name).drop();
    await writeDb.collection(MODELS.Tenant.collection).insertOne(tenant());
    observedRows.length = 0;
  });
  afterEach(() => {
    // Liste positive : une future écriture non prévue ne peut pas passer sous
    // une liste noire incomplète. Les fixtures utilisent un autre client.
    const allowed = new Set(['hello', 'isMaster', 'ping', 'aggregate', 'find', 'getMore', 'killCursors', 'endSessions']);
    expect(commands.filter((entry) => !allowed.has(entry.name)).map((entry) => entry.name)).toEqual([]);
    for (const { command } of commands) {
      expect(JSON.stringify(command.pipeline ?? [])).not.toMatch(/"\$(out|merge)"/);
      if (command.aggregate) {
        expect(command.readConcern).toEqual({ level: 'majority' });
        expect(command.cursor.batchSize).toBe(64);
        expect(command.maxTimeMS).toBeGreaterThan(0);
        expect(command.allowDiskUse).toBe(false);
      }
    }
  });
  afterAll(async () => {
    try { if (ownsDatabase) { await owned(); await writeDb.dropDatabase(); } }
    finally { await Promise.all([reader?.close(), writer?.close()]); }
  });

  it('un inventaire vide ne crée ni les collections absentes ni leurs index', async () => {
    const before = await stored();
    expect(before.map((entry) => entry.name)).toEqual(['_test_run', MODELS.Tenant.collection]);
    const result = await read();
    expect(result.scan).toMatchObject({ complete: true, counts: { orders: 0, admissions: 0, days: 0 } });
    expect(result.report).toMatchObject({ status: 'reviewed', occupants: [] });
    expect(await stored()).toEqual(before);
  });

  it('lit les champs select:false réels et conserve le calendrier figé sans exposer les données privées', async () => {
    const row = order();
    await writeDb.collection(MODELS.Order.collection).insertOne(row);
    await writeDb.collection(MODELS.PublicOrderAdmission.collection).insertOne(admission(row));
    await writeDb.collection(MODELS.OrderCapacityDay.collection).insertOne(frozen());
    expect(MODELS.Tenant.schema.path('capacityControl').options.select).toBe(false);
    expect(MODELS.Order.schema.path('publicRecovery').options.select).toBe(false);
    for (const path of ['kind', 'channel', 'proofHash', 'payloadHash', 'snapshot', 'capacity']) {
      expect(MODELS.PublicOrderAdmission.schema.path(path).options.select).toBe(false);
    }
    const before = await stored();
    const result = await read();
    expect(result.scan).toMatchObject({ complete: true, counts: { orders: 1, admissions: 1, days: 1 } });
    expect(result.report).toMatchObject({ status: 'reviewed', issues: [], occupants: [
      { orderId: row._id.toHexString(), admissionId: orderAdmissionId(TENANT, row.clientId), source: 'order' },
    ] });
    expect(result.report?.days[0]).toMatchObject({ frozen: true, sourceRevision: 3,
      slots: [{ kitchenCapacity: 2, kitchenUsed: 1 }] });
    expect(JSON.stringify(observedRows)).not.toContain(PRIVATE_SENTINEL);
    expect(await stored()).toEqual(before);
  });

  it('projette le snapshot committing privé sans ses prix, lignes ni coordonnées', async () => {
    const row = order();
    await writeDb.collection(MODELS.PublicOrderAdmission.collection).insertOne(admission(row, { state: 'committing', snapshot: row }));
    const result = await read();
    expect(result.scan.complete).toBe(true);
    blocked(result, 'materialization_required');
    expect(result.report?.occupants).toEqual([expect.objectContaining({ orderId: row._id.toHexString(), source: 'committing_snapshot' })]);
    expect(JSON.stringify(observedRows)).not.toContain(PRIVATE_SENTINEL);
  });

  it.each([{ channel: 'online', type: 'pickup' }, { channel: 'phone', type: 'pickup' },
    { channel: 'pos', type: 'emporter' }, { channel: 'online', type: 'delivery' }])(
    'reconnaît un historique réel $channel/$type sans preuve ni double occupation', async ({ channel, type }) => {
      const row = order(1, { channel, type }); delete row.publicRecovery;
      await writeDb.collection(MODELS.Order.collection).insertOne(row);
      await writeDb.collection(MODELS.PublicOrderAdmission.collection).insertOne(historical(row));
      await writeDb.collection(MODELS.OrderCapacityDay.collection).insertOne(frozen());
      const before = await stored();
      const result = await read();
      expect(result.report).toMatchObject({ status: 'reviewed', issues: [], occupants: [{ source: 'order', orderId: row._id.toHexString() }] });
      expect(result.report?.days[0]?.slots[0]).toMatchObject({ kitchenUsed: 1, deliveryUsed: type === 'delivery' ? 1 : 0 });
      const projected = observedRows.find((value) => value.kind === 'historical');
      for (const key of ['proofHash', 'payloadHash', 'snapshot', 'validationOwner', 'rejection']) expect(projected).not.toHaveProperty(key);
      expect(await stored()).toEqual(before);
    });

  it.each([
    ['validationOwner', null], ['validationOwner', PRIVATE_SENTINEL], ['rejection', null], ['rejection', { private: PRIVATE_SENTINEL }],
    ['proofHash', PROOF], ['payloadHash', PAYLOAD], ['snapshot', null],
  ])('refuse le champ interdit historique %s tout en masquant sa valeur privée', async (field, value) => {
    const row = order(1, { publicRecovery: null });
    await writeDb.collection(MODELS.Order.collection).insertOne(row);
    await writeDb.collection(MODELS.PublicOrderAdmission.collection).insertOne(historical(row, { [field as string]: value }));
    blocked(await read(), 'invalid_admission');
    expect(JSON.stringify(observedRows)).not.toContain(PRIVATE_SENTINEL);
    if (field === 'validationOwner' || field === 'rejection') {
      expect(observedRows.find((entry) => entry.kind === 'historical')?.[field]).toBe('__invalid_persisted_capacity_value__');
    }
  });

  it.each([
    { version: 2 }, { bootstrapId: 'not-a-uuid' }, { importedAt: '2030-05-02T08:00:00.000Z' },
  ])('ne caste ni ne répare une provenance historique BSON invalide %j', async (patch) => {
    const row = order(1, { publicRecovery: null });
    const imported = historical(row);
    imported.historicalImport = { ...imported.historicalImport, ...patch };
    await writeDb.collection(MODELS.Order.collection).insertOne(row);
    await writeDb.collection(MODELS.PublicOrderAdmission.collection).insertOne(imported);
    blocked(await read(), 'invalid_admission');
  });

  it('omet même les marqueurs de propriétaire sur C01, mais refuse une provenance import ajoutée', async () => {
    const row = order();
    await writeDb.collection(MODELS.Order.collection).insertOne(row);
    await writeDb.collection(MODELS.PublicOrderAdmission.collection).insertOne(admission(row, { historicalImport: historical(row).historicalImport }));
    blocked(await read(), 'invalid_admission');
    const projected = observedRows.find((entry) => entry.kind === 'public');
    expect(projected).not.toHaveProperty('validationOwner');
    expect(projected).not.toHaveProperty('rejection');
  });

  it('ne fabrique pas l’Order manquante à partir d’une admission historique terminale', async () => {
    const row = order(1, { publicRecovery: null });
    await writeDb.collection(MODELS.PublicOrderAdmission.collection).insertOne(historical(row));
    const before = await stored();
    blocked(await read(), 'missing_order');
    expect(await stored()).toEqual(before);
  });

  it('refuse un historique attaché à une Order protégée, sans adopter sa preuve', async () => {
    const row = order();
    await writeDb.collection(MODELS.Order.collection).insertOne(row);
    await writeDb.collection(MODELS.PublicOrderAdmission.collection).insertOne(historical(row));
    blocked(await read(), 'recovery_binding_mismatch');
  });

  it('refuse une capacité historique ancienne avec une date de libération texte', async () => {
    const at = new Date('2029-05-02T09:00:00.000Z');
    const row = order(1, { publicRecovery: null, pickup: { slot: at } });
    await writeDb.collection(MODELS.Order.collection).insertOne(row);
    await writeDb.collection(MODELS.PublicOrderAdmission.collection).insertOne(historical(row, { capacity: { slot: at, releasedAt: '2029-05-02T10:00:00.000Z' } }));
    blocked(await read(), 'invalid_admission');
  });

  it('ne lit aucune Order, admission ou journée d’un autre tenant', async () => {
    const foreign = order(2, { tenantId: new ObjectId(OTHER_TENANT) });
    await writeDb.collection(MODELS.Order.collection).insertOne(foreign);
    await writeDb.collection(MODELS.PublicOrderAdmission.collection).insertOne(admission(foreign, { tenantId: new ObjectId(OTHER_TENANT) }));
    await writeDb.collection(MODELS.OrderCapacityDay.collection).insertOne(frozen({ tenantId: new ObjectId(OTHER_TENANT) }));
    const result = await read();
    expect(result.scan).toMatchObject({ complete: true, counts: { orders: 0, admissions: 0, days: 0 } });
    expect(result.report).toMatchObject({ status: 'reviewed', occupants: [] });
    expect(JSON.stringify(observedRows)).not.toContain(OTHER_TENANT);
  });

  it.each([{ value: TENANT }, { value: [new ObjectId(TENANT)] }])(
    'signale une référence tenantId BSON corrompue $value associable au restaurant, sans la caster', async ({ value }) => {
      await writeDb.collection(MODELS.Order.collection).insertOne(order(1, { tenantId: value, publicRecovery: null }));
      const result = await read();
      expect(result.scan.counts.orders).toBe(1);
      blocked(result, 'invalid_order');
    },
  );
  it('un ancien tenant sans capacityControl reste analytique sans activation implicite', async () => {
    await writeDb.collection(MODELS.Tenant.collection).updateOne({ _id: new ObjectId(TENANT) }, { $unset: { capacityControl: '' } });
    const result = await read();
    expect(result.scan.complete).toBe(true);
    expect(result.report).toMatchObject({ status: 'reviewed', issues: [], days: [expect.objectContaining({ sourceRevision: 0, frozen: false })] });
    expect(await writeDb.collection(MODELS.Tenant.collection).findOne({ _id: new ObjectId(TENANT) })).not.toHaveProperty('capacityControl');
  });
  it('un capacityControl explicitement null est invalide, pas un ancien tenant sans contrôle', async () => {
    await writeDb.collection(MODELS.Tenant.collection).updateOne({ _id: new ObjectId(TENANT) }, { $set: { capacityControl: null } });
    incomplete(await read(), 'invalid_tenant', 'tenant');
  });

  it.each([{ value: 'scalaire' }, { value: [] }])('ne transforme pas publicRecovery malformé $value en commande legacy', async ({ value }) => {
    await writeDb.collection(MODELS.Order.collection).insertOne(order(1, { publicRecovery: value }));
    blocked(await read(), 'invalid_order');
  });
  it.each([{ value: 'scalaire' }, { value: [] }])('ne transforme pas snapshot malformé $value en snapshot purgé', async ({ value }) => {
    const row = order();
    await writeDb.collection(MODELS.Order.collection).insertOne(row);
    await writeDb.collection(MODELS.PublicOrderAdmission.collection).insertOne(admission(row, { snapshot: value }));
    blocked(await read(), 'terminal_admission_conflict');
  });
  it.each([{ value: 'scalaire' }, { value: [] }])('ne transforme pas capacity malformé $value en admission sans réservation', async ({ value }) => {
    const row = order();
    await writeDb.collection(MODELS.Order.collection).insertOne(row);
    await writeDb.collection(MODELS.PublicOrderAdmission.collection).insertOne(admission(row, { capacity: value }));
    blocked(await read(), 'invalid_capacity_claim');
  });
  it('ne convertit pas une date de créneau stockée en string en preuve BSON valide', async () => {
    await writeDb.collection(MODELS.Order.collection).insertOne(order(1, { pickup: { slot: SLOT.toISOString() }, publicRecovery: null }));
    blocked(await read(), 'invalid_order');
  });
  it('ne répare pas un tenantId texte corrompu dans le snapshot Mixed, que le writer caste avant persistance', async () => {
    const row = order();
    await writeDb.collection(MODELS.PublicOrderAdmission.collection).insertOne(admission(row, {
      state: 'committing', snapshot: { ...row, tenantId: TENANT },
    }));
    const result = await read();
    expect(result.scan.complete).toBe(true);
    blocked(result, 'invalid_snapshot');
  });
  it('retrouve une admission ancienne dont le snapshot réserve une date future', async () => {
    const row = order();
    await writeDb.collection(MODELS.PublicOrderAdmission.collection).insertOne(admission(row, {
      state: 'committing', slot: new Date('2029-05-02T09:00:00.000Z'), snapshot: row,
    }));
    const result = await read();
    expect(result.scan.counts.admissions).toBe(1);
    blocked(result, 'admission_identity_mismatch');
  });

  it('lit réellement trois batches Mongo pour 130 tickets, sans troncature au premier lot', async () => {
    await writeDb.collection(MODELS.Order.collection).insertMany(Array.from({ length: 130 }, (_, index) =>
      order(index + 1, { publicRecovery: null, channel: 'pos', type: 'surplace', pickup: null })));
    const start = commands.length;
    const result = await read();
    expect(result.scan).toMatchObject({ complete: true, counts: { orders: 130 } });
    expect(result.report).toMatchObject({ status: 'reviewed', occupants: [] });
    const more = commands.slice(start).filter((entry) => entry.name === 'getMore' && entry.command.collection === MODELS.Order.collection);
    expect(more.length).toBeGreaterThanOrEqual(2);
  });
  it('une limite de documents atteinte refuse un inventaire partiel', async () => {
    await writeDb.collection(MODELS.Order.collection).insertMany(Array.from({ length: 3 }, (_, index) =>
      order(index + 1, { publicRecovery: null })));
    incomplete(await read(readDb, { maxDocuments: 2 }), 'document_limit', 'orders');
  });
  it('une limite de volume atteinte refuse un inventaire partiel', async () => {
    await writeDb.collection(MODELS.Order.collection).insertOne(order(1, { clientId: 'x'.repeat(8_192) }));
    incomplete(await read(readDb, { maxBytes: 1_024 }), 'byte_limit', 'orders');
  });
  it('une limite de jours atteinte refuse l’analyse sans masquer les dates lointaines', async () => {
    await writeDb.collection(MODELS.Order.collection).insertOne(order(1, {
      publicRecovery: null, pickup: { slot: new Date('2040-05-02T09:00:00.000Z') },
    }));
    incomplete(await read(readDb, { maxDays: 1 }), 'day_limit', 'orders');
  });
  it('une réponse réelle arrivant après le budget temporel ne produit pas un rapport complet', async () => {
    let delayed = false;
    const db = intercept(readDb, { afterNext: async (name, row) => {
      if (name === MODELS.Tenant.collection && row && !delayed) { delayed = true; await delay(250); }
    } });
    incomplete(await read(db, { maxDurationMs: 200 }), 'deadline_exceeded');
    expect(delayed).toBe(true);
  });

  it('un changement réel de contrôle entre lecture et relecture invalide l’inventaire', async () => {
    let changed = false;
    const db = intercept(readDb, { afterNext: async (name, row) => {
      if (name === MODELS.Tenant.collection && row && !changed) {
        changed = true;
        await writeDb.collection(MODELS.Tenant.collection).updateOne({ _id: new ObjectId(TENANT) }, { $inc: { 'capacityControl.configRevision': 1 } });
      }
    } });
    incomplete(await read(db), 'tenant_changed', 'tenant_recheck');
    expect(changed).toBe(true);
  });
  it('la disparition du contrôle entre lecture et relecture ne devient pas un tenant legacy valide', async () => {
    let changed = false;
    const db = intercept(readDb, { afterNext: async (name, row) => {
      if (name === MODELS.Tenant.collection && row && !changed) {
        changed = true;
        await writeDb.collection(MODELS.Tenant.collection).updateOne({ _id: new ObjectId(TENANT) }, { $unset: { capacityControl: '' } });
      }
    } });
    incomplete(await read(db), 'tenant_changed', 'tenant_recheck');
    expect(changed).toBe(true);
  });
  it('une intention créée sans changer configRevision invalide aussi le scan avant/après', async () => {
    let changed = false;
    const plan = { day: DAY, sourceRevision: 7, closedReason: null,
      slots: [{ at: SLOT, kitchenCapacity: 4, deliveryCapacity: 2 }] };
    const intent = { ...plan, operationId: randomUUID(), planHash: orderCapacityCalendarPlanHash(plan) };
    const db = intercept(readDb, { afterNext: async (name, row) => {
      if (name === MODELS.Tenant.collection && row && !changed) {
        changed = true;
        await writeDb.collection(MODELS.Tenant.collection).updateOne({ _id: new ObjectId(TENANT) }, { $set: { 'capacityControl.dayIntent': intent } });
      }
    } });
    incomplete(await read(db), 'tenant_changed', 'tenant_recheck');
    expect(changed).toBe(true);
    const persisted = await writeDb.collection(MODELS.Tenant.collection).findOne({ _id: new ObjectId(TENANT) });
    expect(persisted?.capacityControl.configRevision).toBe(7);
    expect(persisted?.capacityControl.dayIntent).toEqual(intent);
  });
  it('une erreur à la relecture finale ne retourne pas le rapport déjà calculé', async () => {
    let tenantReads = 0;
    const db = intercept(readDb, { beforeAggregate: (name) => {
      if (name === MODELS.Tenant.collection && ++tenantReads === 2) throw new Error(PRIVATE_SENTINEL);
    } });
    incomplete(await read(db), 'read_failed', 'tenant_recheck');
    expect(tenantReads).toBe(2);
  });
  it('une erreur de curseur après un vrai getMore clôt le curseur et refuse tout rapport partiel', async () => {
    await writeDb.collection(MODELS.Order.collection).insertMany(Array.from({ length: 130 }, (_, index) =>
      order(index + 1, { publicRecovery: null, channel: 'pos', pickup: null })));
    let rows = 0; let closed = false;
    const start = commands.length;
    const db = intercept(readDb, {
      afterNext: async (name, row) => {
        if (name === MODELS.Order.collection && row && ++rows === 70) throw new Error(PRIVATE_SENTINEL);
      },
      closed: (name) => { if (name === MODELS.Order.collection) closed = true; },
    });
    incomplete(await read(db), 'read_failed', 'orders');
    expect(rows).toBe(70); expect(closed).toBe(true);
    expect(commands.slice(start).some((entry) => entry.name === 'getMore' && entry.command.collection === MODELS.Order.collection)).toBe(true);
    expect(commands.slice(start).some((entry) => entry.name === 'killCursors' && entry.command.killCursors === MODELS.Order.collection)).toBe(true);
  });
});
