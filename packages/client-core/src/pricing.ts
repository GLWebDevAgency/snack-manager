import type { Product, OptionGroup } from './types';

/**
 * Calcul de prix côté client — pour l'affichage immédiat et le fonctionnement
 * hors ligne. Le serveur recalcule tout à la création de la commande et fait
 * autorité : ces fonctions ne doivent JAMAIS être la source du montant encaissé
 * une fois la connexion revenue.
 */

export interface SelectedOption {
  groupKey: string;
  choiceKey: string;
  name: string;
  priceDelta: number;
}

export interface CartLine {
  /** Identifiant local de ligne (permet de rouvrir la configuration). */
  lineId: string;
  productId: string;
  name: string;
  variantKey: string | null;
  variantName: string | null;
  options: SelectedOption[];
  removed: string[];
  note?: string;
  qty: number;
  unitPrice: number;
}

/** Prix d'une variante, ou prix de base si le produit n'en a pas. */
export function basePrice(product: Product, variantKey?: string | null): number {
  if (product.variants?.length) {
    const v = product.variants.find((x) => x.key === variantKey);
    return v ? v.price : (product.variants[0]?.price ?? 0);
  }
  return product.price ?? 0;
}

/** Règle effective d'un groupe pour une variante (min/max/priceDelta). */
export function ruleFor(
  group: OptionGroup,
  variantKey?: string | null,
): { min: number; max: number; priceDelta?: number } {
  const per =
    variantKey && group.perVariant
      ? (group.perVariant as Record<string, { min?: number; max?: number; priceDelta?: number }>)[
          variantKey
        ]
      : undefined;
  return {
    min: per?.min ?? group.min ?? 0,
    max: per?.max ?? group.max ?? Number.POSITIVE_INFINITY,
    priceDelta: per?.priceDelta,
  };
}

/** Prix unitaire = variante + suppléments (la règle par variante prime). */
export function unitPrice(
  product: Product,
  variantKey: string | null,
  options: SelectedOption[],
): number {
  let total = basePrice(product, variantKey);
  for (const opt of options) {
    const group = product.optionGroups?.find((g) => g.key === opt.groupKey);
    const override = group ? ruleFor(group, variantKey).priceDelta : undefined;
    total += override ?? opt.priceDelta;
  }
  return total;
}

export const lineTotal = (line: CartLine): number => line.unitPrice * line.qty;

export const cartTotal = (lines: CartLine[]): number =>
  lines.reduce((sum, l) => sum + lineTotal(l), 0);

/**
 * Vérifie que chaque groupe obligatoire est satisfait.
 * Retourne les libellés des groupes en défaut (vide = configuration valide).
 */
export function missingRequired(
  product: Product,
  variantKey: string | null,
  options: SelectedOption[],
): string[] {
  const missing: string[] = [];
  for (const group of product.optionGroups ?? []) {
    const { min, max } = ruleFor(group, variantKey);
    const count = options.filter((o) => o.groupKey === group.key).length;
    if (count < min || count > max) missing.push(group.name);
  }
  return missing;
}

/** 950 → « 9,50 € » */
export const euros = (cents: number): string =>
  `${(cents / 100).toFixed(2).replace('.', ',')} €`;

/** Deux lignes fusionnables si produit, variante, options, retraits et note identiques. */
export function sameConfiguration(a: CartLine, b: CartLine): boolean {
  if (a.productId !== b.productId || a.variantKey !== b.variantKey) return false;
  if ((a.note ?? '') !== (b.note ?? '')) return false;
  const key = (l: CartLine) =>
    [
      l.options
        .map((o) => `${o.groupKey}:${o.choiceKey}`)
        .sort()
        .join('|'),
      [...l.removed].sort().join('|'),
    ].join('#');
  return key(a) === key(b);
}
