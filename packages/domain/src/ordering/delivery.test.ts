import { describe, expect, it } from 'vitest';
import { Money } from '../shared/money';
import { quoteDelivery, type DeliveryPolicy } from './delivery';

const policy: DeliveryPolicy = {
  enabled: true,
  leadTimeMin: 45,
  zones: [{ id: 'centre', name: 'Centre', postalCodes: ['69001', '69002'], feeCents: 250, minimumOrderCents: 1500 }],
};

describe('livraison propre : zone et tarif faisant autorité', () => {
  it('ajoute les frais exacts au panier net, sans arrondi flottant', () => {
    expect(quoteDelivery(policy, '69001', Money.fromCents(1801))).toMatchObject({
      ok: true, value: { zoneId: 'centre', feeCents: 250, subtotalCents: 1801, totalCents: 2051, estimatedMinutes: 45 },
    });
  });

  it('le seuil est inclusif et ne compte jamais les frais de livraison', () => {
    expect(quoteDelivery(policy, '69002', Money.fromCents(1500)).ok).toBe(true);
    expect(quoteDelivery(policy, '69002', Money.fromCents(1499))).toMatchObject({
      ok: false, error: { code: 'delivery.minimum_not_reached' },
    });
  });

  it('refuse un code voisin, même dans le même département', () => {
    expect(quoteDelivery(policy, '69003', Money.fromCents(3000))).toMatchObject({
      ok: false, error: { code: 'delivery.outside_zone' },
    });
  });

  it('refuse une livraison mise en pause et toute configuration ambiguë', () => {
    expect(quoteDelivery({ ...policy, enabled: false }, '69001', Money.fromCents(3000))).toMatchObject({
      ok: false, error: { code: 'delivery.unavailable' },
    });
    expect(quoteDelivery({ ...policy, zones: [...policy.zones, { ...policy.zones[0]!, id: 'duplicate' }] }, '69001', Money.fromCents(3000))).toMatchObject({
      ok: false, error: { code: 'delivery.invalid_configuration' },
    });
  });

  it('refuse les montants négatifs persistés et accepte les frais offerts', () => {
    expect(quoteDelivery({ ...policy, zones: [{ ...policy.zones[0]!, feeCents: -1 }] }, '69001', Money.fromCents(3000)).ok).toBe(false);
    expect(quoteDelivery({ ...policy, zones: [{ ...policy.zones[0]!, feeCents: 0 }] }, '69001', Money.fromCents(3000))).toMatchObject({
      ok: true, value: { feeCents: 0, totalCents: 3000 },
    });
  });
});
