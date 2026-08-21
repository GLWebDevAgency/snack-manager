"use client";

import { useState } from "react";
import type { Shot } from "./content";

/**
 * Image réelle (capture d'application ou photo du restaurant pilote) avec
 * repli propre : si le fichier manque encore dans `public/`, on affiche un
 * cartouche sombre plutôt qu'un pictogramme d'image cassée. Les captures sont
 * produites en parallèle — la landing ne doit pas casser parce qu'un PNG
 * n'est pas encore là.
 *
 * On reste sur un `<img>` natif plutôt que `next/image` : ces fichiers sont
 * servis tels quels depuis `public/`, sans domaine externe ni transformation,
 * et la vitrine n'a alors aucune dépendance à l'optimiseur d'images au
 * runtime. Le coût est un poids de fichier brut, assumé et mesuré.
 */
export function Photo({
  shot,
  className,
  eager,
  sizes,
  decorative,
}: {
  shot: Shot;
  className?: string;
  /** Première carte du deck : chargée en priorité, c'est elle qui porte le LCP. */
  eager?: boolean;
  sizes?: string;
  /**
   * L'IMAGE N'APPORTE RIEN À QUI NE LA VOIT PAS — cas des bandes à fond perdu
   * de `/offres`, où la photo pose une ambiance derrière un texte qui, lui, dit
   * déjà tout.
   *
   * `alt=""` NE SUFFIT PAS. Il retire l'image de l'arbre d'accessibilité dans
   * la plupart des lecteurs, mais `aria-hidden` sur l'enveloppe garantit aussi
   * que le cartouche de repli — qui est du TEXTE — ne soit jamais annoncé. Sans
   * les deux, un lecteur d'écran énumère des plats entre deux paragraphes de
   * tarifs, et le trajet vers le prix s'allonge d'autant.
   *
   * Une image qui porte une INFORMATION (la capture de l'application qu'on est
   * en train de vendre) ne prend jamais ce drapeau : elle garde son texte
   * alternatif.
   */
  decorative?: boolean;
}) {
  const [failed, setFailed] = useState(false);

  return (
    <span className={className ? `ph ${className}` : "ph"} aria-hidden={decorative || undefined}>
      {failed ? (
        // Le repli d'une image décorative est un aplat, pas une légende : un
        // texte qui apparaît au milieu d'une bande le jour où un fichier manque
        // serait pire que l'absence d'image.
        <span className="ph-fb">{decorative ? null : shot.alt}</span>
      ) : (
        /* eslint-disable-next-line @next/next/no-img-element */
        <img
          src={shot.src}
          alt={decorative ? "" : shot.alt}
          loading={eager ? "eager" : "lazy"}
          fetchPriority={eager ? "high" : "auto"}
          decoding="async"
          sizes={sizes}
          onError={() => setFailed(true)}
        />
      )}
    </span>
  );
}
