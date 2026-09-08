import { describe, expect, it } from 'vitest';
import { reservationSchema } from './validation';

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
