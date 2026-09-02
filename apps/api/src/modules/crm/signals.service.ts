import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, type PipelineStage } from 'mongoose';
import {
  CLIENT_RISK_DAYS,
  CRM_SIGNAL_SEVERITY_LABELS,
  CRM_SIGNAL_SEVERITY_RANK,
  DEVICE_OFFLINE_AFTER_MS,
  planChoiceLabel,
  SCREEN_OFFLINE_AFTER_MS,
  TENANT_ACCOUNT_STATUS_LABELS,
  daysSince,
  isAccessBlocked,
  statutEffectif,
  type CompteLu,
  summarizeOutstanding,
  type CrmOutstanding,
  type CrmQueueSignal,
  type CrmSignalKind,
  type CrmSignalSeverity,
  type RevocableDeviceKind,
  type TenantAccountStatus,
} from '@sm/contracts';
import type { Device, Order, Screen, SignalDismissal, Tenant } from '@sm/db';
import { stockMovements, type SupplyDb } from '@sm/supply';
import { sql } from 'drizzle-orm';
import { SUPPLY_DB } from '../../supply-db.module';
import { BillingService } from './billing.service';
// Le JUGEMENT de la fiche de santé est réutilisé tel quel, jamais recopié :
// `buildModules` décide de l'adoption, `toFleetUnit` de l'état d'un appareil,
// `windowBounds` des bornes des fenêtres. Deux surfaces qui parleraient de
// « module utilisé » ou de « 7 jours » avec des règles différentes finiraient
// par se contredire à l'écran, et c'est l'équipe qui arbitrerait au téléphone.
import {
  ACTIVITY_DROP_MIN_ORDERS,
  ACTIVITY_DROP_PCT,
  DEVICE_SILENT_AFTER_MS,
  buildModules,
  deltaPct,
  eurosLabel,
  frNumber,
  sinceLabel,
  toFleetUnit,
  windowBounds,
  type CrmFleetUnit,
  type CrmModuleAdoption,
} from './health.service';

/**
 * LA FILE DE SIGNAUX — « qui dois-je appeler cette semaine, et pour lui dire
 * quoi ».
 *
 * La liste des clients répond à « comment va le parc ? », la fiche de santé à
 * « comment va CE client ? ». Cette file-ci répond à la seule question qu'on se
 * pose vraiment le lundi matin, et elle y répond dans l'ordre : premier appel,
 * deuxième appel, troisième appel.
 *
 * ─── LA RÈGLE QUI TIENT TOUT LE FICHIER ───
 *
 * **AUCUN SIGNAL SANS CHIFFRE RÉEL DERRIÈRE.** Chaque ligne rendue ici porte un
 * nombre lu en base — des commandes comptées, des heures de silence, des euros
 * échus, des ingrédients en rupture — et la phrase qui l'accompagne dit ce
 * nombre. Rien n'est déduit d'une grille tarifaire qu'on aurait supposée, d'un
 * seuil « probable » ou d'un statut qu'on aurait interprété.
 *
 * Ce n'est pas de la coquetterie : un back-office qui crie au loup se fait
 * ignorer en deux semaines, et le jour où un vrai départ passe dans la file,
 * personne ne le lit. Un écran court et juste vaut mieux qu'un écran long et
 * bavard — d'où les SEUILS de ce fichier, tous choisis pour qu'un incident
 * ordinaire (un jour férié, une tablette éteinte entre deux services, un
 * ingrédient manquant) ne déclenche AUCUN appel.
 *
 * ─── CE QUI DÉCLENCHE UN GESTE ───
 *
 *  · `compte_suspendu`    — l'accès est coupé : le dossier le plus chaud du parc ;
 *  · `impaye`             — des factures échues, et depuis combien de jours ;
 *  · `arret_activite`     — il n'encaisse plus du tout, ou n'a jamais démarré ;
 *  · `appareil_muet`      — une caisse ou un écran s'est tu PENDANT que ça tournait ;
 *  · `chute_activite`     — 7 jours nettement en dessous des 7 précédents ;
 *  · `essai_qui_sacheve`  — la période d'essai touche à sa fin ;
 *  · `rupture_appro`      — plusieurs ingrédients en rupture en même temps ;
 *  · `module_dormant`     — un module ouvert chez le client et jamais servi.
 *
 * ─── CE QUE CETTE FILE NE DIT PAS ───
 *
 * Deux signaux mesurent MOINS que ce qu'on aimerait leur faire dire. Les deux
 * limites sont écrites ici, en tête, pour que personne ne les « corrige » un
 * jour en affirmant plus que ce que nous savons. Publiées aussi dans
 * `CRM_SIGNAL_LIMITS` (@sm/contracts), pour l'écran qui les affichera.
 *
 * 1. `module_dormant` NE DIT PAS « FACTURÉ ». Il dit deux faits lus en base :
 *    le module est OUVERT chez le client, et il ne sert pas. Il ne dit PAS que
 *    le client paie pour lui, parce qu'aucune correspondance formule → modules
 *    n'existe : `docs/specs/contraintes-business.md` §6.2 laisse le contenu des
 *    formules « à définir ». L'inventer produirait des alertes fausses sur tout
 *    le parc — et une équipe qui annonce à un restaurateur qu'il paie pour un
 *    module qu'il n'utilise pas a intérêt à ne pas se tromper. Ce qu'on en fait
 *    au renouvellement est une DÉCISION HUMAINE, pas une déduction de l'outil.
 *
 * 2. `rupture_appro` MESURE LA SIMULTANÉITÉ, PAS LA RÉCURRENCE. Le chiffre est
 *    le nombre d'ingrédients coupés À L'INSTANT DE LA LECTURE — trois produits
 *    hors carte en même temps, c'est une carte qui se ferme aujourd'hui. Il ne
 *    dit rien de « il est en rupture toutes les semaines » : rien n'historise
 *    les passages en rupture (`ingredients.isOut` est un booléen d'état, sans
 *    trace des transitions). Tant que cette table n'existe pas, la phrase
 *    rendue parle du présent, au présent.
 *
 * Les deux se lèveront le jour où la donnée existera — une grille
 * formule → modules, un historique des ruptures. Pas avant, et pas au jugé.
 *
 * ─── DÉGRADATION PROPRE ───
 *
 * La facturation (Mongo, `BillingService`) et l'approvisionnement (PostgreSQL)
 * sont des sources ANNEXES : si l'une tombe, la file se sert sans elle plutôt
 * que de rendre une erreur. Une file amputée reste utile ; une file en 500 ne
 * l'est pas. Les deux familles concernées disparaissent alors simplement, sans
 * signal approximatif pour faire nombre.
 *
 * ─── CLOISONNEMENT ET RESPECT DES CLIENTS DE NOS CLIENTS ───
 *
 * Ce service est TRANS-TENANT par construction : il balaie le parc entier et
 * n'a aucun garde-fou interne. Il n'est appelé que depuis `HealthController`,
 * qui porte `@Roles('sm_admin')`.
 *
 * Aucune requête ne lit le nom ni le téléphone d'un consommateur final : des
 * comptages, des sommes, des dates. Le fichier client d'un restaurateur lui
 * appartient.
 *
 * Cette vue n'est pas journalisée, et c'est délibéré — elle n'ouvre le dossier
 * de personne. La consultation est tracée au moment où l'on clique sur une
 * ligne pour ouvrir la fiche (`GET /crm/tenants/:id/health`).
 */

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
const LONG_WINDOW_DAYS = 30;

/**
 * CA = commandes prêtes + remises.
 *
 * Même convention que `StatsService`, `CrmService` et `HealthService`. Elle est
 * RECOPIÉE ici parce que `health.service.ts` ne l'exporte pas — la sortir de là
 * est signalé au rapport, car deux définitions du chiffre d'affaires dans le
 * même produit finissent toujours par diverger.
 */
const REVENUE_STATUSES = ['ready', 'delivered'];

// ─── Seuils (exportés : ce sont eux que les tests épinglent) ───

/**
 * DURÉE D'UNE PÉRIODE D'ESSAI, en jours.
 *
 * Convention ÉDITORIALE pour le parc HISTORIQUE, donnée réelle pour le reste.
 * `docs/specs/contraintes-business.md` §6.2 laisse le contenu des formules
 * « à définir » ; les comptes nés du pipeline, eux, portent un `trialEndsAt`
 * écrit à la conversion, et c'est lui qui fait foi (cf. le calcul du signal).
 * Cette constante sert aux tenants d'avant ce champ, dont on ne mesure que
 * l'ANCIENNETÉ du statut « essai » (`account.since`).
 *
 * C'est aussi la seule population sur laquelle « Essai dépassé » peut encore
 * se déclencher : un compte qui porte un terme vaut `active` dès ce terme
 * (`statutEffectif`, lu par `readAccount`), et sort donc du signal. Un essai
 * sans terme écrit, lui, ne peut pas se clore tout seul — il faut continuer de
 * le rappeler à l'équipe.
 */
export const TRIAL_DAYS = 30;

/** On appelle dans les dix derniers jours de l'essai, pas le premier jour. */
export const TRIAL_WARNING_DAYS = 10;

/** Sous trois jours restants, l'essai se joue : l'appel passe en critique. */
export const TRIAL_CRITICAL_DAYS = 3;

/** Répit d'un signal « traité » avant qu'il ne revienne si sa cause persiste. */
export const DISMISS_DAYS = 7;

/**
 * SILENCE MINIMAL D'UN APPAREIL avant qu'on en parle, quand le restaurant
 * tourne : une heure.
 *
 * Bien plus court que `DEVICE_SILENT_AFTER_MS` (24 h), et c'est tout l'intérêt
 * de ce signal : une caisse morte coûte à la minute. Mais une heure seule ne
 * suffit pas — toutes les tablettes du parc se taisent chaque nuit. Il faut EN
 * PLUS la preuve que le restaurant travaillait pendant ce silence (cf.
 * `mutedUnits`). Sans cette seconde condition, la file hurlerait tous les
 * matins à 3 h sur le parc entier, et plus personne ne la lirait.
 */
export const DEVICE_MUTE_MIN_MS = HOUR_MS;

/** Au-delà, un appareil muet n'est plus un incident, c'est une panne installée. */
export const MUTED_CRITICAL_ORDERS = 5;

/** Impayé : on relance amiablement avant, on met en demeure après. */
export const OVERDUE_CRITICAL_DAYS = 15;

/** Une chute de moitié ou pire ne s'explique plus par la météo. */
export const ACTIVITY_DROP_CRITICAL_PCT = 60;

/**
 * RUPTURES : trois ingrédients coupés EN MÊME TEMPS, c'est une carte qui se
 * ferme produit par produit. Un ou deux, c'est la vie d'un fast-food, et
 * l'écran d'appro du gérant le lui dit déjà — l'appeler pour ça, c'est lui
 * répéter ce qu'il voit.
 */
export const SUPPLY_OUT_MIN = 3;

/** Au-delà, ce n'est plus l'appro qui déraille, c'est le service. */
export const SUPPLY_OUT_CRITICAL = 8;

/** En dessous, le registre d'ingrédients n'est pas « configuré », il est ébauché. */
export const SUPPLY_SETUP_MIN_INGREDIENTS = 10;

/**
 * Plafond de lectures ponctuelles « combien de commandes depuis que cet
 * appareil s'est tu ? ». Bornée pour qu'un parc entier hors ligne (coupure
 * régionale, panne de notre côté) ne déclenche pas mille requêtes.
 */
export const MAX_SILENT_ORDER_LOOKUPS = 100;

// ─── Types de sortie ───

/**
 * LA FORME DE LA FILE EST PUBLIÉE, elle ne vit plus ici.
 *
 * `CrmQueueSignal`, les huit familles, les trois bandes et les unités sont
 * désormais dans `@sm/contracts` (`signals.ts`) : ce fichier n'en est plus que
 * le PRODUCTEUR. C'est ce qui manquait au tour précédent — la forme a changé
 * (familles renommées, `severity`, `action`, `href`, `id`, `ageDays` ajoutés)
 * sans rien publier, si bien que l'écran la relisait à la main avec des
 * lecteurs défensifs et que la rupture suivante se serait vue à l'exécution.
 *
 * Réexportés ici pour que les appelants internes (tests, contrôleur) ne
 * changent pas d'import : ce qui compte est qu'il n'existe plus qu'UNE
 * déclaration, et qu'elle soit lisible des deux côtés du réseau.
 */
export type {
  CrmQueueSignal,
  CrmSignalKind,
  CrmSignalSeverity,
  CrmSignalUnit,
} from '@sm/contracts';

/**
 * Bandes de gravité, par famille.
 *
 * L'ordre est un choix ÉDITORIAL assumé : c'est l'ordre dans lequel on décroche
 * le téléphone. Un bonus 0-9 à l'intérieur de la bande classe l'ampleur, si
 * bien qu'une chute de −85 % passe devant une chute de −31 % mais jamais devant
 * une caisse morte.
 */
export const SIGNAL_GRAVITY_BASE: Record<CrmSignalKind, number> = {
  compte_suspendu: 90,
  impaye: 80,
  arret_activite: 70,
  appareil_muet: 60,
  chute_activite: 50,
  essai_qui_sacheve: 40,
  rupture_appro: 30,
  module_dormant: 20,
};

// ─── Entrées du jugement ───

/** L'appro d'un restaurant, réduite à ce que la file regarde. */
export type SupplySnapshot = {
  /** Ingrédients actifs suivis par ce restaurant. */
  ingredients: number;
  suppliers: number;
  /** Ruptures DÉCLARÉES (`isOut`) — celles qui coupent des produits à la carte. */
  out: number;
  /** Stock tombé à zéro sans que la rupture ait été déclarée. */
  starved: number;
  belowPar: number;
  /** Mouvements de stock enregistrés depuis toujours. */
  movements: number;
  movements30d: number;
  lastMovementAt: Date | null;
};

export type SignalClient = {
  tenantId: string;
  tenantName: string;
  tenantSlug: string;
  /** `null` = client Atelier seul — aucun abonnement logiciel. */
  plan: 'essentiel' | 'complet' | 'boost' | null;
  accountStatus: TenantAccountStatus;
  /** Début du statut COURANT — c'est lui qui date une période d'essai. */
  accountSince: Date | null;
  /**
   * Fin d'essai POSÉE en base à la création du compte (24/08/2026). `null`
   * sur les tenants d'avant : le signal retombe sur l'ancienneté du statut
   * et la convention TRIAL_DAYS — le raisonnement annoncé en tête de fichier.
   */
  trialEndsAt: Date | null;
  suspendedAt: Date | null;
  /** Entrée dans le parc. */
  since: Date | null;
  activity: {
    lastOrderAt: Date | null;
    orders7d: number;
    previousOrders7d: number;
    revenue7Cents: number;
    previousRevenue7Cents: number;
    orders30d: number;
  };
  fleet: readonly CrmFleetUnit[];
  /**
   * Commandes encaissées depuis qu'un appareil s'est tu, par identifiant
   * d'appareil. Absent = non mesuré (plafond atteint), pas « zéro ».
   */
  ordersSinceSilent: ReadonlyMap<string, number>;
  modules: readonly CrmModuleAdoption[];
  /** `null` = facturation injoignable : la famille « impayé » est retirée. */
  outstanding: CrmOutstanding | null;
  /** `null` = appro injoignable : les familles « rupture » et « stocks » le sont. */
  supply: SupplySnapshot | null;
};

// ─── Fonctions pures (le jugement, testable sans base) ───

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

const iso = (d: Date | string | null | undefined): string | null =>
  d ? new Date(d).toISOString() : null;

/**
 * Marque du pluriel français. Les phrases de cette file sont LUES, pas
 * survolées : « 1 commandes » ou « 4 alerte(s) » au milieu d'un argumentaire
 * qu'on répète au téléphone abîme la crédibilité de l'écran plus vite qu'une
 * mauvaise donnée.
 */
const s = (n: number): string => (Math.abs(n) > 1 ? 's' : '');

/**
 * Comment nommer un appareil sans bégayer.
 *
 * La moitié du parc porte un nom qui EST déjà son type — l'écran cuisine de
 * Class'Food s'appelle « Écran cuisine ». « Écran cuisine « Écran cuisine » »
 * est le genre de détail qui fait douter du reste de la ligne.
 */
export function unitLabel(unit: CrmFleetUnit): string {
  const name = unit.name.trim();
  if (name === '' || name.toLowerCase() === unit.kindLabel.toLowerCase()) return unit.kindLabel;
  return `${unit.kindLabel} « ${name} »`;
}

/** Gravité finale : bande de la famille + ampleur (0-9) à l'intérieur. */
export function gravityOf(kind: CrmSignalKind, magnitude: number): number {
  return SIGNAL_GRAVITY_BASE[kind] + clamp(Math.round(magnitude), 0, 9);
}

/** La fiche du client dans le back-office SM — le clic qui suit la lecture. */
export const tenantHref = (tenantId: string): string => `/sm/clients/${tenantId}`;

/**
 * ORDRE D'APPEL : gravité d'abord, ancienneté ensuite.
 *
 * 1. la bande (`critique` avant `attention` avant `info`) ;
 * 2. la gravité chiffrée, décroissante, à l'intérieur de la bande ;
 * 3. LE PLUS ANCIEN D'ABORD — même convention que la file de recouvrement de
 *    `BillingService` : à situation égale, on commence par ce qui pourrit
 *    depuis le plus longtemps. Un signal sans date passe en dernier, faute de
 *    pouvoir être comparé ;
 * 4. le nom du restaurant, puis l'identifiant : aucun sens métier, seulement la
 *    garantie qu'une file identique s'affiche deux fois dans le même ordre.
 */
export function sortQueue(signals: readonly CrmQueueSignal[]): CrmQueueSignal[] {
  return [...signals].sort((a, b) => {
    const bySeverity =
      CRM_SIGNAL_SEVERITY_RANK[a.severity] - CRM_SIGNAL_SEVERITY_RANK[b.severity];
    if (bySeverity !== 0) return bySeverity;
    if (b.gravity !== a.gravity) return b.gravity - a.gravity;
    if (a.since !== b.since) {
      if (a.since === null) return 1;
      if (b.since === null) return -1;
      // Comparaison lexicographique d'ISO : c'est aussi une comparaison
      // chronologique, et le plus ancien est le plus petit.
      return a.since < b.since ? -1 : 1;
    }
    return a.tenantName.localeCompare(b.tenantName, 'fr') || a.id.localeCompare(b.id);
  });
}

/**
 * LES APPAREILS QU'IL FAUT SIGNALER, et pourquoi.
 *
 * Trois situations, et une seule d'entre elles est un « hors ligne » ordinaire :
 *
 *  · JAMAIS CONNECTÉ — appairé, aucun signe de vie depuis l'installation.
 *    L'installation n'a pas été finie, et personne ne nous l'a dit.
 *  · MUET PENDANT LE SERVICE — silencieux depuis au moins une heure ALORS QUE
 *    des commandes sont passées après qu'il s'est tu. C'est la condition qui
 *    rend ce signal utilisable : un restaurant fermé ne produit aucune commande
 *    postérieure, donc aucun signal, quelle que soit la durée du silence.
 *  · MUET DEPUIS PLUS DE 24 H — au-delà, l'absence de commandes n'excuse plus
 *    rien : `DEVICE_SILENT_AFTER_MS` est le seuil que la fiche de santé utilise
 *    déjà pour dire qu'un appareil n'est pas « en retard » mais CASSÉ.
 *
 * Les appareils non appairés sont ignorés : ils ne sont pas en panne, ils ne
 * sont pas encore installés.
 */
export function mutedUnits(
  fleet: readonly CrmFleetUnit[],
  lastOrderAt: Date | null,
  now: Date,
): { unit: CrmFleetUnit; elapsedMs: number | null; longSilence: boolean }[] {
  const out: { unit: CrmFleetUnit; elapsedMs: number | null; longSilence: boolean }[] = [];
  for (const unit of fleet) {
    if (!unit.paired) continue;
    if (unit.lastSeenAt === null) {
      out.push({ unit, elapsedMs: null, longSilence: false });
      continue;
    }
    const seen = new Date(unit.lastSeenAt).getTime();
    const elapsedMs = now.getTime() - seen;
    const longSilence = elapsedMs >= DEVICE_SILENT_AFTER_MS;
    const workedSince = lastOrderAt !== null && new Date(lastOrderAt).getTime() > seen;
    if (!longSilence && !(elapsedMs >= DEVICE_MUTE_MIN_MS && workedSince)) continue;
    out.push({ unit, elapsedMs, longSilence });
  }
  return out;
}

/**
 * Un module tel que la file le regarde : ouvert ou non, servi ou non, et la
 * phrase chiffrée qui le dit.
 *
 * Volontairement plus LARGE que `CrmModuleAdoption` sur la seule clé, pour
 * accueillir un cinquième module (`stocks`) que la fiche de santé ne liste pas
 * encore. Les quatre autres arrivent tels quels de `buildModules` : leur
 * jugement n'est pas recalculé ici, il est réutilisé.
 */
export type SignalModule = {
  key: string;
  label: string;
  provisioned: boolean;
  used: boolean;
  detail: string;
};

/**
 * LE MODULE « SUIVI DES STOCKS », lu sur des faits et non sur une formule.
 *
 * `provisioned` : le restaurateur a monté son registre — assez d'ingrédients
 * actifs pour que ce ne soit pas une ébauche, et au moins un fournisseur.
 * `used` : au moins un mouvement de stock enregistré (réception, perte,
 * inventaire). Les recettes et les tarifs fournisseurs ne comptent PAS comme un
 * usage : ils se saisissent une fois à l'installation, souvent par nous.
 *
 * C'est exactement la distinction que fait `buildModules` pour les quatre
 * autres modules — ouvert d'un côté, servi de l'autre.
 *
 * ATTENTION à ce que cette règle NE DIT PAS : elle ne prétend pas que le module
 * est facturé. La correspondance formule → modules n'est pas arrêtée
 * (`docs/specs/contraintes-business.md` §6.2 la laisse « à définir »), et
 * l'inventer produirait des alertes fausses sur tout le parc. Ce qui est
 * affirmé — et vérifiable — c'est qu'il est OUVERT et qu'il ne sert pas ; ce
 * qu'on en fait au renouvellement est une décision humaine, pas une déduction.
 */
export function stocksModule(supply: SupplySnapshot): SignalModule {
  const provisioned = supply.ingredients >= SUPPLY_SETUP_MIN_INGREDIENTS && supply.suppliers > 0;
  const used = supply.movements > 0;
  return {
    key: 'stocks',
    label: 'Suivi des stocks',
    provisioned,
    used,
    detail: !provisioned
      ? `${supply.ingredients} ingrédient(s) et ${supply.suppliers} fournisseur(s) — registre pas encore monté.`
      : used
        ? `${supply.movements} mouvement(s) de stock enregistré(s), dont ${supply.movements30d} sur 30 j.`
        : `${supply.ingredients} ingrédients et ${supply.suppliers} fournisseurs configurés, aucun mouvement de stock jamais enregistré — les ${supply.belowPar} alerte${s(supply.belowPar)} de réassort que voit le gérant se calculent sur un stock qui ne bouge pas.`,
  };
}

/**
 * LA DÉCISION, restaurant par restaurant.
 *
 * Fonction PURE : les lectures de base sont faites par le service, le jugement
 * « faut-il appeler, et pour dire quoi » est ici, où il se teste sans Mongo ni
 * PostgreSQL.
 */
export function signalsForClient(client: SignalClient, now: Date): CrmQueueSignal[] {
  const out: CrmQueueSignal[] = [];
  const base = {
    tenantId: client.tenantId,
    tenantName: client.tenantName,
    tenantSlug: client.tenantSlug,
    planLabel: planChoiceLabel(client.plan),
    accountStatus: client.accountStatus,
    accountStatusLabel: TENANT_ACCOUNT_STATUS_LABELS[client.accountStatus],
    href: tenantHref(client.tenantId),
  };

  // Le libellé de gravité et l'ancienneté en jours sont DÉRIVÉS ici, une fois :
  // deux lignes de la file ne peuvent pas afficher deux traductions du même
  // mot, et l'écran n'a pas à recalculer une date.
  const push = (
    signal: Omit<CrmQueueSignal, keyof typeof base | 'severityLabel' | 'ageDays'>,
  ): void => {
    out.push({
      ...base,
      ...signal,
      severityLabel: CRM_SIGNAL_SEVERITY_LABELS[signal.severity],
      ageDays: signal.since === null ? null : daysSince(signal.since, now),
    });
  };

  // ─ Compte suspendu : l'accès est coupé, c'est le dossier le plus chaud ─
  if (isAccessBlocked(client.accountStatus)) {
    const days = daysSince(client.suspendedAt ?? client.accountSince, now) ?? 0;
    const ardoise =
      client.outstanding && client.outstanding.totalDueCents > 0
        ? ` — ${client.outstanding.totalDueLabel} au compteur`
        : '';
    push({
      id: `compte_suspendu:${client.tenantId}`,
      kind: 'compte_suspendu',
      severity: 'critique',
      gravity: gravityOf('compte_suspendu', days / 7),
      title: 'Compte suspendu',
      detail: `Accès coupé ${days === 0 ? 'aujourd’hui' : `depuis ${days} j`}${ardoise} — le restaurant travaille sans son outil.`,
      action: 'Rappeler aujourd’hui : réactiver dès le règlement, ou acter le départ.',
      value: days,
      unit: 'jours',
      since: iso(client.suspendedAt ?? client.accountSince),
    });
  }

  // ─ Impayé : des factures ÉCHUES, et depuis combien de jours ─
  //
  // La source est `BillingService` : « impayé » n'est plus une interprétation du
  // statut de compte (la CONSÉQUENCE), c'est le total réellement échu (la
  // CAUSE). Quand la facturation est injoignable, la famille disparaît — on ne
  // devine pas une créance.
  const due = client.outstanding;
  if (due && due.overdueInvoices > 0) {
    const days = due.oldestOverdueDays;
    const pieces = due.overdueInvoices > 1 ? `${due.overdueInvoices} factures` : '1 facture';
    push({
      id: `impaye:${client.tenantId}`,
      kind: 'impaye',
      severity: days >= OVERDUE_CRITICAL_DAYS ? 'critique' : 'attention',
      gravity: gravityOf('impaye', days / 7),
      title: `Impayé — ${due.overdueLabel}`,
      detail: `${pieces} en retard pour ${due.overdueLabel}, la plus ancienne échue depuis ${days} j.`,
      action:
        days >= 30
          ? 'Mise en demeure, puis suspension si rien n’est réglé sous huit jours.'
          : 'Relance amiable au téléphone, et proposer le prélèvement pour la suite.',
      value: days,
      unit: 'jours',
      since: due.oldestOverdueAt,
    });
  }

  // ─ Activité : de l'arrêt total à la simple chute ─
  //
  // Les trois cas s'excluent, et il ne faut surtout pas les confondre :
  // « aucune commande depuis 12 j » sur un restaurant qui n'en a jamais passé
  // une seule enverrait l'équipe parler d'un décrochage à quelqu'un qui n'a
  // jamais commencé. C'est un appel d'ONBOARDING, pas de rétention.
  const age = daysSince(client.since, now);
  const silence = daysSince(client.activity.lastOrderAt, now);
  if (client.activity.lastOrderAt === null) {
    if (age !== null && age >= CLIENT_RISK_DAYS) {
      push({
        id: `arret_activite:${client.tenantId}`,
        kind: 'arret_activite',
        severity: 'critique',
        gravity: gravityOf('arret_activite', age / 7),
        title: 'Jamais démarré',
        detail: `Client dans le parc depuis ${age} j sans une seule commande — l’installation n’a jamais abouti.`,
        action: 'Reprendre l’installation sur place ou en visio : c’est l’appel le plus rentable du parc.',
        value: age,
        unit: 'jours',
        since: iso(client.since),
      });
    }
  } else if (silence !== null && silence >= CLIENT_RISK_DAYS) {
    push({
      id: `arret_activite:${client.tenantId}`,
      kind: 'arret_activite',
      severity: 'critique',
      gravity: gravityOf('arret_activite', silence - CLIENT_RISK_DAYS),
      title: 'Plus aucune commande',
      detail: `Aucune commande depuis ${silence} j — le restaurant a arrêté d’encaisser sur Snack Manager.`,
      action: 'Appeler le gérant aujourd’hui : panne, fermeture, ou départ en cours.',
      value: silence,
      unit: 'jours',
      since: iso(client.activity.lastOrderAt),
    });
  } else {
    // ─ Chute nette : il encaisse encore, mais nettement moins ─
    //
    // Deux garde-fous, et ils sont indissociables : le POURCENTAGE (−30 %, en
    // dessous c'est la météo ou un jour férié) et le VOLUME de référence (5
    // commandes, en dessous le pourcentage ne veut rien dire — passer de 2 à 1
    // commande, ce n'est pas « −50 % », c'est du bruit).
    const pct = deltaPct(client.activity.orders7d, client.activity.previousOrders7d);
    if (
      pct !== null &&
      pct <= -ACTIVITY_DROP_PCT &&
      client.activity.previousOrders7d >= ACTIVITY_DROP_MIN_ORDERS
    ) {
      const lostCents = Math.max(
        0,
        client.activity.previousRevenue7Cents - client.activity.revenue7Cents,
      );
      const money = lostCents > 0 ? `, soit ${eurosLabel(lostCents)} encaissés en moins` : '';
      push({
        id: `chute_activite:${client.tenantId}`,
        kind: 'chute_activite',
        severity: pct <= -ACTIVITY_DROP_CRITICAL_PCT ? 'critique' : 'attention',
        gravity: gravityOf('chute_activite', Math.abs(pct) / 10),
        title: 'Activité en chute',
        detail: `${client.activity.orders7d} commandes sur 7 j contre ${client.activity.previousOrders7d} les 7 précédents (${frNumber(pct)} %)${money}.`,
        action: 'Appeler pour chercher la cause — travaux, concurrence, panne — avant qu’elle s’installe.',
        value: Math.abs(pct),
        unit: 'pourcent',
        since: iso(client.activity.lastOrderAt),
      });
    }
  }

  // ─ Appareil muet : une caisse morte coûte à la minute ─
  for (const { unit, elapsedMs, longSilence } of mutedUnits(
    client.fleet,
    client.activity.lastOrderAt,
    now,
  )) {
    const who = unitLabel(unit);
    if (elapsedMs === null) {
      push({
        id: `appareil_muet:${client.tenantId}:${unit.id}`,
        kind: 'appareil_muet',
        severity: 'attention',
        gravity: gravityOf('appareil_muet', 9),
        title: `${who} jamais connecté`,
        detail: `${who} appairé mais sans le moindre signe de vie : l’installation n’a pas été finie.`,
        action: 'Rappeler l’installateur : appairage fait, matériel jamais allumé.',
        value: 0,
        unit: 'heures',
        since: null,
      });
      continue;
    }

    const hours = Math.floor(elapsedMs / HOUR_MS);
    const missed = client.ordersSinceSilent.get(unit.id) ?? 0;
    // Une CAISSE muette est toujours critique : elle n'encaisse plus, et chaque
    // minute est un client au comptoir qui attend. Un écran cuisine ou de salle
    // ne le devient qu'au-delà de 24 h, ou quand assez de commandes lui sont
    // passées sous le nez.
    const severity: CrmSignalSeverity =
      unit.kind === 'pos' || longSilence || missed >= MUTED_CRITICAL_ORDERS
        ? 'critique'
        : 'attention';
    // Le chiffre qui change la conversation : « hors ligne » le gérant le voit,
    // « le restaurant a pris douze commandes depuis » non.
    const missedPhrase =
      missed > 0 ? ` — le restaurant a pris ${missed} commande${s(missed)} depuis` : '';
    push({
      id: `appareil_muet:${client.tenantId}:${unit.id}`,
      kind: 'appareil_muet',
      severity,
      gravity: gravityOf('appareil_muet', hours / 24),
      title: `${who} muet`,
      detail: `${who} sans signe de vie depuis ${sinceLabel(elapsedMs)}${missedPhrase}.`,
      action: longSilence
        ? 'Panne installée : diagnostiquer et prévoir un remplacement de matériel.'
        : 'Appeler le comptoir : tablette débranchée, wifi coupé ou application fermée.',
      value: hours,
      unit: 'heures',
      since: unit.lastSeenAt,
    });
  }

  // ─ Essai qui s'achève ─
  //
  // Le statut lu est l'EFFECTIF (`readAccount` → `statutEffectif`) : un compte
  // dont le terme est passé vaut `active` et sort d'ici de lui-même. Le signal
  // annonce donc une échéance À VENIR, au lieu de crier « essai dépassé »
  // chaque matin sur un client entré en facturation depuis un an — c'est
  // exactement ce qu'il faisait, et une file qu'on n'écoute plus ne sert plus.
  if (client.accountStatus === 'trial') {
    const inTrial = daysSince(client.accountSince ?? client.since, now);
    // L'échéance RÉELLE quand elle est en base (comptes créés depuis le
    // pipeline), la convention TRIAL_DAYS sinon. « Essai dépassé » ci-dessous
    // ne concerne donc plus QUE le second cas : un essai sans terme écrit ne
    // peut se clore tout seul, et il faut bien que quelqu'un le rappelle.
    const remaining =
      client.trialEndsAt !== null
        ? Math.ceil((client.trialEndsAt.getTime() - now.getTime()) / 86_400_000)
        : inTrial === null
          ? null
          : TRIAL_DAYS - inTrial;
    if (inTrial !== null && remaining !== null && remaining <= TRIAL_WARNING_DAYS) {
      const used = client.activity.orders30d > 0;
      const late = remaining < 0;
      push({
        id: `essai_qui_sacheve:${client.tenantId}`,
        kind: 'essai_qui_sacheve',
        severity: late || remaining <= TRIAL_CRITICAL_DAYS ? 'critique' : 'attention',
        gravity: gravityOf('essai_qui_sacheve', 9 - clamp(remaining, 0, 9)),
        title: late ? 'Essai dépassé' : 'Fin d’essai',
        detail: late
          ? `En essai depuis ${inTrial} j, soit ${-remaining} j au-delà des ${TRIAL_DAYS} prévus — ${used ? `${client.activity.orders30d} commandes encaissées sur 30 j` : 'et toujours aucune commande encaissée'}.`
          : `En essai depuis ${inTrial} j, il reste ${remaining} j sur ${TRIAL_DAYS} — ${used ? `${client.activity.orders30d} commandes encaissées sur 30 j` : 'aucune commande encaissée pour l’instant'}.`,
        action: used
          ? 'Il s’en sert : appeler pour signer l’abonnement avant la fin de l’essai.'
          : 'Rien n’est encaissé : reprendre l’installation avant de parler d’abonnement.',
        value: Math.abs(remaining),
        unit: 'jours',
        since: iso(client.accountSince ?? client.since),
      });
    }
  }

  // ─ Ruptures d'ingrédients ─
  //
  // SIMULTANÉITÉ, jamais récurrence : le chiffre est celui de l'instant de la
  // lecture (cf. « CE QUE CETTE FILE NE DIT PAS », en tête de fichier). Rien
  // n'historise les passages en rupture, donc la phrase parle au présent.
  const supply = client.supply;
  if (supply) {
    const broken = supply.out + supply.starved;
    if (broken >= SUPPLY_OUT_MIN) {
      const zero =
        supply.starved > 0
          ? ` et ${supply.starved} à stock nul sans rupture déclarée`
          : '';
      push({
        id: `rupture_appro:${client.tenantId}`,
        kind: 'rupture_appro',
        severity: broken >= SUPPLY_OUT_CRITICAL ? 'critique' : 'attention',
        gravity: gravityOf('rupture_appro', broken / 2),
        title: 'Ruptures d’ingrédients',
        detail: `${supply.out} ingrédient${s(supply.out)} en rupture${zero} sur ${supply.ingredients} suivis, et ${supply.belowPar} sous le seuil de réassort — la carte se ferme produit par produit.`,
        action: 'Revoir les seuils de réassort avec le gérant et caler une commande fournisseur récurrente.',
        value: broken,
        unit: 'ingredients',
        since: null,
      });
    }
  }

  // ─ Module ouvert et jamais servi : à former, ou à retirer de la facture ─
  //
  // UN SIGNAL PAR MODULE, et non un signal groupé : « former à l'écran cuisine »
  // et « pousser la commande en ligne » ne se disent pas dans le même appel, ni
  // forcément à la même personne.
  //
  // OUVERT ET INUTILISÉ, jamais « facturé » : aucune correspondance
  // formule → modules n'existe (cf. « CE QUE CETTE FILE NE DIT PAS », en tête
  // de fichier). La sévérité ci-dessous distingue un client qu'on facture d'un
  // client en essai — c'est une question de MOMENT de l'appel, pas une
  // affirmation sur le contenu de sa facture.
  const dormant: SignalModule[] = [
    ...client.modules,
    ...(supply ? [stocksModule(supply)] : []),
  ].filter((m) => m.provisioned && !m.used);
  // `trial` ne facture pas encore, `churned` ne facturera plus : dans les deux
  // cas il n'y a pas de ligne à défendre au renouvellement.
  const billable = client.accountStatus === 'active' || client.accountStatus === 'suspended';
  for (const module of dormant) {
    push({
      id: `module_dormant:${client.tenantId}:${module.key}`,
      kind: 'module_dormant',
      // Un module qui dort chez un client FACTURÉ, c'est la ligne qu'on perd au
      // renouvellement — on appelle cette semaine. Chez un client en essai
      // (rien n'est encore facturé) ou parti (il n'y a plus de renouvellement à
      // sauver), c'est un simple prétexte d'appel.
      severity: billable ? 'attention' : 'info',
      gravity: gravityOf('module_dormant', billable ? 5 : 0),
      title: `Module ouvert jamais utilisé — ${module.label}`,
      detail: module.detail,
      action: 'Former le gérant sur ce module, ou le retirer de l’offre au renouvellement.',
      value: 1,
      unit: 'modules',
      since: null,
    });
  }

  return out;
}

// ─── Lignes d'agrégat ───

type ActivityRow = {
  _id: unknown;
  lastOrderAt: Date | null;
  orders7: number;
  revenue7: number;
  ordersPrev7: number;
  revenuePrev7: number;
  orders30: number;
  posOrders30: number;
  posLastAt: Date | null;
  onlineOrders30: number;
  onlineLastAt: Date | null;
};

const EMPTY_ACTIVITY: Omit<ActivityRow, '_id'> = {
  lastOrderAt: null,
  orders7: 0,
  revenue7: 0,
  ordersPrev7: 0,
  revenuePrev7: 0,
  orders30: 0,
  posOrders30: 0,
  posLastAt: null,
  onlineOrders30: 0,
  onlineLastAt: null,
};

/**
 * L'activité du parc entier en UNE passe.
 *
 * Pas de filtre `tenantId` : la file est TRANS-TENANT par nature, et une passe
 * par restaurant coûterait autant de requêtes que de clients. Le cloisonnement
 * se joue sur le rôle du contrôleur, pas ici.
 *
 * Les bornes viennent de `windowBounds` (fiche de santé) : les deux vues
 * doivent parler des mêmes « 7 jours », sinon elles finiront par se contredire
 * à l'écran.
 */
export function activityPipeline(bounds: ReturnType<typeof windowBounds>): PipelineStage[] {
  const between = (from: Date, to?: Date) =>
    to
      ? { $and: [{ $gte: ['$createdAt', from] }, { $lt: ['$createdAt', to] }] }
      : { $gte: ['$createdAt', from] };
  const orders = (from: Date, to?: Date) => ({ $sum: { $cond: [between(from, to), 1, 0] } });
  const revenue = (from: Date, to?: Date) => ({
    $sum: {
      $cond: [
        { $and: [between(from, to), { $in: ['$status', REVENUE_STATUSES] }] },
        '$totals.total',
        0,
      ],
    },
  });
  const channelOrders = (channel: string, from: Date) => ({
    $sum: { $cond: [{ $and: [between(from), { $eq: ['$channel', channel] }] }, 1, 0] },
  });
  const channelLast = (channel: string) => ({
    $max: { $cond: [{ $eq: ['$channel', channel] }, '$createdAt', null] },
  });

  return [
    { $match: { status: { $ne: 'cancelled' } } },
    {
      $group: {
        _id: '$tenantId',
        lastOrderAt: { $max: '$createdAt' },
        orders7: orders(bounds.short),
        revenue7: revenue(bounds.short),
        ordersPrev7: orders(bounds.shortPrev, bounds.short),
        revenuePrev7: revenue(bounds.shortPrev, bounds.short),
        orders30: orders(bounds.long),
        posOrders30: channelOrders('pos', bounds.long),
        posLastAt: channelLast('pos'),
        onlineOrders30: channelOrders('online', bounds.long),
        onlineLastAt: channelLast('online'),
      },
    },
  ] as unknown as PipelineStage[];
}

/**
 * Projections volontairement ÉTROITES — ni jeton d'appareil, ni code
 * d'appairage. Ce sont des secrets, ils n'ont aucune raison de traverser une
 * vue de pilotage, et une projection large finit toujours par en laisser fuir
 * un dans un journal.
 */
const TENANT_FIELDS = { name: 1, slug: 1, plan: 1, account: 1, createdAt: 1 } as const;
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

type RawTenant = Tenant & { _id: unknown; createdAt?: Date };

/**
 * Bloc `account` d'un tenant, absence comprise, et statut EFFECTIF.
 *
 * Les établissements créés avant ce champ n'en ont pas en base, et `.lean()` ne
 * matérialise pas les défauts Mongoose : l'absence vaut « essai », jamais
 * « anomalie » — même règle que dans `AdminService` et `HealthService`.
 *
 * Le statut passe par `statutEffectif` (@sm/contracts), et c'est ce qui EMPÊCHE
 * le signal « essai qui s'achève » de hurler indéfiniment : passé le terme, le
 * compte vaut `active` et le signal ne se déclenche plus. Il annonce donc une
 * échéance à venir — ce qu'il est — au lieu de crier « essai dépassé » chaque
 * matin sur un client entré en facturation depuis un an.
 *
 * `trialEndsAt` reste rendu tel quel : c'est lui qui donne les jours restants
 * AVANT le terme, la fenêtre où le signal sert vraiment.
 */
function readAccount(
  raw: RawTenant,
  now: Date,
): {
  status: TenantAccountStatus;
  since: Date | null;
  trialEndsAt: Date | null;
  suspendedAt: Date | null;
} {
  const account = raw.account as
    | { status?: string; since?: Date; suspendedAt?: Date | null; trialEndsAt?: Date | null }
    | undefined;
  return {
    status: statutEffectif(raw.account as CompteLu | undefined, now),
    since: account?.since ?? null,
    trialEndsAt: account?.trialEndsAt ?? null,
    suspendedAt: account?.suspendedAt ?? null,
  };
}

// ─── Service ───

@Injectable()
export class SignalsService {
  private readonly logger = new Logger(SignalsService.name);

  constructor(
    @InjectModel('Tenant') private readonly tenants: Model<Tenant>,
    @InjectModel('Order') private readonly orders: Model<Order>,
    @InjectModel('Device') private readonly devices: Model<Device>,
    @InjectModel('Screen') private readonly screens: Model<Screen>,
    @InjectModel('SignalDismissal') private readonly dismissals: Model<SignalDismissal>,
    @Inject(SUPPLY_DB) private readonly db: SupplyDb,
    private readonly billing: BillingService,
  ) {}

  /**
   * « Traité » : le signal disparaît de la file — TEMPORAIREMENT. Il revient
   * après `DISMISS_DAYS` si sa cause persiste : un impayé « traité » qui dure
   * n'est pas traité, et un geste d'écran ne doit jamais pouvoir enterrer un
   * problème réel pour de bon. L'auteur reste sur la trace.
   */
  async dismiss(signalId: string, actorEmail: string, now: Date = new Date()): Promise<void> {
    await this.dismissals.updateOne(
      { key: signalId },
      { $set: { at: now, actorEmail } },
      { upsert: true },
    );
  }

  /**
   * LA FILE DE TRAVAIL, tous clients confondus.
   *
   * Sans pagination, volontairement : une file de travail qu'on feuillette
   * n'est plus une file de travail. Sa longueur est bornée par la taille du
   * parc, et si elle devient illisible, c'est le parc qui va mal — pas la route.
   */
  async queue(now: Date = new Date()): Promise<CrmQueueSignal[]> {
    const bounds = windowBounds(now);

    const [tenants, rows, devices, screens, overdue, supply] = await Promise.all([
      this.tenants.find({}, TENANT_FIELDS).lean(),
      this.orders.aggregate<ActivityRow>(activityPipeline(bounds)),
      this.devices.find({}, DEVICE_FIELDS).lean(),
      this.screens.find({}, SCREEN_FIELDS).lean(),
      this.outstandingByTenant(now),
      this.supplyByTenant(now),
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

    // Ce que la cuisine (ou la caisse) n'a pas vu passer. Mesuré UNIQUEMENT sur
    // les appareils déjà retenus par `mutedUnits` : c'est ce qui borne le
    // nombre de requêtes, un parc en bonne santé n'en déclenchant aucune.
    const ordersSinceSilent = await this.missedOrders(tenants, fleetByTenant, activityByTenant, now);

    const signals: CrmQueueSignal[] = [];
    for (const raw of tenants) {
      const tenant = raw as RawTenant;
      const id = String(tenant._id);
      const activity = activityByTenant.get(id) ?? EMPTY_ACTIVITY;
      const fleet = fleetByTenant.get(id) ?? [];
      const account = readAccount(tenant, now);

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
        ...signalsForClient(
          {
            tenantId: id,
            tenantName: String(tenant.name ?? ''),
            tenantSlug: String(tenant.slug ?? ''),
            plan: (tenant.plan ?? null) as SignalClient['plan'],
            accountStatus: account.status,
            accountSince: account.since,
            trialEndsAt: account.trialEndsAt ?? null,
            suspendedAt: account.suspendedAt,
            since: tenant.createdAt ?? null,
            activity: {
              lastOrderAt: activity.lastOrderAt,
              orders7d: activity.orders7,
              previousOrders7d: activity.ordersPrev7,
              revenue7Cents: activity.revenue7,
              previousRevenue7Cents: activity.revenuePrev7,
              orders30d: activity.orders30,
            },
            fleet,
            ordersSinceSilent,
            modules,
            outstanding: overdue?.get(id) ?? overdue?.empty ?? null,
            supply: supply?.get(id) ?? supply?.empty ?? null,
          },
          now,
        ),
      );
    }

    // Les signaux « traités » sortent de la file le temps du répit — la
    // petite collection se lit en entier, la file reste une seule vérité.
    const floor = new Date(now.getTime() - DISMISS_DAYS * 86_400_000);
    const dismissed = new Set(
      (await this.dismissals.find({ at: { $gte: floor } }, { key: 1 }).lean()).map((d) => d.key),
    );

    return sortQueue(signals.filter((signal) => !dismissed.has(signal.id)));
  }

  // ─── Lectures annexes, dégradables ───

  /**
   * L'ARDOISE ÉCHUE DE CHAQUE CLIENT, en un seul appel.
   *
   * `BillingService.overdue()` balaie déjà le parc et ne rend que les pièces
   * réellement en retard ; les regrouper par client coûte moins qu'un
   * `outstandingFor` par restaurant, et surtout garantit que la file et la file
   * de recouvrement donnent le MÊME montant — elles lisent la même passe.
   *
   * `summarizeOutstanding` (@sm/contracts) fait la somme : la règle « ce qui
   * reste dû » n'est pas réécrite ici.
   *
   * `null` en retour = facturation injoignable. La famille « impayé » est alors
   * retirée de la file plutôt que remplacée par une supposition.
   */
  private async outstandingByTenant(
    now: Date,
  ): Promise<(Map<string, CrmOutstanding> & { empty: CrmOutstanding }) | null> {
    try {
      const file = await this.billing.overdue(now);
      const byTenant = new Map<string, (typeof file.invoices)[number][]>();
      for (const invoice of file.invoices) {
        const list = byTenant.get(invoice.tenantId) ?? [];
        list.push(invoice);
        byTenant.set(invoice.tenantId, list);
      }
      const out = new Map<string, CrmOutstanding>();
      for (const [tenantId, invoices] of byTenant) {
        out.set(tenantId, summarizeOutstanding(invoices, now));
      }
      // `empty` distingue « client à jour » (ardoise vide, mesurée) de « source
      // indisponible » (`null`) : sans lui, les deux se liraient pareil.
      return Object.assign(out, { empty: summarizeOutstanding([], now) });
    } catch (error) {
      this.logger.warn(
        `Facturation indisponible — file servie sans les impayés : ${message(error)}`,
      );
      return null;
    }
  }

  /**
   * L'APPRO DE CHAQUE CLIENT — ruptures, seuils, et vie du suivi de stock.
   *
   * Le contexte supply vit dans PostgreSQL, pas dans Mongo : une panne de cette
   * base ne doit pas emporter la file entière, d'où le repli sur `null` plutôt
   * qu'une erreur — même choix que `HealthService.supplyHealth`.
   *
   * Les ingrédients CANONIQUES (`tenantRef IS NULL`, le registre mutualisé
   * Snack Manager) sont exclus : ils appartiennent au produit, pas à un
   * restaurant, et les compter afficherait 107 ruptures fantômes sur chaque
   * client.
   */
  private async supplyByTenant(
    now: Date,
  ): Promise<(Map<string, SupplySnapshot> & { empty: SupplySnapshot }) | null> {
    const cutoff = new Date(now.getTime() - LONG_WINDOW_DAYS * DAY_MS);
    try {
      const [ingredients, suppliers, movements] = await Promise.all([
        this.db.query.ingredients.findMany({
          columns: { tenantRef: true, isOut: true, currentStock: true, parLevel: true },
          where: (t, { and, eq, isNotNull }) => and(isNotNull(t.tenantRef), eq(t.active, true)),
        }),
        this.db.query.suppliers.findMany({
          columns: { tenantRef: true },
          where: (t, { eq }) => eq(t.active, true),
        }),
        // Un `count` groupé plutôt qu'un `findMany` : la table des mouvements
        // grossit à chaque réception et à chaque vente, elle ne se rapatrie pas.
        this.db
          .select({
            tenantRef: stockMovements.tenantRef,
            total: sql<number>`count(*)::int`,
            recent: sql<number>`count(*) filter (where ${stockMovements.at} >= ${cutoff})::int`,
            lastAt: sql<Date | null>`max(${stockMovements.at})`,
          })
          .from(stockMovements)
          .groupBy(stockMovements.tenantRef),
      ]);

      const out = new Map<string, SupplySnapshot>();
      const slot = (tenantId: string): SupplySnapshot => {
        const found = out.get(tenantId) ?? emptySupply();
        out.set(tenantId, found);
        return found;
      };

      for (const row of ingredients) {
        const tenantId = String(row.tenantRef ?? '');
        if (!tenantId) continue;
        const snapshot = slot(tenantId);
        snapshot.ingredients += 1;
        const stock = Number(row.currentStock ?? 0);
        const par = Number(row.parLevel ?? 0);
        if (row.isOut) snapshot.out += 1;
        // Stock à zéro SANS rupture déclarée : le produit se vend encore alors
        // qu'il n'y a plus rien derrière. C'est un fait, pas une extrapolation.
        else if (stock <= 0) snapshot.starved += 1;
        if (stock < par) snapshot.belowPar += 1;
      }
      for (const row of suppliers) {
        const tenantId = String(row.tenantRef ?? '');
        if (!tenantId) continue;
        slot(tenantId).suppliers += 1;
      }
      for (const row of movements) {
        const tenantId = String(row.tenantRef ?? '');
        if (!tenantId) continue;
        const snapshot = slot(tenantId);
        snapshot.movements = Number(row.total ?? 0);
        snapshot.movements30d = Number(row.recent ?? 0);
        snapshot.lastMovementAt = row.lastAt ? new Date(row.lastAt) : null;
      }

      return Object.assign(out, { empty: emptySupply() });
    } catch (error) {
      this.logger.warn(`Appro indisponible — file servie sans le volet stocks : ${message(error)}`);
      return null;
    }
  }

  /**
   * COMBIEN DE COMMANDES SONT PASSÉES pendant qu'un appareil se taisait.
   *
   * C'est le chiffre qui transforme « écran cuisine hors ligne » (que le gérant
   * voit déjà) en « la cuisine n'a pas vu passer douze commandes » (qu'il
   * ignore, et qui justifie l'appel).
   *
   * Une requête par appareil retenu, et pas une de plus : `mutedUnits` a déjà
   * écarté tout ce qui dort normalement. Le plafond
   * (`MAX_SILENT_ORDER_LOOKUPS`) protège du cas pathologique — une coupure
   * réseau régionale qui rendrait tout un parc muet d'un coup.
   */
  private async missedOrders(
    tenants: readonly unknown[],
    fleetByTenant: ReadonlyMap<string, CrmFleetUnit[]>,
    activityByTenant: ReadonlyMap<string, ActivityRow>,
    now: Date,
  ): Promise<Map<string, number>> {
    const out = new Map<string, number>();
    const jobs: { unitId: string; tenantId: unknown; from: Date }[] = [];

    for (const raw of tenants) {
      if (jobs.length >= MAX_SILENT_ORDER_LOOKUPS) break;
      const tenant = raw as RawTenant;
      const id = String(tenant._id);
      const activity = activityByTenant.get(id);
      const lastOrderAt = activity?.lastOrderAt ?? null;
      for (const { unit, elapsedMs } of mutedUnits(fleetByTenant.get(id) ?? [], lastOrderAt, now)) {
        if (elapsedMs === null || unit.lastSeenAt === null) continue;
        if (jobs.length >= MAX_SILENT_ORDER_LOOKUPS) break;
        jobs.push({ unitId: unit.id, tenantId: tenant._id, from: new Date(unit.lastSeenAt) });
      }
    }
    if (jobs.length === 0) return out;

    const counts = await Promise.all(
      jobs.map(async (job) => {
        try {
          return await this.orders.countDocuments({
            tenantId: job.tenantId,
            status: { $ne: 'cancelled' },
            createdAt: { $gt: job.from },
          });
        } catch {
          // Un comptage manquant ne doit pas emporter la file : le signal sort
          // sans son chiffre de commandes ratées, jamais avec un chiffre faux.
          return 0;
        }
      }),
    );
    jobs.forEach((job, i) => out.set(job.unitId, counts[i] ?? 0));
    return out;
  }
}

const emptySupply = (): SupplySnapshot => ({
  ingredients: 0,
  suppliers: 0,
  out: 0,
  starved: 0,
  belowPar: 0,
  movements: 0,
  movements30d: 0,
  lastMovementAt: null,
});

const message = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);
