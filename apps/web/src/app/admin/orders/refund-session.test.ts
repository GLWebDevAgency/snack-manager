import { afterEach, describe, expect, it, vi } from 'vitest';
import { refundSession } from './refund-session';
vi.mock('@/lib/api', () => ({ getToken: () => null }));
const claims = { kind: 'user', role: 'owner', sub: 'a'.repeat(24), tenantId: 'b'.repeat(24), exp: 2_000_000_000 };
const token = (value: unknown) => `header.${Buffer.from(JSON.stringify(value)).toString('base64url')}.signature`;
afterEach(() => vi.unstubAllGlobals());
describe('refund session local authority and durable storage', () => {
  it.each([null, '', 'invalid', token({ ...claims, kind: 'staff' }), token({ ...claims, role: 'cogerant' }), token({ ...claims, exp: 1 }), token({ ...claims, tenantId: 'other' }), token({ ...claims, sub: {} }), token({ ...claims, exp: null })])('refuses an unavailable owner identity %#', value => {
    expect(() => refundSession(() => value)).toThrow('session');
  });
  it('pins the exact session, even if replacement token has the same actor', () => {
    let current = token(claims);
    const session = refundSession(() => current);
    expect(session.ownerId).toBe(`${claims.tenantId}:user:${claims.sub}`);
    session.assertCurrent(); current += 'changed';
    expect(session.assertCurrent).toThrow('session');
  });
  it('refuses expiry and storage access after logout', async () => {
    let current: string | null = token(claims), now = 1_999_999_999_000;
    const session = refundSession(() => current, () => now);
    now += 1000; expect(session.assertCurrent).toThrow('session');
    current = null; await expect(session.store.getItem('journal')).rejects.toThrow('session');
  });
  it('has no memory fallback when storage is unavailable', async () => {
    vi.stubGlobal('localStorage', undefined);
    const session = refundSession(() => token(claims));
    await expect(session.store.setItem('journal', 'intent')).rejects.toThrow('stockage');
  });
  it('detects a storage adapter that silently drops writes and removals', async () => {
    vi.stubGlobal('localStorage', { getItem: () => 'original', setItem: () => {}, removeItem: () => {} });
    const session = refundSession(() => token(claims));
    await expect(session.store.setItem('journal', 'intent')).rejects.toThrow('conservée');
    await expect(session.store.removeItem('journal')).rejects.toThrow('conservée');
  });
});
