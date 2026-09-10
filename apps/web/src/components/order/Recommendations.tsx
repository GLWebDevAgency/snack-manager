"use client";

import type { MenuCategory, MenuProduct } from "./api";
import type { CartLine } from "./cart";
import { Icon } from "@/components/ui";
import { Plate, Prix, Rail, SectionLabel, Tap } from "./primitives";
import { orderRecommendations } from "./recommendation-model";

export function Recommendations({ categories, lines, onPick, prixMono, excludeProductId, disabled = false }: {
  categories: MenuCategory[]; lines: CartLine[]; onPick: (product: MenuProduct) => void; prixMono: boolean;
  excludeProductId?: string; disabled?: boolean;
}) {
  const products = orderRecommendations(categories, lines, excludeProductId, Boolean(excludeProductId));
  if (!products.length) return null;
  return <section className="sm-order-recommendations"><SectionLabel>{excludeProductId ? "Souvent pris avec" : "Pour accompagner"}</SectionLabel>
    <Rail label="Suggestions pour votre commande">{products.map(product => <Tap key={product.id} onClick={() => onPick(product)} disabled={disabled} className="sm-order-recommendation">
      {product.photoUrl && <Plate photoUrl={product.photoUrl} cover={product.photoCover} name={product.name} radius="rounded-none" className="h-[78px] w-full border-0" />}
      <span className="sm-order-recommendation-body"><b>{product.name}</b><span><Prix cents={product.fromPrice} mono={prixMono} /><Icon name={product.configurable ? "edit" : "plus"} size={18} /></span></span>
      <span className="sr-only">{product.configurable ? ", composer" : ", ajouter au panier"}</span>
    </Tap>)}</Rail>
  </section>;
}
