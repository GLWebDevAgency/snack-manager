import { describe, expect, it } from 'vitest';
import { DomainError } from '../shared/errors';
import { unwrap } from '../shared/result';
import type { LoyaltyEarnRule } from './program';
import { deriveLoyaltySaleBasis } from './sale-basis';
import {
  InvalidLoyaltyEarnReversal,
  planLoyaltyEarnReversal,
  type LoyaltyEarnReversalInput,
} from './earn-reversal';

const POINTS: LoyaltyEarnRule = {
  mechanism: 'points', minimumPurchaseCents: 0, maximumUnitsPerPurchase: null,
  spendStepCents: 100, unitsPerStep: 2,
};
const STAMPS: LoyaltyEarnRule = {
  mechanism: 'stamps', minimumPurchaseCents: 800, maximumUnitsPerPurchase: null,
  unitsPerVisit: 1,
};

function input(overrides: Partial<LoyaltyEarnReversalInput> = {}): LoyaltyEarnReversalInput {
  return {
    historicalRule: POINTS, eligiblePurchaseCents: 999,
    confirmedRefundedEligibleCents: 0, earnedUnits: 18, alreadyReversedUnits: 0,
    ...overrides,
  };
}

function expected(originalUnits: number, retainedUnits: number, alreadyReversed = 0) {
  return {
    originalUnits, retainedUnits, totalUnitsToReverse: originalUnits - retainedUnits,
    additionalUnitsToReverse: originalUnits - retainedUnits - alreadyReversed,
  };
}

describe('planLoyaltyEarnReversal — historique, sans écriture', () => {
  it.each([
    ['aucun remboursement', 0, 18],
    ['reste dans la même tranche', 99, 18],
    ['franchit une tranche entière', 100, 16],
    ['recalcule plutôt que répartir proportionnellement', 500, 8],
    ['conserve moins que la première tranche', 998, 0],
    ['remboursement complet', 999, 0],
  ] as const)('%s', (_label, refunded, retained) => {
    expect(unwrap(planLoyaltyEarnReversal(input({ confirmedRefundedEligibleCents: refunded }))))
      .toEqual(expected(18, retained));
  });

  it('applique le seuil historique au montant conservé', () => {
    const historicalRule: LoyaltyEarnRule = { ...POINTS, minimumPurchaseCents: 800 };
    expect(unwrap(planLoyaltyEarnReversal(input({ historicalRule, confirmedRefundedEligibleCents: 199 }))))
      .toEqual(expected(18, 16));
    expect(unwrap(planLoyaltyEarnReversal(input({ historicalRule, confirmedRefundedEligibleCents: 200 }))))
      .toEqual(expected(18, 0));
  });

  it('ne corrige un gain plafonné que lorsque le montant conservé passe sous ce plafond', () => {
    const historicalRule: LoyaltyEarnRule = { ...POINTS, maximumUnitsPerPurchase: 5 };
    expect(unwrap(planLoyaltyEarnReversal(input({ historicalRule, earnedUnits: 5, confirmedRefundedEligibleCents: 699 }))))
      .toEqual(expected(5, 5));
    expect(unwrap(planLoyaltyEarnReversal(input({ historicalRule, earnedUnits: 5, confirmedRefundedEligibleCents: 700 }))))
      .toEqual(expected(5, 4));
  });

  it('conserve un tampon par visite jusqu’au seuil, sans prorata', () => {
    const stamped = input({ historicalRule: STAMPS, earnedUnits: 1 });
    expect(unwrap(planLoyaltyEarnReversal({ ...stamped, confirmedRefundedEligibleCents: 199 })))
      .toEqual(expected(1, 1));
    expect(unwrap(planLoyaltyEarnReversal({ ...stamped, confirmedRefundedEligibleCents: 200 })))
      .toEqual(expected(1, 0));
  });

  it('rembourse tout, y compris une règle de tampons dont le minimum vaut zéro', () => {
    const historicalRule: LoyaltyEarnRule = { ...STAMPS, minimumPurchaseCents: 0, unitsPerVisit: 3, maximumUnitsPerPurchase: 2 };
    expect(unwrap(planLoyaltyEarnReversal(input({ historicalRule, earnedUnits: 2, confirmedRefundedEligibleCents: 999 }))))
      .toEqual(expected(2, 0));
    expect(unwrap(planLoyaltyEarnReversal(input({ historicalRule, earnedUnits: 2, confirmedRefundedEligibleCents: 998 }))))
      .toEqual(expected(2, 2));
  });

  it.each([POINTS, STAMPS, { ...STAMPS, minimumPurchaseCents: 0 }])(
    'une assiette initiale nulle produit un plan nul (%j)', (historicalRule) => {
      expect(unwrap(planLoyaltyEarnReversal(input({ historicalRule, eligiblePurchaseCents: 0, earnedUnits: 0 }))))
        .toEqual(expected(0, 0));
    },
  );

  it('ne réécrit pas silencieusement un ancien tampon accordé à zéro euro', () => {
    const result = planLoyaltyEarnReversal(input({
      historicalRule: { ...STAMPS, minimumPurchaseCents: 0 }, eligiblePurchaseCents: 0, earnedUnits: 1,
    }));
    expect(result).toMatchObject({ ok: false, error: { reason: 'inconsistent_earned_units' } });
  });

  it('retourne uniquement le complément puis zéro lors de la reprise du même snapshot corrigé', () => {
    const partial = input({ confirmedRefundedEligibleCents: 500, alreadyReversedUnits: 4 });
    const first = unwrap(planLoyaltyEarnReversal(partial));
    expect(first).toEqual(expected(18, 8, 4));
    expect(unwrap(planLoyaltyEarnReversal({ ...partial, alreadyReversedUnits: first.totalUnitsToReverse })))
      .toEqual(expected(18, 8, 10));
    expect(unwrap(planLoyaltyEarnReversal({ ...partial, confirmedRefundedEligibleCents: 999, alreadyReversedUnits: 10 })))
      .toEqual(expected(18, 0, 10));
  });

  it('refuse un snapshot dont les corrections dépassent la cible, sans produire de recrédit', () => {
    expect(planLoyaltyEarnReversal(input({ confirmedRefundedEligibleCents: 500, alreadyReversedUnits: 11 })))
      .toMatchObject({ ok: false, error: { reason: 'stale_reversal_snapshot' } });
  });

  it.each([0, 17, 19])('refuse un gain initial incohérent avec la règle historique : %s', (earnedUnits) => {
    expect(planLoyaltyEarnReversal(input({ earnedUnits })))
      .toMatchObject({ ok: false, error: { reason: 'inconsistent_earned_units' } });
  });

  const numericFields = [
    'eligiblePurchaseCents', 'confirmedRefundedEligibleCents', 'earnedUnits', 'alreadyReversedUnits',
  ] as const;
  const invalidNumbers = [NaN, Infinity, -Infinity, -1, 0.5, Number.MAX_SAFE_INTEGER + 1, '12', null, undefined];
  it.each(numericFields.flatMap((field) => invalidNumbers.map((value) => ({ field, value }))))(
    'refuse le nombre invalide $field=$value sans lever ni exposer de montant', ({ field, value }) => {
      const result = planLoyaltyEarnReversal(input({ [field]: value } as Partial<LoyaltyEarnReversalInput>));
      expect(result).toMatchObject({ ok: false, error: { reason: 'invalid_input' } });
      if (result.ok) throw new Error('Un snapshot invalide ne doit produire aucun plan');
      expect(result.error).toBeInstanceOf(DomainError);
      expect(result.error).toBeInstanceOf(InvalidLoyaltyEarnReversal);
      expect(result.error.code).toBe('loyalty.earn_reversal.invalid');
      expect(result.error.message).toBe('Les données de correction du gain sont invalides');
      expect(Object.keys(result.error).sort()).toEqual(['code', 'name', 'reason']);
    },
  );

  it('refuse un remboursement supérieur à l’assiette initiale', () => {
    expect(planLoyaltyEarnReversal(input({ confirmedRefundedEligibleCents: 1_000 })))
      .toMatchObject({ ok: false, error: { reason: 'invalid_input' } });
  });

  it.each([
    null, undefined, {}, { ...STAMPS, mechanism: 'unknown' },
    ...[NaN, Infinity, -1, 0.5, Number.MAX_SAFE_INTEGER + 1].map((minimumPurchaseCents) => ({ ...POINTS, minimumPurchaseCents })),
    ...[0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1].map((maximumUnitsPerPurchase) => ({ ...POINTS, maximumUnitsPerPurchase })),
    ...[0, -1, NaN, 0.5].map((spendStepCents) => ({ ...POINTS, spendStepCents })),
    ...[0, Infinity, 0.5].map((unitsPerStep) => ({ ...POINTS, unitsPerStep })),
    ...[0, -1, Infinity, 0.5].map((unitsPerVisit) => ({ ...STAMPS, unitsPerVisit })),
  ])('refuse une règle historique invalide même sur une assiette nulle (%j)', (historicalRule) => {
    expect(planLoyaltyEarnReversal(input({ historicalRule: historicalRule as LoyaltyEarnRule, eligiblePurchaseCents: 0, earnedUnits: 0 })))
      .toMatchObject({ ok: false, error: { code: 'loyalty.earn_reversal.invalid', reason: 'invalid_rule' } });
  });

  it('refuse un calcul de gain non sûr, même si un plafond aurait masqué le dépassement', () => {
    expect(planLoyaltyEarnReversal(input({
      historicalRule: { ...POINTS, spendStepCents: 1, unitsPerStep: 2, maximumUnitsPerPurchase: 1 },
      eligiblePurchaseCents: Number.MAX_SAFE_INTEGER, earnedUnits: 1,
    }))).toMatchObject({ ok: false, error: { reason: 'invalid_rule' } });
  });

  it('conserve une précision entière jusqu’à MAX_SAFE_INTEGER', () => {
    const max = Number.MAX_SAFE_INTEGER;
    expect(unwrap(planLoyaltyEarnReversal(input({
      historicalRule: { ...POINTS, spendStepCents: 1, unitsPerStep: 1 },
      eligiblePurchaseCents: max, earnedUnits: max, confirmedRefundedEligibleCents: max - 1,
      alreadyReversedUnits: max - 2,
    })))).toEqual(expected(max, 1, max - 2));
  });

  it('compose avec merchandise-net-v1 sans inclure la livraison ni allouer le remboursement', () => {
    const basis = unwrap(deriveLoyaltySaleBasis({
      subtotalCents: 2_000, discountCents: 200, deliveryFeeCents: 500, totalCents: 2_300,
    }));
    // The future adapter supplies this proven merchandise-only refunded amount.
    const confirmedRefundedEligibleCents = 500;
    expect(unwrap(planLoyaltyEarnReversal(input({
      eligiblePurchaseCents: basis.eligiblePurchaseCents, earnedUnits: 36,
      confirmedRefundedEligibleCents,
    })))).toEqual(expected(36, 26));
    // Refunding only the excluded fee provides zero refunded eligible cents.
    expect(unwrap(planLoyaltyEarnReversal(input({
      eligiblePurchaseCents: basis.eligiblePurchaseCents, earnedUnits: 36,
      confirmedRefundedEligibleCents: 0,
    })))).toEqual(expected(36, 36));
  });

  it('ne traite pas le total payé et remboursé comme une assiette éligible ventilée', () => {
    const basis = unwrap(deriveLoyaltySaleBasis({
      subtotalCents: 2_000, discountCents: 200, deliveryFeeCents: 500, totalCents: 2_300,
    }));
    expect(planLoyaltyEarnReversal(input({
      eligiblePurchaseCents: basis.eligiblePurchaseCents, earnedUnits: 36,
      confirmedRefundedEligibleCents: basis.chargedTotalCents,
    }))).toMatchObject({ ok: false, error: { reason: 'invalid_input' } });
  });

  it('ne conserve aucun tampon pour des produits gratuits avec livraison payante', () => {
    const basis = unwrap(deriveLoyaltySaleBasis({
      subtotalCents: 2_000, discountCents: 2_000, deliveryFeeCents: 500, totalCents: 500,
    }));
    expect(unwrap(planLoyaltyEarnReversal(input({
      historicalRule: { ...STAMPS, minimumPurchaseCents: 0 },
      eligiblePurchaseCents: basis.eligiblePurchaseCents, earnedUnits: 0,
    })))).toEqual(expected(0, 0));
  });

  it('ne modifie ni ne gèle les entrées et retourne un plan gelé reproductible', () => {
    const snapshot = input({ historicalRule: { ...POINTS }, confirmedRefundedEligibleCents: 500 });
    const before = structuredClone(snapshot);
    const first = planLoyaltyEarnReversal(snapshot);
    expect(snapshot).toEqual(before);
    expect(Object.isFrozen(snapshot)).toBe(false);
    expect(Object.isFrozen(snapshot.historicalRule)).toBe(false);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(unwrap(first))).toBe(true);
    expect(planLoyaltyEarnReversal(Object.freeze({ ...snapshot, historicalRule: Object.freeze(snapshot.historicalRule) })))
      .toEqual(first);
  });

  it('petit exhaustif : conservation, monotonie et absence de double correction', () => {
    const rules: LoyaltyEarnRule[] = [
      { ...POINTS, spendStepCents: 3, unitsPerStep: 2 },
      { ...POINTS, spendStepCents: 7, unitsPerStep: 3, minimumPurchaseCents: 10 },
      { ...POINTS, spendStepCents: 3, unitsPerStep: 2, maximumUnitsPerPurchase: 5 },
      { ...STAMPS, minimumPurchaseCents: 0 },
      { ...STAMPS, minimumPurchaseCents: 10, unitsPerVisit: 3 },
      { ...STAMPS, minimumPurchaseCents: 10, unitsPerVisit: 3, maximumUnitsPerPurchase: 2 },
    ];
    // Independent small-integer oracle; no proportional refund calculation.
    const units = (rule: LoyaltyEarnRule, cents: number) => {
      if (cents === 0 || cents < rule.minimumPurchaseCents) return 0;
      const raw = rule.mechanism === 'points'
        ? Math.floor(cents / rule.spendStepCents) * rule.unitsPerStep : rule.unitsPerVisit;
      return rule.maximumUnitsPerPurchase === null ? raw : Math.min(raw, rule.maximumUnitsPerPurchase);
    };
    for (const historicalRule of rules) {
      for (let base = 0; base <= 24; base++) {
        const original = units(historicalRule, base);
        let previousRetained = original;
        let previousTarget = 0;
        for (let refunded = 0; refunded <= base; refunded++) {
          const retained = units(historicalRule, base - refunded);
          const snapshot = input({ historicalRule, eligiblePurchaseCents: base,
            confirmedRefundedEligibleCents: refunded, earnedUnits: original });
          const plan = unwrap(planLoyaltyEarnReversal(snapshot));
          expect(plan).toEqual(expected(original, retained));
          expect(plan.retainedUnits + plan.totalUnitsToReverse).toBe(original);
          expect(plan.retainedUnits).toBeLessThanOrEqual(previousRetained);
          expect(plan.totalUnitsToReverse).toBeGreaterThanOrEqual(previousTarget);
          for (let alreadyReversedUnits = 0; alreadyReversedUnits <= plan.totalUnitsToReverse; alreadyReversedUnits++) {
            const resumed = unwrap(planLoyaltyEarnReversal({ ...snapshot, alreadyReversedUnits }));
            expect(resumed).toEqual(expected(original, retained, alreadyReversedUnits));
            expect(resumed.additionalUnitsToReverse + alreadyReversedUnits + retained).toBe(original);
          }
          expect(planLoyaltyEarnReversal({ ...snapshot, alreadyReversedUnits: plan.totalUnitsToReverse + 1 }))
            .toMatchObject({ ok: false, error: { reason: 'stale_reversal_snapshot' } });
          previousRetained = plan.retainedUnits;
          previousTarget = plan.totalUnitsToReverse;
        }
      }
    }
  });
});
