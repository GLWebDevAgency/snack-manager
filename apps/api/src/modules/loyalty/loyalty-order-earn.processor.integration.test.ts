import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { LoyaltyCryptoAdapter, loyaltyDb } from '@sm/loyalty';
import type { Order } from '@sm/db';
import { Types, type Model, type Query } from 'mongoose';
import type { Pool, PoolClient } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { customerOrdersMongoFixture } from '../orders/customer-orders.test-fixture';
import { LoyaltyMemberService } from './loyalty-member.service';
import { LoyaltyOrderEarnProcessor } from './loyalty-order-earn.processor';
import { LoyaltyPurchaseVerifier } from './loyalty-purchase-verifier';

const pgTarget = process.env.LOYALTY_CANONICAL_SALE_TEST_DATABASE_URL;
const mongoTarget = process.env.CUSTOMER_ORDERS_TEST_MONGO_URL;
const integration = pgTarget && mongoTarget ? describe : describe.skip;
type PgFixture = { pool: Pool; close(): Promise<void> };
type Sale = { id: Types.ObjectId; tenant: string; clientId: string; memberId: string; operationId: string; total: number };
type MongoFixture = Awaited<ReturnType<typeof customerOrdersMongoFixture>>;
type Update = { $set?: Record<string, unknown> };

function barrier() {
  let release!: () => void;
  const promise = new Promise<void>(resolve => { release = resolve; });
  return { promise, release };
}

/** A missing causal checkpoint is a failure; never let teardown strand a query. */
async function reached(promise: Promise<void>) {
  let deadline: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([promise, new Promise<never>((_resolve, reject) => {
      deadline = setTimeout(() => reject(new Error('Native earn checkpoint not reached')), 5000);
    })]);
  } finally { clearTimeout(deadline); }
}

/** Interpose only the exact Mongo acknowledgement. Its actual query/filter and
 * every other model operation still execute against the owned Mongo database. */
function beforeCompletedAck(model: Model<Order>, effect: (execute: () => Promise<unknown>) => Promise<unknown>): Model<Order> {
  let armed = true;
  return new Proxy(model, { get(target, key, receiver) {
    if (key !== 'updateOne') return Reflect.get(target, key, receiver);
    return (...args: unknown[]) => {
      const query = Reflect.apply(target.updateOne, target, args) as Query<unknown, Order>;
      if (!armed || (args[1] as Update)?.$set?.loyaltyEarnState !== 'completed') return query;
      armed = false;
      const execute = query.exec.bind(query);
      query.exec = () => effect(execute);
      return query;
    };
  } });
}

/** Real inserts remain uncommitted until released. Only the COMMIT reply is
 * lost afterwards: PostgreSQL really committed, not a fabricated earn result. */
function holdEarnCommit(pool: Pool) {
  const entered = barrier(), resume = barrier();
  let held = false;
  const wrapped = new Proxy(pool, { get(target, key, receiver) {
    if (key !== 'connect') {
      const value = Reflect.get(target, key, receiver);
      return typeof value === 'function' ? value.bind(target) : value;
    }
    return async () => {
      const client = await target.connect();
      let insertedReceipt = false;
      return new Proxy(client, { get(connection, property, clientReceiver) {
        if (property !== 'query') {
          const value = Reflect.get(connection, property, clientReceiver);
          return typeof value === 'function' ? value.bind(connection) : value;
        }
        return async (...args: unknown[]) => {
          const first = args[0];
          const sql = typeof first === 'string' ? first : String((first as { text?: string })?.text ?? '');
          if (/^\s*commit\s*;?\s*$/i.test(sql) && insertedReceipt && !held) {
            held = true; entered.release(); await resume.promise;
            await Reflect.apply(connection.query, connection, args);
            throw new Error('Synthetic lost PostgreSQL COMMIT acknowledgement');
          }
          const result = await Reflect.apply(connection.query, connection, args);
          if (/insert into "loyalty"\."earn_receipts"/i.test(sql)) insertedReceipt = true;
          return result;
        };
      } }) as PoolClient;
    };
  } });
  return { pool: wrapped, entered: entered.promise, release: resume.release };
}

integration('loyalty earn outbox — real Mongo plus PostgreSQL, no provider', () => {
  let pg: PgFixture;
  let mongo: MongoFixture;
  const crypto = new LoyaltyCryptoAdapter({
    encryptionKeyBase64: Buffer.alloc(32, 17).toString('base64'),
    phoneLookupKeyBase64: Buffer.alloc(32, 43).toString('base64'),
    operationFingerprintKeyBase64: Buffer.alloc(32, 91).toString('base64'),
    qrTokenDerivationKeyBase64: Buffer.alloc(32, 127).toString('base64'),
    encryptionKeyVersion: 1,
  });
  const actor = { source: 'pos' as const, actorRef: '507f1f77bcf86cd799439022', deviceRef: '507f1f77bcf86cd799439033' };

  beforeAll(async () => {
    // The dynamic import keeps a test-only migrator outside Nest build inputs.
    const path = resolve(__dirname, '../../../../../packages/loyalty/src/canonical-sale.test-fixture.ts');
    const fixture = await import(/* @vite-ignore */ path) as {
      canonicalSaleTestFixture(raw: unknown): Promise<PgFixture>;
      assertCanonicalSaleTestTarget(raw: unknown): string;
    };
    fixture.assertCanonicalSaleTestTarget(pgTarget);
    pg = await fixture.canonicalSaleTestFixture(pgTarget);
    try {
      mongo = await customerOrdersMongoFixture(mongoTarget!, {
        tenantId: '507f1f77bcf86cd799439011', slot: '2030-05-02T09:00:00.000Z',
      });
    } catch (error) { await pg.close(); throw error; }
  }, 20_000);
  beforeEach(async () => { await mongo.reset(); });
  afterAll(async () => { try { await mongo?.close(); } finally { await pg?.close(); } });

  async function scoped<T>(tenant: string, work: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await pg.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.tenant_ref',$1,true)", [tenant]);
      const result = await work(client); await client.query('COMMIT'); return result;
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  }
  function service(pool = pg.pool) {
    return new LoyaltyMemberService(loyaltyDb(pool), crypto, new LoyaltyPurchaseVerifier(mongo.models.orders));
  }
  function worker(model = mongo.models.orders, loyalty = service()) {
    return new LoyaltyOrderEarnProcessor(model, loyalty);
  }
  async function seedSale(total = 1250): Promise<Sale> {
    const tenant = new Types.ObjectId().toHexString(), program = randomUUID();
    await scoped(tenant, async client => {
      await client.query("INSERT INTO loyalty.programs(id,tenant_ref,status,current_version) VALUES($1,$2,'active',1)", [program, tenant]);
      await client.query(`INSERT INTO loyalty.program_versions(tenant_ref,program_id,version,name,mechanism,minimum_purchase_cents,
        spend_step_cents,units_per_step,unit_label_singular,unit_label_plural,terms_summary)
        VALUES($1,$2,1,'Native outbox fixture','points',100,100,1,'point','points','Synthetic fixture terms')`, [tenant, program]);
    });
    const loyalty = service();
    const enrollment = await loyalty.createMember(tenant, { operationId: randomUUID(), firstName: 'Fixture', phone: null,
      termsAccepted: true, termsNoticeVersion: 'loyalty-2026-09' }, actor);
    await loyalty.acknowledgeEnrollment(tenant, { operationId: enrollment.operationId }, actor);
    const sale = { id: new Types.ObjectId(), tenant, clientId: randomUUID(), memberId: enrollment.member.id, operationId: randomUUID(), total };
    await mongo.models.orders.collection.insertOne({
      _id: sale.id, tenantId: new Types.ObjectId(tenant), clientId: sale.clientId,
      number: 1, type: 'pickup', channel: 'pos', status: 'delivered', createdAt: new Date(),
      payment: { method: 'cash', status: 'paid' }, totals: { subtotal: total, total },
      lines: [], statusHistory: [], trackingToken: 'synthetic-no-provider',
      loyaltyMemberId: sale.memberId, loyaltyEarnOperationId: sale.operationId,
      loyaltyActorRef: actor.actorRef, loyaltyDeviceRef: actor.deviceRef,
      loyaltyEarnState: 'pending', loyaltyEarnAttempts: 0, loyaltyEarnLeaseUntil: null,
      loyaltyEarnNextAttemptAt: null, loyaltyEarnLastError: null, loyaltyEarnCompletedAt: null,
    } as never);
    return sale;
  }
  const order = (sale: Sale) => mongo.models.orders.collection.findOne({ _id: sale.id });
  async function refund(sale: Sale) {
    expect((await mongo.models.orders.collection.updateOne({ _id: sale.id }, { $set: { 'payment.status': 'refunded' } })).matchedCount).toBe(1);
  }
  async function retryDue(sale: Sale) {
    await mongo.models.orders.collection.updateOne({ _id: sale.id }, { $set: {
      loyaltyEarnNextAttemptAt: new Date(0), loyaltyEarnLeaseUntil: new Date(0),
    } });
  }
  async function financial(sale: Sale) {
    return scoped(sale.tenant, async client => {
      const receipts = await client.query('SELECT operation_id,member_id,source,external_ref FROM loyalty.earn_receipts ORDER BY id');
      const ledger = await client.query('SELECT operation_id,kind,delta_units,balance_after FROM loyalty.ledger_entries ORDER BY id');
      const wallets = await client.query('SELECT balance_units,lifetime_earned_units,version FROM loyalty.wallets WHERE member_id=$1', [sale.memberId]);
      const operations = await client.query("SELECT operation_id,status FROM loyalty.operations WHERE kind='earn'");
      return { receipts: receipts.rows, ledger: ledger.rows, wallets: wallets.rows, operations: operations.rows };
    });
  }
  async function assertOneEarn(sale: Sale, units: number) {
    const snapshot = await financial(sale);
    expect(snapshot.receipts).toEqual([{ operation_id: sale.operationId, member_id: sale.memberId, source: 'pos', external_ref: `pos-order:${sale.clientId}` }]);
    expect(snapshot.operations).toEqual([{ operation_id: sale.operationId, status: 'completed' }]);
    expect(snapshot.ledger).toEqual(units ? [{ operation_id: sale.operationId, kind: 'earn', delta_units: String(units), balance_after: String(units) }] : []);
    expect(snapshot.wallets).toEqual([{ balance_units: String(units), lifetime_earned_units: String(units), version: units ? '1' : '0' }]);
    return snapshot;
  }

  it.each([{ total: 1250, units: 12 }, { total: 50, units: 0 }])(
    'a committed $units-unit gain survives a lost Mongo ACK and refund without compensation or a second gain', async ({ total, units }) => {
      const sale = await seedSale(total);
      let acknowledgements = 0;
      const intercepted = beforeCompletedAck(mongo.models.orders, async () => {
        acknowledgements += 1;
        await assertOneEarn(sale, units);
        throw new Error('Synthetic unavailable Mongo acknowledgement');
      });
      await worker(intercepted).drain();
      expect(acknowledgements).toBe(1);
      expect((await order(sale))?.loyaltyEarnState).not.toBe('completed');
      const committed = await assertOneEarn(sale, units);
      await refund(sale); await retryDue(sale);
      const loyalty = service(), earn = vi.spyOn(loyalty, 'earn');
      await worker(mongo.models.orders, loyalty).drain();
      expect(await order(sale)).toMatchObject({ loyaltyEarnState: 'reconciliation_required', loyaltyEarnLastError: 'recorded_gain_sale_ineligible' });
      expect(earn).not.toHaveBeenCalled();
      expect(await financial(sale)).toEqual(committed);
      await worker().drain(); expect(await financial(sale)).toEqual(committed);
    }, 15_000,
  );

  it('a genuinely uncommitted PG gain stays pending after refund, then reconciles the commit visible on a later pass', async () => {
    const sale = await seedSale();
    const held = holdEarnCommit(pg.pool);
    const first = worker(mongo.models.orders, service(held.pool)).drain();
    // Observe rejection immediately as well, so a failed checkpoint cannot leave
    // an unhandled rejection while the test is releasing the actual transaction.
    const finished = first.then(value => ({ value }), error => ({ error }));
    try {
      await reached(held.entered);
      expect((await financial(sale)).receipts).toEqual([]);
      await refund(sale); await retryDue(sale);
      const loyalty = service(), earn = vi.spyOn(loyalty, 'earn');
      await worker(mongo.models.orders, loyalty).drain();
      expect(await order(sale)).toMatchObject({ loyaltyEarnState: 'pending', loyaltyEarnLastError: 'sale_ineligible_unsettled' });
      expect(earn).not.toHaveBeenCalled();
      expect((await financial(sale)).operations).toEqual([]);
    } finally { held.release(); await finished; }
    expect(await finished).toMatchObject({ value: { completed: 0, retried: 1 } });
    const committed = await assertOneEarn(sale, 12);
    await retryDue(sale); await worker().drain();
    expect(await order(sale)).toMatchObject({ loyaltyEarnState: 'reconciliation_required', loyaltyEarnLastError: 'recorded_gain_sale_ineligible' });
    expect(await financial(sale)).toEqual(committed);
  }, 15_000);

  it('two real workers claim once and an expired predecessor cannot overwrite its successors acknowledgement', async () => {
    const sale = await seedSale(), entered = barrier(), resume = barrier();
    const loyalty = service(), earn = vi.spyOn(loyalty, 'earn');
    const intercepted = beforeCompletedAck(mongo.models.orders, async execute => {
      entered.release(); await resume.promise; return execute();
    });
    const first = worker(intercepted, loyalty).drain();
    const finished = first.then(value => ({ value }), error => ({ error }));
    let successor: Awaited<ReturnType<typeof order>>;
    try {
      await reached(entered.promise);
      expect(await worker(mongo.models.orders, loyalty).drain()).toMatchObject({ claimed: 0 });
      const before = await assertOneEarn(sale, 12);
      await retryDue(sale);
      expect(await worker(mongo.models.orders, loyalty).drain()).toMatchObject({ claimed: 1, completed: 1 });
      successor = await order(sale);
      expect(successor).toMatchObject({ loyaltyEarnState: 'completed', loyaltyEarnAttempts: 2 });
      expect(await financial(sale)).toEqual(before);
    } finally { resume.release(); await finished; }
    expect(await finished).toMatchObject({ value: { completed: 0, retried: 1 } });
    expect(await order(sale)).toEqual(successor!);
    expect(earn).toHaveBeenCalledTimes(1);
    await assertOneEarn(sale, 12);
  }, 15_000);

  it('refund after PG earn but before the real Mongo ACK prevents completed and is reconciled after lease recovery', async () => {
    const sale = await seedSale(); let affected: unknown;
    const intercepted = beforeCompletedAck(mongo.models.orders, async execute => {
      await assertOneEarn(sale, 12); await refund(sale);
      affected = await execute(); return affected;
    });
    expect(await worker(intercepted).drain()).toMatchObject({ completed: 0, retried: 1 });
    expect(affected).toMatchObject({ matchedCount: 0, modifiedCount: 0 });
    expect((await order(sale))?.loyaltyEarnState).not.toBe('completed');
    const committed = await assertOneEarn(sale, 12);
    await retryDue(sale); await worker().drain();
    expect(await order(sale)).toMatchObject({ loyaltyEarnState: 'reconciliation_required', loyaltyEarnLastError: 'recorded_gain_sale_ineligible' });
    expect(await financial(sale)).toEqual(committed);
  }, 15_000);
});
