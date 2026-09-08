import { randomBytes, randomUUID } from 'node:crypto';
import { NextRequest } from 'next/server';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { customerAccount } from './customer-bff';

const origin = 'https://staging.snackmanager.fr', api = 'https://customer-api.example.test';
const browserRef = randomUUID(), operationId = randomUUID(), checkId = randomUUID(), activationId = randomUUID();
const browserSecret = randomBytes(32).toString('base64url'), intentProof = randomBytes(32).toString('base64url');
const sessionToken = randomBytes(32).toString('base64url');
const browserCookie = '__Host-sm_customer_browser_classfood', sessionCookie = '__Host-sm_customer_session_classfood';
const proofCookie = `__Host-sm_customer_intent_classfood_${operationId}`;
const cookies = `${browserCookie}=${browserSecret}; ${proofCookie}=${intentProof}`;
const context = { params: Promise.resolve({ slug: 'classfood' }) };
const upstream = vi.fn<typeof fetch>();
const enrollment = () => ({ operationId, checkId, expiresAt: Date.now() + 60_000, stage: 'registration_required', recoveryVersion: 0 });
const view = () => ({ expiresAt: Date.now() + 60_000, profile: { name: null, phoneE164: '+33600000000', phoneVerifiedAt: Date.now() - 1_000, revision: 0 } });
function req(body: Record<string, unknown> = { step: 'state', operationId, checkId }, override: Record<string, string> = {}, action = 'protection') {
  return new NextRequest(`${origin}/r/classfood/compte/${action}`, { method: 'POST',
    headers: { origin, host: new URL(origin).host, 'sec-fetch-site': 'same-origin', 'content-type': 'application/json',
      'x-real-ip': '192.0.2.10', 'x-sm-customer-browser-ref': browserRef, cookie: cookies, ...override }, body: JSON.stringify(body) });
}
beforeEach(() => {
  const env = randomUUID(), project = randomUUID();
  for (const [key, value] of Object.entries({ RAILWAY_ENVIRONMENT_NAME: 'staging', SM_ENV: 'staging', SM_CUSTOMER_ACCOUNT_MODE: 'closed_trial',
    RAILWAY_ENVIRONMENT_ID: env, SM_CUSTOMER_PILOT_ENVIRONMENT_ID: env, RAILWAY_PROJECT_ID: project, SM_CUSTOMER_PILOT_PROJECT_ID: project,
    NEXT_PUBLIC_API_URL: api, SM_CUSTOMER_RELAY_SIGNING_KEY: randomBytes(32).toString('base64'),
    SM_CUSTOMER_PILOT_ORIGINS: JSON.stringify([origin]), SM_CUSTOMER_PILOT_SLUGS: '["classfood"]' })) vi.stubEnv(key, value);
  upstream.mockReset(); vi.stubGlobal('fetch', upstream);
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
describe('protected enrollment BFF — real handler, isolated upstream', () => {
  it('relays only the exact browser and intent capability, never the existing session', async () => {
    const output = { state: 'enrollment', enrollment: enrollment() }; upstream.mockResolvedValue(Response.json(output));
    const response = await customerAccount(req(undefined, { cookie: `${cookies}; ${sessionCookie}=${sessionToken}` }), context, 'protection');
    expect(response.status).toBe(200); expect(await response.json()).toEqual(output);
    expect(response.headers.get('set-cookie')).toBeNull();
    expect(response.headers.get('cache-control')).toBe('private, no-store, max-age=0');
    expect(JSON.parse(String(upstream.mock.calls[0]![1]!.body))).toEqual({ request: { step: 'state', operationId, checkId }, browserRef, browserSecret, intentProof });
    expect(upstream.mock.calls[0]![0]).toBe(`${api}/public/customer/classfood/protection`);
  });
  it('OTP enrollment never emits a personal cookie or private profile', async () => {
    const output = { state: 'enrollment', enrollment: enrollment() }; upstream.mockResolvedValue(Response.json(output));
    const response = await customerAccount(req({ operationId, challengeId: randomUUID(), checkId, code: '123456' }, {}, 'confirmation'), context, 'check');
    expect(response.status).toBe(200); expect(await response.json()).toEqual(output); expect(response.headers.get('set-cookie')).toBeNull();
  });
  it.each(['cookie', 'x-sm-customer-browser-ref'])('refuses a missing %s before any upstream call', async header => {
    const request = req(); request.headers.delete(header);
    const response = await customerAccount(request, context, 'protection');
    expect([401, 409]).toContain(response.status); expect(upstream).not.toHaveBeenCalled();
  });
  it('refuses a same-shaped proof for another intent and duplicate proofs', async () => {
    for (const cookie of [`${browserCookie}=${browserSecret}; __Host-sm_customer_intent_classfood_${randomUUID()}=${intentProof}`,
      `${cookies}; ${proofCookie}=${intentProof}`]) {
      const response = await customerAccount(req(undefined, { cookie }), context, 'protection');
      expect([401, 409]).toContain(response.status); expect(response.headers.get('set-cookie')).toBeNull();
    }
    expect(upstream).not.toHaveBeenCalled();
  });
  it('keeps strict CSRF', async () => {
    const response = await customerAccount(req(undefined, { origin: 'https://other.example.test' }), context, 'protection');
    expect(response.status).toBe(403); expect(upstream).not.toHaveBeenCalled();
  });
  it.each(['operation', 'check', 'expired', 'too-long', 'private-field'])('refuses enrollment %s without cookie changes', async fault => {
    const current = enrollment();
    if (fault === 'operation') current.operationId = randomUUID();
    if (fault === 'check') current.checkId = randomUUID();
    if (fault === 'expired') current.expiresAt = Date.now() - 1;
    if (fault === 'too-long') current.expiresAt = Date.now() + 601_000;
    const output = { state: 'enrollment', enrollment: current, ...(fault === 'private-field' ? { view: view() } : {}) };
    upstream.mockResolvedValue(Response.json(output));
    const response = await customerAccount(req(), context, 'protection');
    expect(response.status).toBe(503); expect(response.headers.get('set-cookie')).toBeNull();
  });
  it('emits the opaque session only for the exact activation receipt and strips its token', async () => {
    const current = view(); upstream.mockResolvedValue(Response.json({ state: 'authenticated', operationId, activationId, token: sessionToken, view: current }));
    const response = await customerAccount(req({ step: 'activation-result', operationId, checkId, activationId }), context, 'protection');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ state: 'authenticated', operationId, activationId, view: current });
    const cookie = response.headers.get('set-cookie')!;
    expect(cookie).toContain(sessionCookie); expect(cookie).toContain('HttpOnly'); expect(cookie).toContain('Secure'); expect(cookie).toMatch(/SameSite=strict/i);
    expect(cookie).not.toMatch(/Max-Age|Domain=/i); expect(cookie).not.toContain(browserCookie); expect(cookie).not.toContain(proofCookie);
  });
  it.each(['operation', 'activation', 'wrong-step', 'expired'])('refuses an authenticated %s mismatch', async fault => {
    const current = view(); if (fault === 'expired') current.expiresAt = Date.now() - 1;
    upstream.mockResolvedValue(Response.json({ state: 'authenticated', operationId: fault === 'operation' ? randomUUID() : operationId,
      activationId: fault === 'activation' ? randomUUID() : activationId, token: sessionToken, view: current }));
    const response = await customerAccount(req(fault === 'wrong-step' ? undefined : { step: 'activation-result', operationId, checkId, activationId }), context, 'protection');
    expect(response.status).toBe(503); expect(response.headers.get('set-cookie')).toBeNull();
  });
  it('allows bounded WebAuthn attestation larger than the legacy 8KiB request limit', async () => {
    upstream.mockResolvedValue(Response.json({ state: 'enrollment', enrollment: { ...enrollment(), stage: 'assertion_required' } }));
    const response = await customerAccount(req({ step: 'register', operationId, checkId, registrationId: randomUUID(),
      response: { id: 'AQ', rawId: 'AQ', type: 'public-key', clientExtensionResults: {}, response: {
        attestationObject: randomBytes(9_000).toString('base64url'), clientDataJSON: 'AQ' } } }), context, 'protection');
    expect(response.status).toBe(200); expect(upstream).toHaveBeenCalledTimes(1);
  });
  it.each([401, 409, 503])('retains every cookie on %s and never retries', async status => {
    upstream.mockResolvedValue(new Response(null, { status }));
    const response = await customerAccount(req(), context, 'protection');
    expect(response.status).toBe(status); expect(response.headers.get('set-cookie')).toBeNull(); expect(upstream).toHaveBeenCalledTimes(1);
  });
  it('refuses oversized WebAuthn requests before the relay and bounds streamed replies', async () => {
    const request = req(); request.headers.set('content-length', '65537');
    expect((await customerAccount(request, context, 'protection')).status).toBe(400); expect(upstream).not.toHaveBeenCalled();
    upstream.mockResolvedValue(new Response(' '.repeat(65537), { headers: { 'content-type': 'application/json' } }));
    const response = await customerAccount(req(), context, 'protection');
    expect(response.status).toBe(503); expect(response.headers.get('set-cookie')).toBeNull(); expect(upstream).toHaveBeenCalledTimes(1);
  });
});
