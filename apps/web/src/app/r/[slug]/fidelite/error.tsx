"use client";

import { marqueDeRepli } from "@sm/contracts";
import { Btn, Icon } from "@/components/ui";
import { FeuilleDuMasque } from "@/components/masque/FeuilleDuMasque";
import { classesPolices } from "@/components/masque/polices";
import { styleDuMasque } from "@/components/masque/styleDuMasque";
import { cx } from "@/lib/cx";

/*
 * Le catalogue fidélité n'a pas pu être chargé : son masque non plus. C'est le
 * REPLI NUIT plutôt que la marque grise de Snack Manager — le pourquoi complet
 * est dans `app/r/[slug]/not-found.tsx`. Cette page peut s'afficher DANS la
 * PWA installée du restaurant : y voir une autre identité que la sienne est
 * précisément ce qu'une carte fidélité ne peut pas se permettre.
 */
const REPLI = marqueDeRepli(null, null);
const MASQUE_DE_REPLI = styleDuMasque(REPLI);

export default function LoyaltyError({ reset }: { reset: () => void }) {
  return (
    <main
      style={MASQUE_DE_REPLI}
      className={cx(
        classesPolices,
        "font-body grid min-h-dvh place-items-center bg-bg px-5 py-12 text-ink",
      )}
    >
      {/* Le masque remonte au document : canevas, rebond iOS, ascenseur
          et contrôles natifs — voir `FeuilleDuMasque`. */}
      <FeuilleDuMasque brand={REPLI} />
      <section className="w-full max-w-md rounded-wide border border-alert/25 bg-surface p-6 text-center shadow-deep sm:p-8">
        <span className="mx-auto grid size-14 place-items-center rounded-card bg-alert/10 text-alertt">
          <Icon name="close" size={24} />
        </span>
        <h1 className="mt-5 text-2xl font-black tracking-[-0.04em]">
          La carte ne répond pas
        </h1>
        <p className="mt-3 text-sm leading-6 text-mut">
          Votre carte n’a pas été modifiée. Vérifiez la connexion puis relancez le chargement.
        </p>
        <Btn className="mt-6" onClick={reset}>
          Réessayer
        </Btn>
      </section>
    </main>
  );
}
