import { DomainError } from '../shared/errors';

/**
 * Erreurs propres au sous-domaine COMMANDE.
 *
 * Les deux erreurs les plus structurantes vivent ailleurs, parce qu'elles sont
 * citées par tout le produit : `IllegalTransition` (machine à états) et
 * `AuthorizationRequired` (NF525) sont dans `shared/errors`.
 */

export class InvalidOrderNumber extends DomainError {
  readonly code = 'order.number.invalid';
}

/** Ligne mal formée : quantité aberrante, note à rallonge, prix négatif. */
export class InvalidOrderLine extends DomainError {
  readonly code = 'order.line.invalid';
}

/** Une commande sans article n'existe pas : rien à préparer, rien à encaisser. */
export class EmptyOrder extends DomainError {
  readonly code = 'order.empty';

  constructor(message = 'Une commande sans article ne peut pas être enregistrée') {
    super(message);
  }
}

export class LineNotFound extends DomainError {
  readonly code = 'order.line.unknown';

  constructor(readonly position: number) {
    super(`Ligne n° ${position + 1} introuvable sur cette commande`);
  }
}

/**
 * Commande servie ou annulée : on ne la retouche plus.
 * Après « livrée », corriger passe par un remboursement tracé, pas par une
 * modification du ticket — sinon l'archive NF525 ne veut plus rien dire.
 */
export class OrderClosed extends DomainError {
  readonly code = 'order.closed';

  constructor(readonly action: string) {
    super(`Commande clôturée : « ${action} » n'est plus possible`);
  }
}

export class InvalidDiscount extends DomainError {
  readonly code = 'order.discount.invalid';
}
