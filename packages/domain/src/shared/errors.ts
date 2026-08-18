/**
 * Erreurs du domaine.
 *
 * Distinction volontaire :
 *  - `DomainError` = règle métier violée par une entrée légitime (le client a
 *    choisi 2 viandes sur un tacos M qui n'en accepte qu'une). C'est un cas
 *    NOMINAL : l'interface doit l'afficher, pas planter. On la transporte via
 *    `Result`.
 *  - `InvariantViolation` = état impossible atteint (une commande livrée sans
 *    ligne). C'est un BUG : on lève, on journalise, on corrige le code.
 */

export abstract class DomainError extends Error {
  abstract readonly code: string;

  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

/** Violation d'invariant : jamais rattrapable, signale un défaut de code. */
export class InvariantViolation extends Error {
  constructor(message: string) {
    super(`Invariant violé : ${message}`);
    this.name = 'InvariantViolation';
  }
}

export function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) throw new InvariantViolation(message);
}

// ─── Erreurs métier concrètes ───

export class InvalidMoney extends DomainError {
  readonly code = 'money.invalid';
}

export class InvalidSlug extends DomainError {
  readonly code = 'slug.invalid';
}

export class InvalidPin extends DomainError {
  readonly code = 'pin.invalid';
}

export class InvalidDomainName extends DomainError {
  readonly code = 'domain.invalid';
}

/** Configuration produit incomplète ou hors bornes (groupe d'options). */
export class OptionRuleViolated extends DomainError {
  readonly code = 'option.rule';

  constructor(
    readonly groupName: string,
    readonly min: number,
    readonly max: number,
    readonly actual: number,
  ) {
    super(
      min === max
        ? `« ${groupName} » : ${min} choix attendu(s), ${actual} fourni(s)`
        : `« ${groupName} » : entre ${min} et ${max === Number.POSITIVE_INFINITY ? '∞' : max} choix attendus, ${actual} fourni(s)`,
    );
  }
}

export class ProductUnavailable extends DomainError {
  readonly code = 'product.unavailable';

  constructor(readonly productName: string) {
    super(`« ${productName} » est en rupture`);
  }
}

/** Transition de statut interdite (on ne revient pas de « remise » à « prête »). */
export class IllegalTransition extends DomainError {
  readonly code = 'order.transition';

  constructor(from: string, to: string) {
    super(`Passage de « ${from} » à « ${to} » impossible`);
  }
}

/** Action sensible tentée sans preuve d'identité (exigence NF525). */
export class AuthorizationRequired extends DomainError {
  readonly code = 'authorization.required';

  constructor(action: string) {
    super(`L'action « ${action} » exige une validation par code PIN`);
  }
}
