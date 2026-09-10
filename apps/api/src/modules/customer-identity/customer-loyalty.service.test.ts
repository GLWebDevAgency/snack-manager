import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { CustomerIdentityCrypto, withProtectedCustomerSession, type ProtectedCustomerSession } from '@sm/customer';
import { LoyaltyCryptoAdapter } from '@sm/loyalty';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CustomerLoyaltyService } from './customer-loyalty.service';
import { CustomerLoyaltyStoreError, runCustomerLoyalty } from './customer-loyalty.store';

vi.mock('@sm/customer', async original => ({ ...await original<typeof import('@sm/customer')>(), withProtectedCustomerSession: vi.fn() }));
vi.mock('./customer-loyalty.store', () => ({ runCustomerLoyalty: vi.fn(),
  CustomerLoyaltyStoreError: class extends Error { constructor(readonly result: unknown) { super('safe refusal'); } } }));

function fixture() {
  const session: ProtectedCustomerSession = { sessionId: randomUUID(), expiresAt: Date.now() + 60_000,
    profile: { accountId: randomUUID(), phoneHash: 'a'.repeat(64), encryptedName: 'fixture', encryptedPhone: 'fixture', phoneVerifiedAt: Date.now(), revision: 0 } };
  const state = { session: session as ProtectedCustomerSession | null, rolledBack: false };
  vi.mocked(withProtectedCustomerSession).mockImplementation(async (_pool, _selection, work) => {
    if (!state.session) return null;
    try { return await work({ client: {} as never, session: state.session }); }
    catch (error) { state.rolledBack = true; throw error; }
  });
  vi.mocked(runCustomerLoyalty).mockResolvedValue({ state: 'member', member: { id: randomUUID(), joinedAt: new Date().toISOString(),
    qrGeneration: 1, balanceUnits: 0, unitLabelSingular: 'point', unitLabelPlural: 'points' } });
  const input = { selection: { parentRef: 'parent', tenantRef: 'tenant', browserRef: randomUUID(), browserHash: 'b'.repeat(64),
    sessionHash: 'c'.repeat(64), expectedOperationId: randomUUID(), expectedCheckId: randomUUID(), now: Date.now() },
    identity: new CustomerIdentityCrypto(Buffer.alloc(32, 60).toString('base64')),
    request: { step: 'view' }, enabled: vi.fn().mockResolvedValue(true), publicationFence: vi.fn() };
  const service = new CustomerLoyaltyService({} as Pool, {} as LoyaltyCryptoAdapter);
  return { service, input, state, session };
}
beforeEach(() => { vi.resetAllMocks(); });
describe('account loyalty orchestration and publication fence', () => {
  it('forwards only validated requests to the local SQL store and registers a last authority check', async () => {
    const f = fixture(); const response = await f.service.execute(f.input);
    expect(response.state).toBe('member'); expect(response.expiresAt).toBe(f.session.expiresAt);
    expect(runCustomerLoyalty).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ session: f.session,
      scope: f.input.selection, identity: f.input.identity }), { step: 'view' });
    expect(f.input.publicationFence).toHaveBeenCalledTimes(1);
    expect(withProtectedCustomerSession).toHaveBeenCalledTimes(2);
  });
  it('rejects injected account authority before any gate or SQL call', async () => {
    const f = fixture(); await expect(f.service.execute({ ...f.input, request: { step: 'view', accountId: randomUUID() } }))
      .rejects.toMatchObject({ reason: 'invalid_request' });
    expect(withProtectedCustomerSession).not.toHaveBeenCalled(); expect(f.input.enabled).not.toHaveBeenCalled();
  });
  it('requires protection even when the commercial capability is closed', async () => {
    const f = fixture(); f.input.enabled.mockResolvedValue(false);
    expect(await f.service.execute(f.input)).toEqual({ state: 'unavailable', expiresAt: f.session.expiresAt });
    expect(runCustomerLoyalty).not.toHaveBeenCalled();
    f.state.session = null;
    await expect(f.service.execute(f.input)).rejects.toMatchObject({ reason: 'unauthorized' });
  });
  it('does not execute writes without a protected session', async () => {
    const f = fixture(); f.state.session = null;
    await expect(f.service.execute(f.input)).rejects.toMatchObject({ reason: 'unauthorized' });
    expect(runCustomerLoyalty).not.toHaveBeenCalled();
  });
  it.each([
    ['member_profiles_tenant_phone_uq', 'existing_card'],
    ['operations_tenant_ref_operation_id_pk', 'conflict'],
  ])('translates only %s after rollback and fresh authority', async (constraint, expected) => {
    const f = fixture(); vi.mocked(runCustomerLoyalty).mockRejectedValue({ code: '23505', constraint, detail: 'PRIVATE SQL DETAILS' });
    f.input.enabled.mockImplementation(async () => { if (f.input.enabled.mock.calls.length > 1) expect(f.state.rolledBack).toBe(true); return true; });
    expect(await f.service.execute(f.input)).toEqual({ state: expected, expiresAt: f.session.expiresAt });
    expect(withProtectedCustomerSession).toHaveBeenCalledTimes(2);
  });
  it('does not classify unrelated SQL failures as a phone collision or leak their details', async () => {
    const f = fixture(); vi.mocked(runCustomerLoyalty).mockRejectedValue({ code: '23505', constraint: 'other_unique', detail: 'PRIVATE SQL DETAILS' });
    await expect(f.service.execute(f.input)).rejects.toMatchObject({ reason: 'unavailable' });
  });
  it('does not publish a safe business refusal after concurrent logout', async () => {
    const f = fixture(); vi.mocked(runCustomerLoyalty).mockImplementation(async () => {
      f.state.session = null; throw new CustomerLoyaltyStoreError({ state: 'name_required' });
    });
    await expect(f.service.execute(f.input)).rejects.toMatchObject({ reason: 'unauthorized' });
    expect(f.state.rolledBack).toBe(true);
  });
  it('fences a capability removed during the transaction without publishing its receipt', async () => {
    const f = fixture(); f.input.enabled.mockResolvedValueOnce(true).mockResolvedValue(false);
    await expect(f.service.execute(f.input)).rejects.toMatchObject({ reason: 'unavailable' });
  });
  it.each(['account', 'session', 'expiry'] as const)('refuses a changed %s during final runtime publication', async changed => {
    const f = fixture(); await f.service.execute(f.input);
    f.state.session = { ...f.session, ...(changed === 'session' ? { sessionId: randomUUID() }
      : changed === 'expiry' ? { expiresAt: f.session.expiresAt + 1 } : {}),
      profile: { ...f.session.profile, ...(changed === 'account' ? { accountId: randomUUID() } : {}) } };
    await expect(f.input.publicationFence.mock.calls[0]![0]()).rejects.toMatchObject({ reason: 'unauthorized' });
  });
  it('refuses a captured QR replaced during later runtime checks', async () => {
    const f = fixture(); const member = { id: randomUUID(), joinedAt: new Date().toISOString(), qrGeneration: 1,
      balanceUnits: 0, unitLabelSingular: 'point', unitLabelPlural: 'points' };
    const qrToken = Buffer.alloc(32, 4).toString('base64url');
    vi.mocked(runCustomerLoyalty).mockResolvedValue({ state: 'card', member, qrToken });
    expect((await f.service.execute({ ...f.input, request: { step: 'card' } })).state).toBe('card');
    vi.mocked(runCustomerLoyalty).mockResolvedValue({ state: 'card', member: { ...member, qrGeneration: 2 }, qrToken: Buffer.alloc(32, 5).toString('base64url') });
    await expect(f.input.publicationFence.mock.calls[0]![0]()).rejects.toMatchObject({ reason: 'unavailable' });
  });
});
