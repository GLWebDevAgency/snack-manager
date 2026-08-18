import { InvalidMenuDefinition, UnknownVariant, VariantRequired } from './errors';
import type { OptionGroup } from './option-group';
import type { ProductId } from './product-id';
import type { Variant } from './variant';
import { Money } from '../shared/money';
import { err, ok, type Result } from '../shared/result';

/**
 * Compare deux libellés de retrait comme un humain les comparerait : la caisse
 * envoie « Sans Oignons », la fiche produit dit « oignons ». Refuser sur un
 * accent ou une majuscule ferait râler la cuisine, pas le développeur.
 */
function normalizeLabel(label: string): string {
  return label
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/^sans\s+/, '')
    .replace(/\s+/g, ' ');
}

/**
 * Un produit tel qu'il est servi : le tacos à composer, la barquette de frites,
 * le Smash, le tiramisu.
 *
 * Entité (elle a une identité stable, `id`) mais immuable : une rupture de
 * stock produit une NOUVELLE instance. Deux surfaces peuvent ainsi tenir la
 * même carte en mémoire sans se marcher dessus, et un test compare des états
 * plutôt que des effets de bord.
 *
 * Deux formes de tarification, jamais les deux à la fois :
 *  - prix simple (`price`) pour un produit sans format — le tiramisu à 3,50 € ;
 *  - une variante par format, chacune avec SON prix — le tacos M à 8,90 €.
 */
export class MenuItem {
  private constructor(
    readonly id: ProductId,
    readonly name: string,
    private readonly price: Money,
    readonly variants: readonly Variant[],
    readonly optionGroups: readonly OptionGroup[],
    readonly removables: readonly string[],
    private readonly outOfStock: boolean,
  ) {}

  static create(input: {
    id: ProductId;
    name: string;
    price?: Money;
    variants?: readonly Variant[];
    optionGroups?: readonly OptionGroup[];
    removables?: readonly string[];
    outOfStock?: boolean;
  }): Result<MenuItem, InvalidMenuDefinition> {
    const name = input.name.trim();
    if (!name) {
      return err(new InvalidMenuDefinition('Un produit doit avoir un nom'));
    }

    const price = input.price ?? Money.ZERO;
    if (price.isNegative()) {
      return err(new InvalidMenuDefinition(`Prix négatif pour « ${name} » : ${price.format()}`));
    }

    const variants = input.variants ?? [];
    const variantKeys = new Set<string>();
    for (const variant of variants) {
      if (variantKeys.has(variant.key)) {
        return err(
          new InvalidMenuDefinition(`« ${name} » déclare deux fois le format « ${variant.key} »`),
        );
      }
      variantKeys.add(variant.key);
    }

    const groups = input.optionGroups ?? [];
    const groupKeys = new Set<string>();
    for (const group of groups) {
      if (groupKeys.has(group.key)) {
        return err(
          new InvalidMenuDefinition(`« ${name} » déclare deux fois le groupe « ${group.key} »`),
        );
      }
      groupKeys.add(group.key);

      // Une dérogation qui vise un format inexistant est le pire des bugs de
      // carte : elle ne casse rien, elle facture simplement le mauvais prix.
      // Un « gratiné XLL » au lieu de « XXL », ce sont 50 centimes perdus sur
      // chaque tacos jusqu'à ce que quelqu'un compte la caisse.
      for (const overridden of group.overriddenVariants()) {
        if (!variantKeys.has(overridden)) {
          return err(
            new InvalidMenuDefinition(
              `Le groupe « ${group.name} » de « ${name} » vise un format inconnu : « ${overridden} »`,
            ),
          );
        }
      }
    }

    const removables: string[] = [];
    for (const raw of input.removables ?? []) {
      const label = raw.trim();
      if (!label) {
        return err(new InvalidMenuDefinition(`Retrait sans libellé sur « ${name} »`));
      }
      if (!removables.some((r) => normalizeLabel(r) === normalizeLabel(label))) {
        removables.push(label);
      }
    }

    return ok(
      new MenuItem(
        input.id,
        name,
        price,
        [...variants],
        [...groups],
        removables,
        input.outOfStock ?? false,
      ),
    );
  }

  /** Un produit en rupture ne part pas en cuisine, quel que soit le canal. */
  isAvailable(): boolean {
    return !this.outOfStock;
  }

  /** Rupture pilotée à la main par la caisse ou déduite d'un ingrédient épuisé. */
  withAvailability(available: boolean): MenuItem {
    return new MenuItem(
      this.id,
      this.name,
      this.price,
      this.variants,
      this.optionGroups,
      this.removables,
      !available,
    );
  }

  requiresVariant(): boolean {
    return this.variants.length > 0;
  }

  variant(key: string | null | undefined): Variant | undefined {
    if (key === null || key === undefined) return undefined;
    return this.variants.find((v) => v.key === key);
  }

  group(key: string): OptionGroup | undefined {
    return this.optionGroups.find((g) => g.key === key);
  }

  /**
   * Libellé exact du retrait tel qu'il doit être imprimé, ou `undefined` si le
   * produit ne l'autorise pas. On renvoie le libellé de la CARTE, pas celui
   * saisi : la cuisine lit toujours la même formulation.
   */
  canonicalRemoval(label: string): string | undefined {
    const wanted = normalizeLabel(label);
    return this.removables.find((r) => normalizeLabel(r) === wanted);
  }

  /** Prix d'appel affiché en carte : le format le moins cher (« à partir de 8,90 € »). */
  startingPrice(): Money {
    if (!this.requiresVariant()) return this.price;
    return this.variants.reduce<Money>(
      (cheapest, v) => (cheapest.greaterThan(v.price) ? v.price : cheapest),
      this.variants[0]!.price,
    );
  }

  /**
   * Prix de départ d'une configuration, avant suppléments.
   * Un produit à formats commandé sans format est refusé : servir un XXL au
   * prix du M parce que « c'est le premier de la liste » a déjà coûté cher.
   */
  basePriceFor(variantKey: string | null): Result<Money, VariantRequired | UnknownVariant> {
    if (!this.requiresVariant()) return ok(this.price);
    if (variantKey === null) return err(new VariantRequired(this.name));

    const variant = this.variant(variantKey);
    if (!variant) return err(new UnknownVariant(this.name, variantKey));

    return ok(variant.price);
  }
}
