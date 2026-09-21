import { afterEach, describe, expect, it, vi } from 'vitest';
import { orderingApi, type TransportRequest } from './api';
import { demoSite } from './demo/fixture';
const raw = demoSite(new Date('2030-09-09T10:00:00.000Z'), () => 0);
const availability = { observedAt: '2030-09-09T10:00:00.000Z', openNow: raw.openNow,
  ordering: raw.ordering, todayHours: raw.todayHours, timezone: raw.timezone, slots: raw.slots };
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
describe('live public availability transport', () => {
  it('validates the exact narrow response, escapes the tenant and requests no-store', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify(availability)));
    vi.stubGlobal('fetch', fetcher);
    expect(await orderingApi().loadAvailability('restaurant/other')).toEqual(availability);
    expect(fetcher).toHaveBeenCalledWith(expect.stringContaining('/public/tenants/restaurant%2Fother/availability'), expect.objectContaining({ method: 'GET', cache: 'no-store', signal: expect.any(AbortSignal) }));
  });
  it.each([{ ...availability, private: true }, { ...availability, observedAt: 'yesterday' }, { ...availability, ordering: { paused: 'false', message: null } }])('rejects invalid availability instead of trusting the old site', async body => {
    await expect(orderingApi({ send: async () => ({ status: 200, body }) }).loadAvailability('recette')).rejects.toThrow();
  });
  it('bounds even an uncooperative transport to ten seconds and aborts its signal', async () => {
    vi.useFakeTimers(); let request: TransportRequest | undefined;
    const result = orderingApi({ send: value => { request = value; return new Promise(() => {}); } }).loadAvailability('recette');
    const rejected = expect(result).rejects.toThrow('Disponibilités indisponibles');
    await vi.advanceTimersByTimeAsync(10_000); await rejected;
    expect(request?.signal?.aborted).toBe(true); expect(vi.getTimerCount()).toBe(0);
  });
  it('propagates caller cancellation and never accepts a late response', async () => {
    const abort = new AbortController(); let finish!: (value: { status: number; body: unknown }) => void;
    const result = orderingApi({ send: () => new Promise(resolve => { finish = resolve; }) }).loadAvailability('recette', abort.signal);
    const rejected = expect(result).rejects.toThrow(); abort.abort(); finish({ status: 200, body: availability }); await rejected;
  });
});
