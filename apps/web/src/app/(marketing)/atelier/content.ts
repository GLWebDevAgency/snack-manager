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
 * L'ORDRE EST CELUI D'UNE MISE EN CONFIANCE : la démarche (neutre), la grille
 * des prix, la garantie du site, puis la comparaison que le lecteur fait de
 * toute façon (et pourquoi pas une agence ?). On ne demande rien avant
 * d'avoir tout montré. Le sommaire dérive de ce tableau : son ordre EST
 * l'ordre des sections dans la page — les deux se recalent ensemble.
 */
export const ATELIER_SECTIONS: readonly AtelierSectionMeta[] = [
  // La démarche OUVRE, et elle est neutre : regarder, choisir service par
  // service, confier. La maquette n'y est plus une étape — elle avait pris
  // cette place et laissait croire que tout partait du site, alors qu'un
  // restaurateur peut ne rien vouloir y changer (fondateur, 25/08) : elle est
  // redescendue comme GARANTIE du service site, dans sa propre section.
  {
    id: "parcours",
    nav: "La démarche",
    badge: "Trois étapes",
    title: "On regarde. Vous choisissez. On s’en occupe.",
    // « Rien n'est un paquet » disait la liberté par la négative : « à la
    // carte » la dit dans la langue du métier (fondateur, 25/08 —
    // communication positive partout).
    lead: "Chaque service se choisit à la carte : la fiche Google seule, les réseaux seuls, ou tout ensemble. Vous composez, on s’occupe du reste.",
  },
  {
    id: "services",
    nav: "Les services",
    badge: "Prix affichés",
    title: "Six services, six prix. Écrits ici.",
    lead: "Des repères de prix pour choisir. Le devis fixe le périmètre de votre site sur mesure et les éventuels frais récurrents.",
  },
  {
    id: "maquette",
    nav: "Le site, sans risque",
    badge: "Si vous prenez le site",
    title: "Le site ? Vous le voyez avant de payer.",
    lead: "Nous vous présentons la direction du site avant engagement. Votre vitrine est sur mesure ; ses boutons Commander ouvrent votre application de commande.",
  },
  {
    id: "agence",
    nav: "Pourquoi nous",
    badge: "La comparaison",
    // Le titre AFFIRME au lieu d'opposer : tout ce qu'une agence fait, plus
    // ce qu'elle n'aura jamais — le comptoir, la caisse, la carte.
    title: "Tout d’une agence, avec le comptoir en plus.",
    lead: "Une création sur mesure, un interlocuteur identifié et un lien clair vers vos outils de commande.",
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
 * place du chiffre — même écart assumé que `/cuisine`. Les montants arrivent
 * plus bas, tous ensemble et tous affichés. « Sans engagement » ne s'écrit
 * jamais seul — toujours avec « résiliable à tout moment ».
 *
 * L'ANGLE EST CELUI DU FONDATEUR (25/08), MOT POUR MOT OU PRESQUE : un
 * restaurant, c'est aussi une image et de la communication — et quelqu'un
 * s'en occupe pour vous. Pas une liste de prestations : une charge qu'on
 * enlève. La pastille à pouls doré porte l'autre message qui devait être
 * limpide : chaque service se choisit SEUL — la maquette du site n'est la
 * condition de rien, elle est la garantie d'UN service, dite dans sa section.
 */
export const ATELIER_HERO = {
  badge: "L’Atelier",
  title: "Un restaurant, c’est aussi une image. On s’en occupe pour vous.",
  lead: "La fiche Google, les réseaux, le site, l’identité visuelle : un interlocuteur pour votre présence en ligne, avec ou sans notre caisse. Prestations sur mesure et services mensuels se choisissent séparément, selon un périmètre convenu.",
  /** La pastille à pouls doré — LE message anti-confusion, épinglé dès l'ouverture. */
  chip: "Chaque service se choisit seul, à la carte",
  price: "des prix affichés, noir sur blanc",
  claim: "et si vous prenez le site : sa maquette est offerte, montrée avant tout engagement",
} as const;

/* ── 1 bis. La démarche — trois étapes ───────────────────────── */

/**
 * LA FRISE DES JALONS, APPLIQUÉE À LA VENTE : le même gabarit visuel que le
 * lancement de la landing (`jl-`), parce que c'est le type le plus premium du
 * site et qu'une démarche EST une frise.
 *
 * ═══ ET ELLE EST NEUTRE — AUCUN SERVICE N'Y EST UNE ÉTAPE ═══
 *
 * La première version mettait « on dessine votre maquette » en étape 2 : le
 * lecteur qui ne voulait pas toucher à son site comprenait que tout partait
 * de là (fondateur, 25/08). La démarche dit désormais la seule chose vraie
 * pour TOUS les services : on regarde, VOUS choisissez service par service,
 * on s'en occupe. La maquette vit dans la section du site, comme sa garantie.
 */
export const PARCOURS_STEPS: readonly { when: string; title: string; line: string }[] = [
  {
    when: "Étape 1",
    title: "On regarde votre image ensemble",
    line: "Trente minutes, chez vous ou au téléphone : votre fiche Google, vos réseaux, votre site s’il existe. Ce qui marche, ce qui manque — dit simplement, sans jargon.",
  },
  {
    when: "Étape 2",
    title: "Vous choisissez, service par service",
    line: "Chaque service a son prix, affiché sur cette page, et se prend seul — la fiche Google seule, les réseaux seuls. Vous composez à la carte, à votre rythme.",
  },
  {
    when: "Étape 3",
    title: "On s’en occupe, vous tenez votre comptoir",
    line: "Publications, avis, mises à jour : le travail part, et un rapport simple vous dit ce qui a été fait. Les services mensuels se résilient à tout moment.",
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
  "Votre site vitrine peut se choisir seul, sans abonnement à la caisse.",
  "Les boutons Commander renvoient au module personnalisé. La carte et les prix de ce module se gèrent dans son back-office.",
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
    line: "Les services mensuels se résilient à tout moment. Vous restez pour une seule raison : le travail est bon.",
  },
  {
    label: "Local et joignable",
    line: "Un artisan local : la personne qui tient votre site connaît votre caisse, votre carte et votre comptoir — et vous savez qui appeler.",
  },
  {
    label: "Le logiciel derrière",
    line: "La vitrine et les applications partagent votre identité. Le site reste sur mesure ; la commande et la fidélité s’activent selon votre besoin, avec leur propre back-office.",
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
  // « — pas par vendre » finissait la page sur une négation : la promesse
  // positive dit la même retenue — un regard d'abord, une demi-heure, et le
  // lecteur repart avec un avis clair (fondateur, 25/08).
  title: "On commence par regarder votre image — trente minutes, et vous saurez.",
  line: "Laissez votre numéro : on regarde ensemble votre image — fiche Google, réseaux, site — et on vous dit ce qu’on ferait, aux prix affichés ici. Vous choisirez service par service.",
  /**
   * La preuve, au moment de demander le numéro : le logiciel derrière
   * l'Atelier tourne en service réel — un FAIT du site (la frise des jalons
   * le date), jamais un chiffre inventé.
   */
  proof: "Class’Food est notre restaurant pilote. Chaque prestation, ses livrables et ses conditions sont précisés avant signature.",
} as const;
