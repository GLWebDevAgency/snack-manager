import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { customerAccountResponseLimit } from '@sm/contracts';
import { customerAccountRequest } from './client';

const selected = { browserRef: randomUUID(), publication: { expectedOperationId: randomUUID(), expectedCheckId: randomUUID() } };
const query = { filter: 'all', limit: 8, cursor: null };
afterEach(() => vi.unstubAllGlobals());
describe('private order transport', () => {
  it.each(['orders', 'order-detail', 'order-create'] as const)('%s requires a pinned access and sends only same-origin publication headers', async action => {
    const fetch = vi.fn(async () => Response.json({ fixture: true })); vi.stubGlobal('fetch', fetch);
    const request = customerAccountRequest('recette', async () => selected.browserRef, async () => selected.publication);
    await expect(request(action, query)).rejects.toMatchObject({ status: 409 }); expect(fetch).not.toHaveBeenCalled();
    await request(action, query, selected);
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, options] = fetch.mock.calls[0]! as unknown as [string, RequestInit];
    expect(url).toBe(`/r/recette/compte/commandes${action === 'orders' ? '/recherche' : action === 'order-detail' ? '/detail' : ''}`);
    expect(options).toMatchObject({ method: 'POST', credentials: 'same-origin', cache: 'no-store', redirect: 'error', referrerPolicy: 'no-referrer' });
    expect(new Headers(options.headers).get('x-sm-customer-operation-id')).toBe(selected.publication.expectedOperationId);
    expect(new Headers(options.headers).get('x-sm-customer-check-id')).toBe(selected.publication.expectedCheckId);
  });
  it('discards a successful response if publication changes while its body is arriving', async () => {
    let publication = selected.publication;
    vi.stubGlobal('fetch', vi.fn(async () => { publication = { expectedOperationId: randomUUID(), expectedCheckId: randomUUID() }; return Response.json({ fixture: true }); }));
    const request = customerAccountRequest('recette', async () => selected.browserRef, async () => publication);
    await expect(request('orders', query, selected)).rejects.toMatchObject({ status: 409 });
  });
  it.each(['orders', 'order-detail'] as const)('bounds %s response bytes without relaxing the legacy reader', async action => {
    const request = customerAccountRequest('recette', async () => selected.browserRef, async () => selected.publication);
    vi.stubGlobal('fetch', vi.fn(async () => new Response(' '.repeat(customerAccountResponseLimit(action) + 1), { headers: { 'content-type': 'application/json' } })));
    await expect(request(action, query, selected)).rejects.toMatchObject({ status: 502 });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(' '.repeat(4097), { headers: { 'content-type': 'application/json' } })));
    await expect(request('session', undefined, selected)).rejects.toMatchObject({ status: 502 });
  });
});
