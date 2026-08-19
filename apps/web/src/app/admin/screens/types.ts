/**
 * Vue « Écrans TV » — types partagés et règles d'affichage.
 *
 * Rien ici ne recalcule ce que l'API sait déjà : `statusLabel`, `sceneCount`,
 * `orientationLabel` arrivent rédigés depuis `screens.view.ts`. On ne dérive
 * localement que ce qui dépend de l'HORLOGE DU NAVIGATEUR — la teinte de
 * l'état et le compte à rebours du code — parce qu'ils doivent bouger entre
 * deux rafraîchissements.
 */

import {
  DAYPART_TAGS,
  SCENE_DURATION_MAX_MS,
  SCENE_DURATION_MIN_MS,
  SCREEN_OFFLINE_AFTER_MS,
  type SceneKind,
  type ScreenOrientation,
  type ScreenScene,
  type ScreenTheme,
  type ScreenView,
} from "@sm/contracts";

export type { SceneKind, ScreenOrientation, ScreenScene, ScreenTheme, ScreenView };

// ─────────────────────────────────────────────────────────────
// État d'un écran
// ─────────────────────────────────────────────────────────────

/**
 * `pairing` : jamais appairé · `online` : vu récemment · `warn` : muet depuis
 * peu · `down` : muet depuis longtemps.
 *
 * L'API bascule `online` à false au-delà de `SCREEN_OFFLINE_AFTER_MS` (15 min).
 * Ce seuil ne suffit pas à colorer : un écran qui vient de le franchir a
 * peut-être simplement raté un battement sur un wifi fatigué — c'est de
 * l'ambre. Au-delà du DOUBLE, plus aucune explication bénigne ne tient : la
 * clé HDMI est débranchée ou la box est tombée, et la carte du restaurant
 * n'est plus affichée depuis une demi-heure. C'est du rouge.
 */
export type ScreenTone = "pairing" | "online" | "warn" | "down";

export const OFFLINE_CRITICAL_AFTER_MS = 2 * SCREEN_OFFLINE_AFTER_MS;

/**
 * `now` peut être `null` (horloge pas encore abonnée, rendu serveur) : on s'en
 * tient alors au verdict de l'API, jamais à `Date.now()` — lire l'horloge
 * pendant le rendu rendrait la teinte instable d'un rendu à l'autre.
 */
export function screenTone(screen: ScreenView, now: number | null): ScreenTone {
  if (!screen.paired) return "pairing";
  if (screen.online) return "online";
  // Appairé sans premier contact : anomalie rare (l'appairage horodate déjà),
  // traitée en attente plutôt qu'en panne pour ne pas alarmer à tort.
  if (!screen.lastSeenAt || now === null) return "warn";
  const elapsed = now - Date.parse(screen.lastSeenAt);
  return elapsed > OFFLINE_CRITICAL_AFTER_MS ? "down" : "warn";
}

/** Couleurs FONCTIONNELLES (DA §3) — jamais l'accent de marque. */
export const TONE_DOT: Record<ScreenTone, string> = {
  pairing: "bg-gold",
  online: "bg-ok",
  warn: "bg-prep",
  down: "bg-alert",
};

export const TONE_TEXT: Record<ScreenTone, string> = {
  pairing: "text-gold",
  online: "text-okt",
  warn: "text-prept",
  down: "text-alertt",
};

/** Filet de tête de carte : l'état se lit avant même d'avoir lu le nom. */
export const TONE_BAR: Record<ScreenTone, string> = {
  pairing: "bg-gold/70",
  online: "bg-ok",
  warn: "bg-prep",
  down: "bg-alert",
};

// ─────────────────────────────────────────────────────────────
// Scènes
// ─────────────────────────────────────────────────────────────

export const SCENE_KIND_LABELS: Record<SceneKind, string> = {
  promo: "Offres",
  category: "Catégorie",
  featured: "Mise en avant",
  custom: "Panneau libre",
};

/**
 * Durées proposées, toutes comprises entre `SCENE_DURATION_MIN_MS` et
 * `SCENE_DURATION_MAX_MS`. Une liste fermée plutôt qu'un champ libre : le
 * gérant n'a aucune raison de deviner qu'en dessous de 4 s on ne lit rien, et
 * un refus de l'API après coup serait incompréhensible.
 */
export const DURATION_CHOICES = [
  4_000, 6_000, 8_000, 10_000, 12_000, 15_000, 20_000, 30_000, 45_000, 60_000,
].filter((ms) => ms >= SCENE_DURATION_MIN_MS && ms <= SCENE_DURATION_MAX_MS);

/** 10000 → « 10 s » · 60000 → « 1 min ». */
export const fmtDuration = (ms: number): string =>
  ms >= 60_000 ? `${Math.round(ms / 60_000)} min` : `${Math.round(ms / 1_000)} s`;

/** Durée totale de la boucle : « 3 min 50 s ». */
export function fmtLoop(ms: number): string {
  const total = Math.round(ms / 1_000);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  if (minutes === 0) return `${seconds} s`;
  return seconds === 0 ? `${minutes} min` : `${minutes} min ${seconds} s`;
}

export const loopMs = (playlist: readonly ScreenScene[]): number =>
  playlist.reduce((sum, scene) => sum + scene.durationMs, 0);

/** « 12:04 » — un compte à rebours se lit en minutes:secondes, pas en « 724 s ». */
export function fmtCountdown(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1_000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

/** Déplace un élément d'un cran ; renvoie le tableau inchangé si impossible. */
export function moveScene(
  playlist: readonly ScreenScene[],
  from: number,
  direction: -1 | 1,
): ScreenScene[] {
  const to = from + direction;
  if (to < 0 || to >= playlist.length) return [...playlist];
  const next = [...playlist];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

// ─────────────────────────────────────────────────────────────
// Carte (GET /menu) — seuls les champs consommés ici
// ─────────────────────────────────────────────────────────────

export type MenuProduct = {
  _id: string;
  name: string;
  tags?: string[];
  active?: boolean;
};

export type MenuCategory = {
  _id: string;
  name: string;
  active?: boolean;
  products?: MenuProduct[];
};

export type MenuData = {
  categories: MenuCategory[];
  uncategorized?: MenuProduct[];
};

export const categoryName = (
  menu: MenuData | null,
  id: string | null | undefined,
): string | null =>
  (id && menu?.categories.find((c) => c._id === id)?.name) || null;

/**
 * Service auquel un produit est LIMITÉ par ses étiquettes, `null` s'il est
 * servi toute la journée.
 *
 * Même lecture que `isServedAt()` côté API : étiqueté dans les deux services
 * (ou dans aucun), le produit reste visible en permanence.
 */
export function daypartOf(tags: readonly string[] | undefined): "lunch" | "dinner" | null {
  if (!tags?.length) return null;
  const normalized = tags.map((t) => t.trim().toLowerCase());
  const lunch = normalized.some((t) => DAYPART_TAGS.lunch.includes(t));
  const dinner = normalized.some((t) => DAYPART_TAGS.dinner.includes(t));
  if (lunch === dinner) return null;
  return lunch ? "lunch" : "dinner";
}

/** Tous les produits de la carte, catégorisés ou non. */
export function allProducts(menu: MenuData | null): MenuProduct[] {
  if (!menu) return [];
  return [
    ...menu.categories.flatMap((c) => c.products ?? []),
    ...(menu.uncategorized ?? []),
  ];
}
