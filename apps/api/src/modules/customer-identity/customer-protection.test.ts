import { randomBytes, randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { CustomerIdentityCrypto, recoveryCodeHash } from '@sm/customer';
import { protectCustomerEnrollment } from './customer-protection';
import { confirmedCustomerBrowserFixture } from './customer-browser.test-fixture';

function fixture() {
  const now = Date.now(), operationId = randomUUID(), checkId = randomUUID();
  const opaque = () => randomBytes(32).toString('base64url');
  const binding = { parentRef: 'fixture-parent', tenantRef: 'fixture-restaurant', browserRef: randomUUID(),
    browserHash: opaque(), operationId, checkId, proofHash: opaque() };
  const enrollment = { operationId, checkId, expiresAt: now + 600_000,
    stage: 'recovery_required' as const, recoveryVersion: 1 };
  const repository = confirmedCustomerBrowserFixture(binding.browserRef, now + 604_800_000);
  repository.readEnrollment.mockResolvedValue(enrollment);
  const credential = { credentialId: opaque(), publicKey: new Uint8Array([1, 2, 3]),
    counter: 0, deviceType: 'multiDevice' as const, backedUp: true, transports: [] };
  const port = { repository, binding, crypto: new CustomerIdentityCrypto(randomBytes(32).toString('base64')),
    browserSecret: opaque(), intentProof: opaque(), origin: 'https://fixture.example', now: () => now,
    browser: vi.fn().mockResolvedValue({ expiresAt: now + 604_800_000 }),
    intent: vi.fn().mockResolvedValue({ expiresAt: enrollment.expiresAt }),
    view: vi.fn().mockResolvedValue({ expiresAt: now + 604_800_000,
      profile: { name: null, phoneE164: '+33612345678', phoneVerifiedAt: now, revision: 0 } }),
    verifier: { registrationOptions: vi.fn(), authenticationOptions: vi.fn(),
      verifyRegistration: vi.fn().mockResolvedValue(credential),
      verifyAuthentication: vi.fn().mockResolvedValue({ credentialId: credential.credentialId,
        counter: 1, deviceType: credential.deviceType, backedUp: true }) },
  } satisfies Parameters<typeof protectCustomerEnrollment>[0];
  return { port, repository, enrollment, credential, ids: { operationId, checkId } };
}
describe('protected enrollment use case authority', () => {
  it.each(['http://fixture.example', 'https://fixture.example/path', 'https://user@fixture.example'])('rejects non-exact secure origin %s before repository work', async origin => {
    const f = fixture(); f.port.origin = origin;
    await expect(protectCustomerEnrollment(f.port, { ...f.ids, step: 'state' })).rejects.toThrow();
    expect(f.repository.readEnrollment).not.toHaveBeenCalled();
  });
  it.each(['register', 'assert'] as const)('reads the immutable %s challenge instead of creating another preparation on retry', async step => {
    const f = fixture(), id = randomUUID();
    const prepared = { origin: f.port.origin, rpId: 'fixture.example', challenge: randomBytes(32).toString('base64url'),
      userHandle: randomBytes(32).toString('base64url'), expiresAt: f.enrollment.expiresAt };
    f.repository.readEnrollmentKey.mockResolvedValue({ ...prepared, registrationId: id });
    f.repository.readEnrollmentAssertion.mockResolvedValue({ ...prepared, assertionId: id, credential: f.credential });
    f.repository.recordEnrollmentKey.mockResolvedValue(f.enrollment);
    f.repository.recordEnrollmentAssertion.mockResolvedValue(f.enrollment);
    // Cryptographic validation belongs to the injected verifier, independently
    // exercised with native credentials by the PG and signed HTTP suites.
    const response = { id: f.credential.credentialId, rawId: f.credential.credentialId, type: 'public-key' as const,
      response: { clientDataJSON: 'AA', attestationObject: 'AA', authenticatorData: 'AA', signature: 'AA' },
      clientExtensionResults: {} };
    await expect(protectCustomerEnrollment(f.port, step === 'register'
      ? { ...f.ids, step, registrationId: id, response }
      : { ...f.ids, step, assertionId: id, response })).resolves.toEqual({ state: 'enrollment', enrollment: f.enrollment });
    expect(f.repository.prepareEnrollmentKey).not.toHaveBeenCalled();
    expect(f.repository.prepareEnrollmentAssertion).not.toHaveBeenCalled();
    expect(f.port.view).not.toHaveBeenCalled(); expect(f.repository.activateEnrollment).not.toHaveBeenCalled();
  });
  it('never emits a code on replay and only stores its dedicated tenant-bound hash', async () => {
    const f = fixture(), rotationId = randomUUID();
    f.repository.issueEnrollmentRecovery.mockResolvedValueOnce({ enrollment: f.enrollment, emitCode: true })
      .mockResolvedValueOnce({ enrollment: f.enrollment, emitCode: false });
    const command = { ...f.ids, step: 'recovery-code' as const, rotationId, expectedVersion: 0 };
    const first = await protectCustomerEnrollment(f.port, command);
    expect(first.state).toBe('recovery-code');
    if (first.state !== 'recovery-code' || !first.code) throw new Error('Expected first code');
    expect(f.repository.issueEnrollmentRecovery.mock.calls[0]?.[0]).toEqual({ ...f.port.binding, rotationId,
      expectedVersion: 0, codeHash: recoveryCodeHash(f.port.crypto, f.port.binding, first.code) });
    expect(JSON.stringify(f.repository.issueEnrollmentRecovery.mock.calls)).not.toContain(first.code);
    await expect(protectCustomerEnrollment(f.port, command)).resolves.toEqual({ state: 'recovery-code', enrollment: f.enrollment, code: null });
  });
  it('does not publish a code when its durable write failed', async () => {
    const f = fixture();
    await expect(protectCustomerEnrollment(f.port, { ...f.ids, step: 'recovery-code', rotationId: randomUUID(), expectedVersion: 0 })).rejects.toThrow();
    expect(f.port.view).not.toHaveBeenCalled();
  });
  it('does not return a provisional state that expires across its final intent wait', async () => {
    const f = fixture(); let reads = 0;
    f.port.intent.mockImplementation(async () => { if (++reads === 2) f.port.now = () => f.enrollment.expiresAt;
      return { expiresAt: f.enrollment.expiresAt }; });
    await expect(protectCustomerEnrollment(f.port, { ...f.ids, step: 'state' })).rejects.toThrow();
  });
  it('does not reinterpret a missing activation receipt as permission to create a session', async () => {
    const f = fixture();
    await expect(protectCustomerEnrollment(f.port, { ...f.ids, step: 'activation-result', activationId: randomUUID() })).rejects.toThrow();
    expect(f.repository.activateEnrollment).not.toHaveBeenCalled(); expect(f.port.intent).not.toHaveBeenCalled();
    expect(f.port.view).not.toHaveBeenCalled();
  });
});
