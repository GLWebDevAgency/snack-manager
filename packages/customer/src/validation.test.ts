import { describe, expect, it } from 'vitest';
import { reservationSchema, sessionSchema, nameSchema, revocationSchema } from './validation';

const common = { smsUnitsReservedPerSend: 1, cooldownMs: 60_000, windowMs: 86_400_000,
  globalSendReservations: 10, tenantSendReservations: 10, phoneSendReservations: 3,
  ipSendReservations: 5, challengeCheckAttempts: 5 };
const trial = { ...common, trialSendReservations: 50, freeSmsUnitsRemainingAtObservation: 1, freeVerificationUnitsRemainingAtObservation: 1 };
const paidBudget = { mode: 'paid', authorizationRef: 'fixture', costEvidenceReference: 'cost_fixture', currency: 'USD', authorizedSpendMicrousd: 1000,
  reservePerSendMicrousd: 600, expiresAt: 2_000_000_000_000 };
const paid = { ...common, maxSendReservations: 50, paidBudget };
describe('verification funding input boundaries', () => {
  const limits = reservationSchema.shape.limits;
  it('accepts the original Trial shape and a separate Paid shape without free credits', () => {
    expect(limits.safeParse(trial).success).toBe(true);
    expect(limits.safeParse(paid).success).toBe(true);
  });
  it.each([
    { ...trial, paidBudget }, { ...paid, freeSmsUnitsRemainingAtObservation: 1 },
    { ...paid, trialSendReservations: 50 }, { ...paid, paidBudget: { ...paidBudget, currency: 'EUR' } },
    { ...paid, paidBudget: { ...paidBudget, reservePerSendMicrousd: 0 } },
    { ...paid, paidBudget: { ...paidBudget, authorizedSpendMicrousd: Number.MAX_SAFE_INTEGER + 1 } },
    { ...paid, paidBudget: { ...paidBudget, reservePerSendMicrousd: 0.1 } },
    { ...paid, paidBudget: { ...paidBudget, secret: 'not-accepted' } },
    { ...paid, paidBudget: { ...paidBudget, costEvidenceReference: undefined } },
    { ...trial, freeSmsUnitsRemainingAtObservation: 0 },
  ])('rejects malformed or mixed funding, without stripping authorization fields', input => {
    expect(limits.safeParse(input).success).toBe(false);
  });
});

describe('browser credential input boundaries', () => {
  const common = { parentRef: 'fixture', tenantRef: 'tenant', sessionHash: 'a'.repeat(64), now: 1 };
  it.each([
    { schema: sessionSchema, input: common },
    { schema: nameSchema, input: { ...common, encryptedName: null, expectedRevision: 0 } },
    { schema: revocationSchema, input: { ...common, all: false } },
  ])('requires a canonical browser hash in addition to the session credential', ({ schema, input }) => {
    for (const browserHash of [undefined, null, '', 'B'.repeat(64), 'b'.repeat(63)]) {
      expect(schema.safeParse({ ...input, browserHash }).success).toBe(false);
    }
    expect(schema.safeParse({ ...input, browserHash: 'b'.repeat(64) }).success).toBe(true);
  });
});
