import 'reflect-metadata';
import { Mongoose } from 'mongoose';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TenantSchema, type Tenant } from '@sm/db';
import { SiteService } from './site.service';
import { SlotsService } from './slots.service';
import { buildOrderCapacityCalendar } from './order-capacity-calendar';

const TENANT = '507f1f77bcf86cd799439011';
const DAY = '2026-09-08';
const zone = { id: 'centre', name: 'Centre fixture', postalCodes: ['69001'], feeCents: 350,
  minimumOrderCents: 1500, freeDeliveryFromCents: 3000 };
const TenantModel = new Mongoose().model<Tenant>('DeliverySiteHydrationTenant', TenantSchema.clone());

/** The repository boundary returns a real hydrated Tenant, as TenantsService.bySlug does.
 * Menu/reviews/calendar storage are isolated; neither service nor the delivery helper is mocked. */
function fixture({ enabled = true, chargesEnabled = true, connected = true, subscribed = true } = {}) {
  const tenant = TenantModel.hydrate({
    _id: TENANT, slug: 'delivery-hydrated', name: 'Restaurant fixture', brand: null,
    plan: 'essentiel', onlineOrdering: true, onlineDelivery: subscribed, account: { status: 'active' },
    settings: { onlineOrderingPaused: false, slotIntervalMin: 30, slotCapacity: 7 },
    hours: Array.from({ length: 7 }, (_, index) => ({ day: index + 1,
      lunch: { open: '11:00', close: '14:00' }, dinner: { open: '18:00', close: '22:00' } })),
    closures: [], delivery: { enabled, leadTimeMin: 75, slotCapacity: 3, zones: [zone] },
    encaissement: connected ? { accountId: 'acct_fixture', chargesEnabled, payoutsEnabled: true,
      detailsSubmitted: true, raccordeLe: new Date('2026-09-01T09:00:00Z'), synchroniseLe: new Date('2026-09-01T09:00:00Z') } : null,
  });
  const previewDay = vi.fn(async (_tenantId: string, day: string) => {
    const plan = buildOrderCapacityCalendar(tenant, day);
    return { day, sourceRevision: 1, frozen: true, closedReason: plan.emptyReason, slots: plan.slots };
  });
  const readDay = vi.fn(async (tenantId: string, day: string) => {
    const plan = await previewDay(tenantId, day);
    return { ...plan, slots: plan.slots.map(slot => ({ ...slot, kitchenTaken: 0, deliveryTaken: 0 })) };
  });
  const slots = new SlotsService({ readDay, previewDay } as never);
  const tenants = { bySlug: vi.fn(async () => tenant) };
  const menu = { publicMenu: vi.fn(async () => ({ categories: [], medias: [], featuredConfigured: false })) };
  const reviews = { aggregate: vi.fn(async () => []), find: vi.fn(() => ({ sort: () => ({ limit: () => ({ lean: async () => [] }) }) })) };
  const site = new SiteService(reviews as never, tenants as never, slots, menu as never);
  return { tenant, site, slots, tenants, readDay };
}

afterEach(() => vi.useRealTimers());

describe('livraison publique — SiteService et SlotsService avec Tenant hydraté', () => {
  it('le site expose réellement la livraison et ses zones sans perdre les réglages Mongoose', async () => {
    vi.useFakeTimers().setSystemTime('2026-09-07T09:00:00.000Z');
    const ctx = fixture();
    expect(ctx.tenant.delivery).toBeInstanceOf(Mongoose.prototype.Document);
    const result = await ctx.site.build('delivery-hydrated', DAY);
    expect(ctx.tenants.bySlug).toHaveBeenCalledExactlyOnceWith('delivery-hydrated');
    expect(result.ordering.paused).toBe(false);
    expect(result.delivery).toEqual({ available: true, zones: [zone], leadTimeMin: 75, paymentRequired: 'online' });
    expect(result.slots.slots.length).toBeGreaterThan(0);
    expect(result.slots.capacity).toBe(7);
    expect(JSON.stringify(result.delivery)).not.toMatch(/\$__|_doc|acct_fixture/);
  });

  it('le calcul consommé par le checkout expose les créneaux livraison et leur capacité', async () => {
    vi.useFakeTimers().setSystemTime('2026-09-07T09:00:00.000Z');
    const ctx = fixture();
    const result = await ctx.slots.compute(ctx.tenant, DAY, 'delivery');
    expect(result).toMatchObject({ paused: false, closedToday: false, capacity: 3, leadTimeMin: 75 });
    expect(result.slots).toContainEqual(expect.objectContaining({ iso: '2026-09-08T09:00:00.000Z', remaining: 3, full: false }));
    expect(ctx.readDay).toHaveBeenCalledExactlyOnceWith(TENANT, DAY);
  });

  it.each([
    ['désactivée par le restaurant', { enabled: false }],
    ['encaissement non prêt', { chargesEnabled: false }],
    ['compte bancaire absent', { connected: false }],
    ['capacité livraison non souscrite', { subscribed: false }],
  ] as const)('garde la livraison fermée si %s sans fermer le retrait', async (_label, options) => {
    vi.useFakeTimers().setSystemTime('2026-09-07T09:00:00.000Z');
    const ctx = fixture(options);
    const result = await ctx.site.build('delivery-hydrated', DAY);
    expect(result.delivery).toEqual({ available: false, zones: [], leadTimeMin: 75, paymentRequired: 'online' });
    expect(result.ordering.paused).toBe(false);
    expect(result.slots.slots.length).toBeGreaterThan(0);
    const delivery = await ctx.slots.compute(ctx.tenant, DAY, 'delivery');
    expect(delivery).toMatchObject({ paused: true, closedToday: true, slots: [], leadTimeMin: 75 });
    await expect(ctx.slots.exigerDisponible(ctx.tenant, '2026-09-08T09:00:00.000Z', 'delivery')).rejects.toThrow(/suspendue/);
  });
});
