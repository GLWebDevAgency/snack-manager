import { describe, expect, it } from 'vitest';
import { deriveLoyaltySaleBasis, type LoyaltySaleTotals } from './sale-basis';

const totals = (patch: Partial<LoyaltySaleTotals> = {}): LoyaltySaleTotals => ({
  subtotalCents: 2_000, discountCents: 200, deliveryFeeCents: 500, totalCents: 2_300, ...patch,
});

describe('loyalty sale basis — net merchandise, not delivery fees', () => {
  it('uses merchandise after discount and preserves the charged total separately', () => {
    expect(deriveLoyaltySaleBasis(totals())).toEqual({ ok: true, value: {
      policyVersion: 'merchandise-net-v1', eligiblePurchaseCents: 1_800,
      excludedChargeCents: 500, chargedTotalCents: 2_300,
    } });
  });
  it('uses the same basis for pickup without delivery fees', () => {
    const result = deriveLoyaltySaleBasis(totals({ deliveryFeeCents: 0, totalCents: 1_800 }));
    expect(result.ok && result.value.eligiblePurchaseCents).toBe(1_800);
  });
  it('does not turn paid delivery on free merchandise into an eligible purchase', () => {
    const result = deriveLoyaltySaleBasis(totals({ discountCents: 2_000, totalCents: 500 }));
    expect(result.ok && result.value.eligiblePurchaseCents).toBe(0);
  });
  it('accepts a coherent zero sale without manufacturing a gain', () => {
    expect(deriveLoyaltySaleBasis({ subtotalCents: 0, discountCents: 0, deliveryFeeCents: 0, totalCents: 0 }))
      .toMatchObject({ ok: true, value: { eligiblePurchaseCents: 0, excludedChargeCents: 0, chargedTotalCents: 0 } });
  });
  it.each(['subtotalCents', 'discountCents', 'deliveryFeeCents', 'totalCents'] as const)(
    'rejects non-integer, negative, non-finite and unsafe %s', field => {
      for (const value of [-1, 0.5, NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER + 1]) {
        const result = deriveLoyaltySaleBasis(totals({ [field]: value }));
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.error.code).toBe('loyalty.sale_basis.invalid');
      }
    },
  );
  it('rejects a discount exceeding the merchandise amount', () => {
    expect(deriveLoyaltySaleBasis(totals({ discountCents: 2_001, totalCents: 499 })).ok).toBe(false);
  });
  it.each([2_299, 2_301, 0])('rejects a supplied total inconsistent with the exact components: %i', totalCents => {
    expect(deriveLoyaltySaleBasis(totals({ totalCents })).ok).toBe(false);
  });
  it('accepts the highest safe amount without rounding cents', () => {
    const maximum = Number.MAX_SAFE_INTEGER;
    expect(deriveLoyaltySaleBasis({ subtotalCents: maximum, discountCents: 1, deliveryFeeCents: 1, totalCents: maximum }))
      .toMatchObject({ ok: true, value: { eligiblePurchaseCents: maximum - 1, chargedTotalCents: maximum } });
  });
  it('rejects component overflow instead of accepting a rounded total', () => {
    const maximum = Number.MAX_SAFE_INTEGER;
    expect(deriveLoyaltySaleBasis({ subtotalCents: maximum, discountCents: 0, deliveryFeeCents: 2, totalCents: maximum }).ok).toBe(false);
  });
  it('preserves its input and returns a detached immutable result', () => {
    const input = Object.freeze(totals()); const result = deriveLoyaltySaleBasis(input);
    expect(result.ok).toBe(true); expect(input).toEqual(totals()); expect(Object.isFrozen(result)).toBe(true);
    if (result.ok) { expect(Object.isFrozen(result.value)).toBe(true); expect(result.value).not.toBe(input); }
  });
  it('uses a fixed error without echoing the invalid financial input', () => {
    const a = deriveLoyaltySaleBasis(totals({ subtotalCents: -123456 }));
    const b = deriveLoyaltySaleBasis(totals({ subtotalCents: -999999 }));
    expect(a.ok).toBe(false); expect(b.ok).toBe(false);
    if (!a.ok && !b.ok) { expect(a.error.message).toBe(b.error.message); expect(a.error.message).not.toContain('123456'); }
  });
  it.each([null, undefined, false, '2300', [], {}])('refuses a malformed runtime snapshot without throwing (%j)', raw => {
    expect(deriveLoyaltySaleBasis(raw as unknown as LoyaltySaleTotals)).toMatchObject({
      ok: false, error: { code: 'loyalty.sale_basis.invalid' },
    });
  });
  it('conserves every cent over a small exhaustive set of discounts and delivery fees', () => {
    for (let subtotalCents = 0; subtotalCents <= 20; subtotalCents++) {
      for (let discountCents = 0; discountCents <= subtotalCents; discountCents++) {
        for (const deliveryFeeCents of [0, 1, 5, 500]) {
          const totalCents = subtotalCents - discountCents + deliveryFeeCents;
          const result = deriveLoyaltySaleBasis({ subtotalCents, discountCents, deliveryFeeCents, totalCents });
          expect(result.ok).toBe(true);
          if (result.ok) expect(result.value.eligiblePurchaseCents + result.value.excludedChargeCents).toBe(totalCents);
        }
      }
    }
  });
});
