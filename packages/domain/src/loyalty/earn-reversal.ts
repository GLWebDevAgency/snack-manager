import { DomainError } from '../shared/errors';
import { Money } from '../shared/money';
import { err, ok, type Result } from '../shared/result';
import { calculateLoyaltyEarn, type LoyaltyEarnRule } from './program';

export interface LoyaltyEarnReversalInput {
  /** Snapshot de la règle qui a produit le gain, jamais la règle courante. */
  readonly historicalRule: LoyaltyEarnRule;
  /** Assiette initiale prouvée par l'adaptateur, hors allocation inventée ici. */
  readonly eligiblePurchaseCents: number;
  /** Cumul confirmé remboursé sur CETTE assiette, pas un remboursement en attente. */
  readonly confirmedRefundedEligibleCents: number;
  /** Gain initial immuable, avant toute correction ou consommation du portefeuille. */
  readonly earnedUnits: number;
  /** Cumul des corrections de ce gain déjà confirmées, jamais le solde courant. */
  readonly alreadyReversedUnits: number;
}

export interface LoyaltyEarnReversalPlan {
  readonly originalUnits: number;
  readonly retainedUnits: number;
  readonly totalUnitsToReverse: number;
  readonly additionalUnitsToReverse: number;
}

export type LoyaltyEarnReversalErrorReason =
  | 'invalid_input' | 'invalid_rule' | 'inconsistent_earned_units' | 'stale_reversal_snapshot';

export class InvalidLoyaltyEarnReversal extends DomainError {
  readonly code = 'loyalty.earn_reversal.invalid';

  constructor(readonly reason: LoyaltyEarnReversalErrorReason) {
    super('Les données de correction du gain sont invalides');
  }
}

function rejected(reason: LoyaltyEarnReversalErrorReason): Result<never, InvalidLoyaltyEarnReversal> {
  // Ni cause brute ni valeurs du snapshot dans l'erreur publique de domaine.
  return Object.freeze(err(Object.freeze(new InvalidLoyaltyEarnReversal(reason))));
}

/**
 * Plan pur d'une correction cumulative : ne débite aucun portefeuille et ne
 * prouve ni la vente, ni les remboursements, ni leur allocation aux produits.
 * Le futur writer doit relire/verrouiller ses preuves et appliquer le delta
 * atomiquement ; deux plans identiques ne constituent pas une idempotence DB.
 */
export function planLoyaltyEarnReversal(
  input: LoyaltyEarnReversalInput,
): Result<LoyaltyEarnReversalPlan, InvalidLoyaltyEarnReversal> {
  if (!input || typeof input !== 'object') return rejected('invalid_input');
  const {
    historicalRule, eligiblePurchaseCents, confirmedRefundedEligibleCents,
    earnedUnits, alreadyReversedUnits,
  } = input;
  if (
    ![eligiblePurchaseCents, confirmedRefundedEligibleCents, earnedUnits, alreadyReversedUnits]
      .every((value) => Number.isSafeInteger(value) && value >= 0) ||
    confirmedRefundedEligibleCents > eligiblePurchaseCents
  ) {
    return rejected('invalid_input');
  }
  if (
    !historicalRule || typeof historicalRule !== 'object' ||
    (historicalRule.mechanism !== 'points' && historicalRule.mechanism !== 'stamps')
  ) {
    return rejected('invalid_rule');
  }

  // « active » sélectionne le calcul de la règle HISTORIQUE validée, et non
  // une disponibilité commerciale actuelle : sa pause ne supprime pas la dette
  // de correction d'un ancien gain. Aucune lecture de programme n'a lieu ici.
  const historicalProgram = { status: 'active' as const, earn: historicalRule };
  const original = calculateLoyaltyEarn(historicalProgram, Money.fromCents(eligiblePurchaseCents));
  if (!original.ok) return rejected('invalid_rule');

  // Un tampon à seuil zéro ne doit pas survivre à une assiette nulle. Les
  // anciennes écritures ayant crédité ce cas sont refusées comme incohérentes.
  const originalUnits = eligiblePurchaseCents === 0 ? 0 : original.value.units;
  if (earnedUnits !== originalUnits) return rejected('inconsistent_earned_units');

  const retainedPurchaseCents = eligiblePurchaseCents - confirmedRefundedEligibleCents;
  let retainedUnits = 0;
  if (retainedPurchaseCents > 0) {
    const retained = calculateLoyaltyEarn(historicalProgram, Money.fromCents(retainedPurchaseCents));
    if (!retained.ok) return rejected('invalid_rule');
    retainedUnits = retained.value.units;
  }
  const totalUnitsToReverse = originalUnits - retainedUnits;
  if (alreadyReversedUnits > totalUnitsToReverse) return rejected('stale_reversal_snapshot');

  return Object.freeze(ok(Object.freeze({
    originalUnits,
    retainedUnits,
    totalUnitsToReverse,
    additionalUnitsToReverse: totalUnitsToReverse - alreadyReversedUnits,
  })));
}
