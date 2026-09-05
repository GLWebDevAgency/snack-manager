"use client";

import { useMemo, type CSSProperties, type ReactNode } from "react";
import {
  TYPE_PAIRS,
  marqueDeRepli,
  type Brand,
  type ScreenContent,
  type ScreenScenePayload,
} from "@sm/contracts";
import { cx } from "@/lib/cx";
import { classesPolices } from "@/components/masque/polices";
import { styleDuMasque } from "@/components/masque/styleDuMasque";
import { BoardHeader } from "./board-header";
import { SceneLayer } from "./scene-layer";
import { moduleDe } from "./scenographies/registry";
import type { Stage } from "./use-stage";

/**
 * Le masque que l'écran PEINT.
 *
 * Un cache écrit par une version antérieure n'en porte pas : on replie sur
 * l'accent et le logo plats plutôt que sur un écran noir, le temps du prochain
 * contenu frais — qui arrive dans la minute.
 */
export function masqueDuContenu(content: ScreenContent | null): Brand {
  if (content?.masque) return content.masque;
  return marqueDeRepli(content?.brand.accent ?? null, content?.brand.logoUrl ?? null);
}

/**
 * L'HÔTE — ce que toute scénographie reçoit sans le refaire.
 *
 * Le cadre de référence mis à l'échelle, les jetons du masque et les polices
 * de l'accord sur la racine, l'en-tête persistant si la scénographie le
 * demande, les deux couches du fondu, la barre de progression. Le téléviseur
 * et le tiroir « Apparence » montent le même composant : `embed` ne change
 * que la géométrie (le conteneur au lieu de la fenêtre), jamais le rendu.
 */
export function BoardStage({
  content,
  current,
  leaving,
  stage,
  embed = false,
  still = false,
  paused = false,
  fallback = null,
  overlay = null,
  className,
}: {
  content: ScreenContent | null;
  current: ScreenScenePayload | null;
  leaving: ScreenScenePayload | null;
  stage: Stage;
  /** Incrusté dans une page (aperçu) : géométrie du conteneur, curseur visible. */
  embed?: boolean;
  /** Mouvement figé — les tuiles de choix du tiroir. */
  still?: boolean;
  /** Pause de la lecture ; les entrées restent jouées pour permettre la navigation. */
  paused?: boolean;
  /** Ce qui s'affiche sans scène (chargement, non appairé). */
  fallback?: ReactNode;
  /** Par-dessus les scènes, dans l'aire : le bandeau « hors ligne ». */
  overlay?: ReactNode;
  className?: string;
}) {
  const masque = useMemo(() => masqueDuContenu(content), [content]);
  // Mémorisé : `resoudreMarque()` recalcule une trentaine de mélanges, et la
  // référence sert de `style` — la recréer repeindrait tout le sous-arbre.
  const skin = useMemo(() => styleDuMasque(masque), [masque]);
  const prixMono = TYPE_PAIRS[masque.type.pair].prixMono;
  const chrome = moduleDe(content?.scenography).chrome;
  const multiScene = (content?.scenes.length ?? 0) > 1;

  return (
    <div
      className={cx("bd-root", classesPolices, className)}
      style={skin}
      data-embed={embed ? "1" : "0"}
      data-still={still ? "1" : "0"}
      data-paused={paused ? "1" : "0"}
      data-scenography={content?.scenography ?? "ardoise"}
      data-prix-mono={prixMono ? "1" : "0"}
      data-mode={masque.mode}
    >
      <div
        className="bd-stage"
        data-orientation={stage.orientation}
        data-ready={stage.ready ? "1" : "0"}
        style={stage.style}
      >
        {content && chrome === "header" ? (
          <BoardHeader
            masque={masque}
            brand={content.brand}
            serviceLabel={content.serviceLabel}
            open={content.open}
            timezone={content.timezone}
          />
        ) : null}

        <div className="bd-stagearea">
          {leaving && content ? (
            <SceneLayer
              key={`out-${leaving.id}`}
              scene={leaving}
              content={content}
              phase="out"
              prixMono={prixMono}
            />
          ) : null}

          {current && content ? (
            <SceneLayer
              key={current.id}
              scene={current}
              content={content}
              phase="in"
              prixMono={prixMono}
            />
          ) : (
            fallback
          )}

          {overlay}
        </div>

        <div className="bd-progress">
          {multiScene && current && !still ? (
            <div
              key={current.id}
              className="bd-progress-fill"
              style={{ "--bd-dur": `${current.durationMs}ms` } as CSSProperties}
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}
