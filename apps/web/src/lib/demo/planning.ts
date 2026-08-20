"use client";

/**
 * LE PLANNING DE DÉMONSTRATION.
 *
 * L'écran « Planning » est arrivé après le reste du back-office ; il vit à
 * part parce qu'il ne se PHOTOGRAPHIE pas. Toutes ses réponses sont ancrées
 * sur une semaine — dates, jours de semaine, plages de service, confrontation
 * prévu/pointé — et une charge utile figée afficherait donc la semaine du jour
 * de la capture, quel que soit le lundi que le visiteur demande. On engendre
 * la semaine demandée à partir de l'établissement de `state.ts` : la même
 * équipe, les mêmes horaires d'ouverture, la même carte de chaleur.
 *
 * TOUT EST ANNOTÉ AVEC LES TYPES DE `@sm/contracts`. C'est délibéré : ces
 * formes appartiennent à une autre surface que celle-ci, et la seule garantie
 * durable qu'elles ne divergent pas est que le compilateur refuse de passer.
 * Une divergence non détectée ne se verrait qu'à l'écran, sous la forme d'une
 * grille vide devant un restaurateur.
 *
 * Ce qui est REPRIS de l'API plutôt que réinventé : les libellés fixes, les
 * seuils et le repère d'effectif viennent des constantes partagées — deux
 * écrans qui donnent deux conseils différents sur le même créneau sont pires
 * que pas de conseil du tout.
 */

import {
  PLANNING_COMPARISON_NOTE,
  PLANNING_COVERAGE_DISCLAIMER,
  PLANNING_COVERAGE_PEAK_THRESHOLD,
  PLANNING_COVERAGE_PEOPLE_BUSY,
  PLANNING_COVERAGE_PEOPLE_CALM,
  PLANNING_REMINDERS_DISCLAIMER,
  PLANNING_REMINDER_THRESHOLDS,
  PLANNING_SERVICES,
  PLANNING_SERVICE_DEFAULT_HOURS,
  PLANNING_SERVICE_SPLIT_HOUR,
  type PlanningComparison,
  type PlanningComparisonRow,
  type PlanningCoverage,
  type PlanningCoverageBlock,
  type PlanningCoverageVerdict,
  type PlanningDay,
  type PlanningPosition,
  type PlanningReminder,
  type PlanningService,
  type PlanningServiceBlock,
  type PlanningShiftView,
  type PlanningStaffTotal,
  type PlanningStatus,
  type PlanningWeek,
} from "@sm/contracts";
import { HEATMAP, isoDay, type DemoWorld } from "./state";

const DAY_MS = 86_400_000;

const WEEKDAY_LABELS = [
  "Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi", "Dimanche",
];

/** `AAAA-MM-JJ` en heure LOCALE — `toISOString()` reculerait d'un jour le soir. */
export const ymd = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** Lundi 00:00 de la semaine contenant `d`. */
function mondayOf(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
  return x;
}

/** Lundi de la semaine demandée, celle du visiteur à défaut. */
export function weekAnchor(world: DemoWorld, week: string | null): Date {
  if (week && /^\d{4}-\d{2}-\d{2}$/.test(week)) {
    const [y, m, d] = week.split("-").map(Number) as [number, number, number];
    return mondayOf(new Date(y, m - 1, d));
  }
  return mondayOf(new Date(world.bootAt));
}

const hhmm = (minutes: number): string =>
  `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
const toMin = (v: string): number => {
  const [h = "0", m = "0"] = v.split(":");
  return Number(h) * 60 + Number(m);
};

/** Coût horaire employeur, par rôle — les mêmes ordres de grandeur que l'API. */
const HOURLY_COST_CENTS: Record<string, number> = {
  gerant: 2200,
  cuisine: 1650,
  caisse: 1450,
};

/** Poste par défaut d'un rôle : un gérant tient la caisse, pas la friteuse. */
const POSITION_OF: Record<string, PlanningPosition> = {
  gerant: "polyvalent",
  cuisine: "cuisine",
  caisse: "caisse",
};

/** Roulement hebdomadaire — mêmes jours que les pointages, pour que la
 *  confrontation prévu/pointé ait un sens plutôt que d'aligner deux hasards. */
const ROSTER: number[][] = [
  [1, 2, 3, 4, 5, 6],
  [2, 3, 4, 5, 6, 7],
  [1, 2, 3, 5, 6, 7],
  [1, 4, 5, 6, 7],
  [2, 3, 4, 6, 7],
  [1, 3, 4, 5, 6],
];

/**
 * Services PRÉVUS de la semaine, engendrés depuis les horaires réels.
 *
 * Ils sont conservés dans le monde dès le premier appel : le visiteur qui pose
 * un service, en déplace un autre puis revient sur la semaine doit retrouver
 * ses modifications. Une regénération à chaque lecture les effacerait, et
 * l'écran donnerait l'impression de ne rien enregistrer.
 */
export function shiftsOfWeek(world: DemoWorld, monday: Date): PlanningShiftView[] {
  const key = ymd(monday);
  const cached = world.planning[key];
  if (cached) return cached;

  const rows: PlanningShiftView[] = [];
  let n = 0;
  for (let k = 0; k < 7; k++) {
    const date = new Date(monday.getTime() + k * DAY_MS);
    const day = isoDay(date);
    const hours = world.tenant.hours.find((h) => h.day === day);
    if (!hours) continue;

    // Qui est disponible ce jour-là, d'après le roulement.
    const available = world.staff.filter(
      (m, i) => m.active && (ROSTER[i % ROSTER.length] ?? []).includes(day),
    );

    for (const [si, slot] of [hours.lunch, hours.dinner].entries()) {
      if (!slot) continue;
      const service: PlanningService = si === 0 ? "midi" : "soir";

      // ── Combien de personnes ? ──
      //
      // Poser toute l'équipe sur chaque service donnerait douze services par
      // jour et un écran qui répond « sur-effectif » à TOUS les créneaux : un
      // conseil qui ne varie jamais n'est plus un conseil. On dimensionne donc
      // sur le repère du tableau de bord — sauf le vendredi soir, laissé
      // volontairement à une personne de moins. C'est le seul moyen de montrer
      // ce que cet écran sert à voir : le trou dans le planning qu'on n'aurait
      // pas repéré à l'œil.
      const target = Math.max(1, referencePeopleFor(day, service) - (day === 5 && service === "soir" ? 1 : 0));
      // Rotation par jour et par service : ce n'est pas la même paire tous les
      // midis, ce qui donnerait un planning en rayures.
      const start0 = (k * 2 + si) % Math.max(1, available.length);
      const team = Array.from({ length: Math.min(target, available.length) }, (_, j) =>
        available[(start0 + j) % available.length]!,
      );

      // Une équipe arrive une demi-heure avant l'ouverture et part une
      // demi-heure après la fermeture : c'est la mise en place et la
      // fermeture, et les omettre sous-estimerait toutes les heures.
      const start = Math.max(0, toMin(slot.open) - 30);
      const end = Math.min(23 * 60 + 59, toMin(slot.close) + 30);
      const minutes = end - start;

      for (const member of team) {
        const cost = HOURLY_COST_CENTS[member.role] ?? null;
        rows.push({
          id: `pl${++n}-${key}`,
          staffId: member._id,
          staffName: member.name,
          date: ymd(date),
          start: hhmm(start),
          end: hhmm(end),
          position: POSITION_OF[member.role] ?? "polyvalent",
          service,
          note: "",
          // La semaine à venir garde des brouillons : sans eux, le bouton
          // « Publier » n'aurait rien à publier et l'écran perdrait son geste
          // principal.
          status: date.getTime() > world.bootAt ? "brouillon" : "publie",
          minutes,
          hours: Math.round((minutes / 60) * 100) / 100,
          costCents: cost === null ? null : Math.round((minutes / 60) * cost),
        });
      }
    }
  }
  world.planning[key] = rows;
  return rows;
}

/** Repère d'effectif du tableau de bord pour un créneau, d'après l'affluence. */
function referencePeopleFor(day: number, service: PlanningService): number {
  const span = PLANNING_SERVICE_DEFAULT_HOURS[service];
  let peak = 0;
  for (const [hour, orders] of heat.get(day) ?? []) {
    if (hour < span.fromHour || hour > span.toHour) continue;
    peak = Math.max(peak, Math.round(orders / 4));
  }
  return peak > PLANNING_COVERAGE_PEAK_THRESHOLD
    ? PLANNING_COVERAGE_PEOPLE_BUSY
    : PLANNING_COVERAGE_PEOPLE_CALM;
}

// ─────────────────────────────────────────────────────────────
// GET /planning/week
// ─────────────────────────────────────────────────────────────

export function planningWeek(world: DemoWorld, week: string | null): PlanningWeek {
  const monday = weekAnchor(world, week);
  const shifts = shiftsOfWeek(world, monday);

  const days: PlanningDay[] = [];
  for (let k = 0; k < 7; k++) {
    const date = new Date(monday.getTime() + k * DAY_MS);
    const iso = ymd(date);
    const ofDay = shifts.filter((s) => s.date === iso);
    // Toujours les deux services, même vides : l'écran pose un service en
    // cliquant dans une case, et une case absente ne se clique pas.
    const services: PlanningServiceBlock[] = PLANNING_SERVICES.map((service) =>
      blockOf(service, ofDay.filter((s) => s.service === service)),
    );
    days.push({
      date: iso,
      weekday: isoDay(date),
      label: WEEKDAY_LABELS[isoDay(date) - 1] ?? "?",
      services,
      people: new Set(ofDay.map((s) => s.staffId)).size,
      hours: round2(ofDay.reduce((sum, s) => sum + s.hours, 0)),
      costCents: sumCost(ofDay),
    });
  }

  const perStaff: PlanningStaffTotal[] = world.staff
    .filter((m) => m.active)
    .map((m) => {
      const mine = shifts.filter((s) => s.staffId === m._id);
      return {
        staffId: m._id,
        staffName: m.name,
        role: m.role,
        hourlyCostCents: HOURLY_COST_CENTS[m.role] ?? null,
        shifts: mine.length,
        hours: round2(mine.reduce((sum, s) => sum + s.hours, 0)),
        costCents: sumCost(mine),
      };
    });

  return {
    week: ymd(monday),
    weekEnd: ymd(new Date(monday.getTime() + 6 * DAY_MS)),
    days,
    totals: {
      shifts: shifts.length,
      people: new Set(shifts.map((s) => s.staffId)).size,
      hours: round2(shifts.reduce((sum, s) => sum + s.hours, 0)),
      costCents: sumCost(shifts),
    },
    perStaff,
    counts: {
      brouillon: shifts.filter((s) => s.status === "brouillon").length,
      publie: shifts.filter((s) => s.status === "publie").length,
    },
    payroll: {
      visible: true,
      missingCost: [],
      message: "Montants calculés sur les coûts horaires renseignés.",
    },
    reminders: remindersOf(shifts),
    remindersDisclaimer: PLANNING_REMINDERS_DISCLAIMER,
  };
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** `null` dès qu'un service n'a pas de coût : un total partiel serait un
 *  mensonge plus coûteux qu'une absence de total. */
function sumCost(shifts: PlanningShiftView[]): number | null {
  if (shifts.length === 0) return 0;
  if (shifts.some((s) => s.costCents === null)) return null;
  return shifts.reduce((sum, s) => sum + (s.costCents ?? 0), 0);
}

function blockOf(service: PlanningService, shifts: PlanningShiftView[]): PlanningServiceBlock {
  return {
    service,
    shifts,
    people: new Set(shifts.map((s) => s.staffId)).size,
    hours: round2(shifts.reduce((sum, s) => sum + s.hours, 0)),
    costCents: sumCost(shifts),
  };
}

/**
 * Rappels de durée du travail — INDICATIFS, et le contrat le dit en toutes
 * lettres. On applique les seuils partagés plutôt que les nôtres, pour que
 * l'écran ne se contredise pas d'une source de données à l'autre.
 */
function remindersOf(shifts: PlanningShiftView[]): PlanningReminder[] {
  const out: PlanningReminder[] = [];
  const byStaffDay = new Map<string, PlanningShiftView[]>();
  for (const s of shifts) {
    const key = `${s.staffId}|${s.date}`;
    byStaffDay.set(key, [...(byStaffDay.get(key) ?? []), s]);
  }
  for (const [key, group] of byStaffDay) {
    const hours = group.reduce((sum, s) => sum + s.hours, 0);
    if (hours <= PLANNING_REMINDER_THRESHOLDS.longDayHours) continue;
    const [staffId = "", date = ""] = key.split("|");
    out.push({
      kind: "journee-longue",
      staffId,
      staffName: group[0]?.staffName ?? "",
      date,
      message: `${group[0]?.staffName} : ${round2(hours)} h cumulées sur la journée du ${date}.`,
    });
  }
  return out;
}

// ─────────────────────────────────────────────────────────────
// GET /planning/week/coverage
// ─────────────────────────────────────────────────────────────

/** Commandes relevées, par jour ISO puis par heure. */
const heat = (() => {
  const table = new Map<number, Map<number, number>>();
  for (const cell of HEATMAP) {
    const row = table.get(cell.day) ?? new Map<number, number>();
    row.set(cell.hour, cell.orders);
    table.set(cell.day, row);
  }
  return table;
})();

export function planningCoverage(world: DemoWorld, week: string | null): PlanningCoverage {
  const monday = weekAnchor(world, week);
  const shifts = shiftsOfWeek(world, monday);
  const blocks: PlanningCoverageBlock[] = [];
  let hasForecast = false;

  for (let k = 0; k < 7; k++) {
    const date = new Date(monday.getTime() + k * DAY_MS);
    const iso = ymd(date);
    const day = isoDay(date);
    const label = WEEKDAY_LABELS[day - 1] ?? "?";
    const row = heat.get(day);

    for (const service of PLANNING_SERVICES) {
      const ofBlock = shifts.filter((s) => s.date === iso && s.service === service);
      const window =
        ofBlock.length === 0
          ? null
          : {
              start: ofBlock.reduce((min, s) => (s.start < min ? s.start : min), "23:59"),
              end: ofBlock.reduce((max, s) => (s.end > max ? s.end : max), "00:00"),
            };

      // Volume attendu : la moyenne relevée sur ce jour de semaine, bornée à
      // l'amplitude du service — sinon un service du soir hériterait du coup
      // de feu du midi et le conseil serait faux.
      const span = window
        ? { fromHour: Number(window.start.slice(0, 2)), toHour: Number(window.end.slice(0, 2)) }
        : PLANNING_SERVICE_DEFAULT_HOURS[service];
      let expectedOrders = 0;
      let expectedPeakHourOrders = 0;
      for (const [hour, orders] of row ?? []) {
        if (hour < span.fromHour || hour > span.toHour) continue;
        expectedOrders += orders;
        expectedPeakHourOrders = Math.max(expectedPeakHourOrders, orders);
      }
      // La carte de chaleur cumule trente jours : on ramène à une journée.
      expectedOrders = Math.round(expectedOrders / 4);
      expectedPeakHourOrders = Math.round(expectedPeakHourOrders / 4);
      if (expectedOrders > 0) hasForecast = true;

      const referencePeople =
        expectedPeakHourOrders > PLANNING_COVERAGE_PEAK_THRESHOLD
          ? PLANNING_COVERAGE_PEOPLE_BUSY
          : PLANNING_COVERAGE_PEOPLE_CALM;
      const peoplePlanned = new Set(ofBlock.map((s) => s.staffId)).size;

      let verdict: PlanningCoverageVerdict;
      let message: string;
      const when = `${label} ${service}`;
      if (expectedOrders === 0) {
        verdict = "sans-volume";
        message = `${when} : aucun volume attendu sur ce créneau d'après vos 30 derniers jours.`;
      } else if (peoplePlanned === 0) {
        verdict = "sans-service";
        message = `${when} : personne de prévu pour ≈ ${expectedOrders} commandes attendues.`;
      } else if (peoplePlanned < referencePeople) {
        verdict = "sous-effectif";
        message = `${when} : ${peoplePlanned} personne(s) prévue(s) pour ≈ ${expectedOrders} commandes attendues, sous le repère de ${referencePeople}.`;
      } else if (peoplePlanned > referencePeople) {
        verdict = "sur-effectif";
        message = `${when} : ${peoplePlanned} personnes prévues pour ≈ ${expectedOrders} commandes attendues, au-dessus du repère de ${referencePeople}.`;
      } else {
        verdict = "equilibre";
        message = `${when} : ${peoplePlanned} personnes prévues pour ≈ ${expectedOrders} commandes attendues, dans le repère du tableau de bord.`;
      }

      blocks.push({
        date: iso,
        weekday: day,
        label,
        service,
        window,
        peoplePlanned,
        expectedOrders,
        expectedPeakHourOrders,
        referencePeople,
        verdict,
        message,
      });
    }
  }

  return {
    week: ymd(monday),
    weekEnd: ymd(new Date(monday.getTime() + 6 * DAY_MS)),
    blocks,
    hasForecast,
    disclaimer: PLANNING_COVERAGE_DISCLAIMER,
  };
}

// ─────────────────────────────────────────────────────────────
// GET /planning/week/comparison
// ─────────────────────────────────────────────────────────────

/**
 * Confrontation prévu / pointé.
 *
 * Elle ne compte QUE les services publiés — un brouillon n'a engagé personne —
 * et l'écart d'une semaine en cours n'est jamais définitif. Le pointé est ici
 * dérivé du prévu avec de petits décalages déterministes : une semaine où tout
 * tombe juste à la minute ne montrerait pas ce que l'écran sert à voir.
 */
export function planningComparison(world: DemoWorld, week: string | null): PlanningComparison {
  const monday = weekAnchor(world, week);
  const shifts = shiftsOfWeek(world, monday);
  const weekEnd = new Date(monday.getTime() + 7 * DAY_MS);
  const weekInProgress = world.bootAt < weekEnd.getTime();

  const rows: PlanningComparisonRow[] = world.staff
    .filter((m) => m.active)
    .map((m, i) => {
      const done = shifts.filter(
        (s) =>
          s.staffId === m._id &&
          s.status === "publie" &&
          new Date(`${s.date}T23:59:59`).getTime() < world.bootAt,
      );
      const plannedHours = round2(done.reduce((sum, s) => sum + s.hours, 0));
      // Un service déborde plus souvent qu'il ne s'arrête tôt : le coup de feu
      // ne s'arrête pas à l'heure. L'écart penche donc légèrement vers le haut.
      const drift = [0.5, -0.5, 1, 0, 0.5, -1][i % 6] ?? 0;
      const actualHours = plannedHours === 0 ? 0 : round2(Math.max(0, plannedHours + drift));
      const rate = HOURLY_COST_CENTS[m.role] ?? null;
      return {
        staffId: m._id,
        staffName: m.name,
        plannedHours,
        actualHours,
        deltaHours: round2(actualHours - plannedHours),
        plannedCostCents: rate === null ? null : Math.round(plannedHours * rate),
        actualCostCents: rate === null ? null : Math.round(actualHours * rate),
        deltaCostCents: rate === null ? null : Math.round((actualHours - plannedHours) * rate),
        openShifts: m.onDuty ? 1 : 0,
      };
    });

  const total = (pick: (r: PlanningComparisonRow) => number | null): number | null =>
    rows.some((r) => pick(r) === null) ? null : rows.reduce((sum, r) => sum + (pick(r) ?? 0), 0);

  return {
    week: ymd(monday),
    weekEnd: ymd(new Date(monday.getTime() + 6 * DAY_MS)),
    weekInProgress,
    rows,
    totals: {
      plannedHours: round2(rows.reduce((s, r) => s + r.plannedHours, 0)),
      actualHours: round2(rows.reduce((s, r) => s + r.actualHours, 0)),
      deltaHours: round2(rows.reduce((s, r) => s + r.deltaHours, 0)),
      plannedCostCents: total((r) => r.plannedCostCents),
      actualCostCents: total((r) => r.actualCostCents),
      deltaCostCents: total((r) => r.deltaCostCents),
      openShifts: rows.reduce((s, r) => s + r.openShifts, 0),
    },
    draftHoursIgnored: round2(
      shifts.filter((s) => s.status === "brouillon").reduce((sum, s) => sum + s.hours, 0),
    ),
    note: PLANNING_COMPARISON_NOTE,
  };
}

// ─────────────────────────────────────────────────────────────
// GET /planning/staff-costs
// ─────────────────────────────────────────────────────────────

export function planningStaffCosts(world: DemoWorld) {
  const members = world.staff
    .filter((m) => m.active)
    .map((m) => ({
      id: m._id,
      name: m.name,
      role: m.role,
      hourlyCostCents: HOURLY_COST_CENTS[m.role] ?? null,
    }));
  const missingCost = members.filter((m) => m.hourlyCostCents === null).length;
  return {
    members,
    missingCost,
    message:
      missingCost === 0
        ? "Tous les membres ont un coût horaire — les projections sont complètes."
        : `${missingCost} membre(s) sans coût horaire — les projections restent partielles.`,
  };
}

// ─────────────────────────────────────────────────────────────
// Écritures
// ─────────────────────────────────────────────────────────────

export const HOURLY_COST_FOR = (role: string): number | null => HOURLY_COST_CENTS[role] ?? null;

/** Recalcule les champs dérivés d'un service après une pose ou un déplacement. */
export function withDerived(
  shift: PlanningShiftView,
  role: string | undefined,
): PlanningShiftView {
  const minutes = Math.max(0, toMin(shift.end) - toMin(shift.start));
  const rate = role ? (HOURLY_COST_CENTS[role] ?? null) : null;
  return {
    ...shift,
    service: toMin(shift.start) < PLANNING_SERVICE_SPLIT_HOUR * 60 ? "midi" : "soir",
    minutes,
    hours: round2(minutes / 60),
    costCents: rate === null ? null : Math.round((minutes / 60) * rate),
  };
}

export const PLANNING_STATUS_PUBLISHED: PlanningStatus = "publie";
