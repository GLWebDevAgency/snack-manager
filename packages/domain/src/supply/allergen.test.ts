import { describe, expect, it } from 'vitest';
import { ALLERGENS, formatAllergens, isAllergen, sortAllergens } from './allergen';

describe('Allergen', () => {
  it('couvre les 14 allergènes à déclaration obligatoire', () => {
    // Annexe II du règlement (UE) 1169/2011 — ni 13 ni 15.
    expect(ALLERGENS).toHaveLength(14);
    expect(new Set(ALLERGENS).size).toBe(14);
  });

  it('trie dans l’ordre du règlement, pas dans l’ordre de saisie', () => {
    // Le gérant saisit sa sauce avant sa galette ; la carte doit malgré tout
    // lister « Gluten, Lait, Sésame » dans l'ordre de l'annexe.
    expect(sortAllergens(['sesame', 'lait', 'gluten'])).toEqual(['gluten', 'lait', 'sesame']);
  });

  it('ne trie pas par ordre alphabétique', () => {
    // Piège classique : « Céleri » passerait avant « Gluten » alors que le
    // règlement place le gluten en tête.
    expect(sortAllergens(['celeri', 'gluten'])).toEqual(['gluten', 'celeri']);
  });

  it('dédoublonne un allergène apporté par plusieurs ingrédients', () => {
    // La galette ET le cordon bleu apportent du gluten : une seule mention.
    expect(sortAllergens(['gluten', 'lait', 'gluten'])).toEqual(['gluten', 'lait']);
  });

  it('renvoie une liste vide, jamais rien, quand le produit ne déclare rien', () => {
    // « Rien à déclarer » et « on ne sait pas » ne s'affichent pas pareil :
    // c'est à l'appelant de choisir, le domaine ne renvoie jamais null.
    expect(sortAllergens([])).toEqual([]);
    expect(formatAllergens([])).toBe('');
  });

  it('écrit les libellés français attendus sur la carte', () => {
    expect(formatAllergens(['fruits_a_coque', 'oeufs', 'gluten'])).toBe(
      'Gluten, Œufs, Fruits à coque',
    );
  });

  it('rejette une valeur inconnue venue d’un import fournisseur', () => {
    expect(isAllergen('gluten')).toBe(true);
    expect(isAllergen('piment')).toBe(false);
    expect(isAllergen(null)).toBe(false);
  });
});
