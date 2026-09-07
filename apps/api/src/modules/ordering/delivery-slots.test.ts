import { afterEach, describe, expect, it, vi } from 'vitest';
import { SlotsService, type TenantWithId } from './slots.service';
import { buildOrderCapacityCalendar } from './order-capacity-calendar';

const tenant = {
  _id: '507f1f77bcf86cd799439011', onlineDelivery: true, account: { status: 'active' },
  encaissement: { accountId: 'acct_restaurant', chargesEnabled: true },
  hours: Array.from({ length: 7 }, (_, index) => ({ day: index + 1, lunch: { open: '11:00', close: '14:00' }, dinner: { open: '18:00', close: '22:00' } })),
  settings: { slotIntervalMin: 30, slotCapacity: 4 }, closures: [],
  delivery: { enabled: true, leadTimeMin: 60, slotCapacity: 2, zones: [{ id: 'centre', name: 'Centre', postalCodes: ['69001'], feeCents: 250, minimumOrderCents: 1500 }] },
} as unknown as TenantWithId;
const slot = '2026-09-06T10:00:00.000Z';

function setup(kitchen: number, delivery: number) {
  const previewDay = vi.fn(async (_tenantId: string, day: string) => {
    const grid = buildOrderCapacityCalendar(tenant, day);
    return { day, sourceRevision: 1, frozen: true, closedReason: grid.emptyReason, slots: grid.slots };
  });
  const readDay = vi.fn(async (tenantId: string, day: string) => {
    const plan = await previewDay(tenantId, day);
    return { ...plan, slots: plan.slots.map((entry) => ({ ...entry,
      kitchenTaken: entry.at.toISOString() === slot ? kitchen : 0,
      deliveryTaken: entry.at.toISOString() === slot ? delivery : 0 })) };
  });
  return { service: new SlotsService({ readDay, previewDay } as never) };
}
afterEach(() => vi.useRealTimers());

describe('capacité livraison et cuisine partagée', () => {
  it('refuse une livraison si les livreurs sont complets même quand la cuisine a de la place', async () => {
    vi.useFakeTimers().setSystemTime('2026-09-05T09:00:00.000Z');
    const ctx = setup(2, 2);
    await expect(ctx.service.exigerDisponible(tenant, slot, 'delivery')).rejects.toThrow(/complet/);
    await expect(ctx.service.exigerDisponible(tenant, slot, 'pickup')).resolves.toBeUndefined();
  });
  it('refuse livraison si la capacité cuisine est pleine, même sans autre livraison', async () => {
    vi.useFakeTimers().setSystemTime('2026-09-05T09:00:00.000Z');
    await expect(setup(4, 0).service.exigerDisponible(tenant, slot, 'delivery')).rejects.toThrow(/complet/);
  });
  it('applique le délai de préparation et trajet uniquement à la livraison', async () => {
    vi.useFakeTimers().setSystemTime('2026-09-06T09:20:00.000Z');
    const ctx = setup(0, 0);
    expect((await ctx.service.compute(tenant, '2026-09-06', 'delivery')).slots.map((value) => value.iso)).not.toContain(slot);
    expect((await ctx.service.compute(tenant, '2026-09-06', 'pickup')).slots.map((value) => value.iso)).toContain(slot);
  });
  it('ferme uniquement la livraison lorsque le restaurant la suspend', async () => {
    vi.useFakeTimers().setSystemTime('2026-09-05T09:00:00.000Z');
    const closed = { ...tenant, delivery: { ...tenant.delivery, enabled: false } } as TenantWithId;
    expect(await setup(0, 0).service.compute(closed, '2026-09-06', 'delivery')).toMatchObject({ slots: [], paused: true });
    expect((await setup(0, 0).service.compute(closed, '2026-09-06', 'pickup')).slots.length).toBeGreaterThan(0);
  });
});
