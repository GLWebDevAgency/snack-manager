import { INGREDIENT_CATEGORIES, SUPPLEMENT_CATEGORY_ORDER, type IngredientCategory } from '@sm/contracts';

/** Presentation shared by web and future mobile; no pricing or choice rewrite. */
const LABELS: Record<IngredientCategory, string> = {
  viande: 'Viandes', volaille: 'Volailles', poisson: 'Poissons', fromage: 'Fromages',
  legume: 'Légumes', feculent: 'Accompagnements', pain: 'Pains', sauce: 'Sauces',
  epicerie: 'Épicerie', dessert: 'Desserts', boisson: 'Boissons',
  emballage: 'Emballages', autre: 'Autres suppléments',
};
const categories: ReadonlySet<unknown> = new Set(INGREDIENT_CATEGORIES);

/** Legacy/unknown categories remain visible; labels never infer ingredients. */
export function groupSupplementsByCategory<T extends { category?: IngredientCategory }>(
  items: readonly T[],
): { category: IngredientCategory; label: string; items: T[] }[] {
  const groups = new Map<IngredientCategory, T[]>();
  for (const item of items) {
    const category = categories.has(item.category) ? item.category! : 'autre';
    const group = groups.get(category);
    if (group) group.push(item);
    else groups.set(category, [item]);
  }
  return SUPPLEMENT_CATEGORY_ORDER.flatMap(category => {
    const selected = groups.get(category);
    return selected ? [{ category, label: LABELS[category], items: selected }] : [];
  });
}
