import type { PublicKeyCredentialCreationOptionsJSON, PublicKeyCredentialRequestOptionsJSON } from '@simplewebauthn/browser';

export type CustomerPasskeyOutcome = { kind: 'completed'; response: unknown }
  | { kind: 'cancelled' | 'unavailable' | 'busy' };
type Sdk = {
  browserSupportsWebAuthn(): boolean;
  startRegistration(input: { optionsJSON: PublicKeyCredentialCreationOptionsJSON; useAutoRegister: false }): Promise<unknown>;
  startAuthentication(input: { optionsJSON: PublicKeyCredentialRequestOptionsJSON; useBrowserAutofill: false }): Promise<unknown>;
  WebAuthnAbortService: { cancelCeremony(): void };
};
type Port = { load(): Promise<Sdk>; secure(): boolean; hostname(): string; active(): boolean };

/** The caller validates the server DTO and durably selects a command first.
 * A browser credential is not proof of registration/login: only a correlated
 * server receipt may advance the journal. No conditional or silent ceremony. */
export function createCustomerPasskeyBrowser(port: Port) {
  let generation = 0; let busy = false; let currentSdk: Sdk | null = null;
  async function ceremony(kind: 'register' | 'authenticate', options: PublicKeyCredentialCreationOptionsJSON | PublicKeyCredentialRequestOptionsJSON): Promise<CustomerPasskeyOutcome> {
    if (busy) return { kind: 'busy' };
    if (!port.secure() || !port.active()) return { kind: 'unavailable' };
    if (kind === 'register') {
      if (!('rp' in options) || options.rp.id !== port.hostname() || options.attestation !== 'none'
        || options.authenticatorSelection?.residentKey !== 'required'
        || options.authenticatorSelection.userVerification !== 'required') return { kind: 'unavailable' };
    } else if (!('rpId' in options) || options.rpId !== port.hostname() || options.userVerification !== 'required') return { kind: 'unavailable' };
    const version = generation; busy = true;
    try {
      const sdk = await port.load();
      if (version !== generation || !port.active()) return { kind: 'cancelled' };
      if (!sdk.browserSupportsWebAuthn()) return { kind: 'unavailable' };
      currentSdk = sdk;
      const response = kind === 'register'
        ? await sdk.startRegistration({ optionsJSON: options as PublicKeyCredentialCreationOptionsJSON, useAutoRegister: false })
        : await sdk.startAuthentication({ optionsJSON: options as PublicKeyCredentialRequestOptionsJSON, useBrowserAutofill: false });
      return version === generation && port.active() ? { kind: 'completed', response } : { kind: 'cancelled' };
    } catch (error) {
      const name = error instanceof Error ? error.name : '';
      return { kind: version !== generation || ['AbortError', 'NotAllowedError'].includes(name) ? 'cancelled' : 'unavailable' };
    } finally { busy = false; currentSdk = null; }
  }
  return {
    register: (options: PublicKeyCredentialCreationOptionsJSON) => ceremony('register', options),
    authenticate: (options: PublicKeyCredentialRequestOptionsJSON) => ceremony('authenticate', options),
    cancel() {
      generation++;
      // Do not cancel a different owner's ceremony while this SDK is loading.
      try { currentSdk?.WebAuthnAbortService.cancelCeremony(); } catch { /* No browser diagnostics leave this boundary. */ }
    },
  };
}

export function customerPasskeyBrowser(active: () => boolean) {
  return createCustomerPasskeyBrowser({ load: () => import('@simplewebauthn/browser'), active,
    secure: () => typeof window !== 'undefined' && window.isSecureContext && window.location.protocol === 'https:',
    hostname: () => typeof window === 'undefined' ? '' : window.location.hostname,
  });
}
