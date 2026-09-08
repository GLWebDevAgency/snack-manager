import { describe, expect, it } from 'vitest';
import { planTrialPhoneVerification } from './trial-verification-policy';

const now = Date.UTC(2026, 8, 8, 12);
const accountSid = `AC${'a'.repeat(32)}`;
const serviceSid = `VA${'b'.repeat(32)}`;
const phone = '+33600000001'; // Fixture only. No network in these tests.
const tenantRef = 'tenant-classfood-fixture';

function fixture() {
  return {
    now,
    policy: {
      mode: 'closed_trial',
      environment: 'staging',
      accountSid,
      serviceSid,
      tenantRef,
      allowedPhones: [phone],
      maxSendReservations: 10,
      expiresAt: now + 86_400_000,
    },
    evidence: {
      reference: 'trial-review-fixture-1',
      accountSid,
      accountType: 'Trial',
      accountStatus: 'active',
      serviceSid,
      smsEnabled: true,
      fraudGuardEnabled: true,
      codeLength: 6,
      maxTokenValiditySeconds: 600,
      verifiedPhones: [phone],
      freeSmsUnitsRemaining: 20,
      maxSmsSegmentsPerSend: 1,
      freeVerificationUnitsRemaining: 15,
      observedAt: now - 60_000,
      trialExpiresAt: now + 86_400_000,
    },
    request: { tenantRef, phone },
  };
}

describe('closed trial send planning (not a budget reservation)', () => {
  it('produces a bounded reservation plan, never a permission to send directly', () => {
    expect(planTrialPhoneVerification(fixture())).toEqual({
      kind: 'reservation_required',
      accountSid,
      serviceSid,
      tenantRef,
      evidenceReference: 'trial-review-fixture-1',
      expiresAt: now + 14 * 60_000,
      limits: {
        trialSendReservations: 10,
        freeSmsUnitsRemainingAtObservation: 20,
        smsUnitsReservedPerSend: 1,
        freeVerificationUnitsRemainingAtObservation: 15,
        cooldownMs: 60_000,
        windowMs: 86_400_000,
        globalSendReservations: 10,
        tenantSendReservations: 10,
        phoneSendReservations: 3,
        ipSendReservations: 5,
        challengeCheckAttempts: 5,
        challengeTtlMs: 600_000,
      },
    });
  });

  it.each([undefined, null, {}, { mode: 'disabled' }])('is closed without complete explicit policy: %j', (policy) => {
    expect(planTrialPhoneVerification({ ...fixture(), policy })).toEqual({ kind: 'denied', reason: 'configuration' });
  });

  it.each(['production', 'development', '', undefined])('does not admit environment %s', (environment) => {
    const input = fixture();
    expect(planTrialPhoneVerification({ ...input, policy: { ...input.policy, environment } }).kind).toBe('denied');
  });

  it.each([0, -1, 1.2, 51, Number.NaN, Infinity, '10'])('rejects unbounded or coerced trial cap %s', (maxSendReservations) => {
    const input = fixture();
    expect(planTrialPhoneVerification({ ...input, policy: { ...input.policy, maxSendReservations } }).kind).toBe('denied');
  });

  it.each([null, undefined, {}, { accountType: 'Trial' }])('fails closed on missing provider evidence %j', (evidence) => {
    expect(planTrialPhoneVerification({ ...fixture(), evidence })).toEqual({ kind: 'denied', reason: 'evidence' });
  });

  it.each([
    { accountType: 'Full' }, { accountStatus: 'suspended' },
    { accountSid: `AC${'c'.repeat(32)}` }, { serviceSid: `VA${'d'.repeat(32)}` },
    { smsEnabled: false }, { fraudGuardEnabled: false }, { codeLength: 4 },
    { maxTokenValiditySeconds: undefined }, { maxTokenValiditySeconds: 0 },
    { maxTokenValiditySeconds: 601 }, { maxTokenValiditySeconds: 60.5 },
    { freeSmsUnitsRemaining: null }, { freeVerificationUnitsRemaining: undefined },
    { freeSmsUnitsRemaining: -1 }, { freeSmsUnitsRemaining: 1.5 },
    { maxSmsSegmentsPerSend: undefined }, { maxSmsSegmentsPerSend: 0 },
    { maxSmsSegmentsPerSend: 1.5 }, { maxSmsSegmentsPerSend: 11 },
    { freeVerificationUnitsRemaining: Infinity },
    { observedAt: now + 1 }, { observedAt: now - 900_000 },
    { trialExpiresAt: now }, { trialExpiresAt: now - 1 },
  ])('rejects provider evidence that cannot attest the closed trial: %j', (patch) => {
    const input = fixture();
    expect(planTrialPhoneVerification({ ...input, evidence: { ...input.evidence, ...patch } }).kind).toBe('denied');
  });

  it.each([
    { expiresAt: now }, { expiresAt: now - 1 },
    { allowedPhones: [] }, { allowedPhones: [phone, phone] },
    { allowedPhones: Array.from({ length: 6 }, (_, i) => `+3360000000${i}`) },
    { allowedPhones: ['06 00 00 00 01'] }, { allowedPhones: ['+15005550006'] },
    { allowedPhones: ['+33100000001'] }, { accountSid: '../../evil' },
  ])('rejects expired/ambiguous policy %j', (patch) => {
    const input = fixture();
    expect(planTrialPhoneVerification({ ...input, policy: { ...input.policy, ...patch } }).kind).toBe('denied');
  });

  it('requires every configured recipient to have been verified, not only the current request', () => {
    const input = fixture();
    input.policy.allowedPhones.push('+33700000001');
    expect(planTrialPhoneVerification(input)).toEqual({ kind: 'denied', reason: 'evidence' });
  });

  it.each([{ tenantRef: 'another-tenant', phone }, { tenantRef, phone: '+33600000002' },
    { tenantRef, phone: '06 00 00 00 01' }, { tenantRef, phone, customerRef: 'injected' }])('refuses a request outside the explicit target %j', (request) => {
    expect(planTrialPhoneVerification({ ...fixture(), request })).toEqual({ kind: 'denied', reason: 'target' });
  });

  it.each([0, 1])('never treats free balance as a paid fallback, sms remaining %i', (freeSmsUnitsRemaining) => {
    const input = fixture();
    input.evidence.freeSmsUnitsRemaining = freeSmsUnitsRemaining;
    expect(planTrialPhoneVerification(input)).toEqual(freeSmsUnitsRemaining === 0
      ? { kind: 'denied', reason: 'allowance' }
      : expect.objectContaining({ kind: 'reservation_required', limits: expect.objectContaining({ trialSendReservations: 1 }) }));
  });

  it('reserves a verification allowance conservatively for each send too', () => {
    const input = fixture();
    input.evidence.freeVerificationUnitsRemaining = 2;
    expect(planTrialPhoneVerification(input)).toMatchObject({ kind: 'reservation_required', limits: { trialSendReservations: 2 } });
    input.evidence.freeVerificationUnitsRemaining = 0;
    expect(planTrialPhoneVerification(input)).toEqual({ kind: 'denied', reason: 'allowance' });
  });

  it('reserves every potential SMS segment, not merely one unit per OTP', () => {
    const input = fixture();
    input.evidence.maxSmsSegmentsPerSend = 3;
    expect(planTrialPhoneVerification(input)).toMatchObject({
      kind: 'reservation_required', limits: { trialSendReservations: 6, smsUnitsReservedPerSend: 3 },
    });
    input.evidence.freeSmsUnitsRemaining = 2;
    expect(planTrialPhoneVerification(input)).toEqual({ kind: 'denied', reason: 'allowance' });
  });

  it('expires at the earliest policy, provider or observation boundary', () => {
    const input = fixture();
    input.policy.expiresAt = now + 1;
    expect(planTrialPhoneVerification(input)).toMatchObject({ expiresAt: now + 1 });
    input.policy.expiresAt = now + 60_000;
    input.evidence.trialExpiresAt = now + 2;
    expect(planTrialPhoneVerification(input)).toMatchObject({ expiresAt: now + 2 });
  });

  it('does not mutate configuration/evidence and exposes no recipient in its decision', () => {
    const input = fixture();
    const before = structuredClone(input);
    const result = planTrialPhoneVerification(input);
    expect(input).toEqual(before);
    expect(JSON.stringify(result)).not.toContain(phone);
  });

  it.each(['policy', 'evidence'] as const)('does not accept undeclared fields in %s', (field) => {
    const input = fixture();
    expect(planTrialPhoneVerification({ ...input, [field]: { ...input[field], paidFallback: true } }).kind).toBe('denied');
  });

  it('requires distinct verified recipients and safe counts', () => {
    const input = fixture();
    input.evidence.verifiedPhones.push(phone);
    expect(planTrialPhoneVerification(input).kind).toBe('denied');
    input.evidence.verifiedPhones.pop();
    input.evidence.freeSmsUnitsRemaining = Number.MAX_SAFE_INTEGER + 1;
    expect(planTrialPhoneVerification(input).kind).toBe('denied');
  });

  it('allows the last millisecond of observation validity, not its boundary', () => {
    const input = fixture();
    input.evidence.observedAt = now - 899_999;
    expect(planTrialPhoneVerification(input)).toMatchObject({ kind: 'reservation_required', expiresAt: now + 1 });
    input.evidence.observedAt -= 1;
    expect(planTrialPhoneVerification(input)).toEqual({ kind: 'denied', reason: 'evidence' });
  });

  it.each([NaN, Infinity, -1, now + 0.5])('rejects an invalid clock %s', (clock) => {
    expect(planTrialPhoneVerification({ ...fixture(), now: clock }).kind).toBe('denied');
  });
});
