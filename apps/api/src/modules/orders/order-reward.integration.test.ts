import { randomBytes, randomUUID } from 'node:crypto';
import { Types } from 'mongoose';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { historicalSaleTestFixture, type HistoricalSaleTestFixture } from '../loyalty/loyalty-historical-sale.test-fixture';
import { LoyaltyWebSettlementProcessor } from '../loyalty/loyalty-web-settlement.processor';
import { customerOrdersMongoFixture } from './customer-orders.test-fixture';
import { OrderRewardService } from './order-reward.service';
import { OrderRewardStore } from '../loyalty/order-reward.store';
import { OrderPaymentLifecycleService } from '../ordering/order-payment-lifecycle.service';
import { OrderCounterCollectionService } from './order-counter-collection.service';
import { OrderCounterRefundService } from '../ordering/order-counter-refund.service';
import { LoyaltyAdminService } from '../loyalty/loyalty-admin.service';
import { DeliveryService } from '../delivery/delivery.service';
import { loyaltyDb } from '@sm/loyalty';
import { publicRecoveryBinding } from './order-recovery';
import type { PrepareCustomerSaleAttribution } from './customer-sale-attribution';
import { loyaltyWebObservation, type LoyaltyWebObservedOrder } from '../loyalty/loyalty-web-observation';

const pgTarget = process.env.LOYALTY_WEB_TEST_DATABASE_URL, mongoTarget = process.env.CUSTOMER_ORDERS_TEST_MONGO_URL;
const integration = pgTarget && mongoTarget ? describe : describe.skip;
integration('reward checkout — actual Mongo + PostgreSQL boundaries', () => {
  let pg: HistoricalSaleTestFixture;
  const fixtures: Awaited<ReturnType<typeof customerOrdersMongoFixture>>[] = [];
  beforeAll(async () => {
    vi.stubEnv('ORDER_COUNTER_REFUNDS_ENABLED', 'true'); vi.stubEnv('LOYALTY_ORDER_REWARDS_ENABLED', 'true'); vi.stubEnv('LOYALTY_WEB_SETTLEMENT_ENABLED', 'true');
    pg = await historicalSaleTestFixture(pgTarget);
  }, 30_000);
  afterEach(async () => { for (const f of fixtures.splice(0)) await f.close(); vi.useRealTimers(); vi.restoreAllMocks(); });
  afterAll(async () => { try { await pg?.close(); } finally { vi.unstubAllEnvs(); } });
  async function seed(discount = 300, rule?: Parameters<HistoricalSaleTestFixture['seed']>[0]) {
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2030-05-02T07:00:00Z'));
    const earned = await pg.seed({ eligiblePurchaseCents: 10000, ...rule }); await pg.service.settleHistoricalSale(earned);
    const rewardId = randomUUID();
    await pg.admin.query(`INSERT INTO loyalty.rewards(id,tenant_ref,program_id,name,kind,cost_units,value_cents)
      VALUES($1,$2,$3,'Avantage test','fixed_discount',60,$4)`, [rewardId, earned.tenantRef, earned.attribution.programId, discount]);
    const mongo = await customerOrdersMongoFixture(mongoTarget!, { tenantId: earned.tenantRef, slot: '2030-05-02T09:00:00Z' }); fixtures.push(mongo);
    await mongo.models.tenants.collection.updateOne({ _id: new Types.ObjectId(earned.tenantRef) }, { $set: { standaloneLoyalty: true } });
    const rewards = new OrderRewardService(pg.app, mongo.models.orders, mongo.models.admissions, mongo.models.tenants, { publish: vi.fn() } as never);
    const replica = mongo.replica({ orderRewards: rewards });
    const body = mongo.request({ reward: { rewardId, expectedCostUnits: 60 }, expectedTotalCents: 1250 - discount });
    const attribution = { ...earned.attribution, clientId: body.clientId, capturedAt: Date.now(),
      basis: { policyVersion: 'merchandise-net-v1' as const, eligiblePurchaseCents: 1250 - discount, excludedChargeCents: 0, chargedTotalCents: 1250 - discount } };
    const create = (prepareLoyaltyAttribution: PrepareCustomerSaleAttribution = async () => attribution) => replica.checkout.createForCustomer({ slug: 'isolated-capacity', body, owner: earned.attribution.owner,
      beforeCommit: async () => earned.attribution.owner, sourceKey: `customer:${randomBytes(32).toString('base64url')}`,
      prepareLoyaltyAttribution });
    const wallet = async () => (await pg.admin.query('SELECT balance_units,reserved_units FROM loyalty.wallets WHERE tenant_ref=$1', [earned.tenantRef])).rows[0];
    return { earned, mongo, rewards, replica, body, create, wallet, rewardId, attribution };
  }
  it('prices and consumes once, then earns only on the remainder after pickup', async () => {
    const f = await seed(); const created = await f.create();
    expect(created.totals.total).toBe(950); expect(await f.wallet()).toEqual({ balance_units: '40', reserved_units: '0' });
    await f.create(); await f.rewards.reconcile(f.earned.tenantRef, f.body.clientId);
    expect(await f.wallet()).toEqual({ balance_units: '40', reserved_units: '0' });
    expect(JSON.stringify(created)).not.toMatch(/reservationId|memberId|pricingHash/);
    const actor = { sub: new Types.ObjectId().toHexString(), tenantId: f.earned.tenantRef, role: 'owner' as const, kind: 'user' as const };
    const collection = new OrderCounterCollectionService(f.mongo.models.orders, { pourTenant: async () => ['bo','online'] } as never,
      { logOnce: vi.fn() } as never, f.replica.redis as never);
    await collection.collect(f.earned.tenantRef, created._id, actor, { operationId: randomUUID(), tender: 'cash', expectedTotalCents: 950, cashReceivedCents: 1000 });
    await f.replica.orders.updateStatus(f.earned.tenantRef, created._id, 'ready', actor);
    await f.replica.orders.updateStatus(f.earned.tenantRef, created._id, 'delivered', actor);
    await new LoyaltyWebSettlementProcessor(f.mongo.models.orders, pg.service).drain();
    expect(await f.wallet()).toEqual({ balance_units: '49', reserved_units: '0' });
  });
  it('finishes a fully offered order without a bank intent or counter collection', async () => {
    const f = await seed(1250), created = await f.create();
    expect(created).toMatchObject({ totals: { total: 0 }, payment: { status: 'paid' } });
    const stored = await f.mongo.models.orders.collection.findOne({ clientId: f.body.clientId });
    expect(stored?.paymentFlow.attempt).toBeNull(); expect(stored?.counterCollection).toBeNull();
    expect(stored?.loyaltyRewardProcessing).toMatchObject({ state: 'consumed', zeroPaid: true });
    const actor = { sub: new Types.ObjectId().toHexString(), tenantId: f.earned.tenantRef, role: 'owner' as const, kind: 'user' as const };
    await f.replica.orders.updateStatus(f.earned.tenantRef, created._id, 'ready', actor);
    await f.replica.orders.updateStatus(f.earned.tenantRef, created._id, 'delivered', actor);
    expect((await new LoyaltyWebSettlementProcessor(f.mongo.models.orders, pg.service).drain()).completed).toBe(1);
    expect(await f.wallet()).toEqual({ balance_units: '40', reserved_units: '0' });
  });
  it('retries after a lost SQL reservation acknowledgement without a second hold', async () => {
    const f = await seed(); const original = OrderRewardStore.prototype.reserve; let once = true;
    vi.spyOn(OrderRewardStore.prototype, 'reserve').mockImplementation(async function(this: OrderRewardStore, input) {
      const result = await original.call(this, input); if (once) { once = false; throw new Error('Lost SQL COMMIT acknowledgement'); } return result;
    });
    await expect(f.create()).rejects.toThrow();
    expect(await f.wallet()).toEqual({ balance_units: '100', reserved_units: '60' });
    const created = await f.create(); expect(created.totals.total).toBe(950);
    expect(await f.wallet()).toEqual({ balance_units: '40', reserved_units: '0' });
  });
  it('closes a real admission while its original SQL reservation is delayed', async () => {
    const f = await seed(); let entered!: () => void, release!: () => void;
    const ready = new Promise<void>(done => { entered = done; }), resume = new Promise<void>(done => { release = done; });
    const original = OrderRewardStore.prototype.reserve;
    vi.spyOn(OrderRewardStore.prototype, 'reserve').mockImplementation(async function(this: OrderRewardStore, input) { entered(); await resume; return original.call(this, input); });
    const pending = f.create().catch(error => error); await ready;
    expect(await f.replica.admissions.abandon(f.earned.tenantRef, f.body)).toMatchObject({ state: 'rejected' });
    await f.rewards.reconcile(f.earned.tenantRef, f.body.clientId); release(); await pending;
    expect(await f.wallet()).toEqual({ balance_units: '100', reserved_units: '0' });
    expect(await f.mongo.models.orders.countDocuments({ clientId: f.body.clientId })).toBe(0);
  });
  it('releases after a price-change rejection and refuses unauthenticated selection', async () => {
    const f = await seed(); f.body.expectedTotalCents = 1;
    await expect(f.create()).rejects.toMatchObject({ response: { code: 'ORDER_ATTEMPT_REJECTED' } });
    await f.rewards.reconcile(f.earned.tenantRef, f.body.clientId);
    expect(await f.wallet()).toEqual({ balance_units: '100', reserved_units: '0' });
    await expect(f.replica.checkout.createPublic('isolated-capacity', f.body)).rejects.toThrow('compte');
  });
  it('honors a terminal CAS before freeing a hold when a validator disappeared', async () => {
    const f = await seed(); await f.replica.admissions.begin(f.earned.tenantRef, f.body, f.earned.attribution.owner);
    const binding = await f.replica.admissions.claimValidation(f.earned.tenantRef, f.body.clientId, publicRecoveryBinding(f.earned.tenantRef, f.body, f.earned.attribution.owner)!);
    await f.rewards.prepare({ tenantRef: f.earned.tenantRef, clientId: f.body.clientId, binding: binding!, selection: f.body.reward!,
      subtotal: 1250, lines: [{ productId: f.mongo.productId, unitPrice: 1250, qty: 1, options: [] }] });
    await f.rewards.reconcile(f.earned.tenantRef, f.body.clientId);
    expect(await f.wallet()).toEqual({ balance_units: '100', reserved_units: '60' });
    vi.setSystemTime(new Date('2030-05-02T08:01:00Z')); await f.rewards.drain();
    expect((await f.replica.admissions.recover(f.earned.tenantRef, f.body.clientId, f.body.recoveryProof!)).state).toBe('rejected');
    expect(await f.wallet()).toEqual({ balance_units: '100', reserved_units: '0' });
  });
  it('restores the consumed reward exactly once after real counter partials reach the full paid remainder', async () => {
    const f = await seed(), created = await f.create();
    const actor = { sub: new Types.ObjectId().toHexString(), tenantId: f.earned.tenantRef, role: 'owner' as const, kind: 'user' as const };
    const caps = { pourTenant: async () => ['bo','online'] }, audit = { logOnce: vi.fn() };
    await new OrderCounterCollectionService(f.mongo.models.orders, caps as never, audit as never, f.replica.redis as never)
      .collect(actor.tenantId, created._id, actor, { operationId: randomUUID(), tender: 'cash', expectedTotalCents: 950, cashReceivedCents: 1000 });
    await f.replica.orders.updateStatus(actor.tenantId, created._id, 'ready', actor);
    await f.replica.orders.updateStatus(actor.tenantId, created._id, 'delivered', actor);
    const gains = new LoyaltyWebSettlementProcessor(f.mongo.models.orders, pg.service); await gains.drain();
    const refunds = new OrderCounterRefundService(f.mongo.models.orders, caps as never, audit as never, f.replica.redis as never);
    const part = async (amountCents: number) => {
      const intent = { operationId: randomUUID(), amountCents, tender: 'cash' as const, reason: 'Article retourné', allocation: { version: 1 as const, merchandiseCents: amountCents, deliveryCents: 0 } };
      await refunds.execute('prepare', actor.tenantId, created._id, actor, actor, intent);
      await refunds.execute('start', actor.tenantId, created._id, actor, actor, intent);
      await f.rewards.reconcile(actor.tenantId, f.body.clientId);
      expect((await new OrderRewardStore(pg.app).read(actor.tenantId, f.body.clientId))?.state).toBe('consumed');
      await refunds.execute('confirm', actor.tenantId, created._id, actor, actor, intent, { attestation: 'cash_returned' });
      await gains.drain();
    };
    await part(450); await f.rewards.reconcile(actor.tenantId, f.body.clientId);
    expect((await new OrderRewardStore(pg.app).read(actor.tenantId, f.body.clientId))?.state).toBe('consumed');
    await part(500);
    // No direct reward call: the worker discovers the financial transition.
    await f.rewards.drain(); await f.rewards.drain(); await f.rewards.reconcile(actor.tenantId, f.body.clientId);
    expect(await f.wallet()).toEqual({ balance_units: '100', reserved_units: '0' });
    expect((await new OrderRewardStore(pg.app).read(actor.tenantId, f.body.clientId))?.state).toBe('reversed');
  });
  it('does not accept new holds if the durable recovery queue cannot be indexed', async () => {
    const f = await seed(); await f.mongo.models.admissions.collection.dropIndex('order_reward_attempt_due');
    await expect(f.create()).rejects.toThrow();
    expect(await f.wallet()).toEqual({ balance_units: '100', reserved_units: '0' });
    expect(await f.mongo.models.orders.countDocuments({ clientId: f.body.clientId })).toBe(0);
  });
  it('configures a real menu product in the back office and quotes it without reserving any points', async () => {
    const f = await seed();
    const admin = new LoyaltyAdminService(loyaltyDb(pg.app), f.mongo.models.products);
    const input = { name: 'Mon produit offert', description: 'Hors suppléments', costUnits: 60, kind: 'product' as const, valueCents: null, productRef: f.mongo.productId, active: true };
    const reward = await admin.createReward(f.earned.tenantRef, input);
    await expect(admin.createReward(new Types.ObjectId().toHexString(), input)).rejects.toThrow('ce restaurant');
    await expect(admin.createReward(f.earned.tenantRef, { ...input, productRef: 'Ancien nom libre' })).rejects.toThrow('ce restaurant');
    const quotes = new DeliveryService(f.mongo.models.tenants, f.mongo.models.products, f.mongo.models.orders, {} as never, f.replica.redis as never, f.mongo.models.promotions, pg.app);
    const quote = await quotes.quotePickup('isolated-capacity', { lines: f.body.lines, reward: { rewardId: reward.id, expectedCostUnits: 60 } });
    expect(quote).toMatchObject({ fulfillment: 'pickup', originalSubtotalCents: 1250, totalCents: 0, discount: { amount: 1250 } });
    expect(await f.wallet()).toEqual({ balance_units: '100', reserved_units: '0' });
    expect(await f.mongo.models.admissions.countDocuments()).toBe(0);
    await expect(quotes.quotePickup('isolated-capacity', { lines: f.body.lines, reward: { rewardId: reward.id, expectedCostUnits: 1 } })).rejects.toThrow('changé');
    await admin.updateReward(f.earned.tenantRef, reward.id, { active: false });
    await expect(quotes.quotePickup('isolated-capacity', { lines: f.body.lines, reward: { rewardId: reward.id, expectedCostUnits: 60 } })).rejects.toThrow('changé');
  });

  it('cancels a fully offered order before pickup and restores its points without a bank request', async () => {
    const f = await seed(1250), created = await f.create();
    const lifecycle = new OrderPaymentLifecycleService(f.mongo.models.orders);
    await lifecycle.cancel(created._id, f.earned.tenantRef, new Types.ObjectId().toHexString(), 'Annulation avant retrait', null);
    const worker = () => new LoyaltyWebSettlementProcessor(f.mongo.models.orders, pg.service);
    const read = () => f.mongo.models.orders.findById(created._id).select('+loyaltyRewardProcessing +loyaltyWebProcessing').lean();
    expect(await worker().drain()).toMatchObject({ claimed: 1, reconciliation: 0, completed: 0, retried: 1 });
    expect((await read())?.loyaltyRewardProcessing?.state).toBe('consumed');
    expect((await read())?.loyaltyWebProcessing).toMatchObject({ state: 'pending', dirty: false,
      nextAttemptAt: null, awardedUnits: null, lastError: 'payment_or_handoff_pending' });
    expect(await f.wallet()).toEqual({ balance_units: '40', reserved_units: '0' });
    const sale = async () => (await pg.admin.query(`SELECT initial_units,status,reason FROM loyalty.sale_settlements
      WHERE tenant_ref=$1 AND client_id=$2`, [f.earned.tenantRef, f.body.clientId])).rows;
    expect(await sale()).toEqual([{ initial_units: null, status: 'pending', reason: 'payment_or_handoff_pending' }]);
    await f.rewards.reconcile(f.earned.tenantRef, f.body.clientId);
    expect((await read())?.loyaltyRewardProcessing?.state).toBe('reversed');
    // Replay a lost Mongo acknowledgement after restitution using the exact
    // financial versions; the pending SQL case must never turn into a gain.
    await f.mongo.models.orders.collection.updateOne({ clientId: f.body.clientId }, {
      $set: { 'loyaltyWebProcessing.dirty': true, 'loyaltyWebProcessing.nextAttemptAt': new Date() },
    });
    expect(await worker().drain()).toMatchObject({ claimed: 1, reconciliation: 0, completed: 0, retried: 1 });
    await lifecycle.cancel(created._id, f.earned.tenantRef, new Types.ObjectId().toHexString(), 'Annulation avant retrait', null);
    await f.rewards.reconcile(f.earned.tenantRef, f.body.clientId);
    for (const elapsed of [65_000, 1_800_000]) {
      vi.setSystemTime(Date.now() + elapsed);
      expect((await worker().drain()).claimed).toBe(0);
      expect(await sale()).toEqual([{ initial_units: null, status: 'pending', reason: 'payment_or_handoff_pending' }]);
    }
    expect((await pg.admin.query(`SELECT count(*)::int n FROM loyalty.earn_receipts
      WHERE tenant_ref=$1 AND external_ref=$2`, [f.earned.tenantRef, `order:${f.body.clientId}`])).rows[0].n).toBe(0);
    expect(await f.wallet()).toEqual({ balance_units: '100', reserved_units: '0' });
    expect((await f.mongo.models.orders.findById(created._id))?.status).toBe('cancelled');
  });
  it.each(['delivered', 'cancelled'] as const)('keeps a %s zero order valid when a program publishes after the reward reservation commits', async status => {
    const f = await seed(1250), admin = new LoyaltyAdminService(loyaltyDb(pg.app), f.mongo.models.products);
    let entered!: () => void, release!: () => void;
    const reserved = new Promise<void>(resolve => { entered = resolve; }), published = new Promise<void>(resolve => { release = resolve; });
    const original = OrderRewardStore.prototype.reserve;
    vi.spyOn(OrderRewardStore.prototype, 'reserve').mockImplementation(async function(this: OrderRewardStore, input) {
      const snapshot = await original.call(this, input); entered(); await published; return snapshot;
    });
    const pending = f.create(async () => {
      const current = await admin.getProgram(f.earned.tenantRef);
      if (!current) throw new Error('Program fixture missing');
      // The protected identity is fixture-owned; the rule/version comes from
      // the actual publication, not a fabricated version number.
      return { ...f.attribution, rulesVersion: current.rulesVersion, rule: current.earn };
    });
    await reserved;
    try {
      expect((await new OrderRewardStore(pg.app).read(f.earned.tenantRef, f.body.clientId))?.snapshot.rulesVersion).toBe(1);
      const current = (await admin.getProgram(f.earned.tenantRef))!;
      const next = await admin.putProgram(f.earned.tenantRef, { name: `${current.name} actualisé`, status: current.status,
        unitLabelSingular: current.unitLabelSingular, unitLabelPlural: current.unitLabelPlural,
        termsSummary: current.termsSummary, earn: { mechanism: 'stamps', minimumPurchaseCents: 0,
          maximumUnitsPerPurchase: null, unitsPerVisit: 1 } });
      expect(next.rulesVersion).toBe(2);
    } finally { release(); }
    const created = await pending;
    const actor = { sub: new Types.ObjectId().toHexString(), tenantId: f.earned.tenantRef, role: 'owner' as const, kind: 'user' as const };
    if (status === 'delivered') {
      await f.replica.orders.updateStatus(actor.tenantId, created._id, 'ready', actor);
      await f.replica.orders.updateStatus(actor.tenantId, created._id, 'delivered', actor);
    } else await new OrderPaymentLifecycleService(f.mongo.models.orders).cancel(created._id, actor.tenantId, actor.sub, 'Annulation avant retrait', null);
    const raw = await f.mongo.models.orders.collection.findOne({ clientId: f.body.clientId });
    expect(raw?.loyaltyReward.rulesVersion).toBe(1); expect(raw?.customerSaleAttribution.rulesVersion).toBe(2);
    expect(loyaltyWebObservation(raw as unknown as LoyaltyWebObservedOrder).observation.paidAndDelivered).toBe(status === 'delivered');
    expect((await new LoyaltyWebSettlementProcessor(f.mongo.models.orders, pg.service).drain()).reconciliation).toBe(0);
    const stored = (await pg.admin.query(`SELECT initial_units,status,reason FROM loyalty.sale_settlements
      WHERE tenant_ref=$1 AND client_id=$2`, [f.earned.tenantRef, f.body.clientId])).rows;
    expect(stored).toEqual([status === 'delivered' ? { initial_units: '0', status: 'recorded', reason: null }
      : { initial_units: null, status: 'pending', reason: 'payment_or_handoff_pending' }]);
    await f.rewards.reconcile(f.earned.tenantRef, f.body.clientId);
    await new LoyaltyWebSettlementProcessor(f.mongo.models.orders, pg.service).drain();
    expect(await f.wallet()).toEqual({ balance_units: status === 'delivered' ? '40' : '100', reserved_units: '0' });
  });
  it('a fully offered stamp-program visit earns no replacement stamp', async () => {
    const f = await seed(1250, { rule: { mechanism: 'stamps', minimumPurchaseCents: 0, maximumUnitsPerPurchase: null, unitsPerVisit: 100 } });
    const created = await f.create();
    const actor = { sub: new Types.ObjectId().toHexString(), tenantId: f.earned.tenantRef, role: 'owner' as const, kind: 'user' as const };
    await f.replica.orders.updateStatus(actor.tenantId, created._id, 'ready', actor);
    await f.replica.orders.updateStatus(actor.tenantId, created._id, 'delivered', actor);
    await new LoyaltyWebSettlementProcessor(f.mongo.models.orders, pg.service).drain();
    expect(await f.wallet()).toEqual({ balance_units: '40', reserved_units: '0' });
    await expect(new OrderPaymentLifecycleService(f.mongo.models.orders).cancel(created._id, actor.tenantId, actor.sub, 'Déjà remis', null)).rejects.toThrow('remise');
  });
  it('does not confuse a manipulated paid-zero flag with a consumed offered-order receipt', async () => {
    const f = await seed(1250), created = await f.create();
    await f.mongo.models.orders.collection.updateOne({ clientId: f.body.clientId }, { $set: { 'loyaltyRewardProcessing.zeroPaid': false } });
    await expect(new OrderPaymentLifecycleService(f.mongo.models.orders).cancel(created._id, f.earned.tenantRef, new Types.ObjectId().toHexString(), 'Incohérent', null)).rejects.toThrow('réglée');
    expect(await f.wallet()).toEqual({ balance_units: '40', reserved_units: '0' });
  });

  it('repairs a missing Mongo projection from the canonical SQL receipt without spending again', async () => {
    const f = await seed(), created = await f.create();
    await f.mongo.models.orders.collection.updateOne({ clientId: f.body.clientId }, { $set: { loyaltyRewardProcessing: null } });
    await f.rewards.reconcile(f.earned.tenantRef, f.body.clientId);
    expect(await f.wallet()).toEqual({ balance_units: '40', reserved_units: '0' });
    expect((await f.mongo.models.orders.findById(created._id).select('+loyaltyRewardProcessing'))?.loyaltyRewardProcessing?.state).toBe('consumed');
  });

});
