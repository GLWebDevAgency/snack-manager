import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  CLIENT_HEALTH_LABELS,
  CLIENT_RISK_DAYS,
  DEVICE_OFFLINE_AFTER_MS,
  PLAN_LABELS,
  REVOCABLE_DEVICE_KIND_LABELS,
  SCREEN_OFFLINE_AFTER_MS,
  TENANT_ACCOUNT_STATUS_LABELS,
  clientHealth,
  daysSince,
  isAccessBlocked,
  type CrmClientHealth,
  type JwtPayload,
  type RevocableDeviceKind,
  type TenantAccountStatus,
} from '@sm/contracts';
import type { Device, Order, Screen, Tenant } from '@sm/db';
import type { SupplyDb } from '@sm/supply';
import { SUPPLY_DB } from '../../supply-db.module';
import { AdminService } from './admin.service';

/**
 * PILOTAGE CLIENT — tout ce qu'il faut savoir sur un restaurant pour
 * l'accompagner, en une lecture.
 *
 * Ce service répond à trois questions que l'équipe se pose vraiment :
 * « ce client va-t-il bien ? » (`tenantHealth`), et « qui dois-je rappeler
 * cette semaine ? » (`signals`). Il n'écrit RIEN sur les données d'un
 * restaurant : c'est une surface de lecture, à l'inverse d'`AdminService` qui,
 * lui, agit sur les comptes.
 *
 * ─── RESPECT DES CLIENTS DE NOS CLIENTS ───
 *
 * Aucune requête de ce fichier ne remonte un consommateur final. On ne lit ni
 * `pickup.customerName`, ni `pickup.customerPhone`, ni l'auteur d'un avis :
 * uniquement des COMPTAGES, des SOMMES et des DATES. C'est un choix
 * d'architecture assumé — le fichier client d'un restaurateur lui appartient,
 * et le détenir nous rendrait responsables de sa protection sans qu'aucune
 * décision d'accompagnement ne l'exige. Une évolution qui ajouterait un nom de
 * consommateur ici serait une régression, pas une fonctionnalité.
 *
 * ─── CLOISONNEMENT ───
 *
 * Ce service est TRANS-TENANT par construction : `signals` lit le parc entier.
 * Il n'a donc aucun garde-fou interne et n'est appelé que depuis
 * `HealthController`, qui porte `@Roles('sm_admin')`.
 */

// ─── Conventions partagées avec le reste du CRM ───

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

/**
 * CA = commandes prêtes + remises — même convention que `StatsService` et
 * `CrmService`. Deux définitions du chiffre d'affaires dans le même produit,
 * et l'équipe finit par débattre du chiffre au lieu du client.
 */
const REVENUE_STATUSES = ['ready', 'delivered'];

/**
 * Fenêtres GLISSANTES (7 × 24 h, 30 × 24 h) et non calendaires.
 *
 * `StatsService` raisonne en jours calendaires Paris parce qu'il rend un
 * graphique au gérant, qui lit « lundi, mardi ». Ici on compare une période à
 * la précédente pour détecter un décrochage : les deux fenêtres doivent avoir
 * exactement la même durée, sinon la variation mesure la longueur de la
 * fenêtre autant que l'activité du restaurant. `CrmService.listClients` fait
 * déjà ce choix pour ses 30 jours.
 */
const SHORT_WINDOW_DAYS = 7;
const LONG_WINDOW_DAYS = 30;

/**
 * Au-delà de 24 h sans battement de cœur, un appareil appairé n'est plus
 * « en retard », il est MUET : quelque chose s'est cassé (tablette débranchée,
 * box changée, matériel volé) et personne ne nous a appelés.
 *
 * Rien à voir avec `DEVICE_OFFLINE_AFTER_MS` (5 min), qui sert au gérant à
 * savoir si sa caisse répond à l'instant T. Nous, ce qu'on veut, c'est la
 * panne que le restaurant n'a pas signalée.
 */
export const DEVICE_SILENT_AFTER_MS = 24 * HOUR_MS;

/**
 * Une baisse de commandes n'est un signal qu'à partir de −30 % : en dessous,
 * c'est la météo, un jour férié ou un congé. Et seulement si la période
 * précédente pesait assez pour que le pourcentage veuille dire quelque chose.
 */
export const ACTIVITY_DROP_PCT = 30;
export const ACTIVITY_DROP_MIN_ORDERS = 5;

// ─── Types de sortie ───

export type CrmHealthAxisKey = 'activite' | 'adoption' | 'technique' | 'paiement';

export type CrmHealthAxis = {
  key: CrmHealthAxisKey;
  label: string;
  /** Poids de l'axe dans le score composite (somme des quatre = 100). */
  weight: number;
  /** `false` quand la donnée manque : l'axe est alors RETIRÉ du calcul. */
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
  verdict: CrmHealthVerdict;
  verdictLabel: string;
  /**
   * Axe qui a PLAFONNÉ le verdict, quand la moyenne était plus flatteuse que
   * lui. `null` la plupart du temps. Renvoyé pour que l'écran puisse écrire
   * « correct sur la moyenne, mais l'activité le tire vers le bas » plutôt que
   * de laisser l'équipe se demander pourquoi 66 donne « fragile ».
   */
  cappedBy: CrmHealthAxisKey | null;
  axes: CrmHealthAxis[];
};

export type CrmActivityWindow = {
  days: number;
  orders: number;
  revenueCents: number;
  avgBasketCents: number;
  /** Même durée, juste avant — la seule comparaison honnête. */
  previousOrders: number;
  previousRevenueCents: number;
  ordersDeltaPct: number | null;
  revenueDeltaPct: number | null;
};

export type CrmModuleKey = 'caisse' | 'cuisine' | 'commande_en_ligne' | 'ecrans_salle';

export type CrmModuleAdoption = {
  key: CrmModuleKey;
  label: string;
  /**
   * Le module est-il OUVERT chez ce client (matériel appairé, surface en
   * service) ? Un module ouvert et jamais utilisé, c'est de la formation à
   * prévoir — ou une ligne de facture à justifier.
   */
  provisioned: boolean;
  used: boolean;
  lastUsedAt: string | null;
  detail: string;
};

export type CrmFleetUnit = {
  id: string;
  name: string;
  kind: RevocableDeviceKind;
  kindLabel: string;
  paired: boolean;
  online: boolean;
  lastSeenAt: string | null;
  statusLabel: string;
};

export type CrmFleet = {
  units: CrmFleetUnit[];
  total: number;
  online: number;
  offline: number;
  /** Appairés mais jamais vus : installés puis abandonnés. */
  neverSeen: number;
};

export type CrmSupplyPriceIncrease = {
  ingredientName: string;
  supplierName: string;
  previousPriceCents: number;
  packPriceCents: number;
  increasePct: number;
};

export type CrmSupplyHealth = {
  /**
   * `false` quand le contexte supply (PostgreSQL) est injoignable. La fiche
   * doit rester lisible : une panne d'appro ne justifie pas de refuser
   * l'activité, la santé et le parc.
   */
  available: boolean;
  belowPar: number;
  ruptures: number;
  priceIncreases30d: number;
  topPriceIncreases: CrmSupplyPriceIncrease[];
};

export type CrmTenantHealth = {
  tenantId: string;
  name: string;
  slug: string;
  plan: 'essentiel' | 'complet' | 'boost';
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
  activity: {
    last7d: CrmActivityWindow;
    last30d: CrmActivityWindow;
    lastOrderAt: string | null;
    daysSinceLastOrder: number | null;
    health: CrmClientHealth;
    healthLabel: string;
  };
  score: CrmHealthScore;
  modules: CrmModuleAdoption[];
  fleet: CrmFleet;
  supply: CrmSupplyHealth;
  computedAt: string;
};

export type CrmSignalKind =
  | 'impaye'
  | 'arret_activite'
  | 'appareil_muet'
  | 'chute_activite'
  | 'module_inutilise';

export type CrmSignal = {
  kind: CrmSignalKind;
  /** 0-100, décroissant : c'est l'ordre d'appel de la journée. */
  gravity: number;
  tenantId: string;
  tenantName: string;
  /** Intitulé court, lisible dans une liste. */
  title: string;
  /** Une phrase : ce qui se passe, et depuis quand. */
  detail: string;
  /** Le chiffre qui justifie l'appel. */
  value: number;
  unit: 'commandes' | 'pourcent' | 'jours' | 'heures' | 'modules';
  since: string | null;
};

// ─── Barème du score composite ───

/**
 * COMPOSITION DU SCORE — un score que personne ne comprend ne sert à rien.
 *
 * Quatre axes, quatre poids, et la règle qui les assemble tient en trois
 * lignes. Chaque axe est noté sur 100, le score final est leur moyenne
 * pondérée, et le détail de chaque axe est renvoyé avec le score : l'équipe
 * doit pouvoir dire au restaurateur POURQUOI il est à 54.
 *
 *  - ACTIVITÉ 40 — le plus lourd, et de loin : un client qui n'encaisse plus
 *    est un client qui part, quels que soient ses modules et son matériel.
 *  - ADOPTION 25 — ce qu'il utilise vraiment. C'est là que se joue le
 *    renouvellement : on ne résilie pas un outil dont on se sert tous les
 *    jours.
 *  - TECHNIQUE 20 — le matériel répond-il ? Une caisse muette, c'est un
 *    service qui tourne à l'aveugle et un appel qui arrive bientôt.
 *  - PAIEMENT 15 — le plus faible, volontairement : un impayé est un fait
 *    binaire, déjà traité comme un signal prioritaire dans la file de travail.
 *    Le noyer dans un score le rendrait moins visible, pas plus.
 *
 * UN AXE NON MESURABLE EST RETIRÉ DU CALCUL, pas noté au hasard. Un restaurant
 * qui vient d'ouvrir n'a ni historique ni matériel : lui coller 0 sur deux axes
 * l'afficherait « critique » le jour de sa signature. Le score se calcule alors
 * sur ce qu'on sait, et `axes[].measured` dit ce qui manquait.
 */
export const HEALTH_AXIS_WEIGHTS: Record<CrmHealthAxisKey, number> = {
  activite: 40,
  adoption: 25,
  technique: 20,
  paiement: 15,
};

export const HEALTH_AXIS_LABELS: Record<CrmHealthAxisKey, string> = {
  activite: 'Activité',
  adoption: 'Adoption',
  technique: 'Technique',
  paiement: 'Paiement',
};

export const HEALTH_VERDICT_LABELS: Record<CrmHealthVerdict, string> = {
  solide: 'Client solide',
  correct: 'Client correct',
  fragile: 'Client fragile — à rappeler',
  critique: 'Client critique — appel immédiat',
};

/** Seuils du verdict, du meilleur au pire. */
export const HEALTH_VERDICT_THRESHOLDS: readonly { min: number; verdict: CrmHealthVerdict }[] = [
  { min: 80, verdict: 'solide' },
  { min: 60, verdict: 'correct' },
  { min: 40, verdict: 'fragile' },
  { min: 0, verdict: 'critique' },
];

export const MODULE_LABELS: Record<CrmModuleKey, string> = {
  caisse: 'Caisse',
  cuisine: 'Écran cuisine',
  commande_en_ligne: 'Commande en ligne',
  ecrans_salle: 'Écrans de salle',
};

/**
 * Bandes de gravité de la file de travail.
 *
 * Dix points par famille, et un bonus 0-9 à l'intérieur de la bande selon
 * l'ampleur : une chute de −85 % passe devant une chute de −31 %, mais jamais
 * devant une caisse muette. L'ordre des familles est un choix éditorial
 * assumé — c'est l'ordre dans lequel on décroche le téléphone.
 */
export const SIGNAL_GRAVITY_BASE: Record<CrmSignalKind, number> = {
  impaye: 90,
  arret_activite: 80,
  appareil_muet: 70,
  chute_activite: 50,
  module_inutilise: 30,
};

// ─── Fonctions pures (le jugement, testable sans base) ───

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

const iso = (d: Date | string | null | undefined): string | null =>
  d ? new Date(d).toISOString() : null;

/**
 * Variation en % (1 décimale), `null` si la référence est nulle — même
 * formule que `StatsService.deltaPct`. « +∞ % » n'aide personne : quand la
 * période précédente est vide, on préfère ne rien dire.
 */
export function deltaPct(current: number, previous: number): number | null {
  if (previous <= 0) return null;
  return Math.round(((current - previous) / previous) * 1000) / 10;
}

/** « 12 min », « 3 h », « 2 j » — l'unité qui se lit d'un coup d'œil. */
export function sinceLabel(elapsedMs: number): string {
  if (elapsedMs < HOUR_MS) return `${Math.max(1, Math.floor(elapsedMs / 60_000))} min`;
  if (elapsedMs < 2 * DAY_MS) return `${Math.floor(elapsedMs / HOUR_MS)} h`;
  return `${Math.floor(elapsedMs / DAY_MS)} j`;
}

/**
 * Nombre décimal à la française : « 288,7 », « -10,9 ».
 *
 * Toutes les phrases rendues par cette surface passent par là. Un « 288.7 »
 * anglo-saxon au milieu d'une phrase française est une faute que l'équipe lit
 * cinquante fois par jour — et le monorepo est en français, sans exception.
 */
export const frNumber = (n: number): string =>
  n.toLocaleString('fr-FR', { maximumFractionDigits: 1 });

/** Montant en centimes → « 1 234 € » pour les phrases d'explication. */
export function eurosLabel(cents: number): string {
  return `${Math.round(cents / 100).toLocaleString('fr-FR')} €`;
}

export function buildWindow(
  days: number,
  current: { orders: number; revenueCents: number },
  previous: { orders: number; revenueCents: number },
): CrmActivityWindow {
  return {
    days,
    orders: current.orders,
    revenueCents: current.revenueCents,
    avgBasketCents: current.orders > 0 ? Math.round(current.revenueCents / current.orders) : 0,
    previousOrders: previous.orders,
    previousRevenueCents: previous.revenueCents,
    ordersDeltaPct: deltaPct(current.orders, previous.orders),
    revenueDeltaPct: deltaPct(current.revenueCents, previous.revenueCents),
  };
}

/**
 * AXE ACTIVITÉ — deux moitiés de 50 points.
 *
 *  - RÉCENCE : plein pot si le restaurant a encaissé aujourd'hui, zéro à
 *    `CLIENT_RISK_DAYS` (7 j) de silence, linéaire entre les deux. Le même
 *    seuil que `clientHealth`, pour qu'un client « à risque » ne puisse pas
 *    afficher une bonne note d'activité.
 *  - TENDANCE : plein pot dès que le client fait au moins autant que la
 *    semaine précédente (croître n'est pas exigé, ne pas s'effondrer si), zéro
 *    à −100 %. Non mesurable quand la semaine précédente était vide — l'axe se
 *    rabat alors sur la seule récence.
 *
 * Aucun historique du tout (jamais une commande) : l'axe n'est pas mesuré.
 * Un restaurant signé hier n'est pas un restaurant en train de mourir.
 */
export function scoreActivite(input: {
  daysSinceLastOrder: number | null;
  orders7d: number;
  previousOrders7d: number;
  hasHistory: boolean;
}): { measured: boolean; score: number | null; detail: string } {
  if (!input.hasHistory) {
    return {
      measured: false,
      score: null,
      detail: 'Aucune commande enregistrée — pas encore d’historique à juger.',
    };
  }

  const days = input.daysSinceLastOrder ?? CLIENT_RISK_DAYS;
  const recency = clamp(1 - days / CLIENT_RISK_DAYS, 0, 1);
  const recencyPhrase =
    days === 0 ? 'dernière commande aujourd’hui' : `dernière commande il y a ${days} j`;

  if (input.previousOrders7d <= 0) {
    return {
      measured: true,
      score: Math.round(recency * 100),
      detail: `${input.orders7d} commande(s) sur 7 j, ${recencyPhrase} — tendance non mesurable, la semaine précédente était vide.`,
    };
  }

  const ratio = (input.orders7d - input.previousOrders7d) / input.previousOrders7d;
  const trend = clamp(1 + Math.min(0, ratio), 0, 1);
  const pct = deltaPct(input.orders7d, input.previousOrders7d);
  const trendPhrase =
    pct === null
      ? 'tendance inconnue'
      : `${pct > 0 ? '+' : ''}${frNumber(pct)} % vs 7 j précédents`;

  return {
    measured: true,
    score: Math.round((recency * 50 + trend * 50)),
    detail: `${input.orders7d} commande(s) sur 7 j (${trendPhrase}), ${recencyPhrase}.`,
  };
}

/**
 * AXE ADOPTION — la part des modules OUVERTS qui servent vraiment.
 *
 * Le dénominateur est le nombre de modules ouverts chez ce client, pas les
 * quatre du produit : reprocher à un restaurant sans téléviseur de ne pas
 * utiliser les écrans de salle n'apprend rien à personne. Ce qu'on veut voir,
 * c'est ce qui est en place et qui dort.
 */
export function scoreAdoption(modules: readonly CrmModuleAdoption[]): {
  measured: boolean;
  score: number | null;
  detail: string;
} {
  const open = modules.filter((m) => m.provisioned);
  if (open.length === 0) {
    return { measured: false, score: null, detail: 'Aucun module ouvert — rien à juger.' };
  }
  const used = open.filter((m) => m.used);
  const idle = open.filter((m) => !m.used).map((m) => m.label);
  return {
    measured: true,
    score: Math.round((used.length / open.length) * 100),
    detail:
      idle.length === 0
        ? `${used.length} module(s) ouvert(s), tous utilisés.`
        : `${used.length}/${open.length} module(s) ouvert(s) utilisé(s) — jamais servi : ${idle.join(', ')}.`,
  };
}

/**
 * AXE TECHNIQUE — la part du parc appairé qui répond.
 *
 * Un appareil en attente d'appairage ne compte pas : il n'est pas en panne, il
 * n'est pas encore installé. Pas de parc du tout : axe non mesuré.
 */
export function scoreTechnique(fleet: CrmFleet): {
  measured: boolean;
  score: number | null;
  detail: string;
} {
  const paired = fleet.units.filter((u) => u.paired);
  if (paired.length === 0) {
    return {
      measured: false,
      score: null,
      detail: 'Aucun appareil appairé — pas de parc à surveiller.',
    };
  }
  const online = paired.filter((u) => u.online);
  const mute = paired.filter((u) => !u.online).map((u) => u.name);
  return {
    measured: true,
    score: Math.round((online.length / paired.length) * 100),
    detail:
      mute.length === 0
        ? `${online.length} appareil(s) en ligne sur ${paired.length}.`
        : `${online.length}/${paired.length} appareil(s) en ligne — muet(s) : ${mute.join(', ')}.`,
  };
}

/**
 * AXE PAIEMENT — binaire, parce que la réalité l'est.
 *
 * `suspended` est le seul statut qui vaut zéro : c'est le seul où l'on a
 * coupé la porte. `churned` n'est pas un impayé — c'est un départ, et il n'a
 * pas à faire chuter le score technique d'un compte qu'on n'accompagne plus.
 * `trial` vaut plein pot : on ne facture pas encore.
 */
export function scorePaiement(status: TenantAccountStatus): {
  measured: boolean;
  score: number | null;
  detail: string;
} {
  if (status === 'suspended') {
    return { measured: true, score: 0, detail: 'Compte suspendu — accès coupé.' };
  }
  if (status === 'churned') {
    return { measured: true, score: 50, detail: 'Client parti — compte conservé, plus facturé.' };
  }
  return {
    measured: true,
    score: 100,
    detail: status === 'trial' ? 'Période d’essai — rien à facturer.' : 'Abonnement à jour.',
  };
}

/** Verdict qu'une note sur 100 mérite, prise isolément. */
export function verdictFor(value: number): CrmHealthVerdict {
  return HEALTH_VERDICT_THRESHOLDS.find((t) => value >= t.min)?.verdict ?? 'critique';
}

/** 0 = le meilleur verdict. Sert à comparer deux verdicts, jamais à les afficher. */
const verdictRank = (verdict: CrmHealthVerdict): number =>
  HEALTH_VERDICT_THRESHOLDS.findIndex((t) => t.verdict === verdict);

/**
 * Assemble les quatre axes.
 *
 * DEUX RÈGLES, et elles sont l'essentiel de ce fichier.
 *
 * 1. Les axes non mesurés sortent du numérateur ET du dénominateur. C'est ce
 *    qui empêche un manque de donnée de se transformer en mauvaise note.
 *
 * 2. LE VERDICT NE PEUT PAS ÊTRE MEILLEUR QUE L'ACTIVITÉ. Une moyenne, par
 *    construction, dilue : un restaurant dont les commandes se sont effondrées
 *    de 78 % mais dont les tablettes clignotent et la facture est réglée
 *    ressortait à 66/100, soit « client correct » — exactement le client qu'on
 *    ne rappelle pas, et qu'on retrouve résilié six semaines plus tard. Le
 *    verdict est donc plafonné par celui que l'axe activité mériterait seul.
 *    Le score chiffré, lui, reste la moyenne honnête : c'est le verdict qui
 *    décide, pas le nombre, et `cappedBy` dit lequel des deux a parlé.
 */
export function compositeScore(axes: readonly CrmHealthAxis[]): CrmHealthScore {
  const measured = axes.filter((a) => a.measured && a.score !== null);
  const weight = measured.reduce((sum, a) => sum + a.weight, 0);
  // `adoption` et `paiement` sont toujours mesurables : le dénominateur ne peut
  // pas être nul. La garde est là pour que l'API ne rende jamais NaN si un axe
  // futur venait à changer cette propriété.
  const value =
    weight > 0
      ? Math.round(measured.reduce((sum, a) => sum + a.weight * (a.score ?? 0), 0) / weight)
      : 0;

  const average = verdictFor(value);
  const activite = axes.find((a) => a.key === 'activite');
  const ceiling =
    activite?.measured && activite.score !== null ? verdictFor(activite.score) : null;
  const capped = ceiling !== null && verdictRank(ceiling) > verdictRank(average);
  const verdict = capped && ceiling !== null ? ceiling : average;

  return {
    value,
    verdict,
    verdictLabel: HEALTH_VERDICT_LABELS[verdict],
    cappedBy: capped ? 'activite' : null,
    axes: [...axes],
  };
}

/** État d'un appareil ou d'un écran, rédigé plutôt qu'à interpréter côté web. */
export function toFleetUnit(
  raw: {
    _id: unknown;
    name?: string | null;
    paired?: boolean | null;
    lastSeenAt?: Date | null;
    revokedAt?: Date | null;
  },
  kind: RevocableDeviceKind,
  offlineAfterMs: number,
  now: Date,
): CrmFleetUnit {
  const lastSeenAt = raw.lastSeenAt ?? null;
  const paired = raw.paired === true;
  const elapsed = lastSeenAt ? now.getTime() - new Date(lastSeenAt).getTime() : null;
  const online = paired && elapsed !== null && elapsed <= offlineAfterMs;

  let statusLabel: string;
  if (raw.revokedAt && !paired) statusLabel = 'Révoqué — en attente de réappairage';
  else if (!paired) statusLabel = 'En attente d’appairage';
  else if (elapsed === null) statusLabel = 'Jamais connecté';
  else if (online) statusLabel = 'En ligne';
  else statusLabel = `Hors ligne depuis ${sinceLabel(elapsed)}`;

  return {
    id: String(raw._id),
    name: String(raw.name ?? ''),
    kind,
    kindLabel: REVOCABLE_DEVICE_KIND_LABELS[kind],
    paired,
    online,
    lastSeenAt: iso(lastSeenAt),
    statusLabel,
  };
}

export function buildFleet(units: readonly CrmFleetUnit[]): CrmFleet {
  const paired = units.filter((u) => u.paired);
  return {
    units: [...units],
    total: units.length,
    online: paired.filter((u) => u.online).length,
    offline: paired.filter((u) => !u.online).length,
    neverSeen: paired.filter((u) => u.lastSeenAt === null).length,
  };
}

/**
 * ADOPTION DES MODULES — ce qui révèle où former le client, et ce qu'il paie
 * sans s'en servir.
 *
 * « Ouvert » (`provisioned`) se lit sur des faits, pas sur une grille
 * tarifaire : la correspondance formule → modules n'est pas arrêtée
 * (`docs/specs/contraintes-business.md` §6.2 la laisse « à définir »), et
 * inventer un tableau ici produirait des alertes fausses sur toute la base.
 * On observe donc ce qui est réellement en place :
 *
 *  - CAISSE et ÉCRAN CUISINE : une tablette du bon type existe chez le client ;
 *  - COMMANDE EN LIGNE : ouverte pour tout le monde — la page de commande est
 *    servie dès la création du restaurant, sans aucun geste de sa part. C'est
 *    précisément ce qui en fait le module le plus souvent oublié ;
 *  - ÉCRANS DE SALLE : un téléviseur a été déclaré.
 *
 * « Utilisé » se lit sur l'USAGE réel : une commande passée pour les deux
 * canaux de vente, un battement de cœur pour les deux surfaces d'affichage.
 * Une tablette appairée qui n'a jamais émis un signe de vie n'est pas un
 * module utilisé, c'est un carton ouvert.
 */
export function buildModules(input: {
  posOrders: number;
  posLastOrderAt: Date | null;
  onlineOrders: number;
  onlineLastOrderAt: Date | null;
  kdsDevices: readonly CrmFleetUnit[];
  posDevices: readonly CrmFleetUnit[];
  screens: readonly CrmFleetUnit[];
}): CrmModuleAdoption[] {
  const lastSeen = (units: readonly CrmFleetUnit[]): string | null =>
    units
      .map((u) => u.lastSeenAt)
      .filter((d): d is string => d !== null)
      .sort()
      .at(-1) ?? null;

  const kdsLast = lastSeen(input.kdsDevices);
  const screenLast = lastSeen(input.screens);

  return [
    {
      key: 'caisse',
      label: MODULE_LABELS.caisse,
      provisioned: input.posDevices.length > 0,
      used: input.posOrders > 0,
      lastUsedAt: iso(input.posLastOrderAt),
      detail:
        input.posOrders > 0
          ? `${input.posOrders} commande(s) encaissée(s) à la caisse sur 30 j.`
          : 'Aucune commande encaissée à la caisse sur 30 j.',
    },
    {
      key: 'cuisine',
      label: MODULE_LABELS.cuisine,
      provisioned: input.kdsDevices.length > 0,
      used: kdsLast !== null,
      lastUsedAt: kdsLast,
      detail:
        input.kdsDevices.length === 0
          ? 'Aucun écran cuisine déclaré.'
          : kdsLast !== null
            ? `${input.kdsDevices.length} écran(s) cuisine, dernier signe de vie enregistré.`
            : `${input.kdsDevices.length} écran(s) cuisine déclaré(s), jamais connecté(s).`,
    },
    {
      key: 'commande_en_ligne',
      label: MODULE_LABELS.commande_en_ligne,
      // Servie sans action du restaurateur : toujours ouverte, donc toujours
      // comptée. C'est le module qu'on retrouve le plus souvent inutilisé.
      provisioned: true,
      used: input.onlineOrders > 0,
      lastUsedAt: iso(input.onlineLastOrderAt),
      detail:
        input.onlineOrders > 0
          ? `${input.onlineOrders} commande(s) en ligne sur 30 j.`
          : 'Page de commande en ligne ouverte, aucune commande reçue sur 30 j.',
    },
    {
      key: 'ecrans_salle',
      label: MODULE_LABELS.ecrans_salle,
      provisioned: input.screens.length > 0,
      used: screenLast !== null,
      lastUsedAt: screenLast,
      detail:
        input.screens.length === 0
          ? 'Aucun écran de salle déclaré.'
          : screenLast !== null
            ? `${input.screens.length} écran(s) de salle en service.`
            : `${input.screens.length} écran(s) de salle déclaré(s), jamais connecté(s).`,
    },
  ];
}

/** Gravité finale : bande de la famille + ampleur (0-9) à l'intérieur. */
export function gravityOf(kind: CrmSignalKind, magnitude: number): number {
  return SIGNAL_GRAVITY_BASE[kind] + clamp(Math.round(magnitude), 0, 9);
}

/**
 * Ordre d'appel : gravité décroissante, puis chiffre décroissant, puis nom du
 * restaurant. Le dernier critère n'a aucun sens métier — il n'est là que pour
 * qu'une file identique s'affiche deux fois dans le même ordre.
 */
export function sortSignals(signals: CrmSignal[]): CrmSignal[] {
  return [...signals].sort(
    (a, b) =>
      b.gravity - a.gravity || b.value - a.value || a.tenantName.localeCompare(b.tenantName, 'fr'),
  );
}

/**
 * LA FILE DE TRAVAIL — ce qui mérite un appel cette semaine, tous clients
 * confondus. Fonction pure : les lectures de base sont faites par le service,
 * la décision « faut-il appeler ? » est ici, où elle se teste.
 */
export function buildSignalsFor(
  client: {
    tenantId: string;
    tenantName: string;
    accountStatus: TenantAccountStatus;
    suspendedAt: Date | null;
    /** Entrée dans le parc — sert à distinguer « jamais démarré » de « tout neuf ». */
    since: Date | null;
    lastOrderAt: Date | null;
    orders7d: number;
    previousOrders7d: number;
    fleet: readonly CrmFleetUnit[];
    modules: readonly CrmModuleAdoption[];
  },
  now: Date,
): CrmSignal[] {
  const out: CrmSignal[] = [];
  const base = { tenantId: client.tenantId, tenantName: client.tenantName };

  // ─ Impayé : l'accès est coupé, c'est le dossier le plus chaud du parc ─
  if (isAccessBlocked(client.accountStatus)) {
    const days = daysSince(client.suspendedAt, now) ?? 0;
    out.push({
      ...base,
      kind: 'impaye',
      gravity: gravityOf('impaye', days / 7),
      title: 'Compte suspendu',
      detail: `Accès coupé depuis ${days} j — le restaurant travaille sans son outil.`,
      value: days,
      unit: 'jours',
      since: iso(client.suspendedAt),
    });
  }

  // ─ Jamais démarré : signé, installé, et pas une seule commande ─
  //
  // Distinct de l'arrêt d'activité, et il ne faut surtout pas les confondre :
  // « aucune commande depuis 12 j » sur un restaurant qui n'en a jamais passé
  // une seule enverrait l'équipe parler d'un décrochage à quelqu'un qui n'a
  // jamais commencé. C'est un appel d'ONBOARDING, pas de rétention — et c'est
  // le plus rentable du parc. Le délai de grâce est le même que le seuil de
  // risque : en dessous, le restaurant vient d'arriver, on le laisse s'installer.
  const age = daysSince(client.since, now);
  const silence = daysSince(client.lastOrderAt, now);
  if (client.lastOrderAt === null) {
    if (age !== null && age >= CLIENT_RISK_DAYS) {
      out.push({
        ...base,
        kind: 'arret_activite',
        gravity: gravityOf('arret_activite', age / 7),
        title: 'Jamais démarré',
        detail: `Client dans le parc depuis ${age} j sans une seule commande — l’installation n’a jamais abouti.`,
        value: age,
        unit: 'jours',
        since: iso(client.since),
      });
    }
  } else if (silence !== null && silence >= CLIENT_RISK_DAYS) {
    // ─ Arrêt total : il encaissait, il n'encaisse plus ─
    out.push({
      ...base,
      kind: 'arret_activite',
      gravity: gravityOf('arret_activite', silence - CLIENT_RISK_DAYS),
      title: 'Plus aucune commande',
      detail: `Aucune commande depuis ${silence} j — le restaurant a arrêté d’encaisser sur Snack Manager.`,
      value: silence,
      unit: 'jours',
      since: iso(client.lastOrderAt),
    });
  } else if (client.orders7d > 0 || client.previousOrders7d > 0) {
    // ─ Chute d'activité : il encaisse encore, mais nettement moins ─
    const pct = deltaPct(client.orders7d, client.previousOrders7d);
    if (
      pct !== null &&
      pct <= -ACTIVITY_DROP_PCT &&
      client.previousOrders7d >= ACTIVITY_DROP_MIN_ORDERS
    ) {
      out.push({
        ...base,
        kind: 'chute_activite',
        gravity: gravityOf('chute_activite', Math.abs(pct) / 10),
        title: 'Activité en chute',
        detail: `${client.orders7d} commandes sur 7 j contre ${client.previousOrders7d} la semaine précédente, soit ${frNumber(pct)} %.`,
        value: Math.abs(pct),
        unit: 'pourcent',
        since: iso(client.lastOrderAt),
      });
    }
  }

  // ─ Appareil muet : appairé, mais plus un signe de vie depuis 24 h ─
  for (const unit of client.fleet) {
    if (!unit.paired) continue;
    const elapsed = unit.lastSeenAt ? now.getTime() - new Date(unit.lastSeenAt).getTime() : null;
    if (elapsed !== null && elapsed < DEVICE_SILENT_AFTER_MS) continue;
    const hours = elapsed === null ? null : Math.floor(elapsed / HOUR_MS);
    out.push({
      ...base,
      kind: 'appareil_muet',
      gravity: gravityOf('appareil_muet', hours === null ? 9 : hours / 24 - 1),
      title: `${unit.kindLabel} muet — ${unit.name}`,
      detail:
        hours === null
          ? `${unit.kindLabel} « ${unit.name} » appairé mais jamais connecté : l’installation n’a pas été finie.`
          : `${unit.kindLabel} « ${unit.name} » sans signe de vie depuis ${sinceLabel(elapsed ?? 0)}.`,
      value: hours ?? 0,
      unit: 'heures',
      since: unit.lastSeenAt,
    });
  }

  // ─ Module ouvert jamais utilisé : de la formation, ou une ligne à justifier ─
  const idle = client.modules.filter((m) => m.provisioned && !m.used);
  if (idle.length > 0) {
    out.push({
      ...base,
      kind: 'module_inutilise',
      gravity: gravityOf('module_inutilise', idle.length - 1),
      title: `Module ouvert jamais utilisé — ${idle.map((m) => m.label).join(', ')}`,
      detail: `${idle.length} module(s) en service chez le client sans aucune utilisation : à former, ou à retirer de la facture.`,
      value: idle.length,
      unit: 'modules',
      since: null,
    });
  }

  return out;
}

// ─── Lignes d'agrégat MongoDB ───

type TenantActivityRow = {
  _id: unknown;
  lastOrderAt: Date | null;
  orders7: number;
  revenue7: number;
  ordersPrev7: number;
  revenuePrev7: number;
  orders30: number;
  revenue30: number;
  ordersPrev30: number;
  revenuePrev30: number;
  posOrders30: number;
  posLastAt: Date | null;
  onlineOrders30: number;
  onlineLastAt: Date | null;
};

const EMPTY_ACTIVITY: Omit<TenantActivityRow, '_id'> = {
  lastOrderAt: null,
  orders7: 0,
  revenue7: 0,
  ordersPrev7: 0,
  revenuePrev7: 0,
  orders30: 0,
  revenue30: 0,
  ordersPrev30: 0,
  revenuePrev30: 0,
  posOrders30: 0,
  posLastAt: null,
  onlineOrders30: 0,
  onlineLastAt: null,
};

/**
 * Bornes des quatre fenêtres, calculées une fois et partagées par la fiche
 * d'un client et par la file de travail : deux vues qui parleraient de « 7
 * jours » avec des bornes différentes finiraient par se contredire à l'écran.
 */
export function windowBounds(now: Date): {
  short: Date;
  shortPrev: Date;
  long: Date;
  longPrev: Date;
} {
  const t = now.getTime();
  return {
    short: new Date(t - SHORT_WINDOW_DAYS * DAY_MS),
    shortPrev: new Date(t - 2 * SHORT_WINDOW_DAYS * DAY_MS),
    long: new Date(t - LONG_WINDOW_DAYS * DAY_MS),
    longPrev: new Date(t - 2 * LONG_WINDOW_DAYS * DAY_MS),
  };
}

/**
 * Le `$group` d'activité, écrit une fois.
 *
 * Comptages sur les commandes non annulées, CA sur les seuls statuts
 * générateurs de recette : c'est la convention de `CrmService.listClients`, et
 * la fiche d'un client ne peut pas afficher un chiffre différent de la liste
 * d'où l'on vient de cliquer.
 */
function activityGroup(bounds: ReturnType<typeof windowBounds>): Record<string, unknown> {
  const between = (from: Date, to?: Date) =>
    to
      ? { $and: [{ $gte: ['$createdAt', from] }, { $lt: ['$createdAt', to] }] }
      : { $gte: ['$createdAt', from] };
  const orders = (from: Date, to?: Date) => ({ $sum: { $cond: [between(from, to), 1, 0] } });
  const revenue = (from: Date, to?: Date) => ({
    $sum: {
      $cond: [{ $and: [between(from, to), { $in: ['$status', REVENUE_STATUSES] }] }, '$totals.total', 0],
    },
  });
  const channelOrders = (channel: string, from: Date) => ({
    $sum: { $cond: [{ $and: [between(from), { $eq: ['$channel', channel] }] }, 1, 0] },
  });
  const channelLast = (channel: string) => ({
    $max: { $cond: [{ $eq: ['$channel', channel] }, '$createdAt', null] },
  });

  return {
    lastOrderAt: { $max: '$createdAt' },
    orders7: orders(bounds.short),
    revenue7: revenue(bounds.short),
    ordersPrev7: orders(bounds.shortPrev, bounds.short),
    revenuePrev7: revenue(bounds.shortPrev, bounds.short),
    orders30: orders(bounds.long),
    revenue30: revenue(bounds.long),
    ordersPrev30: orders(bounds.longPrev, bounds.long),
    revenuePrev30: revenue(bounds.longPrev, bounds.long),
    posOrders30: channelOrders('pos', bounds.long),
    posLastAt: channelLast('pos'),
    onlineOrders30: channelOrders('online', bounds.long),
    onlineLastAt: channelLast('online'),
  };
}

// ─── Service ───

type RawTenant = Tenant & { _id: unknown; createdAt?: Date };

@Injectable()
export class HealthService {
  private readonly logger = new Logger(HealthService.name);

  constructor(
    @InjectModel('Tenant') private readonly tenants: Model<Tenant>,
    @InjectModel('Order') private readonly orders: Model<Order>,
    @InjectModel('Device') private readonly devices: Model<Device>,
    @InjectModel('Screen') private readonly screens: Model<Screen>,
    @Inject(SUPPLY_DB) private readonly db: SupplyDb,
    private readonly admin: AdminService,
  ) {}

  /**
   * FICHE DE SANTÉ d'un restaurant : activité, score, adoption, parc, appro.
   *
   * La consultation est JOURNALISÉE, comme la fiche « compte » — ouvrir le
   * dossier d'un client est un accès à ses données, pas un geste neutre. C'est
   * exactement ce pour quoi `AdminService` est exporté par le module.
   */
  async tenantHealth(
    actor: JwtPayload,
    tenantId: string,
    now: Date = new Date(),
  ): Promise<CrmTenantHealth> {
    const tenant = await this.requireTenant(tenantId);
    const id = String(tenant._id);
    await this.admin.recordDetailView(actor, id);

    const bounds = windowBounds(now);
    const [activity, fleet, supply] = await Promise.all([
      this.tenantActivity(id, bounds),
      this.tenantFleet(id, now),
      this.supplyHealth(id, now),
    ]);

    const modules = buildModules({
      posOrders: activity.posOrders30,
      posLastOrderAt: activity.posLastAt,
      onlineOrders: activity.onlineOrders30,
      onlineLastOrderAt: activity.onlineLastAt,
      posDevices: fleet.units.filter((u) => u.kind === 'pos'),
      kdsDevices: fleet.units.filter((u) => u.kind === 'kds'),
      screens: fleet.units.filter((u) => u.kind === 'screen'),
    });

    const account = readAccount(tenant);
    const days = daysSince(activity.lastOrderAt, now);
    const health = clientHealth(activity.lastOrderAt, now);

    const axis = (
      key: CrmHealthAxisKey,
      r: { measured: boolean; score: number | null; detail: string },
    ): CrmHealthAxis => ({
      key,
      label: HEALTH_AXIS_LABELS[key],
      weight: HEALTH_AXIS_WEIGHTS[key],
      ...r,
    });

    const score = compositeScore([
      axis(
        'activite',
        scoreActivite({
          daysSinceLastOrder: days,
          orders7d: activity.orders7,
          previousOrders7d: activity.ordersPrev7,
          hasHistory: activity.lastOrderAt !== null,
        }),
      ),
      axis('adoption', scoreAdoption(modules)),
      axis('technique', scoreTechnique(fleet)),
      axis('paiement', scorePaiement(account.status)),
    ]);

    const plan = (tenant.plan ?? 'essentiel') as CrmTenantHealth['plan'];
    return {
      tenantId: id,
      name: String(tenant.name ?? ''),
      slug: String(tenant.slug ?? ''),
      plan,
      planLabel: PLAN_LABELS[plan] ?? plan,
      founderSeat: tenant.founderSeat === true,
      since: iso(tenant.createdAt) ?? now.toISOString(),
      account: {
        status: account.status,
        statusLabel: TENANT_ACCOUNT_STATUS_LABELS[account.status],
        accessBlocked: isAccessBlocked(account.status),
        since: iso(account.since) ?? iso(tenant.createdAt) ?? now.toISOString(),
        reason: account.reason,
      },
      activity: {
        last7d: buildWindow(
          SHORT_WINDOW_DAYS,
          { orders: activity.orders7, revenueCents: activity.revenue7 },
          { orders: activity.ordersPrev7, revenueCents: activity.revenuePrev7 },
        ),
        last30d: buildWindow(
          LONG_WINDOW_DAYS,
          { orders: activity.orders30, revenueCents: activity.revenue30 },
          { orders: activity.ordersPrev30, revenueCents: activity.revenuePrev30 },
        ),
        lastOrderAt: iso(activity.lastOrderAt),
        daysSinceLastOrder: days,
        health,
        healthLabel: CLIENT_HEALTH_LABELS[health],
      },
      score,
      modules,
      fleet,
      supply,
      computedAt: now.toISOString(),
    };
  }

  /**
   * LA FILE DE TRAVAIL — tous clients confondus, ce qui mérite un appel cette
   * semaine, trié par gravité.
   *
   * Non journalisée, et c'est délibéré : cette vue n'ouvre le dossier de
   * personne. Elle ne rend que des agrégats et des états de compte, exactement
   * comme la liste des clients. La consultation est tracée au moment où l'on
   * clique sur une ligne pour ouvrir la fiche.
   */
  async signals(now: Date = new Date()): Promise<CrmSignal[]> {
    const bounds = windowBounds(now);

    const [tenants, rows, devices, screens] = await Promise.all([
      this.tenants.find({}, { name: 1, slug: 1, account: 1, createdAt: 1 }).lean(),
      // Pas de filtre tenant : la file de travail est TRANS-TENANT par nature.
      // Le cloisonnement se joue sur le rôle du contrôleur, pas ici.
      this.orders.aggregate<TenantActivityRow>([
        { $match: { status: { $ne: 'cancelled' } } },
        { $group: { _id: '$tenantId', ...activityGroup(bounds) } },
      ]),
      this.devices.find({}, DEVICE_FIELDS).lean(),
      this.screens.find({}, SCREEN_FIELDS).lean(),
    ]);

    const activityByTenant = new Map(rows.map((r) => [String(r._id), r]));
    const fleetByTenant = new Map<string, CrmFleetUnit[]>();
    const push = (tenantId: string, unit: CrmFleetUnit) => {
      const list = fleetByTenant.get(tenantId) ?? [];
      list.push(unit);
      fleetByTenant.set(tenantId, list);
    };
    for (const d of devices) {
      push(
        String(d.tenantId),
        toFleetUnit(d, (d.kind ?? 'pos') as RevocableDeviceKind, DEVICE_OFFLINE_AFTER_MS, now),
      );
    }
    for (const s of screens) {
      push(String(s.tenantId), toFleetUnit(s, 'screen', SCREEN_OFFLINE_AFTER_MS, now));
    }

    const signals: CrmSignal[] = [];
    for (const tenant of tenants) {
      const id = String(tenant._id);
      const activity = activityByTenant.get(id) ?? EMPTY_ACTIVITY;
      const fleet = fleetByTenant.get(id) ?? [];
      const account = readAccount(tenant as RawTenant);
      const modules = buildModules({
        posOrders: activity.posOrders30,
        posLastOrderAt: activity.posLastAt,
        onlineOrders: activity.onlineOrders30,
        onlineLastOrderAt: activity.onlineLastAt,
        posDevices: fleet.filter((u) => u.kind === 'pos'),
        kdsDevices: fleet.filter((u) => u.kind === 'kds'),
        screens: fleet.filter((u) => u.kind === 'screen'),
      });

      signals.push(
        ...buildSignalsFor(
          {
            tenantId: id,
            tenantName: String(tenant.name ?? ''),
            accountStatus: account.status,
            suspendedAt: account.suspendedAt,
            since: (tenant as RawTenant).createdAt ?? null,
            lastOrderAt: activity.lastOrderAt,
            orders7d: activity.orders7,
            previousOrders7d: activity.ordersPrev7,
            fleet,
            modules,
          },
          now,
        ),
      );
    }

    return sortSignals(signals);
  }

  // ─── Lectures ───

  private async tenantActivity(
    tenantId: string,
    bounds: ReturnType<typeof windowBounds>,
  ): Promise<Omit<TenantActivityRow, '_id'>> {
    const rows = await this.orders.aggregate<TenantActivityRow>([
      // Le `tenantId` est dans le `$match` : une fiche de santé ne doit jamais
      // pouvoir mélanger deux restaurants, même sur un identifiant mal formé.
      { $match: { tenantId: new Types.ObjectId(tenantId), status: { $ne: 'cancelled' } } },
      { $group: { _id: null, ...activityGroup(bounds) } },
    ]);
    return rows[0] ?? EMPTY_ACTIVITY;
  }

  private async tenantFleet(tenantId: string, now: Date): Promise<CrmFleet> {
    const oid = new Types.ObjectId(tenantId);
    const [devices, screens] = await Promise.all([
      this.devices.find({ tenantId: oid }, DEVICE_FIELDS).sort({ createdAt: 1 }).lean(),
      this.screens.find({ tenantId: oid }, SCREEN_FIELDS).sort({ createdAt: 1 }).lean(),
    ]);
    return buildFleet([
      ...devices.map((d) =>
        toFleetUnit(d, (d.kind ?? 'pos') as RevocableDeviceKind, DEVICE_OFFLINE_AFTER_MS, now),
      ),
      ...screens.map((s) => toFleetUnit(s, 'screen', SCREEN_OFFLINE_AFTER_MS, now)),
    ]);
  }

  /**
   * APPROVISIONNEMENT — sous seuil, ruptures, hausses de prix récentes.
   *
   * Mêmes règles que `SupplyService.alerts`, à laquelle cette vue emprunte sa
   * définition d'une alerte : sous seuil = `currentStock < parLevel`, rupture =
   * `isOut`, hausse = prix courant supérieur au dernier prix historisé, changé
   * il y a moins de 30 jours. Le service n'est pas injecté (il appartient à un
   * autre module) mais la RÈGLE doit rester la même : un client ne peut pas
   * voir « 4 alertes » dans son back-office et nous « 6 » dans le nôtre.
   *
   * Le contexte supply vit dans PostgreSQL, pas dans Mongo : une panne de cette
   * base ne doit pas emporter la fiche entière, d'où le repli sur
   * `available: false` plutôt qu'une erreur.
   */
  private async supplyHealth(tenantId: string, now: Date): Promise<CrmSupplyHealth> {
    const cutoff = new Date(now.getTime() - LONG_WINDOW_DAYS * DAY_MS);
    try {
      const [rows, tenantSuppliers] = await Promise.all([
        this.db.query.ingredients.findMany({
          columns: { id: true, isOut: true, currentStock: true, parLevel: true },
          where: (t, { and, eq }) =>
            and(eq(t.tenantRef, tenantId), eq(t.active, true)),
        }),
        this.db.query.suppliers.findMany({
          columns: { id: true, name: true },
          where: (t, { and, eq }) => and(eq(t.tenantRef, tenantId), eq(t.active, true)),
          with: {
            items: {
              with: {
                ingredient: true,
                priceHistory: { orderBy: (h, { desc }) => [desc(h.recordedAt)], limit: 1 },
              },
            },
          },
        }),
      ]);

      const increases: CrmSupplyPriceIncrease[] = [];
      for (const supplier of tenantSuppliers) {
        for (const item of supplier.items) {
          const previous = item.priceHistory[0];
          if (!item.active || !previous) continue;
          if (previous.recordedAt < cutoff || item.packPriceCents <= previous.packPriceCents) {
            continue;
          }
          increases.push({
            ingredientName: item.ingredient.name,
            supplierName: supplier.name,
            previousPriceCents: previous.packPriceCents,
            packPriceCents: item.packPriceCents,
            increasePct:
              previous.packPriceCents > 0
                ? Math.round(
                    ((item.packPriceCents - previous.packPriceCents) / previous.packPriceCents) *
                      1000,
                  ) / 10
                : 100,
          });
        }
      }
      increases.sort((a, b) => b.increasePct - a.increasePct);

      return {
        available: true,
        belowPar: rows.filter((r) => Number(r.currentStock) < Number(r.parLevel)).length,
        ruptures: rows.filter((r) => r.isOut).length,
        priceIncreases30d: increases.length,
        topPriceIncreases: increases.slice(0, 3),
      };
    } catch (error) {
      this.logger.warn(
        `Appro indisponible pour ${tenantId} — fiche servie sans le volet stocks : ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return {
        available: false,
        belowPar: 0,
        ruptures: 0,
        priceIncreases30d: 0,
        topPriceIncreases: [],
      };
    }
  }

  private async requireTenant(tenantId: string): Promise<RawTenant> {
    // Un `:id` d'URL n'est pas forcément un ObjectId : sans ce garde-fou,
    // Mongoose lève une CastError et l'équipe reçoit un 500 au lieu d'un 404.
    if (!Types.ObjectId.isValid(tenantId)) throw new NotFoundException('Établissement introuvable');
    const raw = await this.tenants.findById(new Types.ObjectId(tenantId)).lean();
    if (!raw) throw new NotFoundException('Établissement introuvable');
    return raw as RawTenant;
  }
}

/**
 * Projections volontairement ÉTROITES.
 *
 * Ni jeton d'appareil, ni code d'appairage : ces deux champs sont des secrets
 * qui n'ont aucune raison de traverser une vue de pilotage. Ce qu'on lit tient
 * en cinq champs — qui, de quel type, appairé, vu quand, révoqué quand.
 */
const DEVICE_FIELDS = {
  name: 1,
  kind: 1,
  paired: 1,
  lastSeenAt: 1,
  revokedAt: 1,
  tenantId: 1,
  createdAt: 1,
} as const;

const SCREEN_FIELDS = {
  name: 1,
  paired: 1,
  lastSeenAt: 1,
  revokedAt: 1,
  tenantId: 1,
  createdAt: 1,
} as const;

/**
 * Bloc `account` d'un tenant, absence comprise.
 *
 * Les établissements créés avant ce champ n'en ont pas en base, et `.lean()`
 * ne matérialise pas les défauts Mongoose : l'absence vaut « essai », jamais
 * « anomalie » — même règle que dans `AdminService`.
 */
function readAccount(raw: RawTenant): {
  status: TenantAccountStatus;
  since: Date | null;
  reason: string;
  suspendedAt: Date | null;
} {
  const account = raw.account as
    | { status?: string; since?: Date; reason?: string; suspendedAt?: Date | null }
    | undefined;
  return {
    status: (account?.status ?? 'trial') as TenantAccountStatus,
    since: account?.since ?? null,
    reason: account?.reason ?? '',
    suspendedAt: account?.suspendedAt ?? null,
  };
}
