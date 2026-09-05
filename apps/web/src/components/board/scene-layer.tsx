"use client";

import type { Brand, ScreenContent, ScreenScenePayload } from "@sm/contracts";
import { moduleDe } from "./scenographies/registry";

/**
 * Une couche de scène.
 *
 * Deux couches coexistent le temps du fondu (l'entrante par-dessus la
 * sortante) : c'est ce qui évite le passage par le noir entre deux scènes. La
 * composition elle-même est déléguée au module de la scénographie de l'écran.
 */
export function SceneLayer({
  scene,
  content,
  masque,
  phase,
  prixMono,
}: {
  scene: ScreenScenePayload;
  content: ScreenContent;
  masque: Brand;
  phase: "in" | "out";
  prixMono: boolean;
}) {
  const { Component } = moduleDe(content.scenography);
  return (
    <div className="bd-layer" data-phase={phase} aria-hidden={phase === "out"}>
      <Component
        scene={scene}
        content={content}
        masque={masque}
        orientation={content.orientation}
        prixMono={prixMono}
      />
    </div>
  );
}
