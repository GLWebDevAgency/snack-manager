"use client";

import { useState } from "react";
import { cx } from "@/lib/cx";

/** Initiales de repli : deux lettres, articles et prépositions écartés. */
const FILLER = /^(le|la|les|l|de|du|des|d|au|aux|à|et|the)$/i;

export function monogram(name: string): string {
  const words = name.trim().split(/[\s'’-]+/).filter(Boolean);
  const strong = words.filter((w) => !FILLER.test(w));
  const source = strong.length > 0 ? strong : words;
  // Un seul mot (« Végétarien ») : deux lettres. Une initiale isolée flotte au
  // milieu du plateau, deux lettres tiennent la surface comme un monogramme.
  const letters =
    source.length > 1
      ? source
          .slice(0, 2)
          .map((w) => w[0] ?? "")
          .join("")
      : (source[0] ?? name.trim()).slice(0, 2);
  return (letters || name.trim().slice(0, 2)).toUpperCase();
}

/**
 * Plateau : le réceptacle de TOUT visuel produit (carte, rail, panier, fiche).
 *
 * Trois exigences, un seul composant :
 *  — les photos de la carte sont **détournées** et de format libre : elles
 *    tiennent par défaut en `contain` sur un halo ; un cadrage `cover`
 *    demande le choix explicite du gérant dans sa fiche produit ;
 *  — un produit sans photo — la majorité de la carte — reçoit le monogramme
 *    en contour : une mise en page réglée, pas un cadre vide ;
 *  — une photo qui ne charge PAS bascule sur ce même monogramme. Sans cela le
 *    navigateur dessine son icône d'image cassée, ce qui donne à la carte
 *    l'air d'un site en panne.
 */
export function Plate({
  photoUrl,
  name,
  className,
  radius = "rounded-card",
  /** Corps du monogramme de repli, en pixels. */
  mono = 22,
  /** Marge intérieure de la photo (le détourage respire). */
  pad = "p-[7%]",
  cover = false,
}: {
  photoUrl: string | null;
  name: string;
  className?: string;
  radius?: string;
  mono?: number;
  pad?: string;
  /** Cadrage choisi explicitement dans la fiche produit administrateur. */
  cover?: boolean;
}) {
  /**
   * L’état porte l’URL qu’il juge : la feuille produit réutilise le même
   * plateau d’un produit à l’autre, une photo cassée ne doit pas condamner la
   * suivante (motif « ajuster l’état pendant le rendu » de la doc React).
   */
  const [state, setState] = useState({ url: photoUrl, broken: false });
  if (state.url !== photoUrl) setState({ url: photoUrl, broken: false });
  const shown = photoUrl && !state.broken;
  const fail = () => setState({ url: photoUrl, broken: true });
  return (
    <span
      aria-hidden
      className={cx(
        "sm-plate relative grid shrink-0 place-items-center overflow-hidden border border-ink/6",
        radius,
        className,
      )}
    >
      {shown ? (
        // Photo tenant : domaine non maîtrisé, next/image imposerait une
        // liste blanche — <img> volontaire, avec repli à l'erreur.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={photoUrl}
          alt=""
          loading="lazy"
          decoding="async"
          onError={fail}
          /* La page est rendue côté serveur : une image morte a déjà échoué
             quand React s’attache, et `onError` ne se déclenchera JAMAIS. On
             relit donc l’état réel du nœud au montage — sans quoi le
             navigateur laisse son icône d’image cassée dans la carte. */
          ref={(node) => {
            if (node?.complete && node.naturalWidth === 0) fail();
          }}
          className={cx("absolute inset-0 size-full min-h-0 min-w-0", cover ? "object-cover" : "sm-cut object-contain", !cover && pad)}
        />
      ) : (
        <span
          style={{ fontSize: mono }}
          className="sm-mono relative font-black uppercase leading-none"
        >
          {monogram(name)}
        </span>
      )}
    </span>
  );
}
