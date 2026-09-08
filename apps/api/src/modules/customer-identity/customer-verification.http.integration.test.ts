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
import { CustomerAccountResponses, type CustomerAccountAction, type CustomerAccountEnvelope } from '@sm/contracts';
import { PostgresCustomerIdentityRepository } from '@sm/customer';
import { SharedPublicQuota } from '../../common/shared-public-quota';
import { CustomerAccountController } from './customer-account.controller';
import { CustomerAccountGuard } from './customer-account.guard';
import { CustomerAccountHumanVerifier } from './customer-account.human';
import { CUSTOMER_IDENTITY_REPOSITORY, CUSTOMER_VERIFICATION_TRANSPORT_FACTORY, CustomerAccountRuntime } from './customer-account.runtime';
import { customerTestEnvironment } from './customer-account.test-fixture';
import type { PhoneVerificationTransport } from './phone-verification.port';

// Real signed HTTP -> Nest guard/controller/runtime/core -> migrated PostgreSQL
// under a NOSUPERUSER/NOBYPASSRLS role. Only tenant lookup, HTTP rate limiting,
// Turnstile and Verify are port fixtures. No browser/BFF cookie jar is claimed
// here: its independent native-browser suite covers cookie delivery/selection.
// Loss injection destroys the HTTP response only after the controller has the
// real committed result. It never fabricates a business or repository result.
const integration = process.env.CUSTOMER_TEST_DATABASE_URL ? describe : describe.skip;
type DatabaseFixture = { app: Pool; admin: Pool; close(): Promise<void> };
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
const query = { read: () => query, readConcern: () => query, maxTimeMS: () => query, lean: () => query,
  exec: async () => ({ _id: env.SM_CUSTOMER_PILOT_TENANT_ID, slug: 'fixture', account: { status: 'trial' } }) };

@Module({ controllers: [CustomerAccountController], providers: [CustomerAccountGuard, CustomerAccountRuntime,
  { provide: ConfigService, useValue: config },
  { provide: getModelToken('Tenant'), useValue: { findOne: () => query } },
  { provide: SharedPublicQuota, useValue: { reserve: async () => true } },
  { provide: CustomerAccountHumanVerifier, useValue: human },
  { provide: CUSTOMER_IDENTITY_REPOSITORY, useFactory: () => new PostgresCustomerIdentityRepository(database.app) },
  { provide: CUSTOMER_VERIFICATION_TRANSPORT_FACTORY, useValue: () => provider },
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
  async function close() {
    if (closed) return;
    closed = true;
    try { await app?.close(); } finally { await database?.close(); }
  }
  beforeAll(async () => {
    // Reuse the guarded UUID database/role fixture; no application DB can be a
    // target. Dynamic imports keep test-only sources out of API build inputs.
    const fixturePath = resolve(process.cwd(), '../../packages/customer/src/test-fixture.ts');
    const fixture = await import(/* @vite-ignore */ fixturePath) as { customerTestFixture(raw: unknown): Promise<DatabaseFixture> };
    database = await fixture.customerTestFixture(process.env.CUSTOMER_TEST_DATABASE_URL);
    try {
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
  beforeEach(() => {
    dropAction = null;
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
  it('recovers one committed approval after HTTP loss, refuses changed OTP replay, and closes its session', async () => {
    const binding = await browser(), f = await intent(binding), pending = await ok('start', f.start());
    const check = f.check(pending.challengeId); dropAction = 'check';
    await expect(http('check', check)).rejects.toBeDefined(); expect(dropAction).toBeNull();
    const result = await ok('recover', f.result(check.request.checkId));
    expect(result.state).toBe('approved'); if (result.state !== 'approved') throw new Error('Expected exact approval');
    expect(await ok('recover', f.result(check.request.checkId))).toEqual(result);
    expect((await http('check', { ...check, request: { ...check.request, code: '654321' } })).status).toBe(401);
    const noSelection = await ok('recover', f.result(null)); expect(noSelection.state).not.toBe('approved');
    expect(await ok('session', { ...binding, ...f.publication(check.request.checkId), sessionToken: result.token, request: {} })).toEqual(result.view);
    expect((await f.close()).intent.state).toBe('closed');
    expect((await ok('recover', f.result(check.request.checkId))).state).toBe('closed');
    expect((await http('session', { ...binding, ...f.publication(check.request.checkId), sessionToken: result.token, request: {} })).status).toBe(401);
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
    const checkA = a.check(pendingA.challengeId), approvedA = await ok('check', checkA);
    const nonexistentPublication = { expectedOperationId: randomUUID(), expectedCheckId: randomUUID() };
    // A is still valid here: these refusals specifically prove publication
    // selection, not an already-revoked token or a stale browser generation.
    expect((await http('session', { ...binding, ...nonexistentPublication, sessionToken: approvedA.token, request: {} })).status).toBe(401);
    expect((await http('name', { ...binding, ...nonexistentPublication, sessionToken: approvedA.token,
      request: { name: 'Must not be written', expectedRevision: 0 } })).status).toBe(401);
    await ok('logout', { ...binding, ...nonexistentPublication, sessionToken: approvedA.token, request: { all: true } });
    expect(await ok('session', { ...binding, ...a.publication(checkA.request.checkId), sessionToken: approvedA.token, request: {} })).toEqual(approvedA.view);
    // This is the stale server credential carried by a delayed Set-Cookie A;
    // browser cookie delivery itself belongs to the separate BFF/Chromium test.
    const b = await intent(binding), pendingB = await ok('start', b.start(phones[1]));
    const checkB = b.check(pendingB.challengeId), approvedB = await ok('check', checkB);
    expect((await http('session', { ...binding, ...b.publication(checkB.request.checkId), sessionToken: approvedA.token, request: {} })).status).toBe(401);
    expect((await ok('recover', a.result(checkA.request.checkId))).state).toBe('failed');
    expect((await a.close()).intent.state).toBe('closed');
    expect(await ok('session', { ...binding, ...b.publication(checkB.request.checkId), sessionToken: approvedB.token, request: {} })).toEqual(approvedB.view);
    expect(await counts()).toEqual({ sends: 2, accounts: 2, sessions: 2, checks: 2 });
    expect(provider.start).toHaveBeenCalledTimes(2); expect(provider.check).toHaveBeenCalledTimes(2);
  });
});
