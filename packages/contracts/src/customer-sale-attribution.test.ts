import { describe, expect, it } from 'vitest';
import { CustomerSaleAttributionSchema } from './customer-sale-attribution';

const tenantRef = '507f1f77bcf86cd799439011';
const uuid = '11111111-1111-4111-8111-111111111111';
const common = { version: 1, tenantRef, clientId: uuid,
  owner: { parentRef: `AC${'a'.repeat(32)}`, tenantRef, accountId: uuid }, capturedAt: 1789034400000,
  basis: { policyVersion: 'merchandise-net-v1', eligiblePurchaseCents: 800, excludedChargeCents: 200, chargedTotalCents: 1000 } };
const attributed = { ...common, decision: 'attributed', memberId: uuid, membershipOperationId: uuid,
  programId: uuid, rulesVersion: 1, rule: { mechanism: 'points', minimumPurchaseCents: 0,
    maximumUnitsPerPurchase: null, spendStepCents: 100, unitsPerStep: 1 } };

describe('private customer sale attribution contract', () => {
  it.each(['not_enrolled', 'program_inactive', 'feature_unavailable', 'member_inactive'])('accepts explicit no-attribution: %s', reason => {
    const input = { ...common, decision: 'none', reason };
    expect(CustomerSaleAttributionSchema.parse(input)).toEqual(input);
  });
  it('accepts exact points and stamps snapshots', () => {
    expect(CustomerSaleAttributionSchema.parse(attributed)).toEqual(attributed);
    const input = { ...attributed, rule: { mechanism: 'stamps', minimumPurchaseCents: 500,
      maximumUnitsPerPurchase: 2, unitsPerVisit: 1 } };
    expect(CustomerSaleAttributionSchema.parse(input)).toEqual(input);
  });
  it.each([
    { version: 2 }, { tenantRef: 'other' }, { clientId: 'legacy-key' }, { capturedAt: 0 }, { capturedAt: 1.5 },
    { capturedAt: Number.MAX_SAFE_INTEGER + 1 }, { capturedAt: '123' }, { memberId: 'invalid' },
    { membershipOperationId: undefined }, { programId: 'invalid' }, { rulesVersion: 0 },
    { rulesVersion: Number.MAX_SAFE_INTEGER + 1 }, { reason: 'not_enrolled' }, { decision: 'unknown' },
    { phone: '+33600000000' }, { qrToken: 'private' }, { sessionHash: 'private' }, { balanceUnits: 42 },
    { owner: { ...common.owner, tenantRef: '507f1f77bcf86cd799439012' } },
    { owner: { ...common.owner, phone: '+33600000000' } }, { owner: { ...common.owner, parentRef: 'ACshort' } },
    { owner: { ...common.owner, accountId: 'invalid' } },
    { basis: { ...common.basis, chargedTotalCents: 999 } },
    { basis: { ...common.basis, eligiblePurchaseCents: -1 } },
    { basis: { ...common.basis, excludedChargeCents: 0.5 } },
    { basis: { ...common.basis, excludedChargeCents: '200' } },
    { basis: { ...common.basis, policyVersion: 'gross-v0' } },
    { basis: { ...common.basis, phone: '+33600000000' } },
    { rule: { ...attributed.rule, unitsPerVisit: 1 } },
    { rule: { ...attributed.rule, spendStepCents: 0 } },
  ])('rejects malformed or extra fields %#', patch => {
    expect(CustomerSaleAttributionSchema.safeParse({ ...attributed, ...patch }).success).toBe(false);
  });
  it('never accepts attributed fields on an explicit none decision', () => {
    expect(CustomerSaleAttributionSchema.safeParse({ ...attributed, decision: 'none', reason: 'not_enrolled' }).success).toBe(false);
  });
  it('validates maximum safe boundaries with exact arithmetic, not rounded sums', () => {
    const max = Number.MAX_SAFE_INTEGER;
    expect(CustomerSaleAttributionSchema.safeParse({ ...attributed,
      basis: { ...common.basis, eligiblePurchaseCents: max - 1, excludedChargeCents: 1, chargedTotalCents: max } }).success).toBe(true);
    expect(CustomerSaleAttributionSchema.safeParse({ ...attributed,
      basis: { ...common.basis, eligiblePurchaseCents: max, excludedChargeCents: 1, chargedTotalCents: max } }).success).toBe(false);
  });
});
