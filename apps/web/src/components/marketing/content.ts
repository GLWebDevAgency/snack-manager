/**
 * Copy du site vitrine — source unique, en français.
 *
 * Les textes proviennent de docs/specs/site-vitrine.md (§4.x) et
 * docs/specs/contraintes-business.md (§6 offres, §5 conformité, FAQ).
 * Les montants publics (79–139 €/mois) suivent le brief fondateur.
 */

import type { MkIconName } from "./icons";

export const CONTACT_EMAIL = "contact@snackmanager.fr";
export const FOUNDER_SEATS_TOTAL = 10;
export const FOUNDER_SEATS_TAKEN = 3;
export const FOUNDER_SEATS_LEFT = FOUNDER_SEATS_TOTAL - FOUNDER_SEATS_TAKEN;

export const NAV = [
  { href: "#produit", label: "Produit" },
  { href: "#site", label: "Votre site" },
  { href: "#offre", label: "L'offre" },
  { href: "#tarifs", label: "Tarifs" },
  { href: "#faq", label: "FAQ" },
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

/* ── Les 4 modules ───────────────────────────────────────────── */

export type ModuleKey = "pos" | "kds" | "shop" | "backoffice";

/** Une puce de fonctionnalité : `a` + **`b`** + `c` (le gras met le bénéfice en avant). */
export type Feature = { a?: string; b?: string; c?: string };

export type ModuleDef = {
  key: ModuleKey;
  tab: string;
  icon: MkIconName;
  name: string;
  device: string;
  pitch: string;
  features: Feature[];
};

export const MODULES: ModuleDef[] = [
  {
    key: "pos",
    tab: "Caisse",
    icon: "register",
    name: "Caisse (POS)",
    device: "Tablette, au comptoir",
    pitch:
      "Menus cadrés, totaux automatiques, ticket cuisine et sticker sac imprimés. Une nouvelle recrue la prend en main en une heure — plus en trois jours.",
    features: [
      { b: "Sur place, à emporter, téléphone", c: " — le même écran" },
      { a: "Config express : recette (Complet, ST, SO, SC…), sauces, tailles" },
      { a: "Tacos sur-mesure : taille, viandes, gratiné, suppléments" },
      { a: "Passage en menu (+2,50 €) en un tap" },
      { a: "Totaux et rendu monnaie automatiques" },
      { b: "Ticket cuisine + sticker sac", c: " imprimés à l'acceptation" },
      { a: "Lignes identiques cumulées, note par produit" },
      { a: "Mode hors-ligne : le service se termine même sans internet" },
    ],
  },
  {
    key: "kds",
    tab: "Cuisine",
    icon: "kitchen",
    name: "Cuisine (KDS)",
    device: "Tablette & téléphone",
    pitch:
      "Les commandes arrivent seules, « 3 frites à lancer » en un coup d'œil. Plus de papier à déchiffrer en plein coup de feu, plus de ticket perdu sous le plan de travail.",
    features: [
      { a: "Colonnes ", b: "Nouveau → En prépa → Prêt" },
      { b: "« À lancer » agrégé", c: " : 3 frites, 2 tacos… en un coup d'œil" },
      { a: "Minuteur couleur par commande : vert < 5 min, ambre < 10, rouge au-delà" },
      { a: "Alerte sonore à chaque nouvelle commande" },
      { a: "Chaque article cochable pendant la préparation" },
      { a: "Numéro de retrait pour appeler le client" },
      { a: "Thème sombre ou clair, pensé pour la cuisine" },
      { a: "Mode hors-ligne avec resynchronisation automatique" },
    ],
  },
  {
    key: "shop",
    tab: "Commande en ligne",
    icon: "phoneOrder",
    name: "Commande en ligne",
    device: "Web, mobile first",
    pitch:
      "Le client commande et paie — le ticket file droit en cuisine, déjà encaissé. La caisse ne fait que remettre le sac : personne ne quitte son poste pour décrocher le téléphone.",
    features: [
      { b: "Click & collect", c: " avec créneaux de retrait" },
      { b: "0 % de commission", c: " sur chaque commande en direct" },
      { a: "Paiement en ligne (CB) ou au retrait" },
      { a: "Configurateur identique à la caisse — zéro surprise" },
      { a: "Codes promo, fidélité points & tampons" },
      { a: "Compte client, historique, recommande en 1 tap" },
      { a: "Suivi de commande en direct (reçue → prête)" },
      { b: "À vos couleurs", c: " : logo, nom, identité complète" },
    ],
  },
  {
    key: "backoffice",
    tab: "Back-office",
    icon: "chart",
    name: "Back-office",
    device: "Web, côté gérant",
    pitch:
      "Le poste de pilotage du gérant : ce qui rentre, ce qui manque, qui travaille quand. Un changement de prix est appliqué partout en 30 secondes — caisse, cuisine, commande en ligne.",
    features: [
      { b: "CA & commandes en temps réel" },
      { a: "Menu & prix : édition en direct, import CSV/XML" },
      { a: "Catégories en drag & drop, ruptures en un tap" },
      { a: "Stats : top ventes, affluence par heure, canaux" },
      { a: "Promos, codes et produits mis en avant" },
      { a: "Horaires, créneaux, fermetures exceptionnelles" },
      { b: "Pointage & heures", c: " de l'équipe" },
      { a: "Avis clients et réponses publiques" },
    ],
  },
];

/* ── Widget site existant ────────────────────────────────────── */

/**
 * Extrait affiché sur la landing. Il doit rester STRICTEMENT identique au
 * contrat du chargeur réel (`apps/web/public/w.js` : attribut `data-tenant`,
 * options `data-color`, `data-label`, `data-position`, `data-target`).
 */
export const WIDGET_SNIPPET =
  '<script src="https://app.snackmanager.fr/w.js"\n        data-tenant="votre-restaurant" defer></script>';

export const WIDGET_POINTS = [
  {
    title: "Votre site reste le vôtre",
    text: "WordPress, Wix, Squarespace, Shopify ou du HTML fait maison : le widget se colle dans le pied de page et s'ouvre par-dessus. Aucune refonte, aucune migration de domaine.",
  },
  {
    title: "La commande complète, pas un lien sortant",
    text: "Carte, configurateurs, créneaux de retrait, paiement CB, fidélité : tout se passe sur votre page. Le client ne part jamais chez un intermédiaire.",
  },
  {
    title: "0 % de commission",
    text: "Chaque commande passée par le widget vous revient entière. Le ticket tombe en cuisine et au back-office comme s'il venait de la caisse.",
  },
  {
    title: "À vos couleurs, en 5 minutes",
    text: "Logo, nom, couleur d'accent : le widget prend l'identité du restaurant. Bouton flottant, ou inséré directement dans la page de votre choix. Votre référencement n'est pas touché — le widget se charge après la page.",
  },
] as const;

export const WIDGET_PLATFORMS = ["WordPress", "Wix", "Squarespace", "Shopify", "Webflow", "HTML statique"] as const;

/* ── Les 3 piliers de l'offre ────────────────────────────────── */

export type Pillar = {
  n: string;
  icon: MkIconName;
  title: string;
  price: string;
  priceNote?: string;
  desc: string;
  items: { b?: string; text: string }[];
  foot: string;
  cta: { label: string; href: string };
};

export const PILLARS: Pillar[] = [
  {
    n: "Pilier 1 · Logiciel",
    icon: "register",
    title: "La suite Snack Manager",
    price: "79–139 €",
    priceNote: "/mois",
    desc: "Caisse, cuisine, commande en ligne et back-office. Une seule plateforme, à vos couleurs.",
    items: [
      { b: "Les 4 apps", text: " incluses, sans module à la carte" },
      { b: "Installation 290 €", text: " — carte importée, équipe créée, matériel réglé" },
      { b: "Offre fondateur", text: " : les 10 premiers restaurants gardent leur tarif à vie" },
      { text: "Sans engagement, résiliable à tout moment" },
    ],
    foot: "Facturé au mois, même montant chaque mois, factures PDF dans votre back-office.",
    cta: { label: "Voir les tarifs", href: "#tarifs" },
  },
  {
    n: "Pilier 2 · Studio",
    icon: "sparkle",
    title: "Le studio : votre carte et votre image",
    price: "290–2 490 €",
    priceNote: "one-shot",
    desc: "Ce qu'on a fait pour notre restaurant pilote, industrialisé — photos de la carte en entrée, back-office rempli en sortie.",
    items: [
      { b: "Carte par photo en 24 h", text: " : même manuscrite — produits, prix, options, allergènes suggérés" },
      { b: "Identité visuelle complète", text: " : logo, flyer, habillage vitrine, templates réseaux (990–2 490 €)" },
      { b: "Refonte de carte & pricing", text: " : ancres, menus, ordre des sections (690–1 490 €)" },
      { text: "Options mensuelles : réponses aux avis (19 €), promos & SMS générés (29 €)" },
    ],
    foot: "L'import de carte est inclus dans les frais d'installation : c'est lui qui justifie les 290 €.",
    cta: { label: "Voir une carte importée", href: "#contact" },
  },
  {
    n: "Pilier 3 · Chiffre d'affaires",
    icon: "euro",
    title: "Du CA en plus, sans embauche",
    price: "0 €",
    priceNote: "d'entrée · 8 % des ventes",
    desc: "Même équipe, même matériel, mêmes horaires — une deuxième source de commandes qui tombe dans le même KDS.",
    items: [
      { b: "Marques virtuelles", text: " : Maki-Ya, Pastella, Wings Club, Green Bowl — 100 % halal" },
      { b: "0 € de droit d'entrée", text: ", 8 % des ventes de la marque, uniquement quand ça vend" },
      { b: "3 semaines", text: " du oui au premier ticket — recettes, formation, comptes plateformes gérés" },
      { b: "SM Boost dès 99 €/mois", text: " : on pilote votre page Uber Eats & Deliveroo (+30 % visés en 60 jours)" },
    ],
    foot: "Vous gardez votre marque principale et sa commande en ligne à 0 % — la marque virtuelle vit à côté.",
    cta: { label: "Être rappelé", href: "#contact" },
  },
];

/* ── Tarifs ──────────────────────────────────────────────────── */

export type Plan = {
  key: "essentiel" | "complet" | "multisite";
  name: string;
  price: string;
  unit: string;
  desc: string;
  popular?: boolean;
};

export const PLANS: Plan[] = [
  {
    key: "essentiel",
    name: "Essentiel",
    price: "79 €",
    unit: "/mois",
    desc: "Le comptoir équipé : caisse, cuisine et impressions. Pour un point de vente qui démarre.",
  },
  {
    key: "complet",
    name: "Complet",
    price: "119 €",
    unit: "/mois",
    desc: "Le plus choisi : tout l'Essentiel plus la commande en ligne à 0 % et le marketing.",
    popular: true,
  },
  {
    key: "multisite",
    name: "Multi-sites",
    price: "139 €",
    unit: "/mois et par établissement",
    desc: "Pour les groupes : consolidation des chiffres et compte dédié.",
  },
];

export type PlanRow = {
  label: string;
  essentiel: boolean | string;
  complet: boolean | string;
  multisite: boolean | string;
};

export const PLAN_ROWS: PlanRow[] = [
  { label: "Caisse (POS) sur tablette", essentiel: true, complet: true, multisite: true },
  { label: "App Cuisine (KDS) temps réel", essentiel: true, complet: true, multisite: true },
  { label: "Ticket cuisine & sticker sac imprimés", essentiel: true, complet: true, multisite: true },
  { label: "Mode hors-ligne caisse & cuisine", essentiel: true, complet: true, multisite: true },
  { label: "Back-office : menu, prix, ruptures, stats", essentiel: true, complet: true, multisite: true },
  { label: "Pointage & plannings de l'équipe", essentiel: true, complet: true, multisite: true },
  { label: "Commande en ligne — 0 % de commission", essentiel: false, complet: true, multisite: true },
  { label: "Widget sur votre site actuel", essentiel: false, complet: true, multisite: true },
  { label: "Fidélité, tampons & codes promo", essentiel: false, complet: true, multisite: true },
  { label: "Avis clients & réponses publiques", essentiel: false, complet: true, multisite: true },
  { label: "Tableau de bord multi-établissements", essentiel: false, complet: false, multisite: true },
  { label: "Support", essentiel: "E-mail", complet: "Prioritaire", multisite: "Compte dédié" },
  { label: "Installation & import de carte", essentiel: "290 €", complet: "290 €", multisite: "Sur devis" },
];

/* ── Comparatif ──────────────────────────────────────────────── */

export const VS_WITHOUT = [
  "Plusieurs outils qui ne se parlent pas",
  "Commandes au stylo, totaux calculés de tête",
  "Des jours de formation à chaque recrue",
  "Plannings et heures recomptés à la main",
  "Site figé, pas de click & collect",
  "20 à 30 % de commission sur chaque livraison",
];

export const VS_WITH = [
  "Une seule plateforme, tout connecté",
  "Menus cadrés, totaux automatiques, ticket + sticker sac",
  "Caisse prise en main en une heure",
  "Pointage & plannings automatisés",
  "Site & commande en ligne à vos couleurs",
  "0 % de commission sur vos commandes en direct",
];

/* ── Pilote ──────────────────────────────────────────────────── */

export const PILOT_QUOTE =
  "Snack Manager est né derrière le comptoir de notre restaurant pilote. Tickets perdus en plein rush, téléphone qui sonne pendant l'encaissement, heures recomptées à la main : on a vécu chaque problème avant de l'automatiser. Chaque écran de la plateforme est testé en service réel, midi et soir, avant d'arriver chez vous.";

export const PILOT_STATS = [
  { value: "109", label: "produits et 22 catégories gérés au quotidien" },
  { value: "2 000+", label: "commandes passées sur la plateforme" },
  { value: "107", label: "ingrédients suivis, recettes et allergènes" },
];

export const PILOT_FACTS = ["Testé en service réel 7 j/7", "Rodé sur de vrais rushs", "Amélioré chaque semaine"];

/* ── FAQ ─────────────────────────────────────────────────────── */

export const FAQ = [
  {
    q: "Dois-je changer mon matériel de caisse ?",
    a: "Non — la plateforme fonctionne sur tablette et téléphone standards. On vous conseille sur l'imprimante ticket/sticker si besoin, et on la règle le jour de l'installation.",
  },
  {
    q: "Combien de temps avant d'être opérationnel ?",
    a: "Quelques jours suffisent : votre carte est importée depuis des photos en 24 h, puis on configure l'équipe, les moyens de paiement et votre identité visuelle avant l'ouverture.",
  },
  {
    q: "Y a-t-il un engagement de durée ?",
    a: "Non. Sans engagement, résiliable à tout moment, et vous repartez avec l'intégralité de vos données — menu, historique des commandes, clients — en CSV standard. Sans engagement veut dire sans otage.",
  },
  {
    q: "Puis-je garder mon site actuel ?",
    a: "Oui. Une ligne de code à coller dans votre site existant suffit : le module de commande s'ouvre par-dessus, à vos couleurs. Si vous n'avez pas de site, on vous en fournit un complet.",
  },
  {
    q: "Et si la connexion internet coupe ?",
    a: "La caisse et la cuisine continuent en local : les tickets restent affichés et s'impriment, puis tout se resynchronise au retour du réseau. La commande en ligne affiche automatiquement « indisponible » aux clients.",
  },
  {
    q: "C'est adapté à quel type de restaurant ?",
    a: "Pensé pour les fast-foods et snacks indépendants — sur place, à emporter ou en click & collect. Un comptoir, une cuisine, du rush le midi et le soir.",
  },
  {
    q: "C'est quoi, une marque virtuelle ?",
    a: "Une marque de livraison qui existe uniquement sur Uber Eats & Deliveroo, préparée dans votre cuisine avec votre équipe. On fournit le concept, les recettes, la formation et la gestion — vous encaissez un CA que vous n'aviez pas, pour 0 € d'entrée et 8 % des ventes.",
  },
  {
    q: "À qui appartiennent mes données ?",
    a: "À vous. Ventes, clients, menus : tout est exportable à tout moment en CSV et hébergé en Europe. De notre côté, nous ne voyons que des données techniques et des agrégats anonymes — jamais votre détail sans votre accord. C'est contractuel.",
  },
  {
    q: "Vous êtes conformes RGPD et caisse certifiée ?",
    a: "Données hébergées en Europe, registre RGPD tenu, et le module d'encaissement suit les exigences françaises de la loi anti-fraude TVA — inaltérabilité, sécurisation, conservation, archivage. L'attestation est disponible dans Back-office → Abonnement.",
  },
  {
    q: "Que se passe-t-il si j'ai un problème en plein service ?",
    a: "En service (11h30–14h et 18h30–22h), on répond en moins de 5 minutes et on donne d'abord le geste qui sauve le service — l'explication vient après la fermeture. Hors service, tout ce qui touche l'argent est traité le jour même.",
  },
];

/* ── Conformité ──────────────────────────────────────────────── */

export const TRUST = [
  {
    icon: "shield" as MkIconName,
    title: "Hébergement en Europe",
    text: "Vos données et celles de vos clients restent sur des serveurs européens, avec un registre RGPD tenu à jour.",
  },
  {
    icon: "flag" as MkIconName,
    title: "Conformité caisse",
    text: "Le module d'encaissement suit les exigences de la loi anti-fraude TVA : inaltérabilité, sécurisation, conservation, archivage. Attestation téléchargeable depuis votre back-office.",
  },
  {
    icon: "download" as MkIconName,
    title: "Réversibilité totale",
    text: "Menu, historique des commandes, clients : export CSV standard à tout moment, sans demander la permission. Sans engagement veut dire sans otage.",
  },
  {
    icon: "clock" as MkIconName,
    title: "Support pendant le rush",
    text: "Réponse en moins de 5 minutes sur les créneaux de service, 7 j/7. On donne d'abord le geste qui sauve le service.",
  },
];

/* ── Contact ─────────────────────────────────────────────────── */

export const CALLBACK_SLOTS = [
  { value: "matin", label: "Plutôt le matin" },
  { value: "entre-services", label: "Entre les services (14h–18h)" },
  { value: "apres-21h", label: "Après 21h" },
] as const;
