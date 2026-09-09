import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type { CustomerAccountRequest } from '../customer-account/client';
import type { CheckoutAccountAccess, PendingCheckoutAttempt } from './checkout-attempt';
import { captureCheckoutProvenance, checkoutAccessMatches, createCheckoutAttemptOrder } from './checkout-account';

const now = Date.now();
const access: CheckoutAccountAccess = { selection: { browserRef: randomUUID(), publication: { expectedOperationId: randomUUID(), expectedCheckId: randomUUID() } }, expiresAt: now + 60_000, privacyEpoch: 0 };
const payload = { lines: [{ productId: 'a'.repeat(24), qty: 1, options: [], removed: [] }],
  payment: { method: 'counter' as const }, pickup: { slot: '2030-09-09T18:00:00.000Z', customerName: 'Client de recette', customerPhone: '0600000000' } };
const order = { _id: 'b'.repeat(24), number: 1, status: 'new' as const, type: 'pickup' as const,
  payment: { method: 'counter' as const, status: 'pending' as const }, totals: { subtotal: 500, deliveryFee: 0, discount: null, total: 500 },
  pickup: { slot: payload.pickup.slot, customerName: payload.pickup.customerName }, delivery: null, trackingToken: 'fixture-tracking' };
function attempt(account = true): PendingCheckoutAttempt {
  return { v: 2, tenant: 'recette', origin: 'https://recette.invalid', clientId: randomUUID(), cartFingerprint: 'a'.repeat(64), createdAt: now, updatedAt: now,
    state: 'uncertain', payload, recoveryProof: 'b'.repeat(64), provenance: account ? { kind: 'account', ...structuredClone(access) } : { kind: 'guest' } };
}
function fixture() {
  let current: CheckoutAccountAccess | null = structuredClone(access);
  const accountRequest = vi.fn<CustomerAccountRequest>(async () => ({ state: 'created', expiresAt: access.expiresAt, order }));
  const guestCreate = vi.fn(async () => order);
  const port = { slug: 'recette', currentAccess: () => current, accountRequest: accountRequest as CustomerAccountRequest, guestCreate, now: () => now };
  return { port, accountRequest, guestCreate, change: (next: CheckoutAccountAccess | null) => { current = next; } };
}
describe('checkout pinned account transport', () => {
  it('captures a detached identity before awaits, never a profile or phone', () => {
    const source = structuredClone(access), provenance = captureCheckoutProvenance('authenticated', source, true, now);
    source.selection.publication.expectedCheckId = randomUUID();
    expect(provenance).toEqual({ kind: 'account', ...access });
    expect(captureCheckoutProvenance('guest', null, true, now)).toEqual({ kind: 'guest' });
    expect(captureCheckoutProvenance('idle', null, false, now)).toEqual({ kind: 'guest' });
  });
  it.each(['idle', 'loading', 'authenticated', 'offline', 'error', 'unavailable'] as const)('does not silently turn unconfirmed %s into guest', status => {
    expect(() => captureCheckoutProvenance(status, null, true, now)).toThrow();
  });
  it('rejects expired or changed access, including the same publication after logout', () => {
    const provenance = { kind: 'account' as const, ...access };
    expect(checkoutAccessMatches(provenance, access, now)).toBe(true);
    for (const next of [null, { ...access, privacyEpoch: 1 }, { ...access, expiresAt: now },
      { ...access, selection: { ...access.selection, publication: { ...access.selection.publication, expectedCheckId: randomUUID() } } }]) {
      expect(checkoutAccessMatches(provenance, next, now)).toBe(false);
    }
  });
  it('sends the same C01 payload only to the pinned account route', async () => {
    const f = fixture(), pending = attempt();
    expect(await createCheckoutAttemptOrder(f.port, pending, 'fresh-turnstile')).toEqual({ state: 'created', order });
    expect(f.accountRequest).toHaveBeenCalledExactlyOnceWith('order-create', { ...payload, clientId: pending.clientId, recoveryProof: pending.recoveryProof, turnstileToken: 'fresh-turnstile' }, access.selection);
    expect(f.guestCreate).not.toHaveBeenCalled();
  });
  it('keeps an existing guest attempt guest even after login', async () => {
    const f = fixture(), pending = attempt(false);
    expect(await createCheckoutAttemptOrder(f.port, pending, 'challenge')).toEqual({ state: 'created', order });
    expect(f.guestCreate).toHaveBeenCalledExactlyOnceWith('recette', { ...payload, clientId: pending.clientId, recoveryProof: pending.recoveryProof, turnstileToken: 'challenge' });
    expect(f.accountRequest).not.toHaveBeenCalled();
  });
  it('keeps a v1 journal guest without inventing an account provenance', async () => {
    const f = fixture(), pending = { ...attempt(false), v: 1 as const, provenance: undefined };
    expect(await createCheckoutAttemptOrder(f.port, pending, 'challenge')).toEqual({ state: 'created', order });
    expect(f.guestCreate).toHaveBeenCalledExactlyOnceWith('recette', { ...payload, clientId: pending.clientId, recoveryProof: pending.recoveryProof, turnstileToken: 'challenge' });
    expect(f.accountRequest).not.toHaveBeenCalled();
  });
  it('refuses an identity changed before send without any POST', async () => {
    const f = fixture(); f.change(null);
    await expect(createCheckoutAttemptOrder(f.port, attempt(), 'challenge')).rejects.toMatchObject({ status: 409 });
    expect(f.accountRequest).not.toHaveBeenCalled(); expect(f.guestCreate).not.toHaveBeenCalled();
  });
  it.each([true, false])('never dispatches an attempt to another restaurant (account: %s)', async account => {
    const f = fixture(); f.port.slug = 'autre-restaurant';
    await expect(createCheckoutAttemptOrder(f.port, attempt(account), 'challenge')).rejects.toMatchObject({ status: 409 });
    expect(f.accountRequest).not.toHaveBeenCalled(); expect(f.guestCreate).not.toHaveBeenCalled();
  });
  it('requires durable uncertain state and explicit v2 provenance before dispatch', async () => {
    const missing = { ...attempt(), provenance: undefined };
    for (const pending of [{ ...attempt(), state: 'prepared' as const }, missing]) {
      const f = fixture();
      await expect(createCheckoutAttemptOrder(f.port, pending, 'challenge')).rejects.toMatchObject({ status: 409 });
      expect(f.accountRequest).not.toHaveBeenCalled(); expect(f.guestCreate).not.toHaveBeenCalled();
    }
  });
  it.each(['logout', 'publication', 'epoch'] as const)('rejects a held response after %s without replay or guest fallback', async change => {
    const f = fixture(); let release!: (value: unknown) => void;
    f.accountRequest.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
    const result = createCheckoutAttemptOrder(f.port, attempt(), 'challenge');
    f.change(change === 'logout' ? null : change === 'epoch' ? { ...access, privacyEpoch: 1 }
      : { ...access, selection: { ...access.selection, publication: { expectedOperationId: randomUUID(), expectedCheckId: randomUUID() } } });
    release({ state: 'created', expiresAt: access.expiresAt, order });
    await expect(result).rejects.toMatchObject({ status: 409 });
    expect(f.accountRequest).toHaveBeenCalledTimes(1); expect(f.guestCreate).not.toHaveBeenCalled();
  });
  it.each([401, 409, 503, 0])('never retries or falls back after status/transport failure %i', async status => {
    const f = fixture(); f.accountRequest.mockRejectedValueOnce(Object.assign(new Error('fixture'), { status }));
    await expect(createCheckoutAttemptOrder(f.port, attempt(), 'challenge')).rejects.toThrow();
    expect(f.accountRequest).toHaveBeenCalledTimes(1); expect(f.guestCreate).not.toHaveBeenCalled();
  });
  it('requires the exact session expiration and a valid response contract', async () => {
    for (const response of [{ state: 'created', expiresAt: access.expiresAt + 1, order }, { state: 'created', expiresAt: access.expiresAt, order: { ...order, trackingToken: '' } }]) {
      const f = fixture(); f.accountRequest.mockResolvedValueOnce(response);
      await expect(createCheckoutAttemptOrder(f.port, attempt(), 'challenge')).rejects.toThrow();
      expect(f.guestCreate).not.toHaveBeenCalled();
    }
  });
});
