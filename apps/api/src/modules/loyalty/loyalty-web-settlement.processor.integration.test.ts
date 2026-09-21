import { randomBytes, randomUUID } from 'node:crypto';
import { loyaltyDb } from '@sm/loyalty';
import type { Order } from '@sm/db';
import { Types, type Model, type Query } from 'mongoose';
import type { Pool, PoolClient } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { customerOrdersMongoFixture } from '../orders/customer-orders.test-fixture';
import { OrderCounterCollectionService } from '../orders/order-counter-collection.service';
import { historicalSaleTestFixture, type HistoricalSaleTestFixture } from './loyalty-historical-sale.test-fixture';
import { LoyaltyHistoricalSaleService } from './loyalty-historical-sale.service';
import { LoyaltyWebSettlementProcessor } from './loyalty-web-settlement.processor';
import { loyaltyWebFixture } from './loyalty-web.test-fixture';
import type { HistoricalSaleAttribution } from './loyalty-historical-sale.types';

const pgTarget = process.env.LOYALTY_WEB_TEST_DATABASE_URL;
const mongoTarget = process.env.CUSTOMER_ORDERS_TEST_MONGO_URL;
const integration = pgTarget && mongoTarget ? describe : describe.skip;
type Mongo = Awaited<ReturnType<typeof customerOrdersMongoFixture>>;
type Sale = { _id: Types.ObjectId; tenantRef: string; clientId: string; attribution: HistoricalSaleAttribution; operationId: string };
function barrier() { let release!: () => void; const promise = new Promise<void>(done => { release = done; }); return { promise, release }; }
async function reached(promise: Promise<void>) {
  let timer: NodeJS.Timeout | undefined;
  try { await Promise.race([promise, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Native checkpoint not reached')), 5000); })]); }
  finally { clearTimeout(timer); }
}
function interceptAck(model: Model<Order>, intercept: (execute: () => Promise<unknown>) => Promise<unknown>) {
  let armed = true;
  return new Proxy(model, { get(target, key, receiver) {
    if (key !== 'updateOne') return Reflect.get(target, key, receiver);
    return (...args: unknown[]) => {
      const query = Reflect.apply(target.updateOne, target, args) as Query<unknown, Order>;
      const set = (args[1] as { $set?: Record<string, unknown> }).$set;
      if (armed && set?.['loyaltyWebProcessing.state'] === 'completed') {
        armed = false; const execute = query.exec.bind(query); query.exec = () => intercept(execute);
      }
      return query;
    };
  } });
}
function holdCommit(pool: Pool) {
  const entered = barrier(), resume = barrier(); let armed = true;
  const wrapped = new Proxy(pool, { get(target, key, receiver) {
    if (key !== 'connect') { const value = Reflect.get(target, key, receiver); return typeof value === 'function' ? value.bind(target) : value; }
    return async () => {
      const client = await target.connect(); let effect = false;
      return new Proxy(client, { get(connection, property, inner) {
        if (property !== 'query') { const value = Reflect.get(connection, property, inner); return typeof value === 'function' ? value.bind(connection) : value; }
        return async (...args: unknown[]) => {
          const sql = typeof args[0] === 'string' ? args[0] : String((args[0] as { text?: string })?.text ?? '');
          if (/^\s*commit\s*;?\s*$/i.test(sql) && effect && armed) {
            armed = false; entered.release(); await resume.promise;
            await Reflect.apply(connection.query, connection, args); throw new Error('Synthetic lost real COMMIT acknowledgement');
          }
          const result = await Reflect.apply(connection.query, connection, args);
          if (/insert into "loyalty"\."earn_receipts"/i.test(sql)) effect = true;
          return result;
        };
      } }) as PoolClient;
    };
  } });
  return { pool: wrapped, entered: entered.promise, release: resume.release };
}

integration('web loyalty — real Mongo + PostgreSQL recovery, no provider', () => {
  let pg: HistoricalSaleTestFixture, mongo: Mongo;
  beforeAll(async () => {
    vi.stubEnv('LOYALTY_WEB_SETTLEMENT_ENABLED', 'true');
    pg = await historicalSaleTestFixture(pgTarget);
    try { mongo = await customerOrdersMongoFixture(mongoTarget!, { tenantId: '507f1f77bcf86cd799439011', slot: '2030-05-02T09:00:00Z' }); }
    catch (error) { await pg.close(); throw error; }
  }, 30_000);
  afterAll(async () => { try { await mongo?.close(); } finally { try { await pg?.close(); } finally { vi.unstubAllEnvs(); } } });
  const worker = (orders = mongo.models.orders, service = pg.service) => new LoyaltyWebSettlementProcessor(orders, service);

  async function seed(options: { eligiblePurchaseCents?: number; excludedChargeCents?: number; counter?: boolean } = {}): Promise<Sale> {
    const input = await pg.seed(options), row = loyaltyWebFixture(), _id = row._id as Types.ObjectId;
    row.tenantId = new Types.ObjectId(input.tenantRef); row.clientId = input.clientId; row.customerOwner = input.attribution.owner;
    row.customerSaleAttribution = input.attribution; row.loyaltyWebIntent = { version: 1, operationId: input.earnOperationId };
    const basis = input.attribution.basis;
    row.totals = { subtotal: basis.eligiblePurchaseCents, discount: null, deliveryFee: basis.excludedChargeCents, total: basis.chargedTotalCents };
    row.counterCollection!.amountCents = basis.chargedTotalCents;
    if (!options.counter) {
      row.payment.method = 'online'; row.payment.stripePaymentIntentId = `pi_fixture_${randomUUID()}`; row.payment.stripeAccountId = 'acct_fixture'; row.counterCollection = null;
      row.paymentFlow = { version: 1, phase: 'settled', providerStatus: 'succeeded', attempt: { id: randomUUID(), accountId: 'acct_fixture',
        environment: 'test', amountCents: basis.chargedTotalCents, currency: 'eur', requestStartedAt: new Date('2029-12-31T23:00:00Z'),
        metadata: { orderId: String(_id), tenantId: input.tenantRef, orderNumber: '1' } } };
    }
    await mongo.models.orders.collection.insertOne({ ...row, number: 1, lines: [], createdAt: new Date(),
      loyaltyWebProcessing: { state: 'pending', dirty: true, attempts: 0, nextAttemptAt: new Date(0) } } as never);
    return { _id, tenantRef: input.tenantRef, clientId: input.clientId, attribution: input.attribution, operationId: input.earnOperationId };
  }
  const read = (sale: Sale) => mongo.models.orders.collection.findOne({ _id: sale._id });
  async function due(sale: Sale) { await mongo.models.orders.collection.updateOne({ _id: sale._id }, { $set: {
    'loyaltyWebProcessing.nextAttemptAt': new Date(0), 'loyaltyWebProcessing.leaseUntil': new Date(0), 'loyaltyWebProcessing.dirty': true } }); }
  async function refunds(sale: Sale, rows: { id: string; amountCents: number; status: string }[], wake = true) {
    const confirmed = rows.filter(r => r.status === 'succeeded').reduce((sum, r) => sum + r.amountCents, 0);
    const pending = rows.filter(r => ['pending', 'requires_action'].includes(r.status)).reduce((sum, r) => sum + r.amountCents, 0);
    await mongo.models.orders.collection.updateOne({ _id: sale._id }, { $set: { 'payment.refunds': rows,
      'payment.refundedCents': confirmed, 'payment.pendingRefundCents': pending,
      'payment.status': confirmed === sale.attribution.basis.chargedTotalCents ? 'refunded' : 'paid',
      ...(wake ? { 'loyaltyWebProcessing.nextAttemptAt': new Date(0), 'loyaltyWebProcessing.dirty': true } : {}) }, $inc: { __v: 1, 'payment.refundSyncVersion': 1 } });
  }
  async function financial(sale: Sale) {
    const client = await pg.app.connect();
    try {
      await client.query('BEGIN'); await client.query("SELECT set_config('app.tenant_ref',$1,true)", [sale.tenantRef]);
      const wallet = (await client.query('SELECT balance_units,lifetime_earned_units FROM loyalty.wallets WHERE member_id=$1', [sale.attribution.memberId])).rows;
      const ledger = (await client.query('SELECT kind,delta_units FROM loyalty.ledger_entries ORDER BY recorded_at,id')).rows;
      const receipts = (await client.query('SELECT operation_id FROM loyalty.earn_receipts')).rows;
      const settlements = (await client.query('SELECT initial_units,reversed_units,status,reason FROM loyalty.sale_settlements')).rows;
      await client.query('COMMIT'); return { wallet, ledger, receipts, settlements };
    } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
  }

  it.each([false, true])('credits one server-proven online sale, counter collection=%s, under two workers', async counter => {
    const sale = await seed({ counter }); await Promise.all([worker().drain(), worker().drain()]);
    expect(await financial(sale)).toMatchObject({ wallet: [{ balance_units: '10', lifetime_earned_units: '10' }],
      ledger: [{ kind: 'earn', delta_units: '10' }], receipts: [{ operation_id: sale.operationId }] });
    expect((await read(sale))?.loyaltyWebProcessing?.state).toBe('completed');
  });
  it.each([false, true])('parks a cancelled unhanded sale without a gain or polling writes, fully refunded=%s', async refunded => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const now = Date.now(); vi.setSystemTime(now);
    try {
      const sale = await seed();
      await mongo.models.orders.collection.updateOne({ _id: sale._id }, {
        $set: { status: 'cancelled', statusHistory: [{ status: 'cancelled', at: new Date(), by: new Types.ObjectId().toHexString() }] },
        $inc: { __v: 1 },
      });
      if (refunded) await refunds(sale, [{ id: 're_cancelled', amountCents: 1000, status: 'succeeded' }]);
      await worker().drain();
      expect((await read(sale))?.loyaltyWebProcessing).toMatchObject({ state: 'pending', dirty: false,
        nextAttemptAt: null, awardedUnits: null, lastError: 'payment_or_handoff_pending' });
      expect(await financial(sale)).toMatchObject({ wallet: [{ balance_units: '0' }], ledger: [], receipts: [],
        settlements: [{ initial_units: null, status: 'pending', reason: 'payment_or_handoff_pending' }] });
      const sqlBefore = (await pg.admin.query('SELECT * FROM loyalty.sale_settlements WHERE tenant_ref=$1', [sale.tenantRef])).rows;
      const processingBefore = (await read(sale))?.loyaltyWebProcessing;
      for (const elapsed of [31_000, 65_000, 1_800_000]) {
        vi.setSystemTime(now + elapsed);
        await worker().drain();
        expect((await read(sale))?.loyaltyWebProcessing).toEqual(processingBefore);
        expect((await pg.admin.query('SELECT * FROM loyalty.sale_settlements WHERE tenant_ref=$1', [sale.tenantRef])).rows).toEqual(sqlBefore);
      }
      const live = await seed();
      expect((await worker().drain()).claimed).toBe(1);
      expect((await financial(live)).receipts).toHaveLength(1);
      // A writer unaware of the dirty scheduler still wakes this parked case
      // through a version change; no automatic zero receipt is ever created.
      await mongo.models.orders.collection.updateOne({ _id: sale._id }, { $inc: { __v: 1, 'payment.refundSyncVersion': 1 } });
      await worker().drain();
      expect((await read(sale))?.loyaltyWebProcessing?.dirty).toBe(true);
      await worker().drain();
      expect((await read(sale))?.loyaltyWebProcessing).toMatchObject({ state: 'pending', dirty: false, nextAttemptAt: null });
      expect((await financial(sale)).receipts).toEqual([]);
      expect(BigInt((await pg.admin.query('SELECT version FROM loyalty.sale_settlements WHERE tenant_ref=$1', [sale.tenantRef])).rows[0].version))
        .toBeGreaterThan(BigInt(sqlBefore[0].version));
    } finally { vi.useRealTimers(); }
  });
  it('consumes an actual new checkout admission only after the counter collection and pickup handoff services', async () => {
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2030-05-02T07:00:00Z'));
    let checkoutMongo: Mongo | undefined;
    try {
      const seed = await pg.seed({ eligiblePurchaseCents: 1250 });
      checkoutMongo = await customerOrdersMongoFixture(mongoTarget!, { tenantId: seed.tenantRef, slot: '2030-05-02T09:00:00Z' });
      const replica = checkoutMongo.replica(), body = checkoutMongo.request({ clientId: seed.clientId });
      const created = await replica.checkout.createForCustomer({ slug: 'isolated-capacity', body, owner: seed.attribution.owner,
        beforeCommit: async () => seed.attribution.owner, sourceKey: `customer:${randomBytes(32).toString('base64url')}`,
        prepareLoyaltyAttribution: async () => seed.attribution });
      const model = checkoutMongo.models.orders, runtime = new LoyaltyWebSettlementProcessor(model, pg.service);
      expect((await runtime.drain()).claimed).toBe(0);
      const actor = { sub: new Types.ObjectId().toHexString(), tenantId: seed.tenantRef, role: 'owner' as const, kind: 'user' as const };
      const collect = new OrderCounterCollectionService(model, { pourTenant: async () => ['bo', 'online'] } as never,
        { logOnce: vi.fn(async () => undefined) } as never, replica.redis as never);
      await collect.collect(seed.tenantRef, created._id, actor, { operationId: randomUUID(), tender: 'cash', expectedTotalCents: 1250, cashReceivedCents: 1500 });
      await replica.orders.updateStatus(seed.tenantRef, created._id, 'ready', actor);
      expect((await runtime.drain()).claimed).toBe(0);
      await replica.orders.updateStatus(seed.tenantRef, created._id, 'delivered', actor);
      expect((await runtime.drain()).completed).toBe(1);
      const persisted = await model.collection.findOne({ _id: new Types.ObjectId(created._id) });
      expect(persisted?.loyaltyWebProcessing).toMatchObject({ state: 'completed', dirty: false, awardedUnits: 12 });
      expect(persisted?.payment.refundSyncVersion).toBe(0);
      expect((await pg.admin.query('SELECT balance_units FROM loyalty.wallets WHERE tenant_ref=$1', [seed.tenantRef])).rows)
        .toEqual([{ balance_units: '12' }]);
    } finally { try { await checkoutMongo?.close(); } finally { vi.useRealTimers(); } }
  });
  it('recovers a committed SQL gain after Mongo acknowledgement loss without another financial effect', async () => {
    const sale = await seed(); let lost = false;
    await worker(interceptAck(mongo.models.orders, async () => { lost = true; throw new Error('Synthetic Mongo ACK unavailable'); })).drain();
    expect(lost).toBe(true); expect((await financial(sale)).ledger).toHaveLength(1);
    await due(sale); const mutate = vi.spyOn(pg.service, 'settleHistoricalSale'); mutate.mockClear();
    await worker().drain(); expect(mutate).not.toHaveBeenCalled(); mutate.mockRestore();
    expect((await read(sale))?.loyaltyWebProcessing?.state).toBe('completed'); expect((await financial(sale)).ledger).toHaveLength(1);
  });
  it('rescans completed sales and applies cumulative partial then full corrections once', async () => {
    const sale = await seed(); await worker().drain();
    await refunds(sale, [{ id: 're_partial', amountCents: 400, status: 'succeeded' }]);
    await Promise.all([worker().drain(), worker().drain()]);
    expect((await financial(sale)).wallet).toEqual([{ balance_units: '6', lifetime_earned_units: '6' }]);
    await refunds(sale, [{ id: 're_partial', amountCents: 400, status: 'succeeded' }, { id: 're_final', amountCents: 600, status: 'succeeded' }]);
    await worker().drain(); await due(sale); await worker().drain();
    const proof = await financial(sale);
    expect(proof.wallet).toEqual([{ balance_units: '0', lifetime_earned_units: '0' }]);
    expect(proof.ledger).toHaveLength(3); expect(proof.receipts).toHaveLength(1);
    expect(proof.settlements).toMatchObject([{ initial_units: '10', reversed_units: '10', status: 'recorded' }]);
  });
  it('a refund winning after SQL commit fences the old Mongo ACK and is reconciled in the next observation', async () => {
    const sale = await seed();
    await worker(interceptAck(mongo.models.orders, async execute => {
      await refunds(sale, [{ id: 're_race', amountCents: 1000, status: 'succeeded' }]); return execute();
    })).drain();
    expect((await financial(sale)).wallet).toEqual([{ balance_units: '0', lifetime_earned_units: '0' }]);
    expect((await read(sale))?.loyaltyWebProcessing).toMatchObject({ state: 'completed', reversedUnits: 10 });
  });
  it('a refund before first settlement posts earn and compensating debit in one SQL commit', async () => {
    const sale = await seed(); await refunds(sale, [{ id: 're_before', amountCents: 1000, status: 'succeeded' }]);
    await worker().drain();
    const proof = await financial(sale); expect(proof.wallet).toEqual([{ balance_units: '0', lifetime_earned_units: '0' }]);
    expect(proof.ledger).toHaveLength(2); expect(proof.settlements).toMatchObject([{ status: 'recorded', reversed_units: '10' }]);
  });
  it('retains pending and unknown allocation without releasing points, then recovers when financial proof is complete', async () => {
    const sale = await seed({ eligiblePurchaseCents: 800, excludedChargeCents: 200 });
    await refunds(sale, [{ id: 're_pending', amountCents: 500, status: 'pending' }]); await worker().drain();
    expect((await financial(sale)).ledger).toHaveLength(0);
    await refunds(sale, [{ id: 're_pending', amountCents: 500, status: 'succeeded' }]); await worker().drain();
    expect((await read(sale))?.loyaltyWebProcessing).toMatchObject({ state: 'reconciliation_required', lastError: 'allocation_unknown' });
    expect((await financial(sale)).ledger).toHaveLength(0);
    await refunds(sale, [{ id: 're_pending', amountCents: 500, status: 'succeeded' }, { id: 're_complete', amountCents: 500, status: 'succeeded' }]);
    await worker().drain(); expect((await financial(sale)).wallet).toEqual([{ balance_units: '0', lifetime_earned_units: '0' }]);
    expect((await read(sale))?.loyaltyWebProcessing?.state).toBe('completed');
  });
  it('preserves a zero-unit receipt and never creates its ledger entry on replay', async () => {
    const sale = await seed({ eligiblePurchaseCents: 50 }); await worker().drain(); await due(sale); await worker().drain();
    const proof = await financial(sale); expect(proof.ledger).toHaveLength(0); expect(proof.receipts).toHaveLength(1);
    expect(proof.settlements).toMatchObject([{ initial_units: '0', reversed_units: '0', status: 'recorded' }]);
  });
  it('a periodic scan catches a changed completed sale even without its wake-up write', async () => {
    const sale = await seed(); await worker().drain();
    await refunds(sale, [{ id: 're_old_writer', amountCents: 1000, status: 'succeeded' }], false);
    await worker().drain(); expect((await financial(sale)).wallet[0]?.balance_units).toBe('10');
    expect((await read(sale))?.loyaltyWebProcessing?.dirty).toBe(true);
    await worker().drain();
    expect((await financial(sale)).wallet[0]?.balance_units).toBe('0');
  });
  it('never synthesizes an intent for an already attributed historical sale or a guest', async () => {
    const sale = await seed(); await mongo.models.orders.collection.updateOne({ _id: sale._id }, { $unset: { loyaltyWebIntent: '' } });
    expect((await worker().drain()).claimed).toBe(0); expect((await financial(sale)).ledger).toHaveLength(0);
    expect((await read(sale))?.loyaltyWebIntent).toBeUndefined();
  });
  it('preserves a real SQL commit whose acknowledgement is lost while a new Mongo lease waits', async () => {
    const sale = await seed(), held = holdCommit(pg.app), service = new LoyaltyHistoricalSaleService(loyaltyDb(held.pool));
    const a = worker(mongo.models.orders, service).drain(); let b: Promise<unknown> | undefined;
    try {
      await reached(held.entered); expect((await financial(sale)).ledger).toHaveLength(0);
      await due(sale); b = worker().drain(); held.release(); await a; await b;
    } finally { held.release(); await Promise.allSettled([a, ...(b ? [b] : [])]); }
    await due(sale); await worker().drain(); const proof = await financial(sale);
    expect(proof.ledger).toHaveLength(1); expect(proof.receipts).toHaveLength(1);
    expect(proof.wallet).toEqual([{ balance_units: '10', lifetime_earned_units: '10' }]);
    expect((await read(sale))?.loyaltyWebProcessing?.state).toBe('completed');
  });
});
