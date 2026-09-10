import { randomBytes, randomUUID } from 'node:crypto';
import Redis from 'ioredis';
import { CustomerIdentityCrypto } from '@sm/customer';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SharedPublicQuota } from '../../common/shared-public-quota';
import { reserveLoyaltyAttachmentQuota, type LoyaltyAttachmentQuotaInput } from './customer-loyalty-attachment.quota';

const integration = process.env.LOYALTY_ATTACHMENT_TEST_REDIS_URL ? describe : describe.skip;
const token = () => randomBytes(32).toString('base64url');
const identity = new CustomerIdentityCrypto(Buffer.alloc(32, 54).toString('base64'));
integration('attachment throttling — real Redis Lua across independent connections', () => {
  let clients: Redis[], quotas: SharedPublicQuota[], keys: Set<string>, prefix: string;
  beforeEach(async () => {
    const target = new URL(process.env.LOYALTY_ATTACHMENT_TEST_REDIS_URL!);
    if (target.protocol !== 'redis:' || target.hostname !== '127.0.0.1' || !target.port || Number(target.port) < 1024
      || target.username || target.password || target.search || target.hash || !/^\/(?:[0-9]|1[0-5])$/.test(target.pathname)) {
      throw new Error('Only an explicit local Redis test target is permitted');
    }
    prefix = `sm-test-loyalty-attach:${randomUUID()}:`; keys = new Set();
    clients = [0, 1].map(() => new Redis(target.toString(), { lazyConnect: true, enableOfflineQueue: false,
      connectTimeout: 2_000, maxRetriesPerRequest: 0, retryStrategy: () => null }));
    for (const client of clients) client.on('error', () => {}); // No URL or socket details in test output.
    await Promise.all(clients.map(client => client.connect()));
    quotas = clients.map(client => new SharedPublicQuota({
      // Test-only isolation: production scopes/Lua/limits are unchanged. Every
      // command uses this fixture's UUID prefix; no FLUSHDB or shared-key DEL.
      eval: (script: string, keyCount: number, ...args: (string | number)[]) => {
        const own = args.slice(0, keyCount).map(key => `${prefix}${key}`); own.forEach(key => keys.add(key));
        return client.eval(script, keyCount, ...own, ...args.slice(keyCount));
      },
    } as Pick<Redis, 'eval'>));
  });
  afterEach(async () => {
    try {
      if (keys?.size && clients?.[1]?.status === 'ready') {
        if ([...keys].some(key => !key.startsWith(prefix))) throw new Error('Foreign Redis key refused');
        await clients[1].del(...keys);
      }
    } finally { clients?.forEach(client => client.disconnect()); }
  });
  function input(patch: Partial<LoyaltyAttachmentQuotaInput> = {}): LoyaltyAttachmentQuotaInput {
    return { sourceClient: token(), parentRef: 'parent-fixture', tenantRef: 'tenant-fixture',
      sessionHash: randomBytes(32).toString('hex'), qrToken: token(), identity, ...patch };
  }
  async function admitted(requests: LoyaltyAttachmentQuotaInput[]): Promise<number> {
    const results = await Promise.all(requests.map(async (request, index) => {
      try { await reserveLoyaltyAttachmentQuota(quotas[index % 2]!, request); return 1; }
      catch (error) { expect(error).toMatchObject({ reason: 'limited' }); return 0; }
    }));
    return results.reduce<number>((sum, value) => sum + value, 0);
  }
  async function count(suffix: string): Promise<number[]> {
    const own = [...keys].filter(key => key.includes(suffix));
    return Promise.all(own.map(key => clients[0]!.zcard(key)));
  }
  it('allows only six concurrent attempts for one session across two instances', async () => {
    const same = input(); expect(await admitted(Array.from({ length: 30 }, () => same))).toBe(6);
    expect(await count('attach-session-v1:')).toEqual([6]); expect(await count('attach-qr-v1:')).toEqual([6]);
    expect(await count('attach-source-v1:global')).toEqual([20]);
  });
  it('allows only twelve attempts for the same QR despite new sessions and sources', async () => {
    const qrToken = token(); expect(await admitted(Array.from({ length: 30 }, () => input({ qrToken })))).toBe(12);
    expect(await count('attach-qr-v1:')).toEqual([12]);
  });
  it('does not reset a source budget when the session, QR or restaurant changes', async () => {
    const sourceClient = token();
    expect(await admitted(Array.from({ length: 30 }, (_, i) => input({ sourceClient, tenantRef: `tenant-${i}` })))).toBe(20);
    expect(await count('attach-source-v1:global')).toEqual([20]);
  });
  it('bounds the global budget even with entirely fresh sources and identities', async () => {
    expect(await admitted(Array.from({ length: 120 }, () => input()))).toBe(100);
    expect(await count('attach-source-v1:global')).toEqual([100]);
    const ttls = await Promise.all([...keys].map(key => clients[0]!.pttl(key)));
    // Twenty rejected new sources never created a key; all persisted buckets expire.
    expect(ttls.filter(ttl => ttl === -2)).toHaveLength(20);
    expect(ttls.filter(ttl => ttl > 0)).toHaveLength(301);
    expect(ttls.some(ttl => ttl === -1)).toBe(false);
  });
  it('expires the real Redis window and permits a later attempt without a fake clock', async () => {
    const request = { scope: 'fixture-expiry', clientKey: token(), windowMs: 80, clientLimit: 1, globalLimit: 1 };
    expect(await quotas[0]!.reserve(request)).toBe(true); expect(await quotas[1]!.reserve(request)).toBe(false);
    const globalKey = [...keys].find(key => key.endsWith(':global'))!;
    await expect.poll(() => clients[0]!.pttl(globalKey), { interval: 40, timeout: 2_000 }).toBe(-2);
    expect(await quotas[1]!.reserve(request)).toBe(true);
  });
  it('returns only a fixed unavailable error when the real connection is closed', async () => {
    clients[0]!.disconnect();
    await expect(reserveLoyaltyAttachmentQuota(quotas[0]!, input())).rejects.toMatchObject({ reason: 'unavailable' });
  });
});
