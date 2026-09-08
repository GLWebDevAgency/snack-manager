/** Private consumer identity, independent of staff users and loyalty cards.
 * All dates are server epoch milliseconds. No browser supplies a tenant, parent
 * account, verified phone, quota plan or account identity to this boundary. */
export type CustomerScope = { tenantRef: string; parentRef: string };
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
export interface CustomerIdentityRepository {
  reserve(input: VerificationReservation): Promise<ReservationResult>;
  settleSend(input: CustomerScope & {
    challengeId: string;
    verificationSid: string | null;
    now: number;
  }): Promise<PendingChallenge | null>;
  claimCheck(input: CheckClaim): Promise<PendingChallenge | null>;
  recoverCheck(input: CheckClaim & { sessionHash: string }): Promise<CustomerSession | null>;
  completeCheck(input: CheckClaim & {
    result: CheckResult;
    sessionId: string;
    sessionHash: string;
    sessionExpiresAt: number;
    accountId: string;
    /** Existing accounts need continuity proof, never a loyalty QR or just a
     * matching unverified/recycled phone. Null permits first enrollment only. */
    existingSessionHash: string | null;
  }): Promise<CustomerSession | null>;
  authenticate(input: CustomerScope & { sessionHash: string; browserHash: string; now: number }): Promise<CustomerSession | null>;
  updateName(input: CustomerScope & {
    sessionHash: string;
    browserHash: string;
    encryptedName: string | null;
    expectedRevision: number;
    now: number;
  }): Promise<CustomerSession | null>;
  revoke(input: CustomerScope & { sessionHash: string; browserHash: string; all: boolean; now: number }): Promise<void>;
}
