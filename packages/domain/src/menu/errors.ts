import { DomainError } from '../shared/errors';

/**
 * Erreurs propres au sous-domaine MENU.
 *
 * Deux familles, volontairement distinctes :
 *  - la carte est mal définie (`InvalidMenuDefinition`) — le restaurateur vient
 *    de saisir une bêtise dans le back-office, on refuse d'enregistrer ;
 *  - le panier ne colle plus à la carte (`UnknownProduct`, `UnknownVariant`…) —
 *    le client avait la carte d'hier dans son onglet, on lui explique.
 *
 * Les deux sont NOMINALES : elles remontent par `Result`, jamais par exception.
 * Les bornes d'un groupe d'options (`OptionRuleViolated`) et la rupture
 * (`ProductUnavailable`) vivent dans `shared/errors` : elles sont citées par le
 * reste du domaine (commande, cuisine), pas seulement par la carte.
 */

/** Carte incohérente : deux variantes de même clé, groupe sans choix, dérogation orpheline. */
export class InvalidMenuDefinition extends DomainError {
  readonly code = 'menu.definition.invalid';
}

export class InvalidProductId extends DomainError {
  readonly code = 'menu.product-id.invalid';
}

/** Sélection mal formée côté appelant (clé vide) — pas encore confrontée à la carte. */
export class InvalidSelection extends DomainError {
  readonly code = 'menu.selection.invalid';
}

/**
 * Le panier référence un produit absent de la carte servie.
 * Cas réel : le gérant retire un plat pendant que le client remplit son panier.
 * Le message reste lisible par le client ; l'identifiant sert au support.
 */
export class UnknownProduct extends DomainError {
  readonly code = 'menu.product.unknown';

  constructor(readonly productId: string) {
    super("Un article de votre panier n'est plus à la carte");
  }
}

/** Produit à formats (tacos, barquette) commandé sans format : le prix serait arbitraire. */
export class VariantRequired extends DomainError {
  readonly code = 'menu.variant.required';

  constructor(readonly productName: string) {
    super(`Choisissez un format pour « ${productName} »`);
  }
}

export class UnknownVariant extends DomainError {
  readonly code = 'menu.variant.unknown';

  constructor(
    readonly productName: string,
    readonly variantKey: string,
  ) {
    super(`Le format « ${variantKey} » n'existe pas pour « ${productName} »`);
  }
}

export class UnknownOption extends DomainError {
  readonly code = 'menu.option.unknown';

  constructor(
    readonly productName: string,
    readonly detail: string,
  ) {
    super(`Choix indisponible pour « ${productName} » : ${detail}`);
  }
}

/**
 * Retrait non prévu par la fiche produit.
 * On refuse plutôt que d'ignorer : un « sans gluten » avalé en silence par la
 * caisse et jamais imprimé en cuisine, c'est une assiette renvoyée — ou pire.
 */
export class RemovalNotAllowed extends DomainError {
  readonly code = 'menu.removal.refused';

  constructor(
    readonly productName: string,
    readonly label: string,
  ) {
    super(`« ${productName} » ne peut pas être servi sans ${label}`);
  }
}
