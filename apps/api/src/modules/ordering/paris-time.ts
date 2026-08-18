import { RESTAURANT_TZ } from '@sm/contracts';

/**
 * Utilitaires de fuseau restaurant (Europe/Paris), sans dépendance et DST-safe.
 *
 * Les horaires du tenant (`hours[].lunch.open` = « 18:00 ») sont des heures
 * MURALES : « 19:30 » doit tomber sur 17:30Z en été et 18:30Z en hiver. On passe
 * donc systématiquement par `Intl.DateTimeFormat` plutôt que par un offset fixe.
 */

const ymdFmt = new Intl.DateTimeFormat('fr-CA', {
  timeZone: RESTAURANT_TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

const wallFmt = new Intl.DateTimeFormat('fr-CA', {
  timeZone: RESTAURANT_TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

export interface CalendarDay {
  y: number;
  m: number; // 1–12
  d: number;
}

export const pad2 = (n: number) => String(n).padStart(2, '0');

/** Composants calendaires parisiens d'un instant. */
export function parisYmd(at: Date): CalendarDay {
  const [y, m, d] = ymdFmt.format(at).split('-').map(Number);
  return { y: y ?? 1970, m: m ?? 1, d: d ?? 1 };
}

/** `AAAA-MM-JJ` parisien d'un instant. */
export function parisDateString(at: Date): string {
  return ymdFmt.format(at);
}

export const formatDay = ({ y, m, d }: CalendarDay) => `${y}-${pad2(m)}-${pad2(d)}`;

/** Parse `AAAA-MM-JJ` — renvoie `null` si la date est syntaxiquement invalide. */
export function parseDay(value: string): CalendarDay | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  // Contrôle de existence réelle (31 février …) via un aller-retour UTC.
  const probe = new Date(Date.UTC(y, m - 1, d));
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== m - 1 || probe.getUTCDate() !== d) {
    return null;
  }
  return { y, m, d };
}

/** Heure murale parisienne d'un instant, exprimée en ms « UTC » (calcul d'offset). */
function parisWallMs(at: Date): number {
  const parts = wallFmt.formatToParts(at);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour'),
    get('minute'),
    get('second'),
  );
}

/**
 * Instant UTC correspondant à une heure murale parisienne.
 * Deux passes de correction suffisent, y compris les jours de changement d'heure.
 */
export function parisWallToUtc(day: CalendarDay, hour = 0, minute = 0): Date {
  const target = Date.UTC(day.y, day.m - 1, day.d, hour, minute);
  let ts = target;
  for (let i = 0; i < 2; i++) ts += target - parisWallMs(new Date(ts));
  return new Date(ts);
}

/** Jour ISO 8601 (1 = lundi … 7 = dimanche) d'une date calendaire. */
export function isoWeekday(day: CalendarDay): number {
  const wd = new Date(Date.UTC(day.y, day.m - 1, day.d)).getUTCDay(); // 0 = dimanche
  return wd === 0 ? 7 : wd;
}

/** Décale une date calendaire de `delta` jours (arithmétique UTC, sans DST). */
export function addDays(day: CalendarDay, delta: number): CalendarDay {
  const next = new Date(Date.UTC(day.y, day.m - 1, day.d) + delta * 86_400_000);
  return { y: next.getUTCFullYear(), m: next.getUTCMonth() + 1, d: next.getUTCDate() };
}

/** Comparaison calendaire : < 0 si `a` précède `b`. */
export function compareDays(a: CalendarDay, b: CalendarDay): number {
  return Date.UTC(a.y, a.m - 1, a.d) - Date.UTC(b.y, b.m - 1, b.d);
}

/** « 18:00 » → minutes depuis minuit ; `null` si le format est inexploitable. */
export function parseHm(value: string | null | undefined): number | null {
  if (!value) return null;
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const h = Number(match[1]);
  const m = Number(match[2]);
  if (h > 47 || m > 59) return null; // 24:00+ toléré (service qui déborde sur la nuit)
  return h * 60 + m;
}

/** Minutes depuis minuit → « 19:30 » (les minutes ≥ 24 h repassent sur 0–23). */
export function formatHm(minutes: number): string {
  const normalized = ((minutes % 1440) + 1440) % 1440;
  return `${pad2(Math.floor(normalized / 60))}:${pad2(normalized % 60)}`;
}

/** Heure murale parisienne « 19:30 » d'un instant. */
export function parisHm(at: Date): string {
  const parts = wallFmt.formatToParts(at);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '00';
  return `${get('hour')}:${get('minute')}`;
}

/** Minutes écoulées depuis minuit (heure parisienne) pour un instant donné. */
export function parisMinutesOfDay(at: Date): number {
  const parts = wallFmt.formatToParts(at);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return get('hour') * 60 + get('minute');
}
