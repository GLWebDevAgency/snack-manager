/** Catalogue des modules autonomes. Pur : utilisable par le site public sans charger Zod. */
export const COMMERCE_PRICES = {
  loyaltyMonthlyCents: 3_900,
  collectMonthlyCents: 7_900,
  deliverySupplementMonthlyCents: 4_000,
  deliveryMonthlyCents: 11_900,
  setupCents: 5_500,
} as const;

export const COMMERCE_LABELS = {
  loyalty: 'Fidélité',
  collect: 'Click & collect',
  delivery: 'Click & collect + livraison',
} as const;

export type CommerceOptions = {
  onlineOrdering?: boolean;
  onlineDelivery?: boolean;
  standaloneLoyalty?: boolean;
};

/** Une inclusion ne se facture jamais deux fois. La livraison reste un supplément à Boost. */
export function commerceMonthlyCents(options: CommerceOptions & { plan?: string | null }): number {
  const online = options.onlineOrdering === true || options.onlineDelivery === true;
  const bundled = options.plan === 'boost';
  return (online && !bundled ? COMMERCE_PRICES.collectMonthlyCents : 0)
    + (options.onlineDelivery === true ? COMMERCE_PRICES.deliverySupplementMonthlyCents : 0)
    + (options.standaloneLoyalty === true && !online && !bundled ? COMMERCE_PRICES.loyaltyMonthlyCents : 0);
}

/** Les fonctions nécessaires à une offre font partie de cette offre. */
export const BACKOFFICE_ACCESS = {
  dashboard: ['bo', 'online'],
  orders: ['bo', 'online'],
  menu: ['menu', 'online'],
  ingredients: ['stocks'],
  fidelite: ['loyalty'],
  promos: ['loyalty'],
  reviews: ['bo', 'online'],
  team: ['pos', 'planning'],
  planning: ['planning'],
  stats: ['bo', 'online'],
  site: [],
  screens: ['pos'],
  encaissement: ['online'],
  settings: [],
  hours: ['online', 'pos'],
  devices: ['pos', 'kds', 'print'],
  abonnement: [],
  livraison: ['delivery'],
} as const;

export type BackofficeArea = keyof typeof BACKOFFICE_ACCESS;

export function canAccessArea(area: BackofficeArea, capabilities: readonly string[]): boolean {
  const anyOf: readonly string[] = BACKOFFICE_ACCESS[area];
  return anyOf.length === 0 || anyOf.some((capability) => capabilities.includes(capability));
}

/** Le filtre commercial est imposé au serveur, pas choisi par le navigateur. */
export function orderAccessScope(capabilities: readonly string[]): 'all' | 'online' | 'none' {
  if (capabilities.includes('bo')) return 'all';
  return capabilities.includes('online') ? 'online' : 'none';
}
