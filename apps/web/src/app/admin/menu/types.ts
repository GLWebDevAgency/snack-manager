/**
 * Vue « Menu & prix » (spec backoffice-restaurant §7) — types partagés.
 * Tous les montants circulent en CENTIMES (int).
 */

export type Variant = { key: string; name: string; price: number };

export type Product = {
  _id: string;
  /** null = « Non rattaché » (orphelin après suppression de catégorie). */
  categoryId: string | null;
  name: string;
  description: string;
  /** Centimes — ignoré côté client si `variants` non vide. */
  price: number;
  variants: Variant[];
  tags: string[];
  isNew: boolean;
  outOfStock: boolean;
  /** 'manual' = coupé à la main · 'ingredient' = cascade rupture ingrédient. */
  outOfStockSource: "manual" | "ingredient" | null;
  order: number;
  active: boolean;
};

export type Category = {
  _id: string;
  name: string;
  order: number;
  active: boolean;
  products: Product[];
};

export type MenuData = { categories: Category[]; uncategorized: Product[] };

/** Sentinelle de sélection pour la rangée spéciale « Non rattachés ». */
export const UNCAT = "__uncat__";

/** Prix effectif (centimes) : min des variantes, sinon prix de base. */
export const effectivePrice = (p: Product): number =>
  p.variants.length > 0 ? Math.min(...p.variants.map((v) => v.price)) : p.price;

/** Prix « à définir » (bandeau §7.1) : prix effectif nul. */
export const isPriceToDefine = (p: Product): boolean => effectivePrice(p) === 0;

/** 890 → « 8,90 » pour l'input prix ; 0 → chaîne vide (état « à définir »). */
export const priceToInput = (cents: number): string =>
  cents > 0 ? (cents / 100).toFixed(2).replace(".", ",") : "";

/**
 * Saisie libre (« 8,90 », « 8.9 », « 8,90 € ») → centimes.
 * Chaîne vide → 0 (retour à « à définir ») ; illisible → null.
 */
export function inputToCents(raw: string): number | null {
  const clean = raw.replace(/[^0-9.,]/g, "").replace(",", ".");
  if (!clean) return 0;
  const n = Number.parseFloat(clean);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}
