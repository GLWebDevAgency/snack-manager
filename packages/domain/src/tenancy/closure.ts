import { err, ok, type Result } from '../shared/result';
import { InvalidClosure } from './errors';
import type { CalendarDay } from './wall-clock';

/**
 * Fermeture exceptionnelle : congés, jour férié travaillé ailleurs, panne de
 * friteuse, mariage du patron.
 *
 * Elle ne touche pas aux horaires hebdomadaires — le gérant ne doit pas avoir à
 * démonter puis remonter sa semaine type pour fermer trois jours en août.
 *
 * Deux fabriques, parce que le terrain pose deux questions différentes :
 *  - « fermé du 24 au 26 » → `wholeDays`, qui couvre les trois JOURNÉES de
 *    restaurant entières (sinon le 26 rouvrirait et le 24 fermerait à minuit
 *    pile, au milieu du service du soir) ;
 *  - « fermé ce soir » → `between`, bornes horaires respectées telles quelles.
 */
export class Closure {
  /** Libellé affiché quand le gérant n'a rien saisi. */
  static readonly DEFAULT_REASON = 'Fermeture exceptionnelle';

  private constructor(
    private readonly fromMs: number,
    private readonly toMs: number,
    readonly reason: string,
  ) {}

  /** Copies défensives : un `Date` est mutable, un value object ne l'est pas. */
  get from(): Date {
    return new Date(this.fromMs);
  }

  get to(): Date {
    return new Date(this.toMs);
  }

  static between(from: Date, to: Date, reason?: string): Result<Closure, InvalidClosure> {
    const fromMs = from.getTime();
    const toMs = to.getTime();
    if (!Number.isFinite(fromMs) || !Number.isFinite(toMs)) {
      return err(new InvalidClosure('Dates de fermeture illisibles'));
    }
    if (toMs < fromMs) {
      return err(new InvalidClosure('La fin de la fermeture précède son début'));
    }
    return ok(new Closure(fromMs, toMs, normalizeReason(reason)));
  }

  /** Journées de restaurant entières, bornes incluses. */
  static wholeDays(
    from: CalendarDay,
    to: CalendarDay,
    reason?: string,
  ): Result<Closure, InvalidClosure> {
    if (to.isBefore(from)) {
      return err(new InvalidClosure('La fin de la fermeture précède son début'));
    }
    // Borne haute = dernier instant du jour de fin, pas minuit du lendemain :
    // une commande à retirer à 23h59 le 26 doit rester impossible.
    return ok(
      new Closure(from.startsAt().getTime(), to.endsAt().getTime() - 1, normalizeReason(reason)),
    );
  }

  static onDay(day: CalendarDay, reason?: string): Result<Closure, InvalidClosure> {
    return Closure.wholeDays(day, day, reason);
  }

  covers(instant: Date): boolean {
    const ms = instant.getTime();
    return ms >= this.fromMs && ms <= this.toMs;
  }

  /** La journée de service entière est-elle avalée par cette fermeture ? */
  coversWholeDay(day: CalendarDay): boolean {
    return this.fromMs <= day.startsAt().getTime() && this.toMs >= day.endsAt().getTime() - 1;
  }

  /** Chevauche-t-elle au moins un instant de cette journée ? */
  touchesDay(day: CalendarDay): boolean {
    return this.fromMs < day.endsAt().getTime() && this.toMs >= day.startsAt().getTime();
  }
}

function normalizeReason(reason?: string): string {
  const cleaned = reason?.trim() ?? '';
  return cleaned.length > 0 ? cleaned : Closure.DEFAULT_REASON;
}
