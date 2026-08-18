import type { Clock } from '../shared/clock';
import { invariant } from '../shared/errors';
import { err, ok, type Result } from '../shared/result';
import type { Closure } from './closure';
import { InvalidSlotPolicy } from './errors';
import { SERVICE_LABELS, type ServiceHours, type ServiceName } from './service-hours';
import { CalendarDay, wallLabel } from './wall-clock';

const MINUTE_MS = 60_000;

/**
 * Créneaux de retrait.
 *
 * Trois réglages, et seulement trois, parce que ce sont les trois seuls que le
 * comptoir a jamais demandé à bouger :
 *  - le PAS (10 min) : la cadence à laquelle la cuisine accepte de sortir un sac ;
 *  - la CAPACITÉ (4 commandes) : ce que la friteuse encaisse sur un même pas ;
 *  - le DÉLAI DE PRÉPARATION (20 min) : le temps incompressible entre l'accusé
 *    de réception et le premier sac prêt. Sans lui, un client commande à 19h29
 *    pour 19h30 et arrive avant le tacos.
 */
export class SlotPolicy {
  private constructor(
    readonly intervalMinutes: number,
    readonly capacity: number,
    readonly leadTimeMinutes: number,
  ) {}

  /** Réglage livré à l'ouverture d'un compte. */
  static readonly DEFAULT = new SlotPolicy(10, 4, 20);

  static create(settings: {
    intervalMinutes?: number;
    capacity?: number;
    leadTimeMinutes?: number;
  }): Result<SlotPolicy, InvalidSlotPolicy> {
    const interval = settings.intervalMinutes ?? SlotPolicy.DEFAULT.intervalMinutes;
    const capacity = settings.capacity ?? SlotPolicy.DEFAULT.capacity;
    const leadTime = settings.leadTimeMinutes ?? SlotPolicy.DEFAULT.leadTimeMinutes;

    // Bornes hautes volontairement basses : elles bornent aussi le nombre de
    // créneaux calculables en une journée, donc le coût de `generateSlots`.
    if (!Number.isInteger(interval) || interval < 1 || interval > 240) {
      return err(new InvalidSlotPolicy('Le pas des créneaux va de 1 à 240 minutes'));
    }
    if (!Number.isInteger(capacity) || capacity < 1 || capacity > 999) {
      return err(new InvalidSlotPolicy('La capacité d’un créneau va de 1 à 999 commandes'));
    }
    if (!Number.isInteger(leadTime) || leadTime < 0 || leadTime > 1440) {
      return err(new InvalidSlotPolicy('Le délai de préparation va de 0 à 1440 minutes'));
    }

    return ok(new SlotPolicy(interval, capacity, leadTime));
  }

  get intervalMs(): number {
    return this.intervalMinutes * MINUTE_MS;
  }

  /** Premier instant proposable à un client qui commande maintenant. */
  earliestFrom(now: Date): Date {
    return new Date(now.getTime() + this.leadTimeMinutes * MINUTE_MS);
  }
}

/** Un créneau proposé au client. */
export class PickupSlot {
  private constructor(
    private readonly ms: number,
    readonly service: ServiceName,
    /** Places encore disponibles — jamais négatif. */
    readonly remaining: number,
    readonly capacity: number,
  ) {}

  static at(
    instant: Date,
    service: ServiceName,
    capacity: number,
    taken: number,
  ): PickupSlot {
    invariant(capacity > 0, `capacité de créneau nulle : ${capacity}`);
    invariant(taken >= 0, `occupation négative : ${taken}`);
    return new PickupSlot(instant.getTime(), service, Math.max(0, capacity - taken), capacity);
  }

  /** Copie défensive : le créneau reste immuable même si l'appelant modifie sa date. */
  get instant(): Date {
    return new Date(this.ms);
  }

  /** Complet : la cuisine ne prend plus rien sur ce pas. */
  get isFull(): boolean {
    return this.remaining <= 0;
  }

  /** « 19:30 » — heure murale du restaurant. */
  label(): string {
    return wallLabel(this.instant);
  }

  /** « Soir · 19:30 ». */
  fullLabel(): string {
    return `${SERVICE_LABELS[this.service]} · ${this.label()}`;
  }
}

/**
 * Ce que la cuisine a déjà accepté sur chaque créneau.
 *
 * Port au sens strict : le domaine sait qu'un créneau se remplit, il ignore que
 * les commandes vivent dans Mongo.
 */
export interface SlotOccupancy {
  /** Commandes déjà prises sur le créneau qui démarre à cet instant. */
  takenAt(slotStart: Date): number;
}

/** Grille vierge — restaurant qui vient d'ouvrir, ou simulation. */
export const EMPTY_OCCUPANCY: SlotOccupancy = { takenAt: () => 0 };

/**
 * Occupation déduite des commandes déjà encaissées.
 *
 * Une commande « au plus tôt » ne tombe jamais pile sur la grille : elle est
 * rattachée au créneau ouvert qui la précède, sinon 19h33 ne consommerait la
 * place de personne et le comptoir prendrait cinq sacs pour 19h30.
 */
export function occupancyOf(bookings: readonly Date[], policy: SlotPolicy): SlotOccupancy {
  const stamps = bookings.map((b) => b.getTime()).sort((a, b) => a - b);
  return {
    takenAt(slotStart: Date): number {
      const start = slotStart.getTime();
      const end = start + policy.intervalMs;
      return stamps.filter((ms) => ms >= start && ms < end).length;
    },
  };
}

/**
 * Créneaux proposables pour une journée donnée.
 *
 * Ne lève jamais : une journée fermée, passée ou entièrement annulée renvoie
 * une liste vide. C'est l'interface qui décide du message (« fermé aujourd'hui,
 * réouverture demain à 11h30 ») — le domaine ne connaît pas la formulation.
 *
 * Les créneaux complets restent dans la liste : le client doit voir que 20h00
 * existe et qu'il est plein, sinon il croit le restaurant fermé.
 */
export function generateSlots(
  day: CalendarDay,
  hours: ServiceHours,
  policy: SlotPolicy,
  occupancy: SlotOccupancy,
  clock: Clock,
  closures: readonly Closure[] = [],
): readonly PickupSlot[] {
  const now = clock.now();

  // Une journée déjà écoulée ne propose rien, même si les horaires la couvrent.
  if (day.isBefore(CalendarDay.from(now))) return [];

  // Fermeture couvrant la journée entière : inutile de dérouler la grille.
  if (closures.some((c) => c.coversWholeDay(day))) return [];

  const earliest = policy.earliestFrom(now).getTime();
  const slots: PickupSlot[] = [];

  for (const window of hours.windowsOn(day)) {
    for (
      let minutes = window.opensAt.minutes;
      minutes <= window.closesAt.minutes;
      minutes += policy.intervalMinutes
    ) {
      const instant = day.atMinutes(minutes);
      if (instant.getTime() < earliest) continue;
      if (closures.some((c) => c.covers(instant))) continue;

      slots.push(
        PickupSlot.at(instant, window.service, policy.capacity, occupancy.takenAt(instant)),
      );
    }
  }

  // Les plages d'un même jour ne se chevauchent pas (`DayHours` le refuse),
  // mais elles peuvent être saisies dans le désordre.
  return slots.sort((a, b) => a.instant.getTime() - b.instant.getTime());
}
