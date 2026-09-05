import { describe, expect, it, vi } from 'vitest';
import { Mongoose } from 'mongoose';
import { ProductSchema } from '@sm/db';
import { CreateOrderSchema, DeliveryQuoteRequestSchema } from '@sm/contracts';
import { DeliveryService } from './delivery.service';
import { OrdersService } from '../orders/orders.service';

const tenantId = '507f1f77bcf86cd799439011';
const productId = '507f1f77bcf86cd799439012';
const ProductModel = new Mongoose().model('DeliveryQuoteProduct', ProductSchema);
const product = new ProductModel({
  _id: productId, tenantId, name: 'Kebab Fromage', price: 850, active: true, variants: [],
  optionGroups: [
    { key: 'fromage', name: 'Fromage inclus', type: 'single', min: 1, max: 1, choices: [{ key: 'cheddar', name: 'Cheddar', priceDelta: 0 }] },
    { key: 'supplements', name: 'Suppléments', type: 'multi', min: 0, max: 1, choices: [{ key: 'bacon', name: 'Bacon', priceDelta: 100 }] },
  ],
}).toObject();
const address = { line1: '12 rue des Fleurs', postalCode: '69001', city: 'Lyon', country: 'FR' as const };
const lines = [{ productId, qty: 2, options: [{ groupKey: 'fromage', choiceKey: 'cheddar' }], removed: [] }];
const tenant = {
  _id: tenantId, slug: 'restaurant', onlineDelivery: true, account: { status: 'active' },
  encaissement: { accountId: 'acct_restaurant', chargesEnabled: true },
  delivery: { enabled: true, leadTimeMin: 45, slotCapacity: 2, zones: [
    { id: 'centre', name: 'Centre', postalCodes: ['69001'], feeCents: 250, minimumOrderCents: 1500 },
  ] },
};
const promotion = (over: Record<string, unknown> = {}) => ({
  _id: 'promo', tenantId, name: 'Bienvenue', kind: 'amount', value: 200, active: true, channels: ['online'],
  code: null, maxUsage: 2, usageCount: 0, ...over,
});

function fixture(candidates: Record<string, unknown>[] = [], zoneOverrides: Record<string, unknown> = {}) {
  const localTenant = { ...tenant, delivery: { ...tenant.delivery, zones: [{ ...tenant.delivery.zones[0]!, ...zoneOverrides }] } };
  const writes = {
    findOneAndUpdate: vi.fn().mockResolvedValue({ usageCount: 1 }),
    updateOne: vi.fn().mockResolvedValue({ modifiedCount: 1 }),
  };
  const promotions = {
    find: vi.fn((filter: { tenantId: string; active: boolean; code: string | null }) => ({ lean: async () => candidates.filter((candidate) =>
      candidate.tenantId === filter.tenantId && candidate.active === filter.active && (candidate.code ?? null) === filter.code),
    })),
    ...writes,
  };
  const tenants = { findOne: vi.fn(() => ({ lean: async () => localTenant })), findById: vi.fn(() => ({ lean: async () => localTenant })) };
  const products = { find: vi.fn(() => ({ lean: async () => [product] })), updateOne: vi.fn(), bulkWrite: vi.fn() };
  const orders = { findOne: vi.fn().mockResolvedValue(null), create: vi.fn(async (doc: Record<string, unknown>) => ({ ...doc, toObject: () => doc })) };
  const audit = { log: vi.fn() };
  const redis = { publish: vi.fn().mockResolvedValue(1) };
  const counters = { findOneAndUpdate: vi.fn().mockResolvedValue({ seq: 12 }) };
  const payments = { createIntent: vi.fn(), cancelOrder: vi.fn() };
  const service = new DeliveryService(tenants as never, products as never, orders as never, audit as never, redis as never, promotions as never);
  const writer = new OrdersService(orders as never, products as never, counters as never, promotions as never, redis as never,
    audit as never, tenants as never, { pourTenant: async () => ['online', 'delivery'] } as never, payments as never);
  const noWrites = () => {
    for (const spy of [writes.findOneAndUpdate, writes.updateOne, products.updateOne, products.bulkWrite, orders.create,
      audit.log, redis.publish, counters.findOneAndUpdate, payments.createIntent, payments.cancelOrder]) expect(spy).not.toHaveBeenCalled();
  };
  return { service, writer, promotions, products, orders, noWrites, tenant: localTenant };
}

describe('devis livraison : prix nets identiques à la commande, aucune écriture', () => {
  it('une promotion qui rabaisse le panier sous le seuil rétablit les frais fixes', async () => {
    const ctx = fixture([promotion()], { feeCents: 500, freeDeliveryFromCents: 1800 });
    const selections = [{ ...lines[0]!, options: [...lines[0]!.options, { groupKey: 'supplements', choiceKey: 'bacon' }] }];
    expect(await ctx.service.quote('restaurant', { address, lines: selections })).toMatchObject({
      originalSubtotalCents: 1900, subtotalCents: 1700, standardFeeCents: 500, feeCents: 500,
      freeDeliveryFromCents: 1800, remainingForFreeDeliveryCents: 100, totalCents: 2200,
    });
    ctx.noWrites();
  });

  it('un supplément payant atteint le seuil net et les frais offerts sont figés à la création', async () => {
    const ctx = fixture([], { feeCents: 500, freeDeliveryFromCents: 1900 });
    expect(await ctx.service.quote('restaurant', { address, lines })).toMatchObject({
      subtotalCents: 1700, feeCents: 500, remainingForFreeDeliveryCents: 200,
    });
    const selections = [{ ...lines[0]!, options: [...lines[0]!.options, { groupKey: 'supplements', choiceKey: 'bacon' }] }];
    const quote = await ctx.service.quote('restaurant', { address, lines: selections });
    expect(quote).toMatchObject({ subtotalCents: 1900, standardFeeCents: 500, feeCents: 0, remainingForFreeDeliveryCents: 0, totalCents: 1900 });
    ctx.noWrites();
    await ctx.writer.createWithOutcome(tenantId, CreateOrderSchema.parse({
      clientId: '11111111-1111-4111-8111-111111111111', channel: 'online', type: 'delivery', lines: selections,
      payment: { method: 'online' }, delivery: { address },
      pickup: { slot: '2026-09-06T18:00:00.000Z', customerName: 'Camille', customerPhone: '0612345678' },
    }), 'client');
    const stored = ctx.orders.create.mock.calls[0]![0];
    expect(stored).toMatchObject({ delivery: { feeCents: 0 }, totals: { deliveryFee: 0, total: 1900 } });
    // La configuration change, pas le snapshot de la vente précédente.
    Object.assign(ctx.tenant.delivery.zones[0]!, { feeCents: 700, freeDeliveryFromCents: 5000 });
    expect(await ctx.service.quote('restaurant', { address, lines: selections })).toMatchObject({ feeCents: 700, totalCents: 2600 });
    expect(stored).toMatchObject({ delivery: { feeCents: 0 }, totals: { deliveryFee: 0, total: 1900 } });
  });

  it('la gratuité permanente conserve le minimum net et le verrou de souscription', async () => {
    const ctx = fixture([promotion()], { feeCents: 0, freeDeliveryFromCents: null });
    expect(await ctx.service.quote('restaurant', { address, lines })).toMatchObject({ subtotalCents: 1500, feeCents: 0, standardFeeCents: 0, remainingForFreeDeliveryCents: 0, totalCents: 1500 });
    await expect(ctx.service.quote('restaurant', { address, lines: [{ ...lines[0]!, qty: 1 }] })).rejects.toThrow(/minimum/);
    ctx.tenant.onlineDelivery = false;
    await expect(ctx.service.quote('restaurant', { address, lines })).rejects.toThrow(/indisponible/);
    expect(await ctx.service.publicSettings('restaurant')).toMatchObject({ available: false, zones: [] });
    ctx.noWrites();
  });

  it('applique la meilleure offre automatique avant le minimum et avant les frais', async () => {
    const ctx = fixture([promotion({ value: 100 }), promotion({ _id: 'best', value: 200 })]);
    expect(await ctx.service.quote('restaurant', { address, lines })).toMatchObject({
      originalSubtotalCents: 1700, subtotalCents: 1500, feeCents: 250, totalCents: 1750,
      discount: { amount: 200, reason: 'Bienvenue' },
    });
    ctx.noWrites();
  });

  it('refuse immédiatement un panier qui passe le minimum brut mais pas net après promotion', async () => {
    const ctx = fixture([promotion({ value: 300 })]);
    await expect(ctx.service.quote('restaurant', { address, lines })).rejects.toThrow(/minimum.*après remise/);
    ctx.noWrites();
  });

  it('lit uniquement le tenant et le code demandé, sans appliquer un code d’un autre restaurant ni une offre automatique', async () => {
    const ctx = fixture([promotion({ code: 'WELCOME', kind: 'percent', value: 10 }), promotion({ tenantId: 'other', code: 'WELCOME', value: 500 }), promotion({ value: 300 })]);
    const result = await ctx.service.quote('restaurant', { address, lines, promoCode: ' welcome ' });
    expect(ctx.promotions.find).toHaveBeenCalledWith({ tenantId, active: true, code: 'WELCOME' });
    expect(result).toMatchObject({ originalSubtotalCents: 1700, subtotalCents: 1530, totalCents: 1780, discount: { amount: 170, reason: 'WELCOME — Bienvenue' } });
    expect(result.discount).not.toHaveProperty('promotionId');
    expect(result.discount).not.toHaveProperty('id');
    ctx.noWrites();
  });

  it.each([
    [[], 'UNKNOWN', /aucune offre/],
    [[promotion({ code: 'WELCOME', channels: ['pos'] })], 'WELCOME', /pas valable.*en ligne/],
    [[promotion({ code: 'WELCOME', maxUsage: 2, usageCount: 2 })], 'WELCOME', /nombre d’utilisations/],
    [[promotion({ code: 'WELCOME', minSubtotalCents: 5000 })], 'WELCOME', /au moins 50,00/],
    [[promotion({ code: 'WELCOME', endsAt: new Date('2000-01-01') })], 'WELCOME', /terminée/],
  ] as const)('refuse le code avec la même raison métier que la création : %s', async (candidates, promoCode, reason) => {
    const ctx = fixture([...candidates]);
    await expect(ctx.service.quote('restaurant', { address, lines, promoCode })).rejects.toThrow(reason);
    const order = CreateOrderSchema.parse({
      clientId: '11111111-1111-4111-8111-111111111111', channel: 'online', type: 'delivery', lines, promoCode,
      payment: { method: 'online' }, delivery: { address },
      pickup: { slot: '2026-09-06T18:00:00.000Z', customerName: 'Camille', customerPhone: '0612345678' },
    });
    await expect(ctx.writer.createWithOutcome(tenantId, order, 'client')).rejects.toThrow(reason);
    ctx.noWrites();
  });

  it('ignore les promotions automatiques épuisées ou hors canal et sert le prix sans remise', async () => {
    const ctx = fixture([promotion({ maxUsage: 2, usageCount: 2 }), promotion({ channels: ['pos'] })]);
    expect(await ctx.service.quote('restaurant', { address, lines })).toMatchObject({ originalSubtotalCents: 1700, subtotalCents: 1700, totalCents: 1950, discount: null });
    ctx.noWrites();
  });

  it('inclut les suppléments serveur payants et les choix à zéro, puis rejoint le total de la vraie création', async () => {
    const ctx = fixture([promotion()]);
    const selections = [{ ...lines[0]!, options: [...lines[0]!.options, { groupKey: 'supplements', choiceKey: 'bacon' }] }];
    const quote = await ctx.service.quote('restaurant', { address, lines: selections });
    expect(quote).toMatchObject({ originalSubtotalCents: 1900, subtotalCents: 1700, totalCents: 1950 });
    ctx.noWrites();
    const request = CreateOrderSchema.parse({
      clientId: '11111111-1111-4111-8111-111111111111', channel: 'online', type: 'delivery', lines: selections,
      payment: { method: 'online' }, delivery: { address },
      pickup: { slot: '2026-09-06T18:00:00.000Z', customerName: 'Camille', customerPhone: '0612345678' },
    });
    await ctx.writer.createWithOutcome(tenantId, request, 'client');
    expect(ctx.promotions.findOneAndUpdate).toHaveBeenCalledOnce();
    expect(ctx.orders.create).toHaveBeenCalledWith(expect.objectContaining({ totals: {
      subtotal: quote.originalSubtotalCents, discount: { ...quote.discount, promotionId: 'promo' },
      deliveryFee: quote.feeCents, total: quote.totalCents,
    } }));
  });

  it('ne réserve aucun quota même après plusieurs devis successifs', async () => {
    const ctx = fixture([promotion({ maxUsage: 1 })]);
    await Promise.all(Array.from({ length: 4 }, () => ctx.service.quote('restaurant', { address, lines })));
    ctx.noWrites();
  });

  it('le contrat accepte le code facultatif borné mais aucun montant client', () => {
    expect(DeliveryQuoteRequestSchema.parse({ address, lines, promoCode: ' WELCOME ' }).promoCode).toBe('WELCOME');
    expect(DeliveryQuoteRequestSchema.safeParse({ address, lines }).success).toBe(true);
    expect(DeliveryQuoteRequestSchema.safeParse({ address, lines, promoCode: '' }).success).toBe(false);
    expect(DeliveryQuoteRequestSchema.safeParse({ address, lines, promoCode: 'x'.repeat(25) }).success).toBe(false);
    expect(DeliveryQuoteRequestSchema.safeParse({ address, lines, subtotalCents: 1, discount: { amount: 100 } }).success).toBe(false);
  });
});
