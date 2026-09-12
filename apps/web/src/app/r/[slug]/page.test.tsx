import { Children, type ReactElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { marqueDeRepli } from '@sm/contracts';
import type { Site } from '@/components/order/api';

const { site, catalog } = vi.hoisted(() => ({ site: vi.fn(), catalog: vi.fn() }));
vi.mock('@/components/order/api', () => ({ loadSite: site, PublicApiError: class extends Error { constructor(readonly status: number) { super('site'); } } }));
vi.mock('@/components/loyalty/public-api', () => ({ loadPublicLoyalty: catalog, LoyaltyPublicApiError: class extends Error { constructor(readonly status: number) { super('catalog'); } } }));
vi.mock('@/components/order/Storefront', () => ({ Storefront: () => null }));
vi.mock('@/components/loyalty/LoyaltyCardApp', () => ({ LoyaltyCardApp: () => null }));
vi.mock('next/navigation', () => ({ notFound: () => { throw new Error('NOT_FOUND'); } }));
import RestaurantPage, { generateMetadata, generateViewport } from './page';
import CartePage from './carte/page';
import SearchPage from './recherche/page';
import OrdersPage from './commandes/page';
import { PublicApiError } from '@/components/order/api';
import { LoyaltyPublicApiError } from '@/components/loyalty/public-api';
import { Storefront } from '@/components/order/Storefront';
import { LoyaltyCardApp } from '@/components/loyalty/LoyaltyCardApp';

const brand = marqueDeRepli(null, null);
const publicSite: Site = {
  tenant: { slug: 'restaurant', name: 'Le Comptoir', brand, logoUrl: null, brandColor: '#c9a15a',
    address: '12 rue du Marché, 75001 Paris', phones: ['+33100000000'], hours: [] },
  categories: [{ id: 'desserts', name: 'Desserts', products: [{ id: 'tarte', name: 'Tarte </script>', description: 'Au chocolat',
    price: 350, fromPrice: 350, variants: [], groups: [], removables: [], supplements: [], tags: [], isNew: false,
    outOfStock: false, photoUrl: null, configurable: false }] }],
  medias: [], slots: null, reviews: { avg: 4.8, count: 12, latest: [] }, ordering: { paused: false, message: null },
  openNow: true, todayHours: null, timezone: 'Europe/Paris',
};
const publicCatalog = { restaurant: { slug: 'restaurant', name: 'Le Comptoir', brand },
  program: { name: 'Les habitués', unitLabelSingular: 'point', unitLabelPlural: 'points' }, rewards: [] };
const params = { params: Promise.resolve({ slug: 'restaurant' }) };
const storefrontNode = (node: ReactElement<{ children: ReactElement[] }>) => Children.toArray(node.props.children)
  .find(child => typeof child === 'object' && 'type' in child && child.type === Storefront) as ReactElement<Record<string, unknown>>;
beforeEach(() => { vi.clearAllMocks(); site.mockResolvedValue(publicSite); catalog.mockResolvedValue(publicCatalog); });

describe('vitrine principale — mêmes replis sur carte, recherche et commandes', () => {
  it('conserve les métadonnées et le vrai JSON-LD du restaurant sain, sans lecture privée', async () => {
    const node = await RestaurantPage(params) as ReactElement<{ children: ReactElement[] }>;
    const storefront = storefrontNode(node);
    expect(storefront.type).toBe(Storefront); expect(storefront.props.site).toBe(publicSite);
    expect(storefront.props.loyaltyCatalog).toBe(publicCatalog); expect(storefront.props.unavailableService).toBeUndefined();
    const script = Children.toArray(node.props.children).find(child => typeof child === 'object' && 'type' in child && child.type === 'script') as ReactElement<{ type: string; dangerouslySetInnerHTML: { __html: string } }>;
    expect(script.props.type).toBe('application/ld+json');
    const serialized = script.props.dangerouslySetInnerHTML.__html;
    expect(serialized).not.toContain('</script>');
    expect(JSON.parse(serialized)).toMatchObject({ '@type': 'Restaurant', name: 'Le Comptoir', telephone: '+33100000000',
      aggregateRating: { ratingValue: 4.8, reviewCount: 12 }, hasMenu: { hasMenuSection: [{ name: 'Desserts', hasMenuItem: [{ name: 'Tarte </script>', offers: { price: '3.50', priceCurrency: 'EUR' } }] }] } });
    const metadata = await generateMetadata(params);
    expect(metadata.title).toBe('Le Comptoir — Commander en ligne à Paris');
    expect(metadata.description).toContain('Dès 3,50'); expect(metadata.robots).toEqual({ index: true, follow: true });
    expect(metadata.manifest).toBe('/r/restaurant/manifest.webmanifest');
    expect(site).toHaveBeenCalledWith('restaurant'); expect(catalog).toHaveBeenCalledWith('restaurant');
  });
  it.each([CartePage, SearchPage, OrdersPage])('une panne de fidélité conserve la route vitrine et le compte avec un état inconnu explicite', async render => {
    catalog.mockRejectedValue(new LoyaltyPublicApiError(503, 'Panne'));
    const node = await render(params) as ReactElement<{ children: ReactElement[] }>;
    const storefront = storefrontNode(node);
    expect(storefront.props.site).toBe(publicSite); expect(storefront.props.loyaltyCatalog).toBeUndefined();
    expect(storefront.props.unavailableService).toBe('loyalty');
    expect(storefront.props.loyalty).toBeNull();
    expect((await generateMetadata(params)).title).toBe('Le Comptoir — Commander en ligne à Paris');
  });
  it('une panne vitrine laisse compte et fidélité accessibles, sans fabriquer de menu ou de JSON-LD', async () => {
    site.mockRejectedValue(new PublicApiError(503, 'Panne'));
    const node = await RestaurantPage(params) as ReactElement<Record<string, unknown>>;
    expect(node.type).toBe(LoyaltyCardApp); expect(node.props.catalog).toBe(publicCatalog);
    expect(node.props).toMatchObject({ orderingAvailable: false, unavailableService: 'storefront' });
    expect(node.props).not.toHaveProperty('children'); expect(node.props).not.toHaveProperty('site');
    expect((await generateMetadata(params)).title).toBe('Le Comptoir — Compte et fidélité');
    expect(await generateViewport(params)).toMatchObject({ themeColor: brand.palette.ground, colorScheme: brand.mode });
  });
  it('404 reste une absence explicite : pas de notice de panne, puis 404 seulement si les deux projections sont absentes', async () => {
    catalog.mockRejectedValue(new LoyaltyPublicApiError(404, 'Absent'));
    const node = await RestaurantPage(params) as ReactElement<{ children: ReactElement[] }>;
    expect(storefrontNode(node).props.unavailableService).toBeUndefined();
    site.mockResolvedValue(null); await expect(RestaurantPage(params)).rejects.toThrow('NOT_FOUND');
  });
  it('ne transforme jamais une panne intégrale en restaurant inexistant', async () => {
    const failure = new PublicApiError(503, 'Panne site'); site.mockRejectedValue(failure);
    catalog.mockRejectedValue(new LoyaltyPublicApiError(503, 'Panne fidélité'));
    await expect(RestaurantPage(params)).rejects.toBe(failure);
    expect((await generateMetadata(params)).title).toBe('Restaurant temporairement indisponible');
  });
});
