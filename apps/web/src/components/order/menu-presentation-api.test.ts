import { describe, expect, it, vi } from 'vitest';
import { DIRECTIONS } from '@sm/contracts';
import { orderingApi } from './api';

describe('lecture publique de la présentation', () => {
  it('porte la marque et les choix de photo sans transformer le prix ni le mode de configuration', async () => {
    const brand = { ...DIRECTIONS.nuit, tagline: 'Fait maison.', taglineSub: 'À emporter.', hero: 'https://example.test/hero.webp' };
    const send = vi.fn().mockResolvedValue({ status: 200, body: {
      tenant: { slug: 'restaurant', name: 'Restaurant', brand },
      menu: { categories: [{ _id: 'cat', name: 'Plats', featuredProductIds: ['p2'], products: [
        { _id: 'p1', name: 'Plat', price: 875, variants: [], photoUrl: '/photos/plat.webp', photoKind: 'cover', popular: true },
        { _id: 'p2', name: 'Autre', price: 900, variants: [{ key: 'large', name: 'Grand', price: 1200 }], isNew: true },
      ] }] },
    } });
    const site = await orderingApi({ send }).loadSite('restaurant');
    expect(site?.tenant.brand).toEqual(brand);
    expect(site?.categories[0]?.products[0]).toMatchObject({ photoKind: 'cover', photoCover: true, popular: true, price: 875, fromPrice: 875, configurable: false });
    expect(site?.categories[0]?.products[1]).toMatchObject({ photoKind: 'cutout', photoCover: false, popular: false, isNew: true, price: 900, fromPrice: 1200, configurable: true });
    expect(site?.categories[0]?.featuredProductIds).toEqual(['p2']);
  });
});
