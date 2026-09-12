import { loadSite, PublicApiError, type Site } from '../order/api';
import { loadPublicLoyalty, LoyaltyPublicApiError } from '../loyalty/public-api';
import type { LoyaltyPublicProgram } from '@sm/contracts';

export type CustomerUnavailableService = 'loyalty' | 'storefront';
type Surface<T> = { state: 'available'; value: T } | { state: 'absent' } | { state: 'unavailable'; cause: unknown };
type PublicSurfaces = { site: Surface<Site>; catalog: Surface<LoyaltyPublicProgram> };

async function read<T>(load: () => Promise<T | null>, absent: (cause: unknown) => boolean): Promise<Surface<T>> {
  try { const value = await load(); return value === null ? { state: 'absent' } : { state: 'available', value }; }
  catch (cause) { return absent(cause) ? { state: 'absent' } : { state: 'unavailable', cause }; }
}

/** Public projections only. A failed projection is unknown, never evidence of
 * a removed module, and cannot prevent rendering the other healthy surface. */
export async function loadCustomerPublicSurfaces(slug: string): Promise<PublicSurfaces> {
  const [site, catalog] = await Promise.all([
    read(() => loadSite(slug), cause => cause instanceof PublicApiError && cause.status === 404),
    read(() => loadPublicLoyalty(slug), cause => cause instanceof LoyaltyPublicApiError && cause.status === 404),
  ]);
  return { site, catalog };
}

type CustomerSurface =
  | { kind: 'storefront'; site: Site; catalog?: LoyaltyPublicProgram; unavailableService?: CustomerUnavailableService }
  | { kind: 'loyalty'; catalog: LoyaltyPublicProgram; unavailableService?: CustomerUnavailableService }
  | { kind: 'absent' };

export function customerSurface({ site, catalog }: PublicSurfaces): CustomerSurface {
  if (site.state === 'available') return { kind: 'storefront', site: site.value,
    ...(catalog.state === 'available' ? { catalog: catalog.value } : {}),
    ...(catalog.state === 'unavailable' ? { unavailableService: 'loyalty' } : {}) };
  if (catalog.state === 'available') return { kind: 'loyalty', catalog: catalog.value,
    ...(site.state === 'unavailable' ? { unavailableService: 'storefront' } : {}) };
  // With no healthy shell there is no safe surface to infer from local state.
  // Preserve the actual outage for the route's error boundary; only two
  // explicit absences authorize notFound(). No cause crosses client props.
  if (site.state === 'unavailable') throw site.cause;
  if (catalog.state === 'unavailable') throw catalog.cause;
  return { kind: 'absent' };
}
