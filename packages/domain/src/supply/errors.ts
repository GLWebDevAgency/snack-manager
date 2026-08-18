import { DomainError } from '../shared/errors';

/**
 * Erreurs propres au sous-domaine APPROVISIONNEMENT.
 *
 * Toutes correspondent à une saisie humaine plausible dans le back-office
 * (« 2 pièces de viande kebab », « 0 g de sauce ») : ce sont des cas nominaux
 * transportés par `Result`, pas des incidents.
 */

/** Quantité de recette hors bornes. */
export class InvalidQuantity extends DomainError {
  readonly code = 'quantity.invalid';
}

/** Deux unités de dimensions différentes (masse / volume / pièce). */
export class IncompatibleUnits extends DomainError {
  readonly code = 'unit.incompatible';
}

/** Fiche ingrédient incomplète ou incohérente. */
export class InvalidIngredient extends DomainError {
  readonly code = 'ingredient.invalid';
}

/** Nomenclature vide ou contradictoire. */
export class InvalidRecipe extends DomainError {
  readonly code = 'recipe.invalid';
}

/** Groupe d'options mal borné (2 choix imposés parmi 0 proposé). */
export class InvalidOptionGroup extends DomainError {
  readonly code = 'option.group.invalid';
}
