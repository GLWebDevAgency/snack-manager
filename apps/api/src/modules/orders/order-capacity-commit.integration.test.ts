import { randomUUID } from 'node:crypto';
import mongoose, { Types, type Connection, type Model, type Query } from 'mongoose';
import { MODELS, ORDER_CAPACITY_DAY_INDEX, ORDER_CAPACITY_INDEXES, type Order, type OrderCapacityDay, type PublicOrderAdmission } from '@sm/db';
import { CreateOrderSchema, CreatePublicOrderSchema } from '@sm/contracts';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { OrderCapacityCommitStore } from './order-capacity-commit.store';
import { PublicOrderAdmissionService } from './public-order-admission.service';
import { publicRecoveryBinding } from './order-recovery';
import { internalOrderAdmissionBinding, orderAdmissionId, type OrderAdmissionBinding, type OrderAdmissionKind } from './order-admission-identity';
import { capacityModels } from './order-capacity-test-fixtures';

const TENANT = '507f1f77bcf86cd799439011';
const OTHER_TENANT = '507f1f77bcf86cd799439021';
const PRODUCT = '507f1f77bcf86cd799439012';
const DAY = '2030-05-02';
const SLOT = '2030-05-02T16:00:00.000Z';
const NEXT_SLOT = '2030-05-02T16:30:00.000Z';
const PRIVATE = '+kind +channel +proofHash +payloadHash +validationOwner +snapshot +capacity';

export function capacityTestDatabase(raw: string): string {
  const url = new URL(raw);
  if (url.protocol !== 'mongodb:' || !['localhost', '127.0.0.1'].includes(url.hostname)
    || url.username || url.password || url.search || url.hash
    || !/^\/snackmanager_capacity_test_[a-z0-9_]{1,20}$/i.test(url.pathname)) {
    throw new Error('ORDER_CAPACITY_TEST_MONGO_URL doit cibler une base isolée locale snackmanager_capacity_test_ sans options.');
  }
  url.pathname += `_${randomUUID().replaceAll('-', '').slice(0, 10)}`;
  return url.toString();
}
const uri = process.env.ORDER_CAPACITY_TEST_MONGO_URL
  ? capacityTestDatabase(process.env.ORDER_CAPACITY_TEST_MONGO_URL) : null;
const integration = uri ? describe : describe.skip;

describe('cible Mongo du socle de capacité', () => {
  const credentials = new URL('mongodb://localhost/snackmanager_capacity_test_ci');
  credentials.username = 'synthetic-user';
  credentials.password = 'synthetic-password';
  it.each([
    'mongodb://remote.example/snackmanager_capacity_test_ci',
    'mongodb://localhost/snackmanager', 'mongodb://localhost/admin',
    'mongodb://localhost/snackmanager_capacity_test_ci?replicaSet=production',
    'mongodb://localhost/snackmanager_capacity_test_ci#fragment', credentials.toString(),
  ])('refuse %s sans I/O', (value) => expect(() => capacityTestDatabase(value)).toThrow());
});

function barrier() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => { release = resolve; });
  return { promise, release };
}

function interceptCommit(model: Model<PublicOrderAdmission>, effect: (run: () => Promise<unknown>) => Promise<unknown>) {
  let armed = true;
  return new Proxy(model, { get(target, property) {
    const value = Reflect.get(target, property, target);
    if (property !== 'updateOne') return typeof value === 'function' ? value.bind(target) : value;
    return (...args: unknown[]) => {
      const query = Reflect.apply(value, target, args) as Query<unknown, PublicOrderAdmission>;
      const run = query.exec.bind(query);
      query.exec = async () => {
        const update = args[1] as { $set?: { state?: string } };
        if (!armed || update.$set?.state !== 'committing') return run();
        armed = false;
        return effect(run);
      };
      return query;
    };
  } });
}

integration('socle de sièges atomiques — vrai Mongo, non branché au runtime', () => {
  let dbA: Connection; let dbB: Connection;
  let ordersA: Model<Order>; let ordersB: Model<Order>;
  let admissionsA: Model<PublicOrderAdmission>; let admissionsB: Model<PublicOrderAdmission>;
  let daysA: Model<OrderCapacityDay>; let daysB: Model<OrderCapacityDay>;
  let first: OrderCapacityCommitStore; let second: OrderCapacityCommitStore;
  let admissionA: PublicOrderAdmissionService; let admissionB: PublicOrderAdmissionService;
  const redis = { publish: vi.fn().mockResolvedValue(1) };

  beforeAll(async () => {
    dbA = await mongoose.createConnection(uri!).asPromise();
    dbB = await mongoose.createConnection(uri!).asPromise();
    ordersA = dbA.model(MODELS.Order.name, MODELS.Order.schema, MODELS.Order.collection);
    ordersB = dbB.model(MODELS.Order.name, MODELS.Order.schema, MODELS.Order.collection);
    admissionsA = dbA.model(MODELS.PublicOrderAdmission.name, MODELS.PublicOrderAdmission.schema, MODELS.PublicOrderAdmission.collection);
    admissionsB = dbB.model(MODELS.PublicOrderAdmission.name, MODELS.PublicOrderAdmission.schema, MODELS.PublicOrderAdmission.collection);
    daysA = dbA.model(MODELS.OrderCapacityDay.name, MODELS.OrderCapacityDay.schema, MODELS.OrderCapacityDay.collection);
    daysB = dbB.model(MODELS.OrderCapacityDay.name, MODELS.OrderCapacityDay.schema, MODELS.OrderCapacityDay.collection);
    await Promise.all([ordersA.init(), admissionsA.init(), daysA.init()]);
  });
  beforeEach(async () => {
    // Nettoyage administratif de la base UUID isolée : le modèle métier
    // interdit légitimement de supprimer une journée déjà préparée.
    await Promise.all([ordersA.deleteMany({}), admissionsA.deleteMany({}), daysA.collection.deleteMany({})]);
    await Promise.all([admissionsA.createIndexes(), daysA.createIndexes()]);
    first = new OrderCapacityCommitStore(admissionsA, ordersA, daysA);
    second = new OrderCapacityCommitStore(admissionsB, ordersB, daysB);
    await capacityModels(dbA).tenants.collection.updateOne({ _id: new Types.ObjectId(TENANT) }, { $set: {
      capacityControl: { version: 1, state: 'active', bootstrapId: randomUUID(), cutoverAt: new Date(SLOT), configRevision: 0, dayIntent: null },
    } }, { upsert: true });
    admissionA = new PublicOrderAdmissionService(admissionsA, ordersA, redis as never, daysA, capacityModels(dbA).tenants);
    admissionB = new PublicOrderAdmissionService(admissionsB, ordersB, redis as never, daysB, capacityModels(dbB).tenants);
    redis.publish.mockClear();
  });
  afterAll(async () => {
    if (dbA) { await dbA.dropDatabase(); await dbA.close(); }
    if (dbB) await dbB.close();
  });

  async function calendar(kitchenCapacity = 1, deliveryCapacity = 1, state = 'ready', slots = [SLOT, NEXT_SLOT], day = DAY) {
    return daysA.create({ tenantId: TENANT, day, state, slots: slots.map((at) => ({ at: new Date(at), kitchenCapacity, deliveryCapacity })) });
  }
  async function prepared(type: 'pickup' | 'delivery' = 'pickup', slot = SLOT, kind: OrderAdmissionKind = 'public', staffChannel: 'pos' | 'phone' = 'phone') {
    const body = CreatePublicOrderSchema.parse({
      clientId: randomUUID(), recoveryProof: randomUUID().replaceAll('-', '').repeat(2), fulfillment: type,
      lines: [{ productId: PRODUCT, qty: 1 }], payment: { method: type === 'delivery' ? 'online' : 'counter' },
      pickup: { slot, customerName: 'Camille', customerPhone: '0612345678' },
      ...(type === 'delivery' ? { delivery: { address: { line1: '12 rue du Test', postalCode: '69001', city: 'Lyon', country: 'FR' } } } : {}),
      turnstileToken: 'local-proof-only',
    });
    const channel = kind === 'staff' ? staffChannel : 'online';
    let binding: OrderAdmissionBinding;
    if (kind === 'public') {
      await admissionA.begin(TENANT, body);
      binding = (await admissionA.claimValidation(TENANT, body.clientId, publicRecoveryBinding(TENANT, body)!))!;
    } else {
      // Fixture du noyau uniquement : aucun orchestrateur staff/legacy runtime
      // n'est prétendu livré par ce test de concurrence des places.
      const dto = CreateOrderSchema.parse({ ...body, channel, type });
      binding = { ...internalOrderAdmissionBinding(kind, TENANT, dto), validationOwner: randomUUID() };
      await admissionsA.create({ _id: orderAdmissionId(TENANT, body.clientId), tenantId: TENANT,
        clientId: body.clientId, ...binding, slot: new Date(slot), state: 'validating' });
    }
    const candidate: Record<string, unknown> = {
      _id: new Types.ObjectId(), tenantId: TENANT, clientId: body.clientId, channel, type,
      number: 12, lines: [], totals: { subtotal: 1250, deliveryFee: type === 'delivery' ? 250 : 0, total: type === 'delivery' ? 1500 : 1250 },
      payment: { method: type === 'delivery' ? 'online' : 'counter', status: 'pending' },
      trackingToken: randomUUID(), pickup: { ...body.pickup, slot: new Date(slot) },
      status: 'new', statusHistory: [{ status: 'new', at: new Date(), by: 'online:turnstile' }],
      ...(type === 'delivery' ? { delivery: { address: body.delivery!.address, zoneId: 'centre', zoneName: 'Centre', feeCents: 250, estimatedMinutes: 30 } } : {}),
    };
    return { body, binding, candidate };
  }
  type Prepared = Awaited<ReturnType<typeof prepared>>;
  const commit = (store: OrderCapacityCommitStore, attempt: Prepared) => store.commit(TENANT, attempt.body.clientId, attempt.binding, attempt.candidate);
  const stored = (attempt: Prepared) => admissionsB.findOne({ tenantId: TENANT, clientId: attempt.body.clientId }).select(PRIVATE).lean();
  async function materialize(attempt: Prepared, status: 'new' | 'cancelled' | 'delivered' = 'new') {
    const admission = await stored(attempt);
    expect(admission?.snapshot).toBeTruthy();
    await ordersA.create({ ...(admission!.snapshot as Record<string, unknown>), status });
    await admissionsA.updateOne({ clientId: attempt.body.clientId }, { $set: { state: 'created', snapshot: null } });
  }

  it('deux connexions sur la dernière place : un snapshot engagé, un refus, jamais deux sièges', async () => {
    await calendar();
    const a = await prepared(); const b = await prepared();
    // Les deux lectures ont réellement choisi le même siège avant les writes.
    const bothReady = barrier(); let waiting = 0;
    const collide = async (run: () => Promise<unknown>) => {
      waiting += 1;
      if (waiting === 2) bothReady.release();
      await bothReady.promise;
      return run();
    };
    const writerA = new OrderCapacityCommitStore(interceptCommit(admissionsA, collide), ordersA, daysA);
    const writerB = new OrderCapacityCommitStore(interceptCommit(admissionsB, collide), ordersB, daysB);
    const results = await Promise.all([commit(writerA, a), commit(writerB, b)]);
    expect(results.map((result) => result.state).sort()).toEqual(['committing', 'full']);
    expect(waiting).toBe(2);
    const full = results[0]?.state === 'full' ? a : b;
    expect(await stored(full)).toMatchObject({ state: 'validating', rejection: null, snapshot: null });
    const held = await admissionsB.find({ 'capacity.kitchenSeat': { $exists: true } }).select(PRIVATE).lean();
    expect(held).toHaveLength(1);
    expect(held[0]).toMatchObject({ state: 'committing', capacity: { slot: new Date(SLOT), kitchenSeat: 0 } });
    expect(held[0]?.capacity?.deliverySeat).toBeUndefined();
    expect(await ordersB.countDocuments()).toBe(0); // Le socle réserve, il ne crée pas encore le ticket.
  });

  it.each([
    ['public', 'legacy'], ['public', 'staff'], ['legacy', 'staff'], ['staff', 'staff'], ['legacy', 'legacy'],
  ] as const)('dernière place %s/%s : même autorité et aucune preuve publique fabriquée', async (kindA, kindB) => {
    await calendar();
    const a = await prepared('pickup', SLOT, kindA); const b = await prepared('pickup', SLOT, kindB);
    const results = await Promise.all([commit(first, a), commit(second, b)]);
    expect(results.map((result) => result.state).sort()).toEqual(['committing', 'full']);
    const winner = results[0]!.state === 'committing' ? a : b;
    const held = await stored(winner);
    expect(await admissionsB.countDocuments({ 'capacity.kitchenSeat': { $exists: true } })).toBe(1);
    expect(held?.snapshot).toMatchObject({ channel: winner.candidate.channel, payment: { status: 'pending' } });
    expect((held?.snapshot as Record<string, unknown>).publicRecovery).toEqual(winner.binding.kind === undefined
      ? { version: 1, proofHash: winner.binding.proofHash, payloadHash: winner.binding.payloadHash } : null);
  });

  it.each(['legacy', 'staff'] as const)('une admission %s ne peut être adoptée via begin/recover/reject publics', async (kind) => {
    await calendar(); const a = await prepared('pickup', SLOT, kind);
    // Même avec des empreintes publiques copiées, l'origine privée reste une
    // barrière indépendante. Écriture native limitée à cette fixture isolée.
    const publicBinding = publicRecoveryBinding(TENANT, a.body)!;
    await admissionsA.collection.updateOne({ clientId: a.body.clientId }, { $set: publicBinding });
    await expect(admissionB.begin(TENANT, a.body)).rejects.toMatchObject({ status: 404 });
    await expect(admissionB.recover(TENANT, a.body.clientId, a.body.recoveryProof!)).rejects.toMatchObject({ status: 404 });
    await expect(admissionB.reject(TENANT, a.body.clientId, publicBinding, 'abandoned')).rejects.toMatchObject({ status: 404 });
    await expect(admissionB.releaseValidation(TENANT, a.body.clientId, a.binding)).rejects.toMatchObject({ status: 404 });
    await expect(second.commit(TENANT, a.body.clientId, publicBinding, { ...a.candidate, channel: 'online' })).rejects.toMatchObject({ status: 404 });
    expect(await stored(a)).toMatchObject({ state: 'validating', kind, snapshot: null });
    expect((await stored(a))?.validationOwner).toBe(a.binding.validationOwner);
    expect(await ordersB.countDocuments()).toBe(0);
  });

  it('une ancienne admission sans kind conserve le protocole public C01', async () => {
    await calendar(); const a = await prepared();
    await admissionsA.collection.updateOne({ clientId: a.body.clientId }, { $unset: { kind: '' } });
    expect(await commit(first, a)).toMatchObject({ state: 'committing' });
    expect(await admissionB.recover(TENANT, a.body.clientId, a.body.recoveryProof!)).toMatchObject({ state: 'created' });
    expect(await ordersB.countDocuments()).toBe(1);
  });

  it('le snapshot staff conserve paiement/outbox fidélité et écrase toute preuve publique fournie', async () => {
    await calendar(); const a = await prepared('pickup', SLOT, 'staff', 'pos');
    const loyalty = { loyaltyMemberId: randomUUID(), loyaltyEarnOperationId: randomUUID(),
      loyaltyEarnState: 'pending', loyaltyEarnAttempts: 0, loyaltyActorRef: 'staff:test', loyaltyDeviceRef: 'device:test' };
    Object.assign(a.candidate, loyalty, { publicRecovery: publicRecoveryBinding(TENANT, a.body) });
    const committed = await commit(first, a);
    expect(committed).toMatchObject({ state: 'committing' });
    const row = await stored(a);
    expect(row?.snapshot).toMatchObject({ ...loyalty, publicRecovery: null, payment: { status: 'pending', method: 'counter' } });
    expect(await second.commit(TENANT, a.body.clientId, a.binding,
      { ...a.candidate, _id: new Types.ObjectId(), number: 999, loyaltyMemberId: randomUUID() })).toEqual(committed);
    expect((await stored(a))?.snapshot).toMatchObject(loyalty);
  });

  it.each(['legacy', 'staff'] as const)('la clé %s ne crée pas une seconde admission du même client', async (kind) => {
    const a = await prepared('pickup', SLOT, kind);
    await expect(admissionsB.create({ _id: orderAdmissionId(TENANT, a.body.clientId), tenantId: TENANT,
      clientId: a.body.clientId, ...publicRecoveryBinding(TENANT, a.body), slot: new Date(SLOT), state: 'validating' }))
      .rejects.toMatchObject({ code: 11000 });
    expect(await admissionsB.countDocuments()).toBe(1);
  });

  it.each(['public', 'legacy', 'staff'] as const)('refuse un candidat qui change le canal autorisé %s', async (kind) => {
    await calendar(); const a = await prepared('pickup', SLOT, kind);
    await expect(second.commit(TENANT, a.body.clientId, a.binding, { ...a.candidate, channel: kind === 'staff' ? 'online' : 'pos' }))
      .rejects.toMatchObject({ status: 400 });
    expect((await stored(a))?.capacity).toBeUndefined();
  });

  it.each(['pos', 'phone'] as const)('le snapshot staff ne peut pas échanger le canal %s', async (channel) => {
    await calendar(); const a = await prepared('pickup', SLOT, 'staff', channel);
    const other = channel === 'pos' ? 'phone' : 'pos';
    await expect(second.commit(TENANT, a.body.clientId, a.binding, { ...a.candidate, channel: other }))
      .rejects.toMatchObject({ status: 400 });
    await expect(second.commit(TENANT, a.body.clientId, { ...a.binding, channel: other }, { ...a.candidate, channel: other }))
      .rejects.toMatchObject({ status: 404 });
    expect((await stored(a))?.capacity).toBeUndefined();
  });

  it('alloue les plus petits sièges libres, sans gaspiller les trous', async () => {
    await calendar(3, 2);
    const a = await prepared(); const b = await prepared(); const c = await prepared();
    await commit(first, a); await commit(second, b);
    expect((await stored(a))?.capacity?.kitchenSeat).toBe(0);
    expect((await stored(b))?.capacity?.kitchenSeat).toBe(1);
    await materialize(a, 'cancelled');
    await first.releaseCancelled(TENANT, a.body.clientId);
    await commit(second, c);
    expect((await stored(c))?.capacity?.kitchenSeat).toBe(0);
  });

  it('la limite livraison et cuisine est atomique : livraison pleine ne grignote pas un siège cuisine', async () => {
    await calendar(2, 1);
    const deliveryA = await prepared('delivery'); const deliveryB = await prepared('delivery'); const pickup = await prepared();
    expect(await commit(first, deliveryA)).toMatchObject({ state: 'committing' });
    expect(await commit(second, deliveryB)).toMatchObject({ state: 'full' });
    expect((await stored(deliveryB))?.capacity).toBeUndefined();
    expect(await commit(second, pickup)).toMatchObject({ state: 'committing' });
    expect((await stored(deliveryA))?.capacity).toMatchObject({ kitchenSeat: 0, deliverySeat: 0 });
    expect((await stored(pickup))?.capacity).toMatchObject({ kitchenSeat: 1 });
    expect((await stored(pickup))?.capacity?.deliverySeat).toBeUndefined();
  });

  it('une cuisine pleine refuse la livraison même si des sièges livraison sont libres', async () => {
    await calendar(1, 2);
    const pickup = await prepared(); const delivery = await prepared('delivery');
    await commit(first, pickup);
    expect(await commit(second, delivery)).toMatchObject({ state: 'full' });
    expect((await stored(delivery))?.capacity).toBeUndefined();
  });

  it('deux créations livraison concurrentes respectent les deux index en une écriture', async () => {
    await calendar(2, 1);
    const a = await prepared('delivery'); const b = await prepared('delivery');
    const results = await Promise.all([commit(first, a), commit(second, b)]);
    expect(results.map((result) => result.state).sort()).toEqual(['committing', 'full']);
    expect(await admissionsB.countDocuments({ 'capacity.kitchenSeat': { $exists: true } })).toBe(1);
    expect(await admissionsB.countDocuments({ 'capacity.deliverySeat': { $exists: true } })).toBe(1);
  });

  it('abandon gagne devant un CAS suspendu : aucun siège ni snapshot tardif', async () => {
    await calendar(); const a = await prepared();
    const reached = barrier(); const resume = barrier();
    const held = new OrderCapacityCommitStore(interceptCommit(admissionsA, async (run) => {
      reached.release(); await resume.promise; return run();
    }), ordersA, daysA);
    const pending = commit(held, a);
    try {
      await reached.promise;
      expect(await admissionB.reject(TENANT, a.body.clientId, a.binding, 'abandoned')).toMatchObject({ state: 'rejected' });
    } finally { resume.release(); }
    expect(await pending).toMatchObject({ state: 'rejected' });
    expect(await stored(a)).toMatchObject({ state: 'rejected', snapshot: null });
    expect((await stored(a))?.capacity).toBeUndefined();
  });

  it('un rejeu même clientId garde son siège et le snapshot gagnant, pas un second numéro', async () => {
    await calendar(2, 2); const a = await prepared();
    const original = await commit(first, a);
    const replay = await second.commit(TENANT, a.body.clientId, a.binding, { ...a.candidate, _id: new Types.ObjectId(), number: 999 });
    expect(replay).toEqual(original);
    expect(await admissionsB.countDocuments({ 'capacity.kitchenSeat': { $exists: true } })).toBe(1);
    expect((await stored(a))?.snapshot).toMatchObject({ _id: a.candidate._id, number: 12 });
  });

  it('deux helpers de la même admission ne consomment qu’un siège et conservent le snapshot gagnant', async () => {
    await calendar(2, 2); const a = await prepared();
    const reached = barrier(); const resume = barrier();
    const held = new OrderCapacityCommitStore(interceptCommit(admissionsA, async (run) => {
      reached.release(); await resume.promise; return run();
    }), ordersA, daysA);
    const pending = commit(held, a);
    let helper: Awaited<ReturnType<typeof commit>>;
    try {
      await reached.promise;
      helper = await commit(second, a);
    } finally { resume.release(); }
    expect(await pending).toEqual(helper!);
    expect(await admissionsB.countDocuments({ 'capacity.kitchenSeat': { $exists: true } })).toBe(1);
    expect((await stored(a))?.capacity?.kitchenSeat).toBe(0);
    expect((await stored(a))?.snapshot).toMatchObject({ _id: a.candidate._id, number: 12 });
  });

  it('un helper ancien ne réalloue pas sa place après engagement, annulation et attribution à une autre commande', async () => {
    await calendar(); const a = await prepared();
    const reached = barrier(); const resume = barrier();
    const held = new OrderCapacityCommitStore(interceptCommit(admissionsA, async (run) => {
      reached.release(); await resume.promise; return run();
    }), ordersA, daysA);
    const pending = commit(held, a);
    let c: Prepared;
    try {
      await reached.promise;
      expect(await commit(second, a)).toMatchObject({ state: 'committing' });
      await materialize(a, 'cancelled');
      expect(await second.releaseCancelled(TENANT, a.body.clientId)).toBe(true);
      c = await prepared();
      expect(await commit(second, c)).toMatchObject({ state: 'committing' });
    } finally { resume.release(); }
    expect(await pending).toMatchObject({ state: 'created', orderId: String(a.candidate._id) });
    expect((await stored(a))?.capacity?.kitchenSeat).toBeUndefined();
    expect((await stored(c!))?.capacity?.kitchenSeat).toBe(0);
    expect(await ordersB.findById(a.candidate._id).lean()).toMatchObject({ status: 'cancelled' });
    expect(await admissionsB.countDocuments({ 'capacity.kitchenSeat': { $exists: true } })).toBe(1);
  });

  it('même clientId ne peut être déplacé vers un second créneau avant engagement', async () => {
    await calendar(); const a = await prepared();
    const changed = { ...a.candidate, pickup: { ...a.body.pickup, slot: new Date(NEXT_SLOT) } };
    await expect(first.commit(TENANT, a.body.clientId, a.binding, changed)).rejects.toMatchObject({ status: 400 });
    expect(await stored(a)).toMatchObject({ state: 'validating', slot: new Date(SLOT), snapshot: null });
    expect((await stored(a))?.capacity).toBeUndefined();
  });

  it('après réponse du CAS perdue, la seconde connexion retrouve le même engagement et aucun siège supplémentaire', async () => {
    await calendar(2, 2); const a = await prepared();
    const lostResponse = new OrderCapacityCommitStore(interceptCommit(admissionsA, async (run) => {
      await run(); throw new Error('response lost after Mongo acknowledged commit');
    }), ordersA, daysA);
    expect(await commit(lostResponse, a)).toMatchObject({ state: 'committing', orderId: String(a.candidate._id) });
    expect(await commit(second, a)).toMatchObject({ state: 'committing', orderId: String(a.candidate._id) });
    expect(await admissionsB.countDocuments({ 'capacity.kitchenSeat': { $exists: true } })).toBe(1);
  });

  it('une erreur avant effet Mongo reste503, jamais un faux engagement ni une place libérée', async () => {
    await calendar(); const a = await prepared();
    const unknown = new OrderCapacityCommitStore(interceptCommit(admissionsA, async () => {
      throw new Error('connection lost before acknowledgement');
    }), ordersA, daysA);
    await expect(commit(unknown, a)).rejects.toMatchObject({ status: 503 });
    expect(await stored(a)).toMatchObject({ state: 'validating', snapshot: null });
    expect((await stored(a))?.capacity).toBeUndefined();
    expect(await commit(second, a)).toMatchObject({ state: 'committing' });
  });

  it('HTTP503 puis abandon durable : le CAS encore en vol ne réserve rien lorsqu’il arrive très tard', async () => {
    await calendar(); const a = await prepared();
    let lateWrite!: () => Promise<unknown>;
    const delayed = new OrderCapacityCommitStore(interceptCommit(admissionsA, async (run) => {
      lateWrite = run;
      throw new Error('request timed out while Mongo command remains in transit');
    }), ordersA, daysA);
    await expect(commit(delayed, a)).rejects.toMatchObject({ status: 503 });
    expect(await stored(a)).toMatchObject({ state: 'validating', snapshot: null });
    expect(await admissionB.reject(TENANT, a.body.clientId, a.binding, 'abandoned')).toMatchObject({ state: 'rejected' });
    expect(await lateWrite()).toMatchObject({ matchedCount: 0 });
    expect(await stored(a)).toMatchObject({ state: 'rejected', rejection: 'abandoned', snapshot: null });
    expect((await stored(a))?.capacity).toBeUndefined();
    const b = await prepared();
    expect(await commit(second, b)).toMatchObject({ state: 'committing' });
  });

  it('HTTP503 puis CAS tardif gagnant : un abandon retrouve la vente sans restituer le siège', async () => {
    await calendar(); const a = await prepared();
    let lateWrite!: () => Promise<unknown>;
    const delayed = new OrderCapacityCommitStore(interceptCommit(admissionsA, async (run) => {
      lateWrite = run;
      throw new Error('request timed out while Mongo command remains in transit');
    }), ordersA, daysA);
    await expect(commit(delayed, a)).rejects.toMatchObject({ status: 503 });
    expect(await lateWrite()).toMatchObject({ matchedCount: 1 });
    expect(await admissionB.reject(TENANT, a.body.clientId, a.binding, 'abandoned')).toMatchObject({ state: 'created' });
    expect((await stored(a))?.capacity?.kitchenSeat).toBe(0);
    expect(await ordersB.countDocuments()).toBe(1);
    const b = await prepared();
    expect(await commit(second, b)).toMatchObject({ state: 'full' });
  });

  it.each(ORDER_CAPACITY_INDEXES)('refuse avant CAS si l’index unique $name manque', async ({ name }) => {
    await calendar(); const a = await prepared();
    await admissionsA.collection.dropIndex(name);
    const cas = vi.fn(async (run: () => Promise<unknown>) => run());
    const unsafe = new OrderCapacityCommitStore(interceptCommit(admissionsA, cas), ordersA, daysA);
    try {
      await expect(commit(unsafe, a)).rejects.toMatchObject({ status: 503 });
      expect(cas).not.toHaveBeenCalled();
      expect(await stored(a)).toMatchObject({ state: 'validating', snapshot: null });
    } finally { await admissionsA.createIndexes(); }
  });

  it('refuse avant CAS si l’unicité de la journée tenant/date n’est pas installée', async () => {
    await calendar(); const a = await prepared();
    await daysA.collection.dropIndex(ORDER_CAPACITY_DAY_INDEX);
    const cas = vi.fn(async (run: () => Promise<unknown>) => run());
    const unsafe = new OrderCapacityCommitStore(interceptCommit(admissionsA, cas), ordersA, daysA);
    try {
      await expect(commit(unsafe, a)).rejects.toMatchObject({ status: 503 });
      expect(cas).not.toHaveBeenCalled();
      expect(await stored(a)).toMatchObject({ state: 'validating', snapshot: null });
    } finally { await daysA.createIndexes(); }
  });

  it.each(['missing', 'seeding', 'blocked'])('aucune admission de nouvelle commande sans journée ready : %s', async (state) => {
    if (state !== 'missing') await calendar(1, 1, state);
    const a = await prepared();
    await expect(commit(first, a)).rejects.toMatchObject({ status: 503 });
    expect(await stored(a)).toMatchObject({ state: 'validating', snapshot: null });
    expect((await stored(a))?.capacity).toBeUndefined();
  });

  it('le calendrier est recherché selon le jour Paris, pas la date UTC du créneau', async () => {
    const midnightParis = '2030-05-02T22:30:00.000Z';
    await calendar(1, 1, 'ready', [midnightParis], '2030-05-03');
    const a = await prepared('pickup', midnightParis);
    expect(await commit(first, a)).toMatchObject({ state: 'committing' });
    expect((await stored(a))?.capacity?.slot).toEqual(new Date(midnightParis));
  });

  it('un créneau absent de la grille figée n’obtient aucun siège', async () => {
    await calendar(1, 1, 'ready', [SLOT]); const a = await prepared('pickup', NEXT_SLOT);
    await expect(commit(first, a)).rejects.toMatchObject({ status: 503 });
    expect((await stored(a))?.capacity).toBeUndefined();
  });

  it('snapshot invalide : validation avant CAS et aucun siège consommé', async () => {
    await calendar(); const a = await prepared();
    delete a.candidate.number;
    await expect(commit(first, a)).rejects.toMatchObject({ status: 400 });
    expect(await stored(a)).toMatchObject({ state: 'validating', snapshot: null });
    expect((await stored(a))?.capacity).toBeUndefined();
  });

  it.each(['proofHash', 'payloadHash', 'validationOwner'] as const)('un ancien ou mauvais %s ne réserve aucune place', async (field) => {
    await calendar(); const a = await prepared();
    const forged = { ...a.binding, [field]: field === 'validationOwner' ? randomUUID() : 'f'.repeat(64) };
    if (field === 'validationOwner') {
      expect(await first.commit(TENANT, a.body.clientId, forged, a.candidate)).toMatchObject({ state: 'stale' });
    } else {
      await expect(first.commit(TENANT, a.body.clientId, forged, a.candidate)).rejects.toMatchObject({ status: 404 });
    }
    expect((await stored(a))?.capacity).toBeUndefined();
  });

  it('un autre tenant ne peut réserver ni restituer les sièges de la commande', async () => {
    await calendar(); const a = await prepared();
    await expect(first.commit(OTHER_TENANT, a.body.clientId, a.binding, a.candidate)).rejects.toMatchObject({ status: 404 });
    await commit(first, a); await materialize(a, 'cancelled');
    expect(await second.releaseCancelled(OTHER_TENANT, a.body.clientId)).toBe(false);
    expect((await stored(a))?.capacity?.kitchenSeat).toBe(0);
  });

  it.each(['unmaterialized', 'new', 'delivered'] as const)('ne libère jamais sans commande finale cancelled : %s', async (status) => {
    await calendar(); const a = await prepared(); await commit(first, a);
    if (status !== 'unmaterialized') await materialize(a, status);
    expect(await first.releaseCancelled(TENANT, a.body.clientId)).toBe(false);
    expect((await stored(a))?.capacity?.kitchenSeat).toBe(0);
    const b = await prepared();
    expect(await commit(second, b)).toMatchObject({ state: 'full' });
  });

  it('annulation confirmée : restitution idempotente des deux sièges, sans réouverture de l’admission', async () => {
    await calendar(); const a = await prepared('delivery'); await commit(first, a); await materialize(a, 'cancelled');
    const released = await first.releaseCancelled(TENANT, a.body.clientId);
    expect(released).toBe(true);
    await second.releaseCancelled(TENANT, a.body.clientId);
    const terminal = await stored(a);
    expect(terminal).toMatchObject({ state: 'created', orderId: a.candidate._id, snapshot: null });
    expect(terminal?.capacity?.kitchenSeat).toBeUndefined();
    expect(terminal?.capacity?.deliverySeat).toBeUndefined();
    expect(terminal?.capacity?.releasedAt).toBeInstanceOf(Date);
    expect(await ordersB.findById(a.candidate._id).lean()).toMatchObject({ status: 'cancelled' });
    expect(await commit(second, a)).toMatchObject({ state: 'created', orderId: String(a.candidate._id) });
    const b = await prepared('delivery');
    expect(await commit(second, b)).toMatchObject({ state: 'committing' });
    expect((await stored(b))?.capacity).toMatchObject({ kitchenSeat: 0, deliverySeat: 0 });
  });

  it('un ticket cancelled avec un autre _id ne prouve pas l’annulation du snapshot engagé', async () => {
    await calendar(); const a = await prepared(); await commit(first, a);
    const admission = await stored(a);
    await ordersA.create({ ...(admission!.snapshot as Record<string, unknown>), _id: new Types.ObjectId(), status: 'cancelled' });
    expect(await first.releaseCancelled(TENANT, a.body.clientId)).toBe(false);
    expect((await stored(a))?.capacity?.kitchenSeat).toBe(0);
  });

  it('un releasedAt incohérent avec des sièges encore présents reste503, pas un faux acquittement', async () => {
    await calendar(); const a = await prepared(); await commit(first, a); await materialize(a, 'cancelled');
    await admissionsA.updateOne({ clientId: a.body.clientId }, { $set: { 'capacity.releasedAt': new Date() } });
    await expect(second.releaseCancelled(TENANT, a.body.clientId)).rejects.toMatchObject({ status: 503 });
    expect((await stored(a))?.capacity?.kitchenSeat).toBe(0);
  });
});
