/** Public destinations shared by the web shell and a future native shell.
 * Availability is supplied by the tenant's server projections, never inferred
 * from a saved card or a client preference. */
export const CUSTOMER_APP_DESTINATIONS = [
  { key: 'menu', label: 'Carte', suffix: 'carte' },
  { key: 'search', label: 'Rechercher', suffix: 'recherche' },
  { key: 'orders', label: 'Commandes', suffix: 'commandes' },
  { key: 'loyalty', label: 'Fidélité', suffix: 'fidelite' },
  { key: 'account', label: 'Compte', suffix: 'compte' },
] as const;

export type CustomerAppView = typeof CUSTOMER_APP_DESTINATIONS[number]['key'];
export type CustomerAppAvailability = { ordering: boolean; loyalty: boolean; account: boolean };

export function customerAppDestinations(availability: CustomerAppAvailability) {
  return CUSTOMER_APP_DESTINATIONS.filter(({ key }) => key === 'loyalty' ? availability.loyalty
    : key === 'account' ? availability.account : availability.ordering);
}

export function customerAppPath(slug: string, key: CustomerAppView) {
  const destination = CUSTOMER_APP_DESTINATIONS.find(item => item.key === key)!;
  return `/r/${encodeURIComponent(slug)}/${destination.suffix}`;
}

export function customerAppViewFromPath(path: string): CustomerAppView {
  const suffix = path.replace(/\/+$/, '').split('/').pop();
  return CUSTOMER_APP_DESTINATIONS.find(item => item.suffix === suffix)?.key ?? 'menu';
}
