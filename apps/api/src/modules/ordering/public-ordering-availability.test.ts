import 'reflect-metadata';
import { ServiceUnavailableException } from '@nestjs/common';
import { Mongoose } from 'mongoose';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PublicOrderingAvailabilitySchema } from '@sm/contracts';
import { TenantSchema, type Tenant } from '@sm/db';
import { buildOrderCapacityCalendar } from './order-capacity-calendar';
import { OrderingController } from './ordering.controller';
import { SiteService } from './site.service';
import { SlotsService } from './slots.service';

const TENANT = '507f1f77bcf86cd799439011';
const TenantModel = new Mongoose().model<Tenant>('AvailabilityTenant', TenantSchema.clone());

/** Real hydrated tenant, calendar and slot calculations; storage boundaries only are isolated. */
function fixture() {
  const tenant = TenantModel.hydrate({
    _id: TENANT, slug: 'restaurant', name: 'Restaurant',
    plan: 'essentiel', onlineOrdering: true, account: { status: 'active' },
    settings: { onlineOrderingPaused: false, pauseMessage: 'Pause cuisine', slotIntervalMin: 10, slotCapacity: 4 },
    hours: Array.from({ length: 7 }, (_, index) => ({ day: index + 1,
      lunch: { open: '11:00', close: '14:00' }, dinner: { open: '18:00', close: '22:00' } })),
    closures: [],
  });
  let full = false;
  const previewDay = vi.fn(async (_tenantId: string, day: string) => {
    const calendar = buildOrderCapacityCalendar(tenant, day);
    return { day, sourceRevision: 1, frozen: true, closedReason: calendar.emptyReason, slots: calendar.slots };
  });
  const readDay = vi.fn(async (tenantId: string, day: string) => {
    const plan = await previewDay(tenantId, day);
    return { ...plan, slots: plan.slots.map(slot => ({ ...slot,
      kitchenTaken: full ? slot.kitchenCapacity : 0, deliveryTaken: 0 })) };
  });
  const slots = new SlotsService({ readDay, previewDay } as never);
  const tenants = { bySlug: vi.fn(async () => tenant) };
  const menu = { publicMenu: vi.fn(async () => ({ categories: [], medias: [], featuredConfigured: false })) };
  const reviews = { aggregate: vi.fn(async () => []), find: vi.fn(() => ({ sort: () => ({ limit: () => ({ lean: async () => [] }) }) })) };
  const service = new SiteService(reviews as never, tenants as never, slots, menu as never);
  return { service, tenant, tenants, slots, readDay, menu, reviews, fill: () => { full = true; } };
}

afterEach(() => vi.useRealTimers());

describe('public ordering availability', () => {
  it('refreshes a long-lived page past closing without loading menu, reviews or branding', async () => {
    vi.useFakeTimers().setSystemTime('2026-09-21T19:00:00.000Z');
    const ctx = fixture();
    const first = await ctx.service.availability('restaurant');
    expect(first).toMatchObject({ openNow: true, ordering: { paused: false }, observedAt: '2026-09-21T19:00:00.000Z' });
    expect(first.slots.slots[0]?.label).toBe('21:20');
    vi.setSystemTime('2026-09-21T21:12:32.000Z');
    const next = await ctx.service.availability('restaurant');
    expect(next).toMatchObject({ openNow: false, observedAt: '2026-09-21T21:12:32.000Z', slots: { slots: [], closedToday: true } });
    expect(ctx.tenants.bySlug.mock.calls).toEqual([['restaurant'], ['restaurant']]);
    expect(ctx.readDay).toHaveBeenCalledTimes(2);
    expect(ctx.menu.publicMenu).not.toHaveBeenCalled();
    expect(ctx.reviews.aggregate).not.toHaveBeenCalled();
    expect(ctx.reviews.find).not.toHaveBeenCalled();
    expect(Object.keys(next).sort()).toEqual(['observedAt', 'openNow', 'ordering', 'slots', 'timezone', 'todayHours']);
    expect(PublicOrderingAvailabilitySchema.safeParse(next).success).toBe(true);
  });

  it.each(['manual', 'suspended', 'unsubscribed'] as const)('shares the site gate for a newly %s restaurant', async (state) => {
    vi.useFakeTimers().setSystemTime('2026-09-21T16:00:00.000Z');
    const ctx = fixture();
    expect((await ctx.service.availability('restaurant')).ordering.paused).toBe(false);
    if (state === 'manual') ctx.tenant.set('settings.onlineOrderingPaused', true);
    if (state === 'suspended') ctx.tenant.set('account.status', 'suspended');
    if (state === 'unsubscribed') ctx.tenant.set('onlineOrdering', false);
    const next = await ctx.service.availability('restaurant');
    const initialSite = await ctx.service.build('restaurant');
    expect(next.ordering).toEqual(initialSite.ordering);
    expect(next.ordering.paused).toBe(true);
    expect(next.openNow).toBe(true);
    if (state !== 'manual') expect(next.ordering.message).not.toBe('Pause cuisine');
  });

  it('does not equate future slots, full capacity or opening hours with opening right now', async () => {
    vi.useFakeTimers().setSystemTime('2026-09-21T07:00:00.000Z');
    const ctx = fixture();
    const before = await ctx.service.availability('restaurant');
    expect(before.openNow).toBe(false);
    expect(before.slots.closedToday).toBe(false);
    expect(before.slots.slots.length).toBeGreaterThan(0);
    vi.setSystemTime('2026-09-21T16:00:00.000Z');
    ctx.fill();
    const full = await ctx.service.availability('restaurant');
    expect(full.openNow).toBe(true);
    expect(full.slots.slots.every(slot => slot.full)).toBe(true);
    ctx.tenant.set('hours.0.dinner.open', '19:00');
    const changed = await ctx.service.availability('restaurant');
    expect(changed.openNow).toBe(false);
    expect(changed.todayHours?.dinner?.open).toBe('19:00');
  });

  it('computes the restaurant day afresh after midnight', async () => {
    vi.useFakeTimers().setSystemTime('2026-09-21T21:59:59.000Z');
    const ctx = fixture();
    expect((await ctx.service.availability('restaurant')).slots.date).toBe('2026-09-21');
    vi.setSystemTime('2026-09-21T22:00:01.000Z');
    const next = await ctx.service.availability('restaurant');
    expect(next.slots.date).toBe('2026-09-22');
    expect(next.todayHours?.day).toBe(2);
  });

  it('never renews the age of a slow observation or fabricates availability after a failed read', async () => {
    vi.useFakeTimers().setSystemTime('2026-09-21T16:00:00.000Z');
    const ctx = fixture();
    const result = await ctx.slots.compute(ctx.tenant);
    vi.spyOn(ctx.slots, 'compute').mockImplementationOnce(async () => {
      vi.setSystemTime('2026-09-21T16:02:00.000Z');
      return result;
    });
    expect((await ctx.service.availability('restaurant')).observedAt).toBe('2026-09-21T16:00:00.000Z');
    ctx.readDay.mockRejectedValueOnce(new ServiceUnavailableException('capacity unavailable'));
    await expect(ctx.service.availability('restaurant')).rejects.toThrow('capacity unavailable');
  });

  it('exposes a public no-store GET scoped only by URL slug', async () => {
    const availability = vi.fn().mockResolvedValue({ observedAt: 'fixture' });
    const controller = new OrderingController({} as never, {} as never, {} as never, {} as never, { availability } as never);
    expect(await controller.publicAvailability('restaurant')).toEqual({ observedAt: 'fixture' });
    expect(availability).toHaveBeenCalledExactlyOnceWith('restaurant');
    const handler = OrderingController.prototype.publicAvailability;
    expect(Reflect.getMetadata('isPublic', handler)).toBe(true);
    expect(Reflect.getMetadata('method', handler)).toBe(0);
    expect(Reflect.getMetadata('path', handler)).toBe('public/tenants/:slug/availability');
    expect(Reflect.getMetadata('__headers__', handler)).toContainEqual({ name: 'Cache-Control', value: 'no-store' });
  });
});
