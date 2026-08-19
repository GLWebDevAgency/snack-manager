"use client";

/**
 * LA FILE DE TRAVAIL DU MATIN — vocabulaire commun aux trois écrans qui s'en
 * servent : le tableau de bord (`/sm`), la liste des clients (`/sm/clients`) et
 * la file elle-même (`/sm/signals`).
 *
 * ─── Ce module ne DEVINE plus rien ───
 *
 * `/crm/signals` a désormais son contrat : `CrmQueueSignal`, publié dans
 * `@sm/contracts` et servi par `SignalsService`. Les lecteurs défensifs qui
 * vivaient ici (alias de familles, mots de gravité anglais, consigne de repli
 * rédigée côté écran) ont donc SAUTÉ : ils dédoublaient une vérité qui est
 * maintenant typée, et un doublon finit toujours par diverger.
 *
 * La lecture elle-même vit dans `../clients/data` (`readSignals`), pour que la
 * fiche client et la file lisent le MÊME objet. Ce fichier n'ajoute que ce qui
 * est propre à la file : un pictogramme par famille, le tri, les regroupements
 * et la notion de « geste du jour ».
 *
 * Deux choses restent écrites par l'API et ne se réécrivent pas ici :
 *
 *  · LA BANDE (`severity`), qui ne se déduit PAS du chiffre `gravity` — un essai
 *    qui s'achève sort à 40 en « critique », un appareil muet à 60 en « à
 *    surveiller ». `gravity` départage deux signaux de MÊME bande, rien de plus ;
 *  · LA CONSIGNE (`action`), la phrase à dire quand le gérant décroche. L'API
 *    connaît le montant de l'ardoise et les jours d'essai restants ; deux
 *    formulations pour le même appel finiraient par se contredire.
 *
 * ─── Respect des clients de nos clients ───
 *
 * Un signal porte un ÉTABLISSEMENT et un agrégat (jours de silence, pourcentage
 * de baisse, ingrédients en rupture) — jamais un consommateur final.
 */

import type { CrmSignalKind, TenantAccountStatus } from "@sm/contracts";
import type { IconName } from "@/components/ui";
import { api } from "@/lib/api";
import {
  SEVERITY_RANK,
  readSignals,
  type ClientRow,
  type ClientSignal,
  type SignalSeverity,
} from "../clients/data";

// ─────────────────────────────────────────────────────────────
// Lecteurs tolérants — réservés aux routes SANS contrat
//
// Il n'en reste qu'un usage : `/crm/tenants/:id/health`, plus bas, qui n'a pas
// encore de type publié. La file, elle, est typée.
// ─────────────────────────────────────────────────────────────

type Bag = Record<string, unknown>;

const asBag = (v: unknown): Bag =>
  v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Bag) : {};

const asList = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

function asStr(source: unknown, ...keys: string[]): string {
  const o = asBag(source);
  for (const k of keys) {
    const v = o[k];
    if (typeof v === "string" && v.trim() !== "") return v.trim();
    if (typeof v === "number" && Number.isFinite(v)) return String(v);
  }
  return "";
}

function asNum(source: unknown, ...keys: string[]): number | null {
  const o = asBag(source);
  for (const k of keys) {
    const v = o[k];
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) {
      return Number(v);
    }
  }
  return null;
}

function asIso(source: unknown, ...keys: string[]): string | null {
  const raw = asStr(source, ...keys);
  if (!raw) return null;
  return Number.isNaN(new Date(raw).getTime()) ? null : raw;
}

// ─────────────────────────────────────────────────────────────
// Familles de signaux
// ─────────────────────────────────────────────────────────────

/**
 * Pictogramme de famille — il double la couleur, il ne la remplace pas.
 *
 * Typé sur `CrmSignalKind` À DESSEIN : le jour où l'API ajoute une neuvième
 * famille, ce fichier ne compile plus et quelqu'un choisit son icône. C'est
 * moins confortable qu'un repli silencieux, et c'est le but — un repli
 * silencieux, personne ne le voit jamais.
 */
export const SIGNAL_KIND_ICONS: Record<CrmSignalKind, IconName> = {
  compte_suspendu: "close",
  impaye: "euro",
  arret_activite: "chart",
  appareil_muet: "tv",
  chute_activite: "chart",
  essai_qui_sacheve: "clock",
  rupture_appro: "cart",
  module_dormant: "grid",
};

// ─────────────────────────────────────────────────────────────
// Le signal, tel que l'écran l'utilise
// ─────────────────────────────────────────────────────────────

/**
 * Un signal de la file — c'est `ClientSignal`, plus rien.
 *
 * `key` double `id` parce que trois écrans s'en servent déjà comme clé de rendu
 * React ; l'identifiant, lui, reste celui de l'API (`famille:tenant:précision`),
 * stable d'un appel à l'autre et donc utilisable le jour où l'équipe voudra
 * masquer un signal traité.
 */
export type WorkSignal = ClientSignal & { key: string };

export const readWorkSignals = (raw: unknown): WorkSignal[] =>
  readSignals(raw).map((s) => ({ ...s, key: s.id }));

/**
 * ORDRE D'APPEL — le même que celui de l'API (`sortQueue`, signals.service).
 *
 * La bande d'abord, la gravité chiffrée ensuite, le plus ancien en dernier
 * recours. Reproduire ce tri côté écran n'est pas de la défiance : la liste des
 * clients regroupe et refiltre les signaux, et deux tris différents feraient
 * apparaître le même parc dans deux ordres selon la page d'où l'on vient.
 */
export const sortWorkSignals = (signals: readonly WorkSignal[]): WorkSignal[] =>
  [...signals].sort(
    (a, b) =>
      SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
      b.gravity - a.gravity ||
      // Une date absente passe après : elle ne se compare à rien.
      (a.since ?? "9999").localeCompare(b.since ?? "9999") ||
      a.tenantName.localeCompare(b.tenantName, "fr") ||
      a.key.localeCompare(b.key),
  );

export function groupBySeverity(
  signals: readonly WorkSignal[],
): Record<SignalSeverity, WorkSignal[]> {
  const out: Record<SignalSeverity, WorkSignal[]> = {
    critique: [],
    attention: [],
    info: [],
  };
  for (const s of sortWorkSignals(signals)) out[s.severity].push(s);
  return out;
}

export function signalsByTenant(
  signals: readonly WorkSignal[],
): Map<string, WorkSignal[]> {
  const map = new Map<string, WorkSignal[]>();
  for (const s of sortWorkSignals(signals)) {
    if (!s.tenantId) continue;
    const arr = map.get(s.tenantId);
    if (arr) arr.push(s);
    else map.set(s.tenantId, [s]);
  }
  return map;
}

/**
 * LES GESTES DU JOUR — un client, un geste.
 *
 * Trois signaux chez le même restaurant, c'est UN appel : les empiler en tête
 * du tableau de bord donnerait l'illusion d'une matinée chargée et masquerait
 * les autres clients. On garde donc le signal le plus grave par établissement.
 */
export function todaysMoves(signals: readonly WorkSignal[], max = 5): WorkSignal[] {
  const seen = new Set<string>();
  const out: WorkSignal[] = [];
  for (const s of sortWorkSignals(signals)) {
    const key = s.tenantId || s.key;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
    if (out.length >= max) break;
  }
  return out;
}

/** Gravité la plus haute d'une pile — `null` si la pile est vide. */
export function worstSeverity(
  signals: readonly WorkSignal[],
): SignalSeverity | null {
  let worst: SignalSeverity | null = null;
  for (const s of signals) {
    if (worst === null || SEVERITY_RANK[s.severity] < SEVERITY_RANK[worst]) {
      worst = s.severity;
    }
  }
  return worst;
}

// ─────────────────────────────────────────────────────────────
// Résumé de santé d'un client, pour la LISTE
// ─────────────────────────────────────────────────────────────

const ACCOUNT_STATUSES: TenantAccountStatus[] = [
  "trial",
  "active",
  "suspended",
  "churned",
];

/** Statut de compte lu depuis `/health`, qui n'a pas encore de contrat. */
const readAccountStatus = (v: unknown): TenantAccountStatus | null => {
  const s = String(v ?? "").toLowerCase();
  return (ACCOUNT_STATUSES as string[]).includes(s)
    ? (s as TenantAccountStatus)
    : null;
};

/**
 * Ce que la liste sait montrer d'un client une fois sa fiche de santé lue.
 *
 * Toutes ces valeurs existent DÉJÀ dans `/crm/tenants/:id/health` : le score et
 * son verdict, le statut de compte, le parc muet, la variation de commandes.
 * Aucune n'est recalculée ici — la liste et la fiche doivent afficher le même
 * chiffre, sinon l'équipe débat du chiffre au lieu du client.
 */
export type TenantSummary = {
  score: number | null;
  /** « Client solide », « Client fragile — à rappeler »… */
  verdictLabel: string;
  accountStatus: TenantAccountStatus | null;
  /** Variation des commandes, en % arrondi. */
  ordersDeltaPct: number | null;
  /** Fenêtre de cette variation, en jours : 30 si mesurable, sinon 7. */
  deltaDays: number;
  lastOrderAt: string | null;
  devicesOffline: number | null;
  devicesTotal: number | null;
};

/**
 * VOLUME MINIMAL DE LA PÉRIODE DE RÉFÉRENCE pour qu'une variation veuille dire
 * quelque chose.
 *
 * Constaté en curl sur le parc de développement : `last30d` rend
 * `previousOrders: 5` et `ordersDeltaPct: 41020` — mathématiquement exact,
 * éditorialement faux. « +41 020 % » ne dit pas qu'un restaurant explose, il
 * dit qu'il a été installé le mois dernier. Afficher ce chiffre dans une
 * colonne qu'on balaie apprendrait à l'équipe à ignorer la colonne.
 *
 * L'API applique déjà cette prudence pour DÉCLENCHER un signal de chute (un
 * plancher de commandes sur la période précédente). On tient le même
 * raisonnement à l'affichage, avec un plancher plus haut parce qu'une colonne
 * de liste se lit sans contexte.
 */
export const TREND_MIN_BASELINE_ORDERS = 20;

/**
 * Lecture de `/crm/tenants/:id/health`, réponse réellement observée :
 *
 *   { account:{status}, activity:{ last7d:{orders, previousOrders,
 *     ordersDeltaPct}, last30d:{…}, lastOrderAt },
 *     score:{ value, verdictLabel, axes[] },
 *     fleet:{ total, online, offline, units[] } }
 *
 * La fenêtre de 30 jours est la bonne réponse à « comment il va ce mois-ci » —
 * à condition qu'il y ait eu un mois précédent à comparer. Sinon on bascule sur
 * 7 jours en le DISANT à l'écran, ce qui vaut mieux qu'un pourcentage
 * spectaculaire ou qu'un « pas d'historique » affiché à un client dont
 * l'activité bouge visiblement.
 */
export function readTenantSummary(raw: unknown): TenantSummary {
  const h = asBag(raw);
  const activity = asBag(h.activity);
  const long = asBag(activity.last30d ?? activity.long ?? activity.month);
  const short = asBag(activity.last7d ?? activity.short ?? activity.week);
  const score = asBag(h.score);
  const fleet = asBag(h.fleet);
  const units = asList(fleet.units ?? h.devices);

  /** Une variation n'est lisible que si la période de référence pesait. */
  const usable = (window: Bag): number | null => {
    const pct = asNum(window, "ordersDeltaPct", "deltaPct", "trendPct");
    if (pct === null) return null;
    const baseline = asNum(window, "previousOrders", "previous", "ordersPrevious");
    // Base inconnue : on fait confiance à l'API plutôt que de masquer une
    // information qu'elle est seule à pouvoir qualifier.
    if (baseline !== null && baseline < TREND_MIN_BASELINE_ORDERS) return null;
    return pct;
  };

  const longPct = usable(long);
  const shortPct = usable(short);
  const usingLong = longPct !== null;
  const pct = usingLong ? longPct : shortPct;

  const offline =
    asNum(fleet, "offline", "offlineCount") ??
    (units.length > 0
      ? units.filter((u) => asBag(u).online === false).length
      : null);

  return {
    score: asNum(score, "value") ?? asNum(h, "score", "healthScore"),
    verdictLabel: asStr(score, "verdictLabel", "verdict"),
    accountStatus:
      readAccountStatus(asBag(h.account).status) ??
      readAccountStatus(h.accountStatus) ??
      readAccountStatus(h.status),
    // Arrondi ici, une fois : « −10,1 % » dans une colonne de liste se lit
    // moins vite que « −10 % », et le point décimal anglais n'a rien à y faire.
    ordersDeltaPct: pct === null ? null : Math.round(pct),
    deltaDays: usingLong ? (asNum(long, "days") ?? 30) : (asNum(short, "days") ?? 7),
    lastOrderAt: asIso(activity, "lastOrderAt") ?? asIso(h, "lastOrderAt"),
    devicesOffline: offline,
    devicesTotal: asNum(fleet, "total") ?? (units.length > 0 ? units.length : null),
  };
}

/**
 * COMBIEN DE FICHES ON ACCEPTE D'OUVRIR pour peupler la liste.
 *
 * `GET /crm/tenants` ne renvoie PAS le score (vérifié en curl : `_id, name,
 * slug, plan, mrrCents, founderSeat, since, orders30d, revenue30dCents,
 * lastOrderAt, daysSinceLastOrder, health`). Le seul endroit où vit le 88
 * affiché sur la fiche est `/crm/tenants/:id/health`, une route par client.
 *
 * Une requête par ligne, lancée en vrac, ferait ramer la page à cinquante
 * clients ET taperait cinquante fois la base pour un écran de survol. D'où
 * trois règles :
 *
 *   1. la liste s'affiche AVANT, sans attendre : les scores arrivent après,
 *      pastille par pastille — on peut déjà appeler pendant ce temps ;
 *   2. quatre requêtes en vol au maximum, jamais cinquante ;
 *   3. un plafond, et surtout un ORDRE : les clients qui portent un signal
 *      passent devant. Si le budget est épuisé, ce sont des clients calmes qui
 *      restent sans chiffre — pas ceux qu'on doit rappeler.
 *
 * La vraie solution est un champ `score` sur `GET /crm/tenants` : ce mécanisme
 * entier disparaîtra le jour où l'API le rendra (`readClientRow` le lit déjà).
 */
export const SUMMARY_BUDGET = 24;
const SUMMARY_CONCURRENCY = 4;

/**
 * Ordre d'hydratation : d'abord les clients signalés (bande la plus grave, puis
 * gravité décroissante), ensuite ceux que la liste juge déjà mal en point, puis
 * le reste.
 */
export function hydrationOrder(
  rows: readonly ClientRow[],
  byTenant: Map<string, WorkSignal[]>,
): string[] {
  const weight = (c: ClientRow): number => {
    const top = byTenant.get(c._id)?.[0];
    // Les signalés sortent en négatif : ils passent avant tout le reste, et
    // entre eux c'est la bande puis la gravité qui tranchent.
    if (top) return -100 + SEVERITY_RANK[top.severity] * 10 - top.gravity / 100;
    if (c.health === "risque") return 10;
    if (c.health === "attention") return 20;
    return 30;
  };
  return [...rows].sort((a, b) => weight(a) - weight(b)).map((c) => c._id);
}

/**
 * Charge les fiches de santé en file, `onLoaded` appelé à chaque réponse.
 *
 * Une fiche muette (404, service à l'arrêt) n'interrompt jamais les autres :
 * la ligne concernée garde sa pastille sans chiffre, les autres s'affichent.
 */
export async function hydrateSummaries(
  ids: readonly string[],
  onLoaded: (id: string, summary: TenantSummary) => void,
  isCancelled: () => boolean = () => false,
): Promise<void> {
  const queue = ids.slice(0, SUMMARY_BUDGET);
  let cursor = 0;

  const worker = async (): Promise<void> => {
    for (;;) {
      if (isCancelled()) return;
      const id = queue[cursor++];
      if (id === undefined) return;
      try {
        const raw = await api.get<unknown>(`/crm/tenants/${id}/health`);
        if (!isCancelled()) onLoaded(id, readTenantSummary(raw));
      } catch {
        // Silencieux par construction : voir le commentaire ci-dessus.
      }
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(SUMMARY_CONCURRENCY, queue.length) }, worker),
  );
}
