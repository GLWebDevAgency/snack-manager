/**
 * Copy de la page Commande en ligne (route `/commande-en-ligne`).
 *
 * Troisième page par application, sur le MODÈLE de `/caisse` : même registre
 * (mots de comptoir, décision du 23/08/2026), mêmes règles — aucun chiffre de
 * résultat, montants dérivés des constantes de la vitrine, et chaque
 * affirmation tenue par le produit. Les plateformes de livraison restent des
 * ATOUTS, jamais des adversaires : elles acquièrent, le canal direct fidélise
 * — c'est l'arbitrage du fondateur, écrit dans `SERVICES`.
 */

import {
  MODULE_MONTHLY_CENTS,
  MODULE_SETUP_CENTS,
  euros,
  type Shot,
} from "@/components/marketing/content";
import { LOYALTY_PILOT_NOTE } from "@/components/marketing/commerce-offers";

/* ── Les sections, et leur sommaire ──────────────────────────── */

export type CommandeSectionMeta = {
  id: string;
  nav: string;
  badge: string;
  title: string;
  lead: string;
};

/**
 * L'ordre est celui d'une commande : le client commande chez vous, elle
 * tombe en cuisine, il revient — et Google amène le suivant.
 */
export const COMMANDE_SECTIONS: readonly CommandeSectionMeta[] = [
  {
    id: "direct",
    nav: "En direct",
    badge: "Chez vous",
    title: "Vos clients commandent chez vous. Au prix de la carte.",
    lead: "Une page à vos couleurs, sur votre nom de domaine si vous en avez un. Zéro commission à absorber : vos prix restent les vôtres, et le client aussi.",
  },
  {
    id: "cuisine",
    nav: "Vers la cuisine",
    badge: "Sans ressaisie",
    title: "Recevez et traitez vos commandes en direct.",
    lead: "Le back-office inclus reçoit vos commandes et leurs créneaux. Si vous utilisez notre cuisine KDS, elles rejoignent aussi sa file.",
  },
  {
    id: "fidelite",
    nav: "La fidélité",
    badge: "Pilote accompagné",
    title: "Votre programme fidélité, configuré avec vous.",
    lead: LOYALTY_PILOT_NOTE,
  },
  {
    id: "google",
    nav: "Sur Google",
    badge: "La visibilité",
    title: "Votre lien de commande, sur votre fiche Google.",
    lead: "À côté de ceux des plateformes, et marqué « préféré par l'établissement ». Elles continuent d'apporter des clients ; votre page retient ceux qui reviennent.",
  },
] as const;

export function commandeSection(id: string): CommandeSectionMeta {
  const found = COMMANDE_SECTIONS.find((s) => s.id === id);
  if (!found) throw new Error(`Section inconnue de la page Commande en ligne : ${id}`);
  return found;
}

export const COMMANDE_SOMMAIRE: readonly { href: string; label: string }[] = COMMANDE_SECTIONS.map(
  (s) => ({ href: `#${s.id}`, label: s.nav }),
);

/* ── Les images ──────────────────────────────────────────────── */

/**
 * LE HERO N'EST PLUS LA CAPTURE DU TUNNEL. `commande-tunnel.webp` fait
 * 780 × 763 : presque carrée et minuscule, étirée sur une bande de pleine
 * largeur elle sortait floue et mal cadrée — constaté en production par le
 * fondateur (23/08). La capture reste à sa place sur `/offres`, en panneau
 * CONTENU, où son format lui va. Ici, la bande porte une photographie
 * paysage (1560 × 780) : un téléphone en main, la scène exacte de la page.
 */
export const COMMANDE_SHOTS = {
  hero: { src: "/photos/libre/blog-telephone-main-nuit.webp", alt: "" },
  cta: { src: "/photos/libre/ambiance-salle-nuit-bokeh.webp", alt: "" },
} satisfies Record<string, Shot>;

/* ── En-tête de page ─────────────────────────────────────────── */

/**
 * Les deux montants du module — dérivés, comme partout : le jour où la
 * grille bouge, cette page suit.
 */
export const COMMANDE_HERO = {
  badge: "La commande en ligne",
  title: "La commande en ligne sans commission.",
  lead: "Le click & collect à vos couleurs : commande, créneau et paiement. Le back-office inclus vous permet de traiter les commandes, même sans notre caisse. La fidélité est incluse en pilote accompagné.",
  price: `${euros(MODULE_MONTHLY_CENTS)} / mois`,
  claim: `+ ${euros(MODULE_SETUP_CENTS)} de mise en service, une fois — les deux compris dans Boost`,
} as const;

/* ── 1. En direct ────────────────────────────────────────────── */

export const DIRECT_POINTS: readonly string[] = [
  "Votre page, à vos couleurs, sur votre nom de domaine — ou branchée sur votre site actuel.",
  "Le prix affiché en ligne est celui de la salle : rien à gonfler pour absorber une commission.",
  "Le client est le vôtre : son numéro, son historique, ses habitudes restent chez vous.",
  "La livraison par votre restaurant est incluse dans Boost sans supplément, ou proposée dans le module à la carte dédié. Ouverture après configuration et validation pilote. Aucun livreur tiers n’est fourni.",
] as const;

/* ── 2. Vers la cuisine ──────────────────────────────────────── */

export const CUISINE_LIEN_POINTS: readonly string[] = [
  "Des horaires et une capacité par créneau pour limiter le nombre de commandes acceptées.",
  "Ça déborde ? Vous mettez la commande en ligne en pause d'un geste, avec un mot à vos clients.",
  "Paiement en ligne ou au retrait : c'est vous qui décidez ce que la page propose.",
  "Le client suit les statuts de sa commande sur son téléphone et retrouve son créneau de retrait.",
] as const;

/* ── 3. La fidélité ──────────────────────────────────────────── */

export const FIDELITE_POINTS: readonly string[] = [
  "Vous choisissez points ou tampons, seuils et récompenses avec notre accompagnement. L’utilisation sécurisée des récompenses reste à finaliser ; elle n’est pas disponible dans ce pilote.",
  "L’attribution automatique de points après une commande en ligne n’est pas disponible. Les opérations assistées et leurs limites sont précisées avant ouverture du programme.",
  "Les codes promo, quand vous voulez pousser une offre — créés depuis le back-office.",
  "Le back-office permet de gérer les membres et leurs cartes, avec les informations et consentements du programme.",
] as const;

/* ── 4. Sur Google ───────────────────────────────────────────── */

export const GOOGLE_POINTS: readonly string[] = [
  "Votre lien de commande est ajouté à votre fiche Google, marqué « préféré par l'établissement ».",
  "Les plateformes restent : elles vous apportent des clients que vous n'auriez pas eus, et portent les sacs.",
  "L'ajout du lien est compris dans la mise en route — c'est nous qui le faisons.",
] as const;

/* ── L'appel final ───────────────────────────────────────────── */

export const COMMANDE_CTA = {
  title: "Essayez le parcours de commande en démonstration.",
  line: "Le tunnel de commande est en démonstration sur la page d'accueil : composez un menu, choisissez un créneau — personne ne vous demandera votre e-mail.",
} as const;
