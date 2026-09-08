import { generateAuthenticationOptions, generateRegistrationOptions, verifyAuthenticationResponse,
  verifyRegistrationResponse } from '@simplewebauthn/server';
import { decodeAttestationObject } from '@simplewebauthn/server/helpers';
import { TextDecoder } from 'node:util';
import { z } from 'zod';
import { PasskeyVerificationError, type PasskeyVerifier, type PasskeyRegistrationOptions,
  type PasskeyAuthenticationOptions, type VerifiedPasskey, type VerifiedPasskeyAssertion } from './passkey-verifier.port';

// Explicit, identical policy on generation and verification; never inherit
// runtime-dependent algorithm additions from the library's defaults.
const supportedAlgorithmIDs = [-7, -257, -8];
const canonicalBytes = (maximum: number, exact?: number) => z.string().min(1).max(Math.ceil(maximum * 4 / 3))
  .regex(/^[A-Za-z0-9_-]+$/).refine(value => {
    const bytes = Buffer.from(value, 'base64url');
    return bytes.length > 0 && bytes.length <= maximum && (exact === undefined || bytes.length === exact)
      && bytes.toString('base64url') === value;
  });
const opaque = canonicalBytes(32, 32);
const credentialId = canonicalBytes(1024);
const transports = z.array(z.enum(['ble', 'cable', 'hybrid', 'internal', 'nfc', 'smart-card', 'usb'])).max(7)
  .refine(value => new Set(value).size === value.length);
const descriptor = z.strictObject({ credentialId, transports: transports.optional() });
const descriptors = z.array(descriptor).max(20).refine(value => new Set(value.map(item => item.credentialId)).size === value.length);
const scopeShape = { origin: z.string().min(1).max(512), rpId: z.string().min(1).max(253), challenge: opaque };
const registrationInput = z.strictObject({ ...scopeShape,
  rpName: z.string().min(1).max(120).refine(value => value.trim() === value && !/[\p{Cc}\p{Cf}]/u.test(value)),
  userHandle: opaque, excludeCredentials: descriptors.optional() });
const authenticationInput = z.strictObject({ ...scopeShape, allowCredentials: descriptors.optional() });
const extensionResults = z.strictObject({ credProps: z.strictObject({ rk: z.boolean().optional() }).optional() });
const commonResponse = { id: credentialId, rawId: credentialId, type: z.literal('public-key'),
  authenticatorAttachment: z.enum(['platform', 'cross-platform']).optional(), clientExtensionResults: extensionResults };
const registrationResponse = z.strictObject({ ...commonResponse, response: z.strictObject({
  clientDataJSON: canonicalBytes(4096), attestationObject: canonicalBytes(16_384),
  transports: transports.optional(), authenticatorData: canonicalBytes(4096).optional(),
  publicKey: canonicalBytes(4096).optional(), publicKeyAlgorithm: z.number().int().optional(),
}) });
const authenticationResponse = z.strictObject({ ...commonResponse, response: z.strictObject({
  clientDataJSON: canonicalBytes(4096), authenticatorData: canonicalBytes(4096), signature: canonicalBytes(4096),
  userHandle: opaque.optional(),
}) });
const publicKey = z.instanceof(Uint8Array).refine(value => value.byteLength > 0 && value.byteLength <= 4096)
  .transform(value => new Uint8Array(value));
const counter = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const verifyRegistrationInput = z.strictObject({ ...scopeShape, response: registrationResponse });
const verifyAuthenticationInput = z.strictObject({ ...scopeShape, response: authenticationResponse,
  credential: descriptor.extend({ publicKey, counter, userHandle: opaque }) });

function assertScope(value: { origin: string; rpId: string }) {
  const url = new URL(value.origin);
  // A host-only RP deliberately excludes parent-domain sharing, Related Origin
  // Requests and HTTP fallback. Tenant ownership is separately attested by API.
  const labels = value.rpId.split('.');
  if (url.protocol !== 'https:' || url.origin !== value.origin || url.username || url.password
    || url.hostname !== value.rpId || labels.some(label => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))) throw new PasskeyVerificationError();
}
function assertSameOriginClientData(encoded: string) {
  const text = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.from(encoded, 'base64url'));
  const value: unknown = JSON.parse(text);
  // Keep the exact signed clientDataJSON for the library. WebAuthn permits
  // additional keys; only this explicit cross-origin restriction is ours.
  const parsed = z.object({ crossOrigin: z.literal(false).optional(), topOrigin: z.never().optional() }).parse(value);
  if (parsed.topOrigin !== undefined) throw new PasskeyVerificationError();
}
function hints(values: z.infer<typeof descriptors> = []) {
  return values.map(value => ({ id: value.credentialId, type: 'public-key' as const,
    ...(value.transports ? { transports: [...value.transports] } : {}) }));
}

/** Stateless SimpleWebAuthn adapter. A verified assertion is NOT permission to
 * publish a session: the caller must consume the durable challenge and update
 * the counter against the same credential/account revision atomically.
 * Credential discovery, userHandle ownership and origin/tenant configuration
 * are caller responsibilities; no storage, provider, logging or fallback. */
export class SimpleWebAuthnPasskeyVerifier implements PasskeyVerifier {
  async registrationOptions(input: Parameters<PasskeyVerifier['registrationOptions']>[0]): Promise<PasskeyRegistrationOptions> {
    try {
      const value = registrationInput.parse(input); assertScope(value);
      // A stable opaque alias avoids copying phone/name into authenticator UIs.
      const alias = `Compte ${value.userHandle.slice(0, 12)}`;
      const options = await generateRegistrationOptions({ rpID: value.rpId, rpName: value.rpName,
        userID: new Uint8Array(Buffer.from(value.userHandle, 'base64url')), userName: alias, userDisplayName: alias,
        challenge: new Uint8Array(Buffer.from(value.challenge, 'base64url')), timeout: 60_000, attestationType: 'none',
        supportedAlgorithmIDs,
        excludeCredentials: hints(value.excludeCredentials),
        authenticatorSelection: { residentKey: 'required', requireResidentKey: true, userVerification: 'required' },
        extensions: { credProps: true } });
      return { challenge: options.challenge, rp: { id: value.rpId, name: value.rpName }, user: { ...options.user },
        pubKeyCredParams: options.pubKeyCredParams.map(item => ({ type: item.type, alg: item.alg })),
        timeout: 60_000, attestation: 'none', excludeCredentials: hints(value.excludeCredentials),
        authenticatorSelection: { residentKey: 'required', requireResidentKey: true, userVerification: 'required' },
        extensions: { credProps: true } };
    } catch { throw new PasskeyVerificationError(); }
  }
  async authenticationOptions(input: Parameters<PasskeyVerifier['authenticationOptions']>[0]): Promise<PasskeyAuthenticationOptions> {
    try {
      const value = authenticationInput.parse(input); assertScope(value);
      const options = await generateAuthenticationOptions({ rpID: value.rpId, challenge: new Uint8Array(Buffer.from(value.challenge, 'base64url')),
        allowCredentials: hints(value.allowCredentials), timeout: 60_000, userVerification: 'required' });
      return { challenge: options.challenge, rpId: value.rpId, timeout: 60_000,
        userVerification: 'required', allowCredentials: hints(value.allowCredentials) };
    } catch { throw new PasskeyVerificationError(); }
  }
  async verifyRegistration(input: Parameters<PasskeyVerifier['verifyRegistration']>[0]): Promise<VerifiedPasskey> {
    try {
      const value = verifyRegistrationInput.parse(input); assertScope(value);
      assertSameOriginClientData(value.response.response.clientDataJSON);
      if (value.response.id !== value.response.rawId || value.response.clientExtensionResults.credProps?.rk === false) throw new PasskeyVerificationError();
      // Only the explicitly requested 'none' format: no certificate/metadata
      // service or unexpected attestation privacy semantics in this adapter.
      const attestation = decodeAttestationObject(new Uint8Array(Buffer.from(value.response.response.attestationObject, 'base64url')));
      if (attestation.get('fmt') !== 'none') throw new PasskeyVerificationError();
      const verified = await verifyRegistrationResponse({ response: value.response, expectedChallenge: value.challenge,
        expectedOrigin: value.origin, expectedRPID: value.rpId, requireUserVerification: true, requireUserPresence: true,
        supportedAlgorithmIDs });
      if (!verified.verified || !verified.registrationInfo.userVerified) throw new PasskeyVerificationError();
      const info = verified.registrationInfo;
      if (info.credential.id !== value.response.id) throw new PasskeyVerificationError();
      return { credentialId: credentialId.parse(info.credential.id), publicKey: publicKey.parse(info.credential.publicKey),
        counter: counter.parse(info.credential.counter), deviceType: info.credentialDeviceType,
        backedUp: info.credentialBackedUp, transports: transports.parse(info.credential.transports ?? []) };
    } catch { throw new PasskeyVerificationError(); }
  }
  async verifyAuthentication(input: Parameters<PasskeyVerifier['verifyAuthentication']>[0]): Promise<VerifiedPasskeyAssertion> {
    try {
      const value = verifyAuthenticationInput.parse(input); assertScope(value);
      assertSameOriginClientData(value.response.response.clientDataJSON);
      // The library verifies using the supplied public key but does not compare
      // response.id with its stored credential.id, nor bind userHandle for us.
      if (value.response.id !== value.response.rawId || value.response.id !== value.credential.credentialId
        || (value.response.response.userHandle !== undefined && value.response.response.userHandle !== value.credential.userHandle)) throw new PasskeyVerificationError();
      const verified = await verifyAuthenticationResponse({ response: value.response, expectedChallenge: value.challenge,
        expectedOrigin: value.origin, expectedRPID: value.rpId, requireUserVerification: true,
        credential: { id: value.credential.credentialId, publicKey: new Uint8Array(value.credential.publicKey),
          counter: value.credential.counter, transports: value.credential.transports } });
      if (!verified.verified || !verified.authenticationInfo.userVerified) throw new PasskeyVerificationError();
      const info = verified.authenticationInfo;
      return { credentialId: info.credentialID, counter: counter.parse(info.newCounter),
        deviceType: info.credentialDeviceType, backedUp: info.credentialBackedUp };
    } catch { throw new PasskeyVerificationError(); }
  }
}
