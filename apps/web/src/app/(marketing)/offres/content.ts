/**
 * Copy de la page Offres (route `/offres`) — en français, comme tout le site.
 *
 * ═══ POURQUOI CE FICHIER EXISTE À CÔTÉ DE `components/marketing/content.ts` ═══
 *
 * La landing CONVAINC en onze sections ; cette page DÉTAILLE pour qui est déjà
 * convaincu et veut vérifier. Les deux surfaces n'ont donc pas le même texte, et
 * élargir `content.ts` de six sections de plus en ferait un fichier que personne
 * ne relit — c'est exactement ce qui a laissé « Expertise → #pourquoi » survivre
 * des semaines à son composant.
 *
 * ═══ MAIS PAS UN SEUL MONTANT NE NAÎT ICI ═══
 *
 * Chaque euro affiché sur cette page descend des constantes de la vitrine
 * (`PLAN_MONTHLY_CENTS`, `MODULE_MONTHLY_CENTS`, `MODULE_SETUP_CENTS`,
 * `yearlyCents`) ou d'un texte déjà écrit là-bas (`SERVICES`,
 * `HARDWARE_PATHS`). Une page de tarifs qui recopie une grille est une page qui
 * annoncera un jour un prix que la facture dément — et celle-ci est justement
 * la page qu'un prospect ouvre pour vérifier.
 *
 * ═══ LES RÈGLES DE FOND SONT CELLES DE LA VITRINE ═══
 *
 * Aucun client hors du pilote Class'Food, donc aucun résultat chiffré, aucun
 * témoignage, aucun compteur. Le tunnel s'arrête au CRÉNEAU DE RETRAIT : nous ne
 * fournissons aucun livreur, et la section `limites` l'écrit noir sur blanc au
 * lieu de le laisser deviner. Uber Eats et Deliveroo sont des atouts — elles
 * apportent des clients et portent les sacs — jamais des adversaires. Et
 * `ENGAGEMENT` s'affiche telle quelle, jamais reformulée.
 */

import {
  BILLING_CYCLES,
  HARDWARE_PATHS,
  MODULE_ADDON,
  MODULE_MONTHLY_CENTS,
  MODULE_SETUP_CENTS,
  PRICE_RANGE,
  SERVICES,
  euros,
  type Service,
} from "@/components/marketing/content";

/* ── Les six sections, et leur sommaire ──────────────────────── */

export type OffreSectionMeta = {
  /** Ancre réelle dans le DOM. Le sommaire de la page ne vise que celles-là. */
  id: string;
  /** Libellé court du sommaire — deux ou trois mots, pas le titre. */
  nav: string;
  /** Pastille au-dessus du titre. */
  badge: string;
  /** Le `h2` de la section. */
  title: string;
  /** La phrase sous le titre : ce que la section apporte, pas ce qu'elle est. */
  lead: string;
};

/**
 * L'ORDRE EST CELUI D'UNE VÉRIFICATION, PAS D'UNE PERSUASION.
 *
 * Le lecteur arrive ici convaincu ; il veut savoir ce qu'il achète, dans quel
 * ordre il paiera, et où sont les pièges. D'où : ce que contient une formule →
 * ce qui se vend à part → ce qu'on fait autour → ce qui est toujours compris →
 * ce qui ne l'est JAMAIS → à quoi il s'engage.
 *
 * ═══ LE PIÈGE QUE CETTE PAGE A LE DEVOIR D'ÉVITER ═══
 *
 * Un tableau comparatif de trois colonnes et vingt lignes est exactement ce qui
 * a été retiré de la landing (« trop chargé, trop d'informations, trop de trucs
 * en même temps »). Une page de détail a le DROIT d'être longue, elle n'a pas le
 * droit d'être indigeste : les six sections alternent délibérément de forme —
 * cartes, panneau à deux colonnes, rangées pleine largeur, liste cochée,
 * blocs d'avertissement, bande de texte. Deux grilles ne se suivent jamais.
 */
export const OFFRE_SECTIONS: readonly OffreSectionMeta[] = [
  {
    id: "formules",
    nav: "Les formules",
    badge: "Trois formules",
    title: "Ce que contient chaque formule, ligne par ligne.",
    lead: "La même liste de modules dans les trois colonnes, pastille pleine ou vide. Vous n'avez qu'une seule chose à chercher : où s'arrête la vôtre.",
  },
  {
    id: "module",
    nav: "Commande en ligne",
    badge: "Le module",
    title: "Commande en ligne & fidélité, en détail.",
    lead: "Vendu à part sur Essentiel et sur Complet, compris dans Boost. Voici exactement ce qu'il fait, et où il s'arrête.",
  },
  {
    id: "services",
    nav: "Les services",
    badge: "Autour du logiciel",
    title: "Un logiciel ne suffit pas. Voici le reste, et son prix.",
    lead: "Trois chantiers ponctuels, chiffrés ici plutôt qu'au téléphone : un service dont le prix se demande est un service qu'on ne demande pas.",
  },
  {
    id: "compris",
    nav: "Toujours compris",
    badge: "Dans les trois formules",
    title: "Ce que vous ne payez jamais en supplément.",
    lead: "Ni option, ni palier, ni ligne de facture qui apparaît au troisième mois. C'est dans l'abonnement ou dans la mise en route, quelle que soit la formule.",
  },
  {
    id: "limites",
    nav: "Ce qu'on ne fait pas",
    badge: "En toutes lettres",
    title: "Et ce que nous ne faisons pas.",
    lead: "Mieux vaut le lire ici, tranquillement, que le découvrir sur une facture ou un jour de service.",
  },
  {
    id: "conditions",
    nav: "Conditions",
    badge: "Conditions",
    title: "Engagement, année, mise en route.",
    lead: "Les conditions de l'abonnement, dans les termes exacts où elles sont écrites — nous ne les reformulons nulle part.",
  },
] as const;

/** Retrouve une section par son ancre, et LÈVE si l'ancre n'existe plus. */
export function offreSection(id: string): OffreSectionMeta {
  const found = OFFRE_SECTIONS.find((s) => s.id === id);
  if (!found) throw new Error(`Section inconnue de la page Offres : ${id}`);
  return found;
}

/**
 * LE SOMMAIRE INTERNE — et c'est le SEUL endroit du site où une ancre nue est
 * légitime.
 *
 * `#formules` écrit ici résout en `/offres#formules`, c'est-à-dire la page où
 * l'on est : le navigateur trouve l'élément et défile. La règle qui interdit les
 * ancres nues (`ancre()` dans `components/marketing/content.ts`) vise les
 * ancres de la LANDING citées depuis une autre route — `#tarifs` écrit ici
 * résoudrait en `/offres#tarifs` et ne ferait rien du tout, sans erreur ni 404.
 * Tout lien de cette page vers la vitrine passe donc par `ancre()`.
 *
 * Il est dérivé du tableau ci-dessus, jamais saisi : une deuxième liste de six
 * entrées finirait par désigner une section supprimée.
 */
export const SOMMAIRE: readonly { href: string; label: string }[] = OFFRE_SECTIONS.map((s) => ({
  href: `#${s.id}`,
  label: s.nav,
}));

/* ── En-tête de page ─────────────────────────────────────────── */

/**
 * LES TROIS FAITS DE L'EN-TÊTE, ET AUCUN N'EST « SANS ENGAGEMENT ».
 *
 * La clause ne s'écrit qu'EN ENTIER (`ENGAGEMENT`, forfait de mise en route
 * compris) ou elle ne s'écrit pas : « sans engagement » servi seul est le
 * demi-mensonge que le fondateur a tranché, et une pastille de trois mots ne
 * peut pas porter la phrase entière. Elle est donc affichée telle quelle dans la
 * section `conditions`, en bas de page, et nulle part ailleurs.
 *
 * La fourchette de prix est DÉRIVÉE (`PRICE_RANGE`) : c'est la même chaîne que
 * celle qui part chez Google sous le lien de la vitrine.
 */
export const OFFRE_HERO = {
  badge: "Offres",
  title: "Le détail de nos offres, prix compris.",
  lead: "Trois formules affichées, un module vendu à part, trois services chiffrés — et la liste de ce qui n'est pas compris. Vous n'aurez pas à nous appeler pour connaître un prix.",
  facts: ["Zéro commission sur vos ventes", PRICE_RANGE, "Deux mois offerts à l'année"] as const,
} as const;

/* ── 1. Les formules ─────────────────────────────────────────── */

/**
 * La pastille de l'annuel, LUE et non recopiée : le jour où l'on facturerait
 * onze mois au lieu de dix, `BILLING_CYCLES` suivrait et cette page aussi.
 *
 * L'accès lève si la pastille disparaît. C'est voulu : une page de tarifs qui
 * annonce en silence « » à la place de « 2 mois offerts » est pire qu'une page
 * qui ne se rend pas.
 */
const cycleAnnuel = BILLING_CYCLES.find((c) => c.id === "annuel");
if (!cycleAnnuel?.hint) {
  throw new Error("BILLING_CYCLES n'a plus de cycle annuel, ou plus de pastille : la page Offres ne peut pas l'afficher.");
}
export const ANNUEL_HINT: string = cycleAnnuel.hint;

/**
 * LA NOTE DE PIED DE CARTE — ce qu'il faut ajouter, ou ce qui est déjà là.
 *
 * C'est l'information que la grille de la landing ne peut pas porter (elle a
 * déjà onze lignes de modules par colonne) et c'est pourtant la première
 * question de quelqu'un qui compare Essentiel et Boost : « et la commande en
 * ligne, elle coûte combien en plus ? »
 *
 * La carte choisit sa note d'après ses MODULES (`plan.modules.includes("online")`)
 * et jamais d'après son identifiant : le jour où la commande en ligne
 * descendrait dans Complet, les notes suivraient sans qu'on rouvre ce fichier.
 */
export const PLAN_MODULE_NOTE = {
  inclus: `${MODULE_ADDON.name} comprise — abonnement et mise en service.`,
  supplement: `${MODULE_ADDON.name} en supplément : ${euros(MODULE_MONTHLY_CENTS)} par mois, plus ${euros(
    MODULE_SETUP_CENTS,
  )} de mise en service la première fois.`,
} as const;

/* ── 2. Le module Commande en ligne & fidélité ───────────────── */

export type ModulePoint = { title: string; line: string };

/**
 * CE QUE LE MODULE FAIT VRAIMENT — six points, et le dernier ferme la porte.
 *
 * Chaque point décrit une capacité DÉJÀ IMPLÉMENTÉE : le tunnel du panier au
 * créneau (`components/order/Checkout`), le paiement en ligne ou au retrait, le
 * configurateur partagé avec la caisse, la fidélité points et tampons, la page à
 * vos couleurs. Rien n'est promis ici qui ne tourne pas à Class'Food.
 *
 * LE CRÉNEAU DE RETRAIT EST UN POINT À PART ENTIÈRE, et c'est délibéré. Une page
 * qui détaille un module de commande en ligne sans dire où il s'arrête laisse le
 * lecteur supposer une livraison ; le supposer et le découvrir plus tard coûte
 * le client entier. On le dit à l'endroit exact où la question se pose.
 */
export const MODULE_POINTS: readonly ModulePoint[] = [
  {
    title: "Click and collect",
    line: "Votre client compose sa commande sur votre page, la règle, et choisit son créneau. Le ticket part droit en cuisine, déjà encaissé — la caisse ne fait que remettre le sac.",
  },
  {
    title: "Le créneau de retrait, et pas un mètre de plus",
    line: "Le tunnel s'arrête là : le client vient chercher sa commande. Nous ne fournissons aucun livreur, et rien dans la page ne le laisse croire.",
  },
  {
    title: "Paiement en ligne ou au retrait",
    line: "Carte bancaire au moment de la commande, ou règlement au comptoir : c'est vous qui décidez ce que la page propose.",
  },
  {
    title: "Points de fidélité, tampons et codes promo",
    line: "Les points se cumulent tout seuls à chaque commande. Un habitué qui commande en direct paie le prix affiché en salle — pas celui qu'il faut gonfler pour absorber une commission.",
  },
  {
    title: "Le configurateur de la caisse, à l'identique",
    line: "Le même tacos se compose de la même façon en ligne et au comptoir, avec les mêmes suppléments et le même passage en menu. Aucun écart entre ce qui est commandé et ce qui est préparé.",
  },
  {
    title: "À vos couleurs, ou collée sur le site que vous avez déjà",
    line: "Votre page sur votre nom de domaine si vous en avez un — sinon, une balise que nous posons pour vous sur votre site actuel. Vos clients ne quittent pas votre enseigne.",
  },
];

/* ── 3. Les services ─────────────────────────────────────────── */

export type OffreService = {
  id: string;
  title: string;
  /** L'accroche : ce que le service PRODUIT, en une phrase. */
  lead: string;
  /** Le détail — c'est ici que l'avantage se justifie. */
  line: string;
  /** Le montant, seul. Toujours renseigné : jamais « sur demande ». */
  price: string;
  /** La condition sous le montant — devis, unicité, cas à zéro euro. */
  priceNote?: string;
};

/** Retrouve un service de la vitrine par son `id`, et lève s'il a disparu. */
function service(id: string): Service {
  const found = SERVICES.find((s) => s.id === id);
  if (!found) throw new Error(`Service inconnu dans SERVICES : ${id}`);
  return found;
}

/** Retrouve une voie matérielle par son `id` — jamais par son rang. */
function hardwarePath(id: (typeof HARDWARE_PATHS)[number]["id"]) {
  const found = HARDWARE_PATHS.find((p) => p.id === id);
  if (!found) throw new Error(`Voie matérielle inconnue dans HARDWARE_PATHS : ${id}`);
  return found;
}

const installe = hardwarePath("nous");
const equipeDeja = hardwarePath("vous");

/**
 * TROIS RANGÉES, ET DEUX D'ENTRE ELLES SONT RECOPIÉES DE LA VITRINE — au sens
 * strict : c'est le MÊME objet, lu, pas un texte réécrit.
 *
 * La landing vend les mêmes services en section « Nos services + » ; deux
 * descriptions parallèles d'un même service finiraient par se contredire, et
 * c'est la contradiction qu'un prospect attrape en ouvrant les deux pages côte à
 * côte. On lit donc `SERVICES` et on n'y ajoute que ce que cette page apporte.
 *
 * Le module « Commande en ligne & fidélité » est EXCLU de cette liste alors
 * qu'il est dans `SERVICES` : il a sa section entière juste au-dessus. Le dire
 * deux fois sur la même page, c'est le vendre deux fois.
 *
 * L'INSTALLATION, elle, n'existe pas dans `SERVICES` — elle vit dans
 * `HARDWARE_PATHS`, en section matériel de la landing, où c'est une VOIE et non
 * un service. Elle est ici parce que le lecteur qui compare des prix la cherche
 * dans la liste des prix, pas dans une section sur les tablettes ; et sa
 * condition rappelle l'autre voie, celle qui ne coûte rien.
 */
export const OFFRE_SERVICES: readonly OffreService[] = [
  {
    id: "google",
    title: service("google").title,
    lead: service("google").lead,
    line: service("google").line,
    price: service("google").price,
  },
  {
    id: "identite",
    title: service("identite").title,
    lead: service("identite").lead,
    line: service("identite").line,
    price: service("identite").price,
    priceNote: service("identite").priceNote,
  },
  {
    id: "installation",
    title: "L'installation du matériel",
    lead: "On fournit, on configure, on pose. Vous ouvrez le lendemain.",
    line: installe.line,
    price: installe.price,
    // La voie à zéro euro est rappelée SOUS le montant, jamais à côté : posée à
    // la même hauteur, elle ferait lire deux tarifs pour un seul chantier.
    priceNote: `Ou ${equipeDeja.price} si vous avez déjà vos tablettes`,
  },
];

/* ── 4. Ce qui est toujours compris ──────────────────────────── */

/**
 * NEUF LIGNES, ET PAS UNE QUI NE SOIT DÉJÀ TENUE.
 *
 * Chacune reprend un engagement écrit ailleurs sur le site — jalons de
 * lancement, réponses de la FAQ, mode hors-ligne de la section matériel,
 * appairage de la caisse, tableau des commissions. Cette section ne PROMET rien
 * de neuf : elle rassemble en un endroit ce qu'un lecteur devrait autrement
 * aller chercher dans cinq sections de la landing.
 *
 * La distinction abonnement / mise en route est portée par le texte lui-même
 * (« compris dans la mise en route ») : la gommer ferait de « toujours
 * compris » un raccourci que la première facture démentirait.
 */
export const TOUJOURS_COMPRIS: readonly string[] = [
  "Les mises à jour, le support et les corrections",
  "Vos données exportables quand vous voulez, en CSV — ventes, clients, menus",
  "L'hébergement, en Europe",
  "Le mode hors-ligne : la caisse et la cuisine continuent en local si le réseau tombe",
  "La configuration — menu, équipe, couleurs, moyens de paiement, imprimante — faite par nous",
  "Le premier service avec nous, midi et soir, dans votre cuisine",
  // « compris » et non « comprise » : l'accord se fait sur « votre lien », pas
  // sur « votre fiche » qui n'est que le complément le plus proche. La faute
  // venait de là, et elle se lisait à l'écran.
  "Votre lien de commande ajouté sur votre fiche Google, compris dans la mise en route",
  "Zéro commission sur vos ventes, quel que soit le volume",
  "L'appairage des tablettes par code à six caractères, révocable à tout moment",
];

/* ── 5. Ce qui n'est pas compris ─────────────────────────────── */

export type Limite = { title: string; line: string };

/**
 * ═══ LA SECTION QUI VEND LE MIEUX, ET C'EST CELLE QUI DIT NON ═══
 *
 * Quatre choses que nous ne faisons pas, écrites par nous, à la page où le
 * lecteur décide. Chacune serait autrement découverte au pire moment : le
 * livreur qui n'existe pas un soir de rush, les 1,5 % sur le premier relevé, un
 * devis d'identité visuelle qu'on croyait compris dans l'abonnement.
 *
 * LE TON N'EST PAS UNE EXCUSE. Nous n'attaquons pas les plateformes — elles
 * apportent des clients que le restaurateur n'aurait pas eus et elles portent
 * les sacs. La division du travail est écrite comme telle : elles acquièrent,
 * le canal direct fidélise.
 */
export const LIMITES: readonly Limite[] = [
  {
    title: "Nous ne livrons pas.",
    line: "Le tunnel de commande s'arrête au créneau de retrait, et nous n'avons jamais eu l'intention d'aller plus loin. Vos tournées restent les vôtres, avec vos horaires ; et Uber Eats et Deliveroo continuent de porter les sacs et de vous apporter des clients que vous n'auriez pas eus.",
  },
  {
    // LE TAUX N'EST PAS ÉCRIT ICI. Il vit dans `PRICING_FOOTNOTE`, affichée
    // telle quelle sous cette liste : un pourcentage recopié dans une prose de
    // plus, c'est un pourcentage de plus à corriger le jour où il bouge — et
    // celui-là, nous ne le fixons même pas.
    title: "Les frais d'encaissement carte ne nous reviennent pas.",
    line: "Ils sont prélevés par votre prestataire de paiement sur chaque transaction, et vous les régleriez avec n'importe quelle solution de paiement en ligne. Nous ne touchons rien dessus, et nous ne fixons pas le taux : il dépend de votre prestataire et de la carte présentée.",
  },
  {
    title: "L'identité visuelle et l'installation ne sont dans aucune formule.",
    line: "Ce sont deux chantiers ponctuels, chiffrés au devis et facturés une fois. Vous pouvez très bien ouvrir sans l'un ni l'autre : zéro euro si vous avez déjà vos tablettes, zéro euro si votre enseigne vous convient.",
  },
  {
    title: "Nous ne vendons pas de matériel propriétaire.",
    line: "Une tablette Android ou un iPad, une imprimante ticket 80 mm en réseau, une box internet — de la fibre n'est même pas nécessaire. Vous achetez où vous voulez, ou nous vous équipons ; dans les deux cas le matériel est à vous.",
  },
];

/* ── 7. L'appel de pied de page ──────────────────────────────── */

/**
 * LE SEUL POINT DE CONVERSION DE LA PAGE, ET IL RENVOIE À LA LANDING.
 *
 * Le formulaire de rappel vit en section 11 de la vitrine, avec sa logique et
 * son back-end. En reconstruire un ici, ce serait deux formulaires à maintenir
 * pour un seul rappel — et le jour où l'un des deux cesserait d'envoyer, rien ne
 * le signalerait.
 */
export const OFFRE_CTA = {
  title: "Il reste une question ? Elle se règle en trente minutes.",
  line: "On regarde votre carte, vos services et votre organisation actuelle, et vous repartez avec vos chiffres. Chez vous ou en visio.",
} as const;
