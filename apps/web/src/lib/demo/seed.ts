"use client";

/**
 * CE QUE LA PHOTO N'A PAS PU PRENDRE.
 *
 * `capture.mjs` photographie l'API en lecture seule ; quatre listes reviennent
 * VIDES de la base de staging, non pas parce que le produit ne sait pas les
 * servir, mais parce que personne n'y a encore rien saisi : promotions, écrans
 * TV, mouvements de stock et noms de domaine.
 *
 * Les photographier telles quelles donnerait quatre écrans vides — exactement
 * ce que cette démonstration doit éviter, puisqu'elle existe pour montrer
 * l'ÉTENDUE de la couverture. Elles sont donc composées ici, à la main.
 *
 * DEUX PRÉCAUTIONS, parce qu'une forme inventée est un écran cassé en
 * puissance :
 *
 *   1. tout ce qui a un type dans `@sm/contracts` (ou dans les types de
 *      l'écran concerné) est ANNOTÉ avec ce type — une divergence de forme
 *      devient une erreur de compilation, pas un tableau vide découvert six
 *      semaines plus tard ;
 *   2. aucune date absolue : comme dans `snapshot.ts`, on ne décrit que des
 *      ÂGES, que `state.ts` recale sur l'horloge du visiteur.
 *
 * Le jour où la base de staging contiendra ces objets, `capture.mjs` les
 * photographiera et ce fichier fondra d'autant.
 */

import type { ScreenScene, ScreenView, StockMovementType } from "@sm/contracts";
import type { DomainView, SiteAddresses } from "@/app/admin/site/types";

// ─────────────────────────────────────────────────────────────
// Promotions
// ─────────────────────────────────────────────────────────────

/**
 * Miroir du type consommé par `/admin/promos` (déclaré localement dans sa
 * page, donc non importable). Les quatre natures que l'écran sait afficher
 * sont représentées, plus une promotion éteinte : un écran où tout est allumé
 * ne montre pas l'interrupteur.
 */
export interface DemoPromo {
  _id: string;
  name: string;
  description: string;
  kind: "percent" | "amount" | "offered_item";
  /** `percent` : pourcentage · `amount` : CENTIMES. */
  value: number;
  code: string | null;
  channels: ("online" | "pos" | "phone")[];
  /** Ancienneté en minutes au démarrage (négatif = à venir). */
  startsAtAgeMin: number | null;
  endsAtAgeMin: number | null;
  active: boolean;
  usageCount: number;
}

const DAY = 60 * 24;

export const SEED_PROMOTIONS: DemoPromo[] = [
  {
    _id: "promo1",
    name: "Bienvenue en ligne",
    description: "10 % sur la première commande passée sur le site du restaurant.",
    kind: "percent",
    value: 10,
    code: "BIENVENUE",
    channels: ["online"],
    startsAtAgeMin: 45 * DAY,
    endsAtAgeMin: null,
    active: true,
    usageCount: 168,
  },
  {
    _id: "promo2",
    name: "Menu étudiant du midi",
    description: "2 € de remise sur les menus le midi, du lundi au vendredi, sur présentation de la carte.",
    kind: "amount",
    value: 200,
    code: "ETUDIANT",
    channels: ["pos", "online"],
    startsAtAgeMin: 120 * DAY,
    endsAtAgeMin: null,
    active: true,
    usageCount: 412,
  },
  {
    _id: "promo3",
    name: "Boisson offerte le mardi",
    description: "Une canette offerte pour tout menu commandé le mardi soir.",
    kind: "offered_item",
    value: 0,
    code: null,
    channels: ["pos", "phone", "online"],
    startsAtAgeMin: 20 * DAY,
    endsAtAgeMin: -10 * DAY, // se termine dans dix jours
    active: true,
    usageCount: 57,
  },
  {
    _id: "promo4",
    name: "Black Friday",
    description: "20 % sur toute la carte pendant trois jours — opération terminée.",
    kind: "percent",
    value: 20,
    code: "BF20",
    channels: ["online", "pos", "phone"],
    startsAtAgeMin: 260 * DAY,
    endsAtAgeMin: 257 * DAY,
    active: false,
    usageCount: 231,
  },
];

// ─────────────────────────────────────────────────────────────
// Écrans TV
// ─────────────────────────────────────────────────────────────

/**
 * Deux écrans, et c'est délibéré : un appairé qui répond (état nominal) et un
 * qui attend son code (l'état qu'un restaurateur rencontre le jour de la
 * livraison de sa clé HDMI). Montrer les deux dit mieux ce que fait l'écran
 * qu'une carte verte solitaire.
 *
 * Les `categoryId` renvoient aux catégories de `snapshot.ts` (`c1`…) ; leurs
 * noms sont résolus par l'écran, comme en production.
 */
export interface DemoScreen {
  id: string;
  name: string;
  orientation: ScreenView["orientation"];
  theme: ScreenView["theme"];
  playlist: ScreenScene[];
  paired: boolean;
  /** Ancienneté du dernier battement, en minutes. `null` = jamais connecté. */
  lastSeenAtAgeMin: number | null;
  /** Code d'appairage, seulement tant que l'écran n'est pas appairé. */
  pairingCode: string | null;
  /** Expiration du code, en minutes DANS LE FUTUR. */
  pairingExpiresInMin: number;
  active: boolean;
}

export const SEED_SCREENS: DemoScreen[] = [
  {
    id: "scr1",
    name: "Écran comptoir",
    orientation: "landscape",
    theme: "brand",
    playlist: [
      { kind: "category", categoryId: "c1", title: null, productIds: [], durationMs: 12_000 },
      { kind: "category", categoryId: "c2", title: null, productIds: [], durationMs: 12_000 },
      { kind: "promo", categoryId: null, title: "Nos offres", productIds: [], durationMs: 8_000 },
      { kind: "featured", categoryId: null, title: "Les incontournables", productIds: ["p1", "p6", "p23"], durationMs: 10_000 },
    ],
    paired: true,
    lastSeenAtAgeMin: 1,
    pairingCode: null,
    pairingExpiresInMin: 0,
    active: true,
  },
  {
    id: "scr2",
    name: "Écran salle (à installer)",
    orientation: "portrait",
    theme: "dark",
    playlist: [
      { kind: "category", categoryId: "c3", title: null, productIds: [], durationMs: 15_000 },
      { kind: "custom", categoryId: null, title: "Wifi gratuit — demandez le code", productIds: [], durationMs: 8_000 },
    ],
    paired: false,
    lastSeenAtAgeMin: null,
    // Six caractères pris dans l'alphabet non ambigu de `PAIRING_CODE_ALPHABET`
    // (ni O ni 0, ni I ni 1) : c'est la forme exacte que l'écran affiche et que
    // la page d'installation demande de recopier. Un code à quatre chiffres
    // contredirait la consigne « saisissez le code à six caractères » imprimée
    // deux centimètres plus bas.
    //
    // Il vit quinze minutes dans l'API ; on en laisse quatorze au visiteur.
    // S'il traîne au-delà, l'écran bascule sur « code expiré » et le bouton
    // « Renvoyer un code » fonctionne : c'est un chemin de la vraie
    // application, pas une impasse.
    pairingCode: "K7QM42",
    pairingExpiresInMin: 14,
    active: true,
  },
];

// ─────────────────────────────────────────────────────────────
// Fermetures exceptionnelles
// ─────────────────────────────────────────────────────────────

/**
 * L'écran Horaires porte une section « Fermetures exceptionnelles » qui, sur
 * une base neuve, ne dit rien. Deux congés — un passé, un à venir — suffisent
 * à montrer ce que la section sait faire, et à quoi ressemble une date de
 * réouverture.
 */
export const SEED_CLOSURES: { fromAgeMin: number; toAgeMin: number; reason: string }[] = [
  // Ancienneté NÉGATIVE = à venir. `from` doit être plus ANCIEN que `to`, donc
  // son âge est le plus grand des deux — y compris dans le futur.
  //
  // Les deux sont À VENIR : l'écran présente cette section comme une
  // planification (« la commande en ligne sera fermée sur ces dates »), et une
  // fermeture passée s'y lirait comme une fermeture à venir, puisque la liste
  // n'affiche pas l'année.
  { fromAgeMin: -40 * DAY, toAgeMin: -41 * DAY, reason: "Jour férié" },
  { fromAgeMin: -120 * DAY, toAgeMin: -134 * DAY, reason: "Congés annuels" },
];

// ─────────────────────────────────────────────────────────────
// Mouvements de stock
// ─────────────────────────────────────────────────────────────

/**
 * Le journal des mouvements ne se compose pas ligne à ligne : il se DÉDUIT des
 * ingrédients réellement photographiés. `state.ts` déroule ce motif sur les dix
 * derniers jours — livraisons du jeudi, sorties de service, une casse et un
 * inventaire — pour que le journal parle des vrais produits du Comptoir plutôt
 * que d'un jeu d'essai parallèle.
 */
export interface DemoMovementPattern {
  type: StockMovementType;
  /** Ancienneté en minutes. */
  ageMin: number;
  /** Rang de l'ingrédient concerné dans la liste (modulo sa longueur). */
  pick: number;
  /** Quantité signée, en fraction du niveau cible (`parLevel`). */
  ratio: number;
  ref: string | null;
  note: string | null;
}

export const SEED_MOVEMENT_PATTERN: DemoMovementPattern[] = [
  { type: "purchase", ageMin: 1 * DAY + 120, pick: 0, ratio: 0.8, ref: "BL-24188", note: "Livraison Halles du Vexin" },
  { type: "purchase", ageMin: 1 * DAY + 118, pick: 3, ratio: 0.6, ref: "BL-24188", note: null },
  { type: "purchase", ageMin: 1 * DAY + 115, pick: 7, ratio: 0.9, ref: "BL-24188", note: null },
  { type: "sale", ageMin: 1 * DAY + 40, pick: 11, ratio: -0.25, ref: null, note: "Service du soir" },
  { type: "waste", ageMin: 2 * DAY + 200, pick: 5, ratio: -0.08, ref: null, note: "Chute d'un bac au déchargement" },
  { type: "sale", ageMin: 2 * DAY + 60, pick: 2, ratio: -0.3, ref: null, note: null },
  { type: "count", ageMin: 3 * DAY + 30, pick: 9, ratio: 0.05, ref: null, note: "Écart constaté au comptage du dimanche" },
  { type: "purchase", ageMin: 4 * DAY + 130, pick: 14, ratio: 1, ref: "BL-24102", note: "Livraison Grossiste Normandie Pro" },
  { type: "purchase", ageMin: 4 * DAY + 128, pick: 17, ratio: 0.7, ref: "BL-24102", note: null },
  { type: "sale", ageMin: 5 * DAY + 55, pick: 1, ratio: -0.4, ref: null, note: "Service du midi" },
  { type: "waste", ageMin: 6 * DAY + 300, pick: 20, ratio: -0.05, ref: null, note: "Rupture de chaîne du froid — bac écarté" },
  { type: "purchase", ageMin: 8 * DAY + 140, pick: 6, ratio: 0.85, ref: "BL-24039", note: "Livraison Cash & Food" },
  { type: "sale", ageMin: 8 * DAY + 45, pick: 12, ratio: -0.35, ref: null, note: null },
  { type: "count", ageMin: 10 * DAY + 20, pick: 4, ratio: -0.12, ref: null, note: "Inventaire mensuel" },
];

// ─────────────────────────────────────────────────────────────
// Noms de domaine
// ─────────────────────────────────────────────────────────────

/**
 * Un domaine en service et un en attente de DNS : c'est le couple qui explique
 * l'écran. La consigne CNAME est CALCULÉE PAR L'API en production ; on la
 * recopie ici avec la même forme pour que la carte d'instructions s'affiche
 * comme elle s'affichera pour de vrai.
 */
export interface DemoDomain {
  hostname: string;
  status: DomainView["status"];
  statusLabel: string;
  isPrimary: boolean;
  addedAtAgeMin: number;
  lastCheckedAtAgeMin: number | null;
  detail: string | null;
}

export const SEED_DOMAINS: DemoDomain[] = [
  {
    hostname: "commander.le-comptoir.fr",
    status: "active",
    statusLabel: "Actif",
    isPrimary: true,
    addedAtAgeMin: 96 * DAY,
    lastCheckedAtAgeMin: 180,
    detail: null,
  },
  {
    hostname: "commande.comptoir-rouen.fr",
    status: "pending_dns",
    statusLabel: "En attente du DNS",
    isPrimary: false,
    addedAtAgeMin: 2 * DAY,
    lastCheckedAtAgeMin: 25,
    detail: "Aucun enregistrement CNAME trouvé pour ce nom.",
  },
];

/** Cible du CNAME, telle que l'API la renvoie. */
export const SEED_CNAME_TARGET = "sites.snackmanager.app";

/** Fournisseur de domaines annoncé par l'écran. */
export const SEED_DOMAIN_PROVIDER: SiteAddresses["provider"] = "Cloudflare";
