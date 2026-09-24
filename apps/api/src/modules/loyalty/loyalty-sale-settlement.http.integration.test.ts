import 'reflect-metadata';
import { randomBytes, randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { Inject, Module, type INestApplication } from '@nestjs/common';
import { APP_GUARD, NestFactory, Reflector } from '@nestjs/core';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { getModelToken } from '@nestjs/mongoose';
import { ThrottlerModule, ThrottlerStorageService, getStorageToken } from '@nestjs/throttler';
import * as argon2 from 'argon2';
import mongoose, { Types, type Connection } from 'mongoose';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { MODELS } from '@sm/db';
import { loyaltyDb } from '@sm/loyalty';
import { LoyaltySaleSettlementSchema, LoyaltySaleSettlementV2Schema, type JwtPayload, type LoyaltySaleResolutionRequest } from '@sm/contracts';
import { AuthGuard } from '../../common/auth';
import { CapaciteGuard, CapacitesService } from '../../common/capacites';
import { SessionAccessService } from '../../common/session-access';
import { OwnerReauthentication } from '../encaissement/owner-reauthentication.service';
import { historicalSaleTestFixture, type HistoricalSaleTestFixture } from './loyalty-historical-sale.test-fixture';
import { loyaltyWebFixture } from './loyalty-web.test-fixture';
import { loyaltyWebObservation } from './loyalty-web-observation';
import { LoyaltySaleSettlementService } from './loyalty-sale-settlement.service';
import { LoyaltySaleSettlementController } from './loyalty-sale-settlement.controller';

function isolated(raw: string) {
  const url = new URL(raw);
  if (url.protocol !== 'mongodb:' || !['127.0.0.1', 'localhost'].includes(url.hostname) || url.username || url.password || url.search || url.hash
    || !/^\/snackmanager_runtime_test_[a-z0-9_]+$/i.test(url.pathname)) throw new Error('Local isolated Mongo fixture required');
  url.pathname += `_sales_${randomUUID().replaceAll('-', '').slice(0, 10)}`; return url.toString();
}
const mongo = process.env.CUSTOMER_ORDERS_TEST_MONGO_URL ? isolated(process.env.CUSTOMER_ORDERS_TEST_MONGO_URL) : null;
const integration = mongo && process.env.CUSTOMER_TEST_DATABASE_URL ? describe : describe.skip;
describe('sale settlement integration target', () => { it('rejects remote or business Mongo targets', () => {
  for (const uri of ['mongodb://remote.invalid/snackmanager_runtime_test_ci', 'mongodb://localhost/snackmanager', 'mongodb://localhost/snackmanager_runtime_test_ci?x=y']) expect(() => isolated(uri)).toThrow();
}); });
integration('loyalty sale settlement — real HTTP, SQL RLS and Mongo', () => {
  let f: HistoricalSaleTestFixture, db: Connection, app: INestApplication, origin: string, password: string;
  let models: { Tenant: ReturnType<Connection['model']>; User: ReturnType<Connection['model']>; Order: ReturnType<Connection['model']> };
  let tenant: string, orderId: string, actorId: string, token: string, manager: string, foreign: string;
  let row: ReturnType<typeof loyaltyWebFixture>, rea: OwnerReauthentication;
  const runId = randomUUID();
  beforeAll(async () => {
    f = await historicalSaleTestFixture(process.env.CUSTOMER_TEST_DATABASE_URL);
    db = await mongoose.createConnection(mongo!, { autoCreate: false, autoIndex: false, directConnection: true, serverSelectionTimeoutMS: 5000 }).asPromise();
    expect(await db.db!.listCollections().toArray()).toEqual([]); await db.db!.collection('_run').insertOne({ runId });
    models = Object.fromEntries(['Tenant', 'User', 'Order', 'Staff', 'Device'].map(key => {
      const definition = MODELS[key as keyof typeof MODELS]; return [key, db.model(definition.name, definition.schema, definition.collection)];
    })) as unknown as typeof models;
    for (const model of Object.values(models)) await model.createCollection();
    password = randomBytes(24).toString('hex');
    Inject(Reflector)(CapaciteGuard, undefined, 0); Inject(CapacitesService)(CapaciteGuard, undefined, 1);
    Reflect.defineMetadata('design:paramtypes', CapaciteGuard, [Reflector, CapacitesService]);
    Inject(LoyaltySaleSettlementService)(LoyaltySaleSettlementController, undefined, 0); Inject(OwnerReauthentication)(LoyaltySaleSettlementController, undefined, 1);
    Reflect.defineMetadata('design:paramtypes', LoyaltySaleSettlementController, [LoyaltySaleSettlementService, OwnerReauthentication]);
    class Fixture {}
    Module({ imports: [JwtModule.register({ secret: randomBytes(32).toString('hex'), signOptions: { expiresIn: '5m' } }), ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 100 }])],
      controllers: [LoyaltySaleSettlementController], providers: [
        ...Object.entries(models).map(([name, model]) => ({ provide: getModelToken(name), useValue: model })),
        SessionAccessService, CapacitesService, OwnerReauthentication,
        { provide: LoyaltySaleSettlementService, useValue: new LoyaltySaleSettlementService(models.Order as never, loyaltyDb(f.app), f.service) },
        { provide: CapaciteGuard, inject: [Reflector, CapacitesService], useFactory: (r: Reflector, c: CapacitesService) => new CapaciteGuard(r, c) },
        { provide: APP_GUARD, inject: [JwtService, Reflector, SessionAccessService], useFactory: (j: JwtService, r: Reflector, s: SessionAccessService) => new AuthGuard(j, r, s) },
      ] })(Fixture);
    app = await NestFactory.create(Fixture, { logger: false, abortOnError: false }); await app.listen(0, '127.0.0.1');
    origin = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`; rea = app.get(OwnerReauthentication); vi.spyOn(rea, 'verify');
  }, 40_000);
  beforeEach(async () => {
    vi.stubEnv('LOYALTY_WEB_SETTLEMENT_ENABLED', 'true');
    const storage = app.get<ThrottlerStorageService>(getStorageToken()); storage.onApplicationShutdown(); storage.storage.clear();
    const input = await f.seed(); tenant = input.tenantRef; actorId = new Types.ObjectId().toHexString(); orderId = new Types.ObjectId().toHexString();
    const other = new Types.ObjectId().toHexString(), managerId = new Types.ObjectId().toHexString(), otherId = new Types.ObjectId().toHexString();
    await models.Tenant.create([{ _id: tenant, slug: `fixture-${tenant}`, name: 'Fixture', plan: null, standaloneLoyalty: true, account: { status: 'active' } }, { _id: other, slug: `fixture-${other}`, name: 'Other', plan: null, standaloneLoyalty: true, account: { status: 'active' } }]);
    const hash = await argon2.hash(password);
    await models.User.create([{ _id: actorId, tenantId: tenant, email: `${actorId}@fixture.invalid`, role: 'owner', passwordHash: hash, sessionVersion: 'v1' },
      { _id: managerId, tenantId: tenant, email: `${managerId}@fixture.invalid`, role: 'cogerant', passwordHash: hash, sessionVersion: 'v1' },
      { _id: otherId, tenantId: other, email: `${otherId}@fixture.invalid`, role: 'owner', passwordHash: hash, sessionVersion: 'v1' }]);
    const jwt = app.get(JwtService), sign = (sub: string, tenantId: string, role: JwtPayload['role']) => jwt.signAsync({ sub, tenantId, role, kind: 'user', userSessionVersion: 'v1' } satisfies JwtPayload);
    token = await sign(actorId, tenant, 'owner'); manager = await sign(managerId, tenant, 'cogerant'); foreign = await sign(otherId, other, 'owner');
    row = { ...loyaltyWebFixture(), _id: new Types.ObjectId(orderId), tenantId: new Types.ObjectId(tenant), clientId: input.clientId,
      customerSaleAttribution: input.attribution, customerOwner: input.attribution.owner, loyaltyWebIntent: { version: 1, operationId: input.earnOperationId } };
    row.payment.method = 'online'; row.payment.stripePaymentIntentId = 'pi_fixture'; row.payment.stripeAccountId = 'acct_fixture'; row.counterCollection = null;
    row.paymentFlow = { version: 1, phase: 'settled', providerStatus: 'succeeded', attempt: { id: randomUUID(), accountId: 'acct_fixture', environment: 'test', amountCents: 1000, currency: 'eur', metadata: { orderId, tenantId: tenant, orderNumber: '42' }, requestStartedAt: new Date('2030-01-01T11:55:00Z') } };
    await models.Order.collection.insertOne({ ...row, _id: new Types.ObjectId(orderId), number: 42 }); vi.clearAllMocks();
  });
  afterEach(() => vi.unstubAllEnvs());
  afterAll(async () => {
    await app?.close(); vi.restoreAllMocks();
    try { if (db) { try { if (db.name === new URL(mongo!).pathname.slice(1) && await db.db!.collection('_run').findOne({ runId })) await db.dropDatabase(); } finally { await db.close(); } } } finally { await f?.close(); }
  });
  async function get(auth = token, query = '') { const response = await fetch(`${origin}/loyalty/sales/${orderId}${query}`, { headers: { authorization: `Bearer ${auth}` } }); return { response, body: await response.json() }; }
  async function saveRow() { await models.Order.collection.replaceOne({ _id: new Types.ObjectId(orderId) }, { ...row, _id: new Types.ObjectId(orderId), number: 42 }); }
  function offeredCancellation() {
    const a = row.customerSaleAttribution!;
    if (a.decision !== 'attributed') throw new Error('Attributed fixture required');
    a.basis = { policyVersion: 'merchandise-net-v1', eligiblePurchaseCents: 0, excludedChargeCents: 0, chargedTotalCents: 0 };
    row.totals = { subtotal: 1000, discount: { amount: 1000 }, deliveryFee: 0, total: 0 };
    row.status = 'cancelled'; row.statusHistory = [{ status: 'cancelled', at: new Date('2030-01-01T12:00:00Z'), by: actorId }];
    row.payment = { method: 'online', status: 'paid', refundedCents: 0, pendingRefundCents: 0, refundSyncVersion: 0, refunds: [] };
    row.paymentFlow = { version: 1, origin: 'created_v1', phase: 'closed', attempt: null,
      close: { operationId: randomUUID(), destination: 'cancel_order', reason: 'Annulation avant retrait', requestedBy: actorId, requestedAt: new Date('2030-01-01T12:00:00Z') } };
    row.loyaltyReward = { version: 1, reservationId: randomUUID(), clientId: row.clientId, owner: a.owner,
      memberId: a.memberId, programId: a.programId, rulesVersion: a.rulesVersion, pricingHash: 'a'.repeat(64),
      benefit: { rewardId: randomUUID(), name: 'Récompense fixture', costUnits: 10, kind: 'fixed_discount', amountCents: 1000, productRef: null, policy: 'one-reward-no-promotion-v1' } };
    row.loyaltyRewardProcessing = { state: 'consumed', zeroPaid: true, orderVersion: row.__v };
  }
  async function financialState() {
    const tables = ['sale_settlements', 'sale_observations', 'sale_corrections', 'earn_receipts', 'ledger_entries', 'wallets', 'operations'] as const;
    const state: Record<string, unknown> = {};
    for (const table of tables) state[table] = (await f.admin.query(`SELECT to_jsonb(t) AS row FROM loyalty.${table} t WHERE tenant_ref=$1 ORDER BY to_jsonb(t)::text`, [tenant])).rows;
    return state;
  }
  async function post(body: unknown, auth = token) { const response = await fetch(`${origin}/loyalty/sales/${orderId}/resolution`, { method: 'POST', headers: { authorization: `Bearer ${auth}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); return { response, body: await response.json() }; }
  async function readyCase() {
    await f.service.settleHistoricalSale(loyaltyWebObservation(row));
    // A real pre-existing consumption leaves no balance for correction.
    const c = await f.app.connect(); try {
      await c.query('BEGIN'); await c.query("SELECT set_config('app.tenant_ref',$1,true)", [tenant]);
      const op = randomUUID(); await c.query("INSERT INTO loyalty.operations(tenant_ref,operation_id,kind,request_fingerprint,status,result,completed_at) VALUES($1,$2,'adjust',$3,'completed','{}',now())", [tenant, op, 'f'.repeat(64)]);
      const w = await c.query('UPDATE loyalty.wallets SET balance_units=0,lifetime_redeemed_units=10,version=version+1 WHERE tenant_ref=$1 RETURNING version', [tenant]);
      const a = row.customerSaleAttribution!; if (a.decision !== 'attributed') throw new Error('fixture');
      await c.query("INSERT INTO loyalty.ledger_entries(tenant_ref,member_id,program_id,operation_id,kind,delta_units,balance_after,source,rules_version,wallet_version,occurred_at) VALUES($1,$2,$3,$4,'redeem',-10,0,'admin',1,$5,now())", [tenant, a.memberId, a.programId, op, w.rows[0].version]);
      await c.query('COMMIT');
    } catch (error) { await c.query('ROLLBACK'); throw error; } finally { c.release(); }
    row.payment.refunds = [{ id: 're_fixture', amountCents: 500, status: 'succeeded' }]; row.payment.refundedCents = 500; row.payment.refundSyncVersion = 1; row.__v = 3;
    await models.Order.collection.updateOne({ _id: new Types.ObjectId(orderId) }, { $set: { payment: row.payment, __v: row.__v } });
    await f.service.settleHistoricalSale(loyaltyWebObservation(row)); return LoyaltySaleSettlementSchema.parse((await get()).body);
  }
  function body(view: Awaited<ReturnType<typeof readyCase>>, decision: 'retry' | 'waive_current' = 'waive_current'): LoyaltySaleResolutionRequest {
    return { operationId: randomUUID(), caseId: view.caseId!, expectedVersion: view.version!, decision, reason: 'Geste commercial confirmé', password };
  }
  it('GET is pure, private, bounded and available with the flag closed', async () => {
    vi.stubEnv('LOYALTY_WEB_SETTLEMENT_ENABLED', 'false'); const before = await f.admin.query('SELECT count(*) FROM loyalty.sale_settlements');
    const result = await get(); expect(result.response.status).toBe(200); expect(result.response.headers.get('cache-control')).toBe('private, no-store');
    expect(LoyaltySaleSettlementSchema.parse(result.body)).toMatchObject({ state: 'waiting', reason: 'not_observed', canResolve: false });
    expect((await f.admin.query('SELECT count(*) FROM loyalty.sale_settlements')).rows).toEqual(before.rows);
    expect(JSON.stringify(result.body)).not.toMatch(/accountId|memberId|parentRef|financialFingerprint|phone/);
    const invalid = await fetch(`${origin}/loyalty/sales?limit=31`, { headers: { authorization: `Bearer ${token}` } }); expect(invalid.status).toBe(400);
  });
  it('enforces tenant isolation and actual subscription before exposing receipts', async () => {
    expect((await get(foreign)).response.status).toBe(404);
    expect((await get(manager)).response.status).toBe(200);
    await models.Tenant.updateOne({ _id: tenant }, { $set: { standaloneLoyalty: false } }); expect((await get()).response.status).toBe(403);
  });
  it('presents a canonically cancelled offered sale without gain only to v2, before and after restitution, with no writes', async () => {
    offeredCancellation(); await saveRow();
    const settled = await f.service.settleHistoricalSale(loyaltyWebObservation(row));
    expect(settled).toMatchObject({ kind: 'pending', reason: 'payment_or_handoff_pending', receipt: { initialUnits: null, earnReceiptId: null, earnLedgerEntryId: null } });
    const before = await financialState(), beforeOrder = await models.Order.collection.findOne({ _id: new Types.ObjectId(orderId) });
    const old = await get(); expect(old.response.status).toBe(200);
    expect(LoyaltySaleSettlementSchema.parse(old.body)).toMatchObject({ state: 'waiting', reason: 'payment_or_handoff_pending', initialUnits: null });
    const modern = await get(token, '?presentationVersion=2');
    expect(modern.response.status).toBe(200); expect(modern.response.headers.get('cache-control')).toBe('private, no-store');
    expect(LoyaltySaleSettlementV2Schema.parse(modern.body)).toMatchObject({ state: 'not_earned', reason: 'cancelled_before_handoff', initialUnits: null,
      dueUnits: 0, retainedUnits: 0, canResolve: false, canAllocate: false, resolutions: [] });
    expect(LoyaltySaleSettlementSchema.safeParse(modern.body).success).toBe(false);
    for (const query of ['', '?presentationVersion=2']) {
      const list = await fetch(`${origin}/loyalty/sales${query}`, { headers: { authorization: `Bearer ${token}` } });
      const body = await list.json(); expect(list.status).toBe(200); expect(body.items).toEqual([query ? modern.body : old.body]);
    }
    expect((await get(manager, '?presentationVersion=2')).body).toEqual(modern.body);
    expect((await get(foreign, '?presentationVersion=2')).response.status).toBe(404);
    expect(await financialState()).toEqual(before); expect(await models.Order.collection.findOne({ _id: new Types.ObjectId(orderId) })).toEqual(beforeOrder);
    // Restitution changes its separate journal, not the absence of a gain.
    row.loyaltyRewardProcessing!.state = 'reversed'; row.__v!++; await saveRow();
    expect((await get(token, '?presentationVersion=2')).body).toEqual(modern.body);
    expect(await financialState()).toEqual(before); expect(rea.verify).not.toHaveBeenCalled();
  });
  it.each(['missing_reward', 'unknown_bank_attempt', 'pending_payment', 'legacy_total', 'unobserved', 'superseded', 'earned_zero'] as const)('does not close uncertain or already earned history: %s', async reason => {
    offeredCancellation();
    if (reason === 'earned_zero') {
      row.status = 'delivered'; row.statusHistory = [{ status: 'delivered', at: new Date('2030-01-01T12:00:00Z'), by: actorId }];
      row.paymentFlow!.phase = 'open'; row.paymentFlow!.close = null;
      expect(await f.service.settleHistoricalSale(loyaltyWebObservation(row))).toMatchObject({ kind: 'recorded', receipt: { initialUnits: 0 } });
      offeredCancellation();
    }
    if (reason !== 'unobserved') await f.service.settleHistoricalSale(loyaltyWebObservation(row));
    if (reason === 'missing_reward') row.loyaltyReward = null;
    if (reason === 'unknown_bank_attempt') row.paymentFlow!.attempt = { id: randomUUID(), environment: 'test', amountCents: 0, currency: 'eur', metadata: { orderId, tenantId: tenant, orderNumber: '42' } };
    if (reason === 'pending_payment') row.payment.status = 'pending';
    if (reason === 'legacy_total') row.totals = { subtotal: 1000, discount: null, deliveryFee: 0 } as typeof row.totals;
    if (reason === 'superseded') row.paymentFlow!.close!.operationId = randomUUID();
    await saveRow(); const before = await financialState();
    const read = await get(token, '?presentationVersion=2'); expect(read.response.status).toBe(200);
    expect(read.body.state).not.toBe('not_earned'); expect(read.body.reason).not.toBe('cancelled_before_handoff');
    expect(read.body.canResolve).toBe(false); expect(read.body.canAllocate).toBe(false);
    expect(await financialState()).toEqual(before);
  });
  it.each(['receipt', 'ledger'] as const)('keeps a pre-existing canonical legacy %s visible as a conflict', async history => {
    offeredCancellation(); const a = row.customerSaleAttribution!;
    if (a.decision !== 'attributed') throw new Error('Attributed fixture required');
    const c = await f.app.connect();
    try {
      await c.query('BEGIN'); await c.query("SELECT set_config('app.tenant_ref',$1,true)", [tenant]);
      const operation = randomUUID(), externalRef = `POS-ORDER:${row.clientId.toUpperCase()}`;
      await c.query("INSERT INTO loyalty.operations(tenant_ref,operation_id,kind,request_fingerprint,status,result,completed_at) VALUES($1,$2,'earn',$3,'completed','{}',now())", [tenant, operation, 'c'.repeat(64)]);
      if (history === 'receipt') await c.query("INSERT INTO loyalty.earn_receipts(tenant_ref,source,external_ref,operation_id,member_id) VALUES($1,'pos',$2,$3,$4)", [tenant, externalRef, operation, a.memberId]);
      else {
        const wallet = await c.query('UPDATE loyalty.wallets SET balance_units=1,lifetime_earned_units=1,version=version+1 WHERE tenant_ref=$1 RETURNING version', [tenant]);
        await c.query("INSERT INTO loyalty.ledger_entries(tenant_ref,member_id,program_id,operation_id,kind,delta_units,balance_after,source,external_ref,rules_version,wallet_version,occurred_at) VALUES($1,$2,$3,$4,'earn',1,1,'online',$5,1,$6,now())", [tenant, a.memberId, a.programId, operation, externalRef, wallet.rows[0].version]);
      }
      await c.query('COMMIT');
    } catch (error) { await c.query('ROLLBACK'); throw error; } finally { c.release(); }
    await saveRow();
    expect(await f.service.settleHistoricalSale(loyaltyWebObservation(row))).toMatchObject({ kind: 'pending', receipt: { initialUnits: null } });
    const before = await financialState();
    expect((await get(token, '?presentationVersion=2')).body).toMatchObject({ state: 'reconciliation', reason: 'canonical_sale_conflict', canResolve: false });
    expect((await get()).body).toMatchObject({ state: 'waiting', reason: 'payment_or_handoff_pending' });
    expect(await financialState()).toEqual(before);
  });
  it('rejects unsupported or repeated presentation versions on both read routes', async () => {
    for (const suffix of ['presentationVersion=1', 'presentationVersion=3', 'presentationVersion=', 'presentationVersion=2&presentationVersion=2']) {
      for (const path of [`/loyalty/sales?${suffix}`, `/loyalty/sales/${orderId}?${suffix}`]) {
        const response = await fetch(`${origin}${path}`, { headers: { authorization: `Bearer ${token}` } }); expect(response.status).toBe(400);
      }
    }
    expect(rea.verify).not.toHaveBeenCalled();
  });
  it('refuses manager decisions, invalid bodies and wrong passwords before writer effects', async () => {
    const view = await readyCase(), request = body(view);
    expect((await post(request, manager)).response.status).toBe(403);
    expect((await post({ ...request, dueUnits: 5 })).response.status).toBe(400);
    expect(rea.verify).not.toHaveBeenCalled();
    expect((await post({ ...request, password: 'wrong' })).response.status).toBe(401);
    expect((await get()).body.dueUnits).toBe(5);
  });
  it('records a scoped waiver once and rereads its exact historical receipt after another refund', async () => {
    const view = await readyCase(), request = body(view); const first = await post(request);
    expect(first.response.status).toBe(200); expect(first.body).toMatchObject({ waivedUnits: 5, dueUnits: 0 });
    const { password: _secret, ...expected } = request; expect(first.body.resolutions[0].request).toEqual(expected);
    row.payment.refunds![0]!.amountCents = 700; row.payment.refundedCents = 700; row.payment.refundSyncVersion = 2; row.__v = 4;
    await models.Order.collection.updateOne({ _id: new Types.ObjectId(orderId) }, { $set: { payment: row.payment, __v: row.__v } });
    await f.service.settleHistoricalSale(loyaltyWebObservation(row));
    const next = await get(); expect(next.body).toMatchObject({ waivedUnits: 5, dueUnits: 2 }); expect(next.body.resolutions[0].result).toMatchObject({ waivedUnits: 5, dueUnits: 0 });
    vi.stubEnv('LOYALTY_WEB_SETTLEMENT_ENABLED', 'false'); expect((await post(request)).response.status).toBe(200);
    expect((await get()).body).toMatchObject({ waivedUnits: 5, dueUnits: 2 });
    expect((await get(manager)).body.resolutions).toEqual([]);
  });
  it('recovers the exact receipt beyond the 128 most recent decisions without applying a future waiver', async () => {
    const view = await readyCase(), original = body(view); expect((await post(original)).response.status).toBe(200);
    row.payment.refunds![0]!.amountCents = 700; row.payment.refundedCents = 700; row.payment.refundSyncVersion = 2; row.__v = 4;
    await models.Order.collection.updateOne({ _id: new Types.ObjectId(orderId) }, { $set: { payment: row.payment, __v: row.__v } });
    await f.service.settleHistoricalSale(loyaltyWebObservation(row));
    const current = (await get()).body;
    for (let i = 0; i < 129; i++) await f.service.resolveHistoricalSale({ tenantRef: tenant, clientId: row.clientId, operationId: randomUUID(), caseId: current.caseId, expectedVersion: current.version, decision: 'retry', actorRef: actorId, reason: 'Nouvelle vérification' });
    expect((await get()).body.resolutions.some((receipt: { request: { operationId: string } }) => receipt.request.operationId === original.operationId)).toBe(false);
    const response = await fetch(`${origin}/loyalty/sales/${orderId}?resolutionId=${original.operationId}`, { headers: { authorization: `Bearer ${token}` } });
    const historical = await response.json(); expect(historical.resolutions).toHaveLength(1); expect(historical.resolutions[0].request.operationId).toBe(original.operationId);
    expect((await post(original)).body).toMatchObject({ waivedUnits: 5, dueUnits: 2 });
  });
  it('does not waive future corrections or a stale version, and keeps a failed retry receipt', async () => {
    const view = await readyCase(); const retry = body(view, 'retry'); expect((await post(retry)).response.status).toBe(200);
    const reread = await get(); expect(reread.body).toMatchObject({ dueUnits: 5, waivedUnits: 0 }); expect(reread.body.resolutions[0].request.decision).toBe('retry');
    expect((await post({ ...body(view), expectedVersion: view.version! + 1 })).response.status).toBe(409);
    vi.stubEnv('LOYALTY_WEB_SETTLEMENT_ENABLED', 'false'); expect((await post(body(view))).response.status).toBe(409);
    expect((await get()).body).toMatchObject({ dueUnits: 5, waivedUnits: 0 });
  });
});
