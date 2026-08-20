"use client";

/**
 * Bandeau de démonstration — la sortie de secours du visiteur.
 *
 * Un seul composant pour les DEUX surfaces web (back-office du gérant,
 * commande en ligne), et la même forme que les deux surfaces Expo (caisse,
 * écran cuisine) qui, elles, ne peuvent pas le partager. C'est voulu : les
 * quatre démonstrations racontent la même chose, elles doivent se ressembler.
 *
 * ─── OÙ IL SE POSE, ET POURQUOI LÀ ───
 *
 * En HAUT, DANS LE FLUX, jamais en surimpression. Un bandeau flottant finit
 * toujours par recouvrir quelque chose — sur la commande en ligne, ce serait
 * précisément le rail de catégories collant, c'est-à-dire la navigation de la
 * carte ; dans le back-office, la barre de titre. Posé dans le flux, il ne
 * peut RIEN recouvrir : il prend 44 px et rend le reste.
 *
 * Dans le back-office, la coque occupe exactement la fenêtre : la barre y est
 * donc visible en permanence. Sur la commande en ligne, page qui défile, elle
 * est en tête de document — le premier écran, celui qu'on voit sans chercher.
 *
 * ─── POURQUOI IL N'APPARAÎT QU'APRÈS HYDRATATION ───
 *
 * Trois des quatre décisions (cadre, référent, origine) n'existent que dans le
 * navigateur. Rendre quoi que ce soit côté serveur ferait diverger
 * l'hydratation ; pire, dans l'iframe de la vitrine, le bandeau apparaîtrait
 * puis disparaîtrait — un clignotement dans le châssis d'appareil de la page
 * d'accueil. `useSyncExternalStore` avec un instantané serveur `null` est la
 * forme sanctionnée : rien au premier rendu, la barre juste après.
 */

import { useSyncExternalStore } from "react";
import {
  DEMO_BAR_H,
  contexteNavigateur,
  retourDemo,
  type ContexteRetour,
} from "./retour";

/** Aucun abonnement : le contexte du navigateur ne change pas en cours de page. */
const sansAbonnement = () => () => {};
const rienAuServeur = (): Omit<ContexteRetour, "demo"> | null => null;

export function BandeauDemo({ actif }: { actif: boolean }) {
  const contexte = useSyncExternalStore(
    sansAbonnement,
    contexteNavigateur,
    rienAuServeur,
  );

  const retour = contexte ? retourDemo({ demo: actif, ...contexte }) : null;
  if (!retour) return null;

  return (
    <div
      // `shrink-0` : dans la coque en colonne du back-office, la barre ne se
      // laisse pas comprimer par le contenu. Le filet doré dit qu'elle est à
      // NOUS et non au produit qu'elle encadre — et il évite deux plans de
      // même valeur côte à côte (DA §1).
      className="flex shrink-0 items-center justify-between gap-3 border-b border-gold/40 bg-surface px-3.5"
      style={{ height: DEMO_BAR_H }}
      data-sm-demo="bandeau"
    >
      <a
        href={retour.href}
        aria-label={`${retour.libelle} — Snack Manager`}
        className="cf-press flex min-h-8 shrink-0 items-center gap-2 rounded-pill border border-white/14 bg-white/6 px-3 py-1.5 text-[13.5px] font-bold tracking-[-0.01em] text-ink hover:border-gold/55 hover:bg-gold/15"
      >
        {retour.retour && (
          <span aria-hidden className="text-[15px] leading-none text-gold">
            ←
          </span>
        )}
        <span className="whitespace-nowrap">{retour.libelle}</span>
      </a>

      <div className="flex min-w-0 items-center gap-2">
        <span
          aria-hidden
          className="grid size-[22px] shrink-0 place-items-center rounded-[6px] bg-gold text-[10.5px] font-extrabold tracking-[0.02em] text-[#12100d]"
        >
          SM
        </span>
        {/* Le nom cède la place avant la mention : sur un téléphone, savoir
            que rien n'est enregistré compte plus que relire notre marque, que
            la tuile porte déjà. Le seuil est `md` (768 px), le même que
            `COMPACT_W` côté caisse et cuisine — la barre change de forme au
            même endroit sur les quatre démonstrations. */}
        <span className="hidden whitespace-nowrap text-[13px] font-bold text-ink md:inline">
          {retour.marque}
        </span>
        <span className="truncate text-[13px] font-medium text-mut">
          <span className="hidden md:inline">{retour.mention}</span>
          <span className="md:hidden">{retour.mentionCourte}</span>
        </span>
      </div>
    </div>
  );
}
