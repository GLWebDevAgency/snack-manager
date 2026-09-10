import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto';
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CUSTOMER_LOYALTY_NOTICE_VERSION, CUSTOMER_LOYALTY_ATTACHMENT_NOTICE_VERSION, customerAccountResponseLimit } from '@sm/contracts';
import { customerAccount } from './customer-bff';

const origin = 'https://staging.snackmanager.fr', api = 'https://customer-api.example.test';
const browserRef = randomUUID(), expectedOperationId = randomUUID(), expectedCheckId = randomUUID();
const browserSecret = randomBytes(32).toString('base64url'), sessionToken = randomBytes(32).toString('base64url');
const cookies = `__Host-sm_customer_browser_classfood=${browserSecret}; __Host-sm_customer_session_classfood=${sessionToken}`;
const context = { params: Promise.resolve({ slug: 'classfood' }) }, upstream = vi.fn<typeof fetch>();
const join = { step: 'join', operationId: randomUUID(), programId: randomUUID(), rulesVersion: 1,
  termsNoticeVersion: CUSTOMER_LOYALTY_NOTICE_VERSION, termsAccepted: true };
const attach = { ...join, step: 'attach', termsNoticeVersion: CUSTOMER_LOYALTY_ATTACHMENT_NOTICE_VERSION, qrToken: randomBytes(32).toString('base64url') };
const program = { id: join.programId, version: 1, name: 'Les habitués', mechanism: 'points', termsSummary: 'Conditions du restaurant.', unitLabelSingular: 'point', unitLabelPlural: 'points' };
const member = { id: randomUUID(), joinedAt: '2026-09-09T12:00:00.000Z', qrGeneration: 1, balanceUnits: 0, unitLabelSingular: 'point', unitLabelPlural: 'points' };
function request(body: unknown = { step: 'view' }, headers: Record<string, string> = {}) {
  return new NextRequest(`${origin}/r/classfood/compte/fidelite`, { method: 'POST', headers: { origin, host: new URL(origin).host,
    'sec-fetch-site': 'same-origin', 'content-type': 'application/json', 'x-real-ip': '192.0.2.10',
    'x-sm-customer-browser-ref': browserRef, 'x-sm-customer-operation-id': expectedOperationId, 'x-sm-customer-check-id': expectedCheckId,
    cookie: cookies, ...headers }, body: JSON.stringify(body) });
}
beforeEach(() => {
  const environment = randomUUID(), project = randomUUID();
  for (const [key, value] of Object.entries({ RAILWAY_ENVIRONMENT_NAME: 'staging', SM_ENV: 'staging', SM_CUSTOMER_ACCOUNT_MODE: 'closed_trial',
    RAILWAY_ENVIRONMENT_ID: environment, SM_CUSTOMER_PILOT_ENVIRONMENT_ID: environment, RAILWAY_PROJECT_ID: project, SM_CUSTOMER_PILOT_PROJECT_ID: project,
    NEXT_PUBLIC_API_URL: api, SM_CUSTOMER_RELAY_SIGNING_KEY: randomBytes(32).toString('base64'),
    SM_CUSTOMER_PILOT_ORIGINS: JSON.stringify([origin]), SM_CUSTOMER_PILOT_SLUGS: '["classfood"]' })) vi.stubEnv(key, value);
  upstream.mockReset(); vi.stubGlobal('fetch', upstream);
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
describe('private loyalty BFF — isolated upstream, real handler', () => {
  it.each(['view', 'join', 'attach', 'card'] as const)('%s carries only the strict request and signed current authority', async step => {
    const body = step === 'join' ? join : step === 'attach' ? attach : { step };
    const output = { expiresAt: Date.now() + 60_000, ...(step === 'view' ? { state: 'available', program, profileReady: true }
      : step === 'card' ? { state: 'card', member, qrToken: randomBytes(32).toString('base64url') } : { state: 'member', member }) };
    upstream.mockResolvedValue(Response.json(output));
    const response = await customerAccount(request(body), context, 'loyalty');
    expect(response.status).toBe(200); expect(await response.json()).toEqual(output);
    expect(response.headers.get('set-cookie')).toBeNull(); expect(response.headers.get('cache-control')).toContain('private, no-store');
    const sent = upstream.mock.calls[0]!;
    expect(sent[0]).toBe(`${api}/public/customer/classfood/loyalty`);
    expect(JSON.parse(String(sent[1]!.body))).toEqual({ request: body, browserRef, browserSecret, sessionToken, expectedOperationId, expectedCheckId });
    const headers = new Headers(sent[1]!.headers), key = Buffer.from(process.env.SM_CUSTOMER_RELAY_SIGNING_KEY!, 'base64');
    const payload = ['customer-v1', headers.get('x-sm-customer-at'), 'classfood', 'loyalty', 'POST', '/public/customer/classfood/loyalty', origin,
      headers.get('x-sm-customer-client'), createHash('sha256').update(String(sent[1]!.body)).digest('hex')].join('\0');
    expect(headers.get('x-sm-customer-proof')).toBe(createHmac('sha256', key).update(payload).digest('base64url'));
  });
  it.each(['phone', 'accountId', 'memberId', 'marketing', 'sessionToken'] as const)('rejects attachment authority injection %s before upstream', async field => {
    expect((await customerAccount(request({ ...attach, [field]: 'not-authority' }), context, 'loyalty')).status).toBe(400);
    expect(upstream).not.toHaveBeenCalled();
  });
  it('requires a canonical raw attachment QR, exact notice and fresh explicit consent', async () => {
    for (const body of [{ ...attach, qrToken: 'A'.repeat(42) + 'B' }, { ...attach, qrToken: `https://example.test/#card=${attach.qrToken}` },
      { ...attach, qrToken: undefined }, { ...attach, termsAccepted: false }, { ...attach, termsNoticeVersion: CUSTOMER_LOYALTY_NOTICE_VERSION }]) {
      expect((await customerAccount(request(body), context, 'loyalty')).status).toBe(400);
    }
    expect(upstream).not.toHaveBeenCalled();
  });
  it('returns uniform attachment refusal without QR, cookie or private extra fields', async () => {
    const output = { state: 'attachment_refused', expiresAt: Date.now() + 60_000 };
    upstream.mockResolvedValue(Response.json(output));
    const response = await customerAccount(request(attach), context, 'loyalty');
    expect(response.status).toBe(200); expect(await response.json()).toEqual(output);
    expect(response.headers.get('set-cookie')).toBeNull(); expect(response.headers.get('cache-control')).toContain('private, no-store');
  });
  it('never forwards an unsolicited card after attachment', async () => {
    upstream.mockResolvedValue(Response.json({ state: 'card', member, qrToken: attach.qrToken, expiresAt: Date.now() + 60_000 }));
    const response = await customerAccount(request(attach), context, 'loyalty');
    expect(response.status).toBe(503); expect(await response.text()).not.toContain(attach.qrToken); expect(response.headers.get('set-cookie')).toBeNull();
  });
  it.each([['CJK', '界'.repeat(6000)], ['JSON-escaped controls', '\u0001'.repeat(6000)]])('preserves a valid 6000-character %s terms DTO within the bounded transport', async (_label, termsSummary) => {
    const output = { state: 'available', expiresAt: Date.now() + 60_000, program: { ...program, termsSummary }, profileReady: true };
    const encoded = JSON.stringify(output);
    expect(Buffer.byteLength(encoded)).toBeGreaterThan(16_384);
    expect(Buffer.byteLength(encoded)).toBeLessThanOrEqual(customerAccountResponseLimit('loyalty'));
    upstream.mockResolvedValue(new Response(encoded, { headers: { 'content-type': 'application/json', 'content-length': String(Buffer.byteLength(encoded)) } }));
    const response = await customerAccount(request(), context, 'loyalty');
    expect(response.status).toBe(200); expect(await response.json()).toEqual(output);
    expect(response.headers.get('cache-control')).toContain('private, no-store'); expect(response.headers.get('set-cookie')).toBeNull();
    expect(upstream).toHaveBeenCalledTimes(1);
  });
  it.each(['phone', 'accountId', 'memberId', 'qrToken', 'marketing', 'sessionToken'])('refuses browser injection %s before upstream', async field => {
    expect((await customerAccount(request({ ...join, [field]: 'private-fixture' }), context, 'loyalty')).status).toBe(400);
    expect(upstream).not.toHaveBeenCalled();
  });
  it('requires both cookies, unambiguous selectors and same-origin', async () => {
    for (const [headers, status] of [[{ cookie: '' }, 401], [{ cookie: `${cookies}; __Host-sm_customer_session_classfood=${sessionToken}` }, 409],
      [{ 'x-sm-customer-operation-id': '' }, 409], [{ 'x-sm-customer-check-id': '' }, 409], [{ 'x-sm-customer-browser-ref': '' }, 409],
      [{ origin: 'https://other.example.test' }, 403]] as const) {
      expect((await customerAccount(request({ step: 'view' }, headers), context, 'loyalty')).status).toBe(status);
    }
    expect(upstream).not.toHaveBeenCalled();
  });
  it('requires current notice and explicit acceptance', async () => {
    for (const body of [{ ...join, termsAccepted: false }, { ...join, termsNoticeVersion: 'old' }, { ...join, operationId: undefined }]) {
      expect((await customerAccount(request(body), context, 'loyalty')).status).toBe(400);
    }
    expect(upstream).not.toHaveBeenCalled();
  });
  it.each(['expired', 'private-extra', 'oversized', 'unsolicited-card'] as const)('refuses %s without exposing the response', async fault => {
    const marker = randomBytes(32).toString('base64url');
    const output = fault === 'unsolicited-card' ? { state: 'card', member, qrToken: marker, expiresAt: Date.now() + 60_000 }
      : { state: 'member', member, expiresAt: Date.now() + (fault === 'expired' ? -1 : 60_000), ...(fault === 'private-extra' ? { token: marker } : {}) };
    upstream.mockResolvedValue(fault === 'oversized' ? new Response(' '.repeat(customerAccountResponseLimit('loyalty') + 1), { headers: { 'content-type': 'application/json' } }) : Response.json(output));
    const response = await customerAccount(request(join), context, 'loyalty');
    expect(response.status).toBe(503); expect(await response.text()).not.toContain(marker); expect(response.headers.get('set-cookie')).toBeNull();
  });
  it.each([401, 409, 429, 503])('preserves refusal %s without retry or cookie writes', async status => {
    upstream.mockResolvedValue(new Response(null, { status }));
    const response = await customerAccount(request(), context, 'loyalty');
    expect(response.status).toBe(status); expect(response.headers.get('set-cookie')).toBeNull(); expect(upstream).toHaveBeenCalledTimes(1);
  });
  it('stays closed before reading any provider configuration outside the pilot', async () => {
    vi.stubEnv('RAILWAY_ENVIRONMENT_NAME', 'production');
    expect((await customerAccount(request(), context, 'loyalty')).status).toBe(503); expect(upstream).not.toHaveBeenCalled();
  });
});
