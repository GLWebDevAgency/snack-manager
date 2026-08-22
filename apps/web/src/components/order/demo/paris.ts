/**
 * Heure murale du restaurant, sans dépendance et à l'épreuve du changement d'heure.
 *
 * Transcription du module que l'API utilise pour calculer ses créneaux
 * (`apps/api/src/modules/ordering/paris-time.ts`). La démonstration doit
 * fabriquer les MÊMES instants que le serveur : « 19:30 » tombe sur 17:30Z en
 * été et 18:30Z en hiver, et un créneau qui se tromperait d'une heure ferait
 * mentir toute la page (retrait affiché, service midi/soir, jour courant).
 *
 * Rien ici n'est propre à la démonstration : c'est de l'arithmétique de fuseau.
 * Elle vit dans ce dossier pour que la démonstration reste un bloc qu'on peut
 * lire — et retirer — d'un seul tenant.
 */
import { RESTAURANT_TZ } from "@sm/contracts";

const wallFmt = new Intl.DateTimeFormat("fr-CA", {
  timeZone: RESTAURANT_TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

export interface CalendarDay {
  y: number;
  m: number; // 1–12
  d: number;
}

const pad2 = (n: number) => String(n).padStart(2, "0");

function partsOf(at: Date): Record<string, number> {
  const out: Record<string, number> = {};
  for (const part of wallFmt.formatToParts(at)) {
    if (part.type !== "literal") out[part.type] = Number(part.value);
  }
  return out;
}

/** Composants calendaires parisiens d'un instant. */
export function parisDay(at: Date): CalendarDay {
  const p = partsOf(at);
  return { y: p.year ?? 1970, m: p.month ?? 1, d: p.day ?? 1 };
}

/** Minutes écoulées depuis minuit, heure du restaurant. */
export function parisMinutes(at: Date): number {
  const p = partsOf(at);
  return (p.hour ?? 0) * 60 + (p.minute ?? 0);
}

export const formatDay = ({ y, m, d }: CalendarDay) => `${y}-${pad2(m)}-${pad2(d)}`;

/** Parse `AAAA-MM-JJ`, `null` si la date n'existe pas (31 février compris). */
export function parseDay(value: string): CalendarDay | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  const probe = new Date(Date.UTC(y, m - 1, d));
  if (
    probe.getUTCFullYear() !== y ||
    probe.getUTCMonth() !== m - 1 ||
    probe.getUTCDate() !== d
  ) {
    return null;
  }
  return { y, m, d };
}

/** Heure murale parisienne d'un instant, exprimée en ms « UTC » (calcul d'offset). */
function parisWallMs(at: Date): number {
  const p = partsOf(at);
  return Date.UTC(
    p.year ?? 1970,
    (p.month ?? 1) - 1,
    p.day ?? 1,
    p.hour ?? 0,
    p.minute ?? 0,
    p.second ?? 0,
  );
}

/**
 * Instant UTC correspondant à une heure murale parisienne.
 * Deux passes de correction suffisent, y compris les jours de bascule.
 */
export function parisWallToUtc(day: CalendarDay, minutes = 0): Date {
  const target = Date.UTC(day.y, day.m - 1, day.d, 0, minutes);
  let ts = target;
  for (let i = 0; i < 2; i++) ts += target - parisWallMs(new Date(ts));
  return new Date(ts);
}

/** Jour ISO 8601 (1 = lundi … 7 = dimanche). */
export function isoWeekday(day: CalendarDay): number {
  const wd = new Date(Date.UTC(day.y, day.m - 1, day.d)).getUTCDay();
  return wd === 0 ? 7 : wd;
}

/** Décale une date calendaire de `delta` jours. */
export function addDays(day: CalendarDay, delta: number): CalendarDay {
  const next = new Date(Date.UTC(day.y, day.m - 1, day.d) + delta * 86_400_000);
  return { y: next.getUTCFullYear(), m: next.getUTCMonth() + 1, d: next.getUTCDate() };
}

/** Comparaison calendaire : < 0 si `a` précède `b`. */
export function compareDays(a: CalendarDay, b: CalendarDay): number {
  return Date.UTC(a.y, a.m - 1, a.d) - Date.UTC(b.y, b.m - 1, b.d);
}

/** Minutes depuis minuit → « 19:30 ». */
export function formatHm(minutes: number): string {
  const normalized = ((Math.round(minutes) % 1440) + 1440) % 1440;
  return `${pad2(Math.floor(normalized / 60))}:${pad2(normalized % 60)}`;
}

/** « 18:00 » → minutes depuis minuit ; `null` si le format est inexploitable. */
export function parseHm(value: string | null | undefined): number | null {
  if (!value) return null;
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const h = Number(match[1]);
  const m = Number(match[2]);
  if (h > 47 || m > 59) return null;
  return h * 60 + m;
}
