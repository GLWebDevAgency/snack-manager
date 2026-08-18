import { describe, expect, it } from 'vitest';
import { Money } from '../shared/money';
import { unwrap } from '../shared/result';
import { Ingredient } from './ingredient';
import { Quantity } from './units';

const viande = (patch: { stock?: number; parLevel?: number; isOut?: boolean } = {}): Ingredient =>
  unwrap(
    Ingredient.create({
      name: 'Viande kebab',
      unit: 'kg',
      costPerUnit: Money.fromCents(1290),
      allergens: [],
      stock: 8,
      parLevel: 5,
      ...patch,
    }),
  );

describe('Ingredient', () => {
  it('facture une pesée de recette au prorata du prix d’achat', () => {
    // 150 g de viande à 12,90 € le kilo = 1,94 € sur la ligne.
    const cost = unwrap(viande().costOf(unwrap(Quantity.of(150, 'g'))));
    expect(cost.format()).toBe('1,94 €');
  });

  it('refuse de compter en pièces un ingrédient acheté au kilo', () => {
    // « 2 pièces de viande kebab » est une faute de saisie courante ; laisser
    // passer donnerait 25,80 € de viande sur un tacos.
    const wrong = viande().costOf(unwrap(Quantity.of(2, 'pcs')));
    expect(wrong.ok).toBe(false);
    if (!wrong.ok) expect(wrong.error.code).toBe('unit.incompatible');
  });

  it('alerte au réassort dès que le stock passe sous le seuil', () => {
    expect(viande({ stock: 8, parLevel: 5 }).isBelowPar()).toBe(false);
    expect(viande({ stock: 4.5, parLevel: 5 }).isBelowPar()).toBe(true);
    // Seuil atteint pile : on ne commande pas encore.
    expect(viande({ stock: 5, parLevel: 5 }).isBelowPar()).toBe(false);
  });

  it('n’alerte jamais sur un ingrédient dont le seuil n’est pas renseigné', () => {
    // Sinon le tableau de bord est rouge en permanence à l'ouverture du compte,
    // et plus personne ne le regarde.
    expect(viande({ stock: 0, parLevel: 0 }).isBelowPar()).toBe(false);
  });

  it('devient indisponible en rupture déclarée comme en stock épuisé', () => {
    expect(viande().isAvailable()).toBe(true);
    expect(viande({ isOut: true }).isAvailable()).toBe(false);
    expect(viande({ stock: 0 }).isAvailable()).toBe(false);
  });

  it('trie ses allergènes dès la fiche, dans l’ordre réglementaire', () => {
    const cordonBleu = unwrap(
      Ingredient.create({
        name: 'Cordon bleu',
        unit: 'pcs',
        costPerUnit: Money.fromCents(210),
        allergens: ['lait', 'gluten', 'oeufs'],
      }),
    );
    expect(cordonBleu.allergens).toEqual(['gluten', 'oeufs', 'lait']);
  });

  it('refuse une fiche sans nom ou à coût négatif', () => {
    const nameless = Ingredient.create({
      name: ' ',
      unit: 'kg',
      costPerUnit: Money.fromCents(100),
    });
    expect(nameless.ok).toBe(false);
    if (!nameless.ok) expect(nameless.error.code).toBe('ingredient.invalid');

    expect(
      Ingredient.create({ name: 'Frites', unit: 'kg', costPerUnit: Money.fromCents(-1) }).ok,
    ).toBe(false);
  });
});
