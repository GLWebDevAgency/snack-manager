import { describe, expect, it, vi } from 'vitest';
import { CreateOrderSchema, CreatePublicOrderSchema } from '@sm/contracts';
import { OrdersController } from './orders.controller';

const request = CreatePublicOrderSchema.parse({
  clientId: '11111111-1111-4111-8111-111111111111', fulfillment: 'delivery',
  lines: [{ productId: 'burger', qty: 2 }], payment: { method: 'online' },
  pickup: { slot: '2026-09-06T18:00:00.000Z', customerName: 'Camille', customerPhone: '0612345678' },
  delivery: { address: { line1: '12 rue des Fleurs', postalCode: '69001', city: 'Lyon', country: 'FR' } },
  turnstileToken: 'proof',
});
const tenant = {
  _id: '507f1f77bcf86cd799439011', onlineDelivery: true, account: { status: 'active' },
  encaissement: { accountId: 'acct_restaurant', chargesEnabled: true },
  delivery: { enabled: true, leadTimeMin: 45, slotCapacity: 2, zones: [
    { id: 'centre', name: 'Centre', postalCodes: ['69001'], feeCents: 250, minimumOrderCents: 1500 },
  ] },
};
function setup(over = {}) {
  const orders = { findPublicReplay: vi.fn().mockResolvedValue(null), createWithOutcome: vi.fn().mockResolvedValue({ created: true, order: { type: 'delivery' } }) };
  const slots = { exigerDisponible: vi.fn().mockResolvedValue(undefined) };
  const gate = { authorize: vi.fn().mockResolvedValue({}), release: vi.fn(), serializeSlot: vi.fn(async (_input, action: () => unknown) => action()) };
  const tenants = { bySlug: vi.fn().mockResolvedValue({ ...tenant, ...over }) };
  return { controller: new OrdersController(orders as never, {} as never, tenants as never, slots as never, gate as never), orders, slots, gate };
}

describe('écriture publique livraison', () => {
  it('le point de vente ne contourne pas le checkout et sa réservation de créneau', () => {
    const ctx = setup();
    const privateRequest = CreateOrderSchema.parse({ ...request, channel: 'online', type: 'delivery' });
    expect(() => ctx.controller.create(tenant._id, { sub: 'owner' } as never, privateRequest)).toThrow(/commande en ligne/);
    expect(ctx.orders.createWithOutcome).not.toHaveBeenCalled();
  });
  it('refuse un appel direct livraison sur une offre retrait seule', async () => {
    const ctx = setup({ onlineDelivery: false, onlineOrdering: true });
    await expect(ctx.controller.createOnline('classfood', request)).rejects.toThrow(/livraison.*indisponible/);
    expect(ctx.gate.authorize).not.toHaveBeenCalled();
    expect(ctx.orders.createWithOutcome).not.toHaveBeenCalled();
  });
  it('revérifie le créneau livraison sous le verrou partagé et transmet uniquement le tarif serveur', async () => {
    const ctx = setup();
    await ctx.controller.createOnline('classfood', request);
    expect(ctx.slots.exigerDisponible).toHaveBeenCalledTimes(2);
    expect(ctx.slots.exigerDisponible).toHaveBeenLastCalledWith(tenant, request.pickup.slot, 'delivery');
    expect(ctx.gate.serializeSlot).toHaveBeenCalledWith({ tenantId: tenant._id, slot: request.pickup.slot }, expect.any(Function));
    expect(ctx.orders.createWithOutcome).toHaveBeenCalledWith(tenant._id, expect.objectContaining({ type: 'delivery', channel: 'online', payment: { method: 'online' }, delivery: request.delivery }), 'online:turnstile', null, undefined);
    expect(ctx.orders.createWithOutcome.mock.calls[0]?.[1]).not.toHaveProperty('fulfillment');
  });
});
