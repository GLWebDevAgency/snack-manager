import {
  PAYROLL_HIDDEN_MESSAGE,
  PLANNING_REMINDERS_DISCLAIMER,
  PLANNING_REMINDER_THRESHOLDS,
  PLANNING_SERVICE_SPLIT_HOUR,
  PLANNING_SERVICES,
  type PlannedShiftCreate,
  type PlanningDay,
  type PlanningPayrollAccess,
  type PlanningPosition,
  type PlanningReminder,
  type PlanningService,
  type PlanningServiceBlock,
  type PlanningShiftView,
  type PlanningStaffTotal,
  type PlanningStatus,
  type PlanningWeek,
} from '@sm/contracts';
import { tenancy } from '@sm/domain';
import {
  addDays,
  compareDays,
  formatDay,
  isoWeekday,
  parseDay,
  type CalendarDay,
} from '../ordering/paris-time';

/**
 * Tout le calcul du planning, SANS base ni HTTP : c'est ici que se décide le
 * chiffre que le gérant regarde avant de valider sa semaine, donc c'est ici
 * que les tests doivent pouvoir taper directement.
 */

/** Un service prévu, tel qu'il sort de Mongo, réduit à ce dont le calcul a besoin. */
export interface PlannedShiftRow {
  id: string;
  staffId: string;
  date: string;
  start: string;
  end: string;
  position: PlanningPosition;
  note: string;
  status: PlanningStatus;
}

export interface StaffRow {
  id: string;
  name: string;
  role: string;
  /** `null` = coût horaire non renseigné, à ne JAMAIS confondre avec 0. */
  hourlyCostCents: number | null;
}

const MINUTES_PER_DAY = 1440;
const DAY_MS = 86_400_000;

const pad2 = (n: number) => String(n).padStart(2, '0');

/** « 18:30 » → 1110 minutes. Le format est déjà validé par zod en amont. */
export function hmToMinutes(hm: string): number {
  const [h, m] = hm.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

/**
 * Durée d'un service prévu, en minutes.
 *
 * Une fin INFÉRIEURE au début n'est pas une faute de saisie : un snack qui
 * ferme à 00:30 pose bien « 18:00 → 00:30 ». On ajoute donc 24 h. Le cas
 * `start === end` est refusé à la validation (zod) : sans ce refus, il vaudrait
 * ici 24 h et une journée entière de masse salariale apparaîtrait sur un
 * simple doublon de saisie.
 */
export function shiftMinutes(start: string, end: string): number {
  const from = hmToMinutes(start);
  const to = hmToMinutes(end);
  return to > from ? to - from : to + MINUTES_PER_DAY - from;
}

/** Heures décimales, 2 décimales : 7,5 = 7 h 30. */
export const minutesToHours = (minutes: number) => Math.round((minutes / 60) * 100) / 100;

/** « 11 h 30 », « 9 h » — la façon dont un patron lit une durée. */
export function formatDuration(minutes: number): string {
  const rounded = Math.round(minutes);
  const h = Math.floor(rounded / 60);
  const m = rounded % 60;
  return m === 0 ? `${h} h` : `${h} h ${pad2(m)}`;
}

/**
 * Coût projeté d'une durée. `null` quand le coût horaire est inconnu : compter
 * un salarié non tarifé comme gratuit donnerait une masse salariale fausse,
 * et un chiffre faux est pire que pas de chiffre — c'est sur celui-là que le
 * gérant décide.
 */
export function costCentsFor(minutes: number, hourlyCostCents: number | null): number | null {
  if (hourlyCostCents == null) return null;
  return Math.round((minutes * hourlyCostCents) / 60);
}

/** Midi ou soir, d'après l'heure de DÉBUT (cf. `PLANNING_SERVICE_SPLIT_HOUR`). */
export function serviceOf(start: string): PlanningService {
  return hmToMinutes(start) < PLANNING_SERVICE_SPLIT_HOUR * 60 ? 'midi' : 'soir';
}

/**
 * Deux services d'une même personne se chevauchent-ils ? Personne ne tient la
 * caisse et la cuisine en même temps : c'est une erreur de saisie, refusée à
 * l'écriture. Les services de nuit sont projetés sur une ligne du temps
 * absolue pour que « 22:00 → 02:00 » et le lendemain « 01:00 → 07:00 » soient
 * bien vus comme superposés.
 */
export function shiftsOverlap(a: PlannedShiftRow, b: PlannedShiftRow): boolean {
  const spanOf = (s: PlannedShiftRow) => {
    const day = parseDay(s.date);
    const base = day ? Date.UTC(day.y, day.m - 1, day.d) / 60_000 : 0;
    const from = base + hmToMinutes(s.start);
    return { from, to: from + shiftMinutes(s.start, s.end) };
  };
  const x = spanOf(a);
  const y = spanOf(b);
  return x.from < y.to && y.from < x.to;
}

// ─── Accumulateur de coût ───

/**
 * Un total de masse salariale doit pouvoir dire « je ne sais pas » : tant
 * qu'aucun service agrégé n'a de coût connu, le total vaut `null` (l'écran
 * affiche « — »), pas 0 (l'écran affiche « 0,00 € », et le gérant croit son
 * équipe gratuite).
 */
class CostSum {
  private cents = 0;
  private known = false;

  add(value: number | null): void {
    if (value == null) return;
    this.cents += value;
    this.known = true;
  }

  merge(other: CostSum): void {
    if (!other.known) return;
    this.cents += other.cents;
    this.known = true;
  }

  get value(): number | null {
    return this.known ? this.cents : null;
  }
}

// ─── Assemblage de la semaine ───

export interface WeekInput {
  /** Lundi de la semaine. */
  weekStart: CalendarDay;
  shifts: PlannedShiftRow[];
  staff: StaffRow[];
  /** Faux → tous les montants de la réponse sortent à `null`. */
  payrollVisible: boolean;
  reminders: PlanningReminder[];
}

export function buildWeek(input: WeekInput): PlanningWeek {
  const { weekStart, staff, payrollVisible } = input;
  const staffById = new Map(staff.map((s) => [s.id, s]));
  const weekEnd = addDays(weekStart, 6);

  const views: PlanningShiftView[] = input.shifts
    .map((s) => toView(s, staffById.get(s.staffId), payrollVisible))
    .sort((a, b) => a.date.localeCompare(b.date) || a.start.localeCompare(b.start));

  const byDate = new Map<string, PlanningShiftView[]>();
  for (const v of views) {
    const bucket = byDate.get(v.date);
    if (bucket) bucket.push(v);
    else byDate.set(v.date, [v]);
  }

  const weekCost = new CostSum();
  const days: PlanningDay[] = [];
  for (let i = 0; i < 7; i++) {
    const day = addDays(weekStart, i);
    const date = formatDay(day);
    const dayShifts = byDate.get(date) ?? [];
    const dayCost = new CostSum();

    const services: PlanningServiceBlock[] = PLANNING_SERVICES.map((service) => {
      const blockShifts = dayShifts.filter((s) => s.service === service);
      const blockCost = new CostSum();
      let minutes = 0;
      for (const s of blockShifts) {
        blockCost.add(s.costCents);
        minutes += s.minutes;
      }
      dayCost.merge(blockCost);
      return {
        service,
        shifts: blockShifts,
        people: new Set(blockShifts.map((s) => s.staffId)).size,
        hours: minutesToHours(minutes),
        costCents: blockCost.value,
      };
    });

    weekCost.merge(dayCost);
    const weekday = isoWeekday(day);
    days.push({
      date,
      weekday,
      label: tenancy.isWeekday(weekday) ? tenancy.WEEKDAY_LABELS[weekday] : '',
      services,
      people: new Set(dayShifts.map((s) => s.staffId)).size,
      hours: minutesToHours(dayShifts.reduce((sum, s) => sum + s.minutes, 0)),
      costCents: dayCost.value,
    });
  }

  return {
    week: formatDay(weekStart),
    weekEnd: formatDay(weekEnd),
    days,
    totals: {
      shifts: views.length,
      people: new Set(views.map((s) => s.staffId)).size,
      hours: minutesToHours(views.reduce((sum, s) => sum + s.minutes, 0)),
      costCents: weekCost.value,
    },
    perStaff: perStaffTotals(views, staff, payrollVisible),
    counts: {
      brouillon: views.filter((s) => s.status === 'brouillon').length,
      publie: views.filter((s) => s.status === 'publie').length,
    },
    payroll: payrollAccess(views, staffById, payrollVisible),
    reminders: input.reminders,
    // La réserve voyage AVEC les rappels : un écran qui les afficherait sans
    // elle laisserait croire à une validation de conformité.
    remindersDisclaimer: PLANNING_REMINDERS_DISCLAIMER,
  };
}

function toView(
  row: PlannedShiftRow,
  member: StaffRow | undefined,
  payrollVisible: boolean,
): PlanningShiftView {
  const minutes = shiftMinutes(row.start, row.end);
  return {
    id: row.id,
    staffId: row.staffId,
    // Un membre supprimé de l'équipe laisse ses services derrière lui : mieux
    // vaut un intitulé explicite qu'une ligne vide au milieu du planning.
    staffName: member?.name ?? 'Membre supprimé',
    date: row.date,
    start: row.start,
    end: row.end,
    position: row.position,
    service: serviceOf(row.start),
    note: row.note,
    status: row.status,
    minutes,
    hours: minutesToHours(minutes),
    costCents: payrollVisible ? costCentsFor(minutes, member?.hourlyCostCents ?? null) : null,
  };
}

function perStaffTotals(
  views: PlanningShiftView[],
  staff: StaffRow[],
  payrollVisible: boolean,
): PlanningStaffTotal[] {
  const rows: PlanningStaffTotal[] = [];
  for (const member of staff) {
    const mine = views.filter((v) => v.staffId === member.id);
    if (mine.length === 0) continue;
    const cost = new CostSum();
    for (const v of mine) cost.add(v.costCents);
    rows.push({
      staffId: member.id,
      staffName: member.name,
      role: member.role,
      hourlyCostCents: payrollVisible ? member.hourlyCostCents : null,
      shifts: mine.length,
      hours: minutesToHours(mine.reduce((sum, v) => sum + v.minutes, 0)),
      costCents: cost.value,
    });
  }
  return rows.sort((a, b) => b.hours - a.hours || a.staffName.localeCompare(b.staffName, 'fr'));
}

/**
 * Ce que la réponse dit d'elle-même sur les montants : masqués, complets, ou
 * partiels. Un total partiel affiché comme un total complet ferait sous-estimer
 * la masse salariale — donc on nomme les salariés qui manquent.
 */
function payrollAccess(
  views: PlanningShiftView[],
  staffById: Map<string, StaffRow>,
  payrollVisible: boolean,
): PlanningPayrollAccess {
  if (!payrollVisible) {
    return { visible: false, missingCost: [], message: PAYROLL_HIDDEN_MESSAGE };
  }
  const missing = new Map<string, string>();
  for (const v of views) {
    const member = staffById.get(v.staffId);
    if (member && member.hourlyCostCents == null) missing.set(member.id, member.name);
  }
  const missingCost = [...missing].map(([staffId, staffName]) => ({ staffId, staffName }));
  return {
    visible: true,
    missingCost,
    message:
      missingCost.length === 0
        ? 'Projection complète : tous les salariés planifiés ont un coût horaire.'
        : `Projection partielle — coût horaire manquant pour ${missingCost
            .map((m) => m.staffName)
            .join(', ')}.`,
  };
}

// ─── Rappels de durée du travail ───

const dayFmt = new Intl.DateTimeFormat('fr-FR', {
  timeZone: 'Europe/Paris',
  weekday: 'long',
  day: 'numeric',
  month: 'long',
});

/** « samedi 23 août » — construit à midi UTC, jamais de bascule de jour à Paris. */
function frenchDay(date: string): string {
  const day = parseDay(date);
  if (!day) return date;
  return dayFmt.format(new Date(Date.UTC(day.y, day.m - 1, day.d, 12)));
}

/** Position absolue en minutes depuis l'époque — comparable d'un jour à l'autre. */
function absoluteStart(row: PlannedShiftRow): number {
  const day = parseDay(row.date);
  const base = day ? Date.UTC(day.y, day.m - 1, day.d) / 60_000 : 0;
  return base + hmToMinutes(row.start);
}

export interface RemindersInput {
  shifts: PlannedShiftRow[];
  staff: StaffRow[];
  /** Bornes de la semaine affichée : un rappel hors écran n'aide personne. */
  weekStart: CalendarDay;
  weekEnd: CalendarDay;
}

/**
 * RAPPELS, PAS CONTRÔLE DE CONFORMITÉ.
 *
 * On signale trois durées qui interpellent — une journée qui dépasse dix
 * heures, moins de onze heures de repos entre deux journées, sept jours
 * d'affilée. On ne dit JAMAIS que le planning est conforme, ni qu'il ne l'est
 * pas : la durée du travail dépend de la convention collective, des accords
 * d'entreprise et du contrat de chaque salarié, dont nous ne savons rien. Le
 * message rendu à l'écran porte cette réserve
 * (`PLANNING_REMINDERS_DISCLAIMER`) ; promettre la conformité exposerait nos
 * clients.
 *
 * LA COUPURE N'EST PAS UN REPOS COURT. Un snack tourne à deux services séparés
 * par le creux de l'après-midi : entre le service du midi et celui du soir, il
 * s'écoule trois heures, tous les jours, pour tout le monde. Une première
 * version comparait deux services consécutifs sans regarder leur date et
 * signalait donc cette coupure quotidienne — quatorze rappels sur une semaine
 * ordinaire, dont aucun n'apprenait quoi que ce soit au gérant. Le repos se
 * mesure entre la FIN DE JOURNÉE et la REPRISE DU LENDEMAIN, jamais à
 * l'intérieur d'une même journée.
 */
export function buildReminders(input: RemindersInput): PlanningReminder[] {
  const { longDayHours, shortRestHours, consecutiveDays } = PLANNING_REMINDER_THRESHOLDS;
  const inWeek = (date: string) => {
    const day = parseDay(date);
    return !!day && compareDays(day, input.weekStart) >= 0 && compareDays(day, input.weekEnd) <= 0;
  };

  const reminders: PlanningReminder[] = [];
  for (const member of input.staff) {
    const mine = input.shifts
      .filter((s) => s.staffId === member.id)
      .sort((a, b) => absoluteStart(a) - absoluteStart(b));
    if (mine.length === 0) continue;

    // 1. Journée cumulée trop longue — cumul, pas service isolé : deux
    //    services de six heures dans la même journée en font douze.
    const minutesByDate = new Map<string, number>();
    for (const s of mine) {
      minutesByDate.set(s.date, (minutesByDate.get(s.date) ?? 0) + shiftMinutes(s.start, s.end));
    }
    for (const [date, minutes] of minutesByDate) {
      if (minutes > longDayHours * 60 && inWeek(date)) {
        reminders.push({
          kind: 'journee-longue',
          staffId: member.id,
          staffName: member.name,
          date,
          message: `${member.name} — ${frenchDay(date)} : ${formatDuration(minutes)} prévues, au-delà de ${longDayHours} h sur la journée.`,
        });
      }
    }

    // 2. Repos entre la FIN d'une journée et la REPRISE de la suivante. La
    //    coupure de l'après-midi est délibérément ignorée : c'est le rythme
    //    normal d'un snack, pas un signal. Retenu si l'une des deux journées
    //    est à l'écran, pour qu'une reprise serrée du dimanche soir au lundi
    //    matin se voie depuis la semaine qu'on est en train de poser.
    const journees = [...dayBoundsOf(mine)].sort((a, b) => a.from - b.from);
    for (let i = 1; i < journees.length; i++) {
      const veille = journees[i - 1];
      const lendemain = journees[i];
      if (!veille || !lendemain) continue;
      const rest = lendemain.from - veille.to;
      if (rest < 0 || rest >= shortRestHours * 60) continue;
      if (!inWeek(lendemain.date) && !inWeek(veille.date)) continue;
      reminders.push({
        kind: 'repos-court',
        staffId: member.id,
        staffName: member.name,
        date: lendemain.date,
        message: `${member.name} — ${formatDuration(rest)} de repos entre la fin du ${frenchDay(veille.date)} et la reprise du ${frenchDay(lendemain.date)}, en dessous de ${shortRestHours} h.`,
      });
    }

    // 3. Jours travaillés d'affilée. La série est cherchée sur une fenêtre
    //    élargie aux semaines voisines : sept jours à cheval sur deux semaines
    //    restent sept jours.
    for (const run of consecutiveRuns([...minutesByDate.keys()])) {
      if (run.length < consecutiveDays) continue;
      const first = run[0];
      const last = run[run.length - 1];
      if (!first || !last) continue;
      if (!run.some(inWeek)) continue;
      reminders.push({
        kind: 'jours-consecutifs',
        staffId: member.id,
        staffName: member.name,
        date: last,
        message: `${member.name} — ${run.length} jours travaillés d'affilée, du ${frenchDay(first)} au ${frenchDay(last)}.`,
      });
    }
  }

  return reminders.sort((a, b) => a.date.localeCompare(b.date) || a.staffName.localeCompare(b.staffName, 'fr'));
}

/**
 * Bornes de chaque JOURNÉE de travail : première prise de poste et dernière
 * fin, en minutes absolues. Un service du soir qui ferme à 00:30 pousse la
 * borne de fin sur le lendemain — c'est bien ce qu'il faut pour mesurer le
 * repos avant la reprise.
 */
function dayBoundsOf(shifts: PlannedShiftRow[]): { date: string; from: number; to: number }[] {
  const bounds = new Map<string, { date: string; from: number; to: number }>();
  for (const s of shifts) {
    const from = absoluteStart(s);
    const to = from + shiftMinutes(s.start, s.end);
    const known = bounds.get(s.date);
    if (known) {
      known.from = Math.min(known.from, from);
      known.to = Math.max(known.to, to);
    } else {
      bounds.set(s.date, { date: s.date, from, to });
    }
  }
  return [...bounds.values()];
}

/** Découpe une liste de jours en séries de dates calendaires contiguës. */
function consecutiveRuns(dates: string[]): string[][] {
  const sorted = [...new Set(dates)].sort();
  const runs: string[][] = [];
  let current: string[] = [];
  let previousMs: number | null = null;
  for (const date of sorted) {
    const day = parseDay(date);
    if (!day) continue;
    const ms = Date.UTC(day.y, day.m - 1, day.d);
    if (previousMs != null && ms - previousMs === DAY_MS) current.push(date);
    else {
      if (current.length > 0) runs.push(current);
      current = [date];
    }
    previousMs = ms;
  }
  if (current.length > 0) runs.push(current);
  return runs;
}

/** Normalise l'entrée d'écriture vers la forme calculée (tests et service). */
export function rowOf(id: string, dto: PlannedShiftCreate): PlannedShiftRow {
  return {
    id,
    staffId: dto.staffId,
    date: dto.date,
    start: dto.start,
    end: dto.end,
    position: dto.position,
    note: dto.note,
    status: dto.status,
  };
}
