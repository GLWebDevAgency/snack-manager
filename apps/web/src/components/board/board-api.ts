"use client";

import type { ScreenContent, ScreenHeartbeat, ScreenPaired } from "@sm/contracts";

/**
 * Client HTTP de l'écran de salle.
 *
 * Un téléviseur n'a ni compte, ni session, ni personne devant lui : son
 * `deviceToken` est sa seule identité, et il voyage en query string parce
 * qu'une clé Fire TV pointe une URL — elle ne compose pas d'en-tête HTTP.
 */

export const BOARD_API_URL =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

/** Au-delà, la requête est abandonnée : sur un wifi qui tombe, une requête
 *  suspendue bloquerait la boucle de rafraîchissement pour la journée. */
const REQUEST_TIMEOUT_MS = 15_000;

export class BoardApiError extends Error {
  /** `0` = pas de réponse du tout (réseau coupé, DNS, timeout). */
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "BoardApiError";
    this.status = status;
  }

  /** Jeton refusé : l'écran a été dépairé ou son code régénéré. */
  get isRevoked(): boolean {
    return this.status === 401 || this.status === 403;
  }
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  // `AbortSignal.timeout` n'existe pas sur les navigateurs de clé HDMI :
  // l'AbortController manuel marche partout.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(`${BOARD_API_URL}${path}`, {
      ...init,
      cache: "no-store",
      signal: controller.signal,
    });
  } catch {
    throw new BoardApiError(0, "Serveur injoignable");
  } finally {
    clearTimeout(timer);
  }

  const payload: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    // Nest renvoie `{ message, error, statusCode }`, mais `message` devient un
    // TABLEAU quand la validation échoue sur plusieurs champs. Sur un écran de
    // salle, mieux vaut une phrase générique qu'un « [object Object] » en
    // capitales de 40 pixels.
    const raw = (payload as { message?: unknown } | null)?.message;
    const message =
      typeof raw === "string" && raw.trim().length > 0
        ? raw
        : `Erreur serveur (${response.status})`;
    throw new BoardApiError(response.status, message);
  }

  return payload as T;
}

/** Échange le code à 6 caractères contre un jeton d'appareil, une fois. */
export function pairScreen(pairingCode: string): Promise<ScreenPaired> {
  return call<ScreenPaired>("/public/screens/pair", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pairingCode }),
  });
}

/** Tout ce que l'écran doit peindre, en un seul aller-retour. */
export function fetchScreenContent(token: string): Promise<ScreenContent> {
  return call<ScreenContent>(
    `/public/screens/content?token=${encodeURIComponent(token)}`,
  );
}

/** Signe de vie + sonde de fraîcheur (l'empreinte du contenu revient avec). */
export function sendHeartbeat(token: string): Promise<ScreenHeartbeat> {
  return call<ScreenHeartbeat>(
    `/public/screens/heartbeat?token=${encodeURIComponent(token)}`,
    { method: "POST" },
  );
}
