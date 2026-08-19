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
 * ─── Pourquoi tout est normalisé depuis `unknown` ───
 * `/crm/tenants/:id/health`, `/insights` et `/crm/signals` s'écrivent en
 * parallèle de cet écran. Plutôt que de parier sur un nom de champ et de
 * casser l'outil le jour où l'API tranche autrement, chaque section est lue
 * défensivement : plusieurs noms plausibles acceptés, section ABSENTE plutôt
 * qu'écran blanc, et jamais d'exception qui remonte jusqu'au rendu. Une fois
 * les types publiés dans `@sm/contracts`, ces lecteurs se remplacent par un
 * import — l'interface, elle, ne bouge pas.
 *
 * Rappel de convention : tous les montants circulent en CENTIMES (int).
 */

import {
  DEVICE_OFFLINE_AFTER_MS,
  REVOCABLE_DEVICE_KIND_LABELS,
  SCREEN_OFFLINE_AFTER_MS,
  clientHealth,
  type AdminLogEntry,
  type AdminPlan,
  type AdminTenantAccount,
  type CrmClient,
  type CrmClientHealth,
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
 * L'adoption des modules peut arriver sous `/health` comme sous `/insights` :
 * on ne veut pas d'un écran qui dépend du service qui a gagné la course.
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

/** Trois gravités, pas davantage : une file de travail se trie à l'œil. */
export const SIGNAL_SEVERITIES = ["critique", "attention", "info"] as const;
export type SignalSeverity = (typeof SIGNAL_SEVERITIES)[number];

export const SIGNAL_SEVERITY_LABELS: Record<SignalSeverity, string> = {
  critique: "Critique",
  attention: "À surveiller",
  info: "Pour information",
};

/**
 * Ce que chaque gravité veut dire pour l'équipe. Écrit ici plutôt que dans la
 * page : c'est une règle de travail, pas une décoration.
 */
export const SIGNAL_SEVERITY_HINTS: Record<SignalSeverity, string> = {
  critique: "À traiter aujourd'hui — le client perd de l'argent ou du service.",
  attention: "À traiter cette semaine, au prochain appel.",
  info: "Bon prétexte d'appel, sans urgence.",
};

/** L'API peut parler anglais, français, ou par niveaux — on ramène à trois. */
const SEVERITY_ALIASES: Record<string, SignalSeverity> = {
  critique: "critique",
  critical: "critique",
  urgent: "critique",
  high: "critique",
  danger: "critique",
  risque: "critique",
  error: "critique",
  attention: "attention",
  warning: "attention",
  warn: "attention",
  medium: "attention",
  moyen: "attention",
  info: "info",
  low: "info",
  faible: "info",
  notice: "info",
};

export const readSeverity = (v: unknown): SignalSeverity =>
  SEVERITY_ALIASES[String(v ?? "").toLowerCase()] ?? "info";

export const SEVERITY_RANK: Record<SignalSeverity, number> = {
  critique: 0,
  attention: 1,
  info: 2,
};

/** Une ligne de la liste des clients, enrichie de ce que l'API veut bien donner. */
export type ClientRow = CrmClient & {
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

export type Comparison = {
  current: number;
  /** `null` = l'API ne fournit pas de période précédente : pas de tendance inventée. */
  previous: number | null;
};

export type HealthComponent = {
  key: string;
  label: string;
  /** Note du critère, 0–100. */
  score: number;
  /** Poids dans le score global, en % — `null` si l'API ne le pondère pas. */
  weight: number | null;
  detail: string;
};

export type ActivityPoint = { label: string; value: number; previous: number | null };

export type TenantActivity = {
  /** Longueur de la fenêtre comparée, en jours. */
  days: number;
  orders: Comparison;
  revenueCents: Comparison;
  /** Panier moyen — agrégat, jamais un ticket nominatif. */
  ticketCents: Comparison | null;
  series: ActivityPoint[];
};

export type ModuleAdoption = {
  key: string;
  label: string;
  /** Le restaurant s'en sert réellement sur la période. */
  used: boolean;
  /** Sa formule le lui facture. `included && !used` = le sujet d'appel. */
  included: boolean;
  detail: string;
  lastUsedAt: string | null;
  /** Volume d'usage sur la période (commandes, tickets, envois…). */
  usage: number | null;
};

export type ParkDevice = {
  id: string;
  name: string;
  kind: RevocableDeviceKind;
  kindLabel: string;
  online: boolean;
  lastSeenAt: string | null;
  /** Appairé : un appareil révoqué repart en attente de code. */
  paired: boolean;
};

export type SupplyAlertKind = "rupture" | "seuil" | "prix";

export const SUPPLY_ALERT_LABELS: Record<SupplyAlertKind, string> = {
  rupture: "Rupture",
  seuil: "Sous le seuil",
  prix: "Hausse de prix",
};

export type SupplyAlert = {
  key: string;
  name: string;
  kind: SupplyAlertKind;
  detail: string;
};

/**
 * Une recommandation de `/insights`, telle qu'on la dit au téléphone.
 *
 * `value` et `benchmark` sont des CHAÎNES déjà formatées par l'API (« 35 % »,
 * « 28 % de médiane réseau ») : le calcul d'un food cost n'a rien à faire dans
 * un composant, et l'unité change d'une recommandation à l'autre.
 */
export type Recommendation = {
  key: string;
  title: string;
  detail: string;
  value: string;
  benchmark: string;
  severity: SignalSeverity;
  /** Gain mensuel estimé, en CENTIMES — `null` si l'API ne le chiffre pas. */
  gainCentsPerMonth: number | null;
};

export type ClientSignal = {
  id: string;
  severity: SignalSeverity;
  title: string;
  detail: string;
  tenantId: string;
  tenantName: string;
  at: string | null;
  /** Étiquette courte de famille : « appareil », « stock », « activité »… */
  kind: string;
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
  supply: SupplyAlert[];
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
  changePlan: (id: string, plan: AdminPlan, reason: string) =>
    api.patch<unknown>(`/crm/tenants/${id}/plan`, { plan, reason }),
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

/** Variation en % entre deux périodes ; `null` si la base est vide ou absente. */
export function trend(current: number, previous: number | null): number | null {
  if (previous === null || previous <= 0) return null;
  return Math.round(((current - previous) / previous) * 100);
}

export function readClientRow(raw: unknown): ClientRow {
  const o = bag(raw);
  const orders30d = num(o, "orders30d") ?? 0;
  const prev = num(
    o,
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
    plan: (str(o, "plan") || "essentiel") as CrmClient["plan"],
    mrrCents: num(o, "mrrCents") ?? 0,
    founderSeat: bool(o, "founderSeat") ?? false,
    since: iso(o, "since", "createdAt") ?? new Date().toISOString(),
    orders30d,
    revenue30dCents: num(o, "revenue30dCents") ?? 0,
    lastOrderAt,
    daysSinceLastOrder: num(o, "daysSinceLastOrder"),
    // La santé reste calculable sans l'API : la règle est dans les contrats.
    health:
      (str(o, "health") as CrmClientHealth) || clientHealth(lastOrderAt),
    city: str(o, "city", "ville", "town"),
    accountStatus:
      readAccountStatus(o.accountStatus) ??
      readAccountStatus(dig(o, "account", "status")) ??
      readAccountStatus(o.status),
    score: num(o, "score", "healthScore"),
    ordersPrev30d: prev,
    trendPct: num(o, "trendPct", "ordersTrendPct") ?? trend(orders30d, prev),
    lastActivityAt: iso(o, "lastActivityAt", "lastSeenAt") ?? lastOrderAt,
    devicesOffline: num(o, "devicesOffline", "offlineDevices"),
    openSignals: num(o, "openSignals", "signals", "signalsCount"),
  };
}

export const readClientRows = (raw: unknown): ClientRow[] =>
  firstList(raw, dig(raw, "items"), dig(raw, "clients"), dig(raw, "tenants"))
    .map(readClientRow)
    .filter((c) => c._id !== "");

function readComparison(raw: unknown, ...keys: string[]): Comparison | null {
  // Deux formes acceptées : { current, previous } ou un nombre plat doublé
  // d'un champ « …Prev » à côté.
  const direct = bag(raw);
  const current = num(direct, "current", "value", "now", ...keys);
  if (current === null) return null;
  return {
    current,
    previous: num(direct, "previous", "prev", "before"),
  };
}

function readActivity(raw: unknown): TenantActivity | null {
  const a = bag(raw);
  if (Object.keys(a).length === 0) return null;

  const orders =
    readComparison(a.orders) ??
    (num(a, "orders", "orders30d") !== null
      ? {
          current: num(a, "orders", "orders30d") as number,
          previous: num(a, "ordersPrevious", "ordersPrev", "ordersPrev30d"),
        }
      : null);

  const revenue =
    readComparison(a.revenue ?? a.revenueCents) ??
    (num(a, "revenueCents", "revenue30dCents") !== null
      ? {
          current: num(a, "revenueCents", "revenue30dCents") as number,
          previous: num(a, "revenuePreviousCents", "revenuePrevCents"),
        }
      : null);

  const ticket =
    readComparison(a.ticket ?? a.ticketCents ?? a.averageTicket) ??
    (num(a, "ticketCents", "averageTicketCents") !== null
      ? {
          current: num(a, "ticketCents", "averageTicketCents") as number,
          previous: num(a, "ticketPreviousCents", "ticketPrevCents"),
        }
      : null);

  const series = firstList(a.series, a.points, a.days, a.buckets).map((p, i) => {
    const b = bag(p);
    return {
      label: str(b, "label", "day", "date", "week") || `J${i + 1}`,
      value: num(b, "value", "orders", "count", "revenueCents") ?? 0,
      previous: num(b, "previous", "prev"),
    };
  });

  if (!orders && !revenue && series.length === 0) return null;

  return {
    days: num(a, "days", "windowDays", "period") ?? 30,
    orders: orders ?? { current: 0, previous: null },
    revenueCents: revenue ?? { current: 0, previous: null },
    ticketCents: ticket,
    series,
  };
}

function readComponents(raw: unknown): HealthComponent[] {
  return firstList(raw).map((c, i) => {
    const o = bag(c);
    return {
      key: str(o, "key", "id") || `c${i}`,
      label: str(o, "label", "name", "title") || "Critère",
      score: Math.max(0, Math.min(100, num(o, "score", "value") ?? 0)),
      // Un poids donné entre 0 et 1 se lit en pourcentage comme les autres.
      weight: (() => {
        const w = num(o, "weight", "poids");
        if (w === null) return null;
        return w > 0 && w <= 1 ? Math.round(w * 100) : Math.round(w);
      })(),
      detail: str(o, "detail", "hint", "description", "reason"),
    };
  });
}

function readModules(raw: unknown): ModuleAdoption[] {
  return firstList(raw).map((m, i) => {
    const o = bag(m);
    return {
      key: str(o, "key", "id", "module") || `m${i}`,
      label: str(o, "label", "name", "title") || "Module",
      used: bool(o, "used", "adopted", "active") ?? (num(o, "usage", "count") ?? 0) > 0,
      // Par défaut inclus : un module listé sur la fiche d'un client est un
      // module qu'il paie — c'est l'hypothèse qui déclenche l'appel utile.
      included: bool(o, "included", "includedInPlan", "billed", "inPlan") ?? true,
      detail: str(o, "detail", "hint", "description"),
      lastUsedAt: iso(o, "lastUsedAt", "lastAt", "lastSeenAt"),
      usage: num(o, "usage", "count", "events"),
    };
  });
}

const DEVICE_KINDS: RevocableDeviceKind[] = ["pos", "kds", "screen"];

function readDevices(raw: unknown): ParkDevice[] {
  return firstList(raw).map((d, i) => {
    const o = bag(d);
    const rawKind = str(o, "kind", "type").toLowerCase();
    const kind = (DEVICE_KINDS as string[]).includes(rawKind)
      ? (rawKind as RevocableDeviceKind)
      : "pos";
    const lastSeenAt = iso(o, "lastSeenAt", "lastHeartbeatAt", "lastPingAt", "at");
    const declared = bool(o, "online");
    return {
      id: str(o, "id", "_id", "deviceId") || `d${i}`,
      name: str(o, "name", "label") || REVOCABLE_DEVICE_KIND_LABELS[kind],
      kind,
      kindLabel: str(o, "kindLabel") || REVOCABLE_DEVICE_KIND_LABELS[kind],
      // L'API tranche si elle le dit ; sinon la règle des contrats s'applique,
      // avec le délai propre à chaque support (5 min tablette, 15 min écran).
      online: declared ?? isDeviceOnline(kind, lastSeenAt),
      lastSeenAt,
      paired: bool(o, "paired") ?? true,
    };
  });
}

/** Un appareil est « en ligne » tant qu'il a battu récemment. */
export function isDeviceOnline(
  kind: RevocableDeviceKind,
  lastSeenAt: string | null,
): boolean {
  if (!lastSeenAt) return false;
  const limit = kind === "screen" ? SCREEN_OFFLINE_AFTER_MS : DEVICE_OFFLINE_AFTER_MS;
  return Date.now() - new Date(lastSeenAt).getTime() < limit;
}

const SUPPLY_KIND_ALIASES: Record<string, SupplyAlertKind> = {
  rupture: "rupture",
  out: "rupture",
  out_of_stock: "rupture",
  outofstock: "rupture",
  empty: "rupture",
  seuil: "seuil",
  low: "seuil",
  low_stock: "seuil",
  below: "seuil",
  threshold: "seuil",
  prix: "prix",
  price: "prix",
  price_increase: "prix",
  cost: "prix",
};

function readSupply(raw: unknown): SupplyAlert[] {
  const o = bag(raw);
  // Deux formes : une liste plate étiquetée, ou trois listes nommées.
  const grouped: [SupplyAlertKind, unknown][] = [
    ["rupture", o.outOfStock ?? o.ruptures ?? o.out],
    ["seuil", o.belowThreshold ?? o.lowStock ?? o.low ?? o.underThreshold],
    ["prix", o.priceIncreases ?? o.priceUp ?? o.prices],
  ];

  const fromGroups = grouped.flatMap(([kind, source]) =>
    list(source).map((x, i) => toSupplyAlert(x, kind, i)),
  );
  if (fromGroups.length > 0) return fromGroups;

  return firstList(raw, o.items, o.alerts).map((x, i) => {
    const b = bag(x);
    const kind =
      SUPPLY_KIND_ALIASES[str(b, "kind", "type", "severity").toLowerCase()] ?? "seuil";
    return toSupplyAlert(x, kind, i);
  });
}

function toSupplyAlert(raw: unknown, kind: SupplyAlertKind, i: number): SupplyAlert {
  const o = bag(raw);
  const name = str(o, "name", "label", "ingredient", "title") || "Ingrédient";
  const unit = str(o, "unit");
  const stock = num(o, "stock", "quantity", "qty");
  const threshold = num(o, "threshold", "min", "seuil");
  const deltaPct = num(o, "deltaPct", "changePct", "variationPct", "increasePct");

  // Détail reconstruit si l'API n'en fournit pas : au téléphone, « 1,2 kg pour
  // un seuil à 5 kg » vaut mieux que « stock bas ».
  const fallback =
    kind === "prix"
      ? deltaPct !== null
        ? `+${Math.round(deltaPct)} % sur le dernier réapprovisionnement`
        : "Hausse relevée au dernier réapprovisionnement"
      : stock !== null && threshold !== null
        ? `${fmtQty(stock)}${unit ? ` ${unit}` : ""} en stock · seuil ${fmtQty(threshold)}${unit ? ` ${unit}` : ""}`
        : kind === "rupture"
          ? "Stock épuisé"
          : "Sous le seuil de réappro";

  return {
    key: str(o, "key", "id", "_id") || `${kind}-${i}-${name}`,
    name,
    kind,
    detail: str(o, "detail", "hint", "description") || fallback,
  };
}

const fmtQty = (n: number): string =>
  n.toLocaleString("fr-FR", { maximumFractionDigits: 2 });

function readRecommendations(raw: unknown): Recommendation[] {
  return firstList(raw).map((r, i) => {
    const o = bag(r);
    return {
      key: str(o, "key", "id") || `r${i}`,
      title: str(o, "title", "label", "headline") || "Recommandation",
      detail: str(o, "detail", "message", "description", "argument", "hint"),
      value: str(o, "value", "current", "clientValue"),
      benchmark: str(o, "benchmark", "median", "networkMedian", "reference"),
      severity: readSeverity(o.severity ?? o.level ?? o.priority),
      gainCentsPerMonth: num(
        o,
        "gainCentsPerMonth",
        "gainCents",
        "impactCents",
        "monthlyGainCents",
      ),
    };
  });
}

export function readSignal(raw: unknown, i = 0): ClientSignal {
  const o = bag(raw);
  return {
    id: str(o, "id", "_id", "key") || `s${i}`,
    severity: readSeverity(o.severity ?? o.level ?? o.gravity ?? o.priority),
    title: str(o, "title", "label", "headline", "message") || "Signal",
    detail: str(o, "detail", "description", "hint", "message"),
    tenantId: str(o, "tenantId", "tenant", "clientId", "_tenantId"),
    tenantName: str(o, "tenantName", "name", "restaurant", "clientName"),
    at: iso(o, "at", "createdAt", "since", "detectedAt"),
    kind: str(o, "kind", "type", "family", "category"),
  };
}

export const readSignals = (raw: unknown): ClientSignal[] =>
  firstList(raw, dig(raw, "signals"), dig(raw, "items"), dig(raw, "results")).map(
    readSignal,
  );

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
  const [rows, account, health, insights, signals, journal] = await Promise.all([
    soft(clientsApi.list()),
    soft(clientsApi.account(id)),
    soft(clientsApi.health(id)),
    soft(clientsApi.insights(id)),
    soft(clientsApi.signals()),
    soft(clientsApi.journal(id)),
  ]);

  const offline = new Set<Section>();
  if (rows === null) offline.add("row");
  if (account === null) offline.add("account");
  if (health === null) offline.add("health");
  if (insights === null) offline.add("insights");
  if (signals === null) offline.add("signals");
  if (journal === null) offline.add("journal");

  const row = readClientRows(rows).find((c) => c._id === id) ?? null;
  if (rows !== null && !row) offline.add("row");

  const h = bag(health);
  const ins = bag(insights);

  // Adoption, parc et appro peuvent tomber d'un service comme de l'autre : on
  // prend la première branche renseignée plutôt que de parier.
  const modules = readModules(
    firstList(h.modules, h.adoption, ins.modules, ins.adoption),
  );
  const devices = readDevices(
    firstList(h.devices, h.park, h.fleet, ins.devices, ins.park),
  );
  const supply = readSupply(ins.supply ?? ins.stock ?? h.supply ?? h.stock ?? {});
  const recommendations = readRecommendations(
    firstList(
      ins.recommendations,
      ins.advice,
      ins.items,
      ins.insights,
      Array.isArray(insights) ? insights : undefined,
      h.recommendations,
    ),
  );

  const score = num(h, "score", "healthScore") ?? row?.score ?? null;

  return {
    id,
    row,
    account: readAccount(account),
    city: str(bag(account), "city", "ville") || str(h, "city") || row?.city || "",
    contact: readContact(account, health, rows === null ? null : row),
    score,
    health:
      (str(h, "health") as CrmClientHealth) || row?.health || "attention",
    components: readComponents(
      firstList(h.components, h.breakdown, h.criteria, h.parts),
    ),
    activity: readActivity(h.activity ?? h.trend ?? h.orders ?? {}),
    modules,
    devices,
    supply,
    recommendations,
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

/** « +18 % » / « −4 % » / « — » quand il n'y a pas de période précédente. */
export function fmtTrend(pct: number | null): string {
  if (pct === null) return "—";
  if (pct === 0) return "stable";
  return `${pct > 0 ? "+" : "−"}${Math.abs(pct)} %`;
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
