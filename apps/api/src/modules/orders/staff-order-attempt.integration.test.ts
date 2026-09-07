import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import mongoose, { Types, type Connection, type Model, type Query } from 'mongoose';
import { MODELS, type Order, type PublicOrderAdmission } from '@sm/db';
import { CreatePublicOrderSchema, StaffOrderAttemptResultSchema, StaffPhoneOrderAttemptRequestSchema, roleSatisfait, type CreateOrder, type JwtPayload } from '@sm/contracts';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { HTTP_CODE_METADATA, METHOD_METADATA, PATH_METADATA, ROUTE_ARGS_METADATA } from '@nestjs/common/constants';
import { RequestMethod } from '@nestjs/common';
import { OrdersService } from './orders.service';
import { OrdersController } from './orders.controller';
import { PublicOrderAdmissionService } from './public-order-admission.service';
import { capacityModels, seedCapacityFixture } from './order-capacity-test-fixtures';
import { orderAdmissionId } from './order-admission-identity';
import { publicRecoveryBinding } from './order-recovery';
import { SlotsService } from '../ordering/slots.service';
import { OrderCapacityAvailabilityService } from '../ordering/order-capacity-availability.service';
import { OrderCapacityCalendarStore } from '../ordering/order-capacity-calendar.store';
import { addDays, formatDay, parisWallToUtc, parisYmd } from '../ordering/paris-time';
import { IS_PUBLIC, ROLES } from '../../common/auth';
import { FONCTION_REQUISE } from '../../common/capacites';
import { ZodValidationPipe } from '../../common/zod.pipe';

const TENANT = '507f1f77bcf86cd799439011';
const OTHER_TENANT = '507f1f77bcf86cd799439021';
const PRODUCT = '507f1f77bcf86cd799439012';
const SLOT = parisWallToUtc(addDays(parisYmd(new Date()), 1), 18).toISOString();
const DAY = formatDay(parisYmd(new Date(SLOT)));
const PRIVATE = '+kind +channel +proofHash +payloadHash +snapshot +capacity +validationOwner +historicalImport';
const RUN_ID = randomUUID();
const USER = { sub: 'staff-fixture', tenantId: TENANT, role: 'caisse', kind: 'staff' } as JwtPayload;

export function staffAttemptTestDatabase(raw: string): string {
  const url = new URL(raw);
  if (url.protocol !== 'mongodb:' || !['localhost', '127.0.0.1'].includes(url.hostname)
    || url.username || url.password || url.search || url.hash
    || !/^\/snackmanager_runtime_test_[a-z0-9_]{1,20}$/i.test(url.pathname)) {
    throw new Error('STAFF_ORDER_ATTEMPT_TEST_MONGO_URL doit cibler une base runtime isolée locale sans options.');
  }
  url.pathname += `_${randomUUID().replaceAll('-', '').slice(0, 10)}`;
  return url.toString();
}
const uri = process.env.STAFF_ORDER_ATTEMPT_TEST_MONGO_URL ? staffAttemptTestDatabase(process.env.STAFF_ORDER_ATTEMPT_TEST_MONGO_URL) : null;
const integration = uri ? describe : describe.skip;

describe('cible Mongo des tentatives staff', () => {
  const credentials = new URL('mongodb://localhost/snackmanager_runtime_test_staff');
  credentials.username = 'synthetic'; credentials.password = 'synthetic';
  it.each(['mongodb://remote.example/snackmanager_runtime_test_staff', 'mongodb+srv://localhost/snackmanager_runtime_test_staff',
    'mongodb://localhost/admin', 'mongodb://localhost/snackmanager', 'mongodb://localhost/snackmanager_runtime_test_staff?retryWrites=true',
    'mongodb://localhost/snackmanager_runtime_test_staff#fragment', credentials.toString()])('refuse %s avant I/O', (raw) => {
    expect(() => staffAttemptTestDatabase(raw)).toThrow();
  });
  it('alloue une nouvelle base UUID à chaque passage', () => {
    const target = 'mongodb://127.0.0.1:27037/snackmanager_runtime_test_staff';
    expect(staffAttemptTestDatabase(target)).not.toBe(staffAttemptTestDatabase(target));
  });
});

function request() {
  return StaffPhoneOrderAttemptRequestSchema.parse({ clientId: randomUUID(), channel: 'phone', type: 'pickup',
    lines: [{ productId: PRODUCT, qty: 1 }], payment: { method: 'counter' },
    pickup: { slot: SLOT, customerName: 'Client de recette', customerPhone: '0600000000' } });
}
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
function replica(stored: Models, overrides: { orders?: Model<Order>; admissions?: Model<PublicOrderAdmission>; capabilities?: string[] } = {}) {
  const orders = overrides.orders ?? stored.orders; const admissions = overrides.admissions ?? stored.admissions;
  const facade = new PublicOrderAdmissionService(admissions, orders, redis as never, stored.days, stored.tenants);
  const service = new OrdersService(orders, stored.products, stored.counters, stored.promotions, redis as never, {} as never, stored.tenants,
    { pourTenant: async () => overrides.capabilities ?? ['bo', 'online'] } as never, {} as never, facade);
  const slots = new SlotsService(new OrderCapacityAvailabilityService(stored.tenants, stored.days, admissions, orders));
  const controller = new OrdersController(service, {} as never, {} as never, slots, {} as never, facade, {} as never);
  return { facade, service, controller, slots };
}
function barrier() { let release!: () => void; const promise = new Promise<void>((resolve) => { release = resolve; }); return { promise, release }; }
function intercept<T>(model: Model<T>, matches: (update: Record<string, unknown>) => boolean, effect: (run: () => Promise<unknown>) => Promise<unknown>) {
  let armed = true;
  return new Proxy(model, { get(target, key) {
    const value = Reflect.get(target, key, target);
    if (key !== 'updateOne') return typeof value === 'function' ? value.bind(target) : value;
    return (...args: unknown[]) => {
      const query = Reflect.apply(value, target, args) as Query<unknown, T>; const execute = query.exec.bind(query);
      query.exec = async () => {
        if (!armed || !matches(args[1] as Record<string, unknown>)) return execute();
        armed = false; return effect(execute);
      };
      return query;
    };
  } });
}
function transition(state: string) { return (update: Record<string, unknown>) => (update.$set as { state?: string })?.state === state; }

describe('routes staff — provenance, rôles et validation du corps', () => {
  it.each([
    ['staffSlots', 'orders/slots', RequestMethod.GET], ['staffRecovery', 'orders/recovery', RequestMethod.POST],
    ['staffAbandon', 'orders/abandon', RequestMethod.POST], ['create', 'orders', RequestMethod.POST],
  ] as const)('%s exige une session de comptoir et la fonction orders', (method, path, verb) => {
    const handler = OrdersController.prototype[method]; const roles = Reflect.getMetadata(ROLES, handler) as string[];
    expect(Reflect.getMetadata(PATH_METADATA, handler)).toBe(path);
    expect(Reflect.getMetadata(METHOD_METADATA, handler)).toBe(verb);
    expect(Reflect.getMetadata(IS_PUBLIC, handler)).not.toBe(true);
    expect(Reflect.getMetadata(IS_PUBLIC, OrdersController)).not.toBe(true);
    expect(Reflect.getMetadata(FONCTION_REQUISE, OrdersController)).toBe('orders');
    expect(roles).toEqual(['owner', 'gerant', 'caisse']);
    for (const role of ['owner', 'gerant', 'cogerant', 'caisse']) expect(roleSatisfait(role, roles)).toBe(true);
    for (const role of ['cuisine', 'livreur']) expect(roleSatisfait(role, roles)).toBe(false);
  });
  it.each(['staffRecovery', 'staffAbandon'] as const)('%s impose HTTP200 et applique réellement le schéma du body', (method) => {
    const handler = OrdersController.prototype[method];
    expect(Reflect.getMetadata(HTTP_CODE_METADATA, handler)).toBe(200);
    const metadata = Reflect.getMetadata(ROUTE_ARGS_METADATA, OrdersController, method) as Record<string, { pipes?: unknown[] }>;
    const pipe = Object.values(metadata).flatMap((entry) => entry.pipes ?? []).find((entry) => entry instanceof ZodValidationPipe) as ZodValidationPipe;
    expect(pipe).toBeInstanceOf(ZodValidationPipe);
    const body = request();
    expect(pipe.transform(body)).toEqual(body);
    expect(() => pipe.transform({ ...request(), clientId: 'not-uuid' })).toThrow();
    expect(() => pipe.transform({ ...request(), lines: [] })).toThrow();
    expect(() => pipe.transform({ ...request(), pickup: { ...request().pickup, slot: 'tomorrow' } })).toThrow();
    expect(() => pipe.transform({ ...request(), tenantId: OTHER_TENANT })).toThrow();
    expect(() => pipe.transform({ ...request(), lines: Array(51).fill(request().lines[0]) })).toThrow();
  });
  it('le pipe create valide phone strictement avant suppression des extras, sans changer le corps POS', () => {
    const metadata = Reflect.getMetadata(ROUTE_ARGS_METADATA, OrdersController, 'create') as Record<string, { pipes?: unknown[] }>;
    const pipe = Object.values(metadata).flatMap((entry) => entry.pipes ?? []).find((entry) => entry instanceof ZodValidationPipe) as ZodValidationPipe;
    const body = request();
    expect(pipe.transform(body)).toEqual(body);
    expect(() => pipe.transform({ ...body, tenantId: OTHER_TENANT })).toThrow();
    expect(() => pipe.transform({ ...body, lines: [{ ...body.lines[0], unitPrice: 1 }] })).toThrow();
    expect(() => pipe.transform({ ...body, pickup: { ...body.pickup, customerName: 'n'.repeat(121) } })).toThrow();
    expect(() => pipe.transform({ ...body, lines: Array(51).fill(body.lines[0]) })).toThrow();
    const pos = { ...body, channel: 'pos', type: 'surplace', pickup: undefined, payment: { method: 'counter', tender: 'cash', cashReceived: 2_000 } };
    expect(pipe.transform(pos)).toEqual(pos);
  });
});

integration('tentatives staff — vrai Mongo, deux connexions, vrais services et contrôleurs', () => {
  let dbA: Connection; let dbB: Connection; let first: Models; let second: Models;
  let a: ReturnType<typeof replica>; let b: ReturnType<typeof replica>; let ownsDatabase = false;
  async function owned() {
    if (!uri || !ownsDatabase || dbA.name !== new URL(uri).pathname.slice(1)
      || !/^snackmanager_runtime_test_[a-z0-9_]+_[a-f0-9]{10}$/i.test(dbA.name)
      || !await dbA.db!.collection('_test_run').findOne({ runId: RUN_ID })) throw new Error('Base de recette staff non possédée.');
  }
  beforeAll(async () => {
    dbA = await mongoose.createConnection(uri!, { autoIndex: false, autoCreate: false, monitorCommands: true }).asPromise();
    expect(await dbA.db!.listCollections({}, { nameOnly: true }).toArray()).toEqual([]);
    await dbA.db!.collection('_test_run').insertOne({ runId: RUN_ID }); ownsDatabase = true;
    dbB = await mongoose.createConnection(uri!, { autoIndex: false, autoCreate: false }).asPromise();
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
    finally { await Promise.all([dbA?.close(), dbB?.close()]); }
  });
  const persisted = (body: CreateOrder) => first.admissions.findById(orderAdmissionId(TENANT, body.clientId)).select(PRIVATE).lean();

  it('la lecture avant POST est pending, sans admission, ticket, numéro ni refus inventé', async () => {
    const body = request();
    expect(await a.controller.staffRecovery(TENANT, body)).toEqual({ tenantId: TENANT, clientId: body.clientId, channel: 'phone', state: 'pending' });
    expect(await first.orders.countDocuments()).toBe(0);
    expect(await first.admissions.countDocuments()).toBe(0);
    expect(await first.counters.countDocuments()).toBe(0);
  });
  it('le calendrier envoie réellement majority+journal+wtimeout dans sa commande insert Mongo', async () => {
    await first.days.collection.deleteMany({ tenantId: new Types.ObjectId(TENANT) });
    await first.tenants.collection.updateOne({ _id: new Types.ObjectId(TENANT) }, { $set: {
      hours: Array.from({ length: 7 }, (_, index) => ({ day: index + 1, dinner: { open: '18:00', close: '19:00' } })),
    } });
    const writes: { name: string; concern: unknown }[] = [];
    const observe = (event: mongoose.mongo.CommandStartedEvent) => {
      if (event.databaseName === dbA.name && event.commandName === 'insert' && event.command.insert === MODELS.OrderCapacityDay.collection) {
        writes.push({ name: event.commandName, concern: event.command.writeConcern });
      }
    };
    dbA.getClient().on('commandStarted', observe);
    try {
      const ready = await new OrderCapacityCalendarStore(first.tenants, first.days, first.admissions, first.orders).ensureDay(TENANT, DAY);
      expect(ready.state).toBe('ready');
      expect(writes).toEqual([{ name: 'insert', concern: { w: 'majority', j: true, wtimeout: 10_000 } }]);
    } finally { dbA.getClient().off('commandStarted', observe); }
  });
  it('abandon avant POST pose une tombe durable et bloque tout POST retardé', async () => {
    const body = request();
    expect(await a.controller.staffAbandon(TENANT, body)).toMatchObject({ state: 'rejected', code: 'ORDER_ATTEMPT_REJECTED', reason: 'abandoned' });
    expect(await persisted(body)).toMatchObject({ state: 'rejected', kind: 'staff', channel: 'phone', rejection: 'abandoned', snapshot: null });
    await expect(b.controller.create(TENANT, USER, body)).rejects.toMatchObject({ status: 409, response: { code: 'ORDER_ATTEMPT_REJECTED', reason: 'abandoned' } });
    expect(await first.orders.countDocuments()).toBe(0);
    expect(await first.counters.countDocuments()).toBe(0);
    expect(await first.admissions.countDocuments({ 'capacity.kitchenSeat': { $exists: true } })).toBe(0);
  });
  it.each(['cash', 'card', 'meal_voucher'] as const)('la création téléphone ne peut déclarer le paiement %s avant confirmation de réservation', async (tender) => {
    const body: CreateOrder = { ...request(), payment: { method: 'counter', tender, ...(tender === 'cash' ? { cashReceived: 2_000 } : {}) } };
    await expect(a.controller.create(TENANT, USER, body)).rejects.toMatchObject({ status: 400 });
    expect(await first.orders.countDocuments()).toBe(0);
    expect(await first.admissions.countDocuments()).toBe(0);
  });
  it('la défense service refuse un corps téléphone démesuré avant le journal ou le menu', async () => {
    const body = request();
    await expect(a.service.create(TENANT, { ...body, lines: Array(51).fill(body.lines[0]) }, USER.sub)).rejects.toMatchObject({ status: 400 });
    await expect(a.service.create(TENANT, { ...body, pickup: { ...body.pickup, customerName: 'n'.repeat(121) } }, USER.sub)).rejects.toMatchObject({ status: 400 });
    expect(await first.orders.countDocuments()).toBe(0);
    expect(await first.admissions.countDocuments()).toBe(0);
    expect(await first.counters.countDocuments()).toBe(0);
  });

  it.each(['past_day', 'inside_lead_time', 'beyond_horizon'] as const)('nouvelle commande téléphone %s : un siège libre ne rend pas le créneau réservable', async (scenario) => {
    const slot = scenario === 'past_day' ? parisWallToUtc(addDays(parisYmd(new Date()), -1), 18).toISOString()
      : scenario === 'inside_lead_time' ? new Date(Math.ceil(Date.now() / 60_000) * 60_000 + 60_000).toISOString()
        : parisWallToUtc(addDays(parisYmd(new Date()), 31), 18).toISOString();
    await seedCapacityFixture(dbA, TENANT, slot, 1);
    const body = { ...request(), pickup: { ...request().pickup, slot } };
    await expect(a.controller.create(TENANT, USER, body)).rejects.toMatchObject({ status: 409 });
    expect(await first.orders.countDocuments()).toBe(0);
    expect(await first.admissions.countDocuments({ 'capacity.kitchenSeat': { $exists: true } })).toBe(0);
  });

  it('abandon clôture un ancien validateur avant son CAS retardé et interdit toute résurrection', async () => {
    const body = request(); const reached = barrier(); const resume = barrier();
    const writer = replica(first, { admissions: intercept(first.admissions, transition('committing'), async (run) => {
      reached.release(); await resume.promise; return run();
    }) });
    const pending = writer.controller.create(TENANT, USER, body).then((order) => ({ order }), (error: unknown) => ({ error }));
    try {
      await Promise.race([reached.promise, pending.then(() => { throw new Error('Le writer a terminé avant son vrai CAS'); })]);
      expect(await b.controller.staffRecovery(TENANT, body)).toMatchObject({ state: 'pending' });
      expect(await b.controller.staffAbandon(TENANT, body)).toMatchObject({ state: 'rejected', reason: 'abandoned' });
      const fenced = await persisted(body);
      resume.release();
      expect(await pending).toMatchObject({ error: { status: 409, response: { code: 'ORDER_ATTEMPT_REJECTED' } } });
      expect(await persisted(body)).toEqual(fenced);
      expect(await first.orders.countDocuments()).toBe(0);
      expect(await first.admissions.countDocuments({ 'capacity.kitchenSeat': { $exists: true } })).toBe(0);
    } finally { resume.release(); await pending; }
  });

  it('validating devenu périmé : le rejeu clôture par CAS avant la reprise du validateur retardé', async () => {
    const body = request(); const reached = barrier(); const resume = barrier();
    const writer = replica(first, { admissions: intercept(first.admissions, transition('committing'), async (run) => {
      reached.release(); await resume.promise; return run();
    }) });
    const pending = writer.controller.create(TENANT, USER, body).then((order) => ({ order }), (error: unknown) => ({ error }));
    try {
      await Promise.race([reached.promise, pending.then(() => { throw new Error('Writer terminé avant son CAS'); })]);
      vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date(SLOT));
      await expect(b.controller.create(TENANT, USER, body)).rejects.toMatchObject({ status: 409, response: { code: 'ORDER_ATTEMPT_REJECTED', reason: 'slot_unavailable' } });
      expect(await b.controller.staffRecovery(TENANT, body)).toMatchObject({ state: 'rejected', reason: 'slot_unavailable' });
      const closed = await persisted(body);
      resume.release();
      expect(await pending).toMatchObject({ error: { status: 409 } });
      expect(await persisted(body)).toEqual(closed);
      expect(await first.orders.countDocuments()).toBe(0);
    } finally { resume.release(); await pending; vi.useRealTimers(); }
  });

  it('le rejeu d’un snapshot déjà committing reste matérialisable après son créneau', async () => {
    const body = request();
    const writer = replica(first, { orders: intercept(first.orders, (update) => Boolean(update.$setOnInsert), async () => {
      throw new Error('Panne après réservation, avant insertion');
    }) });
    await expect(writer.controller.create(TENANT, USER, body)).rejects.toThrow('Panne après réservation');
    expect(await persisted(body)).toMatchObject({ state: 'committing' });
    try {
      vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date(new Date(SLOT).getTime() + 86_400_000));
      const replay = await b.controller.create(TENANT, USER, body);
      expect(replay).toMatchObject({ clientId: body.clientId, totals: { total: 1250 }, pickup: { slot: new Date(SLOT) } });
      expect(await persisted(body)).toMatchObject({ state: 'created', snapshot: null, capacity: { kitchenSeat: 0 } });
      const again = await b.controller.create(TENANT, USER, body);
      expect(String(again._id)).toBe(String(replay._id));
      expect(await first.orders.countDocuments()).toBe(1);
    } finally { vi.useRealTimers(); }
  });

  it('un abandon retardé après le commit retourne created et ne retire ni ticket ni siège', async () => {
    const body = request(); const reached = barrier(); const resume = barrier();
    const abandoner = replica(first, { admissions: intercept(first.admissions, transition('rejected'), async (run) => {
      reached.release(); await resume.promise; return run();
    }) });
    const pending = abandoner.controller.staffAbandon(TENANT, body).then((result) => ({ result }), (error: unknown) => ({ error }));
    try {
      await Promise.race([reached.promise, pending.then(() => { throw new Error('Abandon terminé avant le vrai CAS'); })]);
      const order = await b.controller.create(TENANT, USER, body);
      resume.release();
      expect(await pending).toMatchObject({ result: { state: 'created', order: { _id: String(order._id), payment: { status: 'pending' } } } });
      expect(await persisted(body)).toMatchObject({ state: 'created', capacity: { kitchenSeat: 0 } });
      expect(await first.orders.countDocuments()).toBe(1);
    } finally { resume.release(); await pending; }
  });

  it('abandon d’un snapshot engagé aide son insertion et renvoie son reçu, sans recalcul', async () => {
    const body = request(); const reached = barrier(); const resume = barrier();
    const writer = replica(first, { orders: intercept(first.orders, (update) => Boolean(update.$setOnInsert), async (run) => {
      reached.release(); await resume.promise; return run();
    }) });
    const pending = writer.controller.create(TENANT, USER, body).then((order) => ({ order }), (error: unknown) => ({ error }));
    try {
      await Promise.race([reached.promise, pending.then(() => { throw new Error('Insertion terminée avant la barrière'); })]);
      expect(await persisted(body)).toMatchObject({ state: 'committing', snapshot: { totals: { total: 1250 } } });
      expect(await first.orders.countDocuments()).toBe(0);
      const counters = await first.counters.find().lean();
      await first.products.collection.updateOne({ _id: new Types.ObjectId(PRODUCT) }, { $set: { price: 9900, active: false } });
      const result = await b.controller.staffAbandon(TENANT, body);
      expect(result).toMatchObject({ state: 'created', order: { totals: { total: 1250 }, payment: { status: 'pending' } } });
      expect(StaffOrderAttemptResultSchema.safeParse(result).success).toBe(true);
      expect(await first.counters.find().lean()).toEqual(counters);
      expect(await first.orders.countDocuments()).toBe(1);
      resume.release();
      expect(await pending).toHaveProperty('order');
      expect(await first.orders.countDocuments()).toBe(1);
      expect(await persisted(body)).toMatchObject({ state: 'created', snapshot: null, capacity: { kitchenSeat: 0 } });
    } finally { resume.release(); await pending; }
  });

  it.each(['before', 'after'] as const)('réponse abandon perdue %s écriture : jamais de faux rejet et reprise de la même clé', async (when) => {
    const body = request();
    const interrupted = replica(first, { admissions: intercept(first.admissions, transition('rejected'), async (run) => {
      if (when === 'after') await run();
      throw new Error('Réponse Mongo perdue');
    }) });
    if (when === 'before') {
      await expect(interrupted.controller.staffAbandon(TENANT, body)).rejects.toMatchObject({ status: 503 });
      expect(await b.controller.staffRecovery(TENANT, body)).toMatchObject({ state: 'pending' });
    } else expect(await interrupted.controller.staffAbandon(TENANT, body)).toMatchObject({ state: 'rejected', reason: 'abandoned' });
    expect(await b.controller.staffAbandon(TENANT, body)).toMatchObject({ state: 'rejected', reason: 'abandoned' });
    await expect(b.controller.create(TENANT, USER, body)).rejects.toMatchObject({ status: 409 });
    expect(await first.orders.countDocuments()).toBe(0);
    expect(await first.admissions.countDocuments()).toBe(1);
  });

  it.each(['absent', 'seeding', 'blocked'] as const)('contrôle %s : abandon reste possible, aucune admission de commande nouvelle', async (state) => {
    if (state === 'absent') await first.tenants.collection.updateOne({ _id: new Types.ObjectId(TENANT) }, { $unset: { capacityControl: '' } });
    else await first.tenants.collection.updateOne({ _id: new Types.ObjectId(TENANT) }, { $set: { 'capacityControl.state': state } });
    const body = request();
    expect(await b.controller.staffAbandon(TENANT, body)).toMatchObject({ state: 'rejected', reason: 'abandoned' });
    await expect(a.controller.create(TENANT, USER, body)).rejects.toMatchObject({ status: 409 });
    await expect(a.controller.create(TENANT, USER, request())).rejects.toMatchObject({ status: 503 });
    expect(await first.orders.countDocuments()).toBe(0);
    expect(await first.admissions.countDocuments()).toBe(1);
  });

  it('le reçu créé ne fuit ni preuves d’admission, ni commande publique, ni champs financiers privés', async () => {
    const body = request(); const order = await a.controller.create(TENANT, USER, body);
    const result = await b.controller.staffRecovery(TENANT, body);
    expect(result).toMatchObject({ tenantId: TENANT, clientId: body.clientId, channel: 'phone', state: 'created',
      order: { _id: String(order._id), totals: { total: 1250 }, pickup: { slot: SLOT }, payment: { method: 'counter', status: 'pending' } } });
    expect(StaffOrderAttemptResultSchema.safeParse(result).success).toBe(true);
    const serialized = JSON.stringify(result);
    for (const privateField of ['proofHash', 'payloadHash', 'validationOwner', 'snapshot', 'capacityControl', 'historicalImport',
      'paymentFlow', 'counterCollection', 'publicRecovery', 'loyaltyEarnState']) expect(serialized).not.toContain(`"${privateField}"`);
  });

  it.each(['lines', 'slot', 'channel', 'without_slot'] as const)('%s modifié : aucune observation ni clôture de l’identité figée', async (field) => {
    const body = request(); await a.controller.create(TENANT, USER, body);
    const changed: CreateOrder = field === 'lines' ? { ...body, lines: [{ ...body.lines[0]!, qty: 2 }] }
      : field === 'slot' ? { ...body, pickup: { ...body.pickup!, slot: new Date(new Date(SLOT).getTime() + 1_800_000).toISOString() } }
        : field === 'channel' ? { ...body, channel: 'pos' } : { ...body, pickup: undefined };
    const before = await persisted(body);
    // Valeurs invalides injectées au service : la frontière HTTP est testée
    // séparément avec les vrais pipes montés sur le contrôleur.
    await expect(b.service.staffAttempt(TENANT, changed, false)).rejects.toThrow();
    await expect(b.service.staffAttempt(TENANT, changed, true)).rejects.toThrow();
    expect(await persisted(body)).toEqual(before);
    expect(await first.orders.countDocuments()).toBe(1);
  });

  it('une lecture d’un autre restaurant ne divulgue pas le ticket et un abandon reste strictement tenant-scopé', async () => {
    const body = request(); await a.controller.create(TENANT, USER, body);
    const original = await persisted(body);
    expect(await b.controller.staffRecovery(OTHER_TENANT, body)).toMatchObject({ tenantId: OTHER_TENANT, state: 'pending' });
    expect(await b.controller.staffAbandon(OTHER_TENANT, body)).toMatchObject({ tenantId: OTHER_TENANT, state: 'rejected' });
    expect(await persisted(body)).toEqual(original);
    expect(await first.orders.countDocuments()).toBe(1);
    expect(await first.admissions.countDocuments()).toBe(2);
  });

  it('reprise et abandon staff refusent une admission publique protégée sans la modifier', async () => {
    const body = request(); const { channel: _channel, type: _type, ...publicFields } = body;
    const publicBody = CreatePublicOrderSchema.parse({ ...publicFields, recoveryProof: 'ab'.repeat(32), turnstileToken: 'fixture-only' });
    await a.facade.begin(TENANT, publicBody);
    const owner = await a.facade.claimValidation(TENANT, body.clientId, publicRecoveryBinding(TENANT, publicBody)!);
    await a.service.createWithOutcome(TENANT, { ...body, channel: 'online' }, 'online:fixture', null, owner!);
    const original = await persisted(body);
    await expect(b.controller.staffRecovery(TENANT, body)).rejects.toMatchObject({ status: 404 });
    await expect(b.controller.staffAbandon(TENANT, body)).rejects.toMatchObject({ status: 404 });
    expect(await persisted(body)).toEqual(original);
    expect(await a.facade.recover(TENANT, body.clientId, publicBody.recoveryProof!)).toMatchObject({ state: 'created' });
    expect(await first.orders.countDocuments()).toBe(1);
  });

  it('la fidélité/tender/canal/type hors tentative phone sont refusés avant toute écriture', async () => {
    const body = request();
    const invalid: CreateOrder[] = [{ ...body, channel: 'pos' }, { ...body, channel: 'online' }, { ...body, type: 'surplace' },
      { ...body, payment: { method: 'online' } }, { ...body, payment: { method: 'counter', tender: 'cash', cashReceived: 2_000 } },
      { ...body, loyaltyMemberId: randomUUID(), loyaltyEarnOperationId: randomUUID() }, { ...body, pickup: undefined }];
    for (const changed of invalid) {
      await expect(a.service.staffAttempt(TENANT, changed, false)).rejects.toMatchObject({ status: 400 });
      await expect(a.service.staffAttempt(TENANT, changed, true)).rejects.toMatchObject({ status: 400 });
    }
    expect(await first.admissions.countDocuments()).toBe(0);
    expect(await first.orders.countDocuments()).toBe(0);
  });

  it.each([{ label: 'online', capabilities: ['online'] }, { label: 'aucune', capabilities: [] }])('offre sans caisse $label : refus d’accès, pas un refus terminal de tentative', async ({ capabilities }) => {
    const client = replica(first, { capabilities }); const body = request();
    await expect(client.controller.staffRecovery(TENANT, body)).rejects.toMatchObject({ status: 403 });
    await expect(client.controller.staffAbandon(TENANT, body)).rejects.toMatchObject({ status: 403 });
    await expect(client.controller.staffSlots(TENANT, DAY)).rejects.toMatchObject({ status: 403 });
    expect(await first.admissions.countDocuments()).toBe(0);
    expect(await first.orders.countDocuments()).toBe(0);
  });

  it('pause web ignorée par les créneaux staff, inchangée pour les créneaux publics', async () => {
    await first.tenants.collection.updateOne({ _id: new Types.ObjectId(TENANT) }, { $set: { 'settings.onlineOrderingPaused': true } });
    const staff = await a.controller.staffSlots(TENANT, DAY);
    expect(staff).toMatchObject({ tenantId: TENANT, date: DAY, paused: false, slots: [{ iso: SLOT, remaining: 1 }] });
    const tenant = await a.service.tenantForStaffSlots(TENANT);
    const publicSlots = await a.slots.compute(tenant, DAY);
    expect(publicSlots).toMatchObject({ date: DAY, paused: true });
    expect(await first.orders.countDocuments()).toBe(0);
    expect(await first.admissions.countDocuments()).toBe(0);
  });

  it('l’import historique créé renvoie le reçu exact, même via abandon, sans libérer sa place', async () => {
    const body = request(); const order = await a.controller.create(TENANT, USER, body);
    const original = await persisted(body);
    const control = await first.tenants.findById(TENANT).select('+capacityControl').lean();
    await first.admissions.deleteOne({ _id: original!._id });
    await first.admissions.create({ _id: original!._id, tenantId: new Types.ObjectId(TENANT), clientId: body.clientId,
      version: 1, kind: 'historical', channel: 'phone', state: 'created', slot: new Date(SLOT), orderId: order._id,
      capacity: original!.capacity, historicalImport: { version: 1, bootstrapId: control!.capacityControl!.bootstrapId, importedAt: new Date() } });
    const historical = await persisted(body); const counters = await first.counters.find().lean();
    for (const action of ['staffRecovery', 'staffAbandon'] as const) {
      expect(await b.controller[action](TENANT, body)).toMatchObject({ state: 'created', order: { _id: String(order._id) } });
    }
    expect(await persisted(body)).toEqual(historical);
    expect(await first.counters.find().lean()).toEqual(counters);
    expect(await first.admissions.countDocuments({ 'capacity.kitchenSeat': 0 })).toBe(1);
    await expect(b.facade.recover(TENANT, body.clientId, 'ab'.repeat(32))).rejects.toMatchObject({ status: 404 });
  });

  it('un orderId historique incohérent échoue sans adopter un autre ticket ni clôturer l’admission', async () => {
    const body = request(); const order = await a.controller.create(TENANT, USER, body);
    const original = await persisted(body);
    const control = await first.tenants.findById(TENANT).select('+capacityControl').lean();
    await first.admissions.deleteOne({ _id: original!._id });
    await first.admissions.create({ _id: original!._id, tenantId: new Types.ObjectId(TENANT), clientId: body.clientId,
      version: 1, kind: 'historical', channel: 'phone', state: 'created', slot: new Date(SLOT), orderId: new Types.ObjectId(),
      capacity: original!.capacity, historicalImport: { version: 1, bootstrapId: control!.capacityControl!.bootstrapId, importedAt: new Date() } });
    const historical = await persisted(body);
    await expect(b.controller.staffRecovery(TENANT, body)).rejects.toMatchObject({ status: 503 });
    await expect(b.controller.staffAbandon(TENANT, body)).rejects.toMatchObject({ status: 503 });
    expect(await persisted(body)).toEqual(historical);
    expect(await first.orders.findById(order._id).lean()).toMatchObject({ clientId: body.clientId, status: 'new' });
  });
});
