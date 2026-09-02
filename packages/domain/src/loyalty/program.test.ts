import { describe, expect, it } from 'vitest';
import { Money } from '../shared/money';
import {
  calculateLoyaltyEarn,
  redeemLoyaltyUnits,
  validateLoyaltyEarnRule,
  type LoyaltyEarnRule,
} from './program';

const points = (overrides: Partial<LoyaltyEarnRule> = {}): LoyaltyEarnRule => ({
  mechanism: 'points',
  minimumPurchaseCents: 0,
  maximumUnitsPerPurchase: null,
  spendStepCents: 100,
  unitsPerStep: 1,
  ...overrides,
} as LoyaltyEarnRule);

describe('gain de points', () => {
  it('travaille en centimes et ne donne que les tranches complètes', () => {
    const result = calculateLoyaltyEarn(
      { status: 'active', earn: points() },
      Money.fromCents(999),
    );
    expect(result).toEqual({
      ok: true,
      value: {
        units: 9,
        mechanism: 'points',
        eligiblePurchaseCents: 999,
        reason: 'earned',
      },
    });
  });

  it('respecte le panier minimum et le plafond anti-abus', () => {
    const below = calculateLoyaltyEarn(
      {
        status: 'active',
        earn: points({ minimumPurchaseCents: 800, maximumUnitsPerPurchase: 20 }),
      },
      Money.fromCents(799),
    );
    const capped = calculateLoyaltyEarn(
      {
        status: 'active',
        earn: points({ minimumPurchaseCents: 800, maximumUnitsPerPurchase: 20 }),
      },
      Money.fromCents(12_500),
    );

    expect(below.ok && below.value).toMatchObject({ units: 0, reason: 'below_minimum' });
    expect(capped.ok && capped.value.units).toBe(20);
  });

  it('traite une tranche incomplète comme un no-op explicite', () => {
    const result = calculateLoyaltyEarn(
      { status: 'active', earn: points() },
      Money.fromCents(99),
    );

    expect(result).toMatchObject({
      ok: true,
      value: { units: 0, reason: 'below_minimum' },
    });
  });

  it('refuse un calcul qui dépasse la précision entière sûre au lieu de le borner', () => {
    const result = calculateLoyaltyEarn(
      {
        status: 'active',
        earn: points({ spendStepCents: 1, unitsPerStep: 2 }),
      },
      Money.fromCents(Number.MAX_SAFE_INTEGER),
    );

    expect(result).toMatchObject({
      ok: false,
      error: { message: 'Le gain calculé dépasse la précision sûre' },
    });
  });
});

describe('gain de tampons', () => {
  it('accorde une fois la visite, quelle que soit la taille du panier', () => {
    const earn: LoyaltyEarnRule = {
      mechanism: 'stamps',
      minimumPurchaseCents: 800,
      maximumUnitsPerPurchase: null,
      unitsPerVisit: 1,
    };
    const small = calculateLoyaltyEarn({ status: 'active', earn }, Money.fromCents(800));
    const large = calculateLoyaltyEarn({ status: 'active', earn }, Money.fromCents(80_000));
    expect(small.ok && small.value.units).toBe(1);
    expect(large.ok && large.value.units).toBe(1);
  });
});

describe('garde-fous du programme', () => {
  it('refuse une règle ambiguë ou un programme en pause', () => {
    expect(validateLoyaltyEarnRule(points({ spendStepCents: 0 })).ok).toBe(false);
    expect(
      calculateLoyaltyEarn(
        { status: 'paused', earn: points() },
        Money.fromCents(2_000),
      ).ok,
    ).toBe(false);
  });

  it('ne laisse jamais une récompense rendre le solde négatif', () => {
    const denied = redeemLoyaltyUnits(9, 10);
    const accepted = redeemLoyaltyUnits(12, 10);
    expect(denied.ok).toBe(false);
    expect(accepted).toEqual({
      ok: true,
      value: { costUnits: 10, balanceBefore: 12, balanceAfter: 2 },
    });
  });
});
