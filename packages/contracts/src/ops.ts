import { z } from 'zod';

/**
 * EXPLOITATION — le journal d'erreurs de la plateforme.
 *
 * Décision du 24/08/2026 (diagnostic quatre casquettes, P0) : les erreurs ne
 * partent pas chez un tiers, elles rentrent À LA MAISON. Un filtre côté API et
 * un rapporteur minuscule dans chaque interface écrivent dans une collection
 * unique, regroupée par empreinte, lue sur l'écran /sm/erreurs. Zéro compte
 * externe, zéro clé à poser : le filet marche le jour du déploiement.
 *
 * Le rapport client est volontairement pauvre : un message, une pile, une URL,
 * une version. Jamais de données du restaurant, jamais rien du client final —
 * c'est un journal de pannes, pas de la télémétrie.
 */

export const CLIENT_ERROR_SOURCES = ['web', 'pos', 'kds'] as const;
export type ClientErrorSource = (typeof CLIENT_ERROR_SOURCES)[number];

/** L'API se rapporte elle-même via son filtre d'exceptions — jamais par HTTP. */
export const ERROR_SOURCES = ['api', ...CLIENT_ERROR_SOURCES] as const;
export type ErrorSource = (typeof ERROR_SOURCES)[number];

export const ERROR_SOURCE_LABELS: Record<ErrorSource, string> = {
  api: 'API',
  web: 'Web',
  pos: 'Caisse',
  kds: 'Écran cuisine',
};

export const ClientErrorReportSchema = z.object({
  source: z.enum(CLIENT_ERROR_SOURCES),
  message: z.string().trim().min(1).max(500),
  stack: z.string().max(6_000).default(''),
  url: z.string().max(300).default(''),
  appVersion: z.string().max(40).default(''),
});
export type ClientErrorReport = z.infer<typeof ClientErrorReportSchema>;

/** Une occurrence à journaliser — la forme que `OpsService.record` avale,
 *  d'où qu'elle vienne (filtre API, guichet public, constat de service). */
export type ErrorReport = {
  source: ErrorSource;
  message: string;
  stack?: string;
  url?: string;
  appVersion?: string;
};

/* ── Le tunnel de commande, en chiffres ───────────────────────── */

/**
 * QUATRE JALONS, PAS UN DE PLUS — le tunnel était totalement aveugle : on
 * vendait un module de commande en ligne sans pouvoir dire s'il convertit ni
 * où il perd les clients (diagnostic quatre casquettes, P2).
 *
 * Un jalon est ANONYME par construction : un slug d'établissement, une étape,
 * un canal. Ni identifiant de commande, ni panier, ni cookie — ce n'est pas
 * de la mesure d'audience, c'est un entonnoir de produit.
 */
export const FUNNEL_STEPS = ['visite', 'panier', 'coordonnees', 'commande'] as const;
export type FunnelStep = (typeof FUNNEL_STEPS)[number];

export const FUNNEL_STEP_LABELS: Record<FunnelStep, string> = {
  visite: 'Visites',
  panier: 'Paniers commencés',
  coordonnees: 'Coordonnées saisies',
  commande: 'Commandes passées',
};

/** Par où le client est entré — la page, le widget, ou un domaine propre. */
export const FUNNEL_CANALS = ['page', 'embed', 'domaine'] as const;
export type FunnelCanal = (typeof FUNNEL_CANALS)[number];

export const FunnelEventSchema = z.object({
  slug: z.string().trim().min(1).max(60),
  step: z.enum(FUNNEL_STEPS),
  canal: z.enum(FUNNEL_CANALS),
});
export type FunnelEvent = z.infer<typeof FunnelEventSchema>;

/** L'entonnoir d'un établissement, tel que l'écran le lit. */
export type OpsFunnelRow = {
  slug: string;
  steps: Record<FunnelStep, number>;
  /** commandes / visites, en pourcentage entier — null sans visite. */
  conversionPct: number | null;
};

/** Un groupe d'erreurs tel que l'écran /sm/erreurs le lit. */
export type OpsErrorGroup = {
  _id: string;
  source: ErrorSource;
  message: string;
  count: number;
  firstAt: string;
  lastAt: string;
  /** null = pas encore vue par l'équipe — c'est le tri de l'écran. */
  seenAt: string | null;
  stack: string;
  url: string;
  appVersion: string;
};
