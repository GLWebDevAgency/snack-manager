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
    title: "Proposez votre propre page de commande.",
    lead: "Présentez votre carte à vos couleurs et choisissez vos prix. Snack Manager ne prélève pas de commission sur les commandes ; les frais de paiement restent distincts.",
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
    lead: "Ajoutez un accès à votre commande directe sur votre fiche d’établissement. Vos autres canaux peuvent rester disponibles selon votre organisation.",
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
  title: "Recevez vos commandes en direct.",
  lead: "Le click & collect à vos couleurs : commande, créneau et paiement. Le back-office inclus vous permet de traiter les commandes, même sans notre caisse. La fidélité est incluse en pilote accompagné.",
  price: `${euros(MODULE_MONTHLY_CENTS)} HT / mois / établissement`,
  claim: `+ ${euros(MODULE_SETUP_CENTS)} HT de mise en service standard — abonnement et mise en service compris dans Boost. Frais de paiement distincts.`,
} as const;

/* ── 1. En direct ────────────────────────────────────────────── */

export const DIRECT_POINTS: readonly string[] = [
  "Votre page reprend votre identité. L’utilisation de votre nom de domaine ou l’intégration à un site existant sont précisées au devis.",
  "Vous définissez vos prix de vente. L’abonnement est distinct des frais de votre prestataire de paiement.",
  "Consultez les informations nécessaires au traitement des commandes et les données clients disponibles, selon les consentements recueillis.",
  "La livraison par votre restaurant est incluse dans Boost sans supplément, ou proposée dans le module à la carte dédié. Ouverture après configuration et validation pilote. Aucun livreur tiers n’est fourni.",
] as const;

/* ── 2. Vers la cuisine ──────────────────────────────────────── */

export const CUISINE_LIEN_POINTS: readonly string[] = [
  "Des horaires et une capacité par créneau pour limiter le nombre de commandes acceptées.",
  "Mettez la commande en ligne en pause lorsque votre capacité de service est atteinte, avec un message destiné aux clients.",
  "Paiement en ligne ou au retrait : c'est vous qui décidez ce que la page propose.",
  "Le client suit les statuts de sa commande sur son téléphone et retrouve son créneau de retrait.",
] as const;

/* ── 3. La fidélité ──────────────────────────────────────────── */

export const FIDELITE_POINTS: readonly string[] = [
  "Vous choisissez points ou tampons, seuils et récompenses avec notre accompagnement. L’utilisation sécurisée des récompenses reste à finaliser ; elle n’est pas disponible dans ce pilote.",
  "L’attribution automatique de points après une commande en ligne n’est pas disponible. Les opérations assistées et leurs limites sont précisées avant ouverture du programme.",
  "Créez vos codes promotionnels depuis le back-office pour une opération définie.",
  "Le back-office permet de gérer les membres et leurs cartes, avec les informations et consentements du programme.",
] as const;

/* ── 4. Sur Google ───────────────────────────────────────────── */

export const GOOGLE_POINTS: readonly string[] = [
  "L’ajout du lien à votre fiche Google est préparé avec vous, sous réserve des accès et options disponibles pour votre établissement.",
  "Conservez les canaux qui vous sont utiles et comparez leur coût complet, y compris la livraison lorsqu’elle est proposée.",
  "L’accompagnement à l’ajout du lien est compris dans la mise en service standard, avec votre autorisation d’accès à la fiche.",
] as const;

/* ── L'appel final ───────────────────────────────────────────── */

export const COMMANDE_CTA = {
  title: "Essayez le parcours de commande en démonstration.",
  line: "Découvrez la carte, les options et le choix du créneau depuis la page d’accueil. La démonstration utilise des données d’exemple, sans paiement réel.",
} as const;
