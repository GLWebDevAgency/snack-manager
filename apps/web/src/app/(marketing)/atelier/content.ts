/**
 * Copy de la page Atelier (route `/atelier`) — en français, comme tout le site.
 *
 * ═══ CE QU'ELLE EST : LA PAGE DES SERVICES D'AGENCE ═══
 *
 * Construite sur le MODÈLE de `/caisse` : mêmes trois fichiers, même registre
 * (mots de comptoir, décision du fondateur du 23/08/2026), mêmes règles de
 * fond. Elle ne vend pas le logiciel — les pages par application s'en
 * chargent — mais ce qu'on fait AUTOUR : le site, la fiche Google, les
 * réseaux. Un seul interlocuteur, celui qui fait déjà tourner la caisse.
 *
 * ═══ PAS UN MONTANT NE NAÎT ICI ═══
 *
 * Les services et leurs prix sont LUS dans `ATELIER_SERVICES` et
 * `ATELIER_CENTS` (components/marketing/content.ts), la seule grille — la
 * bande de `/offres` lit les mêmes objets. Deux textes parallèles d'un même
 * prix finiraient par se contredire, et cette page vend précisément la
 * transparence.
 *
 * ═══ LES DEUX ARGUMENTS-SIGNATURE, ET RIEN D'INVENTÉ ═══
 *
 * La maquette du site est dessinée et MONTRÉE AVANT TOUT ENGAGEMENT — on
 * valide sur pièce, pas sur promesse. Et le menu est déjà dedans : le site
 * suit la caisse, jamais de carte périmée en ligne. Aucun délai garanti,
 * aucun « satisfait ou remboursé » : ces promesses n'existent pas ici parce
 * qu'elles n'existent nulle part sur le site.
 */

import type { Shot } from "@/components/marketing/content";

/* ── Les sections, et leur sommaire ──────────────────────────── */

export type AtelierSectionMeta = {
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
 * L'ORDRE EST CELUI D'UNE MISE EN CONFIANCE : d'abord la démarche (la
 * maquette, montrée avant l'engagement), puis la grille (les six services et
 * leurs prix), puis la comparaison que le lecteur fait de toute façon (et
 * pourquoi pas une agence ?). On ne demande rien avant d'avoir tout montré.
 */
export const ATELIER_SECTIONS: readonly AtelierSectionMeta[] = [
  {
    id: "maquette",
    nav: "La maquette",
    badge: "Avant tout engagement",
    title: "La maquette d’abord. Votre décision ensuite.",
    lead: "On dessine votre site et on vous le montre : vous validez sur pièce, pas sur promesse — et votre menu est déjà dedans.",
  },
  {
    id: "parcours",
    nav: "La démarche",
    badge: "Trois étapes",
    title: "D’abord on regarde. Ensuite on dessine. Vous décidez en dernier.",
    lead: "Aucune étape ne vous engage avant que vous ayez vu — c’est l’ordre entier de la démarche.",
  },
  {
    id: "services",
    nav: "Les services",
    badge: "Prix affichés",
    title: "Six services, six prix. Écrits ici.",
    lead: "Une agence répond par un devis. Nous, on affiche la grille : voici ce qu’on fait, et ce que ça coûte.",
  },
  {
    id: "agence",
    nav: "Pourquoi nous",
    badge: "Et pas une agence",
    title: "Pourquoi nous, et pas une agence.",
    lead: "Quatre raisons — toutes vérifiables sur cette page, aucune à croire sur parole.",
  },
] as const;

/** Retrouve une section par son ancre, et LÈVE si l'ancre n'existe plus. */
export function atelierSection(id: string): AtelierSectionMeta {
  const found = ATELIER_SECTIONS.find((s) => s.id === id);
  if (!found) throw new Error(`Section inconnue de la page Atelier : ${id}`);
  return found;
}

/**
 * Le sommaire — dérivé du tableau, jamais saisi. Ancres nues : elles visent
 * des sections de CETTE page (même règle que `/offres` ; tout lien vers la
 * landing passe par `ancre()`).
 */
export const ATELIER_SOMMAIRE: readonly { href: string; label: string }[] = ATELIER_SECTIONS.map(
  (s) => ({ href: `#${s.id}`, label: s.nav }),
);

/* ── Les images ──────────────────────────────────────────────── */

/**
 * Deux bandes photographiques, comme sur `/caisse` — et deux fichiers déjà
 * dans `public/photos/libre/`, vérifiés dans PROVENANCE.md : le comptoir sous
 * ses lampes cuivrées à l'ouverture (l'artisan derrière le comptoir, ce que la
 * page raconte), la main au téléphone sur l'appel final (le geste qu'on
 * demande). Les deux sont décoratives : voilées derrière un dégradé, elles
 * posent une ambiance que le texte dit déjà.
 */
export const ATELIER_SHOTS = {
  hero: { src: "/photos/libre/comptoir-vignette.webp", alt: "" },
  cta: { src: "/photos/libre/blog-telephone-main-nuit.webp", alt: "" },
} satisfies Record<string, Shot>;

/* ── En-tête de page ─────────────────────────────────────────── */

/**
 * LE PREMIER DORÉ DE LA PAGE N'EST PAS UN PRIX, ET C'EST UNE DÉCISION : la
 * transparence EST l'argument de l'Atelier, donc c'est elle qui prend la
 * place du chiffre — même écart assumé que `/cuisine`, dont le doré dit
 * « compris dans toutes les formules ». Les montants, eux, arrivent deux
 * écrans plus bas, tous ensemble et tous affichés.
 *
 * « Sans engagement » ne s'écrit jamais seul — toujours avec « résiliable à
 * tout moment », la leçon de la constante `ENGAGEMENT`.
 */
export const ATELIER_HERO = {
  badge: "L’Atelier",
  title: "Votre présence en ligne, tenue par ceux qui font tourner votre caisse.",
  lead: "Le site, Google, les réseaux et la caisse : un seul interlocuteur — un artisan local, pas une plateforme. Zéro commission sur vos ventes, et les services mensuels sans engagement, résiliables à tout moment.",
  /** La pastille à pouls doré — LE renversement de risque, épinglé dès l'ouverture. */
  chip: "Maquette offerte — vous voyez avant de payer",
  price: "des prix affichés, pas des devis",
  claim: "et la maquette de votre site, montrée avant tout engagement",
} as const;

/* ── 1 bis. La démarche — trois étapes ───────────────────────── */

/**
 * LA FRISE DES JALONS, APPLIQUÉE À LA VENTE : le même gabarit visuel que le
 * lancement de la landing (`jl-`), parce que c'est le type le plus premium du
 * site et qu'une démarche EST une frise. Trois étapes, et la troisième dit la
 * seule chose qui compte : vous pouvez dire non, et vous ne devez rien —
 * c'est vrai (la maquette est offerte), donc ça s'écrit.
 */
export const PARCOURS_STEPS: readonly { when: string; title: string; line: string }[] = [
  {
    when: "Étape 1",
    title: "On regarde ensemble",
    line: "Trente minutes, chez vous ou au téléphone : votre site s’il existe, votre fiche Google, vos réseaux. Ce qui marche, ce qui manque — dit simplement, sans jargon.",
  },
  {
    when: "Étape 2",
    title: "On dessine votre maquette",
    line: "Votre enseigne, vos photos, votre carte déjà dedans. Offerte, sans engagement : c’est notre façon de prouver, pas de promettre.",
  },
  {
    when: "Étape 3",
    title: "Vous décidez devant elle",
    line: "Elle vous plaît : on pose les contenus et on met en ligne. Elle ne vous plaît pas : on se serre la main, et vous ne devez rien.",
  },
] as const;

/* ── 1. La maquette ──────────────────────────────────────────── */

/**
 * Les deux arguments-signature, en quatre faits : deux pour la maquette, deux
 * pour le menu. Le quatrième dit un geste que le back-office fait déjà
 * (menu et prix en direct, voir `CATALOGUE`) : rien ici n'attend d'être vrai.
 */
export const MAQUETTE_POINTS: readonly string[] = [
  "La maquette de votre site est dessinée sur mesure, et montrée avant tout engagement.",
  "Vous validez sur pièce : ce que vous voyez est ce qui part en ligne.",
  "Votre menu est déjà dedans : le site affiche la carte de votre caisse.",
  "Un prix change, un plat saute ? Vous le faites au back-office, le site suit — jamais de carte périmée en ligne.",
] as const;

/* ── 3. Et pas une agence ────────────────────────────────────── */

export type AgenceRow = { readonly label: string; readonly line: string };

/**
 * LA COMPARAISON EST ASSUMÉE MAIS PERSONNE N'EST NOMMÉ — même règle que pour
 * les plateformes : on ne se bat pas, on se place à côté. Chaque rangée dit ce
 * que NOUS faisons ; ce que font les agences, le lecteur le sait déjà.
 */
export const AGENCE_ROWS: readonly AgenceRow[] = [
  {
    label: "Des prix affichés",
    line: "Chaque service est chiffré sur cette page, avant le premier appel. Un devis opaque se négocie ; une grille affichée se vérifie.",
  },
  {
    label: "Sans engagement",
    line: "Les services mensuels se résilient à tout moment. Vous restez parce que le travail est bon, pas parce qu’un contrat vous tient.",
  },
  {
    label: "Local et joignable",
    line: "Un artisan local, pas une plateforme : la personne qui tient votre site connaît votre caisse, votre carte et votre comptoir — et vous savez qui appeler.",
  },
  {
    label: "Le logiciel derrière",
    line: "Aucune agence n’a la caisse, le site, la fiche Google et les réseaux sur une seule facture. Nous, si — et votre site est branché sur la carte de votre caisse.",
  },
] as const;

/* ── L'appel final ───────────────────────────────────────────── */

/**
 * LE DERNIER MOT EST LA DÉMARCHE, PAS UNE RELANCE : on redit l'ordre des
 * opérations — la maquette d'abord, la décision ensuite — à l'endroit exact où
 * l'on demande un numéro. Aucun délai n'est promis : on dit ce qu'on fait,
 * jamais quand.
 */
export const ATELIER_CTA = {
  title: "On commence par la maquette.",
  line: "Laissez votre numéro : on regarde ensemble ce que vous avez déjà — site, fiche Google, réseaux — puis on dessine la maquette de votre site. Vous déciderez devant elle.",
  /**
   * La preuve, au moment de demander le numéro : le logiciel derrière
   * l'Atelier tourne en service réel — un FAIT du site (la frise des jalons
   * le date), jamais un chiffre inventé.
   */
  proof: "Le logiciel derrière l’Atelier tourne en service réel 7 j/7 — et les prix que vous venez de lire sont les vrais.",
} as const;
