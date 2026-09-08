import { randomBytes, randomUUID, createHash, createHmac } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { CustomerAccountErrorSchema } from '@sm/contracts';
import { GET as status } from './capacites/route';
import { POST as browser } from './navigateur/route';
import { POST as start } from './verification/route';
import { POST as check } from './confirmation/route';
import { POST as recover } from './resultat/route';
import { GET as session, DELETE as logout } from './session/route';
import { PATCH as name } from './profil/route';

const origin = 'https://staging.snackmanager.fr';
const apiOrigin = 'https://customer-api.example.test';
const key = randomBytes(32).toString('base64');
const browserToken = randomBytes(32).toString('base64url');
const sessionToken = randomBytes(32).toString('base64url');
const browserCookie = '__Host-sm_customer_browser_classfood';
const sessionCookie = '__Host-sm_customer_session_classfood';
const browserRef = randomUUID();
const preparation = (state: 'prepared' | 'issued' | 'confirmed' = 'prepared') => ({ browserRef, state,
  admissionExpiresAt: Date.now() + 600_000, expiresAt: Date.now() + 604_800_000 });
const context = { params: Promise.resolve({ slug: 'classfood' }) };
const mockFetch = vi.fn<typeof fetch>();
const view = () => ({ expiresAt: Date.now() + 60_000,
  profile: { name: 'Client test', phoneE164: '+33600000000', phoneVerifiedAt: Date.now() - 1_000, revision: 0 } });

function req(path: string, method = 'POST', body: unknown = path === 'navigateur' ? { step: 'prepare', browserRef } : {}, headers: Record<string, string> = {}) {
  return new NextRequest(`${origin}/r/classfood/compte/${path}`, { method,
    headers: { host: 'staging.snackmanager.fr', origin, 'sec-fetch-site': 'same-origin',
      'x-real-ip': '192.0.2.10', 'content-type': 'application/json', 'x-sm-customer-browser-ref': browserRef, ...headers },
    ...(method === 'GET' ? {} : { body: JSON.stringify(body) }) });
}
function privateHeaders(response: Response) {
  expect(response.headers.get('cache-control')).toBe('private, no-store, max-age=0');
  expect(response.headers.get('referrer-policy')).toBe('no-referrer');
}
beforeEach(() => {
  vi.stubEnv('NODE_ENV', 'production');
  vi.stubEnv('RAILWAY_ENVIRONMENT_NAME', 'staging');
  vi.stubEnv('SM_ENV', 'staging');
  vi.stubEnv('SM_CUSTOMER_ACCOUNT_MODE', 'closed_trial');
  const environmentId = randomUUID(), projectId = randomUUID();
  vi.stubEnv('RAILWAY_ENVIRONMENT_ID', environmentId);
  vi.stubEnv('SM_CUSTOMER_PILOT_ENVIRONMENT_ID', environmentId);
  vi.stubEnv('RAILWAY_PROJECT_ID', projectId);
  vi.stubEnv('SM_CUSTOMER_PILOT_PROJECT_ID', projectId);
  vi.stubEnv('NEXT_PUBLIC_SITE_URL', origin);
  vi.stubEnv('NEXT_PUBLIC_API_URL', apiOrigin);
  vi.stubEnv('SM_CUSTOMER_RELAY_SIGNING_KEY', key);
  vi.stubEnv('SM_CUSTOMER_PILOT_ORIGINS', JSON.stringify([origin]));
  vi.stubEnv('SM_CUSTOMER_PILOT_SLUGS', JSON.stringify(['classfood']));
  mockFetch.mockReset();
  vi.stubGlobal('fetch', mockFetch);
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.useRealTimers(); vi.restoreAllMocks(); });

describe('customer account BFF — real handlers, isolated upstream', () => {
  it('preparation is public metadata only, even when a cookie already exists', async () => {
    const current = preparation();
    mockFetch.mockResolvedValue(Response.json({ preparation: current, emitCookie: false }));
    const response = await browser(req('navigateur', 'POST', { step: 'prepare', browserRef },
      { cookie: `${browserCookie}=${browserToken}` }), context);
    expect(response.status).toBe(200); expect(await response.json()).toEqual(current);
    expect(response.headers.get('set-cookie')).toBeNull();
    expect(JSON.parse(String(mockFetch.mock.calls[0]![1]!.body))).toEqual({
      request: { step: 'prepare', browserRef }, browserSecret: null, candidateSecret: null });
  });
  it('refuses legacy empty bootstrap and confirmation without proof, with no network or cookie', async () => {
    expect((await browser(req('navigateur', 'POST', {}), context)).status).toBe(400);
    expect((await browser(req('navigateur', 'POST', { step: 'confirm', browserRef }), context)).status).toBe(401);
    expect(mockFetch).not.toHaveBeenCalled();
  });
  it.each(['', 'not-a-reference', `${browserRef},${browserRef}`])('never adopts a cookie without a canonical journal selector %s', async selected => {
    const response = await session(req('session', 'GET', {}, { 'x-sm-customer-browser-ref': selected,
      cookie: `${browserCookie}=${browserToken}; ${sessionCookie}=${sessionToken}` }), context);
    expect(response.status).toBe(409); expect(mockFetch).not.toHaveBeenCalled();
    expect(response.headers.get('set-cookie')).toBeNull();
  });
  it.each(['prepare', 'confirm'] as const)('refuses an upstream cookie emission during %s', async step => {
    mockFetch.mockResolvedValue(Response.json({ preparation: preparation('issued'), emitCookie: true }));
    const response = await browser(req('navigateur', 'POST', { step, browserRef }, { cookie: `${browserCookie}=${browserToken}` }), context);
    expect(response.status).toBe(503); expect(response.headers.get('set-cookie')).toBeNull();
  });
  it('does not emit on a replayed issue or mismatched reference', async () => {
    mockFetch.mockResolvedValueOnce(Response.json({ preparation: preparation('issued'), emitCookie: false }))
      .mockResolvedValueOnce(Response.json({ preparation: { ...preparation('issued'), browserRef: randomUUID() }, emitCookie: true }));
    const first = await browser(req('navigateur', 'POST', { step: 'issue', browserRef }), context);
    expect(first.status).toBe(200); expect(first.headers.get('set-cookie')).toBeNull();
    const second = await browser(req('navigateur', 'POST', { step: 'issue', browserRef }), context);
    expect(second.status).toBe(503); expect(second.headers.get('set-cookie')).toBeNull();
  });
  it('never renews a recovered session cookie through relative Max-Age or browser re-emission', async () => {
    const current = view(); mockFetch.mockResolvedValue(Response.json({ token: sessionToken, view: current }));
    const response = await recover(req('resultat', 'POST', { challengeId: randomUUID(), checkId: randomUUID() },
      { cookie: `${browserCookie}=${browserToken}` }), context);
    const cookie = response.headers.get('set-cookie')!;
    expect(cookie).toContain(`Expires=${new Date(current.expiresAt).toUTCString()}`);
    expect(cookie).not.toContain('Max-Age'); expect(cookie).not.toContain(browserCookie);
  });
  it.each([
    ['session', session, 'session', 'GET', {}],
    ['name', name, 'profil', 'PATCH', { name: 'Client test', expectedRevision: 0 }],
    ['logout', logout, 'session', 'DELETE', { all: true }],
  ] as const)('requires the browser credential as well as the session for %s', async (_action, handler, path, method, body) => {
    mockFetch.mockResolvedValue(Response.json(view()));
    const response = await handler(req(path, method, body, { cookie: `${sessionCookie}=${sessionToken}` }), context);
    expect(response.status).toBe(401);
    privateHeaders(response); expect(response.headers.get('set-cookie')).toBeNull();
    expect(mockFetch).not.toHaveBeenCalled();
  });
  it.each(['sm_loyalty_classfood', '__Host-sm_customer_browser_other', '__Secure-sm_customer_browser_classfood'])(
    'does not bind a personal session to the unrelated %s cookie', async foreignCookie => {
      const response = await session(req('session', 'GET', {},
        { cookie: `${foreignCookie}=${browserToken}; ${sessionCookie}=${sessionToken}` }), context);
      expect(response.status).toBe(401); expect(mockFetch).not.toHaveBeenCalled();
      expect(response.headers.get('set-cookie')).toBeNull();
    });
  describe('explicit closed paid pilot', () => {
    beforeEach(() => { vi.stubEnv('SM_CUSTOMER_ACCOUNT_MODE', 'closed_paid_pilot'); });
    it('relays capability checks but does not infer spending permission from the mode', async () => {
      mockFetch.mockResolvedValue(Response.json({ available: false }));
      const response = await status(req('capacites', 'GET'), context);
      expect(await response.json()).toEqual({ available: false });
      privateHeaders(response); expect(response.headers.get('set-cookie')).toBeNull();
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect((await browser(req('navigateur'), context)).status).toBe(503);
    });
    it('allows an existing private session without creating a cookie or sending an OTP', async () => {
      const current = view(); mockFetch.mockResolvedValue(Response.json(current));
      const response = await session(req('session', 'GET', {}, { cookie: `${browserCookie}=${browserToken}; ${sessionCookie}=${sessionToken}` }), context);
      expect(response.status).toBe(200); expect(await response.json()).toEqual(current);
      privateHeaders(response); expect(response.headers.get('set-cookie')).toBeNull();
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(mockFetch.mock.calls[0]![0]).toBe(`${apiOrigin}/public/customer/classfood/session`);
      expect(JSON.parse(String(mockFetch.mock.calls[0]![1]!.body))).toEqual({
        browserRef, browserSecret: browserToken, sessionToken, request: {} });
    });
    it.each(['production', 'development', 'test'])('never permits a paid pilot in %s', async environment => {
      vi.stubEnv('RAILWAY_ENVIRONMENT_NAME', environment);
      expect((await browser(req('navigateur'), context)).status).toBe(503);
      expect(mockFetch).not.toHaveBeenCalled();
    });
    it.each(['SM_CUSTOMER_PILOT_ENVIRONMENT_ID', 'SM_CUSTOMER_PILOT_PROJECT_ID',
      'SM_CUSTOMER_PILOT_SLUGS', 'SM_CUSTOMER_PILOT_ORIGINS', 'SM_CUSTOMER_RELAY_SIGNING_KEY'])(
      'keeps the paid pilot closed without %s', async field => {
        vi.stubEnv(field, '');
        expect((await browser(req('navigateur'), context)).status).toBe(503);
        expect(mockFetch).not.toHaveBeenCalled();
      });
  });
  it.each(['', 'paid', 'Full', 'active', 'production', 'closed_paid_pilot ', 'closed_trial,closed_paid_pilot'])(
    'refuses unsupported account mode %j without a fallback', async mode => {
      vi.stubEnv('SM_CUSTOMER_ACCOUNT_MODE', mode);
      expect(await (await status(req('capacites', 'GET'), context)).json()).toEqual({ available: false });
      expect(mockFetch).not.toHaveBeenCalled();
    });
  it.each(['SM_CUSTOMER_RELAY_SIGNING_KEY', 'SM_CUSTOMER_PILOT_ORIGINS', 'SM_CUSTOMER_PILOT_SLUGS'])(
    'stays closed without %s', async field => {
      vi.stubEnv(field, '');
      const response = await status(req('capacites', 'GET'), context);
      expect(await response.json()).toEqual({ available: false });
      privateHeaders(response); expect(mockFetch).not.toHaveBeenCalled();
    });
  it('never opens production or a local fallback', async () => {
    vi.stubEnv('RAILWAY_ENVIRONMENT_NAME', 'production');
    expect((await browser(req('navigateur'), context)).status).toBe(503);
    expect(mockFetch).not.toHaveBeenCalled();
  });
  it('only the admitted issue sets a host-only private browser cookie with absolute expiry', async () => {
    const current = preparation('issued');
    mockFetch.mockResolvedValue(Response.json({ preparation: current, emitCookie: true }));
    const response = await browser(req('navigateur', 'POST', { step: 'issue', browserRef }), context);
    expect(response.status).toBe(200); expect(await response.json()).toEqual(current);
    const cookie = response.headers.get('set-cookie')!;
    expect(cookie).toContain(`${browserCookie}=`); expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('Secure'); expect(cookie).toContain('SameSite=strict');
    expect(cookie).toMatch(/Path=\/;/); expect(cookie).not.toContain('Domain=');
    expect(cookie).toContain(`Expires=${new Date(current.expiresAt).toUTCString()}`); expect(cookie).not.toContain('Max-Age');
    const envelope = JSON.parse(String(mockFetch.mock.calls[0]![1]!.body));
    expect(cookie).toContain(`${browserCookie}=${envelope.candidateSecret}`);
    expect(envelope).toEqual({ request: { step: 'issue', browserRef }, browserSecret: null, candidateSecret: expect.any(String) });
    privateHeaders(response); expect(mockFetch).toHaveBeenCalledTimes(1);
  });
  it('does not rotate an established browser secret on a confirmation retry', async () => {
    mockFetch.mockResolvedValue(Response.json({ preparation: preparation('confirmed'), emitCookie: false }));
    const response = await browser(req('navigateur', 'POST', { step: 'confirm', browserRef }, { cookie: `${browserCookie}=${browserToken}` }), context);
    expect(response.status).toBe(200); expect(response.headers.get('set-cookie')).toBeNull();
  });
  it('never sends before a browser cookie was received in a separate request', async () => {
    const response = await start(req('verification', 'POST', { phone: '+33600000000', operationId: randomUUID(), turnstileToken: 'challenge' }), context);
    expect(response.status).toBe(409); expect(response.headers.get('set-cookie')).toBeNull();
    expect(mockFetch).not.toHaveBeenCalled();
  });
  it.each<Record<string, string>>([{ origin: 'https://evil.example' }, { origin: '' }, { 'sec-fetch-site': 'same-site' },
    { 'x-forwarded-host': 'staging.snackmanager.fr,evil.example', 'x-forwarded-proto': 'https' }])(
    'rejects origin ambiguity before bootstrap %j', async headers => {
      expect((await browser(req('navigateur', 'POST', {}, headers), context)).status).toBe(403);
      expect(mockFetch).not.toHaveBeenCalled();
    });
  it('refuses duplicate cookies rather than choosing an identity', async () => {
    const response = await recover(req('resultat', 'POST', { challengeId: randomUUID(), checkId: randomUUID() },
      { cookie: `${browserCookie}=${browserToken}; ${browserCookie}=${browserToken}` }), context);
    expect(response.status).toBe(409); expect(mockFetch).not.toHaveBeenCalled();
  });
  it('ignores attacker-supplied forwarded-for when edge identity is missing', async () => {
    const response = await browser(req('navigateur', 'POST', {}, { 'x-real-ip': '', 'x-forwarded-for': '192.0.2.11' }), context);
    expect(response.status).toBe(503); expect(mockFetch).not.toHaveBeenCalled();
  });
  it('binds the exact action, body, tenant, origin and opaque source to the dedicated key', async () => {
    mockFetch.mockResolvedValue(Response.json({ available: false }));
    await status(req('capacites', 'GET'), context);
    const [url, init] = mockFetch.mock.calls[0]!;
    expect(url).toBe(`${apiOrigin}/public/customer/classfood/status`);
    expect(init).toMatchObject({ method: 'POST', redirect: 'error', cache: 'no-store', body: '{"request":{}}' });
    const headers = new Headers(init!.headers);
    const source = headers.get('x-sm-customer-client')!;
    const payload = ['customer-v1', headers.get('x-sm-customer-at'), 'classfood', 'status', 'POST',
      '/public/customer/classfood/status', origin, source, createHash('sha256').update(String(init!.body)).digest('hex')].join('\0');
    expect(headers.get('x-sm-customer-proof')).toBe(createHmac('sha256', Buffer.from(key, 'base64')).update(payload).digest('base64url'));
    expect(source).not.toContain('192.0.2.10'); expect(headers.get('cookie')).toBeNull();
  });
  it('check and recover keep their token only in the HttpOnly cookie', async () => {
    for (const [handler, path, body] of [[check, 'confirmation', { challengeId: randomUUID(), checkId: randomUUID(), code: '123456' }],
      [recover, 'resultat', { challengeId: randomUUID(), checkId: randomUUID() }]] as const) {
      const current = view(); mockFetch.mockResolvedValueOnce(Response.json({ token: sessionToken, view: current }));
      const response = await handler(req(path, 'POST', body, { cookie: `${browserCookie}=${browserToken}` }), context);
      expect(response.status).toBe(200); expect(await response.json()).toEqual(current);
      expect(response.headers.get('set-cookie')).toContain(`${sessionCookie}=${sessionToken}`);
      privateHeaders(response);
    }
    expect(String(mockFetch.mock.calls[1]![1]!.body)).not.toContain('123456');
  });
  it('a failed confirmation never removes an existing session', async () => {
    mockFetch.mockResolvedValue(new Response(null, { status: 401 }));
    const response = await check(req('confirmation', 'POST', { challengeId: randomUUID(), checkId: randomUUID(), code: '123456' },
      { cookie: `${browserCookie}=${browserToken}; ${sessionCookie}=${sessionToken}` }), context);
    expect(response.status).toBe(401); expect(response.headers.get('set-cookie')).toBeNull();
  });
  it('a session 401 does not mutate cookies from a potentially newer confirmation', async () => {
    mockFetch.mockResolvedValue(new Response(null, { status: 401 }));
    const response = await session(req('session', 'GET', {}, { cookie: `${browserCookie}=${browserToken}; ${sessionCookie}=${sessionToken}` }), context);
    expect(response.status).toBe(401); expect(response.headers.get('set-cookie')).toBeNull();
  });
  it('an uncertain logout preserves the cookie until server revocation is known', async () => {
    mockFetch.mockRejectedValue(new Error('provider detail must not leak'));
    const response = await logout(req('session', 'DELETE', { all: false }, { cookie: `${browserCookie}=${browserToken}; ${sessionCookie}=${sessionToken}` }), context);
    expect(response.status).toBe(503); expect(response.headers.get('set-cookie')).toBeNull();
    expect(await response.text()).not.toContain('provider detail');
  });
  it('confirmed logout acknowledges server revocation without mutating newer browser cookies', async () => {
    mockFetch.mockResolvedValue(new Response(null, { status: 204 }));
    const response = await logout(req('session', 'DELETE', { all: false }, { cookie: `${browserCookie}=${browserToken}; ${sessionCookie}=${sessionToken}` }), context);
    expect(response.status).toBe(204); expect(response.headers.get('set-cookie')).toBeNull();
    expect(JSON.parse(String(mockFetch.mock.calls[0]![1]!.body))).toEqual({ browserRef, browserSecret: browserToken, sessionToken, request: { all: false } });
  });
  it('rejects stale/overbroad upstream profiles without copying secrets or setting a cookie', async () => {
    mockFetch.mockResolvedValue(Response.json({ token: sessionToken, view: { ...view(), accountId: randomUUID() } }));
    const response = await recover(req('resultat', 'POST', { challengeId: randomUUID(), checkId: randomUUID() },
      { cookie: `${browserCookie}=${browserToken}` }), context);
    expect(response.status).toBe(503); expect(response.headers.get('set-cookie')).toBeNull();
  });
  it('strictly refuses client-controlled envelope identity fields', async () => {
    const response = await name(req('profil', 'PATCH', { name: 'Test', expectedRevision: 0, sessionToken },
      { cookie: `${browserCookie}=${browserToken}; ${sessionCookie}=${sessionToken}` }), context);
    expect(response.status).toBe(400); expect(mockFetch).not.toHaveBeenCalled();
  });
  it.each(['SM_CUSTOMER_ACCOUNT_MODE', 'RAILWAY_PROJECT_ID', 'RAILWAY_ENVIRONMENT_ID',
    'SM_CUSTOMER_PILOT_ENVIRONMENT_ID', 'SM_CUSTOMER_PILOT_PROJECT_ID'])(
    'has no runtime fallback when %s is absent', async field => {
      vi.stubEnv(field, '');
      expect(await (await status(req('capacites', 'GET'), context)).json()).toEqual({ available: false });
      expect(mockFetch).not.toHaveBeenCalled();
    });
  it.each(['development', 'production', 'test'])('refuses contradictory SM_ENV=%s', async environment => {
    vi.stubEnv('SM_ENV', environment);
    expect((await browser(req('navigateur'), context)).status).toBe(503);
    expect(mockFetch).not.toHaveBeenCalled();
  });
  it.each(['[]', 'null', '["classfood", "classfood"]', '["classfood/other"]'])(
    'rejects malformed/empty pilot configuration %s', async slugs => {
      vi.stubEnv('SM_CUSTOMER_PILOT_SLUGS', slugs);
      expect(await (await status(req('capacites', 'GET'), context)).json()).toEqual({ available: false });
      expect(mockFetch).not.toHaveBeenCalled();
    });
  it('a refused capability does not create a browser identity', async () => {
    mockFetch.mockResolvedValue(Response.json({ available: false }));
    const response = await browser(req('navigateur'), context);
    expect(response.status).toBe(503); expect(response.headers.get('set-cookie')).toBeNull();
  });
  it('status hides an upstream outage and never advertises a login', async () => {
    mockFetch.mockRejectedValue(new Error('private provider failure'));
    const response = await status(req('capacites', 'GET'), context);
    expect(await response.json()).toEqual({ available: false }); privateHeaders(response);
  });
  it.each(['https://staging.snackmanager.fr/', 'https://staging.snackmanager.fr,https://evil.example', 'null'])(
    'refuses a noncanonical Origin %s', async value => {
      expect((await browser(req('navigateur', 'POST', {}, { origin: value }), context)).status).toBe(403);
      expect(mockFetch).not.toHaveBeenCalled();
    });
  it('refuses HTTP despite a matching Host and a supposedly staging configuration', async () => {
    const insecure = new NextRequest('http://staging.snackmanager.fr/r/classfood/compte/navigateur', {
      method: 'POST', body: '{}', headers: req('navigateur').headers });
    expect((await browser(insecure, context)).status).toBe(403); expect(mockFetch).not.toHaveBeenCalled();
  });
  it('a custom origin is resolved afresh before any account envelope is signed', async () => {
    const custom = 'https://restaurant.example.test';
    vi.stubEnv('SM_CUSTOMER_PILOT_ORIGINS', JSON.stringify([custom]));
    mockFetch.mockResolvedValueOnce(Response.json({ slug: 'classfood' }))
      .mockResolvedValueOnce(Response.json({ available: true }));
    const request = new NextRequest(`${custom}/r/classfood/compte/capacites`, {
      headers: { host: 'restaurant.example.test', origin: custom, 'x-real-ip': '192.0.2.10' } });
    const response = await status(request, context);
    expect(await response.json()).toEqual({ available: true });
    expect(mockFetch.mock.calls[0]![0]).toBe(`${apiOrigin}/public/resolve?host=restaurant.example.test`);
    expect(new Headers(mockFetch.mock.calls[0]![1]!.headers).has('x-sm-customer-proof')).toBe(false);
    expect(new Headers(mockFetch.mock.calls[1]![1]!.headers).get('x-sm-customer-origin')).toBe(custom);
  });
  it('a mismatched custom domain never reaches a private account endpoint', async () => {
    const custom = 'https://restaurant.example.test';
    vi.stubEnv('SM_CUSTOMER_PILOT_ORIGINS', JSON.stringify([custom]));
    mockFetch.mockResolvedValueOnce(Response.json({ slug: 'different-tenant' }));
    const request = new NextRequest(`${custom}/r/classfood/compte/capacites`, {
      headers: { host: 'restaurant.example.test', origin: custom, 'x-real-ip': '192.0.2.10', 'x-sm-tenant': 'classfood' } });
    expect((await status(request, context)).status).toBe(403); expect(mockFetch).toHaveBeenCalledTimes(1);
  });
  it('canonicalizes mapped IPv6 to the same quota source as IPv4, independent of XFF', async () => {
    const sources: string[] = [];
    mockFetch.mockImplementation(async (_url, init) => {
      sources.push(new Headers(init!.headers).get('x-sm-customer-client')!);
      return Response.json({ available: false });
    });
    for (const ip of ['192.0.2.10', '::ffff:192.0.2.10', '0:0:0:0:0:ffff:c000:020a']) {
      await status(req('capacites', 'GET', {}, { 'x-real-ip': ip, 'x-forwarded-for': randomUUID() }), context);
    }
    expect(new Set(sources).size).toBe(1);
  });
  it.each(['192.0.2.10,192.0.2.11', '127.1', '::1%scope', 'not-an-ip'])(
    'fails closed for an invalid edge identity %s', async ip => {
      expect((await browser(req('navigateur', 'POST', {}, { 'x-real-ip': ip }), context)).status).toBe(503);
      expect(mockFetch).not.toHaveBeenCalled();
    });
  it.each(['sm_loyalty_classfood', '__Secure-sm_customer_browser_classfood', '__Host-sm_customer_browser_other'])(
    'does not adopt the %s cookie as browser identity', async otherCookie => {
      const response = await recover(req('resultat', 'POST', { challengeId: randomUUID(), checkId: randomUUID() },
        { cookie: `${otherCookie}=${browserToken}` }), context);
      expect(response.status).toBe(409); expect(mockFetch).not.toHaveBeenCalled();
    });
  it('recover rejects an OTP or other extra input rather than forwarding it', async () => {
    const response = await recover(req('resultat', 'POST', { challengeId: randomUUID(), checkId: randomUUID(), code: '123456' },
      { cookie: `${browserCookie}=${browserToken}` }), context);
    expect(response.status).toBe(400); expect(mockFetch).not.toHaveBeenCalled();
  });
  it('rejects both declared and streamed oversized bodies before upstream', async () => {
    const variants: Record<string, string>[] = [{ 'content-length': '9000' }, {}];
    for (const headers of variants) {
      const response = await start(req('verification', 'POST', { phone: '+33600000000', operationId: randomUUID(), turnstileToken: 'x'.repeat(9_000) },
        { ...headers, cookie: `${browserCookie}=${browserToken}` }), context);
      expect(response.status).toBe(400);
    }
    expect(mockFetch).not.toHaveBeenCalled();
  });
  it('does not retry a lost start response or change the operation/body on explicit retry', async () => {
    const body = { phone: '+33600000000', operationId: randomUUID(), turnstileToken: 'challenge' };
    mockFetch.mockRejectedValueOnce(new Error('answer lost')).mockResolvedValueOnce(Response.json({ challengeId: randomUUID(), expiresAt: Date.now() + 60_000 }));
    expect((await start(req('verification', 'POST', body, { cookie: `${browserCookie}=${browserToken}` }), context)).status).toBe(503);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect((await start(req('verification', 'POST', body, { cookie: `${browserCookie}=${browserToken}` }), context)).status).toBe(200);
    expect(mockFetch.mock.calls[0]![1]!.body).toBe(mockFetch.mock.calls[1]![1]!.body);
  });
  it('a late old-session 401 cannot erase a concurrently confirmed session', async () => {
    let answer!: (response: Response) => void;
    mockFetch.mockImplementationOnce(() => new Promise(resolve => { answer = resolve; }));
    const old = session(req('session', 'GET', {}, { cookie: `${browserCookie}=${browserToken}; ${sessionCookie}=${sessionToken}` }), context);
    await vi.waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));
    const fresh = randomBytes(32).toString('base64url');
    mockFetch.mockResolvedValueOnce(Response.json({ token: fresh, view: view() }));
    const newer = await recover(req('resultat', 'POST', { challengeId: randomUUID(), checkId: randomUUID() },
      { cookie: `${browserCookie}=${browserToken}` }), context);
    expect(newer.headers.get('set-cookie')).toContain(fresh);
    answer(new Response(null, { status: 401 }));
    expect((await old).headers.get('set-cookie')).toBeNull();
  });
  it('a late old-session logout cannot erase a concurrently confirmed session', async () => {
    let answer!: (response: Response) => void;
    mockFetch.mockImplementationOnce(() => new Promise(resolve => { answer = resolve; }));
    const old = logout(req('session', 'DELETE', { all: false }, { cookie: `${browserCookie}=${browserToken}; ${sessionCookie}=${sessionToken}` }), context);
    await vi.waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));
    const fresh = randomBytes(32).toString('base64url');
    mockFetch.mockResolvedValueOnce(Response.json({ token: fresh, view: view() }));
    const newer = await recover(req('resultat', 'POST', { challengeId: randomUUID(), checkId: randomUUID() },
      { cookie: `${browserCookie}=${browserToken}` }), context);
    expect(newer.headers.get('set-cookie')).toContain(fresh);
    answer(new Response(null, { status: 204 }));
    expect((await old).headers.get('set-cookie')).toBeNull();
  });
  it('bounds a silent upstream including a body that never finishes, without a retry', async () => {
    const deadline = new AbortController();
    const timeout = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(deadline.signal);
    const cancelled = vi.fn();
    mockFetch.mockResolvedValue(new Response(new ReadableStream({ cancel: cancelled }), { headers: { 'Content-Type': 'application/json' } }));
    try {
      const pending = session(req('session', 'GET', {}, { cookie: `${browserCookie}=${browserToken}; ${sessionCookie}=${sessionToken}` }), context);
      await vi.waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));
      deadline.abort();
      const response = await pending;
      expect(timeout).toHaveBeenCalledWith(10_000);
      expect(response.status).toBe(503); expect(response.headers.get('set-cookie')).toBeNull();
      expect(mockFetch).toHaveBeenCalledTimes(1); expect(cancelled).toHaveBeenCalledTimes(1);
    } finally { timeout.mockRestore(); }
  });
  it.each([0, 999, 604_800_001])('refuses an unusable or excessive session lifetime %d ms', async remaining => {
    vi.spyOn(Date, 'now').mockReturnValue(Date.now());
    const current = view(); current.expiresAt = Date.now() + remaining;
    mockFetch.mockResolvedValue(Response.json({ token: sessionToken, view: current }));
    const response = await recover(req('resultat', 'POST', { challengeId: randomUUID(), checkId: randomUUID() },
      { cookie: `${browserCookie}=${browserToken}` }), context);
    expect(response.status).toBe(503); expect(response.headers.get('set-cookie')).toBeNull();
  });
  it('refuses a challenge beyond the ten-minute policy instead of extending it', async () => {
    mockFetch.mockResolvedValue(Response.json({ challengeId: randomUUID(), expiresAt: Date.now() + 601_000 }));
    const response = await start(req('verification', 'POST', { phone: '+33600000000', operationId: randomUUID(), turnstileToken: 'challenge' },
      { cookie: `${browserCookie}=${browserToken}` }), context);
    expect(response.status).toBe(503);
  });
  it('also bounds a silent upstream that never sends HTTP headers', async () => {
    const deadline = new AbortController();
    const timeout = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(deadline.signal);
    mockFetch.mockImplementation(() => new Promise(() => undefined));
    try {
      const pending = session(req('session', 'GET', {}, { cookie: `${browserCookie}=${browserToken}; ${sessionCookie}=${sessionToken}` }), context);
      await vi.waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));
      deadline.abort();
      const response = await pending;
      expect(response.status).toBe(503); privateHeaders(response);
      expect(mockFetch).toHaveBeenCalledTimes(1);
    } finally { timeout.mockRestore(); }
  });
  it('a disconnected browser cancels the whole operation without creating a retry', async () => {
    const disconnect = new AbortController();
    mockFetch.mockImplementation(() => new Promise(() => undefined));
    const request = new NextRequest(req('session', 'GET', {}, { cookie: `${browserCookie}=${browserToken}; ${sessionCookie}=${sessionToken}` }), { signal: disconnect.signal });
    const pending = session(request, context);
    await vi.waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));
    disconnect.abort();
    expect((await pending).status).toBe(503);
    expect(mockFetch.mock.calls[0]![1]!.signal!.aborted).toBe(true);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
  it.each(['text/html', 'text/plain', 'application/javascript'])(
    'refuses a non-JSON content type %s without an upstream request', async contentType => {
      const response = await browser(req('navigateur', 'POST', {}, { 'content-type': contentType }), context);
      expect(response.status).toBe(400); privateHeaders(response);
      expect(CustomerAccountErrorSchema.safeParse(await response.json()).success).toBe(true);
      expect(mockFetch).not.toHaveBeenCalled();
    });
  it('refuses query identities and an envelope sent to a different exact route', async () => {
    for (const url of [`${origin}/r/classfood/compte/session?token=${sessionToken}`, `${origin}/r/classfood/compte/session/nested`]) {
      const response = await session(new NextRequest(url, { headers: req('session', 'GET').headers }), context);
      expect(response.status).toBe(400);
    }
    expect(mockFetch).not.toHaveBeenCalled();
  });
  it('never accepts an oversized upstream response even if its prefix resembles a session', async () => {
    mockFetch.mockResolvedValue(new Response(JSON.stringify({ ...view(), private: 'x'.repeat(17_000) }),
      { headers: { 'Content-Type': 'application/json' } }));
    const response = await session(req('session', 'GET', {}, { cookie: `${browserCookie}=${browserToken}; ${sessionCookie}=${sessionToken}` }), context);
    expect(response.status).toBe(503); expect(response.headers.get('set-cookie')).toBeNull();
    expect((await response.text()).length).toBeLessThan(250);
  });
  it.each([400, 401, 403, 409, 429, 500, 503])('projects upstream %d into bounded fixed errors without private details', async upstreamStatus => {
    mockFetch.mockResolvedValue(Response.json({ message: 'private diagnostic', token: sessionToken, phone: '+33600000000' },
      { status: upstreamStatus, headers: { 'Retry-After': '999', 'Set-Cookie': 'upstream=secret' } }));
    const response = await session(req('session', 'GET', {}, { cookie: `${browserCookie}=${browserToken}; ${sessionCookie}=${sessionToken}` }), context);
    privateHeaders(response);
    expect(CustomerAccountErrorSchema.safeParse(await response.clone().json()).success).toBe(true);
    const body = await response.text();
    expect(body).not.toContain('private diagnostic'); expect(body).not.toContain(sessionToken);
    expect(response.headers.get('set-cookie')).toBeNull();
    expect(response.headers.get('retry-after')).toBe(upstreamStatus === 429 ? '300' : null);
  });
  it('never converts an overbroad capability into permission to bootstrap', async () => {
    mockFetch.mockResolvedValue(Response.json({ available: true, secret: sessionToken }));
    const response = await browser(req('navigateur'), context);
    expect(response.status).toBe(503); expect(response.headers.get('set-cookie')).toBeNull();
  });
  it('changes a name only through the protected exact envelope and projects the verified result', async () => {
    const current = view(); current.profile.name = 'Nom choisi'; current.profile.revision = 2;
    mockFetch.mockResolvedValue(Response.json(current));
    const response = await name(req('profil', 'PATCH', { name: 'Nom choisi', expectedRevision: 1 },
      { cookie: `${browserCookie}=${browserToken}; ${sessionCookie}=${sessionToken}` }), context);
    expect(response.status).toBe(200); expect(await response.json()).toEqual(current);
    expect(JSON.parse(String(mockFetch.mock.calls[0]![1]!.body))).toEqual({
      browserRef, browserSecret: browserToken, sessionToken, request: { name: 'Nom choisi', expectedRevision: 1 } });
    expect(response.headers.get('set-cookie')).toBeNull();
  });
});
