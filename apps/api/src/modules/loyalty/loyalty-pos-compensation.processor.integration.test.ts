import { randomUUID } from 'node:crypto';
import { loyaltyDb } from '@sm/loyalty';
import type { Order } from '@sm/db';
import { Types, type Model, type Query } from 'mongoose';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { customerOrdersMongoFixture } from '../orders/customer-orders.test-fixture';
import { counterRefundProjection } from '../ordering/order-counter-refund.policy';
import { historicalSaleTestFixture, type HistoricalSaleTestFixture } from './loyalty-historical-sale.test-fixture';
import { LoyaltyHistoricalSaleService } from './loyalty-historical-sale.service';
import { LoyaltyPosCompensationProcessor } from './loyalty-pos-compensation.processor';
import { LoyaltySaleSettlementService } from './loyalty-sale-settlement.service';
import { posTestCrypto, seedPosReceipt, reservePosFixtureReward } from './loyalty-pos.test-fixture';
import type { LoyaltyPosObservedOrder } from './loyalty-pos-observation';

const pgTarget = process.env.LOYALTY_WEB_TEST_DATABASE_URL, mongoTarget = process.env.CUSTOMER_ORDERS_TEST_MONGO_URL;
const integration = pgTarget && mongoTarget ? describe : describe.skip;
type Mongo = Awaited<ReturnType<typeof customerOrdersMongoFixture>>;
const owner = (tenantId: string) => ({ sub: '507f1f77bcf86cd799439010', tenantId, kind: 'user' as const, role: 'owner' as const });
integration('POS compensation — Mongo + PostgreSQL runtime, no provider', () => {
  let f: HistoricalSaleTestFixture, mongo: Mongo, service: LoyaltyHistoricalSaleService;
  beforeAll(async () => {
    vi.stubEnv('LOYALTY_POS_COMPENSATION_ENABLED', 'true'); f = await historicalSaleTestFixture(pgTarget);
    service = new LoyaltyHistoricalSaleService(loyaltyDb(f.app), posTestCrypto);
    try { mongo = await customerOrdersMongoFixture(mongoTarget!, { tenantId: '507f1f77bcf86cd799439011', slot: '2030-05-02T09:00:00Z' }); }
    catch (e) { await f.close(); throw e; }
  }, 30_000);
  afterAll(async () => { try { await mongo?.close(); } finally { await f?.close(); vi.unstubAllEnvs(); } });
  const worker = (orders = mongo.models.orders) => new LoyaltyPosCompensationProcessor(orders, service);
  async function seed(amount = 0, linked = false) {
    const input = await seedPosReceipt(f, service, 1000, 10, linked), now = new Date('2030-01-01T12:00:00Z');
    const row = { _id: new Types.ObjectId(), tenantId: new Types.ObjectId(input.tenantRef), clientId: input.clientId, number: 1,
      channel: 'pos', type: 'pickup', status: 'delivered', createdAt: now, __v: 1, lines: [],
      totals: { subtotal: 1000, discount: null, deliveryFee: 0, total: 1000 },
      statusHistory: [{ status: 'new', at: now, by: owner(input.tenantRef).sub }, { status: 'delivered', at: new Date(now.getTime() + 1000), by: owner(input.tenantRef).sub }],
      payment: { method: 'counter', tender: 'cash', status: 'paid', cashReceived: 1000, changeGiven: 0, refundedCents: 0, pendingRefundCents: 0, refundSyncVersion: 0, refunds: [] },
      paymentFlow: { version: 1, origin: 'created_v1', phase: 'open', attempt: null, close: null },
      loyaltyMemberId: input.attribution.memberId, loyaltyEarnOperationId: input.earnOperationId, loyaltyEarnState: 'completed',
      loyaltyPosCompensationProcessing: { state: 'pending', dirty: true, attempts: 0, nextAttemptAt: new Date(0) }, counterRefundFlow: null,
    } as unknown as LoyaltyPosObservedOrder;
    await mongo.models.orders.collection.insertOne(row as never);
    if (amount) await refund(row, amount);
    return { row, input };
  }
  async function refund(row: LoyaltyPosObservedOrder, amount: number, wake = true) {
    const original = await mongo.models.orders.collection.findOne({ _id: row._id as Types.ObjectId }) as unknown as LoyaltyPosObservedOrder;
    const projection = counterRefundProjection(original);
    const op = { operationId: randomUUID(), amountCents: amount - projection.confirmedRefundedCents, reason: 'Remboursement de recette', tender: 'cash',
      allocation: { version: 1, merchandiseCents: amount - projection.confirmedRefundedCents, deliveryCents: 0 },
      actor: owner(String(row.tenantId)), approver: owner(String(row.tenantId)), state: 'confirmed',
      preparedAt: new Date('2030-01-01T13:00:00Z'), startedAt: new Date('2030-01-01T13:00:01Z'), disburseExpiresAt: new Date('2030-01-01T13:05:01Z'), confirmedAt: new Date('2030-01-01T13:00:02Z'),
      resolvedAt: null, attestation: 'cash_returned', resolution: null };
    const operations = [...(original.counterRefundFlow?.operations ?? []), op];
    await mongo.models.orders.collection.updateOne({ _id: row._id as Types.ObjectId }, { $set: {
      counterRefundFlow: { version: 1, paymentProofHash: projection.paymentProofHash, operations },
      'payment.refundedCents': amount, 'payment.status': amount === 1000 ? 'refunded' : 'paid',
      ...(wake ? { 'loyaltyPosCompensationProcessing.nextAttemptAt': new Date(0), 'loyaltyPosCompensationProcessing.dirty': true } : {}),
    }, $inc: { __v: 1, 'payment.refundSyncVersion': 1 } });
  }
  const balance = async (tenant: string, member: string) => (await f.admin.query('SELECT balance_units,lifetime_earned_units FROM loyalty.wallets WHERE tenant_ref=$1 AND member_id=$2', [tenant, member])).rows[0];
  const rowState = (row: LoyaltyPosObservedOrder) => mongo.models.orders.collection.findOne({ _id: row._id as Types.ObjectId });
  it('two workers compensate a partial then total physical refund once; no new account or gain', async () => {
    const { row, input } = await seed(300);
    await Promise.all([worker().drain(), worker().drain()]);
    expect(await balance(input.tenantRef, input.attribution.memberId)).toEqual({ balance_units: '7', lifetime_earned_units: '7' });
    await refund(row, 1000); await worker().drain(); await worker().drain();
    expect(await balance(input.tenantRef, input.attribution.memberId)).toEqual({ balance_units: '0', lifetime_earned_units: '0' });
    expect((await rowState(row))?.loyaltyPosCompensationProcessing).toMatchObject({ state: 'completed', awardedUnits: 10, reversedUnits: 10, dirty: false });
    expect((await f.admin.query('SELECT count(*)::int n FROM loyalty.earn_receipts WHERE tenant_ref=$1', [input.tenantRef])).rows[0].n).toBe(1);
  });
  it('recovers real SQL commit with lost Mongo acknowledgement without a second debit', async () => {
    const { row, input } = await seed(400); let armed = true;
    const wrapped = new Proxy(mongo.models.orders, { get(target, key, receiver) {
      if (key !== 'updateOne') return Reflect.get(target, key, receiver);
      return (...args: unknown[]) => {
        const q = Reflect.apply(target.updateOne, target, args) as Query<unknown, Order>;
        if (armed && (args[1] as { $set?: Record<string, unknown> }).$set?.['loyaltyPosCompensationProcessing.state'] === 'completed') {
          armed = false; q.exec = async () => { throw new Error('Synthetic lost ACK after actual SQL commit'); };
        }
        return q;
      };
    } }) as Model<Order>;
    expect((await worker(wrapped).drain()).retried).toBe(1);
    expect(await balance(input.tenantRef, input.attribution.memberId)).toMatchObject({ balance_units: '6' });
    await mongo.models.orders.collection.updateOne({ _id: row._id as Types.ObjectId }, { $set: { 'loyaltyPosCompensationProcessing.nextAttemptAt': new Date(0) } });
    await worker().drain(); expect(await balance(input.tenantRef, input.attribution.memberId)).toMatchObject({ balance_units: '6' });
    expect((await f.admin.query('SELECT count(*)::int n FROM loyalty.sale_corrections WHERE tenant_ref=$1', [input.tenantRef])).rows[0].n).toBe(1);
  });
  it('a refund committed between SQL and Mongo ACK invalidates the first snapshot and resumes cumulative correction', async () => {
    const { row, input } = await seed(300); let armed = true;
    const wrapped = new Proxy(mongo.models.orders, { get(target, key, receiver) {
      if (key !== 'updateOne') return Reflect.get(target, key, receiver);
      return (...args: unknown[]) => {
        const q = Reflect.apply(target.updateOne, target, args) as Query<unknown, Order>;
        if (armed && (args[1] as { $set?: Record<string, unknown> }).$set?.['loyaltyPosCompensationProcessing.state'] === 'completed') {
          armed = false; const execute = q.exec.bind(q); q.exec = async () => { await refund(row, 1000); return execute(); };
        }
        return q;
      };
    } }) as Model<Order>;
    await worker(wrapped).drain(); await worker().drain();
    expect(await balance(input.tenantRef, input.attribution.memberId)).toMatchObject({ balance_units: '0' });
    expect((await rowState(row))?.loyaltyPosCompensationProcessing.reversedUnits).toBe(10);
  });
  it('old POS rows with null scheduler are admitted by bounded fallback, never fake a gain', async () => {
    const { row, input } = await seed(200);
    await mongo.models.orders.collection.updateOne({ _id: row._id as Types.ObjectId }, { $set: { loyaltyPosCompensationProcessing: null } });
    const p = worker(); await p.drain(); await p.drain();
    expect(await balance(input.tenantRef, input.attribution.memberId)).toMatchObject({ balance_units: '8' });
  });
  it('counter drift without a journal is an explicit reconciliation and no debit', async () => {
    const { row, input } = await seed();
    await mongo.models.orders.collection.updateOne({ _id: row._id as Types.ObjectId }, { $set: { 'payment.refundedCents': 300 } });
    await worker().drain();
    expect(await balance(input.tenantRef, input.attribution.memberId)).toMatchObject({ balance_units: '10' });
    expect((await rowState(row))?.loyaltyPosCompensationProcessing).toMatchObject({ state: 'reconciliation_required', lastError: 'financial_proof_conflict' });
  });
  it('Stripe cumulative proof takes precedence over an older aggregate and never waits for allocation of a legacy total', async () => {
    const { row, input } = await seed();
    await mongo.models.orders.collection.updateOne({ _id: row._id as Types.ObjectId }, { $set: {
      'payment.method': 'online', 'payment.stripePaymentIntentId': 'pi_pos_fixture', 'payment.stripeAccountId': null,
      'payment.refunds': [{ id: 're_pos_partial', amountCents: 300, status: 'succeeded' }],
      // The exact receipt is newer than the historical materialized counter.
      'payment.refundedCents': 0, 'payment.refundSyncVersion': 1,
    }, $inc: { __v: 1 } });
    await worker().drain();
    expect(await balance(input.tenantRef, input.attribution.memberId)).toMatchObject({ balance_units: '7' });
  });
  it('BO reads show the POS case with no side effect and owner retry uses available balance', async () => {
    const { row, input } = await seed(300, true);
    const hold = await reservePosFixtureReward(f, input, 9);
    await worker().drain();
    const bo = new LoyaltySaleSettlementService(mongo.models.orders, loyaltyDb(f.app), service), actor = owner(input.tenantRef);
    const before = await balance(input.tenantRef, input.attribution.memberId);
    const view = await bo.get(input.tenantRef, String(row._id), actor);
    expect(view).toMatchObject({ state: 'reconciliation', reason: 'insufficient_balance', initialUnits: 10, dueUnits: 3, canResolve: true });
    expect(await balance(input.tenantRef, input.attribution.memberId)).toEqual(before);
    expect((await bo.list(input.tenantRef, actor, { limit: 20 })).items).toHaveLength(1);
    await hold.release();
    const body = { operationId: randomUUID(), caseId: view.caseId!, expectedVersion: view.version!, decision: 'retry' as const, reason: 'Reprise propriétaire autorisée', password: 'unused-service-boundary' };
    expect(await bo.resolve(input.tenantRef, String(row._id), actor, body)).toMatchObject({ state: 'recorded', reversedUnits: 3 });
    expect(await bo.get(input.tenantRef, String(row._id), actor, body.operationId)).toMatchObject({ resolutions: [{ request: { operationId: body.operationId } }] });
  });
});
