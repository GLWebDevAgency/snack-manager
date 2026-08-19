import { describe, expect, it } from 'vitest';
import { CategoryUpdateSchema, ProductUpdateSchema } from './index';

/**
 * Régression : `.partial()` de zod garde les `.default()` des champs.
 * Un PATCH partiel ressortait donc de la validation avec price: 0,
 * variants: [], optionGroups: [] — et écrasait le produit en base.
 * Trois produits de la carte pilote ont réellement perdu leur prix.
 */
describe('mise à jour partielle d’un produit', () => {
  it('ne réintroduit aucun champ absent de la requête', () => {
    const parsed = ProductUpdateSchema.parse({ tags: ['midi'] });
    expect(parsed).toEqual({ tags: ['midi'] });
    expect('price' in parsed).toBe(false);
    expect('variants' in parsed).toBe(false);
    expect('optionGroups' in parsed).toBe(false);
    expect('active' in parsed).toBe(false);
  });

  it('renommer un produit ne touche pas à son prix', () => {
    const parsed = ProductUpdateSchema.parse({ name: 'Kebab maison' });
    expect(parsed).toEqual({ name: 'Kebab maison' });
  });

  it('accepte une remise à zéro explicite du prix', () => {
    // Distinguer « non transmis » de « volontairement à zéro » : un produit
    // dont le prix reste à définir est un cas légitime de la carte.
    expect(ProductUpdateSchema.parse({ price: 0 })).toEqual({ price: 0 });
  });

  it('refuse un prix négatif', () => {
    expect(ProductUpdateSchema.safeParse({ price: -100 }).success).toBe(false);
  });
});

describe('mise à jour partielle d’une catégorie', () => {
  it('ne réintroduit ni ordre ni activation', () => {
    const parsed = CategoryUpdateSchema.parse({ name: 'Tacos' });
    expect(parsed).toEqual({ name: 'Tacos' });
  });
});
