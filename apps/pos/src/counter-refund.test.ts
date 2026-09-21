import { afterEach, describe, expect, it, vi } from 'vitest';
import { counterRefundHttp, createCounterRefundTransport, type CounterRefundAccess } from './counter-refund';
import type { CounterRefundJournal } from '@sm/contracts';
const orderId = 'a'.repeat(24), operationId = '10000000-0000-4000-8000-000000000001';
const body = { operationId, amountCents: 100, reason: 'Article manquant', tender: 'cash', allocation: { version: 1, merchandiseCents: 100, deliveryCents: 0 }, clientProtocolVersion: 1,
  authorization: { kind: 'manager_pin', pin: '0000' } };
function view(): CounterRefundJournal {
  return { orderId, enabled: true, available: true, unavailableReason: null, tender: 'cash', observedAt: '2026-09-21T12:00:01.000Z',
    originalPaidCents: 500, refundedCents: 0, pendingRefundCents: 100, remainingCents: 400, basis: { merchandiseCents: 500, deliveryCents: 0 },
    remaining: { merchandiseCents: 400, deliveryCents: 0 }, canResolveNoEffect: false, operations: [{ operationId, amountCents: 100, reason: 'Article manquant', tender: 'cash', allocation: { version: 1, merchandiseCents: 100, deliveryCents: 0 },
      state: 'started', preparedAt: '2026-09-21T11:59:00.000Z', startedAt: '2026-09-21T12:00:00.000Z', disburseExpiresAt: '2026-09-21T12:05:00.000Z', confirmedAt: null,
      resolvedAt: null, resolutionReason: null, canResume: true }] };
}
afterEach(() => vi.unstubAllGlobals());
describe('counter refund transport boundaries', () => {
  it('pins the session, forbids redirects and caching, and restricts endpoint paths', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ journal: view(), mayDisburse: true }), { status: 201, headers: { 'content-type': 'application/json' } })); vi.stubGlobal('fetch', fetch);
    const request = counterRefundHttp('https://api.fixture.invalid', 'fixture-token');
    await request('POST', `/orders/${orderId}/counter-refunds/start`, body);
    expect(fetch).toHaveBeenCalledExactlyOnceWith(`https://api.fixture.invalid/orders/${orderId}/counter-refunds/start`, expect.objectContaining({ method: 'POST', redirect: 'error', cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer',
      headers: expect.objectContaining({ Authorization: 'Bearer fixture-token' }), body: JSON.stringify(body) }));
    await expect(request('POST', 'https://other.invalid', body)).rejects.toThrow(); expect(fetch).toHaveBeenCalledTimes(1);
  });
  it.each([
    () => new Response('x', { headers: { 'content-type': 'text/html' } }),
    () => new Response('{}', { headers: { 'content-type': 'application/json', 'content-length': '262145' } }),
    () => new Response(' '.repeat(262145), { headers: { 'content-type': 'application/json' } }),
    () => new Response('{}', { status: 201, headers: { 'content-type': 'application/json' } }),
  ])('rejects malformed/oversized or wrong-status GET without retry', async response => {
    const fetch = vi.fn(async () => response()); vi.stubGlobal('fetch', fetch);
    await expect(counterRefundHttp('https://api.fixture.invalid', 'fixture')('GET', `/orders/${orderId}/counter-refunds/journal`)).rejects.toThrow(); expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('allows the bounded 200-order history above 256 KiB while preserving the smaller financial journal limit', async () => {
    const data = { rows: Array.from({ length: 200 }, (_, index) => ({ _id: index.toString(16).padStart(24, '0'), number: index + 1,
      status: 'delivered', payment: { method: 'counter', status: 'paid', tender: 'cash' }, totals: { total: 500 }, lines: [{ name: 'é'.repeat(1000), options: [] }] })), total: 200, truncated: false };
    const encoded = JSON.stringify(data); expect(new TextEncoder().encode(encoded).length).toBeGreaterThan(262_144);
    vi.stubGlobal('fetch', vi.fn(async () => new Response(encoded, { headers: { 'content-type': 'application/json' } })));
    const request = counterRefundHttp('https://api.fixture.invalid', 'fixture');
    expect(await request('GET', '/orders?status=delivered')).toEqual(data);
    await expect(request('GET', `/orders/${orderId}/counter-refunds/journal`)).rejects.toThrow('volumineuse');
  });
  it('bounds native non-stream responses by UTF-8 bytes, including multibyte text', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ status: 200, headers: new Headers({ 'content-type': 'application/json' }), body: null, text: async () => JSON.stringify('é'.repeat(140_000)) })));
    await expect(counterRefundHttp('https://api.fixture.invalid', 'fixture')('GET', `/orders/${orderId}/counter-refunds/journal`)).rejects.toThrow('volumineuse');
  });
  it('drops a held response after the access cycle changes', async () => {
    let active = true, release!: (value: unknown) => void;
    const request = vi.fn(() => new Promise(resolve => { release = resolve; }));
    const access = { request, client: { tenantStore: {} }, ownerId: 'fixture', role: 'owner', sessionKey: 'fixture', onSessionExpired: vi.fn() } as unknown as CounterRefundAccess;
    const sending = createCounterRefundTransport(access, () => active).send(orderId, 'start', body);
    active = false; release({ journal: view(), mayDisburse: true });
    await expect(sending).rejects.toThrow('session'); expect(request).toHaveBeenCalledTimes(1);
  });
  it.each(['wrong order', 'wrong amount', 'raw reason', 'permission on prepare'])('rejects mismatched financial authority: %s', async flaw => {
    const journal = view();
    if (flaw === 'wrong order') journal.orderId = 'b'.repeat(24);
    if (flaw === 'wrong amount') { journal.operations[0]!.amountCents = 200; journal.operations[0]!.allocation.merchandiseCents = 200; }
    if (flaw === 'raw reason') journal.operations[0]!.reason += ' ';
    const access = { request: async () => ({ journal, mayDisburse: true }), client: { tenantStore: {} }, ownerId: 'fixture', role: 'owner', sessionKey: 'fixture', onSessionExpired: vi.fn() } as unknown as CounterRefundAccess;
    await expect(createCounterRefundTransport(access, () => true).send(orderId, flaw === 'permission on prepare' ? 'prepare' : 'start', body)).rejects.toThrow();
  });
});
