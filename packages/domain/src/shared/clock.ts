/**
 * Le temps est une dépendance, pas un fait global.
 *
 * Un domaine qui appelle `Date.now()` est intestable : les créneaux de retrait,
 * les minuteurs de cuisine et les services du soir dépendent tous de l'heure.
 * On injecte donc une horloge, et les tests fixent l'instant.
 */
export interface Clock {
  now(): Date;
}

export const systemClock: Clock = {
  now: () => new Date(),
};

/** Horloge figée pour les tests. */
export class FixedClock implements Clock {
  constructor(private instant: Date) {}

  now(): Date {
    return new Date(this.instant);
  }

  advanceMinutes(minutes: number): void {
    this.instant = new Date(this.instant.getTime() + minutes * 60_000);
  }
}

/** Fuseau de référence du produit : les restaurants sont en France. */
export const RESTAURANT_TIMEZONE = 'Europe/Paris';

/** Minutes écoulées entre deux instants (valeur positive ou nulle). */
export function minutesBetween(from: Date, to: Date): number {
  return Math.max(0, Math.floor((to.getTime() - from.getTime()) / 60_000));
}
