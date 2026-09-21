import { randomBytes, randomUUID } from 'node:crypto';
import { Types } from 'mongoose';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { historicalSaleTestFixture, type HistoricalSaleTestFixture } from '../loyalty/loyalty-historical-sale.test-fixture';
import { LoyaltyWebSettlementProcessor } from '../loyalty/loyalty-web-settlement.processor';
import { customerOrdersMongoFixture } from './customer-orders.test-fixture';
import { OrderCounterRefundService } from '../ordering/order-counter-refund.service';
import { OrderCounterCollectionService } from './order-counter-collection.service';

const pgTarget = process.env.LOYALTY_WEB_TEST_DATABASE_URL;
const mongoTarget = process.env.CUSTOMER_ORDERS_TEST_MONGO_URL;
const integration = pgTarget && mongoTarget ? describe : describe.skip;

integration('attributed pickup discount — real Mongo + PostgreSQL', () => {
  let pg: HistoricalSaleTestFixture;
  beforeAll(async () => {
    vi.stubEnv('LOYALTY_WEB_SETTLEMENT_ENABLED', 'true');
    vi.stubEnv('ORDER_COUNTER_REFUNDS_ENABLED', 'true');
    pg = await historicalSaleTestFixture(pgTarget);
  }, 30_000);
  afterAll(async () => { try { await pg?.close(); } finally { vi.unstubAllEnvs(); } });

  it('refuses a changed loyalty basis before writing, then collects, hands over and credits the original sale exactly once', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2030-05-02T07:00:00Z'));
    let mongo: Awaited<ReturnType<typeof customerOrdersMongoFixture>> | undefined;
    try {
      const seed = await pg.seed({ eligiblePurchaseCents: 1250 });
      mongo = await customerOrdersMongoFixture(mongoTarget!, {
        tenantId: seed.tenantRef, slot: '2030-05-02T09:00:00Z',
      });
      const replica = mongo.replica(), body = mongo.request({ clientId: seed.clientId });
      const created = await replica.checkout.createForCustomer({
        slug: 'isolated-capacity', body, owner: seed.attribution.owner,
        beforeCommit: async () => seed.attribution.owner,
        sourceKey: `customer:${randomBytes(32).toString('base64url')}`,
        prepareLoyaltyAttribution: async () => seed.attribution,
      });
      const model = mongo.models.orders;
      const filter = { _id: new Types.ObjectId(created._id), tenantId: new Types.ObjectId(seed.tenantRef) };
      const before = await model.collection.findOne(filter);
      // A normal read omits this private field. The discount command must
      // explicitly load it, without broadening public/staff order responses.
      expect((await replica.orders.byId(seed.tenantRef, created._id)).customerSaleAttribution).toBeUndefined();
      await expect(replica.orders.discount(seed.tenantRef, created._id,
        { staffId: new Types.ObjectId().toHexString(), role: 'gerant' }, 250, 'Geste commercial'))
        .rejects.toMatchObject({ response: { code: 'ORDER_LOYALTY_BASIS_LOCKED' } });
      expect(await model.collection.findOne(filter)).toEqual(before);

      const actor = { sub: new Types.ObjectId().toHexString(), tenantId: seed.tenantRef, role: 'owner' as const, kind: 'user' as const };
      const collection = new OrderCounterCollectionService(model,
        { pourTenant: async () => ['bo', 'online'] } as never,
        { logOnce: vi.fn(async () => undefined) } as never, replica.redis as never);
      const operation = { operationId: randomUUID(), tender: 'cash' as const, expectedTotalCents: 1250, cashReceivedCents: 1500 };
      await collection.collect(seed.tenantRef, created._id, actor, operation);
      await replica.orders.updateStatus(seed.tenantRef, created._id, 'ready', actor);
      await replica.orders.updateStatus(seed.tenantRef, created._id, 'delivered', actor);
      const worker = new LoyaltyWebSettlementProcessor(model, pg.service);
      expect((await worker.drain()).completed).toBe(1);
      await collection.collect(seed.tenantRef, created._id, actor, operation);
      await replica.orders.updateStatus(seed.tenantRef, created._id, 'delivered', actor);
      expect((await worker.drain()).claimed).toBe(0);

      const sql = await pg.app.connect();
      try {
        await sql.query('BEGIN');
        await sql.query("SELECT set_config('app.tenant_ref',$1,true)", [seed.tenantRef]);
        expect((await sql.query('SELECT balance_units,lifetime_earned_units FROM loyalty.wallets WHERE member_id=$1', [seed.attribution.memberId])).rows)
          .toEqual([{ balance_units: '12', lifetime_earned_units: '12' }]);
        expect((await sql.query('SELECT kind,delta_units FROM loyalty.ledger_entries WHERE member_id=$1', [seed.attribution.memberId])).rows)
          .toEqual([{ kind: 'earn', delta_units: '12' }]);
        await sql.query('COMMIT');
      } catch (error) { await sql.query('ROLLBACK'); throw error; }
      finally { sql.release(); }
      expect((await model.collection.findOne(filter))?.customerSaleAttribution).toEqual(before?.customerSaleAttribution);

      const refunds = new OrderCounterRefundService(model, { pourTenant: async () => ['bo', 'online'] } as never,
        { logOnce: vi.fn(async () => undefined) } as never, replica.redis as never);
      for (const amountCents of [500, 750]) {
        const request = { operationId: randomUUID(), amountCents, tender: 'cash' as const, reason: 'Retour recette contrôlé',
          allocation: { version: 1 as const, merchandiseCents: amountCents, deliveryCents: 0 } };
        await refunds.execute('prepare', seed.tenantRef, created._id, actor, actor, request);
        await refunds.execute('start', seed.tenantRef, created._id, actor, actor, request);
        // Pending is observed without prematurely debiting an unperformed act.
        await worker.drain();
        await refunds.execute('confirm', seed.tenantRef, created._id, actor, actor, request, { attestation: 'cash_returned' });
        expect((await worker.drain()).completed).toBe(1);
        await refunds.execute('confirm', seed.tenantRef, created._id, actor, actor, request, { attestation: 'cash_returned' });
        expect((await worker.drain()).claimed).toBe(0);
      }
      const audit = await pg.app.connect();
      try {
        await audit.query('BEGIN'); await audit.query("SELECT set_config('app.tenant_ref',$1,true)", [seed.tenantRef]);
        expect((await audit.query('SELECT balance_units,lifetime_earned_units FROM loyalty.wallets WHERE member_id=$1', [seed.attribution.memberId])).rows)
          .toEqual([{ balance_units: '0', lifetime_earned_units: '0' }]);
        const ledger = (await audit.query('SELECT kind,delta_units FROM loyalty.ledger_entries WHERE member_id=$1', [seed.attribution.memberId])).rows;
        expect(ledger.filter(row => row.kind === 'earn')).toEqual([{ kind: 'earn', delta_units: '12' }]);
        expect(ledger.filter(row => row.kind === 'adjust_debit').reduce((sum, row) => sum + Number(row.delta_units), 0)).toBe(-12);
        await audit.query('COMMIT');
      } catch (error) { await audit.query('ROLLBACK'); throw error; } finally { audit.release(); }
      expect((await model.collection.findOne(filter))?.payment).toMatchObject({ status: 'refunded', refundedCents: 1250, refunds: [] });

    } finally { try { await mongo?.close(); } finally { vi.useRealTimers(); } }
  });
});
