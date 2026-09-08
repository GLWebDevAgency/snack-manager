import { randomBytes, randomUUID } from 'node:crypto';
import { NextRequest } from 'next/server';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { customerAccount } from './customer-bff';

const origin = 'https://staging.snackmanager.fr', api = 'https://customer-api.example.test';
const browserRef = randomUUID(), operationId = randomUUID(), attemptId = randomUUID(), activationId = randomUUID();
const browserSecret = randomBytes(32).toString('base64url'), intentProof = randomBytes(32).toString('base64url');
const token = randomBytes(32).toString('base64url');
const proofName = `__Host-sm_customer_intent_classfood_${operationId}`;
const cookies = `__Host-sm_customer_browser_classfood=${browserSecret}; ${proofName}=${intentProof}`;
const context = { params: Promise.resolve({ slug: 'classfood' }) };
const upstream = vi.fn<typeof fetch>();
const view = () => ({ expiresAt: Date.now() + 60_000, profile: { name: null, phoneE164: '+33600000000', phoneVerifiedAt: Date.now() - 1_000, revision: 0 } });
const recovery = () => ({ operationId, attemptId, expiresAt: Date.now() + 60_000, stage: 'registration_required', recoveryVersion: 0 });
function req(action: 'passkey' | 'recovery', body: object, headers: Record<string, string> = {}) {
  return new NextRequest(`${origin}/r/classfood/compte/${action === 'passkey' ? 'cle-acces' : 'secours'}`, { method: 'POST',
    headers: { origin, host: new URL(origin).host, 'sec-fetch-site': 'same-origin', 'content-type': 'application/json',
      'x-real-ip': '192.0.2.10', 'x-sm-customer-browser-ref': browserRef, cookie: cookies, ...headers }, body: JSON.stringify(body) });
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
describe('credential access BFF — real handler, simulated API', () => {
  it.each(['passkey', 'recovery'] as const)('%s binds browser and intention, never an existing session or OTP', async action => {
    const body = { step: action === 'passkey' ? 'result' : 'state', operationId, attemptId };
    const output = { state: 'unresolved', operationId, attemptId, expiresAt: Date.now() + 60_000 };
    upstream.mockResolvedValue(Response.json(output));
    const response = await customerAccount(req(action, body, { cookie: `${cookies}; __Host-sm_customer_session_classfood=${token}` }), context, action);
    expect(response.status).toBe(200); expect(await response.json()).toEqual(output); expect(response.headers.get('set-cookie')).toBeNull();
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(JSON.parse(String(upstream.mock.calls[0]![1]!.body))).toEqual({ request: body, browserRef, browserSecret, intentProof });
    expect(upstream.mock.calls[0]![0]).toBe(`${api}/public/customer/classfood/${action}`);
  });
  it.each(['passkey', 'recovery'] as const)('%s fails closed without capability, with duplicate proof, cross-origin or OTP-shaped body', async action => {
    const body = { step: action === 'passkey' ? 'result' : 'state', operationId, attemptId };
    const variants: Record<string, string>[] = [{ cookie: '' }, { cookie: `${cookies}; ${proofName}=${intentProof}` }, { origin: 'https://other.example.test' }];
    for (const headers of variants) {
      expect((await customerAccount(req(action, body, headers), context, action)).status).toBeGreaterThanOrEqual(400);
    }
    expect((await customerAccount(req(action, { ...body, checkId: randomUUID() }), context, action)).status).toBe(400);
    expect(upstream).not.toHaveBeenCalled();
  });
  it.each(['operationId', 'attemptId', 'expired', 'private'])('refuses a provisional %s fault without any cookie', async fault => {
    const grant = { ...recovery(), ...(fault === 'operationId' || fault === 'attemptId' ? { [fault]: randomUUID() } : {}),
      ...(fault === 'expired' ? { expiresAt: Date.now() - 1 } : {}) };
    upstream.mockResolvedValue(Response.json({ state: 'recovery', recovery: grant, ...(fault === 'private' ? { view: view() } : {}) }));
    const response = await customerAccount(req('recovery', { step: 'state', operationId, attemptId }), context, 'recovery');
    expect(response.status).toBe(503); expect(response.headers.get('set-cookie')).toBeNull();
  });
  it.each(['passkey', 'recovery'] as const)('%s publishes only the exact receipt and strips its token', async action => {
    const publicationId = action === 'passkey' ? attemptId : activationId;
    const current = view(); upstream.mockResolvedValue(Response.json({ state: 'authenticated', operationId, publicationId, token, view: current }));
    const body = action === 'passkey' ? { step: 'result', operationId, attemptId } : { step: 'activation-result', operationId, attemptId, activationId };
    const response = await customerAccount(req(action, body), context, action);
    expect(response.status).toBe(200); expect(await response.json()).toEqual({ state: 'authenticated', operationId, publicationId, view: current });
    for (const attribute of ['__Host-sm_customer_session_classfood=', 'HttpOnly', 'Secure', 'SameSite=strict']) expect(response.headers.get('set-cookie')).toContain(attribute);
    expect(response.headers.get('set-cookie')).not.toMatch(/Max-Age|Domain=|intent|browser/);
  });
  it.each(['operation', 'publication', 'wrong-step', 'expired'])('rejects an authenticated recovery %s mismatch', async fault => {
    upstream.mockResolvedValue(Response.json({ state: 'authenticated', operationId: fault === 'operation' ? randomUUID() : operationId,
      publicationId: fault === 'publication' ? attemptId : activationId, token, view: { ...view(), ...(fault === 'expired' ? { expiresAt: Date.now() - 1 } : {}) } }));
    const body = fault === 'wrong-step' ? { step: 'state', operationId, attemptId } : { step: 'activation-result', operationId, attemptId, activationId };
    const response = await customerAccount(req('recovery', body), context, 'recovery');
    expect(response.status).toBe(503); expect(response.headers.get('set-cookie')).toBeNull();
  });
  it('refuses options and secret responses on unrelated steps', async () => {
    upstream.mockResolvedValue(Response.json({ state: 'recovery-code', recovery: recovery(), code: null }));
    expect((await customerAccount(req('recovery', { step: 'state', operationId, attemptId }), context, 'recovery')).status).toBe(503);
  });
  it.each([401, 409, 503])('preserves cookies and never retries after HTTP %s', async status => {
    upstream.mockResolvedValue(new Response(null, { status }));
    const response = await customerAccount(req('passkey', { step: 'result', operationId, attemptId }), context, 'passkey');
    expect(response.status).toBe(status); expect(response.headers.get('set-cookie')).toBeNull(); expect(upstream).toHaveBeenCalledTimes(1);
  });
  it('bounds both new action streams to 65KiB and leaves legacy bounds intact', async () => {
    for (const action of ['passkey', 'recovery'] as const) {
      const body = { step: action === 'passkey' ? 'result' : 'state', operationId, attemptId };
      const request = req(action, body, { 'content-length': '65537' });
      expect((await customerAccount(request, context, action)).status).toBe(400);
      upstream.mockResolvedValue(new Response(' '.repeat(65537), { headers: { 'content-type': 'application/json' } }));
      expect((await customerAccount(req(action, body), context, action)).status).toBe(503);
    }
    expect(upstream).toHaveBeenCalledTimes(2);
  });
  it('requires the discoverable userHandle before relaying any login assertion', async () => {
    const response = await customerAccount(req('passkey', { step: 'assert', operationId, attemptId,
      response: { id: 'AQ', rawId: 'AQ', type: 'public-key', clientExtensionResults: {}, response: {
        clientDataJSON: 'AQ', authenticatorData: 'AQ', signature: 'AQ' } } }), context, 'passkey');
    expect(response.status).toBe(400); expect(upstream).not.toHaveBeenCalled();
  });
  it('accepts a bounded assertion above legacy 4KiB only on its new route', async () => {
    upstream.mockResolvedValue(Response.json({ state: 'failed', operationId, attemptId, expiresAt: Date.now() + 60_000 }));
    const response = await customerAccount(req('passkey', { step: 'assert', operationId, attemptId,
      response: { id: 'AQ', rawId: 'AQ', type: 'public-key', clientExtensionResults: {}, response: {
        clientDataJSON: randomBytes(2_000).toString('base64url'), authenticatorData: 'AQ', signature: randomBytes(2_000).toString('base64url'), userHandle: token } } }), context, 'passkey');
    expect(response.status).toBe(200); expect(upstream).toHaveBeenCalledTimes(1); expect(response.headers.get('set-cookie')).toBeNull();
  });
});
