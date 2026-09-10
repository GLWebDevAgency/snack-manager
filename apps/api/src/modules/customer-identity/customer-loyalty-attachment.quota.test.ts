import { CustomerIdentityCrypto } from '@sm/customer';
import { describe, expect, it, vi } from 'vitest';
import type { SharedPublicQuota } from '../../common/shared-public-quota';
import { reserveLoyaltyAttachmentQuota } from './customer-loyalty-attachment.quota';

function fixture() {
  const quota = { reserve: vi.fn().mockResolvedValue(true), reserveClient: vi.fn().mockResolvedValue(true) };
  const input = { sourceClient: Buffer.alloc(32, 21).toString('base64url'), parentRef: 'parent-fixture', tenantRef: 'tenant-fixture',
    sessionHash: 'c'.repeat(64), qrToken: Buffer.alloc(32, 22).toString('base64url'),
    identity: new CustomerIdentityCrypto(Buffer.alloc(32, 23).toString('base64')) };
  return { quota, input, reserve: () => reserveLoyaltyAttachmentQuota(quota as unknown as SharedPublicQuota, input) };
}
describe('protected loyalty attachment quotas', () => {
  it('reserves source/global before distinct hashed session and QR dimensions', async () => {
    const f = fixture(); await f.reserve();
    expect(f.quota.reserve).toHaveBeenCalledExactlyOnceWith({ scope: 'customer-loyalty-attach-source-v1',
      clientKey: f.input.sourceClient, windowMs: 60_000, clientLimit: 20, globalLimit: 100 });
    expect(f.quota.reserveClient.mock.calls).toEqual([
      [{ scope: 'customer-loyalty-attach-session-v1', clientKey: expect.stringMatching(/^[a-f0-9]{64}$/), windowMs: 60_000, clientLimit: 6 }],
      [{ scope: 'customer-loyalty-attach-qr-v1', clientKey: expect.stringMatching(/^[a-f0-9]{64}$/), windowMs: 60_000, clientLimit: 12 }],
    ]);
    expect(f.quota.reserve.mock.invocationCallOrder[0]).toBeLessThan(f.quota.reserveClient.mock.invocationCallOrder[0]!);
    const serialized = JSON.stringify(f.quota.reserveClient.mock.calls);
    for (const secret of [f.input.parentRef, f.input.tenantRef, f.input.sessionHash, f.input.qrToken]) expect(serialized).not.toContain(secret);
    expect(f.quota.reserveClient.mock.calls[0]![0].clientKey).not.toBe(f.quota.reserveClient.mock.calls[1]![0].clientKey);
  });
  it.each(['source', 'session', 'qr'])('stops at the first exhausted %s dimension without refunding earlier reservations', async dimension => {
    const f = fixture();
    if (dimension === 'source') f.quota.reserve.mockResolvedValue(false);
    else if (dimension === 'session') f.quota.reserveClient.mockResolvedValueOnce(false);
    else f.quota.reserveClient.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    await expect(f.reserve()).rejects.toMatchObject({ reason: 'limited' });
    expect(f.quota.reserveClient).toHaveBeenCalledTimes(dimension === 'source' ? 0 : dimension === 'session' ? 1 : 2);
  });
  it.each(['source', 'session', 'qr'])('fails closed on Redis failure at %s without exposing the exception', async dimension => {
    const f = fixture(); const error = new Error('private Redis connection details');
    if (dimension === 'source') f.quota.reserve.mockRejectedValue(error);
    else if (dimension === 'session') f.quota.reserveClient.mockRejectedValueOnce(error);
    else f.quota.reserveClient.mockResolvedValueOnce(true).mockRejectedValueOnce(error);
    const caught: unknown = await f.reserve().catch(error => error);
    expect(caught).toMatchObject({ reason: 'unavailable' });
    expect(String(caught)).not.toContain('private Redis connection details');
  });
  it('counts retries and keeps the global/source bucket independent of tenant or session rotation', async () => {
    const f = fixture(); await f.reserve(); await f.reserve();
    expect(f.quota.reserve).toHaveBeenCalledTimes(2);
    const firstSession = f.quota.reserveClient.mock.calls[0]![0].clientKey;
    const firstQr = f.quota.reserveClient.mock.calls[1]![0].clientKey;
    expect(f.quota.reserveClient.mock.calls[2]![0].clientKey).toBe(firstSession);
    expect(f.quota.reserveClient.mock.calls[3]![0].clientKey).toBe(firstQr);
    await reserveLoyaltyAttachmentQuota(f.quota as unknown as SharedPublicQuota, { ...f.input, tenantRef: 'another', sessionHash: 'd'.repeat(64) });
    expect(f.quota.reserve.mock.calls[2]).toEqual(f.quota.reserve.mock.calls[0]);
    expect(f.quota.reserveClient.mock.calls[4]![0].clientKey).not.toBe(firstSession);
    expect(f.quota.reserveClient.mock.calls[5]![0].clientKey).not.toBe(firstQr);
  });
  it.each([{ sourceClient: 'raw-ip' }, { sessionHash: 'raw-session' }, { qrToken: 'raw-qr' }])('refuses noncanonical keys before Redis (%j)', async patch => {
    const f = fixture();
    await expect(reserveLoyaltyAttachmentQuota(f.quota as unknown as SharedPublicQuota, { ...f.input, ...patch }))
      .rejects.toMatchObject({ reason: 'unavailable' });
    expect(f.quota.reserve).not.toHaveBeenCalled(); expect(f.quota.reserveClient).not.toHaveBeenCalled();
  });
});
