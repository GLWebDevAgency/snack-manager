import { z } from 'zod';
import type { VerificationLimits } from '@sm/customer';

const minute = 60_000;
const day = 24 * 60 * minute;
export const PRODUCTION_OBSERVATION_MAX_AGE_MS = 15 * minute;
export const PRODUCTION_ATTESTATION_MAX_AGE_MS = 7 * day;
const timestamp = z.number().int().nonnegative().max(8_640_000_000_000_000 - PRODUCTION_ATTESTATION_MAX_AGE_MS);
const microusd = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const reference = z.string().regex(/^[a-zA-Z0-9_-]{1,120}$/);
const fingerprint = z.string().regex(/^[a-f0-9]{64}$/);
const scope = {
  accountSid: z.string().regex(/^AC[0-9a-fA-F]{32}$/),
  serviceSid: z.string().regex(/^VA[0-9a-fA-F]{32}$/),
  tenantRef: z.string().regex(/^[a-zA-Z0-9_-]{1,160}$/),
};

/** Deployment/anti-abuse policy only. The authorization reference selects a
 * separately funded SQL authorization; no configuration value grants money. */
export const ProductionVerificationPolicySchema = z.strictObject({
  mode: z.literal('production_paid'), environment: z.enum(['staging', 'production']), ...scope,
  authorizationRef: reference, costEvidenceReference: reference,
  evidenceNotBefore: timestamp, expiresAt: timestamp,
  globalSendReservations: z.number().int().min(1).max(100_000),
  tenantSendReservations: z.number().int().min(1).max(100_000),
  ipSendReservations: z.number().int().min(1).max(1000),
});

/** The runtime observer obtains account/service facts via authenticated reads.
 * These fields deliberately do not claim SMS, Fraud Guard or token validity:
 * the Verify Service response does not establish those safeguards. */
export const ProductionServerObservationSchema = z.strictObject({
  reference, ...scope, accountType: z.literal('Full'), accountStatus: z.literal('active'),
  codeLength: z.literal(6), observedAt: timestamp, settingsFingerprint: fingerprint,
});
const safeguards = z.strictObject({
  reference, ...scope, smsEnabled: z.literal(true), fraudGuardEnabled: z.literal(true),
  maxTokenValiditySeconds: z.number().int().min(1).max(600),
  maxSmsSegmentsPerSend: z.number().int().min(1).max(10), settingsFingerprint: fingerprint,
  attestedAt: timestamp, expiresAt: timestamp,
});
const costs = z.strictObject({
  reference, ...scope, currency: z.literal('USD'), smsSegmentUpperBoundMicrousd: microusd,
  successfulVerificationUpperBoundMicrousd: microusd, allFeesIncluded: z.literal(true),
  attestedAt: timestamp, expiresAt: timestamp,
});
export const ProductionVerificationEvidenceSchema = z.strictObject({ serverObservation: ProductionServerObservationSchema, safeguards, costs });
export type ProductionVerificationPolicy = z.infer<typeof ProductionVerificationPolicySchema>;
export type ProductionVerificationEvidence = z.infer<typeof ProductionVerificationEvidenceSchema>;

export type ProductionSendPlan =
  | { kind: 'denied'; reason: 'configuration' | 'evidence' | 'target' }
  | {
      kind: 'reservation_required'; accountSid: string; serviceSid: string; tenantRef: string;
      evidenceReference: string; costEvidenceReference: string; expiresAt: number;
      limits: VerificationLimits & {
        productionBudget: { mode: 'production_paid'; authorizationRef: string; costEvidenceReference: string;
          currency: 'USD'; reservePerSendMicrousd: number };
        challengeTtlMs: number;
      };
    };

/** PURE plan, not a provider permission, evidence collector or funding grant.
 *
 * The server must obtain the technical observation independently of public
 * input/config JSON, after validating authenticated account/service responses.
 * A timestamp or a literal provenance label cannot prove such a read. The
 * observation may be refreshed automatically; operator attestations may not.
 * A failed refresh never extends observedAt or any attestation deadline.
 *
 * Fingerprint changes close the plan until the operator reviews safeguards.
 * Cost/safeguard attestations cover at most seven days. Their bounded validity
 * is independent of the separately funded, revocable SQL authorization.
 * Every send still needs fresh runtime/tenant/human checks and an atomic SQL
 * reservation; every check retains its original funding receipt. Refreshing
 * observations, references or config never resets spending or quota counters.
 */
export function planProductionPhoneVerification(input: {
  policy: unknown; evidence: unknown; request: unknown; now: number;
}): ProductionSendPlan {
  const policy = ProductionVerificationPolicySchema.safeParse(input.policy);
  if (!policy.success || !timestamp.safeParse(input.now).success
    || policy.data.expiresAt <= input.now || policy.data.evidenceNotBefore > input.now) {
    return { kind: 'denied', reason: 'configuration' };
  }
  const evidence = ProductionVerificationEvidenceSchema.safeParse(input.evidence);
  if (!evidence.success) return { kind: 'denied', reason: 'evidence' };
  const p = policy.data;
  const { serverObservation: o, safeguards: s, costs: c } = evidence.data;
  const sameScope = (value: z.infer<typeof ProductionServerObservationSchema> | z.infer<typeof safeguards> | z.infer<typeof costs>) =>
    value.accountSid === p.accountSid && value.serviceSid === p.serviceSid && value.tenantRef === p.tenantRef;
  const validAttestation = (value: { attestedAt: number; expiresAt: number }) => value.attestedAt <= input.now
    && value.expiresAt > input.now && value.expiresAt <= value.attestedAt + PRODUCTION_ATTESTATION_MAX_AGE_MS;
  if (![o, s, c].every(sameScope) || o.observedAt > input.now || o.observedAt < p.evidenceNotBefore
    || o.observedAt + PRODUCTION_OBSERVATION_MAX_AGE_MS <= input.now
    || !validAttestation(s) || !validAttestation(c)
    || o.settingsFingerprint !== s.settingsFingerprint || c.reference !== p.costEvidenceReference) {
    return { kind: 'denied', reason: 'evidence' };
  }
  const request = z.strictObject({ tenantRef: scope.tenantRef, phone: z.string().regex(/^\+33[67]\d{8}$/) }).safeParse(input.request);
  if (!request.success || request.data.tenantRef !== p.tenantRef) return { kind: 'denied', reason: 'target' };
  const reserve = BigInt(c.smsSegmentUpperBoundMicrousd) * BigInt(s.maxSmsSegmentsPerSend)
    + BigInt(c.successfulVerificationUpperBoundMicrousd);
  if (reserve > BigInt(Number.MAX_SAFE_INTEGER)) return { kind: 'denied', reason: 'evidence' };
  return {
    kind: 'reservation_required', accountSid: p.accountSid, serviceSid: p.serviceSid, tenantRef: p.tenantRef,
    evidenceReference: o.reference, costEvidenceReference: c.reference,
    expiresAt: Math.min(p.expiresAt, o.observedAt + PRODUCTION_OBSERVATION_MAX_AGE_MS, s.expiresAt, c.expiresAt),
    limits: {
      productionBudget: { mode: 'production_paid', authorizationRef: p.authorizationRef,
        costEvidenceReference: c.reference, currency: 'USD', reservePerSendMicrousd: Number(reserve) },
      smsUnitsReservedPerSend: s.maxSmsSegmentsPerSend, cooldownMs: minute, windowMs: day,
      globalSendReservations: p.globalSendReservations, tenantSendReservations: p.tenantSendReservations,
      phoneSendReservations: 3, ipSendReservations: p.ipSendReservations, challengeCheckAttempts: 5, challengeTtlMs: 10 * minute,
    },
  };
}
