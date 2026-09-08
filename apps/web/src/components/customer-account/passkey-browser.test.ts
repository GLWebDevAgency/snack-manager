import { describe, expect, it, vi } from 'vitest';
import { createCustomerPasskeyBrowser } from './passkey-browser';

const options = () => ({ challenge: 'A'.repeat(43), rp: { id: 'restaurant.example.test', name: 'Restaurant' },
  user: { id: 'B'.repeat(42) + 'A', name: 'opaque', displayName: 'Clé personnelle' },
  pubKeyCredParams: [{ type: 'public-key' as const, alg: -7 }], timeout: 60_000, attestation: 'none' as const,
  authenticatorSelection: { residentKey: 'required' as const, userVerification: 'required' as const },
});
const assertion = () => ({ challenge: 'A'.repeat(43), rpId: 'restaurant.example.test',
  timeout: 60_000, userVerification: 'required' as const, allowCredentials: [] });
function fixture() {
  const sdk = { browserSupportsWebAuthn: vi.fn(() => true), startRegistration: vi.fn(async () => ({ id: 'registered' })),
    startAuthentication: vi.fn(async () => ({ id: 'asserted' })), WebAuthnAbortService: { cancelCeremony: vi.fn() } };
  const load = vi.fn(async () => sdk);
  const port = { load, secure: () => true, hostname: () => 'restaurant.example.test', active: () => true };
  return { sdk, load, port };
}
describe('explicit customer passkey ceremony', () => {
  it('does not load or invoke the browser authenticator when constructed', () => {
    const f = fixture(); createCustomerPasskeyBrowser(f.port);
    expect(f.load).not.toHaveBeenCalled();
  });
  it('invokes registration only and never silent auto-registration', async () => {
    const f = fixture(); const client = createCustomerPasskeyBrowser(f.port);
    expect(await client.register(options())).toEqual({ kind: 'completed', response: { id: 'registered' } });
    expect(f.sdk.startRegistration).toHaveBeenCalledExactlyOnceWith({ optionsJSON: options(), useAutoRegister: false });
    expect(f.sdk.startAuthentication).not.toHaveBeenCalled();
  });
  it('invokes assertion explicitly without conditional autofill', async () => {
    const f = fixture(); const client = createCustomerPasskeyBrowser(f.port);
    expect(await client.authenticate(assertion())).toEqual({ kind: 'completed', response: { id: 'asserted' } });
    expect(f.sdk.startAuthentication).toHaveBeenCalledExactlyOnceWith({ optionsJSON: assertion(), useBrowserAutofill: false });
  });
  it.each(['insecure', 'foreign-rp', 'no-user-verification', 'nonresident', 'attestation'] as const)('refuses %s before SDK loading', async fault => {
    const f = fixture(); const input = options();
    if (fault === 'insecure') f.port.secure = () => false;
    if (fault === 'foreign-rp') input.rp.id = 'example.test';
    if (fault === 'no-user-verification') Object.assign(input.authenticatorSelection, { userVerification: 'preferred' });
    if (fault === 'nonresident') Object.assign(input.authenticatorSelection, { residentKey: 'preferred' });
    if (fault === 'attestation') Object.assign(input, { attestation: 'direct' });
    expect(await createCustomerPasskeyBrowser(f.port).register(input)).toEqual({ kind: 'unavailable' });
    expect(f.load).not.toHaveBeenCalled();
  });
  it('refuses an assertion for a parent or different RP', async () => {
    const f = fixture(); expect(await createCustomerPasskeyBrowser(f.port).authenticate({ ...assertion(), rpId: 'example.test' })).toEqual({ kind: 'unavailable' });
    expect(f.load).not.toHaveBeenCalled();
  });
  it('does not start a late SDK import after the panel was paused', async () => {
    const f = fixture(); let resolve!: (value: typeof f.sdk) => void;
    f.load.mockImplementation(() => new Promise(r => { resolve = r; }));
    const client = createCustomerPasskeyBrowser(f.port); const work = client.register(options());
    client.cancel(); resolve(f.sdk);
    expect(await work).toEqual({ kind: 'cancelled' });
    expect(f.sdk.startRegistration).not.toHaveBeenCalled();
    expect(f.sdk.WebAuthnAbortService.cancelCeremony).not.toHaveBeenCalled();
  });
  it('cancels the current ceremony and discards its late response', async () => {
    const f = fixture(); let resolve!: (value: { id: string }) => void;
    f.sdk.startRegistration.mockImplementation(() => new Promise(r => { resolve = r; }));
    const client = createCustomerPasskeyBrowser(f.port); const work = client.register(options());
    await vi.waitFor(() => expect(f.sdk.startRegistration).toHaveBeenCalled()); client.cancel(); resolve({ id: 'late' });
    expect(await work).toEqual({ kind: 'cancelled' });
    expect(f.sdk.WebAuthnAbortService.cancelCeremony).toHaveBeenCalledTimes(1);
  });
  it('refuses concurrent ceremonies without cancelling the first one', async () => {
    const f = fixture(); let resolve!: (value: { id: string }) => void;
    f.sdk.startRegistration.mockImplementation(() => new Promise(r => { resolve = r; }));
    const client = createCustomerPasskeyBrowser(f.port); const first = client.register(options());
    expect(await client.authenticate(assertion())).toEqual({ kind: 'busy' });
    await vi.waitFor(() => expect(f.sdk.startRegistration).toHaveBeenCalled()); resolve({ id: 'first' }); await first;
    expect(f.sdk.WebAuthnAbortService.cancelCeremony).not.toHaveBeenCalled();
  });
  it.each(['NotAllowedError', 'AbortError', 'SecurityError', 'InvalidStateError'])('projects %s without exposing the browser error', async name => {
    const f = fixture(); f.sdk.startRegistration.mockRejectedValue(Object.assign(new Error('private credential diagnostic'), { name }));
    const result = await createCustomerPasskeyBrowser(f.port).register(options());
    expect(result).toEqual({ kind: ['NotAllowedError', 'AbortError'].includes(name) ? 'cancelled' : 'unavailable' });
    expect(JSON.stringify(result)).not.toContain('private');
  });
  it('discards a completed credential when visibility or connectivity changed', async () => {
    const f = fixture(); f.sdk.startAuthentication.mockImplementation(async () => { f.port.active = () => false; return { id: 'private' }; });
    // active stays indirect so the controller can revoke authority mid-request.
    const client = createCustomerPasskeyBrowser({ ...f.port, active: () => f.port.active() });
    expect(await client.authenticate(assertion())).toEqual({ kind: 'cancelled' });
  });
});
