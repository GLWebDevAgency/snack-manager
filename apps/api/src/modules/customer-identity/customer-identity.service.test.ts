import { confirmedCustomerBrowserFixture } from './customer-browser.test-fixture';
import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CustomerIdentityCrypto, type CustomerIdentityRepository, type CustomerSession } from '@sm/customer';
import { CustomerIdentityService } from './customer-identity.service';
import type { PhoneVerificationTransport } from './phone-verification.port';

const NOW = Date.parse('2026-09-08T10:00:00Z');
const PARENT = `AC${'a'.repeat(32)}`;
const SERVICE = `VA${'b'.repeat(32)}`;
const SID = `VE${'c'.repeat(32)}`;
const PHONE = '+33612345678';
const TENANT = 'tenant-classfood-test';
const BROWSER_REF = randomUUID();
const BROWSER = Buffer.alloc(32, 33).toString('base64url');
const crypto = new CustomerIdentityCrypto(Buffer.alloc(32, 19).toString('base64'));
const phoneHash = crypto.hash('phone', TENANT, PHONE);
const pending = {
  challengeId: randomUUID(), phoneHash, expiresAt: NOW + 600_000,
  serviceSid: SERVICE, verificationSid: SID,
  funding: { mode: 'trial' as const },
  encryptedPhone: crypto.seal('phone', TENANT, phoneHash, PHONE),
};
const privateSession: CustomerSession = {
  sessionId: randomUUID(), expiresAt: NOW + 7 * 86_400_000,
  profile: { accountId: randomUUID(), phoneHash, encryptedName: null,
    encryptedPhone: pending.encryptedPhone, phoneVerifiedAt: NOW, revision: 0 },
};
function configuration() {
  return {
    environment: 'staging', parentRef: PARENT, mode: 'closed_trial' as const,
    policy: { mode: 'closed_trial', environment: 'staging', accountSid: PARENT,
      serviceSid: SERVICE, tenantRef: TENANT, allowedPhones: [PHONE],
      maxSendReservations: 10, expiresAt: NOW + 86_400_000 },
    evidence: { reference: 'operator-evidence-test', accountSid: PARENT,
      accountType: 'Trial', accountStatus: 'active', serviceSid: SERVICE,
      smsEnabled: true, fraudGuardEnabled: true, codeLength: 6,
      maxTokenValiditySeconds: 600,
      verifiedPhones: [PHONE], freeSmsUnitsRemaining: 10,
      maxSmsSegmentsPerSend: 1, freeVerificationUnitsRemaining: 10,
      observedAt: NOW, trialExpiresAt: NOW + 86_400_000 },
  };
}
function fixture() {
  const repository = {
    ...confirmedCustomerBrowserFixture(BROWSER_REF, NOW + 7 * 86_400_000),
    reserve: vi.fn<CustomerIdentityRepository['reserve']>().mockResolvedValue({ kind: 'reserved', challengeId: pending.challengeId }),
    settleSend: vi.fn<CustomerIdentityRepository['settleSend']>().mockResolvedValue(pending),
    claimCheck: vi.fn<CustomerIdentityRepository['claimCheck']>().mockResolvedValue(pending),
    recoverCheck: vi.fn<CustomerIdentityRepository['recoverCheck']>().mockResolvedValue(null),
    completeCheck: vi.fn<CustomerIdentityRepository['completeCheck']>().mockResolvedValue(privateSession),
    authenticate: vi.fn<CustomerIdentityRepository['authenticate']>().mockResolvedValue(privateSession),
    updateName: vi.fn<CustomerIdentityRepository['updateName']>().mockResolvedValue(privateSession),
    revoke: vi.fn<CustomerIdentityRepository['revoke']>().mockResolvedValue(undefined),
  } satisfies CustomerIdentityRepository;
  const transport: PhoneVerificationTransport = {
    start: vi.fn().mockResolvedValue({ verificationSid: SID }),
    check: vi.fn().mockResolvedValue('approved'),
  };
  const config = configuration();
  const service = new CustomerIdentityService(repository, crypto, transport, () => config, () => NOW);
  const start = { tenantRef: TENANT, browserRef: BROWSER_REF, phone: PHONE, operationId: randomUUID(),
    browserSecret: BROWSER, clientIp: '127.0.0.1', humanVerified: true as const };
  const check = { tenantRef: TENANT, browserRef: BROWSER_REF, challengeId: pending.challengeId,
    checkId: randomUUID(), code: '123456', browserSecret: BROWSER,
    existingSessionToken: null };
  return { repository, transport, config, service, start, check };
}

describe('private customer identity orchestration', () => {
  beforeEach(() => vi.clearAllMocks());
  it.each(['session', 'updateName', 'logout'] as const)('requires a canonical browser secret before %s reaches storage', async action => {
    const f = fixture();
    const input = { tenantRef: TENANT, browserRef: BROWSER_REF, token: BROWSER,
      ...(action === 'updateName' ? { name: 'Mina', expectedRevision: 0 } : action === 'logout' ? { all: false } : {}) };
    for (const patch of [{}, { browserSecret: null }, { browserSecret: 'loyalty-qr' }, { browserSecret: `${'A'.repeat(42)}B` }]) {
      await expect(f.service[action]({ ...input, ...patch })).rejects.toMatchObject({ reason: 'invalid_request' });
    }
    expect(f.repository.authenticate).not.toHaveBeenCalled();
    expect(f.repository.updateName).not.toHaveBeenCalled(); expect(f.repository.revoke).not.toHaveBeenCalled();
    expect(f.transport.start).not.toHaveBeenCalled(); expect(f.transport.check).not.toHaveBeenCalled();
  });
  it.each(['session', 'updateName'] as const)('does not authorize %s with another browser even when the session token matches', async action => {
    const f = fixture(); const expectedHash = crypto.hash('browser', TENANT, BROWSER);
    f.repository.authenticate.mockImplementation(async input => Reflect.get(input, 'browserHash') === expectedHash ? privateSession : null);
    await expect(f.service[action]({ tenantRef: TENANT, browserRef: BROWSER_REF, token: BROWSER,
      browserSecret: Buffer.alloc(32, 34).toString('base64url'),
      ...(action === 'updateName' ? { name: 'Mina', expectedRevision: 0 } : {}) })).rejects.toMatchObject({ reason: 'unauthorized' });
    expect(f.repository.authenticate).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      sessionHash: crypto.hash('session', TENANT, BROWSER),
      browserHash: crypto.hash('browser', TENANT, Buffer.alloc(32, 34).toString('base64url')),
    }));
    expect(f.repository.updateName).not.toHaveBeenCalled();
  });
  it('binds logout to the browser without authorizing a token-only or foreign-browser revocation', async () => {
    const f = fixture(); let revoked = false;
    const browserHash = crypto.hash('browser', TENANT, BROWSER);
    f.repository.revoke.mockImplementation(async input => { if (Reflect.get(input, 'browserHash') === browserHash) revoked = true; });
    await f.service.logout({ tenantRef: TENANT, browserRef: BROWSER_REF, token: BROWSER, browserSecret: Buffer.alloc(32, 34).toString('base64url'), all: true });
    expect(revoked).toBe(false);
    await f.service.logout({ tenantRef: TENANT, browserRef: BROWSER_REF, token: BROWSER, browserSecret: BROWSER, all: true });
    expect(revoked).toBe(true);
    expect(f.repository.revoke).toHaveBeenLastCalledWith({ tenantRef: TENANT, parentRef: PARENT, browserRef: BROWSER_REF,
      sessionHash: crypto.hash('session', TENANT, BROWSER), browserHash, all: true, now: NOW });
    expect(JSON.stringify(f.repository.revoke.mock.calls)).not.toContain(BROWSER);
  });
  it('recovers only the exact committed receipt, without claiming or checking any OTP', async () => {
    const f = fixture(); f.repository.recoverCheck.mockResolvedValue(privateSession);
    f.config.evidence.observedAt = NOW - 86_400_000;
    const { tenantRef, browserRef, challengeId, checkId, browserSecret } = f.check;
    const result = await f.service.recover({ tenantRef, browserRef, challengeId, checkId, browserSecret });
    expect(result.view.expiresAt).toBe(privateSession.expiresAt);
    expect(result.token === crypto.tokenForCheck(TENANT, BROWSER, challengeId, checkId)).toBe(true);
    expect(f.repository.recoverCheck).toHaveBeenCalledTimes(1);
    for (const method of ['claimCheck', 'completeCheck', 'reserve', 'settleSend', 'authenticate', 'updateName', 'revoke'] as const) {
      expect(f.repository[method]).not.toHaveBeenCalled();
    }
    expect(f.transport.start).not.toHaveBeenCalled(); expect(f.transport.check).not.toHaveBeenCalled();
  });
  it('recovery without a receipt never starts a check or accepts a code field', async () => {
    const f = fixture(); const { tenantRef, browserRef, challengeId, checkId, browserSecret } = f.check;
    await expect(f.service.recover({ tenantRef, browserRef, challengeId, checkId, browserSecret })).rejects.toMatchObject({ reason: 'unauthorized' });
    await expect(f.service.recover({ tenantRef, browserRef, challengeId, checkId, browserSecret, code: '123456' })).rejects.toMatchObject({ reason: 'invalid_request' });
    expect(f.repository.recoverCheck).toHaveBeenCalledTimes(1);
    expect(f.repository.claimCheck).not.toHaveBeenCalled(); expect(f.transport.check).not.toHaveBeenCalled();
  });
  it('persists the complete bounded reservation BEFORE the only provider send', async () => {
    const f = fixture();
    await expect(f.service.start(f.start)).resolves.toEqual({
      challengeId: pending.challengeId, expiresAt: pending.expiresAt,
    });
    expect(f.repository.reserve.mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(f.transport.start).mock.invocationCallOrder[0]!);
    expect(f.repository.settleSend.mock.invocationCallOrder[0]).toBeGreaterThan(vi.mocked(f.transport.start).mock.invocationCallOrder[0]!);
    const stored = f.repository.reserve.mock.calls[0]![0];
    expect(stored.parentRef).toBe(PARENT);
    expect(stored.tenantRef).toBe(TENANT);
    expect(stored.phoneHash).toBe(phoneHash);
    expect(stored.limits).not.toHaveProperty('challengeTtlMs');
    expect(stored.browserHash).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(stored)).not.toContain(PHONE);
    expect(JSON.stringify(stored)).not.toContain(BROWSER);
    expect(f.transport.start).toHaveBeenCalledExactlyOnceWith({ phone: PHONE, serviceSid: SERVICE });
  });
  it.each(['denied', 'uncertain'] as const)('does not send when durable reservation is %s', async kind => {
    const f = fixture(); f.repository.reserve.mockResolvedValue({ kind });
    await expect(f.service.start(f.start)).rejects.toMatchObject({ reason: 'unavailable' });
    expect(f.transport.start).not.toHaveBeenCalled();
  });
  it('does not call provider when durable storage fails', async () => {
    const f = fixture(); f.repository.reserve.mockRejectedValue(new Error('private SQL data'));
    await expect(f.service.start(f.start)).rejects.toMatchObject({ message: 'Service de compte momentanément indisponible.' });
    expect(f.transport.start).not.toHaveBeenCalled();
  });
  it('replays a pending reservation without a second SMS', async () => {
    const f = fixture(); f.repository.reserve.mockResolvedValue({ kind: 'pending', challenge: pending });
    await expect(f.service.start(f.start)).resolves.toEqual({ challengeId: pending.challengeId, expiresAt: pending.expiresAt });
    expect(f.transport.start).not.toHaveBeenCalled();
  });
  it.each(['check', 'start'] as const)('does not reclassify paid funding as trial during %s', async action => {
    const f = fixture(); const foreign = { ...pending, funding: { mode: 'paid' as const,
      authorizationRef: 'old-paid', currency: 'USD' as const, reservedMicrousd: 70, expiresAt: NOW + 600_000 } };
    f.repository.claimCheck.mockResolvedValue(foreign);
    f.repository.reserve.mockResolvedValue({ kind: 'pending', challenge: foreign });
    const refused = await (action === 'start' ? f.service.start(f.start) : f.service.check(f.check))
      .then(() => false, (error: { reason?: string }) => error.reason === 'unavailable');
    expect(refused).toBe(true);
    expect(f.transport.start).not.toHaveBeenCalled(); expect(f.transport.check).not.toHaveBeenCalled();
  });
  it.each(['production', 'local', ''])('never spends from runtime %s', async environment => {
    const f = fixture(); f.config.environment = environment;
    await expect(f.service.start(f.start)).rejects.toMatchObject({ reason: 'unavailable' });
    expect(f.repository.reserve).not.toHaveBeenCalled(); expect(f.transport.start).not.toHaveBeenCalled();
  });
  it.each(['accountType', 'freeVerificationUnitsRemaining', 'fraudGuardEnabled'])('fails closed on invalid evidence %s', async field => {
    const f = fixture(); (f.config.evidence as Record<string, unknown>)[field] = null;
    await expect(f.service.start(f.start)).rejects.toMatchObject({ reason: 'unavailable' });
    expect(f.repository.reserve).not.toHaveBeenCalled();
  });
  it('requires human attestation, strict input and approved tenant/phone', async () => {
    for (const patch of [{ humanVerified: false }, { customerRef: 'victim' }, { phone: '+33699999999' }, { tenantRef: 'other' }]) {
      const f = fixture();
      await expect(f.service.start({ ...f.start, ...patch })).rejects.toBeDefined();
      expect(f.transport.start).not.toHaveBeenCalled();
    }
  });
  it('retains a spent attempt and exposes no provider details on send uncertainty', async () => {
    const f = fixture(); vi.mocked(f.transport.start).mockRejectedValue(new Error(`private ${PHONE}`));
    await expect(f.service.start(f.start)).rejects.toMatchObject({ reason: 'unavailable' });
    expect(f.repository.settleSend).toHaveBeenCalledWith(expect.objectContaining({ verificationSid: null }));
    expect(f.transport.start).toHaveBeenCalledTimes(1);
  });
  it('never fabricates pending when provider SID persistence fails', async () => {
    const f = fixture(); f.repository.settleSend.mockRejectedValue(new Error('commit uncertain'));
    await expect(f.service.start(f.start)).rejects.toMatchObject({ reason: 'unavailable' });
    expect(f.transport.start).toHaveBeenCalledTimes(1);
  });
  it('claims a check before calling Verify and issues only the committed session', async () => {
    const f = fixture();
    const result = await f.service.check(f.check);
    expect(result.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(result.view.profile).toEqual({ name: null, phoneE164: PHONE, phoneVerifiedAt: NOW, revision: 0 });
    expect(result.view).not.toHaveProperty('accountId');
    expect(JSON.stringify(result.view)).not.toContain(phoneHash);
    expect(f.repository.claimCheck.mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(f.transport.check).mock.invocationCallOrder[0]!);
    expect(f.transport.check).toHaveBeenCalledExactlyOnceWith({ phone: PHONE, serviceSid: SERVICE, verificationSid: SID, code: '123456' });
    expect(f.repository.completeCheck).toHaveBeenCalledWith(expect.objectContaining({
      result: 'approved', sessionHash: crypto.hash('session', TENANT, result.token), existingSessionHash: null,
    }));
    expect(JSON.stringify(f.repository.completeCheck.mock.calls)).not.toContain('123456');
  });
  it('replays a committed check with the exact token and no second provider request', async () => {
    const f = fixture(); f.repository.recoverCheck.mockResolvedValue(privateSession);
    const a = await f.service.check(f.check); const b = await f.service.check(f.check);
    expect(a).toEqual(b); expect(f.transport.check).not.toHaveBeenCalled(); expect(f.repository.claimCheck).not.toHaveBeenCalled();
  });
  it.each(['pending', 'expired', 'locked'] as const)('does not create access from %s', async result => {
    const f = fixture(); vi.mocked(f.transport.check).mockResolvedValue(result);
    f.repository.completeCheck.mockResolvedValue(null);
    await expect(f.service.check(f.check)).rejects.toMatchObject({ reason: 'unauthorized' });
    expect(f.repository.completeCheck).toHaveBeenCalledWith(expect.objectContaining({ result }));
  });
  it('does not infer success from a timeout after an actual possible approval', async () => {
    const f = fixture(); vi.mocked(f.transport.check).mockRejectedValue(new Error('approved response lost'));
    f.repository.completeCheck.mockResolvedValue(null);
    await expect(f.service.check(f.check)).rejects.toMatchObject({ reason: 'unavailable' });
    expect(f.repository.completeCheck).toHaveBeenCalledWith(expect.objectContaining({ result: 'uncertain' }));
    expect(f.transport.check).toHaveBeenCalledTimes(1);
  });
  it('rejects a concurrent/replayed check without a fresh provider call', async () => {
    const f = fixture(); f.repository.claimCheck.mockResolvedValue(null);
    await expect(f.service.check(f.check)).rejects.toMatchObject({ reason: 'unauthorized' });
    expect(f.transport.check).not.toHaveBeenCalled();
  });
  it('requires atomic completion even after an approved provider result', async () => {
    const f = fixture(); f.repository.completeCheck.mockResolvedValue(null);
    await expect(f.service.check(f.check)).rejects.toMatchObject({ reason: 'unauthorized' });
  });
  it('passes a continuity proof separately from the phone', async () => {
    const f = fixture(); const existing = Buffer.alloc(32, 8).toString('base64url');
    await f.service.check({ ...f.check, existingSessionToken: existing });
    expect(f.repository.completeCheck).toHaveBeenCalledWith(expect.objectContaining({ existingSessionHash: crypto.hash('session', TENANT, existing) }));
  });
  it('returns only a protected minimal profile, never a QR identity', async () => {
    const f = fixture(); const token = Buffer.alloc(32, 5).toString('base64url');
    const view = await f.service.session({ tenantRef: TENANT, browserRef: BROWSER_REF, token, browserSecret: BROWSER });
    expect(view.profile.phoneE164).toBe(PHONE);
    expect(f.repository.authenticate).toHaveBeenCalledWith({ tenantRef: TENANT, parentRef: PARENT, browserRef: BROWSER_REF,
      sessionHash: crypto.hash('session', TENANT, token), browserHash: crypto.hash('browser', TENANT, BROWSER), now: NOW });
    await expect(f.service.session({ tenantRef: TENANT, browserRef: BROWSER_REF, token: 'loyalty-qr', browserSecret: BROWSER })).rejects.toMatchObject({ reason: 'invalid_request' });
  });
  it('does not treat a storage failure as a confirmed logout', async () => {
    const f = fixture(); f.repository.revoke.mockRejectedValue(new Error('offline'));
    await expect(f.service.logout({ tenantRef: TENANT, browserRef: BROWSER_REF, token: BROWSER, browserSecret: BROWSER, all: false })).rejects.toMatchObject({ reason: 'unavailable' });
  });
  it('encrypts explicit name changes and sends the expected revision', async () => {
    const f = fixture();
    await f.service.updateName({ tenantRef: TENANT, browserRef: BROWSER_REF, token: BROWSER, browserSecret: BROWSER, name: '  Mina  ', expectedRevision: 0 });
    const stored = f.repository.updateName.mock.calls[0]![0];
    expect(stored.expectedRevision).toBe(0);
    expect(Reflect.get(stored, 'browserHash')).toBe(crypto.hash('browser', TENANT, BROWSER));
    expect(f.repository.authenticate.mock.invocationCallOrder[0]).toBeLessThan(f.repository.updateName.mock.invocationCallOrder[0]!);
    expect(stored.encryptedName).not.toContain('Mina');
    expect(crypto.open('name', TENANT, privateSession.profile.accountId, stored.encryptedName!)).toBe('Mina');
  });
  it('never writes a profile from an invalid session', async () => {
    const f = fixture(); f.repository.authenticate.mockResolvedValue(null);
    await expect(f.service.updateName({ tenantRef: TENANT, browserRef: BROWSER_REF, token: BROWSER, browserSecret: BROWSER, name: 'Mina', expectedRevision: 0 })).rejects.toMatchObject({ reason: 'unauthorized' });
    expect(f.repository.updateName).not.toHaveBeenCalled();
  });
});
