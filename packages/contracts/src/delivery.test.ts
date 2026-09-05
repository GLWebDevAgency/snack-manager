import { describe, expect, it } from 'vitest';
import { DeliveryAddressSchema, DeliverySettingsSchema, DeliveryZoneSchema } from './delivery';
import { CreatePublicOrderSchema } from './index';

const address = { line1: '12 rue des Fleurs', postalCode: '69001', city: 'Lyon', country: 'FR' };
const settings = {
  enabled: true, leadTimeMin: 45, slotCapacity: 2,
  zones: [{ id: 'centre', name: 'Centre', postalCodes: ['69001'], feeCents: 250, minimumOrderCents: 1500 }],
};
const order = {
  clientId: '11111111-1111-4111-8111-111111111111',
  lines: [{ productId: 'burger', options: [], removed: [], qty: 1 }],
  pickup: { slot: '2026-09-06T18:00:00.000Z', customerName: 'Camille', customerPhone: '0612345678' },
  payment: { method: 'online' }, turnstileToken: 'proof',
};

describe('contrats de livraison', () => {
  it.each([undefined, null, 1, 3000, 100000])('accepte le seuil gratuit facultatif sans le confondre avec le minimum : %s', (freeDeliveryFromCents) => {
    const zone = DeliveryZoneSchema.parse({ ...settings.zones[0], freeDeliveryFromCents });
    expect(zone).toMatchObject({ feeCents: 250, minimumOrderCents: 1500 });
    expect(zone.freeDeliveryFromCents).toBe(freeDeliveryFromCents);
  });
  it.each([0, -1, 1.5, 100001, '3000', NaN, Infinity])('refuse un seuil gratuit invalide : %s', (freeDeliveryFromCents) => {
    expect(DeliveryZoneSchema.safeParse({ ...settings.zones[0], freeDeliveryFromCents }).success).toBe(false);
  });
  it('un tarif zéro reste valable avec ou sans seuil ; le minimum demeure indépendant', () => {
    expect(DeliveryZoneSchema.safeParse({ ...settings.zones[0], feeCents: 0, freeDeliveryFromCents: null }).success).toBe(true);
    expect(DeliveryZoneSchema.safeParse({ ...settings.zones[0], minimumOrderCents: 4000, freeDeliveryFromCents: 3000 }).success).toBe(true);
  });

  it('accepte une adresse française structurée, refuse pays non couvert et champ inconnu', () => {
    expect(DeliveryAddressSchema.parse(address)).toEqual(address);
    expect(DeliveryAddressSchema.safeParse({ ...address, country: 'BE' }).success).toBe(false);
    expect(DeliveryAddressSchema.safeParse({ ...address, latitude: 0 }).success).toBe(false);
  });
  it('interdit les zones ambiguës et les frais non entiers', () => {
    expect(DeliverySettingsSchema.safeParse(settings).success).toBe(true);
    expect(DeliverySettingsSchema.safeParse({ ...settings, zones: [...settings.zones, { ...settings.zones[0], id: 'other' }] }).success).toBe(false);
    expect(DeliverySettingsSchema.safeParse({ ...settings, zones: [{ ...settings.zones[0], feeCents: 2.5 }] }).success).toBe(false);
    expect(DeliverySettingsSchema.safeParse({ ...settings, zones: [] }).success).toBe(false);
  });
  it('préserve les anciens paniers retrait et exige adresse + paiement en ligne pour livraison', () => {
    expect(CreatePublicOrderSchema.safeParse(order).success).toBe(true);
    expect(CreatePublicOrderSchema.safeParse({ ...order, fulfillment: 'delivery' }).success).toBe(false);
    expect(CreatePublicOrderSchema.safeParse({ ...order, fulfillment: 'delivery', delivery: { address } }).success).toBe(true);
    expect(CreatePublicOrderSchema.safeParse({ ...order, fulfillment: 'delivery', delivery: { address }, payment: { method: 'counter' } }).success).toBe(false);
  });
  it('refuse adresse sur retrait et prix imposé par le navigateur', () => {
    expect(CreatePublicOrderSchema.safeParse({ ...order, delivery: { address } }).success).toBe(false);
    expect(CreatePublicOrderSchema.safeParse({ ...order, fulfillment: 'delivery', delivery: { address, feeCents: 0 } }).success).toBe(false);
  });
});
