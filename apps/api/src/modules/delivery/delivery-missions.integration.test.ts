import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import mongoose, { type Connection, type Model, type Query } from 'mongoose';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { MODELS, type DeliveryOperator, type Order, type Staff, type Tenant } from '@sm/db';
import { type DeliveryMissionAssign, type JwtPayload } from '@sm/contracts';
import { DeliveryMissionsService } from './delivery-missions.service';
import { DeliveryOperatorsService } from './delivery-operators.service';
import { DeliveryAccessService } from './delivery-access.service';
import { DeliveryService } from './delivery.service';

const TENANT = '507f1f77bcf86cd799439011';
const OTHER = '507f1f77bcf86cd799439022';
const STAFF = '507f1f77bcf86cd799439033';
const actor = { kind: 'user', role: 'owner', sub: '507f1f77bcf86cd799439044', tenantId: TENANT } as JwtPayload;

export function missionTestDatabase(raw: string): { uri: string; name: string } {
  const url = new URL(raw);
  if (url.protocol !== 'mongodb:' || !['localhost', '127.0.0.1'].includes(url.hostname)
    || url.username || url.password || url.search || url.hash
    || !/^\/snackmanager_delivery_mission_test_[a-z0-9_]{1,12}$/.test(url.pathname)) {
    throw new Error('DELIVERY_MISSION_TEST_MONGO_URL doit cibler une base locale isolée snackmanager_delivery_mission_test_, sans options.');
  }
  url.pathname += `_${randomUUID().replaceAll('-', '').slice(0, 10)}`;
  return { uri: url.toString(), name: url.pathname.slice(1) };
}
const database = process.env.DELIVERY_MISSION_TEST_MONGO_URL ? missionTestDatabase(process.env.DELIVERY_MISSION_TEST_MONGO_URL) : null;

describe('cible Mongo des missions', () => {
  it.each(['mongodb://remote.example/snackmanager_delivery_mission_test_ci', 'mongodb://localhost/admin',
    'mongodb://localhost/snackmanager_delivery_mission_test_ci?replicaSet=prod',
    'mongodb://fixture:fixture@localhost/snackmanager_delivery_mission_test_ci',
    'mongodb+srv://localhost/snackmanager_delivery_mission_test_ci',
  ])('refuse la cible non isolée %s', url => expect(() => missionTestDatabase(url)).toThrow());
  it('utilise une base différente pour chaque run', () => {
    const url = 'mongodb://127.0.0.1/snackmanager_delivery_mission_test_local';
    expect(missionTestDatabase(url).name).not.toBe(missionTestDatabase(url).name);
  });
});

function barrier() { let release!: () => void; const promise = new Promise<void>(resolve => { release = resolve; }); return { promise, release }; }
function interceptWrite(model: Model<Order>, before?: () => Promise<void>, after?: () => Promise<void>) {
  let armed = true;
  return new Proxy(model, { get(target, property) {
    const value = Reflect.get(target, property, target);
    if (property !== 'updateOne') return typeof value === 'function' ? value.bind(target) : value;
    return (...args: unknown[]) => {
      const query = Reflect.apply(value, target, args) as Query<unknown, Order>;
      const exec = query.exec.bind(query);
      query.exec = async () => {
        const active = armed; armed = false;
        if (active && before) await before();
        const result = await exec();
        if (active && after) await after();
        return result;
      };
      return query;
    };
  } });
}

(database ? describe : describe.skip)('missions — CAS réels Mongo standalone', () => {
  let db: Connection; let otherDb: Connection;
  let orders: Model<Order>; let secondOrders: Model<Order>; let operators: Model<DeliveryOperator>;
  let staff: Model<Staff>; let tenants: Model<Tenant>; let access: DeliveryAccessService; let directory: DeliveryOperatorsService;
  const audit = { logOnce: vi.fn().mockResolvedValue(undefined), log: vi.fn().mockResolvedValue(undefined) };
  const redis = { publish: vi.fn().mockResolvedValue(1) };
  const service = (model = orders) => new DeliveryMissionsService(model, operators, staff, tenants, access, audit as never, redis as never);
  const legacy = () => new DeliveryService(tenants, {} as never, orders, audit as never, redis as never, {} as never);
  const stored = (id: string) => orders.findById(id).select('+deliveryMission +paymentFlow').lean();

  beforeAll(async () => {
    db = await mongoose.createConnection(database!.uri, { serverSelectionTimeoutMS: 5_000, family: 4, directConnection: true }).asPromise();
    otherDb = await mongoose.createConnection(database!.uri, { serverSelectionTimeoutMS: 5_000, family: 4, directConnection: true }).asPromise();
    orders = db.model(MODELS.Order.name, MODELS.Order.schema, MODELS.Order.collection);
    secondOrders = otherDb.model(MODELS.Order.name, MODELS.Order.schema, MODELS.Order.collection);
    operators = db.model(MODELS.DeliveryOperator.name, MODELS.DeliveryOperator.schema, MODELS.DeliveryOperator.collection);
    staff = db.model(MODELS.Staff.name, MODELS.Staff.schema, MODELS.Staff.collection);
    tenants = db.model(MODELS.Tenant.name, MODELS.Tenant.schema, MODELS.Tenant.collection);
    await Promise.all([orders.init(), operators.init(), staff.init(), tenants.init()]);
    access = new DeliveryAccessService(operators, tenants, staff);
    directory = new DeliveryOperatorsService(operators, staff);
  }, 20_000);
  beforeEach(async () => {
    if (db.name !== database!.name) throw new Error('Base de recette non possédée');
    await Promise.all([orders.deleteMany({}), operators.deleteMany({}), staff.deleteMany({}), tenants.deleteMany({})]);
    vi.clearAllMocks();
    await tenants.create({ _id: TENANT, slug: 'mission-fixture', name: 'Restaurant de recette', plan: 'essentiel', onlineDelivery: true });
    await tenants.create({ _id: OTHER, slug: 'other-fixture', name: 'Autre restaurant', plan: 'boost' });
  });
  afterAll(async () => {
    try { if (db && db.name === database!.name) await db.dropDatabase(); }
    finally { await Promise.all([db?.close(), otherDb?.close()]); }
  });

  async function seed(overrides: Record<string, unknown> = {}) {
    const row = await orders.create({ tenantId: TENANT, number: 1, clientId: randomUUID(), channel: 'online', type: 'delivery',
      status: 'ready', lines: [{ productId: '507f1f77bcf86cd799439055', name: 'Article de recette', qty: 1, unitPrice: 1250, lineTotal: 1250 }],
      totals: { subtotal: 1250, total: 1500, deliveryFee: 250 }, payment: { method: 'online', status: 'paid' },
      paymentFlow: { version: 1, origin: 'created_v1', phase: 'settled', attempt: null, close: null },
      pickup: { slot: new Date('2030-01-01T11:00:00Z'), customerName: 'Destinataire fixture', customerPhone: '0600000000' },
      delivery: { address: { line1: '1 rue de recette', postalCode: '75001', city: 'Paris', country: 'FR' },
        instructions: 'Entrée de recette', zoneId: 'fixture', zoneName: 'Recette', feeCents: 250, estimatedMinutes: 20 },
      trackingToken: 'fixture-tracking-secret', meta: { secret: 'fixture-private-meta' }, ...overrides });
    return String(row._id);
  }
  const createOperator = (name = 'Camille') => directory.create(TENANT, { requestId: randomUUID(), name }, actor);
  const assignInput = (operatorId: string | null, expectedRevision = 0, expectedOperatorRevision = 0): DeliveryMissionAssign => ({
    operationId: randomUUID(), expectedRevision, operatorId, expectedOperatorRevision: operatorId ? expectedOperatorRevision : null, reason: 'Affectation de recette',
  });
  async function connected() {
    const operator = await createOperator();
    const invitation = await directory.invitation(TENANT, operator.id, operator.revision, actor);
    const nonce = Buffer.alloc(32, 3).toString('base64url');
    const result = await access.exchange({ token: invitation.token, nonce });
    const session = await access.authenticate(result.token);
    return { operator: (await directory.list(TENANT)).operators[0]!, session };
  }

  it('rend une commande legacy révision zéro et projection privée limitée', async () => {
    const id = await seed();
    const view = await service().getManager(TENANT, id, actor);
    expect(view).toMatchObject({ id, revision: 0, operator: null, canAssign: true, canDispatch: false });
    expect(JSON.stringify(view)).not.toMatch(/tracking|stripe|paymentFlow|totals|private-meta|operations|tenantId/);
  });
  it('affecte sans changer statut, paiement, montants ni départ', async () => {
    const id = await seed({ status: 'new', payment: { method: 'online', status: 'pending' } });
    const before = await stored(id); const operator = await createOperator();
    const result = await service().assign(TENANT, id, assignInput(operator.id), actor);
    const after = await stored(id);
    expect(result.mission).toMatchObject({ revision: 1, orderStatus: 'new', dispatchedAt: null, canDispatch: false, operator: { id: operator.id } });
    expect(after?.payment).toEqual(before?.payment); expect(after?.totals).toEqual(before?.totals);
    expect(after?.deliveryMission?.operations).toHaveLength(1);
    expect(after?.__v).toBe((before?.__v ?? 0) + 1);
    expect(JSON.stringify(redis.publish.mock.calls)).not.toMatch(/deliveryMission|assignmentId|fingerprint|assignedBy/);
  });
  it('une même affectation concurrente donne une seule preuve et un rejeu', async () => {
    const id = await seed(); const operator = await createOperator(); const input = assignInput(operator.id);
    const outcomes = await Promise.all([service().assign(TENANT, id, input, actor), service(secondOrders).assign(TENANT, id, input, actor)]);
    expect(outcomes.map(value => value.replay).sort()).toEqual([false, true]);
    expect((await stored(id))?.deliveryMission?.operations).toHaveLength(1);
  });
  it('deux affectations différentes de même révision ont un seul gagnant', async () => {
    const id = await seed(); const a = await createOperator('Aline'); const b = await createOperator('Brice');
    const outcomes = await Promise.allSettled([service().assign(TENANT, id, assignInput(a.id), actor), service(secondOrders).assign(TENANT, id, assignInput(b.id), actor)]);
    expect(outcomes.filter(value => value.status === 'fulfilled')).toHaveLength(1);
    expect((await stored(id))?.deliveryMission?.operations).toHaveLength(1);
  });
  it('retrouve une écriture appliquée après perte de réponse Mongo', async () => {
    const id = await seed(); const operator = await createOperator();
    const lost = interceptWrite(orders, undefined, async () => { throw new Error('ACK fixture perdu'); });
    const result = await service(lost).assign(TENANT, id, assignInput(operator.id), actor);
    expect(result.replay).toBe(true); expect((await stored(id))?.deliveryMission?.operations).toHaveLength(1);
  });
  it('ne transforme pas une erreur I/O sans preuve en conflit définitif', async () => {
    const id = await seed(); const operator = await createOperator();
    const lost = interceptWrite(orders, async () => { throw new Error('I/O fixture'); });
    await expect(service(lost).assign(TENANT, id, assignInput(operator.id), actor)).rejects.toMatchObject({ status: 503 });
    expect((await stored(id))?.deliveryMission).toBeNull();
  });
  it('un ancien rejeu rend l’affectation actuelle sans la remplacer', async () => {
    const id = await seed(); const a = await createOperator('Aline'); const b = await createOperator('Brice'); const input = assignInput(a.id);
    await service().assign(TENANT, id, input, actor);
    await service().assign(TENANT, id, assignInput(b.id, 1), actor);
    const replay = await service().assign(TENANT, id, input, actor);
    expect(replay).toMatchObject({ replay: true, appliedRevision: 1, mission: { revision: 2, operator: { id: b.id } } });
    expect((await stored(id))?.deliveryMission?.operations).toHaveLength(2);
  });
  it('un UUID ne peut désigner un autre corps ou acteur', async () => {
    const id = await seed(); const operator = await createOperator(); const input = assignInput(operator.id);
    await service().assign(TENANT, id, input, actor);
    await expect(service().assign(TENANT, id, { ...input, reason: 'Une autre intention' }, actor)).rejects.toMatchObject({ status: 409 });
    await expect(service().assign(TENANT, id, input, { ...actor, sub: OTHER })).rejects.toMatchObject({ status: 409 });
  });
  it('un refus acquitté reste refusé si la commande devient prête plus tard', async () => {
    const id = await seed({ status: 'preparing' }); const operator = await createOperator();
    await service().assign(TENANT, id, assignInput(operator.id), actor);
    const input = { operationId: randomUUID(), expectedRevision: 1 };
    vi.clearAllMocks();
    const refused = await service().dispatchManager(TENANT, id, input, actor);
    expect(refused).toMatchObject({ outcome: 'rejected', refusalCode: 'delivery.mission.not_ready', appliedRevision: 2, replay: false });
    expect(audit.logOnce).not.toHaveBeenCalled(); expect(redis.publish).not.toHaveBeenCalled();
    await orders.updateOne({ _id: id }, { $set: { status: 'ready' }, $inc: { __v: 1 } });
    const replay = await service().dispatchManager(TENANT, id, input, actor);
    expect(replay).toMatchObject({ outcome: 'rejected', refusalCode: 'delivery.mission.not_ready', replay: true, mission: { canDispatch: true, revision: 2 } });
    expect((await stored(id))?.delivery?.dispatchedAt).toBeNull();
    await expect(service().dispatchManager(TENANT, id, { ...input, operationId: randomUUID() }, actor)).rejects.toMatchObject({ status: 409 });
  });
  it('reprend un refus après perte de réponse Mongo sans affecter plus tard', async () => {
    const id = await seed(); const operator = await createOperator(); const input = assignInput(operator.id, 0, 99);
    const lost = interceptWrite(orders, undefined, async () => { throw new Error('ACK fixture perdu'); });
    const result = await service(lost).assign(TENANT, id, input, actor);
    expect(result).toMatchObject({ outcome: 'rejected', replay: true, refusalCode: 'DELIVERY_OPERATOR_CHANGED' });
    expect((await stored(id))?.deliveryMission?.assignment).toBeNull();
    expect(audit.logOnce).not.toHaveBeenCalled();
  });
  it('répare audit ou publication perdus sans double mutation', async () => {
    const id = await seed(); const operator = await createOperator(); const input = assignInput(operator.id);
    audit.logOnce.mockRejectedValueOnce(new Error('Audit fixture indisponible'));
    await expect(service().assign(TENANT, id, input, actor)).rejects.toMatchObject({ status: 503 });
    expect((await stored(id))?.deliveryMission?.operations).toHaveLength(1);
    const result = await service().assign(TENANT, id, input, actor);
    expect(result).toMatchObject({ outcome: 'applied', replay: true, appliedRevision: 1 });
    expect((await stored(id))?.deliveryMission?.operations).toHaveLength(1);
  });
  it('refuse le journal plein sans tronquer ses preuves', async () => {
    const id = await seed(); const operator = await createOperator();
    await service().assign(TENANT, id, assignInput(operator.id), actor);
    const row = await stored(id); const initial = row!.deliveryMission!.operations[0]!;
    const operations = Array.from({ length: 128 }, (_, index) => ({ ...initial, operationId: randomUUID(), revision: index + 1 }));
    await orders.updateOne({ _id: id }, { $set: { 'deliveryMission.operations': operations, 'deliveryMission.revision': 128 } });
    await expect(service().assign(TENANT, id, assignInput(null, 128), actor)).rejects.toMatchObject({ status: 409 });
    expect((await stored(id))?.deliveryMission?.operations).toHaveLength(128);
  });
  it('la réaffectation gagne contre un départ retenu avant son CAS', async () => {
    const id = await seed(); const a = await createOperator('Aline'); const b = await createOperator('Brice');
    await service().assign(TENANT, id, assignInput(a.id), actor);
    const reached = barrier(); const resume = barrier();
    const held = interceptWrite(orders, async () => { reached.release(); await resume.promise; });
    const departure = service(held).dispatchManager(TENANT, id, { operationId: randomUUID(), expectedRevision: 1 }, actor).catch(error => error);
    await reached.promise;
    try { await service(secondOrders).assign(TENANT, id, assignInput(b.id, 1), actor); } finally { resume.release(); }
    expect(await departure).toMatchObject({ status: 409 });
    expect((await stored(id))?.delivery?.dispatchedAt).toBeNull();
  });
  it('un départ empêche ensuite réaffectation et retrait', async () => {
    const id = await seed(); const operator = await createOperator(); await service().assign(TENANT, id, assignInput(operator.id), actor);
    const input = { operationId: randomUUID(), expectedRevision: 1 };
    const result = await service().dispatchManager(TENANT, id, input, actor);
    expect(result.mission).toMatchObject({ orderStatus: 'ready', revision: 2, canDispatch: false, canAssign: false });
    expect(result.mission.dispatchedAt).not.toBeNull();
    expect((await service().dispatchManager(TENANT, id, input, actor)).replay).toBe(true);
    await expect(service().assign(TENANT, id, assignInput(null, 2), actor)).resolves.toMatchObject({ outcome: 'rejected', refusalCode: 'delivery.mission.departed' });
  });
  it.each([{ 'payment.pendingRefundCents': 1 }, { 'payment.refundedCents': 1 }, { 'paymentFlow.phase': 'review_required' },
    { 'payment.status': 'refunded' }, { status: 'cancelled' }, { status: 'preparing' }])('un état non admissible interdit le départ %j', async change => {
    const id = await seed(); const operator = await createOperator(); await service().assign(TENANT, id, assignInput(operator.id), actor);
    await orders.updateOne({ _id: id }, { $set: change, $inc: { __v: 1 } });
    await expect(service().dispatchManager(TENANT, id, { operationId: randomUUID(), expectedRevision: 1 }, actor)).resolves.toMatchObject({ outcome: 'rejected' });
    expect((await stored(id))?.delivery?.dispatchedAt).toBeNull();
  });
  it('un remboursement connu qui gagne pendant le départ est relu dans le CAS', async () => {
    const id = await seed(); const operator = await createOperator(); await service().assign(TENANT, id, assignInput(operator.id), actor);
    const model = interceptWrite(orders, async () => { await secondOrders.updateOne({ _id: id }, { $set: { 'payment.pendingRefundCents': 100 }, $inc: { __v: 1 } }); });
    await expect(service(model).dispatchManager(TENANT, id, { operationId: randomUUID(), expectedRevision: 1 }, actor)).rejects.toMatchObject({ status: 409 });
  });
  it('refuse mauvaise révision d’accès, opérateur révoqué et Staff changé', async () => {
    const id = await seed(); const operator = await createOperator();
    await expect(service().assign(TENANT, id, assignInput(operator.id, 0, 99), actor)).resolves.toMatchObject({ outcome: 'rejected', refusalCode: 'DELIVERY_OPERATOR_CHANGED' });
    await directory.update(TENANT, operator.id, { expectedRevision: 0, active: false }, actor);
    await expect(service().assign(TENANT, id, assignInput(operator.id, 1, 1), actor)).resolves.toMatchObject({ outcome: 'rejected', refusalCode: 'DELIVERY_OPERATOR_CHANGED' });
    await staff.create({ _id: STAFF, tenantId: TENANT, name: 'Équipier fixture', role: 'caisse', pinHash: 'fixture', sessionVersion: 'v1' });
    const linked = await directory.create(TENANT, { staffId: STAFF, requestId: randomUUID() }, actor);
    await staff.updateOne({ _id: STAFF }, { $set: { sessionVersion: 'v2' } });
    await expect(service().assign(TENANT, id, assignInput(linked.id, 2), actor)).resolves.toMatchObject({ outcome: 'rejected', refusalCode: 'DELIVERY_OPERATOR_CHANGED' });
  });
  it('les missions exigent delivery mais pas RH, et la caisse ne peut affecter', async () => {
    const id = await seed(); const operator = await createOperator();
    await expect(service().assign(TENANT, id, assignInput(operator.id), { ...actor, kind: 'staff', role: 'caisse' })).rejects.toMatchObject({ status: 403 });
    expect((await service().listManager(TENANT, actor)).missions).toHaveLength(1);
    await tenants.updateOne({ _id: TENANT }, { $set: { onlineDelivery: false } });
    await expect(service().getManager(TENANT, id, actor)).rejects.toMatchObject({ status: 403 });
  });
  it('isole restaurant, type et opérateur sur liste/détail/départ', async () => {
    const { operator, session } = await connected(); const id = await seed(); const other = await seed({ tenantId: OTHER });
    const pickup = await seed({ type: 'pickup', delivery: null });
    await service().assign(TENANT, id, assignInput(operator.id, 0, operator.revision), actor);
    expect((await service().listCourier(session)).missions.map(row => row.id)).toEqual([id]);
    await expect(service().getManager(TENANT, other, actor)).rejects.toMatchObject({ status: 404 });
    await expect(service().getManager(TENANT, pickup, actor)).rejects.toMatchObject({ status: 404 });
    await expect(service().getCourier(session, other)).rejects.toMatchObject({ status: 404 });
    const next = await createOperator('Autre livreur');
    await service().assign(TENANT, id, assignInput(next.id, 1), actor);
    expect((await service().listCourier(session)).missions).toEqual([]);
    await expect(service().dispatchCourier(session, id, { operationId: randomUUID(), expectedRevision: 1 })).rejects.toMatchObject({ status: 404 });
  });
  it('un livreur peut partir mais jamais terminer la livraison', async () => {
    const { operator, session } = await connected(); const id = await seed();
    await service().assign(TENANT, id, assignInput(operator.id, 0, operator.revision), actor);
    const result = await service().dispatchCourier(session, id, { operationId: randomUUID(), expectedRevision: 1 });
    expect(result.mission).toMatchObject({ orderStatus: 'ready', canAssign: false, canDispatch: false });
    expect((await stored(id))?.delivery?.deliveredAt).toBeNull();
    expect(audit.logOnce).toHaveBeenLastCalledWith(expect.objectContaining({ actor: { kind: 'delivery', sub: operator.id, role: 'livreur', name: 'Camille' } }), expect.any(String));
  });
  it('une révocation avant une nouvelle requête interdit lecture et écriture', async () => {
    const { operator, session } = await connected(); const id = await seed();
    await service().assign(TENANT, id, assignInput(operator.id, 0, operator.revision), actor);
    await directory.update(TENANT, operator.id, { expectedRevision: operator.revision, active: false }, actor);
    await expect(service().getCourier(session, id)).rejects.toMatchObject({ status: 401 });
    await expect(service().dispatchCourier(session, id, { operationId: randomUUID(), expectedRevision: 1 })).rejects.toMatchObject({ status: 401 });
    expect((await stored(id))?.delivery?.dispatchedAt).toBeNull();
  });
  it('documente la requête en vol : révocation après dernier contrôle ne rollback pas le CAS', async () => {
    const { operator, session } = await connected(); const id = await seed();
    await service().assign(TENANT, id, assignInput(operator.id, 0, operator.revision), actor);
    const held = interceptWrite(orders, async () => { await directory.update(TENANT, operator.id, { expectedRevision: operator.revision, active: false }, actor); });
    await expect(service(held).dispatchCourier(session, id, { operationId: randomUUID(), expectedRevision: 1 })).rejects.toMatchObject({ status: 401 });
    expect((await stored(id))?.delivery?.dispatchedAt).not.toBeNull();
    expect((await stored(id))?.deliveryMission?.operations).toHaveLength(2);
  });
  it('ferme le chemin legacy dès qu’une mission existe, y compris après son départ', async () => {
    const id = await seed(); const operator = await createOperator(); await service().assign(TENANT, id, assignInput(operator.id), actor);
    await expect(legacy().dispatch(TENANT, id, {}, actor)).rejects.toMatchObject({ status: 409 });
    await service().dispatchManager(TENANT, id, { operationId: randomUUID(), expectedRevision: 1 }, actor);
    await expect(legacy().dispatch(TENANT, id, {}, actor)).rejects.toMatchObject({ status: 409 });
  });
  it('pagine sans coupure à minuit et donne un détail des missions terminées au responsable', async () => {
    const ids = await Promise.all(Array.from({ length: 52 }, () => seed({ createdAt: new Date('2020-01-01T00:00:00Z') })));
    const first = await service().listManager(TENANT, actor);
    expect(first.missions).toHaveLength(50); expect(first.nextCursor).not.toBeNull();
    const second = await service().listManager(TENANT, actor, { after: first.nextCursor! });
    expect(second.missions).toHaveLength(2); expect(second.nextCursor).toBeNull();
    expect(new Set([...first.missions, ...second.missions].map(row => row.id)).size).toBe(52);
    await orders.updateOne({ _id: ids[0] }, { $set: { status: 'delivered' } });
    expect((await service().getManager(TENANT, ids[0]!, actor)).orderStatus).toBe('delivered');
  });
});
