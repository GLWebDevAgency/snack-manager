import { z } from 'zod';

const minute = 60_000;
const day = 24 * 60 * minute;
const freshnessMs = 15 * minute;
const timestamp = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER - day);
const microusd = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const reference = z.string().regex(/^[a-zA-Z0-9_-]{1,120}$/);
const target = {
  accountSid: z.string().regex(/^AC[0-9a-fA-F]{32}$/),
  serviceSid: z.string().regex(/^VA[0-9a-fA-F]{32}$/),
  tenantRef: z.string().regex(/^[a-zA-Z0-9_-]{1,160}$/),
};
const phone = z.string().regex(/^\+33[67]\d{8}$/);
const policySchema = z.strictObject({
  mode: z.literal('closed_paid_pilot'), environment: z.literal('staging'), ...target,
  allowedPhones: z.array(phone).min(1).max(5).refine(values => new Set(values).size === values.length),
  maxSendReservations: z.number().int().min(1).max(50), expiresAt: timestamp,
  evidenceNotBefore: timestamp, costEvidenceReference: reference,
  authorization: z.strictObject({
    kind: z.literal('one_off'), reference, authorizedBy: reference, ...target,
    currency: z.literal('USD'), authorizedSpendMicrousd: microusd,
    authorizedAt: timestamp, expiresAt: timestamp, recurring: z.literal(false),
  }),
});
const evidenceSchema = z.strictObject({
  reference, ...target,
  // Official Account.type is Full after upgrade; Active is a Console label,
  // not this enum: https://www.twilio.com/docs/iam/api/account
  accountType: z.literal('Full'), accountStatus: z.literal('active'),
  smsEnabled: z.literal(true), fraudGuardEnabled: z.literal(true), codeLength: z.literal(6),
  maxTokenValiditySeconds: z.number().int().min(1).max(600),
  maxSmsSegmentsPerSend: z.number().int().min(1).max(10), observedAt: timestamp,
  costs: z.strictObject({
    reference, currency: z.literal('USD'), smsSegmentUpperBoundMicrousd: microusd,
    successfulVerificationUpperBoundMicrousd: microusd, allFeesIncluded: z.literal(true),
    observedAt: timestamp, expiresAt: timestamp,
  }),
});
const requestSchema = z.strictObject({ tenantRef: target.tenantRef, phone });

export type PaidPilotSendPlan =
  | { kind: 'denied'; reason: 'configuration' | 'evidence' | 'target' | 'allowance' }
  | {
      kind: 'reservation_required'; accountSid: string; serviceSid: string; tenantRef: string;
      evidenceReference: string; costEvidenceReference: string; expiresAt: number;
      limits: {
        maxSendReservations: number; smsUnitsReservedPerSend: number;
        paidBudget: {
          mode: 'paid'; authorizationRef: string; currency: 'USD';
          authorizedSpendMicrousd: number; reservePerSendMicrousd: number; expiresAt: number;
        };
        cooldownMs: number; windowMs: number; globalSendReservations: number;
        tenantSendReservations: number; phoneSendReservations: number; ipSendReservations: number;
        challengeCheckAttempts: number; challengeTtlMs: number;
      };
    };

/** PURE planning, never permission to call the provider without a durable reservation.
 * A trusted operator must supply the
 * actual one-off authorization and complete cost evidence, never browser input.
 * A balance, an account upgrade or an evidence refresh authorizes no spending.
 * allFeesIncluded must cover every possible charge in these upper bounds; if
 * that cannot be attested, this pilot stays closed. No tariff/default is inferred.
 *
 * The result is NOT a permission to send: real runtime/tenant/relay/human checks
 * and an atomic durable parent-account reservation are still mandatory. All
 * reservations, including uncertain sends, remain spent. Changing service,
 * authorization/evidence reference or restarting must never reset the ledger.
 */
export function planPaidPilotPhoneVerification(input: {
  policy: unknown; evidence: unknown; request: unknown; now: number;
}): PaidPilotSendPlan {
  const parsedPolicy = policySchema.safeParse(input.policy);
  if (!parsedPolicy.success || !timestamp.safeParse(input.now).success) {
    return { kind: 'denied', reason: 'configuration' };
  }
  const p = parsedPolicy.data;
  const a = p.authorization;
  if (p.expiresAt <= input.now || a.expiresAt <= input.now || a.authorizedAt > input.now
    || p.evidenceNotBefore > input.now || p.evidenceNotBefore < a.authorizedAt
    || a.accountSid !== p.accountSid || a.serviceSid !== p.serviceSid || a.tenantRef !== p.tenantRef) {
    return { kind: 'denied', reason: 'configuration' };
  }
  const parsedEvidence = evidenceSchema.safeParse(input.evidence);
  if (!parsedEvidence.success) return { kind: 'denied', reason: 'evidence' };
  const e = parsedEvidence.data;
  const c = e.costs;
  const fresh = (observedAt: number) => observedAt <= input.now && observedAt >= p.evidenceNotBefore
    && observedAt + freshnessMs > input.now;
  if (e.accountSid !== p.accountSid || e.serviceSid !== p.serviceSid || e.tenantRef !== p.tenantRef
    || c.reference !== p.costEvidenceReference || !fresh(e.observedAt) || !fresh(c.observedAt)
    || c.expiresAt <= input.now) return { kind: 'denied', reason: 'evidence' };
  const request = requestSchema.safeParse(input.request);
  if (!request.success || request.data.tenantRef !== p.tenantRef || !p.allowedPhones.includes(request.data.phone)) {
    return { kind: 'denied', reason: 'target' };
  }
  // Exact integer arithmetic: never round a segment cost, a sum or a budget up
  // into permission. Only JSON-safe integers cross the eventual repository port.
  const reserve = BigInt(c.smsSegmentUpperBoundMicrousd) * BigInt(e.maxSmsSegmentsPerSend)
    + BigInt(c.successfulVerificationUpperBoundMicrousd);
  if (reserve > BigInt(Number.MAX_SAFE_INTEGER)) return { kind: 'denied', reason: 'evidence' };
  const affordable = BigInt(a.authorizedSpendMicrousd) / reserve;
  const maxSendReservations = Number(affordable < BigInt(p.maxSendReservations) ? affordable : BigInt(p.maxSendReservations));
  if (maxSendReservations === 0) return { kind: 'denied', reason: 'allowance' };
  const budgetExpiresAt = Math.min(p.expiresAt, a.expiresAt);
  return {
    kind: 'reservation_required', accountSid: p.accountSid, serviceSid: p.serviceSid, tenantRef: p.tenantRef,
    evidenceReference: e.reference, costEvidenceReference: c.reference,
    expiresAt: Math.min(budgetExpiresAt, c.expiresAt, e.observedAt + freshnessMs, c.observedAt + freshnessMs),
    limits: {
      maxSendReservations, smsUnitsReservedPerSend: e.maxSmsSegmentsPerSend,
      paidBudget: { mode: 'paid', authorizationRef: a.reference, currency: 'USD',
        authorizedSpendMicrousd: a.authorizedSpendMicrousd, reservePerSendMicrousd: Number(reserve), expiresAt: budgetExpiresAt },
      cooldownMs: minute, windowMs: day, globalSendReservations: 10, tenantSendReservations: 10,
      phoneSendReservations: 3, ipSendReservations: 5, challengeCheckAttempts: 5, challengeTtlMs: 10 * minute,
    },
  };
}
