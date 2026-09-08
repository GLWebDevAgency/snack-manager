import { randomBytes } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { SimpleWebAuthnPasskeyVerifier } from './passkey-verifier';
import { PasskeyVerificationError } from './passkey-verifier.port';

const verifier = new SimpleWebAuthnPasskeyVerifier();
const scope = () => ({ origin: 'https://keys.fixture.test', rpId: 'keys.fixture.test', challenge: randomBytes(32).toString('base64url') });
const registration = () => ({ ...scope(), rpName: 'Restaurant fixture', userHandle: randomBytes(32).toString('base64url') });

describe('passkey verifier — bounded options with explicit orchestration challenge', () => {
  it('returns caller-owned challenge/opaque handle with mandatory UV and resident credentials', async () => {
    const input = registration(); const before = structuredClone(input);
    const options = await verifier.registrationOptions(input);
    expect(options).toMatchObject({ challenge: input.challenge, rp: { id: input.rpId, name: input.rpName },
      user: { id: input.userHandle }, attestation: 'none', timeout: 60_000,
      authenticatorSelection: { residentKey: 'required', requireResidentKey: true, userVerification: 'required' }, extensions: { credProps: true } });
    expect(options.user.name).toBe(options.user.displayName);
    expect(options.user.name).not.toContain('@');
    expect(options.pubKeyCredParams).toEqual([-7, -257, -8].map(alg => ({ type: 'public-key', alg })));
    expect(await verifier.registrationOptions(input)).toEqual(options);
    expect(input).toEqual(before);
  });
  it('supports discoverable authentication without inventing a challenge or account selection', async () => {
    const input = scope();
    expect(await verifier.authenticationOptions(input)).toEqual({ challenge: input.challenge, rpId: input.rpId,
      allowCredentials: [], userVerification: 'required', timeout: 60_000 });
  });
  it('preserves bounded descriptor IDs and copies transport hints', async () => {
    const descriptor = { credentialId: randomBytes(32).toString('base64url'), transports: ['internal' as const] };
    const registrationOptions = await verifier.registrationOptions({ ...registration(), excludeCredentials: [descriptor] });
    const authenticationOptions = await verifier.authenticationOptions({ ...scope(), allowCredentials: [descriptor] });
    expect(registrationOptions.excludeCredentials).toEqual([{ id: descriptor.credentialId, type: 'public-key', transports: ['internal'] }]);
    descriptor.transports.pop();
    expect(authenticationOptions.allowCredentials[0]?.transports).toEqual(['internal']);
  });
  it.each([
    { origin: 'http://keys.fixture.test' }, { origin: 'https://keys.fixture.test/' },
    { origin: 'https://keys.fixture.test/path' }, { origin: 'https://keys.fixture.test?query=1' },
    { origin: 'https://keys.fixture.test#fragment' }, { origin: 'https://user@keys.fixture.test' },
    { origin: 'https://KEYS.fixture.test' }, { rpId: 'fixture.test' }, { rpId: 'other.fixture.test' },
    { rpId: 'keys.fixture.test:443' }, { challenge: '' }, { challenge: 'x'.repeat(43) },
    { challenge: randomBytes(32).toString('base64') }, { challenge: randomBytes(33).toString('base64url') },
  ])('rejects noncanonical scope/challenge %j', async patch => {
    await expect(verifier.registrationOptions({ ...registration(), ...patch })).rejects.toBeInstanceOf(PasskeyVerificationError);
    await expect(verifier.authenticationOptions({ ...scope(), ...patch })).rejects.toBeInstanceOf(PasskeyVerificationError);
  });
  it.each(['', 'customer@example.test', '+33612345678', 'x'.repeat(43)])('rejects a non-opaque handle', async userHandle => {
    await expect(verifier.registrationOptions({ ...registration(), userHandle })).rejects.toBeInstanceOf(PasskeyVerificationError);
  });
  it.each(['', 'x'.repeat(121), 'Restaurant\nfixture'])('rejects unbounded or control-bearing RP labels', async rpName => {
    await expect(verifier.registrationOptions({ ...registration(), rpName })).rejects.toBeInstanceOf(PasskeyVerificationError);
  });
  it('rejects unknown options rather than letting a caller disable security requirements', async () => {
    await expect(verifier.registrationOptions({ ...registration(), userVerification: 'discouraged' } as never)).rejects.toBeInstanceOf(PasskeyVerificationError);
    await expect(verifier.authenticationOptions({ ...scope(), extensions: { appid: 'https://other.fixture.test' } } as never)).rejects.toBeInstanceOf(PasskeyVerificationError);
  });
  it('bounds descriptor count, size, duplication and transports', async () => {
    const many = Array.from({ length: 21 }, () => ({ credentialId: randomBytes(32).toString('base64url') }));
    for (const allowCredentials of [many, [many[0], many[0]], [{ credentialId: randomBytes(1025).toString('base64url') }],
      [{ ...many[0], transports: ['internal', 'internal'] }], [{ ...many[0], transports: ['unknown'] }]]) {
      await expect(verifier.authenticationOptions({ ...scope(), allowCredentials } as never)).rejects.toBeInstanceOf(PasskeyVerificationError);
    }
    expect((await verifier.authenticationOptions({ ...scope(), allowCredentials: many.slice(0, 20) })).allowCredentials).toHaveLength(20);
  });
  it('emits no logs for a malformed bounded assertion', async () => {
    const log = vi.spyOn(console, 'log'), warn = vi.spyOn(console, 'warn'), error = vi.spyOn(console, 'error');
    try {
      await expect(verifier.verifyAuthentication({ ...scope(), response: { private: 'fixture-marker' }, credential: {
        credentialId: randomBytes(32).toString('base64url'), publicKey: new Uint8Array([1]), counter: 0,
        userHandle: randomBytes(32).toString('base64url'),
      } })).rejects.toBeInstanceOf(PasskeyVerificationError);
      expect(log).not.toHaveBeenCalled(); expect(warn).not.toHaveBeenCalled(); expect(error).not.toHaveBeenCalled();
    } finally { log.mockRestore(); warn.mockRestore(); error.mockRestore(); }
  });
  it.each([null, [], 'secret input', {}, { response: {} }])('rejects invalid response without leaking library diagnostics', async response => {
    let failure: unknown;
    try { await verifier.verifyRegistration({ ...scope(), response }); } catch (error) { failure = error; }
    expect(failure).toBeInstanceOf(PasskeyVerificationError);
    expect((failure as Error).message).toBe('Vérification de la clé d’accès indisponible.');
    expect(failure).not.toHaveProperty('cause');
    expect(JSON.stringify(failure)).not.toContain('secret input');
  });
});
