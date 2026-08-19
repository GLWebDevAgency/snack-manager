"use client";

import type { ScreenBrand } from "@sm/contracts";
import { useRestaurantClock } from "./board-runtime";
import { monogramOf } from "./board-theme";

/**
 * L'heure vit dans son propre composant : elle change toutes les minutes, et
 * elle est la SEULE chose de l'écran qui ait le droit de se repeindre sans que
 * la carte ait bougé.
 */
function BoardClock({ timezone }: { timezone: string | null }) {
  return <div className="bd-clock">{useRestaurantClock(timezone)}</div>;
}

/**
 * En-tête discret : on vient lire la carte, pas le bandeau.
 *
 * Il porte quand même trois informations utiles au client dans la file — chez
 * qui il est, quel service est en cours, et l'heure qu'il est — et une preuve
 * de vie pour le gérant : une heure juste, c'est un écran qui tourne.
 */
export function BoardHeader({
  brand,
  serviceLabel,
  open,
  timezone,
}: {
  brand: ScreenBrand;
  serviceLabel: string;
  open: boolean;
  timezone: string | null;
}) {
  return (
    <header className="bd-header">
      <div className="bd-brand">
        {brand.logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img className="bd-logo" src={brand.logoUrl} alt="" decoding="async" />
        ) : (
          <div className="bd-logo bd-logo-fallback">{monogramOf(brand.name)}</div>
        )}
        <div className="bd-brand-name">{brand.name}</div>
      </div>

      <div className="bd-service">
        <span className="bd-dot" data-open={open ? "1" : "0"} />
        <span className="bd-service-label">{serviceLabel}</span>
        <span className="bd-sep" />
        <BoardClock timezone={timezone} />
      </div>
    </header>
  );
}
