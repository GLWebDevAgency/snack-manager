import { describe, expect, it } from 'vitest';
import { canAccessArea, commerceMonthlyCents, orderAccessScope } from './commerce';
import { capacitesEffectives } from './capacites';

describe('offres autonomes', () => {
  it.each([
    [{}, 0],
    [{ standaloneLoyalty: true }, 3900],
    [{ onlineOrdering: true, standaloneLoyalty: true }, 7900],
    [{ onlineDelivery: true, standaloneLoyalty: true }, 11900],
    [{ plan: 'boost', onlineOrdering: true, standaloneLoyalty: true }, 0],
    [{ plan: 'boost', onlineDelivery: true }, 4000],
  ])('chiffre sans doubler les inclusions %j', (options, expected) => {
    expect(commerceMonthlyCents(options)).toBe(expected);
  });

  it('livre un back-office exploitable avec la commande seule', () => {
    const caps = capacitesEffectives({ plan: null, onlineOrdering: true });
    for (const area of ['dashboard', 'orders', 'menu', 'hours', 'site', 'settings', 'encaissement', 'abonnement', 'fidelite'] as const) {
      expect(canAccessArea(area, caps), area).toBe(true);
    }
    for (const area of ['planning', 'team', 'devices', 'screens', 'ingredients', 'livraison'] as const) {
      expect(canAccessArea(area, caps), area).toBe(false);
    }
    expect(orderAccessScope(caps)).toBe('online');
  });

  it('la fidélité seule ne vend ni caisse, ni commande, ni livraison', () => {
    const caps = capacitesEffectives({ plan: null, standaloneLoyalty: true });
    expect(caps).toEqual(['loyalty']);
    expect(canAccessArea('fidelite', caps)).toBe(true);
    expect(canAccessArea('orders', caps)).toBe(false);
    expect(orderAccessScope(caps)).toBe('none');
  });

  it('la livraison comprend retrait et fidélité ; la pause ne change pas les droits', () => {
    const caps = capacitesEffectives({ onlineDelivery: true });
    expect(caps).toEqual(expect.arrayContaining(['online', 'delivery', 'loyalty', 'menu']));
    expect(caps).not.toContain('pos');
  });

  it('un retrait explicite prévaut sur les inclusions commerciales', () => {
    const caps = capacitesEffectives({ onlineDelivery: true, derogationsCapacite: [{ capacite: 'delivery', sens: 'retiree' }] });
    expect(caps).not.toContain('delivery');
    expect(caps).toContain('online');
  });
});
