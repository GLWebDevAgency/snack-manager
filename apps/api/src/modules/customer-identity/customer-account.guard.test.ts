import { createHash, createHmac } from 'node:crypto';
import type { ExecutionContext } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { describe, expect, it, vi } from 'vitest';
import type { SharedPublicQuota } from '../../common/shared-public-quota';
import { CustomerAccountGuard, type CustomerAccountRequest } from './customer-account.guard';
import { customerTestEnvironment } from './customer-account.test-fixture';

function fixture(action = 'session') {
  const env = customerTestEnvironment();
  const body = { sessionToken: Buffer.alloc(32, 17).toString('base64url'),
    browserSecret: Buffer.alloc(32, 20).toString('base64url'), request: {} };
  const request = { method: 'POST', originalUrl: `/public/customer/fixture/${action}`,
    params: { slug: 'fixture', action }, body, rawBody: Buffer.from(JSON.stringify(body)),
    headers: { 'content-type': 'application/json', 'x-sm-customer-client': Buffer.alloc(32, 18).toString('base64url'),
      'x-sm-customer-at': String(Math.floor(Date.now() / 1000)), 'x-sm-customer-origin': 'https://fixture.example' },
    rawHeaders: [],
  } as unknown as CustomerAccountRequest;
  function sign() {
    const headers = request.headers;
    const payload = ['customer-v1', headers['x-sm-customer-at'], request.params.slug, request.params.action,
      'POST', request.originalUrl, headers['x-sm-customer-origin'], headers['x-sm-customer-client'],
      createHash('sha256').update(JSON.stringify(request.body)).digest('hex')].join('\0');
    headers['x-sm-customer-proof'] = createHmac('sha256', Buffer.from(env.SM_CUSTOMER_RELAY_SIGNING_KEY!, 'base64')).update(payload).digest('base64url');
    request.rawHeaders = Object.entries(headers).flatMap(([name, value]) => [name, String(value)]);
  }
  sign(); const setHeader = vi.fn();
  const context = { switchToHttp: () => ({ getRequest: () => request, getResponse: () => ({ setHeader }) }) } as ExecutionContext;
  const quota = { reserve: vi.fn().mockResolvedValue(true) };
  const config = new ConfigService(env);
  vi.spyOn(config, 'get').mockImplementation(name => env[String(name)]);
  const guard = new CustomerAccountGuard(config, quota as unknown as SharedPublicQuota);
  return { env, request, sign, quota, guard, context, setHeader };
}
describe('customer dedicated signed boundary', () => {
  it('accepts the exact signed envelope and reserves source plus global HTTP quota', async () => {
    const f = fixture(); await expect(f.guard.canActivate(f.context)).resolves.toBe(true);
    expect(f.request.customerRelay).toMatchObject({ action: 'session', slug: 'fixture', origin: 'https://fixture.example' });
    expect(Reflect.has(f.request, 'user')).toBe(false);
    expect(f.quota.reserve).toHaveBeenCalledWith(expect.objectContaining({ scope: 'customer-account-http', clientLimit: 60, globalLimit: 300 }));
    expect(f.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store, private');
  });
  it.each(['x-sm-customer-client', 'x-sm-customer-at', 'x-sm-customer-origin', 'x-sm-customer-proof'])('refuses unsigned or duplicate %s', async name => {
    const f = fixture(); delete f.request.headers[name];
    await expect(f.guard.canActivate(f.context)).rejects.toMatchObject({ status: 403 });
    const g = fixture(); g.request.rawHeaders.push(name, String(g.request.headers[name]));
    await expect(g.guard.canActivate(g.context)).rejects.toMatchObject({ status: 403 });
    expect(f.quota.reserve).not.toHaveBeenCalled(); expect(g.quota.reserve).not.toHaveBeenCalled();
  });
  it.each([-61, 61])('rejects clock displacement %s seconds', async offset => {
    const f = fixture(); f.request.headers['x-sm-customer-at'] = String(Math.floor(Date.now() / 1000) + offset); f.sign();
    await expect(f.guard.canActivate(f.context)).rejects.toMatchObject({ status: 403 });
  });
  it('rejects body edits even if they remain valid DTOs', async () => {
    const f = fixture(); f.request.body.sessionToken = Buffer.alloc(32, 19).toString('base64url');
    await expect(f.guard.canActivate(f.context)).rejects.toMatchObject({ status: 403 });
    expect(f.quota.reserve).not.toHaveBeenCalled();
  });
  it.each(['query', 'method', 'slug', 'action', 'origin', 'legacy'])('rejects %s mismatch without quota or business work', async kind => {
    const f = fixture();
    if (kind === 'query') f.request.originalUrl += '?private=fixture';
    if (kind === 'method') f.request.method = 'GET';
    if (kind === 'slug') f.request.params.slug = 'another';
    if (kind === 'action') f.request.params.action = 'unknown';
    if (kind === 'origin') f.request.headers['x-sm-customer-origin'] = 'https://other.example';
    if (kind === 'legacy') { f.request.headers['x-sm-relay-proof'] = f.request.headers['x-sm-customer-proof']; delete f.request.headers['x-sm-customer-proof']; }
    await expect(f.guard.canActivate(f.context)).rejects.toMatchObject({ status: 403 });
    expect(f.quota.reserve).not.toHaveBeenCalled();
  });
  it.each(['body', 'content-type', 'content-encoding', 'size', 'raw-size'])('rejects strict invalid %s', async kind => {
    const f = fixture();
    if (kind === 'body') f.request.body.tenantRef = 'forged';
    if (kind === 'content-type') f.request.headers['content-type'] = 'text/plain';
    if (kind === 'content-encoding') f.request.headers['content-encoding'] = 'gzip';
    if (kind === 'size') f.request.body.request.extra = 'x'.repeat(4097);
    if (kind === 'raw-size') f.request.rawBody = Buffer.alloc(4097);
    f.sign();
    await expect(f.guard.canActivate(f.context)).rejects.toMatchObject({ status: 400 });
    expect(f.quota.reserve).not.toHaveBeenCalled();
  });
  it('fails closed on shared quota refusal or Redis failure with generic errors', async () => {
    const f = fixture(); f.quota.reserve.mockResolvedValue(false);
    await expect(f.guard.canActivate(f.context)).rejects.toMatchObject({ status: 429 });
    f.quota.reserve.mockRejectedValue(new Error('fixture-secret-redis-url'));
    const error: unknown = await f.guard.canActivate(f.context).catch(value => value);
    expect(error).toMatchObject({ status: 503, message: 'Service de compte momentanément indisponible.' });
    expect(JSON.stringify(error).includes('fixture-secret-redis-url')).toBe(false);
    expect(f.request.customerRelay).toBeUndefined();
  });
  it('rejects production even with a perfectly signed envelope', async () => {
    const f = fixture(); f.env.RAILWAY_ENVIRONMENT_NAME = 'production';
    await expect(f.guard.canActivate(f.context)).rejects.toMatchObject({ status: 503 });
    expect(f.quota.reserve).not.toHaveBeenCalled();
  });
});
