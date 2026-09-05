import { describe, expect, it } from 'vitest';
import type { CreateOrder } from '@sm/contracts';
import { computeDeliveryForOrder, publicDeliverySettingsOf } from './delivery-order';

const tenant = {
  onlineDelivery: true, account: { status: 'active' as const },
  encaissement: { accountId: 'acct_restaurant', chargesEnabled: true },
  delivery: { enabled: true, leadTimeMin: 45, slotCapacity: 2, zones: [
    { id: 'centre', name: 'Centre', postalCodes: ['69001'], feeCents: 250, minimumOrderCents: 1500 },
  ] },
};
const order: CreateOrder = {
  clientId: '11111111-1111-4111-8111-111111111111', channel: 'online', type: 'delivery',
  lines: [{ productId: 'burger', qty: 2, options: [], removed: [] }], payment: { method: 'online' },
  pickup: { slot: '2026-09-06T18:00:00.000Z', customerName: 'Camille', customerPhone: '0612345678' },
  delivery: { address: { line1: '12 rue des Fleurs', city: 'Lyon', postalCode: '69001', country: 'FR' } },
};

describe('publication et écriture de livraison', () => {
  it('ne divulgue aucune zone si option absente, compte suspendu ou Stripe indisponible', () => {
    expect(publicDeliverySettingsOf({ ...tenant, onlineDelivery: false })).toMatchObject({ available: false, zones: [] });
    expect(publicDeliverySettingsOf({ ...tenant, account: { status: 'suspended' } }).available).toBe(false);
    expect(publicDeliverySettingsOf({ ...tenant, encaissement: null }).available).toBe(false);
    expect(publicDeliverySettingsOf(tenant).available).toBe(true);
  });
  it('exige le module à l’écriture et fige frais et adresse calculés', () => {
    expect(() => computeDeliveryForOrder({ ...tenant, onlineDelivery: false }, order, 1800)).toThrow(/indisponible/);
    expect(computeDeliveryForOrder(tenant, order, 1800)).toMatchObject({ feeCents: 250, zoneId: 'centre', address: order.delivery!.address, dispatchedAt: null });
  });
  it('contrôle le minimum APRES la promotion et ne facture pas le retrait', () => {
    expect(() => computeDeliveryForOrder(tenant, order, 1499)).toThrow(/minimum/);
    expect(computeDeliveryForOrder(tenant, { ...order, type: 'pickup', delivery: undefined }, 1499)).toBeNull();
  });
  it('ne permet pas une livraison encaissée au comptoir en contournant le checkout', () => {
    expect(() => computeDeliveryForOrder(tenant, { ...order, channel: 'pos' }, 2000)).toThrow(/paiement en ligne/);
    expect(() => computeDeliveryForOrder(tenant, { ...order, payment: { method: 'counter' } }, 2000)).toThrow(/paiement en ligne/);
  });
});
