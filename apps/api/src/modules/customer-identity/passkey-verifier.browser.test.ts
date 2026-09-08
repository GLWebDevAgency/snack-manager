/// <reference lib="dom" />
import { randomBytes } from 'node:crypto';
import { build } from 'esbuild';
import { chromium, type Browser, type BrowserContext, type CDPSession, type Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { verifyAuthenticationResponse, verifyRegistrationResponse } from '@simplewebauthn/server';
import { SimpleWebAuthnPasskeyVerifier } from './passkey-verifier';
import { PasskeyVerificationError, type PasskeyAuthenticationOptions, type PasskeyRegistrationOptions, type VerifiedPasskey } from './passkey-verifier.port';

/** Real browser + SimpleWebAuthn browser/server with a Chromium CTAP2 virtual
 * authenticator. HTTPS origin is fulfilled locally, no network/server/provider,
 * no recorded private credential, screenshots or authenticator hardware claim.
 * This tests crypto/options only, NOT challenge consumption/session publication. */
const verifier = new SimpleWebAuthnPasskeyVerifier();
const origin = 'https://keys.fixture.test'; const rpId = 'keys.fixture.test';
const opaque = () => randomBytes(32).toString('base64url');
type RegistrationJSON = { id: string; rawId: string; type: string; clientExtensionResults: { credProps?: { rk?: boolean } };
  response: { attestationObject: string; clientDataJSON: string; publicKey?: string; authenticatorData?: string; transports?: string[] } };
type AuthenticationJSON = { id: string; rawId: string; type: string; clientExtensionResults: Record<string, unknown>;
  response: { clientDataJSON: string; authenticatorData: string; signature: string; userHandle?: string } };
type FixtureWindow = Window & { passkeys: { startRegistration(input: { optionsJSON: PasskeyRegistrationOptions }): Promise<RegistrationJSON>;
  startAuthentication(input: { optionsJSON: PasskeyAuthenticationOptions }): Promise<AuthenticationJSON> } };
function alterBytes(encoded: string, position: number, mask: number) {
  const bytes = Buffer.from(encoded, 'base64url'); bytes[position] = bytes[position]! ^ mask; return bytes.toString('base64url');
}
function alterClientData<T extends { response: { clientDataJSON: string } }>(response: T, patch: Record<string, unknown>): T {
  const next = structuredClone(response);
  next.response.clientDataJSON = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(next.response.clientDataJSON, 'base64url').toString('utf8')), ...patch })).toString('base64url');
  return next;
}

describe('passkey verifier — real WebAuthn signatures from isolated Chromium', () => {
  let browser: Browser | undefined; let context: BrowserContext | undefined; let page: Page; let cdp: CDPSession; let authenticatorId: string;
  let registration: RegistrationJSON; let credential: VerifiedPasskey; let userHandle: string; let registrationChallenge: string;
  let authentication: AuthenticationJSON; let authenticationChallenge: string;
  const unexpectedRequests: string[] = [];
  beforeAll(async () => {
    const bundle = await build({ stdin: { contents: 'import {startRegistration,startAuthentication} from "@simplewebauthn/browser";window.passkeys={startRegistration,startAuthentication};',
      resolveDir: process.cwd(), sourcefile: 'passkey-fixture.js' }, write: false, bundle: true, format: 'iife', platform: 'browser', target: 'es2022' });
    browser = await chromium.launch({ headless: true });
    context = await browser.newContext();
    await context.route('**/*', async route => {
      if (route.request().url() === `${origin}/` && route.request().method() === 'GET') {
        await route.fulfill({ contentType: 'text/html', body: '<!doctype html><html lang="fr"><title>Isolated WebAuthn fixture</title></html>' });
      } else { unexpectedRequests.push(new URL(route.request().url()).origin); await route.abort(); }
    });
    page = await context.newPage(); page.setDefaultTimeout(5000);
    await page.goto(origin); await page.addScriptTag({ content: bundle.outputFiles[0]!.text });
    cdp = await context.newCDPSession(page); await cdp.send('WebAuthn.enable');
    ({ authenticatorId } = await cdp.send('WebAuthn.addVirtualAuthenticator', { options: { protocol: 'ctap2', transport: 'internal',
      hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true } }));
    userHandle = opaque(); registrationChallenge = opaque();
    const options = await verifier.registrationOptions({ origin, rpId, challenge: registrationChallenge, rpName: 'Restaurant fixture', userHandle });
    registration = await page.evaluate(optionsJSON => (window as unknown as FixtureWindow).passkeys.startRegistration({ optionsJSON }), options);
    credential = await verifier.verifyRegistration({ origin, rpId, challenge: registrationChallenge, response: registration });
    authenticationChallenge = opaque();
    const authOptions = await verifier.authenticationOptions({ origin, rpId, challenge: authenticationChallenge,
      allowCredentials: [{ credentialId: credential.credentialId, transports: credential.transports }] });
    authentication = await page.evaluate(optionsJSON => (window as unknown as FixtureWindow).passkeys.startAuthentication({ optionsJSON }), authOptions);
  }, 20_000);
  afterAll(async () => { try { await context?.close(); } finally { await browser?.close(); } });
  const verifyRegistration = (response = registration, challenge = registrationChallenge) => verifier.verifyRegistration({ origin, rpId, challenge, response });
  const storedCredential = () => ({ credentialId: credential.credentialId, publicKey: credential.publicKey,
    counter: credential.counter, transports: credential.transports, userHandle });
  const verifyAuthentication = (response = authentication, override: Record<string, unknown> = {}) => verifier.verifyAuthentication({
    origin, rpId, challenge: authenticationChallenge, response, credential: { ...storedCredential(), ...override } });

  it('verifies registration and assertion with only minimal detached projections', async () => {
    expect(credential.credentialId).toBe(registration.id);
    expect(credential.publicKey).toBeInstanceOf(Uint8Array);
    expect(Object.keys(credential).sort()).toEqual(['backedUp', 'counter', 'credentialId', 'deviceType', 'publicKey', 'transports']);
    expect(await verifyAuthentication()).toEqual({ credentialId: credential.credentialId, counter: credential.counter + 1,
      deviceType: 'singleDevice', backedUp: false });
    expect(unexpectedRequests).toEqual([]);
  });
  it('does not infer replay protection without the caller persisting the counter', async () => {
    const first = await verifyAuthentication(); expect(await verifyAuthentication()).toEqual(first);
    await expect(verifyAuthentication(authentication, { counter: first.counter })).rejects.toBeInstanceOf(PasskeyVerificationError);
  });
  it('rejects a different challenge for registration and assertion', async () => {
    await expect(verifyRegistration(registration, opaque())).rejects.toBeInstanceOf(PasskeyVerificationError);
    await expect(verifier.verifyAuthentication({ origin, rpId, challenge: opaque(), response: authentication,
      credential: storedCredential() })).rejects.toBeInstanceOf(PasskeyVerificationError);
  });
  it('rejects another origin even under a self-consistent exact-host scope', async () => {
    const other = { origin: 'https://other.fixture.test', rpId: 'other.fixture.test' };
    await expect(verifier.verifyRegistration({ ...other, challenge: registrationChallenge, response: registration })).rejects.toBeInstanceOf(PasskeyVerificationError);
    await expect(verifier.verifyAuthentication({ ...other, challenge: authenticationChallenge, response: authentication,
      credential: storedCredential() })).rejects.toBeInstanceOf(PasskeyVerificationError);
  });
  it('rejects a credential generated for the parent RP despite the correct page origin', async () => {
    const challenge = opaque(); const options = await verifier.registrationOptions({ origin, rpId, challenge, userHandle: opaque(), rpName: 'Parent RP counterexample' });
    options.rp.id = 'fixture.test';
    const response = await page.evaluate(optionsJSON => (window as unknown as FixtureWindow).passkeys.startRegistration({ optionsJSON }), options);
    await expect(verifier.verifyRegistration({ origin, rpId, challenge, response })).rejects.toBeInstanceOf(PasskeyVerificationError);
  });
  it('rejects a real unverified authenticator registration and signed assertion', async () => {
    await cdp.send('WebAuthn.setResponseOverrideBits', { authenticatorId, isBadUV: true });
    try {
      const challenge = opaque(); const options = await verifier.registrationOptions({ origin, rpId, challenge, userHandle: opaque(), rpName: 'UV counterexample' });
      const response = await page.evaluate(optionsJSON => {
        Object.assign(optionsJSON.authenticatorSelection, { userVerification: 'discouraged' });
        return (window as unknown as FixtureWindow).passkeys.startRegistration({ optionsJSON });
      }, options);
      // Positive controls prove these are otherwise valid library responses;
      // the adapter must reject UV specifically, not unrelated fixture errors.
      expect((await verifyRegistrationResponse({ response: response as Parameters<typeof verifyRegistrationResponse>[0]['response'],
        expectedChallenge: challenge, expectedOrigin: origin, expectedRPID: rpId, requireUserVerification: false })).verified).toBe(true);
      await expect(verifier.verifyRegistration({ origin, rpId, challenge, response })).rejects.toBeInstanceOf(PasskeyVerificationError);
      const authOptions = await verifier.authenticationOptions({ origin, rpId, challenge,
        allowCredentials: [{ credentialId: credential.credentialId }] });
      const assertion = await page.evaluate(optionsJSON => {
        Object.assign(optionsJSON, { userVerification: 'discouraged' });
        return (window as unknown as FixtureWindow).passkeys.startAuthentication({ optionsJSON });
      }, authOptions);
      expect((await verifyAuthenticationResponse({ response: assertion as Parameters<typeof verifyAuthenticationResponse>[0]['response'],
        expectedChallenge: challenge, expectedOrigin: origin, expectedRPID: rpId, requireUserVerification: false,
        credential: { id: credential.credentialId, publicKey: new Uint8Array(credential.publicKey), counter: credential.counter } })).verified).toBe(true);
      await expect(verifier.verifyAuthentication({ origin, rpId, challenge, response: assertion, credential: storedCredential() })).rejects.toBeInstanceOf(PasskeyVerificationError);
    } finally { await cdp.send('WebAuthn.setResponseOverrideBits', { authenticatorId, isBadUV: false }); }
  });
  it('rejects a corrupted real signature and public key', async () => {
    const next = structuredClone(authentication); next.response.signature = alterBytes(next.response.signature, 5, 1);
    await expect(verifyAuthentication(next)).rejects.toBeInstanceOf(PasskeyVerificationError);
    await expect(verifyAuthentication(authentication, { publicKey: new Uint8Array([1, 2, 3]) })).rejects.toBeInstanceOf(PasskeyVerificationError);
  });
  it('takes the public key from verified attestation, not the browser convenience field', async () => {
    const altered = structuredClone(registration); altered.response.publicKey = opaque();
    const result = await verifyRegistration(altered);
    expect(result.publicKey).toEqual(credential.publicKey);
    result.publicKey.fill(0);
    expect((await verifyRegistration()).publicKey).toEqual(credential.publicKey);
  });
  it('rejects oversized response bytes before CBOR/signature parsing', async () => {
    const large = structuredClone(registration); large.response.attestationObject = randomBytes(16_385).toString('base64url');
    await expect(verifyRegistration(large)).rejects.toBeInstanceOf(PasskeyVerificationError);
    const assertion = structuredClone(authentication); assertion.response.clientDataJSON = randomBytes(4097).toString('base64url');
    await expect(verifyAuthentication(assertion)).rejects.toBeInstanceOf(PasskeyVerificationError);
  });
  it('rejects a relabeled credential even when its supplied public key verifies', async () => {
    const next = structuredClone(authentication); next.id = next.rawId = opaque();
    await expect(verifyAuthentication(next)).rejects.toBeInstanceOf(PasskeyVerificationError);
    await expect(verifyAuthentication(authentication, { credentialId: opaque() })).rejects.toBeInstanceOf(PasskeyVerificationError);
  });
  it('binds a returned userHandle to the stored account handle', async () => {
    expect(authentication.response.userHandle).toBe(userHandle);
    const next = structuredClone(authentication); next.response.userHandle = opaque();
    await expect(verifyAuthentication(next)).rejects.toBeInstanceOf(PasskeyVerificationError);
  });
  it.each([{ crossOrigin: true }, { crossOrigin: true, topOrigin: 'https://frame.fixture.test' }, { topOrigin: origin }])('rejects cross-origin clientData explicitly %j', async patch => {
    await expect(verifyRegistration(alterClientData(registration, patch))).rejects.toBeInstanceOf(PasskeyVerificationError);
    await expect(verifyAuthentication(alterClientData(authentication, patch))).rejects.toBeInstanceOf(PasskeyVerificationError);
  });
  it('rejects mismatched raw IDs, noncanonical bytes and unknown extension output', async () => {
    const raw = structuredClone(registration); raw.rawId = opaque();
    await expect(verifyRegistration(raw)).rejects.toBeInstanceOf(PasskeyVerificationError);
    const padded = structuredClone(authentication); padded.response.signature += '=';
    await expect(verifyAuthentication(padded)).rejects.toBeInstanceOf(PasskeyVerificationError);
    const extension = structuredClone(authentication); extension.clientExtensionResults = { appid: true };
    await expect(verifyAuthentication(extension)).rejects.toBeInstanceOf(PasskeyVerificationError);
  });
});
