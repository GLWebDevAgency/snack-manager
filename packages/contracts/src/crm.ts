import { z } from 'zod';
import type { TenantAccountStatus } from './admin';

// ─────────────────────────────────────────────────────────────
// CRM Snack Manager — notre back-office interne (HQ), pas celui du client.
//
// Cette surface est TRANS-TENANT : elle lit l'ensemble des restaurants
// clients. C'est exactement pour ça qu'elle est réservée au rôle `sm_admin`
// (compte d'équipe SM, `tenantId: null`) — un gérant de restaurant n'y a
// jamais accès, ni côté API ni côté web.
//
// Rappel de convention : tous les montants circulent en CENTIMES (int).
// ─────────────────────────────────────────────────────────────

// ─── Étapes du pipeline ───

export const LEAD_STAGES = [
  'nouveau',
  'contacte',
  'demo',
  'proposition',
  'signe',
  'perdu',
] as const;
export const LeadStageSchema = z.enum(LEAD_STAGES);
export type LeadStage = z.infer<typeof LeadStageSchema>;

export const LEAD_STAGE_LABELS: Record<LeadStage, string> = {
  nouveau: 'Nouveau',
  contacte: 'Contacté',
  demo: 'Démo planifiée',
  proposition: 'Proposition',
  signe: 'Signé',
  perdu: 'Perdu',
};

/**
 * Colonnes du pipeline, dans l'ordre de progression.
 *
 * `perdu` n'y figure pas : ce n'est pas une étape « plus avancée » que
 * « signé », c'est une sortie de route — même raisonnement que
 * `ORDER_STATUS_RANK`, où `cancelled` vaut −1 plutôt qu'un rang.
 */
export const LEAD_PIPELINE = ['nouveau', 'contacte', 'demo', 'proposition', 'signe'] as const;
export type LeadPipelineStage = (typeof LEAD_PIPELINE)[number];

/** Étape suivante, ou `null` en bout de pipeline (et depuis « perdu »). */
export function nextLeadStage(stage: LeadStage): LeadStage | null {
  const i = LEAD_PIPELINE.indexOf(stage as LeadPipelineStage);
  if (i === -1) return null;
  return LEAD_PIPELINE[i + 1] ?? null;
}

/** Étape précédente — un commercial se trompe de bouton, il doit pouvoir revenir. */
export function previousLeadStage(stage: LeadStage): LeadStage | null {
  const i = LEAD_PIPELINE.indexOf(stage as LeadPipelineStage);
  if (i <= 0) return null;
  return LEAD_PIPELINE[i - 1] ?? null;
}

/** Un lead « en cours » : ni signé, ni perdu — c'est ce qu'il reste à travailler. */
export const isOpenLeadStage = (stage: LeadStage): boolean =>
  stage !== 'signe' && stage !== 'perdu';

// ─── Séquences de relance (spec crm-sm §8.1) ───

export const LEAD_SEQUENCES = ['A', 'B', 'C'] as const;
export const LeadSequenceSchema = z.enum(LEAD_SEQUENCES);
export type LeadSequence = z.infer<typeof LeadSequenceSchema>;

export const LEAD_SEQUENCE_LABELS: Record<LeadSequence, string> = {
  A: 'A · après la démo',
  B: 'B · visite sans démo',
  C: 'C · nurture mensuel',
};

/**
 * Rappel des séquences, affiché dans la fiche lead. Les règles viennent du
 * document « Séquences de relance » : jamais plus de deux relances sur la même
 * proposition, envois hors service (14h30–16h30 ou 21h30–22h), arrêt immédiat
 * sur un « pas intéressé ».
 */
export const LEAD_SEQUENCE_STEPS: Record<LeadSequence, readonly string[]> = {
  A: ['A1 · SMS le soir même (21h30–22h)', 'A2 · appel à J+3', 'A3 · SMS à J+10 — dernier avant pause'],
  B: ['B1 · SMS le lendemain (14h30–16h) — 2 créneaux de démo', 'B2 · SMS à J+7 — preuve sociale locale'],
  C: ['C1/C2/C3 · 1 email par mois — un chiffre, une leçon, une porte ouverte'],
};

// ─── Relances tracées (« touches ») ───

export const LEAD_TOUCH_TYPES = ['sms', 'email', 'appel', 'visite', 'demo', 'autre'] as const;
export const LeadTouchTypeSchema = z.enum(LEAD_TOUCH_TYPES);
export type LeadTouchType = z.infer<typeof LeadTouchTypeSchema>;

export const LEAD_TOUCH_LABELS: Record<LeadTouchType, string> = {
  sms: 'SMS',
  email: 'E-mail',
  appel: 'Appel',
  visite: 'Visite',
  demo: 'Démo',
  autre: 'Autre',
};

// ─── Places fondateur & MRR ───

/** « 10 places à tarif préférentiel à vie » (Dossier fondateur, roadmap T4). */
export const FOUNDER_SEATS_TOTAL = 10;

/**
 * LA GRILLE, EN CENTIMES, ET C'EST ICI QU'ELLE FAIT LOI.
 *
 * Le CRM calcule le MRR avec ces valeurs et la facturation les reprend : un
 * prix changé sur la vitrine sans l'être ici produit des factures au tarif de
 * l'année dernière, sans que rien ne casse et sans que personne le voie.
 *
 * Révisée le 21/08/2026 : 89/139/189 → 99/159/199.
 *
 * Boost à 199 et non 229, et le choix est arithmétique. Complet (159) plus le
 * module de commande en ligne (79) font 238 par mois, plus 55 de mise en
 * service : Boost fait donc économiser 94 le premier mois puis 39 par mois. À
 * 229 il n'en resterait que 9, trop peu pour décider quiconque. Et l'échelle
 * 99 → 159 → 199 a des écarts DÉCROISSANTS (+60, +40), ce qui fait lire le haut
 * de gamme comme la bonne affaire ; 99 → 159 → 229 les rend croissants et
 * produit l'effet inverse.
 *
 * Le MRR qu'en tire le CRM reste une ESTIMATION tant que Stripe Billing n'est
 * pas branché (roadmap M9) : le jour où il l'est, c'est cette table qui
 * disparaît, pas les calculs qui la lisent. Elle remplace au passage la
 * fourchette « 89–189 €/mois » de `docs/specs/contraintes-business.md` §6.2,
 * qui décrivait l'intention de départ et non la grille arrêtée.
 */
/*
 * `as const satisfies` et non une annotation `Record<…, number>`, et ce n'est
 * pas un raffinement de style. L'annotation ÉLARGIT les valeurs à `number` :
 * le type ne dit plus que Complet vaut 15 900, seulement que c'est un nombre.
 * Or la vitrine recopie cette table (`PLAN_MONTHLY_CENTS`, content.ts) faute de
 * pouvoir importer zod dans le paquet client de la page d'accueil, et c'est
 * cette recopie qu'il faut garder honnête. Avec les littéraux préservés, la
 * vitrine peut poser une assertion de type qui casse le typecheck le jour où
 * les deux tables divergent — le `satisfies` continuant de vérifier qu'aucune
 * formule ne manque.
 */
export const PLAN_MRR_CENTS = {
  essentiel: 9_900,
  complet: 15_900,
  boost: 19_900,
} as const satisfies Record<'essentiel' | 'complet' | 'boost', number>;

/**
 * Le module de commande en ligne et sa mise en service, en centimes.
 *
 * Ils vivaient uniquement dans le texte de la vitrine, donc la facturation ne
 * savait pas les compter. `SETUP_CENTS` n'est dû qu'UNE FOIS, et jamais sur
 * Boost, qui le comprend.
 */
export const MODULE_ORDERING_CENTS = 7_900;
export const MODULE_ORDERING_SETUP_CENTS = 5_500;

/**
 * L'ENGAGEMENT ANNUEL — deux mois offerts.
 *
 * Douze mois payés dix. C'est la remise la plus répandue du SaaS, et surtout la
 * seule qui se dise sans calcul : « deux mois offerts » se retient, « −16,7 % »
 * se vérifie. Le montant annuel se déduit toujours du mensuel, il n'est jamais
 * saisi à la main — deux grilles indépendantes finiraient par diverger.
 */
export const YEARLY_MONTHS_BILLED = 10;
export const yearlyCents = (monthlyCents: number): number => monthlyCents * YEARLY_MONTHS_BILLED;

export const PLAN_LABELS: Record<'essentiel' | 'complet' | 'boost', string> = {
  essentiel: 'Essentiel',
  complet: 'Complet',
  boost: 'Boost',
};

/** Places restantes sur les 10 — jamais négatif, même si on a survendu. */
export const founderSeatsRemaining = (taken: number): number =>
  Math.max(0, FOUNDER_SEATS_TOTAL - taken);

// ─── Santé d'un restaurant client ───

/**
 * Un client qui n'encaisse plus, c'est un client qui part. Le signal n'est pas
 * son abonnement (il court encore) mais ses commandes : sept jours sans une
 * seule commande sur un fast-food, ce n'est pas un creux, c'est un décrochage.
 */
export const CLIENT_RISK_DAYS = 7;
/** Deux jours de silence : pas encore une alerte, mais on regarde. */
export const CLIENT_WATCH_DAYS = 2;

export const CLIENT_HEALTHS = ['ok', 'attention', 'risque'] as const;
export const ClientHealthSchema = z.enum(CLIENT_HEALTHS);
export type CrmClientHealth = z.infer<typeof ClientHealthSchema>;

export const CLIENT_HEALTH_LABELS: Record<CrmClientHealth, string> = {
  ok: 'Bonne',
  attention: 'À suivre',
  risque: 'À risque',
};

const DAY_MS = 86_400_000;

/** Jours pleins écoulés depuis la dernière commande (`null` = jamais commandé). */
export function daysSince(lastAt: Date | string | null, now: Date = new Date()): number | null {
  if (!lastAt) return null;
  const ms = now.getTime() - new Date(lastAt).getTime();
  return Math.max(0, Math.floor(ms / DAY_MS));
}

/**
 * Santé d'un client d'après sa dernière commande. Un client sans aucune
 * commande est « à risque » : soit il n'a jamais démarré, soit il a arrêté —
 * les deux demandent un appel.
 */
export function clientHealth(
  lastOrderAt: Date | string | null,
  now: Date = new Date(),
): CrmClientHealth {
  const days = daysSince(lastOrderAt, now);
  if (days === null || days >= CLIENT_RISK_DAYS) return 'risque';
  if (days >= CLIENT_WATCH_DAYS) return 'attention';
  return 'ok';
}

// ─── Entrées d'API (validées par zod) ───

export const LeadContactSchema = z.object({
  name: z.string().trim().max(120).default(''),
  phone: z.string().trim().max(40).default(''),
  // Un lead terrain n'a souvent qu'un numéro : l'e-mail vide est légitime.
  email: z.union([z.literal(''), z.email().max(160)]).default(''),
});
export type LeadContact = z.infer<typeof LeadContactSchema>;

export const LeadCreateSchema = z.object({
  restaurantName: z.string().trim().min(1).max(160),
  contact: LeadContactSchema.default({ name: '', phone: '', email: '' }),
  stage: LeadStageSchema.default('nouveau'),
  sequence: LeadSequenceSchema.nullable().default(null),
  notes: z.string().trim().max(2_000).default(''),
  founderSeatReserved: z.boolean().default(false),
});
export type LeadCreate = z.infer<typeof LeadCreateSchema>;

/**
 * PATCH partiel : seules les clés présentes sont écrites.
 *
 * Écrit à la main, et surtout PAS en `LeadCreateSchema.partial()` : zod
 * conserve les `.default()` sous l'optionnel, si bien qu'un PATCH
 * `{ notes: "rappelé" }` repartait avec `stage: "nouveau"` et un contact vide
 * — l'étape et le téléphone du prospect effacés à chaque note ajoutée.
 * Ici, une clé absente reste absente.
 */
const LeadContactUpdateSchema = z.object({
  name: z.string().trim().max(120).optional(),
  phone: z.string().trim().max(40).optional(),
  email: z.union([z.literal(''), z.email().max(160)]).optional(),
});

export const LeadUpdateSchema = z.object({
  restaurantName: z.string().trim().min(1).max(160).optional(),
  contact: LeadContactUpdateSchema.optional(),
  stage: LeadStageSchema.optional(),
  sequence: LeadSequenceSchema.nullable().optional(),
  notes: z.string().trim().max(2_000).optional(),
  founderSeatReserved: z.boolean().optional(),
});
export type LeadUpdate = z.infer<typeof LeadUpdateSchema>;

export const LeadStageChangeSchema = z.object({ stage: LeadStageSchema });
export type LeadStageChange = z.infer<typeof LeadStageChangeSchema>;

export const LeadTouchCreateSchema = z.object({
  type: LeadTouchTypeSchema,
  note: z.string().trim().max(500).default(''),
  /** Relance saisie après coup — sinon « maintenant ». */
  at: z.coerce.date().optional(),
});
export type LeadTouchCreate = z.infer<typeof LeadTouchCreateSchema>;

export const LeadListQuerySchema = z.object({
  stage: LeadStageSchema.optional(),
});
export type LeadListQuery = z.infer<typeof LeadListQuerySchema>;

// ─── Sorties d'API ───

export type CrmLeadTouch = {
  at: string;
  type: LeadTouchType | string;
  note: string;
};

export type CrmLead = {
  _id: string;
  restaurantName: string;
  contact: LeadContact;
  stage: LeadStage;
  sequence: LeadSequence | null;
  touches: CrmLeadTouch[];
  founderSeatReserved: boolean;
  notes: string;
  createdAt: string;
  updatedAt: string;
  /** Dernière relance tracée — `null` si le lead n'a jamais été touché. */
  lastTouchAt: string | null;
};

export type CrmFounderSeats = {
  total: number;
  /** Places consommées : clients signés + places réservées dans le pipeline. */
  taken: number;
  remaining: number;
  /** Restaurants déjà clients avec le statut fondateur. */
  clients: number;
  /** Leads du pipeline qui tiennent une place au chaud. */
  reserved: number;
};

export type CrmOverview = {
  /** Compteur par étape — les six étapes sont toujours présentes, même à 0. */
  stages: Record<LeadStage, number>;
  leadsTotal: number;
  /** Leads ni signés ni perdus : ce qu'il reste à travailler. */
  leadsOpen: number;
  founderSeats: CrmFounderSeats;
  /** MRR estimé (CENTIMES) : somme des plans des clients actifs. */
  mrrCents: number;
  /** Nombre de restaurants clients (tous tenants confondus). */
  clients: number;
  /** Clients ayant encaissé au moins une commande sur 30 jours. */
  activeClients: number;
  /** Clients sans commande depuis `CLIENT_RISK_DAYS` jours. */
  atRiskClients: number;
  /** Commandes encaissées par le parc sur 30 jours. */
  orders30d: number;
  /** Fil des dernières relances, tous leads confondus. */
  recentTouches: (CrmLeadTouch & { leadId: string; restaurantName: string })[];
};

/**
 * Une ligne de la liste des clients.
 *
 * ─── POURQUOI ELLE PORTE LE SCORE ───
 *
 * La colonne « Santé » affichait un tiret : la route ne rendait ni score, ni
 * statut de compte, ni tendance, et l'écran compensait en rappelant
 * `/crm/tenants/:id/health` une fois PAR CLIENT après l'affichage. À dix
 * restaurants c'est un scintillement ; à cinquante, c'est cinquante requêtes
 * dont chacune journalise une consultation de dossier — l'équipe aurait
 * « ouvert » tout le parc sans avoir cliqué nulle part.
 *
 * Les cinq champs ci-dessous sont donc calculés EN UNE AGRÉGATION PAR CHAMP sur
 * tout le parc, avec les mêmes fonctions de jugement que la fiche : le score
 * qu'on lit dans la liste est celui qu'on retrouve en cliquant, au point près.
 */
export type CrmClient = {
  _id: string;
  name: string;
  slug: string;
  plan: 'essentiel' | 'complet' | 'boost';
  /** MRR estimé du client (CENTIMES), d'après son plan. */
  mrrCents: number;
  founderSeat: boolean;
  /** Date d'entrée dans le parc (création du tenant). */
  since: string;
  orders30d: number;
  /** CA encaissé sur 30 jours (CENTIMES) — commandes prêtes + remises. */
  revenue30dCents: number;
  lastOrderAt: string | null;
  daysSinceLastOrder: number | null;
  health: CrmClientHealth;
  /**
   * Statut commercial du compte — `suspended` signifie accès coupé, et c'est
   * l'information qui doit se lire AVANT d'appeler, pas après.
   */
  accountStatus: TenantAccountStatus;
  /** Score de santé composite 0-100, identique à celui de la fiche. */
  score: number;
  /** Commandes des 30 jours PRÉCÉDENTS — le socle de la tendance. */
  previousOrders: number;
  /**
   * Variation des commandes sur 30 j, en %. `null` quand la période de
   * référence ne pesait pas assez pour qu'un pourcentage veuille dire quelque
   * chose : un client arrivé le mois dernier n'a pas fait « +18 536 % ».
   */
  ordersDeltaPct: number | null;
  /** Appareils appairés sans réponse — une caisse muette se voit sans cliquer. */
  devicesOffline: number;
};
