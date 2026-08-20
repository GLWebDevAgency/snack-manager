import { z } from 'zod';

// ─────────────────────────────────────────────────────────────
// Planning des services — types partagés API ↔ web.
//
// Vocabulaire : un SERVICE PRÉVU est ce que le gérant décide, un POINTAGE est
// ce qui s'est réellement passé. Tout le module vit de cet écart.
//
// Montants : CENTIMES (int) partout. Heures : décimales (7,5 = 7 h 30).
// Jours : `AAAA-MM-JJ` parisien. Heures de service : `HH:MM` MURALES — l'heure
// de la pendule du snack, jamais un instant, pour qu'un planning posé en août
// ne se décale pas au passage à l'heure d'hiver.
// ─────────────────────────────────────────────────────────────

/** Poste tenu sur le service. `polyvalent` : la réalité de la plupart des snacks. */
export const PLANNING_POSITIONS = ['caisse', 'cuisine', 'polyvalent'] as const;
export const PlanningPositionSchema = z.enum(PLANNING_POSITIONS);
export type PlanningPosition = z.infer<typeof PlanningPositionSchema>;

export const PLANNING_POSITION_LABELS: Readonly<Record<PlanningPosition, string>> = {
  caisse: 'Caisse',
  cuisine: 'Cuisine',
  polyvalent: 'Polyvalent',
};

/**
 * Un planning se construit en plusieurs fois. Tant qu'il est en `brouillon`,
 * l'équipe ne doit rien en voir : publier est un GESTE, pas un effet de bord.
 */
export const PLANNING_STATUSES = ['brouillon', 'publie'] as const;
export const PlanningStatusSchema = z.enum(PLANNING_STATUSES);
export type PlanningStatus = z.infer<typeof PlanningStatusSchema>;

/** Un snack tourne à deux services : midi et soir, avec un creux entre les deux. */
export const PLANNING_SERVICES = ['midi', 'soir'] as const;
export const PlanningServiceSchema = z.enum(PLANNING_SERVICES);
export type PlanningService = z.infer<typeof PlanningServiceSchema>;

export const PLANNING_SERVICE_LABELS: Readonly<Record<PlanningService, string>> = {
  midi: 'Midi',
  soir: 'Soir',
};

/**
 * Frontière midi / soir : un service qui COMMENCE avant 16 h est un service du
 * midi, sinon c'est le soir. 16 h tombe dans le creux de l'après-midi, donc
 * jamais au milieu d'un coup de feu — un début à 15 h 30 reste une fin de
 * service du midi, un début à 17 h est une mise en place du soir.
 */
export const PLANNING_SERVICE_SPLIT_HOUR = 16;

/**
 * Plage horaire de référence d'un service, utilisée quand AUCUN service n'est
 * prévu : sans elle, on ne saurait pas dire « samedi soir, personne de prévu
 * pour ≈ 68 commandes attendues ». Bornes alignées sur la plage de la heatmap
 * du tableau de bord (11 h → 23 h).
 */
export const PLANNING_SERVICE_DEFAULT_HOURS: Readonly<
  Record<PlanningService, { fromHour: number; toHour: number }>
> = {
  midi: { fromHour: 11, toHour: PLANNING_SERVICE_SPLIT_HOUR - 1 },
  soir: { fromHour: PLANNING_SERVICE_SPLIT_HOUR, toHour: 23 },
};

// ─── Entrées ───

const DaySchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Format attendu : AAAA-MM-JJ');

const HmSchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Format attendu : HH:MM (00:00 → 23:59)');

const NoteSchema = z.string().trim().max(200, 'Note : 200 caractères maximum');

/**
 * Coût horaire employeur en centimes. Plafond à 1 000 €/h : bien au-delà de
 * tout salaire de snack, assez bas pour intercepter la saisie en euros
 * (« 1250 » tapé pour 12,50 €) avant qu'elle ne fausse toute la projection.
 */
export const HourlyCostCentsSchema = z
  .number()
  .int('Le coût horaire est en centimes (entier)')
  .min(0)
  .max(100_000, 'Coût horaire invalide — le montant est attendu en centimes');

export const PlannedShiftCreateSchema = z
  .object({
    staffId: z.string().min(1),
    date: DaySchema,
    start: HmSchema,
    end: HmSchema,
    position: PlanningPositionSchema.default('polyvalent'),
    note: NoteSchema.default(''),
    /** Par défaut BROUILLON : poser un service ne le rend jamais visible à l'équipe. */
    status: PlanningStatusSchema.default('brouillon'),
  })
  .refine((s) => s.start !== s.end, {
    message: 'Le début et la fin ne peuvent pas être identiques',
    path: ['end'],
  });
export type PlannedShiftCreate = z.infer<typeof PlannedShiftCreateSchema>;

/**
 * Mise à jour PARTIELLE — surtout pas `.partial()` sur le schéma de création :
 * `.partial()` conserve les `.default()`, et un `PATCH { note: "…" }`
 * repasserait le service en brouillon en écrasant `status`. Le piège a déjà
 * coûté des produits en production (cf. `ProductUpdateSchema`).
 */
export const PlannedShiftUpdateSchema = z
  .object({
    staffId: z.string().min(1).optional(),
    date: DaySchema.optional(),
    start: HmSchema.optional(),
    end: HmSchema.optional(),
    position: PlanningPositionSchema.optional(),
    note: NoteSchema.optional(),
    status: PlanningStatusSchema.optional(),
  })
  .refine((s) => Object.keys(s).length > 0, { message: 'Aucune modification transmise' })
  .refine((s) => s.start === undefined || s.end === undefined || s.start !== s.end, {
    message: 'Le début et la fin ne peuvent pas être identiques',
    path: ['end'],
  });
export type PlannedShiftUpdate = z.infer<typeof PlannedShiftUpdateSchema>;

/** `?week=` : n'importe quelle date de la semaine voulue. Défaut : semaine courante. */
export const PlanningWeekQuerySchema = z.object({ week: DaySchema.optional() });
export type PlanningWeekQuery = z.infer<typeof PlanningWeekQuerySchema>;

/**
 * Duplication : le geste le plus fréquent du dimanche soir, une semaine
 * ressemblant à la précédente. La copie arrive TOUJOURS en brouillon (voir
 * `PlanningDuplicateResult`) et refuse d'écraser une semaine déjà remplie
 * tant que `replace` n'est pas demandé explicitement.
 */
export const PlanningDuplicateSchema = z.object({
  from: DaySchema,
  to: DaySchema,
  replace: z.boolean().default(false),
});
export type PlanningDuplicate = z.infer<typeof PlanningDuplicateSchema>;

export const PlanningPublishSchema = z.object({ week: DaySchema });
export type PlanningPublish = z.infer<typeof PlanningPublishSchema>;

export const StaffHourlyCostSchema = z.object({
  /** `null` efface le coût horaire (retour à « non renseigné »). */
  hourlyCostCents: HourlyCostCentsSchema.nullable(),
});
export type StaffHourlyCost = z.infer<typeof StaffHourlyCostSchema>;

// ─── Sorties ───

/**
 * Accès aux montants dans une réponse de planning.
 *
 * `visible: false` signifie « cette session n'a pas le droit de lire les
 * rémunérations » : tous les `costCents` de la réponse valent alors `null`.
 * Sans ce drapeau, l'écran ne pourrait pas distinguer un montant INTERDIT
 * d'un montant simplement pas encore renseigné — et afficherait « 0 € » dans
 * les deux cas.
 */
export interface PlanningPayrollAccess {
  visible: boolean;
  /** Salariés sans coût horaire : tant qu'ils y figurent, la projection est PARTIELLE. */
  missingCost: { staffId: string; staffName: string }[];
  message: string;
}

export const PAYROLL_HIDDEN_MESSAGE =
  'Montants masqués — les rémunérations sont réservées au compte propriétaire.';

export interface PlanningShiftView {
  id: string;
  staffId: string;
  staffName: string;
  date: string;
  start: string;
  end: string;
  position: PlanningPosition;
  service: PlanningService;
  note: string;
  status: PlanningStatus;
  minutes: number;
  hours: number;
  /** `null` : coût horaire non renseigné, ou session sans droit de lecture. */
  costCents: number | null;
}

export interface PlanningServiceBlock {
  service: PlanningService;
  shifts: PlanningShiftView[];
  people: number;
  hours: number;
  costCents: number | null;
}

export interface PlanningDay {
  date: string;
  /** Jour ISO : 1 = lundi … 7 = dimanche. */
  weekday: number;
  label: string;
  /** Toujours les deux services, dans l'ordre midi puis soir — même vides. */
  services: PlanningServiceBlock[];
  people: number;
  hours: number;
  costCents: number | null;
}

export interface PlanningStaffTotal {
  staffId: string;
  staffName: string;
  role: string;
  hourlyCostCents: number | null;
  shifts: number;
  hours: number;
  costCents: number | null;
}

/**
 * Rappels de durée du travail.
 *
 * CE N'EST PAS UN CONTRÔLE DE CONFORMITÉ, et le dire est non négociable : la
 * durée légale du travail dépend de la convention collective, des accords
 * d'entreprise et du contrat de chaque salarié — nous n'en savons rien.
 * Promettre la conformité exposerait nos clients.
 */
export const PLANNING_REMINDER_KINDS = ['journee-longue', 'repos-court', 'jours-consecutifs'] as const;
export const PlanningReminderKindSchema = z.enum(PLANNING_REMINDER_KINDS);
export type PlanningReminderKind = z.infer<typeof PlanningReminderKindSchema>;

export interface PlanningReminder {
  kind: PlanningReminderKind;
  staffId: string;
  staffName: string;
  /** Jour concerné (pour `repos-court` : le jour de la reprise). */
  date: string;
  message: string;
}

export const PLANNING_REMINDERS_DISCLAIMER =
  "Rappels indicatifs, ce n'est pas un contrôle de conformité : la durée du travail dépend de votre convention collective, de vos accords d'entreprise et du contrat de chaque salarié.";

/** Seuils des rappels — affichés tels quels au gérant, jamais présentés comme la loi. */
export const PLANNING_REMINDER_THRESHOLDS = {
  /** Journée cumulée au-delà de laquelle on interpelle le gérant. */
  longDayHours: 10,
  /** Repos entre la fin d'un service et le début du suivant. */
  shortRestHours: 11,
  /** Nombre de jours travaillés d'affilée qui déclenche le rappel. */
  consecutiveDays: 7,
} as const;

export interface PlanningWeek {
  /** Lundi de la semaine, `AAAA-MM-JJ`. */
  week: string;
  /** Dimanche de la semaine, `AAAA-MM-JJ`. */
  weekEnd: string;
  days: PlanningDay[];
  totals: {
    shifts: number;
    people: number;
    hours: number;
    costCents: number | null;
  };
  perStaff: PlanningStaffTotal[];
  counts: { brouillon: number; publie: number };
  payroll: PlanningPayrollAccess;
  reminders: PlanningReminder[];
  remindersDisclaimer: string;
}

// ─── Confrontation prévu / pointé ───

export interface PlanningComparisonRow {
  staffId: string;
  staffName: string;
  plannedHours: number;
  actualHours: number;
  /** Pointé − prévu : positif = plus d'heures qu'annoncé. */
  deltaHours: number;
  plannedCostCents: number | null;
  actualCostCents: number | null;
  deltaCostCents: number | null;
  /** Pointages encore ouverts sur la semaine : exclus des totaux, jamais tus. */
  openShifts: number;
}

export interface PlanningComparison {
  week: string;
  weekEnd: string;
  /** Vrai si la semaine n'est pas terminée — l'écart n'est alors pas définitif. */
  weekInProgress: boolean;
  rows: PlanningComparisonRow[];
  totals: Omit<PlanningComparisonRow, 'staffId' | 'staffName'>;
  /** Heures de brouillon écartées : elles n'ont jamais engagé personne. */
  draftHoursIgnored: number;
  note: string;
}

export const PLANNING_COMPARISON_NOTE =
  "Comparaison sur les services PUBLIÉS : un brouillon n'a engagé personne. Les heures pointées reprennent l'arrondi à la demi-heure de l'écran Pointages ; les heures prévues sont exactes.";

// ─── Adéquation au volume attendu ───

export const PLANNING_COVERAGE_VERDICTS = [
  'sans-volume',
  'sans-service',
  'sous-effectif',
  'equilibre',
  'sur-effectif',
] as const;
export type PlanningCoverageVerdict = (typeof PLANNING_COVERAGE_VERDICTS)[number];

export interface PlanningCoverageBlock {
  date: string;
  weekday: number;
  label: string;
  service: PlanningService;
  /** Amplitude réellement couverte par au moins une personne — `null` si personne. */
  window: { start: string; end: string } | null;
  peoplePlanned: number;
  /** Commandes attendues sur le créneau (moyenne du même jour de semaine, 30 j). */
  expectedOrders: number;
  /** Commandes attendues sur l'heure la plus chargée du créneau. */
  expectedPeakHourOrders: number;
  /** Repère du tableau de bord, pas une consigne. */
  referencePeople: number;
  verdict: PlanningCoverageVerdict;
  message: string;
}

export interface PlanningCoverage {
  week: string;
  weekEnd: string;
  blocks: PlanningCoverageBlock[];
  /** Faux tant que l'historique de commandes ne permet aucune estimation. */
  hasForecast: boolean;
  disclaimer: string;
}

/**
 * Repère d'effectif REPRIS du tableau de bord, pour que les deux écrans ne
 * racontent pas deux histoires : au-delà de 25 commandes sur l'heure de
 * pointe, il y annonce « 2 en cuisine + 1 comptoir » ; en dessous,
 * « 1 en cuisine + 1 comptoir ».
 */
export const PLANNING_COVERAGE_PEAK_THRESHOLD = 25;
export const PLANNING_COVERAGE_PEOPLE_BUSY = 3;
export const PLANNING_COVERAGE_PEOPLE_CALM = 2;

export const PLANNING_COVERAGE_DISCLAIMER =
  "Constats issus de vos 30 derniers jours de commandes. Ils décrivent, ils ne décident pas : vous seul connaissez vos contrats, vos extras et votre carte.";
