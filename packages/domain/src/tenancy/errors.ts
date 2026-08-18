import { DomainError } from '../shared/errors';

/**
 * Erreurs propres au sous-domaine RESTAURANT.
 *
 * `shared/errors.ts` ne porte que les erreurs transverses (montant, slug,
 * domaine) ; celles-ci ne parlent qu'aux horaires, aux créneaux et à la marque.
 * Les garder ici évite de faire enfler un fichier que tout le monde importe.
 */

/** Horaires incohérents saisis dans le back-office (fermeture avant ouverture…). */
export class InvalidServiceHours extends DomainError {
  readonly code = 'hours.invalid';
}

/** Heure murale illisible (« 25h », « midi »). */
export class InvalidWallTime extends DomainError {
  readonly code = 'hours.time';
}

/** Date calendaire inexistante ou mal formée. */
export class InvalidCalendarDay extends DomainError {
  readonly code = 'day.invalid';
}

/** Fermeture exceptionnelle mal bornée. */
export class InvalidClosure extends DomainError {
  readonly code = 'closure.invalid';
}

/** Réglage des créneaux hors bornes (pas de 0 minute, capacité négative…). */
export class InvalidSlotPolicy extends DomainError {
  readonly code = 'slot.policy';
}

/** Couleur de marque illisible. */
export class InvalidBrandColor extends DomainError {
  readonly code = 'brand.color';
}

/**
 * Tentative de personnaliser une couleur FONCTIONNELLE.
 *
 * Règle produit, pas contrainte technique : vert = prêt, rouge = urgent,
 * ambre = en attente, sur tous les comptes. Une équipe formée chez un client
 * doit savoir travailler chez le suivant sans réapprendre le code couleur.
 */
export class FunctionalColorLocked extends DomainError {
  readonly code = 'brand.locked';

  constructor(readonly role: string) {
    super(
      `La couleur « ${role} » est standard sur tous les restaurants et ne peut pas être personnalisée. Seule la couleur d'accent vous appartient.`,
    );
  }
}

/** Identité du restaurant incomplète. */
export class InvalidRestaurant extends DomainError {
  readonly code = 'restaurant.invalid';
}

/** Le même nom de domaine est déjà rattaché à ce restaurant. */
export class DomainAlreadyAttached extends DomainError {
  readonly code = 'domain.duplicate';

  constructor(domain: string) {
    super(`« ${domain} » est déjà rattaché à ce restaurant`);
  }
}
