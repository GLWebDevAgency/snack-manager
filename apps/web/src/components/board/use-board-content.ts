"use client";

import { useEffect, useRef, useState } from "react";
import type { ScreenContent } from "@sm/contracts";
import { BoardApiError, fetchScreenContent, sendHeartbeat } from "./board-api";
import { clearPairing, readCachedContent, writeCachedContent } from "./board-store";

/**
 * La boucle de vie de l'écran : cache d'abord, réseau ensuite, jamais d'écran
 * noir.
 *
 * Ordre des opérations, dans cet ordre exact :
 *
 *  1. le dernier contenu connu est peint IMMÉDIATEMENT, avant toute requête.
 *     Une clé HDMI qui redémarre pendant le coup de feu réaffiche la carte en
 *     moins d'une seconde, même si la box du snack met une minute à revenir ;
 *  2. le contenu est rechargé toutes les 60 s, mais l'état React n'est remplacé
 *     QUE si `contentHash` a bougé. Sans ce garde-fou, l'écran se repeindrait
 *     720 fois par service et casserait l'animation en cours à chaque fois ;
 *  3. en cas d'échec, on garde le cache à l'écran et on réessaie avec un délai
 *     croissant (5 s → 2 min). Le bandeau « hors ligne » n'apparaît qu'après
 *     TROIS échecs consécutifs : une coupure de dix secondes ne mérite pas
 *     d'inquiéter les clients dans la file ;
 *  4. un battement de cœur toutes les 5 minutes date le dernier signe de vie
 *     pour le back-office, et sert de sonde de fraîcheur : si l'empreinte qu'il
 *     rapporte diffère, le contenu est rechargé sans attendre le prochain tour.
 */

const HEARTBEAT_INTERVAL_MS = 5 * 60_000;
const FALLBACK_POLL_MS = 60_000;
const OFFLINE_AFTER_FAILURES = 3;
const RETRY_BASE_MS = 5_000;
const RETRY_MAX_MS = 120_000;

function retryDelay(failures: number): number {
  return Math.min(RETRY_BASE_MS * 2 ** (failures - 1), RETRY_MAX_MS);
}

export interface BoardFeed {
  content: ScreenContent | null;
  /** Plusieurs échecs d'affilée : l'écran affiche son cache, et le dit. */
  offline: boolean;
  /** Horodatage du dernier contenu reçu — affiché dans le bandeau hors ligne. */
  lastSyncAt: number | null;
  /** Jeton refusé : l'écran doit se ré-appairer. */
  revoked: boolean;
}

export function useBoardContent(token: string | null): BoardFeed {
  const [content, setContent] = useState<ScreenContent | null>(null);
  const [revoked, setRevoked] = useState(false);
  // Un seul objet : le bandeau ne bascule qu'aux transitions, ce qui garantit
  // qu'un cycle réseau réussi ne déclenche AUCUN rendu quand rien n'a changé.
  const [link, setLink] = useState<{ offline: boolean; lastSyncAt: number | null }>({
    offline: false,
    lastSyncAt: null,
  });

  const hashRef = useRef<string | null>(null);

  useEffect(() => {
    if (!token) return;

    let alive = true;
    let failures = 0;
    let lastSyncAt: number | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;

    // 1 · le cache, tout de suite.
    const cached = readCachedContent();
    if (cached) {
      hashRef.current = cached.contentHash;
      setContent(cached);
    }

    const schedule = (delay: number) => {
      if (!alive) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        void refresh();
      }, delay);
    };

    const refresh = async (): Promise<void> => {
      if (!alive) return;
      try {
        const next = await fetchScreenContent(token);
        if (!alive) return;

        failures = 0;
        lastSyncAt = Date.now();
        setLink((previous) => (previous.offline ? { offline: false, lastSyncAt } : previous));

        // 2 · on ne repeint que si le contenu a réellement changé.
        if (next.contentHash !== hashRef.current) {
          hashRef.current = next.contentHash;
          setContent(next);
          writeCachedContent(next);
        }

        schedule(next.pollIntervalMs > 0 ? next.pollIntervalMs : FALLBACK_POLL_MS);
      } catch (error) {
        if (!alive) return;

        if (error instanceof BoardApiError && error.isRevoked) {
          // Écran dépairé ou code régénéré : inutile de marteler le serveur.
          clearPairing();
          setRevoked(true);
          return;
        }

        // 3 · le cache reste à l'écran ; on réessaie de plus en plus lentement.
        failures += 1;
        if (failures === OFFLINE_AFTER_FAILURES) {
          const at = lastSyncAt;
          setLink({ offline: true, lastSyncAt: at });
        }
        schedule(retryDelay(failures));
      }
    };

    // 4 · battement de cœur — signe de vie ET sonde de fraîcheur.
    const beat = async (): Promise<void> => {
      if (!alive) return;
      try {
        const pulse = await sendHeartbeat(token);
        if (alive && pulse.contentHash !== hashRef.current) void refresh();
      } catch {
        /* la boucle de contenu porte déjà l'état de la liaison */
      }
    };

    const onBackOnline = () => {
      failures = 0;
      void refresh();
    };

    void refresh();
    void beat();
    const beatTimer = setInterval(() => void beat(), HEARTBEAT_INTERVAL_MS);
    window.addEventListener("online", onBackOnline);

    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
      clearInterval(beatTimer);
      window.removeEventListener("online", onBackOnline);
    };
  }, [token]);

  return { content, offline: link.offline, lastSyncAt: link.lastSyncAt, revoked };
}
