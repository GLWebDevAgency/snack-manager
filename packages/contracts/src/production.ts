import { z } from 'zod';
import type { TenantAccountStatus } from './admin';
import type { LeadServices } from './crm';

// ─────────────────────────────────────────────────────────────
// PRODUCTION DE L'ATELIER — « qu'est-ce que je dois à mes clients cette
// semaine ? »
//
// Depuis que « réseaux sociaux, 2 publications/semaine » ou « présence
// internet, rapport mensuel » se SIGNENT, il y a une promesse récurrente à
// tenir — et rien ne la rappelait le lundi matin : le premier client réseaux
// oublié une semaine aurait découvert le trou lui-même.
//
// LA RÈGLE, LA MÊME QUE POUR LES IMPAYÉS : le DÛ ne se stocke pas, il se
// DÉRIVE de ce que chaque client a signé (`tenant.atelier`) et de la semaine
// regardée. Seules les COCHES (« fait ») s'écrivent en base. Une file stockée
// divergerait de la signature au premier avenant ; une file dérivée est juste
// par construction, même pour les semaines passées.
//
// Les PONCTUELS (site, identité, intégration) n'y figurent pas : un chantier
// se suit à la fiche client, il n'a pas de cadence hebdomadaire. Il entrera
// dans une file le jour où il portera un état de livraison — pas avant.
// ─────────────────────────────────────────────────────────────

/* ── Les semaines — calendaires, ISO-8601, lundi → dimanche ──── */

/**
 * Tous les calculs sont CALENDAIRES, sur des jours `AAAA-MM-JJ`, jamais sur
 * des instants : c'est l'appelant (l'API) qui convertit « maintenant » en jour
 * PARISIEN avant d'entrer ici. Le passage par minuit UTC n'est qu'un support
 * d'arithmétique — aucun fuseau ne s'y cache.
 */
const dayToUtc = (day: string): Date => new Date(`${day}T00:00:00.000Z`);
const utcToDay = (d: Date): string => d.toISOString().slice(0, 10);
const addDays = (day: string, n: number): string => {
  const d = dayToUtc(day);
  d.setUTCDate(d.getUTCDate() + n);
  return utcToDay(d);
};
/** Lundi = 1 … dimanche = 7, convention ISO. */
const isoDow = (day: string): number => {
  const js = dayToUtc(day).getUTCDay();
  return js === 0 ? 7 : js;
};

export type ProductionWeek = {
  /** `AAAA-Wss` — l'année ISO (celle du jeudi), pas forcément l'année civile. */
  key: string;
  monday: string;
  sunday: string;
};

/** Le 4 janvier est TOUJOURS en semaine 1 (ISO-8601) — d'où tout se déduit. */
const mondayOfWeek1 = (isoYear: number): string => {
  const jan4 = `${isoYear}-01-04`;
  return addDays(jan4, 1 - isoDow(jan4));
};

const WEEK_MS = 7 * 86_400_000;

/** La semaine de production qui contient ce jour. */
export function productionWeekOf(day: string): ProductionWeek {
  const monday = addDays(day, 1 - isoDow(day));
  // L'année ISO est celle du JEUDI de la semaine — c'est ce qui fait qu'un
  // 1er janvier tombé un vendredi appartient à la W53 de l'année d'avant.
  const thursday = addDays(monday, 3);
  const isoYear = Number(thursday.slice(0, 4));
  const num =
    1 +
    Math.round(
      (dayToUtc(monday).getTime() - dayToUtc(mondayOfWeek1(isoYear)).getTime()) / WEEK_MS,
    );
  return { key: `${isoYear}-W${String(num).padStart(2, '0')}`, monday, sunday: addDays(monday, 6) };
}

/**
 * Relit une clef `AAAA-Wss` — `null` si elle est malformée OU si elle nomme
 * une semaine qui n'existe pas (la W53 d'une année qui n'en a que 52 se
 * reconstruit sous une autre clef, et c'est ce qui la trahit).
 */
export function parseWeekKey(key: string): ProductionWeek | null {
  const m = /^(\d{4})-W(\d{2})$/.exec(key);
  if (!m) return null;
  const num = Number(m[2]);
  if (num < 1 || num > 53) return null;
  const monday = addDays(mondayOfWeek1(Number(m[1])), (num - 1) * 7);
  const built = productionWeekOf(monday);
  return built.key === key ? built : null;
}

export const previousWeekKey = (w: ProductionWeek): string =>
  productionWeekOf(addDays(w.monday, -7)).key;
export const nextWeekKey = (w: ProductionWeek): string =>
  productionWeekOf(addDays(w.monday, 7)).key;

const MOIS = [
  'janvier',
  'février',
  'mars',
  'avril',
  'mai',
  'juin',
  'juillet',
  'août',
  'septembre',
  'octobre',
  'novembre',
  'décembre',
] as const;

const dayLabel = (day: string, avecMois: boolean): string => {
  const n = Number(day.slice(8, 10));
  const numero = n === 1 ? '1er' : String(n);
  return avecMois ? `${numero} ${MOIS[Number(day.slice(5, 7)) - 1]}` : numero;
};

/** « du 24 au 30 août » — le mois du lundi ne sort que s'il diffère. */
export function productionWeekLabel(w: ProductionWeek): string {
  const memeMois = w.monday.slice(0, 7) === w.sunday.slice(0, 7);
  return `du ${dayLabel(w.monday, !memeMois)} au ${dayLabel(w.sunday, true)}`;
}

/* ── Les tâches dues — dérivées du signé, jamais saisies ─────── */

export const PRODUCTION_TASKS = [
  'social_pub_1',
  'social_pub_2',
  'presence_avis',
  'presence_rapport',
] as const;
export type ProductionTaskKey = (typeof PRODUCTION_TASKS)[number];

export type ProductionDueTask = { key: ProductionTaskKey; label: string };

/**
 * Le 1er du mois contenu dans la semaine, en `AAAA-MM-JJ` — `null` sinon.
 * C'est lui qui déclenche le rapport mensuel, et c'est contre lui que le
 * service compare la date de signature (un client signé APRÈS ce 1er n'a
 * jamais promis le mois clos : pas de rapport fantôme sa semaine d'entrée).
 */
export function premierDuMoisDans(w: ProductionWeek): string | null {
  for (let i = 0; i < 7; i += 1) {
    const day = addDays(w.monday, i);
    if (day.slice(8) === '01') return day;
  }
  return null;
}

/**
 * Le mois dont le RAPPORT se doit cette semaine — celui qui vient de se
 * clore, quand la semaine contient un 1er du mois. `null` sinon.
 */
export function moisDuRapport(w: ProductionWeek): string | null {
  const premier = premierDuMoisDans(w);
  if (!premier) return null;
  // Le 1er de septembre ouvre la semaine du rapport… d'août.
  return MOIS[(Number(premier.slice(5, 7)) + 10) % 12] ?? null;
}

/**
 * Ce que la maison DOIT à un client cette semaine-là, d'après ce qu'il a
 * signé. Fonction PURE : c'est elle que la file appelle client par client,
 * et c'est elle que le POST de coche rappelle pour refuser une tâche qui
 * n'est pas due (cocher « 2e publication » chez un client en hebdo serait
 * une coche sans promesse derrière).
 */
export function productionTasksFor(
  atelier: Pick<LeadServices, 'presenceInternet' | 'reseauxSociaux'>,
  week: ProductionWeek,
): ProductionDueTask[] {
  const tasks: ProductionDueTask[] = [];
  if (atelier.reseauxSociaux === 'hebdo') {
    tasks.push({ key: 'social_pub_1', label: 'Publication de la semaine — réseaux sociaux' });
  }
  if (atelier.reseauxSociaux === 'bihebdo') {
    tasks.push({ key: 'social_pub_1', label: 'Première publication — réseaux sociaux' });
    tasks.push({ key: 'social_pub_2', label: 'Deuxième publication — réseaux sociaux' });
  }
  if (atelier.presenceInternet) {
    tasks.push({ key: 'presence_avis', label: 'Fiche Google — avis répondus, infos à jour' });
    const mois = moisDuRapport(week);
    if (mois) {
      tasks.push({ key: 'presence_rapport', label: `Rapport mensuel (${mois}) — présence internet` });
    }
  }
  return tasks;
}

/* ── Entrée d'API ────────────────────────────────────────────── */

/** La semaine demandée à la file — absente : la semaine courante. */
export const ProductionWeekQuerySchema = z.object({
  week: z
    .string()
    .regex(/^\d{4}-W\d{2}$/, 'Clef de semaine attendue : AAAA-Wss')
    .optional(),
});
export type ProductionWeekQuery = z.infer<typeof ProductionWeekQuerySchema>;

export const ProductionTickSchema = z.object({
  week: z.string().regex(/^\d{4}-W\d{2}$/, 'Clef de semaine attendue : AAAA-Wss'),
  task: z.enum(PRODUCTION_TASKS),
  done: z.boolean(),
  /** Trace libre — « lien du post », « avis de Mme D. répondu ». */
  note: z.string().trim().max(300).default(''),
});
export type ProductionTick = z.infer<typeof ProductionTickSchema>;

/* ── Sorties d'API ───────────────────────────────────────────── */

export type CrmProductionTask = ProductionDueTask & {
  done: boolean;
  doneAt: string | null;
  note: string;
};

export type CrmProductionClient = {
  tenantId: string;
  name: string;
  slug: string;
  /** La signature de l'Atelier — depuis quand la promesse court. */
  signedAt: string | null;
  /**
   * Statut du compte — un client SUSPENDU reste dans la file (continuer ou
   * suspendre le travail est une décision humaine), mais l'écran doit le
   * dire : la décision est impossible si le statut ne se lit pas là où le
   * travail se fait.
   */
  accountStatus: TenantAccountStatus;
  tasks: CrmProductionTask[];
  done: number;
  total: number;
};

export type CrmProductionWeek = {
  week: string;
  /** « du 24 au 30 août ». */
  label: string;
  monday: string;
  sunday: string;
  /** Navigation — `next` est `null` sur la semaine courante : le travail de
   * la semaine prochaine n'est pas encore dû, l'afficher inviterait à cocher
   * d'avance. */
  previous: string;
  next: string | null;
  current: string;
  clients: CrmProductionClient[];
  done: number;
  total: number;
};
