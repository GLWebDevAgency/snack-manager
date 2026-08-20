import {
  PLANNING_COMPARISON_NOTE,
  type PlanningComparison,
  type PlanningComparisonRow,
} from '@sm/contracts';
import { addDays, formatDay, type CalendarDay } from '../ordering/paris-time';
import {
  costCentsFor,
  minutesToHours,
  shiftMinutes,
  type PlannedShiftRow,
  type StaffRow,
} from './planning.compute';

/**
 * CONFRONTATION PRÉVU / POINTÉ — l'endroit où fuit l'argent.
 *
 * Le gérant décide un planning, son équipe badge autre chose, et il découvre
 * l'écart à la fin du mois sur son bulletin de paie. Ce calcul le lui met sous
 * les yeux, en heures ET en euros, par personne.
 *
 * DEUX CHOIX ASSUMÉS, tous deux visibles dans la réponse :
 *
 *  - Seuls les services PUBLIÉS entrent dans le prévu. Un brouillon n'a engagé
 *    personne : l'équipe ne l'a jamais vu. Les heures écartées sont quand même
 *    remontées (`draftHoursIgnored`) pour que rien ne disparaisse en silence.
 *
 *  - Les heures pointées reprennent l'arrondi à la demi-heure PAR POINTAGE de
 *    l'écran « Équipe & pointage ». Comparer deux règles d'arrondi différentes
 *    ferait apparaître des écarts qui n'existent que dans nos calculs ; le
 *    gérant doit retrouver, à la minute près, le total qu'il lit sur l'autre
 *    écran.
 */

/** Arrondi à la demi-heure — règle identique à celle du module staff (spec §12.2). */
const roundHalfHours = (ms: number) => Math.round((ms / 3_600_000) * 2) / 2;

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Un pointage réel, réduit à ce que la comparaison consomme. */
export interface ClockedShiftRow {
  staffId: string;
  clockIn: Date;
  clockOut: Date | null;
}

export interface CompareInput {
  weekStart: CalendarDay;
  /** Tous les services de la semaine, brouillons compris — le tri se fait ici. */
  planned: PlannedShiftRow[];
  clocked: ClockedShiftRow[];
  staff: StaffRow[];
  /** Instant courant : sert à dire si la semaine est encore en cours. */
  now: Date;
  /** Fin de semaine (dimanche 24 h) en instant, pour situer `now`. */
  weekEndsAt: Date;
}

export function buildComparison(input: CompareInput): PlanningComparison {
  const published = input.planned.filter((s) => s.status === 'publie');
  const draftMinutes = input.planned
    .filter((s) => s.status === 'brouillon')
    .reduce((sum, s) => sum + shiftMinutes(s.start, s.end), 0);

  // Un membre supprimé de l'équipe garde ses pointages : sans cette union, ses
  // heures disparaîtraient du total et l'écart serait faux.
  const staffIds = new Set<string>([
    ...published.map((s) => s.staffId),
    ...input.clocked.map((s) => s.staffId),
  ]);
  const staffById = new Map(input.staff.map((s) => [s.id, s]));

  const rows: PlanningComparisonRow[] = [];
  for (const staffId of staffIds) {
    const member = staffById.get(staffId);
    const hourly = member?.hourlyCostCents ?? null;

    const plannedMinutes = published
      .filter((s) => s.staffId === staffId)
      .reduce((sum, s) => sum + shiftMinutes(s.start, s.end), 0);

    const mine = input.clocked.filter((s) => s.staffId === staffId);
    let actualHours = 0;
    let openShifts = 0;
    for (const shift of mine) {
      if (!shift.clockOut) {
        openShifts++;
        continue;
      }
      actualHours += roundHalfHours(shift.clockOut.getTime() - shift.clockIn.getTime());
    }

    const plannedHours = minutesToHours(plannedMinutes);
    const plannedCostCents = costCentsFor(plannedMinutes, hourly);
    const actualCostCents = costCentsFor(actualHours * 60, hourly);
    rows.push({
      staffId,
      staffName: member?.name ?? 'Membre supprimé',
      plannedHours,
      actualHours: round2(actualHours),
      deltaHours: round2(actualHours - plannedHours),
      plannedCostCents,
      actualCostCents,
      deltaCostCents:
        plannedCostCents == null || actualCostCents == null
          ? null
          : actualCostCents - plannedCostCents,
      openShifts,
    });
  }

  rows.sort(
    (a, b) => Math.abs(b.deltaHours) - Math.abs(a.deltaHours) || a.staffName.localeCompare(b.staffName, 'fr'),
  );

  return {
    week: formatDay(input.weekStart),
    weekEnd: formatDay(addDays(input.weekStart, 6)),
    weekInProgress: input.now < input.weekEndsAt,
    rows,
    totals: totalsOf(rows),
    draftHoursIgnored: minutesToHours(draftMinutes),
    note: PLANNING_COMPARISON_NOTE,
  };
}

/**
 * Les totaux en euros restent `null` tant qu'AUCUNE ligne n'a de coût connu :
 * additionner des `null` comme des zéros afficherait « 0 € d'écart » sur une
 * équipe entièrement non tarifée, ce qui est le contraire de l'information.
 */
function totalsOf(rows: PlanningComparisonRow[]): PlanningComparison['totals'] {
  const sum = (pick: (r: PlanningComparisonRow) => number | null): number | null => {
    let total = 0;
    let known = false;
    for (const row of rows) {
      const value = pick(row);
      if (value == null) continue;
      total += value;
      known = true;
    }
    return known ? total : null;
  };

  const plannedHours = round2(rows.reduce((n, r) => n + r.plannedHours, 0));
  const actualHours = round2(rows.reduce((n, r) => n + r.actualHours, 0));
  return {
    plannedHours,
    actualHours,
    deltaHours: round2(actualHours - plannedHours),
    plannedCostCents: sum((r) => r.plannedCostCents),
    actualCostCents: sum((r) => r.actualCostCents),
    deltaCostCents: sum((r) => r.deltaCostCents),
    openShifts: rows.reduce((n, r) => n + r.openShifts, 0),
  };
}
