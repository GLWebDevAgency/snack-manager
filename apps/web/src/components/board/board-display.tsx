"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { CSSProperties } from "react";
import type { ScreenScenePayload } from "@sm/contracts";
import { useDailyReload, useWakeLock } from "./board-runtime";
import { SceneLayer } from "./board-scenes";
import { BoardHeader } from "./board-header";
import { boardPalette } from "./board-theme";
import { readDeviceToken } from "./board-store";
import { useBoardContent } from "./use-board-content";
import { useSceneRotation } from "./use-scene-rotation";
import { useStage } from "./use-stage";

/** Identité stable : une nouvelle liste vide à chaque rendu relancerait les
 *  effets du carrousel en boucle. */
const NO_SCENES: ScreenScenePayload[] = [];

/** « 14:32 », à l'heure du RESTAURANT — celle qu'un gérant peut recouper. */
function formatSync(at: number | null, timezone: string | null): string {
  if (!at) return "";
  try {
    return new Intl.DateTimeFormat("fr-FR", {
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
      ...(timezone ? { timeZone: timezone } : {}),
    }).format(new Date(at));
  } catch {
    return "";
  }
}

/**
 * L'AFFICHAGE — ce que voient les clients toute la journée.
 *
 * Plein écran, fond noir, aucun curseur, aucune barre. Le composant se contente
 * d'assembler : le contenu vient du cache puis du réseau, le rythme du serveur,
 * la mise à l'échelle du viewport. Tout ce qui bouge est confié au CSS —
 * `transform` et `opacity` uniquement — pour qu'une clé HDMI à 30 € tienne la
 * cadence douze heures d'affilée.
 */
export function BoardDisplay() {
  const router = useRouter();
  const [token, setToken] = useState<string | null>(null);
  const [checked, setChecked] = useState(false);

  // Le jeton est lu APRÈS le montage : le rendu serveur ne connaît pas
  // localStorage, et une divergence d'hydratation ferait clignoter l'écran.
  useEffect(() => {
    const stored = readDeviceToken();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- le jeton vient de localStorage, illisible au rendu serveur : le lire pendant le rendu provoquerait une divergence d'hydratation sur la télévision de la salle, au mieux un clignotement, au pire l'écran d'appairage montré aux clients en plein service.
    setToken(stored);
    setChecked(true);
    if (!stored) router.replace("/board");
  }, [router]);

  const { content, offline, lastSyncAt, revoked } = useBoardContent(token);

  // Jeton révoqué (écran supprimé, code régénéré) : retour à l'appairage.
  useEffect(() => {
    if (revoked) router.replace("/board");
  }, [revoked, router]);

  const scenes = content?.scenes ?? NO_SCENES;
  const { current, leaving, index } = useSceneRotation(scenes);
  const stage = useStage(content?.orientation ?? null);
  const palette = useMemo(
    () => boardPalette(content?.brand.accent, content?.theme),
    [content?.brand.accent, content?.theme],
  );

  useWakeLock();
  useDailyReload(content?.dailyReloadAt);

  // La photo de la scène SUIVANTE est chargée pendant celle en cours : sur le
  // wifi d'un snack, une image qui arrive en même temps que la scène se voit.
  useEffect(() => {
    if (scenes.length < 2) return;
    const next = scenes[(index + 1) % scenes.length];
    for (const product of next?.products ?? []) {
      if (product.photoUrl) new Image().src = product.photoUrl;
    }
  }, [index, scenes]);

  const brand = content?.brand ?? null;
  const multiScene = scenes.length > 1;

  return (
    <div className="bd-root bd-display" style={palette}>
      <div
        className="bd-stage"
        data-orientation={stage.orientation}
        data-ready={stage.ready ? "1" : "0"}
        style={stage.style}
      >
        {brand ? (
          <BoardHeader
            brand={brand}
            serviceLabel={content?.serviceLabel ?? ""}
            open={content?.open ?? false}
            timezone={content?.timezone ?? null}
          />
        ) : null}

        <div className="bd-stagearea">
          {leaving ? (
            <SceneLayer
              key={`out-${leaving.id}`}
              scene={leaving}
              phase="out"
              orientation={stage.orientation}
              brandName={brand?.name ?? ""}
              logoUrl={brand?.logoUrl ?? null}
            />
          ) : null}

          {current ? (
            <SceneLayer
              key={current.id}
              scene={current}
              phase="in"
              orientation={stage.orientation}
              brandName={brand?.name ?? ""}
              logoUrl={brand?.logoUrl ?? null}
            />
          ) : (
            // Ni réseau ni cache : une plaque sobre, jamais un écran noir.
            <div className="bd-layer" data-phase="in">
              <div className="bd-plate">
                <div className="bd-plate-kicker">Menu Board</div>
                <div className="bd-plate-title">
                  {checked && !token ? "Écran non appairé" : "Chargement de la carte"}
                </div>
                <div className="bd-plate-line">
                  {checked && !token
                    ? "Redirection vers l'appairage…"
                    : "Le dernier menu connu s'affichera dès qu'il sera disponible."}
                </div>
              </div>
            </div>
          )}

          {offline ? (
            <div className="bd-offline">
              <span className="bd-offline-dot" />
              Hors ligne
              {lastSyncAt
                ? ` · carte de ${formatSync(lastSyncAt, content?.timezone ?? null)}`
                : ""}
            </div>
          ) : null}
        </div>

        <div className="bd-progress">
          {multiScene && current ? (
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
