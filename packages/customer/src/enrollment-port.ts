import type { CustomerIntentBinding, CustomerSession } from './port';

/** Private repository boundary. Only a verifier may supply verified key data. */
export type EnrollmentBinding = CustomerIntentBinding & { checkId: string };
export type CustomerEnrollment = {
  operationId: string; checkId: string; expiresAt: number;
  stage: 'registration_required' | 'assertion_required' | 'recovery_required'; recoveryVersion: number;
};
export type CustomerCheckCompletion = { kind: 'enrollment'; enrollment: CustomerEnrollment }
  | { kind: 'session'; session: CustomerSession };
export type EnrollmentPasskey = {
  credentialId: string; publicKey: Uint8Array; counter: number;
  deviceType: 'singleDevice' | 'multiDevice'; backedUp: boolean;
  transports: ('ble' | 'cable' | 'hybrid' | 'internal' | 'nfc' | 'smart-card' | 'usb')[];
};
export type EnrollmentKeyPreparation = {
  registrationId: string; origin: string; rpId: string; challenge: string; userHandle: string; expiresAt: number;
};
export type EnrollmentAssertionPreparation = {
  assertionId: string; origin: string; rpId: string; challenge: string; userHandle: string;
  credential: EnrollmentPasskey; expiresAt: number;
};
export interface CustomerEnrollmentRepository {
  readEnrollment(input: EnrollmentBinding): Promise<CustomerEnrollment | null>;
  readEnrollmentKey(input: EnrollmentBinding & { registrationId: string }): Promise<EnrollmentKeyPreparation | null>;
  readEnrollmentAssertion(input: EnrollmentBinding & { assertionId: string }): Promise<EnrollmentAssertionPreparation | null>;
  prepareEnrollmentKey(input: EnrollmentBinding & Omit<EnrollmentKeyPreparation, 'expiresAt'>): Promise<EnrollmentKeyPreparation | null>;
  recordEnrollmentKey(input: EnrollmentBinding & {
    registrationId: string; requestHash: string; credential: EnrollmentPasskey;
  }): Promise<CustomerEnrollment | null>;
  prepareEnrollmentAssertion(input: EnrollmentBinding & {
    assertionId: string; origin: string; rpId: string; challenge: string;
  }): Promise<EnrollmentAssertionPreparation | null>;
  recordEnrollmentAssertion(input: EnrollmentBinding & {
    assertionId: string; requestHash: string; credentialId: string; counter: number;
    deviceType: 'singleDevice' | 'multiDevice'; backedUp: boolean;
  }): Promise<CustomerEnrollment | null>;
  /** A replay never emits the old code, even if a new candidate was generated. */
  issueEnrollmentRecovery(input: EnrollmentBinding & {
    rotationId: string; expectedVersion: number; codeHash: string;
  }): Promise<{ enrollment: CustomerEnrollment; emitCode: boolean } | null>;
  activateEnrollment(input: EnrollmentBinding & {
    /** One stable ID per enrollment, pinned on the first confirmation, including
     * incorrect codes. Up to five explicit corrections; no code rotation after. */
    activationId: string; requestHash: string; recoveryVersion: number; codeHash: string;
    accountId: string; sessionId: string; sessionHash: string; sessionExpiresAt: number;
  }): Promise<CustomerSession | null>;
  recoverEnrollmentActivation(input: EnrollmentBinding & {
    activationId: string; sessionHash: string;
  }): Promise<CustomerSession | null>;
}
