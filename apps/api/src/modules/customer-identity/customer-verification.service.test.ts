import { randomBytes, randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { CustomerIdentityCrypto, type CustomerIdentityRepository } from '@sm/customer';
import { CustomerIdentityService } from './customer-identity.service';
import { customerTestEnvironment } from './customer-account.test-fixture';
import { confirmedCustomerBrowserFixture } from './customer-browser.test-fixture';

// Orchestration-only ports. The package's native PG suite proves their fences.
function fixture() {
  let now = Date.parse('2026-09-08T10:00:00Z');
  const env = customerTestEnvironment(now), browserRef = randomUUID(), operationId = randomUUID();
  const browserSecret = randomBytes(32).toString('base64url'), intentProof = randomBytes(32).toString('base64url');
  const tenantRef = env.SM_CUSTOMER_PILOT_TENANT_ID!, parentRef = env.SM_CUSTOMER_VERIFY_ACCOUNT_SID!;
  const crypto = new CustomerIdentityCrypto(env.SM_CUSTOMER_IDENTITY_KEY!);
  const intent = { operationId, state: 'open' as const, expiresAt: now + 600_000 };
  const phone = '+33612345678', phoneHash = crypto.hash('phone', tenantRef, phone);
  const pending = { challengeId: randomUUID(), expiresAt: intent.expiresAt, phoneHash,
    serviceSid: `VA${'b'.repeat(32)}`, verificationSid: `VE${'c'.repeat(32)}`, funding: { mode: 'trial' as const },
    encryptedPhone: crypto.seal('phone', tenantRef, phoneHash, phone) };
  const session = { sessionId: randomUUID(), expiresAt: now + 604_800_000,
    profile: { accountId: randomUUID(), phoneHash, encryptedPhone: pending.encryptedPhone,
      encryptedName: null, phoneVerifiedAt: now, revision: 0 } };
  const repository = {
    ...confirmedCustomerBrowserFixture(browserRef, session.expiresAt),
    prepareIntent: vi.fn().mockResolvedValue({ intent, emitCookie: true }),
    closeIntent: vi.fn().mockResolvedValue({ ...intent, state: 'closed' }),
    validateIntent: vi.fn().mockImplementation(async input => input.operationId === operationId
      && input.proofHash === crypto.hash('intent-proof', tenantRef, intentProof) ? { expiresAt: intent.expiresAt } : null),
    resultIntent: vi.fn().mockResolvedValue({ operationId, state: 'unresolved', challengeId: null, checkId: null, expiresAt: intent.expiresAt }),
    reserve: vi.fn().mockResolvedValue({ kind: 'reserved', challengeId: pending.challengeId }),
    settleSend: vi.fn().mockResolvedValue(pending), recoverCheck: vi.fn().mockResolvedValue(null),
    claimCheck: vi.fn().mockResolvedValue(pending), completeCheck: vi.fn().mockResolvedValue(session),
    authenticate: vi.fn().mockResolvedValue(session), updateName: vi.fn().mockResolvedValue(session), revoke: vi.fn().mockResolvedValue(undefined),
  };
  const provider = { start: vi.fn().mockResolvedValue({ verificationSid: pending.verificationSid }), check: vi.fn().mockResolvedValue('approved') };
  const beforeProvider = vi.fn().mockResolvedValue(undefined);
  const configuration = { environment: 'staging', parentRef, mode: 'closed_trial' as const,
    policy: JSON.parse(env.SM_CUSTOMER_VERIFY_POLICY!), evidence: JSON.parse(env.SM_CUSTOMER_VERIFY_EVIDENCE!) };
  const service = new CustomerIdentityService(repository as CustomerIdentityRepository, crypto, provider, () => configuration, () => now, beforeProvider);
  const binding = { tenantRef, browserRef, browserSecret };
  const start = { ...binding, operationId, intentProof, phone, clientIp: 'fixture-client', humanVerified: true };
  const check = { ...binding, operationId, intentProof, challengeId: pending.challengeId, checkId: randomUUID(), code: '123456', existingSessionToken: null };
  const recover = { ...binding, operationId, intentProof, checkId: null };
  return { service, repository, provider, configuration, beforeProvider, crypto, intent, binding, start, check, recover,
    session, pending, intentProof, advance: (ms: number) => { now += ms; } };
}

describe('verification intent and result — API use cases', () => {
  it.each(['session', 'updateName', 'logout'] as const)('requires the selected public publication on %s without reusing the short-lived intent proof', async action => {
    const f = fixture();
    const input = { ...f.binding, token: f.binding.browserSecret,
      ...(action === 'updateName' ? { name: null, expectedRevision: 0 } : action === 'logout' ? { all: false } : {}) };
    await expect(f.service[action](input)).rejects.toMatchObject({ reason: 'invalid_request' });
    const publication = { expectedOperationId: f.intent.operationId, expectedCheckId: f.check.checkId };
    f.advance(600_001); f.repository.validateIntent.mockResolvedValue(null);
    await f.service[action]({ ...input, ...publication });
    const method = action === 'session' ? 'authenticate' : action === 'updateName' ? 'updateName' : 'revoke';
    expect(f.repository[method]).toHaveBeenCalledWith(expect.objectContaining(publication));
    expect(f.repository.validateIntent).not.toHaveBeenCalled(); expect(f.repository.resultIntent).not.toHaveBeenCalled();
    expect(f.provider.start).not.toHaveBeenCalled(); expect(f.provider.check).not.toHaveBeenCalled();
  });
  it('prepares a one-shot private intent without an SMS or quota reservation', async () => {
    const f = fixture();
    const result = await f.service.intent({ ...f.binding, request: { step: 'prepare', operationId: f.intent.operationId }, candidateProof: f.intentProof });
    expect(result).toEqual({ intent: f.intent, emitCookie: true });
    expect(JSON.stringify(result)).not.toContain(f.intentProof);
    expect(f.repository.reserve).not.toHaveBeenCalled(); expect(f.provider.start).not.toHaveBeenCalled();
  });
  it('closes a guest intent without requiring a session or making a provider call', async () => {
    const f = fixture();
    await expect(f.service.intent({ ...f.binding, request: { step: 'close', operationId: f.intent.operationId }, candidateProof: null }))
      .resolves.toEqual({ intent: { ...f.intent, state: 'closed' }, emitCookie: false });
    expect(f.repository.revoke).not.toHaveBeenCalled(); expect(f.provider.start).not.toHaveBeenCalled();
  });
  it('reads a start response lost before challengeId, with no fresh send attestation', async () => {
    const f = fixture(); f.configuration.policy = null; f.configuration.evidence = null;
    await expect(f.service.recover(f.recover)).resolves.toEqual({ operationId: f.intent.operationId,
      state: 'unresolved', challengeId: null, checkId: null, expiresAt: f.intent.expiresAt });
    expect(f.repository.reserve).not.toHaveBeenCalled(); expect(f.repository.claimCheck).not.toHaveBeenCalled();
    expect(f.provider.start).not.toHaveBeenCalled(); expect(f.provider.check).not.toHaveBeenCalled();
  });
  it('accepts a private intent proof before start rather than rejecting the new envelope shape', async () => {
    const f = fixture(); await f.service.start(f.start);
    expect(f.provider.start).toHaveBeenCalledTimes(1);
    expect(f.repository.reserve).toHaveBeenCalledWith(expect.objectContaining({ operationId: f.intent.operationId }));
  });
  it.each(['missing', 'wrong', 'other-intent'] as const)('refuses %s intent authority before spending', async kind => {
    const f = fixture(); const input: Record<string, unknown> = { ...f.start };
    if (kind === 'missing') delete input.intentProof;
    if (kind === 'wrong') input.intentProof = randomBytes(32).toString('base64url');
    if (kind === 'other-intent') input.operationId = randomUUID();
    await expect(f.service.start(input)).rejects.toBeDefined();
    expect(f.repository.reserve).not.toHaveBeenCalled(); expect(f.provider.start).not.toHaveBeenCalled();
  });
  it.each(['start', 'check'] as const)('revalidates a closure after the final async boundary before %s', async action => {
    const f = fixture(); f.beforeProvider.mockImplementation(async () => { f.repository.validateIntent.mockResolvedValue(null); });
    await expect(f.service[action](f[action])).rejects.toBeDefined();
    expect(f.provider.start).not.toHaveBeenCalled(); expect(f.provider.check).not.toHaveBeenCalled();
  });
  it('does not report a session when durable publication rejects a closure racing the provider response', async () => {
    const f = fixture(); f.repository.completeCheck.mockResolvedValue(null);
    await expect(f.service.check(f.check)).rejects.toMatchObject({ reason: 'unauthorized' });
    expect(f.provider.check).toHaveBeenCalledTimes(1);
    expect(f.repository.completeCheck).toHaveBeenCalledWith(expect.objectContaining({ operationId: f.intent.operationId,
      proofHash: f.crypto.hash('intent-proof', f.binding.tenantRef, f.intentProof) }));
  });
  it('records a keyed check body digest, never a clear OTP, and refuses a changed-body replay', async () => {
    const f = fixture();
    const expectedHash = f.crypto.hash('request', f.binding.tenantRef, JSON.stringify(['customer-check-body-v1',
      f.check.operationId, f.check.challengeId, f.check.checkId, f.check.code]));
    f.repository.recoverCheck.mockImplementation(async input => input.requestHash === expectedHash ? f.session : null);
    f.repository.claimCheck.mockResolvedValue(null);
    await expect(f.service.check(f.check)).resolves.toMatchObject({ view: { expiresAt: f.session.expiresAt } });
    await expect(f.service.check({ ...f.check, code: '654321' })).rejects.toBeDefined();
    expect(f.provider.check).not.toHaveBeenCalled();
    const calls = f.repository.recoverCheck.mock.calls;
    expect(calls[0]![0].requestHash).toBe(expectedHash); expect(calls[1]![0].requestHash).not.toBe(expectedHash);
    expect(JSON.stringify(calls)).not.toContain('123456'); expect(JSON.stringify(calls)).not.toContain('654321');
  });
  it('reads only the selected check and repeats authority before returning its approved session', async () => {
    const f = fixture(); const selection = { ...f.recover, checkId: f.check.checkId };
    const approved = { state: 'approved', operationId: f.intent.operationId, challengeId: f.check.challengeId,
      checkId: f.check.checkId, expiresAt: f.intent.expiresAt };
    f.repository.resultIntent.mockResolvedValueOnce({ ...approved, session: null }).mockResolvedValueOnce({ ...approved, session: f.session });
    const result = await f.service.recover(selection);
    expect(result.state).toBe('approved'); if (result.state !== 'approved') throw new Error('Expected approval');
    expect(result.token).toBe(f.crypto.tokenForIntentCheck(f.binding.tenantRef, f.binding.browserSecret, f.intent.operationId,
      f.intentProof, f.check.challengeId, f.check.checkId));
    expect(result.view).not.toHaveProperty('sessionId');
    expect(f.repository.resultIntent).toHaveBeenCalledTimes(2);
    const [metadata, privateRead] = f.repository.resultIntent.mock.calls.map(call => call[0]);
    expect(metadata.sessionHash).toBeNull(); expect(privateRead).toEqual({ ...metadata,
      sessionHash: f.crypto.hash('session', f.binding.tenantRef, result.token) });
    expect(f.repository.validateIntent).not.toHaveBeenCalled(); // Consumed is valid for exact receipt recovery.
    expect(f.provider.start).not.toHaveBeenCalled(); expect(f.provider.check).not.toHaveBeenCalled();
  });
  it.each(['closed', 'replaced', 'expired'] as const)('refuses an approval invalidated between metadata and private read: %s', async cause => {
    const f = fixture();
    f.repository.resultIntent.mockResolvedValueOnce({ state: 'approved', operationId: f.intent.operationId,
      challengeId: f.check.challengeId, checkId: f.check.checkId, expiresAt: f.intent.expiresAt, session: null })
      .mockResolvedValueOnce(cause === 'closed' ? { state: 'closed', operationId: f.intent.operationId,
        challengeId: f.check.challengeId, checkId: f.check.checkId, expiresAt: f.intent.expiresAt } : null);
    await expect(f.service.recover({ ...f.recover, checkId: f.check.checkId })).rejects.toBeDefined();
    expect(f.provider.check).not.toHaveBeenCalled();
  });
  it('never adopts a current check or session when the requested selector is null', async () => {
    const f = fixture();
    f.repository.resultIntent.mockResolvedValue({ state: 'approved', operationId: f.intent.operationId,
      challengeId: f.check.challengeId, checkId: f.check.checkId, expiresAt: f.intent.expiresAt, session: null });
    await expect(f.service.recover(f.recover)).rejects.toBeDefined();
    expect(f.repository.resultIntent).toHaveBeenCalledTimes(1); expect(f.provider.check).not.toHaveBeenCalled();
  });
  it.each(['unresolved', 'code_required', 'incorrect', 'closed', 'expired', 'failed'] as const)('projects %s without a token, profile or provider lookup', async state => {
    const f = fixture(); const checkId = state === 'incorrect' ? f.check.checkId : null;
    const raw = { state, operationId: f.intent.operationId, checkId, challengeId: state === 'code_required' || state === 'incorrect' ? f.check.challengeId : null,
      expiresAt: f.intent.expiresAt };
    f.repository.resultIntent.mockResolvedValue(raw);
    await expect(f.service.recover({ ...f.recover, checkId })).resolves.toEqual(raw);
    expect(f.repository.resultIntent).toHaveBeenCalledTimes(1); expect(f.provider.check).not.toHaveBeenCalled();
  });
});
