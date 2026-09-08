import { randomBytes, randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { CustomerIdentityCrypto, recoveryCodeHash } from '@sm/customer';
import { confirmedCustomerBrowserFixture } from './customer-browser.test-fixture';
import { loginCustomerPasskey } from './customer-passkey-login';
import { recoverCustomerAccount } from './customer-account-recovery';
import { customerCredentialContext } from './customer-credential-access.port';
import { PasskeyVerificationError } from './passkey-verifier.port';

function fixture() {
  const now = Date.now(), operationId = randomUUID(), attemptId = randomUUID();
  const opaque = () => randomBytes(32).toString('base64url');
  const binding = { parentRef: 'fixture-parent', tenantRef: 'fixture-restaurant', browserRef: randomUUID(),
    browserHash: randomBytes(32).toString('hex'), operationId, attemptId, proofHash: randomBytes(32).toString('hex') };
  const ids = { operationId, attemptId }, expiresAt = now + 600_000;
  const recovery = { ...ids, expiresAt, stage: 'recovery_required' as const, recoveryVersion: 1 };
  const repository = confirmedCustomerBrowserFixture(binding.browserRef, now + 604_800_000);
  repository.readAccountRecovery.mockResolvedValue({ ...ids, expiresAt, state: 'granted', grant: recovery });
  const credential = { credentialId: opaque(), publicKey: new Uint8Array([1, 2, 3]),
    counter: 0, deviceType: 'multiDevice' as const, backedUp: true, transports: [] };
  const port = { repository, binding, crypto: new CustomerIdentityCrypto(randomBytes(32).toString('base64')),
    browserSecret: opaque(), intentProof: opaque(), source: 'relay:fixture-source', origin: 'https://fixture.example', now: () => now,
    browser: vi.fn().mockResolvedValue({ expiresAt: now + 604_800_000 }), intent: vi.fn().mockResolvedValue({ expiresAt }),
    view: vi.fn().mockResolvedValue({ expiresAt: now + 604_800_000,
      profile: { name: null, phoneE164: '+33612345678', phoneVerifiedAt: now, revision: 0 } }),
    verifier: { registrationOptions: vi.fn(), authenticationOptions: vi.fn(), verifyRegistration: vi.fn().mockResolvedValue(credential),
      verifyAuthentication: vi.fn().mockResolvedValue({ credentialId: credential.credentialId, counter: 1, deviceType: credential.deviceType, backedUp: true }) },
  } satisfies Parameters<typeof loginCustomerPasskey>[0];
  const prepared = { ...ids, expiresAt, origin: port.origin, rpId: 'fixture.example', challenge: opaque(), userHandle: opaque(), credential };
  const response = { id: credential.credentialId, rawId: credential.credentialId, type: 'public-key' as const,
    response: { clientDataJSON: 'AA', attestationObject: 'AA', authenticatorData: 'AA', signature: 'AA', userHandle: prepared.userHandle }, clientExtensionResults: {} };
  return { port, repository, ids, recovery, prepared, credential, response, expiresAt };
}

describe('credential access use case authority (cryptographic verifier injected)', () => {
  it.each(['http://fixture.example', 'https://fixture.example/path', 'https://user@fixture.example'])('rejects insecure or non-exact origin %s before repository work', async origin => {
    const f = fixture(); f.port.origin = origin;
    await expect(loginCustomerPasskey(f.port, { ...f.ids, step: 'result' })).rejects.toThrow();
    await expect(recoverCustomerAccount(f.port, { ...f.ids, step: 'state' })).rejects.toThrow();
    expect(f.repository.resultPasskeyLogin).not.toHaveBeenCalled(); expect(f.repository.readAccountRecovery).not.toHaveBeenCalled();
  });
  it('can hash a bounded WebAuthn body without persisting it or crossing the crypto primitive limit', () => {
    const f = fixture(), context = customerCredentialContext(f.port), value = { assertion: 'a'.repeat(40_000) };
    expect(context.hash('assertion', value)).toMatch(/^[a-f0-9]{64}$/);
    expect(context.hash('assertion', value)).toBe(context.hash('assertion', value));
    expect(context.hash('assertion', value)).not.toBe(context.hash('registration', value));
    f.port.binding.attemptId = randomUUID();
    expect(customerCredentialContext(f.port).token('passkey', f.port.binding.attemptId).token)
      .not.toBe(context.token('recovery', f.port.binding.attemptId).token);
  });
  it.each(['passkey', 'recovery'] as const)('reads a missing %s attempt as unresolved only behind a valid private intent', async method => {
    const f = fixture(); f.repository.readAccountRecovery.mockResolvedValue(null);
    const work = () => method === 'passkey' ? loginCustomerPasskey(f.port, { ...f.ids, step: 'result' })
      : recoverCustomerAccount(f.port, { ...f.ids, step: 'state' });
    await expect(work()).resolves.toEqual({ state: 'unresolved', ...f.ids, expiresAt: f.expiresAt });
    f.port.intent.mockRejectedValue(new Error('private intent closed'));
    await expect(work()).rejects.toThrow();
    expect(f.repository.preparePasskeyLogin).not.toHaveBeenCalled(); expect(f.repository.beginAccountRecovery).not.toHaveBeenCalled();
    expect(f.port.view).not.toHaveBeenCalled();
  });
  it.each(['closed', 'expired'] as const)('never projects a profile from a %s login receipt', async state => {
    const f = fixture(); f.repository.resultPasskeyLogin.mockResolvedValue({ ...f.ids, expiresAt: f.expiresAt, state, session: null });
    await expect(loginCustomerPasskey(f.port, { ...f.ids, step: 'result' })).rejects.toThrow();
    expect(f.port.view).not.toHaveBeenCalled();
  });
  it('does not repeat cryptography when the signature was already claimed', async () => {
    const f = fixture(); f.repository.resultPasskeyLogin.mockResolvedValue({ ...f.ids, expiresAt: f.expiresAt, state: 'unresolved', session: null });
    await expect(loginCustomerPasskey(f.port, { ...f.ids, step: 'assert', response: f.response }))
      .resolves.toEqual({ ...f.ids, expiresAt: f.expiresAt, state: 'unresolved' });
    expect(f.port.verifier.verifyAuthentication).not.toHaveBeenCalled(); expect(f.repository.completePasskeyLogin).not.toHaveBeenCalled();
  });
  it('records a known invalid signature as terminal without exposing verifier inputs', async () => {
    const f = fixture(); f.repository.claimPasskeyLogin.mockResolvedValue(f.prepared);
    f.port.verifier.verifyAuthentication.mockRejectedValue(new PasskeyVerificationError());
    f.repository.resultPasskeyLogin.mockResolvedValueOnce(null).mockResolvedValue({ ...f.ids, expiresAt: f.expiresAt, state: 'failed', session: null });
    await expect(loginCustomerPasskey(f.port, { ...f.ids, step: 'assert', response: f.response }))
      .resolves.toEqual({ ...f.ids, expiresAt: f.expiresAt, state: 'failed' });
    expect(f.repository.completePasskeyLogin).toHaveBeenCalledWith(expect.objectContaining({ assertion: null }));
    expect(f.port.view).not.toHaveBeenCalled();
  });
  it('leaves an unexpected verifier outage uncertain, without a second claim or a synthetic session', async () => {
    const f = fixture(); f.repository.claimPasskeyLogin.mockResolvedValue(f.prepared);
    f.port.verifier.verifyAuthentication.mockRejectedValue(new Error('isolated verifier outage'));
    await expect(loginCustomerPasskey(f.port, { ...f.ids, step: 'assert', response: f.response })).rejects.toThrow();
    expect(f.repository.claimPasskeyLogin).toHaveBeenCalledTimes(1); expect(f.repository.completePasskeyLogin).not.toHaveBeenCalled();
  });
  it('refuses changed origin on the stored claim before cryptographic verification', async () => {
    const f = fixture(); f.repository.claimPasskeyLogin.mockResolvedValue({ ...f.prepared, origin: 'https://other.example' });
    await expect(loginCustomerPasskey(f.port, { ...f.ids, step: 'assert', response: f.response })).rejects.toThrow();
    expect(f.port.verifier.verifyAuthentication).not.toHaveBeenCalled();
  });
  it('checks the intent again after generating login options', async () => {
    const f = fixture(); f.repository.preparePasskeyLogin.mockResolvedValue(f.prepared);
    f.port.verifier.authenticationOptions.mockResolvedValue({ challenge: f.prepared.challenge, rpId: f.prepared.rpId,
      timeout: 60_000, userVerification: 'required', allowCredentials: [] });
    f.port.intent.mockResolvedValueOnce({ expiresAt: f.expiresAt }).mockRejectedValue(new Error('closed during generation'));
    await expect(loginCustomerPasskey(f.port, { ...f.ids, step: 'options' })).rejects.toThrow();
    expect(f.port.verifier.authenticationOptions).toHaveBeenCalledWith(expect.objectContaining({ allowCredentials: [] }));
  });
  it('recovery admission never requests a profile or session', async () => {
    const f = fixture(), code = 'SM1-1234-5678-9ABC-DEF0-1234-5678-9ABC-DEF0';
    f.repository.beginAccountRecovery.mockResolvedValue({ ...f.ids, expiresAt: f.expiresAt, state: 'granted', grant: f.recovery });
    await expect(recoverCustomerAccount(f.port, { ...f.ids, step: 'begin', code })).resolves.toEqual({ state: 'recovery', recovery: f.recovery });
    expect(f.repository.beginAccountRecovery).toHaveBeenCalledWith(expect.objectContaining({ codeHash: recoveryCodeHash(f.port.crypto, f.port.binding, code) }));
    expect(JSON.stringify(f.repository.beginAccountRecovery.mock.calls)).not.toContain(code);
    expect(f.repository.activateAccountRecovery).not.toHaveBeenCalled(); expect(f.port.view).not.toHaveBeenCalled();
  });
  it('recovery result never turns a missing receipt into a new activation', async () => {
    const f = fixture();
    await expect(recoverCustomerAccount(f.port, { ...f.ids, step: 'activation-result', activationId: randomUUID() })).rejects.toThrow();
    expect(f.repository.activateAccountRecovery).not.toHaveBeenCalled(); expect(f.port.intent).not.toHaveBeenCalled();
  });
  it('never republishes the clear replacement code on read/replay', async () => {
    const f = fixture(), rotationId = randomUUID();
    f.repository.issueRecoveryReplacement.mockResolvedValueOnce({ grant: f.recovery, emitCode: true })
      .mockResolvedValueOnce({ grant: f.recovery, emitCode: false });
    const request = { ...f.ids, step: 'recovery-code' as const, rotationId, expectedVersion: 0 };
    const first = await recoverCustomerAccount(f.port, request);
    if (first.state !== 'recovery-code' || !first.code) throw new Error('Expected initial clear code');
    expect(f.repository.issueRecoveryReplacement).toHaveBeenCalledWith({ ...f.port.binding, rotationId, expectedVersion: 0,
      codeHash: recoveryCodeHash(f.port.crypto, f.port.binding, first.code) });
    await expect(recoverCustomerAccount(f.port, request)).resolves.toEqual({ state: 'recovery-code', recovery: f.recovery, code: null });
  });
  it('rejects a grant expiring while the final private intent check waits', async () => {
    const f = fixture(); let reads = 0;
    f.port.intent.mockImplementation(async () => { if (++reads === 2) f.port.now = () => f.expiresAt; return { expiresAt: f.expiresAt }; });
    await expect(recoverCustomerAccount(f.port, { ...f.ids, step: 'state' })).rejects.toThrow();
  });
});
