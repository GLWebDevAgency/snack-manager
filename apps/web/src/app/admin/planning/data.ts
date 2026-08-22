"use client";

/**
 * Planning des services — socle de données de l'écran.
 *
 * Le vocabulaire vient de `@sm/contracts` : un SERVICE PRÉVU est ce que le
 * gérant décide, un POINTAGE est ce qui s'est réellement passé. L'écran ne
 * réinvente aucun calcul — heures, coûts, rappels et constats de volume
 * arrivent déjà calculés par l'API, qui les produit avec le MÊME code que le
 * tableau de bord. Ici on ne fait que naviguer, formater et poser.
 *
 * Dates : `AAAA-MM-JJ` PARISIEN partout, jamais un `Date` sérialisé. Un
 * planning se raisonne en jours de calendrier — le fuseau du navigateur du
 * gérant (ou d'un test lancé ailleurs) n'a pas à décaler son samedi soir.
 */

import type {
  PlanningComparison,
  PlanningCoverage,
  PlanningCoverageBlock,
  PlanningPosition,
  PlanningService,
  PlanningShiftView,
  PlanningWeek,
} from "@sm/contracts";
import { PLANNING_SERVICES } from "@sm/contracts";
import { api } from "@/lib/api";

// ─── Équipe (module `staff`, DTO local — comme l'écran Équipe & pointage) ───

export type StaffRole = "gerant" | "caisse" | "cuisine";

export type Member = {
  _id: string;
  name: string;
  role: StaffRole;
  active: boolean;
};

export const ROLE_LABEL: Readonly<Record<StaffRole, string>> = {
  gerant: "Gérant",
  caisse: "Caisse",
  cuisine: "Cuisine",
};

/** Poste proposé par défaut d'après le rôle — le gérant reste libre de le changer. */
export const POSITION_FOR_ROLE: Readonly<Record<StaffRole, PlanningPosition>> = {
  gerant: "polyvalent",
  caisse: "caisse",
  cuisine: "cuisine",
};

// ─── Créneaux proposés d'avance ───

/**
 * Les deux services d'un snack, prêts à poser.
 *
 * Ces horaires ne sont PAS `PLANNING_SERVICE_DEFAULT_HOURS` : ces constantes-là
 * décrivent l'amplitude sur laquelle l'API cherche du volume quand personne
 * n'est prévu (11 h → 23 h, bornes de la heatmap). Un service posé, lui, colle
 * à la réalité d'un fast-food : on met en place vers 11 h, on ferme après le
 * dernier client. Le gérant ajuste ensuite au quart d'heure.
 */
export const SHIFT_PRESETS: Readonly<
  Record<PlanningService, { start: string; end: string }>
> = {
  midi: { start: "11:00", end: "15:00" },
  soir: { start: "18:00", end: "23:30" },
};

export const SERVICES = PLANNING_SERVICES;

// ─── Jours ───

const WEEKDAY_SHORT = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"];

/** Date du jour à Paris, `AAAA-MM-JJ`. `en-CA` produit exactement ce format. */
export function todayIso(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Paris",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

/**
 * Arithmétique de calendrier sur `AAAA-MM-JJ`.
 *
 * On passe par UTC à MIDI, jamais par l'heure locale : le 30 mars 2025, un
 * `setDate(+1)` posé à minuit local retombe sur le même jour à cause du saut
 * d'heure d'été. À midi, aucune bascule de fuseau ne peut faire changer la
 * date de jour.
 */
export function addDaysIso(iso: string, n: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d, 12));
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
}

/** Lundi de la semaine de `iso` (convention française). */
export function mondayIso(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dow = (new Date(Date.UTC(y, m - 1, d, 12)).getUTCDay() + 6) % 7;
  return addDaysIso(iso, -dow);
}

/** Jour ISO (1 = lundi … 7 = dimanche) d'un `AAAA-MM-JJ`. */
export function isoWeekday(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  return ((new Date(Date.UTC(y, m - 1, d, 12)).getUTCDay() + 6) % 7) + 1;
}

export const shortDayLabel = (iso: string) => WEEKDAY_SHORT[isoWeekday(iso) - 1];

/** « 17 » — le numéro seul, le mois vit dans le titre de la semaine. */
export const dayNumber = (iso: string) => String(Number(iso.slice(8, 10)));

/** « lundi 17 août » — pour les phrases, jamais pour un en-tête de colonne. */
export function longDayLabel(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12)).toLocaleDateString("fr-FR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  });
}

/** « Semaine du 17 au 23 août » (l'année n'apparaît que si elle diffère). */
export function weekTitle(weekIso: string, weekEndIso: string): string {
  const opts: Intl.DateTimeFormatOptions = { day: "numeric", month: "long", timeZone: "UTC" };
  const utc = (iso: string) => {
    const [y, m, d] = iso.split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, d, 12));
  };
  const sameYear = weekIso.slice(0, 4) === todayIso().slice(0, 4);
  const end = utc(weekEndIso).toLocaleDateString("fr-FR", {
    ...opts,
    ...(sameYear ? {} : { year: "numeric" }),
  });
  const startSameMonth = weekIso.slice(5, 7) === weekEndIso.slice(5, 7);
  const start = startSameMonth
    ? dayNumber(weekIso)
    : utc(weekIso).toLocaleDateString("fr-FR", opts);
  return `Semaine du ${start} au ${end}`;
}

/** Position de la semaine par rapport à aujourd'hui — pilote ce qu'on affiche. */
export function weekPosition(weekIso: string): "passee" | "courante" | "future" {
  const current = mondayIso(todayIso());
  if (weekIso === current) return "courante";
  return weekIso < current ? "passee" : "future";
}

// ─── Heures murales ───

export const hmToMinutes = (hm: string) => {
  const [h, m] = hm.split(":").map(Number);
  return h * 60 + m;
};

export const minutesToHm = (min: number) => {
  const wrapped = ((min % 1440) + 1440) % 1440;
  return `${String(Math.floor(wrapped / 60)).padStart(2, "0")}:${String(wrapped % 60).padStart(2, "0")}`;
};

/**
 * Durée d'un service en heures décimales, fin après minuit comprise.
 * Un service 22:00 → 01:00 dure 3 h, pas −21 h : l'API applique la même règle,
 * l'écran doit annoncer le même chiffre AVANT l'enregistrement.
 */
export function shiftHours(start: string, end: string): number {
  const diff = hmToMinutes(end) - hmToMinutes(start);
  return ((diff + 1440) % 1440) / 60;
}

/** « 5,5 h » — jamais « 5.5 h ». */
export const fmtHours = (h: number) =>
  `${h.toLocaleString("fr-FR", { maximumFractionDigits: 2 })} h`;

/** « 11:00 – 15:00 », tiret demi-cadratin entouré d'insécables. */
export const fmtRange = (start: string, end: string) => `${start} – ${end}`;

/** « +2 h » / « −1,5 h » — le signe porte l'information, jamais la couleur seule. */
export function fmtSignedHours(h: number): string {
  if (h === 0) return "0 h";
  const abs = Math.abs(h).toLocaleString("fr-FR", { maximumFractionDigits: 2 });
  return `${h > 0 ? "+" : "−"}${abs} h`;
}

export function fmtSignedEuro(cents: number | null): string {
  if (cents == null) return "—";
  if (cents === 0) return "0,00 €";
  const abs = (Math.abs(cents) / 100)
    .toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    .replace(/ /g, " ");
  return `${cents > 0 ? "+" : "−"}${abs} €`;
}

// ─── Lecture ───

/** Réponse de `GET /planning/staff-costs` — propriétaire uniquement. */
export type StaffCosts = {
  members: { id: string; name: string; role: string; hourlyCostCents: number | null }[];
  missingCost: number;
  message: string;
};

export type WeekBundle = {
  week: PlanningWeek;
  coverage: PlanningCoverage | null;
  /** `null` si la session n'a pas le droit de lire les rémunérations (403). */
  comparison: PlanningComparison | null;
  /** Idem — sans lui, l'écran ne peut pas chiffrer un service avant de le poser. */
  staffCosts: StaffCosts | null;
  members: Member[];
};

/**
 * Un chargement, cinq routes, aucune dépendance entre elles.
 *
 * Trois d'entre elles DÉGRADENT en `null` au lieu de faire échouer l'écran :
 * la confrontation prévu/pointé et les coûts horaires sont fermés à tout ce
 * qui n'est pas le compte propriétaire, et le croisement avec les prévisions
 * n'a rien à dire d'un établissement sans historique de commandes. Dans les
 * trois cas, la grille et sa pose de service doivent rester utilisables — un
 * gérant sur tablette ne verra simplement pas les montants.
 */
export async function loadWeekBundle(anchorIso: string): Promise<WeekBundle> {
  const q = `?week=${anchorIso}`;
  const [week, coverage, comparison, staffCosts, members] = await Promise.all([
    api.get<PlanningWeek>(`/planning/week${q}`),
    api.get<PlanningCoverage>(`/planning/week/coverage${q}`).catch(() => null),
    api.get<PlanningComparison>(`/planning/week/comparison${q}`).catch(() => null),
    api.get<StaffCosts>("/planning/staff-costs").catch(() => null),
    api.get<Member[]>("/staff").catch(() => [] as Member[]),
  ]);
  return { week, coverage, comparison, staffCosts, members };
}

/** `staffId` → coût horaire en centimes, pour chiffrer un service AVANT de le poser. */
export function hourlyCostIndex(
  week: PlanningWeek,
  staffCosts: StaffCosts | null,
): Map<string, number> {
  const map = new Map<string, number>();
  for (const t of week.perStaff)
    if (t.hourlyCostCents != null) map.set(t.staffId, t.hourlyCostCents);
  for (const m of staffCosts?.members ?? [])
    if (m.hourlyCostCents != null) map.set(m.id, m.hourlyCostCents);
  return map;
}

// ─── Dérivés d'affichage ───

export type GridRow = {
  staffId: string;
  name: string;
  role: StaffRole;
  hours: number;
  costCents: number | null;
  shifts: number;
  /** Vrai pour un membre désactivé qui reste planifié — on ne l'escamote pas. */
  inactive: boolean;
};

/**
 * Lignes de la grille : toute l'équipe ACTIVE, plus tout membre désactivé qui
 * a encore des services sur la semaine.
 *
 * L'équipe vient de `/staff` et non des totaux du planning : sur une semaine
 * vide, `perStaff` ne contient personne — sans cette fusion, le gérant
 * ouvrirait une grille sans aucune ligne où poser quoi que ce soit.
 */
export function buildRows(week: PlanningWeek, members: Member[]): GridRow[] {
  const totals = new Map(week.perStaff.map((t) => [t.staffId, t]));
  const rows: GridRow[] = members
    .filter((m) => m.active)
    .map((m) => {
      const t = totals.get(m._id);
      return {
        staffId: m._id,
        name: m.name,
        role: m.role,
        hours: t?.hours ?? 0,
        costCents: t?.costCents ?? null,
        shifts: t?.shifts ?? 0,
        inactive: false,
      };
    });

  const known = new Set(rows.map((r) => r.staffId));
  for (const t of week.perStaff) {
    if (known.has(t.staffId)) continue;
    rows.push({
      staffId: t.staffId,
      name: t.staffName,
      role: (["gerant", "caisse", "cuisine"] as const).includes(t.role as StaffRole)
        ? (t.role as StaffRole)
        : "caisse",
      hours: t.hours,
      costCents: t.costCents,
      shifts: t.shifts,
      inactive: true,
    });
  }
  return rows;
}

/** Index `staffId|date|service` → services posés, pour un accès O(1) par case. */
export function indexShifts(week: PlanningWeek): Map<string, PlanningShiftView[]> {
  const map = new Map<string, PlanningShiftView[]>();
  for (const day of week.days) {
    for (const block of day.services) {
      for (const s of block.shifts) {
        const key = `${s.staffId}|${s.date}|${block.service}`;
        const list = map.get(key);
        if (list) list.push(s);
        else map.set(key, [s]);
      }
    }
  }
  for (const list of map.values()) list.sort((a, b) => a.start.localeCompare(b.start));
  return map;
}

export const cellKey = (staffId: string, date: string, service: PlanningService) =>
  `${staffId}|${date}|${service}`;

/** Index `date|service` → constat de volume attendu. */
export function indexCoverage(
  coverage: PlanningCoverage | null,
): Map<string, PlanningCoverageBlock> {
  const map = new Map<string, PlanningCoverageBlock>();
  for (const b of coverage?.blocks ?? []) map.set(`${b.date}|${b.service}`, b);
  return map;
}

/**
 * Ton d'un constat de volume.
 *
 * Deux règles tenues strictement (DA §3) :
 *  - le ROUGE est réservé à ce qui va vraiment mal — un créneau où du volume
 *    est attendu et où PERSONNE n'est prévu. C'est un trou de service, pas une
 *    nuance ;
 *  - sous-effectif et sur-effectif partagent l'AMBRE : ce sont deux écarts au
 *    repère, aucun n'est une urgence. Ce qui les distingue est écrit en
 *    toutes lettres, pas laissé à la couleur.
 */
export type CoverageTone = "neutre" | "ok" | "attention" | "trou";

export function coverageTone(b: PlanningCoverageBlock | undefined): CoverageTone {
  if (!b) return "neutre";
  switch (b.verdict) {
    case "sans-service":
      return "trou";
    case "sous-effectif":
    case "sur-effectif":
      return "attention";
    case "equilibre":
      return "ok";
    default:
      return "neutre";
  }
}

export const COVERAGE_TONE_TEXT: Readonly<Record<CoverageTone, string>> = {
  neutre: "text-mut",
  ok: "text-okt",
  attention: "text-prept",
  trou: "text-alertt",
};
