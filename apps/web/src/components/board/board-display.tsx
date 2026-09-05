"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { ScreenScenePayload } from "@sm/contracts";
import { mediasDuContenu, precacherMedias, useServiceWorkerEcran } from "./board-autonomie";
import { useDailyReload, useWakeLock } from "./board-runtime";
import { BoardStage } from "./board-stage";
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
 * Plein écran, aucun curseur, aucune barre. Le composant se contente
 * d'assembler : le contenu vient du cache puis du réseau, le rythme du serveur,
 * la mise à l'échelle du viewport, et l'HÔTE (`BoardStage`) peint le masque du
 * restaurant puis délègue chaque scène à la scénographie de l'écran. Tout ce
 * qui bouge est confié au CSS — `transform` et `opacity` uniquement — pour
 * qu'une clé HDMI à 30 € tienne la cadence douze heures d'affilée.
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
  const { current, leaving, index, playbackVersion } = useSceneRotation(scenes, {
    playbackKey: content ? `${content.scenography ?? "ardoise"}:${content.orientation}` : undefined,
  });
  const stage = useStage(content?.orientation ?? null);

  useWakeLock();
  useDailyReload(content?.dailyReloadAt);
  useServiceWorkerEcran();

  // À chaque contenu frais, le worker reçoit la liste des médias de la boucle :
  // il précache ce qui manque et purge ce qui n'y est plus. Sur l'empreinte,
  // pas sur l'objet : un même contenu relu ne relance rien.
  const contentHash = content?.contentHash ?? null;
  useEffect(() => {
    if (!contentHash) return;
    precacherMedias(mediasDuContenu(content));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contentHash]);

  // La photo de la scène SUIVANTE est chargée pendant celle en cours : sur le
  // wifi d'un snack, une image qui arrive en même temps que la scène se voit.
  useEffect(() => {
    if (scenes.length < 2) return;
    const next = scenes[(index + 1) % scenes.length];
    for (const product of next?.products ?? []) {
      if (product.photoUrl) new Image().src = product.photoUrl;
    }
  }, [index, scenes]);

  return (
    <BoardStage
      content={content}
      current={current}
      leaving={leaving}
      playbackVersion={playbackVersion}
      stage={stage}
      className="bd-display"
      fallback={
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
      }
      overlay={
        offline ? (
          <div className="bd-offline">
            <span className="bd-offline-dot" />
            Hors ligne
            {lastSyncAt
              ? ` · carte de ${formatSync(lastSyncAt, content?.timezone ?? null)}`
              : ""}
          </div>
        ) : null
      }
    />
  );
}
