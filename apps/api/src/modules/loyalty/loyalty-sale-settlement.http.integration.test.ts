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
import { LoyaltySaleSettlementSchema, type JwtPayload, type LoyaltySaleResolutionRequest } from '@sm/contracts';
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
  async function get(auth = token) { const response = await fetch(`${origin}/loyalty/sales/${orderId}`, { headers: { authorization: `Bearer ${auth}` } }); return { response, body: await response.json() }; }
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
