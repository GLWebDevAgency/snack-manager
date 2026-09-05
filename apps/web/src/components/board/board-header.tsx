"use client";

import type { Brand, ScreenBrand } from "@sm/contracts";
import { verrouPour } from "@/components/ui/verrou";
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
 * La MARQUE (le symbole) du mode en cours, sans retomber sur le verrou.
 *
 * `logoPour(brand, "mark")` retombe sur le verrou quand aucune marque n'est
 * posée — juste pour une tuile, faux ici : le nom est écrit à côté, et un
 * verrou (qui porte déjà le nom) le ferait bégayer.
 */
export function marqueSeule(brand: Brand): string | null {
  const pref = brand.mode === "dark" ? "dark" : "light";
  const alt = pref === "dark" ? "light" : "dark";
  return brand.logo.mark[pref] ?? brand.logo.mark[alt];
}

/**
 * En-tête discret : on vient lire la carte, pas le bandeau.
 *
 * Il porte quand même trois informations utiles au client dans la file — chez
 * qui il est, quel service est en cours, et l'heure qu'il est — et une preuve
 * de vie pour le gérant : une heure juste, c'est un écran qui tourne.
 */
export function BoardHeader({
  masque,
  brand,
  serviceLabel,
  open,
  timezone,
}: {
  masque: Brand;
  brand: ScreenBrand;
  serviceLabel: string;
  open: boolean;
  timezone: string | null;
}) {
  // Le verrou — « logo avec le nom » — remplace le nom écrit quand il est posé.
  const verrou = verrouPour(masque);
  const marque = marqueSeule(masque);
  return (
    <header className="bd-header">
      <div className="bd-brand">
        {verrou ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img className="bd-verrou" src={verrou} alt={brand.name} decoding="async" />
        ) : (
          <>
            {marque ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img className="bd-logo" src={marque} alt="" decoding="async" />
            ) : (
              <div className="bd-logo bd-logo-fallback">{monogramOf(brand.name)}</div>
            )}
            <div className="bd-brand-name">{brand.name}</div>
          </>
        )}
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
