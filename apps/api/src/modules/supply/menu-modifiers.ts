/**
 * Modificateurs de la caisse DÉRIVÉS de la recette.
 *
 * Le gérant ne saisit rien de plus qu'une nomenclature : un sandwich dont la
 * recette porte salade, tomate et oignon rouge propose automatiquement
 * « sans salade », « sans tomate », « sans oignons » ; les ingrédients tarifés
 * du restaurant qui n'y figurent pas encore deviennent ses suppléments payants.
 *
 * Ce fichier est PUR (aucune dépendance NestJS, Mongo ni Postgres) : la règle
 * métier se teste sans base et sert aussi bien la lecture du menu que la
 * projection du groupe d'options réservé « supplements ».
 */
import {
  SUPPLEMENT_CATEGORY_ORDER,
  type IngredientCategory,
  type MenuRemovable,
  type MenuSupplement,
  type ProductModifiers,
} from '@sm/contracts';

/** Ingrédient réduit à ce qui pilote les modificateurs. */
export interface ModifierIngredient {
  ingredientId: string;
  name: string;
  displayName: string | null;
  category: IngredientCategory;
  removable: boolean;
  supplementPriceCents: number | null;
  isOut: boolean;
}

/**
 * Un supplément ne se propose que sur un plat composable — une base salée.
 * Sans ce garde-fou, une canette de Coca se verrait proposer « + cheddar
 * 1,00 € » : la recette d'une boisson n'est qu'un contenant.
 */
const COMPOSABLE_CATEGORIES: ReadonlySet<IngredientCategory> = new Set([
  'pain',
  'feculent',
  'viande',
  'volaille',
  'poisson',
  'fromage',
]);

const CATEGORY_RANK = new Map<string, number>(
  SUPPLEMENT_CATEGORY_ORDER.map((c, i) => [c, i]),
);

/** Libellé affiché : le libellé court prime sur le nom de gestion des stocks. */
export function modifierLabel(ing: ModifierIngredient): string {
  const label = (ing.displayName ?? '').trim();
  return label.length > 0 ? label : ing.name.trim();
}

/**
 * Clé stable d'un modificateur — accents et ponctuation retirés.
 *
 * Elle voyage jusqu'au ticket cuisine (« - sans oignons ») : elle doit rester
 * lisible par un humain, pas être un UUID.
 */
export function modifierKey(label: string): string {
  return label
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // diacritiques isolés par NFD
    .replace(/œ/gi, 'oe')
    .replace(/æ/gi, 'ae')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

const byLabelFr = (a: { label: string }, b: { label: string }) =>
  a.label.localeCompare(b.label, 'fr');

/**
 * Forme de comparaison d'une clé, singuliers et pluriels confondus.
 *
 * Le produit porte « tomates » en dur, la recette porte « Tomate » : sans cela
 * la caisse afficherait deux fois le même retrait.
 */
function comparableKey(key: string): string {
  return key
    .split('-')
    .map((token) => (token.length > 3 && token.endsWith('s') ? token.slice(0, -1) : token))
    .join('-');
}

/**
 * Construit les deux blocs d'un produit.
 *
 * @param recipe            ingrédients de la recette du produit (toutes variantes confondues)
 * @param catalog           ingrédients du restaurant proposés en supplément
 * @param legacyRemovables  `removables` saisis en dur sur le produit — conservés
 *                          en repli, mais la recette reste la source principale
 * @param alreadyOffered    clés déjà proposées par les groupes d'options du
 *                          gérant : un supplément qu'il vend déjà à sa façon
 *                          (les « supp. 1,00 € » du tacos) n'est pas doublé
 */
export function buildProductModifiers(
  recipe: ModifierIngredient[],
  catalog: ModifierIngredient[],
  legacyRemovables: readonly string[] = [],
  alreadyOffered: readonly string[] = [],
): ProductModifiers {
  const inRecipe = new Set(recipe.map((i) => i.ingredientId));

  // ── Retraits : les ingrédients retirables réellement présents dans la recette ──
  const removables: MenuRemovable[] = [];
  const seen = new Set<string>();
  for (const ing of recipe) {
    if (!ing.removable) continue;
    const label = modifierLabel(ing);
    const key = modifierKey(label);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    // Le nom de gestion des stocks vaut alias : un produit qui porte
    // « oignons rouges » en dur ne doit pas doubler l'« Oignons » de la recette.
    seen.add(comparableKey(modifierKey(ing.name)));
    seen.add(comparableKey(key));
    removables.push({ key, label });
  }
  removables.sort(byLabelFr);

  // Les anciens modificateurs express (« crudités ») restent proposés en fin de
  // liste tant que le gérant ne les a pas retirés du produit.
  for (const raw of legacyRemovables) {
    const label = String(raw).trim();
    const key = modifierKey(label);
    if (!key || seen.has(key) || seen.has(comparableKey(key))) continue;
    seen.add(key);
    seen.add(comparableKey(key));
    removables.push({ key, label });
  }

  // ── Suppléments : le catalogue tarifé, moins ce que la recette contient déjà ──
  const composable = recipe.some((i) => COMPOSABLE_CATEGORIES.has(i.category));
  const supplements: MenuSupplement[] = [];
  if (composable) {
    const keys = new Set<string>(alreadyOffered.map((k) => modifierKey(k)));
    for (const ing of catalog) {
      const priceCents = ing.supplementPriceCents;
      if (priceCents == null || ing.isOut) continue;
      if (inRecipe.has(ing.ingredientId)) continue;
      const label = modifierLabel(ing);
      const key = modifierKey(label);
      if (!key || keys.has(key)) continue;
      keys.add(key);
      supplements.push({ key, label, priceCents, category: ing.category });
    }
    supplements.sort(
      (a, b) =>
        (CATEGORY_RANK.get(a.category) ?? 99) - (CATEGORY_RANK.get(b.category) ?? 99) ||
        a.priceCents - b.priceCents ||
        byLabelFr(a, b),
    );
  }

  return { removables, supplements };
}
