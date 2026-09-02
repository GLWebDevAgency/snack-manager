"use client";

import { useEffect } from "react";
import { marqueDeRepli } from "@sm/contracts";
import { FeuilleDuMasque } from "@/components/masque/FeuilleDuMasque";
import { classesPolices } from "@/components/masque/polices";
import { styleDuMasque } from "@/components/masque/styleDuMasque";
import { cx } from "@/lib/cx";

/*
 * Le site n'a pas pu être chargé : son masque non plus. C'est le REPLI NUIT
 * plutôt que la marque grise de Snack Manager — le pourquoi complet est dans
 * `not-found.tsx`, à côté.
 */
const REPLI = marqueDeRepli(null, null);
const MASQUE_DE_REPLI = styleDuMasque(REPLI);

/**
 * Panne côté service (API injoignable, 5xx). La vitrine d’un restaurant ne doit
 * jamais afficher une trace technique : message clair, numéro de secours
 * impossible à donner ici, et une reprise en un appui.
 */
export default function RestaurantError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[/r] chargement du restaurant impossible", error);
  }, [error]);

  return (
    <main
      style={MASQUE_DE_REPLI}
      className={cx(
        classesPolices,
        "font-body grid min-h-dvh place-items-center bg-bg px-6 text-center text-ink",
      )}
    >
      {/* Le masque remonte au document : canevas, rebond iOS, ascenseur
          et contrôles natifs — voir `FeuilleDuMasque`. */}
      <FeuilleDuMasque brand={REPLI} />
      <div className="max-w-[380px]">
        <h1 className="text-[24px] font-extrabold tracking-[-0.035em] text-ink">
          La carte ne s’est pas chargée
        </h1>
        <p className="mt-3 text-[15px] leading-relaxed text-mut">
          Le service est momentanément injoignable. Le restaurant, lui, est
          toujours ouvert&nbsp;: réessayez dans un instant.
        </p>
        {/* `min-h-11` : 44 px, la cible tactile de WCAG 2.2 (2.5.8) — le
            `py-3` seul plafonnait à 41 px. `cf-press` remplace le retour
            tactile recopié à la main : lui seul est annulé sous
            `prefers-reduced-motion`, la classe `transition-*` ne l'était pas. */}
        <button
          type="button"
          onClick={reset}
          className="cf-press mt-6 inline-flex min-h-11 items-center justify-center rounded-pill bg-accent px-5 py-3 text-[14px] font-extrabold text-onaccent"
        >
          Réessayer
        </button>
        {error.digest && (
          <p className="mt-4 text-[12px] text-mut tabular-nums">
            Référence : {error.digest}
          </p>
        )}
      </div>
    </main>
  );
}
