export type PhoneVerificationStart = { phone: string; serviceSid: string };
export type PhoneVerificationCheck = PhoneVerificationStart & {
  verificationSid: string;
  code: string;
};
export type PhoneVerificationStarted = { verificationSid: string;
  /** Authenticated provider resource/HTTP dates; required for production settlement. */
  providerCreatedAt?: number; providerObservedAt?: number };

/** Transport only: callers must first bind and reserve a durable challenge.
 * `expired` means no longer checkable, including Twilio's ambiguous 404 after
 * approval or exhausted attempts. It NEVER constitutes proof of ownership. */
export interface PhoneVerificationTransport {
  start(input: PhoneVerificationStart): Promise<PhoneVerificationStarted>;
  check(input: PhoneVerificationCheck): Promise<'approved' | 'pending' | 'expired' | 'locked'>;
}

export type PhoneVerificationFailure =
  | 'configuration' | 'invalid_request' | 'throttled' | 'rejected' | 'uncertain';

export class PhoneVerificationTransportError extends Error {
  constructor(readonly reason: PhoneVerificationFailure) {
    super('Vérification téléphonique indisponible.');
    this.name = 'PhoneVerificationTransportError';
  }
}
