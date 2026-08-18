import { InvalidSelection } from './errors';
import type { OptionChoice } from './option-choice';
import type { OptionGroup } from './option-group';
import type { Money } from '../shared/money';
import { err, ok, type Result } from '../shared/result';

/**
 * Ce que le client coche à l'écran : deux clés, aucun prix.
 *
 * Le panier ne transporte JAMAIS de montant — sinon un client bricoleur
 * commanderait un XXL quatre viandes à 1 €. Les prix sont résolus contre la
 * carte au moment de valider la commande (cf. `validateSelection`).
 */
export class OptionSelection {
  private constructor(
    readonly groupKey: string,
    readonly choiceKey: string,
  ) {}

  static create(groupKey: string, choiceKey: string): Result<OptionSelection, InvalidSelection> {
    const group = groupKey.trim();
    const choice = choiceKey.trim();

    if (!group || !choice) {
      return err(new InvalidSelection('Sélection incomplète : groupe et choix sont requis'));
    }

    return ok(new OptionSelection(group, choice));
  }
}

/**
 * Option résolue contre la carte : libellés ET supplément FIGÉS.
 *
 * C'est cette forme-là qui part sur la ligne de commande. Le ticket doit rester
 * lisible et vérifiable des années après, même si le restaurateur a depuis
 * renommé « Kefta » en « Kefta maison » ou fait passer le gratiné à 2,50 €.
 *
 * Pas de `Result` ici : la fabrique reçoit un groupe et un choix déjà validés,
 * il n'y a plus rien à refuser. La validation a eu lieu en amont.
 */
export class SelectedOption {
  private constructor(
    readonly groupKey: string,
    readonly groupName: string,
    readonly choiceKey: string,
    readonly choiceName: string,
    readonly priceDelta: Money,
  ) {}

  static resolve(group: OptionGroup, choice: OptionChoice, priceDelta: Money): SelectedOption {
    return new SelectedOption(group.key, group.name, choice.key, choice.name, priceDelta);
  }

  /** Empreinte stable, utilisée pour comparer deux configurations de ligne. */
  identity(): string {
    return `${this.groupKey}:${this.choiceKey}`;
  }

  equals(other: SelectedOption): boolean {
    return this.identity() === other.identity() && this.priceDelta.equals(other.priceDelta);
  }

  toJSON(): { groupKey: string; choiceKey: string; name: string; priceDelta: number } {
    return {
      groupKey: this.groupKey,
      choiceKey: this.choiceKey,
      name: this.choiceName,
      priceDelta: this.priceDelta.cents,
    };
  }
}
