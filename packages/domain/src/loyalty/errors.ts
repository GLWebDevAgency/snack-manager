import { DomainError } from '../shared/errors';

/** Configuration d'un programme impossible à appliquer sans ambiguïté. */
export class InvalidLoyaltyRule extends DomainError {
  readonly code = 'loyalty.rule.invalid';
}

/** Dépense supérieure au solde disponible — cas nominal au comptoir. */
export class InsufficientLoyaltyBalance extends DomainError {
  readonly code = 'loyalty.balance.insufficient';

  constructor(
    readonly availableUnits: number,
    readonly requiredUnits: number,
  ) {
    super(
      `Solde insuffisant : ${availableUnits} disponible${availableUnits > 1 ? 's' : ''}, ${requiredUnits} requis`,
    );
  }
}

/** Un programme en brouillon ou en pause ne produit aucun mouvement. */
export class LoyaltyProgramInactive extends DomainError {
  readonly code = 'loyalty.program.inactive';
}
