import { describe, expect, it, vi } from 'vitest';
import { LoyaltyEnrollmentExpiryProcessor } from './loyalty-enrollment-expiry.processor';

describe('LoyaltyEnrollmentExpiryProcessor', () => {
  it('isole chaque tenant et poursuit après un échec local', async () => {
    const tenants = {
      find: vi.fn(() => ({
        lean: vi.fn().mockResolvedValue([{ _id: 'tenant-a' }, { _id: 'tenant-b' }]),
      })),
    };
    const loyalty = {
      expireStaleEnrollments: vi
        .fn()
        .mockResolvedValueOnce(2)
        .mockRejectedValueOnce(new Error('postgres indisponible')),
    };
    const processor = new LoyaltyEnrollmentExpiryProcessor(
      tenants as never,
      loyalty as never,
    );
    const now = new Date('2026-09-01T10:00:00.000Z');

    await expect(processor.drain(now)).resolves.toEqual({
      tenants: 2,
      expired: 2,
      failedTenants: 1,
    });
    expect(loyalty.expireStaleEnrollments).toHaveBeenNthCalledWith(
      1,
      'tenant-a',
      now,
      100,
    );
    expect(loyalty.expireStaleEnrollments).toHaveBeenNthCalledWith(
      2,
      'tenant-b',
      now,
      100,
    );
  });

  it('refuse deux balayages concurrents dans la même instance', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const tenants = {
      find: () => ({ lean: () => gate.then(() => [{ _id: 'tenant-a' }]) }),
    };
    const loyalty = { expireStaleEnrollments: vi.fn().mockResolvedValue(0) };
    const processor = new LoyaltyEnrollmentExpiryProcessor(
      tenants as never,
      loyalty as never,
    );

    const first = processor.drain();
    await expect(processor.drain()).resolves.toEqual({
      tenants: 0,
      expired: 0,
      failedTenants: 0,
    });
    release();
    await expect(first).resolves.toEqual({ tenants: 1, expired: 0, failedTenants: 0 });
  });
});
