"use client";

import type { CSSProperties } from "react";
import type { ScreenProduct } from "@sm/contracts";
import { Photo } from "../comptoir/Comptoir";

/**
 * Une ligne de carte : photo, nom, description courte, prix.
 *
 * Aucun montant n'est reformaté ici. L'API envoie `priceLabel` déjà écrit
 * (« 8,50 € », « 8,50 – 12,00 € ») parce qu'une règle de formatage recopiée
 * dans le front finit toujours par diverger de celle de la caisse — et un écran
 * accroché au plafond n'a personne pour s'apercevoir de l'écart.
 */

/**
 * Prix compact d'un produit à variantes.
 *
 * Dans une liste, « 12,00 – 17,00 € » mange la moitié de la ligne — on l'a vu
 * réduire « Assiette Kebab » à « Assi… » sur un écran vertical. On annonce donc
 * le seuil d'entrée, « dès 12,00 € », exactement comme une ardoise ; la
 * fourchette complète reste affichée sur les scènes de mise en avant, où la
 * place ne manque pas. On DÉCOUPE l'étiquette produite par l'API, sans jamais
 * reconstruire un montant à partir des centimes.
 */
export function compactPrice(product: ScreenProduct): {
  prefix: string | null;
  value: string;
} {
  if (product.priceCents === product.priceMaxCents) {
    return { prefix: null, value: product.priceLabel };
  }
  const [low] = product.priceLabel.split("–");
  const symbol = product.priceLabel.match(/[^\d\s]+$/)?.[0] ?? "";
  if (!low || !low.trim()) return { prefix: null, value: product.priceLabel };
  return { prefix: "dès", value: `${low.trim()} ${symbol}`.trim() };
}

export interface ProductRowProps {
  product: ScreenProduct;
  /** Rang 0–7 : le rythme d'apparition est adapté à la durée par l'hôte. */
  index: number;
  /** Durée de la scène : le Ken Burns dure exactement le temps d'affichage. */
  durationMs: number;
}

export function ProductRow({ product, index, durationMs }: ProductRowProps) {
  const price = compactPrice(product);

  return (
    <div
      className="bd-row"
      data-out={product.outOfStock ? "1" : "0"}
      style={{ "--bd-i": index, "--bd-ken": `${durationMs}ms` } as CSSProperties}
    >
      {product.photoUrl ? (
        <div className="bd-thumb">
          <Photo p={product} drift durationMs={durationMs} />
        </div>
      ) : null}

      <div className="bd-row-main">
        <div className="bd-name-line">
          <span className="bd-name">{product.name}</span>
          <span className="bd-tags">
            {product.isNew && !product.outOfStock ? (
              <span className="bd-badge" data-kind="new">
                Nouveau
              </span>
            ) : null}
            {/* Jamais retiré de la carte : un produit qui disparaît fait
                répéter la question au comptoir. Grisé, barré, et dit. */}
            {product.outOfStock ? (
              <span className="bd-badge" data-kind="out">
                Épuisé
              </span>
            ) : null}
          </span>
        </div>
        {product.description ? <div className="bd-desc">{product.description}</div> : null}
      </div>

      <div className="bd-price">
        {price.prefix ? <span className="bd-price-from">{price.prefix}</span> : null}
        {price.value}
      </div>
    </div>
  );
}
