import 'reflect-metadata';
import { randomBytes, randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { BadRequestException, Controller, Get, Module, type INestApplication } from '@nestjs/common';
import { APP_FILTER, NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { SharedPublicQuota } from '../../common/shared-public-quota';
import { CustomerAccountController } from './customer-account.controller';
import { CustomerAccountGuard } from './customer-account.guard';
import { CustomerAccountRuntime } from './customer-account.runtime';
import { customerAccessConfiguration } from './customer-account.config';
import { OpsExceptionFilter } from '../ops/ops-exception.filter';
import { OpsService } from '../ops/ops.service';

/** The signer is imported from the actual Web implementation, not rewritten
 * in a fixture. A dynamic source path keeps this test-only dependency out of
 * the API TypeScript emit root. Turbo explicitly hashes that Web source. */
type Sign = (input: {
  key: Uint8Array; slug: string; action: string; origin: string;
  clientIp: string; body: string; now?: number;
}) => Record<string, string>;

const key = randomBytes(32);
const projectId = randomUUID();
const environmentId = randomUUID();
const origin = 'https://classfood.staging.snackmanager.fr';
const tenantId = randomBytes(12).toString('hex');
const configValues: Record<string, unknown> = {
  NODE_ENV: 'production', SM_ENV: 'staging', RAILWAY_ENVIRONMENT_NAME: 'staging',
  RAILWAY_PROJECT_ID: projectId, RAILWAY_ENVIRONMENT_ID: environmentId,
  SM_CUSTOMER_PILOT_PROJECT_ID: projectId, SM_CUSTOMER_PILOT_ENVIRONMENT_ID: environmentId,
  SM_CUSTOMER_ACCOUNT_MODE: 'closed_trial',
  SM_CUSTOMER_RELAY_SIGNING_KEY: key.toString('base64'),
  SM_CUSTOMER_IDENTITY_KEY: randomBytes(32).toString('base64'),
  SM_CUSTOMER_PILOT_SLUGS: JSON.stringify(['classfood']),
  SM_CUSTOMER_PILOT_TENANT_ID: tenantId,
  SM_CUSTOMER_PILOT_ORIGINS: JSON.stringify([origin]),
  SM_CUSTOMER_VERIFY_ACCOUNT_SID: `AC${'a'.repeat(32)}`,
};
const config = new ConfigService(configValues);
const execute = vi.fn().mockResolvedValue({ available: false });
const quota = { reserve: vi.fn().mockResolvedValue(true), reserveClient: vi.fn().mockResolvedValue(true) };
const record = vi.fn().mockResolvedValue(undefined);

@Controller('public/customer-other')
class NeighborController {
  @Get()
  read() { throw new BadRequestException('neighbor-fixture-marker'); }
}

@Module({
  controllers: [CustomerAccountController, NeighborController],
  providers: [CustomerAccountGuard,
    { provide: CustomerAccountRuntime, useValue: { execute } },
    { provide: ConfigService, useValue: config },
    { provide: SharedPublicQuota, useValue: quota },
    { provide: OpsService, useValue: { record } },
    { provide: APP_FILTER, useClass: OpsExceptionFilter }],
})
class RelayInteropModule {}

describe('customer relay — real Web signer into the Nest HTTP boundary', () => {
  let app: INestApplication;
  let base: string;
  let sign: Sign;
  beforeAll(async () => {
    const webSource = resolve(process.cwd(), '../web/src/app/r/[slug]/compte/customer-relay.ts');
    const module = await import(/* @vite-ignore */ webSource) as { customerRelayHeaders: Sign };
    sign = module.customerRelayHeaders;
    app = await NestFactory.create(RelayInteropModule, { logger: false, rawBody: true });
    await app.listen(0, '127.0.0.1');
    base = await app.getUrl();
  });
  beforeEach(() => {
    execute.mockReset().mockResolvedValue({ available: false });
    quota.reserve.mockReset().mockResolvedValue(true);
    quota.reserveClient.mockReset().mockResolvedValue(true);
    record.mockReset().mockResolvedValue(undefined);
    configValues.RAILWAY_ENVIRONMENT_NAME = 'staging';
  });
  afterAll(async () => { await app?.close(); });

  function signed(action = 'status', body = JSON.stringify({ request: {} }), patch: Partial<Parameters<Sign>[0]> = {}): {
    body: string; headers: Record<string, string>;
  } {
    return { body, headers: { 'content-type': 'application/json', ...sign({ key, slug: 'classfood',
      action, origin, clientIp: '192.0.2.10', body, ...patch }) } };
  }
  function post(path: string, input: { headers: Record<string, string>; body: string }) {
    return fetch(`${base}${path}`, { method: 'POST', ...input });
  }

  it('accepts the actual Web signature while keeping the capability closed', async () => {
    expect(Object.fromEntries(Object.keys(configValues).map(name => [name, config.get(name)]))).toEqual(configValues);
    expect(customerAccessConfiguration({ get: name => configValues[name] })).not.toBeNull();
    expect(customerAccessConfiguration(config)).not.toBeNull();
    const input = signed();
    const response = await post('/public/customer/classfood/status', input);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ available: false });
    expect(execute).toHaveBeenCalledTimes(1);
    const relay = execute.mock.calls[0]![0];
    expect(relay).toMatchObject({ slug: 'classfood', action: 'status', origin });
    expect(JSON.stringify(relay)).not.toContain('192.0.2.10');
    expect(response.headers.get('cache-control')).toContain('no-store');
  });

  it('passes the original browser-bound recovery proof, without an OTP', async () => {
    const body = JSON.stringify({ browserRef: randomUUID(), browserSecret: randomBytes(32).toString('base64url'),
      request: { challengeId: randomUUID(), checkId: randomUUID() } });
    const response = await post('/public/customer/classfood/recover', signed('recover', body));
    expect(response.status).toBe(200);
    expect(execute.mock.calls[0]![1]).toEqual(JSON.parse(body));
    expect(execute.mock.calls[0]![1].request).not.toHaveProperty('code');
  });

  it.each(['prepare', 'issue', 'confirm'] as const)('relays the exact %s phase, with no secret in the preparation response', async step => {
    const browserRef = randomUUID(); const secret = randomBytes(32).toString('base64url');
    const envelope = { request: { step, browserRef }, browserSecret: step === 'confirm' ? secret : null,
      candidateSecret: step === 'issue' ? secret : null };
    const now = Date.now(); const result = { preparation: { browserRef,
      state: step === 'prepare' ? 'prepared' : step === 'issue' ? 'issued' : 'confirmed',
      admissionExpiresAt: now + 600_000, expiresAt: now + 604_800_000 }, emitCookie: step === 'issue' };
    // Runtime is a port fixture here; the separate runtime/PG suites prove the CAS.
    execute.mockResolvedValue(result);
    const response = await post('/public/customer/classfood/browser', signed('browser', JSON.stringify(envelope)));
    expect(response.status).toBe(200); expect(await response.json()).toEqual(result);
    expect(execute).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ action: 'browser' }), envelope);
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(JSON.stringify(result)).not.toContain(secret);
    expect(response.headers.get('set-cookie')).toBeNull();
  });

  it.each(['start', 'check', 'recover', 'session', 'name', 'logout'] as const)(
    'requires a signed canonical browserRef for %s; the UUID alone never replaces its cookie', async action => {
      const secret = randomBytes(32).toString('base64url');
      const request = action === 'start' ? { phone: '+33612345678', operationId: randomUUID(), turnstileToken: 'fixture-human-token' }
        : action === 'check' ? { challengeId: randomUUID(), checkId: randomUUID(), code: '123456' }
          : action === 'recover' ? { challengeId: randomUUID(), checkId: randomUUID() }
            : action === 'name' ? { name: null, expectedRevision: 0 } : action === 'logout' ? { all: false } : {};
      const envelope = { browserRef: randomUUID(), browserSecret: secret, request,
        ...(['check', 'session', 'name', 'logout'].includes(action) ? { sessionToken: action === 'check' ? null : secret } : {}) };
      const body = JSON.stringify(envelope), input = signed(action, body);
      const tampered = await post(`/public/customer/classfood/${action}`, { ...input,
        body: JSON.stringify({ ...envelope, browserRef: randomUUID() }) });
      expect(tampered.status).toBe(403);
      for (const field of ['browserRef', 'browserSecret'] as const) {
        const missing: Record<string, unknown> = { ...envelope }; delete missing[field];
        const refused = await post(`/public/customer/classfood/${action}`, signed(action, JSON.stringify(missing)));
        expect(refused.status).toBe(400);
      }
      expect(execute).not.toHaveBeenCalled();
    });

  it.each(['session', 'name', 'logout'] as const)('signs and requires the exact private browser binding for %s', async action => {
    const request = action === 'name' ? { name: null, expectedRevision: 0 } : action === 'logout' ? { all: false } : {};
    const envelope = { browserRef: randomUUID(), browserSecret: randomBytes(32).toString('base64url'),
      sessionToken: randomBytes(32).toString('base64url'), request };
    const body = JSON.stringify(envelope); const input = signed(action, body);
    const accepted = await post(`/public/customer/classfood/${action}`, input);
    expect(accepted.status).toBe(action === 'logout' ? 204 : 200);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute.mock.calls[0]![1]).toEqual(envelope);
    const changed = await post(`/public/customer/classfood/${action}`, { ...input,
      body: JSON.stringify({ ...envelope, browserSecret: randomBytes(32).toString('base64url') }) });
    expect(changed.status).toBe(403);
    const missing = await post(`/public/customer/classfood/${action}`, signed(action,
      JSON.stringify({ sessionToken: envelope.sessionToken, request })));
    expect(missing.status).toBe(400);
    expect(execute).toHaveBeenCalledTimes(1);
    for (const response of [accepted, changed, missing]) {
      expect(response.headers.get('cache-control')).toContain('no-store');
      expect(await response.text()).not.toContain(envelope.browserSecret);
    }
  });

  it.each(['body', 'action', 'tenant', 'origin', 'source', 'key', 'expired'] as const)(
    'rejects a request with an altered %s before any account operation', async change => {
      const input = signed();
      let path = '/public/customer/classfood/status';
      if (change === 'body') input.body = JSON.stringify({ request: { injected: true } });
      if (change === 'action') path = '/public/customer/classfood/session';
      if (change === 'tenant') path = '/public/customer/another-restaurant/status';
      if (change === 'origin') input.headers['x-sm-customer-origin'] = 'https://evil.example';
      if (change === 'source') input.headers['x-sm-customer-client'] = randomBytes(32).toString('base64url');
      if (change === 'key') Object.assign(input.headers, signed('status', input.body, { key: randomBytes(32) }).headers);
      if (change === 'expired') Object.assign(input.headers, signed('status', input.body, { now: Date.now() - 120_000 }).headers);
      const response = await post(path, input);
      expect(response.status).toBeGreaterThanOrEqual(400);
      expect(response.status).toBeLessThan(500);
      expect(execute).not.toHaveBeenCalled();
    });

  it('refuses an unsigned direct call even with spoofed edge and browser headers', async () => {
    const response = await post('/public/customer/classfood/status', {
      body: JSON.stringify({ request: {} }), headers: { 'content-type': 'application/json',
        origin, 'x-real-ip': '192.0.2.10', 'x-forwarded-for': '192.0.2.11' },
    });
    expect(response.status).toBe(403);
    expect(execute).not.toHaveBeenCalled();
  });

  it('refuses a duplicate relay signature instead of choosing one', async () => {
    const input = signed();
    input.headers['x-sm-customer-proof'] += `, ${input.headers['x-sm-customer-proof']}`;
    const response = await post('/public/customer/classfood/status', input);
    expect(response.status).toBe(403);
    expect(execute).not.toHaveBeenCalled();
  });

  it('keeps the same signed request closed in a production runtime', async () => {
    configValues.RAILWAY_ENVIRONMENT_NAME = 'production';
    const response = await post('/public/customer/classfood/status', signed());
    expect(response.status).toBe(503);
    expect(execute).not.toHaveBeenCalled();
  });

  it('fails closed without leaking the quota infrastructure error', async () => {
    quota.reserve.mockRejectedValueOnce(new Error('private-infrastructure-detail'));
    const response = await post('/public/customer/classfood/status', signed());
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain('private-infrastructure-detail');
    expect(execute).not.toHaveBeenCalled();
  });

  it.each([
    ['malformed JSON', 'private7', 400],
    ['body beyond the HTTP parser limit', JSON.stringify({ private: 'private-fixture-marker'.repeat(10_000) }), 413],
  ] as const)('normalizes %s before the relay guard', async (_label, body, expectedStatus) => {
    const response = await post('/public/customer/classfood/check', signed('check', body));
    expect(response.status).toBe(expectedStatus);
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(response.headers.get('referrer-policy')).toBe('no-referrer');
    const payload = await response.text();
    expect(payload).not.toContain('private-fixture-marker');
    expect(payload).not.toContain('private7');
    expect(JSON.parse(payload)).toMatchObject({ code: 'CUSTOMER_INVALID_REQUEST' });
    expect(execute).not.toHaveBeenCalled();
    expect(record).not.toHaveBeenCalled();
  });

  it('sanitizes an unexpected customer failure before both response and Ops storage', async () => {
    execute.mockRejectedValueOnce(new Error('private-fixture-marker'));
    const response = await post('/public/customer/classfood/status', signed());
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain('private-fixture-marker');
    expect(record).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(record.mock.calls)).not.toContain('private-fixture-marker');
  });

  it('leaves neighboring routes and their existing error shape unchanged', async () => {
    const response = await fetch(`${base}/public/customer-other`);
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ message: 'neighbor-fixture-marker', statusCode: 400 });
    expect(response.headers.get('cache-control')).toBeNull();
    expect(record).not.toHaveBeenCalled();
  });
});
