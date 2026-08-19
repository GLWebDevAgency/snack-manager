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

export const TICKER = ["Cuisine (KDS)", "Caisse (POS)", "Back-office", "Site & commande"] as const;

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

/* ── Catalogue app par app ───────────────────────────────────── */

export type CatalogueColumn = {
  name: string;
  device: string;
  /** `demo` pointe vers l'index de la scène 3D. */
  demo: number;
  demoLabel: string;
  items: { pre?: string; strong?: string; post?: string }[];
};

export const CATALOGUE: CatalogueColumn[] = [
  {
    name: "Caisse (POS)",
    device: "Tablette, au comptoir",
    demo: 1,
    demoLabel: "Essayer la caisse en démo →",
    items: [
      { strong: "Sur place, à emporter, téléphone", post: " — même écran" },
      { pre: "Config express : recette (Complet, ST, SO, SC…), sauces, tailles" },
      { pre: "Tacos sur-mesure : taille, viandes, gratiné, suppléments" },
      { pre: "Passage en menu (+2,50 €) en un tap" },
      { pre: "Totaux et rendu monnaie automatiques" },
      { strong: "Ticket cuisine + sticker sac", post: " imprimés" },
      { pre: "Lignes identiques cumulées, note par produit" },
      { pre: "CB, espèces, paiement au retrait" },
    ],
  },
  {
    name: "Cuisine (KDS)",
    device: "Tablette & téléphone",
    demo: 2,
    demoLabel: "Essayer la cuisine en démo →",
    items: [
      { pre: "Colonnes ", strong: "Nouveau → En prépa → Prêt" },
      { pre: "« À lancer » agrégé : 3 frites, 2 tacos… en un coup d'œil" },
      { pre: "Minuteur couleur par commande, seuils d'alerte" },
      { pre: "Alerte sonore à chaque nouvelle commande" },
      { pre: "Chaque article cochable pendant la prépa" },
      { pre: "Numéro de retrait pour appeler le client" },
      { pre: "Thème sombre ou clair, pensé pour la cuisine" },
      { pre: "Mode hors-ligne avec resynchronisation" },
    ],
  },
  {
    name: "Commande en ligne",
    device: "Web, mobile first",
    demo: 3,
    demoLabel: "Essayer la commande en démo →",
    items: [
      { strong: "Click & collect", post: " avec créneaux de retrait" },
      { pre: "Paiement en ligne ou au retrait" },
      { pre: "Configurateur identique à la caisse — zéro surprise" },
      { pre: "Panier modifiable ligne par ligne" },
      { pre: "Codes promo, fidélité points & tampons" },
      { pre: "Compte client, historique, recommande en 1 tap" },
      { pre: "Suivi de commande en direct (reçue → prête)" },
      { strong: "À vos couleurs", post: " : logo, nom, identité complète" },
    ],
  },
  {
    name: "Back-office",
    device: "Web, côté gérant",
    demo: 0,
    demoLabel: "Essayer le back-office en démo →",
    items: [
      { strong: "CA & commandes en temps réel" },
      { pre: "Menu & prix : édition en direct, import CSV/XML" },
      { pre: "Catégories en drag & drop, ruptures en un tap" },
      { pre: "Stats : top ventes, affluence par heure, canaux" },
      { pre: "Promos, codes et produits mis en avant" },
      { pre: "Horaires, créneaux, fermetures exceptionnelles" },
      { strong: "Pointage & heures", post: " de l'équipe" },
      { pre: "Avis clients et réponses publiques" },
    ],
  },
];

/* ── Scène de démonstration 3D ───────────────────────────────── */

export type DemoApp = {
  id: string;
  label: string;
  shot: Shot;
  lead: string;
  body: string;
  chips: string[];
};

export const DEMO_APPS: DemoApp[] = [
  {
    id: "bo",
    label: "Back-office",
    shot: { src: "/shots/backoffice.png", alt: "Back-office : CA du jour, commandes en direct, prévisions du service" },
    lead: "Back-office gérant.",
    body: " Menu & prix modifiables en direct, CA du jour, ruptures, promos, pointage et heures de l'équipe — toute la gestion au même endroit.",
    chips: ["Import CSV/XML", "Pointage équipe", "Stats & CA"],
  },
  {
    id: "pos",
    label: "Caisse (POS)",
    shot: { src: "/shots/pos.png", alt: "Caisse : catalogue, configurateur produit et ticket en cours" },
    lead: "Caisse.",
    body: " Menus cadrés, totaux automatiques, ticket cuisine et sticker sac imprimés — prise en main en une heure, même pour une nouvelle recrue.",
    chips: ["Config express", "Ticket + sticker sac", "Sur place & téléphone"],
  },
  {
    id: "kds",
    label: "Cuisine (KDS)",
    shot: { src: "/shots/kds.png", alt: "App cuisine : colonnes Nouveau, En préparation, Prêt avec minuteurs" },
    lead: "Cuisine.",
    body: " Les commandes arrivent seules, « 3 frites à lancer » en un coup d'œil, statuts Nouveau → En prépa → Prêt, minuteurs et alerte sonore.",
    chips: ["À lancer agrégé", "Minuteurs couleur", "Alerte sonore"],
  },
  {
    id: "order",
    label: "Commande client",
    shot: { src: "/shots/commande.png", alt: "Commande en ligne sur mobile : carte du restaurant et panier", portrait: true },
    lead: "Commande en ligne.",
    body: " Le client commande et paie — le ticket file droit en cuisine, déjà encaissé. La caisse ne fait que remettre le sac.",
    chips: ["Créneaux de retrait", "Fidélité & promos", "Paiement en ligne"],
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
  "Plannings et heures à la main",
  "Site figé, pas de click & collect",
] as const;

export const VS_WITH = [
  "Une seule plateforme, tout connecté",
  "Menus cadrés, totaux automatiques, ticket + sticker sac",
  "Caisse prise en main en une heure",
  "Pointage & plannings automatisés",
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
    features: ["Site & commande en ligne", "Fidélité & codes promo", "Module RH (pointage, planning)", "Support prioritaire"],
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
