import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { CustomerIdentityCrypto, withProtectedCustomerSession, type ProtectedCustomerSession } from '@sm/customer';
import { LoyaltyCryptoAdapter } from '@sm/loyalty';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CustomerSaleAttributionService } from './customer-sale-attribution.service';
import { readCustomerLoyaltySaleAttribution } from './customer-loyalty.store';

vi.mock('@sm/customer', async original => ({ ...await original<typeof import('@sm/customer')>(), withProtectedCustomerSession: vi.fn() }));
vi.mock('./customer-loyalty.store', () => ({ readCustomerLoyaltySaleAttribution: vi.fn() }));

function fixture() {
  const owner = { parentRef: `AC${'1'.repeat(32)}`, tenantRef: 'a'.repeat(24), accountId: randomUUID() };
  const session: ProtectedCustomerSession = { sessionId: randomUUID(), expiresAt: Date.now() + 60_000,
    profile: { accountId: owner.accountId, phoneHash: 'd'.repeat(64), encryptedName: 'private-name',
      encryptedPhone: 'private-phone', phoneVerifiedAt: Date.now(), revision: 0 } };
  const state = { session: session as ProtectedCustomerSession | null, inTransaction: false };
  vi.mocked(withProtectedCustomerSession).mockImplementation(async (_pool, _selection, work) => {
    if (!state.session) return null;
    state.inTransaction = true;
    try { return await work({ client: { query: vi.fn().mockResolvedValue({ rows: [{ now: new Date() }] }) } as never, session: state.session }); }
    finally { state.inTransaction = false; }
  });
  const decision = { decision: 'attributed' as const, memberId: randomUUID(), membershipOperationId: randomUUID(),
    programId: randomUUID(), rulesVersion: 2, rule: { mechanism: 'points' as const, minimumPurchaseCents: 500,
      maximumUnitsPerPurchase: 50, spendStepCents: 100, unitsPerStep: 2 } };
  vi.mocked(readCustomerLoyaltySaleAttribution).mockResolvedValue(decision);
  const input = { selection: { parentRef: owner.parentRef, tenantRef: owner.tenantRef, browserRef: randomUUID(), browserHash: 'b'.repeat(64),
    sessionHash: 'c'.repeat(64), expectedOperationId: randomUUID(), expectedCheckId: randomUUID(), now: Date.now() },
    identity: new CustomerIdentityCrypto(Buffer.alloc(32, 60).toString('base64')),
    expected: { owner, sessionId: session.sessionId, expiresAt: session.expiresAt }, clientId: randomUUID(),
    totals: { subtotalCents: 1500, discountCents: 500, deliveryFeeCents: 300, totalCents: 1300 },
    enabled: vi.fn(async () => { expect(state.inTransaction).toBe(false); return true; }) };
  const service = new CustomerSaleAttributionService({} as Pool, {} as LoyaltyCryptoAdapter);
  return { service, input, owner, session, state, decision };
}
beforeEach(() => vi.resetAllMocks());

describe('private sale attribution preparation', () => {
  it('captures server merchandise-net basis and the current historical rule, without private session material', async () => {
    const f = fixture(); const before = Date.now();
    const result = await f.service.prepare(f.input);
    expect(result).toEqual({ version: 1, tenantRef: f.owner.tenantRef, clientId: f.input.clientId, owner: f.owner,
      capturedAt: expect.any(Number), basis: { policyVersion: 'merchandise-net-v1', eligiblePurchaseCents: 1000,
        excludedChargeCents: 300, chargedTotalCents: 1300 }, ...f.decision });
    expect((result as { capturedAt: number }).capturedAt).toBeGreaterThanOrEqual(before);
    expect((result as { capturedAt: number }).capturedAt).toBeLessThanOrEqual(Date.now());
    expect(JSON.stringify(result)).not.toMatch(/private-name|private-phone|phoneHash|sessionHash|browserHash|balanceUnits|qrToken/);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen((result as { owner: unknown }).owner)).toBe(true);
    expect(Object.isFrozen((result as { basis: unknown }).basis)).toBe(true);
    expect(Object.isFrozen((result as { rule: unknown }).rule)).toBe(true);
  });
  it.each(['not_enrolled', 'program_inactive', 'member_inactive'] as const)('keeps the proven business absence %s explicit', async reason => {
    const f = fixture(); vi.mocked(readCustomerLoyaltySaleAttribution).mockResolvedValue({ decision: 'none', reason });
    expect(await f.service.prepare(f.input)).toMatchObject({ decision: 'none', reason });
  });
  it('requires the exact protected session even when the capability is absent, without running the loyalty reader', async () => {
    const f = fixture(); f.input.enabled.mockResolvedValue(false);
    expect(await f.service.prepare(f.input)).toMatchObject({ decision: 'none', reason: 'feature_unavailable' });
    expect(withProtectedCustomerSession).toHaveBeenCalledTimes(1);
    expect(readCustomerLoyaltySaleAttribution).not.toHaveBeenCalled();
    f.state.session = null;
    await expect(f.service.prepare(f.input)).rejects.toMatchObject({ reason: 'unauthorized' });
  });
  it.each(['account', 'session', 'expiry', 'expired', 'parent', 'tenant'] as const)('rejects a mismatching initial %s before reading loyalty', async kind => {
    const f = fixture();
    if (kind === 'parent') f.input.expected.owner.parentRef = `AC${'2'.repeat(32)}`;
    else if (kind === 'tenant') f.input.expected.owner.tenantRef = '2'.repeat(24);
    else f.state.session = { ...f.session,
      sessionId: kind === 'session' ? randomUUID() : f.session.sessionId,
      expiresAt: kind === 'expired' ? Date.now() - 1 : kind === 'expiry' ? f.session.expiresAt + 1 : f.session.expiresAt,
      profile: { ...f.session.profile, accountId: kind === 'account' ? randomUUID() : f.owner.accountId } };
    await expect(f.service.prepare(f.input)).rejects.toMatchObject({ reason: 'unauthorized' });
    expect(readCustomerLoyaltySaleAttribution).not.toHaveBeenCalled();
  });
  it('keeps capability lookup outside SQL and does not turn its technical failure into feature_unavailable', async () => {
    const f = fixture(); f.input.enabled.mockRejectedValue(new Error('PRIVATE MONGO URI'));
    await expect(f.service.prepare(f.input)).rejects.toMatchObject({ reason: 'unavailable', message: 'Service de compte momentanément indisponible.' });
    expect(withProtectedCustomerSession).not.toHaveBeenCalled();
  });
  it('pins A and its server basis before the external capability wait, despite later mutations of caller objects', async () => {
    const f = fixture(); const initial = structuredClone({ selection: f.input.selection, expected: f.input.expected,
      clientId: f.input.clientId, totals: f.input.totals });
    let release!: (enabled: boolean) => void;
    f.input.enabled.mockImplementation(() => new Promise<boolean>(resolve => { release = resolve; }));
    const pending = f.service.prepare(f.input);
    f.input.selection.browserHash = 'e'.repeat(64); f.input.selection.expectedOperationId = randomUUID();
    f.input.expected.owner.accountId = randomUUID(); f.input.expected.sessionId = randomUUID();
    f.input.expected.expiresAt += 60_000; f.input.clientId = randomUUID();
    f.input.totals.subtotalCents = 9900; f.input.totals.totalCents = 9700;
    release(true);
    const result = await pending;
    expect(result).toMatchObject({ owner: initial.expected.owner, clientId: initial.clientId,
      basis: { eligiblePurchaseCents: 1000, excludedChargeCents: 300, chargedTotalCents: 1300 } });
    expect(withProtectedCustomerSession).toHaveBeenCalledWith(expect.anything(), { ...initial.selection, now: expect.any(Number) }, expect.any(Function));
  });
  it.each(['sql', 'corruption', 'final-authority'] as const)('does not emit an absence or raw cause for %s failure', async kind => {
    const f = fixture();
    if (kind === 'final-authority') vi.mocked(withProtectedCustomerSession).mockRejectedValue(new Error('PRIVATE FINAL SQL'));
    else vi.mocked(readCustomerLoyaltySaleAttribution).mockRejectedValue(new Error('PRIVATE SQL/profile/QR'));
    const error = await f.service.prepare(f.input).catch(value => value);
    expect(error).toMatchObject({ reason: 'unavailable', message: 'Service de compte momentanément indisponible.' });
    expect(error).not.toHaveProperty('cause'); expect(JSON.stringify(error)).not.toContain('PRIVATE');
  });
  it.each([NaN, 1.5, -1, Number.MAX_SAFE_INTEGER + 1])('rejects invalid server amounts (%s) before external work', async subtotalCents => {
    const f = fixture(); f.input.totals.subtotalCents = subtotalCents;
    await expect(f.service.prepare(f.input)).rejects.toMatchObject({ reason: 'unavailable' });
    expect(f.input.enabled).not.toHaveBeenCalled(); expect(withProtectedCustomerSession).not.toHaveBeenCalled();
  });
  it('rejects a malformed returned rule instead of freezing an apparently valid attribution', async () => {
    const f = fixture(); vi.mocked(readCustomerLoyaltySaleAttribution).mockResolvedValue({ ...f.decision,
      rule: { ...f.decision.rule, spendStepCents: 0 } });
    await expect(f.service.prepare(f.input)).rejects.toMatchObject({ reason: 'unavailable' });
  });
});
