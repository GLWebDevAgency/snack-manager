/**
 * Les 14 allergènes à déclaration obligatoire.
 *
 * Annexe II du règlement (UE) n° 1169/2011 dit « INCO ». L'ORDRE de cette liste
 * n'est pas décoratif : c'est celui de l'annexe, et c'est celui dans lequel les
 * affichages réglementaires sont attendus — la même carte doit lister « Gluten,
 * Lait, Sésame » dans cet ordre chez tous les restaurants, pas dans l'ordre où
 * le gérant a saisi ses ingrédients.
 *
 * La liste est fermée : elle ne bouge que si la réglementation bouge.
 */
export const ALLERGENS = [
  'gluten',
  'crustaces',
  'oeufs',
  'poissons',
  'arachides',
  'soja',
  'lait',
  'fruits_a_coque',
  'celeri',
  'moutarde',
  'sesame',
  'sulfites',
  'lupin',
  'mollusques',
] as const;

export type Allergen = (typeof ALLERGENS)[number];

/** Libellés d'affichage — ce que le client lit sur la carte. */
export const ALLERGEN_LABELS: Readonly<Record<Allergen, string>> = {
  gluten: 'Gluten',
  crustaces: 'Crustacés',
  oeufs: 'Œufs',
  poissons: 'Poissons',
  arachides: 'Arachides',
  soja: 'Soja',
  lait: 'Lait',
  fruits_a_coque: 'Fruits à coque',
  celeri: 'Céleri',
  moutarde: 'Moutarde',
  sesame: 'Sésame',
  sulfites: 'Sulfites',
  lupin: 'Lupin',
  mollusques: 'Mollusques',
};

/** Rang réglementaire, pour trier sans dépendre de l'ordre d'insertion. */
const RANK: ReadonlyMap<Allergen, number> = new Map(ALLERGENS.map((a, index) => [a, index]));

/** Garde-fou pour les données venues de la base ou d'un import fournisseur. */
export function isAllergen(value: unknown): value is Allergen {
  return typeof value === 'string' && (ALLERGENS as readonly string[]).includes(value);
}

export function labelOf(allergen: Allergen): string {
  return ALLERGEN_LABELS[allergen];
}

/**
 * Dédoublonne et remet dans l'ordre réglementaire.
 *
 * Fonction TOTALE : pas de `Result`, pas d'exception. L'affichage des
 * allergènes est une obligation légale — la seule issue acceptable d'un appel
 * est une liste. Un produit sans allergène renvoie une liste vide, jamais
 * `null` : « rien à déclarer » et « on ne sait pas » ne se ressemblent pas à
 * l'écran, et c'est l'appelant qui doit choisir quoi afficher.
 */
export function sortAllergens(values: Iterable<Allergen>): readonly Allergen[] {
  return [...new Set(values)].sort((a, b) => (RANK.get(a) ?? 0) - (RANK.get(b) ?? 0));
}

/** « Gluten, Lait, Sésame » — prêt pour la fiche produit. */
export function formatAllergens(values: Iterable<Allergen>): string {
  return sortAllergens(values).map(labelOf).join(', ');
}
