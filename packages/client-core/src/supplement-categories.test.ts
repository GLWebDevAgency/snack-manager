import { describe, expect, it } from 'vitest';
import { INGREDIENT_CATEGORIES, SUPPLEMENT_CATEGORY_ORDER, type IngredientCategory } from '@sm/contracts';
import { groupSupplementsByCategory } from './supplement-categories';

describe('groupage des suppléments pour les surfaces clientes', () => {
  it('suit les familles métier sans changer l’ordre serveur, les clés ni les prix dans une famille', () => {
    const items = Object.freeze([
      Object.freeze({ key: 'kebab', category: 'viande' as const, priceCents: 250 }),
      Object.freeze({ key: 'bleu', category: 'fromage' as const, priceCents: 150 }),
      Object.freeze({ key: 'barbecue', category: 'sauce' as const, priceCents: 0 }),
      Object.freeze({ key: 'cheddar', category: 'fromage' as const, priceCents: 100 }),
    ]);
    const result = groupSupplementsByCategory(items);
    expect(result.map(group => [group.category, group.label])).toEqual([['fromage', 'Fromages'], ['viande', 'Viandes'], ['sauce', 'Sauces']]);
    expect(result[0]!.items).toEqual([items[1], items[3]]);
    expect(result[0]!.items[0]).toBe(items[1]);
    expect(result[0]!.items[1]).toBe(items[3]);
    expect(result[2]!.items[0]?.priceCents).toBe(0);
    expect(items.map(item => item.key)).toEqual(['kebab', 'bleu', 'barbecue', 'cheddar']);
  });
  it('conserve les anciennes données et les catégories futures dans Autres sans deviner depuis leur nom', () => {
    const items = [
      { key: 'old', label: 'Cheddar' },
      { key: 'new', label: 'Sauce', category: 'future' as IngredientCategory },
      { key: 'other', label: 'Viande', category: 'autre' as const },
    ];
    expect(groupSupplementsByCategory(items)).toEqual([{ category: 'autre', label: 'Autres suppléments', items }]);
  });
  it('couvre toute la taxonomie partagée sans groupe vide ni fusion de clés égales entre catégories', () => {
    const items = [...INGREDIENT_CATEGORIES].reverse().map(category => ({ key: 'same-key', category }));
    const result = groupSupplementsByCategory(items);
    expect(result.map(group => group.category)).toEqual(SUPPLEMENT_CATEGORY_ORDER);
    expect(result.flatMap(group => group.items)).toHaveLength(items.length);
    expect(result.every(group => group.items.length === 1 && group.label.length > 0)).toBe(true);
    expect(groupSupplementsByCategory([])).toEqual([]);
  });
});
