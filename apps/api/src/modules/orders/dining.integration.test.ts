import 'reflect-metadata';
import { randomBytes, randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { ConflictException, ForbiddenException, NotFoundException, ServiceUnavailableException, Module, type INestApplication } from '@nestjs/common';
import { APP_GUARD, NestFactory, Reflector } from '@nestjs/core';
import { JwtModule, JwtService } from '@nestjs/jwt';
import mongoose, { Types, type Connection, type Model, type Query } from 'mongoose';
import { MODELS, DINING_ACTIVE_TABLE_INDEX, type DiningSessionRecord, type DiningTableRecord, type DiningOrderPricingRecord, type Order, type Product, type Counter, type Promotion, type Tenant, type AuditLog, type Staff, type User, type Device } from '@sm/db';
import { type JwtPayload } from '@sm/contracts';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuditService } from '../audit/audit.module';
import { DiningService } from './dining.service';
import { OrdersService } from './orders.service';
import { OrderCounterCollectionService } from './order-counter-collection.service';
import { DiningController } from './dining.controller';
import { AuthGuard } from '../../common/auth';
import { SessionAccessService } from '../../common/session-access';
import { CapacitesService } from '../../common/capacites';
import { prepareDiningSchemas } from './dining-schema-bootstrap';

const TENANT = '507f1f77bcf86cd799439011';
const OTHER = '507f1f77bcf86cd799439021';
const PRODUCT = '507f1f77bcf86cd799439012';
const actor: JwtPayload = { sub: '507f1f77bcf86cd799439013', tenantId: TENANT, role: 'gerant', kind: 'staff' };
const other: JwtPayload = { ...actor, tenantId: OTHER };
const cash = { ...actor, role: 'caisse' as const };
const kitchen = { ...actor, role: 'cuisine' as const };

export function diningTestDatabase(raw: string): string {
  const url = new URL(raw);
  if (url.protocol !== 'mongodb:' || !['localhost', '127.0.0.1'].includes(url.hostname) || url.username || url.password || url.search || url.hash
    || !/^\/snackmanager_dining_test_[a-z0-9_]{1,20}$/i.test(url.pathname)) throw new Error('A dedicated local snackmanager_dining_test_ database without options is required.');
  url.pathname += `_${randomUUID().replaceAll('-', '').slice(0, 10)}`;
  return url.toString();
}
const uri = process.env.DINING_TEST_MONGO_URL ? diningTestDatabase(process.env.DINING_TEST_MONGO_URL) : null;
const integration = uri ? describe : describe.skip;
describe('dining test database boundary', () => {
  const authenticatedLocal = new URL('mongodb://localhost/snackmanager_dining_test_ci');
  authenticatedLocal.username = 'a';
  authenticatedLocal.password = 'b';
  it.each(['mongodb://remote.example/snackmanager_dining_test_ci', 'mongodb://localhost/snackmanager', 'mongodb://localhost/admin',
    'mongodb://localhost/snackmanager_dining_test_ci?replicaSet=production', authenticatedLocal.toString()])('refuses %s before I/O', (value) => expect(() => diningTestDatabase(value)).toThrow());
});
function barrier() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => { release = resolve; });
  return { promise, release };
}
function intercept<T>(model: Model<T>, match: (update: Record<string, unknown>) => boolean, effect: (run: () => Promise<unknown>) => Promise<unknown>): Model<T> {
  let armed = true;
  return new Proxy(model, { get(target, property) {
    const value = Reflect.get(target, property, target);
    if (property !== 'updateOne') return typeof value === 'function' ? value.bind(target) : value;
    return (...args: unknown[]) => {
      const query = Reflect.apply(value, target, args) as Query<unknown, T>;
      const run = query.exec.bind(query);
      query.exec = async () => {
        if (!armed || !match(args[1] as Record<string, unknown>)) return run();
        armed = false;
        return effect(run);
      };
      return query;
    };
  } });
}

integration('table service — real isolated Mongo, ordinary pricing, payment and handoff', () => {
  let db: Connection;
  let tables: Model<DiningTableRecord>; let sessions: Model<DiningSessionRecord>; let orders: Model<Order>;
  let pricings: Model<DiningOrderPricingRecord>;
  let products: Model<Product>; let counters: Model<Counter>; let promotions: Model<Promotion>; let tenants: Model<Tenant>;
  let logs: Model<AuditLog>; let staff: Model<Staff>; let users: Model<User>;
  let devices: Model<Device>; let app: INestApplication; let origin: string; let jwt: JwtService;
  let audit: AuditService; let orderService: OrdersService; let collection: OrderCounterCollectionService; let dining: DiningService;
  const redis = { publish: vi.fn().mockResolvedValue(1) };
  const capabilities = { pourTenant: vi.fn().mockResolvedValue(['bo']) };
  const makeService = (sessionModel = sessions, orderModel = orders, tableModel = tables) => new DiningService(tableModel, sessionModel, orderModel, orderService, capabilities as never, audit, redis as never);
  beforeAll(async () => {
    db = await mongoose.createConnection(uri!).asPromise();
    tables = db.model<DiningTableRecord>(MODELS.DiningTable.name, MODELS.DiningTable.schema, MODELS.DiningTable.collection);
    sessions = db.model<DiningSessionRecord>(MODELS.DiningSession.name, MODELS.DiningSession.schema, MODELS.DiningSession.collection);
    pricings = db.model<DiningOrderPricingRecord>(MODELS.DiningOrderPricing.name, MODELS.DiningOrderPricing.schema, MODELS.DiningOrderPricing.collection);
    orders = db.model<Order>(MODELS.Order.name, MODELS.Order.schema, MODELS.Order.collection);
    products = db.model<Product>(MODELS.Product.name, MODELS.Product.schema, MODELS.Product.collection);
    counters = db.model<Counter>(MODELS.Counter.name, MODELS.Counter.schema, MODELS.Counter.collection);
    promotions = db.model<Promotion>(MODELS.Promotion.name, MODELS.Promotion.schema, MODELS.Promotion.collection);
    tenants = db.model<Tenant>(MODELS.Tenant.name, MODELS.Tenant.schema, MODELS.Tenant.collection);
    logs = db.model<AuditLog>(MODELS.AuditLog.name, MODELS.AuditLog.schema, MODELS.AuditLog.collection);
    staff = db.model<Staff>(MODELS.Staff.name, MODELS.Staff.schema, MODELS.Staff.collection);
    users = db.model<User>(MODELS.User.name, MODELS.User.schema, MODELS.User.collection);
    devices = db.model<Device>(MODELS.Device.name, MODELS.Device.schema, MODELS.Device.collection);
    await Promise.all([tables.init(), sessions.init(), pricings.init(), orders.init(), products.init(), counters.init(), promotions.init(), logs.init()]);
    audit = new AuditService(logs, staff, users);
    orderService = new OrdersService(orders, products, counters, promotions, redis as never, audit, tenants, capabilities as never, {} as never, undefined, pricings);
    collection = new OrderCounterCollectionService(orders, capabilities as never, audit, redis as never);
    dining = makeService();
    const httpCapabilities = new CapacitesService(tenants);
    const httpOrders = new OrdersService(orders, products, counters, promotions, redis as never, audit, tenants, httpCapabilities, {} as never, undefined, pricings);
    const httpDining = new DiningService(tables, sessions, orders, httpOrders, httpCapabilities, audit, redis as never);
    const sessionAccess = new SessionAccessService(tenants, staff, devices, users);
    if (!Reflect.hasOwnMetadata('design:paramtypes', DiningController)) Reflect.defineMetadata('design:paramtypes', [DiningService], DiningController);
    class DiningHttpFixtureModule {}
    Module({ imports: [JwtModule.register({ secret: randomBytes(32).toString('base64url'), signOptions: { expiresIn: '5m' } })], controllers: [DiningController],
      providers: [{ provide: DiningService, useValue: httpDining }, { provide: APP_GUARD, inject: [JwtService, Reflector],
        useFactory: (signer: JwtService, reflector: Reflector) => new AuthGuard(signer, reflector, sessionAccess) }],
    })(DiningHttpFixtureModule);
    app = await NestFactory.create(DiningHttpFixtureModule, { logger: false, abortOnError: false });
    await app.listen(0, '127.0.0.1');
    origin = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
    jwt = app.get(JwtService);
  });
  beforeEach(async () => {
    vi.restoreAllMocks(); redis.publish.mockResolvedValue(1); capabilities.pourTenant.mockResolvedValue(['bo']);
    await Promise.all([tables.collection.deleteMany({}), sessions.collection.deleteMany({}), orders.collection.deleteMany({}), products.collection.deleteMany({}),
      counters.collection.deleteMany({}), promotions.collection.deleteMany({}), pricings.collection.deleteMany({}), logs.collection.deleteMany({})]);
    await Promise.all([tenants.collection.deleteMany({}), users.collection.deleteMany({}), staff.collection.deleteMany({}), devices.collection.deleteMany({})]);
    await sessions.createIndexes();
    await products.collection.insertOne({ _id: new Types.ObjectId(PRODUCT), tenantId: new Types.ObjectId(TENANT), name: 'Plat du test', price: 700,
      active: true, outOfStock: false, variants: [], optionGroups: [], removables: [] } as never);
  });
  afterAll(async () => {
    await app?.close();
    if (db) {
      if (!/^snackmanager_dining_test_[a-z0-9_]+$/i.test(db.name)) throw new Error('Unsafe cleanup refused');
      await db.dropDatabase(); await db.close();
    }
  });
  const table = (label: string, seats = 4) => dining.createTable(TENANT, actor, { operationId: randomUUID(), label, seats });
  const open = async (tableId: string) => dining.open(TENANT, cash, { operationId: randomUUID(), tableId, guestCount: 2 });
  const body = (revision: number) => {
    const operationId = randomUUID();
    return { operationId, expectedRevision: revision, order: { clientId: operationId, channel: 'pos', type: 'surplace',
      lines: [{ productId: PRODUCT, qty: 2, note: 'Sans sel' }], note: 'Premier envoi', payment: { method: 'counter', tender: null } } };
  };
  const rejection = (operationId: string) => expect.objectContaining({ response: expect.objectContaining({ code: 'DINING_OPERATION_REJECTED', operationId }) });
  async function httpFixture() {
    await tenants.create([{ _id: TENANT, slug: 'dining-http', name: 'Salle de recette', plan: 'essentiel', account: { status: 'active' } },
      { _id: OTHER, slug: 'dining-other', name: 'Autre restaurant', plan: 'essentiel', account: { status: 'active' } }]);
    const ownerId = new Types.ObjectId().toString(); const otherId = new Types.ObjectId().toString(); const coId = new Types.ObjectId().toString();
    const deviceId = new Types.ObjectId().toString(); const kitchenId = new Types.ObjectId().toString();
    await users.create([{ _id: ownerId, email: 'owner@dining.invalid', passwordHash: 'fixture', role: 'owner', tenantId: TENANT, sessionVersion: 'u1' },
      { _id: otherId, email: 'other@dining.invalid', passwordHash: 'fixture', role: 'owner', tenantId: OTHER, sessionVersion: 'u1' },
      { _id: coId, email: 'co@dining.invalid', passwordHash: 'fixture', role: 'cogerant', tenantId: TENANT, sessionVersion: 'u1' }]);
    await staff.create([{ _id: actor.sub, tenantId: TENANT, name: 'Caisse test', role: 'caisse', pinHash: 'fixture', active: true, sessionVersion: 's1' },
      { _id: kitchenId, tenantId: TENANT, name: 'Cuisine test', role: 'cuisine', pinHash: 'fixture', active: true, sessionVersion: 's1' }]);
    await devices.create({ _id: deviceId, tenantId: TENANT, name: 'POS test', kind: 'pos', paired: true, active: true, sessionVersion: 'd1' });
    const owner = await jwt.signAsync({ sub: ownerId, tenantId: TENANT, kind: 'user', role: 'owner', userSessionVersion: 'u1' });
    const foreign = await jwt.signAsync({ sub: otherId, tenantId: OTHER, kind: 'user', role: 'owner', userSessionVersion: 'u1' });
    const co = await jwt.signAsync({ sub: coId, tenantId: TENANT, kind: 'user', role: 'cogerant', userSessionVersion: 'u1' });
    const staffToken = (sub: string, role: string) => jwt.signAsync({ sub, tenantId: TENANT, kind: 'staff', role, staffSessionVersion: 's1', deviceId, deviceSessionVersion: 'd1' });
    return { owner, foreign, co, caisse: await staffToken(actor.sub, 'caisse'), kitchen: await staffToken(kitchenId, 'cuisine'), deviceId };
  }
  const http = (path: string, token?: string, method = 'GET', payload?: unknown) => fetch(`${origin}/dining${path}`, { method,
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), 'content-type': 'application/json' }, ...(payload ? { body: JSON.stringify(payload) } : {}) });

  it('configures real tables with unique names, bounded capacity and idempotent audited patches', async () => {
    const initial = await table('Terrasse 1');
    const patch = { operationId: randomUUID(), expectedRevision: initial.revision, label: 'Terrasse A', seats: 6, active: false };
    const changed = await dining.updateTable(TENANT, initial.id, actor, patch);
    expect(await dining.updateTable(TENANT, initial.id, actor, patch)).toEqual(changed);
    expect(changed).toMatchObject({ label: 'Terrasse A', seats: 6, active: false });
    expect(await logs.countDocuments({ action: 'dining.table.update' })).toBe(1);
    await expect(table('TERRASSE A')).rejects.toBeInstanceOf(ConflictException);
    const operation = { operationId: randomUUID(), tableId: initial.id, guestCount: 2 };
    await expect(dining.open(TENANT, cash, operation)).rejects.toEqual(rejection(operation.operationId));
  });
  it('arbitrates concurrent openings and never reopens a rejected attempt after the winning table closes', async () => {
    const target = await table('1');
    const first = { operationId: randomUUID(), tableId: target.id, guestCount: 2 };
    const second = { ...first, operationId: randomUUID() };
    const results = await Promise.allSettled([dining.open(TENANT, cash, first), dining.open(TENANT, cash, second)]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const winner = results.find((result) => result.status === 'fulfilled')!;
    if (winner.status !== 'fulfilled') throw new Error('missing winner');
    const loser = winner.value.id === first.operationId ? second : first;
    await dining.close(TENANT, winner.value.id, cash, { operationId: randomUUID(), expectedRevision: winner.value.revision });
    await expect(dining.open(TENANT, cash, loser)).rejects.toEqual(rejection(loser.operationId));
    expect(await sessions.countDocuments({ tenantId: TENANT, state: 'open' })).toBe(0);
  });
  it('returns the same opening and one audit after a lost mutation acknowledgement', async () => {
    const target = await table('1');
    const lost = makeService(intercept(sessions, (update) => (update.$set as { state?: string })?.state === 'open', async (run) => { await run(); throw new Error('lost ACK'); }));
    const request = { operationId: randomUUID(), tableId: target.id, guestCount: 2 };
    const created = await lost.open(TENANT, cash, request);
    expect(await dining.open(TENANT, cash, request)).toEqual(created);
    expect(await logs.countDocuments({ action: 'dining.session.open' })).toBe(1);
  });
  it('transfers exclusively, leaves the losing source occupied and rejects altered replay bodies', async () => {
    const [a, b, destination] = await Promise.all([table('1'), table('2'), table('3')]);
    const [one, two] = await Promise.all([open(a.id), open(b.id)]);
    const actions = [one, two].map((session) => ({ operationId: randomUUID(), expectedRevision: session.revision, tableId: destination.id }));
    const results = await Promise.allSettled([dining.transfer(TENANT, one.id, cash, actions[0]!), dining.transfer(TENANT, two.id, cash, actions[1]!)]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(await sessions.countDocuments({ tenantId: TENANT, tableId: destination.id, state: 'open' })).toBe(1);
    expect(await sessions.countDocuments({ tenantId: TENANT, state: 'open' })).toBe(2);
    const i = results[0]!.status === 'fulfilled' ? 0 : 1;
    await expect(dining.transfer(TENANT, [one, two][i]!.id, cash, { ...actions[i], tableId: a.id })).rejects.toBeInstanceOf(ConflictException);
  });
  it('sends multiple unpaid tickets through ordinary server pricing and preserves the table at each send', async () => {
    const [a, b] = await Promise.all([table('1'), table('2')]);
    const session = await open(a.id);
    const firstBody = body(session.revision);
    const first = await dining.addOrder(TENANT, session.id, cash, firstBody);
    expect(first.order).toMatchObject({ totals: { total: 1400 }, payment: { status: 'pending' }, status: 'new', dining: { tableId: a.id } });
    const transferred = await dining.transfer(TENANT, session.id, cash, { operationId: randomUUID(), expectedRevision: first.session.revision, tableId: b.id });
    const second = await dining.addOrder(TENANT, session.id, cash, body(transferred.revision));
    expect(second.order.dining?.tableId).toBe(b.id);
    expect((await dining.addOrder(TENANT, session.id, cash, firstBody)).order._id).toEqual(first.order._id);
    expect(await orders.countDocuments({ tenantId: TENANT })).toBe(2);
    expect((await dining.detail(TENANT, session.id, kitchen)).orders).toHaveLength(2);
  });
  it('never closes unpaid or unhanded tickets; existing collection and counter handoff complete the session', async () => {
    const session = await open((await table('1')).id);
    const created = await dining.addOrder(TENANT, session.id, cash, body(session.revision));
    const closeRequest = { operationId: randomUUID(), expectedRevision: created.session.revision };
    await expect(dining.close(TENANT, session.id, cash, closeRequest)).rejects.toEqual(rejection(closeRequest.operationId));
    await collection.collect(TENANT, String(created.order._id), cash, { operationId: randomUUID(), expectedTotalCents: 1400, tender: 'cash', cashReceivedCents: 2000 });
    await orderService.updateStatus(TENANT, String(created.order._id), 'ready', kitchen);
    await expect(orderService.updateStatus(TENANT, String(created.order._id), 'delivered', kitchen)).rejects.toBeInstanceOf(ForbiddenException);
    await orderService.updateStatus(TENANT, String(created.order._id), 'delivered', cash);
    const current = (await dining.detail(TENANT, session.id, cash)).session;
    const request = { operationId: randomUUID(), expectedRevision: current.revision };
    expect(await dining.close(TENANT, session.id, cash, request)).toMatchObject({ state: 'closed' });
    expect(await dining.close(TENANT, session.id, cash, request)).toMatchObject({ state: 'closed' });
    expect(await logs.countDocuments({ action: 'dining.session.close' })).toBe(1);
    expect(await orders.countDocuments({ tenantId: TENANT })).toBe(1);
  });
  it('fences an in-flight priced candidate when close wins first', async () => {
    const session = await open((await table('1')).id);
    const entered = barrier(); const resume = barrier();
    const delayed = makeService(intercept(sessions, (update) => Boolean((update.$push as { admissions?: unknown })?.admissions), async (run) => { entered.release(); await resume.promise; return run(); }));
    const request = body(session.revision);
    const pending = delayed.addOrder(TENANT, session.id, cash, request);
    await entered.promise;
    await dining.close(TENANT, session.id, cash, { operationId: randomUUID(), expectedRevision: session.revision });
    resume.release();
    await expect(pending).rejects.toEqual(rejection(request.operationId));
    expect(await orders.countDocuments({ tenantId: TENANT })).toBe(0);
    await expect(dining.addOrder(TENANT, session.id, cash, request)).rejects.toEqual(rejection(request.operationId));
  });
  it('recovers the exact committed snapshot after lost materialization and blocks close meanwhile', async () => {
    const session = await open((await table('1')).id);
    const lostOrders = intercept(orders, (update) => Boolean(update.$setOnInsert), async () => { throw new Error('network lost before materialization'); });
    const interrupted = makeService(sessions, lostOrders);
    const request = body(session.revision);
    await expect(interrupted.addOrder(TENANT, session.id, cash, request)).rejects.toBeInstanceOf(ServiceUnavailableException);
    const room = await dining.room(TENANT, cash);
    expect(room.sessions[0]?.pendingOperationCount).toBe(1);
    const closeRequest = { operationId: randomUUID(), expectedRevision: room.sessions[0]!.revision };
    await expect(dining.close(TENANT, session.id, cash, closeRequest)).rejects.toEqual(rejection(closeRequest.operationId));
    await products.updateOne({ _id: PRODUCT }, { $set: { price: 9999 } });
    const recovered = await dining.detail(TENANT, session.id, cash);
    expect(recovered.session.pendingOperationCount).toBe(0);
    expect(recovered.orders[0]?.totals.total).toBe(1400);
    expect((await dining.addOrder(TENANT, session.id, cash, request)).order._id).toEqual(recovered.orders[0]?._id);
    expect(await orders.countDocuments({ tenantId: TENANT })).toBe(1);
  });
  it('keeps a stock rejection terminal even after restock and allows a distinct corrected attempt', async () => {
    const session = await open((await table('1')).id);
    await products.updateOne({ _id: PRODUCT }, { $set: { outOfStock: true } });
    const request = body(session.revision);
    await expect(dining.addOrder(TENANT, session.id, cash, request)).rejects.toEqual(rejection(request.operationId));
    await products.updateOne({ _id: PRODUCT }, { $set: { outOfStock: false } });
    await expect(dining.addOrder(TENANT, session.id, cash, request)).rejects.toEqual(rejection(request.operationId));
    const refreshed = await dining.detail(TENANT, session.id, cash);
    expect((await dining.addOrder(TENANT, session.id, cash, body(refreshed.session.revision))).order.totals.total).toBe(1400);
  });
  it('admits concurrent identical sends once and compensates the losing promotion reservation', async () => {
    await promotions.collection.insertOne({ tenantId: new Types.ObjectId(TENANT), name: 'Offre test', kind: 'percent', value: 10,
      code: null, channels: ['pos'], active: true, maxUsage: 0, usageCount: 0 } as never);
    const session = await open((await table('1')).id);
    const request = body(session.revision);
    const results = await Promise.all([dining.addOrder(TENANT, session.id, cash, request), dining.addOrder(TENANT, session.id, cash, request)]);
    expect(String(results[0]!.order._id)).toBe(String(results[1]!.order._id));
    expect(results[0]!.order.totals.total).toBe(1260);
    expect(await orders.countDocuments({ tenantId: TENANT })).toBe(1);
    expect((await promotions.findOne({ tenantId: TENANT }))?.usageCount).toBe(1);
    expect(await logs.countDocuments({ action: 'dining.session.order' })).toBe(1);
  });
  it('repairs a lost audit after admission without reverting its promotion or changing the loyalty binding', async () => {
    await promotions.collection.insertOne({ tenantId: new Types.ObjectId(TENANT), name: 'Offre test', kind: 'percent', value: 10,
      code: null, channels: ['pos'], active: true, maxUsage: 0, usageCount: 0 } as never);
    const session = await open((await table('1')).id);
    const request = { ...body(session.revision) };
    const withLoyalty = { ...request, order: { ...request.order, loyaltyMemberId: randomUUID(), loyaltyEarnOperationId: randomUUID() } };
    vi.spyOn(audit, 'logOnce').mockRejectedValueOnce(new Error('audit temporarily unavailable'));
    await expect(dining.addOrder(TENANT, session.id, cash, withLoyalty)).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect((await promotions.findOne({ tenantId: TENANT }))?.usageCount).toBe(1);
    const resumed = await dining.addOrder(TENANT, session.id, cash, withLoyalty);
    const privateOrder = await orders.findById(resumed.order._id).select('+loyaltyMemberId +loyaltyEarnOperationId');
    expect(privateOrder?.loyaltyMemberId).toBe(withLoyalty.order.loyaltyMemberId);
    expect(privateOrder?.loyaltyEarnOperationId).toBe(withLoyalty.order.loyaltyEarnOperationId);
    expect(resumed.order.toJSON()).not.toHaveProperty('loyaltyMemberId');
    expect(await logs.countDocuments({ action: 'dining.session.order' })).toBe(1);
    expect((await promotions.findOne({ tenantId: TENANT }))?.usageCount).toBe(1);
  });
  it('preserves the price and last promo quota after admission CAS fails before execution', async () => {
    await promotions.collection.insertOne({ tenantId: new Types.ObjectId(TENANT), name: 'Dernière offre', kind: 'percent', value: 10,
      code: null, channels: ['pos'], active: true, maxUsage: 1, usageCount: 0 } as never);
    const session = await open((await table('1')).id);
    const delayed = makeService(intercept(sessions, (update) => Boolean((update.$push as { admissions?: unknown })?.admissions), async () => { throw new Error('CAS never reached server'); }));
    const request = body(session.revision);
    await expect(delayed.addOrder(TENANT, session.id, cash, request)).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(await orders.countDocuments({ tenantId: TENANT })).toBe(0);
    expect((await promotions.findOne({ tenantId: TENANT }))?.usageCount).toBe(1);
    await products.updateOne({ _id: PRODUCT }, { $set: { price: 9999 } });
    await promotions.updateOne({ tenantId: TENANT }, { $set: { active: false } });
    const resumed = await dining.addOrder(TENANT, session.id, cash, request);
    expect(resumed.order.totals.total).toBe(1260);
    expect((await promotions.findOne({ tenantId: TENANT }))?.usageCount).toBe(1);
  });
  it('does not release another session’s quota when an operation UUID is reused with another binding', async () => {
    await promotions.collection.insertOne({ tenantId: new Types.ObjectId(TENANT), name: 'Offre liée', kind: 'percent', value: 10,
      code: null, channels: ['pos'], active: true, maxUsage: 1, usageCount: 0 } as never);
    const first = await open((await table('1')).id); const second = await open((await table('2')).id);
    const delayed = makeService(intercept(sessions, (update) => Boolean((update.$push as { admissions?: unknown })?.admissions), async () => { throw new Error('CAS not sent'); }));
    const request = body(first.revision);
    await expect(delayed.addOrder(TENANT, first.id, cash, request)).rejects.toBeInstanceOf(ServiceUnavailableException);
    await expect(dining.addOrder(TENANT, second.id, cash, { ...request, expectedRevision: second.revision })).rejects.toMatchObject({
      response: { code: 'DINING_PRICING_IDENTITY_CONFLICT' },
    });
    expect((await promotions.findOne({ tenantId: TENANT }))?.usageCount).toBe(1);
    await expect(dining.addOrder(TENANT, second.id, cash, { ...request, expectedRevision: 0 })).rejects.toMatchObject({
      response: { code: 'DINING_PRICING_IDENTITY_CONFLICT' },
    });
    expect((await promotions.findOne({ tenantId: TENANT }))?.usageCount).toBe(1);
    expect((await dining.addOrder(TENANT, first.id, cash, request)).order.totals.total).toBe(1260);
    expect((await dining.detail(TENANT, second.id, cash)).orders).toHaveLength(0);
  });
  it('makes table disabling win against an attribution whose grant has not committed', async () => {
    const target = await table('1'); const entered = barrier(); const resume = barrier();
    const delayed = makeService(sessions, orders, intercept(tables, (update) => Boolean((update.$push as { grants?: unknown })?.grants), async (run) => { entered.release(); await resume.promise; return run(); }));
    const request = { operationId: randomUUID(), tableId: target.id, guestCount: 2 };
    const opening = delayed.open(TENANT, cash, request);
    await entered.promise;
    await dining.updateTable(TENANT, target.id, actor, { operationId: randomUUID(), expectedRevision: target.revision, active: false });
    resume.release();
    await expect(opening).rejects.toEqual(rejection(request.operationId));
    expect((await dining.room(TENANT, actor)).sessions).toHaveLength(0);
  });
  it('honors an already accepted table grant and its label/capacity after disabling, including replay', async () => {
    const target = await table('1'); const entered = barrier(); const resume = barrier();
    const delayed = makeService(intercept(sessions, (update) => (update.$set as { state?: string })?.state === 'open', async (run) => { entered.release(); await resume.promise; return run(); }));
    const request = { operationId: randomUUID(), tableId: target.id, guestCount: 4 };
    const opening = delayed.open(TENANT, cash, request);
    await entered.promise;
    const current = (await dining.room(TENANT, actor)).tables[0]!;
    await dining.updateTable(TENANT, target.id, actor, { operationId: randomUUID(), expectedRevision: current.revision, active: false, label: 'Nouveau nom', seats: 1 });
    resume.release();
    const opened = await opening;
    expect(opened).toMatchObject({ tableLabel: '1', guestCount: 4, state: 'open' });
    expect(await dining.open(TENANT, cash, request)).toEqual(opened);
    expect((await dining.room(TENANT, actor)).tables[0]).toMatchObject({ active: false, seats: 1, label: 'Nouveau nom' });
  });
  it.each(['before-grant', 'after-grant'] as const)('serializes transfer and destination disabling (%s)', async (moment) => {
    const source = await table('1'); const destination = await table('2');
    const session = await open(source.id); const entered = barrier(); const resume = barrier();
    const stop = async (run: () => Promise<unknown>) => { entered.release(); await resume.promise; return run(); };
    const delayed = moment === 'before-grant'
      ? makeService(sessions, orders, intercept(tables, (update) => Boolean((update.$push as { grants?: unknown })?.grants), stop))
      : makeService(intercept(sessions, (update) => (update.$set as { tableId?: string })?.tableId === destination.id, stop));
    const request = { operationId: randomUUID(), expectedRevision: session.revision, tableId: destination.id };
    const pending = delayed.transfer(TENANT, session.id, cash, request);
    await entered.promise;
    const current = (await dining.room(TENANT, actor)).tables.find((entry) => entry.id === destination.id)!;
    await dining.updateTable(TENANT, destination.id, actor, { operationId: randomUUID(), expectedRevision: current.revision, active: false, label: 'Fermée', seats: 1 });
    resume.release();
    if (moment === 'before-grant') {
      await expect(pending).rejects.toEqual(rejection(request.operationId));
      expect((await dining.detail(TENANT, session.id, cash)).session.tableId).toBe(source.id);
    } else {
      const moved = await pending;
      expect(moved).toMatchObject({ tableId: destination.id, tableLabel: '2', guestCount: 2 });
      expect(await dining.transfer(TENANT, session.id, cash, request)).toEqual(moved);
    }
  });
  it('keeps the 200-table ceiling atomic when two creations compete for the last position', async () => {
    const fixtures = Array.from({ length: 199 }, (_, position) => {
      const id = randomUUID();
      return { _id: `${TENANT}:${id}`, tenantId: new Types.ObjectId(TENANT), publicId: id, label: `Fixture ${position}`,
        labelKey: `fixture ${position}`, position, seats: 4, active: true, state: 'created', revision: 0, operations: [], grants: [] };
    });
    await tables.collection.insertMany(fixtures as never);
    const results = await Promise.allSettled([table('Dernière A'), table('Dernière B')]);
    expect(results.filter((entry) => entry.status === 'fulfilled')).toHaveLength(1);
    expect(await tables.countDocuments({ tenantId: TENANT, state: 'created' })).toBe(200);
    expect((await dining.room(TENANT, actor)).tables).toHaveLength(200);
  });
  it('fences a duplicate table label and a stale configuration so their replays never mutate later state', async () => {
    const first = await table('1');
    const create = { operationId: randomUUID(), label: '1', seats: 2 };
    await expect(dining.createTable(TENANT, actor, create)).rejects.toEqual(rejection(create.operationId));
    const rename = { operationId: randomUUID(), expectedRevision: first.revision, label: 'A' };
    const changed = await dining.updateTable(TENANT, first.id, actor, rename);
    await expect(dining.createTable(TENANT, actor, create)).rejects.toEqual(rejection(create.operationId));
    const stale = { operationId: randomUUID(), expectedRevision: first.revision, label: 'B' };
    await expect(dining.updateTable(TENANT, first.id, actor, stale)).rejects.toEqual(rejection(stale.operationId));
    await expect(dining.updateTable(TENANT, first.id, actor, stale)).rejects.toEqual(rejection(stale.operationId));
    expect((await dining.room(TENANT, actor)).tables[0]?.label).toBe(changed.label);
  });
  it('does not leak tables across tenants and refuses roles/capabilities before mutations', async () => {
    const target = await table('1');
    expect((await dining.room(OTHER, other)).tables).toHaveLength(0);
    await expect(dining.updateTable(OTHER, target.id, other, { operationId: randomUUID(), expectedRevision: 0, label: 'X' })).rejects.toBeInstanceOf(NotFoundException);
    await expect(dining.createTable(TENANT, cash, { operationId: randomUUID(), label: 'X', seats: 2 })).rejects.toBeInstanceOf(ForbiddenException);
    await expect(dining.open(TENANT, kitchen, { operationId: randomUUID(), tableId: target.id, guestCount: 2 })).rejects.toBeInstanceOf(ForbiddenException);
    await expect(dining.room(TENANT, other)).rejects.toBeInstanceOf(ForbiddenException);
    capabilities.pourTenant.mockResolvedValue(['online']);
    await expect(dining.room(TENANT, actor)).rejects.toBeInstanceOf(ForbiddenException);
  });
  it('serves before payment without changing financial/kitchen status, then closes through the established handoff', async () => {
    const session = await open((await table('1')).id);
    const created = await dining.addOrder(TENANT, session.id, cash, body(session.revision));
    await orderService.updateStatus(TENANT, String(created.order._id), 'ready', kitchen);
    const request = { operationId: randomUUID() };
    const served = await dining.serve(TENANT, session.id, String(created.order._id), cash, request);
    expect(served.order).toMatchObject({ status: 'ready', payment: { status: 'pending' }, dining: { servedAt: expect.any(Date) } });
    expect((await dining.serve(TENANT, session.id, String(created.order._id), actor, request)).order.dining?.servedAt).toEqual(served.order.dining?.servedAt);
    expect(await logs.countDocuments({ action: 'dining.session.serve' })).toBe(1);
    expect(served.order.toJSON()).not.toHaveProperty('diningServeReceipt');
    const earlyClose = { operationId: randomUUID(), expectedRevision: served.session.revision };
    await expect(dining.close(TENANT, session.id, cash, earlyClose)).rejects.toEqual(rejection(earlyClose.operationId));
    await collection.collect(TENANT, String(created.order._id), cash, { operationId: randomUUID(), expectedTotalCents: 1400, tender: 'card' });
    const current = (await dining.detail(TENANT, session.id, cash)).session;
    const closed = await dining.close(TENANT, session.id, cash, { operationId: randomUUID(), expectedRevision: current.revision });
    expect(closed.state).toBe('closed');
    expect((await orders.findById(created.order._id))?.status).toBe('delivered');
  });
  it('arbitrates two serve operations, repairs a lost audit and never rewrites the winning physical timestamp', async () => {
    const session = await open((await table('1')).id);
    const created = await dining.addOrder(TENANT, session.id, cash, body(session.revision));
    await orderService.updateStatus(TENANT, String(created.order._id), 'ready', kitchen);
    const one = { operationId: randomUUID() }; const two = { operationId: randomUUID() };
    const results = await Promise.allSettled([dining.serve(TENANT, session.id, String(created.order._id), cash, one), dining.serve(TENANT, session.id, String(created.order._id), cash, two)]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(await logs.countDocuments({ action: 'dining.session.serve' })).toBe(1);
    const winner = results[0]!.status === 'fulfilled' ? one : two;
    const before = (await orders.findById(created.order._id))!.dining!.servedAt;
    vi.spyOn(audit, 'logOnce').mockRejectedValueOnce(new Error('lost audit read'));
    await expect(dining.serve(TENANT, session.id, String(created.order._id), cash, winner)).rejects.toBeInstanceOf(ServiceUnavailableException);
    await dining.detail(TENANT, session.id, cash);
    expect((await orders.findById(created.order._id))!.dining!.servedAt).toEqual(before);
    expect(await logs.countDocuments({ action: 'dining.session.serve' })).toBe(1);
  });
  it.each(['delivered', 'ready'] as const)('closes a refunded ticket only when already terminal: %s', async (status) => {
    const session = await open((await table('1')).id);
    const created = await dining.addOrder(TENANT, session.id, cash, body(session.revision));
    const orderId = String(created.order._id);
    await collection.collect(TENANT, orderId, cash, { operationId: randomUUID(), expectedTotalCents: 1400, tender: 'cash', cashReceivedCents: 2000 });
    await orderService.updateStatus(TENANT, orderId, 'ready', kitchen);
    await dining.serve(TENANT, session.id, orderId, cash, { operationId: randomUUID() });
    if (status === 'delivered') await orderService.updateStatus(TENANT, orderId, 'delivered', cash);
    // Represent a completed refund fact; this test never invokes a payment provider.
    await orders.updateOne({ _id: orderId }, { $set: { 'payment.status': 'refunded' } });
    const before = (await orders.findById(orderId))!.toObject();
    const transition = vi.spyOn(orderService, 'updateStatus');
    const request = { operationId: randomUUID(), expectedRevision: created.session.revision };
    if (status === 'delivered') {
      expect(await dining.close(TENANT, session.id, cash, request)).toMatchObject({ state: 'closed' });
      expect(await dining.close(TENANT, session.id, cash, request)).toMatchObject({ state: 'closed' });
      expect(await logs.countDocuments({ action: 'dining.session.close' })).toBe(1);
    } else {
      await expect(dining.close(TENANT, session.id, cash, request)).rejects.toEqual(rejection(request.operationId));
      expect((await dining.detail(TENANT, session.id, cash)).session.state).toBe('open');
      expect(await logs.countDocuments({ action: 'dining.session.close' })).toBe(0);
    }
    const after = (await orders.findById(orderId))!.toObject();
    expect(after.status).toBe(status);
    expect(after.payment).toEqual(before.payment);
    expect(after.dining?.servedAt).toEqual(before.dining?.servedAt);
    expect(transition).not.toHaveBeenCalled();
  });
  it('keeps a premature serve rejection fenced after the kitchen becomes ready', async () => {
    const session = await open((await table('1')).id);
    const created = await dining.addOrder(TENANT, session.id, cash, body(session.revision));
    const refused = { operationId: randomUUID() };
    await expect(dining.serve(TENANT, session.id, String(created.order._id), cash, refused)).rejects.toEqual(rejection(refused.operationId));
    await orderService.updateStatus(TENANT, String(created.order._id), 'ready', kitchen);
    await expect(dining.serve(TENANT, session.id, String(created.order._id), cash, refused)).rejects.toEqual(rejection(refused.operationId));
    expect((await dining.serve(TENANT, session.id, String(created.order._id), cash, { operationId: randomUUID() })).order.dining?.servedAt).toBeInstanceOf(Date);
  });
  it('uses actual HTTP JWT/session guards, tenant scoping, role subsumption and schema validation', async () => {
    const tokens = await httpFixture();
    expect((await http('/room')).status).toBe(401);
    expect((await http('/room', 'not-a-token')).status).toBe(401);
    const request = { operationId: randomUUID(), label: 'HTTP', seats: 4 };
    expect((await http('/tables', tokens.caisse, 'POST', request)).status).toBe(403);
    expect((await http('/tables', tokens.co, 'POST', request)).status).toBe(201);
    const created = await (await http('/tables', tokens.co, 'POST', request)).json();
    expect(created).toMatchObject({ id: request.operationId, label: 'HTTP' });
    expect(created).not.toHaveProperty('operations');
    expect((await http('/tables', tokens.owner, 'POST', { ...request, operationId: randomUUID(), seats: 0 })).status).toBe(400);
    expect((await http(`/tables/${created.id}`, tokens.foreign, 'PATCH', { operationId: randomUUID(), expectedRevision: 0, label: 'Foreign' })).status).toBe(404);
    expect((await http('/sessions', tokens.kitchen, 'POST', { operationId: randomUUID(), tableId: created.id, guestCount: 2 })).status).toBe(403);
    const opened = await (await http('/sessions', tokens.caisse, 'POST', { operationId: randomUUID(), tableId: created.id, guestCount: 2 })).json();
    const ticketResponse = await http(`/sessions/${opened.id}/orders`, tokens.caisse, 'POST', body(opened.revision));
    expect(ticketResponse.status).toBe(200);
    const ticket = await ticketResponse.json();
    expect(ticket.order.dining).toMatchObject({ sessionId: opened.id, tableId: created.id });
    expect(ticket.order).not.toHaveProperty('paymentFlow');
    expect((await http(`/sessions/${opened.id}/orders/${ticket.order._id}/serve`, tokens.kitchen, 'POST', { operationId: randomUUID() })).status).toBe(403);
    await orderService.updateStatus(TENANT, ticket.order._id, 'ready', kitchen);
    const servedResponse = await http(`/sessions/${opened.id}/orders/${ticket.order._id}/serve`, tokens.caisse, 'POST', { operationId: randomUUID() });
    expect(servedResponse.status).toBe(200);
    const served = await servedResponse.json();
    expect(served.order.dining.servedAt).toEqual(expect.any(String));
    expect(served.order).not.toHaveProperty('diningServeReceipt');
    expect(served.order).not.toHaveProperty('diningServeRejections');
    await devices.updateOne({ _id: tokens.deviceId }, { $set: { active: false } });
    expect((await http('/room', tokens.caisse)).status).toBe(401);
    await tenants.updateOne({ _id: TENANT }, { $set: { 'account.status': 'suspended' } });
    expect((await http('/room', tokens.owner)).status).toBe(403);
  });
  it('fails closed when the active-table unique index is absent', async () => {
    const target = await table('1');
    await sessions.collection.dropIndex(DINING_ACTIVE_TABLE_INDEX);
    await expect(open(target.id)).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(await sessions.countDocuments({ tenantId: TENANT })).toBe(0);
  });
  it('prepares dining DDL additively and idempotently with automatic creation/indexing disabled', async () => {
    const isolated = await mongoose.createConnection(uri!, { autoCreate: false, autoIndex: false }).asPromise();
    try {
      const tableModel = isolated.model<DiningTableRecord>('DiningTableBootstrap', MODELS.DiningTable.schema, 'dining_bootstrap_tables');
      const sessionModel = isolated.model<DiningSessionRecord>('DiningSessionBootstrap', MODELS.DiningSession.schema, 'dining_bootstrap_sessions');
      const pricingModel = isolated.model<DiningOrderPricingRecord>('DiningPricingBootstrap', MODELS.DiningOrderPricing.schema, 'dining_bootstrap_pricing');
      await prepareDiningSchemas(tableModel, sessionModel, pricingModel);
      await tableModel.collection.createIndex({ label: 1 }, { name: 'preserved_extra_index' });
      await prepareDiningSchemas(tableModel, sessionModel, pricingModel);
      expect((await sessionModel.collection.listIndexes().toArray()).some((entry) => entry.name === DINING_ACTIVE_TABLE_INDEX && entry.unique)).toBe(true);
      expect((await tableModel.collection.listIndexes().toArray()).some((entry) => entry.name === 'preserved_extra_index')).toBe(true);
      expect((await pricingModel.collection.listIndexes().toArray()).some((entry) => entry.name === '_id_')).toBe(true);
    } finally { await isolated.close(); }
  });
});
