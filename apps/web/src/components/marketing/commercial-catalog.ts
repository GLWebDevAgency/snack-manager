import type { MODULE_ORDERING_CENTS, MODULE_ORDERING_SETUP_CENTS } from "@sm/contracts";

/**
 * Catalogue V2 validé pour les nouveaux devis, sans modifier la facturation
 * des contrats existants. Les modules en pilote ne sont pas activés par cette
 * vitrine. Les montants déjà facturables restent vérifiés contre le contrat.
 */
export const COMMERCE_PRICES = {
  loyaltyMonthlyCents: 3_900,
  collectMonthlyCents: 7_900,
  deliverySupplementMonthlyCents: 4_000,
  deliveryMonthlyCents: 11_900,
  setupCents: 5_500,
} as const satisfies Record<string, number> & {
  collectMonthlyCents: typeof MODULE_ORDERING_CENTS;
  setupCents: typeof MODULE_ORDERING_SETUP_CENTS;
};

export const COMMERCE_LABELS = {
  loyalty: "Fidélité",
  collect: "Click & collect",
  delivery: "Click & collect + livraison",
} as const;

export const NEW_QUOTE_NOTE = "Tarifs V2 pour les nouveaux devis. Le périmètre et la configuration sont validés avec vous avant toute mise en service. Les fonctions en pilote sont proposées dans leur périmètre accompagné ; leur ouverture n’est pas automatique. Les contrats existants et leur facturation restent inchangés.";
