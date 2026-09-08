import { describe, expect, it, vi } from 'vitest';
import { planPaidPilotPhoneVerification } from './paid-pilot-policy';

const now = Date.UTC(2026, 8, 8, 12);
const accountSid = `AC${'a'.repeat(32)}`;
const serviceSid = `VA${'b'.repeat(32)}`;
const tenantRef = 'tenant-pilot-fixture';
const phone = '+33600000001';
// Arbitrary micro-unit arithmetic fixtures, NOT provider prices or user approval.
function fixture() {
  const target = { accountSid, serviceSid, tenantRef };
  return {
    now,
    policy: {
      mode: 'closed_paid_pilot', environment: 'staging', ...target,
      allowedPhones: [phone], maxSendReservations: 10, expiresAt: now + 86_400_000,
      evidenceNotBefore: now - 120_000, costEvidenceReference: 'price-fixture',
      authorization: { kind: 'one_off', reference: 'owner-approval-fixture', authorizedBy: 'owner-fixture',
        ...target, currency: 'USD', authorizedSpendMicrousd: 1_010, authorizedAt: now - 120_000,
        expiresAt: now + 86_400_000, recurring: false },
    },
    evidence: {
      reference: 'provider-fixture', ...target, accountType: 'Full', accountStatus: 'active',
      smsEnabled: true, fraudGuardEnabled: true, codeLength: 6, maxTokenValiditySeconds: 600,
      maxSmsSegmentsPerSend: 2, observedAt: now - 60_000,
      costs: { reference: 'price-fixture', currency: 'USD', smsSegmentUpperBoundMicrousd: 31,
        successfulVerificationUpperBoundMicrousd: 8, allFeesIncluded: true,
        observedAt: now - 30_000, expiresAt: now + 86_400_000 },
    },
    request: { tenantRef, phone },
  };
}

describe('closed paid pilot planning — pure, never a send permission', () => {
  it('requires a worst-case reservation for all segments AND a successful verification', () => {
    expect(planPaidPilotPhoneVerification(fixture())).toEqual({
      kind: 'reservation_required', accountSid, serviceSid, tenantRef,
      evidenceReference: 'provider-fixture', costEvidenceReference: 'price-fixture', expiresAt: now + 840_000,
      limits: { maxSendReservations: 10, smsUnitsReservedPerSend: 2,
        paidBudget: { mode: 'paid', currency: 'USD', authorizationRef: 'owner-approval-fixture',
          authorizedSpendMicrousd: 1_010, reservePerSendMicrousd: 70, expiresAt: now + 86_400_000 }, cooldownMs: 60_000,
        windowMs: 86_400_000, globalSendReservations: 10, tenantSendReservations: 10,
        phoneSendReservations: 3, ipSendReservations: 5, challengeCheckAttempts: 5, challengeTtlMs: 600_000 },
    });
  });

  it.each([undefined, null, {}, { mode: 'closed_paid_pilot' }])('has no policy defaults: %j', policy => {
    expect(planPaidPilotPhoneVerification({ ...fixture(), policy })).toEqual({ kind: 'denied', reason: 'configuration' });
  });
  it.each([undefined, null, {}, { kind: 'one_off', currency: 'USD' }])('has no spending authorization defaults: %j', authorization => {
    const input = fixture();
    expect(planPaidPilotPhoneVerification({ ...input, policy: { ...input.policy, authorization } }).kind).toBe('denied');
  });
  it.each([
    { mode: 'closed_trial' }, { mode: 'active' }, { environment: 'production' }, { environment: 'development' },
    { expiresAt: now }, { expiresAt: now - 1 }, { evidenceNotBefore: now + 1 },
    { evidenceNotBefore: now }, { costEvidenceReference: 'unapproved-price' },
    { allowedPhones: [] }, { allowedPhones: [phone, phone] },
    { allowedPhones: Array.from({ length: 6 }, (_, i) => `+3360000000${i}`) },
    { allowedPhones: ['0600000001'] }, { allowedPhones: ['+33100000001'] }, { allowedPhones: ['+15005550006'] },
    { accountSid: `AC${'c'.repeat(32)}` }, { serviceSid: `VA${'d'.repeat(32)}` }, { tenantRef: 'other-owner-tenant' },
    { freeSmsUnitsRemaining: 100 }, { balance: 20 }, { recurring: true },
  ])('refuses stale, mismatched or mixed policy %j', patch => {
    const input = fixture();
    expect(planPaidPilotPhoneVerification({ ...input, policy: { ...input.policy, ...patch } }).kind).toBe('denied');
  });
  it.each([0, -1, 0.5, 51, NaN, Infinity, '10', undefined])('refuses send count %s', maxSendReservations => {
    const input = fixture();
    expect(planPaidPilotPhoneVerification({ ...input, policy: { ...input.policy, maxSendReservations } }).kind).toBe('denied');
  });
  it.each([
    { kind: 'monthly' }, { recurring: true }, { recurring: undefined }, { reference: '' }, { authorizedBy: '' },
    { currency: 'EUR' }, { currency: 'usd' }, { currency: undefined },
    { authorizedAt: now + 1 }, { authorizedAt: now + 0.5 }, { expiresAt: now },
    { accountSid: `AC${'c'.repeat(32)}` }, { serviceSid: `VA${'d'.repeat(32)}` }, { tenantRef: 'other-tenant' },
    { authorizedSpendMicrousd: undefined }, { authorizedSpendMicrousd: 0 }, { authorizedSpendMicrousd: -1 },
    { authorizedSpendMicrousd: 1.1 }, { authorizedSpendMicrousd: '1010' },
    { authorizedSpendMicrousd: Number.MAX_SAFE_INTEGER + 1 }, { authorizedSpendMicrousd: Infinity },
    { balance: 20 },
  ])('requires exact explicit one-off authority %j', patch => {
    const input = fixture();
    expect(planPaidPilotPhoneVerification({ ...input, policy: { ...input.policy,
      authorization: { ...input.policy.authorization, ...patch } } }).kind).toBe('denied');
  });
  it.each([undefined, null, {}, { accountType: 'Full' }])('has no provider evidence defaults: %j', evidence => {
    expect(planPaidPilotPhoneVerification({ ...fixture(), evidence })).toEqual({ kind: 'denied', reason: 'evidence' });
  });
  it.each([
    { accountType: 'Trial' }, { accountType: 'Active' }, { accountStatus: 'suspended' }, { accountStatus: 'closed' },
    { accountSid: `AC${'c'.repeat(32)}` }, { serviceSid: `VA${'d'.repeat(32)}` }, { tenantRef: 'other-tenant' },
    { smsEnabled: false }, { fraudGuardEnabled: false }, { codeLength: 4 }, { codeLength: '6' },
    { maxTokenValiditySeconds: undefined }, { maxTokenValiditySeconds: 0 }, { maxTokenValiditySeconds: 601 },
    { maxSmsSegmentsPerSend: 0 }, { maxSmsSegmentsPerSend: 11 }, { maxSmsSegmentsPerSend: 1.5 },
    { observedAt: now + 1 }, { observedAt: now - 900_000 }, { observedAt: now - 120_001 },
    { freeVerificationUnitsRemaining: 100 }, { trialExpiresAt: now + 60_000 },
  ])('refuses incomplete or foreign provider evidence %j', patch => {
    const input = fixture();
    expect(planPaidPilotPhoneVerification({ ...input, evidence: { ...input.evidence, ...patch } }).kind).toBe('denied');
  });
  it.each([
    { reference: 'different-price' }, { currency: 'EUR' }, { currency: 'usd' }, { allFeesIncluded: false }, { allFeesIncluded: undefined },
    { smsSegmentUpperBoundMicrousd: undefined }, { smsSegmentUpperBoundMicrousd: 0 }, { smsSegmentUpperBoundMicrousd: -1 },
    { smsSegmentUpperBoundMicrousd: 0.1 }, { smsSegmentUpperBoundMicrousd: '31' }, { smsSegmentUpperBoundMicrousd: NaN },
    { successfulVerificationUpperBoundMicrousd: undefined }, { successfulVerificationUpperBoundMicrousd: 0 },
    { successfulVerificationUpperBoundMicrousd: Infinity }, { successfulVerificationUpperBoundMicrousd: Number.MAX_SAFE_INTEGER + 1 },
    { observedAt: now + 1 }, { observedAt: now - 900_000 }, { observedAt: now - 120_001 }, { expiresAt: now },
    { freeUnits: 100 }, { ignoredSurcharge: 1 },
  ])('does not infer complete prices or USD conversion %j', patch => {
    const input = fixture();
    expect(planPaidPilotPhoneVerification({ ...input, evidence: { ...input.evidence,
      costs: { ...input.evidence.costs, ...patch } } }).kind).toBe('denied');
  });
  it.each([
    { tenantRef: 'other-tenant', phone }, { tenantRef, phone: '+33600000002' }, { tenantRef, phone: '06 00 00 00 01' },
    { tenantRef, phone, accountSid }, { tenantRef, phone, authorizedSpendMicrousd: 1_000_000 },
  ])('refuses public target/authority injection %j', request => {
    expect(planPaidPilotPhoneVerification({ ...fixture(), request })).toEqual({ kind: 'denied', reason: 'target' });
  });

  it.each([[69, 0], [70, 1], [139, 1], [140, 2], [210, 3], [1_010, 10]])('floors budget %i without a partial send', (budget, count) => {
    const input = fixture(); input.policy.authorization.authorizedSpendMicrousd = budget;
    const result = planPaidPilotPhoneVerification(input);
    expect(result).toMatchObject(count ? { kind: 'reservation_required', limits: { maxSendReservations: count } }
      : { kind: 'denied', reason: 'allowance' });
  });
  it('charges the full possible segmentation and successful fee for each reservation', () => {
    const input = fixture(); input.evidence.maxSmsSegmentsPerSend = 10;
    expect(planPaidPilotPhoneVerification(input)).toMatchObject({
      limits: { paidBudget: { reservePerSendMicrousd: 318 }, maxSendReservations: 3, smsUnitsReservedPerSend: 10 },
    });
  });
  it('rejects exact arithmetic overflow in both multiplication and addition', () => {
    const input = fixture(); input.policy.authorization.authorizedSpendMicrousd = Number.MAX_SAFE_INTEGER;
    input.evidence.costs.smsSegmentUpperBoundMicrousd = Number.MAX_SAFE_INTEGER;
    expect(planPaidPilotPhoneVerification(input).kind).toBe('denied');
    input.evidence.maxSmsSegmentsPerSend = 1;
    expect(planPaidPilotPhoneVerification(input).kind).toBe('denied');
  });
  it('accepts a safe exact upper-bound total, never silently rounding it', () => {
    const input = fixture(); input.policy.authorization.authorizedSpendMicrousd = Number.MAX_SAFE_INTEGER;
    input.evidence.maxSmsSegmentsPerSend = 1;
    input.evidence.costs.smsSegmentUpperBoundMicrousd = Number.MAX_SAFE_INTEGER - 8;
    expect(planPaidPilotPhoneVerification(input)).toMatchObject({
      limits: { paidBudget: { reservePerSendMicrousd: Number.MAX_SAFE_INTEGER }, maxSendReservations: 1 },
    });
  });
  it('caps at every independent expiry without refreshing authorization or evidence', () => {
    const input = fixture();
    input.policy.expiresAt = now + 3; input.policy.authorization.expiresAt = now + 2; input.evidence.costs.expiresAt = now + 1;
    expect(planPaidPilotPhoneVerification(input)).toMatchObject({ expiresAt: now + 1 });
    input.evidence.costs.expiresAt = now + 4;
    expect(planPaidPilotPhoneVerification(input)).toMatchObject({ expiresAt: now + 2 });
    input.policy.authorization.expiresAt = now + 4;
    expect(planPaidPilotPhoneVerification(input)).toMatchObject({ expiresAt: now + 3 });
  });
  it.each(['provider', 'costs'])('allows only the last millisecond of fresh %s evidence', field => {
    const input = fixture(); input.policy.evidenceNotBefore = now - 900_000;
    input.policy.authorization.authorizedAt = now - 900_000;
    const observed = field === 'provider' ? input.evidence : input.evidence.costs;
    observed.observedAt = now - 899_999;
    expect(planPaidPilotPhoneVerification(input)).toMatchObject({ expiresAt: now + 1 });
    observed.observedAt--;
    expect(planPaidPilotPhoneVerification(input)).toEqual({ kind: 'denied', reason: 'evidence' });
  });
  it('cannot move the evidence floor before the explicit authorization', () => {
    const input = fixture(); input.policy.evidenceNotBefore = input.policy.authorization.authorizedAt - 1;
    expect(planPaidPilotPhoneVerification(input)).toEqual({ kind: 'denied', reason: 'configuration' });
  });
  it('allows five explicit recipients and at most fifty lifetime sends, not fifty per recipient', () => {
    const input = fixture(); input.policy.allowedPhones = Array.from({ length: 5 }, (_, i) => `+3370000000${i}`);
    input.request.phone = input.policy.allowedPhones[4]!; input.policy.maxSendReservations = 50;
    input.policy.authorization.authorizedSpendMicrousd = 3_500;
    expect(planPaidPilotPhoneVerification(input)).toMatchObject({ limits: { maxSendReservations: 50,
      globalSendReservations: 10, phoneSendReservations: 3 } });
  });
  it.each([NaN, Infinity, -1, now + 0.5, Number.MAX_SAFE_INTEGER])('rejects unsafe caller clock %s', clock => {
    expect(planPaidPilotPhoneVerification({ ...fixture(), now: clock }).kind).toBe('denied');
  });
  it('is deterministic, immutable and does not disclose the recipient', () => {
    const input = fixture(); const before = structuredClone(input);
    Object.freeze(input.policy.allowedPhones); Object.freeze(input.policy.authorization); Object.freeze(input.policy);
    Object.freeze(input.evidence.costs); Object.freeze(input.evidence); Object.freeze(input.request); Object.freeze(input);
    const date = vi.spyOn(Date, 'now').mockImplementation(() => { throw new Error('No ambient clock'); });
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(() => { throw new Error('No provider'); });
    try {
      const result = planPaidPilotPhoneVerification(input);
      expect(result.kind).toBe('reservation_required');
      expect(planPaidPilotPhoneVerification(input)).toEqual(result); expect(input).toEqual(before);
      expect(JSON.stringify(result).includes(phone)).toBe(false);
      expect(JSON.stringify(result).includes('free')).toBe(false); expect(JSON.stringify(result).includes('trial')).toBe(false);
      expect(fetch).not.toHaveBeenCalled(); expect(date).not.toHaveBeenCalled();
    } finally { date.mockRestore(); fetch.mockRestore(); }
  });
});
