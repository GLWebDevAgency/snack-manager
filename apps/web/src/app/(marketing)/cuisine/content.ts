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
    nav: "Le coup de feu",
    badge: "Le coup de feu",
    title: "Chaque commande arrive à sa place. Avec le son.",
    lead: "Caisse, téléphone et commande en ligne selon les modules activés : une seule file, trois colonnes et un signal sonore à l’arrivée.",
  },
  {
    id: "lisible",
    nav: "Lisible",
    badge: "Sans lunettes",
    title: "Lisible du fond de la cuisine.",
    lead: "Des gros caractères, et des couleurs qui veulent toujours dire la même chose : vert, c'est prêt. Personne ne réapprend les codes à chaque service.",
  },
  {
    id: "coupure",
    nav: "Sans internet",
    badge: "Vendredi soir",
    title: "La coupure passe, vos tickets restent.",
    lead: "La cuisine conserve les tickets déjà reçus. Les nouvelles commandes attendent la reconnexion pour parvenir à l’écran.",
  },
  {
    id: "vous",
    nav: "Chez vous",
    badge: "Votre matériel",
    title: "Une tablette, ou un moniteur au mur.",
    lead: "L'écran s'appaire comme un téléviseur : six caractères, et il est à votre enseigne. Le matériel reste le vôtre.",
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
  hero: { src: "/shots/kds.png", alt: "" },
  cta: { src: "/photos/libre/blog-fenetre-service-nuit.webp", alt: "" },
} satisfies Record<string, Shot>;

/* ── En-tête de page ─────────────────────────────────────────── */

/**
 * Le KDS est dans les TROIS formules : le prix annoncé est celui de
 * l'entrée de grille, dérivé — jamais recopié.
 */
export const CUISINE_HERO = {
  badge: "L'écran cuisine",
  title: "L'écran qui tient la cuisine.",
  lead: "Fini les tickets papier qui se perdent et les commandes criées deux fois : tout arrive à l'écran, dans l'ordre, lisible de loin.",
  price: "compris dans toutes les formules",
  claim: `dès ${euros(PLAN_MONTHLY_CENTS.essentiel)} / mois — zéro commission`,
} as const;

/* ── 1. Le coup de feu ───────────────────────────────────────── */

export const ARRIVEE_POINTS: readonly string[] = [
  "Trois colonnes — Nouveau, En préparation, Prête — et un bouton par geste.",
  "La caisse, le téléphone et la commande en ligne tombent dans la même file.",
  "Le ticket sonne à l'arrivée. Le son se coupe d'un geste quand le service le demande.",
  "La remise archive le ticket — et nourrit les statistiques du soir.",
] as const;

/* ── 2. Lisible ──────────────────────────────────────────────── */

export const LISIBLE_POINTS: readonly string[] = [
  "Vert, c'est prêt — toujours. Les couleurs de sens ne changent jamais de métier.",
  "Les « sans oignons » et les notes du client sont sur le ticket, impossibles à rater.",
  "Les réglages d'affichage se font à l'écran, sans redémarrer ni appeler personne.",
] as const;

/* ── 3. La coupure ───────────────────────────────────────────── */

export const CUISINE_COUPURE_POINTS: readonly string[] = [
  "Les tickets restent affichés : la cuisine ne s'arrête pas parce que la box redémarre.",
  "La pastille réseau dit l'état sans alarmer — toujours visible, jamais anxiogène.",
  "À la reconnexion, l’écran récupère l’état des commandes. Sans réseau, il ne reçoit pas de nouvelles commandes des autres tablettes.",
] as const;

/* ── 4. Chez vous ────────────────────────────────────────────── */

export const CUISINE_VOUS_POINTS: readonly string[] = [
  "Une tablette du commerce — ou un moniteur mural déporté, à l'abri de la graisse et de la chaleur.",
  "L'appairage tient en six caractères, comme la caisse : l'écran casse, le remplaçant reprend.",
  "À votre enseigne : votre nom, votre couleur — pas les nôtres.",
] as const;

/* ── L'appel final ───────────────────────────────────────────── */

export const CUISINE_CTA = {
  title: "Regardez-le tourner, sans compte.",
  line: "L'écran cuisine est en démonstration sur la page d'accueil, à côté de la caisse : envoyez une commande, regardez-la traverser les colonnes.",
} as const;
