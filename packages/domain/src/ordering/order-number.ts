import { InvalidOrderNumber } from './errors';
import { err, ok, type Result } from '../shared/result';

/**
 * Numéro d'appel d'une commande — celui qu'on crie au comptoir et qu'on
 * imprime en gros sur le ticket.
 *
 * C'est une séquence JOURNALIÈRE par restaurant, remise à 1 chaque jour de
 * service : au bout de trois semaines un compteur global afficherait « 4127 »,
 * illisible à l'oral et impossible à retenir pour le client debout devant la
 * vitrine. La remise à zéro est le travail de l'infrastructure (un compteur
 * atomique par tenant et par jour) ; ce value object garantit seulement qu'un
 * numéro reste un entier appelable.
 */
export class OrderNumber {
  private constructor(readonly value: number) {}

  /** Un service qui dépasserait 9 999 commandes en une journée est un bug, pas un succès. */
  private static readonly MAX = 9999;

  static create(value: number): Result<OrderNumber, InvalidOrderNumber> {
    if (!Number.isInteger(value)) {
      return err(new InvalidOrderNumber(`Numéro de commande non entier : ${value}`));
    }
    if (value < 1) {
      return err(new InvalidOrderNumber(`Numéro de commande invalide : ${value}`));
    }
    if (value > OrderNumber.MAX) {
      return err(
        new InvalidOrderNumber(
          `Numéro de commande hors séquence journalière : ${value} (maximum ${OrderNumber.MAX})`,
        ),
      );
    }

    return ok(new OrderNumber(value));
  }

  /** Trois chiffres sur le ticket et l'écran d'appel : « 042 » se lit de loin. */
  format(): string {
    return String(this.value).padStart(3, '0');
  }

  equals(other: OrderNumber): boolean {
    return this.value === other.value;
  }

  toString(): string {
    return this.format();
  }

  toJSON(): number {
    return this.value;
  }
}
