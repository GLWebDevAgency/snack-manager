import { confirmedCustomerBrowserFixture, confirmedCustomerIntentFixture } from './customer-browser.test-fixture';
import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { CustomerIdentityCrypto, type CustomerIdentityRepository, type CustomerSession } from '@sm/customer';
import { CustomerIdentityService } from './customer-identity.service';
import type { PhoneVerificationTransport } from './phone-verification.port';

// Deliberate port-level counterexamples. This suite does not claim to prove
// PostgreSQL locking/commit semantics, and never contacts a verification provider.
function fixture() {
  const initial = Date.parse('2026-09-08T10:00:00Z');
  let now = initial;
  const tenant = 'tenant-orchestration-review';
  const parent = `AC${'d'.repeat(32)}`;
  const serviceSid = `VA${'e'.repeat(32)}`;
  const phone = '+33600000001';
  const browserRef = randomUUID(), operationId = randomUUID();
  const intentProof = Buffer.alloc(32, 38).toString('base64url');
  const browser = Buffer.alloc(32, 37).toString('base64url');
  const crypto = new CustomerIdentityCrypto(Buffer.alloc(32, 73).toString('base64'));
  const phoneHash = crypto.hash('phone', tenant, phone);
  const pending = { challengeId: randomUUID(), phoneHash, expiresAt: initial + 600_000,
    funding: { mode: 'trial' as const },
    serviceSid, verificationSid: `VE${'f'.repeat(32)}`,
    encryptedPhone: crypto.seal('phone', tenant, phoneHash, phone) };
  const session: CustomerSession = { sessionId: randomUUID(), expiresAt: initial + 86_400_000,
    profile: { accountId: randomUUID(), phoneHash, encryptedName: null,
      encryptedPhone: pending.encryptedPhone, phoneVerifiedAt: initial, revision: 0 } };
  const config = {
    environment: 'staging', parentRef: parent, mode: 'closed_trial' as const,
    policy: { mode: 'closed_trial', environment: 'staging', accountSid: parent,
      serviceSid, tenantRef: tenant, allowedPhones: [phone], maxSendReservations: 10,
      expiresAt: initial + 86_400_000 },
    evidence: { reference: 'orchestration-review', accountSid: parent, accountType: 'Trial',
      accountStatus: 'active', serviceSid, smsEnabled: true, fraudGuardEnabled: true,
      codeLength: 6, verifiedPhones: [phone], freeSmsUnitsRemaining: 10,
      maxTokenValiditySeconds: 600,
      maxSmsSegmentsPerSend: 1, freeVerificationUnitsRemaining: 10,
      observedAt: initial, trialExpiresAt: initial + 86_400_000 },
  };
  const repository = {
    ...confirmedCustomerBrowserFixture(browserRef, initial + 7 * 86_400_000),
    ...confirmedCustomerIntentFixture(operationId, initial + 600_000),
    reserve: vi.fn<CustomerIdentityRepository['reserve']>().mockResolvedValue({ kind: 'reserved', challengeId: pending.challengeId }),
    settleSend: vi.fn<CustomerIdentityRepository['settleSend']>().mockResolvedValue(pending),
    recoverCheck: vi.fn<CustomerIdentityRepository['recoverCheck']>().mockResolvedValue(null),
    claimCheck: vi.fn<CustomerIdentityRepository['claimCheck']>().mockResolvedValue(pending),
    completeCheck: vi.fn<CustomerIdentityRepository['completeCheck']>().mockResolvedValue(session),
    authenticate: vi.fn<CustomerIdentityRepository['authenticate']>().mockResolvedValue(session),
    updateName: vi.fn<CustomerIdentityRepository['updateName']>().mockResolvedValue(session),
    revoke: vi.fn<CustomerIdentityRepository['revoke']>().mockResolvedValue(undefined),
  } satisfies CustomerIdentityRepository;
  const transport = {
    start: vi.fn<PhoneVerificationTransport['start']>().mockResolvedValue({ verificationSid: pending.verificationSid }),
    check: vi.fn<PhoneVerificationTransport['check']>().mockResolvedValue('approved'),
  } satisfies PhoneVerificationTransport;
  const service = new CustomerIdentityService(repository, crypto, transport, () => config, () => now);
  const start = { tenantRef: tenant, browserRef, phone, operationId, intentProof, browserSecret: browser,
    clientIp: '127.0.0.1', humanVerified: true };
  const check = { tenantRef: tenant, browserRef, operationId, intentProof, challengeId: pending.challengeId, checkId: randomUUID(),
    browserSecret: browser, code: '123456', existingSessionToken: null };
  return { service, repository, transport, config, crypto, start, check, pending, session,
    advance: (ms: number) => { now += ms; } };
}

describe('independent customer orchestration race and recovery checks', () => {
  it('does not check a challenge that expired while its durable claim response was in flight', async () => {
    const f = fixture();
    f.repository.claimCheck.mockImplementation(async () => {
      await Promise.resolve();
      f.advance(600_001); // Evidence is still fresh for another five minutes.
      return f.pending;
    });
    f.repository.completeCheck.mockResolvedValue(null);
    await expect(f.service.check(f.check)).rejects.toBeDefined();
    expect(f.transport.check).not.toHaveBeenCalled();
    expect(f.repository.completeCheck).not.toHaveBeenCalledWith(expect.objectContaining({ result: 'approved' }));
  });

  it.each(['disabled', 'expired', 'new-segmentation'] as const)(
    'revalidates %s configuration after the reservation wait, without another reservation', async change => {
      const f = fixture();
      f.repository.reserve.mockImplementation(async () => {
        await Promise.resolve();
        if (change === 'disabled') f.config.environment = 'production';
        if (change === 'expired') f.advance(900_001);
        if (change === 'new-segmentation') f.config.evidence.maxSmsSegmentsPerSend = 2;
        return { kind: 'reserved', challengeId: f.pending.challengeId };
      });
      await expect(f.service.start(f.start)).rejects.toMatchObject({ reason: 'unavailable' });
      expect(f.repository.reserve).toHaveBeenCalledTimes(1);
      expect(f.transport.start).not.toHaveBeenCalled();
    },
  );

  it('does not release a fresh challenge from a pending receipt belonging to another requested phone', async () => {
    const f = fixture();
    const otherPhone = '+33700000002';
    const otherHash = f.crypto.hash('phone', f.start.tenantRef, otherPhone);
    f.repository.reserve.mockResolvedValue({ kind: 'pending', challenge: { ...f.pending,
      phoneHash: otherHash, encryptedPhone: f.crypto.seal('phone', f.start.tenantRef, otherHash, otherPhone) } });
    await expect(f.service.start(f.start)).rejects.toMatchObject({ reason: 'unavailable' });
    expect(f.transport.start).not.toHaveBeenCalled();
  });

  it('does not check a different challenge returned by an inconsistent private port', async () => {
    const f = fixture();
    f.repository.claimCheck.mockResolvedValue({ ...f.pending, challengeId: randomUUID() });
    f.repository.completeCheck.mockResolvedValue(null);
    await expect(f.service.check(f.check)).rejects.toBeDefined();
    expect(f.transport.check).not.toHaveBeenCalled();
  });

  it('recovers a committed completion whose response was lost, with the same token and no second check', async () => {
    const f = fixture();
    let committed = false;
    f.repository.completeCheck.mockImplementation(async () => {
      committed = true;
      throw new Error('simulated completion commit response loss');
    });
    f.repository.recoverCheck.mockImplementation(async () => committed ? f.session : null);
    await expect(f.service.check(f.check)).rejects.toMatchObject({ reason: 'unavailable' });
    const expectedToken = f.crypto.tokenForIntentCheck(f.start.tenantRef, f.check.browserSecret, f.check.operationId, f.check.intentProof,
      f.check.challengeId, f.check.checkId);
    const retried = await f.service.check(f.check);
    expect(retried).toMatchObject({ token: expectedToken, view: { sessionId: f.session.sessionId,
      expiresAt: f.session.expiresAt } });
    expect(f.repository.recoverCheck).toHaveBeenLastCalledWith(expect.objectContaining({
      challengeId: f.check.challengeId, checkId: f.check.checkId,
      sessionHash: f.crypto.hash('session', f.start.tenantRef, expectedToken),
    }));
    expect(f.repository.claimCheck).toHaveBeenCalledTimes(1);
    expect(f.repository.completeCheck).toHaveBeenCalledTimes(1);
    expect(f.transport.check).toHaveBeenCalledTimes(1);
  });

  it('does not retry a remote check when completion did not commit and the old claim remains unresolved', async () => {
    const f = fixture();
    f.repository.completeCheck.mockRejectedValue(new Error('simulated failure before completion commit'));
    f.repository.claimCheck.mockResolvedValueOnce(f.pending).mockResolvedValue(null);
    await expect(f.service.check(f.check)).rejects.toMatchObject({ reason: 'unavailable' });
    await expect(f.service.check(f.check)).rejects.toMatchObject({ reason: 'unauthorized' });
    expect(f.transport.check).toHaveBeenCalledTimes(1);
    expect(f.repository.completeCheck).toHaveBeenCalledTimes(1);
  });

  it('does not expose an expired recovered session or send another provider request', async () => {
    const f = fixture();
    f.repository.recoverCheck.mockImplementation(async () => {
      f.advance(86_400_001);
      return f.session;
    });
    await expect(f.service.check(f.check)).rejects.toMatchObject({ reason: 'unauthorized' });
    expect(f.repository.claimCheck).not.toHaveBeenCalled();
    expect(f.transport.check).not.toHaveBeenCalled();
  });
});
