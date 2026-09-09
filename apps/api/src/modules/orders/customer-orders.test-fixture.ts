import { randomBytes, randomUUID } from 'node:crypto';
import mongoose, { Types, type Model } from 'mongoose';
import { MODELS, type Order, type PublicOrderAdmission } from '@sm/db';
import { CreatePublicOrderSchema } from '@sm/contracts';
import { vi } from 'vitest';
import { OrdersService } from './orders.service';
import { PublicOrderAdmissionService } from './public-order-admission.service';
import { OnlineOrderCheckoutService } from './online-order-checkout.service';
import { CustomerOrderHistoryService } from './customer-order-history.service';
import { capacityModels, seedCapacityFixture } from './order-capacity-test-fixtures';

/** Only local disposable databases. No connection happens before validation. */
export function customerOrdersTestDatabase(raw: string) {
  const url = new URL(raw);
  if (url.protocol !== 'mongodb:' || !['127.0.0.1', 'localhost'].includes(url.hostname)
    || url.username || url.password || url.search || url.hash
    || !/^\/snackmanager_runtime_test_[a-z0-9_]{1,20}$/i.test(url.pathname)) {
    throw new Error('Customer orders tests require an isolated loopback Mongo database.');
  }
  url.pathname += `_${randomBytes(5).toString('hex')}`;
  return url.toString();
}

/** Real Mongo checkout and prices; only external anti-bot/quota and slot HTTP
 * facade are simulated. The final calendar/capacity CAS remains real. */
export async function customerOrdersMongoFixture(raw: string, scope: { tenantId: string; slot: string }) {
  const uri = customerOrdersTestDatabase(raw);
  if (!/^[a-f0-9]{24}$/.test(scope.tenantId) || !Number.isFinite(Date.parse(scope.slot))) throw new Error('Invalid fixture scope.');
  const runId = randomUUID(); const productId = new Types.ObjectId().toHexString();
  const db = await mongoose.createConnection(uri, { autoCreate: false, autoIndex: false }).asPromise();
  let owned = false; let closing: Promise<void> | undefined;
  async function assertOwned() {
    if (!owned || db.name !== new URL(uri).pathname.slice(1)
      || !/^snackmanager_runtime_test_[a-z0-9_]+_[a-f0-9]{10}$/i.test(db.name)
      || !await db.db!.collection('_test_run').findOne({ runId })) throw new Error('Unowned customer orders fixture.');
  }
  const models = { ...capacityModels(db),
    orders: db.model(MODELS.Order.name, MODELS.Order.schema, MODELS.Order.collection),
    admissions: db.model(MODELS.PublicOrderAdmission.name, MODELS.PublicOrderAdmission.schema, MODELS.PublicOrderAdmission.collection),
    products: db.model(MODELS.Product.name, MODELS.Product.schema, MODELS.Product.collection),
    counters: db.model(MODELS.Counter.name, MODELS.Counter.schema, MODELS.Counter.collection),
    promotions: db.model(MODELS.Promotion.name, MODELS.Promotion.schema, MODELS.Promotion.collection),
  };
  async function reset() {
    await assertOwned();
    for (const model of Object.values(models)) await model.collection.deleteMany({});
    await seedCapacityFixture(db, scope.tenantId, scope.slot, 50);
    await models.tenants.collection.updateOne({ _id: new Types.ObjectId(scope.tenantId) }, { $set: {
      account: { status: 'active' }, onlineOrdering: true,
    } });
    await models.products.collection.insertOne({ _id: new Types.ObjectId(productId), tenantId: new Types.ObjectId(scope.tenantId),
      name: 'Article de recette', price: 1250, active: true, variants: [], optionGroups: [] } as never);
  }
  function replica(overrides: { orders?: Model<Order>; admissions?: Model<PublicOrderAdmission> } = {}) {
    const orderModel = overrides.orders ?? models.orders;
    const redis = { publish: vi.fn().mockResolvedValue(1) };
    const admissions = new PublicOrderAdmissionService(overrides.admissions ?? models.admissions, orderModel, redis as never, models.days, models.tenants);
    const orders = new OrdersService(orderModel, models.products, models.counters, models.promotions, redis as never,
      {} as never, models.tenants, { pourTenant: async () => ['bo', 'online'] } as never, {} as never, admissions);
    const tenants = { bySlug: async (slug: string) => {
      const tenant = await models.tenants.findOne({ slug });
      if (!tenant) throw new Error('Unknown fixture restaurant');
      return tenant;
    } };
    const slots = { exigerDisponible: vi.fn().mockResolvedValue(undefined) };
    const gate = {
      authorize: vi.fn().mockResolvedValue({ provider: 'turnstile', quotaReservation: { tenantId: scope.tenantId, id: 'fixture' } }),
      serializeSlot: vi.fn().mockImplementation(async (_input: unknown, work: () => Promise<unknown>) => work()),
      release: vi.fn().mockResolvedValue(undefined),
    };
    const quota = { reserve: vi.fn().mockResolvedValue(true), reserveClient: vi.fn().mockResolvedValue(true) };
    const checkout = new OnlineOrderCheckoutService(orders, tenants as never, slots as never, gate as never, admissions,
      quota as never, new CustomerOrderHistoryService(orderModel));
    return { checkout, admissions, orders, redis, gate, quota, slots };
  }
  function request(changes: Record<string, unknown> = {}) {
    return CreatePublicOrderSchema.parse({ clientId: randomUUID(), lines: [{ productId, qty: 1 }], payment: { method: 'counter' },
      pickup: { slot: scope.slot, customerName: 'Client synthétique', customerPhone: '0600000000' },
      recoveryProof: randomBytes(32).toString('hex'), turnstileToken: 'fixture-only', ...changes });
  }
  function close() {
    return closing ??= (async () => {
      try { if (owned) { await assertOwned(); await db.dropDatabase(); } }
      finally { await db.close(); }
    })();
  }
  try {
    if ((await db.db!.listCollections({}, { nameOnly: true }).toArray()).length) throw new Error('Fixture database is not empty.');
    await db.db!.collection('_test_run').insertOne({ runId }); owned = true;
    for (const model of Object.values(models)) { await model.createCollection(); await model.createIndexes(); }
    await reset();
    return { db, models, uri, productId, replica, request, reset, close };
  } catch (error) { await close(); throw error; }
}
