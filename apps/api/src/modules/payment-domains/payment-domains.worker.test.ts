import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { eligibleTenant, paymentDomainCacheKey, paymentDomainsNamespace, type DomainCursor, type DomainTenant, type PaymentDomainsConfig } from './payment-domain-hosts';
import { PaymentDomainsWorker, PAYMENT_DOMAINS_DISABLED_MS, PAYMENT_DOMAINS_LEASE_MS, PAYMENT_DOMAINS_RETRY_MS, PAYMENT_DOMAINS_SUCCESS_MS,
  RELEASE_PAYMENT_DOMAINS_LEASE, RENEW_PAYMENT_DOMAINS_LEASE, WRITE_PAYMENT_DOMAINS_STATE } from './payment-domains.worker';
import type { PaymentDomainsRepository } from './payment-domains.repository';

const config: PaymentDomainsConfig = { mode: 'test', webHostname: 'web.snackmanager.fr', rootDomain: 'snackmanager.fr' };
const namespace = paymentDomainsNamespace(config);
const leaseKey = `${namespace}:lease`;
const cursorKey = `${namespace}:cursor`;
const tenant = (index = 1, count = 0): DomainTenant => ({ _id: index.toString(16).padStart(24, '0'), slug: `restaurant-${index}`,
  encaissement: { accountId: `acct_${index}`, chargesEnabled: true },
  domains: Array.from({ length: count }, (_, i) => ({ hostname: `a${String(i).padStart(2, '0')}.restaurant.fr`, status: 'active' })),
});
class MemoryRedis {
  data = new Map<string, { value: string; expires: number }>();
  get = vi.fn(async (key: string) => {
    const row = this.data.get(key);
    if (row && row.expires <= Date.now()) { this.data.delete(key); return null; }
    return row?.value ?? null;
  });
  set = vi.fn(async (key: string, value: string, _px: string, ttl: number, _nx?: string) => {
    if (_nx && await this.get(key)) return null;
    this.data.set(key, { value, expires: Date.now() + ttl }); return 'OK';
  });
  eval = vi.fn(async (script: string, count: number, ...args: (string | number)[]) => {
    const [lease, state] = args.slice(0, count) as string[];
    const [owner, value, ttl] = args.slice(count);
    if (await this.get(lease!) !== owner) return 0;
    if (script === RELEASE_PAYMENT_DOMAINS_LEASE) this.data.delete(lease!);
    else if (script === RENEW_PAYMENT_DOMAINS_LEASE) this.data.get(lease!)!.expires = Date.now() + Number(value);
    else if (script === WRITE_PAYMENT_DOMAINS_STATE) this.data.set(state!, { value: String(value), expires: Date.now() + Number(ttl) });
    else throw new Error('Unknown Lua script');
    return 1;
  });
}
function fixture(rows = [tenant()]) {
  const redis = new MemoryRedis();
  const repository: PaymentDomainsRepository = {
    page: vi.fn(async (cursor: DomainCursor | null, limit: number) => rows.filter(row => eligibleTenant(row)
      && (!cursor || (cursor.host === null ? String(row._id) > cursor.tenantId : String(row._id) >= cursor.tenantId))).slice(0, limit)),
    current: vi.fn(async (id, accountId) => rows.find(row => String(row._id) === id && row.encaissement?.accountId === accountId && eligibleTenant(row)) ?? null),
  };
  const stripe = { ensure: vi.fn().mockResolvedValue('active') };
  const worker = new PaymentDomainsWorker(config, repository, redis as never, stripe);
  const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  return { worker, redis, repository, stripe, rows, warn };
}
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

describe('payment domains background sweep', () => {
  it('registers server-owned hosts, revalidates tenant scope and caches successes for 24 hours', async () => {
    const { worker, stripe, repository, redis } = fixture();
    await worker.tick();
    expect(stripe.ensure.mock.calls.map(([account, host]) => [account, host])).toEqual([
      ['acct_1', 'restaurant-1.snackmanager.fr'], ['acct_1', 'web.snackmanager.fr'],
    ]);
    expect(repository.current).toHaveBeenCalledWith(String(tenant()._id), 'acct_1');
    const cache = redis.data.get(paymentDomainCacheKey(config, 'acct_1', 'web.snackmanager.fr'))!;
    expect(cache.value).toBe('active'); expect(cache.expires - Date.now()).toBeGreaterThan(PAYMENT_DOMAINS_SUCCESS_MS - 1_000);
    await worker.tick(); expect(stripe.ensure).toHaveBeenCalledTimes(2);
    expect(await redis.get(leaseKey)).toBeNull();
  });
  it('does no Stripe work without a shared lease or after Redis failure', async () => {
    const { worker, stripe, redis, warn } = fixture();
    await redis.set(leaseKey, 'other-process', 'PX', PAYMENT_DOMAINS_LEASE_MS);
    await worker.tick(); expect(stripe.ensure).not.toHaveBeenCalled();
    expect(await redis.get(leaseKey)).toBe('other-process');
    redis.set.mockRejectedValueOnce(new Error('redis down'));
    await expect(worker.tick()).resolves.toBeUndefined();
    expect(stripe.ensure).not.toHaveBeenCalled(); expect(warn).toHaveBeenCalled();
  });
  it('keeps concurrency at two and resumes inside a tenant with more than ten hosts', async () => {
    const { worker, stripe, redis } = fixture([tenant(1, 15), tenant(2)]);
    let running = 0; let maximum = 0;
    stripe.ensure.mockImplementation(async () => {
      running++; maximum = Math.max(maximum, running);
      await new Promise(resolve => setTimeout(resolve, 1)); running--; return 'active';
    });
    await worker.tick();
    expect(stripe.ensure).toHaveBeenCalledTimes(10); expect(maximum).toBe(2);
    expect(JSON.parse((await redis.get(cursorKey))!)).toEqual({ tenantId: String(tenant()._id), host: 'a09.restaurant.fr' });
    await worker.tick();
    expect(stripe.ensure).toHaveBeenCalledTimes(19);
    const seen = stripe.ensure.mock.calls.map(([account, host]) => `${account}/${host}`);
    expect(new Set(seen).size).toBe(19);
    expect(seen).toContain('acct_2/web.snackmanager.fr');
    expect(await redis.get(cursorKey)).toBe('null');
  });
  it('scopes the same public host independently for different accounts and modes', async () => {
    const { worker, stripe, redis, repository } = fixture([tenant(1), tenant(2)]);
    await worker.tick(); expect(stripe.ensure).toHaveBeenCalledTimes(4);
    const live = new PaymentDomainsWorker({ ...config, mode: 'live' }, repository, redis as never, stripe);
    await live.tick(); expect(stripe.ensure).toHaveBeenCalledTimes(8);
  });
  it('continues after Stripe errors, caches bounded retries and later heals without a checkout request', async () => {
    vi.useFakeTimers();
    const { worker, stripe, redis, warn } = fixture();
    stripe.ensure.mockRejectedValueOnce(new Error('SECRET_REQUEST must never be logged'));
    await worker.tick();
    expect(stripe.ensure).toHaveBeenCalledTimes(2);
    expect(redis.data.get(paymentDomainCacheKey(config, 'acct_1', 'restaurant-1.snackmanager.fr'))!.expires - Date.now()).toBe(PAYMENT_DOMAINS_RETRY_MS);
    expect(JSON.stringify(warn.mock.calls)).not.toContain('SECRET_REQUEST');
    await worker.tick(); expect(stripe.ensure).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(PAYMENT_DOMAINS_RETRY_MS);
    await worker.tick(); expect(stripe.ensure).toHaveBeenCalledTimes(3);
  });
  it('retries an inactive domain after five minutes and observes manual disable for one hour', async () => {
    vi.useFakeTimers();
    const { worker, stripe, redis } = fixture();
    stripe.ensure.mockResolvedValueOnce('inactive').mockResolvedValueOnce('disabled');
    await worker.tick();
    expect(redis.data.get(paymentDomainCacheKey(config, 'acct_1', 'restaurant-1.snackmanager.fr'))!.expires - Date.now()).toBe(PAYMENT_DOMAINS_RETRY_MS);
    expect(redis.data.get(paymentDomainCacheKey(config, 'acct_1', 'web.snackmanager.fr'))!.expires - Date.now()).toBe(PAYMENT_DOMAINS_DISABLED_MS);
  });
  it('does not call an old account or a domain removed after the page snapshot', async () => {
    const { worker, stripe, repository } = fixture([tenant(1, 1)]);
    vi.mocked(repository.current).mockResolvedValue({ ...tenant(), encaissement: { accountId: 'acct_replaced', chargesEnabled: true } });
    await worker.tick(); expect(stripe.ensure).not.toHaveBeenCalled();
    vi.mocked(repository.current).mockResolvedValue(tenant());
    await worker.tick();
    expect(stripe.ensure.mock.calls.map(([, host]) => host)).toEqual(['restaurant-1.snackmanager.fr', 'web.snackmanager.fr']);
  });
  it('does not overwrite or release another owner after lease loss', async () => {
    const { worker, stripe, redis } = fixture([tenant(1, 15)]);
    stripe.ensure.mockImplementation(async () => {
      redis.data.set(leaseKey, { value: 'replacement', expires: Date.now() + PAYMENT_DOMAINS_LEASE_MS });
      return 'active';
    });
    await worker.tick();
    expect(stripe.ensure.mock.calls.length).toBeLessThanOrEqual(2);
    expect(await redis.get(leaseKey)).toBe('replacement');
    expect(await redis.get(cursorKey)).toBeNull();
    expect([...redis.data.keys()].filter(key => key.includes(':result:'))).toHaveLength(0);
  });
  it('renews its shared lease during long work and prevents local overlapping ticks', async () => {
    vi.useFakeTimers();
    const { worker, stripe, redis } = fixture();
    let release!: () => void;
    const barrier = new Promise<string>(resolve => { release = () => resolve('active'); });
    stripe.ensure.mockImplementation(() => barrier);
    const active = worker.tick();
    await vi.advanceTimersByTimeAsync(1);
    await worker.tick(); expect(stripe.ensure).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(redis.eval.mock.calls.some(([script]) => script === RENEW_PAYMENT_DOMAINS_LEASE)).toBe(true);
    worker.onModuleDestroy(); release();
    await active;
    expect(await redis.get(leaseKey)).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });
  it('stops recurring work on module destruction and tolerates missing optional configuration', async () => {
    vi.useFakeTimers();
    const { worker, stripe, redis, repository } = fixture();
    worker.onModuleInit(); await vi.advanceTimersByTimeAsync(1);
    expect(stripe.ensure).toHaveBeenCalledTimes(2);
    worker.onModuleDestroy(); await vi.advanceTimersByTimeAsync(90_000);
    expect(stripe.ensure).toHaveBeenCalledTimes(2); expect(vi.getTimerCount()).toBe(0);
    const disabled = new PaymentDomainsWorker(null, repository, redis as never, null);
    disabled.onModuleInit(); await disabled.tick(); expect(vi.getTimerCount()).toBe(0);
  });
});
