/**
 * Copy de la page Écran cuisine (route `/cuisine`) — en français.
 *
 * Deuxième page par application, construite sur le MODÈLE de `/caisse` :
 * mêmes trois fichiers, même registre (mots de comptoir, décision du
 * fondateur du 23/08/2026), mêmes règles de fond — aucun chiffre de
 * résultat, aucun montant écrit à la main, et chaque affirmation correspond
 * à une capacité réelle du produit (`apps/kds`), démontrable sur la landing.
 */

import { PLAN_MONTHLY_CENTS, euros, type Shot } from "@/components/marketing/content";

/* ── Les sections, et leur sommaire ──────────────────────────── */

export type CuisineSectionMeta = {
  id: string;
  nav: string;
  badge: string;
  title: string;
  lead: string;
};

/**
 * L'ordre est celui d'un ticket : il arrive, il se lit, le réseau saute,
 * et l'écran reste celui du restaurant.
 */
export const CUISINE_SECTIONS: readonly CuisineSectionMeta[] = [
  {
    id: "arrivee",
    nav: "Les commandes",
    badge: "Les commandes",
    title: "Suivez les commandes de leur arrivée à leur remise.",
    lead: "Caisse, téléphone et commande en ligne selon les modules activés : une seule file, trois colonnes et un signal sonore à l’arrivée.",
  },
  {
    id: "lisible",
    nav: "Lisible",
    badge: "Lecture des tickets",
    title: "Retrouvez les informations utiles à la préparation.",
    lead: "Des caractères ajustables, des statuts et des couleurs aident l’équipe à repérer les commandes à préparer et celles qui sont prêtes.",
  },
  {
    id: "coupure",
    nav: "Sans internet",
    badge: "En cas de coupure",
    title: "Les tickets déjà reçus restent consultables.",
    lead: "La cuisine conserve les tickets déjà reçus. Les nouvelles commandes attendent la reconnexion pour parvenir à l’écran.",
  },
  {
    id: "vous",
    nav: "Chez vous",
    badge: "Votre matériel",
    title: "Une tablette, ou un moniteur au mur.",
    lead: "Associez un écran compatible à votre établissement. L’emplacement et l’équipement sont choisis selon les contraintes de votre cuisine.",
  },
] as const;

export function cuisineSection(id: string): CuisineSectionMeta {
  const found = CUISINE_SECTIONS.find((s) => s.id === id);
  if (!found) throw new Error(`Section inconnue de la page Cuisine : ${id}`);
  return found;
}

export const CUISINE_SOMMAIRE: readonly { href: string; label: string }[] = CUISINE_SECTIONS.map(
  (s) => ({ href: `#${s.id}`, label: s.nav }),
);

/* ── Les images ──────────────────────────────────────────────── */

export const CUISINE_SHOTS = {
  hero: { src: "/shots/kds.jpg", alt: "" },
  cta: { src: "/photos/libre/blog-fenetre-service-nuit.webp", alt: "" },
} satisfies Record<string, Shot>;

/* ── En-tête de page ─────────────────────────────────────────── */

/**
 * Le KDS est dans les TROIS formules : le prix annoncé est celui de
 * l'entrée de grille, dérivé — jamais recopié.
 */
export const CUISINE_HERO = {
  badge: "L'écran cuisine",
  title: "Un écran pour coordonner la cuisine.",
  lead: "Regroupez les commandes des canaux activés, consultez les détails et suivez leur préparation. Votre équipe dispose d’une vue commune du service.",
  price: "compris dans Service, Gestion et Boost",
  claim: `dès ${euros(PLAN_MONTHLY_CENTS.essentiel)} HT / mois / établissement — matériel distinct`,
} as const;

/* ── 1. Le coup de feu ───────────────────────────────────────── */

export const ARRIVEE_POINTS: readonly string[] = [
  "Trois colonnes — Nouveau, En préparation, Prête — et un bouton par geste.",
  "Les commandes saisies en caisse, y compris celles reçues par téléphone, rejoignent la file. La commande en ligne s’y ajoute lorsque le module est activé.",
  "Le ticket sonne à l'arrivée. Le son se coupe d'un geste quand le service le demande.",
  "La remise du ticket fait évoluer son statut dans le suivi du service.",
] as const;

/* ── 2. Lisible ──────────────────────────────────────────────── */

export const LISIBLE_POINTS: readonly string[] = [
  "Les statuts distinguent les commandes nouvelles, en préparation et prêtes.",
  "Les options et les notes du client apparaissent dans le détail du ticket.",
  "Adaptez les réglages d’affichage depuis l’écran cuisine.",
] as const;

/* ── 3. La coupure ───────────────────────────────────────────── */

export const CUISINE_COUPURE_POINTS: readonly string[] = [
  "Pendant une coupure, les tickets déjà reçus restent affichés. Les nouvelles commandes attendent la reconnexion.",
  "Un indicateur de connexion permet de repérer une interruption du réseau.",
  "À la reconnexion, l’écran récupère l’état des commandes. Sans réseau, il ne reçoit pas de nouvelles commandes des autres tablettes.",
] as const;

/* ── 4. Chez vous ────────────────────────────────────────────── */

export const CUISINE_VOUS_POINTS: readonly string[] = [
  "Choisissez une tablette ou un écran avec un appareil compatible, placé à distance des sources de chaleur et des projections.",
  "Associez un appareil de remplacement, puis vérifiez la connexion et le chargement des commandes avant de reprendre le service.",
  "Le nom et les couleurs de votre établissement identifient l’écran.",
] as const;

/* ── L'appel final ───────────────────────────────────────────── */

export const CUISINE_CTA = {
  title: "Découvrez l’écran cuisine en démonstration.",
  line: "Consultez l’interface et les étapes de préparation depuis la page d’accueil. La démonstration utilise des commandes fictives.",
} as const;
