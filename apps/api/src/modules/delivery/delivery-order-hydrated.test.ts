import { Document, Mongoose } from 'mongoose';
import { TenantSchema } from '@sm/db';
import { DEFAULT_DELIVERY_SETTINGS, type CreateOrder } from '@sm/contracts';
import { describe, expect, it, vi } from 'vitest';
import { computeDeliveryForOrder, deliverySettingsOf, publicDeliverySettingsOf } from './delivery-order';

// Real application schema, with hydrate() only: no connection or database IO.
const TenantDocument = new Mongoose().model('DeliveryOrderHydratedRegression', TenantSchema);
const settings = { enabled: true, leadTimeMin: 60, slotCapacity: 3, zones: [
  { id: 'centre', name: 'Centre ville', postalCodes: ['69001'], feeCents: 250,
    minimumOrderCents: 1500, freeDeliveryFromCents: 3000 },
] };
const tenant = { slug: 'delivery-hydrated-fixture', name: 'Restaurant de recette', onlineDelivery: true,
  account: { status: 'active' as const }, encaissement: { accountId: 'acct_fixture', chargesEnabled: true }, delivery: settings };
const order: CreateOrder = {
  clientId: '11111111-1111-4111-8111-111111111111', channel: 'online', type: 'delivery',
  lines: [{ productId: '507f1f77bcf86cd799439055', qty: 1, options: [], removed: [] }], payment: { method: 'online' },
  pickup: { slot: '2030-01-01T18:00:00.000Z', customerName: 'Client fixture', customerPhone: '0600000000' },
  delivery: { address: { line1: '12 rue de recette', city: 'Lyon', postalCode: '69001', country: 'FR' } },
};

describe('livraison — parité objet brut et vrai Tenant Mongoose hydraté', () => {
  it('publie les mêmes réglages et zones depuis les lectures lean et hydratée', () => {
    const hydrated = TenantDocument.hydrate(tenant);
    expect(hydrated.delivery).toBeInstanceOf(Document);
    expect(deliverySettingsOf(hydrated)).toEqual(deliverySettingsOf(tenant));
    expect(publicDeliverySettingsOf(hydrated)).toEqual(publicDeliverySettingsOf(tenant));
    expect(publicDeliverySettingsOf(hydrated)).toEqual({ available: true, zones: settings.zones,
      leadTimeMin: 60, paymentRequired: 'online' });
    expect(hydrated.modifiedPaths()).toEqual([]);
  });

  it.each([1800, 3000])('fige la même livraison et les frais après promotion à %s centimes', subtotal => {
    const hydrated = TenantDocument.hydrate(tenant);
    expect(computeDeliveryForOrder(hydrated, order, subtotal)).toEqual(computeDeliveryForOrder(tenant, order, subtotal));
    expect(computeDeliveryForOrder(hydrated, order, subtotal)).toMatchObject({ zoneId: 'centre',
      feeCents: subtotal >= 3000 ? 0 : 250, estimatedMinutes: 60, dispatchedAt: null, deliveredAt: null });
    expect(hydrated.modifiedPaths()).toEqual([]);
  });

  it('conserve le minimum après promotion, les zones et le paiement en ligne obligatoires', () => {
    const hydrated = TenantDocument.hydrate(tenant);
    expect(() => computeDeliveryForOrder(hydrated, order, 1499)).toThrow(/minimum/);
    const outside = { ...order, delivery: { address: { ...order.delivery!.address, postalCode: '69002' } } };
    expect(() => computeDeliveryForOrder(hydrated, outside, 1800)).toThrow();
    expect(() => computeDeliveryForOrder(hydrated, { ...order, payment: { method: 'counter' } }, 1800)).toThrow(/paiement en ligne/);
    expect(computeDeliveryForOrder(hydrated, { ...order, type: 'pickup', delivery: undefined }, 1800)).toBeNull();
  });

  it.each([
    ['désactivée', { delivery: { ...settings, enabled: false } }],
    ['sans zone', { delivery: { ...settings, zones: [] } }],
    ['option absente', { onlineDelivery: false }],
    ['compte suspendu', { account: { status: 'suspended' as const } }],
    ['commande en pause', { settings: { onlineOrderingPaused: true } }],
    ['Stripe absent', { encaissement: null }],
    ['Stripe non prêt', { encaissement: { accountId: 'acct_fixture', chargesEnabled: false } }],
    ['compte Stripe absent', { encaissement: { accountId: null, chargesEnabled: true } }],
  ] as const)('reste fermée : %s', (_name, patch) => {
    const plain = { ...tenant, ...patch };
    const hydrated = TenantDocument.hydrate(plain);
    expect(publicDeliverySettingsOf(plain)).toMatchObject({ available: false, zones: [] });
    expect(publicDeliverySettingsOf(hydrated)).toEqual(publicDeliverySettingsOf(plain));
    expect(() => computeDeliveryForOrder(hydrated, order, 1800)).toThrow(/indisponible/);
  });

  it.each([
    ['champ inconnu', { ...settings, unexpected: true }],
    ['objet inconnu vide', { ...settings, unexpected: {} }],
    ['champ de zone inconnu', { ...settings, zones: [{ ...settings.zones[0]!, unexpected: true }] }],
    ['frais négatifs', { ...settings, zones: [{ ...settings.zones[0]!, feeCents: -1 }] }],
    ['délai invalide', { ...settings, leadTimeMin: 19 }],
    ['capacité fractionnaire', { ...settings, slotCapacity: 1.5 }],
    ['codes postaux dupliqués', { ...settings, zones: [...settings.zones, { ...settings.zones[0]!, id: 'autre' }] }],
    ['configuration absente', null],
  ] as const)('ne répare pas silencieusement une configuration invalide : %s', (_name, delivery) => {
    const plain = { ...tenant, delivery };
    const hydrated = TenantDocument.hydrate(plain);
    expect(deliverySettingsOf(plain)).toEqual(DEFAULT_DELIVERY_SETTINGS);
    expect(deliverySettingsOf(hydrated)).toEqual(DEFAULT_DELIVERY_SETTINGS);
    expect(publicDeliverySettingsOf(hydrated)).toMatchObject({ available: false, zones: [] });
    expect(() => computeDeliveryForOrder(hydrated, order, 1800)).toThrow(/indisponible/);
  });

  it('n’exécute pas un toObject fourni par un objet arbitraire', () => {
    const toObject = vi.fn(() => settings);
    expect(deliverySettingsOf({ delivery: { toObject } })).toEqual(DEFAULT_DELIVERY_SETTINGS);
    expect(toObject).not.toHaveBeenCalled();
  });

  it('une erreur de normalisation du vrai sous-document reste fermée', () => {
    const hydrated = TenantDocument.hydrate(tenant);
    const delivery = hydrated.delivery;
    if (!(delivery instanceof Document)) throw new Error('Sous-document Mongoose de recette attendu');
    const toObject = vi.spyOn(delivery, 'toObject').mockImplementation(() => {
      throw new Error('Normalisation de recette indisponible');
    });
    expect(deliverySettingsOf(hydrated)).toEqual(DEFAULT_DELIVERY_SETTINGS);
    expect(publicDeliverySettingsOf(hydrated)).toMatchObject({ available: false, zones: [] });
    expect(() => computeDeliveryForOrder(hydrated, order, 1800)).toThrow(/indisponible/);
    toObject.mockRestore();
  });
});
