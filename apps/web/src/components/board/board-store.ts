"use client";

import type { ScreenContent, ScreenPaired } from "@sm/contracts";

/**
 * Mémoire locale de l'écran.
 *
 * Deux promesses tiennent dans ce fichier :
 *
 *  - on n'appaire QU'UNE FOIS. La TV est accrochée au mur, souvent au-dessus du
 *    comptoir : personne ne montera sur un escabeau parce qu'une coupure de
 *    courant a redémarré la clé HDMI. Le jeton est donc persistant ;
 *  - le wifi d'un snack tombe. Le dernier contenu connu est conservé tel quel
 *    et rejoué au démarrage, AVANT même la première réponse réseau — un écran
 *    noir en salle vaut une affiche arrachée.
 *
 * Tous les accès sont enveloppés : navigation privée, quota plein ou stockage
 * désactivé ne doivent jamais faire tomber l'affichage.
 */

const TOKEN_KEY = "sm.board.token";
const SCREEN_KEY = "sm.board.screen";
const CONTENT_KEY = "sm.board.content";

type PairedMeta = Omit<ScreenPaired, "deviceToken">;

function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* stockage indisponible : l'écran fonctionne, il oublie juste au reboot. */
  }
}

function drop(key: string): void {
  try {
    window.localStorage.removeItem(key);
  } catch {
    /* rien à faire */
  }
}

export function readDeviceToken(): string | null {
  const token = read(TOKEN_KEY);
  return token && token.length > 0 ? token : null;
}

export function savePairing(paired: ScreenPaired): void {
  const { deviceToken, ...meta } = paired;
  write(TOKEN_KEY, deviceToken);
  write(SCREEN_KEY, JSON.stringify(meta));
}

export function readPairedMeta(): PairedMeta | null {
  const raw = read(SCREEN_KEY);
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && "screenId" in parsed) {
      return parsed as PairedMeta;
    }
  } catch {
    /* entrée corrompue */
  }
  return null;
}

/** Jeton révoqué côté serveur : on repart proprement sur l'appairage. */
export function clearPairing(): void {
  drop(TOKEN_KEY);
  drop(SCREEN_KEY);
  drop(CONTENT_KEY);
}

/**
 * Contenu mis en cache.
 *
 * La forme est vérifiée au minimum (des scènes, une empreinte) : un cache écrit
 * par une version précédente ne doit pas faire planter la version en place —
 * l'écran repartirait en boucle de rechargement, sans personne pour le voir.
 */
export function readCachedContent(): ScreenContent | null {
  const raw = read(CONTENT_KEY);
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      parsed &&
      typeof parsed === "object" &&
      Array.isArray((parsed as ScreenContent).scenes) &&
      typeof (parsed as ScreenContent).contentHash === "string" &&
      (parsed as ScreenContent).brand
    ) {
      return parsed as ScreenContent;
    }
  } catch {
    /* cache illisible : on repart du réseau */
  }
  drop(CONTENT_KEY);
  return null;
}

export function writeCachedContent(content: ScreenContent): void {
  write(CONTENT_KEY, JSON.stringify(content));
}
