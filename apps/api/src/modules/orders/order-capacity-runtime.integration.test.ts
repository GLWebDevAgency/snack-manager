import { randomUUID } from 'node:crypto';
import mongoose, { Types, type Connection, type Model, type Query } from 'mongoose';
import { MODELS, type Order, type PublicOrderAdmission } from '@sm/db';
import { CreateOrderSchema, CreatePublicOrderSchema, type CreateOrder } from '@sm/contracts';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { OrdersService } from './orders.service';
import { OrdersController } from './orders.controller';
import { PublicOrderAdmissionService } from './public-order-admission.service';
import { capacityModels, seedCapacityFixture } from './order-capacity-test-fixtures';
import { publicRecoveryBinding } from './order-recovery';
import { orderAdmissionId } from './order-admission-identity';
import { OrderCapacityAvailabilityService } from '../ordering/order-capacity-availability.service';

const TENANT = '507f1f77bcf86cd799439011';
const PRODUCT = '507f1f77bcf86cd799439012';
const SLOT = '2030-05-02T09:00:00.000Z';
const PRIVATE = '+kind +channel +proofHash +payloadHash +snapshot +capacity +validationOwner +historicalImport';
const RUN_ID = randomUUID();

export function capacityRuntimeTestDatabase(raw: string): string {
  const url = new URL(raw);
  if (url.protocol !== 'mongodb:' || !['localhost', '127.0.0.1'].includes(url.hostname)
    || url.username || url.password || url.search || url.hash
    || !/^\/snackmanager_runtime_test_[a-z0-9_]{1,20}$/i.test(url.pathname)) {
    throw new Error('ORDER_CAPACITY_RUNTIME_TEST_MONGO_URL doit cibler une base isolée locale snackmanager_runtime_test_ sans options.');
  }
  url.pathname += `_${randomUUID().replaceAll('-', '').slice(0, 10)}`;
  return url.toString();
}
const uri = process.env.ORDER_CAPACITY_RUNTIME_TEST_MONGO_URL
  ? capacityRuntimeTestDatabase(process.env.ORDER_CAPACITY_RUNTIME_TEST_MONGO_URL) : null;
const integration = uri ? describe : describe.skip;

describe('cible Mongo du runtime C15', () => {
  const credentials = new URL('mongodb://localhost/snackmanager_runtime_test_ci');
  credentials.username = 'synthetic'; credentials.password = 'synthetic';
  it.each(['mongodb://remote.example/snackmanager_runtime_test_ci', 'mongodb+srv://localhost/snackmanager_runtime_test_ci',
    'mongodb://localhost/admin', 'mongodb://localhost/snackmanager',
    'mongodb://localhost/snackmanager_runtime_test_ci?replicaSet=production',
    'mongodb://localhost/snackmanager_runtime_test_ci#fragment', credentials.toString()])('refuse %s sans I/O', (raw) => {
    expect(() => capacityRuntimeTestDatabase(raw)).toThrow();
  });
  it('alloue une base propre à chaque exécution', () => {
    const target = 'mongodb://127.0.0.1:27037/snackmanager_runtime_test_local';
    expect(capacityRuntimeTestDatabase(target)).not.toBe(capacityRuntimeTestDatabase(target));
  });
});

function models(db: Connection) {
  return { ...capacityModels(db),
    orders: db.model(MODELS.Order.name, MODELS.Order.schema, MODELS.Order.collection),
    admissions: db.model(MODELS.PublicOrderAdmission.name, MODELS.PublicOrderAdmission.schema, MODELS.PublicOrderAdmission.collection),
    products: db.model(MODELS.Product.name, MODELS.Product.schema, MODELS.Product.collection),
    counters: db.model(MODELS.Counter.name, MODELS.Counter.schema, MODELS.Counter.collection),
    promotions: db.model(MODELS.Promotion.name, MODELS.Promotion.schema, MODELS.Promotion.collection),
  };
}
type Models = ReturnType<typeof models>;
const redis = { publish: vi.fn().mockResolvedValue(1) };
function replica(stored: Models, overrides: { orders?: Model<Order>; admissions?: Model<PublicOrderAdmission> } = {}) {
  const orders = overrides.orders ?? stored.orders; const admissions = overrides.admissions ?? stored.admissions;
  const facade = new PublicOrderAdmissionService(admissions, orders, redis as never, stored.days, stored.tenants);
  const service = new OrdersService(orders, stored.products, stored.counters, stored.promotions, redis as never,
    {} as never, stored.tenants, { pourTenant: async () => ['bo', 'online'] } as never, {} as never, facade);
  return { facade, service };
}
type Replica = ReturnType<typeof replica>;
type Origin = 'public' | 'legacy' | 'staff';
function request(origin: Origin, clientId = randomUUID(), changes: Partial<CreateOrder> = {}) {
  return CreateOrderSchema.parse({ clientId, channel: origin === 'staff' ? 'phone' : 'online', type: 'pickup',
    lines: [{ productId: PRODUCT, qty: 1 }], payment: { method: 'counter' },
    pickup: { slot: SLOT, customerName: 'Client de recette', customerPhone: '0600000000' }, ...changes });
}
async function create(actor: Replica, origin: Origin, body = request(origin)) {
  if (origin === 'public') {
    const publicBody = publicRequest(body);
    const result = await actor.facade.begin(TENANT, publicBody);
    if (result.state === 'created') return { order: await actor.facade.createdOrder(TENANT, publicBody), created: false };
    if (result.state === 'rejected') throw new Error('Tentative publique rejetée');
    const owner = await actor.facade.claimValidation(TENANT, body.clientId, publicRecoveryBinding(TENANT, publicBody)!);
    if (!owner) throw new Error('Le vrai journal n’a pas attribué le propriétaire de recette.');
    return actor.service.createWithOutcome(TENANT, body, 'online:fixture', null, owner);
  }
  return actor.service.createWithOutcome(TENANT, body, `${origin}:fixture`, null, undefined, origin);
}
function publicRequest(body: CreateOrder) {
  const { channel: _channel, type: _type, ...publicFields } = body;
  return CreatePublicOrderSchema.parse({ ...publicFields, recoveryProof: 'ab'.repeat(32), turnstileToken: 'fixture-only' });
}
function interruptedInsert(model: Model<Order>, when: 'before' | 'after') {
  let enabled = true;
  const failure = new Error(`Réponse Mongo indisponible (${when} insertion)`);
  const wrapped = new Proxy(model, { get(target, key, receiver) {
    if (key !== 'updateOne') return Reflect.get(target, key, receiver);
    return (...args: unknown[]) => {
      const query = Reflect.apply(target.updateOne, target, args) as Query<unknown, Order>;
      const execute = query.exec.bind(query);
      query.exec = async () => {
        if (!enabled || !(args[1] as { $setOnInsert?: unknown })?.$setOnInsert) return execute();
        if (when === 'after') await execute();
        throw failure;
      };
      return query;
    };
  } });
  return { model: wrapped, failure, restore: () => { enabled = false; } };
}
function barrier() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => { release = resolve; });
  return { promise, release };
}
function interceptTransition(model: Model<PublicOrderAdmission>, state: 'committing' | 'rejected', effect: (run: () => Promise<unknown>) => Promise<unknown>) {
  let armed = true;
  return new Proxy(model, { get(target, key) {
    const value = Reflect.get(target, key, target);
    if (key !== 'updateOne') return typeof value === 'function' ? value.bind(target) : value;
    return (...args: unknown[]) => {
      const query = Reflect.apply(value, target, args) as Query<unknown, PublicOrderAdmission>;
      const execute = query.exec.bind(query);
      query.exec = async () => {
        if (!armed || (args[1] as { $set?: { state?: string } }).$set?.state !== state) return execute();
        armed = false;
        return effect(execute);
      };
      return query;
    };
  } });
}

integration('runtime capacité — services réels, trois origines, deux connexions Mongo', () => {
  let dbA: Connection; let dbB: Connection;
  let first: Models; let second: Models;
  let a: Replica; let b: Replica; let ownsDatabase = false;
  async function owned() {
    if (!uri || !ownsDatabase || dbA.name !== new URL(uri).pathname.slice(1)
      || !/^snackmanager_runtime_test_[a-z0-9_]+_[a-f0-9]{10}$/i.test(dbA.name)
      || !await dbA.db!.collection('_test_run').findOne({ runId: RUN_ID })) throw new Error('Base runtime de recette non possédée.');
  }
  beforeAll(async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2030-05-02T07:00:00.000Z'));
    dbA = await mongoose.createConnection(uri!, { autoCreate: false, autoIndex: false }).asPromise();
    expect(await dbA.db!.listCollections({}, { nameOnly: true }).toArray()).toEqual([]);
    await dbA.db!.collection('_test_run').insertOne({ runId: RUN_ID }); ownsDatabase = true;
    dbB = await mongoose.createConnection(uri!, { autoCreate: false, autoIndex: false }).asPromise();
    first = models(dbA); second = models(dbB);
    for (const model of Object.values(first)) { await model.createCollection(); await model.createIndexes(); }
  }, 20_000);
  beforeEach(async () => {
    await owned(); vi.restoreAllMocks(); redis.publish.mockClear();
    for (const model of Object.values(first)) await model.collection.deleteMany({});
    await seedCapacityFixture(dbA, TENANT, SLOT, 1);
    await first.products.collection.insertOne({ _id: new Types.ObjectId(PRODUCT), tenantId: new Types.ObjectId(TENANT),
      name: 'Article de recette', price: 1_250, active: true, variants: [], optionGroups: [] } as never);
    a = replica(first); b = replica(second);
  });
  afterAll(async () => {
    vi.restoreAllMocks();
    try { if (ownsDatabase) { await owned(); await dbA.dropDatabase(); } }
    finally { await Promise.all([dbA?.close(), dbB?.close()]); vi.useRealTimers(); }
  });

  it('le vrai upsert C01 applique ses défauts sans this.kind sur un contexte null', async () => {
    const body = request('public');
    const publicBody = publicRequest(body);
    await expect(a.facade.begin(TENANT, publicBody)).resolves.toEqual({ state: 'pending' });
    const stored = await first.admissions.findById(orderAdmissionId(TENANT, body.clientId)).select(PRIVATE).lean();
    expect(stored).toMatchObject({ kind: 'public', state: 'validating', snapshot: null, validationOwner: null, rejection: null });
    expect(stored).not.toHaveProperty('historicalImport');
  });

  it('readDay et previewDay lisent le contrôle select:false via la vraie projection Mongo, sans exposer le contrôle', async () => {
    const hidden = await first.tenants.findById(TENANT).lean();
    expect(hidden).not.toHaveProperty('capacityControl');
    const availability = new OrderCapacityAvailabilityService(first.tenants, first.days, first.admissions, first.orders);
    const preview = await availability.previewDay(TENANT, '2030-05-02');
    expect(preview).toMatchObject({ day: '2030-05-02', sourceRevision: 0 });
    expect(preview).not.toHaveProperty('capacityControl');
    const empty = await availability.readDay(TENANT, '2030-05-02');
    expect(empty.slots).toEqual([{ at: new Date(SLOT), kitchenCapacity: 1, deliveryCapacity: 1, kitchenTaken: 0, deliveryTaken: 0 }]);
    await create(b, 'staff');
    const occupied = await availability.readDay(TENANT, '2030-05-02');
    expect(occupied.slots).toEqual([{ ...empty.slots[0], kitchenTaken: 1 }]);
    expect(occupied).not.toHaveProperty('capacityControl');
  });

  it.each<Origin>(['public', 'legacy', 'staff'])('%s crée par le vrai journal et conserve une seule place lors du rejeu', async (origin) => {
    const body = request(origin);
    const created = await create(a, origin, body);
    expect(created.created).toBe(true);
    expect(created.order.totals.total).toBe(1_250);
    const stored = await first.admissions.findById(orderAdmissionId(TENANT, body.clientId)).select(PRIVATE).lean();
    expect(stored).toMatchObject({ kind: origin, state: 'created', snapshot: null,
      capacity: { slot: new Date(SLOT), kitchenSeat: 0 } });
    const retry = await create(b, origin, body);
    expect(retry.created).toBe(false);
    expect(String(retry.order._id)).toBe(String(created.order._id));
    expect(await first.orders.countDocuments()).toBe(1);
    expect(await first.admissions.countDocuments({ 'capacity.kitchenSeat': { $type: 'number' } })).toBe(1);
  });

  it.each<Origin>(['public', 'legacy', 'staff'])('%s contre deux autres origines : une seule commande pour la dernière place', async (firstOrigin) => {
    const origins: Origin[] = [firstOrigin, ...(['public', 'legacy', 'staff'] as const).filter((origin) => origin !== firstOrigin)];
    const bodies = origins.map((origin) => request(origin));
    const results = await Promise.allSettled(origins.map((origin, index) => create(index % 2 ? b : a, origin, bodies[index])));
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(2);
    expect(await first.orders.countDocuments()).toBe(1);
    const admissions = await first.admissions.find().select(PRIVATE).lean();
    expect(admissions).toHaveLength(3);
    expect(admissions.filter((item) => item.state === 'created')).toHaveLength(1);
    expect(admissions.filter((item) => item.state === 'rejected' && item.rejection === 'slot_unavailable')).toHaveLength(2);
    expect(admissions.filter((item) => item.capacity?.kitchenSeat === 0)).toHaveLength(1);
    expect(admissions.filter((item) => item.state === 'rejected').every((item) => !item.capacity)).toBe(true);
  });

  it('deux vrais services choisissent le siège zéro avant leurs CAS : index arbitre, perdant rejeté durablement', async () => {
    const gate = barrier(); let reached = 0;
    const sameSeat = async (run: () => Promise<unknown>) => {
      if (++reached === 2) gate.release();
      await gate.promise;
      return run();
    };
    const firstActor = replica(first, { admissions: interceptTransition(first.admissions, 'committing', sameSeat) });
    const secondActor = replica(second, { admissions: interceptTransition(second.admissions, 'committing', sameSeat) });
    const pending = Promise.allSettled([create(firstActor, 'legacy'), create(secondActor, 'staff')]);
    // La borne libère également le premier writer si l'autre ne rejoint pas le CAS.
    const timeout = setTimeout(gate.release, 2_000);
    try {
      const results = await pending;
      expect(reached).toBe(2);
      expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
      expect(await first.orders.countDocuments()).toBe(1);
      expect(await first.admissions.countDocuments({ state: 'rejected', rejection: 'slot_unavailable' })).toBe(1);
      expect(await first.admissions.countDocuments({ 'capacity.kitchenSeat': 0 })).toBe(1);
    } finally { clearTimeout(timeout); gate.release(); await pending; }
  });

  it('une même clé client présentée par trois origines ne crée ni deuxième identité ni deuxième ticket', async () => {
    const clientId = randomUUID();
    const results = await Promise.allSettled((['public', 'legacy', 'staff'] as const)
      .map((origin, index) => create(index % 2 ? b : a, origin, request(origin, clientId))));
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(await first.admissions.countDocuments({ tenantId: TENANT, clientId })).toBe(1);
    expect(await first.orders.countDocuments({ tenantId: TENANT, clientId })).toBe(1);
    expect(await first.admissions.countDocuments({ 'capacity.kitchenSeat': 0 })).toBe(1);
  });

  it.each(['before', 'after'] as const)('capacité pleine, réponse du rejet perdue %s CAS : refus définitif seulement avec preuve persistée', async (when) => {
    await create(b, 'public');
    const body = request('staff');
    const faulty = replica(first, { admissions: interceptTransition(first.admissions, 'rejected', async (run) => {
      if (when === 'after') await run();
      throw new Error('Réponse du rejet Mongo indisponible');
    }) });
    const outcome = await create(faulty, 'staff', body).then(() => null, (error: unknown) => error);
    expect(outcome).toMatchObject({ status: when === 'before' ? 503 : 409 });
    const observed = await first.admissions.findById(orderAdmissionId(TENANT, body.clientId)).select(PRIVATE).lean();
    expect(observed).toMatchObject({ state: when === 'before' ? 'validating' : 'rejected',
      rejection: when === 'before' ? null : 'slot_unavailable', snapshot: null });
    expect(observed?.capacity).toBeUndefined();
    expect(await first.orders.countDocuments()).toBe(1);
  });

  it.each(['legacy', 'staff'] as const)('%s : une panne avant insertion laisse un snapshot engagé, repris sans nouveau prix ni numéro', async (origin) => {
    const body = request(origin);
    const fault = interruptedInsert(first.orders, 'before');
    try {
      await expect(create(replica(first, { orders: fault.model }), origin, body)).rejects.toThrow(fault.failure.message);
    } finally { fault.restore(); }
    const pending = await first.admissions.findById(orderAdmissionId(TENANT, body.clientId)).select(PRIVATE).lean();
    expect(pending).toMatchObject({ state: 'committing', capacity: { kitchenSeat: 0 }, snapshot: { totals: { total: 1_250 } } });
    expect(await first.orders.countDocuments()).toBe(0);
    const counters = await first.counters.find().lean();
    await first.products.collection.updateOne({ _id: new Types.ObjectId(PRODUCT) }, { $set: { price: 9_900, active: false } });
    const replay = await create(b, origin, body);
    expect(replay.created).toBe(false);
    expect(String(replay.order._id)).toBe(String(pending?.orderId));
    expect(replay.order.totals.total).toBe(1_250);
    expect(await first.counters.find().lean()).toEqual(counters);
    expect(await first.orders.countDocuments()).toBe(1);
    expect(await first.admissions.findById(pending!._id).select(PRIVATE).lean()).toMatchObject({ state: 'created', snapshot: null });
  });

  it.each(['legacy', 'staff'] as const)('%s : réponse perdue après insertion récupérée par lecture sans seconde commande', async (origin) => {
    const body = request(origin); const fault = interruptedInsert(first.orders, 'after');
    let result: Awaited<ReturnType<typeof create>>;
    try { result = await create(replica(first, { orders: fault.model }), origin, body); }
    finally { fault.restore(); }
    const replay = await create(b, origin, body);
    expect(String(replay.order._id)).toBe(String(result.order._id));
    expect(await first.orders.countDocuments()).toBe(1);
    expect(await first.admissions.countDocuments({ state: 'created' })).toBe(1);
  });

  it('le POST legacy reprend committing avant pause, créneau plein et nouveau Turnstile', async () => {
    const body = request('legacy');
    const fault = interruptedInsert(first.orders, 'before');
    try { await expect(create(replica(first, { orders: fault.model }), 'legacy', body)).rejects.toThrow(fault.failure.message); }
    finally { fault.restore(); }
    const pending = await first.admissions.findById(orderAdmissionId(TENANT, body.clientId)).select(PRIVATE).lean();
    expect(pending?.state).toBe('committing');
    const counters = await first.counters.find().lean();
    const slots = { exigerDisponible: vi.fn().mockRejectedValue(new Error('Créneau complet')) };
    const gate = { authorize: vi.fn().mockRejectedValue(new Error('Ancien Turnstile consommé')), release: vi.fn(), serializeSlot: vi.fn() };
    const controller = new OrdersController(b.service, {} as never, {
      bySlug: async () => ({ _id: TENANT, settings: { onlineOrderingPaused: true } }),
    } as never, slots as never, gate as never, b.facade);
    const { recoveryProof: _unused, ...publicBody } = publicRequest(body);
    const result = await controller.createOnline('restaurant', publicBody);
    expect(result).toMatchObject({ number: pending?.snapshot?.number, totals: { total: 1_250 } });
    expect(String((result as { _id: unknown })._id)).toBe(String(pending?.orderId));
    expect(slots.exigerDisponible).not.toHaveBeenCalled();
    expect(gate.authorize).not.toHaveBeenCalled();
    expect(gate.release).not.toHaveBeenCalled();
    expect(await first.orders.countDocuments()).toBe(1);
    expect(await first.counters.find().lean()).toEqual(counters);
  });

  it.each(['absent', 'seeding', 'blocked'] as const)('%s : aucune origine ne crée avant activation complète', async (state) => {
    if (state === 'absent') await first.tenants.collection.updateOne({ _id: new Types.ObjectId(TENANT) }, { $unset: { capacityControl: '' } });
    else await first.tenants.collection.updateOne({ _id: new Types.ObjectId(TENANT) }, { $set: { 'capacityControl.state': state } });
    const results = await Promise.allSettled((['public', 'legacy', 'staff'] as const).map((origin) => create(a, origin)));
    expect(results.every((result) => result.status === 'rejected')).toBe(true);
    expect(await first.orders.countDocuments()).toBe(0);
    expect(await first.admissions.countDocuments()).toBe(0);
    expect(await first.counters.countDocuments()).toBe(0);
  });

  it.each(['legacy', 'staff'] as const)('%s : body modifié, canal échangé, slot retiré ou preuve publique ne peuvent adopter la commande', async (origin) => {
    const body = request(origin); await create(a, origin, body);
    const before = await first.orders.find().select('+publicRecovery').lean();
    await expect(create(b, origin, { ...body, lines: [{ ...body.lines[0]!, qty: 2 }] })).rejects.toThrow();
    const changedChannel = origin === 'staff' ? 'pos' : 'phone';
    await expect(create(b, origin, { ...body, channel: changedChannel })).rejects.toThrow();
    await expect(create(b, origin, { ...body, pickup: undefined })).rejects.toThrow();
    await expect(b.facade.recover(TENANT, body.clientId, 'ab'.repeat(32))).rejects.toThrow();
    await expect(b.facade.begin(TENANT, publicRequest({ ...body, channel: 'online' }))).rejects.toThrow();
    expect(await first.orders.find().select('+publicRecovery').lean()).toEqual(before);
  });

  it('une admission historique renvoie exclusivement sa commande exacte sans réinventer prix, preuve ni numéro', async () => {
    const body = request('staff'); const created = await create(a, 'staff', body);
    const original = await first.admissions.findById(orderAdmissionId(TENANT, body.clientId)).select(PRIVATE).lean();
    const control = await first.tenants.findById(TENANT).select('+capacityControl').lean();
    await first.admissions.deleteOne({ _id: original!._id });
    await first.admissions.create({ _id: original!._id, tenantId: new Types.ObjectId(TENANT), clientId: body.clientId,
      version: 1, kind: 'historical', channel: 'phone', state: 'created', orderId: created.order._id,
      slot: new Date(SLOT), capacity: original!.capacity,
      historicalImport: { version: 1, bootstrapId: control!.capacityControl!.bootstrapId, importedAt: new Date() } });
    const before = await first.orders.find().lean(); const counters = await first.counters.find().lean();
    await first.products.collection.deleteOne({ _id: new Types.ObjectId(PRODUCT) });
    const replay = await create(b, 'staff', { ...body, lines: [{ ...body.lines[0]!, qty: 2 }] });
    expect(replay.created).toBe(false);
    expect(String(replay.order._id)).toBe(String(created.order._id));
    expect(replay.order.totals.total).toBe(1_250);
    await expect(b.facade.recover(TENANT, body.clientId, 'ab'.repeat(32))).rejects.toThrow();
    await expect(create(b, 'staff', { ...body, channel: 'pos' })).rejects.toThrow();
    expect(await first.orders.find().lean()).toEqual(before);
    expect(await first.counters.find().lean()).toEqual(counters);
  });
});
