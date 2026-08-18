import { Money } from '../shared/money';
import { err, ok, type Result } from '../shared/result';
import { sortAllergens, type Allergen } from './allergen';
import { IncompatibleUnits, InvalidIngredient } from './errors';
import { baseUnitOf, UNIT_LABELS, type BaseUnit, type Quantity } from './units';

/**
 * Ingrédient de la nomenclature.
 *
 * Son identité dans le domaine, c'est son NOM : la base impose déjà l'unicité
 * par restaurant, et un identifiant technique n'apprendrait rien au calcul du
 * coût matière. Le jour où deux ingrédients s'appellent pareil, c'est une
 * fiche en double à fusionner, pas un cas à gérer ici.
 */
export class Ingredient {
  private constructor(
    readonly name: string,
    /** Unité d'achat : le coût s'exprime par kg, par litre ou par pièce. */
    readonly unit: BaseUnit,
    readonly costPerUnit: Money,
    /** Triés dans l'ordre réglementaire dès la construction. */
    readonly allergens: readonly Allergen[],
    /** Stock courant, en unité d'achat. */
    readonly stock: number,
    /** Seuil de réassort. 0 = ingrédient non suivi. */
    readonly parLevel: number,
    /** Rupture déclarée au comptoir — coupe la vente des produits concernés. */
    readonly isOut: boolean,
  ) {}

  static create(ingredient: {
    name: string;
    unit: BaseUnit;
    costPerUnit: Money;
    allergens?: readonly Allergen[];
    stock?: number;
    parLevel?: number;
    isOut?: boolean;
  }): Result<Ingredient, InvalidIngredient> {
    const name = ingredient.name.trim();
    if (name.length === 0) {
      return err(new InvalidIngredient("Le nom de l'ingrédient est obligatoire"));
    }
    if (ingredient.costPerUnit.isNegative()) {
      return err(new InvalidIngredient(`« ${name} » : le coût d'achat ne peut pas être négatif`));
    }

    const stock = ingredient.stock ?? 0;
    const parLevel = ingredient.parLevel ?? 0;
    if (!Number.isFinite(stock) || !Number.isFinite(parLevel) || parLevel < 0) {
      return err(new InvalidIngredient(`« ${name} » : stock ou seuil de réassort illisible`));
    }

    return ok(
      new Ingredient(
        name,
        ingredient.unit,
        ingredient.costPerUnit,
        sortAllergens(ingredient.allergens ?? []),
        stock,
        parLevel,
        ingredient.isOut ?? false,
      ),
    );
  }

  /**
   * Faut-il recommander ?
   *
   * Comparaison stricte : un seuil laissé à 0 (le cas de la plupart des fiches
   * tant que le gérant n'a pas fait le tour de sa réserve) ne doit jamais
   * déclencher d'alerte, sinon le tableau de bord est rouge en permanence et
   * plus personne ne le regarde.
   */
  isBelowPar(): boolean {
    return this.parLevel > 0 && this.stock < this.parLevel;
  }

  /** Vendable : ni rupture déclarée, ni stock épuisé. */
  isAvailable(): boolean {
    return !this.isOut && this.stock > 0;
  }

  /**
   * Coût d'une quantité de recette.
   *
   * Échoue si l'unité pesée n'a rien à voir avec l'unité d'achat (« 2 pièces »
   * de viande vendue au kilo) : c'est une faute de saisie courante et il vaut
   * mieux la signaler que de sortir un coût inventé.
   */
  costOf(quantity: Quantity): Result<Money, IncompatibleUnits> {
    if (baseUnitOf(quantity.unit) !== this.unit) {
      return err(
        new IncompatibleUnits(
          `« ${this.name} » s'achète au ${UNIT_LABELS[this.unit]} : impossible d'en compter ${quantity.format()}.`,
        ),
      );
    }
    // Arrondi au centime À LA LIGNE, comme la fiche recette à l'écran : le
    // total lu par le gérant doit être exactement la somme des lignes affichées.
    return ok(Money.fromCents(Math.round(this.costPerUnit.cents * quantity.baseValue())));
  }

  withStock(stock: number): Result<Ingredient, InvalidIngredient> {
    return Ingredient.create({ ...this.snapshot(), stock });
  }

  markOut(isOut: boolean): Ingredient {
    return new Ingredient(
      this.name,
      this.unit,
      this.costPerUnit,
      this.allergens,
      this.stock,
      this.parLevel,
      isOut,
    );
  }

  equals(other: Ingredient): boolean {
    return this.name === other.name;
  }

  private snapshot() {
    return {
      name: this.name,
      unit: this.unit,
      costPerUnit: this.costPerUnit,
      allergens: this.allergens,
      parLevel: this.parLevel,
      isOut: this.isOut,
    };
  }
}
