"use client";

import { marqueDeRepli } from "@sm/contracts";
import { FeuilleDuMasque } from "@/components/masque/FeuilleDuMasque";
import { classesPolices } from "@/components/masque/polices";
import { styleDuMasque } from "@/components/masque/styleDuMasque";
import { cx } from "@/lib/cx";

/*
 * Le tunnel n'a pas pu être chargé : son masque non plus. C'est le REPLI NUIT
 * plutôt que la marque grise de Snack Manager — le pourquoi complet est dans
 * `app/r/[slug]/not-found.tsx`. Dans une iframe, la nuance compte double :
 * c'est le site du restaurant qui encadre cette page.
 */
const REPLI = marqueDeRepli(null, null);
const MASQUE_DE_REPLI = styleDuMasque(REPLI);

/** Panne dans l’iframe : le site hôte du restaurant ne doit pas paraître cassé. */
export default function EmbedError({ retry }: { retry: () => void }) {
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
      <div className="max-w-[320px]">
        <h1 className="text-[18px] font-extrabold tracking-[-0.03em] text-ink">
          La carte ne s’est pas chargée
        </h1>
        <p className="mt-2 text-[14px] leading-relaxed text-mut">
          Le service est momentanément injoignable.
        </p>
        {/* `min-h-11` : 44 px, la cible tactile de WCAG 2.2 (2.5.8) — le
            `py-2.5` seul plafonnait à 38 px. `cf-press` remplace le retour
            tactile recopié à la main : lui seul est annulé sous
            `prefers-reduced-motion`, la classe `transition-*` ne l'était pas. */}
        <button
          type="button"
          onClick={retry}
          className="cf-press mt-5 inline-flex min-h-11 items-center justify-center rounded-pill bg-accent px-5 py-2.5 text-[14px] font-extrabold text-onaccent"
        >
          Réessayer
        </button>
      </div>
    </main>
  );
}
