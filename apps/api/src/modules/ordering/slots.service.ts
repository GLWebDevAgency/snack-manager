import { BadRequestException, Injectable, ConflictException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  NEXT_OPEN_LOOKAHEAD_DAYS,
  RESTAURANT_TZ,
  SLOT_LEAD_TIME_MIN,
  type PickupSlot,
  type SlotLoad,
  type SlotService,
  type SlotsResponse,
} from '@sm/contracts';
import type { Order, Tenant } from '@sm/db';
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
/** Garde-fou : un créneau toutes les minutes sur 24 h resterait raisonnable. */
const MAX_SLOTS_PER_DAY = 1_000;

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
 *  - `settings.slotCapacity` commandes par créneau, les commandes déjà prises
 *    sur le créneau étant décomptées ;
 *  - fermetures exceptionnelles (`closures`) exclues, à la journée ou au créneau.
 */
@Injectable()
export class SlotsService {
  constructor(@InjectModel('Order') private readonly orders: Model<Order>) {}

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
  private findNextOpenDate(
    tenant: Tenant,
    from: CalendarDay,
    ranges: ClosureRange[],
  ): string | null {
    for (let i = 1; i <= NEXT_OPEN_LOOKAHEAD_DAYS; i++) {
      const day = addDays(from, i);
      if (this.windowsFor(tenant, day).length === 0) continue;
      if (this.fullDayClosure(ranges, day)) continue;
      return formatDay(day);
    }
    return null;
  }

  /**
   * Nombre de commandes déjà prises par créneau de la grille.
   * Les commandes « au plus tôt » ne tombent pas pile sur un créneau : chacune
   * est rattachée au créneau immédiatement antérieur (bucket par troncature).
   */
  private async countPerSlot(
    tenantId: string,
    dayStart: Date,
    dayEnd: Date,
    gridMs: number[],
    intervalMs: number,
  ): Promise<Map<number, number>> {
    const counts = new Map<number, number>();
    if (gridMs.length === 0) return counts;

    const rows = await this.orders.aggregate<{ _id: Date | null; count: number }>([
      {
        $match: {
          tenantId: new Types.ObjectId(tenantId),
          status: { $ne: 'cancelled' }, // une commande annulée relibère sa place
          'pickup.slot': { $gte: dayStart, $lt: dayEnd },
        },
      },
      { $group: { _id: '$pickup.slot', count: { $sum: 1 } } },
    ]);

    const sorted = [...gridMs].sort((a, b) => a - b);
    for (const row of rows) {
      const at = toDate(row._id);
      if (!at) continue;
      const ms = at.getTime();
      let bucket: number | null = null;
      for (const slotMs of sorted) {
        if (slotMs > ms) break;
        bucket = slotMs;
      }
      if (bucket === null || ms - bucket >= intervalMs) continue; // hors grille
      counts.set(bucket, (counts.get(bucket) ?? 0) + row.count);
    }
    return counts;
  }

  /**
   * Créneaux proposables pour `date` (défaut : aujourd'hui, heure du restaurant).
   * Ne lève jamais quand le restaurant est fermé : `closedToday` + `nextOpenDate`.
   */
/**
   * REFUSE un créneau que le restaurant ne peut pas honorer.
   *
   * `compute` savait déjà tout — capacité restante, fermetures exceptionnelles,
   * délai de préparation — et rien ne le relisait au moment d'écrire la
   * commande. Le tunnel grisait les créneaux pleins, ce qui arrête un client
   * honnête et personne d'autre.
   *
   * ── Ce que ce contrôle ferme, et ce qu'il ne ferme pas ──────────────────
   *
   * Il ferme le créneau devenu plein pendant que le client réglait, la
   * fermeture exceptionnelle, l'heure passée, le délai de préparation non
   * tenu, et l'appel direct qui poserait des commandes sur un créneau complet.
   *
   * Il NE ferme PAS la course de la dernière place : deux clients qui valident
   * à la même seconde passent tous deux le contrôle avant que l'un des deux
   * n'écrive. La fenêtre tombe de plusieurs minutes à quelques millisecondes,
   * ce qui est un autre ordre de grandeur, mais la fermer tout à fait
   * demanderait un compteur atomique par créneau — à faire le jour où un
   * restaurant vend assez vite pour que cette seconde-là compte.
   */
  async exigerDisponible(tenant: TenantWithId, iso: string): Promise<void> {
    const at = new Date(iso);
    if (Number.isNaN(at.getTime())) {
      throw new BadRequestException('Créneau de retrait invalide.');
    }

    const { slots, closureReason, closedToday } = await this.compute(tenant, formatDay(parisYmd(at)));
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

    async compute(tenant: TenantWithId, date?: string): Promise<SlotsResponse> {
    const now = new Date();
    const today = parisYmd(now);
    const requested = date ? parseDay(date) : today;
    if (!requested) {
      throw new BadRequestException('Date invalide — format attendu AAAA-MM-JJ');
    }

    const intervalMin = positiveInt(tenant.settings?.slotIntervalMin, DEFAULT_INTERVAL_MIN);
    const capacity = positiveInt(tenant.settings?.slotCapacity, DEFAULT_CAPACITY);
    const paused = tenant.settings?.onlineOrderingPaused === true;

    const dayStart = parisWallToUtc(requested);
    const dayEnd = parisWallToUtc(addDays(requested, 1));
    const ranges = this.closureRanges(tenant);
    const dayClosure = this.fullDayClosure(ranges, requested);
    const isPastDay = compareDays(requested, today) < 0;
    const windows = isPastDay || dayClosure ? [] : this.windowsFor(tenant, requested);

    // ── Grille brute : un créneau tous les `intervalMin`, bornes incluses ──
    const grid: { at: Date; service: SlotService }[] = [];
    const seen = new Set<number>();
    for (const window of windows) {
      for (let m = window.openMin; m <= window.closeMin; m += intervalMin) {
        if (grid.length >= MAX_SLOTS_PER_DAY) break;
        const at = parisWallToUtc(requested, 0, m);
        if (seen.has(at.getTime())) continue; // services qui se chevauchent
        seen.add(at.getTime());
        grid.push({ at, service: window.service });
      }
    }
    grid.sort((a, b) => a.at.getTime() - b.at.getTime());

    // ── Filtres : délai de préparation + fermetures partielles ──
    const earliest = now.getTime() + SLOT_LEAD_TIME_MIN * MINUTE_MS;
    const intervalMs = intervalMin * MINUTE_MS;
    // Première fermeture ayant écarté un créneau : sert de motif si elle finit
    // par vider la journée (fermeture d'un service, bornes horaires précises).
    let blockingClosure: ClosureRange | null = null;
    const openable = grid.filter(({ at }) => {
      const ms = at.getTime();
      if (ms < earliest) return false;
      const hit = ranges.find((r) => ms >= r.from && ms <= r.to);
      if (hit) {
        blockingClosure ??= hit;
        return false;
      }
      return true;
    });

    const counts = await this.countPerSlot(
      String(tenant._id),
      dayStart,
      dayEnd,
      openable.map((s) => s.at.getTime()),
      intervalMs,
    );

    const slots: PickupSlot[] = openable.map(({ at, service }) => {
      const taken = counts.get(at.getTime()) ?? 0;
      const remaining = Math.max(0, capacity - taken);
      return {
        iso: at.toISOString(),
        label: parisHm(at),
        service,
        remaining,
        full: remaining <= 0,
        load: loadOf(remaining, capacity),
      };
    });

    const closedToday = slots.length === 0;
    // Une date passée renvoie la prochaine ouverture à partir d'aujourd'hui.
    const scanFrom = isPastDay ? addDays(today, -1) : requested;
    const closure = dayClosure ?? (closedToday ? blockingClosure : null);

    return {
      date: formatDay(requested),
      timezone: RESTAURANT_TZ,
      intervalMin,
      capacity,
      leadTimeMin: SLOT_LEAD_TIME_MIN,
      slots,
      closedToday,
      nextOpenDate: closedToday ? this.findNextOpenDate(tenant, scanFrom, ranges) : null,
      closureReason: closure ? closure.reason || 'Fermeture exceptionnelle' : null,
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
