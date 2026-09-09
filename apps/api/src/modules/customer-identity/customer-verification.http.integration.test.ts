import 'reflect-metadata';
import { randomBytes, randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { Module, type INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { getModelToken } from '@nestjs/mongoose';
import type { RequestHandler } from 'express';
import type { Pool } from 'pg';
import type { z } from 'zod';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { CUSTOMER_LOYALTY_NOTICE_VERSION, CustomerAccountResponses, CustomerAccountEnvelopes, type CustomerAccountAction, type CustomerAccountEnvelope,
  type CustomerProtectionRequest, type CustomerRecoveryRequest } from '@sm/contracts';
import { PostgresCustomerIdentityRepository } from '@sm/customer';
import { SharedPublicQuota } from '../../common/shared-public-quota';
import { CustomerAccountController } from './customer-account.controller';
import { CustomerAccountGuard } from './customer-account.guard';
import { CustomerAccountHumanVerifier } from './customer-account.human';
import { CUSTOMER_IDENTITY_REPOSITORY, CUSTOMER_VERIFICATION_TRANSPORT_FACTORY, CustomerAccountRuntime } from './customer-account.runtime';
import { customerTestEnvironment } from './customer-account.test-fixture';
import type { PhoneVerificationTransport } from './phone-verification.port';
import { customerPasskeyFixture } from './customer-passkey.test-fixture';
import { OnlineOrderCheckoutService } from '../orders/online-order-checkout.service';
import type { customerOrdersMongoFixture } from '../orders/customer-orders.test-fixture';
import { LoyaltyCryptoAdapter } from '@sm/loyalty';
import { CustomerLoyaltyService } from './customer-loyalty.service';

// Real signed HTTP -> Nest guard/controller/runtime/core -> migrated PostgreSQL
// under a NOSUPERUSER/NOBYPASSRLS role. Only tenant lookup, HTTP rate limiting,
// Turnstile and Verify are port fixtures. No browser/BFF cookie jar is claimed
// here: its independent native-browser suite covers cookie delivery/selection.
// Loss injection destroys the HTTP response only after the controller has the
// real committed result. It never fabricates a business or repository result.
const integration = process.env.CUSTOMER_TEST_DATABASE_URL ? describe : describe.skip;
type DatabaseFixture = { app: Pool; admin: Pool; role: string; close(): Promise<void> };
type Sign = (input: { key: Uint8Array; slug: string; action: string; origin: string; clientIp: string; body: string }) => Record<string, string>;
type Result<A extends CustomerAccountAction> = z.output<(typeof CustomerAccountResponses)[A]>;
const phones = ['+33612345678', '+33687654321'] as const;
const origin = 'https://fixture.example';
let database: DatabaseFixture;
let env: Record<string, string>;
const provider = {
  start: vi.fn<PhoneVerificationTransport['start']>(),
  check: vi.fn<PhoneVerificationTransport['check']>(),
};
const human = { verify: vi.fn().mockResolvedValue(true) };
const config = new ConfigService();
let commerceCheckout: OnlineOrderCheckoutService | undefined;
let loyaltyEnabled = false;
let tenantStatus = 'trial';
const loyaltyCrypto = new LoyaltyCryptoAdapter({ encryptionKeyBase64: Buffer.alloc(32, 17).toString('base64'),
  phoneLookupKeyBase64: Buffer.alloc(32, 43).toString('base64'), operationFingerprintKeyBase64: Buffer.alloc(32, 91).toString('base64'),
  qrTokenDerivationKeyBase64: Buffer.alloc(32, 127).toString('base64') });
const query = { read: () => query, readConcern: () => query, maxTimeMS: () => query, lean: () => query,
  exec: async () => ({ _id: env.SM_CUSTOMER_PILOT_TENANT_ID, slug: 'fixture', account: { status: tenantStatus },
    standaloneLoyalty: loyaltyEnabled, onlineOrdering: false, onlineDelivery: false, plan: null }) };

@Module({ controllers: [CustomerAccountController], providers: [CustomerAccountGuard, CustomerAccountRuntime,
  { provide: ConfigService, useValue: config },
  { provide: getModelToken('Tenant'), useValue: { findOne: () => query } },
  { provide: SharedPublicQuota, useValue: { reserve: async () => true } },
  { provide: CustomerAccountHumanVerifier, useValue: human },
  { provide: CUSTOMER_IDENTITY_REPOSITORY, useFactory: () => new PostgresCustomerIdentityRepository(database.app) },
  { provide: CUSTOMER_VERIFICATION_TRANSPORT_FACTORY, useValue: () => provider },
  { provide: CustomerLoyaltyService, useFactory: () => new CustomerLoyaltyService(database.app, loyaltyCrypto) },
  { provide: OnlineOrderCheckoutService, useValue: {
    createForCustomer: (...args: Parameters<OnlineOrderCheckoutService['createForCustomer']>) => commerceCheckout!.createForCustomer(...args),
    listForCustomer: (...args: Parameters<OnlineOrderCheckoutService['listForCustomer']>) => commerceCheckout!.listForCustomer(...args),
    detailForCustomer: (...args: Parameters<OnlineOrderCheckoutService['detailForCustomer']>) => commerceCheckout!.detailForCustomer(...args),
    reorderForCustomer: (...args: Parameters<OnlineOrderCheckoutService['reorderForCustomer']>) => commerceCheckout!.reorderForCustomer(...args),
  } },
] })
class VerificationHttpModule {}

function barrier<T>() {
  let release!: (value: T) => void;
  const promise = new Promise<T>(resolve => { release = resolve; });
  return { promise, release };
}

integration('customer verification — real Nest HTTP and PostgreSQL, simulated provider', () => {
  let app: INestApplication | undefined;
  let base: string;
  let sign: Sign;
  let dropAction: CustomerAccountAction | null = null;
  let closed = false;
  let keys: Awaited<ReturnType<typeof customerPasskeyFixture>> | undefined;
  async function close() {
    if (closed) return;
    closed = true;
    try { await keys?.close(); } finally { try { await app?.close(); } finally { await database?.close(); } }
  }
  beforeAll(async () => {
    // Reuse the guarded UUID database/role fixture; no application DB can be a
    // target. Dynamic imports keep test-only sources out of API build inputs.
    const fixturePath = resolve(process.cwd(), '../../packages/customer/src/test-fixture.ts');
    const fixture = await import(/* @vite-ignore */ fixturePath) as { customerTestFixture(raw: unknown): Promise<DatabaseFixture> };
    database = await fixture.customerTestFixture(process.env.CUSTOMER_TEST_DATABASE_URL);
    try {
      if (!/^customer_test_[a-f0-9]{32}$/.test(database.role)) throw new Error('Disposable customer role required');
      await database.admin.query(`GRANT USAGE ON SCHEMA loyalty TO "${database.role}";
        GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA loyalty TO "${database.role}"`);
      const webPath = resolve(process.cwd(), '../web/src/app/r/[slug]/compte/customer-relay.ts');
      sign = (await import(/* @vite-ignore */ webPath) as { customerRelayHeaders: Sign }).customerRelayHeaders;
      vi.spyOn(config, 'get').mockImplementation(name => env[String(name)]);
      app = await NestFactory.create(VerificationHttpModule, { logger: false, rawBody: true });
      const loseCommittedResponse: RequestHandler = (request, response, next) => {
        const json = response.json.bind(response);
        response.json = body => {
          if (dropAction && request.path === `/public/customer/fixture/${dropAction}` && response.statusCode === 200) {
            dropAction = null; response.destroy(); return response;
          }
          return json(body);
        };
        next();
      };
      app.use(loseCommittedResponse);
      await app.listen(0, '127.0.0.1'); base = await app.getUrl();
    } catch (error) { await close(); throw error; }
  }, 20_000);
  afterAll(close);
  beforeEach(async () => {
    dropAction = null;
    commerceCheckout = undefined;
    loyaltyEnabled = false;
    tenantStatus = 'trial';
    env = customerTestEnvironment();
    const parent = `AC${randomUUID().replaceAll('-', '')}`, tenant = randomBytes(12).toString('hex');
    env.SM_CUSTOMER_VERIFY_ACCOUNT_SID = parent; env.SM_CUSTOMER_PILOT_TENANT_ID = tenant;
    for (const key of ['SM_CUSTOMER_VERIFY_POLICY', 'SM_CUSTOMER_VERIFY_EVIDENCE']) {
      const value = JSON.parse(env[key]!); value.accountSid = parent;
      if (key.endsWith('POLICY')) { value.tenantRef = tenant; value.allowedPhones = [...phones]; }
      else value.verifiedPhones = [...phones];
      env[key] = JSON.stringify(value);
    }
    human.verify.mockReset().mockResolvedValue(true);
    provider.start.mockReset().mockImplementation(async () => ({ verificationSid: `VE${randomUUID().replaceAll('-', '')}` }));
    provider.check.mockReset().mockResolvedValue('approved');
    await keys?.close(); keys = await customerPasskeyFixture(origin);
  });
  async function http<A extends CustomerAccountAction>(action: A, envelope: CustomerAccountEnvelope<A>) {
    const body = JSON.stringify(envelope);
    return fetch(`${base}/public/customer/fixture/${action}`, { method: 'POST', body, signal: AbortSignal.timeout(3_000),
      headers: { 'content-type': 'application/json', ...sign({ key: Buffer.from(env.SM_CUSTOMER_RELAY_SIGNING_KEY!, 'base64'),
        slug: 'fixture', action, origin, clientIp: '192.0.2.20', body }) } });
  }
  async function ok<A extends CustomerAccountAction>(action: A, envelope: CustomerAccountEnvelope<A>): Promise<Result<A>> {
    const response = await http(action, envelope);
    expect(response.status).toBe(action === 'logout' ? 204 : 200);
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(response.headers.get('set-cookie')).toBeNull();
    return CustomerAccountResponses[action].parse(action === 'logout' ? undefined : await response.json()) as Result<A>;
  }
  async function browser() {
    const browserRef = randomUUID(), browserSecret = randomBytes(32).toString('base64url');
    await ok('browser', { request: { step: 'prepare', browserRef }, browserSecret: null, candidateSecret: null });
    const issued = await ok('browser', { request: { step: 'issue', browserRef }, browserSecret: null, candidateSecret: browserSecret });
    expect(issued.emitCookie).toBe(true);
    await ok('browser', { request: { step: 'confirm', browserRef }, browserSecret, candidateSecret: null });
    return { browserRef, browserSecret };
  }
  async function intent(binding: Awaited<ReturnType<typeof browser>>) {
    const operationId = randomUUID(), intentProof = randomBytes(32).toString('base64url');
    const prepared = await ok('intent', { ...binding, candidateProof: intentProof, request: { step: 'prepare', operationId } });
    expect(prepared.intent.state).toBe('open'); expect(prepared.emitCookie).toBe(true);
    const privateBinding = { ...binding, intentProof };
    return { operationId, privateBinding,
      publication: (checkId: string) => ({ expectedOperationId: operationId, expectedCheckId: checkId }),
      start: (phone: string = phones[0]) => ({ ...privateBinding, request: { phone, operationId, turnstileToken: 'fixture-human' } }),
      check: (challengeId: string, checkId = randomUUID()) => ({ ...privateBinding, sessionToken: null,
        request: { operationId, challengeId, checkId, code: '123456' } }),
      result: (checkId: string | null) => ({ ...privateBinding, request: { operationId, checkId } }),
      close: () => ok('intent', { ...binding, candidateProof: null, request: { step: 'close', operationId } }),
    };
  }
  async function counts() {
    return (await database.admin.query(`SELECT
      (SELECT count(*)::int FROM customer.reservations WHERE tenant_ref=$1) AS sends,
      (SELECT count(*)::int FROM customer.accounts WHERE tenant_ref=$1) AS accounts,
      (SELECT count(*)::int FROM customer.sessions WHERE tenant_ref=$1) AS sessions,
      (SELECT count(*)::int FROM customer.check_attempts WHERE tenant_ref=$1) AS checks`, [env.SM_CUSTOMER_PILOT_TENANT_ID])).rows[0];
  }

  async function prepareProtection(f: Awaited<ReturnType<typeof intent>>, checkId: string) {
    const selected = { operationId: f.operationId, checkId };
    const call = (request: CustomerProtectionRequest) => ok('protection', { ...f.privateBinding, request });
    const registrationId = randomUUID(), assertionId = randomUUID(), activationId = randomUUID();
    const registration = await call({ ...selected, step: 'registration-options', registrationId });
    if (registration.state !== 'registration-options') throw new Error('Expected options');
    const credential = await keys!.register(registration.options);
    const registered = await call({ ...selected, step: 'register', registrationId, response: credential });
    expect(registered.state).toBe('enrollment');
    const assertion = await call({ ...selected, step: 'assertion-options', assertionId });
    if (assertion.state !== 'assertion-options') throw new Error('Expected assertion');
    await call({ ...selected, step: 'assert', assertionId, response: await keys!.authenticate(assertion.options) });
    const recovery = await call({ ...selected, step: 'recovery-code', rotationId: randomUUID(), expectedVersion: 0 });
    if (recovery.state !== 'recovery-code' || !recovery.code) throw new Error('Expected recovery display');
    const envelope = { ...f.privateBinding, request: { ...selected, step: 'activate' as const,
      activationId, recoveryVersion: recovery.enrollment.recoveryVersion, code: recovery.code } };
    const resultEnvelope = { ...f.privateBinding, request: { ...selected, step: 'activation-result' as const, activationId } };
    return { envelope, resultEnvelope, activationId, credentialId: credential.id, code: recovery.code, publication: f.publication(activationId),
      activate: async () => { const result = await ok('protection', envelope);
        if (result.state !== 'authenticated') throw new Error('Expected activation'); return result; },
      recover: async () => { const result = await ok('protection', resultEnvelope);
        if (result.state !== 'authenticated') throw new Error('Expected activation receipt'); return result; } };
  }

  async function protectedAccount(phone: string = phones[0]) {
    const binding = await browser(), f = await intent(binding), pending = await ok('start', f.start(phone));
    const check = f.check(pending.challengeId); expect((await ok('check', check)).state).toBe('enrollment');
    const protection = await prepareProtection(f, check.request.checkId), activated = await protection.activate();
    return { binding, f, protection, activated };
  }
  async function loyaltyProgram() {
    const id = randomUUID(), tenantRef = env.SM_CUSTOMER_PILOT_TENANT_ID!;
    const client = await database.admin.connect();
    try {
      await client.query('BEGIN');
      await client.query("INSERT INTO loyalty.programs(id,tenant_ref,status) VALUES($1,$2,'active')", [id, tenantRef]);
      await client.query(`INSERT INTO loyalty.program_versions(tenant_ref,program_id,version,name,mechanism,
        spend_step_cents,units_per_step,unit_label_singular,unit_label_plural,terms_summary)
        VALUES($1,$2,1,'Programme de recette','points',100,1,'point','points','Un point par euro éligible.')`, [tenantRef, id]);
      await client.query('COMMIT');
    } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
    return id;
  }

  it('creates one account-owned loyalty card through signed HTTP, recovers response loss and survives passkey reconnection without SMS', async () => {
    const a = await protectedAccount(); const programId = await loyaltyProgram();
    const access = { ...a.binding, ...a.protection.publication, sessionToken: a.activated.token };
    expect((await ok('loyalty', { ...access, request: { step: 'view' } })).state).toBe('unavailable');
    // Standalone loyalty works without any ordering/delivery subscription.
    loyaltyEnabled = true;
    expect(await ok('loyalty', { ...access, request: { step: 'view' } })).toMatchObject({ state: 'available', profileReady: false });
    await ok('name', { ...access, request: { name: 'Mina', expectedRevision: 0 } });
    const visible = await ok('loyalty', { ...access, request: { step: 'view' } });
    expect(visible).toMatchObject({ state: 'available', profileReady: true, program: { id: programId, version: 1 } });
    const request = { step: 'join' as const, operationId: randomUUID(), programId, rulesVersion: 1,
      termsNoticeVersion: CUSTOMER_LOYALTY_NOTICE_VERSION, termsAccepted: true } as const;
    delete env.SM_CUSTOMER_VERIFY_POLICY; delete env.SM_CUSTOMER_VERIFY_EVIDENCE; delete env.SM_CUSTOMER_VERIFY_API_KEY_SECRET;
    provider.start.mockClear(); provider.check.mockClear(); human.verify.mockClear();
    dropAction = 'loyalty'; await expect(http('loyalty', { ...access, request })).rejects.toBeDefined();
    expect(dropAction).toBeNull();
    const recovered = await ok('loyalty', { ...access, request: { step: 'view' } });
    if (recovered.state !== 'member') throw new Error('Expected durable membership');
    expect(recovered.member.balanceUnits).toBe(0); expect(recovered).not.toHaveProperty('qrToken');
    expect(await ok('loyalty', { ...access, request })).toEqual(recovered);
    await ok('name', { ...access, request: { name: 'Mina D.', expectedRevision: 1 } });
    expect(await ok('loyalty', { ...access, request })).toEqual(recovered);
    expect(await ok('loyalty', { ...access, request: { ...request, operationId: randomUUID() } })).toEqual(recovered);
    const card = await ok('loyalty', { ...access, request: { step: 'card' } });
    if (card.state !== 'card') throw new Error('Expected protected QR');
    const counts = (await database.admin.query(`SELECT
      (SELECT count(*)::int FROM customer.loyalty_memberships WHERE tenant_ref=$1) AS links,
      (SELECT count(*)::int FROM loyalty.members WHERE tenant_ref=$1 AND enrollment_handoff_at=joined_at) AS handed,
      (SELECT count(*)::int FROM loyalty.membership_events WHERE tenant_ref=$1 AND kind='joined') AS joined,
      (SELECT count(*)::int FROM loyalty.ledger_entries WHERE tenant_ref=$1) AS gains,
      (SELECT count(*)::int FROM loyalty.consent_events WHERE tenant_ref=$1) AS marketing`, [env.SM_CUSTOMER_PILOT_TENANT_ID])).rows[0];
    expect(counts).toEqual({ links: 1, handed: 1, joined: 1, gains: 0, marketing: 0 });
    await ok('logout', { ...access, request: { all: true } });
    for (const step of ['view', 'card'] as const) {
      const denied = await http('loyalty', { ...access, request: { step } });
      expect(denied.status).toBe(401); const body = await denied.text();
      expect(body).not.toContain(card.qrToken); expect(body).not.toContain(card.member.id);
    }
    const login = await passkeyAttempt(a.binding, a.protection.credentialId);
    const logged = await ok('passkey', login.assertion);
    if (logged.state !== 'authenticated') throw new Error('Expected protected reconnection');
    expect(await ok('loyalty', { ...a.binding, ...login.publication, sessionToken: logged.token, request: { step: 'card' } }))
      .toMatchObject({ state: 'card', member: card.member, qrToken: card.qrToken });
    expect(provider.start).not.toHaveBeenCalled(); expect(provider.check).not.toHaveBeenCalled(); expect(human.verify).not.toHaveBeenCalled();
  }, 30_000);

  it('does not publish a real card after logout between service completion and the final HTTP fence', async () => {
    const a = await protectedAccount(); const programId = await loyaltyProgram(); loyaltyEnabled = true;
    const access = { ...a.binding, ...a.protection.publication, sessionToken: a.activated.token };
    await ok('name', { ...access, request: { name: 'Mina', expectedRevision: 0 } });
    await ok('loyalty', { ...access, request: { step: 'join', operationId: randomUUID(), programId, rulesVersion: 1,
      termsNoticeVersion: CUSTOMER_LOYALTY_NOTICE_VERSION, termsAccepted: true } });
    const service = app!.get(CustomerLoyaltyService); const execute = service.execute.bind(service);
    const read = vi.spyOn(service, 'execute').mockImplementationOnce(async input => {
      const result = await execute(input); expect(result.state).toBe('card');
      await ok('logout', { ...access, request: { all: true } }); return result;
    });
    try {
      const response = await http('loyalty', { ...access, request: { step: 'card' } });
      expect(response.status).toBe(401); expect(await response.text()).not.toMatch(/qrToken|balanceUnits|member/);
      expect(response.headers.get('cache-control')).toContain('no-store'); expect(read).toHaveBeenCalledTimes(1);
    } finally { read.mockRestore(); }
  }, 30_000);
  it('refuses the current QR when the tenant churns just before the final publication fence', async () => {
    const a = await protectedAccount(); const programId = await loyaltyProgram(); loyaltyEnabled = true;
    const access = { ...a.binding, ...a.protection.publication, sessionToken: a.activated.token };
    await ok('name', { ...access, request: { name: 'Mina', expectedRevision: 0 } });
    await ok('loyalty', { ...access, request: { step: 'join', operationId: randomUUID(), programId, rulesVersion: 1,
      termsNoticeVersion: CUSTOMER_LOYALTY_NOTICE_VERSION, termsAccepted: true } });
    const service = app!.get(CustomerLoyaltyService); const execute = service.execute.bind(service);
    let reachedFence = false;
    const read = vi.spyOn(service, 'execute').mockImplementationOnce(input => execute({ ...input,
      publicationFence: fence => input.publicationFence(async () => {
        reachedFence = true; tenantStatus = 'churned'; await fence();
      }),
    }));
    try {
      const response = await http('loyalty', { ...access, request: { step: 'card' } });
      expect(reachedFence).toBe(true); expect(response.status).toBe(503);
      expect(await response.text()).not.toMatch(/qrToken|balanceUnits|member/);
      expect(response.headers.get('cache-control')).toContain('no-store');
    } finally { read.mockRestore(); }
  }, 30_000);
  async function commerceFixture() {
    const fixturePath = resolve(process.cwd(), 'src/modules/orders/customer-orders.test-fixture.ts');
    const fixture = await import(/* @vite-ignore */ fixturePath) as { customerOrdersMongoFixture: typeof customerOrdersMongoFixture };
    // A real future half-hour slot, without faking PostgreSQL or WebAuthn time.
    const slot = new Date(Math.ceil((Date.now() + 90 * 60_000) / 1_800_000) * 1_800_000).toISOString();
    const mongo = await fixture.customerOrdersMongoFixture(process.env.CUSTOMER_ORDERS_TEST_MONGO_URL!, {
      tenantId: env.SM_CUSTOMER_PILOT_TENANT_ID!, slot,
    });
    try {
      await mongo.models.tenants.updateOne({ slug: 'isolated-capacity' }, { $set: { slug: 'fixture' } });
      const replica = mongo.replica(); commerceCheckout = replica.checkout;
      return { ...mongo, replica };
    } catch (error) { await mongo.close(); throw error; }
  }
  function access(a: Awaited<ReturnType<typeof protectedAccount>>) {
    return { ...a.binding, ...a.protection.publication, sessionToken: a.activated.token };
  }

  it.skipIf(!process.env.CUSTOMER_ORDERS_TEST_MONGO_URL)('owns a real Mongo order after a lost signed HTTP result, replays once, and isolates history without SMS', async () => {
    const a = await protectedAccount(), b = await protectedAccount(phones[1]);
    const mongo = await commerceFixture();
    try {
      delete env.SM_CUSTOMER_VERIFY_POLICY; delete env.SM_CUSTOMER_VERIFY_EVIDENCE; delete env.SM_CUSTOMER_VERIFY_API_KEY_SECRET;
      provider.start.mockClear(); provider.check.mockClear(); human.verify.mockClear();
      const request = mongo.request();
      dropAction = 'order-create';
      await expect(http('order-create', { ...access(a), request })).rejects.toBeDefined();
      expect(dropAction).toBeNull();
      const created = await ok('order-create', { ...access(a), request });
      if (created.state !== 'created') throw new Error('Expected real creation');
      expect(created.order).toMatchObject({ totals: { total: 1250 }, payment: { method: 'counter', status: 'pending' } });
      expect(await mongo.models.orders.countDocuments()).toBe(1);
      expect(await mongo.models.admissions.countDocuments({ 'capacity.kitchenSeat': { $type: 'number' } })).toBe(1);
      expect(mongo.replica.gate.authorize).toHaveBeenCalledTimes(1);
      const list = await ok('orders', { ...access(a), request: { filter: 'active', limit: 20, cursor: null } });
      expect(list.orders.map(row => row._id)).toEqual([created.order._id]);
      const detail = await ok('order-detail', { ...access(a), request: { orderId: created.order._id } });
      expect(detail.order).toMatchObject({ totals: { total: 1250 }, lines: [{ name: 'Article de recette', qty: 1, unitPrice: 1250 }] });
      const reorder = await ok('order-reorder', { ...access(a), request: { orderId: created.order._id } });
      expect(reorder).toEqual({ expiresAt: a.activated.view.expiresAt, orderId: created.order._id, number: created.order.number,
        lines: [{ productId: request.lines[0]!.productId, name: 'Article de recette', variantKey: null, variantName: null,
          qty: 1, unitPrice: 1250, options: [], removed: [] }] });
      expect(JSON.stringify(reorder)).not.toMatch(/note|payment|pickup|delivery|image|lineTotal/);
      const privateJson = JSON.stringify({ list, detail, reorder });
      for (const forbidden of ['customerOwner', 'accountId', 'trackingToken', 'customerPhone', 'customerName', 'address', 'sessionToken']) {
        expect(privateJson).not.toContain(`"${forbidden}"`);
      }
      expect(privateJson).not.toContain(created.order.trackingToken);
      for (const field of ['browserRef', 'browserSecret', 'sessionToken', 'expectedOperationId', 'expectedCheckId'] as const) {
        const value = field.endsWith('Id') || field === 'browserRef' ? randomUUID() : randomBytes(32).toString('base64url');
        const denied = await http('order-reorder', { ...access(a), [field]: value, request: { orderId: created.order._id } });
        expect(denied.status).toBe(401); expect(await denied.text()).not.toContain('Article de recette');
      }
      expect((await ok('orders', { ...access(b), request: { filter: 'all', limit: 20, cursor: null } })).orders).toEqual([]);
      expect((await http('order-detail', { ...access(b), request: { orderId: created.order._id } })).status).toBe(404);
      expect((await http('order-reorder', { ...access(b), request: { orderId: created.order._id } })).status).toBe(404);
      expect((await http('order-create', { ...access(b), request })).status).toBe(404);
      expect(await mongo.models.orders.countDocuments()).toBe(1);
      await ok('logout', { ...access(a), request: { all: true } });
      expect((await http('orders', { ...access(a), request: { filter: 'all', limit: 20, cursor: null } })).status).toBe(401);
      expect((await http('order-detail', { ...access(a), request: { orderId: created.order._id } })).status).toBe(401);
      expect((await http('order-reorder', { ...access(a), request: { orderId: created.order._id } })).status).toBe(401);
      expect(provider.start).not.toHaveBeenCalled(); expect(provider.check).not.toHaveBeenCalled(); expect(human.verify).not.toHaveBeenCalled();
    } finally { commerceCheckout = undefined; await mongo.close(); }
  }, 30_000);

  it.skipIf(!process.env.CUSTOMER_ORDERS_TEST_MONGO_URL)('drops a real Mongo reorder response after a real PG logout, without another order or provider call', async () => {
    const a = await protectedAccount(); const mongo = await commerceFixture();
    try {
      const created = await ok('order-create', { ...access(a), request: mongo.request() });
      if (created.state !== 'created') throw new Error('Expected real creation');
      provider.start.mockClear(); provider.check.mockClear(); human.verify.mockClear();
      delete env.SM_CUSTOMER_VERIFY_POLICY; delete env.SM_CUSTOMER_VERIFY_EVIDENCE; delete env.SM_CUSTOMER_VERIFY_API_KEY_SECRET;
      const read = mongo.replica.checkout.reorderForCustomer.bind(mongo.replica.checkout);
      const selected = vi.spyOn(mongo.replica.checkout, 'reorderForCustomer').mockImplementationOnce(async (...args) => {
        const result = await read(...args);
        expect(result.lines).toHaveLength(1);
        await ok('logout', { ...access(a), request: { all: true } });
        return result;
      });
      const response = await http('order-reorder', { ...access(a), request: { orderId: created.order._id } });
      expect(response.status).toBe(401);
      expect(response.headers.get('cache-control')).toBe('no-store, private');
      expect(response.headers.get('set-cookie')).toBeNull();
      const body = await response.text();
      expect(body).not.toMatch(/Article de recette|productId|lines|trackingToken/); expect(body).not.toContain(created.order._id);
      expect(selected).toHaveBeenCalledTimes(1);
      expect(await mongo.models.orders.countDocuments()).toBe(1);
      expect(await mongo.models.admissions.countDocuments({ 'capacity.kitchenSeat': { $type: 'number' } })).toBe(1);
      expect(provider.start).not.toHaveBeenCalled(); expect(provider.check).not.toHaveBeenCalled(); expect(human.verify).not.toHaveBeenCalled();
    } finally { commerceCheckout = undefined; await mongo.close(); }
  }, 30_000);

  it.skipIf(!process.env.CUSTOMER_ORDERS_TEST_MONGO_URL)('a real PG logout during checkout prevents Mongo commitment without transferring its admission', async () => {
    const a = await protectedAccount(); const mongo = await commerceFixture();
    try {
      mongo.replica.gate.authorize.mockImplementationOnce(async () => {
        await ok('logout', { ...access(a), request: { all: true } });
        return { provider: 'turnstile', quotaReservation: { tenantId: env.SM_CUSTOMER_PILOT_TENANT_ID!, id: 'fixture' } };
      });
      expect((await http('order-create', { ...access(a), request: mongo.request() })).status).toBe(401);
      expect(await mongo.models.orders.countDocuments()).toBe(0);
      const admission = await mongo.models.admissions.findOne().select('+customerOwner +snapshot').lean();
      const owner = (await database.admin.query('SELECT id FROM customer.accounts WHERE parent_ref=$1 AND tenant_ref=$2',
        [env.SM_CUSTOMER_VERIFY_ACCOUNT_SID, env.SM_CUSTOMER_PILOT_TENANT_ID])).rows[0];
      expect(admission).toMatchObject({ state: 'rejected', snapshot: null, customerOwner: {
        accountId: owner.id, parentRef: env.SM_CUSTOMER_VERIFY_ACCOUNT_SID, tenantRef: env.SM_CUSTOMER_PILOT_TENANT_ID,
      } });
      expect(admission?.capacity).toBeUndefined();
      expect(mongo.replica.gate.release).toHaveBeenCalledTimes(1);
    } finally { commerceCheckout = undefined; await mongo.close(); }
  }, 30_000);

  it.skipIf(!process.env.CUSTOMER_ORDERS_TEST_MONGO_URL)('a protected HTTP session cannot adopt an existing guest order even with its exact recovery proof', async () => {
    const a = await protectedAccount(); const mongo = await commerceFixture();
    try {
      const request = mongo.request(); await mongo.replica.checkout.createPublic('fixture', request);
      expect((await http('order-create', { ...access(a), request })).status).toBe(404);
      expect((await ok('orders', { ...access(a), request: { filter: 'all', limit: 20, cursor: null } })).orders).toEqual([]);
      expect(await mongo.models.orders.countDocuments()).toBe(1);
      expect(await mongo.models.orders.countDocuments({ customerOwner: null })).toBe(1);
    } finally { commerceCheckout = undefined; await mongo.close(); }
  }, 30_000);
  async function passkeyAttempt(binding: Awaited<ReturnType<typeof browser>>, chosenCredentialId?: string) {
    const f = await intent(binding), attemptId = randomUUID();
    const optionsEnvelope = { ...f.privateBinding, request: { step: 'options' as const, operationId: f.operationId, attemptId } };
    const options = await ok('passkey', optionsEnvelope);
    if (options.state !== 'options') throw new Error('Expected discoverable options');
    expect(options.options.allowCredentials).toEqual([]);
    const response = await keys!.authenticate(options.options, chosenCredentialId);
    const assertion = CustomerAccountEnvelopes.passkey.parse({ ...f.privateBinding,
      request: { step: 'assert', operationId: f.operationId, attemptId, response } });
    const result = { ...f.privateBinding, request: { step: 'result' as const, operationId: f.operationId, attemptId } };
    return { f, attemptId, optionsEnvelope, assertion, result, publication: f.publication(attemptId) };
  }
  async function prepareRecovery(f: Awaited<ReturnType<typeof intent>>, attemptId: string) {
    const selected = { operationId: f.operationId, attemptId };
    const call = (request: CustomerRecoveryRequest) => ok('recovery', { ...f.privateBinding, request });
    const registrationId = randomUUID(), assertionId = randomUUID(), activationId = randomUUID();
    const options = await call({ ...selected, step: 'registration-options', registrationId });
    if (options.state !== 'registration-options') throw new Error('Expected replacement key options');
    const credential = await keys!.register(options.options);
    expect((await call({ ...selected, step: 'register', registrationId, response: credential })).state).toBe('recovery');
    const assertion = await call({ ...selected, step: 'assertion-options', assertionId });
    if (assertion.state !== 'assertion-options') throw new Error('Expected replacement assertion');
    expect((await call({ ...selected, step: 'assert', assertionId, response: await keys!.authenticate(assertion.options) })).state).toBe('recovery');
    const code = await call({ ...selected, step: 'recovery-code', rotationId: randomUUID(), expectedVersion: 0 });
    if (code.state !== 'recovery-code' || !code.code) throw new Error('Expected replacement code');
    return { credentialId: credential.id, code: code.code, publication: f.publication(activationId),
      activate: { ...f.privateBinding, request: { ...selected, step: 'activate' as const, activationId, recoveryVersion: 1, code: code.code } },
      result: { ...f.privateBinding, request: { ...selected, step: 'activation-result' as const, activationId } } };
  }

  it('logs in with the native saved key after logout and recovers lost HTTP publication without any SMS funding', async () => {
    const a = await protectedAccount();
    await ok('name', { ...a.binding, ...a.protection.publication, sessionToken: a.activated.token,
      request: { name: 'Mina', expectedRevision: 0 } });
    await ok('logout', { ...a.binding, ...a.protection.publication, sessionToken: a.activated.token, request: { all: false } });
    delete env.SM_CUSTOMER_VERIFY_POLICY; delete env.SM_CUSTOMER_VERIFY_EVIDENCE; delete env.SM_CUSTOMER_VERIFY_API_KEY_SECRET;
    provider.start.mockClear(); provider.check.mockClear(); human.verify.mockClear();
    const login = await passkeyAttempt(a.binding, a.protection.credentialId);
    dropAction = 'passkey'; await expect(http('passkey', login.assertion)).rejects.toBeDefined();
    expect(dropAction).toBeNull();
    const recovered = await ok('passkey', login.result);
    if (recovered.state !== 'authenticated') throw new Error('Expected passkey session');
    expect(await ok('passkey', login.result)).toEqual(recovered);
    expect(recovered.view.profile).toMatchObject({ name: 'Mina', phoneE164: phones[0], revision: 1 });
    expect(await ok('session', { ...a.binding, ...login.publication, sessionToken: recovered.token, request: {} })).toEqual(recovered.view);
    expect(await counts()).toEqual({ sends: 1, accounts: 1, sessions: 2, checks: 1 });
    expect(provider.start).not.toHaveBeenCalled(); expect(provider.check).not.toHaveBeenCalled(); expect(human.verify).not.toHaveBeenCalled();
    await ok('logout', { ...a.binding, ...login.publication, sessionToken: recovered.token, request: { all: true } });
    // The public receipt may report a terminal failure; it must never contain
    // a token/profile or make the revoked private publication usable again.
    expect((await ok('passkey', login.result))).toEqual({ state: 'failed', operationId: login.f.operationId,
      attemptId: login.attemptId, expiresAt: expect.any(Number) });
    expect((await http('session', { ...a.binding, ...login.publication, sessionToken: recovered.token, request: {} })).status).toBe(401);
  });

  it('consumes an invalid native assertion attempt without a session and never replays a new signature under that attempt', async () => {
    const a = await protectedAccount(), login = await passkeyAttempt(await browser(), a.protection.credentialId);
    if (login.assertion.request.step !== 'assert') throw new Error('Expected assertion command');
    const signature = Buffer.from(login.assertion.request.response.response.signature, 'base64url'); signature[0] = signature[0]! ^ 1;
    const invalid = { ...login.assertion, request: { ...login.assertion.request, response: { ...login.assertion.request.response,
      response: { ...login.assertion.request.response.response, signature: signature.toString('base64url') } } } };
    expect((await ok('passkey', invalid)).state).toBe('failed');
    expect((await ok('passkey', login.result)).state).toBe('failed');
    expect((await ok('passkey', login.assertion)).state).toBe('failed');
    expect(await counts()).toEqual({ sends: 1, accounts: 1, sessions: 1, checks: 1 });
    expect(await ok('session', { ...a.binding, ...a.protection.publication, sessionToken: a.activated.token, request: {} })).toEqual(a.activated.view);
  });

  it('keeps the original recovery code usable after abandonment, then atomically replaces key/code and revokes every old session', async () => {
    const a = await protectedAccount();
    delete env.SM_CUSTOMER_VERIFY_POLICY; delete env.SM_CUSTOMER_VERIFY_EVIDENCE; delete env.SM_CUSTOMER_VERIFY_API_KEY_SECRET;
    const b = await intent(await browser()), firstId = randomUUID();
    const first = await ok('recovery', { ...b.privateBinding, request: { step: 'begin', operationId: b.operationId,
      attemptId: firstId, code: a.protection.code } });
    expect(first.state).toBe('recovery'); expect(first).not.toHaveProperty('view'); expect(first).not.toHaveProperty('token');
    await b.close();
    const c = await intent(await browser()), attemptId = randomUUID();
    expect((await ok('recovery', { ...c.privateBinding, request: { step: 'begin', operationId: c.operationId, attemptId, code: a.protection.code } })).state).toBe('recovery');
    const replacement = await prepareRecovery(c, attemptId);
    expect(await counts()).toEqual({ sends: 1, accounts: 1, sessions: 1, checks: 1 });
    expect(await ok('session', { ...a.binding, ...a.protection.publication, sessionToken: a.activated.token, request: {} })).toEqual(a.activated.view);
    dropAction = 'recovery'; await expect(http('recovery', replacement.activate)).rejects.toBeDefined(); expect(dropAction).toBeNull();
    const recovered = await ok('recovery', replacement.result);
    if (recovered.state !== 'authenticated') throw new Error('Expected recovered session');
    expect(await ok('recovery', replacement.result)).toEqual(recovered);
    expect((await http('session', { ...a.binding, ...a.protection.publication, sessionToken: a.activated.token, request: {} })).status).toBe(401);
    const oldKey = await passkeyAttempt(await browser(), a.protection.credentialId);
    expect((await ok('passkey', oldKey.assertion)).state).toBe('failed');
    const newKey = await passkeyAttempt(await browser(), replacement.credentialId);
    expect((await ok('passkey', newKey.assertion)).state).toBe('authenticated');
    const d = await intent(await browser());
    expect((await ok('recovery', { ...d.privateBinding, request: { step: 'begin', operationId: d.operationId,
      attemptId: randomUUID(), code: a.protection.code } })).state).toBe('failed');
    expect((await ok('recovery', { ...d.privateBinding, request: { step: 'begin', operationId: d.operationId,
      attemptId: randomUUID(), code: replacement.code } })).state).toBe('recovery');
    expect(await counts()).toEqual({ sends: 1, accounts: 1, sessions: 3, checks: 1 });
    expect(provider.start).toHaveBeenCalledTimes(1); expect(provider.check).toHaveBeenCalledTimes(1);
  });

  it('restores the confirmed selector after response loss without renewing it or creating a private publication', async () => {
    const binding = await browser();
    delete env.SM_CUSTOMER_VERIFY_POLICY; delete env.SM_CUSTOMER_VERIFY_EVIDENCE;
    delete env.SM_CUSTOMER_VERIFY_API_KEY_SECRET;
    const envelope = { request: { step: 'restore' as const }, browserSecret: binding.browserSecret, candidateSecret: null };
    const first = await ok('browser', envelope);
    expect(first.preparation.browserRef).toBe(binding.browserRef);
    expect(first.preparation.state).toBe('confirmed'); expect(first.emitCookie).toBe(false);
    dropAction = 'browser'; await expect(http('browser', envelope)).rejects.toBeDefined();
    expect(dropAction).toBeNull(); expect(await ok('browser', envelope)).toEqual(first);
    expect(Object.keys(first).sort()).toEqual(['emitCookie', 'preparation']);
    expect(Object.keys(first.preparation).sort()).toEqual(['admissionExpiresAt', 'browserRef', 'expiresAt', 'state']);
    expect((await http('session', { ...binding, request: {}, sessionToken: binding.browserSecret,
      expectedOperationId: randomUUID(), expectedCheckId: randomUUID() })).status).toBe(401);
    expect(human.verify).not.toHaveBeenCalled(); expect(provider.start).not.toHaveBeenCalled(); expect(provider.check).not.toHaveBeenCalled();
    expect(await counts()).toEqual({ sends: 0, accounts: 0, sessions: 0, checks: 0 });
  });
  it('refuses a forged cookie or another tenant during signed HTTP restoration', async () => {
    const binding = await browser();
    expect((await http('browser', { request: { step: 'restore' }, browserSecret: randomBytes(32).toString('base64url'),
      candidateSecret: null })).status).toBe(401);
    env.SM_CUSTOMER_PILOT_TENANT_ID = randomBytes(12).toString('hex');
    expect((await http('browser', { request: { step: 'restore' }, browserSecret: binding.browserSecret,
      candidateSecret: null })).status).toBe(401);
    expect(human.verify).not.toHaveBeenCalled(); expect(provider.start).not.toHaveBeenCalled(); expect(provider.check).not.toHaveBeenCalled();
  });

  it('requires the issued private proof before Turnstile, spending or any result disclosure', async () => {
    const binding = await browser(), f = await intent(binding);
    const replay = await ok('intent', { ...binding, candidateProof: randomBytes(32).toString('base64url'),
      request: { step: 'prepare', operationId: f.operationId } });
    expect(replay.emitCookie).toBe(false);
    const forged = randomBytes(32).toString('base64url');
    expect((await http('start', { ...f.start(), intentProof: forged })).status).toBe(401);
    expect((await http('recover', { ...f.result(null), intentProof: forged })).status).toBe(401);
    expect(human.verify).not.toHaveBeenCalled(); expect(provider.start).not.toHaveBeenCalled();
    expect(await counts()).toEqual({ sends: 0, accounts: 0, sessions: 0, checks: 0 });
    const role = await database.app.query('SELECT rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user');
    expect(role.rows[0]).toEqual({ rolsuper: false, rolbypassrls: false });
  });
  it('recovers a destroyed start response without challengeId, another send or fresh provider evidence', async () => {
    const f = await intent(await browser()); dropAction = 'start';
    await expect(http('start', f.start())).rejects.toBeDefined(); expect(dropAction).toBeNull();
    env.SM_CUSTOMER_VERIFY_EVIDENCE = '{}'; delete env.SM_CUSTOMER_VERIFY_API_KEY_SECRET;
    const result = await ok('recover', f.result(null));
    expect(result.state).toBe('code_required'); expect(result.challengeId).toMatch(/^[a-f0-9-]{36}$/);
    expect(result.checkId).toBeNull(); expect(result).not.toHaveProperty('token'); expect(result).not.toHaveProperty('view');
    expect(provider.start).toHaveBeenCalledTimes(1); expect(provider.check).not.toHaveBeenCalled();
    expect(await counts()).toEqual({ sends: 1, accounts: 0, sessions: 0, checks: 0 });
  });
  it('recovers provisional OTP then protected activation after HTTP loss without a second provider check', async () => {
    const binding = await browser(), f = await intent(binding), pending = await ok('start', f.start());
    const check = f.check(pending.challengeId); dropAction = 'check';
    await expect(http('check', check)).rejects.toBeDefined(); expect(dropAction).toBeNull();
    const provisional = await ok('recover', f.result(check.request.checkId));
    expect(provisional.state).toBe('enrollment');
    expect(provisional).not.toHaveProperty('token'); expect(provisional).not.toHaveProperty('view');
    expect(await ok('recover', f.result(check.request.checkId))).toEqual(provisional);
    expect(await counts()).toEqual({ sends: 1, accounts: 0, sessions: 0, checks: 1 });
    expect((await http('check', { ...check, request: { ...check.request, code: '654321' } })).status).toBe(401);
    const noSelection = await ok('recover', f.result(null)); expect(noSelection.state).not.toBe('approved');
    const protection = await prepareProtection(f, check.request.checkId);
    expect(await counts()).toEqual({ sends: 1, accounts: 0, sessions: 0, checks: 1 });
    dropAction = 'protection'; await expect(http('protection', protection.envelope)).rejects.toBeDefined(); expect(dropAction).toBeNull();
    delete env.SM_CUSTOMER_VERIFY_POLICY; delete env.SM_CUSTOMER_VERIFY_EVIDENCE; delete env.SM_CUSTOMER_VERIFY_API_KEY_SECRET;
    const result = await protection.recover(); expect(await protection.recover()).toEqual(result);
    expect(await ok('session', { ...binding, ...protection.publication, sessionToken: result.token, request: {} })).toEqual(result.view);
    expect((await f.close()).intent.state).toBe('closed');
    expect((await ok('recover', f.result(check.request.checkId))).state).toBe('closed');
    expect((await http('session', { ...binding, ...protection.publication, sessionToken: result.token, request: {} })).status).toBe(401);
    expect(provider.start).toHaveBeenCalledTimes(1); expect(provider.check).toHaveBeenCalledTimes(1);
    expect(await counts()).toEqual({ sends: 1, accounts: 1, sessions: 1, checks: 1 });
  });
  it('tombstones a guest close before delayed start admission, with no durable send reservation', async () => {
    const f = await intent(await browser()), entered = barrier<void>(), release = barrier<boolean>();
    human.verify.mockImplementationOnce(async () => { entered.release(); return release.promise; });
    const delayed = http('start', f.start());
    try {
      await Promise.race([entered.promise, delayed.then(() => { throw new Error('Start settled before the controlled boundary'); })]);
      expect((await f.close()).intent.state).toBe('closed');
    } finally { release.release(true); await delayed.catch(() => undefined); }
    expect((await delayed).status).toBe(401);
    expect((await ok('recover', f.result(null))).state).toBe('closed');
    expect(provider.start).not.toHaveBeenCalled(); expect(await counts()).toEqual({ sends: 0, accounts: 0, sessions: 0, checks: 0 });
  });
  it('does not publish a provider approval after guest close, and never refunds its reservation', async () => {
    const f = await intent(await browser()), pending = await ok('start', f.start());
    const check = f.check(pending.challengeId), entered = barrier<void>(), release = barrier<'approved'>();
    provider.check.mockImplementationOnce(async () => { entered.release(); return release.promise; });
    const delayed = http('check', check);
    try {
      await Promise.race([entered.promise, delayed.then(() => { throw new Error('Check settled before the controlled boundary'); })]);
      expect((await f.close()).intent.state).toBe('closed');
    } finally { release.release('approved'); await delayed.catch(() => undefined); }
    expect((await delayed).status).toBe(401);
    expect((await ok('recover', f.result(check.request.checkId))).state).toBe('closed');
    expect(await counts()).toEqual({ sends: 1, accounts: 0, sessions: 0, checks: 1 });
    const budget = await database.admin.query('SELECT reserved_sends FROM customer.parent_budgets WHERE parent_ref=$1', [env.SM_CUSTOMER_VERIFY_ACCOUNT_SID]);
    expect(Number(budget.rows[0].reserved_sends)).toBe(1);
  });
  it('keeps a later session B authoritative when an old A credential arrives and A is closed', async () => {
    const binding = await browser(), a = await intent(binding), pendingA = await ok('start', a.start());
    const checkA = a.check(pendingA.challengeId);
    expect((await ok('check', checkA)).state).toBe('enrollment');
    const protectionA = await prepareProtection(a, checkA.request.checkId), approvedA = await protectionA.activate();
    const nonexistentPublication = { expectedOperationId: randomUUID(), expectedCheckId: randomUUID() };
    // A is still valid here: these refusals specifically prove publication
    // selection, not an already-revoked token or a stale browser generation.
    expect((await http('session', { ...binding, ...nonexistentPublication, sessionToken: approvedA.token, request: {} })).status).toBe(401);
    expect((await http('name', { ...binding, ...nonexistentPublication, sessionToken: approvedA.token,
      request: { name: 'Must not be written', expectedRevision: 0 } })).status).toBe(401);
    await ok('logout', { ...binding, ...nonexistentPublication, sessionToken: approvedA.token, request: { all: true } });
    expect(await ok('session', { ...binding, ...protectionA.publication, sessionToken: approvedA.token, request: {} })).toEqual(approvedA.view);
    // This is the stale server credential carried by a delayed Set-Cookie A;
    // browser cookie delivery itself belongs to the separate BFF/Chromium test.
    const b = await intent(binding), pendingB = await ok('start', b.start(phones[1]));
    const checkB = b.check(pendingB.challengeId);
    expect((await ok('check', checkB)).state).toBe('enrollment');
    const protectionB = await prepareProtection(b, checkB.request.checkId), approvedB = await protectionB.activate();
    expect((await http('session', { ...binding, ...protectionB.publication, sessionToken: approvedA.token, request: {} })).status).toBe(401);
    expect((await ok('recover', a.result(checkA.request.checkId))).state).toBe('failed');
    expect((await a.close()).intent.state).toBe('closed');
    expect(await ok('session', { ...binding, ...protectionB.publication, sessionToken: approvedB.token, request: {} })).toEqual(approvedB.view);
    expect(await counts()).toEqual({ sends: 2, accounts: 2, sessions: 2, checks: 2 });
    expect(provider.start).toHaveBeenCalledTimes(2); expect(provider.check).toHaveBeenCalledTimes(2);
  });
});
