import type { DomainError } from '../shared/errors';
import { Money } from '../shared/money';
import { err, ok, type Result } from '../shared/result';
import {
  InsufficientLoyaltyBalance,
  InvalidLoyaltyRule,
  LoyaltyProgramInactive,
} from './errors';

/**
 * Un restaurant choisit UN langage de fidélité visible par ses clients.
 *
 * Mélanger « 84 points » et « 7 tampons sur 10 » sur une même carte rend la
 * progression inexplicable et les récompenses impossibles à comparer. Le
 * modèle sait porter les deux mécanismes, mais un programme actif n'en expose
 * qu'un à la fois.
 */
export type LoyaltyMechanism = 'points' | 'stamps';
export type LoyaltyProgramStatus = 'draft' | 'active' | 'paused';

interface CommonEarnRule {
  readonly mechanism: LoyaltyMechanism;
  /** En dessous de ce panier, aucun gain. Toujours en centimes. */
  readonly minimumPurchaseCents: number;
  /** Garde-fou anti-abus et anti-erreur de saisie. `null` = sans plafond. */
  readonly maximumUnitsPerPurchase: number | null;
}

/** Exemple : 1 point par tranche complète de 1 euro. */
export interface PointsEarnRule extends CommonEarnRule {
  readonly mechanism: 'points';
  readonly spendStepCents: number;
  readonly unitsPerStep: number;
}

/** Exemple : 1 tampon par visite à partir de 8 euros. */
export interface StampsEarnRule extends CommonEarnRule {
  readonly mechanism: 'stamps';
  readonly unitsPerVisit: number;
}

export type LoyaltyEarnRule = PointsEarnRule | StampsEarnRule;

export interface LoyaltyProgramRule {
  readonly status: LoyaltyProgramStatus;
  readonly earn: LoyaltyEarnRule;
}

export interface LoyaltyEarnCalculation {
  readonly units: number;
  readonly mechanism: LoyaltyMechanism;
  readonly eligiblePurchaseCents: number;
  /** Explique un gain nul sans transformer le cas en incident. */
  readonly reason: 'earned' | 'below_minimum';
}

function positiveInteger(value: number, label: string): Result<number, InvalidLoyaltyRule> {
  if (!Number.isSafeInteger(value) || value <= 0) {
    return err(new InvalidLoyaltyRule(`${label} doit être un entier sûr strictement positif`));
  }
  return ok(value);
}

function validateCommon(rule: LoyaltyEarnRule): Result<true, InvalidLoyaltyRule> {
  if (!Number.isSafeInteger(rule.minimumPurchaseCents) || rule.minimumPurchaseCents < 0) {
    return err(
      new InvalidLoyaltyRule('Le panier minimum doit être un nombre entier sûr de centimes'),
    );
  }
  if (
    rule.maximumUnitsPerPurchase !== null &&
    (!Number.isSafeInteger(rule.maximumUnitsPerPurchase) ||
      rule.maximumUnitsPerPurchase <= 0)
  ) {
    return err(new InvalidLoyaltyRule('Le plafond de gain doit être un entier strictement positif'));
  }
  return ok(true);
}

/** Valide une règle AVANT publication dans le back-office. */
export function validateLoyaltyEarnRule(
  rule: LoyaltyEarnRule,
): Result<LoyaltyEarnRule, InvalidLoyaltyRule> {
  const common = validateCommon(rule);
  if (!common.ok) return common;

  if (rule.mechanism === 'points') {
    const step = positiveInteger(rule.spendStepCents, 'La tranche de dépense');
    if (!step.ok) return step;
    const units = positiveInteger(rule.unitsPerStep, 'Le nombre de points par tranche');
    if (!units.ok) return units;
  } else {
    const units = positiveInteger(rule.unitsPerVisit, 'Le nombre de tampons par visite');
    if (!units.ok) return units;
  }

  return ok(rule);
}

/**
 * Calcule le gain dans des entiers uniquement.
 *
 * 9,99 euros avec « 1 point par euro » vaut 9 points : aucune virgule, aucun
 * arrondi divergent entre caisse, API et application client. Les tampons sont
 * par visite, donc le montant ne multiplie jamais leur nombre.
 */
export function calculateLoyaltyEarn(
  program: LoyaltyProgramRule,
  purchase: Money,
): Result<LoyaltyEarnCalculation, DomainError> {
  if (program.status !== 'active') {
    return err(new LoyaltyProgramInactive('Le programme de fidélité n’est pas actif'));
  }

  const valid = validateLoyaltyEarnRule(program.earn);
  if (!valid.ok) return valid;
  if (purchase.isNegative()) {
    return err(new InvalidLoyaltyRule('Un remboursement ne peut pas produire de fidélité'));
  }
  if (!Number.isSafeInteger(purchase.cents)) {
    return err(new InvalidLoyaltyRule("Le montant d'achat dépasse la précision sûre"));
  }

  if (purchase.cents < program.earn.minimumPurchaseCents) {
    return ok({
      units: 0,
      mechanism: program.earn.mechanism,
      eligiblePurchaseCents: purchase.cents,
      reason: 'below_minimum',
    });
  }

  const raw =
    program.earn.mechanism === 'points'
      ? Math.floor(purchase.cents / program.earn.spendStepCents) * program.earn.unitsPerStep
      : program.earn.unitsPerVisit;
  if (!Number.isSafeInteger(raw) || raw < 0) {
    return err(new InvalidLoyaltyRule('Le gain calculé dépasse la précision sûre'));
  }
  const units =
    program.earn.maximumUnitsPerPurchase === null
      ? raw
      : Math.min(raw, program.earn.maximumUnitsPerPurchase);

  return ok({
    units,
    mechanism: program.earn.mechanism,
    eligiblePurchaseCents: purchase.cents,
    reason: units > 0 ? 'earned' : 'below_minimum',
  });
}

export interface LoyaltyRedemption {
  readonly costUnits: number;
  readonly balanceBefore: number;
  readonly balanceAfter: number;
}

/** Vérifie une dépense avant toute écriture du registre. */
export function redeemLoyaltyUnits(
  balance: number,
  cost: number,
): Result<LoyaltyRedemption, DomainError> {
  if (!Number.isSafeInteger(balance) || balance < 0) {
    return err(new InvalidLoyaltyRule('Le solde de fidélité est invalide'));
  }
  if (!Number.isSafeInteger(cost) || cost <= 0) {
    return err(new InvalidLoyaltyRule('Le coût de la récompense doit être positif'));
  }
  if (balance < cost) return err(new InsufficientLoyaltyBalance(balance, cost));
  return ok({ costUnits: cost, balanceBefore: balance, balanceAfter: balance - cost });
}
