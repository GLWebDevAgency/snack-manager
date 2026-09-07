import type { Tenant } from '@sm/db';
import { DEFAULT_DELIVERY_SETTINGS, RESTAURANT_TZ, type SlotService } from '@sm/contracts';
import { addDays, formatDay, isoWeekday, parisMinutesOfDay, parisWallToUtc, parisYmd, parseDay, parseHm } from './paris-time';

type Settings = Pick<NonNullable<Tenant['settings']>, 'slotIntervalMin' | 'slotCapacity'>;
type Delivery = Pick<NonNullable<Tenant['delivery']>, 'slotCapacity'>;
type DayHours = Pick<NonNullable<Tenant['hours']>[number], 'day' | 'lunch' | 'dinner'>;
type Closure = Pick<NonNullable<Tenant['closures']>[number], 'from' | 'to' | 'reason'>;

/** Données d'établissement existantes, sans identité, abonnement ni état bancaire. */
export type OrderCapacityCalendarInput = Readonly<{
  settings?: Partial<Settings> | null;
  delivery?: Partial<Delivery> | null;
  hours?: ReadonlyArray<DayHours> | null;
  closures?: ReadonlyArray<Closure> | null;
}>;

export type OrderCapacityCalendarSlot = Readonly<{
  at: Date;
  service: SlotService;
  kitchenCapacity: number;
  deliveryCapacity: number;
}>;

export type OrderCapacityCalendar = Readonly<{
  day: string;
  timezone: typeof RESTAURANT_TZ;
  intervalMin: number;
  slots: readonly OrderCapacityCalendarSlot[];
  closed: boolean;
  emptyReason: 'no_service' | 'exceptional_closure' | null;
  closureReason: string | null;
}>;

export class InvalidCapacityCalendarDay extends Error {
  readonly code = 'INVALID_CAPACITY_CALENDAR_DAY';
  constructor() {
    super('Journée invalide : une date réelle au format AAAA-MM-JJ est requise.');
    this.name = 'InvalidCapacityCalendarDay';
  }
}

export class InvalidCapacityCalendarHours extends Error {
  readonly code = 'INVALID_CAPACITY_CALENDAR_HOURS';
  constructor(message = 'Horaires invalides : les services traversant minuit ne sont pas encore supportés.') {
    super(message);
    this.name = 'InvalidCapacityCalendarHours';
  }
}

export class InvalidCapacityCalendarSettings extends Error {
  readonly code = 'INVALID_CAPACITY_CALENDAR_SETTINGS';
  constructor(readonly field: string) {
    super(`Réglage de capacité invalide : ${field}.`);
    this.name = 'InvalidCapacityCalendarSettings';
  }
}

export class InvalidCapacityCalendarClosures extends Error {
  readonly code = 'INVALID_CAPACITY_CALENDAR_CLOSURES';
  constructor() {
    super('Fermeture invalide : des bornes chronologiques valides sont requises.');
    this.name = 'InvalidCapacityCalendarClosures';
  }
}

type ClosureRange = Readonly<{ from: number; to: number; reason: string }>;
const MAX_SLOTS_PER_DAY = 1_000;

function boundedSetting(value: unknown, fallback: number, min: number, max: number, field: string): number {
  if (value === undefined) return fallback;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    throw new InvalidCapacityCalendarSettings(field);
  }
  return value;
}

function closureDate(value: unknown): Date {
  const date = value instanceof Date ? new Date(value.getTime()) : typeof value === 'string' ? new Date(value) : null;
  if (!date || !Number.isFinite(date.getTime())) throw new InvalidCapacityCalendarClosures();
  return date;
}

/** Même interprétation des sélecteurs date seule que SlotsService.closureRanges. */
function isDateOnly(date: Date): boolean {
  const utcMidnight = date.getUTCHours() === 0 && date.getUTCMinutes() === 0
    && date.getUTCSeconds() === 0 && date.getUTCMilliseconds() === 0;
  return utcMidnight || parisMinutesOfDay(date) === 0;
}

function closureRanges(input: OrderCapacityCalendarInput): ClosureRange[] {
  const closures = input.closures ?? [];
  if (!Array.isArray(closures)) throw new InvalidCapacityCalendarClosures();
  return closures.map((closure) => {
    if (!closure || typeof closure !== 'object') throw new InvalidCapacityCalendarClosures();
    const rawFrom = closureDate(closure.from);
    const rawTo = closure.to == null ? rawFrom : closureDate(closure.to);
    if (rawTo.getTime() < rawFrom.getTime()) throw new InvalidCapacityCalendarClosures();
    const from = isDateOnly(rawFrom) ? parisWallToUtc(parisYmd(rawFrom)) : rawFrom;
    const to = isDateOnly(rawTo)
      ? new Date(parisWallToUtc(addDays(parisYmd(rawTo), 1)).getTime() - 1) : rawTo;
    return { from: from.getTime(), to: to.getTime(), reason: typeof closure.reason === 'string' ? closure.reason : '' };
  });
}

/**
 * Grille BRUTE préparatoire C15-B, non raccordée au runtime.
 *
 * Reprend de SlotsService : jour ISO, heures murales Paris, bornes de service
 * inclusives, priorité lunch lors des chevauchements, déduplication d'instants,
 * conversion DST existante et fermetures date seule/horaire inclusives.
 * Ne lit jamais l'heure actuelle, le délai de préparation, les ventes, les
 * pauses, les zones de livraison, l'abonnement ni Connect. Une grille n'est
 * donc PAS une promesse de disponibilité ou un calendrier prêt à activer.
 *
 * Différences conservatrices explicites avant toute future persistance :
 * - settings explicites hors bornes refusés (pas d'arrondi/default silencieux) ;
 * - horaires incohérents refusés, là où SlotsService les ignore ; 24:00 est
 *   admis uniquement comme FIN exclusive, 26:00 ou 18:00→02:00 sont refusés ;
 * - fermetures malformées refusées, jamais ignorées pour ouvrir une journée.
 *
 * Limite DST héritée : à l'automne parisWallToUtc choisit une occurrence de
 * l'heure répétée, il ne produit pas les deux. Ne pas inventer ici une autre
 * convention : les tests comparent les instants au service actuel.
 */
export function buildOrderCapacityCalendar(input: OrderCapacityCalendarInput, day: string): OrderCapacityCalendar {
  if (typeof day !== 'string') throw new InvalidCapacityCalendarDay();
  const requested = parseDay(day);
  if (!requested) throw new InvalidCapacityCalendarDay();
  const intervalMin = boundedSetting(input.settings?.slotIntervalMin, 10, 5, 60, 'slotIntervalMin');
  const kitchenCapacity = boundedSetting(input.settings?.slotCapacity, 4, 1, 100, 'slotCapacity');
  const deliveryCapacity = boundedSetting(input.delivery?.slotCapacity, DEFAULT_DELIVERY_SETTINGS.slotCapacity, 1, 50, 'delivery.slotCapacity');
  const hours = input.hours ?? [];
  if (!Array.isArray(hours)) throw new InvalidCapacityCalendarHours();
  const weekdays = new Set<number>();
  for (const entry of hours) {
    if (!entry || !Number.isInteger(entry.day) || entry.day < 1 || entry.day > 7 || weekdays.has(entry.day)) {
      throw new InvalidCapacityCalendarHours('Les jours horaires doivent être uniques, entiers et compris entre 1 et 7.');
    }
    weekdays.add(entry.day);
  }
  const entry = hours.find((value) => value.day === isoWeekday(requested));
  const windows: { service: SlotService; openMin: number; closeMin: number }[] = [];
  for (const service of ['lunch', 'dinner'] as const) {
    const range = entry?.[service];
    if (!range) continue;
    if (typeof range.open !== 'string' || typeof range.close !== 'string') throw new InvalidCapacityCalendarHours();
    const openMin = parseHm(range.open);
    const closeMin = parseHm(range.close);
    if (openMin === null || closeMin === null || openMin >= 1440 || closeMin > 1440 || closeMin <= openMin) {
      throw new InvalidCapacityCalendarHours();
    }
    windows.push({ service, openMin, closeMin });
  }

  const ranges = closureRanges(input);
  const dayStart = parisWallToUtc(requested).getTime();
  const dayEnd = parisWallToUtc(addDays(requested, 1)).getTime() - 1;
  const wholeDayClosure = ranges.find((range) => range.from <= dayStart && range.to >= dayEnd);
  const grid: OrderCapacityCalendarSlot[] = [];
  const seen = new Set<number>();
  if (!wholeDayClosure) {
    for (const window of windows) {
      for (let minute = window.openMin; minute <= window.closeMin && minute < 1440; minute += intervalMin) {
        const at = parisWallToUtc(requested, 0, minute);
        if (formatDay(parisYmd(at)) !== day) throw new InvalidCapacityCalendarHours('Un créneau déborde de la journée Paris demandée.');
        if (seen.has(at.getTime())) continue;
        if (grid.length >= MAX_SLOTS_PER_DAY) throw new InvalidCapacityCalendarHours('La grille dépasse 1 000 créneaux.');
        seen.add(at.getTime());
        grid.push({ at, service: window.service, kitchenCapacity, deliveryCapacity });
      }
    }
  }
  grid.sort((left, right) => left.at.getTime() - right.at.getTime());
  let blockingClosure: ClosureRange | null = null;
  const slots = grid.filter(({ at }) => {
    const hit = ranges.find((range) => at.getTime() >= range.from && at.getTime() <= range.to);
    if (!hit) return true;
    blockingClosure ??= hit;
    return false;
  });
  const closed = slots.length === 0;
  const closure = wholeDayClosure ?? (closed ? blockingClosure : null);
  return {
    day, timezone: RESTAURANT_TZ, intervalMin, slots, closed,
    emptyReason: closed ? closure ? 'exceptional_closure' : 'no_service' : null,
    closureReason: closure ? closure.reason || 'Fermeture exceptionnelle' : null,
  };
}
