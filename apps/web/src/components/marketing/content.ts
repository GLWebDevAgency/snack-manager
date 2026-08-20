/**
 * Copy du site vitrine — source unique, en français.
 *
 * ═══ LA RÈGLE QUI PRIME SUR TOUTES LES AUTRES ═══
 *
 * On n'écrit ici QUE ce que le produit tient aujourd'hui. Pas un chiffre de
 * résultat (nous n'avons aucun client hors du pilote, donc aucun résultat à
 * montrer), pas un témoignage, pas un compteur de places prises, et jamais
 * un mot qui laisse entendre qu'on fournit des livreurs : le tunnel de
 * commande s'arrête au CRÉNEAU DE RETRAIT.
 *
 * La page est découpée en onze sections, une par question que se pose un
 * patron de snack, dans l'ordre où il se la pose. `SECTIONS` porte cet ordre
 * et sert à la fois de sommaire (menu burger) et de source des titres.
 */

export const CONTACT_EMAIL = "contact@snackmanager.fr";

/**
 * LA CLAUSE D'ENGAGEMENT — DÉCISION DU FONDATEUR, UN SEUL TEXTE.
 *
 * Elle est une CONSTANTE et non une phrase recopiée, parce que la page se
 * contredisait à voix haute : le hero affichait « Sans engagement » pendant
 * que la FAQ répondait « on vous détaille les conditions au moment du devis ».
 * Un prospect qui attrape les deux ne croit plus ni l'une ni l'autre.
 *
 * Partout où la question se pose — bandeau sous la grille tarifaire, FAQ — on
 * affiche CETTE valeur, jamais une reformulation. Le forfait de mise en route
 * est dit dans la même phrase que l'absence d'engagement : le taire ferait de
 * « sans engagement » un demi-mensonge découvert au devis.
 */
export const ENGAGEMENT =
  "Abonnement sans engagement, résiliable à tout moment. S'y ajoute un forfait de mise en route, non remboursable, qui couvre les journées d'installation.";

/**
 * LA RARETÉ SANS LE COMPTEUR.
 *
 * `FOUNDER_SEATS_TAKEN` valait 3 alors que nous n'avons AUCUN client signé :
 * c'était le seul énoncé de la page qu'un prospect pouvait prendre en flagrant
 * délit d'un coup de téléphone. Le décompte et ses pastilles sont supprimés —
 * constante, calcul et affichage. La politique, elle, est vraie et reste.
 */
export const FOUNDER_POLICY = "Les dix premiers restaurants gardent leur tarif à vie.";

/* ── Appels à l'action ───────────────────────────────────────── */

/**
 * DEUX LIBELLÉS POUR TOUTE LA PAGE, ET PAS UN DE PLUS.
 *
 * Elle en portait six (« Demander une démo », « Demander un devis »,
 * « Réserver ma démo », « Vérifier ces chiffres avec nous », « Explorer la
 * démo », « Contactez-nous ») pour deux destinations seulement. Six verbes
 * pour deux gestes, c'est six décisions demandées au lecteur là où il y en a
 * deux.
 *
 * `CTA_DEMO` est le seul qui reste distinct : il ne mène PAS au formulaire.
 * Ce n'est pas un appel commercial, c'est une commande de produit.
 */
export const CTA_CALLBACK = "Être rappelé";
export const CTA_DEMO = "Prendre une commande en démo";

/* ── Les onze sections ───────────────────────────────────────── */

export type SectionMeta = {
  /** Ancre réelle dans le DOM — toute entrée de navigation doit la viser. */
  id: string;
  /** Libellé court du sommaire (menu burger, encoche d'en-tête). */
  nav: string;
  /** Pastille au-dessus du titre. `null` = la section n'en porte pas. */
  badge: string | null;
  /** Le `h2` de la section, écrit ici et nulle part ailleurs. */
  title: string;
};

/**
 * L'ORDRE DE LA PAGE, ET C'EST UN ORDRE DE QUESTIONS.
 *
 * Est-ce que je suis au bon endroit ? est-ce que ça me parle ? est-ce que ça
 * existe ? comment mes clients commandent ? est-ce que ça marche dans MA
 * cuisine ? combien ? et par rapport à ce que je paie déjà ? si je dis oui,
 * il se passe quoi ? qu'est-ce que je risque ? à qui je donne mon numéro ?
 *
 * Chaque question est posée UNE fois. Une section qui redit le travail d'une
 * autre n'a pas sa place ici — les sections ne se répètent plus, elles se
 * citent (voir `SIM_CTA_NOTE` et `PILOTE_SIGNATURE`).
 */
export const SECTIONS: readonly SectionMeta[] = [
  { id: "hero", nav: "Accueil", badge: null, title: "On fait tourner votre restaurant. Pas l'inverse." },
  {
    id: "votre-service",
    nav: "Votre service",
    badge: "Comparatif",
    title: "Votre service aujourd'hui. Votre service lundi prochain.",
  },
  { id: "produit", nav: "Produit", badge: "Le produit", title: "Ne nous croyez pas sur parole. Prenez une commande." },
  // « Vos clients commandent chez vous. Pas chez eux. » désignait un adversaire
  // sans le nommer — « chez eux », c'est qui ? — et n'expliquait nulle part
  // l'avantage qu'il y a à commander chez le restaurateur. Une préférence
  // annoncée sans sa raison. La section dit maintenant ce qu'on FAIT.
  { id: "commander", nav: "Services", badge: "Nos services +", title: "Un logiciel ne suffit pas. On s'occupe du reste." },
  {
    id: "materiel",
    nav: "Matériel",
    badge: "Chez vous",
    title: "Rien à racheter. Et rien ne s'arrête quand le réseau tombe.",
  },
  { id: "tarifs", nav: "Tarifs", badge: "Tarifs", title: "Trois prix, affichés. Zéro commission, toujours." },
  {
    id: "simulateur",
    nav: "Le calcul",
    badge: "Le calcul",
    title: "139 € par mois. Et votre organisation actuelle, elle vous coûte combien ?",
  },
  {
    id: "lancement",
    nav: "Lancement",
    badge: "Le lancement",
    // Le titre disait « On date ce qu'on livre. Jamais ce que vous gagnerez. » :
    // une précaution déguisée en promesse, qui parlait de nos scrupules au lieu
    // de répondre à la question posée — comment ça se passe ? Vite, et
    // accompagné. Les quatre jalons le disaient déjà ; le titre les contredisait.
    title: "On installe vite. Et on reste après.",
  },
  // « Vous avez des doutes. Ils sont légitimes. » installait le doute au lieu de
  // le lever. Un visiteur arrivé jusqu'ici n'a pas de doutes, il a des questions.
  { id: "faq", nav: "Questions", badge: "Questions", title: "Vos questions. Nos réponses." },
  {
    id: "histoire",
    nav: "Notre histoire",
    badge: "Notre histoire",
    // « Ce logiciel a un restaurant. Il s'appelle Class'Food. » mettait l'outil
    // au centre au moment précis où le lecteur cherche des gens. Ce qu'il veut
    // savoir avant de laisser son numéro, c'est à QUI il le laisse.
    title: "Un expert de la tech, un restaurateur, et le logiciel qui leur manquait.",
  },
  { id: "contact", nav: "Contact", badge: null, title: "Laissez-nous votre numéro. On rappelle sous 24 h." },
] as const;

/** Retrouve la pastille et le titre d'une section par son ancre. */
export function section(id: string): SectionMeta {
  const found = SECTIONS.find((s) => s.id === id);
  if (!found) throw new Error(`Section inconnue : ${id}`);
  return found;
}

/* ── Navigation ──────────────────────────────────────────────── */

/**
 * L'encoche s'ouvre en deux groupes symétriques autour du logo.
 *
 * Les trois ancres d'hier étaient MORTES ou le devenaient : `#pourquoi`
 * (Process, supprimé), `#revenus` (Revenue, éclaté), et `#produit` qui
 * désignait six maquettes inventées — il désigne désormais la démonstration
 * manipulable, ce qui est un progrès pour le lien d'évitement « Aller au
 * contenu » : il atterrit sur le produit et non sur des captures dessinées.
 */
export const NAV_LEFT = [
  { href: "#produit", label: "Produit" },
  { href: "#commander", label: "Commander" },
] as const;

export const NAV_RIGHT = [
  { href: "#tarifs", label: "Tarifs" },
  { href: "#faq", label: "Questions" },
  { href: "#contact", label: "Contact" },
] as const;

/**
 * LE SOMMAIRE DU MENU BURGER — pas la même chose que l'encoche.
 *
 * La barre collante disparaît ; sur téléphone, le burger devient la SEULE
 * navigation de la page. Il doit donc être un sommaire complet, pas un
 * raccourci de cinq entrées. Le hero est exclu : on y est déjà.
 */
export const NAV_MOBILE = SECTIONS.filter((s) => s.id !== "hero").map((s) => ({
  href: `#${s.id}`,
  label: s.nav,
}));

/* ── 1. Hero — captures réelles des applications ─────────────── */

export type Shot = { src: string; alt: string; portrait?: boolean };

/** Deck 3D du hero : uniquement des captures paysage. */
export const HERO_SHOTS: Shot[] = [
  { src: "/shots/backoffice.png", alt: "Back-office Snack Manager : chiffre d'affaires du jour et commandes en direct" },
  { src: "/shots/pos.png", alt: "Caisse Snack Manager sur tablette, en cours de prise de commande" },
  { src: "/shots/kds.png", alt: "App cuisine Snack Manager : colonnes Nouveau, En préparation, Prêt" },
  // `menu.png` MONTRE LE BACK-OFFICE, et son texte alternatif annonçait « Commande
  // en ligne » : le deck représentait donc l'application que les CLIENTS du
  // restaurateur utilisent par une page de gestion, sur un écran d'ordinateur.
  // Le libellé dit maintenant ce que l'image montre.
  { src: "/shots/menu.png", alt: "Back-office Snack Manager : carte et prix, disponibilités en un geste" },
  // Et la vraie commande en ligne entre dans le deck, en PORTRAIT — c'est le
  // seul appareil de la rangée que le client du restaurateur tient en main.
  {
    src: "/shots/commande.png",
    alt: "Commande en ligne Snack Manager sur téléphone : carte du restaurant et click and collect",
    portrait: true,
  },
  { src: "/shots/board.png", alt: "Écran d'appel client Snack Manager : numéros prêts au retrait" },
];

/* ── 2. Votre service — le miroir ────────────────────────────── */

/**
 * SIX LIGNES DE CHAQUE CÔTÉ, ET ELLES SE RÉPONDENT UNE À UNE.
 *
 * C'est le SEUL endroit de la page où la douleur est écrite. Plus jamais
 * ailleurs : le catalogue des douleurs était rouvert par Vignettes, CaseStudy,
 * le premier panneau de Process et la citation du fondateur — cinq fois la
 * même journée décrite au restaurateur, qui la connaît mieux que nous.
 *
 * Le vocabulaire est celui d'un lecteur AU DEUXIÈME ÉCRAN, qui ne connaît pas
 * encore le produit. « Menus cadrés, totaux automatiques, ticket + sticker
 * sac » était un récapitulatif écrit pour quelqu'un qui avait déjà tout lu.
 *
 * La sixième ligne de gauche est la douleur numéro un d'un restaurateur en
 * 2026, et elle manquait entièrement. Sa réponse en face est le meilleur
 * argument de la page (voir `SERVICES[0]`).
 */
export const VS_WITHOUT = [
  "Trois outils qui ne se parlent pas, et vous au milieu",
  "Les commandes au stylo, les totaux calculés de tête",
  "Des jours de formation à chaque nouvelle recrue",
  // Sans outil, la masse salariale est CONSTATÉE, jamais décidée.
  "La masse salariale, vous la découvrez en fin de mois",
  "Un site qui ne prend pas les commandes",
  "Jusqu'à 30 % prélevés sur chaque commande livrée — et le client reste le leur",
] as const;

export const VS_WITH = [
  "Une seule plateforme — caisse, cuisine, back-office, commande en ligne",
  "La caisse calcule, imprime le ticket cuisine et le sticker du sac",
  "Une heure pour qu'une nouvelle recrue tienne la caisse",
  "Le planning affiche ce que la semaine va coûter avant que vous validiez",
  "Votre page de commande en ligne, à vos couleurs, sur votre nom de domaine",
  "Votre lien de commande sur votre fiche Google, marqué « préféré par l'établissement »",
] as const;

/* ── 3. Produit — le catalogue, en légende sous chaque cadre ──── */

export type CatalogueColumn = {
  name: string;
  device: string;
  /** `demo` pointe vers l'index de la scène 3D (`DEMO_APPS`). */
  demo: number;
  items: { pre?: string; strong?: string; post?: string }[];
};

/**
 * CINQ LIGNES PAR COLONNE, ET C'EST LE CHANGEMENT DE MÉTIER DE CE TABLEAU.
 *
 * Il était une SECTION posée AU-DESSUS de sa preuve : un inventaire avant la
 * démonstration est une plaquette. Il devient la LÉGENDE sous le cadre de
 * l'application correspondante — le même inventaire, mais on peut vérifier
 * chaque ligne au doigt dans les trente secondes qui suivent.
 *
 * D'où la coupe de sept lignes à cinq : on ne garde que ce qui se VÉRIFIE au
 * clic. Deux idées rescapées de Platform y sont versées, faute d'exister
 * ailleurs : la prise de commande par téléphone (colonne Caisse) et la
 * fidélité points/tampons (colonne Commande en ligne).
 *
 * La grille est à QUATRE colonnes en dur et `demo:` pointe un index de
 * `DEMO_APPS` : on ne réordonne pas sans casser le lien vers la scène.
 */
export const CATALOGUE: CatalogueColumn[] = [
  {
    name: "Caisse (POS)",
    device: "Tablette, au comptoir",
    demo: 0,
    items: [
      { strong: "Sur place, à emporter, téléphone", post: " — même écran" },
      { pre: "Tacos sur-mesure, passage en menu (+2,50 €) en un tap" },
      { pre: "Totaux, rendu monnaie, CB / espèces / au retrait" },
      { strong: "Ticket cuisine + sticker sac", post: " imprimés" },
      { pre: "Appairage par code à six caractères, révocable" },
    ],
  },
  {
    name: "Cuisine (KDS)",
    device: "Mural en cuisine, ou tablette",
    demo: 1,
    items: [
      { pre: "Colonnes ", strong: "Nouveau → En prépa → Prêt" },
      { pre: "« À lancer » agrégé : 3 frites, 2 tacos… en un coup d'œil" },
      { pre: "Minuteur couleur par commande, alerte sonore" },
      { pre: "Numéro de retrait pour appeler le client" },
      { strong: "Mode hors-ligne", post: " avec resynchronisation" },
    ],
  },
  {
    name: "Commande en ligne",
    device: "Web, mobile first",
    demo: 2,
    items: [
      { strong: "Click & collect", post: " avec créneaux de retrait" },
      { pre: "Paiement en ligne ou au retrait" },
      { pre: "Configurateur identique à la caisse — zéro surprise" },
      { pre: "Codes promo, ", strong: "fidélité points & tampons" },
      { strong: "À vos couleurs", post: ", sur votre nom de domaine" },
    ],
  },
  {
    name: "Back-office",
    device: "Web, côté gérant — 14 écrans",
    demo: 3,
    items: [
      { strong: "CA, commandes et stats", post: " en direct, exports CSV" },
      { pre: "Menu & prix en direct, ruptures en un tap" },
      // La ligne qui vaut la colonne : le planning fait DÉCIDER une dépense
      // au lieu de la constater. Le coût bouge à chaque service posé.
      { pre: "Planning : ", strong: "le coût de la semaine bouge pendant que vous la posez" },
      { strong: "Ingrédients & stocks", post: " : seuils, ruptures, pertes, inventaires" },
      { pre: "Fournisseurs, ", strong: "coût matière et marge par produit" },
    ],
  },
];

/* ── 3. Produit — la scène de démonstration ──────────────────── */

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
 * PRODUCTION, et ce n'est plus un détail d'exploitation : toute la page repose
 * désormais sur ces adresses. Elles pointaient sur des déploiements de STAGING
 * (`pos-staging-7f92`, `kds-staging-90da`) — un cadre blanc en troisième
 * section détruit la page entière, là où seize autres sections continuaient
 * hier de vendre sans que personne s'en aperçoive.
 *
 * Corollaire à assumer côté exploitation : ces démonstrations sont un SERVICE
 * à surveiller, pas une image qu'on dépose et qu'on oublie.
 */
export const DEMO_ORIGINS = {
  pos: "https://pos-production-a9d8.up.railway.app",
  kds: "https://kds-production-8991.up.railway.app",
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
 * de `CATALOGUE` ci-dessus ; ses `demo:` pointent ces index.
 */
export const DEMO_APPS: DemoApp[] = [
  {
    id: "pos",
    label: "Caisse (POS)",
    device: "tablet",
    shot: { src: "/shots/pos.png", alt: "Caisse : catalogue, configurateur produit et ticket en cours" },
    lead: "Caisse.",
    body: " Menus cadrés, totaux automatiques, ticket cuisine et sticker sac imprimés — prise en main en une heure, même pour une nouvelle recrue.",
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

/**
 * L'APPLICATION QUI RESTE MANIPULABLE SOUS 810 px, ET C'EST LA SEULE.
 *
 * Le hero promet un geste (« Prendre une commande en démo ») ; sous le seuil
 * étroit, `AppsShowcase` démontait TOUTE iframe et la promesse tombait sur
 * l'appareil que le prospect tient dans la main. Or la commande client est
 * dessinée pour 390 px — et c'est en plus la seule des quatre que les clients
 * du restaurateur utiliseront vraiment.
 *
 * On ouvre donc la scène sur elle en dessous du seuil, et on l'épargne du
 * démontage. Les trois autres gardent l'affiche et « Ouvrir en plein écran » :
 * une caisse de 1280 px réduite dans 340 px n'est pas une démonstration, c'est
 * une vignette illisible.
 */
export const DEMO_MOBILE_ID = "order";

/**
 * LE REPLI, ET IL N'EST PAS NÉGOCIABLE.
 *
 * Si le cadre ne charge pas — origine tombée, réseau coupé, iframe bloquée par
 * le navigateur — on affiche la capture de `public/shots` avec CETTE mention.
 * Jamais un cadre blanc : un cadre blanc, sur la section dont dépend toute la
 * page, se lit comme un produit qui n'existe pas.
 */
export const DEMO_FALLBACK = "La démonstration ne répond pas — voici l'écran réel.";

/**
 * LA SIGNATURE DU PILOTE, EN PIED DE DÉMONSTRATION — une ligne, pas une
 * section.
 *
 * Founder est en dixième position sur onze : sans elle, le visiteur défile
 * cinq mille pixels sans une preuve d'existence. L'EXISTENCE du pilote est
 * donc affirmée ici, au troisième écran ; sa VOIX reste en section 10, à
 * l'endroit où l'on se demande à qui on donne son numéro.
 */
export const PILOTE_SIGNATURE =
  "Ce que vous venez de manipuler tourne à Class'Food, Perriers-sur-Andelle, midi et soir, 7 j/7.";

/* ── 4. Nos services + — ce qu'on fait, en plus du logiciel ──── */

export type Service = {
  id: string;
  title: string;
  /** L'accroche, en une phrase. Ce que le service PRODUIT, pas ce qu'il est. */
  lead: string;
  /** Le détail, deux ou trois phrases. C'est ici que l'avantage se chiffre. */
  line: string;
  /** « 499 € » ou « Compris dans la mise en route ». Jamais vide. */
  price: string;
};

/**
 * LA SECTION NE PARLE PLUS DE CANAUX, ELLE PARLE DE CE QU'ON FAIT.
 *
 * Elle s'intitulait « Vos clients commandent chez vous. Pas chez eux. » et le
 * fondateur a mis le doigt sur le défaut : « chez eux », c'est qui ? Le titre
 * désignait un adversaire sans le nommer, et surtout il n'expliquait NULLE PART
 * l'avantage qu'il y a à commander chez le restaurateur plutôt que sur Uber
 * Eats. Il annonçait une préférence sans donner sa raison.
 *
 * Trois services, et chacun dit ce qu'il produit. La fiche Google reste en
 * tête : c'est le meilleur argument de la page, et il est vérifiable.
 *
 * ═══ ON NE SE BAT PAS CONTRE UBER EATS, ON SE PLACE À CÔTÉ ═══
 *
 * Première rédaction : « les plateformes posent leur lien sans vous demander
 * votre avis », « on demande le retrait des autres ». Le fondateur a coupé
 * court, et il a raison sur le fond commercial : les plateformes sont un ATOUT
 * pour le chiffre d'affaires du restaurateur, elles lui apportent des clients
 * qu'il n'aurait pas eus et elles portent les sacs. Un prospect qui en vit
 * n'écoute pas quelqu'un qui commence par les attaquer — il entend qu'on lui
 * demande de renoncer à du volume.
 *
 * La division du travail est plus juste ET plus vendeuse : LES PLATEFORMES
 * ACQUIÈRENT, LE CANAL DIRECT FIDÉLISE. L'habitué qui commande en direct paie
 * le prix de la carte, celui qu'on n'a pas eu à gonfler pour absorber la
 * commission et les frais de service ; ses points de fidélité sont dans la
 * page ; son numéro appartient au restaurateur. On n'enlève rien, on ajoute.
 *
 * VÉRIFIÉ CONTRE LA DOCUMENTATION GOOGLE (support.google.com/business/
 * answer/10842217, consultée le 20/08/2026) : un établissement peut ajouter ses
 * propres liens de commande et les marquer comme préférés. La fiche porte donc
 * les DEUX — celui des plateformes et le sien, préféré. On ne prête aucun délai
 * à Google, qui n'en publie pas.
 *
 * LES PRIX SONT ÉCRITS ICI, pas renvoyés à un devis. Un service dont le prix se
 * demande est un service qu'on ne demande pas.
 */
export const SERVICES: readonly Service[] = [
  {
    id: "google",
    title: "Votre visibilité sur Google",
    lead: "Vos clients vous trouvent sur Google. Offrez-leur aussi le choix de commander en direct.",
    line: "On ajoute votre lien de commande sur votre fiche, à côté de ceux des plateformes et marqué « préféré par l'établissement ». Uber Eats et Deliveroo continuent de vous apporter des clients que vous n'auriez pas eus, et de porter les sacs. Votre page, elle, retient ceux qui reviennent.",
    price: "Compris dans la mise en route",
  },
  {
    id: "identite",
    title: "Votre identité visuelle",
    lead: "Une enseigne qui a l'air de ce qu'elle vaut.",
    line: "Logo, palette, carte remise en forme et photographiée : on reprend votre identité et on la pose partout — page de commande, écrans de salle, sacs, réseaux. Beaucoup de très bons snacks se vendent moins bien que leur cuisine, et ça se corrige.",
    price: "499 €, une fois",
  },
  {
    id: "commande",
    title: "Votre page de commande",
    lead: "Vos prix de la carte, et un client qui revient.",
    line: "Un habitué qui commande chez vous en direct paie le prix affiché en salle — pas celui qu'il faut gonfler pour absorber 30 % de commission et des frais de service. Les points de fidélité sont dans la page, et le client est le vôtre : son numéro, son historique, ses habitudes. En ligne dès l'ouverture du compte, à vos couleurs, sur votre nom de domaine si vous en avez un — ou branchée sur le site que vous avez déjà, avec une balise que nous collons pour vous.",
    price: "Compris dans l'abonnement",
  },
];

/**
 * LA CLAUSE D'HONNÊTETÉ, EN PIED DE SECTION.
 *
 * Le tunnel va du panier au créneau de retrait (`components/order/Checkout`) :
 * c'est du click & collect, et NOUS NE FOURNISSONS AUCUN LIVREUR. On le dit
 * ici, à l'endroit exact où le lecteur vient de comprendre qu'il peut reprendre
 * son volume aux plateformes — c'est là et nulle part ailleurs qu'il se demande
 * qui va porter les sacs.
 *
 * Ce n'est pas une pastille de fonctionnalité : une pastille se lit comme
 * quelque chose qu'on fournit.
 */
export const DIRECT_DELIVERY = {
  lead: "Vous livrez ?",
  line: "Vous continuez comme aujourd'hui — vos tournées, vos horaires. Personne ne s'intercale entre votre cuisine et votre client.",
} as const;

/* ── 5. Matériel — ce qu'on ne rachète pas ───────────────────── */

export type HardwareItem = {
  /** Sert à choisir le pictogramme dans `icons.tsx` — aucun emoji, la charte ne bouge pas. */
  id: "tablette" | "imprimante" | "ecran" | "reseau";
  label: string;
  /** SIX MOTS. Pas une phrase de brochure, pas deux lignes : six mots. */
  line: string;
};

/**
 * QUATRE PICTOGRAMMES, QUATRE LIGNES, ZÉRO PROSE.
 *
 * « Est-ce que ça marche chez MOI ? » est la question qui bloque le plus, et
 * la page n'y répondait qu'en sixième et huitième position d'un accordéon.
 * Elle est PROMUE hors de la FAQ, juste après la démonstration : la question se
 * pose exactement une fois dans le parcours, à cet endroit-là.
 *
 * C'est aussi la respiration la plus courte de la page, posée juste avant la
 * plus commerciale. Toute phrase ajoutée ici la détruit.
 */
export const HARDWARE: readonly HardwareItem[] = [
  { id: "tablette", label: "Tablette Android ou iPad", line: "Le vôtre. Aucun matériel propriétaire." },
  { id: "imprimante", label: "Imprimante ticket 80 mm", line: "En réseau. Ticket cuisine et sticker." },
  { id: "ecran", label: "Écran cuisine", line: "Une TV ou un moniteur mural." },
  { id: "reseau", label: "Connexion internet", line: "Une box suffit. Fibre non requise." },
] as const;

/**
 * LE HORS-LIGNE — un demi-titre, pas une cinquième ligne.
 *
 * C'est notre vrai différenciant, il est implémenté (voir la colonne Cuisine de
 * `CATALOGUE`), et il était absent du hero, de Platform et du comparatif. Le
 * ranger dans une pastille de fonctionnalité serait le gâcher.
 */
export const HARDWARE_OFFLINE = {
  lead: "Et si le réseau tombe ?",
  line: "La caisse et la cuisine continuent en local : les tickets restent affichés et s'impriment. Tout se resynchronise au retour du réseau.",
} as const;

/* ── 6. Tarifs — les commissions, puis la grille ─────────────── */

/**
 * LE TABLEAU DES COMMISSIONS, EN TÊTE DE SECTION — trois lignes, et AUCUNE
 * phrase de plaidoyer autour. L'adjacence fait tout le travail.
 *
 * « Jusqu'à 30 % » et non « 30 % » : les taux varient selon le contrat et selon
 * qu'il s'agit de livraison ou de retrait. Annoncer un taux ferme qu'on n'a pas
 * vérifié, c'est offrir à un restaurateur l'occasion de nous corriger — et de
 * douter du reste.
 *
 * La troisième ligne est l'ancienne note de bas de section. L'AFFICHER
 * NOUS-MÊMES, au même rang que les deux autres, prouve qu'on ne dissimule
 * rien : un restaurateur qui compare 1,5 % à 30 % se convainc tout seul. Une
 * note qu'on soupçonne d'être cachée vend contre nous.
 */
export const COMMISSIONS = [
  { who: "Snack Manager", rate: "0 %", note: "un abonnement mensuel, rien de prélevé sur vos commandes" },
  { who: "Les plateformes", rate: "jusqu'à 30 %", note: "sur chaque commande livrée, et le client reste le leur" },
  { who: "Encaissement carte", rate: "≈ 1,5 %", note: "votre prestataire de paiement — cet argent ne nous revient pas" },
] as const;

/**
 * LA LISTE DE MODULES EST UNIQUE, ET C'EST TOUTE LA REFONTE DE LA GRILLE.
 *
 * Les trois colonnes portaient des listes CUMULATIVES (« Tout Starter,
 * plus : ») de quatre, cinq et trois lignes : le lecteur comparait des listes
 * de longueurs différentes et devait reconstruire de tête ce que chacune
 * contenait. Il lit désormais la MÊME liste trois fois, avec une pastille
 * pleine ou vide par ligne. Il n'a plus qu'une chose à trouver : où s'arrête
 * sa colonne.
 */
export type PlanModule = { id: string; label: string };

export const PLAN_MODULES: readonly PlanModule[] = [
  { id: "pos", label: "Caisse (POS)" },
  { id: "kds", label: "Écran cuisine (KDS)" },
  { id: "print", label: "Ticket cuisine & sticker sac" },
  { id: "offline", label: "Mode hors-ligne" },
  { id: "bo", label: "Back-office : CA, commandes, exports CSV" },
  { id: "menu", label: "Menu & prix en direct" },
  { id: "planning", label: "Planning, pointage & coût de la semaine" },
  { id: "stocks", label: "Ingrédients, stocks & coût matière" },
  { id: "online", label: "Commande en ligne & click and collect" },
  { id: "loyalty", label: "Fidélité, codes promo & comptes clients" },
  { id: "priority", label: "Support prioritaire" },
] as const;

export type Plan = {
  id: string;
  name: string;
  /** Le PRIX, affiché. Plus jamais « Sur devis ». */
  price: string;
  period: string;
  desc: string;
  /** Les `id` de `PLAN_MODULES` inclus dans la formule. */
  modules: readonly string[];
  popular?: boolean;
};

/**
 * TROIS PRIX AFFICHÉS, ET « MULTI-SITES » QUITTE LA GRILLE.
 *
 * Les trois « Sur devis » forçaient la conversation ; combinés à « 7 places
 * restantes », ils produisaient de la pression sans information — exactement
 * le contraire de la confiance que la page passe dix sections à construire.
 * Le coût est assumé : un prospect peut s'auto-éliminer sans nous parler, et
 * un concurrent lit notre grille en trente secondes.
 *
 * « Multi-sites » sort parce que nous n'avons pas un client, encore moins un
 * groupe. Un exploitant à trois adresses ne voit plus rien qui lui soit
 * adressé, et c'est honnête.
 */
export const PLANS: Plan[] = [
  {
    id: "essentiel",
    name: "Essentiel",
    price: "89 €",
    period: "par mois",
    desc: "La caisse, la cuisine et le back-office. De quoi tenir un service.",
    modules: ["pos", "kds", "print", "offline", "bo", "menu"],
  },
  {
    id: "complet",
    name: "Complet",
    price: "139 €",
    period: "par mois",
    desc: "Tout l'Essentiel, plus ce qui fait décider : le planning et le coût matière.",
    modules: ["pos", "kds", "print", "offline", "bo", "menu", "planning", "stocks"],
    popular: true,
  },
  {
    id: "boost",
    name: "Boost",
    price: "189 €",
    period: "par mois",
    desc: "Tout, commande en ligne comprise. Vos clients commandent chez vous.",
    modules: [
      "pos",
      "kds",
      "print",
      "offline",
      "bo",
      "menu",
      "planning",
      "stocks",
      "online",
      "loyalty",
      "priority",
    ],
  },
];

/**
 * LE MODULE VENDU À PART, ET SON LIBELLÉ EST UNE DÉCISION.
 *
 * Il s'affiche « Commande en ligne & click and collect », JAMAIS
 * « Livraison » : le mot Livraison en face d'un prix se lit comme un livreur
 * qu'on facture, et nous ne fournissons aucun livreur.
 */
export const MODULE_ADDON = {
  name: "Commande en ligne & click and collect",
  price: "79 € par mois",
  line: "Se branche sur Essentiel ou sur Complet. Déjà inclus dans Boost.",
} as const;

/**
 * L'ADDITION, ÉCRITE FRANCHEMENT — on ne la laisse pas découvrir.
 *
 * Complet + le module font 218 €, Boost en coûte 189 : vingt-neuf euros de
 * moins. Un prospect qui fait ce calcul tout seul après avoir lu la grille se
 * demande pourquoi on ne le lui a pas dit. Quatre nombres, tous les nôtres,
 * aucune hypothèse de marché : l'addition est désamorcée avant d'être faite.
 */
export const PRICING_MATH = {
  left: "Complet 139 € + le module 79 €",
  sum: "218 €",
  right: "Boost",
  boost: "189 €",
  save: "− 29 €",
  line: "Au-delà du Complet, Boost coûte 29 € de moins que le Complet plus le module.",
} as const;

/**
 * L'ASTÉRISQUE DU « 0 % », en note discrète sous la grille.
 *
 * Elle dit la chose qu'un restaurateur découvrirait autrement sur son premier
 * relevé, et un mensonge par omission au premier relevé coûte le client entier.
 * « Environ 1,5 % » et non un taux ferme : il dépend du prestataire de paiement
 * et de la carte présentée, et nous ne le fixons pas.
 */
export const PRICING_FOOTNOTE =
  "* Aucune commission sur vos ventes. Seuls s'appliquent les frais d'encaissement de votre prestataire de paiement — environ 1,5 % par transaction carte — que vous régleriez avec n'importe quelle solution de paiement en ligne.";

/* ── 7. Le calcul — simulateur ───────────────────────────────── */

/**
 * LES DEUX LIGNES AU-DESSUS DES CURSEURS — ce qui reste d'Intro.
 *
 * La phrase la plus forte de la page était posée seule sur un filigrane géant,
 * sans une preuve à portée de regard. Elle devient l'affirmation immédiatement
 * suivie du calcul qui la produit.
 *
 * DEUX MOTS SONT TOMBÉS, ET CHACUN POUR SA RAISON. « Parfois deux » ne sort
 * d'aucun calcul et n'a été constaté chez personne. « On enlève un poste » est
 * écarté délibérément : chez un patron de snack, ce poste c'est souvent sa
 * belle-sœur au comptoir, et « enlever un poste » sonne comme un consultant qui
 * vient conseiller un licenciement.
 */
export const SIM_LEAD = {
  title: "On n'ajoute pas un outil.",
  line: "On vous rend les heures que votre organisation vous prend.",
} as const;

/**
 * L'AMORCE, RAMENÉE DE SOIXANTE MOTS À DEUX LIGNES, ses deux montants sortis
 * en cases de chiffres — ils se lisaient noyés au milieu d'un paragraphe.
 */
export const SIM_ESC = {
  line: "Une commande mal relue, c'est un plat refait. Deux par service, midi et soir, 7 j/7.",
  figures: [
    { fig: "≈ 5,75 €", label: "le plat qu'on refait" },
    { fig: "≈ 700 €", label: "par mois, à la poubelle" },
  ],
} as const;

/**
 * LES DEUX HYPOTHÈSES EXTÉRIEURES, EN CORPS DE TEXTE SOUS LES CURSEURS —
 * jamais en nombres géants au-dessus.
 *
 * C'est tout ce qui survit de ProofBand, et elle était innocente du crime dont
 * on l'accusait : c'est la seule section qui citait une source extérieure, elle
 * ne plaidait pas. Son tort était sa POSITION — cent pixels au-dessus du
 * simulateur, à qui elle volait ses deux chiffres. Les remonter en nombres
 * géants ici, ce serait la reconstruire à l'intérieur de la section qui l'a
 * exécutée.
 *
 * LE +15 % A QUITTÉ LE CALCUL. Il s'annonçait « bas de fourchette des études » ;
 * vérification faite, les seules sources qui l'avancent (15 à 30 %) sont des
 * éditeurs qui vendent la même chose que nous. Citer un vendeur pour appuyer une
 * vente ne prouve rien. Or ce taux pesait 61 % du chiffre annuel affiché : il ne
 * reste donc plus une seule hypothèse maison dans le total.
 *
 * ET ON NE LE RACONTE PAS. Un bloc ouvert titrait un temps « le seul chiffre que
 * nous n'avons pas mesuré nous-mêmes » et détaillait ce qu'on avait refusé de
 * compter. Chaque phrase était exacte, l'ensemble sonnait faux : devancer une
 * objection que personne n'a formulée, c'est s'accuser tout seul. Il ne reste que
 * ce dépliable — disponible pour qui cherche, silencieux pour les autres.
 */
export const SIM_NOTES =
  "Hypothèses prudentes, ajustées ensemble en démo : coût horaire chargé 13 €/h (SMIC restauration 2026 + charges) · commande refaite ≈ 50 % du panier · appel ≈ 3 min + 1 min d'interruption/reprise de poste, 60 % des appels migrent en ligne · erreurs −35 % (Deliverect, 2023) · 2 services/jour, 30,4 jours/mois.";

/**
 * LA PHRASE QUI RECOUD LA PAGE.
 *
 * C'est le SEUL endroit où une section en cite une autre, et c'est le modèle
 * qui remplace la redondance supprimée : les sections ne se répètent plus,
 * elles se citent. Elle est reprise à l'identique dans `CONTACT_POINTS`.
 */
export const SIM_CTA_NOTE = "On repart avec vos chiffres.";

/* ── 8. Lancement — les jalons ───────────────────────────────── */

export type Milestone = {
  /** La DATE, et elle porte sur ce que NOUS livrons. */
  when: string;
  title: string;
  /** Deux lignes, pas trois. */
  lines: readonly [string, string];
};

/**
 * ON DATE CE QU'ON LIVRE, JAMAIS CE QUE LE CLIENT GAGNERA.
 *
 * C'est la seule réponse honnête possible au « +30 % en 60 jours » du
 * concurrent, et la seule qui tienne sans un client : une date que nous tenons
 * SEULS ne peut être démentie que par nous. Aucun de ces quatre jalons ne
 * dépend du marché, de la saison ou de la clientèle du restaurateur.
 *
 * Le fond de PROC_TEXTS survit ici — on observe, on configure, on reste — mais
 * il change de forme : Process était écrit comme une frise et rendu comme trois
 * cartes identiques à celles qui l'entouraient. On lui rend sa forme.
 */
export const MILESTONES: readonly Milestone[] = [
  {
    when: "Jour 1",
    title: "La démonstration",
    lines: ["Trente minutes, chez vous ou en visio.", "On repart avec vos chiffres du simulateur."],
  },
  {
    when: "Semaine 1",
    title: "La configuration",
    lines: ["Menu, équipe, couleurs, moyens de paiement, imprimante.", "C'est nous qui la faisons, pas vous."],
  },
  {
    when: "Jour d'ouverture",
    title: "On est là",
    lines: ["Midi et soir, dans votre cuisine.", "Le premier service se passe avec nous."],
  },
  {
    when: "Ensuite",
    title: "On reste",
    lines: ["Mises à jour incluses, support, corrections.", "Vos données exportables quand vous voulez."],
  },
] as const;

/* ── 9. FAQ ──────────────────────────────────────────────────── */

/**
 * HUIT ENTRÉES RAMENÉES À CINQ, ET L'ACCORDÉON CESSE D'ÊTRE UN PLACARD.
 *
 * Trois questions sont PROMUES dans leur section — matériel et hors-ligne en
 * section 5, délai de mise en route en section 8 — parce qu'elles se posent à
 * un endroit précis du parcours et pas à la fin. Une quatrième (« Puis-je
 * garder mon site actuel ? ») est absorbée par la troisième rangée des canaux.
 * La cinquième (« C'est quoi, une marque virtuelle ? ») part avec les marques
 * blanches, reportées hors de la landing.
 *
 * Deux entrées neuves, et les deux disent ce qu'on préférerait taire. « Vous
 * avez combien de clients ? » est l'objection numéro un d'un produit jeune :
 * l'écrire nous-mêmes vaut mieux que de la laisser découvrir — c'est exactement
 * ce que le compteur « 3 places prises » essayait de cacher. « Est-ce que vous
 * livrez ? » ferme la porte que toute la page laisse entrouverte.
 */
export const FAQ = [
  {
    q: "C'est adapté à quel type de restaurant ?",
    a: "Pensé pour les fast-foods et snacks indépendants — sur place, à emporter ou en click & collect.",
  },
  {
    q: "Vous avez combien de clients ?",
    a: "Un. Class'Food, à Perriers-sur-Andelle, en service 7 j/7 : c'est notre restaurant pilote, et chaque écran y est testé midi et soir. Nous ouvrons dix places de lancement — vous seriez parmi les dix premiers, et vous gardez votre tarif à vie.",
  },
  {
    q: "Y a-t-il un engagement de durée ?",
    // La réponse d'hier (« on vous détaille les conditions au moment du devis »)
    // contredisait le hero qui affichait « Sans engagement ». On affiche la
    // constante, pas une reformulation : c'est ce qui garantit qu'elle ne
    // divergera plus du bandeau tarifaire.
    a: ENGAGEMENT,
  },
  {
    q: "Est-ce que vous livrez ?",
    a: "Non, et nous n'avons jamais eu l'intention de le faire. Le tunnel de commande s'arrête au créneau de retrait. La livraison, quand il y en a une, reste la vôtre — vos tournées, vos horaires.",
  },
  {
    q: "À qui appartiennent mes données ?",
    a: "À vous. Ventes, clients, menus : tout est exportable à tout moment (CSV), hébergé en Europe.",
  },
] as const;

/* ── 10. Le pilote — né au comptoir ──────────────────────────── */

/**
 * LA CITATION RACONTE UNE RENCONTRE, PLUS UNE ORIGINE.
 *
 * Elle disait « Snack Manager est né derrière le comptoir de notre restaurant
 * pilote » : l'outil au centre, au moment précis où le lecteur cherche des
 * gens. Ce qu'il veut savoir avant de laisser son numéro, c'est à QUI il le
 * laisse — et la réponse est deux métiers qui se sont trouvés, pas un logiciel
 * qui a poussé tout seul.
 *
 * Elle a perdu au passage sa première moitié d'origine (« tickets perdus en
 * plein rush, téléphone qui sonne pendant l'encaissement ») : la section 2 dit
 * les douleurs une fois pour toutes.
 */
export const FOUNDER_QUOTE =
  "« D'un côté, un restaurateur qui tient son snack et connaît chaque friction du service par cœur. De l'autre, un expert de la tech. On s'est rencontrés, on a regardé le problème ensemble, et on a construit l'outil qui manquait. Chaque écran est testé en service réel, midi et soir, avant d'arriver chez vous. »";

/**
 * LES PHOTOS — UN CÂBLAGE CASSÉ, PAS UN MANQUE D'IMAGES.
 *
 * Sept des huit chemins référencés ici pointaient sur des fichiers ABSENTS du
 * disque (sandwichs1.jpeg, tacos.jpeg, classiques.jpeg, paninis.jpeg,
 * salades-barquettes.jpeg, enfant-glaces.jpeg, sandwichs3.jpeg) : trois
 * sections rendaient sept cartouches sombres par le repli de `Photo.tsx`, sans
 * que personne s'en aperçoive. `public/photos` contient dix-sept images
 * réelles ; on repointe au lieu de supprimer.
 *
 * ATTENTION — CE QUE CES PHOTOS SONT, ET CE QU'ELLES NE SONT PAS. Ce sont les visuels de
 * la CARTE du restaurant pilote, pas des photos de sa salle ni de son équipe.
 * Les textes alternatifs le disent exactement, et aucune légende de composant
 * ne doit les présenter comme une preuve d'exploitation : la preuve, c'est la
 * commune nommée et la démonstration manipulable, pas un plat photographié.
 */
export const FOUNDER_PHOTO: Shot = {
  src: "/photos/tacos-gratine-hero.png",
  alt: "Le tacos gratiné, produit signature de la carte du restaurant pilote Class'Food",
};

/** Le collage qui accompagne la citation — deux visuels de la carte du pilote. */
export const PILOTE_PHOTOS: Shot[] = [
  { src: "/photos/smash-burger.png", alt: "Le smash burger de la carte du restaurant pilote Class'Food" },
  { src: "/photos/panini-menu.png", alt: "Le panini en formule menu, sur la carte du restaurant pilote Class'Food" },
];

/**
 * UN SEUL FAIT. Les deux autres (« Rodé sur de vrais rushs », « Amélioré chaque
 * semaine ») sont déjà dans la citation, mot pour mot ou presque.
 */
export const FOUNDER_FACTS = ["Testé en service réel 7 j/7"] as const;

/* ── 11. Contact ─────────────────────────────────────────────── */

export const CALLBACK_SLOTS = [
  { value: "matin", label: "Plutôt le matin" },
  { value: "entre-services", label: "Entre les services (14h–18h)" },
  { value: "apres-21h", label: "Après 21h" },
] as const;

/**
 * LES TROIS POINTS À GAUCHE DU FORMULAIRE, compteur de places retiré.
 *
 * Le deuxième est repris à l'identique de `SIM_CTA_NOTE` : c'est la couture
 * qui remplace la redondance supprimée.
 */
export const CONTACT_POINTS = [
  "On vous rappelle sous 24 h ouvrées",
  "On repart avec vos chiffres du simulateur",
  FOUNDER_POLICY,
] as const;

/**
 * LÀ OÙ ATTERRIT LE SERVICE À 99 € — une case à cocher, et rien d'autre.
 *
 * « Voulez-vous qu'on améliore vos pages Uber Eats et Deliveroo ? » n'est pas
 * une question que le visiteur se pose sur cette page : celui qui est sur les
 * plateformes est venu voir comment s'en affranchir, celui qui n'y est pas ne
 * comprend pas de quoi on parle. Mais le formulaire est le seul endroit où
 * c'est NOUS qui posons les questions — et une question qu'on pose devient
 * légitime.
 *
 * SANS PRIX, SANS PROMESSE, SANS DÉLAI. Le « +30 % à 60 jours » est un chiffre
 * de RÉSULTAT sur ZÉRO client, et c'est mot pour mot ce que le concurrent
 * publie comme résultat observé : côte à côte, notre page se lisait comme sa
 * copie sans sa preuve.
 *
 * `help` n'est pas décoratif : une case sans motif est une friction, une case
 * avec sa phrase est une question.
 */
export const CONTACT_PLATFORMS = {
  name: "platforms",
  label: "Vous vendez déjà sur Uber Eats ou Deliveroo ?",
  help: "On regarde vos pages avec vous pendant l'appel.",
} as const;
