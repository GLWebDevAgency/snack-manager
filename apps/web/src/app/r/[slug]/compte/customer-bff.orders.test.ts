import { randomBytes, randomUUID } from 'node:crypto';
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { customerAccount } from './customer-bff';
import { customerAccountRequestLimit, customerAccountResponseLimit } from '@sm/contracts';

const origin = 'https://staging.snackmanager.fr', api = 'https://customer-api.example.test';
const browserRef = randomUUID(), expectedOperationId = randomUUID(), expectedCheckId = randomUUID();
const browserSecret = randomBytes(32).toString('base64url'), sessionToken = randomBytes(32).toString('base64url');
const cookies = `__Host-sm_customer_browser_classfood=${browserSecret}; __Host-sm_customer_session_classfood=${sessionToken}`;
const context = { params: Promise.resolve({ slug: 'classfood' }) };
const upstream = vi.fn<typeof fetch>();
const query = { filter: 'all', limit: 8, cursor: null };
const item = () => ({ _id: 'a'.repeat(24), number: 42, createdAt: '2026-09-09T12:00:00.000Z', status: 'ready', type: 'pickup',
  pickupSlot: null, totalCents: 1250, payment: { method: 'counter', status: 'paid', refundedCents: 0, pendingRefundCents: 0 } });
const detail = () => ({ ...item(), totals: { subtotal: 1250, deliveryFee: 0, discount: null, total: 1250 },
  lines: [{ name: 'Menu recette', variantName: null, qty: 1, unitPrice: 1250, lineTotal: 1250, options: [], removed: [], note: null }],
  note: null, statusHistory: [], delivery: null });
function req(action: 'orders' | 'order-detail' | 'order-create', body: unknown, headers: Record<string, string> = {}) {
  return new NextRequest(`${origin}/r/classfood/compte/commandes${action === 'orders' ? '/recherche' : action === 'order-detail' ? '/detail' : ''}`, { method: 'POST',
    headers: { origin, host: new URL(origin).host, 'sec-fetch-site': 'same-origin', 'content-type': 'application/json',
      'x-real-ip': '192.0.2.10', 'x-sm-customer-browser-ref': browserRef, 'x-sm-customer-operation-id': expectedOperationId,
      'x-sm-customer-check-id': expectedCheckId, cookie: cookies, ...headers }, body: JSON.stringify(body) });
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
describe('private orders BFF — real handler, isolated upstream', () => {
  it.each(['orders', 'order-detail'] as const)('%s signs exact publication and cookies, never needs SMS or an intention', async action => {
    const body = action === 'orders' ? query : { orderId: item()._id };
    const output = { expiresAt: Date.now() + 60_000, ...(action === 'orders' ? { orders: [item()], nextCursor: null } : { order: detail() }) };
    upstream.mockResolvedValue(Response.json(output));
    const response = await customerAccount(req(action, body), context, action);
    expect(response.status).toBe(200); expect(await response.json()).toEqual(output);
    expect(response.headers.get('set-cookie')).toBeNull(); expect(response.headers.get('cache-control')).toContain('private, no-store');
    expect(JSON.parse(String(upstream.mock.calls[0]![1]!.body))).toEqual({ request: body, browserRef, browserSecret, sessionToken, expectedOperationId, expectedCheckId });
    expect(upstream.mock.calls[0]![0]).toBe(`${api}/public/customer/classfood/${action}`);
  });
  it.each(['orders', 'order-detail'] as const)('%s refuses absent/ambiguous authority, CSRF, query extras and guessed identifiers', async action => {
    const body = action === 'orders' ? query : { orderId: item()._id };
    const variants: Record<string, string>[] = [{ cookie: '' }, { cookie: `${cookies}; __Host-sm_customer_session_classfood=${sessionToken}` },
      { 'x-sm-customer-operation-id': '' }, { 'x-sm-customer-check-id': '' }, { origin: 'https://other.example.test' }];
    for (const headers of variants) {
      expect((await customerAccount(req(action, body, headers), context, action)).status).toBeGreaterThanOrEqual(400);
    }
    expect((await customerAccount(req(action, { ...body, accountId: 'a'.repeat(24) }), context, action)).status).toBe(400);
    expect(upstream).not.toHaveBeenCalled();
  });
  it.each(['expired', 'secret', 'wrong-order'] as const)('rejects %s detail without projecting private upstream data', async fault => {
    upstream.mockResolvedValue(Response.json({ expiresAt: Date.now() + (fault === 'expired' ? -1 : 60_000),
      order: { ...detail(), ...(fault === 'secret' ? { trackingToken: sessionToken } : {}), ...(fault === 'wrong-order' ? { _id: 'b'.repeat(24) } : {}) } }));
    const response = await customerAccount(req('order-detail', { orderId: item()._id }), context, 'order-detail');
    expect(response.status).toBe(503); expect(await response.text()).not.toContain(sessionToken); expect(response.headers.get('set-cookie')).toBeNull();
  });
  it.each([401, 404, 409, 429, 503])('preserves the HTTP %s distinction and cookies, without retry', async status => {
    upstream.mockResolvedValue(new Response(null, { status }));
    const response = await customerAccount(req('order-detail', { orderId: item()._id }), context, 'order-detail');
    expect(response.status).toBe(status); expect(response.headers.get('set-cookie')).toBeNull(); expect(upstream).toHaveBeenCalledTimes(1);
  });
  it('rejects an oversized page, duplicate order and cursor that does not name the last row', async () => {
    for (const output of [
      { orders: Array.from({ length: 9 }, () => item()), nextCursor: null },
      { orders: [item(), item()], nextCursor: null },
      { orders: [item()], nextCursor: { createdAt: item().createdAt, id: 'b'.repeat(24) } },
    ]) {
      upstream.mockResolvedValue(Response.json({ expiresAt: Date.now() + 60_000, ...output }));
      expect((await customerAccount(req('orders', query), context, 'orders')).status).toBe(503);
    }
  });
  it.each(['orders', 'order-detail'] as const)('bounds the entire %s response before projecting anything', async action => {
    const body = action === 'orders' ? query : { orderId: item()._id };
    upstream.mockResolvedValue(new Response(' '.repeat(customerAccountResponseLimit(action) + 1), { headers: { 'content-type': 'application/json' } }));
    expect((await customerAccount(req(action, body), context, action)).status).toBe(503);
    expect(upstream).toHaveBeenCalledTimes(1);
  });
  it('relays the exact public checkout DTO with account authority and C01 proof, without a cookie write or guest fallback', async () => {
    const body = { clientId: randomUUID(), recoveryProof: randomBytes(32).toString('hex'), turnstileToken: 'local-human-fixture',
      lines: [{ productId: 'b'.repeat(24), qty: 1, options: [], removed: [], note: 'n'.repeat(200) }],
      payment: { method: 'counter' }, pickup: { slot: '2026-09-09T18:00:00.000Z', customerName: 'Recette', customerPhone: '0600000000' } };
    const output = { state: 'created', expiresAt: Date.now() + 60_000, order: { _id: item()._id, number: 42, status: 'new', type: 'pickup',
      payment: { method: 'counter', status: 'pending' }, totals: { subtotal: 1250, deliveryFee: 0, discount: null, total: 1250 },
      pickup: { slot: body.pickup.slot, customerName: 'Recette' }, trackingToken: randomBytes(32).toString('base64url'), delivery: null } };
    upstream.mockResolvedValue(Response.json(output));
    const response = await customerAccount(req('order-create', body), context, 'order-create');
    expect(response.status).toBe(200); expect(await response.json()).toEqual(output); expect(response.headers.get('set-cookie')).toBeNull();
    expect(JSON.parse(String(upstream.mock.calls[0]![1]!.body))).toEqual({ request: body, browserRef, browserSecret, sessionToken, expectedOperationId, expectedCheckId });
    upstream.mockClear();
    for (const invalidBody of [{ ...body, recoveryProof: undefined }, { ...body, accountId: 'c'.repeat(24) }, { ...body, payment: { method: 'counter', status: 'paid' } }]) {
      expect((await customerAccount(req('order-create', invalidBody), context, 'order-create')).status).toBe(400);
    }
    expect(upstream).not.toHaveBeenCalled();
    expect((await customerAccount(req('order-create', body, { cookie: '' }), context, 'order-create')).status).toBe(401);
    expect(upstream).not.toHaveBeenCalled();
    expect(customerAccountRequestLimit('order-create')).toBe(65_536);
    expect((await customerAccount(req('order-create', body, { 'content-length': '65537' }), context, 'order-create')).status).toBe(400);
    const group = { ...body, lines: Array.from({ length: 25 }, () => body.lines[0]) };
    upstream.mockResolvedValue(Response.json(output)); expect((await customerAccount(req('order-create', group), context, 'order-create')).status).toBe(200);
  });
});
