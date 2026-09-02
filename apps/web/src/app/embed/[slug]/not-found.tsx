import { marqueDeRepli } from "@sm/contracts";
import { FeuilleDuMasque } from "@/components/masque/FeuilleDuMasque";
import { classesPolices } from "@/components/masque/polices";
import { styleDuMasque } from "@/components/masque/styleDuMasque";
import { cx } from "@/lib/cx";

/*
 * Slug inconnu : aucun masque à charger. C'est le REPLI NUIT plutôt que la
 * marque grise de Snack Manager — le pourquoi complet est dans
 * `app/r/[slug]/not-found.tsx`.
 */
const REPLI = marqueDeRepli(null, null);
const MASQUE_DE_REPLI = styleDuMasque(REPLI);

/** Slug inconnu dans une iframe : message court, sans lien de navigation. */
export default function EmbedNotFound() {
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
          Commande en ligne indisponible
        </h1>
        <p className="mt-2 text-[14px] leading-relaxed text-mut">
          Ce restaurant n’est pas (ou plus) configuré pour la commande en ligne.
        </p>
      </div>
    </main>
  );
}
