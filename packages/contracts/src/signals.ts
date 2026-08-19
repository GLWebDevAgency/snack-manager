import { z } from 'zod';
import type { TenantAccountStatus } from './admin';

// ─────────────────────────────────────────────────────────────
// LA FILE DE TRAVAIL — « qui dois-je appeler cette semaine, et pour lui dire
// quoi ».
//
// C'est le contrat de `GET /crm/signals`, servi par `SignalsService` et affiché
// par `/sm/signals`, `/sm/clients` et le tableau de bord `/sm`. Il est publié
// ici pour une raison très concrète : cette forme a DÉJÀ changé une fois en
// cours de route (familles renommées, `severity`, `action`, `href`, `id` et
// `ageDays` ajoutés) sans que rien ne soit publié. Les deux côtés se
// relisaient donc à la main, avec des lecteurs défensifs, et la rupture
// suivante se serait vue à l'exécution — devant l'équipe, un lundi matin —
// plutôt qu'au typecheck.
//
// CE QUI EST PUBLIÉ ICI est la forme RÉELLEMENT rendue par l'API, relevée en
// curl, pas une forme souhaitée. Le producteur (`signals.service.ts`) type sa
// sortie avec `CrmQueueSignal` ; tout écran qui lit la route doit typer son
// entrée avec le même type. Une famille ajoutée ou renommée casse alors la
// compilation des deux côtés, ce qui est exactement le but.
//
// ─── RESPECT DES CLIENTS DE NOS CLIENTS ───
//
// Un signal porte un ÉTABLISSEMENT et un AGRÉGAT — jours de silence,
// pourcentage de baisse, euros échus, ingrédients coupés. Jamais le nom, le
// téléphone ni l'e-mail d'un consommateur final : le fichier client d'un
// restaurateur lui appartient. Aucun champ de ce fichier n'en prévoit un, et
// c'est une règle de conception, pas un oubli.
//
// Rappel de convention : tous les montants circulent en CENTIMES (int).
// ─────────────────────────────────────────────────────────────

// ─── Les huit familles ───

/**
 * LES HUIT FAMILLES DE SIGNAUX, dans l'ordre où l'on décroche le téléphone.
 *
 * L'ordre de ce tableau EST l'ordre d'appel (il correspond aux bandes de
 * gravité du producteur) : le premier élément est le dossier le plus chaud du
 * parc, le dernier un simple prétexte d'appel. Un écran qui regroupe par
 * famille peut donc balayer ce tableau sans réinventer une hiérarchie.
 *
 * Chaque famille est décrite une par une ci-dessous, avec ce qui la déclenche
 * et ce que portent son `value` et son `unit` — c'est ce chiffre-là que la
 * phrase affichée répète, et c'est lui qui justifie l'appel.
 *
 *  1. `compte_suspendu` — L'ACCÈS EST COUPÉ. Le restaurant travaille sans son
 *     outil : le dossier le plus chaud du parc, toujours `critique`.
 *     `value` = jours depuis la coupure (`unit: 'jours'`).
 *
 *  2. `impaye` — DES FACTURES ÉCHUES, lues dans la facturation (jamais déduites
 *     du statut de compte, qui n'en est que la conséquence). Passe en
 *     `critique` au-delà de deux semaines de retard.
 *     `value` = jours de retard de la plus ancienne (`unit: 'jours'`).
 *
 *  3. `arret_activite` — IL N'ENCAISSE PLUS, ou n'a JAMAIS commencé. Les deux
 *     cas se distinguent par le `title` (« Plus aucune commande » / « Jamais
 *     démarré ») : appeler un client qui n'a jamais encaissé pour parler d'un
 *     décrochage serait à côté du sujet — c'est un appel d'installation.
 *     `value` = jours de silence, ou ancienneté dans le parc (`unit: 'jours'`).
 *
 *  4. `appareil_muet` — UNE CAISSE OU UN ÉCRAN S'EST TU pendant que le
 *     restaurant travaillait. Un signal PAR APPAREIL : l'identifiant de
 *     l'appareil est le troisième segment de l'`id`.
 *     `value` = heures de silence (`unit: 'heures'`).
 *
 *  5. `chute_activite` — 7 JOURS NETTEMENT EN DESSOUS des 7 précédents, avec un
 *     volume de référence suffisant pour que le pourcentage veuille dire
 *     quelque chose.
 *     `value` = ampleur de la baisse, en valeur absolue (`unit: 'pourcent'`).
 *
 *  6. `essai_qui_sacheve` — LA PÉRIODE D'ESSAI TOUCHE À SA FIN, ou elle est
 *     dépassée. La consigne diffère selon qu'il s'en sert ou non.
 *     `value` = jours restants, ou jours de dépassement (`unit: 'jours'`).
 *
 *  7. `rupture_appro` — PLUSIEURS INGRÉDIENTS COUPÉS EN MÊME TEMPS : la carte
 *     se ferme produit par produit. Voir la limite documentée plus bas.
 *     `value` = ingrédients concernés (`unit: 'ingredients'`).
 *
 *  8. `module_dormant` — UN MODULE OUVERT CHEZ LE CLIENT ET JAMAIS SERVI. Un
 *     signal PAR MODULE (sa clé est le troisième segment de l'`id`) : « former
 *     à l'écran cuisine » et « pousser la commande en ligne » ne se disent pas
 *     dans le même appel. Voir la limite documentée plus bas.
 *     `value` = 1 (`unit: 'modules'`).
 */
export const CRM_SIGNAL_KINDS = [
  'compte_suspendu',
  'impaye',
  'arret_activite',
  'appareil_muet',
  'chute_activite',
  'essai_qui_sacheve',
  'rupture_appro',
  'module_dormant',
] as const;
export const CrmSignalKindSchema = z.enum(CRM_SIGNAL_KINDS);
export type CrmSignalKind = z.infer<typeof CrmSignalKindSchema>;

/**
 * DEUX LIMITES ASSUMÉES, écrites ici pour qu'on ne les « corrige » pas en
 * affirmant plus que ce que nous savons.
 *
 * 1. `module_dormant` NE DIT PAS « FACTURÉ ». Il dit qu'un module est OUVERT
 *    chez le client et qu'il ne sert pas — deux faits lus en base. Aucune
 *    correspondance formule → modules n'existe (`docs/specs/contraintes-business.md`
 *    §6.2 la laisse « à définir ») : écrire « vous payez pour ça » serait une
 *    déduction, et elle serait fausse sur une partie du parc. Ce qu'on en fait
 *    au renouvellement est une décision humaine, pas un calcul.
 *
 * 2. `rupture_appro` MESURE LA SIMULTANÉITÉ, PAS LA RÉCURRENCE. Le chiffre est
 *    le nombre d'ingrédients coupés À L'INSTANT DE LA LECTURE. Rien
 *    n'historise les passages en rupture : « il est en rupture toutes les
 *    semaines » n'est pas mesurable aujourd'hui et ne doit donc pas être dit.
 *
 * Les deux se corrigeront le jour où la donnée existera (une grille
 * formule → modules, un historique des ruptures) — pas avant, et pas au
 * jugé.
 */
export const CRM_SIGNAL_LIMITS = {
  module_dormant:
    'Module ouvert et jamais servi — jamais « facturé » : aucune correspondance formule → modules n’existe.',
  rupture_appro:
    'Ruptures simultanées à l’instant de la lecture — jamais une récurrence : rien n’historise les passages en rupture.',
} as const;

/**
 * Étiquette COURTE de famille — la colonne de gauche de la file.
 *
 * Volontairement différente du `title` d'un signal : le `title` porte le cas
 * précis (« Écran cuisine « Cuisine » muet »), l'étiquette porte la famille,
 * celle qu'on regroupe mentalement en balayant l'écran.
 */
export const CRM_SIGNAL_KIND_LABELS: Record<CrmSignalKind, string> = {
  compte_suspendu: 'Accès coupé',
  impaye: 'Impayé',
  arret_activite: 'Activité arrêtée',
  appareil_muet: 'Appareil muet',
  chute_activite: 'Activité en baisse',
  essai_qui_sacheve: 'Fin d’essai',
  rupture_appro: 'Rupture d’appro',
  module_dormant: 'Module dormant',
};

// ─── Gravité ───

/**
 * TROIS BANDES, pas davantage.
 *
 * C'est la seule granularité qu'un humain applique vraiment : aujourd'hui,
 * cette semaine, quand j'aurai le temps. Une quatrième n'ajouterait pas de
 * finesse, elle ajouterait une hésitation.
 *
 * La bande est TRANCHÉE PAR L'API et ne se déduit pas du chiffre `gravity` :
 * un essai qui s'achève sort à 40 en « critique », un appareil muet à 60 en
 * « à surveiller ». Un écran qui recalculerait la bande depuis `gravity` se
 * tromperait sur ces deux cas-là.
 */
export const CRM_SIGNAL_SEVERITIES = ['critique', 'attention', 'info'] as const;
export const CrmSignalSeveritySchema = z.enum(CRM_SIGNAL_SEVERITIES);
export type CrmSignalSeverity = z.infer<typeof CrmSignalSeveritySchema>;

export const CRM_SIGNAL_SEVERITY_LABELS: Record<CrmSignalSeverity, string> = {
  critique: 'Critique',
  attention: 'À surveiller',
  info: 'Pour information',
};

/**
 * Ordre d'affichage des bandes — le plus urgent d'abord.
 *
 * Publié parce que l'API et les écrans trient la MÊME file : deux ordres
 * différents feraient apparaître le même parc dans deux ordres selon la page
 * d'où l'on vient, et l'équipe finirait par ne plus savoir ce qu'elle a déjà
 * traité.
 */
export const CRM_SIGNAL_SEVERITY_RANK: Record<CrmSignalSeverity, number> = {
  critique: 0,
  attention: 1,
  info: 2,
};

// ─── Unité du chiffre porté ───

/**
 * L'unité de `value`. Elle n'est pas décorative : c'est elle qui dit si « 12 »
 * se lit « douze jours », « douze heures » ou « douze pour cent ».
 */
export const CRM_SIGNAL_UNITS = [
  'jours',
  'heures',
  'pourcent',
  'commandes',
  'euros',
  'ingredients',
  'modules',
] as const;
export const CrmSignalUnitSchema = z.enum(CRM_SIGNAL_UNITS);
export type CrmSignalUnit = z.infer<typeof CrmSignalUnitSchema>;

// ─── La ligne de file ───

/**
 * UNE LIGNE DE LA FILE, telle que `GET /crm/signals` la rend.
 *
 * La route renvoie un TABLEAU de ces objets, déjà trié (bande, puis gravité
 * décroissante, puis le plus ancien d'abord) et sans pagination : une file de
 * travail qu'on feuillette n'est plus une file de travail.
 *
 * Deux choses sont écrites par l'API et ne doivent pas être réécrites par un
 * écran : la BANDE (`severity`) et la CONSIGNE (`action`). L'API connaît le
 * montant de l'ardoise et le nombre de jours d'essai restants ; deux
 * formulations pour le même appel finiraient par se contredire.
 */
export type CrmQueueSignal = {
  /**
   * Clé STABLE d'un appel à l'autre : `famille:tenant` — suivi d'une troisième
   * précision (identifiant d'appareil, clé de module) quand une même famille
   * peut sortir plusieurs fois pour le même client.
   *
   * Elle sert de clé de rendu au web, et elle sera la poignée du jour où
   * l'équipe voudra masquer un signal traité : un identifiant tiré au hasard
   * interdirait les deux.
   */
  id: string;
  kind: CrmSignalKind;
  severity: CrmSignalSeverity;
  /** `CRM_SIGNAL_SEVERITY_LABELS[severity]`, résolu une fois côté API. */
  severityLabel: string;
  /** 0-100, décroissant. Départage deux signaux DE MÊME bande, rien de plus. */
  gravity: number;
  tenantId: string;
  tenantName: string;
  tenantSlug: string;
  planLabel: string;
  accountStatus: TenantAccountStatus;
  accountStatusLabel: string;
  /** Intitulé court, lisible dans une liste. */
  title: string;
  /** UNE phrase, et elle contient le chiffre qui justifie l'appel. */
  detail: string;
  /** Ce qu'on fait de ce signal — la file dit quoi dire, pas seulement quoi voir. */
  action: string;
  /** Le chiffre lu en base. Voir `unit` pour savoir ce qu'il compte. */
  value: number;
  unit: CrmSignalUnit;
  /** Depuis quand ça dure (ISO). `null` quand la situation n'a pas de date d'entrée. */
  since: string | null;
  /** Ancienneté en jours — `null` quand `since` l'est. */
  ageDays: number | null;
  /** La fiche du client dans le back-office SM — chemin interne, jamais absolu. */
  href: string;
};
