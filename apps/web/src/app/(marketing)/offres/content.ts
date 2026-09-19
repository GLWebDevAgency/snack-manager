import type { Shot } from "@/components/marketing/content";
import { ATELIER_CENTS, INSTALL_FROM_CENTS, MODULE_MONTHLY_CENTS, MODULE_SETUP_CENTS, PLAN_MONTHLY_CENTS, euros } from "@/components/marketing/content";
import { LOYALTY_PILOT_NOTE } from "@/components/marketing/commerce-offers";

export const OFFRE_SECTIONS = [
  { id: "formules", nav: "Les suites", badge: "Trois suites", title: "Choisissez pour aujourd’hui.", lead: "Un socle commun pour le service, puis les outils de gestion et de commande dont vous avez besoin." },
  { id: "comparaison", nav: "Comparer", badge: "Le détail", title: "Ce qui est compris, offre par offre.", lead: "Les fonctions TV existantes sont comprises dans les trois suites. Les créations graphiques restent des prestations distinctes." },
  { id: "module", nav: "Applications seules", badge: "Gardez votre caisse", title: "Ajoutez un service sans tout remplacer.", lead: "Fidélité ou commande directe : chaque application comprend son espace de gestion. Dans Boost, livraison incluse après configuration et validation pilote, avec vos livreurs." },
  { id: "atelier", nav: "Menus & communication", badge: "À la carte", title: "Confiez-nous les supports de votre restaurant.", lead: "Menus papier et TV, identité, site et présence en ligne : des prestations séparées du logiciel, avec un périmètre convenu." },
  { id: "demarrage", nav: "Le coût complet", badge: "Avant de commencer", title: "Chaque ligne de votre budget est expliquée.", lead: "Le devis distingue l’abonnement, la mise en route, le matériel et les prestations. Vous connaissez le périmètre avant de décider." },
  { id: "conditions", nav: "Les conditions", badge: "Votre abonnement", title: "Un choix qui peut évoluer.", lead: "Périodicité, mise en service et changement d’offre : les conditions accompagnent le prix." },
] as const;

export const SOMMAIRE = OFFRE_SECTIONS.map(({ id, nav }) => ({ href: `#${id}`, label: nav }));

export const OFFRE_SHOTS = {
  hero: { src: "/photos/tacos-hero.webp", alt: "" },
  cta: { src: "/photos/libre/blog-telephone-main-nuit.webp", alt: "" },
} satisfies Record<string, Shot>;

export const PLAN_SUMMARIES: Record<string, { promise: string; points: readonly string[]; note: string }> = {
  essentiel: {
    promise: "Encaisser et organiser le service.",
    points: ["Caisse et écran cuisine", "Carte, prix et options administrables", "Ventes, commandes et exports disponibles", "Fonctions TV existantes"],
    note: "Planning, stocks et commande directe à ajouter selon vos besoins.",
  },
  complet: {
    promise: "Suivre votre équipe et vos coûts.",
    points: ["Tout Service, avec les fonctions TV existantes", "Planning, pointage et coût de la semaine", "Ingrédients et suivi des stocks", "Coût matière à partir de vos données"],
    note: `Ajoutez la gestion pour ${euros(PLAN_MONTHLY_CENTS.complet - PLAN_MONTHLY_CENTS.essentiel)} HT/mois de plus que Service.`,
  },
  boost: {
    promise: "Gérer et recevoir vos commandes directes.",
    points: ["Tout Gestion, avec les fonctions TV existantes", "Click & collect et page de commande", "Mise en service standard de la commande incluse", "Support prioritaire selon les modalités de l’offre"],
    note: `Ajoutez la commande directe pour ${euros(PLAN_MONTHLY_CENTS.boost - PLAN_MONTHLY_CENTS.complet)} HT/mois de plus que Gestion. Fidélité et livraison dans leur périmètre pilote.`,
  },
};

export const COMPARISON_ROWS = [
  { label: "Caisse et écran cuisine", module: "pos", included: "Inclus", excluded: "Non inclus" },
  { label: "Carte, prix, options et exports disponibles", module: "menu", included: "Inclus", excluded: "Non inclus" },
  { label: "Fonctions TV existantes", module: "pos", included: "Inclus", excluded: "Non inclus" },
  { label: "Tickets et stickers", module: "print", included: "Matériel compatible requis", excluded: "Non inclus" },
  { label: "Conservation locale des commandes de caisse", module: "offline", included: "Avec limites hors connexion", excluded: "Non inclus" },
  { label: "Planning, pointage et coût semaine", module: "planning", included: "Inclus", excluded: "Non inclus" },
  { label: "Ingrédients, stocks et coût matière renseigné", module: "stocks", included: "Inclus", excluded: "Non inclus" },
  { label: "Click & collect", module: "online", included: "Inclus", excluded: "Application distincte" },
  { label: "Mise en service standard de la commande", module: "online", included: "Incluse", excluded: `${euros(MODULE_SETUP_CENTS)} HT avec l’application` },
  { label: "Fidélité", module: "loyalty", included: "Pilote accompagné inclus", excluded: "Application en pilote" },
  { label: "Livraison par votre restaurant", module: "delivery", included: "Incluse après validation pilote", excluded: "Module distinct, validation pilote" },
  { label: "Support", module: "priority", included: "Prioritaire, selon modalités de l’offre", excluded: "Selon modalités de l’offre" },
] as const;

export const PLAN_MODULE_NOTE = {
  inclus: "Click & collect, livraison restaurant et pilote fidélité compris. La livraison nécessite configuration et validation avant ouverture.",
  supplement: `Click & collect à ${euros(MODULE_MONTHLY_CENTS)} HT/mois, mise en service standard ${euros(MODULE_SETUP_CENTS)} HT.`,
} as const;

export const MODULE_POINTS = [
  { title: "Livraison organisée par votre restaurant", line: "La livraison est incluse dans Boost sans supplément, après configuration et validation du parcours pilote. Votre restaurant fournit les livreurs et assume leurs coûts." },
  { title: "Fidélité en pilote accompagné", line: LOYALTY_PILOT_NOTE },
  { title: "Votre caisse et votre site", line: "Vous pouvez conserver vos outils. Votre site dirige vers votre page de commande ; une synchronisation automatique à une caisse tierce doit être étudiée et validée séparément." },
] as const;

export const STARTUP_ROWS = [
  { title: "Abonnement logiciel", amount: "Selon l’offre", note: "Une suite ou une application, plus les options non déjà incluses. Prix HT par établissement, au mois ou à l’année." },
  { title: "Mise en service standard", amount: `${euros(MODULE_SETUP_CENTS)} HT`, note: "Une fois pour une application autonome. La mise en service standard de la commande est comprise dans Boost." },
  { title: "Intégration à votre site existant", amount: `${euros(ATELIER_CENTS.integration)} HT`, note: `Une fois, mise en service comprise : ce montant remplace les ${euros(MODULE_SETUP_CENTS)}, ils ne s’ajoutent pas. Cette intégration n’est pas automatiquement comprise dans Boost.` },
  { title: "Matériel et installation", amount: `Dès ${euros(INSTALL_FROM_CENTS)} HT`, note: "Installation sur site selon devis. Votre matériel est vérifié avant confirmation ; achats, déplacement et configuration sont détaillés." },
  { title: "Création, impression et communication", amount: "Lignes séparées", note: "La conception est distincte de l’impression et de la livraison au coût de l’imprimeur. Les prestations de l’Atelier se choisissent à la carte." },
  { title: "Paiement et livraison des repas", amount: "Selon vos contrats", note: "Frais du prestataire de paiement et coûts de vos livreurs distincts. Snack Manager ne prélève pas de commission sur vos commandes." },
] as const;

export const OFFER_FAQ = [
  { q: "Puis-je changer d’offre ?", a: "Nous précisons le nouveau périmètre, le montant et la date d’effet avant activation. Une application déjà absorbée par une suite n’est pas facturée une seconde fois. Le paiement annuel, les promotions et l’éventuel prorata sont traités dans la proposition." },
  { q: "Les menus TV sont-ils réservés à Boost ?", a: "Non. Les fonctions TV existantes sont comprises dans Service, Gestion et Boost. La création humaine de compositions TV est une prestation distincte. Le futur Studio papier autonome est encore en préparation." },
  { q: "Le site, Google et les réseaux sont-ils compris dans Boost ?", a: "Boost comprend votre page de commande personnalisée. Un site vitrine sur mesure, la gestion régulière de la fiche Google et les publications sur les réseaux sont des prestations séparées. L’ajout initial du lien de commande sur Google est compris dans la mise en route de la commande, sous réserve des accès nécessaires." },
  { q: "Que se passe-t-il sans internet ?", a: "La caisse conserve localement les commandes saisies et les transmet à la reconnexion. La cuisine conserve les tickets reçus ; de nouvelles commandes ne circulent pas entre appareils sans connexion. La commande et le paiement en ligne nécessitent internet. L’impression dépend du matériel et du réseau local validés." },
] as const;
