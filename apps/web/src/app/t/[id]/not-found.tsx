import { marqueDeRepli } from "@sm/contracts";
import { FeuilleDuMasque } from "@/components/masque/FeuilleDuMasque";
import { classesPolices } from "@/components/masque/polices";
import { styleDuMasque } from "@/components/masque/styleDuMasque";
import { cx } from "@/lib/cx";

/*
 * Commande inconnue : ni slug, ni restaurant, donc aucun masque à charger.
 * C'est le REPLI NUIT plutôt que la marque grise de Snack Manager — le
 * pourquoi complet est dans `app/r/[slug]/not-found.tsx`.
 */
const REPLI = marqueDeRepli(null, null);
const MASQUE_DE_REPLI = styleDuMasque(REPLI);

/** Identifiant de commande inconnu ou périmé. */
export default function TrackingNotFound() {
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
      <div className="max-w-[360px]">
        <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-mut">
          Erreur 404
        </p>
        <h1 className="mt-2 text-[24px] font-extrabold tracking-[-0.035em] text-ink">
          Commande introuvable
        </h1>
        <p className="mt-3 text-[15px] leading-relaxed text-mut">
          Ce lien de suivi n’est plus valide. Présentez votre numéro de retrait
          au comptoir, il reste la référence.
        </p>
      </div>
    </main>
  );
}
