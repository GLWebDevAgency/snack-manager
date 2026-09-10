import { Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type Redis from 'ioredis';
import { eligibleTenant, parseDomainCursor, paymentDomainCacheKey, paymentDomainsNamespace, tenantPaymentHosts,
  type DomainCursor, type PaymentDomainsConfig } from './payment-domain-hosts';
import type { PaymentDomainsRepository } from './payment-domains.repository';
import type { StripePaymentDomainsClient } from './stripe-payment-domains.client';

export const PAYMENT_DOMAINS_INTERVAL_MS = 30_000;
export const PAYMENT_DOMAINS_HOSTS_PER_TICK = 10;
export const PAYMENT_DOMAINS_PAGE_SIZE = 10;
export const PAYMENT_DOMAINS_LEASE_MS = 120_000;
export const PAYMENT_DOMAINS_SUCCESS_MS = 24 * 60 * 60_000;
export const PAYMENT_DOMAINS_RETRY_MS = 5 * 60_000;
export const PAYMENT_DOMAINS_DISABLED_MS = 60 * 60_000;

export const RENEW_PAYMENT_DOMAINS_LEASE = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('PEXPIRE', KEYS[1], ARGV[2])
end
return 0`;
export const RELEASE_PAYMENT_DOMAINS_LEASE = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
end
return 0`;
export const WRITE_PAYMENT_DOMAINS_STATE = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  redis.call('SET', KEYS[2], ARGV[2], 'PX', ARGV[3])
  return 1
end
return 0`;

interface Target { tenantId: string; accountId: string; host: string; cursor: DomainCursor }

/** A bounded, shared sweep of server-owned domains, entirely outside checkout. */
export class PaymentDomainsWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PaymentDomainsWorker.name);
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private stopped = false;
  constructor(private readonly config: PaymentDomainsConfig | null, private readonly repository: PaymentDomainsRepository,
    private readonly redis: Pick<Redis, 'get' | 'set' | 'eval'>, private readonly stripe: StripePaymentDomainsClient | null) {}

  onModuleInit(): void {
    if (!this.config || !this.stripe) {
      this.logger.warn('Payment domains reconciliation disabled: Stripe mode or HTTPS public hosts are not configured');
      return;
    }
    this.timer = setInterval(() => { void this.tick(); }, PAYMENT_DOMAINS_INTERVAL_MS);
    this.timer.unref();
    void this.tick();
  }
  onModuleDestroy(): void {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async tick(): Promise<void> {
    if (this.running || this.stopped || !this.config || !this.stripe) return;
    this.running = true;
    const config = this.config;
    const namespace = paymentDomainsNamespace(config);
    const leaseKey = `${namespace}:lease`;
    const cursorKey = `${namespace}:cursor`;
    const owner = randomUUID();
    let acquired = false;
    let heartbeat: ReturnType<typeof setInterval> | null = null;
    let renewing = false;
    let lost = false;
    let leaseUntil = 0;
    const current = () => !lost && !this.stopped && Date.now() < leaseUntil - 5_000;
    const write = async (key: string, value: string, ttl: number) => {
      if (!current()) return false;
      const written = await this.redis.eval(WRITE_PAYMENT_DOMAINS_STATE, 2, leaseKey, key, owner, value, ttl);
      if (Number(written) !== 1) lost = true;
      return Number(written) === 1;
    };
    try {
      const started = Date.now();
      acquired = await this.redis.set(leaseKey, owner, 'PX', PAYMENT_DOMAINS_LEASE_MS, 'NX') === 'OK';
      if (!acquired) return;
      leaseUntil = started + PAYMENT_DOMAINS_LEASE_MS;
      heartbeat = setInterval(() => {
        if (renewing || !current()) return;
        renewing = true;
        const renewedAt = Date.now();
        void this.redis.eval(RENEW_PAYMENT_DOMAINS_LEASE, 1, leaseKey, owner, PAYMENT_DOMAINS_LEASE_MS)
          .then(result => { if (Number(result) === 1) leaseUntil = renewedAt + PAYMENT_DOMAINS_LEASE_MS; else lost = true; })
          .catch(() => { lost = true; })
          .finally(() => { renewing = false; });
      }, PAYMENT_DOMAINS_INTERVAL_MS);
      heartbeat.unref();
      const cursor = parseDomainCursor(await this.redis.get(cursorKey));
      const rows = await this.repository.page(cursor, PAYMENT_DOMAINS_PAGE_SIZE);
      const targets: Target[] = [];
      let lastCursor = cursor;
      let completedPage = true;
      for (const row of rows) {
        const tenantId = row._id.toString();
        const hosts = eligibleTenant(row) ? tenantPaymentHosts(row, config) : [];
        const remaining = hosts.filter(host => !cursor || cursor.tenantId !== tenantId || cursor.host === null || host > cursor.host);
        if (!remaining.length) lastCursor = { tenantId, host: null };
        for (const host of remaining) {
          if (targets.length === PAYMENT_DOMAINS_HOSTS_PER_TICK) { completedPage = false; break; }
          lastCursor = { tenantId, host: host === hosts.at(-1) ? null : host };
          targets.push({ tenantId, accountId: row.encaissement!.accountId!, host, cursor: lastCursor });
        }
        if (!completedPage) break;
      }
      const completed: boolean[] = [];
      let next = 0;
      let failures = 0;
      let reconciled = 0;
      const consume = async () => {
        while (current()) {
          const index = next++;
          const target = targets[index];
          if (!target) return;
          const cacheKey = paymentDomainCacheKey(config, target.accountId, target.host);
          if (await this.redis.get(cacheKey)) { completed[index] = true; continue; }
          // Recheck ownership/account/DNS state after reading the page. No stale account fallback.
          const fresh = await this.repository.current(target.tenantId, target.accountId);
          if (!fresh || !eligibleTenant(fresh) || fresh.encaissement?.accountId !== target.accountId
            || !tenantPaymentHosts(fresh, config).includes(target.host)) { completed[index] = true; continue; }
          if (!current()) return;
          let result: string;
          let ttl: number;
          try {
            result = await this.stripe!.ensure(target.accountId, target.host, current);
            ttl = result === 'active' ? PAYMENT_DOMAINS_SUCCESS_MS : result === 'disabled' ? PAYMENT_DOMAINS_DISABLED_MS : PAYMENT_DOMAINS_RETRY_MS;
            if (result === 'active') reconciled++; else failures++;
          } catch {
            // Do not log SDK error objects: they may contain request credentials or URLs.
            failures++;
            result = 'retry';
            ttl = PAYMENT_DOMAINS_RETRY_MS;
          }
          completed[index] = await write(cacheKey, result, ttl);
          if (!completed[index]) return;
        }
      };
      // Await both lanes even if one Redis/Mongo read fails, before releasing the lease.
      const outcomes = await Promise.allSettled([consume(), consume()]);
      const firstIncomplete = targets.findIndex((_, index) => !completed[index]);
      if (firstIncomplete === -1) {
        const end = completedPage && rows.length < PAYMENT_DOMAINS_PAGE_SIZE;
        await write(cursorKey, end ? 'null' : JSON.stringify(lastCursor), 7 * 24 * 60 * 60_000);
      } else if (firstIncomplete > 0) {
        await write(cursorKey, JSON.stringify(targets[firstIncomplete - 1]!.cursor), 7 * 24 * 60 * 60_000);
      }
      if (failures || outcomes.some(result => result.status === 'rejected')) {
        this.logger.warn(`Payment domains sweep: active=${reconciled}, pending=${failures}, storageError=${outcomes.some(result => result.status === 'rejected')}`);
      } else if (reconciled) this.logger.log(`Payment domains sweep: active=${reconciled}`);
    } catch {
      this.logger.warn('Payment domains sweep unavailable; next sweep will retry');
    } finally {
      if (heartbeat) clearInterval(heartbeat);
      if (acquired) {
        try { await this.redis.eval(RELEASE_PAYMENT_DOMAINS_LEASE, 1, leaseKey, owner); } catch { /* Bounded TTL releases the lease. */ }
      }
      this.running = false;
    }
  }
}
