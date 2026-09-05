import { Mongoose } from 'mongoose';
import { describe, expect, it } from 'vitest';
import { DeliverySettingsSchema } from '@sm/contracts';
import { TenantSchema } from './schemas';

const Tenant = new Mongoose().model('DeliveryFeeTenant', TenantSchema);
function document(freeDeliveryFromCents?: unknown) {
  return new Tenant({ slug: 'fees-test', name: 'Test', delivery: {
    enabled: true, leadTimeMin: 45, slotCapacity: 2,
    zones: [{ id: 'centre', name: 'Centre', postalCodes: ['69001'], feeCents: 500, minimumOrderCents: 1500,
      ...(freeDeliveryFromCents !== undefined ? { freeDeliveryFromCents } : {}) }],
  } });
}

describe('persistance Mongoose du seuil de gratuité (sans base ni écriture)', () => {
  it('conserve le seuil à travers casting puis lecture du contrat', () => {
    const doc = document(3000);
    expect(doc.validateSync()).toBeUndefined();
    const settings = DeliverySettingsSchema.parse(doc.toObject().delivery);
    expect(settings.zones[0]).toMatchObject({ freeDeliveryFromCents: 3000, feeCents: 500, minimumOrderCents: 1500 });
  });
  it.each([undefined, null])('les anciens tenants restent valides sans seuil : %s', (threshold) => {
    const doc = document(threshold);
    expect(doc.validateSync()).toBeUndefined();
    expect(DeliverySettingsSchema.parse(doc.toObject().delivery).zones[0]).toMatchObject({ freeDeliveryFromCents: null, feeCents: 500 });
  });
  it.each([0, -1, 1.5, 100001, NaN, Infinity])('refuse les seuils invalides même hors route HTTP : %s', (threshold) => {
    const error = document(threshold).validateSync();
    expect(Object.keys(error?.errors ?? {})).toContain('delivery.zones.0.freeDeliveryFromCents');
  });
});
