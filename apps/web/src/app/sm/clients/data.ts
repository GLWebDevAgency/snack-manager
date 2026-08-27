"use client";

/**
 * DONNÉES DU POSTE DE PILOTAGE CLIENT — back-office INTERNE Snack Manager.
 *
 * ─── Cloisonnement ───
 * Tout ce qui est lu ici traverse le parc entier (`/crm/*`, rôle `sm_admin`).
 * La garde qui compte est côté API ; la coquille `/sm` renvoie en plus un
 * gérant chez lui avant même qu'il voie clignoter cet écran.
 *
 * ─── Respect des clients de nos clients ───
 * Aucun type de ce fichier ne porte le nom, le téléphone ou l'e-mail d'un
 * CONSOMMATEUR. Ce qui remonte, ce sont des états de compte et des AGRÉGATS :
 * nombre de commandes, chiffre d'affaires, panier moyen, créneaux. Le fichier
 * client d'un restaurateur lui appartient — le détenir nous rendrait
 * responsables de sa protection sans qu'aucune décision d'administration ne
 * l'exige. C'est un choix d'architecture, pas un oubli : si une route amont se
 * met un jour à renvoyer des consommateurs nominativement, ce fichier ne doit
 * pas les lire.
 *
 * ─── Ce qui est TYPÉ et ce qui reste lu défensivement ───
 * `/crm/signals`, `/crm/tenants/:id/health` et `/crm/tenants/:id/insights` SONT
 * publiés : `CrmQueueSignal`, `CrmTenantHealth` et `CrmTenantInsights` vivent
 * dans `@sm/contracts` et ces trois routes se lisent avec leurs types, plus une
 * ligne de devinette. C'est la leçon de l'audit du 24/08/2026 : les lecteurs
 * défensifs de `/health` et `/insights` DEVINAIENT une forme que l'API ne
 * rendait pas (activité cherchée à plat, appro attendue en listes, champs
 * `included`/`benchmark` jamais envoyés) et des sections entières restaient
 * vides sans qu'aucun typecheck ne le dise. Un champ ajouté ou renommé casse
 * maintenant la compilation des deux côtés — c'est exactement le but.
 *
 * Seules les routes SANS contrat (`/crm/tenants`, `/account`, `/logs`) restent
 * lues défensivement. La règle de tolérance, elle, ne change pas : une réponse
 * absente ou méconnaissable vaut section INDISPONIBLE — jamais un écran blanc,
 * jamais une exception jusqu'au rendu.
 *
 * Rappel de convention : tous les montants circulent en CENTIMES (int).
 */

import {
  CLIENT_HEALTHS,
  CRM_SIGNAL_KIND_LABELS,
  CRM_SIGNAL_SEVERITIES,
  CRM_SIGNAL_SEVERITY_LABELS,
  CRM_SIGNAL_SEVERITY_RANK,
  clientHealth,
  type AdminLogEntry,
  type AdminPlan,
  type LeadServices,
  type ProposalBilling,
  type AdminTenantAccount,
  type CrmActivityWindow,
  type CrmClient,
  type CrmClientHealth,
  type CrmFleetUnit,
  type CrmHealthAxis,
  type CrmInsight,
  type CrmInsightSeverity,
  type CrmInsightUnit,
  type CrmModuleAdoption,
  type CrmQueueSignal,
  type CrmSignalSeverity,
  type CrmSignalUnit,
  type CrmSupplyHealth,
  type CrmTenantActivity,
  type CrmTenantHealth,
  type CrmTenantInsights,
  type DeviceRevoke,
  type RevocableDeviceKind,
  type TenantAccountStatus,
} from "@sm/contracts";
import { api, ApiError } from "@/lib/api";

// ─────────────────────────────────────────────────────────────
// Lecteurs tolérants
// ─────────────────────────────────────────────────────────────

type Bag = Record<string, unknown>;

const bag = (v: unknown): Bag =>
  v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Bag) : {};

const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

/** Première clé présente et non vide, sinon `""`. */
function str(source: unknown, ...keys: string[]): string {
  const o = bag(source);
  for (const k of keys) {
    const v = o[k];
    if (typeof v === "string" && v.trim() !== "") return v.trim();
    if (typeof v === "number" && Number.isFinite(v)) return String(v);
  }
  return "";
}

/** Première clé numériquement exploitable, sinon `null`. */
function num(source: unknown, ...keys: string[]): number | null {
  const o = bag(source);
  for (const k of keys) {
    const v = o[k];
    if (typeof v === "number" && Number.isFinite(v)) return v;
    // Une API qui renvoie « 34.7 » en chaîne reste lisible : on ne perd pas un
    // food cost pour un souci de sérialisation.
    if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) {
      return Number(v);
    }
  }
  return null;
}

function bool(source: unknown, ...keys: string[]): boolean | null {
  const o = bag(source);
  for (const k of keys) {
    const v = o[k];
    if (typeof v === "boolean") return v;
  }
  return null;
}

/** Date ISO exploitable, sinon `null` — une date invalide vaut une absence. */
function iso(source: unknown, ...keys: string[]): string | null {
  const raw = str(source, ...keys);
  if (!raw) return null;
  return Number.isNaN(new Date(raw).getTime()) ? null : raw;
}

/** Descend dans un objet imbriqué : `dig(x, "activity", "orders")`. */
function dig(source: unknown, ...path: string[]): unknown {
  let cur: unknown = source;
  for (const k of path) {
    if (cur === null || typeof cur !== "object") return undefined;
    cur = (cur as Bag)[k];
  }
  return cur;
}

/**
 * Première branche non vide parmi plusieurs chemins.
 *
 * Réservé aux routes SANS contrat (liste des clients, journal), dont la racine
 * a porté plusieurs noms au fil des versions (`items`, `clients`, `entries`…).
 */
function firstList(...candidates: unknown[]): unknown[] {
  for (const c of candidates) {
    const arr = list(c);
    if (arr.length > 0) return arr;
  }
  return [];
}

// ─────────────────────────────────────────────────────────────
// Modèles de vue
// ─────────────────────────────────────────────────────────────

/**
 * TROIS GRAVITÉS, et elles viennent du CONTRAT.
 *
 * `@sm/contracts` publie la bande, son libellé français et l'ordre d'appel avec
 * la file elle-même. On les reprend au lieu de les redéclarer : l'API TRANCHE la
 * bande (`severity`) — elle ne se déduit pas du chiffre `gravity`, un essai qui
 * s'achève sort à 40 en « critique » et un appareil muet à 60 en « à
 * surveiller ». Deux tables parallèles finiraient par donner deux sens à
 * « critique » selon la page d'où l'on vient.
 */
export const SIGNAL_SEVERITIES = CRM_SIGNAL_SEVERITIES;
export type SignalSeverity = CrmSignalSeverity;

export const SIGNAL_SEVERITY_LABELS: Record<SignalSeverity, string> =
  CRM_SIGNAL_SEVERITY_LABELS;

/**
 * Ce que chaque gravité veut dire pour l'équipe. Écrit ici plutôt que dans la
 * page : c'est une règle de travail, pas une décoration.
 */
export const SIGNAL_SEVERITY_HINTS: Record<SignalSeverity, string> = {
  critique: "À traiter aujourd'hui — le client perd de l'argent ou du service.",
  attention: "À traiter cette semaine, au prochain appel.",
  info: "Bon prétexte d'appel, sans urgence.",
};

/**
 * Projection de la gravité de `/insights` vers les trois bandes de la charte.
 *
 * Le contrat du conseil parle le vocabulaire de son producteur (`urgent`,
 * `attention`, `info`) — on publie ce que la route REND, pas ce qu'un écran
 * préférerait lire. La traduction vers les bandes de la file de travail se
 * fait ici, en un seul endroit, plutôt que d'inventer une quatrième échelle.
 * L'ancien dictionnaire d'alias multi-langues a disparu avec le contrat.
 *
 * Le repli `info` n'est pas décoratif : une valeur inattendue à l'exécution
 * doit donner une pastille discrète, jamais une exception jusqu'au rendu.
 */
export const readInsightSeverity = (v: CrmInsightSeverity): SignalSeverity =>
  v === "urgent" ? "critique" : v === "attention" ? "attention" : "info";

/**
 * ORDRE D'APPEL — celui du contrat, donc celui de l'API.
 *
 * La liste des clients, la fiche et la file trient la MÊME file de travail :
 * deux ordres différents feraient apparaître le même parc dans deux ordres
 * selon la page d'où l'on vient, et l'équipe ne saurait plus ce qu'elle a déjà
 * traité.
 */
export const SEVERITY_RANK: Record<SignalSeverity, number> =
  CRM_SIGNAL_SEVERITY_RANK;

/**
 * Une ligne de la liste des clients, enrichie de ce que l'API veut bien donner.
 *
 * `CrmClient` vient de se doter de `accountStatus`, `score`, `previousOrders`,
 * `ordersDeltaPct` et `devicesOffline` — vérifié en curl sur `GET /crm/tenants`,
 * qui les rend bien. Ils sont retirés de l'intersection pour deux raisons :
 *
 *  · les trois premiers restent NULLABLES ici. Le contrat les promet toujours
 *    présents ; la liste, elle, doit continuer de s'afficher si un environnement
 *    plus ancien ne les envoie pas — une pastille sans chiffre vaut mieux qu'un
 *    parc entier absent ;
 *  · `previousOrders` / `ordersDeltaPct` portent DÉJÀ un nom côté écran
 *    (`ordersPrev30d`, `trendPct`), utilisé par la liste. Deux paires de noms
 *    pour la même mesure, c'est la garantie qu'un jour l'une des deux affiche
 *    autre chose que l'autre.
 */
export type ClientRow = Omit<
  CrmClient,
  "accountStatus" | "score" | "previousOrders" | "ordersDeltaPct" | "devicesOffline"
> & {
  /** Ville — utile pour situer un appel, jamais une adresse de consommateur. */
  city: string;
  /** Statut commercial du compte ; `null` tant que la route ne le renvoie pas. */
  accountStatus: TenantAccountStatus | null;
  /** Score de santé 0–100 ; `null` si l'API ne calcule pas encore de score. */
  score: number | null;
  /** Commandes sur les 30 jours PRÉCÉDENTS — socle de la tendance. */
  ordersPrev30d: number | null;
  /** Variation en % des commandes 30 j, calculée ou reprise de l'API. */
  trendPct: number | null;
  /** Dernier signe de vie, tous canaux : commande, caisse, écran. */
  lastActivityAt: string | null;
  /** Appareils muets — une caisse hors ligne se repère sans ouvrir la fiche. */
  devicesOffline: number | null;
  /** Signaux ouverts sur ce client, par gravité. */
  openSignals: number | null;
};

/**
 * L'ACTIVITÉ COMPARÉE — la forme du contrat, telle quelle.
 *
 * Deux fenêtres IMBRIQUÉES (`last7d`, `last30d`), pas de compteurs à plat et
 * PAS de série jour par jour : la route ne la calcule pas. C'était le défaut
 * n° 1 de l'audit — l'ancien lecteur cherchait `orders`/`revenue`/`series` à la
 * racine de `h.activity` et le bloc restait vide à jamais.
 *
 * Les `ordersDeltaPct`/`revenueDeltaPct` à `null` sont un REFUS de l'API (la
 * période de référence ne pesait pas assez pour qu'un pourcentage veuille dire
 * quelque chose), pas une absence : on ne les recalcule JAMAIS localement —
 * même règle que `trendPct` sur la liste.
 */
export type TenantActivity = CrmTenantActivity;
export type ActivityWindow = CrmActivityWindow;

/**
 * Un axe du score composite — le contrat, sans transformation. `score` est
 * `null` quand l'axe n'a pas pu être MESURÉ (`measured: false`) : ce n'est pas
 * une mauvaise note, c'est une donnée qui manque, et l'écran doit le dire.
 */
export type HealthComponent = CrmHealthAxis;

/**
 * ADOPTION D'UN MODULE — le contrat, sans transformation.
 *
 * `provisioned` dit OUVERT chez ce client, jamais FACTURÉ : aucune
 * correspondance formule → modules n'existe (limite documentée en tête de
 * `signals.service.ts` et publiée dans `CRM_SIGNAL_LIMITS`). C'était le défaut
 * n° 3 de l'audit : l'écran lisait un `included` jamais envoyé (défaut `true`)
 * et affichait « Facturé, jamais utilisé » — une affirmation que l'API refuse
 * précisément de faire. `provisioned && !used` reste LE sujet d'appel, mais il
 * se dit « ouvert, jamais utilisé », rien de plus.
 */
export type ModuleAdoption = CrmModuleAdoption;

export type ParkDevice = {
  id: string;
  name: string;
  kind: RevocableDeviceKind;
  kindLabel: string;
  online: boolean;
  lastSeenAt: string | null;
  /** Appairé : un appareil révoqué repart en attente de code. */
  paired: boolean;
  /** Télémétrie du battement — vides tant que la tablette n'envoie rien. */
  appVersion: string;
  queueDepth: number | null;
  lastError: string;
};

/**
 * APPROVISIONNEMENT — des COMPTEURS, pas des listes d'alertes.
 *
 * C'était le défaut n° 2 de l'audit : l'ancien lecteur attendait trois listes
 * nommées et affichait « aucune rupture » devant des compteurs pleins
 * (`belowPar`, `ruptures`…) — `topPriceIncreases`, la seule vraie liste du
 * contrat, n'était même pas parmi les clés lues. `available: false` signifie
 * que le contexte appro (PostgreSQL) n'a pas répondu : la section doit alors
 * se dire INDISPONIBLE, jamais « rien à signaler ».
 */
export type SupplyHealth = CrmSupplyHealth;

/** Les trois familles de lignes de la section appro — pour les pastilles. */
export type SupplyAlertKind = "rupture" | "seuil" | "prix";

export const SUPPLY_ALERT_LABELS: Record<SupplyAlertKind, string> = {
  rupture: "Rupture",
  seuil: "Sous le seuil",
  prix: "Hausse de prix",
};

/**
 * Une recommandation de `/insights`, ramenée aux trois bandes de la charte.
 *
 * Le contrat rend un CHIFFRE (`value` numérique + `unit`), jamais une chaîne
 * pré-formatée ; la médiane du réseau et les montants sont DANS `detail`,
 * rédigés par l'API qui seule connaît le panel. C'était le défaut n° 4 de
 * l'audit : l'écran attendait `benchmark` (chaîne) et `gainCentsPerMonth`, deux
 * champs que `CrmInsight` n'a jamais portés — la mise côte à côte et le
 * « ≈ X €/mois » ne s'affichaient jamais. On affiche ce que l'API dit, rien de
 * plus : le chiffre se met en mots avec `fmtInsightFigure`.
 */
export type Recommendation = Omit<CrmInsight, "severity"> & {
  severity: SignalSeverity;
};

/**
 * UNE LIGNE DE LA FILE DE TRAVAIL — la forme du contrat, sans rien perdre.
 *
 * `CrmQueueSignal` porte huit choses que l'écran doit dire et que l'ancienne
 * lecture jetait : la BANDE tranchée par l'API (`severity`, `severityLabel`),
 * la GRAVITÉ chiffrée qui départage deux signaux de même bande (`gravity`), le
 * CHIFFRE qui justifie l'appel (`value` + `unit`), l'ANCIENNETÉ (`ageDays`), le
 * LIEN direct vers la fiche (`href`) et surtout la CONSIGNE (`action`) — la
 * phrase à dire quand le gérant décroche, rédigée par l'API parce qu'elle seule
 * connaît le montant de l'ardoise et les jours d'essai restants.
 *
 * On étend le type plutôt que de le recopier : une famille ajoutée ou renommée
 * casse alors la compilation ici, au lieu de se voir un lundi matin devant
 * l'équipe.
 */
export type ClientSignal = CrmQueueSignal & {
  /**
   * Étiquette FRANÇAISE et COURTE de la famille (« Appareil muet »), résolue
   * une fois. L'API rend la clé technique (`appareil_muet`) : elle est faite
   * pour être groupée et comparée, pas pour être lue à l'écran.
   */
  kindLabel: string;
};

/**
 * Coordonnées du RESTAURATEUR — notre interlocuteur, pas un consommateur.
 *
 * C'est la seule identité nominative de tout cet écran, et elle est légitime :
 * on ne peut pas « accompagner un client de A à Z » sans savoir qui décroche.
 * Aucun champ de ce type ne doit jamais accueillir un client final du
 * restaurant.
 */
export type ClientContact = { name: string; phone: string; email: string };

/**
 * La fiche complète, recomposée à partir de plusieurs routes.
 *
 * Chaque section porte sa propre disponibilité : au téléphone, « donnée pas
 * encore branchée » et « ce client n'a rien à signaler » ne se confondent pas.
 */
export type ClientFile = {
  id: string;
  row: ClientRow | null;
  account: AdminTenantAccount | null;
  /** Ville de l'établissement, d'où qu'elle vienne. */
  city: string;
  contact: ClientContact;
  score: number | null;
  health: CrmClientHealth;
  components: HealthComponent[];
  activity: TenantActivity | null;
  modules: ModuleAdoption[];
  devices: ParkDevice[];
  /** `null` = `/health` n'a pas répondu. `available: false` = appro en panne. */
  supply: SupplyHealth | null;
  recommendations: Recommendation[];
  signals: ClientSignal[];
  journal: AdminLogEntry[];
  /** Sections dont la route a répondu 404 / en erreur — affichées comme telles. */
  offline: Set<Section>;
};

export type Section =
  | "row"
  | "account"
  | "health"
  | "insights"
  | "signals"
  | "journal";

// ─────────────────────────────────────────────────────────────
// Lecture des routes
// ─────────────────────────────────────────────────────────────

/**
 * `null` si la route n'existe pas encore ou a échoué.
 *
 * Une fiche client ne doit JAMAIS tomber parce qu'une brique d'analyse manque :
 * l'équipe a besoin du bouton « suspendre » même le jour où le service de
 * score est à l'arrêt. Le 401/403 fait exception — il remonte, la coquille
 * `/sm` sait renvoyer l'utilisateur au bon endroit.
 */
async function soft<T>(p: Promise<T>): Promise<T | null> {
  try {
    return await p;
  } catch (e) {
    if (e instanceof ApiError && (e.status === 401 || e.status === 403)) throw e;
    return null;
  }
}

export const clientsApi = {
  list: () => api.get<unknown>("/crm/tenants"),
  account: (id: string) => api.get<unknown>(`/crm/tenants/${id}/account`),
  health: (id: string) => api.get<unknown>(`/crm/tenants/${id}/health`),
  insights: (id: string) => api.get<unknown>(`/crm/tenants/${id}/insights`),
  signals: () => api.get<unknown>("/crm/signals"),
  journal: (id: string) => api.get<unknown>(`/crm/tenants/${id}/logs?limit=60`),

  suspend: (id: string, reason: string) =>
    api.post<unknown>(`/crm/tenants/${id}/suspend`, { reason }),
  reactivate: (id: string, reason: string) =>
    api.post<unknown>(`/crm/tenants/${id}/reactivate`, { reason }),
  /**
   * L'OFFRE entière, pas la seule formule : `/plan` ne portait que `plan` et
   * son énumération excluait `null`, si bien qu'on ne pouvait ni activer le
   * module ni redescendre un client vers l'Atelier seul.
   */
  changeOffre: (
    id: string,
    body: {
      plan: AdminPlan | null;
      onlineOrdering: boolean;
      billing: ProposalBilling;
      services: LeadServices;
      reason: string;
    },
  ) => api.patch<unknown>(`/crm/tenants/${id}/offre`, body),
  /**
   * LA FICHE FACTURATION D'UN CLIENT — pièces, ardoise, prochaine échéance.
   *
   * Cette route JOURNALISE une consultation de dossier : on l'appelle quand on
   * ouvre volontairement la facturation d'un client, jamais en boucle sur une
   * liste. C'est pour la même raison qu'elle n'est pas fondue dans le
   * chargement de la fiche.
   */
  billing: (id: string) => api.get<unknown>(`/crm/tenants/${id}/billing`),

  /**
   * ÉMETTRE une pièce. Aucune surface ne le permettait : les brouillons posés
   * automatiquement à la signature ne pouvaient jamais partir, et l'abonnement
   * du mois suivant n'était jamais facturé. La file de recouvrement pouvait
   * donc rester vide non parce que le parc était à jour, mais parce que rien
   * n'avait jamais été facturé.
   *
   * Aucun champ n'est obligatoire : sans montant, l'API applique l'offre du
   * client ; sans période, le mois courant ; sans libellé, un intitulé dérivé
   * de la nature et de la formule.
   */
  issueInvoice: (
    id: string,
    body: {
      kind?: "abonnement" | "mise_en_place" | "option" | "autre";
      period?: string;
      amountCents?: number;
      label?: string;
      draft?: boolean;
    },
  ) => api.post<unknown>(`/crm/tenants/${id}/invoices`, body),

  /** Envoyer un BROUILLON : c'est ce geste qui crée la créance. */
  sendInvoice: (id: string, invoiceId: string) =>
    api.post<unknown>(`/crm/tenants/${id}/invoices/${invoiceId}/send`, {}),

  /** Un avoir sur une pièce réglée — le seul moyen d'annuler après paiement. */
  creditInvoice: (id: string, invoiceId: string, reason: string) =>
    api.post<unknown>(`/crm/tenants/${id}/invoices/${invoiceId}/credit`, { reason }),

  addNote: (id: string, note: string) =>
    api.post<unknown>(`/crm/tenants/${id}/notes`, { note }),
  /**
   * Un écran de salle ne se révoque pas par la route des tablettes : l'API
   * expose deux chemins parce qu'il s'agit de deux collections. Le geste, lui,
   * est le même — d'où un seul appelant côté écran.
   */
  revokeDevice: (id: string, device: ParkDevice, body: DeviceRevoke) =>
    api.post<unknown>(
      device.kind === "screen"
        ? `/crm/tenants/${id}/screens/${device.id}/revoke`
        : `/crm/tenants/${id}/devices/${device.id}/revoke`,
      body,
    ),
};

// ─────────────────────────────────────────────────────────────
// Normalisation
// ─────────────────────────────────────────────────────────────

const ACCOUNT_STATUSES: TenantAccountStatus[] = [
  "trial",
  "active",
  "suspended",
  "churned",
];

function readAccountStatus(v: unknown): TenantAccountStatus | null {
  const s = String(v ?? "").toLowerCase();
  return (ACCOUNT_STATUSES as string[]).includes(s)
    ? (s as TenantAccountStatus)
    : null;
}

/**
 * Une valeur d'énumération inconnue vaut une valeur ABSENTE.
 *
 * Sans ce filtre, un `health: "degraded"` inattendu traverserait le cast et
 * finirait en clé de `Record` : `HEALTH_TEXT[health]` rendrait `undefined`,
 * donc une classe CSS littérale « undefined » et une pastille invisible. Une
 * pastille qui disparaît sur l'écran qui sert à repérer les décrochages est
 * pire qu'une pastille fausse.
 */
function readEnum<T extends string>(v: unknown, allowed: readonly T[]): T | null {
  const s = String(v ?? "").toLowerCase();
  return (allowed as readonly string[]).includes(s) ? (s as T) : null;
}

const HEALTHS = CLIENT_HEALTHS;
// Les trois formules RÉELLES — le `null` d'un client Atelier seul n'est pas
// une valeur à lire, c'est l'absence que le `?? null` d'en dessous assume.
const PLANS = ["essentiel", "complet", "boost"] as const satisfies readonly NonNullable<
  CrmClient["plan"]
>[];

/** Variation en % entre deux périodes ; `null` si la base est vide ou absente. */
export function trend(current: number, previous: number | null): number | null {
  if (previous === null || previous <= 0) return null;
  return Math.round(((current - previous) / previous) * 100);
}

export function readClientRow(raw: unknown): ClientRow {
  const o = bag(raw);
  const orders30d = num(o, "orders30d") ?? 0;
  // `previousOrders` est le nom du contrat, relevé en curl ; les autres sont les
  // noms qu'a portés cette route avant qu'il soit publié.
  const prev = num(
    o,
    "previousOrders",
    "ordersPrev30d",
    "orders30dPrev",
    "ordersPrevious30d",
    "orders30dPrevious",
  );
  const lastOrderAt = iso(o, "lastOrderAt");

  return {
    _id: str(o, "_id", "id", "tenantId"),
    name: str(o, "name") || "Sans nom",
    slug: str(o, "slug"),
    // `null` assumé : un client Atelier seul n'a pas de formule à afficher.
    plan: readEnum(o.plan, PLANS) ?? null,
    mrrCents: num(o, "mrrCents") ?? 0,
    founderSeat: bool(o, "founderSeat") ?? false,
    since: iso(o, "since", "createdAt") ?? new Date().toISOString(),
    orders30d,
    revenue30dCents: num(o, "revenue30dCents") ?? 0,
    lastOrderAt,
    daysSinceLastOrder: num(o, "daysSinceLastOrder"),
    // La santé reste calculable sans l'API : la règle est dans les contrats.
    health: readEnum(o.health, HEALTHS) ?? clientHealth(lastOrderAt),
    city: str(o, "city", "ville", "town"),
    accountStatus:
      readAccountStatus(o.accountStatus) ??
      readAccountStatus(dig(o, "account", "status")) ??
      readAccountStatus(o.status),
    score: num(o, "score", "healthScore"),
    ordersPrev30d: prev,
    /*
      `ordersDeltaPct: null` N'EST PAS UNE ABSENCE, c'est un REFUS — l'API dit
      que la période de référence ne pesait pas assez pour qu'un pourcentage
      veuille dire quelque chose. Relevé en curl sur le parc de développement :
      `orders30d: 2045`, `previousOrders: 16`, `ordersDeltaPct: null`. Le
      recalculer localement afficherait « +12 681 % », qui ne dit pas qu'un
      restaurant explose mais qu'il a été installé le mois dernier — et une
      colonne qui affiche ça une fois, on apprend à ne plus la lire.

      On ne retombe donc sur le calcul local que si le champ est ABSENT.
    */
    trendPct:
      "ordersDeltaPct" in o
        ? num(o, "ordersDeltaPct")
        : (num(o, "trendPct", "ordersTrendPct") ?? trend(orders30d, prev)),
    lastActivityAt: iso(o, "lastActivityAt", "lastSeenAt") ?? lastOrderAt,
    devicesOffline: num(o, "devicesOffline", "offlineDevices"),
    openSignals: num(o, "openSignals", "signals", "signalsCount"),
  };
}

export const readClientRows = (raw: unknown): ClientRow[] =>
  firstList(raw, dig(raw, "items"), dig(raw, "clients"), dig(raw, "tenants"))
    .map(readClientRow)
    .filter((c) => c._id !== "");

/**
 * `CrmTenantHealth` si la réponse en a la tête, sinon `null`.
 *
 * Le contrat fait foi — plus une seule devinette de clé — mais une fiche ne
 * tombe pas pour une réponse méconnaissable (proxy bavard, environnement en
 * retard d'une version) : on vérifie le SQUELETTE, les blocs que les sections
 * lisent, et une réponse qui ne l'a pas vaut section indisponible. Même
 * facture que `readSignals`, qui ne garde que le tableau.
 */
function readHealth(raw: unknown): CrmTenantHealth | null {
  const o = bag(raw);
  const ok =
    typeof o.tenantId === "string" &&
    Array.isArray(bag(o.score).axes) &&
    bag(o.activity).last30d !== undefined &&
    Array.isArray(bag(o.fleet).units) &&
    Array.isArray(o.modules) &&
    typeof bag(o.supply).available === "boolean";
  return ok ? (raw as CrmTenantHealth) : null;
}

/** `CrmTenantInsights` si la réponse en a la tête, sinon `null`. */
function readInsights(raw: unknown): CrmTenantInsights | null {
  const o = bag(raw);
  return typeof o.tenantId === "string" && Array.isArray(o.recommendations)
    ? (raw as CrmTenantInsights)
    : null;
}

/**
 * Le parc, depuis `fleet.units` du contrat.
 *
 * `ParkDevice` garde sa forme d'écran, télémétrie du battement comprise
 * (`appVersion`, `queueDepth`, `lastError`). Le seul repli conservé est celui
 * du nom : un appareil sans nom s'affiche par son genre plutôt que par une
 * ligne vide — un appareil qu'on ne voit pas est un appareil qu'on ne révoque
 * pas. L'état en ligne, lui, est TRANCHÉ par l'API (elle connaît le délai
 * propre à chaque support) : le recalcul local a disparu avec le contrat.
 */
function readDevices(units: readonly CrmFleetUnit[]): ParkDevice[] {
  return units.map((u) => ({
    id: u.id,
    name: u.name || u.kindLabel,
    kind: u.kind,
    kindLabel: u.kindLabel,
    online: u.online,
    lastSeenAt: u.lastSeenAt,
    paired: u.paired,
    appVersion: u.appVersion,
    queueDepth: u.queueDepth,
    lastError: u.lastError,
  }));
}

/** Une recommandation du contrat, projetée sur les bandes de la charte. */
export const readRecommendation = (raw: CrmInsight): Recommendation => ({
  ...raw,
  severity: readInsightSeverity(raw.severity),
});

/**
 * LE CHIFFRE D'UNE RECOMMANDATION, écrit court : « 6,4 pts », « 31 % »,
 * « 45 € » — à la française, une décimale au plus.
 *
 * `centimes` arrive en ENTIER de centimes (convention maison) et s'affiche en
 * euros ARRONDIS, même règle que `eurosLabel` côté API : le `detail` rédigé
 * porte déjà le montant exact, la pastille n'a pas à le répéter au centime.
 * Une unité inconnue à l'exécution rend le nombre nu plutôt qu'un affichage
 * faux — la phrase de l'API reste la source du sens.
 */
export function fmtInsightFigure(insight: {
  value: number;
  unit: CrmInsightUnit;
}): string {
  const n = insight.value.toLocaleString("fr-FR", { maximumFractionDigits: 1 });
  switch (insight.unit) {
    case "pourcent":
      return `${n} %`;
    case "points":
      return `${n} pts`;
    case "centimes":
      return `${Math.round(insight.value / 100).toLocaleString("fr-FR")} €`;
    case "commandes":
      return `${n} cmd`;
    case "produits":
      return `${n} produits`;
    default:
      return n;
  }
}

/**
 * DESTINATION DE CLIC — chemin interne de ce back-office, et rien d'autre.
 *
 * C'est le seul endroit où l'on ne fait PAS confiance au contrat, et pour une
 * raison qui n'a rien à voir avec la forme des données : `href` finit dans un
 * `<Link>`. Un « // » ou un « http » suffirait à envoyer l'équipe hors du
 * produit sur un simple changement côté serveur. On retombe alors sur la fiche
 * du client, qui est de toute façon la destination voulue.
 */
function readSignalHref(href: string, tenantId: string): string {
  if (href.startsWith("/") && !href.startsWith("//")) return href;
  return tenantId ? `/sm/clients/${tenantId}` : "/sm/clients";
}

/**
 * Le signal, tel que `GET /crm/signals` le rend — relevé en curl :
 *
 *   [{ "tenantId":"6a84…", "tenantName":"CLASS'FOOD", "tenantSlug":"classfood",
 *      "planLabel":"Complet", "accountStatus":"active",
 *      "accountStatusLabel":"Actif", "href":"/sm/clients/6a84…",
 *      "id":"appareil_muet:6a84…:6a85…", "kind":"appareil_muet",
 *      "severity":"attention", "gravity":60, "title":"Écran cuisine muet",
 *      "detail":"Écran cuisine sans signe de vie depuis 4 h — le restaurant a
 *      pris 1 commande depuis.", "action":"Appeler le comptoir : tablette
 *      débranchée, wifi coupé ou application fermée.", "value":4,
 *      "unit":"heures", "since":"2026-08-19T13:29:53.069Z",
 *      "severityLabel":"À surveiller", "ageDays":0 }]
 *
 * Deux ajouts, pas un de plus : l'étiquette française de famille, et le
 * garde-fou sur le lien. Tout le reste passe intact — réécrire `severity` ou
 * `action` côté écran, ce serait se donner une seconde source de vérité pour la
 * même phrase.
 */
export function readSignal(raw: CrmQueueSignal): ClientSignal {
  return {
    ...raw,
    kindLabel: CRM_SIGNAL_KIND_LABELS[raw.kind] ?? raw.kind,
    // L'API résout déjà le libellé de bande ; on ne recalcule que s'il manque.
    severityLabel: raw.severityLabel || SIGNAL_SEVERITY_LABELS[raw.severity],
    href: readSignalHref(raw.href, raw.tenantId),
  };
}

/**
 * La route rend un TABLEAU nu, déjà trié et sans pagination (contrat + curl).
 * Le seul cas qu'on absorbe est l'absence de réponse : `soft()` rend `null`
 * quand le service est à l'arrêt, et une fiche client ne tombe pas pour ça.
 */
export const readSignals = (raw: unknown): ClientSignal[] =>
  (Array.isArray(raw) ? (raw as CrmQueueSignal[]) : []).map(readSignal);

// ─── Mise en mots du chiffre porté par un signal ───

/**
 * SUFFIXE COURT PAR UNITÉ — deux unités n'en ont volontairement pas.
 *
 * `modules` vaut toujours 1 (un signal PAR module dormant) : « 1 mod. » n'ajoute
 * rien à un titre qui nomme déjà le module, et une pastille qui n'apprend rien
 * apprend à ne plus regarder les pastilles.
 *
 * `euros` existe dans le contrat mais aucune famille ne l'émet aujourd'hui, et
 * rien ne dit si la valeur arriverait en euros ou en CENTIMES. Afficher
 * « 4 500 € » pour 45,00 € est pire que ne rien afficher — le montant, lui, est
 * déjà écrit en toutes lettres dans le `detail` rédigé par l'API.
 */
const SIGNAL_UNIT_SUFFIX: Record<CrmSignalUnit, string | null> = {
  jours: "j",
  heures: "h",
  pourcent: "%",
  commandes: "cmd",
  ingredients: "ingr.",
  modules: null,
  euros: null,
};

/**
 * Le chiffre qui justifie l'appel, écrit court : « 4 h », « 12 j », « 31 % ».
 * Chaîne vide quand l'unité ne se résume pas — la phrase de l'API le porte.
 */
export function fmtSignalFigure(signal: {
  value: number;
  unit: CrmSignalUnit;
}): string {
  const suffix = SIGNAL_UNIT_SUFFIX[signal.unit];
  if (!suffix) return "";
  return `${Math.round(signal.value).toLocaleString("fr-FR")} ${suffix}`;
}

/**
 * DEPUIS QUAND ÇA DURE — l'information qui manquait le plus à l'écran.
 *
 * Un impayé de douze jours et un impayé du matin se disent au téléphone avec
 * deux voix différentes. `ageDays` est `null` quand la situation n'a pas de date
 * d'entrée (un module dormant n'a jamais « commencé ») : on n'écrit alors rien
 * plutôt qu'un « depuis 0 jour » qui serait faux.
 */
export function fmtSignalAge(ageDays: number | null): string {
  if (ageDays === null) return "";
  if (ageDays <= 0) return "depuis aujourd'hui";
  if (ageDays === 1) return "depuis hier";
  if (ageDays < 31) return `depuis ${ageDays} jours`;
  const months = Math.round(ageDays / 30);
  return `depuis ${months} mois`;
}

/** Date d'entrée en toutes lettres — pour une infobulle, jamais pour la ligne. */
export const fmtSignalSince = (since: string | null): string | undefined =>
  since ? new Date(since).toLocaleString("fr-FR") : undefined;

function readJournal(raw: unknown): AdminLogEntry[] {
  return firstList(raw, dig(raw, "items"), dig(raw, "entries"), dig(raw, "logs"))
    .map((e) => e as AdminLogEntry)
    .filter((e) => typeof e?.action === "string");
}

/**
 * Coordonnées de l'interlocuteur.
 *
 * On accepte plusieurs formes (`contact.phone`, `phone`, `phones[0]`) parce
 * qu'un tenant porte historiquement une LISTE de téléphones : c'est le numéro
 * de l'établissement, celui qu'on compose.
 */
function readContact(...sources: unknown[]): ClientContact {
  const out: ClientContact = { name: "", phone: "", email: "" };
  for (const source of sources) {
    const o = bag(source);
    const nested = bag(o.contact);
    const phones = list(o.phones ?? nested.phones).filter(
      (p): p is string => typeof p === "string",
    );
    // `name` n'est lu QUE dans un sous-objet `contact` : à la racine d'un
    // compte, `name` est le nom du RESTAURANT — écrire « Appeler CLASS'FOOD
    // (Sofiane) » avec le mauvais des deux est pire que de ne rien afficher.
    out.name ||= str(nested, "name") || str(o, "contactName", "ownerName", "manager");
    out.phone ||=
      str(nested, "phone", "tel") ||
      str(o, "phone", "tel", "telephone") ||
      (phones[0]?.trim() ?? "");
    out.email ||= str(nested, "email") || str(o, "email", "contactEmail");
  }
  return out;
}

function readAccount(raw: unknown): AdminTenantAccount | null {
  const o = bag(raw);
  return typeof o.tenantId === "string" || typeof o.status === "string"
    ? (raw as AdminTenantAccount)
    : null;
}

// ─────────────────────────────────────────────────────────────
// Chargement de la fiche
// ─────────────────────────────────────────────────────────────

/**
 * Une fiche = cinq routes lues EN PARALLÈLE, aucune bloquante.
 *
 * L'écran s'ouvre pendant qu'on décroche : attendre le service d'analyse pour
 * afficher le nom du restaurant et le bouton « suspendre » serait le contraire
 * de l'outil demandé. Chaque section manquante est signalée telle quelle.
 */
export async function loadClientFile(id: string): Promise<ClientFile> {
  const [rows, account, healthRaw, insightsRaw, signals, journal] = await Promise.all([
    soft(clientsApi.list()),
    soft(clientsApi.account(id)),
    soft(clientsApi.health(id)),
    soft(clientsApi.insights(id)),
    soft(clientsApi.signals()),
    soft(clientsApi.journal(id)),
  ]);

  // `/health` et `/insights` sont CONTRACTUALISÉS : une réponse qui n'a pas le
  // squelette du contrat vaut la même chose qu'une route muette — la section
  // se dit indisponible, elle n'affiche pas des miettes devinées.
  const health = readHealth(healthRaw);
  const insights = readInsights(insightsRaw);

  const offline = new Set<Section>();
  if (rows === null) offline.add("row");
  if (account === null) offline.add("account");
  if (health === null) offline.add("health");
  if (insights === null) offline.add("insights");
  if (signals === null) offline.add("signals");
  if (journal === null) offline.add("journal");

  const row = readClientRows(rows).find((c) => c._id === id) ?? null;
  if (rows !== null && !row) offline.add("row");

  // Le score composé vient de `/health` ; le score nu de la liste sert de
  // repli pour que la pastille tienne debout quand la fiche de santé est en
  // panne.
  const score = health?.score.value ?? row?.score ?? null;

  return {
    id,
    row,
    account: readAccount(account),
    city: str(bag(account), "city", "ville") || row?.city || "",
    contact: readContact(account, rows === null ? null : row),
    score,
    // La pastille suit le score chiffré quand il existe : le verdict rédigé de
    // l'API (« solide », « fragile »…) n'est pas l'énuméré de la charte, et le
    // traduire mot à mot créerait deux vocabulaires à maintenir. À défaut, la
    // santé « commande » du contrat, puis celle de la liste.
    health:
      scoreHealth(score) ?? health?.activity.health ?? row?.health ?? "attention",
    components: health?.score.axes ?? [],
    activity: health?.activity ?? null,
    // Adoption, parc et appro ne tombent QUE de `/health` — l'ancien pari
    // « premier service qui répond » lisait des clés que `/insights` n'a
    // jamais portées.
    modules: health?.modules ?? [],
    devices: health ? readDevices(health.fleet.units) : [],
    supply: health?.supply ?? null,
    recommendations: insights?.recommendations.map(readRecommendation) ?? [],
    signals: readSignals(signals).filter((s) => s.tenantId === id),
    journal: readJournal(journal),
    offline,
  };
}

// ─────────────────────────────────────────────────────────────
// Formatage propre à cette surface
// ─────────────────────────────────────────────────────────────

/**
 * Couleur d'un score de santé.
 *
 * Les seuils sont ceux de la liste : au-dessus de 70 le client va bien, entre
 * 40 et 70 on le surveille, en dessous on l'appelle. Les couleurs restent les
 * fonctionnelles de la charte — vert/ambre/rouge, jamais l'accent (DA §3).
 */
export function scoreHealth(score: number | null): CrmClientHealth | null {
  if (score === null) return null;
  if (score >= 70) return "ok";
  if (score >= 40) return "attention";
  return "risque";
}

export const HEALTH_TEXT: Record<CrmClientHealth, string> = {
  ok: "text-okt",
  attention: "text-prept",
  risque: "text-alertt",
};

export const HEALTH_BAR: Record<CrmClientHealth, string> = {
  ok: "bg-ok",
  attention: "bg-prep",
  risque: "bg-alert",
};

export const SEVERITY_TEXT: Record<SignalSeverity, string> = {
  critique: "text-alertt",
  attention: "text-prept",
  info: "text-mut",
};

export const SEVERITY_BORDER: Record<SignalSeverity, string> = {
  critique: "border-alert/70 bg-alert/10 text-alertt",
  attention: "border-prep/55 bg-prep/10 text-prept",
  info: "border-line bg-white/4 text-mut",
};

/**
 * « +18 % » / « −4,9 % » / « — » quand il n'y a pas de période précédente.
 * Les deltas du contrat portent une décimale : elle s'écrit à la française
 * (« 4,9 »), jamais « 4.9 » au milieu d'une phrase française.
 */
export function fmtTrend(pct: number | null): string {
  if (pct === null) return "—";
  if (pct === 0) return "stable";
  const abs = Math.abs(pct).toLocaleString("fr-FR", { maximumFractionDigits: 1 });
  return `${pct > 0 ? "+" : "−"}${abs} %`;
}

/**
 * Dernier signe de vie, au grain qui intéresse l'équipe au téléphone.
 * Volontairement plus court que `timeAgo` : ici on balaie une colonne.
 */
export function fmtSince(at: string | null): string {
  if (!at) return "jamais";
  const ms = Date.now() - new Date(at).getTime();
  if (ms < 0) return "à l'instant";
  const min = Math.floor(ms / 60_000);
  if (min < 1) return "à l'instant";
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} h`;
  const d = Math.floor(h / 24);
  if (d < 31) return `${d} j`;
  return `${Math.floor(d / 30)} mois`;
}
