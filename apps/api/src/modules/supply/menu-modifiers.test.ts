import { describe, expect, it } from 'vitest';
import { buildProductModifiers, modifierKey, type ModifierIngredient } from './menu-modifiers';

/**
 * Le défaut constaté en service : un sandwich Merguez ne proposait que
 * « sans crudités » alors que sa recette porte salade, tomate et oignon rouge —
 * et aucun supplément payant n'était offert, alors que ce sont les ventes
 * additionnelles les plus rentables du métier.
 *
 * La règle tenue ici : la RECETTE fait la carte. Le gérant ne saisit rien de
 * plus qu'une nomenclature.
 */

const ing = (over: Partial<ModifierIngredient> & { ingredientId: string; name: string }): ModifierIngredient => ({
  displayName: null,
  category: 'autre',
  removable: false,
  supplementPriceCents: null,
  isOut: false,
  ...over,
});

const PAIN = ing({ ingredientId: 'i-pain', name: 'Pain sandwich', category: 'pain' });
const MERGUEZ = ing({
  ingredientId: 'i-merguez',
  name: 'Merguez',
  category: 'viande',
  supplementPriceCents: 200,
});
const SALADE = ing({
  ingredientId: 'i-salade',
  name: 'Salade iceberg',
  displayName: 'Salade',
  category: 'legume',
  removable: true,
});
const TOMATE = ing({ ingredientId: 'i-tomate', name: 'Tomate', category: 'legume', removable: true });
const OIGNON = ing({
  ingredientId: 'i-oignon',
  name: 'Oignon rouge',
  displayName: 'Oignons',
  category: 'legume',
  removable: true,
});
const BARQUETTE = ing({ ingredientId: 'i-barq', name: 'Barquette', category: 'emballage' });

const CHEDDAR = ing({
  ingredientId: 'i-cheddar',
  name: 'Cheddar (tranches)',
  displayName: 'Cheddar',
  category: 'fromage',
  removable: true,
  supplementPriceCents: 100,
});
const OEUF = ing({
  ingredientId: 'i-oeuf',
  name: 'Œufs',
  displayName: 'Œuf',
  category: 'epicerie',
  removable: true,
  supplementPriceCents: 100,
});
const LARDONS = ing({
  ingredientId: 'i-lardons',
  name: 'Lardons de dinde',
  displayName: 'Lardons',
  category: 'volaille',
  supplementPriceCents: 150,
});
const CHAMPIGNONS = ing({
  ingredientId: 'i-champi',
  name: 'Champignons',
  category: 'legume',
  removable: true,
  supplementPriceCents: 80,
});

const CATALOGUE = [CHEDDAR, OEUF, LARDONS, CHAMPIGNONS, MERGUEZ];
const SANDWICH_MERGUEZ = [PAIN, MERGUEZ, SALADE, TOMATE, OIGNON, BARQUETTE];

describe('retraits dérivés de la recette', () => {
  it('propose « sans tomate » sur un sandwich dont la recette contient de la tomate', () => {
    const { removables } = buildProductModifiers(SANDWICH_MERGUEZ, CATALOGUE);
    expect(removables).toContainEqual({ key: 'tomate', label: 'Tomate' });
  });

  it('propose les trois crudités de la recette, libellé court en tête de ticket', () => {
    const { removables } = buildProductModifiers(SANDWICH_MERGUEZ, CATALOGUE);
    expect(removables).toEqual([
      { key: 'oignons', label: 'Oignons' },
      { key: 'salade', label: 'Salade' },
      { key: 'tomate', label: 'Tomate' },
    ]);
  });

  it('ne propose jamais de retirer le pain, la viande principale ni l’emballage', () => {
    const { removables } = buildProductModifiers(SANDWICH_MERGUEZ, CATALOGUE);
    expect(removables.map((r) => r.key)).not.toContain('pain-sandwich');
    expect(removables.map((r) => r.key)).not.toContain('merguez');
    expect(removables.map((r) => r.key)).not.toContain('barquette');
  });

  it('garde les anciens modificateurs express, en fin de liste', () => {
    const { removables } = buildProductModifiers(SANDWICH_MERGUEZ, CATALOGUE, ['crudités']);
    expect(removables.at(-1)).toEqual({ key: 'crudites', label: 'crudités' });
    expect(removables).toHaveLength(4);
  });

  it('ne double pas un modificateur express déjà dérivé de la recette', () => {
    const { removables } = buildProductModifiers(SANDWICH_MERGUEZ, CATALOGUE, ['Tomate']);
    expect(removables.filter((r) => r.key === 'tomate')).toHaveLength(1);
  });

  it('reconnaît le doublon au pluriel et sous le nom de gestion des stocks', () => {
    // Le produit porte « tomates » et « oignons rouges » saisis en dur ; la
    // recette porte « Tomate » et « Oignon rouge » affiché « Oignons ».
    const { removables } = buildProductModifiers(SANDWICH_MERGUEZ, CATALOGUE, [
      'tomates',
      'oignons rouges',
    ]);
    expect(removables.map((r) => r.label)).toEqual(['Oignons', 'Salade', 'Tomate']);
  });

  it('dédoublonne les ingrédients partagés par plusieurs variantes', () => {
    const { removables } = buildProductModifiers([...SANDWICH_MERGUEZ, TOMATE], CATALOGUE);
    expect(removables.filter((r) => r.key === 'tomate')).toHaveLength(1);
  });
});

describe('suppléments payants dérivés du catalogue', () => {
  it('propose les suppléments absents de la recette, triés par catégorie puis prix', () => {
    const { supplements } = buildProductModifiers(SANDWICH_MERGUEZ, CATALOGUE);
    expect(supplements).toEqual([
      { key: 'cheddar', label: 'Cheddar', priceCents: 100, category: 'fromage' },
      { key: 'oeuf', label: 'Œuf', priceCents: 100, category: 'epicerie' },
      { key: 'lardons', label: 'Lardons', priceCents: 150, category: 'volaille' },
      { key: 'champignons', label: 'Champignons', priceCents: 80, category: 'legume' },
    ]);
  });

  it('exclut ce que la recette contient déjà — pas de merguez en plus sur un merguez', () => {
    const { supplements } = buildProductModifiers(SANDWICH_MERGUEZ, CATALOGUE);
    expect(supplements.map((s) => s.key)).not.toContain('merguez');
  });

  it('propose la viande en supplément sur un produit qui n’en contient pas', () => {
    const vegetarien = [PAIN, SALADE, TOMATE, BARQUETTE];
    const { supplements } = buildProductModifiers(vegetarien, CATALOGUE);
    expect(supplements).toContainEqual({
      key: 'merguez',
      label: 'Merguez',
      priceCents: 200,
      category: 'viande',
    });
  });

  it('retire un supplément en rupture — on n’encaisse pas ce qu’on n’a plus', () => {
    const catalogue = CATALOGUE.map((i) => (i === CHEDDAR ? { ...CHEDDAR, isOut: true } : i));
    const { supplements } = buildProductModifiers(SANDWICH_MERGUEZ, catalogue);
    expect(supplements.map((s) => s.key)).not.toContain('cheddar');
  });

  it('ne double pas un supplément que le gérant vend déjà dans son propre groupe', () => {
    // « Compose ton Tacos » a ses groupes « supp. 1,00 € » saisis à la main :
    // le cheddar dérivé ne doit pas réapparaître une seconde fois à la caisse.
    const { supplements } = buildProductModifiers(SANDWICH_MERGUEZ, CATALOGUE, [], [
      'cheddar',
      'Œuf',
    ]);
    expect(supplements.map((s) => s.key)).toEqual(['lardons', 'champignons']);
  });

  it('ne propose aucun supplément sur une boisson : sa recette n’est qu’un contenant', () => {
    const canette = [ing({ ingredientId: 'i-can', name: 'Canette 33 cl', category: 'boisson' })];
    expect(buildProductModifiers(canette, CATALOGUE).supplements).toEqual([]);
  });

  it('ne propose rien quand la recette est inconnue', () => {
    expect(buildProductModifiers([], CATALOGUE, ['crudités'])).toEqual({
      removables: [{ key: 'crudites', label: 'crudités' }],
      supplements: [],
    });
  });
});

describe('clés de modificateur', () => {
  it('reste lisible sur un ticket cuisine : accents et ligatures aplanis', () => {
    expect(modifierKey('Oignons')).toBe('oignons');
    expect(modifierKey('Œuf')).toBe('oeuf');
    expect(modifierKey('Jalapeños panés')).toBe('jalapenos-panes');
    expect(modifierKey('Crème balsamique')).toBe('creme-balsamique');
  });
});
