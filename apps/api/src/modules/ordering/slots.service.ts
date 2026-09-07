import { BadRequestException, Injectable, ConflictException } from '@nestjs/common';
import {
  NEXT_OPEN_LOOKAHEAD_DAYS,
  RESTAURANT_TZ,
  SLOT_LEAD_TIME_MIN,
  type PickupSlot,
  type SlotLoad,
  type SlotService,
  type SlotsResponse,
  type Fulfillment,
} from '@sm/contracts';
import type { Tenant } from '@sm/db';
import { OrderCapacityAvailabilityService } from './order-capacity-availability.service';
import { buildOrderCapacityCalendar } from './order-capacity-calendar';
import { assertOrderSlotFresh } from './order-slot-freshness';
import { deliverySettingsOf, publicDeliverySettingsOf } from '../delivery/delivery-order';
import {
  addDays,
  compareDays,
  formatDay,
  formatHm,
  parisHm,
  parisMinutesOfDay,
  parisWallToUtc,
  parisYmd,
  parseDay,
  parseHm,
  type CalendarDay,
} from './paris-time';

const MINUTE_MS = 60_000;
const DEFAULT_INTERVAL_MIN = 10;
const DEFAULT_CAPACITY = 4;

/** Tenant hydraté (le type inféré du schéma ne porte pas `_id`). */
export type TenantWithId = Tenant & { _id: unknown };

/** Fenêtre de service d'une journée, en minutes depuis minuit (heure murale). */
interface ServiceWindow {
  service: SlotService;
  openMin: number;
  closeMin: number;
}

/** Fermeture exceptionnelle normalisée en instants absolus. */
interface ClosureRange {
  from: number;
  to: number;
  reason: string;
}

/**
 * Calcul des créneaux de retrait.
 *
 * Règles (spec commande-en-ligne §5.5) :
 *  - pas de `settings.slotIntervalMin` minutes, bornes = services réels du jour
 *    (Class'Food : lundi et vendredi = soir uniquement) ;
 *  - délai de préparation minimum de 20 min à partir de maintenant ;
 *  - grille et capacités figées par journée, sièges durables non libérés ;
 *  - fermetures incorporées au plan avant son gel. Les réglages courants ne
 *    réécrivent jamais une journée qui porte déjà des engagements.
 */
@Injectable()
export class SlotsService {
  constructor(private readonly availability: OrderCapacityAvailabilityService) {}

  /** Fenêtres de service d'un jour calendaire, d'après `hours` (jour ISO 1–7). */
  private windowsFor(tenant: Tenant, day: CalendarDay): ServiceWindow[] {
    const weekday = isoWeekdayOf(day);
    const entry = (tenant.hours ?? []).find((h) => Number(h?.day) === weekday);
    if (!entry) return [];

    const windows: ServiceWindow[] = [];
    for (const service of ['lunch', 'dinner'] as const) {
      const range = entry[service];
      const openMin = parseHm(range?.open);
      const closeMin = parseHm(range?.close);
      // Service absent (midi fermé le lundi) ou horaire incohérent : ignoré.
      if (openMin === null || closeMin === null || closeMin < openMin) continue;
      windows.push({ service, openMin, closeMin });
    }
    return windows;
  }

  /**
   * Fermetures exceptionnelles ramenées à des intervalles absolus.
   *
   * Une fermeture saisie « du 24 au 26 août » arrive sans heure significative :
   * elle doit couvrir ces trois journées ENTIÈRES du restaurant, sinon le 26
   * resterait ouvert et le 24 le serait jusqu'à 2 h du matin. Les bornes
   * date-seule sont donc étendues aux limites du jour parisien ; une borne
   * portant une vraie heure (fermeture d'un seul service) est respectée telle quelle.
   */
  private closureRanges(tenant: Tenant): ClosureRange[] {
    const ranges: ClosureRange[] = [];
    for (const closure of tenant.closures ?? []) {
      const rawFrom = toDate(closure?.from);
      if (!rawFrom) continue;
      const rawTo = toDate(closure?.to) ?? rawFrom;
      const from = isDateOnly(rawFrom) ? parisWallToUtc(parisYmd(rawFrom)) : rawFrom;
      const to = isDateOnly(rawTo)
        ? new Date(parisWallToUtc(addDays(parisYmd(rawTo), 1)).getTime() - 1)
        : rawTo;
      ranges.push({
        from: from.getTime(),
        to: Math.max(from.getTime(), to.getTime()),
        reason: typeof closure?.reason === 'string' ? closure.reason : '',
      });
    }
    return ranges;
  }

  /** Fermeture couvrant la journée entière, s'il y en a une. */
  private fullDayClosure(ranges: ClosureRange[], day: CalendarDay): ClosureRange | null {
    const start = parisWallToUtc(day).getTime();
    const end = parisWallToUtc(addDays(day, 1)).getTime() - 1;
    return ranges.find((r) => r.from <= start && r.to >= end) ?? null;
  }

  /** Première date (AAAA-MM-JJ) réellement ouverte après `from`, sinon `null`. */
  private async findNextOpenDate(
    tenant: TenantWithId,
    from: CalendarDay,
    furthest: CalendarDay,
  ): Promise<string | null> {
    for (let i = 1; i <= NEXT_OPEN_LOOKAHEAD_DAYS; i++) {
      const day = addDays(from, i);
      if (compareDays(day, furthest) > 0) break;
      const plan = await this.availability.previewDay(String(tenant._id), formatDay(day));
      if (plan.slots.length === 0) continue;
      return formatDay(day);
    }
    return null;
  }

  /**
   * Créneaux proposables pour `date` (défaut : aujourd'hui, heure du restaurant).
   * Ne lève jamais quand le restaurant est fermé : `closedToday` + `nextOpenDate`.
   */
/**
   * REFUSE un créneau que le restaurant ne peut pas honorer.
   *
   * Contrôle de fraîcheur public (horizon, délai et pause) seulement. La
   * disponibilité peut changer juste après : seul le CAS d'admission attribue
   * les sièges atomiques et ferme la course de la dernière place.
   */
  async exigerDisponible(tenant: TenantWithId, iso: string, fulfillment: Fulfillment = 'pickup'): Promise<void> {
    const at = assertOrderSlotFresh(iso);
    const requested = parisYmd(at);
    const { slots, closureReason, closedToday, paused } = await this.compute(tenant, formatDay(requested), fulfillment);
    if (paused) throw new ConflictException('La prise de commande est suspendue pour le moment.');
    const creneau = slots.find((s) => s.iso === at.toISOString());

    if (!creneau) {
      // Un créneau absent de la journée : fermé, passé, ou hors des heures.
      // Le motif de fermeture prime quand il existe — c'est ce que le client
      // a besoin de lire, et il est déjà rédigé pour lui.
      throw new ConflictException(
        closedToday && closureReason
          ? closureReason
          : 'Ce créneau n’est plus disponible — choisissez-en un autre.',
      );
    }
    if (creneau.full) {
      throw new ConflictException(
        `Le créneau de ${creneau.label} vient d’être complet — choisissez-en un autre.`,
      );
    }
  }

  async compute(tenant: TenantWithId, date?: string, fulfillment: Fulfillment = 'pickup', audience: 'public' | 'staff' = 'public'): Promise<SlotsResponse> {
    const now = new Date();
    const today = parisYmd(now);
    const requested = date ? parseDay(date) : today;
    if (!requested) {
      throw new BadRequestException('Date invalide — format attendu AAAA-MM-JJ');
    }

    const furthest = addDays(today, NEXT_OPEN_LOOKAHEAD_DAYS);
    if (compareDays(requested, furthest) > 0) {
      throw new ConflictException(`Les commandes ouvrent au maximum ${NEXT_OPEN_LOOKAHEAD_DAYS} jours a l avance.`);
    }
    // Mandatory even during a pause: never present a legacy Order count as
    // capacity when bootstrap/control is absent, incomplete or blocked.
    const plan = await this.availability.readDay(String(tenant._id), formatDay(requested));
    const delivery = deliverySettingsOf(tenant);
    const isDelivery = fulfillment === 'delivery';
    const slotCapacity = (slot: (typeof plan.slots)[number]) => isDelivery
      ? Math.min(slot.kitchenCapacity, slot.deliveryCapacity) : slot.kitchenCapacity;
    const capacity = plan.slots.length > 0 ? Math.max(...plan.slots.map(slotCapacity))
      : positiveInt(tenant.settings?.slotCapacity, DEFAULT_CAPACITY);
    // These response labels are indicative. Admission NEVER derives an
    // instant or a seat from intervalMin/service; only the frozen plan does.
    const differences = plan.slots.slice(1).map((slot, index) => (slot.at.getTime() - plan.slots[index]!.at.getTime()) / MINUTE_MS)
      .filter((value) => Number.isInteger(value) && value >= 5 && value <= 60);
    const intervalMin = differences.length > 0 ? Math.min(...differences)
      : positiveInt(tenant.settings?.slotIntervalMin, DEFAULT_INTERVAL_MIN);
    const deliveryAvailable = !isDelivery || publicDeliverySettingsOf(tenant).available;
    const leadTimeMin = isDelivery ? Math.max(SLOT_LEAD_TIME_MIN, delivery.leadTimeMin) : SLOT_LEAD_TIME_MIN;
    const paused = (audience === 'public' && tenant.settings?.onlineOrderingPaused === true) || !deliveryAvailable;

    const isPastDay = compareDays(requested, today) < 0;
    const windows = this.windowsFor(tenant, requested);
    const earliest = now.getTime() + leadTimeMin * MINUTE_MS;
    const openable = isPastDay || !deliveryAvailable ? [] : plan.slots.filter(({ at }) => at.getTime() >= earliest);
    const slots: PickupSlot[] = openable.map((slot) => {
      const { at, kitchenCapacity, deliveryCapacity, kitchenTaken, deliveryTaken } = slot;
      const kitchenRemaining = kitchenCapacity - kitchenTaken;
      const remaining = Math.max(0, isDelivery ? Math.min(kitchenRemaining, deliveryCapacity - deliveryTaken) : kitchenRemaining);
      const minutes = parisMinutesOfDay(at);
      const service = windows.find((window) => minutes >= window.openMin && minutes <= window.closeMin)?.service
        ?? (minutes < 16 * 60 ? 'lunch' : 'dinner');
      return {
        iso: at.toISOString(),
        label: parisHm(at),
        service,
        remaining,
        full: remaining <= 0,
        load: loadOf(remaining, slotCapacity(slot)),
      };
    });

    const closedToday = slots.length === 0;
    // Une date passée renvoie la prochaine ouverture à partir d'aujourd'hui.
    const scanFrom = isPastDay ? addDays(today, -1) : requested;
    const closure = plan.closedReason === 'exceptional_closure';
    // Frozen plans intentionally do not copy free-text closure reasons. A
    // later BO edit must not relabel an older closure with an unrelated reason.
    const closureReason = closure ? (!plan.frozen ? buildOrderCapacityCalendar(tenant, plan.day).closureReason : null)
      || 'Fermeture exceptionnelle' : null;

    return {
      date: formatDay(requested),
      timezone: RESTAURANT_TZ,
      intervalMin,
      capacity,
      leadTimeMin,
      slots,
      closedToday,
      nextOpenDate: closedToday ? await this.findNextOpenDate(tenant, scanFrom, furthest) : null,
      closureReason,
      paused,
    };
  }

  /** Le restaurant sert-il à cet instant (services du jour, hors fermeture) ? */
  isOpenNow(tenant: Tenant, now = new Date()): boolean {
    const today = parisYmd(now);
    const ranges = this.closureRanges(tenant);
    if (this.fullDayClosure(ranges, today)) return false;
    const ms = now.getTime();
    if (ranges.some((r) => ms >= r.from && ms <= r.to)) return false;
    const minutes = parisMinutesOfDay(now);
    return this.windowsFor(tenant, today).some(
      (w) => minutes >= w.openMin && minutes <= w.closeMin,
    );
  }

  /** Horaires du jour demandé, normalisés « HH:MM » (null si pas de service). */
  todayHours(tenant: Tenant, day: CalendarDay) {
    const windows = this.windowsFor(tenant, day);
    if (windows.length === 0) return null;
    const pick = (service: SlotService) => {
      const w = windows.find((x) => x.service === service);
      return w ? { open: formatHm(w.openMin), close: formatHm(w.closeMin) } : null;
    };
    return { day: isoWeekdayOf(day), lunch: pick('lunch'), dinner: pick('dinner') };
  }
}

// ─── Helpers locaux ───

/** Jour ISO (1 = lundi … 7 = dimanche) — réexposé ici pour éviter un import croisé. */
function isoWeekdayOf(day: CalendarDay): number {
  const wd = new Date(Date.UTC(day.y, day.m - 1, day.d)).getUTCDay();
  return wd === 0 ? 7 : wd;
}

function positiveInt(value: unknown, fallback: number): number {
  const n = Math.round(Number(value));
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function toDate(value: unknown): Date | null {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value as string);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Borne « date seule » : minuit UTC (sélecteur de date qui envoie `2026-08-26`)
 * ou minuit parisien (date construite dans le fuseau du restaurant).
 */
function isDateOnly(d: Date): boolean {
  const utcMidnight =
    d.getUTCHours() === 0 &&
    d.getUTCMinutes() === 0 &&
    d.getUTCSeconds() === 0 &&
    d.getUTCMilliseconds() === 0;
  return utcMidnight || parisMinutesOfDay(d) === 0;
}

/** Affluence : complet, chargé (moitié de la capacité consommée), tranquille. */
function loadOf(remaining: number, capacity: number): SlotLoad {
  if (remaining <= 0) return 'full';
  return remaining <= Math.ceil(capacity / 2) ? 'busy' : 'calm';
}
