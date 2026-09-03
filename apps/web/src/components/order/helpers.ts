/**
 * Utilitaires de la surface client (site public, tunnel, suivi).
 *
 * Deux règles structurantes :
 *  — tous les montants circulent en CENTIMES (int) ; l’euro n’existe qu’ici,
 *    au moment du rendu ;
 *  — l’heure de référence d’un restaurant est son heure murale (Europe/Paris),
 *    jamais celle du navigateur du client. Un Parisien en vacances à Tokyo doit
 *    voir « Ouvert · 19:30 », pas 03:30 du matin.
 */

import type { PublicSiteHours } from "@sm/contracts";

/** Fuseau de référence des restaurants (miroir de `RESTAURANT_TZ` côté API). */
export const RESTAURANT_TZ = "Europe/Paris";

// ─────────────────────────────────────────────────────────────
// Montants
// ─────────────────────────────────────────────────────────────

/** 950 → « 9,50 € » · null/NaN → « — ». */
export function euros(cents: number | null | undefined): string {
  if (cents == null || !Number.isFinite(cents)) return "—";
  return `${eurosBare(cents)} €`;
}

/** 950 → « 9,50 » (sans symbole — pour les colonnes de chiffres). */
export function eurosBare(cents: number | null | undefined): string {
  if (cents == null || !Number.isFinite(cents)) return "—";
  return (cents / 100)
    .toLocaleString("fr-FR", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
    .replace(/ /g, " ");
}

/** Écart de prix d’une option : 150 → « +1,50 € » · 0 → « offert » · -50 → « −0,50 € ». */
export function delta(cents: number): string {
  if (cents === 0) return "offert";
  return `${cents > 0 ? "+" : "−"}${euros(Math.abs(cents))}`;
}

// ─────────────────────────────────────────────────────────────
// Heure du restaurant
// ─────────────────────────────────────────────────────────────

const WEEKDAYS: Record<string, number> = {
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
  Sun: 7,
};

/** Date/heure murale du restaurant : jour ISO (1 = lundi), minutes depuis minuit. */
export function parisParts(d: Date = new Date()): {
  ymd: string;
  minutes: number;
  weekday: number;
} {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: RESTAURANT_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    weekday: "short",
  }).formatToParts(d);
  const at = (type: string) =>
    parts.find((p) => String(p.type) === type)?.value ?? "";
  return {
    ymd: `${at("year")}-${at("month")}-${at("day")}`,
    minutes: Number(at("hour")) * 60 + Number(at("minute")),
    weekday: WEEKDAYS[at("weekday")] ?? 1,
  };
}

/** Instant ISO → heure murale du restaurant, « 19:30 ». */
export function hhmm(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("fr-FR", {
    timeZone: RESTAURANT_TZ,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(d);
}

/** « 11:30 » → 690. Renvoie `null` si la chaîne n’est pas une heure. */
function parseHm(value: string | null | undefined): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(value ?? ""));
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

/** « 11:30 » → « 11h30 » (typographie française des horaires). */
export function frHour(value: string): string {
  return value.replace(":", "h");
}

const DAY_LABELS = [
  "Lundi",
  "Mardi",
  "Mercredi",
  "Jeudi",
  "Vendredi",
  "Samedi",
  "Dimanche",
];

/** Nom français du jour ISO (1 = lundi). */
export const dayLabel = (day: number) => DAY_LABELS[day - 1] ?? "";

/** Horaires d’un jour : « 11h30–14h30 · 18h00–22h30 » ou « Fermé ». */
export function hoursLine(entry: PublicSiteHours | null | undefined): string {
  if (!entry) return "Fermé";
  const spans = [entry.lunch, entry.dinner]
    .filter((s): s is { open: string; close: string } => Boolean(s?.open && s?.close))
    .map((s) => `${frHour(s.open)}–${frHour(s.close)}`);
  return spans.length > 0 ? spans.join(" · ") : "Fermé";
}

/** Horaires du jour ISO demandé, dans la semaine renvoyée par l’API. */
export function hoursOfDay(
  hours: PublicSiteHours[],
  weekday: number,
): PublicSiteHours | null {
  return hours.find((h) => Number(h.day) === weekday) ?? null;
}

/** Le restaurant sert-il à cet instant (heure murale, hors fermetures exceptionnelles) ? */
export function isOpenAt(hours: PublicSiteHours[], at: Date = new Date()): boolean {
  const { weekday, minutes } = parisParts(at);
  const entry = hoursOfDay(hours, weekday);
  if (!entry) return false;
  return [entry.lunch, entry.dinner].some((span) => {
    const open = parseHm(span?.open);
    const close = parseHm(span?.close);
    return open !== null && close !== null && minutes >= open && minutes <= close;
  });
}

/**
 * Prochaine ouverture, en clair : « réouvre à 18h00 », « réouvre demain à 11h30 »,
 * « réouvre mardi à 11h30 ». `null` si aucune ouverture dans les 7 jours.
 */
export function nextOpeningLabel(
  hours: PublicSiteHours[],
  at: Date = new Date(),
): string | null {
  const { weekday, minutes } = parisParts(at);
  for (let offset = 0; offset < 8; offset++) {
    const day = ((weekday - 1 + offset) % 7) + 1;
    const entry = hoursOfDay(hours, day);
    if (!entry) continue;
    for (const span of [entry.lunch, entry.dinner]) {
      const open = parseHm(span?.open);
      if (open === null) continue;
      if (offset === 0 && open <= minutes) continue;
      const hour = frHour(String(span?.open));
      if (offset === 0) return `réouvre à ${hour}`;
      if (offset === 1) return `réouvre demain à ${hour}`;
      return `réouvre ${dayLabel(day).toLowerCase()} à ${hour}`;
    }
  }
  return null;
}

/** Semaine complète groupée pour l’affichage (lundi → dimanche). */
export function weekSchedule(
  hours: PublicSiteHours[],
): { day: number; label: string; value: string }[] {
  return [1, 2, 3, 4, 5, 6, 7].map((day) => ({
    day,
    label: dayLabel(day),
    value: hoursLine(hoursOfDay(hours, day)),
  }));
}

// ─────────────────────────────────────────────────────────────
// Marque tenant
// ─────────────────────────────────────────────────────────────

/** Initiale affichée dans la tuile de marque (fallback « S »). */
export function initial(name: string): string {
  const letter = name.trim().replace(/[^\p{L}\p{N}]/gu, "").charAt(0);
  return (letter || "S").toUpperCase();
}

/*
 * `onAccent()` et `safeColor()` VIVAIENT ICI — supprimés avec le masque.
 *
 * Les deux dataient du temps où la vitrine peignait elle-même l'accent du
 * tenant : elles validaient un hex et choisissaient noir ou blanc par un
 * SEUIL de luminance (0,45), qui se trompe de pôle au milieu de l'échelle.
 * Le masque résout les deux en amont et mieux — `BrandPaletteSchema` valide
 * l'hex, `textePosableSur()` tranche par contraste réel — et plus personne ne
 * les appelait. Les garder aurait invité la prochaine surface à recalculer
 * une couleur que le contrat rend déjà.
 */

/** `tel:` normalisé (« 09 84 36 49 76 » → « tel:+33984364976 » quand c’est possible). */
export function telHref(phone: string): string {
  const digits = phone.replace(/[^\d+]/g, "");
  if (digits.startsWith("+")) return `tel:${digits}`;
  if (digits.startsWith("0") && digits.length === 10) {
    return `tel:+33${digits.slice(1)}`;
  }
  return `tel:${digits}`;
}

/** Adresse → PostalAddress schema.org (« 63 rue X — 27910 Ville »). */
export function splitAddress(address: string): {
  street: string;
  postalCode: string;
  city: string;
} {
  const match = /(\d{5})\s+(.+)$/.exec(address);
  if (!match) return { street: address.trim(), postalCode: "", city: "" };
  const street = address
    .slice(0, match.index)
    .replace(/[\s,—–-]+$/u, "")
    .trim();
  return { street, postalCode: match[1], city: match[2].trim() };
}

/** Ville seule — utilisée dans les titres SEO et le pied de page. */
export function cityOf(address: string): string {
  return splitAddress(address).city;
}

// ─────────────────────────────────────────────────────────────
// Divers
// ─────────────────────────────────────────────────────────────

/**
 * Identifiant local — lignes de panier, clés React, ET clé d'idempotence.
 *
 * Le repli produisait `l{base36}…`, qui n'est pas un UUID. Or `clientId` du
 * corps de commande est validé par `z.uuid()` : sur tout navigateur sans
 * `crypto.randomUUID` — contexte non sécurisé, WebView ancienne, HTTP en
 * réseau local — la commande partait avec un identifiant que l'API refusait.
 * Le client voyait « commande impossible » sans qu'aucun essai ne puisse
 * aboutir, et rien ne pointait vers la cause.
 *
 * Le repli produit donc un UUID v4 en bonne et due forme. `crypto.randomUUID`
 * reste préféré quand il existe : il tire du générateur du système.
 */
export function uid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  // Version 4, variante RFC 4122 : les positions 13 et 17 portent la version
  // et la variante, le reste est aléatoire.
  const octets = new Uint8Array(16);
  // `crypto` est typé `never` dans cette branche — TypeScript a déduit de la
  // condition précédente qu'on n'y arrive qu'avec `crypto` absent. Il a tort :
  // un contexte non sécurisé expose `getRandomValues` sans `randomUUID`.
  const source = (globalThis as { crypto?: Crypto }).crypto;
  if (source?.getRandomValues) {
    source.getRandomValues(octets);
  } else {
    for (let i = 0; i < 16; i += 1) octets[i] = Math.floor(Math.random() * 256);
  }
  octets[6] = (octets[6]! & 0x0f) | 0x40;
  octets[8] = (octets[8]! & 0x3f) | 0x80;
  const hex = [...octets].map((o) => o.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Normalise pour la recherche : minuscules, sans accents. */
export function fold(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

/** Téléphone client : au moins 8 chiffres (règle de validation du tunnel). */
export function phoneOk(value: string): boolean {
  return value.replace(/\D/g, "").length >= 8;
}
