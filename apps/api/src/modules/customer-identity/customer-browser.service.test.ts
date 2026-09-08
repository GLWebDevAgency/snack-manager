import { approvedCustomerIntentResult, confirmedCustomerBrowserFixture, confirmedCustomerIntentFixture } from './customer-browser.test-fixture';
import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { CustomerIdentityCrypto, type CustomerIdentityRepository } from '@sm/customer';
import { CustomerIdentityService } from './customer-identity.service';
import { customerTestEnvironment } from './customer-account.test-fixture';

// Port-level orchestration evidence only. PG CAS/expiry tests live in @sm/customer.
function fixture() {
  let now = Date.parse('2026-09-08T10:00:00Z');
  const env = customerTestEnvironment(now), tenantRef = env.SM_CUSTOMER_PILOT_TENANT_ID!;
  const operationId = randomUUID(), intentProof = Buffer.alloc(32, 45).toString('base64url');
  const browserRef = randomUUID(), browserSecret = Buffer.alloc(32, 43).toString('base64url');
  const candidateSecret = Buffer.alloc(32, 44).toString('base64url');
  const crypto = new CustomerIdentityCrypto(env.SM_CUSTOMER_IDENTITY_KEY!);
  const parentRef = env.SM_CUSTOMER_VERIFY_ACCOUNT_SID!;
  const expiresAt = now + 6 * 86_400_000;
  const preparation = { browserRef, state: 'prepared' as const, admissionExpiresAt: now + 600_000, expiresAt };
  const phone = '+33612345678', phoneHash = crypto.hash('phone', tenantRef, phone);
  const pending = { challengeId: randomUUID(), phoneHash, expiresAt: now + 600_000,
    serviceSid: `VA${'b'.repeat(32)}`, verificationSid: `VE${'c'.repeat(32)}`,
    encryptedPhone: crypto.seal('phone', tenantRef, phoneHash, phone), funding: { mode: 'trial' as const } };
  const session = { sessionId: randomUUID(), expiresAt,
    profile: { accountId: randomUUID(), phoneHash, encryptedName: null, encryptedPhone: pending.encryptedPhone,
      phoneVerifiedAt: now, revision: 0 } };
  const repository = {
    ...confirmedCustomerBrowserFixture(browserRef, expiresAt),
    ...confirmedCustomerIntentFixture(operationId, now + 600_000),
    prepareBrowser: vi.fn().mockResolvedValue(preparation),
    issueBrowser: vi.fn().mockResolvedValue({ preparation: { ...preparation, state: 'issued' }, emitCookie: true }),
    confirmBrowser: vi.fn().mockResolvedValue({ ...preparation, state: 'confirmed' }),
    restoreBrowser: vi.fn().mockResolvedValue({ ...preparation, state: 'confirmed' }),
    validateBrowser: vi.fn().mockImplementation(async input => input.browserRef === browserRef
      && input.browserHash === crypto.hash('browser', tenantRef, browserSecret) ? { expiresAt } : null),
    reserve: vi.fn().mockResolvedValue({ kind: 'reserved', challengeId: pending.challengeId }),
    settleSend: vi.fn().mockResolvedValue(pending), claimCheck: vi.fn().mockResolvedValue(pending),
    recoverCheck: vi.fn().mockResolvedValue(null), completeCheck: vi.fn().mockResolvedValue({ kind: 'session', session }),
    authenticate: vi.fn().mockResolvedValue(session), updateName: vi.fn().mockResolvedValue(session),
    revoke: vi.fn().mockResolvedValue(undefined),
  } satisfies CustomerIdentityRepository;
  const transport = { start: vi.fn().mockResolvedValue({ verificationSid: pending.verificationSid }), check: vi.fn().mockResolvedValue('approved') };
  const beforeProvider = vi.fn().mockResolvedValue(undefined);
  const service = new CustomerIdentityService(repository, crypto, transport, () => ({ parentRef,
    environment: 'staging', mode: 'closed_trial', policy: JSON.parse(env.SM_CUSTOMER_VERIFY_POLICY!),
    evidence: JSON.parse(env.SM_CUSTOMER_VERIFY_EVIDENCE!) }), () => now, beforeProvider);
  const binding = { tenantRef, browserRef, browserSecret };
  const start = { ...binding, phone, operationId, intentProof, clientIp: 'fixture-client', humanVerified: true };
  const check = { ...binding, operationId, intentProof, challengeId: pending.challengeId, checkId: randomUUID(), code: '123456', existingSessionToken: null };
  const recover = { ...binding, operationId, intentProof, checkId: check.checkId };
  return { service, repository, transport, beforeProvider, preparation, parentRef, candidateSecret, crypto,
    binding, start, check, recover, session, expiresAt, advance: (ms: number) => { now += ms; } };
}

describe('browser preparation — service binding, no provider authorization', () => {
  it('restores only a confirmed public preparation from the existing cookie hash, without selecting a private session', async () => {
    const f = fixture(), { tenantRef, browserSecret } = f.binding;
    const result = await f.service.browser({ tenantRef, request: { step: 'restore' }, browserSecret, candidateSecret: null });
    expect(result).toEqual({ preparation: { ...f.preparation, state: 'confirmed' }, emitCookie: false });
    expect(f.repository.restoreBrowser).toHaveBeenCalledExactlyOnceWith({ parentRef: f.parentRef, tenantRef,
      browserHash: f.crypto.hash('browser', tenantRef, browserSecret) });
    expect(f.repository.validateBrowser).toHaveBeenCalledWith({ parentRef: f.parentRef, tenantRef,
      browserRef: f.binding.browserRef, browserHash: f.crypto.hash('browser', tenantRef, browserSecret) });
    for (const key of ['prepareBrowser', 'issueBrowser', 'confirmBrowser', 'reserve', 'authenticate', 'resultIntent', 'completeCheck'] as const) {
      expect(f.repository[key]).not.toHaveBeenCalled();
    }
    expect(f.transport.start).not.toHaveBeenCalled(); expect(f.transport.check).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain(browserSecret);
  });
  it.each([null, 'prepared', 'issued', 'expired'] as const)('does not turn %s into a restored preparation', async state => {
    const f = fixture(); f.repository.restoreBrowser.mockResolvedValue(state === null ? null : { ...f.preparation, state });
    await expect(f.service.browser({ tenantRef: f.binding.tenantRef, request: { step: 'restore' },
      browserSecret: f.binding.browserSecret, candidateSecret: null })).rejects.toMatchObject({ reason: 'unauthorized' });
  });
  it.each(['expired', 'outlived', 'invalidated', 'changed-expiry', 'private-field'] as const)(
    'refuses a restored preparation that is %s after the read', async failure => {
      const f = fixture();
      if (failure === 'expired') f.advance(7 * 86_400_000);
      if (failure === 'outlived') f.repository.restoreBrowser.mockResolvedValue({ ...f.preparation, state: 'confirmed', expiresAt: f.expiresAt + 7 * 86_400_000 });
      if (failure === 'invalidated') f.repository.validateBrowser.mockResolvedValue(null);
      if (failure === 'changed-expiry') f.repository.validateBrowser.mockResolvedValue({ expiresAt: f.expiresAt - 1 });
      if (failure === 'private-field') f.repository.restoreBrowser.mockResolvedValue({ ...f.preparation, state: 'confirmed', sessionToken: f.binding.browserSecret });
      await expect(f.service.browser({ tenantRef: f.binding.tenantRef, request: { step: 'restore' },
        browserSecret: f.binding.browserSecret, candidateSecret: null })).rejects.toBeDefined();
    });
  it.each([
    { request: { step: 'restore', browserRef: randomUUID() }, current: true, candidate: false },
    { request: { step: 'restore' }, current: false, candidate: false },
    { request: { step: 'restore' }, current: true, candidate: true },
  ])('rejects an inconsistent restoration envelope before storage', async value => {
    const f = fixture();
    await expect(f.service.browser({ tenantRef: f.binding.tenantRef, request: value.request,
      browserSecret: value.current ? f.binding.browserSecret : null,
      candidateSecret: value.candidate ? f.candidateSecret : null })).rejects.toMatchObject({ reason: 'invalid_request' });
    expect(f.repository.restoreBrowser).not.toHaveBeenCalled();
  });
  it('prepares, issues and confirms through distinct strict ports, exposing no raw secret', async () => {
    const f = fixture(); const { tenantRef, browserRef, browserSecret } = f.binding;
    const prepared = await f.service.browser({ tenantRef, request: { step: 'prepare', browserRef }, browserSecret: null, candidateSecret: null });
    expect(prepared).toEqual({ preparation: f.preparation, emitCookie: false });
    expect(f.repository.prepareBrowser).toHaveBeenCalledExactlyOnceWith({ parentRef: f.parentRef, tenantRef, browserRef });
    const issued = await f.service.browser({ tenantRef, request: { step: 'issue', browserRef }, browserSecret, candidateSecret: f.candidateSecret });
    expect(issued.emitCookie).toBe(true);
    expect(f.repository.issueBrowser).toHaveBeenCalledExactlyOnceWith({ parentRef: f.parentRef, tenantRef, browserRef,
      browserHash: f.crypto.hash('browser', tenantRef, f.candidateSecret), currentBrowserHash: f.crypto.hash('browser', tenantRef, browserSecret) });
    const confirmed = await f.service.browser({ tenantRef, request: { step: 'confirm', browserRef }, browserSecret, candidateSecret: null });
    expect(confirmed.preparation.state).toBe('confirmed'); expect(confirmed.emitCookie).toBe(false);
    expect(JSON.stringify([prepared, issued, confirmed])).not.toContain(browserSecret);
    expect(f.transport.start).not.toHaveBeenCalled(); expect(f.transport.check).not.toHaveBeenCalled();
    expect(f.repository.reserve).not.toHaveBeenCalled();
  });
  it('does not turn a lost issue replay into another cookie grant', async () => {
    const f = fixture(); f.repository.issueBrowser.mockResolvedValue({ preparation: { ...f.preparation, state: 'issued' }, emitCookie: false });
    expect((await f.service.browser({ tenantRef: f.binding.tenantRef, request: { step: 'issue', browserRef: f.binding.browserRef },
      browserSecret: null, candidateSecret: f.candidateSecret })).emitCookie).toBe(false);
  });
  it.each(['prepare', 'issue', 'confirm'] as const)('rejects a null storage result for %s without fabricating confirmation', async step => {
    const f = fixture(); f.repository.prepareBrowser.mockResolvedValue(null); f.repository.issueBrowser.mockResolvedValue(null); f.repository.confirmBrowser.mockResolvedValue(null);
    await expect(f.service.browser({ tenantRef: f.binding.tenantRef, request: { step, browserRef: f.binding.browserRef },
      browserSecret: step === 'confirm' ? f.binding.browserSecret : null,
      candidateSecret: step === 'issue' ? f.candidateSecret : null })).rejects.toBeDefined();
  });
  it.each(['prepare', 'issue', 'confirm'] as const)('refuses a mismatched preparation reference on %s', async step => {
    const f = fixture(), wrong = { ...f.preparation, browserRef: randomUUID() };
    f.repository.prepareBrowser.mockResolvedValue(wrong); f.repository.issueBrowser.mockResolvedValue({ preparation: { ...wrong, state: 'issued' }, emitCookie: true });
    f.repository.confirmBrowser.mockResolvedValue({ ...wrong, state: 'confirmed' });
    await expect(f.service.browser({ tenantRef: f.binding.tenantRef, request: { step, browserRef: f.binding.browserRef },
      browserSecret: step === 'confirm' ? f.binding.browserSecret : null,
      candidateSecret: step === 'issue' ? f.candidateSecret : null })).rejects.toBeDefined();
  });
  it.each(['start', 'check', 'recover', 'session', 'updateName', 'logout'] as const)('requires the confirmed ref AND cookie before %s', async method => {
    const f = fixture();
    const input = method === 'start' ? f.start : method === 'check' ? f.check : method === 'recover' ? f.recover
      : { ...f.binding, expectedOperationId: f.start.operationId, expectedCheckId: f.check.checkId,
        token: f.binding.browserSecret, ...(method === 'updateName' ? { name: null, expectedRevision: 0 } : method === 'logout' ? { all: false } : {}) };
    const { browserRef: _reference, ...missing } = input;
    await expect(f.service[method](missing)).rejects.toMatchObject({ reason: 'invalid_request' });
    await expect(f.service[method]({ ...input, browserRef: randomUUID() })).rejects.toMatchObject({ reason: 'unauthorized' });
    await expect(f.service[method]({ ...input, browserSecret: f.candidateSecret })).rejects.toMatchObject({ reason: 'unauthorized' });
    for (const key of ['reserve', 'claimCheck', 'recoverCheck', 'authenticate', 'updateName', 'revoke'] as const) expect(f.repository[key]).not.toHaveBeenCalled();
    expect(f.transport.start).not.toHaveBeenCalled(); expect(f.transport.check).not.toHaveBeenCalled();
  });
  it.each(['start', 'check'] as const)('checks browser expiry after the last async provider guard on %s', async method => {
    const f = fixture();
    f.beforeProvider.mockImplementation(async () => { f.repository.validateBrowser.mockResolvedValue(null); });
    await expect(f.service[method](f[method])).rejects.toBeDefined();
    expect(f.transport.start).not.toHaveBeenCalled(); expect(f.transport.check).not.toHaveBeenCalled();
  });
  it('caps the new session to the immutable browser expiry', async () => {
    const f = fixture(); await f.service.check(f.check);
    expect(f.repository.completeCheck).toHaveBeenCalledWith(expect.objectContaining({ browserRef: f.binding.browserRef, sessionExpiresAt: f.expiresAt }));
  });
  it('rejects recovered or authenticated sessions beyond browser expiry instead of extending it', async () => {
    const f = fixture(); f.session.expiresAt = f.expiresAt + 1000;
    f.repository.resultIntent.mockImplementation(approvedCustomerIntentResult({ operationId: f.start.operationId,
      challengeId: f.check.challengeId, checkId: f.check.checkId, expiresAt: f.preparation.admissionExpiresAt }, f.session));
    await expect(f.service.recover(f.recover)).rejects.toBeDefined();
    await expect(f.service.session({ ...f.binding, expectedOperationId: f.start.operationId, expectedCheckId: f.check.checkId,
      token: f.binding.browserSecret })).rejects.toBeDefined();
    expect(f.transport.check).not.toHaveBeenCalled();
  });
  it.each([
    { step: 'prepare', current: true, candidate: false },
    { step: 'prepare', current: false, candidate: true },
    { step: 'issue', current: false, candidate: false },
    { step: 'confirm', current: false, candidate: false },
    { step: 'confirm', current: true, candidate: true },
  ])('refuses inconsistent secrets for $step before any storage call', async value => {
    const f = fixture();
    await expect(f.service.browser({ tenantRef: f.binding.tenantRef,
      request: { step: value.step, browserRef: f.binding.browserRef },
      browserSecret: value.current ? f.binding.browserSecret : null,
      candidateSecret: value.candidate ? f.candidateSecret : null })).rejects.toMatchObject({ reason: 'invalid_request' });
    expect(f.repository.prepareBrowser).not.toHaveBeenCalled(); expect(f.repository.issueBrowser).not.toHaveBeenCalled();
    expect(f.repository.confirmBrowser).not.toHaveBeenCalled(); expect(f.transport.start).not.toHaveBeenCalled();
  });
  it.each(['prepared', 'confirmed', 'expired'] as const)('never emits a cookie for a repository response in state %s', async state => {
    const f = fixture(); f.repository.issueBrowser.mockResolvedValue({ preparation: { ...f.preparation, state }, emitCookie: true });
    await expect(f.service.browser({ tenantRef: f.binding.tenantRef, request: { step: 'issue', browserRef: f.binding.browserRef },
      browserSecret: null, candidateSecret: f.candidateSecret })).rejects.toBeDefined();
  });
  it.each(['start', 'check'] as const)('does not expose a private result when its browser expires during %s', async action => {
    const f = fixture();
    if (action === 'start') f.repository.settleSend.mockImplementation(async () => { f.advance(7 * 86_400_000); return null; });
    else f.repository.completeCheck.mockImplementation(async () => { f.advance(7 * 86_400_000); return { kind: 'session', session: f.session }; });
    await expect(f.service[action](f[action])).rejects.toBeDefined();
    expect(action === 'start' ? f.transport.start : f.transport.check).toHaveBeenCalledTimes(1);
  });
  it.each([null, { expiresAt: 0 }, { expiresAt: NaN }, { expiresAt: Number.MAX_SAFE_INTEGER + 1 }])(
    'fails closed on an unusable validation receipt', async result => {
      const f = fixture(); f.repository.validateBrowser.mockResolvedValue(result);
      await expect(f.service.requireBrowser(f.binding)).rejects.toMatchObject({ reason: 'unauthorized' });
      expect(f.transport.start).not.toHaveBeenCalled();
    });
});
