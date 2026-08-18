import { Money } from '../shared/money';
import { sortAllergens, type Allergen } from './allergen';
import type { OptionGroup, Recipe } from './recipe';

/**
 * Coût matière, marge et allergènes d'un produit.
 *
 * ── La règle qui coûte cher quand on l'oublie ──
 * Les options IMPOSÉES font partie du prix de revient. Un tacos M dont le
 * groupe « Viandes » exige un choix ne se fabrique pas sans viande : compter
 * seulement la recette de base (galette, frites, sauce) affiche 91 % de marge
 * sur un produit qui en fait 62 %. Le gérant fixe alors ses prix sur un chiffre
 * faux — c'est un bug qui se paie en euros, pas en tickets d'incident.
 *
 * À l'inverse, la sauce samouraï en supplément n'entre PAS dans le coût du
 * produit : elle est facturée à part et le client peut s'en passer.
 *
 * Service sans état : ces fonctions ne font que lire des value objects déjà
 * valides. Elles sont donc totales — aucune ne renvoie de `Result`.
 */

/** Marge dégagée par un produit, en euros et en pourcentage. */
export class Margin {
  private constructor(
    /** Prix de vente moins coût matière complet. Négatif = vendu à perte. */
    readonly amount: Money,
    /** Part du prix qui reste au restaurant, en % à une décimale. */
    readonly percent: number,
    /**
     * Part du prix mangée par la matière première — l'indicateur que les
     * restaurateurs suivent réellement (cible usuelle : 30 % environ).
     */
    readonly foodCostPercent: number,
  ) {}

  static of(price: Money, cost: Money): Margin {
    const amount = price.minus(cost);
    // `ratioOf` renvoie 0 sur un prix nul : un produit offert n'a pas de marge
    // à afficher, et surtout pas une division par zéro.
    return new Margin(amount, amount.ratioOf(price), cost.ratioOf(price));
  }

  isNegative(): boolean {
    return this.amount.isNegative();
  }

  /** « 4,66 € · 62,1 % ». */
  format(): string {
    return `${this.amount.format()} · ${String(this.percent).replace('.', ',')} %`;
  }
}

/** Fourchette de coût d'un produit selon les options imposées retenues. */
export interface CostRange {
  /** Assortiment imposé le moins cher. */
  readonly min: Money;
  /** Estimation affichée par défaut (moyenne des choix imposés). */
  readonly typical: Money;
  /** Assortiment imposé le plus cher — la marge plancher. */
  readonly max: Money;
}

/**
 * Coût matière complet d'un produit : recette de base + options imposées.
 *
 * On peut passer TOUS les groupes du produit : les facultatifs sont écartés
 * ici. Un appelant ne peut donc ni gonfler le coût en oubliant de filtrer, ni
 * le sous-estimer en oubliant les imposés.
 */
export function costOf(
  recipe: Recipe | null,
  requiredOptions: readonly OptionGroup[] = [],
): Money {
  const base = recipe?.cost() ?? Money.ZERO;
  const imposed = requiredOptions.filter((g) => g.isRequired()).map((g) => g.typicalCost());
  return base.plus(Money.sum(imposed));
}

/**
 * Fourchette du coût selon l'assortiment imposé choisi par le client.
 *
 * Utile là où la moyenne trompe : si la viande la moins chère et la plus chère
 * diffèrent de 50 centimes, la marge annoncée n'est pas la marge du pire cas.
 */
export function costRangeOf(
  recipe: Recipe | null,
  options: readonly OptionGroup[] = [],
): CostRange {
  const base = recipe?.cost() ?? Money.ZERO;
  const required = options.filter((g) => g.isRequired());
  return {
    min: base.plus(Money.sum(required.map((g) => g.cheapestCost()))),
    typical: base.plus(Money.sum(required.map((g) => g.typicalCost()))),
    max: base.plus(Money.sum(required.map((g) => g.dearestCost()))),
  };
}

/** Marge dégagée par un prix de vente face à un coût matière. */
export function marginOf(price: Money, cost: Money): Margin {
  return Margin.of(price, cost);
}

/**
 * Allergènes déclarés pour un produit : recette + TOUTES ses options.
 *
 * Y compris les options facultatives : un client allergique aux fruits à coque
 * doit voir le risque AVANT d'ouvrir le configurateur, pas après avoir cliqué
 * sur la sauce qui en contient. Pour la fiche d'une commande déjà configurée,
 * on ne passe que les choix retenus.
 *
 * Fonction totale, triée dans l'ordre de l'annexe INCO : l'affichage des
 * allergènes est une obligation légale, elle ne peut ni échouer ni surprendre.
 */
export function allergensOf(
  recipe: Recipe | null,
  options: readonly OptionGroup[] = [],
): readonly Allergen[] {
  return sortAllergens([
    ...(recipe?.allergens() ?? []),
    ...options.flatMap((g) => g.allergens()),
  ]);
}

/** Le service, regroupé — même responsabilité, une seule porte d'entrée. */
export const FoodCost = {
  costOf,
  costRangeOf,
  marginOf,
  allergensOf,
} as const;
