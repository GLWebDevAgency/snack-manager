import type { MenuCategory, MenuProduct } from "./api";
import type { CartLine } from "./cart";
import { fold } from "./helpers";

/** Real available catalogue products only; configurable choices keep their
 * product form. This projection never invents a recipe or a price. */
export function orderRecommendations(categories: readonly MenuCategory[], lines: readonly CartLine[], excludeProductId?: string, simpleOnly = false): MenuProduct[] {
  const occupied = new Set(lines.map(line => line.productId));
  if (excludeProductId) occupied.add(excludeProductId);
  const groups = ["boissons", "desserts", "tex-mex"];
  const candidates = groups.flatMap(group => categories.filter(category => fold(category.name.trim()) === group)
    .filter(category => !category.products.some(product => occupied.has(product.id)))
    .flatMap(category => category.products.filter(product => !product.outOfStock && !occupied.has(product.id)
      && (!simpleOnly || !product.configurable) && (Boolean(product.photoUrl) || group === "boissons"))));
  return [...new Map(candidates.map(product => [product.id, product])).values()].slice(0, simpleOnly ? 4 : 6);
}

export function expressRemovals(removables: MenuProduct["removables"]): { label: string; keys: string[] }[] {
  const find = (labels: string[]) => removables.find(item => labels.includes(fold(item.label.trim())));
  const onions = find(["oignon", "oignons"]);
  const tomatoes = find(["tomate", "tomates"]);
  const salad = find(["salade"]);
  return [
    ...(onions ? [{ label: "Sans oignons", keys: [onions.key] }] : []),
    ...(tomatoes ? [{ label: "Sans tomates", keys: [tomatoes.key] }] : []),
    ...(onions && tomatoes && salad ? [{ label: "Sans crudités", keys: [onions.key, tomatoes.key, salad.key] }] : []),
  ];
}
