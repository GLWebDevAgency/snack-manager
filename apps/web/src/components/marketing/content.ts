/**
 * Copy du site vitrine — source unique, en français.
 *
 * Le texte est celui de la maquette « Snack Manager - Site Vitrine.html »
 * (Menu Trivolet Redesign) : on ne le réécrit pas, on le structure.
 */

export const CONTACT_EMAIL = "contact@snackmanager.fr";
export const FOUNDER_SEATS_TOTAL = 10;
export const FOUNDER_SEATS_TAKEN = 3;
export const FOUNDER_SEATS_LEFT = FOUNDER_SEATS_TOTAL - FOUNDER_SEATS_TAKEN;

/* ── Navigation ──────────────────────────────────────────────── */

/** L'encoche s'ouvre en deux groupes symétriques autour du logo. */
export const NAV_LEFT = [
  { href: "#produit", label: "Produit" },
  { href: "#pourquoi", label: "Expertise" },
] as const;

export const NAV_RIGHT = [
  { href: "#revenus", label: "Revenus" },
  { href: "#tarifs", label: "Tarifs" },
  { href: "#contact", label: "Contact" },
] as const;

/* ── Bandeau de fonctionnalités sous le hero ─────────────────── */

export const TICKER = [
  "Cuisine (KDS)",
  "Caisse (POS)",
  "Back-office",
  "Planning & masse salariale",
  "Stocks & coût matière",
  "Site & commande",
] as const;

/* ── Bandeau de preuve ───────────────────────────────────────── */

export const PROOF = [
  {
    value: 35,
    prefix: "−",
    suffix: " %",
    label: "d'erreurs de commande avec la prise en ligne",
    source: "Deliverect, 2023",
  },
  {
    value: 15,
    prefix: "+",
    suffix: " %",
    label: "de panier moyen sur les commandes en ligne",
    source: "bas de fourchette des études",
  },
  {
    value: 60,
    prefix: "",
    suffix: " min",
    label: "pour former une recrue à la caisse",
    source: "constaté au restaurant pilote",
  },
  {
    value: 7,
    prefix: "",
    suffix: " j/7",
    label: "testé en service réel, midi et soir",
    source: "Class'Food — Normandie",
  },
] as const;

/* ── Captures réelles des applications ───────────────────────── */

export type Shot = { src: string; alt: string; portrait?: boolean };

/** Deck 3D du hero : uniquement des captures paysage. */
export const HERO_SHOTS: Shot[] = [
  { src: "/shots/backoffice.png", alt: "Back-office Snack Manager : chiffre d'affaires du jour et commandes en direct" },
  { src: "/shots/pos.png", alt: "Caisse Snack Manager sur tablette, en cours de prise de commande" },
  { src: "/shots/kds.png", alt: "App cuisine Snack Manager : colonnes Nouveau, En préparation, Prêt" },
  { src: "/shots/menu.png", alt: "Commande en ligne Snack Manager, carte à la couleur du restaurant" },
  { src: "/shots/board.png", alt: "Écran d'appel client Snack Manager : numéros prêts au retrait" },
];

/* ── Simulateur ──────────────────────────────────────────────── */

export const SIM_NOTES =
  "Hypothèses prudentes, ajustées ensemble en démo : coût horaire chargé 13 €/h (SMIC restauration 2026 + charges) · commande refaite ≈ 50 % du panier · appel ≈ 3 min + 1 min d'interruption/reprise de poste, 60 % des appels migrent en ligne · 10 % du comptoir migre la 1ʳᵉ année · panier en ligne +15 % (bas de fourchette des études : +15 à +30 %) · erreurs −35 % (Deliverect, 2023) · 2 services/jour, 30,4 jours/mois.";

export const SIM_FLOW = [
  "Le client commande & paie en ligne",
  "Ticket généré automatiquement",
  "Visible en direct sur le KDS cuisine",
  "La caisse remet le sac. C'est tout.",
] as const;

/* ── Processus (3 panneaux) ──────────────────────────────────── */

export const PROC_TEXTS = [
  {
    step: "Étape 1.",
    title: "On observe votre service",
    text: "On identifie ce qui ralentit votre équipe et où l'automatisation change vraiment la donne.",
  },
  {
    step: "Étape 2.",
    title: "On configure votre plateforme",
    text: "Menu, équipe, logo, couleurs, moyens de paiement — tout est prêt avant l'ouverture.",
  },
  {
    step: "Étape 3.",
    title: "On reste à vos côtés",
    text: "Support continu, mises à jour, accompagnement — un vrai partenaire, pas un logiciel qu'on vous laisse.",
  },
] as const;

export type ChangelogTone = "new" | "improved" | "fixed";

export type ChangelogMonth = {
  month: string;
  sub: string;
  items: { tone: ChangelogTone; text: string; faded?: 0 | 1 | 2 }[];
};

export const CHANGELOG: ChangelogMonth[] = [
  {
    month: "Juillet 2026",
    sub: "Ce qu'on a amélioré ce mois-ci.",
    items: [
      { tone: "new", text: "Sticker sac imprimé à l'acceptation" },
      { tone: "new", text: "Pointage équipe sur tablette" },
      { tone: "improved", text: "Synchro caisse ↔ cuisine plus rapide" },
      { tone: "new", text: "Alertes sonores personnalisables", faded: 1 },
      { tone: "fixed", text: "Correctifs mode hors-ligne", faded: 2 },
    ],
  },
  {
    month: "Août 2026",
    sub: "Et la suite.",
    items: [
      { tone: "new", text: "Fidélité multi-sites" },
      { tone: "improved", text: "Chargement des tickets 30 % plus rapide" },
      { tone: "new", text: "Export des plannings en PDF", faded: 1 },
      { tone: "fixed", text: "Bug d'impression sticker corrigé", faded: 2 },
    ],
  },
];

/* ── Revenus — les quatre marques de livraison ────────────────── */

/**
 * LES QUATRE MARQUES N'ONT AUCUN VISUEL, ET C'EST ASSUMÉ ICI.
 *
 * Ni logo, ni photo de plat n'existe (rien dans `public/`). On ne fabrique pas
 * l'un ni l'autre : publier une identité qui n'existe pas, c'est promettre au
 * restaurateur un produit qu'on ne pourra pas lui livrer le jour de la
 * signature. La vitrine est donc TYPOGRAPHIQUE — le nom posé grand, la cuisine
 * en dessous, une teinte propre à chaque marque, le repère halal.
 *
 * `tint` n'est PAS une couleur fonctionnelle. Les trois couleurs de sens de la
 * direction artistique (vert « prêt », rouge « alerte », ambre « en cours »)
 * n'ont pas de raison d'être ici : aucune de ces quatre teintes ne reprend
 * leur valeur, et rien sur cette page ne porte de statut. Ce sont des repères
 * d'identité, provisoires : le jour où les vraies identités arrivent, on
 * remplace `tint` et on ajoute `logo` — la structure ne bouge pas.
 */
export type VirtualBrand = {
  id: string;
  name: string;
  /** Deux ou trois mots, pas une carte : ce qu'on cuisine sous cette enseigne. */
  cuisine: string;
  tint: string;
};

export const BRANDS: VirtualBrand[] = [
  { id: "maki-ya", name: "Maki-Ya", cuisine: "Sushis & makis", tint: "#7f9fd4" },
  { id: "pastella", name: "Pastella", cuisine: "Pâtes italiennes", tint: "#d7a15f" },
  { id: "wings-club", name: "Wings Club", cuisine: "Ailes & poulet frit", tint: "#c96f5a" },
  { id: "green-bowl", name: "Green Bowl", cuisine: "Bowls & salades", tint: "#7cb98d" },
];

/** Ce qu'on installe avec la marque — identique pour les quatre. */
export const BRAND_KIT = ["Recettes", "Formation", "Uber Eats & Deliveroo", "Publicité"] as const;

/**
 * Les trois étapes, presque sans mots — c'est le déroulé, pas l'argumentaire.
 * Le détail (« on ouvre les comptes », « on pilote la pub ») est déjà dans
 * `BRAND_KIT` ; le répéter ici, c'est le reproche du fondateur qui revient.
 */
export const BRAND_STEPS = ["On installe", "Vous cuisinez", "Vous encaissez"] as const;

/**
 * LES SEULS CHIFFRES AUTORISÉS SUR CETTE SECTION.
 *
 * Ils viennent du brief du fondateur, un par un. Not So Dark annonce 50 à
 * 150 k€ mensuels supplémentaires : on ne reprend JAMAIS ce genre de promesse
 * à notre compte, ni ici ni ailleurs.
 */
export const BRAND_FIGURES = [
  { fig: "0 €", label: "pour démarrer" },
  { fig: "8 %", label: "sur ce que ça vend, et rien d'autre" },
  { fig: "3 semaines", label: "avant votre premier ticket" },
] as const;

/** Offre 2 — la reprise en main des pages de livraison existantes. */
export const BOOST_LEVERS = [
  "Menu réorganisé",
  "Photos retravaillées",
  "Promos aux bonnes heures",
  "Avis gérés",
] as const;

export const BOOST_FIGURES = [
  { fig: "99 €", label: "par mois" },
  // « Objectif » n'est pas une précaution de langage : c'est le mot du brief.
  // On vise +30 %, on ne le garantit pas.
  { fig: "+30 %", label: "de ventes en livraison — objectif à 60 jours" },
  // « Sans engagement » posé comme un chiffre : c'est un argument de prix,
  // il tient sa place dans la rangée au lieu de finir en note de bas de carte.
  { fig: "0", label: "engagement" },
] as const;

/* ── Catalogue app par app ───────────────────────────────────── */

export type CatalogueColumn = {
  name: string;
  device: string;
  /** `demo` pointe vers l'index de la scène 3D. */
  demo: number;
  demoLabel: string;
  items: { pre?: string; strong?: string; post?: string }[];
};

/**
 * SEPT LIGNES PAR COLONNE, PAS HUIT — ET C'EST UNE CONTRAINTE, PAS UN HASARD.
 *
 * Le back-office a gagné des surfaces entières (planning, ingrédients &
 * stocks, abonnement) qu'il fallait faire entrer ici. « Ne rallonge pas la
 * page » : chaque colonne a donc été resserrée d'une ligne, et les lignes
 * jumelles ont fusionné (minuteur + alerte sonore, totaux + moyens de
 * paiement). Le catalogue dit plus de choses en occupant moins de hauteur.
 *
 * La grille est à QUATRE colonnes en dur (`.cat-grid`), et `demo:` pointe un
 * index de `DEMO_APPS` : on ne peut ni ajouter une cinquième colonne « RH &
 * stocks », ni réordonner sans casser le lien vers la scène de démonstration.
 * Les nouvelles surfaces vivent donc dans la colonne du gérant.
 */
export const CATALOGUE: CatalogueColumn[] = [
  {
    name: "Caisse (POS)",
    device: "Tablette, au comptoir",
    demo: 0,
    demoLabel: "Essayer la caisse en démo →",
    items: [
      { strong: "Sur place, à emporter, téléphone", post: " — même écran" },
      { pre: "Config express : recette, sauces, tailles, suppléments" },
      { pre: "Tacos sur-mesure, passage en menu (+2,50 €) en un tap" },
      { pre: "Totaux, rendu monnaie, CB / espèces / au retrait" },
      { strong: "Ticket cuisine + sticker sac", post: " imprimés" },
      { pre: "Lignes identiques cumulées, note par produit" },
      { pre: "Appairage par code à six caractères, révocable" },
    ],
  },
  {
    name: "Cuisine (KDS)",
    device: "Mural en cuisine, ou tablette",
    demo: 1,
    demoLabel: "Essayer la cuisine en démo →",
    items: [
      { pre: "Colonnes ", strong: "Nouveau → En prépa → Prêt" },
      { pre: "« À lancer » agrégé : 3 frites, 2 tacos… en un coup d'œil" },
      { pre: "Minuteur couleur par commande, alerte sonore" },
      { pre: "Chaque article cochable pendant la prépa" },
      { pre: "Numéro de retrait pour appeler le client" },
      { pre: "Thème sombre ou clair, pensé pour la cuisine" },
      { strong: "Mode hors-ligne", post: " avec resynchronisation" },
    ],
  },
  {
    name: "Commande en ligne",
    device: "Web, mobile first",
    demo: 2,
    demoLabel: "Essayer la commande en démo →",
    items: [
      { strong: "Click & collect", post: " avec créneaux de retrait" },
      { pre: "Paiement en ligne ou au retrait" },
      { pre: "Configurateur identique à la caisse — zéro surprise" },
      { pre: "Codes promo, fidélité points & tampons" },
      { pre: "Compte client, historique, recommande en 1 tap" },
      { pre: "Suivi de commande en direct (reçue → prête)" },
      { strong: "À vos couleurs", post: ", sur votre nom de domaine" },
    ],
  },
  {
    name: "Back-office",
    device: "Web, côté gérant — 14 écrans",
    demo: 3,
    demoLabel: "Essayer le back-office en démo →",
    items: [
      { strong: "CA, commandes et stats", post: " en direct, exports CSV" },
      { pre: "Menu & prix en direct, import CSV/XML, ruptures en un tap" },
      // La ligne qui vaut la section : le planning fait DÉCIDER une dépense
      // au lieu de la constater. Le coût bouge à chaque service posé.
      { pre: "Planning : ", strong: "le coût de la semaine bouge pendant que vous la posez" },
      { pre: "Volume attendu en face de chaque service, ", strong: "prévu contre pointé" },
      { strong: "Ingrédients & stocks", post: " : seuils, ruptures, pertes, inventaires" },
      { pre: "Fournisseurs, prix au colis, ", strong: "coût matière et marge par produit" },
      { pre: "Horaires, promos, avis clients, ", strong: "abonnement & factures" },
    ],
  },
];

/* ── Scène de démonstration 3D ───────────────────────────────── */

/**
 * Châssis dans lequel l'application est présentée. C'est l'appareil RÉEL du
 * terrain, pas une préférence graphique : une caisse se tient sur une tablette
 * posée en paysage au comptoir, la commande client se prend au téléphone, le
 * back-office vit sur un écran d'ordinateur, et l'écran cuisine est un moniteur
 * ACCROCHÉ AU MUR au-dessus du piano.
 *
 * `wall` n'est pas une coquetterie : un mural 24 pouces est en 16/9 quand une
 * tablette est en 16/10. Tant que la cuisine partageait le châssis `tablet`,
 * elle héritait de son rapport — donc d'une affiche rognée et d'une iframe qui
 * ne pouvait pas recevoir 1920 × 1080 sans bande noire.
 */
export type DemoDevice = "tablet" | "phone" | "wide" | "wall";

/**
 * ═══ LA RÉSOLUTION LOGIQUE DE CHAQUE APPAREIL — LA SOURCE UNIQUE ═══
 *
 * C'est le nombre de pixels CSS que l'application EMBARQUÉE croit avoir. Rien
 * à voir avec la place qu'elle occupe sur la page : le cadre l'affiche en
 * réduction (voir `DeviceFrame`), exactement comme on regarde un écran de loin.
 *
 * POURQUOI CE MODULE EST NÉCESSAIRE. Sans lui, l'iframe reçoit la taille du
 * cadre dessiné — 844 px pour la tablette, 856 pour l'écran large — et
 * l'application se met en page pour un petit écran :
 *
 *   · la cuisine, sous les 900 px de `TABS_MAX_WIDTH` (apps/kds/src/config.ts),
 *     bascule en mode COMPACT : une seule liste, des onglets par statut, et le
 *     panneau « À lancer » évaporé. C'est le défaut qui a déclenché ce
 *     chantier — le visiteur ne voyait pas le produit qu'on lui vend ;
 *   · le back-office sous ~1150 px replie sa rangée de cartes (« Prévisions du
 *     service » passe sous « Objectif du jour ») : la mise en page d'un petit
 *     portable, pas celle de l'ordinateur du gérant.
 *
 * CHAQUE VALEUR EST CELLE D'UN APPAREIL RÉEL, ET CELLE DE SON AFFICHE.
 * Les deux ne peuvent pas diverger : `scripts/capture-shots.mjs` photographie
 * chaque surface À CES DIMENSIONS. Le cadre porte donc le rapport exact de la
 * capture (aucun rognage) ET celui de l'application (aucune bande noire), et
 * le passage de l'affiche à la démo au clic ne fait bouger aucun pixel.
 * Changer un nombre ici, c'est recapturer l'affiche correspondante.
 *
 *   · tablet 1280 × 800 — la tablette 10 pouces du comptoir, nommée
 *     « la référence » par apps/kds/src/config.ts ;
 *   · wall   1920 × 1080 — le mural 24 pouces de la cuisine. Au-dessus de
 *     `ALLDAY_MIN_SCREEN` (1240) : trois colonnes ET le panneau « À lancer ».
 *     Petit côté 1080 → échelle typographique 1,28 dans le KDS, celle qui rend
 *     l'écran lisible depuis la friteuse ;
 *   · wide   1440 × 900 — l'ordinateur du gérant, 16/10 comme son châssis ;
 *   · phone  390 × 844 — un téléphone courant, celui du client dans la file.
 */
export const DEVICE_SCREEN: Record<DemoDevice, { w: number; h: number }> = {
  tablet: { w: 1280, h: 800 },
  wall: { w: 1920, h: 1080 },
  wide: { w: 1440, h: 900 },
  phone: { w: 390, h: 844 },
};

/**
 * Origines des applications DE TERRAIN embarquées dans la vitrine.
 *
 * Aujourd'hui STAGING : ce sont les seules URL où le mode démonstration est
 * déployé. Le jour où les domaines de production sont à jour, on remplace les
 * deux valeurs ici et rien d'autre ne bouge.
 */
export const DEMO_ORIGINS = {
  pos: "https://pos-staging-7f92.up.railway.app",
  kds: "https://kds-staging-90da.up.railway.app",
} as const;

/**
 * Le seul déclencheur du mode démonstration, côté applications de terrain
 * (`packages/client-core/src/demo/mode.ts`) : `?demo=1`, et rien d'autre.
 *
 * Ce mode ne touche AUCUNE base : la carte, le service en cours et les
 * commandes prises par le visiteur vivent dans son propre navigateur. Deux
 * visiteurs ne se croisent jamais, aucun faux restaurant n'apparaît dans le
 * CRM, et rien ne pollue la médiane réseau qui alimente notre conseil chiffré.
 */
export const DEMO_QUERY = "?demo=1";

/** URL complète à charger dans le cadre (ou à ouvrir dans un onglet). */
export function demoHref(origin: string): string {
  return `${origin}/${DEMO_QUERY}`;
}

/**
 * Les deux démonstrations servies par CE site — même origine que la vitrine.
 *
 * Ces adresses ne sont pas devinées, elles sont RECOPIÉES de la bascule que
 * chaque surface expose ; toucher l'une sans l'autre casserait la vitrine.
 *
 *   · back-office  → `apps/web/src/lib/demo/mode.ts`
 *     `DEMO_PARAM=demo`, `DEMO_VALUE=1`, et une borne de chemin `/admin` :
 *     le paramètre seul ne suffit pas, l'adresse doit être sous `/admin`.
 *     On vise `/admin/dashboard` et non `/admin` : la page d'index fait une
 *     redirection serveur vers `/admin/menu` qui perdrait la requête — donc
 *     le paramètre, donc la démonstration, remplacée par l'écran de connexion.
 *
 *   · commande en ligne → `apps/web/src/components/order/demo/mode.ts`
 *     deux verrous : `?demo=1` ET le slug réservé `demo`. Sans les deux,
 *     `/r/demo` répond 404 comme n'importe quel restaurant inconnu.
 */
export const DEMO_PATHS = {
  bo: `/admin/dashboard${DEMO_QUERY}`,
  order: `/r/demo${DEMO_QUERY}`,
} as const;

/**
 * Ce qu'il faut pour rendre une application MANIPULABLE depuis la vitrine.
 *
 * Absent = l'application n'a pas (encore) de mode démonstration : on garde
 * l'affiche seule plutôt que d'embarquer un écran d'appairage ou un écran de
 * connexion, qui donneraient l'impression d'un produit fermé.
 */
export type DemoLive = {
  /**
   * Adresse complète à charger, paramètre de démonstration compris.
   *
   * Deux formes cohabitent, et la différence n'est pas cosmétique : une URL
   * absolue (caisse, cuisine — déployées à part) ou un chemin de CE site
   * (back-office, commande en ligne). Une page de même origine embarquée avec
   * `allow-same-origin` retrouve le droit de lire le DOM de la vitrine ; la
   * conséquence est arbitrée et expliquée là où l'iframe est écrite, dans
   * `AppsShowcase`.
   */
  href: string;
  /** Bouton posé sur l'affiche, sur grand écran. Monte la démo dans le cadre. */
  cta: string;
  /**
   * Ouverture dans un onglet, À TOUTE LARGEUR — plus un repli de petit écran.
   *
   * L'application embarquée est réduite pour tenir dans le cadre (1920 px de
   * cuisine dans ~1130 px), donc son texte est plus petit que sur l'appareil
   * réel. Ce lien est la seule façon de la lire à sa taille : il est proposé
   * dès le premier regard, à côté de `cta`, et de nouveau sous le cadre
   * pendant que la démo tourne.
   *
   * Le libellé ne nomme donc plus l'application (« Ouvrir la caisse en plein
   * écran ») : côte à côte avec « Essayer la caisse », il la nommait deux fois
   * et débordait de la ligne. En dessous de 810 px, où il reste seul, la
   * pastille active au-dessus du cadre dit déjà de quelle app il s'agit.
   */
  ctaOut: string;
  /**
   * Par où commencer — UNE phrase, propre à l'application.
   *
   * Elle est affichée sous le cadre, affiche comprise : avant le clic elle
   * annonce ce qu'on va pouvoir faire, après le clic elle dit par où
   * commencer. « Touchez un produit » n'a aucun sens devant un back-office ;
   * chaque application a donc la sienne.
   */
  hint: string;
  /** `title` de l'iframe — lu tel quel par les lecteurs d'écran. */
  title: string;
};

export type DemoApp = {
  id: string;
  label: string;
  device: DemoDevice;
  shot: Shot;
  lead: string;
  body: string;
  chips: string[];
  live?: DemoLive;
};

/**
 * L'ORDRE EST UN CHOIX, ET IL COMMENCE PAR LA CAISSE.
 *
 * La scène s'ouvre sur `DEMO_APPS[0]`. Le back-office y était : le visiteur
 * tombait sur un écran de gestion, sans bouton « Essayer » sous les yeux
 * puisque la démonstration du back-office n'existait pas encore — l'effet
 * était perdu au premier regard. La caisse est l'écran auquel un restaurateur
 * s'identifie immédiatement : c'est celui qu'il a devant lui toute la journée.
 *
 * L'ordre suit ensuite le trajet d'une commande — caisse, cuisine, commande
 * client — et finit par le poste du gérant. C'est aussi l'ordre des colonnes
 * du catalogue ci-dessus ; les `demo:` de `CATALOGUE` pointent ces index.
 */
export const DEMO_APPS: DemoApp[] = [
  {
    id: "pos",
    label: "Caisse (POS)",
    device: "tablet",
    shot: { src: "/shots/pos.png", alt: "Caisse : catalogue, configurateur produit et ticket en cours" },
    lead: "Caisse.",
    body: " Menus cadrés, totaux automatiques, ticket cuisine et sticker sac imprimés — prise en main en une heure, même pour une nouvelle recrue.",
    chips: ["Config express", "Ticket + sticker sac", "Sur place & téléphone"],
    live: {
      href: demoHref(DEMO_ORIGINS.pos),
      cta: "Essayer la caisse",
      ctaOut: "Ouvrir en plein écran",
      hint: "Touchez un produit pour composer une commande, puis encaissez.",
      title: "Caisse Snack Manager en démonstration",
    },
  },
  {
    id: "kds",
    label: "Cuisine (KDS)",
    // Un mural, pas une tablette : 16/9, et 1920 × 1080 dans le cadre. Voir
    // `DEVICE_SCREEN` — en dessous de 900 px l'app bascule en mode onglets et
    // le panneau « À lancer » disparaît, c'est-à-dire tout ce qu'on montre ici.
    device: "wall",
    shot: { src: "/shots/kds.png", alt: "App cuisine : colonnes Nouveau, En préparation, Prêt avec minuteurs" },
    lead: "Cuisine.",
    body: " Les commandes arrivent seules, « 3 frites à lancer » en un coup d'œil, statuts Nouveau → En prépa → Prêt, minuteurs et alerte sonore.",
    chips: ["À lancer agrégé", "Minuteurs couleur", "Alerte sonore"],
    live: {
      href: demoHref(DEMO_ORIGINS.kds),
      cta: "Essayer l'écran cuisine",
      ctaOut: "Ouvrir en plein écran",
      hint: "Ouvrez « Nouveau » et touchez « Accepter » : le ticket part en préparation.",
      title: "Écran cuisine Snack Manager en démonstration",
    },
  },
  {
    id: "order",
    label: "Commande client",
    device: "phone",
    shot: { src: "/shots/commande.png", alt: "Commande en ligne sur mobile : carte du restaurant et panier", portrait: true },
    lead: "Commande en ligne.",
    body: " Le client commande et paie — le ticket file droit en cuisine, déjà encaissé. La caisse ne fait que remettre le sac.",
    chips: ["Créneaux de retrait", "Fidélité & promos", "Paiement en ligne"],
    live: {
      href: DEMO_PATHS.order,
      cta: "Essayer la commande en ligne",
      ctaOut: "Ouvrir en plein écran",
      hint: "Composez un tacos, ajoutez-le au panier, choisissez votre créneau.",
      title: "Commande en ligne Snack Manager en démonstration",
    },
  },
  {
    id: "bo",
    label: "Back-office",
    device: "wide",
    shot: { src: "/shots/backoffice.png", alt: "Back-office : CA du jour, commandes en direct, prévisions du service" },
    lead: "Back-office gérant.",
    body: " Quatorze écrans : CA du jour, menu & prix en direct, planning dont le coût s'affiche avant que vous validiez, stocks et coût matière, factures.",
    chips: ["Planning & coût projeté", "Stocks & coût matière", "Abonnement & factures"],
    live: {
      href: DEMO_PATHS.bo,
      cta: "Essayer le back-office",
      ctaOut: "Ouvrir en plein écran",
      // L'enjeu du back-office n'est pas un geste, c'est l'ÉTENDUE : on invite
      // donc explicitement à ouvrir les écrans les uns après les autres.
      hint: "Promenez-vous dans le menu de gauche : tout est là, écran par écran.",
      title: "Back-office Snack Manager en démonstration",
    },
  },
];

/* ── Cas client (avant / après) ──────────────────────────────── */

export const CASE_SLIDES = [
  {
    title: "Avant Snack Manager",
    text: "Tickets papier, un poste en plus aux heures de rush, des commandes en ligne à gérer à côté du comptoir.",
  },
  {
    title: "Avec Snack Manager",
    text: "Un service organisé, une équipe mieux répartie, et un gain de temps qui se voit dès la première semaine.",
  },
] as const;

/** Photos réelles du restaurant pilote (apps/web/public/photos). */
export const CASE_PHOTOS: Shot[] = [
  { src: "/photos/sandwichs1.jpeg", alt: "La carte papier des sandwichs, affichée au-dessus du comptoir du restaurant pilote" },
  { src: "/photos/tacos.jpeg", alt: "Le panneau « Compose ton tacos » et sa grille de suppléments, au mur du restaurant" },
  { src: "/photos/tacos-gratine-hero.png", alt: "Le tacos gratiné, produit signature du restaurant pilote Class'Food" },
];

/* ── Vignettes du quotidien ──────────────────────────────────── */

export const VIGNETTES: { tag: string; quote: string; photo: Shot }[] = [
  {
    tag: "Vendredi 20h",
    quote: "« Les commandes griffonnées au stylo que la cuisine doit déchiffrer en plein coup de feu. »",
    photo: { src: "/photos/classiques.jpeg", alt: "Le panneau des burgers, affiché au-dessus du comptoir du restaurant pilote" },
  },
  {
    tag: "Dimanche midi",
    quote: "« Une personne en plus juste pour gérer les commandes en ligne à côté du comptoir. »",
    photo: { src: "/photos/paninis.jpeg", alt: "Le panneau des assiettes et des paninis, au mur du restaurant pilote" },
  },
  {
    tag: "Fin de mois",
    quote: "« Recompter les heures de l'équipe à la main pour sortir les plannings du mois. »",
    photo: { src: "/photos/salades-barquettes.jpeg", alt: "Le panneau des salades et des barquettes de frites, au-dessus du comptoir" },
  },
  {
    tag: "Nouvelle recrue",
    quote: "« À chaque départ, des jours de formation juste pour que la nouvelle personne tienne la caisse. »",
    photo: { src: "/photos/enfant-glaces.jpeg", alt: "Le panneau menu enfant, glaces et desserts, au-dessus des friteuses" },
  },
];

/* ── Né au comptoir ──────────────────────────────────────────── */

export const FOUNDER_QUOTE =
  "« Snack Manager est né derrière le comptoir de notre restaurant pilote. Tickets perdus en plein rush, téléphone qui sonne pendant l'encaissement, heures recomptées à la main : on a vécu chaque problème avant de l'automatiser. Chaque écran de la plateforme est testé en service réel, midi et soir, avant d'arriver chez vous. »";

export const FOUNDER_PHOTO: Shot = {
  src: "/photos/sandwichs3.jpeg",
  alt: "Le panneau des kebabs et des sandwichs, au-dessus du comptoir du restaurant pilote Class'Food",
};

export const FOUNDER_FACTS = ["Testé en service réel 7 j/7", "Rodé sur de vrais rushs", "Amélioré chaque semaine"] as const;

/* ── Comparatif ──────────────────────────────────────────────── */

export const VS_WITHOUT = [
  "Plusieurs outils qui ne se parlent pas",
  "Commandes au stylo, totaux calculés de tête",
  "Des jours de formation à chaque recrue",
  // La ligne du planning : sans outil, la masse salariale est CONSTATÉE.
  "Masse salariale découverte en fin de mois",
  "Site figé, pas de click & collect",
] as const;

export const VS_WITH = [
  "Une seule plateforme, tout connecté",
  "Menus cadrés, totaux automatiques, ticket + sticker sac",
  "Caisse prise en main en une heure",
  "Coût de la semaine et volume attendu, avant de valider",
  "Site & commande en ligne à vos couleurs",
] as const;

/* ── Tarifs ──────────────────────────────────────────────────── */

export type Plan = {
  name: string;
  price: string;
  desc: string;
  featLabel: string;
  features: string[];
  popular?: boolean;
};

export const PLANS: Plan[] = [
  {
    name: "Starter",
    price: "Sur devis",
    desc: "Idéal pour un point de vente qui démarre avec l'automatisation.",
    featLabel: "Inclus :",
    features: ["App Cuisine (KDS)", "Caisse (POS)", "Ticket & sticker imprimés", "Support par email"],
  },
  {
    name: "Pro",
    price: "Sur devis",
    desc: "Le plus choisi : la plateforme complète, site inclus.",
    featLabel: "Tout Starter, plus :",
    features: [
      "Site & commande en ligne",
      "Fidélité & codes promo",
      "Planning, pointage & coût de la semaine",
      "Ingrédients, stocks & coût matière",
      "Support prioritaire",
    ],
    popular: true,
  },
  {
    name: "Multi-sites",
    price: "Sur devis",
    desc: "Pour les groupes de plusieurs restaurants.",
    featLabel: "Tout Pro, plus :",
    features: ["Tableau de bord multi-sites", "Compte dédié", "Accompagnement sur mesure"],
  },
];

/* ── FAQ ─────────────────────────────────────────────────────── */

export const FAQ = [
  {
    q: "Dois-je changer mon matériel de caisse ?",
    a: "Non — la plateforme fonctionne sur tablette et téléphone standards. On vous conseille sur l'imprimante ticket/sticker si besoin.",
  },
  {
    q: "Combien de temps avant d'être opérationnel ?",
    a: "Quelques jours suffisent : configuration du menu, de l'équipe et de votre identité visuelle avant l'ouverture.",
  },
  {
    q: "C'est adapté à quel type de restaurant ?",
    a: "Pensé pour les fast-foods et snacks indépendants — sur place, à emporter ou en click & collect.",
  },
  {
    q: "Puis-je garder mon site actuel ?",
    a: "Oui, on peut connecter le module commande à votre site existant ou vous fournir un site complet à vos couleurs.",
  },
  {
    q: "Y a-t-il un engagement de durée ?",
    a: "On vous détaille les conditions au moment du devis, adaptées à votre activité.",
  },
  {
    q: "Et si la connexion internet coupe ?",
    a: "La caisse et la cuisine continuent en local : les tickets restent affichés et s'impriment, puis tout se resynchronise au retour du réseau.",
  },
  {
    q: "C'est quoi, une marque virtuelle ?",
    a: "Une marque de livraison qui existe uniquement sur Uber Eats & Deliveroo, préparée dans votre cuisine avec votre équipe. On fournit le concept, les recettes, la formation et la gestion — vous encaissez un CA que vous n'aviez pas.",
  },
  {
    q: "À qui appartiennent mes données ?",
    a: "À vous. Ventes, clients, menus : tout est exportable à tout moment (CSV), hébergé en Europe.",
  },
] as const;

/* ── Contact ─────────────────────────────────────────────────── */

export const CALLBACK_SLOTS = [
  { value: "matin", label: "Plutôt le matin" },
  { value: "entre-services", label: "Entre les services (14h–18h)" },
  { value: "apres-21h", label: "Après 21h" },
] as const;
