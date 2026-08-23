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
    lead: "Trois gestes, des gros boutons, rien à apprendre par cœur : une nouvelle recrue tient la caisse en une heure.",
  },
  {
    id: "encaissement",
    nav: "L'encaissement",
    badge: "Le compte est bon",
    title: "Espèces, carte, titre-restaurant. Et le soir, tout se recoupe.",
    lead: "Chaque moyen de paiement a son bouton, et la clôture de service se vérifie ligne par ligne — le tiroir, le TPE, la télécollecte.",
  },
  {
    id: "coupure",
    nav: "Sans internet",
    badge: "Vendredi soir",
    title: "Le wifi saute ? La caisse continue.",
    lead: "Un rush ne prévient pas. La caisse et la cuisine travaillent en local, et tout se resynchronise au retour du réseau.",
  },
  {
    id: "vous",
    nav: "Chez vous",
    badge: "À vos couleurs",
    title: "Votre nom, votre logo, votre matériel.",
    lead: "La caisse s'installe comme un téléviseur : un code de six caractères, et elle est chez vous — sur une tablette du commerce.",
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
  hero: { src: "/shots/pos.png", alt: "" },
  cta: { src: "/photos/libre/service-sous-lampe.webp", alt: "" },
} satisfies Record<string, Shot>;

/* ── En-tête de page ─────────────────────────────────────────── */

/**
 * Le premier doré de la page est un prix, comme sur `/offres` — et il est
 * DÉRIVÉ de la grille : le jour où Essentiel bouge, cette page suit.
 */
export const CAISSE_HERO = {
  badge: "La caisse",
  title: "La caisse qui tient le rush.",
  lead: "Prendre la commande, l'envoyer en cuisine, encaisser — même quand la file déborde, même quand le wifi saute.",
  price: `dès ${euros(PLAN_MONTHLY_CENTS.essentiel)} / mois`,
  claim: "zéro commission — quand vous vendez plus, c'est pour vous",
} as const;

/* ── 1. Le service ───────────────────────────────────────────── */

/**
 * Six faits, tous tenus par le produit — la démo de la landing les montre.
 * « Une heure pour une recrue » vient de `VS_WITH` : c'est un constat du
 * pilote, pas une étude inventée.
 */
export const SERVICE_POINTS: readonly string[] = [
  "Sur place, à emporter, téléphone : trois boutons, pas un menu caché.",
  "Le ticket part en cuisine tout seul — sur l'écran, et à l'imprimante.",
  "Un ticket mis en attente reçoit un code court, criable au comptoir.",
  "Remise ou annulation : code PIN du gérant, et tout est journalisé.",
  "Le numéro de retrait s'affiche tout de suite, même sans réseau.",
  "La carte et les prix se changent au back-office — la caisse suit en direct.",
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
    line: "Vous tapez ce que le client pose, la caisse calcule le rendu.",
  },
  {
    label: "Carte bancaire",
    line: "Vous encaissez sur votre TPE, aux conditions de votre banque. La caisse enregistre — nous ne touchons pas à votre argent.",
  },
  {
    label: "Titre-restaurant",
    line: "Papier ou carte, sur votre terminal habituel. Le midi est enfin ventilé correctement.",
  },
  {
    label: "À encaisser au retrait",
    line: "La commande part en cuisine, le règlement attend le client.",
  },
] as const;

export const Z_NOTE =
  "Et le soir, la clôture de service affiche cinq lignes qui se recoupent : les espèces du tiroir, le bordereau du TPE, la télécollecte des titres, la vente en ligne, le reste dû.";

/* ── 3. La coupure ───────────────────────────────────────────── */

export const COUPURE_POINTS: readonly string[] = [
  "Aucune commande perdue : chaque envoi est rejoué jusqu'à ce qu'il passe, sans jamais créer de doublon.",
  "Les tickets s'impriment quand même — l'imprimante est sur votre réseau local, pas sur internet.",
  "Le numéro de retrait sort tout de suite : la file avance, le client attend son numéro, pas la fibre.",
] as const;

/* ── 4. Chez vous ────────────────────────────────────────────── */

export const VOUS_POINTS: readonly string[] = [
  "Une tablette du commerce, Android ou iPad. Aucun matériel propriétaire, aucune location.",
  "L'imprimante ticket 80 mm en réseau est requise : le ticket cuisine, le sticker du sac, le tiroir-caisse.",
  "Votre nom, votre logo, votre couleur — la caisse est à votre enseigne, pas à la nôtre.",
  "La tablette casse ? Six caractères sur la remplaçante, et la caisse revient.",
] as const;

/* ── L'appel final ───────────────────────────────────────────── */

/**
 * LE DERNIER MOT EST UNE PREUVE, PAS UNE PROMESSE : la caisse se manipule en
 * démonstration sur la landing, sans compte. C'est le même contrat que le
 * titre de la section produit — « Ne nous croyez pas sur parole ».
 */
export const CAISSE_CTA = {
  title: "Essayez-la maintenant, sans compte.",
  line: "La caisse tourne en démonstration sur la page d'accueil : prenez une commande, encaissez-la — personne ne vous demandera votre e-mail.",
} as const;
