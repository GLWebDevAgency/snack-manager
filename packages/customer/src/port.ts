import type { CustomerCheckCompletion, CustomerEnrollment, CustomerEnrollmentRepository } from './enrollment-port';
import type { CustomerProtectedAccessRepository } from './access-port';
/** Private consumer identity, independent of staff users and loyalty cards.
 * All dates are server epoch milliseconds. No browser supplies a tenant, parent
 * account, verified phone, quota plan or account identity to this boundary. */
export type CustomerScope = { tenantRef: string; parentRef: string };
export type CustomerBrowserPreparation = {
  browserRef: string;
  state: 'prepared' | 'issued' | 'confirmed' | 'expired';
  admissionExpiresAt: number;
  expiresAt: number;
};
export type CustomerBrowserBinding = CustomerScope & { browserRef: string; browserHash: string };
export type CustomerSessionSelection = { expectedOperationId: string; expectedCheckId: string };
export type CustomerVerificationIntent = {
  operationId: string;
  state: 'open' | 'closed' | 'consumed' | 'expired';
  expiresAt: number;
};
export type CustomerIntentBinding = CustomerBrowserBinding & { operationId: string; proofHash: string };
type IntentResultBase = { operationId: string; checkId: string | null; challengeId: string | null; expiresAt: number };
export type CustomerIntentResult = IntentResultBase & (
  | { state: 'unresolved' | 'code_required' | 'incorrect' | 'closed' | 'expired' | 'failed' }
  | { state: 'approved'; session: CustomerSession | null }
  | { state: 'enrollment'; enrollment: CustomerEnrollment }
);
export type CustomerProfile = {
  accountId: string;
  phoneHash: string;
  encryptedName: string | null;
  encryptedPhone: string;
  phoneVerifiedAt: number;
  revision: number;
};
export type CustomerSession = {
  sessionId: string;
  expiresAt: number;
  profile: CustomerProfile;
};

export type VerificationLimits = {
  smsUnitsReservedPerSend: number;
  cooldownMs: number;
  windowMs: number;
  globalSendReservations: number;
  tenantSendReservations: number;
  phoneSendReservations: number;
  ipSendReservations: number;
  challengeCheckAttempts: number;
};
export type TrialVerificationLimits = VerificationLimits & {
  trialSendReservations: number;
  freeSmsUnitsRemainingAtObservation: number;
  freeVerificationUnitsRemainingAtObservation: number;
};
export type PaidVerificationLimits = VerificationLimits & {
  maxSendReservations: number;
  paidBudget: {
    mode: 'paid'; authorizationRef: string; costEvidenceReference: string; currency: 'USD';
    authorizedSpendMicrousd: number; reservePerSendMicrousd: number; expiresAt: number;
  };
};
type ReservationIdentity = CustomerScope & {
  proofHash: string;
  browserRef: string;
  operationId: string;
  requestHash: string;
  challengeId: string;
  browserHash: string;
  phoneHash: string;
  globalPhoneHash: string;
  ipHash: string;
  encryptedPhone: string;
  serviceSid: string;
  evidenceReference: string;
  planExpiresAt: number;
  expiresAt: number;
  now: number;
};
export type TrialVerificationReservation = ReservationIdentity & { limits: TrialVerificationLimits };
export type PaidVerificationReservation = ReservationIdentity & { limits: PaidVerificationLimits };
export type VerificationReservation = ReservationIdentity & { limits: TrialVerificationLimits | PaidVerificationLimits };
export type VerificationFunding = { mode: 'trial' } | {
  mode: 'paid'; authorizationRef: string; currency: 'USD'; reservedMicrousd: number; expiresAt: number;
};
export type PendingChallenge = {
  challengeId: string;
  phoneHash: string;
  expiresAt: number;
  verificationSid: string;
  serviceSid: string;
  encryptedPhone: string;
  /** Immutable original reservation, never inferred from the current mode. */
  funding: VerificationFunding;
};

export type ReservationResult =
  | { kind: 'reserved'; challengeId: string }
  | { kind: 'pending'; challenge: PendingChallenge }
  | { kind: 'denied' | 'uncertain' };

export type CheckClaim = CustomerScope & {
  operationId: string;
  proofHash: string;
  requestHash: string;
  browserRef: string;
  challengeId: string;
  browserHash: string;
  checkId: string;
  now: number;
};
export type CheckResult = 'approved' | 'pending' | 'expired' | 'locked' | 'uncertain';

/** Transactions, row/advisory locks and constraints implement these operations.
 * Every successful reservation remains spent, including a failed/lost send.
 * Check claims must be single-flight: expired leases NEVER re-execute a remote
 * check whose outcome may have been approved. No raw token, OTP or phone here. */
export interface CustomerIdentityRepository extends CustomerEnrollmentRepository, CustomerProtectedAccessRepository {
  prepareBrowser(input: CustomerScope & { browserRef: string }): Promise<CustomerBrowserPreparation | null>;
  issueBrowser(input: CustomerBrowserBinding & { currentBrowserHash: string | null }): Promise<{
    preparation: CustomerBrowserPreparation; emitCookie: boolean;
  } | null>;
  confirmBrowser(input: CustomerBrowserBinding): Promise<CustomerBrowserPreparation | null>;
  validateBrowser(input: CustomerBrowserBinding): Promise<{ expiresAt: number } | null>;
  /** Read the confirmed browser selected by its cookie; no session authority or TTL renewal. */
  restoreBrowser(input: CustomerScope & { browserHash: string }): Promise<CustomerBrowserPreparation | null>;
  prepareIntent(input: CustomerIntentBinding): Promise<{ intent: CustomerVerificationIntent; emitCookie: boolean } | null>;
  closeIntent(input: CustomerBrowserBinding & { operationId: string }): Promise<CustomerVerificationIntent | null>;
  validateIntent(input: CustomerIntentBinding): Promise<{ expiresAt: number } | null>;
  resultIntent(input: CustomerIntentBinding & { checkId: string | null; sessionHash: string | null }): Promise<CustomerIntentResult | null>;
  reserve(input: VerificationReservation): Promise<ReservationResult>;
  settleSend(input: CustomerScope & {
    challengeId: string;
    verificationSid: string | null;
    now: number;
  }): Promise<PendingChallenge | null>;
  claimCheck(input: CheckClaim): Promise<PendingChallenge | null>;
  recoverCheck(input: CheckClaim & { sessionHash: string }): Promise<CustomerCheckCompletion | null>;
  completeCheck(input: CheckClaim & {
    result: CheckResult;
    sessionId: string;
    sessionHash: string;
    sessionExpiresAt: number;
    accountId: string;
    /** Existing accounts need continuity proof, never a loyalty QR or just a
     * matching unverified/recycled phone. Null permits first enrollment only. */
    existingSessionHash: string | null;
  }): Promise<CustomerCheckCompletion | null>;
  authenticate(input: CustomerBrowserBinding & CustomerSessionSelection & { sessionHash: string; now: number }): Promise<CustomerSession | null>;
  /** Internal principal only; historical phone-only sessions do not qualify. */
  authenticateProtected(input: CustomerBrowserBinding & CustomerSessionSelection & { sessionHash: string; now: number }): Promise<{
    accountId: string; sessionId: string; expiresAt: number;
  } | null>;
  updateName(input: CustomerScope & CustomerSessionSelection & {
    browserRef: string;
    sessionHash: string;
    browserHash: string;
    encryptedName: string | null;
    expectedRevision: number;
    now: number;
  }): Promise<CustomerSession | null>;
  revoke(input: CustomerBrowserBinding & CustomerSessionSelection & { sessionHash: string; all: boolean; now: number }): Promise<void>;
}
