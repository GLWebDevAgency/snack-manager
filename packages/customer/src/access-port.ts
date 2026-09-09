import type { CustomerIntentBinding, CustomerSession } from './port';
import type { EnrollmentPasskey, EnrollmentKeyPreparation, EnrollmentAssertionPreparation } from './enrollment-port';

export type CustomerAccessBinding = CustomerIntentBinding & { attemptId: string };
export type CustomerSessionCandidate = { sessionId: string; sessionHash: string; sessionExpiresAt: number };
export type CustomerPasskeyLoginPreparation = {
  operationId: string; attemptId: string; expiresAt: number; origin: string; rpId: string; challenge: string;
};
export type CustomerPasskeyLoginClaim = CustomerPasskeyLoginPreparation & {
  userHandle: string; credential: EnrollmentPasskey;
};
export type CustomerAccessResult = {
  operationId: string; attemptId: string; expiresAt: number;
  state: 'unresolved' | 'failed' | 'approved' | 'closed' | 'expired'; session: CustomerSession | null;
};
export type CustomerRecoveryGrant = {
  operationId: string; attemptId: string; expiresAt: number;
  stage: 'registration_required' | 'assertion_required' | 'recovery_required'; recoveryVersion: number;
};
export type CustomerRecoveryAttemptResult = {
  operationId: string; attemptId: string; expiresAt: number;
} & ({ state: 'granted'; grant: CustomerRecoveryGrant } | { state: 'denied' | 'closed' | 'expired' | 'failed' });

/** Private ports, no browser account identity, clear code or provider budget. */
export interface CustomerProtectedAccessRepository {
  preparePasskeyLogin(input: CustomerAccessBinding & {
    sourceHash: string; origin: string; rpId: string; challenge: string;
  }): Promise<CustomerPasskeyLoginPreparation | null>;
  claimPasskeyLogin(input: CustomerAccessBinding & {
    requestHash: string; credentialId: string; userHandle: string;
  }): Promise<CustomerPasskeyLoginClaim | null>;
  completePasskeyLogin(input: CustomerAccessBinding & CustomerSessionCandidate & {
    requestHash: string;
    assertion: Pick<EnrollmentPasskey, 'credentialId' | 'counter' | 'deviceType' | 'backedUp'> | null;
  }): Promise<CustomerSession | null>;
  resultPasskeyLogin(input: CustomerAccessBinding & { sessionHash: string | null }): Promise<CustomerAccessResult | null>;
  beginAccountRecovery(input: CustomerAccessBinding & {
    sourceHash: string; requestHash: string; codeHash: string;
  }): Promise<CustomerRecoveryAttemptResult | null>;
  readAccountRecovery(input: CustomerAccessBinding): Promise<CustomerRecoveryAttemptResult | null>;
  prepareRecoveryKey(input: CustomerAccessBinding & Omit<EnrollmentKeyPreparation, 'expiresAt'>): Promise<EnrollmentKeyPreparation | null>;
  readRecoveryKey(input: CustomerAccessBinding & { registrationId: string }): Promise<EnrollmentKeyPreparation | null>;
  recordRecoveryKey(input: CustomerAccessBinding & { registrationId: string; requestHash: string; credential: EnrollmentPasskey }): Promise<CustomerRecoveryGrant | null>;
  prepareRecoveryAssertion(input: CustomerAccessBinding & { assertionId: string; origin: string; rpId: string; challenge: string }): Promise<EnrollmentAssertionPreparation | null>;
  readRecoveryAssertion(input: CustomerAccessBinding & { assertionId: string }): Promise<EnrollmentAssertionPreparation | null>;
  recordRecoveryAssertion(input: CustomerAccessBinding & {
    assertionId: string; requestHash: string; credentialId: string; counter: number;
    deviceType: EnrollmentPasskey['deviceType']; backedUp: boolean;
  }): Promise<CustomerRecoveryGrant | null>;
  issueRecoveryReplacement(input: CustomerAccessBinding & {
    rotationId: string; expectedVersion: number; codeHash: string;
  }): Promise<{ grant: CustomerRecoveryGrant; emitCode: boolean } | null>;
  activateAccountRecovery(input: CustomerAccessBinding & CustomerSessionCandidate & {
    activationId: string; requestHash: string; recoveryVersion: number; codeHash: string;
  }): Promise<CustomerSession | null>;
  recoverAccountRecoveryActivation(input: CustomerAccessBinding & { activationId: string; sessionHash: string }): Promise<CustomerSession | null>;
}
