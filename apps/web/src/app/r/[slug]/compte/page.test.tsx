import type { ReactElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { site, catalog } = vi.hoisted(() => ({ site: vi.fn(), catalog: vi.fn() }));
vi.mock('@/components/order/api', () => ({ loadSite: site, PublicApiError: class extends Error { constructor(readonly status: number) { super('site'); } } }));
vi.mock('@/components/loyalty/public-api', () => ({ loadPublicLoyalty: catalog, LoyaltyPublicApiError: class extends Error { constructor(readonly status: number) { super('catalog'); } } }));
vi.mock('@/components/order/Storefront', () => ({ Storefront: () => null }));
vi.mock('@/components/loyalty/LoyaltyCardApp', () => ({ LoyaltyCardApp: () => null }));
vi.mock('next/navigation', () => ({ notFound: () => { throw new Error('NOT_FOUND'); } }));
import AccountPage, { generateViewport as accountViewport } from './page';
import LoyaltyPage, { generateViewport as loyaltyViewport } from '../fidelite/page';
import { PublicApiError } from '@/components/order/api';
import { LoyaltyPublicApiError } from '@/components/loyalty/public-api';
import { Storefront } from '@/components/order/Storefront';
import { LoyaltyCardApp } from '@/components/loyalty/LoyaltyCardApp';

const publicCatalog = { restaurant: { slug: 'restaurant' }, program: { name: 'Les habitués', unitLabelSingular: 'point', unitLabelPlural: 'points' }, rewards: [] };
const publicSite = { tenant: { slug: 'restaurant' }, categories: [] };
const params = { params: Promise.resolve({ slug: 'restaurant' }) };
beforeEach(() => { vi.clearAllMocks(); site.mockResolvedValue(publicSite); catalog.mockResolvedValue(publicCatalog); });

describe('routes profondes de la même application client', () => {
  it.each([AccountPage, LoyaltyPage])('sert la même Storefront avec le catalogue public, sans session serveur', async render => {
    const node = await render(params) as ReactElement<Record<string, unknown>>;
    expect(node.type).toBe(Storefront); expect(node.props.site).toBe(publicSite); expect(node.props.loyaltyCatalog).toBe(publicCatalog);
    expect(site).toHaveBeenCalledWith('restaurant'); expect(catalog).toHaveBeenCalledWith('restaurant');
  });
  it.each([null, new PublicApiError(404, 'Absent')])('sert la coque fidélité après absence explicite de vitrine (%j)', async missing => {
    if (missing instanceof Error) site.mockRejectedValue(missing); else site.mockResolvedValue(null);
    const account = await AccountPage(params) as ReactElement<Record<string, unknown>>;
    expect(account.type).toBe(LoyaltyCardApp); expect(account.props).toMatchObject({ orderingAvailable: false, initialView: 'account', catalog: publicCatalog });
    const loyalty = await LoyaltyPage(params) as ReactElement<Record<string, unknown>>;
    expect(loyalty.type).toBe(LoyaltyCardApp); expect(loyalty.props.orderingAvailable).toBe(false);
    expect(account.props.unavailableService).toBeUndefined(); expect(loyalty.props.unavailableService).toBeUndefined();
  });
  it.each([AccountPage, LoyaltyPage])('préserve fidélité et compte quand la vitrine répond 503, en nommant le service inconnu', async render => {
    const failure = new PublicApiError(503, 'Panne'); site.mockRejectedValue(failure);
    const node = await render(params) as ReactElement<Record<string, unknown>>;
    expect(node.type).toBe(LoyaltyCardApp); expect(node.props.catalog).toBe(publicCatalog);
    expect(node.props.orderingAvailable).toBe(false); expect(node.props.unavailableService).toBe('storefront');
    expect(node.props).not.toHaveProperty('cause'); expect(node.props).not.toHaveProperty('error');
    if (render === AccountPage) expect(node.props.initialView).toBe('account');
  });
  it('conserve la vitrine publique et ses destinations quand la vente en ligne est en pause', async () => {
    const paused = { ...publicSite, ordering: { paused: true, message: 'Le restaurant reprend bientôt.' } };
    site.mockResolvedValue(paused);
    for (const render of [AccountPage, LoyaltyPage]) {
      const node = await render(params) as ReactElement<Record<string, unknown>>;
      expect(node.type).toBe(Storefront); expect(node.props.site).toBe(paused);
    }
  });
  it.each([AccountPage, LoyaltyPage])('garde la coque saine sans programme, et renvoie 404 seulement si les deux sont absents', async render => {
    catalog.mockRejectedValue(new LoyaltyPublicApiError(404, 'Absent'));
    const node = await render(params) as ReactElement<Record<string, unknown>>;
    expect(node.type).toBe(Storefront); expect(node.props.loyaltyCatalog).toBeUndefined();
    expect(node.props.unavailableService).toBeUndefined();
    site.mockResolvedValue(null); await expect(render(params)).rejects.toThrow('NOT_FOUND');
  });
  it.each([AccountPage, LoyaltyPage])('préserve le compte avec site sain et catalogue 503 sans présenter la panne comme une absence', async render => {
    const failure = new LoyaltyPublicApiError(503, 'Panne'); catalog.mockRejectedValue(failure);
    const node = await render(params) as ReactElement<Record<string, unknown>>;
    expect(node.type).toBe(Storefront); expect(node.props.site).toBe(publicSite);
    expect(node.props.loyaltyCatalog).toBeUndefined(); expect(node.props.loyalty).toBeNull();
    expect(node.props.unavailableService).toBe('loyalty');
    expect(node.props).not.toHaveProperty('cause'); expect(node.props).not.toHaveProperty('error');
  });
  it.each([AccountPage, LoyaltyPage])('conserve l’erreur réelle si aucune coque n’est saine, jamais une fausse 404', async render => {
    const siteFailure = new PublicApiError(503, 'Panne site'), catalogFailure = new LoyaltyPublicApiError(503, 'Panne fidélité');
    site.mockResolvedValue(null); catalog.mockRejectedValue(catalogFailure);
    await expect(render(params)).rejects.toBe(catalogFailure);
    site.mockRejectedValue(siteFailure); catalog.mockRejectedValue(new LoyaltyPublicApiError(404, 'Absent'));
    await expect(render(params)).rejects.toBe(siteFailure);
    catalog.mockRejectedValue(catalogFailure);
    await expect(render(params)).rejects.toBe(siteFailure);
  });
  it.each([AccountPage, LoyaltyPage])('distingue également une erreur réseau d’une absence commerciale et récupère après relecture', async render => {
    const failure = new TypeError('Network request failed'); catalog.mockRejectedValue(failure);
    const partial = await render(params) as ReactElement<Record<string, unknown>>;
    expect(partial.props.unavailableService).toBe('loyalty');
    catalog.mockResolvedValue(publicCatalog);
    const recovered = await render(params) as ReactElement<Record<string, unknown>>;
    expect(recovered.type).toBe(Storefront); expect(recovered.props.loyaltyCatalog).toBe(publicCatalog);
    expect(recovered.props.unavailableService).toBeUndefined();
  });
  it.each([accountViewport, loyaltyViewport])('les métadonnées de couleur utilisent la marque disponible pendant une panne partielle', async viewport => {
    const brand = { palette: { ground: '#fafafa' }, mode: 'light' };
    site.mockResolvedValue({ ...publicSite, tenant: { ...publicSite.tenant, brand } });
    catalog.mockRejectedValue(new LoyaltyPublicApiError(503, 'Panne'));
    expect(await viewport(params)).toMatchObject({ themeColor: '#fafafa', colorScheme: 'light', viewportFit: 'cover' });
    site.mockRejectedValue(new PublicApiError(503, 'Panne'));
    catalog.mockResolvedValue({ ...publicCatalog, restaurant: { ...publicCatalog.restaurant, brand } });
    expect(await viewport(params)).toMatchObject({ themeColor: '#fafafa', colorScheme: 'light', viewportFit: 'cover' });
  });
});
