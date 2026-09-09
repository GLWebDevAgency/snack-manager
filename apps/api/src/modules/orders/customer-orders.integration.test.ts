import { randomBytes, randomUUID } from 'node:crypto';
import mongoose, { Types, type Model, type Query, type Connection } from 'mongoose';
import { MODELS, type Order } from '@sm/db';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { customerOrdersMongoFixture, customerOrdersTestDatabase } from './customer-orders.test-fixture';
import { orderAdmissionId } from './order-admission-identity';
import { publicRecoveryBinding } from './order-recovery';
import type { CustomerOrderOwner } from './customer-order-owner';

const TENANT = '507f1f77bcf86cd799439011';
const SLOT = '2030-05-02T09:00:00.000Z';
const OWNER: CustomerOrderOwner = { tenantRef: TENANT, parentRef: `AC${'b'.repeat(32)}`, accountId: randomUUID() };
const OTHER: CustomerOrderOwner = { ...OWNER, accountId: randomUUID() };
const SOURCE = `customer:${randomBytes(32).toString('base64url')}`;
const PRIVATE = '+customerOwner +snapshot +proofHash +payloadHash +validationOwner +capacity';
const raw = process.env.CUSTOMER_ORDERS_TEST_MONGO_URL;
const integration = raw ? describe : describe.skip;
type Fixture = Awaited<ReturnType<typeof customerOrdersMongoFixture>>;
type Replica = ReturnType<Fixture['replica']>;

function blockedInsert(model: Model<Order>) {
  let blocked = true;
  const wrapped = new Proxy(model, { get(target, key, receiver) {
    if (key !== 'updateOne') return Reflect.get(target, key, receiver);
    return (...args: unknown[]) => {
      const query = Reflect.apply(target.updateOne, target, args) as Query<unknown, Order>;
      const execute = query.exec.bind(query);
      query.exec = async () => {
        if (blocked && (args[1] as { $setOnInsert?: unknown }).$setOnInsert) throw new Error('Synthetic unavailable insertion');
        return execute();
      };
      return query;
    };
  } });
  return { model: wrapped, release: () => { blocked = false; } };
}

describe('customer orders fixture isolation', () => {
  const authenticatedTarget = new URL('mongodb://localhost/snackmanager_runtime_test_ci');
  authenticatedTarget.username = 'fixture'; authenticatedTarget.password = randomUUID();
  it.each(['mongodb://remote.example/snackmanager_runtime_test_ci', 'mongodb://localhost/admin',
    'mongodb://localhost/snackmanager_runtime_test_ci?replicaSet=production', authenticatedTarget.toString()])('rejects unsafe target without I/O (%#)', input => {
    expect(() => customerOrdersTestDatabase(input)).toThrow();
  });
  it('allocates a fresh target for every fixture', () => {
    const target = 'mongodb://127.0.0.1:27048/snackmanager_runtime_test_customer';
    expect(customerOrdersTestDatabase(target)).not.toBe(customerOrdersTestDatabase(target));
  });
});

integration('customer checkout: real Mongo admission, immutable ownership and history', () => {
  let f: Fixture; let a: Replica; let b: Replica; let secondConnection: Connection;
  beforeAll(async () => {
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2030-05-02T07:00:00.000Z'));
    f = await customerOrdersMongoFixture(raw!, { tenantId: TENANT, slot: SLOT });
    secondConnection = await mongoose.createConnection(f.uri, { autoCreate: false, autoIndex: false }).asPromise();
  }, 20_000);
  beforeEach(async () => {
    await f.reset(); a = f.replica(); b = f.replica({
      orders: secondConnection.model(MODELS.Order.name, MODELS.Order.schema, MODELS.Order.collection),
      admissions: secondConnection.model(MODELS.PublicOrderAdmission.name, MODELS.PublicOrderAdmission.schema, MODELS.PublicOrderAdmission.collection),
    });
  });
  afterAll(async () => { try { await secondConnection?.close(); await f?.close(); } finally { vi.useRealTimers(); } });
  const query = { filter: 'all' as const, limit: 20, cursor: null };
  function create(actor = a, body = f.request(), owner = OWNER, beforeCommit = vi.fn(async () => owner)) {
    return actor.checkout.createForCustomer({ slug: 'isolated-capacity', body, owner, beforeCommit, sourceKey: SOURCE });
  }

  it('creates with server prices and hidden owner; exact replay does not repeat gates or capacity', async () => {
    const body = f.request(); const beforeCommit = vi.fn(async () => OWNER);
    const created = await create(a, body, OWNER, beforeCommit);
    expect(created).toMatchObject({ totals: { total: 1250 }, payment: { method: 'counter', status: 'pending' } });
    const order = await f.models.orders.findById(created._id).select('+customerOwner +publicRecovery');
    const admission = await f.models.admissions.findById(orderAdmissionId(TENANT, body.clientId)).select(PRIVATE);
    expect(order!.toObject({ transform: false }).customerOwner).toEqual(OWNER);
    expect(admission!.toObject({ transform: false }).customerOwner).toEqual(OWNER);
    expect(order!.toJSON()).not.toHaveProperty('customerOwner');
    expect(admission!.toJSON()).not.toHaveProperty('customerOwner');
    expect(JSON.stringify(a.redis.publish.mock.calls).includes(OWNER.accountId)).toBe(false);
    expect(created).not.toHaveProperty('customerOwner');
    const again = await create(b, body);
    expect(again).toEqual(created);
    expect(b.gate.authorize).not.toHaveBeenCalled();
    expect(beforeCommit).toHaveBeenCalledTimes(1);
    expect(await f.models.orders.countDocuments()).toBe(1);
    expect(await f.models.admissions.countDocuments({ 'capacity.kitchenSeat': { $type: 'number' } })).toBe(1);
  });

  it('rejects account A to B and account to guest with the same public recovery proof', async () => {
    const body = f.request(); await create(a, body);
    await expect(create(b, body, OTHER)).rejects.toMatchObject({ status: 404 });
    await expect(b.checkout.createPublic('isolated-capacity', body)).rejects.toMatchObject({ status: 404 });
    expect(b.gate.authorize).not.toHaveBeenCalled();
    expect(await f.models.orders.countDocuments()).toBe(1);
  });

  it('never adopts a historical guest admission on a new authenticated request', async () => {
    const body = f.request(); await a.checkout.createPublic('isolated-capacity', body);
    await expect(create(b, body)).rejects.toMatchObject({ status: 404 });
    expect((await b.checkout.listForCustomer(OWNER, query)).orders).toEqual([]);
    expect(await f.models.orders.countDocuments({ customerOwner: null })).toBe(1);
  });

  it.each(['changed', 'lost'] as const)('rechecks authority at the committing boundary (%s), never adopts B', async reason => {
    const body = f.request();
    const authority = vi.fn(async () => { if (reason === 'lost') throw new Error('Synthetic authority unavailable'); return OTHER; });
    await expect(create(a, body, OWNER, authority)).rejects.toMatchObject({ status: 409, response: { code: 'ORDER_ATTEMPT_REJECTED', reason: 'unavailable' } });
    expect(authority).toHaveBeenCalledTimes(1);
    expect(await f.models.orders.countDocuments()).toBe(0);
    const admission = await f.models.admissions.findById(orderAdmissionId(TENANT, body.clientId)).select(PRIVATE).lean();
    expect(admission).toMatchObject({ state: 'rejected', customerOwner: OWNER, snapshot: null });
    expect(admission?.capacity).toBeUndefined();
    expect(a.gate.release).toHaveBeenCalledTimes(1);
  });

  it('an abandonment during the final authority await wins before CAS and compensates the real promotion', async () => {
    const promoId = new Types.ObjectId();
    await f.models.promotions.collection.insertOne({ _id: promoId, tenantId: new Types.ObjectId(TENANT), name: 'Recette',
      kind: 'amount', value: 100, active: true, channels: ['online'], code: null, maxUsage: 1, usageCount: 0 } as never);
    const body = f.request(); let entered!: () => void; let resume!: () => void;
    const reached = new Promise<void>(resolve => { entered = resolve; });
    const waiting = new Promise<void>(resolve => { resume = resolve; });
    const pending = create(a, body, OWNER, vi.fn(async () => { entered(); await waiting; return OWNER; }));
    const settled = pending.then(value => ({ value }), error => ({ error }));
    await reached;
    try {
      expect((await f.models.promotions.findById(promoId).lean())?.usageCount).toBe(1);
      await expect(b.admissions.abandon(TENANT, body)).resolves.toMatchObject({ state: 'rejected', reason: 'abandoned' });
    } finally { resume(); }
    expect(await settled).toMatchObject({ error: { status: 409, response: { reason: 'abandoned' } } });
    expect(await f.models.orders.countDocuments()).toBe(0);
    expect((await f.models.promotions.findById(promoId).lean())?.usageCount).toBe(0);
  });

  it('recovers a committed A snapshot through only C01, without recalculation or a new session', async () => {
    const body = f.request(); const block = blockedInsert(f.models.orders); const interrupted = f.replica({ orders: block.model });
    await expect(create(interrupted, body)).rejects.toThrow();
    const admission = await f.models.admissions.findById(orderAdmissionId(TENANT, body.clientId)).select(PRIVATE).lean();
    expect(admission).toMatchObject({ state: 'committing', customerOwner: OWNER, snapshot: { customerOwner: OWNER } });
    expect(await f.models.orders.countDocuments()).toBe(0);
    block.release();
    const recovered = await b.admissions.recover(TENANT, body.clientId, body.recoveryProof!);
    expect(recovered.state).toBe('created');
    expect(b.gate.authorize).not.toHaveBeenCalled();
    expect((await b.checkout.listForCustomer(OWNER, query)).orders).toHaveLength(1);
    expect((await b.checkout.listForCustomer(OTHER, query)).orders).toEqual([]);
    expect(JSON.stringify(recovered).includes(OWNER.accountId)).toBe(false);
  });

  it('fails closed if a committed snapshot owner does not match its admission', async () => {
    const body = f.request(); const block = blockedInsert(f.models.orders);
    await expect(create(f.replica({ orders: block.model }), body)).rejects.toThrow();
    await f.db.db!.collection<{ _id: string }>(f.models.admissions.collection.name)
      .updateOne({ _id: orderAdmissionId(TENANT, body.clientId) }, { $set: { 'snapshot.customerOwner': OTHER } });
    await expect(b.admissions.recover(TENANT, body.clientId, body.recoveryProof!)).rejects.toMatchObject({ status: 404 });
    expect(await f.models.orders.countDocuments()).toBe(0);
  });

  it('abandon cannot cancel an already committed snapshot or refund its real promotion', async () => {
    const promoId = new Types.ObjectId();
    await f.models.promotions.collection.insertOne({ _id: promoId, tenantId: new Types.ObjectId(TENANT), name: 'Recette',
      kind: 'amount', value: 100, active: true, channels: ['online'], code: null, maxUsage: 1, usageCount: 0 } as never);
    const body = f.request(); const block = blockedInsert(f.models.orders);
    await expect(create(f.replica({ orders: block.model }), body)).rejects.toThrow();
    expect((await f.models.promotions.findById(promoId).lean())?.usageCount).toBe(1);
    await expect(b.admissions.abandon(TENANT, body)).resolves.toMatchObject({ state: 'created', order: { totals: { total: 1150 } } });
    expect((await f.models.promotions.findById(promoId).lean())?.usageCount).toBe(1);
    expect(await f.models.orders.countDocuments()).toBe(1);
  });

  it('delivery shares the existing server fee, online payment and two-seat capacity rules', async () => {
    await f.models.tenants.collection.updateOne({ _id: new Types.ObjectId(TENANT) }, { $set: {
      onlineDelivery: true, encaissement: { accountId: 'acct_fixture', chargesEnabled: true },
      delivery: { enabled: true, leadTimeMin: 45, slotCapacity: 2,
        zones: [{ id: 'centre', name: 'Centre', postalCodes: ['69001'], feeCents: 250, minimumOrderCents: 1000 }] },
    } });
    const body = f.request({ fulfillment: 'delivery', payment: { method: 'online' },
      delivery: { address: { line1: '12 rue de Recette', city: 'Lyon', postalCode: '69001', country: 'FR' }, instructions: 'Recette uniquement' } });
    const created = await create(a, body);
    expect(created).toMatchObject({ type: 'delivery', payment: { method: 'online', status: 'pending' },
      totals: { subtotal: 1250, deliveryFee: 250, total: 1500 }, delivery: { zoneId: 'centre', feeCents: 250 } });
    const admission = await f.models.admissions.findById(orderAdmissionId(TENANT, body.clientId)).select(PRIVATE).lean();
    expect(admission).toMatchObject({ customerOwner: OWNER, capacity: { kitchenSeat: 0, deliverySeat: 0 } });
    const detail = await b.checkout.detailForCustomer(OWNER, created._id);
    expect(detail.delivery).toEqual({ dispatchedAt: null, deliveredAt: null, estimatedMinutes: 45 });
    expect(JSON.stringify(detail).includes(body.delivery!.address.line1)).toBe(false);
    expect(JSON.stringify(detail).includes(body.delivery!.instructions!)).toBe(false);
  });

  it('abandonment after logout closes only the proof-bound owned pending admission', async () => {
    const body = f.request(); await a.admissions.begin(TENANT, body, OWNER);
    await expect(b.admissions.abandon(TENANT, { ...body, lines: [{ ...body.lines[0]!, qty: 2 }] })).rejects.toMatchObject({ status: 409 });
    await expect(b.admissions.abandon(TENANT, body)).resolves.toMatchObject({ state: 'rejected', reason: 'abandoned' });
    await expect(create(a, body)).rejects.toMatchObject({ response: { code: 'ORDER_ATTEMPT_REJECTED', reason: 'abandoned' } });
    expect(await f.models.orders.countDocuments()).toBe(0);
    expect((await f.models.admissions.findOne().select(PRIVATE).lean())?.customerOwner).toEqual(OWNER);
  });

  it('abandonment before the late account POST keeps its guest tombstone and never creates an order', async () => {
    const body = f.request(); await b.admissions.abandon(TENANT, body);
    await expect(create(a, body)).rejects.toMatchObject({ status: 404 });
    await expect(a.admissions.recover(TENANT, body.clientId, body.recoveryProof!)).resolves.toMatchObject({ state: 'rejected', reason: 'abandoned' });
    expect(await f.models.orders.countDocuments()).toBe(0);
  });

  it('concurrent account A/B share a single identity and never cross owners', async () => {
    const body = f.request();
    const results = await Promise.allSettled([create(a, body), create(b, body, OTHER)]);
    expect(results.filter(x => x.status === 'fulfilled')).toHaveLength(1);
    expect(await f.models.orders.countDocuments()).toBe(1);
    const row = await f.models.orders.findOne().select('+customerOwner').lean();
    const admission = await f.models.admissions.findOne().select(PRIVATE).lean();
    expect(row!.customerOwner).toEqual(admission!.customerOwner);
    expect([OWNER.accountId, OTHER.accountId]).toContain(row!.customerOwner?.accountId);
  });

  it('history scopes every read by tenant, parent and account, and omits capabilities/operational private data', async () => {
    const body = f.request({ note: 'Sans serviette', lines: [{ productId: f.productId, qty: 2, note: 'Bien chaud' }] });
    const created = await create(a, body);
    const detail = await b.checkout.detailForCustomer(OWNER, created._id);
    expect(detail).toMatchObject({ totalCents: 2500, note: 'Sans serviette', lines: [{ name: 'Article de recette', qty: 2, unitPrice: 1250, lineTotal: 2500, note: 'Bien chaud' }] });
    for (const owner of [OTHER, { ...OWNER, tenantRef: new Types.ObjectId().toHexString() }, { ...OWNER, parentRef: `AC${'c'.repeat(32)}` }]) {
      expect((await b.checkout.listForCustomer(owner, query)).orders).toEqual([]);
      await expect(b.checkout.detailForCustomer(owner, created._id)).rejects.toMatchObject({ status: 404 });
    }
    const json = JSON.stringify(detail);
    expect(['customerOwner', 'trackingToken', 'customerPhone', 'customerName', 'publicRecovery', 'paymentFlow', 'actor', OWNER.accountId, body.recoveryProof!, created.trackingToken].some(value => json.includes(value))).toBe(false);
    expect(detail).not.toHaveProperty('pickup');
  });

  it('paginates stable timestamp ties and distinguishes payment/refunds from operational status', async () => {
    const receipts = await Promise.all([create(), create(), create()]);
    const sorted = receipts.map(x => x._id).sort().reverse();
    const first = await a.checkout.listForCustomer(OWNER, { ...query, limit: 2 });
    expect(first.orders.map(x => x._id)).toEqual(sorted.slice(0, 2));
    const newReceipt = await create();
    const second = await b.checkout.listForCustomer(OWNER, { ...query, limit: 2, cursor: first.nextCursor });
    expect(second.orders.map(x => x._id)).toEqual(sorted.slice(2));
    expect(second.nextCursor).toBeNull();
    await f.models.orders.collection.updateOne({ _id: new Types.ObjectId(newReceipt._id) }, { $set: {
      status: 'ready', 'payment.status': 'paid', 'payment.refundedCents': 100, 'payment.pendingRefundCents': 200,
    } });
    const active = await a.checkout.listForCustomer(OWNER, { ...query, filter: 'active' });
    expect(active.orders.find(x => x._id === newReceipt._id)).toMatchObject({ status: 'ready', payment: { status: 'paid', refundedCents: 100, pendingRefundCents: 200 } });
    await f.models.orders.collection.updateOne({ _id: new Types.ObjectId(newReceipt._id) }, { $set: { status: 'delivered' } });
    expect((await a.checkout.listForCustomer(OWNER, { ...query, filter: 'past' })).orders.map(x => x._id)).toEqual([newReceipt._id]);
  });

  it('owner is immutable through normal ODM updates; no guest adopts the account on a later edit', async () => {
    const created = await create();
    await f.models.orders.updateOne({ _id: created._id }, { $set: { customerOwner: OTHER } });
    expect((await f.models.orders.findById(created._id).select('+customerOwner').lean())?.customerOwner).toEqual(OWNER);
    await f.models.orders.updateOne({ _id: created._id }, { $set: { 'customerOwner.accountId': OTHER.accountId } });
    expect((await f.models.orders.findById(created._id).select('+customerOwner').lean())?.customerOwner).toEqual(OWNER);
    const guest = await a.checkout.createPublic('isolated-capacity', f.request());
    if ('paused' in guest) throw new Error('Fixture restaurant unexpectedly paused');
    await f.models.orders.updateOne({ _id: guest._id }, { $set: { customerOwner: OWNER } });
    expect((await f.models.orders.findById(guest._id).select('+customerOwner').lean())?.customerOwner).toBeNull();
  });

  it('bindings retain the exact account as an independent immutable dimension, not inside the business hash', () => {
    const body = f.request();
    expect(publicRecoveryBinding(TENANT, body, OWNER)?.payloadHash).toBe(publicRecoveryBinding(TENANT, body, OTHER)?.payloadHash);
  });
});
