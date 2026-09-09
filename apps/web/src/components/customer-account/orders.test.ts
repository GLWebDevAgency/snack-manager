import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { CustomerAccountHttpError, type CustomerAccountSelection } from './client';
import { createCustomerOrdersClient } from './orders';

const now = 1_800_000_000_000;
const deferred = <T>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; };
const row = (id = 'c'.repeat(24)) => ({ _id: id, number: 42, createdAt: '2026-09-09T12:00:00.000Z', status: 'ready', type: 'pickup',
  pickupSlot: null, totalCents: 1250, payment: { method: 'counter', status: 'paid', refundedCents: 0, pendingRefundCents: 0 } });
const page = (orders = [row()], nextCursor: null | { createdAt: string; id: string } = null) => ({ expiresAt: now + 60_000, orders, nextCursor });
const detail = (id = row()._id) => ({ expiresAt: now + 60_000, order: { ...row(id), totals: { subtotal: 1250, deliveryFee: 0, discount: null, total: 1250 },
  lines: [], note: null, statusHistory: [], delivery: null } });
function setup() {
  let selected: CustomerAccountSelection | null = { browserRef: randomUUID(), publication: { expectedOperationId: randomUUID(), expectedCheckId: randomUUID() } };
  const access = { selection: structuredClone(selected), expiresAt: now + 60_000 };
  let active = true, clock = now;
  const request = Object.assign(vi.fn<(action: string, body?: unknown, selection?: CustomerAccountSelection) => Promise<unknown>>(async action => action === 'orders' ? page() : detail()), { selection: async () => selected });
  const lock = vi.fn(async (job: () => Promise<void>) => job());
  const client = createCustomerOrdersClient({ access, request, lock, active: () => active, now: () => clock });
  return { client, access, request, lock, change: () => { selected = { ...access.selection, publication: { expectedOperationId: randomUUID(), expectedCheckId: randomUUID() } }; },
    absent: () => { selected = null; }, pause: () => { active = false; client.invalidate(); }, time: (at: number) => { clock = at; } };
}
describe('private orders — in-memory projection, pinned publication', () => {
  it('starts empty, reads only explicitly and pins every POST to the displayed publication', async () => {
    const f = setup(); expect(f.request).not.toHaveBeenCalled(); expect(f.client.getSnapshot().orders).toEqual([]);
    await f.client.load(); expect(f.request).toHaveBeenCalledWith('orders', { filter: 'all', limit: 8, cursor: null }, f.access.selection);
    expect(f.client.getSnapshot().orders).toEqual([row()]); expect(f.lock).toHaveBeenCalledTimes(1);
  });
  it.each(['changed', 'absent'] as const)('does not send under a %s publication, even if the personal profile is identical', async fault => {
    const f = setup(); if (fault === 'changed') f.change(); else f.absent();
    await f.client.load(); expect(f.request).not.toHaveBeenCalled(); expect(f.client.getSnapshot().orders).toEqual([]);
  });
  it('discards a late A page after B was selected', async () => {
    const f = setup(), held = deferred<ReturnType<typeof page>>(); f.request.mockImplementation(async () => held.promise);
    const pending = f.client.load(); await vi.waitFor(() => expect(f.request).toHaveBeenCalledTimes(1));
    f.change(); held.resolve(page()); await pending; expect(f.client.getSnapshot().orders).toEqual([]);
  });
  it('discards a late detail after pause and clears previously displayed private data', async () => {
    const f = setup(); await f.client.load(); const held = deferred<ReturnType<typeof detail>>(); f.request.mockImplementation(async () => held.promise);
    const pending = f.client.open(row()._id); await vi.waitFor(() => expect(f.request).toHaveBeenCalledTimes(2));
    f.pause(); held.resolve(detail()); await pending; expect(f.client.getSnapshot().orders).toEqual([]); expect(f.client.getSnapshot().detail).toBeNull();
  });
  it('keeps exact cursor ordering and changes filter only on an explicit read', async () => {
    const f = setup(), first = row(); f.request.mockResolvedValueOnce(page([first], { createdAt: first.createdAt, id: first._id }));
    await f.client.load(); f.request.mockResolvedValueOnce(page([row('b'.repeat(24))])); await f.client.more();
    expect(f.request.mock.calls[1]?.[1]).toEqual({ filter: 'all', limit: 8, cursor: { createdAt: first.createdAt, id: first._id } });
    expect(f.client.getSnapshot().orders).toHaveLength(2);
    f.request.mockResolvedValueOnce(page([])); await f.client.load('past'); expect(f.client.getSnapshot().orders).toEqual([]);
    expect(f.client.getSnapshot().filter).toBe('past');
  });
  it.each(['duplicate', 'cursor', 'filter', 'expired', 'secret'] as const)('refuses %s page responses without partial projection', async fault => {
    const f = setup(); const output = fault === 'duplicate' ? page([row(), row()]) : fault === 'cursor' ? page([row()], { id: 'a'.repeat(24), createdAt: row().createdAt })
      : fault === 'expired' ? { ...page(), expiresAt: now } : fault === 'secret' ? { ...page(), token: 'unexpected' } : page();
    f.request.mockResolvedValue(output); await f.client.load(fault === 'filter' ? 'past' : 'all');
    expect(f.client.getSnapshot().orders).toEqual([]); expect(f.client.getSnapshot().message).toBeTruthy();
  });
  it.each([401, 404, 409, 429, 503])('shows a bounded HTTP %s refusal without guessing paid/empty or retrying', async status => {
    const f = setup(); f.request.mockRejectedValue(new CustomerAccountHttpError(status)); await f.client.open(row()._id);
    expect(f.request).toHaveBeenCalledTimes(1); expect(f.client.getSnapshot().detail).toBeNull(); expect(f.client.getSnapshot().message).toBeTruthy();
  });
  it('does not extend the displayed session or accept another order detail', async () => {
    const f = setup(); f.request.mockResolvedValueOnce({ ...page(), expiresAt: now + 60_001 }); await f.client.load();
    expect(f.client.getSnapshot().orders).toEqual([]); f.request.mockResolvedValueOnce(detail('a'.repeat(24))); await f.client.open(row()._id);
    expect(f.client.getSnapshot().detail).toBeNull();
    f.time(now + 60_000); await f.client.load(); expect(f.request).toHaveBeenCalledTimes(2);
  });
  it('honours a shorter authoritative expiry and cannot extend it on another read', async () => {
    const f = setup(); f.request.mockResolvedValueOnce({ ...page(), expiresAt: now + 10_000 }); await f.client.load();
    expect(f.client.getSnapshot().expiresAt).toBe(now + 10_000);
    f.time(now + 10_000); await f.client.load(); expect(f.request).toHaveBeenCalledTimes(1); expect(f.client.getSnapshot().orders).toEqual([]);
  });
});
