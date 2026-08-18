import { RESTAURANT_TIMEZONE } from '../shared/clock';
import { invariant } from '../shared/errors';
import { err, ok, type Result } from '../shared/result';
import { InvalidCalendarDay, InvalidWallTime } from './errors';

/**
 * Heures MURALES du restaurant et jours calendaires.
 *
 * Un horaire de snack n'est pas un instant : « le soir, on ouvre à 18h00 »
 * signifie 18h00 à Perriers, donc 16h00 UTC en été et 17h00 UTC en hiver. Si on
 * figeait un décalage, la carte du soir s'ouvrirait avec une heure de retard
 * chaque dernier dimanche d'octobre. On passe donc systématiquement par le
 * fuseau du restaurant (`RESTAURANT_TIMEZONE`).
 *
 * `Intl` est une brique standard du langage : l'utiliser ne rompt pas la règle
 * « zéro dépendance » du paquet — ce fichier tourne tel quel dans un
 * navigateur, un worker ou un test.
 */

const YMD = new Intl.DateTimeFormat('fr-CA', {
  timeZone: RESTAURANT_TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

const WALL = new Intl.DateTimeFormat('fr-CA', {
  timeZone: RESTAURANT_TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

const DAY_MS = 86_400_000;
const MINUTE_MS = 60_000;
/** Minutes dans une journée — borne des heures murales « normales ». */
export const MINUTES_PER_DAY = 1440;

const pad2 = (n: number): string => String(n).padStart(2, '0');

/** Composants de l'heure murale, lus en une seule passe de formatage. */
function wallParts(at: Date): (type: Intl.DateTimeFormatPartTypes) => number {
  const parts = WALL.formatToParts(at);
  return (type) => Number(parts.find((p) => p.type === type)?.value ?? 0);
}

/** Heure murale d'un instant, réexprimée en millisecondes « UTC » (calcul d'écart). */
function wallMs(at: Date): number {
  const get = wallParts(at);
  return Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
}

// ─── Jour de la semaine ───

/** Jour ISO 8601 : 1 = lundi … 7 = dimanche (comme la saisie du back-office). */
export type Weekday = 1 | 2 | 3 | 4 | 5 | 6 | 7;

export const WEEKDAYS: readonly Weekday[] = [1, 2, 3, 4, 5, 6, 7];

export const WEEKDAY_LABELS: Readonly<Record<Weekday, string>> = {
  1: 'Lundi',
  2: 'Mardi',
  3: 'Mercredi',
  4: 'Jeudi',
  5: 'Vendredi',
  6: 'Samedi',
  7: 'Dimanche',
};

export function isWeekday(value: number): value is Weekday {
  return Number.isInteger(value) && value >= 1 && value <= 7;
}

// ─── Heure murale ───

/**
 * Heure d'horloge du restaurant, en minutes depuis minuit.
 *
 * On tolère au-delà de 24h00 : un snack qui ferme à 1h du matin saisit « 25:00 »,
 * sinon une fermeture « 01:00 » plus petite que l'ouverture « 18:00 » serait
 * indistinguable d'une faute de frappe. L'affichage, lui, repasse sur 0–23.
 */
export class WallTime {
  /** Dernière minute acceptée : 47:59, soit un service qui déborde d'une nuit. */
  private static readonly MAX_MINUTES = 47 * 60 + 59;

  private constructor(readonly minutes: number) {}

  static ofMinutes(minutes: number): Result<WallTime, InvalidWallTime> {
    if (!Number.isInteger(minutes) || minutes < 0 || minutes > WallTime.MAX_MINUTES) {
      return err(new InvalidWallTime(`Heure hors bornes : ${minutes} minutes`));
    }
    return ok(new WallTime(minutes));
  }

  /** Lit la saisie du back-office (« 18:00 », « 8:30 »). */
  static parse(input: string): Result<WallTime, InvalidWallTime> {
    const match = /^(\d{1,2}):(\d{2})$/.exec(input.trim());
    if (!match) {
      return err(new InvalidWallTime(`Heure illisible : « ${input} » (format attendu HH:MM)`));
    }
    const hours = Number(match[1]);
    const minutes = Number(match[2]);
    if (minutes > 59) {
      return err(new InvalidWallTime(`« ${input} » : les minutes vont de 00 à 59`));
    }
    return WallTime.ofMinutes(hours * 60 + minutes);
  }

  /** Cette heure appartient-elle encore au jour civil de saisie ? */
  isSameDay(): boolean {
    return this.minutes < MINUTES_PER_DAY;
  }

  isBefore(other: WallTime): boolean {
    return this.minutes < other.minutes;
  }

  equals(other: WallTime): boolean {
    return this.minutes === other.minutes;
  }

  /** « 19:30 » — les minutes au-delà de 24h repassent sur l'horloge du client. */
  format(): string {
    const normalized = this.minutes % MINUTES_PER_DAY;
    return `${pad2(Math.floor(normalized / 60))}:${pad2(normalized % 60)}`;
  }

  toString(): string {
    return this.format();
  }

  toJSON(): string {
    return this.format();
  }
}

// ─── Jour calendaire ───

/**
 * Journée du restaurant (« le 24 août »), pas un instant.
 *
 * Les horaires, les fermetures et la grille de créneaux raisonnent en journées
 * de service : un `Date` porterait une heure qui n'a aucun sens ici et
 * ouvrirait la porte aux décalages de fuseau.
 */
export class CalendarDay {
  private constructor(
    readonly year: number,
    /** 1–12. */
    readonly month: number,
    /** 1–31. */
    readonly day: number,
  ) {}

  static of(year: number, month: number, day: number): Result<CalendarDay, InvalidCalendarDay> {
    if (![year, month, day].every(Number.isInteger)) {
      return err(new InvalidCalendarDay('Date incomplète'));
    }
    // Aller-retour UTC : élimine le 31 février et le 30 novembre inversés.
    const probe = new Date(Date.UTC(year, month - 1, day));
    if (
      probe.getUTCFullYear() !== year ||
      probe.getUTCMonth() !== month - 1 ||
      probe.getUTCDate() !== day
    ) {
      return err(new InvalidCalendarDay(`Le ${pad2(day)}/${pad2(month)}/${year} n'existe pas`));
    }
    return ok(new CalendarDay(year, month, day));
  }

  /** Lit « AAAA-MM-JJ » (paramètre d'URL, saisie d'un sélecteur de date). */
  static parse(input: string): Result<CalendarDay, InvalidCalendarDay> {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(input.trim());
    if (!match) {
      return err(new InvalidCalendarDay(`Date illisible : « ${input} » (format attendu AAAA-MM-JJ)`));
    }
    return CalendarDay.of(Number(match[1]), Number(match[2]), Number(match[3]));
  }

  /** Journée du restaurant à laquelle appartient cet instant. */
  static from(instant: Date): CalendarDay {
    const [year, month, day] = YMD.format(instant).split('-').map(Number);
    invariant(
      year !== undefined && month !== undefined && day !== undefined,
      `date non formatable : ${instant.toISOString()}`,
    );
    return new CalendarDay(year, month, day);
  }

  plusDays(delta: number): CalendarDay {
    invariant(Number.isInteger(delta), `décalage non entier : ${delta}`);
    const shifted = new Date(Date.UTC(this.year, this.month - 1, this.day) + delta * DAY_MS);
    return new CalendarDay(
      shifted.getUTCFullYear(),
      shifted.getUTCMonth() + 1,
      shifted.getUTCDate(),
    );
  }

  weekday(): Weekday {
    const sunday0 = new Date(Date.UTC(this.year, this.month - 1, this.day)).getUTCDay();
    const iso = sunday0 === 0 ? 7 : sunday0;
    invariant(isWeekday(iso), `jour de semaine impossible : ${iso}`);
    return iso;
  }

  /** < 0 si cette journée précède l'autre. */
  compare(other: CalendarDay): number {
    return (
      Date.UTC(this.year, this.month - 1, this.day) -
      Date.UTC(other.year, other.month - 1, other.day)
    );
  }

  isBefore(other: CalendarDay): boolean {
    return this.compare(other) < 0;
  }

  equals(other: CalendarDay): boolean {
    return this.compare(other) === 0;
  }

  /**
   * Instant absolu correspondant à une heure murale de cette journée.
   *
   * Deux passes de correction : la première approche l'instant, la seconde
   * absorbe le saut d'heure des derniers dimanches de mars et d'octobre.
   */
  at(time: WallTime): Date {
    return this.atMinutes(time.minutes);
  }

  atMinutes(minutes: number): Date {
    const target = Date.UTC(this.year, this.month - 1, this.day) + minutes * MINUTE_MS;
    let ts = target;
    for (let pass = 0; pass < 2; pass++) ts += target - wallMs(new Date(ts));
    return new Date(ts);
  }

  /** Premier instant de la journée du restaurant (minuit local). */
  startsAt(): Date {
    return this.atMinutes(0);
  }

  /** Premier instant de la journée suivante — borne haute exclusive. */
  endsAt(): Date {
    return this.plusDays(1).atMinutes(0);
  }

  toISO(): string {
    return `${this.year}-${pad2(this.month)}-${pad2(this.day)}`;
  }

  toString(): string {
    return this.toISO();
  }

  toJSON(): string {
    return this.toISO();
  }
}

/** Minutes écoulées depuis minuit, à l'heure du restaurant. */
export function minutesOfDay(instant: Date): number {
  const get = wallParts(instant);
  return get('hour') * 60 + get('minute');
}

/** « 19:30 » — heure murale du restaurant pour cet instant. */
export function wallLabel(instant: Date): string {
  const get = wallParts(instant);
  return `${pad2(get('hour'))}:${pad2(get('minute'))}`;
}
