import { describe, expect, it, vi } from 'vitest';
import type Redis from 'ioredis';
import { SharedPublicQuota } from './shared-public-quota';

function redisReturning(result: unknown) {
  const evalFn = vi.fn().mockResolvedValue(result);
  return {
    redis: { eval: evalFn } as unknown as Redis,
    evalFn,
  };
}

const INPUT = {
  scope: 'contact-leads',
  clientKey: '203.0.113.41',
  windowMs: 10 * 60_000,
  clientLimit: 5,
  globalLimit: 30,
} as const;

describe('SharedPublicQuota', () => {
  it('réserve le quota client et le quota global dans une seule commande atomique', async () => {
    const { redis, evalFn } = redisReturning([1, 1, 1]);
    const quota = new SharedPublicQuota(redis);

    await expect(quota.reserve(INPUT)).resolves.toBe(true);

    expect(evalFn).toHaveBeenCalledOnce();
    const [script, keyCount, clientKey, globalKey] = evalFn.mock.calls[0] as unknown[];
    expect(script).toEqual(expect.stringContaining("redis.call('TIME')"));
    expect(script).toEqual(expect.stringContaining("redis.call('PEXPIRE'"));
    expect(keyCount).toBe(2);
    expect(clientKey).toEqual(expect.stringContaining('public-quota:contact-leads:client:'));
    expect(globalKey).toBe('public-quota:contact-leads:global');
  });

  it("ne met jamais l'adresse client brute dans Redis", async () => {
    const { redis, evalFn } = redisReturning([1, 1, 1]);
    await new SharedPublicQuota(redis).reserve(INPUT);

    expect(JSON.stringify(evalFn.mock.calls)).not.toContain(INPUT.clientKey);
  });

  it("refuse toute la réservation dès qu'une des deux bornes est pleine", async () => {
    const { redis } = redisReturning([0, 5, 12]);
    await expect(new SharedPublicQuota(redis).reserve(INPUT)).resolves.toBe(false);
  });

  it('propage une panne Redis pour que chaque appelant applique sa posture fermée', async () => {
    const redis = {
      eval: vi.fn().mockRejectedValue(new Error('redis indisponible')),
    } as unknown as Redis;
    await expect(new SharedPublicQuota(redis).reserve(INPUT)).rejects.toThrow('redis indisponible');
  });

  it('refuse un namespace dynamique avant tout appel Redis', async () => {
    const { redis, evalFn } = redisReturning([1, 1, 1]);
    await expect(
      new SharedPublicQuota(redis).reserve({ ...INPUT, scope: '../contact\nINJECT' }),
    ).rejects.toThrow('Namespace de quota public invalide');
    expect(evalFn).not.toHaveBeenCalled();
  });
});
