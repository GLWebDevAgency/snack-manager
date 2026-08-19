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
}: {
  shot: Shot;
  className?: string;
  /** Première carte du deck : chargée en priorité, c'est elle qui porte le LCP. */
  eager?: boolean;
  sizes?: string;
}) {
  const [failed, setFailed] = useState(false);

  return (
    <span className={className ? `ph ${className}` : "ph"}>
      {failed ? (
        <span className="ph-fb">{shot.alt}</span>
      ) : (
        /* eslint-disable-next-line @next/next/no-img-element */
        <img
          src={shot.src}
          alt={shot.alt}
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
