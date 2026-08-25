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
    title: "La commande tombe en cuisine, toute seule.",
    lead: "Le ticket part droit à l'écran cuisine, avec son créneau de retrait : zéro ressaisie, zéro tablette de plus.",
  },
  {
    id: "fidelite",
    nav: "La fidélité",
    badge: "Ils reviennent",
    title: "La fidélité sans carte tamponnée.",
    lead: "Les points se cumulent tout seuls à chaque commande. L'habitué a une raison de plus de commander en direct — et son numéro est chez vous.",
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
  lead: "Le click & collect à vos couleurs : vos clients commandent, choisissent leur créneau, et la cuisine reçoit le ticket — pendant que vous servez.",
  price: `${euros(MODULE_MONTHLY_CENTS)} / mois`,
  claim: `+ ${euros(MODULE_SETUP_CENTS)} de mise en service, une fois — les deux compris dans Boost`,
} as const;

/* ── 1. En direct ────────────────────────────────────────────── */

export const DIRECT_POINTS: readonly string[] = [
  "Votre page, à vos couleurs, sur votre nom de domaine — ou branchée sur votre site actuel.",
  "Le prix affiché en ligne est celui de la salle : rien à gonfler pour absorber une commission.",
  "Le client est le vôtre : son numéro, son historique, ses habitudes restent chez vous.",
  "Vous livrez déjà ? Vous continuez comme aujourd'hui — vos tournées, vos horaires.",
] as const;

/* ── 2. Vers la cuisine ──────────────────────────────────────── */

export const CUISINE_LIEN_POINTS: readonly string[] = [
  "Des créneaux de retrait à votre rythme, avec une capacité par créneau : la cuisine n'est jamais submergée.",
  "Ça déborde ? Vous mettez la commande en ligne en pause d'un geste, avec un mot à vos clients.",
  "Paiement en ligne ou au retrait : c'est vous qui décidez ce que la page propose.",
  "Le client suit sa commande sur son téléphone — il arrive quand c'est prêt, pas avant.",
] as const;

/* ── 3. La fidélité ──────────────────────────────────────────── */

export const FIDELITE_POINTS: readonly string[] = [
  "Les points se cumulent tout seuls, à chaque commande — rien à tamponner, rien à expliquer.",
  "Les codes promo, quand vous voulez pousser une offre — créés depuis le back-office.",
  "Les comptes clients gardent les coordonnées et l'historique — chez vous, exportables.",
] as const;

/* ── 4. Sur Google ───────────────────────────────────────────── */

export const GOOGLE_POINTS: readonly string[] = [
  "Votre lien de commande est ajouté à votre fiche Google, marqué « préféré par l'établissement ».",
  "Les plateformes restent : elles vous apportent des clients que vous n'auriez pas eus, et portent les sacs.",
  "L'ajout du lien est compris dans la mise en route — c'est nous qui le faisons.",
] as const;

/* ── L'appel final ───────────────────────────────────────────── */

export const COMMANDE_CTA = {
  title: "Commandez chez Class'Food, pour voir.",
  line: "Le tunnel de commande est en démonstration sur la page d'accueil : composez un menu, choisissez un créneau — personne ne vous demandera votre e-mail.",
} as const;
