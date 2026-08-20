import {
  PLANNING_COVERAGE_DISCLAIMER,
  PLANNING_COVERAGE_PEAK_THRESHOLD,
  PLANNING_COVERAGE_PEOPLE_BUSY,
  PLANNING_COVERAGE_PEOPLE_CALM,
  PLANNING_SERVICE_DEFAULT_HOURS,
  PLANNING_SERVICE_LABELS,
  PLANNING_SERVICES,
  type PlanningCoverage,
  type PlanningCoverageBlock,
  type PlanningCoverageVerdict,
  type PlanningService,
  type StatsHeatmapCell,
} from '@sm/contracts';
import { tenancy } from '@sm/domain';
import { addDays, formatDay, isoWeekday, type CalendarDay } from '../ordering/paris-time';
import { hmToMinutes, serviceOf, shiftMinutes, type PlannedShiftRow } from './planning.compute';

/**
 * ADÉQUATION DU PLANNING AU VOLUME ATTENDU.
 *
 * La prévision n'est pas recalculée ici : elle vient de la heatmap du tableau
 * de bord (`StatsService.heatmap`), c'est-à-dire des trente derniers jours de
 * commandes agrégés par jour de semaine et par heure, fuseau Paris. On se
 * contente de la croiser avec les services posés.
 *
 * `/ 4` : la fenêtre de trente jours contient quatre occurrences complètes de
 * chaque jour de semaine. C'est exactement le diviseur qu'emploie le tableau
 * de bord — les deux écrans doivent annoncer le même « ≈ 24 commandes », sinon
 * le gérant ne sait plus lequel croire.
 */
const OCCURRENCES_PER_MONTH = 4;

/** Bornes horaires de la heatmap : rien n'est mesuré hors de 11 h → 23 h. */
const FIRST_HOUR = 11;
const LAST_HOUR = 23;

export interface CoverageInput {
  weekStart: CalendarDay;
  shifts: PlannedShiftRow[];
  /** Sortie brute de `StatsService.heatmap` — cumul 30 j, jamais retouchée. */
  heatmap: StatsHeatmapCell[];
}

export function buildCoverage(input: CoverageInput): PlanningCoverage {
  const expected = expectedByWeekdayHour(input.heatmap);
  const hasForecast = [...expected.values()].some((byHour) =>
    [...byHour.values()].some((n) => n > 0),
  );

  const byDate = new Map<string, PlannedShiftRow[]>();
  for (const s of input.shifts) {
    const bucket = byDate.get(s.date);
    if (bucket) bucket.push(s);
    else byDate.set(s.date, [s]);
  }

  const blocks: PlanningCoverageBlock[] = [];
  for (let i = 0; i < 7; i++) {
    const day = addDays(input.weekStart, i);
    const date = formatDay(day);
    const weekday = isoWeekday(day);
    const label = tenancy.isWeekday(weekday) ? tenancy.WEEKDAY_LABELS[weekday] : '';
    const dayShifts = byDate.get(date) ?? [];
    for (const service of PLANNING_SERVICES) {
      blocks.push(
        blockFor({
          date,
          weekday,
          label,
          service,
          shifts: dayShifts.filter((s) => serviceOf(s.start) === service),
          expectedHours: expected.get(weekday) ?? new Map<number, number>(),
        }),
      );
    }
  }

  return {
    week: formatDay(input.weekStart),
    weekEnd: formatDay(addDays(input.weekStart, 6)),
    blocks,
    hasForecast,
    disclaimer: PLANNING_COVERAGE_DISCLAIMER,
  };
}

/** Commandes attendues par jour de semaine et par heure (moyenne d'une occurrence). */
function expectedByWeekdayHour(cells: StatsHeatmapCell[]): Map<number, Map<number, number>> {
  const byWeekday = new Map<number, Map<number, number>>();
  for (const cell of cells) {
    const byHour = byWeekday.get(cell.day) ?? new Map<number, number>();
    byHour.set(cell.hour, cell.orders / OCCURRENCES_PER_MONTH);
    byWeekday.set(cell.day, byHour);
  }
  return byWeekday;
}

interface BlockInput {
  date: string;
  weekday: number;
  label: string;
  service: PlanningService;
  shifts: PlannedShiftRow[];
  expectedHours: Map<number, number>;
}

function blockFor(input: BlockInput): PlanningCoverageBlock {
  const { hours, window } = coveredHours(input.shifts, input.service);

  let total = 0;
  let peak = 0;
  for (const hour of hours) {
    const n = input.expectedHours.get(hour) ?? 0;
    total += n;
    if (n > peak) peak = n;
  }
  const expectedOrders = Math.round(total);
  const expectedPeakHourOrders = Math.round(peak);
  const people = new Set(input.shifts.map((s) => s.staffId)).size;

  const referencePeople =
    expectedOrders === 0
      ? 0
      : expectedPeakHourOrders >= PLANNING_COVERAGE_PEAK_THRESHOLD
        ? PLANNING_COVERAGE_PEOPLE_BUSY
        : PLANNING_COVERAGE_PEOPLE_CALM;

  const verdict = verdictOf(expectedOrders, people, referencePeople);
  return {
    date: input.date,
    weekday: input.weekday,
    label: input.label,
    service: input.service,
    window,
    peoplePlanned: people,
    expectedOrders,
    expectedPeakHourOrders,
    referencePeople,
    verdict,
    message: messageFor({
      label: input.label,
      service: input.service,
      people,
      expectedOrders,
      expectedPeakHourOrders,
      referencePeople,
      verdict,
    }),
  };
}

/**
 * Heures RÉELLEMENT couvertes par au moins une personne. Quand personne n'est
 * prévu, on retombe sur la plage de référence du service : sans elle on ne
 * pourrait pas dire « samedi soir, personne pour ≈ 68 commandes attendues »,
 * qui est précisément le constat le plus utile.
 */
function coveredHours(
  shifts: PlannedShiftRow[],
  service: PlanningService,
): { hours: number[]; window: { start: string; end: string } | null } {
  if (shifts.length === 0) {
    const { fromHour, toHour } = PLANNING_SERVICE_DEFAULT_HOURS[service];
    return { hours: rangeOf(fromHour, toHour), window: null };
  }

  const hours = new Set<number>();
  let earliest = Number.POSITIVE_INFINITY;
  let latest = Number.NEGATIVE_INFINITY;
  for (const s of shifts) {
    const from = hmToMinutes(s.start);
    const to = from + shiftMinutes(s.start, s.end);
    earliest = Math.min(earliest, from);
    latest = Math.max(latest, to);
    // Une heure est couverte dès que le service en occupe une partie : quelqu'un
    // qui part à 14 h 15 tient bien le début de l'heure de 14 h.
    for (let h = Math.floor(from / 60); h <= Math.floor((to - 1) / 60); h++) {
      const normalized = h % 24;
      if (normalized >= FIRST_HOUR && normalized <= LAST_HOUR) hours.add(normalized);
    }
  }
  return {
    hours: [...hours].sort((a, b) => a - b),
    window: { start: formatMinutes(earliest), end: formatMinutes(latest) },
  };
}

const rangeOf = (from: number, to: number) =>
  Array.from({ length: Math.max(0, to - from + 1) }, (_, i) => from + i);

const formatMinutes = (minutes: number) => {
  const normalized = ((Math.round(minutes) % 1440) + 1440) % 1440;
  return `${String(Math.floor(normalized / 60)).padStart(2, '0')}:${String(normalized % 60).padStart(2, '0')}`;
};

function verdictOf(
  expectedOrders: number,
  people: number,
  referencePeople: number,
): PlanningCoverageVerdict {
  if (expectedOrders === 0) return 'sans-volume';
  if (people === 0) return 'sans-service';
  if (people < referencePeople) return 'sous-effectif';
  if (people > referencePeople) return 'sur-effectif';
  return 'equilibre';
}

interface MessageInput {
  label: string;
  service: PlanningService;
  people: number;
  expectedOrders: number;
  expectedPeakHourOrders: number;
  referencePeople: number;
  verdict: PlanningCoverageVerdict;
}

/**
 * Le constat est FORMULÉ, jamais décidé : on met côte à côte l'effectif posé
 * et le volume attendu, et on rappelle d'où vient le repère. Aucune phrase ne
 * dit au gérant ce qu'il doit faire — il connaît ses contrats, ses extras et
 * sa carte, pas nous.
 */
function messageFor(input: MessageInput): string {
  const moment = `${input.label} ${PLANNING_SERVICE_LABELS[input.service].toLowerCase()}`;
  const volume = `≈ ${input.expectedOrders} commande${input.expectedOrders > 1 ? 's' : ''} attendue${input.expectedOrders > 1 ? 's' : ''}`;
  const effectif = `${input.people} personne${input.people > 1 ? 's' : ''} prévue${input.people > 1 ? 's' : ''}`;
  const repere = `repère du tableau de bord : ${input.referencePeople} personnes (${input.expectedPeakHourOrders} commandes sur l'heure de pointe)`;

  switch (input.verdict) {
    case 'sans-volume':
      return `${moment} : aucun volume attendu sur ce créneau d'après vos 30 derniers jours.`;
    case 'sans-service':
      return `${moment} : aucun service prévu pour un volume attendu de ${input.expectedOrders} commandes.`;
    case 'sous-effectif':
      return `${moment} : ${effectif} pour ${volume} — ${repere}.`;
    case 'sur-effectif':
      return `${moment} : ${effectif} pour ${volume} — ${repere}.`;
    default:
      return `${moment} : ${effectif} pour ${volume}, dans le repère du tableau de bord.`;
  }
}
