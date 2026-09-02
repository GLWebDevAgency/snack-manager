import type Redis from 'ioredis';
import { describe, expect, it, vi } from 'vitest';
import { publishRedisBestEffort } from './redis-best-effort';

describe('publishRedisBestEffort', () => {
  it("absorbe le rejet Redis quand l'événement métier est déjà écrit", async () => {
    const redis = {
      publish: vi.fn().mockRejectedValue(new Error('MaxRetriesPerRequestError')),
    } as unknown as Redis;

    await expect(publishRedisBestEffort(redis, 'tenant:1:orders', '{}')).resolves.toBeUndefined();
  });

  it('publie normalement quand Redis répond', async () => {
    const publish = vi.fn().mockResolvedValue(1);
    const redis = { publish } as unknown as Redis;
    await publishRedisBestEffort(redis, 'tenant:1:orders', '{"event":"ok"}');
    expect(publish).toHaveBeenCalledWith('tenant:1:orders', '{"event":"ok"}');
  });
});
