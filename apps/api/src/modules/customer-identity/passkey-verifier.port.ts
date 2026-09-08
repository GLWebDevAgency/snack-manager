/** Transport/cryptographic boundary only. The caller owns challenge freshness,
 * one-time admission, tenant/account authorization and atomic publication.
 * No SimpleWebAuthn types or browser secrets escape this port. */
export type PasskeyScope = { origin: string; rpId: string; challenge: string };
export type PasskeyTransport = 'ble' | 'cable' | 'hybrid' | 'internal' | 'nfc' | 'smart-card' | 'usb';
export type PasskeyDescriptor = { credentialId: string; transports?: PasskeyTransport[] };
type DescriptorJSON = { id: string; type: 'public-key'; transports?: PasskeyTransport[] };
export type PasskeyRegistrationOptions = {
  challenge: string; rp: { id: string; name: string }; user: { id: string; name: string; displayName: string };
  pubKeyCredParams: { type: 'public-key'; alg: number }[];
  timeout: number; attestation: 'none'; excludeCredentials: DescriptorJSON[];
  authenticatorSelection: { residentKey: 'required'; requireResidentKey: true; userVerification: 'required' };
  extensions: { credProps: true };
};
export type PasskeyAuthenticationOptions = {
  challenge: string; rpId: string; timeout: number; userVerification: 'required'; allowCredentials: DescriptorJSON[];
};
export type VerifiedPasskey = {
  credentialId: string; publicKey: Uint8Array; counter: number;
  deviceType: 'singleDevice' | 'multiDevice'; backedUp: boolean; transports: PasskeyTransport[];
};
export type VerifiedPasskeyAssertion = Pick<VerifiedPasskey, 'credentialId' | 'counter' | 'deviceType' | 'backedUp'>;
export interface PasskeyVerifier {
  registrationOptions(input: PasskeyScope & { rpName: string; userHandle: string; excludeCredentials?: PasskeyDescriptor[] }): Promise<PasskeyRegistrationOptions>;
  authenticationOptions(input: PasskeyScope & { allowCredentials?: PasskeyDescriptor[] }): Promise<PasskeyAuthenticationOptions>;
  verifyRegistration(input: PasskeyScope & { response: unknown }): Promise<VerifiedPasskey>;
  verifyAuthentication(input: PasskeyScope & {
    response: unknown; credential: PasskeyDescriptor & { publicKey: Uint8Array; counter: number; userHandle: string };
  }): Promise<VerifiedPasskeyAssertion>;
}

/** Deliberately omits cause, credential IDs, challenges and library diagnostics. */
export class PasskeyVerificationError extends Error {
  constructor() { super('Vérification de la clé d’accès indisponible.'); this.name = 'PasskeyVerificationError'; }
}
