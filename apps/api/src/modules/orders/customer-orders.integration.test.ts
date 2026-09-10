import { randomBytes, randomUUID } from 'node:crypto';
import mongoose, { Types, type Model, type Query, type Connection } from 'mongoose';
import { MODELS, type Order, type PublicOrderAdmission } from '@sm/db';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { customerOrdersMongoFixture, customerOrdersTestDatabase } from './customer-orders.test-fixture';
import { orderAdmissionId } from './order-admission-identity';
import { publicRecoveryBinding } from './order-recovery';
import type { CustomerOrderOwner } from './customer-order-owner';
import type { PrepareCustomerSaleAttribution } from './customer-sale-attribution';
import type { CustomerSaleAttribution } from '@sm/contracts';
import { CustomerOrderAuthorityLost } from './order-admission.errors';
import { OrderCapacityCommitStore } from './order-capacity-commit.store';

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
    secondConnection = await mongoose.createConnection(f.uri, { autoCreate: false, autoIndex: false, directConnection: true }).asPromise();
  }, 20_000);
  beforeEach(async () => {
    await f.reset(); a = f.replica(); b = f.replica({
      orders: secondConnection.model(MODELS.Order.name, MODELS.Order.schema, MODELS.Order.collection),
      admissions: secondConnection.model(MODELS.PublicOrderAdmission.name, MODELS.PublicOrderAdmission.schema, MODELS.PublicOrderAdmission.collection),
    });
  });
  afterAll(async () => { try { await secondConnection?.close(); await f?.close(); } finally { vi.useRealTimers(); } });
  const query = { filter: 'all' as const, limit: 20, cursor: null };
  function create(actor = a, body = f.request(), owner = OWNER, beforeCommit = vi.fn(async () => owner),
    prepareLoyaltyAttribution: PrepareCustomerSaleAttribution = async input => ({
      version: 1, tenantRef: input.tenantRef, clientId: input.clientId, owner: input.owner, capturedAt: Date.now(),
      basis: { policyVersion: 'merchandise-net-v1', eligiblePurchaseCents: input.totals.subtotalCents - input.totals.discountCents,
        excludedChargeCents: input.totals.deliveryFeeCents, chargedTotalCents: input.totals.totalCents },
      decision: 'none', reason: 'not_enrolled',
    })) {
    return actor.checkout.createForCustomer({ slug: 'isolated-capacity', body, owner, beforeCommit, sourceKey: SOURCE, prepareLoyaltyAttribution });
  }

  function sale(input: Parameters<PrepareCustomerSaleAttribution>[0]): CustomerSaleAttribution {
    return { version: 1, tenantRef: input.tenantRef, clientId: input.clientId, owner: input.owner, capturedAt: Date.now(),
      basis: { policyVersion: 'merchandise-net-v1', eligiblePurchaseCents: input.totals.subtotalCents - input.totals.discountCents,
        excludedChargeCents: input.totals.deliveryFeeCents, chargedTotalCents: input.totals.totalCents },
      decision: 'attributed', memberId: randomUUID(), membershipOperationId: randomUUID(), programId: randomUUID(), rulesVersion: 7,
      rule: { mechanism: 'points', spendStepCents: 100, unitsPerStep: 2, minimumPurchaseCents: 0, maximumUnitsPerPurchase: null },
    };
  }

  it('freezes attribution from server prices, excludes legacy earn and never publishes its private contents', async () => {
    const body = f.request(); const prepare = vi.fn(async input => sale(input));
    const created = await create(a, body, OWNER, vi.fn(async () => OWNER), prepare);
    expect(prepare).toHaveBeenCalledExactlyOnceWith({ tenantRef: TENANT, clientId: body.clientId, owner: OWNER,
      totals: { subtotalCents: 1250, discountCents: 0, deliveryFeeCents: 0, totalCents: 1250 } });
    const expected = await prepare.mock.results[0]!.value;
    const rawOrder = await f.models.orders.collection.findOne({ _id: new Types.ObjectId(created._id) });
    expect(rawOrder?.customerSaleAttribution).toEqual(expected);
    expect(rawOrder).toMatchObject({ loyaltyMemberId: null, loyaltyEarnOperationId: null, loyaltyEarnState: null });
    const hydrated = await f.models.orders.findById(created._id).select('+customerSaleAttribution');
    expect(hydrated?.toObject({ transform: false }).customerSaleAttribution).toEqual(expected);
    const outputs = [created, hydrated?.toObject(), hydrated?.toJSON(),
      await f.models.orders.findById(created._id).lean(), await a.orders.list(TENANT, {}),
      await a.orders.byId(TENANT, created._id), await a.checkout.listForCustomer(OWNER, query),
      await a.checkout.detailForCustomer(OWNER, created._id), await a.checkout.reorderForCustomer(OWNER, created._id),
      await a.admissions.recover(TENANT, body.clientId, body.recoveryProof!), a.redis.publish.mock.calls];
    for (const output of outputs) {
      const json = JSON.stringify(output);
      expect(json).not.toContain('customerSaleAttribution');
      if (expected.decision !== 'attributed') throw new Error('Expected attribution');
      for (const secret of [expected.memberId, expected.membershipOperationId, expected.programId]) expect(json).not.toContain(secret);
    }
    const disconnectedPG = vi.fn(async () => { throw new Error('PG unavailable after commit'); });
    expect(await create(b, body, OWNER, vi.fn(async () => OWNER), disconnectedPG)).toEqual(created);
    expect(disconnectedPG).not.toHaveBeenCalled();
  });

  it.each(['unavailable', 'wrong_account', 'wrong_total'] as const)('does not commit or permanently reject a failed attribution read (%s)', async failure => {
    const body = f.request();
    const prepare = vi.fn(async input => {
      if (failure === 'unavailable') throw new Error('PG private failure');
      const snapshot = sale(input);
      return failure === 'wrong_account' ? { ...snapshot, owner: OTHER }
        : { ...snapshot, basis: { ...snapshot.basis, eligiblePurchaseCents: 1, chargedTotalCents: 1 } };
    });
    await expect(create(a, body, OWNER, vi.fn(async () => OWNER), prepare)).rejects.toMatchObject({ status: 503 });
    expect(await f.models.orders.countDocuments()).toBe(0);
    const admission = await f.models.admissions.findById(orderAdmissionId(TENANT, body.clientId)).select(PRIVATE).lean();
    expect(admission).toMatchObject({ state: 'validating', snapshot: null, validationOwner: null });
    expect(admission?.capacity).toBeUndefined();
    expect(a.gate.release).toHaveBeenCalledTimes(1);
    await expect(create(b, body)).resolves.toMatchObject({ totals: { total: 1250 } });
  });

  it('uses the net merchandise amount while retaining the real delivery charge separately', async () => {
    await f.models.tenants.collection.updateOne({ _id: new Types.ObjectId(TENANT) }, { $set: {
      onlineDelivery: true, encaissement: { accountId: 'acct_fixture_attribution_only', chargesEnabled: true },
      delivery: { enabled: true, leadTimeMin: 45, slotCapacity: 5,
        zones: [{ id: 'fixture', name: 'Zone de recette', postalCodes: ['75001'], feeCents: 500, minimumOrderCents: 0 }] },
    } });
    await f.models.promotions.collection.insertOne({ _id: new Types.ObjectId(), tenantId: new Types.ObjectId(TENANT), name: 'Recette',
      kind: 'amount', value: 250, active: true, channels: ['online'], code: null, maxUsage: 1, usageCount: 0 } as never);
    const body = f.request({ fulfillment: 'delivery', payment: { method: 'online' },
      delivery: { address: { line1: '10 rue de la Recette', postalCode: '75001', city: 'Paris', country: 'FR' } } });
    const prepare = vi.fn(async input => sale(input));
    const created = await create(a, body, OWNER, vi.fn(async () => OWNER), prepare);
    expect(prepare).toHaveBeenCalledExactlyOnceWith({ tenantRef: TENANT, clientId: body.clientId, owner: OWNER,
      totals: { subtotalCents: 1250, discountCents: 250, deliveryFeeCents: 500, totalCents: 1500 } });
    expect(created).toMatchObject({ totals: { total: 1500 }, payment: { method: 'online', status: 'pending' } });
    expect((await f.models.orders.collection.findOne({ clientId: body.clientId }))?.customerSaleAttribution?.basis)
      .toEqual({ policyVersion: 'merchandise-net-v1', eligiblePurchaseCents: 1000, excludedChargeCents: 500, chargedTotalCents: 1500 });
  });

  it('keeps the winning attribution when two replicas race for the same sale', async () => {
    const body = f.request(); const first = vi.fn(async input => sale(input)), second = vi.fn(async input => sale(input));
    const outcomes = await Promise.allSettled([
      create(a, body, OWNER, vi.fn(async () => OWNER), first), create(b, body, OWNER, vi.fn(async () => OWNER), second),
    ]);
    expect(outcomes.some(outcome => outcome.status === 'fulfilled')).toBe(true);
    expect(await f.models.orders.countDocuments()).toBe(1);
    const stored = await f.models.orders.collection.findOne({ clientId: body.clientId });
    const sampled = await Promise.all([...first.mock.results, ...second.mock.results].map(result => result.value));
    expect(sampled).toContainEqual(stored?.customerSaleAttribution);
    const before = stored?.customerSaleAttribution;
    const unexpected = vi.fn(async () => { throw new Error('Never read after commitment'); });
    await create(a, body, OWNER, vi.fn(async () => OWNER), unexpected);
    expect(unexpected).not.toHaveBeenCalled();
    expect((await f.models.orders.collection.findOne({ clientId: body.clientId }))?.customerSaleAttribution).toEqual(before);
  });

  it('arbitrates two different prepared snapshots at the actual committing CAS', async () => {
    const body = f.request(); await a.admissions.begin(TENANT, body, OWNER);
    const binding = await a.admissions.claimValidation(TENANT, body.clientId, publicRecoveryBinding(TENANT, body, OWNER)!);
    if (!binding) throw new Error('Expected validation claim');
    const input = { tenantRef: TENANT, clientId: body.clientId, owner: OWNER,
      totals: { subtotalCents: 1250, discountCents: 0, deliveryFeeCents: 0, totalCents: 1250 } };
    const candidates = [sale(input), sale(input)].map(customerSaleAttribution => ({
      _id: new Types.ObjectId(), tenantId: TENANT, clientId: body.clientId, channel: 'online', type: 'pickup',
      customerOwner: OWNER, customerSaleAttribution, number: 1, lines: [],
      totals: { subtotal: 1250, discount: null, deliveryFee: 0, total: 1250 },
      payment: { method: 'counter', status: 'pending' }, trackingToken: randomBytes(24).toString('base64url'),
      pickup: { slot: new Date(SLOT), customerName: 'Fixture' }, status: 'new',
    }));
    expect(candidates[0]!.customerSaleAttribution).not.toEqual(candidates[1]!.customerSaleAttribution);
    const first = new OrderCapacityCommitStore(f.models.admissions, f.models.orders, f.models.days);
    const second = new OrderCapacityCommitStore(
      secondConnection.model<PublicOrderAdmission>(MODELS.PublicOrderAdmission.name),
      secondConnection.model<Order>(MODELS.Order.name), f.models.days);
    let entered = 0; let ready!: () => void; let release!: () => void;
    const bothReady = new Promise<void>(resolve => { ready = resolve; });
    const released = new Promise<void>(resolve => { release = resolve; });
    const authority = async () => { if (++entered === 2) ready(); await released; return OWNER; };
    const settled = Promise.all([
      first.commit(TENANT, body.clientId, binding, candidates[0]!, authority),
      second.commit(TENANT, body.clientId, binding, candidates[1]!, authority),
    ]);
    try {
      await Promise.race([bothReady, settled.then(() => { throw new Error('Both candidates must reach the authorization barrier'); })]);
    } finally { release(); }
    const results = await settled;
    expect(entered).toBe(2); expect(results[0]?.orderId).toBe(results[1]?.orderId);
    const winner = candidates.find(candidate => String(candidate._id) === results[0]?.orderId);
    expect(winner).toBeDefined();
    const admission = await f.models.admissions.findById(orderAdmissionId(TENANT, body.clientId)).select(PRIVATE).lean();
    expect(admission).toMatchObject({ state: 'committing', snapshot: { customerSaleAttribution: winner!.customerSaleAttribution } });
    await b.admissions.recover(TENANT, body.clientId, body.recoveryProof!);
    expect((await f.models.orders.collection.findOne({ clientId: body.clientId }))?.customerSaleAttribution).toEqual(winner!.customerSaleAttribution);
    expect(await f.models.orders.countDocuments()).toBe(1);
  });

  it('repairs a lost acknowledgement without another attribution or another order', async () => {
    let lost = false;
    const admissions = new Proxy(f.models.admissions, { get(target, key, receiver) {
      if (key !== 'updateOne') return Reflect.get(target, key, receiver);
      return (...args: unknown[]) => {
        const query = Reflect.apply(target.updateOne, target, args) as Query<unknown, Order>;
        const execute = query.exec.bind(query);
        query.exec = async () => {
          if (!lost && (args[1] as { $set?: { state?: string } }).$set?.state === 'created') {
            lost = true; throw new Error('Synthetic lost acknowledgement');
          }
          return execute();
        };
        return query;
      };
    } });
    const body = f.request(), prepare = vi.fn(async input => sale(input));
    const created = await create(f.replica({ admissions }), body, OWNER, vi.fn(async () => OWNER), prepare);
    expect(lost).toBe(true);
    const attribution = (await f.models.orders.collection.findOne({ clientId: body.clientId }))?.customerSaleAttribution;
    expect(await f.models.admissions.findById(orderAdmissionId(TENANT, body.clientId)).select(PRIVATE).lean())
      .toMatchObject({ state: 'committing', snapshot: { customerSaleAttribution: attribution } });
    expect(await create(b, body, OWNER, vi.fn(async () => OWNER), prepare)).toEqual(created);
    expect(prepare).toHaveBeenCalledTimes(1);
    expect(await f.models.orders.countDocuments()).toBe(1);
    expect(await f.models.admissions.findById(orderAdmissionId(TENANT, body.clientId)).select(PRIVATE).lean())
      .toMatchObject({ state: 'created', snapshot: null });
  });

  it('requires the preparer for a NEW protected order but never enriches an old committed order', async () => {
    const body = f.request();
    const input = { slug: 'isolated-capacity', body, owner: OWNER, beforeCommit: vi.fn(async () => OWNER), sourceKey: SOURCE };
    await expect(a.checkout.createForCustomer(input)).rejects.toMatchObject({ status: 503 });
    expect(await f.models.orders.countDocuments()).toBe(0);
    const created = await create(b, body);
    // Reproduce a genuinely pre-feature ticket; a normal ODM update must not
    // create this historical state or attach anything retroactively.
    await f.models.orders.collection.updateOne({ _id: new Types.ObjectId(created._id) }, { $unset: { customerSaleAttribution: '' } });
    expect(await a.checkout.createForCustomer(input)).toEqual(created);
    expect((await f.models.orders.collection.findOne({ _id: new Types.ObjectId(created._id) }))?.customerSaleAttribution).toBeUndefined();
  });

  it('materializes the winning private attribution after a crash without rereading PG or changing the rule', async () => {
    const body = f.request(); const block = blockedInsert(f.models.orders);
    const prepare = vi.fn(async input => sale(input));
    await expect(create(f.replica({ orders: block.model }), body, OWNER, vi.fn(async () => OWNER), prepare)).rejects.toThrow();
    const expected = await prepare.mock.results[0]!.value;
    const admission = await f.models.admissions.findById(orderAdmissionId(TENANT, body.clientId)).select(PRIVATE).lean();
    expect(admission).toMatchObject({ state: 'committing', snapshot: { customerSaleAttribution: expected } });
    expect(await f.models.orders.countDocuments()).toBe(0);
    block.release();
    const recovered = await b.admissions.recover(TENANT, body.clientId, body.recoveryProof!);
    expect(recovered.state).toBe('created');
    expect((await f.models.orders.collection.findOne({ clientId: body.clientId }))?.customerSaleAttribution).toEqual(expected);
    expect(prepare).toHaveBeenCalledTimes(1);
    expect(b.gate.authorize).not.toHaveBeenCalled();
    expect(await f.models.admissions.findById(orderAdmissionId(TENANT, body.clientId)).select(PRIVATE).lean())
      .toMatchObject({ state: 'created', snapshot: null });
  });

  it('does not acknowledge or publish a different materialized attribution after insertion', async () => {
    const body = f.request(); const block = blockedInsert(f.models.orders);
    await expect(create(f.replica({ orders: block.model }), body, OWNER, vi.fn(async () => OWNER), async input => sale(input))).rejects.toThrow();
    const admission = await f.models.admissions.findById(orderAdmissionId(TENANT, body.clientId)).select(PRIVATE).lean();
    const snapshot = admission!.snapshot as unknown as Record<string, unknown>;
    const attribution = snapshot.customerSaleAttribution as CustomerSaleAttribution;
    await f.models.orders.collection.insertOne({ ...snapshot, customerSaleAttribution: { ...attribution, memberId: randomUUID() } } as never);
    await expect(b.admissions.recover(TENANT, body.clientId, body.recoveryProof!)).rejects.toMatchObject({ status: 503 });
    await expect(create(b, body)).rejects.toMatchObject({ status: 503 });
    expect(await f.models.admissions.findById(orderAdmissionId(TENANT, body.clientId)).select(PRIVATE).lean())
      .toMatchObject({ state: 'committing', snapshot: { customerSaleAttribution: attribution } });
    expect(b.redis.publish).not.toHaveBeenCalled();
  });

  it('reads the exact minimal reorder snapshot without writing orders, admissions or publishing events', async () => {
    const created = await create();
    const productId = new Types.ObjectId();
    const line = { productId, name: 'Burger historique', variantKey: 'large', variantName: 'Grand', qty: 2, unitPrice: 1250,
      lineTotal: 2500, options: [{ groupKey: 'sauce', choiceKey: 'mustard', name: 'Moutarde', priceDelta: 50 }],
      removed: ['Oignon'], note: 'PRIVATE_LINE_NOTE' };
    await f.models.orders.collection.updateOne({ _id: new Types.ObjectId(created._id) }, { $set: { lines: [line], note: 'PRIVATE_ORDER_NOTE' } });
    const before = await f.models.orders.collection.findOne({ _id: new Types.ObjectId(created._id) });
    const admissions = await f.models.admissions.collection.find({}).toArray();
    a.redis.publish.mockClear();
    const source = await a.checkout.reorderForCustomer(OWNER, created._id);
    expect(source).toEqual({ orderId: created._id, number: created.number, lines: [{ productId: productId.toHexString(),
      name: line.name, variantKey: 'large', variantName: 'Grand', qty: 2, unitPrice: 1250,
      options: [{ groupKey: 'sauce', choiceKey: 'mustard' }], removed: ['Oignon'] }] });
    expect(JSON.stringify(source)).not.toMatch(/PRIVATE_|trackingToken|recoveryProof|publicRecovery|customerOwner|payment|pickup|image|priceDelta|lineTotal/);
    expect(await b.checkout.reorderForCustomer(OWNER, created._id)).toEqual(source);
    expect(await f.models.orders.collection.findOne({ _id: new Types.ObjectId(created._id) })).toEqual(before);
    expect(await f.models.admissions.collection.find({}).toArray()).toEqual(admissions);
    expect(a.redis.publish).not.toHaveBeenCalled();
  });

  it('keeps incomplete legacy reorder references null, without resolving names against today catalog', async () => {
    const created = await create();
    await f.models.orders.collection.updateOne({ _id: new Types.ObjectId(created._id) }, { $set: { lines: [
      { name: 'Produit identique au catalogue', qty: 1, unitPrice: 100, options: [{ name: 'Sauce existante' }], removed: [] },
      { productId: 'invalid', name: 'Autre', variantKey: '', variantName: 'Grand', qty: 1, unitPrice: 200,
        options: [{ groupKey: '', choiceKey: 'choice' }, { groupKey: 'group', choiceKey: null }], removed: [] },
    ] } });
    expect((await a.checkout.reorderForCustomer(OWNER, created._id)).lines).toEqual([
      { productId: null, name: 'Produit identique au catalogue', variantKey: null, variantName: null, qty: 1,
        unitPrice: 100, options: [{ groupKey: null, choiceKey: null }], removed: [] },
      { productId: null, name: 'Autre', variantKey: null, variantName: 'Grand', qty: 1, unitPrice: 200,
        options: [{ groupKey: null, choiceKey: 'choice' }, { groupKey: 'group', choiceKey: null }], removed: [] },
    ]);
  });

  it.each([
    { variantKey: '', variantName: null },
    { variantKey: 'v'.repeat(301), variantName: null },
    { variantKey: 17, variantName: null },
    { variantKey: null, variantName: 'Ancienne variante' },
    { variantName: 'Ancienne variante sans clé' },
  ])('marks ambiguous legacy variants unavailable instead of converting them to the base product (%#)', async variant => {
    const created = await create(); const productId = new Types.ObjectId();
    const base = { productId, name: 'Article historique', qty: 1, unitPrice: 1250, options: [], removed: [] };
    await f.models.orders.collection.updateOne({ _id: new Types.ObjectId(created._id) }, { $set: { lines: [
      { ...base, ...variant }, { ...base, variantKey: null, variantName: null },
      { ...base, variantKey: 'known-key', variantName: null },
    ] } });
    const source = await a.checkout.reorderForCustomer(OWNER, created._id);
    expect(source.lines[0]).toMatchObject({ productId: null, variantKey: null, name: base.name, qty: 1 });
    expect(source.lines[1]).toMatchObject({ productId: productId.toHexString(), variantKey: null, variantName: null });
    expect(source.lines[2]).toMatchObject({ productId: productId.toHexString(), variantKey: 'known-key' });
  });

  it('hides reorder sources for another account, tenant, parent, guest or non-online order', async () => {
    const created = await create();
    for (const owner of [OTHER, { ...OWNER, tenantRef: 'a'.repeat(24) }, { ...OWNER, parentRef: `AC${'a'.repeat(32)}` }]) {
      await expect(a.checkout.reorderForCustomer(owner, created._id)).rejects.toMatchObject({ status: 404 });
    }
    await expect(a.checkout.reorderForCustomer(OWNER, new Types.ObjectId().toHexString())).rejects.toMatchObject({ status: 404 });
    await expect(a.checkout.reorderForCustomer(OWNER, 'invalid')).rejects.toMatchObject({ status: 404 });
    const guest = await a.checkout.createPublic('isolated-capacity', f.request());
    if ('paused' in guest) throw new Error('Fixture unexpectedly paused');
    await expect(a.checkout.reorderForCustomer(OWNER, String(guest._id))).rejects.toMatchObject({ status: 404 });
    await f.models.orders.collection.updateOne({ _id: new Types.ObjectId(created._id) }, { $set: { channel: 'pos' } });
    await expect(a.checkout.reorderForCustomer(OWNER, created._id)).rejects.toMatchObject({ status: 404 });
  });

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
    const authority = vi.fn(async () => { if (reason === 'lost') throw new CustomerOrderAuthorityLost(); return OTHER; });
    await expect(create(a, body, OWNER, authority)).rejects.toMatchObject({ status: 409, response: { code: 'ORDER_ATTEMPT_REJECTED', reason: 'unavailable' } });
    expect(authority).toHaveBeenCalledTimes(1);
    expect(await f.models.orders.countDocuments()).toBe(0);
    const admission = await f.models.admissions.findById(orderAdmissionId(TENANT, body.clientId)).select(PRIVATE).lean();
    expect(admission).toMatchObject({ state: 'rejected', customerOwner: OWNER, snapshot: null });
    expect(admission?.capacity).toBeUndefined();
    expect(a.gate.release).toHaveBeenCalledTimes(1);
  });

  it('keeps a PG I/O failure before CAS retryable, releases reservations and does not reject the attempt', async () => {
    const promoId = new Types.ObjectId();
    await f.models.promotions.collection.insertOne({ _id: promoId, tenantId: new Types.ObjectId(TENANT), name: 'Recette',
      kind: 'amount', value: 100, active: true, channels: ['online'], code: null, maxUsage: 1, usageCount: 0 } as never);
    const body = f.request();
    await expect(create(a, body, OWNER, vi.fn(async () => { throw new Error('Synthetic PG I/O'); })))
      .rejects.toMatchObject({ status: 503 });
    const admission = await f.models.admissions.findById(orderAdmissionId(TENANT, body.clientId)).select(PRIVATE).lean();
    expect(admission).toMatchObject({ state: 'validating', customerOwner: OWNER, snapshot: null, validationOwner: null });
    expect(admission?.capacity).toBeUndefined();
    expect(await f.models.orders.countDocuments()).toBe(0);
    expect((await f.models.promotions.findById(promoId).lean())?.usageCount).toBe(0);
    expect(a.gate.release).toHaveBeenCalledTimes(1);
    await expect(create(b, body)).resolves.toMatchObject({ totals: { total: 1150 } });
    expect(await f.models.orders.countDocuments()).toBe(1);
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
