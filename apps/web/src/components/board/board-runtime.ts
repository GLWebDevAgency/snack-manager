"use client";

import { useEffect, useMemo, useState } from "react";

/**
 * Les trois garde-fous d'un écran que personne ne surveille.
 */

// ── 1 · Empêcher la mise en veille ──────────────────────────────

interface WakeLockSentinelLike {
  release(): Promise<void>;
}
interface WakeLockLike {
  request(type: "screen"): Promise<WakeLockSentinelLike>;
}

/**
 * L'API Wake Lock quand elle existe, le silence sinon.
 *
 * Une Fire TV s'endort au bout de 20 minutes sans interaction, et il n'y a
 * personne pour bouger une souris devant un écran accroché au plafond. Le
 * verrou saute à chaque passage en arrière-plan (mise en veille de la TV,
 * bascule d'entrée HDMI) : on le redemande au retour, sans rien afficher en cas
 * d'échec — l'API est absente d'un Chromecast, ce n'est pas une panne.
 */
export function useWakeLock(): void {
  useEffect(() => {
    const api = (navigator as Navigator & { wakeLock?: WakeLockLike }).wakeLock;
    if (!api) return;

    let alive = true;
    let sentinel: WakeLockSentinelLike | null = null;

    const acquire = async () => {
      if (!alive || document.visibilityState !== "visible") return;
      try {
        sentinel = await api.request("screen");
      } catch {
        /* refusé (onglet masqué, batterie faible) : sans conséquence */
      }
    };

    const onVisibility = () => {
      if (document.visibilityState === "visible") void acquire();
    };

    void acquire();
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      alive = false;
      document.removeEventListener("visibilitychange", onVisibility);
      void sentinel?.release().catch(() => {});
    };
  }, []);
}

// ── 2 · Rechargement quotidien ──────────────────────────────────

/** On vérifie à la minute : un `setTimeout` de 20 h dérive et ne survit pas
 *  à une mise en veille du processeur. */
const RELOAD_CHECK_MS = 60_000;

/**
 * Rechargement complet une fois par jour, à l'heure creuse fixée par l'API
 * (4 h du matin, décalée de quelques minutes écran par écran).
 *
 * C'est le garde-fou contre les fuites mémoire d'un navigateur de clé HDMI qui
 * tourne douze heures d'affilée : aucun snack ne sert à 4 h, et une page
 * fraîche vaut mieux qu'un écran figé au moment du coup de feu.
 */
export function useDailyReload(dailyReloadAt: string | null | undefined): void {
  useEffect(() => {
    if (!dailyReloadAt) return;
    const target = Date.parse(dailyReloadAt);
    if (!Number.isFinite(target)) return;

    // Une échéance DÉJÀ PASSÉE vient forcément d'un contenu mis en cache la
    // veille : la respecter enfermerait un écran privé de réseau dans un
    // rechargement toutes les minutes, à l'ouverture, devant les clients. On
    // attend le prochain contenu frais, qui porte toujours une heure à venir.
    if (target <= Date.now()) return;

    const timer = setInterval(() => {
      if (Date.now() >= target) window.location.reload();
    }, RELOAD_CHECK_MS);

    return () => clearInterval(timer);
  }, [dailyReloadAt]);
}

// ── 3 · L'heure du restaurant ───────────────────────────────────

const CLOCK_TICK_MS = 15_000;

/**
 * « 19:42 », dans le fuseau du RESTAURANT.
 *
 * Une clé HDMI sortie du carton est souvent réglée sur UTC ou sur le fuseau du
 * revendeur ; l'heure affichée en salle, elle, doit être celle du comptoir. On
 * ne remplace l'état que lorsque la minute change réellement : l'écran ne se
 * repeint donc pas toutes les 15 secondes pendant douze heures.
 */
export function useRestaurantClock(timezone: string | null | undefined): string {
  const formatter = useMemo(() => {
    try {
      return new Intl.DateTimeFormat("fr-FR", {
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
        ...(timezone ? { timeZone: timezone } : {}),
      });
    } catch {
      return new Intl.DateTimeFormat("fr-FR", {
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
      });
    }
  }, [timezone]);

  const [label, setLabel] = useState(() => formatter.format(new Date()));

  useEffect(() => {
    setLabel(formatter.format(new Date()));
    const timer = setInterval(() => {
      const next = formatter.format(new Date());
      setLabel((previous) => (previous === next ? previous : next));
    }, CLOCK_TICK_MS);
    return () => clearInterval(timer);
  }, [formatter]);

  return label;
}
