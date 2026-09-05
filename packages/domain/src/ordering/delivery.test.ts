import { describe, expect, it } from 'vitest';
import { Money } from '../shared/money';
import { quoteDelivery, type DeliveryPolicy } from './delivery';

const policy: DeliveryPolicy = {
  enabled: true,
  leadTimeMin: 45,
  zones: [{ id: 'centre', name: 'Centre', postalCodes: ['69001', '69002'], feeCents: 250, minimumOrderCents: 1500 }],
};

describe('livraison propre : zone et tarif faisant autorité', () => {
  it.each([[2999, 500, 1], [3000, 0, 0], [3001, 0, 0]])('offre les frais dès le seuil NET inclusif : %s centimes', (subtotal, fee, remaining) => {
    const configured = { ...policy, zones: [{ ...policy.zones[0]!, feeCents: 500, freeDeliveryFromCents: 3000 }] };
    expect(quoteDelivery(configured, '69001', Money.fromCents(subtotal))).toMatchObject({
      ok: true, value: { feeCents: fee, standardFeeCents: 500, freeDeliveryFromCents: 3000,
        remainingForFreeDeliveryCents: remaining, subtotalCents: subtotal, totalCents: subtotal + fee },
    });
  });

  it.each([undefined, null])('les zones historiques sans seuil gardent leur tarif fixe : %s', (freeDeliveryFromCents) => {
    expect(quoteDelivery({ ...policy, zones: [{ ...policy.zones[0]!, freeDeliveryFromCents }] }, '69001', Money.fromCents(5000))).toMatchObject({
      ok: true, value: { feeCents: 250, standardFeeCents: 250, freeDeliveryFromCents: null, remainingForFreeDeliveryCents: null, totalCents: 5250 },
    });
  });

  it('un tarif zéro est toujours gratuit et n’annonce jamais de reste à payer pour le débloquer', () => {
    expect(quoteDelivery({ ...policy, zones: [{ ...policy.zones[0]!, feeCents: 0, freeDeliveryFromCents: 3000 }] }, '69001', Money.fromCents(1500))).toMatchObject({
      ok: true, value: { feeCents: 0, standardFeeCents: 0, remainingForFreeDeliveryCents: 0, totalCents: 1500 },
    });
  });

  it('atteindre le seuil gratuit ne dispense jamais du minimum de commande', () => {
    expect(quoteDelivery({ ...policy, zones: [{ ...policy.zones[0]!, minimumOrderCents: 3500, freeDeliveryFromCents: 3000 }] }, '69001', Money.fromCents(3499))).toMatchObject({
      ok: false, error: { code: 'delivery.minimum_not_reached' },
    });
    expect(quoteDelivery({ ...policy, zones: [{ ...policy.zones[0]!, feeCents: 0 }] }, '69001', Money.fromCents(1499)).ok).toBe(false);
  });

  it.each([0, -1, 0.5, 100001, NaN, Infinity])('refuse un seuil persisté invalide : %s', (freeDeliveryFromCents) => {
    expect(quoteDelivery({ ...policy, zones: [{ ...policy.zones[0]!, freeDeliveryFromCents }] }, '69001', Money.fromCents(5000))).toMatchObject({
      ok: false, error: { code: 'delivery.invalid_configuration' },
    });
  });

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
