import { describe, expect, it, vi } from 'vitest';
import { planProductionPhoneVerification, PRODUCTION_ATTESTATION_MAX_AGE_MS,
  PRODUCTION_OBSERVATION_MAX_AGE_MS, ProductionVerificationEvidenceSchema, ProductionVerificationPolicySchema } from './production-verification-policy';

const now = Date.UTC(2026, 8, 12, 12);
const day = 86_400_000;
const accountSid = `AC${'a'.repeat(32)}`;
const serviceSid = `VA${'b'.repeat(32)}`;
const tenantRef = 'production-policy-fixture';
const settingsFingerprint = 'c'.repeat(64);
// Synthetic arithmetic, not provider tariffs, funded credit or operator approval.
function fixture() {
  const scope = { accountSid, serviceSid, tenantRef };
  return {
    now,
    policy: { mode: 'production_paid', environment: 'production', ...scope,
      authorizationRef: 'sql-authorization-fixture', costEvidenceReference: 'cost-fixture',
      evidenceNotBefore: now - 3_600_000, expiresAt: now + 30 * day,
      globalSendReservations: 1000, tenantSendReservations: 500, ipSendReservations: 50 },
    evidence: {
      serverObservation: { reference: 'account-service-read-fixture', ...scope, accountType: 'Full',
        accountStatus: 'active', codeLength: 6, observedAt: now - 60_000, settingsFingerprint },
      safeguards: { reference: 'safeguards-fixture', ...scope, smsEnabled: true, fraudGuardEnabled: true,
        maxTokenValiditySeconds: 600, maxSmsSegmentsPerSend: 2, settingsFingerprint,
        attestedAt: now - 3 * day, expiresAt: now + 4 * day },
      costs: { reference: 'cost-fixture', ...scope, currency: 'USD', smsSegmentUpperBoundMicrousd: 31,
        successfulVerificationUpperBoundMicrousd: 8, allFeesIncluded: true,
        attestedAt: now - 3 * day, expiresAt: now + 4 * day },
    },
    request: { tenantRef, phone: '+33600000001' },
  };
}

describe('production paid verification — pure observation and SQL funding reference', () => {
  it('requires the complete worst-case reservation without granting any funding or lifetime send allowance', () => {
    expect(planProductionPhoneVerification(fixture())).toEqual({
      kind: 'reservation_required', accountSid, serviceSid, tenantRef,
      evidenceReference: 'account-service-read-fixture', costEvidenceReference: 'cost-fixture', expiresAt: now + 840_000,
      limits: { productionBudget: { mode: 'production_paid', authorizationRef: 'sql-authorization-fixture',
        costEvidenceReference: 'cost-fixture', currency: 'USD', reservePerSendMicrousd: 70 },
      smsUnitsReservedPerSend: 2, cooldownMs: 60_000, windowMs: day, globalSendReservations: 1000,
      tenantSendReservations: 500, phoneSendReservations: 3, ipSendReservations: 50, challengeCheckAttempts: 5, challengeTtlMs: 600_000 },
    });
  });

  it.each([1, 50, 1000])('uses the explicit production IP ceiling %s without relaxing phone, cooldown or funding requirements', ipSendReservations => {
    const input = fixture(); input.policy.ipSendReservations = ipSendReservations;
    expect(planProductionPhoneVerification(input)).toMatchObject({ kind: 'reservation_required', limits: {
      ipSendReservations, phoneSendReservations: 3, cooldownMs: 60_000, windowMs: day,
      productionBudget: { mode: 'production_paid', reservePerSendMicrousd: 70 },
    } });
  });

  it.each(['staging', 'production'])('requires an explicit supported %s policy target; actual deployment remains a runtime check', environment => {
    const input = fixture(); input.policy.environment = environment;
    expect(planProductionPhoneVerification(input).kind).toBe('reservation_required');
  });

  it.each([null, undefined, {}, { mode: 'production_paid' }])('has no configuration defaults (%#)', policy => {
    expect(planProductionPhoneVerification({ ...fixture(), policy })).toEqual({ kind: 'denied', reason: 'configuration' });
  });
  it.each([
    { mode: 'closed_paid_pilot' }, { environment: 'development' }, { environment: undefined },
    { authorizationRef: undefined }, { authorizationRef: '' }, { costEvidenceReference: undefined },
    { evidenceNotBefore: now + 1 }, { expiresAt: now }, { expiresAt: now - 1 },
    { globalSendReservations: 0 }, { globalSendReservations: 100_001 }, { globalSendReservations: 1.5 },
    { tenantSendReservations: 0 }, { tenantSendReservations: 100_001 }, { tenantSendReservations: '500' },
    { ipSendReservations: undefined }, { ipSendReservations: 0 }, { ipSendReservations: 1001 },
    { ipSendReservations: 1.5 }, { ipSendReservations: '50' }, { ipSendReservations: null },
    { allowedPhones: ['+33600000001'] }, { authorizedSpendMicrousd: 1_000_000 },
    { authorization: { amount: 1_000_000 } }, { balance: 1_000_000 }, { maxSendReservations: 50 },
    { cooldownMs: 1 }, { source: 'operator' },
  ])('refuses missing/unsafe policy fields and monetary authority injection (%#)', patch => {
    const input = fixture();
    expect(planProductionPhoneVerification({ ...input, policy: { ...input.policy, ...patch } }))
      .toEqual({ kind: 'denied', reason: 'configuration' });
  });

  it.each([null, undefined, {}, { observedAt: now }, { source: 'server', observedAt: now }])('does not manufacture provider proof from an envelope or timestamp (%#)', evidence => {
    expect(planProductionPhoneVerification({ ...fixture(), evidence })).toEqual({ kind: 'denied', reason: 'evidence' });
  });
  it.each([
    { accountType: 'Trial' }, { accountStatus: 'suspended' }, { codeLength: 4 },
    { observedAt: now + 1 }, { observedAt: now - 900_000 }, { observedAt: now - 3_600_001 },
    { settingsFingerprint: 'INVALID' }, { settingsFingerprint: 'd'.repeat(64) },
    { smsEnabled: true }, { fraudGuardEnabled: true }, { maxTokenValiditySeconds: 600 }, { source: 'server' },
  ])('rejects incomplete, mismatched or stale technical observations (%#)', patch => {
    const input = fixture();
    expect(planProductionPhoneVerification({ ...input, evidence: { ...input.evidence,
      serverObservation: { ...input.evidence.serverObservation, ...patch } } }))
      .toEqual({ kind: 'denied', reason: 'evidence' });
  });

  it.each([
    { smsEnabled: undefined }, { smsEnabled: false }, { fraudGuardEnabled: false },
    { maxTokenValiditySeconds: 0 }, { maxTokenValiditySeconds: 601 }, { maxTokenValiditySeconds: 1.5 },
    { maxSmsSegmentsPerSend: 0 }, { maxSmsSegmentsPerSend: 11 }, { maxSmsSegmentsPerSend: '2' },
    { settingsFingerprint: 'd'.repeat(64) }, { attestedAt: now + 1 }, { expiresAt: now },
    { attestedAt: now - 3 * day - 1 }, { availableCredit: 1000 },
  ])('requires independently valid safeguards rather than inferring them from six digits (%#)', patch => {
    const input = fixture();
    expect(planProductionPhoneVerification({ ...input, evidence: { ...input.evidence,
      safeguards: { ...input.evidence.safeguards, ...patch } } }))
      .toEqual({ kind: 'denied', reason: 'evidence' });
  });

  it.each([
    { reference: 'other-cost' }, { currency: 'EUR' }, { allFeesIncluded: false }, { allFeesIncluded: undefined },
    { smsSegmentUpperBoundMicrousd: 0 }, { smsSegmentUpperBoundMicrousd: -1 }, { smsSegmentUpperBoundMicrousd: 0.1 },
    { smsSegmentUpperBoundMicrousd: '31' }, { smsSegmentUpperBoundMicrousd: NaN },
    { successfulVerificationUpperBoundMicrousd: undefined }, { successfulVerificationUpperBoundMicrousd: 0 },
    { successfulVerificationUpperBoundMicrousd: Infinity }, { successfulVerificationUpperBoundMicrousd: Number.MAX_SAFE_INTEGER + 1 },
    { attestedAt: now + 1 }, { expiresAt: now }, { attestedAt: now - 3 * day - 1 },
    { authorizedSpendMicrousd: 1_000_000 }, { grant: true },
  ])('requires complete current cost bounds without granting a budget (%#)', patch => {
    const input = fixture();
    expect(planProductionPhoneVerification({ ...input, evidence: { ...input.evidence,
      costs: { ...input.evidence.costs, ...patch } } })).toEqual({ kind: 'denied', reason: 'evidence' });
  });

  it.each(['serverObservation', 'safeguards', 'costs'] as const)('pins all account/service/tenant scopes in %s', section => {
    for (const patch of [{ accountSid: `AC${'d'.repeat(32)}` }, { serviceSid: `VA${'e'.repeat(32)}` }, { tenantRef: 'foreign-tenant' }]) {
      const input = fixture();
      expect(planProductionPhoneVerification({ ...input, evidence: { ...input.evidence,
        [section]: { ...input.evidence[section], ...patch } } })).toEqual({ kind: 'denied', reason: 'evidence' });
    }
  });

  it('permits all normalized French mobile recipients without a pilot allowlist', () => {
    for (const phone of ['+33600000001', '+33699999999', '+33700000001', '+33799999999']) {
      const input = fixture(); input.request.phone = phone;
      const result = planProductionPhoneVerification(input);
      expect(result.kind).toBe('reservation_required');
      expect(JSON.stringify(result)).not.toContain(phone);
    }
  });
  it.each([
    { tenantRef, phone: '+33100000001' }, { tenantRef, phone: '+447000000001' },
    { tenantRef, phone: '06 00 00 00 01' }, { tenantRef, phone: '+336000000010' },
    { tenantRef: 'other-tenant', phone: '+33600000001' },
    { tenantRef, phone: '+33600000001', authorizationRef: 'public-grant' },
    { tenantRef, phone: '+33600000001', environment: 'production' },
  ])('does not normalize countries, widen the target or accept public funding fields (%#)', request => {
    expect(planProductionPhoneVerification({ ...fixture(), request })).toEqual({ kind: 'denied', reason: 'target' });
  });

  it('bounds the observation to exactly fifteen minutes, independently of old but valid attestations', () => {
    const input = fixture(); input.evidence.serverObservation.observedAt = now - PRODUCTION_OBSERVATION_MAX_AGE_MS + 1;
    expect(planProductionPhoneVerification(input)).toMatchObject({ kind: 'reservation_required', expiresAt: now + 1 });
    input.evidence.serverObservation.observedAt--;
    expect(planProductionPhoneVerification(input)).toEqual({ kind: 'denied', reason: 'evidence' });
  });
  it.each(['safeguards', 'costs'] as const)('accepts only the bounded remaining validity of %s', section => {
    const input = fixture(); const value = input.evidence[section];
    value.attestedAt = now - PRODUCTION_ATTESTATION_MAX_AGE_MS + 1; value.expiresAt = now + 1;
    expect(planProductionPhoneVerification(input)).toMatchObject({ kind: 'reservation_required', expiresAt: now + 1 });
    value.expiresAt++;
    expect(planProductionPhoneVerification(input)).toEqual({ kind: 'denied', reason: 'evidence' });
    value.attestedAt = now - PRODUCTION_ATTESTATION_MAX_AGE_MS; value.expiresAt = now;
    expect(planProductionPhoneVerification(input)).toEqual({ kind: 'denied', reason: 'evidence' });
  });

  it('a technical refresh preserves the financial reference and cannot revive expired safeguards or costs', () => {
    const input = fixture(); const before = planProductionPhoneVerification(input);
    input.evidence.serverObservation.observedAt = now;
    input.evidence.serverObservation.reference = 'fresh-read-fixture';
    const after = planProductionPhoneVerification(input);
    expect(before.kind).toBe('reservation_required'); expect(after.kind).toBe('reservation_required');
    if (before.kind !== 'reservation_required' || after.kind !== 'reservation_required') throw new Error('Fixture should reserve');
    expect(after.limits.productionBudget).toEqual(before.limits.productionBudget);
    expect(after.expiresAt).toBe(now + PRODUCTION_OBSERVATION_MAX_AGE_MS);
    input.evidence.safeguards.expiresAt = now;
    expect(planProductionPhoneVerification(input).kind).toBe('denied');
    input.evidence.safeguards.expiresAt = now + 4 * day; input.evidence.costs.expiresAt = now;
    expect(planProductionPhoneVerification(input).kind).toBe('denied');
  });

  it('expires at the first independently expiring policy, observation, safeguard or cost', () => {
    const input = fixture(); input.policy.expiresAt = now + 3;
    input.evidence.safeguards.expiresAt = now + 2; input.evidence.costs.expiresAt = now + 1;
    expect(planProductionPhoneVerification(input)).toMatchObject({ expiresAt: now + 1 });
    input.evidence.costs.expiresAt = now + 4;
    expect(planProductionPhoneVerification(input)).toMatchObject({ expiresAt: now + 2 });
    input.evidence.safeguards.expiresAt = now + 4;
    expect(planProductionPhoneVerification(input)).toMatchObject({ expiresAt: now + 3 });
  });

  it('uses exact integer arithmetic for every possible SMS segment plus the successful verification fee', () => {
    const input = fixture(); input.evidence.safeguards.maxSmsSegmentsPerSend = 10;
    expect(planProductionPhoneVerification(input)).toMatchObject({ limits: { productionBudget: { reservePerSendMicrousd: 318 } } });
    input.evidence.costs.smsSegmentUpperBoundMicrousd = Number.MAX_SAFE_INTEGER;
    expect(planProductionPhoneVerification(input).kind).toBe('denied');
    input.evidence.safeguards.maxSmsSegmentsPerSend = 1;
    expect(planProductionPhoneVerification(input).kind).toBe('denied');
    input.evidence.costs.smsSegmentUpperBoundMicrousd = Number.MAX_SAFE_INTEGER - 8;
    expect(planProductionPhoneVerification(input)).toMatchObject({ limits: { productionBudget: { reservePerSendMicrousd: Number.MAX_SAFE_INTEGER } } });
  });

  it.each([NaN, Infinity, -1, now + 0.5, Number.MAX_SAFE_INTEGER])('rejects unsafe server time (%#)', clock => {
    expect(planProductionPhoneVerification({ ...fixture(), now: clock })).toEqual({ kind: 'denied', reason: 'configuration' });
  });
  it('exports the same strict schemas used by the planner', () => {
    const input = fixture();
    expect(ProductionVerificationPolicySchema.safeParse(input.policy).success).toBe(true);
    expect(ProductionVerificationEvidenceSchema.safeParse(input.evidence).success).toBe(true);
    expect(ProductionVerificationEvidenceSchema.safeParse({ ...input.evidence, source: 'server' }).success).toBe(false);
  });
  it('is immutable, deterministic and reads neither an ambient clock nor a provider', () => {
    const input = fixture(); const before = structuredClone(input);
    for (const value of Object.values(input.evidence)) Object.freeze(value);
    Object.freeze(input.evidence); Object.freeze(input.policy); Object.freeze(input.request); Object.freeze(input);
    const clock = vi.spyOn(Date, 'now').mockImplementation(() => { throw new Error('Ambient clock forbidden'); });
    const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(() => { throw new Error('Provider call forbidden'); });
    try {
      const result = planProductionPhoneVerification(input);
      expect(result.kind).toBe('reservation_required'); expect(planProductionPhoneVerification(input)).toEqual(result);
      expect(input).toEqual(before); expect(clock).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
      expect(JSON.stringify(result)).not.toMatch(/authorizedSpend|balance|remaining|trial|maxSendReservations/);
    } finally { clock.mockRestore(); fetch.mockRestore(); }
  });
});
