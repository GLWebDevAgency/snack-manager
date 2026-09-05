"use client";

import { useEffect, useMemo, useState, type CSSProperties, type RefObject } from "react";
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
 *
 * La règle est une fonction PURE (`computeStage`), partagée par le téléviseur
 * (la fenêtre) et par le back-office (un conteneur) : la même règle, donc le
 * même rendu dans le tiroir « Apparence » et en salle.
 */

const REFERENCE: Record<ScreenOrientation, { width: number; height: number }> = {
  landscape: { width: 1920, height: 1080 },
  portrait: { width: 1080, height: 1920 },
};

export interface StageStyle extends CSSProperties {
  "--bd-w": string;
  "--bd-h": string;
  "--bd-scale": number;
  "--bd-rot": string;
}

export interface Stage {
  orientation: ScreenOrientation;
  /** La scène est pivotée : le matériel ne sort pas dans le bon sens. */
  rotated: boolean;
  ready: boolean;
  /** À poser sur l'élément `.bd-stage`. */
  style: StageStyle;
}

interface Viewport {
  width: number;
  height: number;
}

export function computeStage(viewport: Viewport, configured: ScreenOrientation | null): Stage {
  const ready = viewport.width > 0 && viewport.height > 0;
  const detected: ScreenOrientation = viewport.width >= viewport.height ? "landscape" : "portrait";
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
    },
  };
}

const SAME = (a: Viewport, b: Viewport) => a.width === b.width && a.height === b.height;

/** Le téléviseur : la scène suit la fenêtre. */
export function useStage(configured: ScreenOrientation | null): Stage {
  const [viewport, setViewport] = useState<Viewport>({ width: 0, height: 0 });

  useEffect(() => {
    const measure = () =>
      setViewport((previous) => {
        const next = { width: window.innerWidth, height: window.innerHeight };
        // Même mesure : pas de re-rendu (l'écran tourne 12 h/jour).
        return SAME(previous, next) ? previous : next;
      });

    measure();
    window.addEventListener("resize", measure);
    window.addEventListener("orientationchange", measure);
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("orientationchange", measure);
    };
  }, []);

  return useMemo(() => computeStage(viewport, configured), [configured, viewport]);
}

/**
 * Le back-office : la scène suit un CONTENEUR, dont le ratio est celui de
 * l'orientation — donc jamais de rotation. `ResizeObserver` plutôt que
 * `resize` : le tiroir s'ouvre, la colonne se replie, le conteneur bouge
 * sans que la fenêtre change.
 */
export function useEmbeddedStage(
  ref: RefObject<HTMLElement | null>,
  configured: ScreenOrientation,
): Stage {
  const [viewport, setViewport] = useState<Viewport>({ width: 0, height: 0 });

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const measure = () => {
      const rect = element.getBoundingClientRect();
      setViewport((previous) => {
        const next = { width: rect.width, height: rect.height };
        return SAME(previous, next) ? previous : next;
      });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);

  return useMemo(() => computeStage(viewport, configured), [configured, viewport]);
}
