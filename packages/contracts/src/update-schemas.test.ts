import { describe, expect, it } from 'vitest';
import {
  BrandUpdateSchema,
  CategoryUpdateSchema,
  IngredientUpdateSchema,
  LeadUpdateSchema,
  ProductUpdateSchema,
  SupplierUpdateSchema,
} from './index';

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

/**
 * LE MÊME PIÈGE, PARTOUT OÙ IL PEUT SE TENDRE.
 *
 * Le défaut n'est pas propre aux produits : il naît mécaniquement dès qu'un
 * schéma de mise à jour est dérivé d'un schéma de création qui porte un
 * `.default()`. Il était encore armé sur les marques d'ingrédients —
 * `preferred: z.boolean().default(false)` — où corriger le nom d'une marque
 * lui aurait retiré son statut de marque préférée, en silence. Le gérant ne
 * l'aurait découvert qu'à la commande suivante, au mauvais prix.
 *
 * Ce bloc balaie donc TOUS les schémas de mise à jour du projet avec la même
 * question : « une requête d'un seul champ ressort-elle avec un seul champ ? »
 * Un schéma ajouté demain sans cette précaution fera rougir ce fichier.
 */
describe('aucun schéma de mise à jour ne réintroduit de valeur par défaut', () => {
  const CAS = [
    ['produit', ProductUpdateSchema, { name: 'Kebab' }],
    ['catégorie', CategoryUpdateSchema, { name: 'Tacos' }],
    ['ingrédient', IngredientUpdateSchema, { name: 'Tomate' }],
    ['marque', BrandUpdateSchema, { name: 'Bridor' }],
    ['fournisseur', SupplierUpdateSchema, { name: 'SDA Market' }],
    ['lead', LeadUpdateSchema, { restaurantName: 'Pizza Vita' }],
  ] as const;

  for (const [nom, schema, requete] of CAS) {
    it(`${nom} : un champ envoyé, un champ ressorti`, () => {
      expect(schema.parse(requete)).toEqual(requete);
    });
  }

  it('marque : corriger le nom ne retire pas le statut « préférée »', () => {
    // Le cas réel : `preferred` porte `.default(false)` à la création. Avec
    // `.partial()`, cette valeur revenait dans la charge validée et écrasait
    // la marque préférée du gérant.
    const parsed = BrandUpdateSchema.parse({ name: 'Bridor' });
    expect('preferred' in parsed).toBe(false);
  });

  it('marque : mais un retrait EXPLICITE reste possible', () => {
    // Distinguer « non transmis » de « volontairement retiré » : sans ça, on
    // corrigerait le bug en rendant le champ immodifiable.
    expect(BrandUpdateSchema.parse({ preferred: false })).toEqual({ preferred: false });
  });
});
