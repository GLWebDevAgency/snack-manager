"use client";

import { useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import type { ScreenOrientation } from "@sm/contracts";

/**
 * La scène de référence et sa mise à l'échelle.
 *
 * L'écran est DESSINÉ à une résolution fixe — 1920 × 1080 en paysage,
 * 1080 × 1920 en portrait — puis ramené au viewport par un unique
 * `transform: scale()`. Trois raisons, toutes de terrain :
 *
 *  - la lisibilité devient prévisible : ce qui se lit à trois mètres en 1080p
 *    se lit à l'identique sur un 4K de 2 500 € comme sur le 1366 × 768 d'une
 *    Smart TV d'entrée de gamme, sans point de rupture à régler un par un ;
 *  - `scale` est une transformation composée par le GPU : le redimensionnement
 *    ne provoque aucun recalcul de mise en page sur un processeur de clé HDMI ;
 *  - un écran physiquement pivoté (le mât vertical d'une salle) reçoit malgré
 *    tout un signal paysage de sa clé HDMI. On fait alors pivoter la scène de
 *    90° — c'est exactement ce que fait un lecteur d'affichage dynamique, et
 *    c'est la seule façon de respecter l'orientation CONFIGURÉE sur l'écran
 *    quand le matériel, lui, n'en sait rien.
 */

const REFERENCE: Record<ScreenOrientation, { width: number; height: number }> = {
  landscape: { width: 1920, height: 1080 },
  portrait: { width: 1080, height: 1920 },
};

export interface Stage {
  orientation: ScreenOrientation;
  /** La scène est pivotée : le matériel ne sort pas dans le bon sens. */
  rotated: boolean;
  ready: boolean;
  /** À poser sur l'élément `.bd-stage`. */
  style: CSSProperties;
}

export function useStage(configured: ScreenOrientation | null): Stage {
  const [viewport, setViewport] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const measure = () =>
      setViewport((previous) =>
        previous.width === window.innerWidth && previous.height === window.innerHeight
          ? previous // même mesure : pas de re-rendu (l'écran tourne 12 h/jour)
          : { width: window.innerWidth, height: window.innerHeight },
      );

    measure();
    window.addEventListener("resize", measure);
    window.addEventListener("orientationchange", measure);
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("orientationchange", measure);
    };
  }, []);

  return useMemo(() => {
    const ready = viewport.width > 0 && viewport.height > 0;
    const detected: ScreenOrientation =
      viewport.width >= viewport.height ? "landscape" : "portrait";
    const orientation = configured ?? detected;
    const rotated = ready && orientation !== detected;
    const { width, height } = REFERENCE[orientation];

    // Pivotée, la scène occupe `height × width` à l'écran : l'échelle se
    // calcule sur les dimensions échangées.
    const scale = !ready
      ? 1
      : rotated
        ? Math.min(viewport.width / height, viewport.height / width)
        : Math.min(viewport.width / width, viewport.height / height);

    return {
      orientation,
      rotated,
      ready,
      style: {
        "--bd-w": `${width}px`,
        "--bd-h": `${height}px`,
        "--bd-scale": scale,
        "--bd-rot": rotated ? "90deg" : "0deg",
      } as CSSProperties,
    };
  }, [configured, viewport.width, viewport.height]);
}
