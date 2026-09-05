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
 * ═══ LA PAGE A CESSÉ DE S'EXCUSER — RÉVISION DU 21/08/2026 ═══
 *
 * Elle portait une section entière intitulée « Et ce que nous ne faisons pas. »,
 * quatre blocs commençant tous par une négation, posés juste avant le seul point
 * de conversion. Verdict du fondateur : « tu en dis trop, tu veux trop faire
 * honnête au dépend du marketing et de la vente ». La section est supprimée, et
 * ses quatre entrées redistribuées une par une :
 *
 *  1. « Nous ne livrons pas » — DOUBLON. `MODULE_POINTS[1]` dit déjà la même
 *     chose, au futur et sans aveu. La version de la section portait en outre
 *     un ÉNONCÉ FAUX qui avait survécu à la correction de fond (« nous n'avons
 *     jamais eu l'intention d'aller plus loin ») : la gestion des livraisons EST
 *     au programme pour les restaurateurs qui ont déjà leur livreur. Les deux
 *     phrases se contredisaient sur la même page. Supprimer la section supprime
 *     le dernier exemplaire du mensonge.
 *  2. « Les frais d'encaissement carte » — DOUBLON de `PRICING_FOOTNOTE`, qui
 *     n'était rendue nulle part ailleurs sur cette page. Elle REMONTE donc sous
 *     la grille de prix, à l'endroit exact où la question se pose. La prose,
 *     elle, disparaît.
 *  3. « L'identité visuelle et l'installation ne sont dans aucune formule » —
 *     DOUBLON des deux rangées de la section services, qui affichent déjà leurs
 *     montants. Il en reste une demi-phrase, dans l'accroche de `services`.
 *  4. « Nous ne vendons pas de matériel propriétaire » — CE N'EST PAS UNE
 *     LIMITE, c'est l'argument le plus fort de la page : Innovorder impose du
 *     matériel propriétaire à quatre chiffres, nous une tablette du commerce.
 *     Elle devient `MATERIEL`, une bande pleine largeur avec son chiffre en or.
 *
 * Ce qui mérite d'être dit se dit UNE FOIS, à l'endroit où la question se pose.
 * Aucun fait vrai n'est tombé — les frais carte restent, les prix restent — mais
 * plus rien n'est répété, et rien n'a de section à soi pour dire non.
 *
 * ═══ LES RÈGLES DE FOND SONT CELLES DE LA VITRINE ═══
 *
 * Aucun client hors du pilote Class'Food, donc aucun résultat chiffré, aucun
 * témoignage, aucun compteur. Uber Eats et Deliveroo sont des atouts — elles
 * apportent des clients et portent les sacs — jamais des adversaires. Et
 * `ENGAGEMENT` s'affiche telle quelle, jamais reformulée.
 */

import {
  ATELIER_CENTS,
  ATELIER_SERVICES,
  BILLING_CYCLES,
  HARDWARE_PATHS,
  MODULE_ADDON,
  MODULE_MONTHLY_CENTS,
  MODULE_SETUP_CENTS,
  PRICE_RANGE,
  SERVICES,
  euros,
  type Service,
  type Shot,
} from "@/components/marketing/content";

/* ── Les sept sections, et leur sommaire ─────────────────────── */

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
 * Le lecteur arrive ici convaincu ; il veut savoir ce qu'il achète et dans quel
 * ordre il paiera. D'où : ce que contient une formule → ce qui se vend à part →
 * ce que le matériel ne coûte pas → ce qu'on fait autour → ce qui est toujours
 * compris → à quoi il s'engage.
 *
 * ═══ LE PIÈGE QUE CETTE PAGE A LE DEVOIR D'ÉVITER ═══
 *
 * Un tableau comparatif de trois colonnes et vingt lignes est exactement ce qui
 * a été retiré de la landing (« trop chargé, trop d'informations, trop de trucs
 * en même temps »). Une page de détail a le DROIT d'être longue, elle n'a pas le
 * droit d'être plate : les six sections alternent délibérément de GABARIT, et
 * pas seulement de contenu — bande photographique pleine largeur, grille de
 * cartes contenue, panneau débordant à droite, bande en diptyque, rangées de
 * devis, bande sur capture voilée, colonne étroite sans un cadre. Deux blocs de
 * même forme ne se suivent jamais, et cette fois la mesure le confirme.
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
    id: "atelier",
    nav: "L’Atelier",
    badge: "L’Atelier",
    title: "L’Atelier : le site, Google, les réseaux — et leurs prix.",
    // La bande RÉSUME, la page `/atelier` détaille : même partage de travail
    // qu'entre la landing et cette page. Les mensuels ne s'annoncent jamais
    // « sans engagement » tout court — la leçon de la constante `ENGAGEMENT`.
    lead: "Nos services d’agence, résumés ici avec leurs montants — les mensuels sans engagement, résiliables à tout moment. La maquette de votre site est montrée avant tout engagement : le détail est sur la page de l’Atelier.",
  },
  {
    id: "module",
    nav: "Commande en ligne",
    badge: "Le module",
    title: "Commande en ligne & fidélité, en détail.",
    // « et où il s'arrête » est tombé : `MODULE_POINTS[1]` porte déjà la borne,
    // au futur et tourné vers l'avant. L'annoncer en plus dans l'accroche, c'est
    // prévenir deux fois d'un mur qu'on est en train de démonter.
    lead: "Disponible seul avec son back-office, en complément d’Essentiel ou Complet, et compris dans Boost. La livraison est une option séparée.",
  },
  {
    id: "materiel",
    nav: "Le matériel",
    badge: "Aucun matériel imposé",
    title: "Le matériel est à vous.",
    lead: "Rien de propriétaire, rien de loué. Vous l'achetez où vous voulez, ou nous vous équipons — dans les deux cas, il est à vous.",
  },
  {
    id: "services",
    nav: "Les services",
    badge: "Autour du logiciel",
    title: "Le logiciel, et tout ce qui l’entoure. Chiffré ici.",
    // La demi-phrase qui reste de l'ancienne entrée 3 des limites : ces deux
    // chantiers sont ponctuels et dans aucune formule. Dit ici, à côté de leurs
    // montants, il n'y a plus besoin d'un bloc entier pour le dire ailleurs.
    lead: "Trois chantiers ponctuels, facturés une fois, en supplément de votre formule — et chiffrés ici plutôt qu'au téléphone : un service dont le prix se demande est un service qu'on ne demande pas.",
  },
  {
    id: "compris",
    nav: "Toujours compris",
    badge: "Dans les trois formules",
    title: "Déjà compris dans votre formule.",
    lead: "Neuf choses comprises dans les trois formules, du premier mois au dernier. Votre facture porte une seule ligne : la vôtre.",
  },
  {
    id: "conditions",
    nav: "Conditions",
    badge: "Conditions",
    title: "Engagement, année, mise en route.",
    lead: "Les voici, dans les termes exacts où elles vous engagent.",
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
 * Il est dérivé du tableau ci-dessus, jamais saisi : c'est ce qui lui a fait
 * perdre tout seul son entrée « Ce qu'on ne fait pas » le jour où la section a
 * disparu, et gagner tout seul « Le matériel » le jour où la bande est née.
 */
export const SOMMAIRE: readonly { href: string; label: string }[] = OFFRE_SECTIONS.map((s) => ({
  href: `#${s.id}`,
  label: s.nav,
}));

/* ── Les images de la page ───────────────────────────────────── */

/**
 * ═══ CINQ IMAGES, ET C'EST TOUT LE SUJET DE LA REFONTE VISUELLE ═══
 *
 * La page n'en portait AUCUNE. Zéro `<img>` dans `<main>`, sur sept écrans et
 * demi de haut, quand la landing en affiche treize — et huit sections calées sur
 * la même largeur de 1 200 px, sans un seul fond perdu. « C'est vraiment fade,
 * ça manque de couleur, de largeur » : la mesure donnait raison au fondateur au
 * pixel près.
 *
 * La réponse n'est PAS d'ajouter des couleurs. La charte est sombre, dorée
 * (#c9a15a), sobre, et elle tient la caisse, la cuisine, le back-office et les
 * écrans de salle : une page d'offres bariolée ne serait pas plus vivante, elle
 * serait étrangère. La richesse vient de la PHOTOGRAPHIE à fond perdu, du
 * contraste d'échelle et de la largeur.
 *
 * ═══ CHAQUE FICHIER EXISTE, ET IL A ÉTÉ OUVERT ═══
 *
 * Sept chemins sur huit pointaient dans le vide sur ce projet sans que personne
 * le voie — `Photo` replie proprement, donc une image absente ne casse rien et
 * ne se signale pas non plus. Les cinq ci-dessous ont été vérifiés au `ls` dans
 * `public/photos/` et `public/shots/`, et choisis sur leurs pixels :
 *
 *  · `tacos-hero` (1086×1448, opaque, coins déjà noirs) — la seule photo
 *    d'ambiance cinématographique du dépôt. Sous voile, le raccord au fond noir
 *    de la page se fait sans couture.
 *  · `commande-tunnel.webp` (780×763) — la SEULE capture du dépôt taillée pour
 *    ce panneau. Affichée vers 520 px de large, donc SOUS sa définition native :
 *    plus nette que la source.
 *
 *    RECADRÉE UNE SECONDE FOIS, et pour une raison qu'aucun audit de texte ne
 *    pouvait trouver : elle portait en clair, dans le fichier, « prêt en
 *    ~20 min » — une promesse de délai chiffrée, que cette page s'interdit —
 *    ainsi que les horaires et « 14 rue des Halles — 76000 Rouen ». Une adresse
 *    postale lisible à côté d'un argumentaire se lit comme un client en
 *    exploitation, et la règle « aucun client hors du pilote » ne vise pas que
 *    les noms. Les 595 px du bloc d'en-tête sont sortis DU FICHIER : ce qui n'y
 *    est plus ne peut pas revenir le jour où quelqu'un touche au CSS.
 *
 *    ═══ ET C'EST UN RECADRAGE, PAS LE FICHIER D'ORIGINE ═══
 *
 *    `shots/commande.png` porte en tête la fiche d'un restaurant de
 *    démonstration — son enseigne, sa ville, et SA NOTE : « ★★★★★ 4,8 (128) ».
 *    Affichée à 520 px de large, à plat, à côté d'un argumentaire de vente, elle
 *    se lit comme une note client. Nous n'avons aucun client hors du pilote
 *    Class'Food : ni résultat chiffré, ni témoignage, ni note. C'est la règle
 *    qui a déjà fait tomber cinq énoncés de ce site, et une capture ne s'en
 *    exempte pas sous prétexte que le chiffre est dessiné plutôt qu'écrit.
 *
 *    Un voile CSS posé sur le haut de l'image l'aurait masquée sur UN gabarit et
 *    la rendrait sur les autres : la position de la note dans le cadre dépend du
 *    recadrage `cover`, donc de la hauteur de la colonne de texte à côté, donc
 *    de la largeur de l'écran. Elle réapparaissait telle quelle sous 1 024 px.
 *    Les 330 premiers pixels sont donc retirés DU FICHIER : l'enseigne, le
 *    bandeau d'ouverture et la note n'existent plus dans l'image, à aucune
 *    largeur. Ce qui reste est le tunnel lui-même, c'est-à-dire ce que la
 *    section vend.
 *  · `crousty-riz` (1254×1254, opaque, bois sombre) — tient la moitié droite
 *    d'un écran de 1 920 px sans agrandissement.
 *
 * ═══ ET LES DEUX PHOTOS SONT SERVIES EN WEBP, PAS EN PNG ═══
 *
 * `Photo` sert un `<img>` natif depuis `public/`, sans optimiseur au runtime :
 * le poids du fichier est donc CELUI QUI PART SUR LE RÉSEAU. Les deux PNG
 * pèsent 2 451 Ko et 2 312 Ko, et celui du haut de page est chargé en `eager`
 * avec `fetchPriority="high"` — c'est le LCP de la route. Une page qui n'avait
 * aucune image serait passée d'un coup à 4,7 Mo de photographies décoratives
 * pour un titre et un prix.
 *
 * Les dérivés WebP (qualité 82, mêmes dimensions au pixel : 1086×1448 et
 * 1254×1254) pèsent 225 Ko et 177 Ko — 4,4 Mo de moins. Sur deux photos posées
 * sous un voile de 60 à 90 %, l'écart de compression est invisible ; le PNG
 * d'origine reste dans `public/photos/` pour qui voudrait un autre cadrage.
 * Les trois CAPTURES restent en PNG : elles pèsent 0,3 à 0,6 Mo, et une capture
 * d'interface est justement le cas où le sans-perte se voit.
 *  · `menu.png` (2880×1800) — la capture la plus CALME du dépôt (lignes de
 *    produits régulières). C'est la seule qui supporte d'être réduite à une
 *    texture de fond sans devenir du bruit.
 *  · `board.png` (2560×1440) — l'écran de salle est déjà une composition noire
 *    et dorée pleine largeur. Elle ferme la page sur le produit.
 *
 * ═══ QUATRE SUR CINQ SONT DÉCORATIVES, ET C'EST UNE DÉCISION ═══
 *
 * `decorative` pose `alt=""` ET `aria-hidden`. Sans ça, un lecteur d'écran
 * énumère des plats entre deux paragraphes de tarifs : la photo d'ambiance
 * n'apporte RIEN à qui ne la voit pas, et son texte alternatif ne fait
 * qu'allonger le trajet vers le prix.
 *
 * `commande.png` fait exception : ce n'est pas une illustration, c'est la
 * capture de ce qu'on vend dans la section qui la vend. Elle porte donc un vrai
 * texte alternatif.
 */
export const OFFRE_SHOTS = {
  hero: { src: "/photos/tacos-hero.webp", alt: "" },
  module: {
    src: "/shots/commande-tunnel.webp",
    alt: "La page de commande en ligne d'un restaurant sur téléphone : les plats mis en avant, leurs photos et leurs prix, la recherche et les rayons de la carte.",
    // Pas de `portrait: true` : ce drapeau ne sert qu'au deck 3D du hero de la
    // landing (`hd-portrait`), et un indicateur qui ne pilote rien ici finirait
    // par faire croire qu'il pilote quelque chose.
  },
  materiel: { src: "/photos/crousty-riz.webp", alt: "" },
  compris: { src: "/shots/menu.png", alt: "" },
  cta: { src: "/shots/board.png", alt: "" },
} satisfies Record<string, Shot>;

/* ── En-tête de page ─────────────────────────────────────────── */

/**
 * L'EN-TÊTE EST DEVENU UNE BANDE, ET LE PREMIER CHIFFRE DE LA PAGE EST DORÉ.
 *
 * Il tenait dans une colonne de texte : badge, titre, accroche, trois pastilles
 * de faits, sommaire. Aucune image, une seule voix typographique, et la
 * fourchette de prix rangée dans une pastille de treize pixels et demi au milieu
 * de deux autres. La page dépensait son accent en confettis (34 de ses 50
 * occurrences dorées mesuraient moins de 20 px de côté) et n'en gardait pas un
 * gramme pour les montants.
 *
 * `PRICE_RANGE` se pose donc SEULE, très grande, en or, sur la photo — c'est le
 * premier chiffre qu'on lit et le premier doré franc de la page. Elle reste
 * DÉRIVÉE : c'est la même chaîne que celle qui part chez Google sous le lien de
 * la vitrine, et la même que la description de `page.tsx`.
 *
 * LES TROIS PASTILLES DE FAITS SONT TOMBÉES. L'une portait `PRICE_RANGE`, que
 * le grand chiffre dit mieux ; les deux autres deviennent `claim`, une ligne
 * unique sous le montant. Deux rangées de pastilles (les faits, puis le
 * sommaire) faisaient de l'ouverture de la page une collection de gélules.
 *
 * ET TOUJOURS PAS UN MOT SUR L'ENGAGEMENT. La clause ne s'écrit qu'EN ENTIER
 * (`ENGAGEMENT`, forfait de mise en route compris) ou elle ne s'écrit pas :
 * « sans engagement » servi seul est le demi-mensonge que le fondateur a
 * tranché, et une pastille de trois mots ne peut pas porter la phrase entière.
 */
export const OFFRE_HERO = {
  badge: "Offres",
  title: "Le détail de nos offres, prix compris.",
  // « — et la liste de ce qui n'est pas compris » est tombé avec la section
  // qu'il annonçait. Une page qui ouvre en promettant l'inventaire de ses refus
  // se vend contre elle-même dès la deuxième phrase.
  lead: "Trois suites pour piloter le restaurant, des applications à la carte et des sites vitrines sur mesure. Le périmètre, les frais et la disponibilité sont précisés pour chaque offre.",
  price: PRICE_RANGE,
  claim: "Zéro commission sur vos ventes. Deux mois offerts à l'année.",
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

/* ── 1 bis. L'Atelier — la bande compacte ────────────────────── */

/** Retrouve un service de l'Atelier par son `id`, et lève s'il a disparu. */
function atelierService(id: string): Service {
  const found = ATELIER_SERVICES.find((s) => s.id === id);
  if (!found) throw new Error(`Service inconnu dans ATELIER_SERVICES : ${id}`);
  return found;
}

/**
 * LA BANDE NE RÉÉCRIT RIEN : les intitulés et les accroches sont LUS dans
 * `ATELIER_SERVICES`, et chaque montant recomposé depuis `ATELIER_CENTS` — la
 * périodicité collée au chiffre, parce qu'une bande compacte n'a pas la
 * colonne de conditions de la page de l'Atelier. Deux lignes réécrivent leur
 * note, et seulement parce que leur prix est double : les réseaux (deux
 * cadences) et l'intégration (un abonnement plus un forfait) — les montants,
 * eux, descendent toujours des mêmes constantes.
 */
export type AtelierStripRow = {
  id: string;
  /** L'intitulé du service — lu dans `ATELIER_SERVICES`. */
  who: string;
  /** Le montant et sa périodicité, en un souffle — « 690 € une fois ». */
  rate: string;
  /** Ce que le service produit, en une ligne. */
  note: string;
};

export const ATELIER_STRIP: readonly AtelierStripRow[] = [
  {
    id: "site",
    who: atelierService("site").title,
    rate: `dès ${euros(ATELIER_CENTS.site)} une fois, sur devis`,
    note: atelierService("site").lead,
  },
  {
    id: "refonte",
    who: atelierService("refonte").title,
    rate: `dès ${euros(ATELIER_CENTS.refonte)} une fois, sur devis`,
    note: atelierService("refonte").lead,
  },
  {
    id: "identite",
    who: atelierService("identite").title,
    rate: `${euros(ATELIER_CENTS.identite)} une fois`,
    note: atelierService("identite").lead,
  },
  {
    id: "presence",
    who: atelierService("presence").title,
    rate: `${euros(ATELIER_CENTS.presence)} / mois`,
    note: atelierService("presence").lead,
  },
  {
    id: "reseaux",
    who: atelierService("reseaux").title,
    rate: `dès ${euros(ATELIER_CENTS.social1)} / mois`,
    note: `1 publication par semaine — ${euros(ATELIER_CENTS.social2)} / mois pour 2. Le calendrier est validé par vous.`,
  },
  {
    id: "integration",
    who: atelierService("integration").title,
    rate: `${euros(MODULE_MONTHLY_CENTS)} / mois`,
    note: `${atelierService("integration").lead} Plus ${euros(ATELIER_CENTS.integration)} d’intégration, une fois.`,
  },
];

/* ── 2. Le module Commande en ligne & fidélité ───────────────── */

export type ModulePoint = { title: string; line: string };

/**
 * CE QUE LE MODULE FAIT VRAIMENT — six points, et le deuxième ouvre une porte.
 *
 * Chaque point décrit une capacité DÉJÀ IMPLÉMENTÉE : le tunnel du panier au
 * créneau (`components/order/Checkout`), le paiement en ligne ou au retrait, le
 * configurateur partagé avec la caisse, la fidélité points et tampons, la page à
 * vos couleurs. Rien n'est promis ici qui ne tourne pas à Class'Food.
 *
 * LA LIVRAISON SE DIT UNE FOIS, AU FUTUR, ET JAMAIS COMME UN AVEU.
 *
 * Ce point s'intitulait « Le créneau de retrait, et pas un mètre de plus » et
 * ajoutait « nous n'avons jamais eu l'intention d'aller plus loin ». Deux
 * défauts, et le second est le plus grave.
 *
 * Le premier est de ton : une page qui vend n'a pas à énumérer ses murs. Dire
 * où le tunnel s'arrête est légitime ; le dire quatre fois, avec un titre qui
 * commence par une négation, transforme une limite en aveu et un argumentaire
 * en autocritique.
 *
 * Le second est de FOND : la phrase était fausse. La gestion des livraisons EST
 * au programme, pour les restaurateurs qui ont déjà leur livreur — nous leur
 * fournirons l'outil, jamais les gens. Écrire qu'on n'a « jamais eu
 * l'intention » d'y aller, c'est fermer devant un prospect une porte qu'on est
 * en train d'ouvrir.
 *
 * D'où un point tourné vers l'avant. Le futur est assumé (« arrive »), rien
 * n'est daté — un délai qu'on ne tient pas coûte plus cher qu'un délai qu'on ne
 * donne pas. Et c'est désormais le SEUL endroit de la page qui en parle : le
 * jumeau qui vivait dans la section « limites », lui, disait encore le
 * contraire.
 */
export const MODULE_POINTS: readonly ModulePoint[] = [
  {
    title: "Click and collect",
    line: "Votre client compose sa commande et choisit son créneau. Le back-office inclus reçoit la commande et permet de la traiter, même sans notre caisse. Le paiement suit les moyens activés.",
  },
  {
    title: "Livraison par votre restaurant — validation pilote",
    line: "Une offre séparée est prévue pour vos zones et tarifs de livraison. L’activation attend la validation du parcours pilote ; votre restaurant assure les livraisons. Aucun coursier tiers n’est fourni.",
  },
  {
    title: "Paiement en ligne ou au retrait",
    line: "Carte bancaire au moment de la commande, ou règlement au comptoir : c'est vous qui décidez ce que la page propose.",
  },
  {
    title: "Points de fidélité, tampons et codes promo",
    line: "Le programme fidélité est inclus avec le click & collect. Vous définissez points ou tampons et récompenses ; l’attribution suit les parcours activés pour votre établissement.",
  },
  {
    title: "Le configurateur de la caisse, à l'identique",
    line: "Le même tacos se compose de la même façon en ligne et au comptoir, avec les mêmes suppléments et le même passage en menu. Aucun écart entre ce qui est commandé et ce qui est préparé.",
  },
  {
    title: "À vos couleurs, ou collée sur le site que vous avez déjà",
    line: "Votre vitrine sur mesure ou existante dirige ses boutons Commander vers votre page personnalisée. Nous pouvons rattacher un sous-domaine de commande ; votre back-office en gère la carte et l’identité.",
  },
];

/* ── 3. Le matériel ──────────────────────────────────────────── */

/** Retrouve une voie matérielle par son `id` — jamais par son rang. */
function hardwarePath(id: (typeof HARDWARE_PATHS)[number]["id"]) {
  const found = HARDWARE_PATHS.find((p) => p.id === id);
  if (!found) throw new Error(`Voie matérielle inconnue dans HARDWARE_PATHS : ${id}`);
  return found;
}

const installe = hardwarePath("nous");
const equipeDeja = hardwarePath("vous");

/**
 * ═══ L'ARGUMENT QUI SE CACHAIT DANS UNE SECTION INTITULÉE « CE QUE NOUS NE
 * FAISONS PAS » ═══
 *
 * « Nous ne vendons pas de matériel propriétaire » était rangée quatrième d'un
 * inventaire de refus, entre les frais bancaires et le devis d'identité
 * visuelle. C'est pourtant l'écart le plus brutal de tout le marché français :
 * la concurrence installée impose ses bornes et ses caisses propriétaires à
 * quatre chiffres, et un restaurateur qui change de logiciel doit tout racheter.
 * Nous, une tablette du commerce.
 *
 * Elle devient donc une BANDE PLEINE LARGEUR à elle seule, en diptyque avec une
 * photo à fond perdu, placée juste AVANT la section services — pour que le
 * lecteur arrive sur les prix d'installation en sachant déjà que le matériel ne
 * lui est ni loué ni imposé.
 *
 * LES DEUX MONTANTS SONT LUS DANS `HARDWARE_PATHS`, jamais écrits : le zéro
 * comme le « à partir de ». Le zéro est l'unique chiffre doré de la bande, et il
 * est énorme — c'est le seul endroit de la page où un « 0 € » vend.
 */
export const MATERIEL = {
  // L'ACCROCHE POSE LA PROMESSE, LA LIGNE DONNE LA LISTE DE COURSES. La première
  // version répétait mot pour mot l'accroche deux lignes plus bas — « une
  // tablette, une imprimante ticket, votre box », puis « rien à rendre » deux
  // fois. Sur une bande de quatre paragraphes, c'est la moitié du texte qui se
  // dit deux fois : exactement le défaut que cette révision existe pour corriger.
  line: "Une tablette Android ou un iPad, une imprimante ticket 80 mm en réseau, votre box internet : la fibre n'est même pas nécessaire. Aucune borne à quatre chiffres, aucun terminal verrouillé, et le jour où vous changez d'avis, tout reste chez vous.",
  /** « 0 € », lu dans la voie « vous avez déjà le matériel ». */
  zero: equipeDeja.price,
  zeroNote: "à racheter si vous avez déjà vos tablettes.",
  // LE MONTANT DE L'INSTALLATION N'EST PAS RÉPÉTÉ ICI. Il est écrit une fois, en
  // section services, à cinq cents pixels de là, dans la rangée qui le détaille —
  // et « À partir de 290 € » recopié au milieu d'une phrase y mettait en plus une
  // capitale que la grammaire n'appelle pas.
  installNote: "Vous préférez qu'on vous équipe et qu'on pose ? C'est un service à part, chiffré juste en dessous.",
} as const;

/* ── 4. Les services ─────────────────────────────────────────── */

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
  /**
   * Le « montant » n'est pas un chiffre (« Compris dans la mise en route ») :
   * la rangée l'affiche discret et blanc, pas doré — le dorer ferait lire les
   * rangées comme autant de dépenses. Porté par la DONNÉE et plus par le rang :
   * la page de l'Atelier réutilise ces rangées, et sa première a un vrai prix.
   */
  compris?: boolean;
};

/** Retrouve un service de la vitrine par son `id`, et lève s'il a disparu. */
function service(id: string): Service {
  const found = SERVICES.find((s) => s.id === id);
  if (!found) throw new Error(`Service inconnu dans SERVICES : ${id}`);
  return found;
}

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
 * qu'il est dans `SERVICES` : il a sa section entière deux blocs plus haut. Le
 * dire deux fois sur la même page, c'est le vendre deux fois.
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
    priceNote: "Service mensuel distinct ; l'ajout du lien de commande lors de la mise en route reste inclus.",
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
    lead: "On vérifie la compatibilité, on configure et on teste avant votre lancement.",
    line: installe.line,
    price: installe.price,
    // La voie à zéro euro est rappelée SOUS le montant, jamais à côté : posée à
    // la même hauteur, elle ferait lire deux tarifs pour un seul chantier.
    priceNote: `Ou ${equipeDeja.price} si vous avez déjà vos tablettes`,
  },
];

/* ── 5. Ce qui est toujours compris ──────────────────────────── */

/**
 * NEUF LIGNES, ET PAS UNE QUI NE SOIT DÉJÀ TENUE.
 *
 * Chacune reprend un engagement écrit ailleurs sur le site — jalons de
 * lancement, réponses de la FAQ, mode hors-ligne de la section matériel,
 * appairage de la caisse, tableau des commissions. Cette section ne PROMET rien
 * de neuf : elle rassemble en un endroit ce qu'un lecteur devrait autrement
 * aller chercher dans cinq sections de la landing.
 *
 * Elles passent de deux colonnes à TROIS, sur une bande pleine largeur : neuf
 * lignes se lisent en trois rangées au lieu de cinq, et la section perd deux
 * cents pixels de hauteur en gagnant la seule respiration horizontale de la
 * page.
 *
 * La distinction abonnement / mise en route est portée par le texte lui-même
 * (« compris dans la mise en route ») : la gommer ferait de « toujours
 * compris » un raccourci que la première facture démentirait.
 */
export const TOUJOURS_COMPRIS: readonly string[] = [
  "Les mises à jour, les corrections et le support selon les modalités de votre offre",
  "Les exports disponibles pour les modules souscrits ; réversibilité précisée au contrat",
  "L'hébergement du logiciel et sa maintenance",
  "Avec la caisse : stockage local et renvoi après reconnexion ; la cuisine conserve les tickets déjà reçus",
  "La configuration des modules souscrits et la validation du matériel compatible",
  "Une prise en main accompagnée, selon le périmètre et le rendez-vous convenus",
  "Avec la commande en ligne : ajout de votre lien sur Google si vous nous donnez l'accès",
  "Zéro commission Snack Manager sur les ventes ; frais de paiement distincts",
  "Avec les applications tablette : appairage par code, révocable depuis le back-office",
];

/* ── 6. L'appel de pied de page ──────────────────────────────── */

/**
 * LE SEUL POINT DE CONVERSION DE LA PAGE, ET IL RENVOIE À LA LANDING.
 *
 * Le formulaire de rappel vit en section 11 de la vitrine, avec sa logique et
 * son back-end. En reconstruire un ici, ce serait deux formulaires à maintenir
 * pour un seul rappel — et le jour où l'un des deux cesserait d'envoyer, rien ne
 * le signalerait.
 *
 * Il est désormais atteint DIRECTEMENT après les conditions, sans passer par un
 * inventaire de refus : la dernière chose que le lecteur lisait avant qu'on lui
 * demande son numéro était quatre paragraphes commençant par une négation.
 */
export const OFFRE_CTA = {
  title: "Il reste une question ? Elle se règle en trente minutes.",
  line: "On regarde votre carte, vos services et votre organisation actuelle, et vous repartez avec vos chiffres. Chez vous ou en visio.",
} as const;
