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

export type VerificationReservation = CustomerScope & {
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
  limits: {
    trialSendReservations: number;
    smsUnitsReservedPerSend: number;
    freeSmsUnitsRemainingAtObservation: number;
    freeVerificationUnitsRemainingAtObservation: number;
    cooldownMs: number;
    windowMs: number;
    globalSendReservations: number;
    tenantSendReservations: number;
    phoneSendReservations: number;
    ipSendReservations: number;
    challengeCheckAttempts: number;
  };
};
export type PendingChallenge = {
  challengeId: string;
  phoneHash: string;
  expiresAt: number;
  verificationSid: string;
  serviceSid: string;
  encryptedPhone: string;
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
  authenticate(input: CustomerScope & { sessionHash: string; now: number }): Promise<CustomerSession | null>;
  updateName(input: CustomerScope & {
    sessionHash: string;
    encryptedName: string | null;
    expectedRevision: number;
    now: number;
  }): Promise<CustomerSession | null>;
  revoke(input: CustomerScope & { sessionHash: string; all: boolean; now: number }): Promise<void>;
}
