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

/**
 * LA FORMULE EST DEVENUE UN CHOIX, PAS UN PRÉALABLE.
 *
 * Depuis l'Atelier, un restaurateur peut n'acheter QUE le site, QUE les
 * réseaux sociaux ou QUE le module de commande en ligne greffé sur son site :
 * la proposition (et la signature) portent alors `plan: null`, et chaque
 * service se cite seul, comme un produit. `null` et non une pseudo-formule
 * « aucune » dans l'énumération : une valeur de plus contaminerait la grille
 * (`PLAN_MRR_CENTS`), la facturation et tous les écrans qui la déroulent.
 */
export type PlanChoice = keyof typeof PLAN_MRR_CENTS | null;

export const PLAN_NONE_LABEL = 'Sans formule — services seuls';
/** La même absence, en pastille courte (listes, cartes du pipeline). */
export const PLAN_NONE_SHORT_LABEL = 'Atelier seul';

export const planChoiceLabel = (plan: PlanChoice): string =>
  plan ? PLAN_LABELS[plan] : PLAN_NONE_LABEL;

/* ── L'Atelier — les services d'agence, au catalogue ──── */

/**
 * Au-delà du logiciel, l'équipe vend du TRAVAIL : site vitrine maquetté,
 * identité visuelle, fiche Google tenue, réseaux sociaux animés. Étalonnage
 * du 24/08/2026 sur les prix publics du marché français (agences restauration
 * 950-1 590 € le site, fiche Google gérée 49-150 €/mois, community management
 * 250-600 €/mois) : nos prix se placent SOUS les agences et AU-DESSUS des
 * robots, tenables parce que l'outillage est mutualisé avec le SaaS.
 *
 * Deux natures, deux règles :
 * - les PONCTUELS se paient une fois, à la mise en chantier ;
 * - les MENSUELS sont SANS ENGAGEMENT et ne sont jamais annualisés : la
 *   remise « douze mois payés dix » ne porte que sur le logiciel — un
 *   service humain résiliable à tout moment ne se paie pas d'avance.
 */
export const ATELIER_ONCE_KEYS = [
  'siteVitrine',
  'refonteSite',
  'identiteVisuelle',
  'integrationCommande',
] as const;
export type AtelierOnceKey = (typeof ATELIER_ONCE_KEYS)[number];

export const ATELIER_ONCE_CENTS: Record<AtelierOnceKey, number> = {
  siteVitrine: 69_000,
  refonteSite: 99_000,
  identiteVisuelle: 39_000,
  integrationCommande: 19_000,
};

export const ATELIER_ONCE_LABELS: Record<AtelierOnceKey, string> = {
  siteVitrine: 'Site vitrine clé en main — maquette sur mesure, contenus, référencement local',
  refonteSite: 'Refonte du site existant — reprise complète, maquette validée avant chantier',
  identiteVisuelle: 'Identité visuelle — logo, couleurs, déclinaisons (tickets, vitrine, réseaux)',
  integrationCommande:
    'Intégration de la commande en ligne sur votre site existant — mise en service du module comprise',
};

/** Présence internet : fiche Google tenue, avis répondus, rapport mensuel. */
export const ATELIER_PRESENCE_CENTS = 6_900;
export const ATELIER_PRESENCE_LABEL =
  'Présence internet — fiche Google tenue, réponse aux avis, rapport mensuel';

/**
 * Réseaux sociaux : le prix est piloté par la CADENCE de publication — c'est
 * la règle observée chez tous les prestataires. Au-delà de deux publications
 * par semaine (vidéo, shooting sur place, campagnes) : sur devis, hors grille.
 */
export const SOCIAL_CADENCES = ['hebdo', 'bihebdo'] as const;
export type SocialCadence = (typeof SOCIAL_CADENCES)[number];

export const SOCIAL_CADENCE_CENTS: Record<SocialCadence, number> = {
  hebdo: 14_900,
  bihebdo: 24_900,
};

export const SOCIAL_CADENCE_LABELS: Record<SocialCadence, string> = {
  hebdo: 'Réseaux sociaux — une publication par semaine, visuels compris',
  bihebdo: 'Réseaux sociaux — deux publications par semaine, visuels compris',
};

/* ── La proposition — ce qu'on a réellement mis sur la table ──── */

/**
 * L'étape « Proposition » du pipeline disait qu'UNE proposition existait,
 * jamais LAQUELLE : le plan, le module et l'engagement discutés ne vivaient
 * que dans la mémoire du commercial (et nous sommes deux). La proposition
 * devient un objet du lead : posée à l'étape, relue à chaque appel, et
 * reprise telle quelle au moment de signer — le panneau de conversion s'en
 * pré-remplit au lieu de redemander ce qui a déjà été négocié.
 *
 * Les PRIX ne s'y stockent pas : ils se DÉRIVENT de la grille
 * (`PLAN_MRR_CENTS`, `MODULE_ORDERING_CENTS`) par `proposalCents`. Une
 * proposition qui figerait ses montants divergerait de la grille au premier
 * changement de tarif — et on ne saurait plus laquelle des deux ment.
 * Le jour où une remise libre se négocie vraiment, elle entrera ici comme
 * un champ explicite, pas comme un prix recopié.
 */
export const PROPOSAL_BILLINGS = ['mensuel', 'annuel'] as const;
export type ProposalBilling = (typeof PROPOSAL_BILLINGS)[number];

export const PROPOSAL_BILLING_LABELS: Record<ProposalBilling, string> = {
  mensuel: 'Mensuel',
  annuel: 'Annuel — deux mois offerts',
};

/**
 * Les services de l'Atelier retenus dans une proposition. Création et refonte
 * de site s'excluent : on ne fabrique pas un site neuf ET une reprise de
 * l'ancien pour le même établissement.
 */
export const LeadServicesSchema = z
  .object({
    siteVitrine: z.boolean().default(false),
    refonteSite: z.boolean().default(false),
    identiteVisuelle: z.boolean().default(false),
    integrationCommande: z.boolean().default(false),
    presenceInternet: z.boolean().default(false),
    reseauxSociaux: z.enum(SOCIAL_CADENCES).nullable().default(null),
  })
  .refine((s) => !(s.siteVitrine && s.refonteSite), {
    message: 'Site neuf OU refonte — pas les deux sur la même proposition.',
  });
export type LeadServices = z.infer<typeof LeadServicesSchema>;

export const EMPTY_SERVICES: LeadServices = {
  siteVitrine: false,
  refonteSite: false,
  identiteVisuelle: false,
  integrationCommande: false,
  presenceInternet: false,
  reseauxSociaux: null,
};

/**
 * L'intégration sur site existant greffe NOTRE module : la vendre sans le
 * module mensuel qui la fait vivre serait un devis incohérent — 190 € pour
 * brancher un service auquel le client ne serait pas abonné. Vérifié ici,
 * à la proposition COMME à la signature.
 */
const integrationExigeLeModule = (
  p: { plan: string | null; onlineOrdering: boolean; services: LeadServices },
  ctx: z.RefinementCtx,
): void => {
  if (p.services.integrationCommande && !p.onlineOrdering && p.plan !== 'boost') {
    ctx.addIssue({
      code: 'custom',
      path: ['services', 'integrationCommande'],
      message: 'L’intégration sur site existant exige le module commande en ligne (ou Boost).',
    });
  }
};

/**
 * Sans formule, sans module et sans aucun service, il n'y a rien à chiffrer,
 * rien à imprimer, rien à signer : refusé ici, à la proposition COMME à la
 * signature — plutôt qu'un devis vide entre les mains du prospect.
 */
const propositionNonVide = (
  p: { plan: string | null; onlineOrdering: boolean; services: LeadServices },
  ctx: z.RefinementCtx,
): void => {
  const unService =
    ATELIER_ONCE_KEYS.some((cle) => p.services[cle]) ||
    p.services.presenceInternet ||
    p.services.reseauxSociaux !== null;
  if (p.plan === null && !p.onlineOrdering && !unService) {
    ctx.addIssue({
      code: 'custom',
      path: ['plan'],
      message: 'Rien sur la table : choisissez une formule, le module ou au moins un service.',
    });
  }
};

export const LeadProposalSchema = z
  .object({
    /** `null` = aucune formule — le prospect n'achète que des services. */
    plan: z.enum(['essentiel', 'complet', 'boost']).nullable(),
    /** Module commande en ligne — sans objet sur Boost, qui le comprend. */
    onlineOrdering: z.boolean().default(false),
    billing: z.enum(PROPOSAL_BILLINGS).default('mensuel'),
    /** L'Atelier — les services retenus, avec ou sans le logiciel. */
    services: LeadServicesSchema.default(EMPTY_SERVICES),
    /** Ce qui s'est dit et ne rentre pas dans les cases — « attend son associé ». */
    note: z.string().trim().max(500).default(''),
  })
  .superRefine(integrationExigeLeModule)
  .superRefine(propositionNonVide);
export type LeadProposal = z.infer<typeof LeadProposalSchema>;

/** La proposition telle que servie — datée du jour où elle a été posée. */
export type CrmLeadProposal = LeadProposal & { at: string };

/** Le chiffrage des seuls services de l'Atelier — composable et testable seul. */
export function servicesCents(services: LeadServices): {
  monthlyCents: number;
  onceCents: number;
} {
  let monthly = services.presenceInternet ? ATELIER_PRESENCE_CENTS : 0;
  if (services.reseauxSociaux) monthly += SOCIAL_CADENCE_CENTS[services.reseauxSociaux];
  const once = ATELIER_ONCE_KEYS.reduce(
    (somme, cle) => somme + (services[cle] ? ATELIER_ONCE_CENTS[cle] : 0),
    0,
  );
  return { monthlyCents: monthly, onceCents: once };
}

/**
 * Le chiffrage d'une proposition, depuis la grille — jamais saisi à la main.
 * Sur Boost le module est compris : ni mensualité ni mise en service en plus,
 * même si la case a été cochée par réflexe.
 *
 * `monthlyCents` reste le LOGICIEL seul (formule + module) : c'est lui que
 * l'engagement annuel remise (douze mois payés dix) — et il vaut 0 quand la
 * proposition ne vend que des services. Les mensuels de l'Atelier sortent à
 * part (`servicesMonthlyCents`) — sans engagement, ils ne s'annualisent
 * jamais. Les ponctuels de l'Atelier rejoignent `setupOnceCents`.
 */
export function proposalCents(
  p: Pick<LeadProposal, 'plan' | 'onlineOrdering'> & { services?: LeadServices },
): {
  monthlyCents: number;
  servicesMonthlyCents: number;
  setupOnceCents: number;
} {
  const services = p.services ?? EMPTY_SERVICES;
  const moduleFacture = p.onlineOrdering && p.plan !== 'boost';
  // L'intégration sur site existant COMPREND la mise en service du module :
  // facturer les deux serait payer deux fois le même branchement.
  const miseEnService = moduleFacture && !services.integrationCommande;
  const atelier = servicesCents(services);
  return {
    monthlyCents:
      (p.plan ? PLAN_MRR_CENTS[p.plan] : 0) + (moduleFacture ? MODULE_ORDERING_CENTS : 0),
    servicesMonthlyCents: atelier.monthlyCents,
    setupOnceCents: (miseEnService ? MODULE_ORDERING_SETUP_CENTS : 0) + atelier.onceCents,
  };
}

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
  /** Poser ou remplacer la proposition ; `null` la retire. Datée côté API. */
  proposal: LeadProposalSchema.nullable().optional(),
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

/**
 * SIGNER : convertir un lead en restaurant, en un geste.
 *
 * Jusqu'au 24/08/2026, il n'existait AUCUNE route pour créer un tenant : une
 * signature se soldait par des écritures Mongo à la main et un script CLI
 * contre la production (diagnostic quatre casquettes, P1). Ce contrat est la
 * chaîne entière d'une installation : le restaurant, le compte gérant, la
 * place fondateur, l'échéance d'essai — et un mot de passe remis UNE fois.
 */
export const LeadConvertSchema = z
  .object({
    /** Le slug public — `<slug>.snackmanager.app`, la carte, la caisse. */
    slug: z
      .string()
      .trim()
      .toLowerCase()
      .regex(/^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/, 'Slug invalide (a-z, 0-9, tirets)'),
    ownerEmail: z.email().max(160),
    ownerName: z.string().trim().max(120).default(''),
    /** `null` = signé sans formule — le client n'achète que des services. */
    plan: z.enum(['essentiel', 'complet', 'boost']).nullable().default('essentiel'),
    founderSeat: z.boolean().default(false),
    /**
     * Les termes SIGNÉS — pré-remplis depuis la proposition par l'écran, mais
     * c'est bien ce qui part ici qui fait foi : ce qui a changé au moment de
     * signer (un module retiré, un passage à l'annuel) doit gagner sur ce qui
     * avait été proposé. Les premières factures s'en dérivent.
     */
    onlineOrdering: z.boolean().default(false),
    billing: z.enum(PROPOSAL_BILLINGS).default('mensuel'),
    /** L'Atelier signé — mêmes règles que la proposition, même primauté du signé. */
    services: LeadServicesSchema.default(EMPTY_SERVICES),
  })
  .superRefine(integrationExigeLeModule)
  .superRefine(propositionNonVide);
export type LeadConvert = z.infer<typeof LeadConvertSchema>;

/* ── « Qui je relance aujourd'hui ? » ─────────────────────────── */

/**
 * Cadence de relance par séquence — le délai au-delà duquel un lead SANS
 * nouvelle touche est « à relancer ». Dérivée des séquences elles-mêmes :
 * A appelle à J+3 (le pas le plus serré après la démo), B revient à J+7,
 * C est un nurture mensuel. Sans séquence, la semaine est la bonne unité
 * d'un pipeline de terrain.
 *
 * Volontairement une CADENCE et pas un suivi d'étapes : le modèle ne sait
 * pas quelle étape de séquence est faite (les touches ne pointent pas les
 * étapes), et prétendre le savoir afficherait des échéances fausses. Une
 * cadence dit une chose vraie : « ça fait N jours qu'on n'a rien fait ».
 */
export const RELANCE_CADENCE_DAYS: Record<LeadSequence, number> = { A: 3, B: 7, C: 30 };
export const RELANCE_DEFAULT_DAYS = 7;

export type RelanceDue = {
  due: boolean;
  /** Jours AU-DELÀ de la cadence — 0 le jour même de l'échéance. */
  retardJours: number;
};

export function relanceDue(
  lead: Pick<CrmLead, 'stage' | 'sequence' | 'lastTouchAt' | 'createdAt'>,
  now: Date,
): RelanceDue {
  // Signé ou perdu : plus rien à relancer, quel que soit le silence.
  if (!isOpenLeadStage(lead.stage)) return { due: false, retardJours: 0 };
  const cadence = lead.sequence ? RELANCE_CADENCE_DAYS[lead.sequence] : RELANCE_DEFAULT_DAYS;
  // Jamais touché : l'horloge court depuis l'entrée au pipeline.
  const reference = new Date(lead.lastTouchAt ?? lead.createdAt).getTime();
  if (Number.isNaN(reference)) return { due: false, retardJours: 0 };
  const silence = Math.floor((now.getTime() - reference) / 86_400_000);
  return { due: silence >= cadence, retardJours: Math.max(0, silence - cadence) };
}

export type LeadConversion = {
  tenantId: string;
  slug: string;
  name: string;
  ownerEmail: string;
  /**
   * Remis UNE SEULE FOIS, à l'écran, au moment de la conversion. Il n'est
   * stocké qu'en empreinte : aucune route ne sait le relire. Perdu = geste
   * « réinitialiser le mot de passe » sur la fiche client.
   */
  password: string;
  /** ISO 8601 — posée à J+30, lue par le signal de fin d'essai. */
  trialEndsAt: string;
  /**
   * Brouillons de facture posés dans Facturation à partir des termes signés
   * (abonnement, et mise en service du module le cas échéant) — datés de la
   * fin d'essai, à émettre d'un geste le moment venu. `0` si la facturation
   * n'a pas pu les poser : la signature, elle, n'échoue jamais pour ça.
   */
  draftInvoices: number;
};

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
  /** La proposition sur la table — `null` tant que rien n'a été posé. */
  proposal: CrmLeadProposal | null;
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
  /** `null` = client Atelier seul — aucun abonnement logiciel. */
  plan: 'essentiel' | 'complet' | 'boost' | null;
  /** MRR estimé du client (CENTIMES), d'après son plan — 0 sans formule. */
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
