import { COMMERCE_LABELS, COMMERCE_PRICES } from "@sm/contracts/commerce";

/** Limite commune au module seul et à son inclusion dans collect/Boost. */
export const LOYALTY_PILOT_NOTE = "Fidélité en pilote accompagné : cartes, programme et récompenses configurables. L’utilisation sécurisée des récompenses et l’attribution automatique de points après une commande en ligne restent à finaliser.";

/** Catalogue des nouveaux devis. Un prix ne vaut pas validation d'exploitation. */
export const COMMERCE_OFFERS = [
  {
    id: "loyalty",
    title: COMMERCE_LABELS.loyalty,
    monthlyCents: COMMERCE_PRICES.loyaltyMonthlyCents,
    status: "Pilote accompagné, sans caisse Snack Manager",
    pilot: true,
    note: LOYALTY_PILOT_NOTE,
    cta: "Étudier mon pilote fidélité",
    points: [
      "Carte digitale aux couleurs du restaurant",
      "Programme à points ou tampons et récompenses configurables",
      "Back-office fidélité inclus ; commande en ligne facultative",
    ],
  },
  {
    id: "collect",
    title: COMMERCE_LABELS.collect,
    monthlyCents: COMMERCE_PRICES.collectMonthlyCents,
    status: "Fidélité incluse en pilote accompagné",
    pilot: false,
    note: LOYALTY_PILOT_NOTE,
    cta: "Parler de ma commande en ligne",
    points: [
      "Carte, options, créneaux de retrait et paiement en ligne",
      "Réception et traitement des commandes depuis le back-office",
      "Domaine de commande personnalisé ; pilote fidélité inclus",
    ],
  },
  {
    id: "delivery",
    title: COMMERCE_LABELS.delivery,
    monthlyCents: COMMERCE_PRICES.deliveryMonthlyCents,
    status: "Validation pilote avant activation",
    pilot: true,
    note: "Tarif prévu. L’ouverture dépend de la validation du parcours de livraison ; aucun livreur tiers n’est fourni. Fidélité incluse dans les limites du pilote accompagné.",
    cta: "Étudier ma livraison",
    points: [
      "Click & collect et pilote fidélité inclus",
      "Livraison organisée par votre restaurant, avec vos livreurs",
      "Zones, tarifs et parcours à valider ensemble avant ouverture",
    ],
  },
] as const;

/** A pilot can be discussed, but must not be advertised as ready to purchase. */
export const PUBLISHED_COMMERCE_OFFERS = COMMERCE_OFFERS.filter((offer) => !offer.pilot);

export const COMMERCE_TERMS = {
  setup: COMMERCE_PRICES.setupCents,
  supplement: COMMERCE_PRICES.deliverySupplementMonthlyCents,
  note: "Prix HT par mois et par établissement, pour les nouveaux devis. Une fonction déjà incluse n'est pas facturée deux fois. Les conditions des contrats existants restent applicables.",
};
