import { BrandSchema } from '@sm/contracts';
import { z } from 'zod';
import { API_URL } from './api';
import { isRestaurantSlug } from '@/lib/restaurant-metadata';

const PublicBrand = z.object({ slug: z.string(), name: z.string().min(1), brand: BrandSchema });
export async function loadOrderPwa(slug: string) {
  if (!isRestaurantSlug(slug)) return null;
  const response = await fetch(`${API_URL}/public/tenants/${slug}`, { headers: { Accept: 'application/json' }, cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(2_000) });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error('Identité indisponible');
  const parsed = PublicBrand.safeParse(await response.json());
  if (!parsed.success || parsed.data.slug !== slug) throw new Error('Identité indisponible');
  return parsed.data;
}
