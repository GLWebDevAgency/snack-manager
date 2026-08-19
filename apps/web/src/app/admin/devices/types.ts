/**
 * Vue « Caisses & cuisine » — types partagés et règles d'affichage.
 *
 * Rien ici ne recalcule ce que l'API sait déjà : `statusLabel` et `kindLabel`
 * arrivent rédigés depuis `devices.view.ts`. On ne dérive localement que ce qui
 * dépend de l'HORLOGE DU NAVIGATEUR — la teinte de l'état et le compte à
 * rebours du code — parce qu'ils doivent vieillir entre deux rafraîchissements.
 */

import {
  DEVICE_KIND_LABELS,
  DEVICE_OFFLINE_AFTER_MS,
  type DeviceKind,
  type DeviceView,
} from "@sm/contracts";
import type { IconName } from "@/components/ui";

export type { DeviceKind, DeviceView };
export { DEVICE_KIND_LABELS };

// ─────────────────────────────────────────────────────────────
// État d'un appareil
// ─────────────────────────────────────────────────────────────

/**
 * `pairing` : jamais appairé · `online` : vu récemment · `warn` : muet depuis
 * peu · `down` : muet depuis longtemps.
 *
 * L'API bascule `online` à false au-delà de `DEVICE_OFFLINE_AFTER_MS` (5 min).
 * Ce seuil ne suffit pas à colorer : une tablette qui vient de le franchir a
 * peut-être raté deux battements sur le wifi du snack — c'est de l'ambre.
 * Au-delà du DOUBLE, plus aucune explication bénigne ne tient : la tablette est
 * éteinte, et si c'est la caisse, plus personne n'encaisse. C'est du rouge.
 */
export type DeviceTone = "pairing" | "online" | "warn" | "down";

export const OFFLINE_CRITICAL_AFTER_MS = 2 * DEVICE_OFFLINE_AFTER_MS;

/**
 * `now` peut être `null` (horloge pas encore abonnée, rendu serveur) : on s'en
 * tient alors au verdict de l'API, jamais à `Date.now()` — lire l'horloge
 * pendant le rendu rendrait la teinte instable d'un rendu à l'autre.
 */
export function deviceTone(device: DeviceView, now: number | null): DeviceTone {
  if (!device.paired) return "pairing";
  if (device.online) return "online";
  // Appairé sans premier contact : anomalie rare (l'appairage horodate déjà),
  // traitée en attente plutôt qu'en panne pour ne pas alarmer à tort.
  if (!device.lastSeenAt || now === null) return "warn";
  const elapsed = now - Date.parse(device.lastSeenAt);
  return elapsed > OFFLINE_CRITICAL_AFTER_MS ? "down" : "warn";
}

/** Couleurs FONCTIONNELLES (DA §3) — jamais l'accent de marque. */
export const TONE_DOT: Record<DeviceTone, string> = {
  pairing: "bg-gold",
  online: "bg-ok",
  warn: "bg-prep",
  down: "bg-alert",
};

export const TONE_TEXT: Record<DeviceTone, string> = {
  pairing: "text-gold",
  online: "text-okt",
  warn: "text-prept",
  down: "text-alertt",
};

/** Filet de tête de carte : l'état se lit avant même d'avoir lu le nom. */
export const TONE_BAR: Record<DeviceTone, string> = {
  pairing: "bg-gold/70",
  online: "bg-ok",
  warn: "bg-prep",
  down: "bg-alert",
};

// ─────────────────────────────────────────────────────────────
// Nature de l'appareil
// ─────────────────────────────────────────────────────────────

/**
 * Aucune icône « tablette » dans la bibliothèque : on désigne donc l'appareil
 * par ce qu'il FAIT — l'euro pour la caisse, le cornet de frites pour le piano
 * — plutôt que par son boîtier, que les deux partagent de toute façon.
 */
export const KIND_ICON: Record<DeviceKind, IconName> = {
  pos: "euro",
  kds: "fries",
};

/** Ce que l'appareil sert, en une ligne, sur la carte. */
export const KIND_ROLE: Record<DeviceKind, string> = {
  pos: "Encaisse les commandes au comptoir",
  kds: "Affiche les tickets à préparer, en cuisine",
};

/** Nom proposé par défaut — le gérant n'a rien à inventer. */
export const KIND_PLACEHOLDER: Record<DeviceKind, string> = {
  pos: "Caisse comptoir",
  kds: "Écran cuisine",
};

/** Ce qu'on ouvre sur la tablette pour l'appairer. */
export const KIND_APP_LABEL: Record<DeviceKind, string> = {
  pos: "l'application Caisse",
  kds: "l'application Cuisine",
};

// ─────────────────────────────────────────────────────────────
// Divers
// ─────────────────────────────────────────────────────────────

/** « 12:04 » — un compte à rebours se lit en minutes:secondes, pas en « 724 s ». */
export function fmtCountdown(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1_000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}
