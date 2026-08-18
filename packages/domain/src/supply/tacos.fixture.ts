import { Money } from '../shared/money';
import { unwrap } from '../shared/result';
import type { Allergen } from './allergen';
import { Ingredient } from './ingredient';
import { OptionChoice, OptionGroup, Recipe, RecipeLine } from './recipe';
import { Quantity, type BaseUnit, type MeasureUnit } from './units';

/**
 * Le tacos de Class'Food, tel qu'il est fabriqué — jeu d'essai des tests du
 * sous-domaine APPROVISIONNEMENT.
 *
 * Produit choisi à dessein : c'est celui qui a révélé le bug du coût matière.
 * Sa recette de base (galette, frites, sauce fromagère, emballage) ne coûte
 * qu'un peu plus d'un euro, mais aucun tacos ne sort de la cuisine sans
 * viande — et la viande, c'est presque les deux tiers du coût.
 *
 * Ce fichier n'a pas vocation à être exporté par le paquet.
 */

const ingredient = (
  name: string,
  unit: BaseUnit,
  costPerUnitCents: number,
  allergens: readonly Allergen[] = [],
  stock = 10,
): Ingredient =>
  unwrap(
    Ingredient.create({
      name,
      unit,
      costPerUnit: Money.fromCents(costPerUnitCents),
      allergens,
      stock,
      parLevel: 2,
    }),
  );

const line = (ing: Ingredient, value: number, unit: MeasureUnit): RecipeLine =>
  unwrap(RecipeLine.create(ing, unwrap(Quantity.of(value, unit))));

// ─── Ingrédients (coûts d'achat réels, en centimes par unité de base) ───

export const GALETTE = ingredient('Galette 30 cm', 'pcs', 45, ['gluten']);
export const FRITES = ingredient('Frites surgelées', 'kg', 220);
export const SAUCE_FROMAGERE = ingredient('Sauce fromagère', 'l', 480, ['lait']);
export const EMBALLAGE = ingredient('Barquette tacos', 'pcs', 12);

export const VIANDE_KEBAB = ingredient('Viande kebab', 'kg', 1290);
export const MERGUEZ = ingredient('Merguez', 'kg', 1150);
export const CORDON_BLEU = ingredient('Cordon bleu', 'pcs', 210, ['gluten', 'lait', 'oeufs']);

export const SAUCE_SAMOURAI = ingredient('Sauce samouraï', 'l', 620, [
  'moutarde',
  'oeufs',
  'sulfites',
]);

// ─── Recette de base : ce qu'un tacos contient hors viande (1,02 €) ───

export const tacosRecipe = (): Recipe =>
  unwrap(
    Recipe.create([
      line(GALETTE, 1, 'pcs'),
      line(FRITES, 120, 'g'),
      line(SAUCE_FROMAGERE, 40, 'ml'),
      line(EMBALLAGE, 1, 'pcs'),
    ]),
  );

// ─── Options ───

const meatChoices = (): readonly OptionChoice[] => [
  unwrap(OptionChoice.create('Kebab', unwrap(Recipe.create([line(VIANDE_KEBAB, 150, 'g')])))),
  unwrap(OptionChoice.create('Merguez', unwrap(Recipe.create([line(MERGUEZ, 140, 'g')])))),
  unwrap(OptionChoice.create('Cordon bleu', unwrap(Recipe.create([line(CORDON_BLEU, 1, 'pcs')])))),
];

/** Groupe IMPOSÉ : pas de tacos sans viande (1,94 € / 1,61 € / 2,10 €). */
export const viandesM = (): OptionGroup =>
  unwrap(
    OptionGroup.create({ name: 'Viandes', minChoices: 1, maxChoices: 1, choices: meatChoices() }),
  );

/** Le XXL en impose quatre — pour trois viandes à la carte. */
export const viandesXXL = (): OptionGroup =>
  unwrap(
    OptionGroup.create({ name: 'Viandes', minChoices: 4, maxChoices: 4, choices: meatChoices() }),
  );

/** Groupe FACULTATIF : la samouraï est un supplément, elle n'est pas dans le prix. */
export const saucesSupplement = (): OptionGroup =>
  unwrap(
    OptionGroup.create({
      name: 'Sauces en supplément',
      minChoices: 0,
      maxChoices: 2,
      choices: [
        unwrap(
          OptionChoice.create(
            'Samouraï',
            unwrap(Recipe.create([line(SAUCE_SAMOURAI, 25, 'ml')])),
          ),
        ),
        unwrap(OptionChoice.create('Sans sauce')),
      ],
    }),
  );

/** Prix de vente affiché du tacos M. */
export const PRIX_TACOS_M = Money.fromCents(850);
