import { InvalidMenuDefinition } from './errors';
import { Money } from '../shared/money';
import { err, ok, type Result } from '../shared/result';

/**
 * Format d'un produit : tacos M/L/XL/XXL, smash simple/double/triple,
 * barquette M/L, tex-mex 5 ou 10 pièces.
 *
 * Une variante porte SON prix, pas un supplément : chez Class'Food le tacos XXL
 * est à 14,50 € et non « 8,90 € + 5,60 € ». Modéliser un delta obligerait le
 * restaurateur à recalculer quatre lignes quand il augmente le M de 20 centimes.
 *
 * La `key` est l'identité de la variante à l'intérieur de son produit : c'est
 * elle que le panier hors ligne stocke et que les dérogations par variante
 * (`OptionGroup`) désignent. Elle ne bouge jamais, le `name` si.
 */
export class Variant {
  private constructor(
    readonly key: string,
    readonly name: string,
    readonly price: Money,
  ) {}

  static create(input: { key: string; name: string; price: Money }): Result<
    Variant,
    InvalidMenuDefinition
  > {
    const key = input.key.trim();
    const name = input.name.trim();

    if (!key) {
      return err(new InvalidMenuDefinition('Une variante doit avoir une clé'));
    }
    if (!name) {
      return err(new InvalidMenuDefinition(`La variante « ${key} » doit avoir un libellé`));
    }
    // Un prix de vente négatif n'existe pas : un produit offert vaut 0.
    if (input.price.isNegative()) {
      return err(
        new InvalidMenuDefinition(`Prix négatif pour la variante « ${name} » : ${input.price.format()}`),
      );
    }

    return ok(new Variant(key, name, input.price));
  }

  equals(other: Variant): boolean {
    return this.key === other.key;
  }

  toJSON(): { key: string; name: string; price: number } {
    return { key: this.key, name: this.name, price: this.price.cents };
  }
}
