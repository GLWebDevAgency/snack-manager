import type { MenuCategory, MenuProduct } from "./api";

/** La sélection éditoriale fait autorité, y compris lorsqu'elle est vide. */
export function storefrontHighlights(categories: readonly MenuCategory[], featuredConfigured = false): MenuProduct[] {
  const configured = featuredConfigured || categories.some((c) => c.featuredConfigured || (c.featuredProductIds?.length ?? 0) > 0);
  if (!configured) {
    const all = categories.flatMap((c) => c.products).filter((p) => !p.outOfStock);
    return [...all.filter((p) => p.photoUrl), ...all.filter((p) => !p.photoUrl)].slice(0, 8);
  }
  const seen = new Set<string>();
  return categories.flatMap((category) => (category.featuredProductIds ?? []).flatMap((id) => {
    const product = category.products.find((p) => p.id === id && !p.outOfStock);
    if (!product || seen.has(id)) return [];
    seen.add(id);
    return [product];
  }));
}
