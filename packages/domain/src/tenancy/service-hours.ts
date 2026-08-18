import { err, ok, type Result } from '../shared/result';
import { InvalidServiceHours } from './errors';
import {
  CalendarDay,
  MINUTES_PER_DAY,
  minutesOfDay,
  WallTime,
  WEEKDAY_LABELS,
  WEEKDAYS,
  type Weekday,
} from './wall-clock';

/**
 * Horaires d'ouverture hebdomadaires.
 *
 * Modèle calqué sur le terrain : un snack ne fait pas « 9h–19h en continu », il
 * fait DEUX services séparés par une coupure. Class'Food sert 7j/7, midi
 * 11h30–14h30 et soir 18h00–22h30, sauf lundi et vendredi où seul le soir
 * tourne. Une plage unique par jour ne saurait pas exprimer ça, et la coupure
 * de 15h serait vendue comme ouverte.
 *
 * Cette classe ignore volontairement les fermetures exceptionnelles : elle
 * décrit la semaine type, qui ne change qu'une ou deux fois par an. Les
 * fermetures ponctuelles sont un autre cycle de vie (cf. `Closure`).
 */

export const SERVICE_NAMES = ['lunch', 'dinner'] as const;
export type ServiceName = (typeof SERVICE_NAMES)[number];

export const SERVICE_LABELS: Readonly<Record<ServiceName, string>> = {
  lunch: 'Midi',
  dinner: 'Soir',
};

/**
 * Horizon de recherche d'une réouverture : deux semaines.
 *
 * Au-delà, c'est une fermeture annuelle — annoncer « on rouvre le 3 septembre »
 * trois semaines à l'avance n'aide personne, l'interface dit « fermé ».
 */
export const OPENING_LOOKAHEAD_DAYS = 14;

/** Un service daté : ce que renvoie la recherche de prochaine ouverture. */
export interface ServiceOpening {
  readonly day: CalendarDay;
  readonly window: ServiceWindow;
  readonly opensAt: Date;
  readonly closesAt: Date;
}

/** Une plage de service (« le midi, de 11h30 à 14h30 »). */
export class ServiceWindow {
  private constructor(
    readonly service: ServiceName,
    readonly opensAt: WallTime,
    readonly closesAt: WallTime,
  ) {}

  static create(
    service: ServiceName,
    opensAt: WallTime,
    closesAt: WallTime,
  ): Result<ServiceWindow, InvalidServiceHours> {
    const label = SERVICE_LABELS[service];
    if (!opensAt.isSameDay()) {
      return err(
        new InvalidServiceHours(`${label} : l'ouverture « ${opensAt.format()} » doit être une heure du jour`),
      );
    }
    if (!opensAt.isBefore(closesAt)) {
      return err(
        new InvalidServiceHours(
          `${label} : la fermeture « ${closesAt.format()} » doit suivre l'ouverture « ${opensAt.format()} »`,
        ),
      );
    }
    return ok(new ServiceWindow(service, opensAt, closesAt));
  }

  /** Depuis la saisie du back-office (« 11:30 », « 14:30 »). */
  static parse(
    service: ServiceName,
    opensAt: string,
    closesAt: string,
  ): Result<ServiceWindow, InvalidServiceHours> {
    const open = WallTime.parse(opensAt);
    if (!open.ok) return err(new InvalidServiceHours(open.error.message));
    const close = WallTime.parse(closesAt);
    if (!close.ok) return err(new InvalidServiceHours(close.error.message));
    return ServiceWindow.create(service, open.value, close.value);
  }

  /**
   * L'heure murale `minutes` tombe-t-elle dans le service ?
   * Borne haute incluse : 22h30 pile est encore l'heure du dernier retrait.
   */
  containsMinutes(minutes: number): boolean {
    return minutes >= this.opensAt.minutes && minutes <= this.closesAt.minutes;
  }

  overlaps(other: ServiceWindow): boolean {
    return (
      this.opensAt.minutes <= other.closesAt.minutes &&
      other.opensAt.minutes <= this.closesAt.minutes
    );
  }

  durationMinutes(): number {
    return this.closesAt.minutes - this.opensAt.minutes;
  }

  /** « 11:30 – 14:30 ». */
  label(): string {
    return `${this.opensAt.format()} – ${this.closesAt.format()}`;
  }
}

/** Les services d'un jour de la semaine — éventuellement aucun. */
export class DayHours {
  private constructor(
    readonly weekday: Weekday,
    /** Triés par heure d'ouverture. */
    readonly windows: readonly ServiceWindow[],
  ) {}

  static closed(weekday: Weekday): DayHours {
    return new DayHours(weekday, []);
  }

  static create(
    weekday: Weekday,
    windows: readonly ServiceWindow[],
  ): Result<DayHours, InvalidServiceHours> {
    const sorted = [...windows].sort((a, b) => a.opensAt.minutes - b.opensAt.minutes);

    const seen = new Set<ServiceName>();
    for (const window of sorted) {
      if (seen.has(window.service)) {
        return err(
          new InvalidServiceHours(
            `${WEEKDAY_LABELS[weekday]} : le service « ${SERVICE_LABELS[window.service]} » est saisi deux fois`,
          ),
        );
      }
      seen.add(window.service);
    }

    // Deux services qui se chevauchent trahissent une inversion de saisie
    // (midi 11:30–18:30 au lieu de 14:30). Laisser passer produirait des
    // créneaux en double sur la coupure.
    for (let i = 1; i < sorted.length; i++) {
      const previous = sorted[i - 1];
      const current = sorted[i];
      if (previous && current && previous.overlaps(current)) {
        return err(
          new InvalidServiceHours(
            `${WEEKDAY_LABELS[weekday]} : les services ${previous.label()} et ${current.label()} se chevauchent`,
          ),
        );
      }
    }

    return ok(new DayHours(weekday, sorted));
  }

  isClosed(): boolean {
    return this.windows.length === 0;
  }

  windowFor(service: ServiceName): ServiceWindow | null {
    return this.windows.find((w) => w.service === service) ?? null;
  }

  /** Le service en cours à cette heure murale, s'il y en a un. */
  openWindowAt(minutes: number): ServiceWindow | null {
    return this.windows.find((w) => w.containsMinutes(minutes)) ?? null;
  }

  label(): string {
    return this.isClosed() ? 'Fermé' : this.windows.map((w) => w.label()).join(' · ');
  }
}

export class ServiceHours {
  private constructor(private readonly byWeekday: ReadonlyMap<Weekday, DayHours>) {}

  /** Restaurant en cours de création : rien n'est encore saisi. */
  static closedAllWeek(): ServiceHours {
    return new ServiceHours(new Map(WEEKDAYS.map((d) => [d, DayHours.closed(d)])));
  }

  /** Les jours absents de la liste sont fermés — l'absence de saisie ferme. */
  static create(days: readonly DayHours[]): Result<ServiceHours, InvalidServiceHours> {
    const byWeekday = new Map<Weekday, DayHours>(WEEKDAYS.map((d) => [d, DayHours.closed(d)]));
    const seen = new Set<Weekday>();

    for (const day of days) {
      if (seen.has(day.weekday)) {
        return err(
          new InvalidServiceHours(`${WEEKDAY_LABELS[day.weekday]} est saisi deux fois`),
        );
      }
      seen.add(day.weekday);
      byWeekday.set(day.weekday, day);
    }

    return ok(new ServiceHours(byWeekday));
  }

  on(weekday: Weekday): DayHours {
    return this.byWeekday.get(weekday) ?? DayHours.closed(weekday);
  }

  /** Les services de cette journée, dans l'ordre. */
  windowsOn(day: CalendarDay): readonly ServiceWindow[] {
    return this.on(day.weekday()).windows;
  }

  servesOn(day: CalendarDay): boolean {
    return this.windowsOn(day).length > 0;
  }

  /**
   * Le restaurant sert-il à cet instant ?
   *
   * On regarde aussi la veille : un service du soir saisi « 18:00 – 25:00 »
   * couvre encore 0h30, qui appartient déjà au jour civil suivant.
   */
  isOpenAt(instant: Date): boolean {
    const today = CalendarDay.from(instant);
    const minutes = minutesOfDay(instant);

    if (this.on(today.weekday()).openWindowAt(minutes) !== null) return true;

    const yesterday = today.plusDays(-1);
    return this.on(yesterday.weekday()).openWindowAt(minutes + MINUTES_PER_DAY) !== null;
  }

  /**
   * Les prochains services à venir, dans l'ordre chronologique.
   *
   * Renvoie une liste plutôt qu'une seule date : l'agrégat `Restaurant` doit
   * pouvoir écarter les services annulés par une fermeture exceptionnelle sans
   * que les horaires hebdomadaires aient à connaître ces fermetures.
   */
  openingsFrom(
    from: Date,
    lookaheadDays: number = OPENING_LOOKAHEAD_DAYS,
  ): readonly ServiceOpening[] {
    const openings: ServiceOpening[] = [];
    let day = CalendarDay.from(from);

    for (let i = 0; i <= lookaheadDays; i++) {
      for (const window of this.windowsOn(day)) {
        const opensAt = day.at(window.opensAt);
        if (opensAt.getTime() > from.getTime()) {
          openings.push({ day, window, opensAt, closesAt: day.at(window.closesAt) });
        }
      }
      day = day.plusDays(1);
    }

    return openings;
  }

  /**
   * Prochain début de service strictement postérieur à `from`, `null` si le
   * restaurant ne rouvre pas dans les deux semaines.
   *
   * Volontairement « strictement postérieur » : la question « quand ouvre-t-on ? »
   * porte sur le service SUIVANT. Pour savoir si l'on sert maintenant,
   * c'est `isOpenAt` qui répond.
   */
  nextOpening(from: Date): Date | null {
    return this.openingsFrom(from)[0]?.opensAt ?? null;
  }
}
