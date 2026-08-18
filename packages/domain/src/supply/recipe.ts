import { invariant } from '../shared/errors';
import { Money } from '../shared/money';
import { err, ok, type Result } from '../shared/result';
import { sortAllergens, type Allergen } from './allergen';
import { IncompatibleUnits, InvalidOptionGroup, InvalidRecipe } from './errors';
import type { Ingredient } from './ingredient';
import type { Quantity } from './units';

/**
 * Nomenclatures : la recette d'un produit, et celle de chacun de ses choix
 * d'option.
 *
 * Une ligne porte l'ingrédient LUI-MÊME, pas une référence à résoudre plus
 * tard. Conséquence voulue : `cost()` et `allergens()` sont des fonctions
 * totales, sans catalogue à charger ni cas « ingrédient introuvable » à gérer
 * au moment précis où l'on affiche une carte à un client allergique.
 */

export class RecipeLine {
  private constructor(
    readonly ingredient: Ingredient,
    readonly quantity: Quantity,
  ) {}

  /** Seule porte d'entrée : la compatibilité d'unité est vérifiée ici, une fois. */
  static create(
    ingredient: Ingredient,
    quantity: Quantity,
  ): Result<RecipeLine, IncompatibleUnits> {
    const probe = ingredient.costOf(quantity);
    if (!probe.ok) return err(probe.error);
    return ok(new RecipeLine(ingredient, quantity));
  }

  cost(): Money {
    const cost = this.ingredient.costOf(this.quantity);
    // La construction l'a déjà garanti : un échec ici serait un bug, pas une saisie.
    invariant(cost.ok, `ligne de recette incohérente : ${this.ingredient.name}`);
    return cost.value;
  }

  allergens(): readonly Allergen[] {
    return this.ingredient.allergens;
  }

  /** « Viande kebab · 150 g · 1,94 € ». */
  label(): string {
    return `${this.ingredient.name} · ${this.quantity.format()} · ${this.cost().format()}`;
  }
}

export class Recipe {
  private constructor(readonly lines: readonly RecipeLine[]) {}

  static create(lines: readonly RecipeLine[]): Result<Recipe, InvalidRecipe> {
    if (lines.length === 0) {
      // Une nomenclature vide et une nomenclature absente sont la même chose :
      // on ne laisse pas coexister deux façons de dire « pas encore saisie ».
      return err(new InvalidRecipe('Une recette sans ligne ne se distingue pas d’une recette absente'));
    }

    const seen = new Set<string>();
    for (const line of lines) {
      const name = line.ingredient.name;
      if (seen.has(name)) {
        // Deux lignes du même ingrédient = une saisie dédoublée. La fusion
        // silencieuse masquerait l'erreur et fausserait le coût affiché.
        return err(new InvalidRecipe(`« ${name} » apparaît deux fois dans la recette`));
      }
      seen.add(name);
    }

    return ok(new Recipe(lines));
  }

  cost(): Money {
    return Money.sum(this.lines.map((l) => l.cost()));
  }

  allergens(): readonly Allergen[] {
    return sortAllergens(this.lines.flatMap((l) => l.allergens()));
  }

  /** Ingrédients qui bloquent la production — rupture ou stock à zéro. */
  missingIngredients(): readonly Ingredient[] {
    return this.lines.map((l) => l.ingredient).filter((i) => !i.isAvailable());
  }

  isProducible(): boolean {
    return this.missingIngredients().length === 0;
  }
}

/**
 * Un choix d'option (« Kebab » dans le groupe « Viandes »).
 *
 * `recipe` à `null` : le choix existe à la carte mais sa nomenclature n'est pas
 * saisie. Il coûte alors 0 et n'apporte aucun allergène — c'est la vérité de ce
 * qu'on sait, et l'écran « recette à compléter » s'occupe du reste.
 */
export class OptionChoice {
  private constructor(
    readonly name: string,
    readonly recipe: Recipe | null,
  ) {}

  static create(name: string, recipe: Recipe | null = null): Result<OptionChoice, InvalidRecipe> {
    const cleaned = name.trim();
    if (cleaned.length === 0) {
      return err(new InvalidRecipe("Le nom du choix d'option est obligatoire"));
    }
    return ok(new OptionChoice(cleaned, recipe));
  }

  cost(): Money {
    return this.recipe?.cost() ?? Money.ZERO;
  }

  allergens(): readonly Allergen[] {
    return this.recipe?.allergens() ?? [];
  }

  isProducible(): boolean {
    return this.recipe?.isProducible() ?? true;
  }
}

/**
 * Un groupe d'options du produit (« Viandes : 1 choix obligatoire »).
 *
 * `minChoices ≥ 1` ⇒ le groupe est IMPOSÉ : le client ne peut pas y échapper,
 * donc son coût fait partie du prix de revient du produit. C'est toute la
 * différence entre la viande d'un tacos et la sauce samouraï en supplément.
 */
export class OptionGroup {
  private constructor(
    readonly name: string,
    readonly minChoices: number,
    readonly maxChoices: number,
    readonly choices: readonly OptionChoice[],
  ) {}

  static create(group: {
    name: string;
    choices: readonly OptionChoice[];
    minChoices?: number;
    maxChoices?: number;
  }): Result<OptionGroup, InvalidOptionGroup> {
    const name = group.name.trim();
    if (name.length === 0) {
      return err(new InvalidOptionGroup('Le nom du groupe d’options est obligatoire'));
    }

    const min = group.minChoices ?? 0;
    const max = group.maxChoices ?? Math.max(min, group.choices.length);

    if (!Number.isInteger(min) || min < 0) {
      return err(new InvalidOptionGroup(`« ${name} » : nombre minimum de choix invalide`));
    }
    if (!Number.isInteger(max) || max < min) {
      return err(
        new InvalidOptionGroup(`« ${name} » : le maximum (${max}) est inférieur au minimum (${min})`),
      );
    }
    if (min >= 1 && group.choices.length === 0) {
      return err(
        new InvalidOptionGroup(`« ${name} » impose ${min} choix mais n’en propose aucun`),
      );
    }

    const seen = new Set<string>();
    for (const choice of group.choices) {
      if (seen.has(choice.name)) {
        return err(new InvalidOptionGroup(`« ${name} » : le choix « ${choice.name} » est saisi deux fois`));
      }
      seen.add(choice.name);
    }

    return ok(new OptionGroup(name, min, max, group.choices));
  }

  /** Le client ne peut pas commander sans passer par ce groupe. */
  isRequired(): boolean {
    return this.minChoices >= 1;
  }

  /** Assortiment imposé le moins cher : le client prend n fois la viande la moins chère. */
  cheapestCost(): Money {
    return this.repeated((costs) => Math.min(...costs));
  }

  /** Assortiment imposé le plus cher — celui qui donne la marge plancher. */
  dearestCost(): Money {
    return this.repeated((costs) => Math.max(...costs));
  }

  /**
   * Coût moyen des choix imposés — ce qu'on affiche par défaut.
   *
   * Sur un menu où les viandes coûtent 1,60 €, 1,94 € et 2,10 €, aucune
   * moyenne n'est « la » vérité : c'est la seule estimation qui ne mente ni
   * dans un sens ni dans l'autre tant qu'on ne connaît pas le mix réel.
   */
  typicalCost(): Money {
    if (!this.isRequired() || this.choices.length === 0) return Money.ZERO;
    const total = this.choices.reduce((sum, c) => sum + c.cost().cents, 0);
    return Money.fromCents(Math.round((total / this.choices.length) * this.minChoices));
  }

  allergens(): readonly Allergen[] {
    return sortAllergens(this.choices.flatMap((c) => c.allergens()));
  }

  /**
   * Borne de l'assortiment imposé, un même choix pouvant être repris.
   *
   * Le tacos XXL impose QUATRE viandes alors que la carte n'en propose que
   * trois : rien n'empêche le client d'en prendre deux fois la même, et il ne
   * s'en prive pas. Compter au plus un exemplaire par choix plafonnerait le
   * coût du XXL à trois viandes — soit une marge surestimée sur le produit le
   * plus vendu du samedi soir.
   */
  private repeated(select: (costs: number[]) => number): Money {
    if (!this.isRequired() || this.choices.length === 0) return Money.ZERO;
    return Money.fromCents(select(this.choices.map((c) => c.cost().cents)) * this.minChoices);
  }
}
