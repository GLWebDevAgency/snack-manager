import type { AdminPlan, RevocableDeviceKind, TenantAccountStatus } from './admin';
import type { CrmClientHealth } from './crm';

// ─────────────────────────────────────────────────────────────
// LA FICHE DE SANTÉ ET LE CONSEIL CHIFFRÉ — ce que l'équipe lit juste avant de
// décrocher son téléphone.
//
// C'est le contrat de `GET /crm/tenants/:id/health` (servi par `HealthService`)
// et de `GET /crm/tenants/:id/insights` (servi par `InsightsService`), affichés
// par la fiche client `/sm/clients/[id]`. Publié pour la même raison que
// `signals.ts` : ces deux routes ont vécu sans contrat, et l'écran les relisait
// à la main avec des lecteurs défensifs qui DEVINAIENT une forme — plate là où
// l'API rend des fenêtres imbriquées, des listes là où elle rend des compteurs.
// Résultat constaté à l'audit : des sections entières qui ne se peuplaient
// JAMAIS, sans qu'aucun typecheck ne le dise. Le producteur type sa sortie avec
// ces types, tout écran qui lit ces routes type son entrée avec les mêmes : la
// prochaine divergence casse la compilation, pas la fiche un lundi matin.
//
// CE QUI EST PUBLIÉ ICI est la forme RÉELLEMENT construite par
// `health.service.ts` et `insights.service.ts`, pas une forme souhaitée.
//
// ─── RESPECT DES CLIENTS DE NOS CLIENTS ───
//
// Ces deux routes ne portent que des AGRÉGATS d'établissement : comptages,
// sommes, dates, pourcentages, noms d'ingrédients et de produits. Jamais le
// nom, le téléphone ou l'e-mail d'un consommateur final — aucun champ de ce
// fichier n'en prévoit un, et c'est une règle de conception, pas un oubli.
//
// Rappel de convention : tous les montants circulent en CENTIMES (int).
// ─────────────────────────────────────────────────────────────

// ─── Le score composite et ses axes ───

/** Les quatre axes du score — leurs poids et libellés restent côté API. */
export type CrmHealthAxisKey = 'activite' | 'adoption' | 'technique' | 'paiement';

export type CrmHealthAxis = {
  key: CrmHealthAxisKey;
  /** Libellé français résolu une fois côté API (« Activité », « Paiement »…). */
  label: string;
  /** Poids de l'axe dans le score composite (somme des quatre = 100). */
  weight: number;
  /**
   * `false` quand la donnée manque : l'axe est alors RETIRÉ du calcul, jamais
   * noté zéro — un restaurant signé hier n'est pas un restaurant qui meurt.
   */
  measured: boolean;
  /** Note de l'axe sur 100 — `null` si non mesuré. */
  score: number | null;
  /** Une phrase qui explique la note, chiffres à l'appui. */
  detail: string;
};

export type CrmHealthVerdict = 'solide' | 'correct' | 'fragile' | 'critique';

export type CrmHealthScore = {
  /** Score composite sur 100 — la moyenne pondérée, sans correctif. */
  value: number;
  /**
   * Le verdict est TRANCHÉ par l'API et ne se déduit pas de `value` : il peut
   * être plafonné par l'axe activité quand la moyenne est plus flatteuse que
   * lui. Un écran qui le recalculerait afficherait « correct » sur le client
   * effondré que ce plafond sert précisément à faire rappeler.
   */
  verdict: CrmHealthVerdict;
  verdictLabel: string;
  /** Axe qui a plafonné le verdict — `null` la plupart du temps. */
  cappedBy: CrmHealthAxisKey | null;
  axes: CrmHealthAxis[];
};

// ─── L'activité comparée ───

/**
 * Une fenêtre GLISSANTE comparée à la fenêtre de même durée qui la précède.
 *
 * `ordersDeltaPct` / `revenueDeltaPct` à `null` sont un REFUS, pas une absence :
 * l'API ne chiffre pas une tendance quand la période de référence ne pesait pas
 * assez (« +18 536 % » mesure l'arrivée d'un client, pas sa tendance). Un écran
 * ne doit JAMAIS recalculer ce pourcentage localement à partir des comptages —
 * il réafficherait exactement le chiffre que l'API a refusé d'écrire.
 */
export type CrmActivityWindow = {
  days: number;
  orders: number;
  revenueCents: number;
  /** Panier moyen de la fenêtre — un agrégat, jamais un ticket nominatif. */
  avgBasketCents: number;
  /** Même durée, juste avant — la seule comparaison honnête. */
  previousOrders: number;
  previousRevenueCents: number;
  ordersDeltaPct: number | null;
  revenueDeltaPct: number | null;
};

/**
 * Le bloc activité de la fiche : DEUX fenêtres IMBRIQUÉES (7 et 30 jours),
 * jamais des compteurs à plat. C'est la forme que l'ancien lecteur web devinait
 * mal — il cherchait `orders`/`revenue` à la racine et laissait le bloc vide.
 * Il n'y a PAS de série jour par jour ici : la route ne la calcule pas, et un
 * graphique qui l'attendrait resterait vide à jamais.
 */
export type CrmTenantActivity = {
  last7d: CrmActivityWindow;
  last30d: CrmActivityWindow;
  lastOrderAt: string | null;
  daysSinceLastOrder: number | null;
  /** La pastille de santé « commande » — même règle que la liste des clients. */
  health: CrmClientHealth;
  healthLabel: string;
};

// ─── L'adoption des modules ───

export type CrmModuleKey =
  | 'caisse'
  | 'cuisine'
  | 'commande_en_ligne'
  | 'ecrans_salle'
  | 'stocks';

/**
 * LIMITE ASSUMÉE, la même que `CRM_SIGNAL_LIMITS.module_dormant` : `provisioned`
 * dit qu'un module est OUVERT chez ce client (matériel appairé, surface en
 * service) — jamais qu'il est FACTURÉ. Aucune correspondance formule → modules
 * n'existe (`docs/specs/contraintes-business.md` §6.2 la laisse « à définir ») :
 * un écran qui écrirait « vous payez pour ça » affirmerait une déduction fausse
 * sur une partie du parc. « Ouvert, jamais utilisé » est tout ce que la donnée
 * permet de dire, et c'est déjà le sujet d'appel.
 */
export type CrmModuleAdoption = {
  key: CrmModuleKey;
  label: string;
  /** Le module est OUVERT chez ce client — pas « facturé », voir ci-dessus. */
  provisioned: boolean;
  /** Il sert VRAIMENT : une commande passée, un battement de cœur reçu. */
  used: boolean;
  lastUsedAt: string | null;
  /** Une phrase chiffrée, rédigée par l'API — elle porte les volumes. */
  detail: string;
};

// ─── Le parc d'appareils ───

export type CrmFleetUnit = {
  id: string;
  name: string;
  kind: RevocableDeviceKind;
  kindLabel: string;
  /** Appairé : un appareil révoqué repart en attente de code. */
  paired: boolean;
  online: boolean;
  lastSeenAt: string | null;
  /** État rédigé côté API (« Hors ligne depuis 3 h ») — pas de calcul à refaire. */
  statusLabel: string;
  /** Télémétrie du dernier battement — vide sur les écrans de salle. */
  appVersion: string;
  queueDepth: number | null;
  lastError: string;
};

export type CrmFleet = {
  units: CrmFleetUnit[];
  total: number;
  online: number;
  offline: number;
  /** Appairés mais jamais vus : installés puis abandonnés. */
  neverSeen: number;
};

// ─── L'approvisionnement ───

export type CrmSupplyPriceIncrease = {
  ingredientName: string;
  supplierName: string;
  previousPriceCents: number;
  packPriceCents: number;
  increasePct: number;
};

/**
 * L'appro de la fiche est faite de COMPTEURS, pas de listes d'alertes — seule
 * `topPriceIncreases` détaille (les trois plus fortes hausses). C'est le
 * deuxième point que l'ancien lecteur web devinait à l'envers : il attendait
 * des listes nommées et affichait « aucune rupture » devant des compteurs
 * pleins.
 *
 * `available: false` = le contexte supply (PostgreSQL) était injoignable. Les
 * compteurs valent alors zéro SANS rien dire du stock réel : un écran doit
 * afficher « indisponible », jamais « rien à signaler » — dire à un gérant que
 * son stock est bon pendant une panne, c'est lui mentir.
 */
export type CrmSupplyHealth = {
  available: boolean;
  belowPar: number;
  ruptures: number;
  priceIncreases30d: number;
  topPriceIncreases: CrmSupplyPriceIncrease[];
  /** Ingrédients ACTIFS suivis par ce restaurant — le registre est-il monté ? */
  ingredients: number;
  suppliers: number;
  /** Mouvements de stock enregistrés depuis toujours — le registre vit-il ? */
  movements: number;
  movements30d: number;
  lastMovementAt: string | null;
};

// ─── La fiche complète ───

/** La réponse de `GET /crm/tenants/:id/health`, telle que l'API la rend. */
export type CrmTenantHealth = {
  tenantId: string;
  name: string;
  slug: string;
  plan: AdminPlan;
  planLabel: string;
  founderSeat: boolean;
  /** Entrée dans le parc. */
  since: string;
  account: {
    status: TenantAccountStatus;
    statusLabel: string;
    accessBlocked: boolean;
    since: string;
    reason: string;
  };
  activity: CrmTenantActivity;
  score: CrmHealthScore;
  modules: CrmModuleAdoption[];
  fleet: CrmFleet;
  supply: CrmSupplyHealth;
  computedAt: string;
};

// ─────────────────────────────────────────────────────────────
// Le conseil chiffré — `GET /crm/tenants/:id/insights`
// ─────────────────────────────────────────────────────────────

/**
 * L'unité de `value` sur une recommandation. `centimes` rappelle la convention
 * maison : le montant est un ENTIER de centimes, jamais un décimal d'euros.
 */
export type CrmInsightUnit = 'pourcent' | 'points' | 'centimes' | 'commandes' | 'produits';

/**
 * Trois niveaux, avec le vocabulaire du producteur (`urgent`, pas `critique`) :
 * on publie ce que la route REND, pas ce qu'un écran préférerait lire. La
 * projection vers les trois bandes de la file de travail appartient à l'écran.
 */
export type CrmInsightSeverity = 'info' | 'attention' | 'urgent';

/**
 * Une recommandation : un intitulé, une explication d'UNE phrase, un chiffre.
 *
 * `value` est un NOMBRE et `unit` dit comment le lire — il n'y a ni chaîne
 * pré-formatée, ni champ `benchmark`, ni gain mensuel estimé : la médiane du
 * réseau et les montants sont DANS `detail`, rédigés par l'API qui seule
 * connaît le panel. L'écran qui attendait ces champs-là affichait du vide.
 */
export type CrmInsight = {
  /** Clé stable, pour cibler un conseil sans lire le texte. */
  key: string;
  title: string;
  detail: string;
  value: number;
  unit: CrmInsightUnit;
  severity: CrmInsightSeverity;
};

export type CrmFoodCostBenchmark = {
  /** `false` = donnée insuffisante ; aucun conseil n'en est tiré. */
  available: boolean;
  /** Coût matière du restaurant, en % du CA des lignes couvertes. */
  tenantPct: number | null;
  /** Médiane du réseau, anonymisée. `null` si le panel est trop petit. */
  networkMedianPct: number | null;
  /** Taille du panel — le SEUL chiffre qu'on dit du réseau : jamais le nom, le
   *  rang ni le ratio d'un autre restaurant. */
  panel: number;
  /** Écart en POINTS de pourcentage (positif = ce client coûte plus cher). */
  deltaPoints: number | null;
  costCents: number;
  revenueCents: number;
  /** Part du CA couverte par une recette saisie. */
  coveragePct: number;
};

export type CrmQuietSlot = {
  hour: number;
  label: string;
  orders: number;
  /** Moyenne du restaurant sur sa propre amplitude de service. */
  averageOrders: number;
  /** De combien de % cette heure est en dessous de cette moyenne. */
  gapPct: number;
};

export type CrmProductMargin = {
  productId: string;
  name: string;
  qty: number;
  revenueCents: number;
  costCents: number;
  /** Marge matière sur toute la fenêtre — la base de « marge faible ». */
  marginPct: number;
  /** Marge de la quinzaine récente — `null` si le volume était trop faible. */
  recentMarginPct: number | null;
  /** Marge de la quinzaine précédente, mêmes conditions de volume. */
  previousMarginPct: number | null;
  /** Points de marge perdus d'une quinzaine à l'autre (positif = recul). */
  marginDropPoints: number | null;
};

export type CrmStockoutLoss = {
  productId: string;
  name: string;
  /** Unités vendues par jour de service, avant la coupure. */
  qtyPerDay: number;
  /** Manque à gagner estimé par jour de rupture, en CENTIMES. */
  lossPerDayCents: number;
  /** Ce qui a coupé le produit : rupture d'ingrédient, ou coupure au comptoir. */
  cause: 'ingredient' | 'manuel';
};

/**
 * La réponse de `GET /crm/tenants/:id/insights`.
 *
 * `recommendations` peut sortir VIDE, et c'est un comportement voulu : quand la
 * donnée ne permet rien d'honnête (pas de recette saisie, panel trop petit,
 * volume insuffisant), la route ne dit rien plutôt que n'importe quoi.
 */
export type CrmTenantInsights = {
  tenantId: string;
  name: string;
  windowDays: number;
  /** Jours où le restaurant a réellement servi sur la fenêtre. */
  serviceDays: number;
  foodCost: CrmFoodCostBenchmark;
  quietSlots: CrmQuietSlot[];
  lowMarginProducts: CrmProductMargin[];
  fallingMarginProducts: CrmProductMargin[];
  stockoutLosses: {
    products: CrmStockoutLoss[];
    totalPerDayCents: number;
  };
  /** Ce qu'on dit au restaurateur. Vide si la donnée ne permet rien. */
  recommendations: CrmInsight[];
  computedAt: string;
};
