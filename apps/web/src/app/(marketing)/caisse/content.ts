/**
 * Copy de la page Caisse (route `/caisse`) — en français, comme tout le site.
 *
 * ═══ CE QU'ELLE EST : LA PREMIÈRE PAGE PAR APPLICATION ═══
 *
 * La landing CONVAINC en onze sections, `/offres` DÉTAILLE les prix ; cette
 * page détaille UNE application pour qui la cherche par son nom — « logiciel
 * caisse snack », « caisse kebab » — ou pour qui veut vérifier ce que la
 * caisse fait avant de laisser son numéro. C'est le MODÈLE des pages à venir
 * (écran cuisine, commande en ligne) : même structure de fichiers, même
 * registre, mêmes règles.
 *
 * ═══ LE REGISTRE EST CELUI DU HERO — DÉCISION DU FONDATEUR (23/08/2026) ═══
 *
 * Des mots de comptoir, des phrases courtes, lisibles en diagonale par un
 * lecteur dont le français n'est pas la langue forte. Le bénéfice d'abord,
 * l'outil ensuite. Aucune image à décoder.
 *
 * ═══ ET LES RÈGLES DE FOND SONT CELLES DE LA VITRINE ═══
 *
 * Aucun chiffre de résultat (un seul restaurant pilote), aucun témoignage,
 * aucun montant écrit à la main : le prix descend de `PLAN_MONTHLY_CENTS`.
 * Chaque affirmation de cette page correspond à une capacité RÉELLE du
 * produit — la caisse en démonstration sur la landing est là pour le prouver,
 * et une promesse qu'elle démentirait coûterait la page entière.
 */

import { PLAN_MONTHLY_CENTS, euros, type Shot } from "@/components/marketing/content";

/* ── Les sections, et leur sommaire ──────────────────────────── */

export type CaisseSectionMeta = {
  /** Ancre réelle dans le DOM — le sommaire ne vise que celles-là. */
  id: string;
  /** Libellé court du sommaire. */
  nav: string;
  /** Pastille au-dessus du titre. */
  badge: string;
  /** Le `h2` de la section. */
  title: string;
  /** La phrase sous le titre. */
  lead: string;
};

/**
 * L'ORDRE EST CELUI D'UN SERVICE : on prend la commande, on encaisse, le
 * réseau saute, et la caisse reste la vôtre. Le lecteur suit sa propre
 * journée, pas notre catalogue.
 */
export const CAISSE_SECTIONS: readonly CaisseSectionMeta[] = [
  {
    id: "service",
    nav: "Le service",
    badge: "Au comptoir",
    title: "Prendre la commande, l'envoyer en cuisine, encaisser.",
    lead: "Une interface tactile pour saisir les plats, transmettre les commandes et enregistrer les règlements. La prise en main se prépare avec votre carte.",
  },
  {
    id: "encaissement",
    nav: "L'encaissement",
    badge: "Suivi des règlements",
    title: "Retrouvez vos règlements par moyen de paiement.",
    lead: "La clôture présente les montants enregistrés par moyen de paiement. Vous les rapprochez de votre tiroir et des relevés de vos terminaux.",
  },
  {
    id: "coupure",
    nav: "Sans internet",
    badge: "En cas de coupure",
    title: "Continuez la saisie pendant une coupure.",
    lead: "La caisse garde localement les commandes saisies et les renvoie à la reconnexion. Leur transmission à la cuisine attend le retour de la connexion.",
  },
  {
    id: "vous",
    nav: "Chez vous",
    badge: "À vos couleurs",
    title: "Votre nom, votre logo, votre matériel.",
    lead: "Associez un appareil compatible à votre établissement avec un code d'appairage. La configuration et les périphériques sont vérifiés avec vous.",
  },
] as const;

/** Retrouve une section par son ancre, et LÈVE si l'ancre n'existe plus. */
export function caisseSection(id: string): CaisseSectionMeta {
  const found = CAISSE_SECTIONS.find((s) => s.id === id);
  if (!found) throw new Error(`Section inconnue de la page Caisse : ${id}`);
  return found;
}

/**
 * Le sommaire — dérivé du tableau, jamais saisi. Ancres nues : elles visent
 * des sections de CETTE page (même règle que `/offres` ; tout lien vers la
 * landing passe par `ancre()`).
 */
export const CAISSE_SOMMAIRE: readonly { href: string; label: string }[] = CAISSE_SECTIONS.map(
  (s) => ({ href: `#${s.id}`, label: s.nav }),
);

/* ── Les images ──────────────────────────────────────────────── */

/**
 * Deux bandes photographiques, comme sur `/offres` : l'ouverture sur la
 * capture réelle de la caisse (voilée — le hero raconte, la démo de la
 * landing montre), et l'appel final sur une scène de service. Les deux sont
 * décoratives : voilées derrière un dégradé, elles posent une ambiance que le
 * texte dit déjà. Provenance : `public/photos/libre/PROVENANCE.md`.
 */
export const CAISSE_SHOTS = {
  hero: { src: "/shots/dark-20260919/pos.jpg", alt: "" },
  cta: { src: "/photos/libre/service-sous-lampe.webp", alt: "" },
} satisfies Record<string, Shot>;

/* ── En-tête de page ─────────────────────────────────────────── */

/**
 * Le premier doré de la page est un prix, comme sur `/offres` — et il est
 * DÉRIVÉ de la grille : le jour où Service bouge, cette page suit.
 */
export const CAISSE_HERO = {
  badge: "La caisse",
  title: "Une caisse pour organiser votre service.",
  lead: "Prendre la commande, suivre la cuisine, encaisser. En cas de coupure, la saisie reste locale et la transmission reprend au retour du réseau.",
  price: `dès ${euros(PLAN_MONTHLY_CENTS.essentiel)} HT / mois / établissement`,
  claim: "Comprise dans Service, Gestion et Boost. Frais de paiement et matériel distincts.",
} as const;

/* ── 1. Le service ───────────────────────────────────────────── */

/**
 * Six faits, tous tenus par le produit — la démo de la landing les montre.
 * « Une heure pour une recrue » vient de `VS_WITH` : c'est un constat du
 * pilote, pas une étude inventée.
 */
export const SERVICE_POINTS: readonly string[] = [
  "Saisissez les commandes sur place, à emporter ou reçues par téléphone.",
  "Les commandes sont transmises à l’écran cuisine connecté. L’impression utilise le matériel compatible configuré dans votre établissement.",
  "Un code de retrait permet d’identifier une commande mise en attente.",
  "Les remises et annulations sont soumises aux autorisations prévues et enregistrées dans le journal d’activité.",
  "Le numéro de retrait et le statut permettent de retrouver la commande transmise.",
  "Gérez la carte et les prix depuis le back-office ; les appareils connectés récupèrent les mises à jour.",
] as const;

/* ── 2. L'encaissement ───────────────────────────────────────── */

/**
 * LA LIGNE CARTE EST UN ENGAGEMENT, PAS UNE LIMITE. « Vous gardez votre
 * TPE » : l'argent du restaurateur va sur son compte, aux conditions déjà
 * négociées avec sa banque — nous n'y touchons pas. C'est l'argument que les
 * caisses à commission ne peuvent pas écrire.
 */
export type EncaissementRow = { readonly label: string; readonly line: string };

export const ENCAISSEMENT_ROWS: readonly EncaissementRow[] = [
  {
    label: "Espèces",
    line: "Saisissez le montant reçu pour calculer la monnaie à rendre.",
  },
  {
    label: "Carte bancaire",
    line: "Le paiement est encaissé sur votre TPE selon le contrat de votre prestataire. Vous enregistrez le règlement dans la caisse.",
  },
  {
    label: "Titre-restaurant",
    line: "Enregistrez les titres acceptés par votre établissement. Les cartes titre-restaurant sont encaissées sur un terminal compatible.",
  },
  {
    label: "À encaisser au retrait",
    line: "Préparez une commande dont le règlement est prévu au retrait.",
  },
] as const;

export const Z_NOTE =
  "La clôture regroupe les montants enregistrés pour contrôler votre service. Les relevés de banque, de TPE et de prestataires de paiement restent à rapprocher séparément.";

/* ── 3. La coupure ───────────────────────────────────────────── */

export const COUPURE_POINTS: readonly string[] = [
  "Les commandes enregistrées sur cet appareil sont conservées localement puis renvoyées à la reconnexion, avec une protection contre les doublons.",
  "L’impression dépend du matériel compatible et du réseau local. Le ticket et le sticker sont testés sur votre installation avant le lancement.",
  "Sans connexion, les nouvelles commandes n’arrivent pas sur une autre tablette. Le fonctionnement de secours est validé avec votre équipe.",
] as const;

/* ── 4. Chez vous ────────────────────────────────────────────── */

export const VOUS_POINTS: readonly string[] = [
  "Le matériel compatible est étudié avant installation, selon votre appareil, votre système et les périphériques nécessaires.",
  "Tickets, stickers et tiroir-caisse : le matériel compatible est sélectionné et testé selon vos besoins.",
  "Votre nom, votre logo et vos couleurs identifient votre établissement.",
  "Un appareil de remplacement peut être associé à votre établissement. Les commandes restées uniquement sur l’ancien appareil nécessitent une récupération spécifique.",
] as const;

/* ── L'appel final ───────────────────────────────────────────── */

/**
 * LE DERNIER MOT EST UNE PREUVE, PAS UNE PROMESSE : la caisse se manipule en
 * démonstration sur la landing, sans compte. C'est le même contrat que le
 * titre de la section produit — « Passez derrière le comptoir ».
 */
export const CAISSE_CTA = {
  title: "Découvrez la caisse en démonstration.",
  line: "Explorez la caisse depuis la page d’accueil avec des données d’exemple. Les actions de démonstration ne déclenchent aucun paiement réel.",
} as const;
