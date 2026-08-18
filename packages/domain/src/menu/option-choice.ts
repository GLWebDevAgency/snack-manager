import { InvalidMenuDefinition } from './errors';
import { Money } from '../shared/money';
import { err, ok, type Result } from '../shared/result';

/**
 * Un choix possible dans un groupe d'options : « Kebab », « Cheddar »,
 * « Tacos gratiné », « Sauce algérienne ».
 *
 * `priceDelta` est le supplément PAR DÉFAUT du choix. Il peut être écrasé par
 * une dérogation de variante (le gratiné vaut 1,50 € en M/L et 2,00 € en
 * XL/XXL) : cf. `resolveRule`. Il peut être négatif — « sans boisson » sur un
 * menu enfant se facture moins cher.
 *
 * `available` couvre la rupture d'un ingrédient précis : à 22 h il n'y a plus
 * de cordon bleu, mais le tacos reste commandable avec les neuf autres viandes.
 * Mettre le produit entier en rupture pour ça ferait perdre la moitié du
 * service du soir.
 */
export class OptionChoice {
  private constructor(
    readonly key: string,
    readonly name: string,
    readonly priceDelta: Money,
    private readonly available: boolean,
  ) {}

  static create(input: {
    key: string;
    name: string;
    priceDelta?: Money;
    available?: boolean;
  }): Result<OptionChoice, InvalidMenuDefinition> {
    const key = input.key.trim();
    const name = input.name.trim();

    if (!key) {
      return err(new InvalidMenuDefinition("Un choix d'option doit avoir une clé"));
    }
    if (!name) {
      return err(new InvalidMenuDefinition(`Le choix « ${key} » doit avoir un libellé`));
    }

    return ok(
      new OptionChoice(key, name, input.priceDelta ?? Money.ZERO, input.available ?? true),
    );
  }

  isAvailable(): boolean {
    return this.available;
  }

  /** Rupture d'ingrédient — la carte ne change pas, la disponibilité oui. */
  withAvailability(available: boolean): OptionChoice {
    return new OptionChoice(this.key, this.name, this.priceDelta, available);
  }

  toJSON(): { key: string; name: string; priceDelta: number } {
    return { key: this.key, name: this.name, priceDelta: this.priceDelta.cents };
  }
}
