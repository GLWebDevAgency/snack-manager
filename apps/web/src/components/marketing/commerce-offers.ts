import { COMMERCE_LABELS, COMMERCE_PRICES } from "@sm/contracts/commerce";

/** Catalogue des nouveaux devis. Un prix ne vaut pas validation d'exploitation. */
export const COMMERCE_OFFERS = [
  {
    id: "loyalty",
    title: COMMERCE_LABELS.loyalty,
    monthlyCents: COMMERCE_PRICES.loyaltyMonthlyCents,
    status: "Disponible sans caisse Snack Manager",
    pilot: false,
    points: [
      "Carte digitale aux couleurs du restaurant",
      "Programme à points ou tampons, récompenses et clients",
      "Back-office fidélité inclus ; commande en ligne facultative",
    ],
  },
  {
    id: "collect",
    title: COMMERCE_LABELS.collect,
    monthlyCents: COMMERCE_PRICES.collectMonthlyCents,
    status: "Fidélité incluse",
    pilot: false,
    points: [
      "Carte, options, créneaux de retrait et paiement en ligne",
      "Réception et traitement des commandes depuis le back-office",
      "Domaine de commande personnalisé et fidélité inclus",
    ],
  },
  {
    id: "delivery",
    title: COMMERCE_LABELS.delivery,
    monthlyCents: COMMERCE_PRICES.deliveryMonthlyCents,
    status: "Validation pilote avant activation",
    pilot: true,
    points: [
      "Click & collect et fidélité inclus",
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
