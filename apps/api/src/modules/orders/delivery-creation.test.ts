import { describe, expect, it, vi } from 'vitest';
import { CreateOrderSchema } from '@sm/contracts';
import { OrdersService } from './orders.service';
import { pricingAdmissionPort } from './order-pricing-test-fixtures';

const tenantId = '507f1f77bcf86cd799439011';
const productId = '507f1f77bcf86cd799439012';
const tenant = {
  onlineDelivery: true, account: { status: 'active' },
  encaissement: { accountId: 'acct_restaurant', chargesEnabled: true },
  delivery: { enabled: true, leadTimeMin: 45, slotCapacity: 2, zones: [
    { id: 'centre', name: 'Centre', postalCodes: ['69001'], feeCents: 250, minimumOrderCents: 1500 },
  ] },
};
const request = CreateOrderSchema.parse({
  clientId: '11111111-1111-4111-8111-111111111111', channel: 'online', type: 'delivery',
  lines: [{ productId, qty: 2 }], payment: { method: 'online' },
  pickup: { slot: '2026-09-06T18:00:00.000Z', customerName: 'Camille', customerPhone: '0612345678' },
  delivery: { address: { line1: '12 rue des Fleurs', postalCode: '69001', city: 'Lyon', country: 'FR' } },
});

function setup(discount = 0, capabilities = ['online', 'delivery']) {
  const existing = { trackingToken: 'existing-secret' };
  const orders = {
    findOne: vi.fn().mockResolvedValue(null),
    create: vi.fn(async (doc: Record<string, unknown>) => ({ ...doc, toObject: () => doc })),
  };
  const products = { find: vi.fn(() => ({ lean: async () => [{ _id: productId, name: 'Burger', price: 1000, variants: [], optionGroups: [], active: true }] })) };
  const promotions = {
    find: vi.fn(() => ({ lean: async () => discount ? [{ _id: 'promo', name: 'Bienvenue', kind: 'amount', value: discount, active: true, channels: ['online'], code: null }] : [] })),
    findOneAndUpdate: vi.fn().mockResolvedValue({ usageCount: 1 }),
    updateOne: vi.fn().mockResolvedValue({ modifiedCount: 1 }),
  };
  const counters = { findOneAndUpdate: vi.fn().mockResolvedValue({ seq: 12 }) };
  const tenants = { findById: vi.fn(() => ({ lean: async () => tenant })) };
  const redis = { publish: vi.fn().mockResolvedValue(1) };
  const admissions = pricingAdmissionPort((candidate) => orders.create(candidate));
  const service = new OrdersService(orders as never, products as never, counters as never, promotions as never, redis as never, {} as never, tenants as never, { pourTenant: async () => capabilities } as never, {} as never, admissions as never);
  return { service, orders, products, promotions, counters, tenants, redis, existing };
}

describe('création livraison : prix, promotion et compensation', () => {
  it.each(['online', 'pos', 'phone'] as const)('prouve l’absence de tentative dès la création %s sans exposer le protocole au temps réel', async (channel) => {
    const ctx = setup(0, ['bo']);
    // Constructor/privacy unit: unslotted ticket. Slotted publication is proven
    // by the real durable-journal suite, not by this pricing-only port.
    const dto = CreateOrderSchema.parse({ ...request, channel, type: 'emporter', pickup: undefined, delivery: undefined });
    await ctx.service.createWithOutcome(tenantId, dto, 'client');
    expect(ctx.orders.create).toHaveBeenCalledWith(expect.objectContaining({
      channel, paymentFlow: expect.objectContaining({ origin: 'created_v1', phase: 'open', attempt: null }),
    }));
    expect(ctx.redis.publish).toHaveBeenCalledOnce();
    expect(JSON.parse(ctx.redis.publish.mock.calls[0]![1] as string).payload).not.toHaveProperty('paymentFlow');
  });
  it('fige les frais serveur après promotion sans les inclure dans la remise', async () => {
    const ctx = setup(200);
    const result = await ctx.service.createWithOutcome(tenantId, request, 'client');
    expect(result.created).toBe(true);
    expect(ctx.orders.create).toHaveBeenCalledWith(expect.objectContaining({
      type: 'delivery', channel: 'online',
      totals: { subtotal: 2000, discount: { amount: 200, reason: 'Bienvenue', promotionId: 'promo' }, deliveryFee: 250, total: 2050 },
      payment: expect.objectContaining({ method: 'online', status: 'pending' }),
      paymentFlow: expect.objectContaining({ version: 1, origin: 'created_v1', phase: 'open', attempt: null }),
      delivery: expect.objectContaining({ address: request.delivery?.address, feeCents: 250, zoneId: 'centre', dispatchedAt: null }),
    }));
    expect(ctx.promotions.updateOne).not.toHaveBeenCalled();
  });

  it('refuse le minimum net après promotion et rend sa réservation', async () => {
    const ctx = setup(600);
    await expect(ctx.service.createWithOutcome(tenantId, request, 'client')).rejects.toThrow(/minimum|15,00/);
    expect(ctx.promotions.findOneAndUpdate).toHaveBeenCalledOnce();
    expect(ctx.promotions.updateOne).toHaveBeenCalledWith({ _id: 'promo', tenantId, usageCount: { $gt: 0 } }, { $inc: { usageCount: -1 } });
    expect(ctx.orders.create).not.toHaveBeenCalled();
    expect(ctx.redis.publish).not.toHaveBeenCalled();
  });

  it('rend également le quota si le compteur de commande échoue avant écriture', async () => {
    const ctx = setup(200);
    ctx.counters.findOneAndUpdate.mockRejectedValue(new Error('Counter indisponible'));
    await expect(ctx.service.createWithOutcome(tenantId, request, 'client')).rejects.toThrow('Counter indisponible');
    expect(ctx.promotions.updateOne).toHaveBeenCalledOnce();
    expect(ctx.orders.create).not.toHaveBeenCalled();
  });

  it('un rejeu existant ne recalcule ni promotion ni tarif livraison', async () => {
    const ctx = setup(200);
    ctx.orders.findOne.mockResolvedValue(ctx.existing);
    await expect(ctx.service.createWithOutcome(tenantId, request, 'client')).resolves.toEqual({ order: ctx.existing, created: false });
    expect(ctx.products.find).not.toHaveBeenCalled();
    expect(ctx.promotions.findOneAndUpdate).not.toHaveBeenCalled();
    expect(ctx.tenants.findById).not.toHaveBeenCalled();
    expect(ctx.orders.create).not.toHaveBeenCalled();
    expect(ctx.existing).not.toHaveProperty('paymentFlow');
  });

  it('une course sur clientId récupère la gagnante et rend la promotion perdante', async () => {
    const ctx = setup(200);
    ctx.orders.findOne.mockResolvedValueOnce(null).mockResolvedValueOnce(ctx.existing);
    ctx.orders.create.mockRejectedValue({ code: 11000 });
    await expect(ctx.service.createWithOutcome(tenantId, request, 'client')).resolves.toEqual({ order: ctx.existing, created: false });
    expect(ctx.promotions.updateOne).toHaveBeenCalledOnce();
    expect(ctx.redis.publish).not.toHaveBeenCalled();
  });
});
