import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SlotsService, type TenantWithId } from './slots.service';
import type { OrderCapacityAvailabilityDay } from './order-capacity-availability.service';

const DAY = '2026-09-07';
const SLOT = '2026-09-07T10:00:00.000Z';
const tenant = { _id: '507f1f77bcf86cd799439011', onlineDelivery: true, account: { status: 'active' },
  encaissement: { accountId: 'acct_example', chargesEnabled: true },
  settings: { slotIntervalMin: 10, slotCapacity: 100 }, closures: [],
  hours: [{ day: 1, lunch: { open: '11:00', close: '14:00' }, dinner: null }],
  delivery: { enabled: true, leadTimeMin: 60, slotCapacity: 50,
    zones: [{ id: 'zone', name: 'Zone', postalCodes: ['69001'], feeCents: 0, minimumOrderCents: 0 }] },
} as unknown as TenantWithId;
function day(kitchenTaken = 1, deliveryTaken = 1): OrderCapacityAvailabilityDay {
  return { day: DAY, sourceRevision: 1, frozen: true, closedReason: null,
    slots: [{ at: new Date(SLOT), kitchenCapacity: 2, deliveryCapacity: 1, kitchenTaken, deliveryTaken }] };
}
function setup(value = day()) {
  const readDay = vi.fn(async () => value);
  const previewDay = vi.fn(async (): Promise<OrderCapacityAvailabilityDay> => ({ ...value, slots: [] }));
  return { service: new SlotsService({ readDay, previewDay } as never), readDay, previewDay };
}
beforeEach(() => vi.useFakeTimers({ toFake: ['Date'] }).setSystemTime('2026-09-06T08:00:00.000Z'));
afterEach(() => vi.useRealTimers());

describe('SlotsService raccordé au calendrier et aux sièges durables', () => {
  it('garde la grille et la capacité figées même quand les réglages actuels sont plus larges', async () => {
    const ctx = setup();
    const result = await ctx.service.compute(tenant, DAY);
    expect(result.capacity).toBe(2);
    expect(result.slots).toEqual([{ iso: SLOT, label: '12:00', service: 'lunch', remaining: 1, full: false, load: 'busy' }]);
    expect(ctx.readDay).toHaveBeenCalledWith(String(tenant._id), DAY);
  });
  it('ne rouvre pas la livraison quand sa dimension durable est pleine', async () => {
    const result = await setup().service.compute(tenant, DAY, 'delivery');
    expect(result.capacity).toBe(1);
    expect(result.slots[0]).toMatchObject({ remaining: 0, full: true });
  });
  it('refuse la dernière place déjà engagée avant matérialisation de sa commande', async () => {
    await expect(setup(day(2, 0)).service.exigerDisponible(tenant, SLOT)).rejects.toThrow(/complet/);
  });
  it('ne change pas la grille figée après modification des horaires ou fermetures', async () => {
    const modified = { ...tenant, hours: [], closures: [{ from: new Date('2026-09-07'), to: new Date('2026-09-07'), reason: 'Nouvelle fermeture' }] } as unknown as TenantWithId;
    expect((await setup().service.compute(modified, DAY)).slots.map(({ iso }) => iso)).toEqual([SLOT]);
  });
  it('applique encore le délai public et le délai livraison', async () => {
    vi.setSystemTime('2026-09-07T09:30:00.000Z');
    expect((await setup().service.compute(tenant, DAY)).slots).toHaveLength(1);
    expect((await setup().service.compute(tenant, DAY, 'delivery')).slots).toHaveLength(0);
  });
  it('conserve pause et Connect comme garde dynamique', async () => {
    const paused = { ...tenant, settings: { ...tenant.settings, onlineOrderingPaused: true } } as TenantWithId;
    expect(await setup().service.compute(paused, DAY)).toMatchObject({ paused: true });
    await expect(setup().service.exigerDisponible(paused, SLOT)).rejects.toThrow(/suspendue/);
    const disconnected = { ...tenant, encaissement: { ...tenant.encaissement, chargesEnabled: false } } as TenantWithId;
    expect(await setup().service.compute(disconnected, DAY, 'delivery')).toMatchObject({ paused: true, slots: [] });
  });
  it('ne masque pas une indisponibilité durable par un fallback aux Orders', async () => {
    const ctx = setup();
    ctx.readDay.mockRejectedValueOnce(new Error('calendar unavailable'));
    await expect(ctx.service.compute(tenant, DAY)).rejects.toThrow('calendar unavailable');
  });
  it('la recherche de prochaine ouverture consulte les plans sans compter les Orders', async () => {
    const ctx = setup({ ...day(), slots: [], closedReason: 'no_service' });
    ctx.previewDay.mockResolvedValueOnce({ ...day(), day: '2026-09-08' });
    expect(await ctx.service.compute(tenant, DAY)).toMatchObject({ closedToday: true, nextOpenDate: '2026-09-08' });
    expect(ctx.readDay).toHaveBeenCalledTimes(1);
    expect(ctx.previewDay).toHaveBeenCalledWith(String(tenant._id), '2026-09-08');
  });
});
