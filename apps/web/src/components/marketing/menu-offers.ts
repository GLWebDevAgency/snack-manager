/**
 * Prestations Menus validées pour la vitrine. Prix HT en centimes.
 * Il s'agit de prestations sur devis, pas de capacités logicielles activées.
 * L'impression, la livraison et le matériel ne sont jamais compris implicitement.
 */
export type MenuOffer = {
  readonly id: string;
  readonly category: "papier" | "tv" | "ensemble" | "accompagnement";
  readonly title: string;
  readonly priceCents: number;
  readonly priceFrom: boolean;
  readonly summary: string;
  readonly included: readonly string[];
  readonly exclusions: readonly string[];
  readonly note: string;
  readonly cta: string;
};

export const MENUS_OFFERS: readonly MenuOffer[] = [
  {
    id: "adaptation",
    category: "papier",
    title: "Adaptation d’un modèle",
    priceCents: 14_900,
    priceFrom: false,
    summary: "Une présentation soignée à partir d’un modèle existant.",
    included: [
      "Un modèle et un format, jusqu’à trois volets",
      "Jusqu’à 30 références, textes, prix et visuels fournis",
      "Une série consolidée de corrections",
      "Bon à tirer et fichier préparé pour l’imprimeur retenu",
    ],
    exclusions: ["Création d’identité, shooting et analyse des ventes"],
    note: "Conception uniquement. Impression et livraison sur devis séparé.",
    cta: "Adapter ma carte",
  },
  {
    id: "papier",
    category: "papier",
    title: "Refonte guidée trois volets",
    priceCents: 29_000,
    priceFrom: false,
    summary: "Faites évoluer votre carte avec un gabarit adapté à votre restaurant.",
    included: [
      "Trois volets, six faces, à partir d’un gabarit adapté",
      "Jusqu’à 40 références et une langue, éléments fournis",
      "Deux séries consolidées de corrections",
      "Bon à tirer et fichier final selon le gabarit imprimeur",
    ],
    exclusions: ["Identité entièrement originale, shooting et rédaction étendue"],
    note: "Les variantes et formules complexes sont examinées avant confirmation du forfait.",
    cta: "Refaire mon menu papier",
  },
  {
    id: "tv",
    category: "tv",
    title: "Mise en scène TV",
    priceCents: 29_000,
    priceFrom: false,
    summary: "Présentez votre carte sur écran, avec une lecture adaptée au service.",
    included: [
      "Deux compositions issues de la bibliothèque existante",
      "Une orientation, jusqu’à 40 références, catalogue et identité fournis",
      "Deux séries consolidées de corrections",
      "Réglage de la boucle et des horaires, validation de l’aperçu",
    ],
    exclusions: ["Matériel, installation, vidéo originale et export MP4"],
    note: "La diffusion nécessite une suite Snack Manager comprenant les fonctions TV existantes.",
    cta: "Préparer mes menus TV",
  },
  {
    id: "complexe",
    category: "papier",
    title: "Carte sur mesure",
    priceCents: 49_000,
    priceFrom: true,
    summary: "Une carte plus longue, plusieurs formats ou une création plus approfondie.",
    included: [
      "Examen de votre carte et de l’identité souhaitée",
      "Formats, langues et références définis au devis",
      "Direction graphique et retours convenus avant le travail",
      "Fichiers adaptés aux supports retenus",
    ],
    exclusions: ["Impression, livraison et shooting non prévus au devis"],
    note: "Le prix et le calendrier dépendent du périmètre accepté. Ce tarif est un point de départ.",
    cta: "Décrire mon projet de carte",
  },
  {
    id: "ensemble",
    category: "ensemble",
    title: "Carte, TV & diagnostic",
    priceCents: 59_000,
    priceFrom: false,
    summary: "Une même identité sur vos supports, avec trois recommandations expliquées.",
    included: [
      "Le trois-volets du forfait de refonte guidée",
      "Deux compositions TV de la bibliothèque existante",
      "Diagnostic des données disponibles et trois actions proposées",
      "Deux séries consolidées de corrections",
    ],
    exclusions: ["Impression, matériel, diffusion logicielle et vidéo originale"],
    note: "L’analyse de contribution nécessite des ventes et coûts exploitables. Vous validez les mises en avant.",
    cta: "Réunir mes supports",
  },
  {
    id: "retouches",
    category: "accompagnement",
    title: "Modifications ponctuelles",
    priceCents: 7_500,
    priceFrom: false,
    summary: "Un nouveau prix ou un texte à corriger, sans reprendre la mise en page.",
    included: [
      "Un lot jusqu’à dix changements simples sur un support existant",
      "45 minutes maximum de production et coordination au total",
      "Un retour compris dans ce budget",
    ],
    exclusions: ["Nouveau format, nouvelle mise en page et restructuration de carte"],
    note: "Le périmètre est confirmé avant le travail. Aucun abonnement humain n’est nécessaire.",
    cta: "Mettre à jour ma carte",
  },
  {
    id: "analyse",
    category: "accompagnement",
    title: "Analyse de votre carte",
    priceCents: 24_900,
    priceFrom: false,
    summary: "Prenez du recul sur les produits à mettre en avant et la présentation de votre offre.",
    included: [
      "Contrôle des données disponibles et analyse humaine",
      "Trois recommandations expliquées et une restitution courte",
      "Jusqu’à 2 h 30 de travail total",
    ],
    exclusions: ["Création graphique, nettoyage massif et saisie des fiches recettes"],
    note: "Sans coûts exploitables, l’analyse porte sur les ventes et la présentation, pas sur la rentabilité.",
    cta: "Faire analyser ma carte",
  },
] as const;

/** Projet logiciel : volontairement absent des offres vendables et des JSON-LD. */
export const MENU_STUDIO_FUTURE = {
  available: false,
  status: "En préparation",
  studioMonthlyCents: 5_900,
  boostMonthlyCents: 24_900,
  note: "Tarifs envisagés après livraison. Le Studio papier autonome n’est pas disponible à la souscription. Les fonctions TV actuelles restent comprises dans les trois suites.",
} as const;

export const MENU_PRINT_NOTE = "Conception et fabrication sont deux lignes distinctes. Impression et livraison au coût de l’imprimeur, selon un devis validé. Une éventuelle coordination de fabrication est chiffrée séparément.";
