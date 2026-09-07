import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Types } from 'mongoose';
import { OrderCapacityCalendarStore } from './order-capacity-calendar.store';
import { OrderCapacityAvailabilityService } from './order-capacity-availability.service';

const TENANT = '507f1f77bcf86cd799439011';
const DAY = '2026-09-07';
const AT = new Date('2026-09-07T10:00:00.000Z');
const control = () => ({ version: 1, state: 'active', configRevision: 3,
  bootstrapId: 'cfd31f52-ad38-454a-a94a-0d8497b7a1c7', cutoverAt: new Date('2026-09-06T22:00:00.000Z'), dayIntent: null });
const plan = () => ({ day: DAY, sourceRevision: 2, frozen: true, closedReason: null,
  slots: [{ at: AT, kitchenCapacity: 4, deliveryCapacity: 2 }] });
function row(seat: number, overrides: Record<string, unknown> = {}) {
  return { _id: `admission-${seat}`, tenantId: new Types.ObjectId(TENANT), state: 'committing',
    slot: AT, orderId: new Types.ObjectId(), capacity: { slot: AT, kitchenSeat: seat }, ...overrides };
}
function setup(rows: Record<string, unknown>[] = [], controls: unknown[] = [control(), control()]) {
  const operations: string[] = [];
  const query = { select: vi.fn().mockReturnThis(), read: vi.fn().mockReturnThis(),
    readConcern: vi.fn().mockReturnThis(), maxTimeMS: vi.fn().mockReturnThis(),
    lean: vi.fn().mockImplementation(async () => ({ capacityControl: controls.shift() })) };
  const tenants = { findById: vi.fn(() => query) };
  const close = vi.fn(async () => { operations.push('close'); });
  const aggregate = vi.fn((_pipeline: unknown[], _options: unknown) => ({
    async *[Symbol.asyncIterator]() { for (const value of rows) yield value; }, close,
  }));
  const preview = vi.spyOn(OrderCapacityCalendarStore.prototype, 'preview').mockImplementation(async () => structuredClone(plan()));
  const service = new OrderCapacityAvailabilityService(tenants as never, {} as never, { collection: { aggregate } } as never, {} as never);
  return { service, query, tenants, aggregate, close, preview, operations };
}
beforeEach(() => vi.restoreAllMocks());

describe('disponibilité : sièges durables uniquement, lecture sans effet', () => {
  it('compte committing avant Order et created une seule fois, cuisine et livraison séparées', async () => {
    const ctx = setup([row(0), row(1, { state: 'created', capacity: { slot: AT, kitchenSeat: 1, deliverySeat: 0 } })]);
    expect(await ctx.service.readDay(TENANT, DAY)).toMatchObject({ frozen: true,
      slots: [{ kitchenCapacity: 4, deliveryCapacity: 2, kitchenTaken: 2, deliveryTaken: 1 }] });
    expect(ctx.query.read).toHaveBeenCalledWith('primary');
    expect(ctx.query.readConcern).toHaveBeenCalledWith('majority');
    expect(ctx.aggregate).toHaveBeenCalledWith(expect.any(Array), expect.objectContaining({ readPreference: 'primary', readConcern: { level: 'majority' }, maxTimeMS: 10_000 }));
    expect(ctx.close).toHaveBeenCalledOnce();
  });

  it('ne libère pas une place selon le statut Order, seulement selon la preuve de libération', async () => {
    const ctx = setup([row(0, { state: 'created' }), row(1, { capacity: { slot: AT, releasedAt: new Date() } })]);
    expect((await ctx.service.readDay(TENANT, DAY)).slots[0]?.kitchenTaken).toBe(1);
  });

  it.each([undefined, null, { ...control(), state: 'seeding' }, { ...control(), state: 'blocked' }])('refuse le contrôle absent ou non actif : %j', async (value) => {
    const ctx = setup([], [value]);
    await expect(ctx.service.readDay(TENANT, DAY)).rejects.toMatchObject({ status: 503 });
    expect(ctx.preview).not.toHaveBeenCalled();
    expect(ctx.aggregate).not.toHaveBeenCalled();
  });

  it('refuse une journée avant le cutover Paris', async () => {
    const ctx = setup();
    await expect(ctx.service.readDay(TENANT, '2026-09-06')).rejects.toMatchObject({ status: 503 });
    expect(ctx.preview).not.toHaveBeenCalled();
  });

  it.each([
    ['double siège cuisine', [row(0), row(0)]],
    ['double siège livreur', [row(0, { capacity: { slot: AT, kitchenSeat: 0, deliverySeat: 0 } }), row(1, { capacity: { slot: AT, kitchenSeat: 1, deliverySeat: 0 } })]],
    ['siège hors capacité', [row(4)]],
    ['livreur hors capacité', [row(0, { capacity: { slot: AT, kitchenSeat: 0, deliverySeat: 2 } })]],
    ['siège libéré mais présent', [row(0, { capacity: { slot: AT, kitchenSeat: 0, releasedAt: new Date() } })]],
    ['siège fractionnaire', [row(0, { capacity: { slot: AT, kitchenSeat: 0.5 } })]],
    ['admission validante avec siège', [row(0, { state: 'validating' })]],
    ['admission commise sans siège', [row(0, { capacity: null })]],
    ['créneau admission différent', [row(0, { slot: new Date(AT.getTime() + 60_000) })]],
    ['créneau capacité illisible', [row(0, { capacity: { slot: 'bad', kitchenSeat: 0 } })]],
    ['créneau hors grille', [row(0, { slot: new Date(AT.getTime() + 60_000), capacity: { slot: new Date(AT.getTime() + 60_000), kitchenSeat: 0 } })]],
    ['commande sans identité', [row(0, { orderId: null })]],
  ])('ferme la disponibilité corrompue : %s', async (_label, rows) => {
    const ctx = setup(rows as Record<string, unknown>[]);
    await expect(ctx.service.readDay(TENANT, DAY)).rejects.toMatchObject({ status: 503 });
    expect(ctx.close).toHaveBeenCalledOnce();
  });

  it('ferme une dérive de contrôle pendant la lecture', async () => {
    const ctx = setup([], [control(), { ...control(), state: 'blocked' }]);
    await expect(ctx.service.readDay(TENANT, DAY)).rejects.toMatchObject({ status: 503 });
  });

  it('ferme une révision de réglages différente pendant la lecture', async () => {
    const ctx = setup([], [control(), { ...control(), configRevision: 4 }]);
    await expect(ctx.service.readDay(TENANT, DAY)).rejects.toMatchObject({ status: 503 });
  });

  it('ne fige pas une journée nouvelle lors de sa consultation', async () => {
    const ctx = setup();
    ctx.preview.mockResolvedValue({ ...plan(), frozen: false } as never);
    expect(await ctx.service.readDay(TENANT, DAY)).toMatchObject({ frozen: false, slots: [{ kitchenTaken: 0, deliveryTaken: 0 }] });
  });

  it('retourne une indisponibilité explicite si la source Mongo ne répond pas', async () => {
    const ctx = setup();
    ctx.aggregate.mockImplementationOnce(() => { throw new Error('read timeout'); });
    await expect(ctx.service.readDay(TENANT, DAY)).rejects.toMatchObject({ status: 503 });
  });

  it('consulte la prochaine grille sans ouvrir de curseur de réservations', async () => {
    const ctx = setup();
    expect(await ctx.service.previewDay(TENANT, DAY)).toMatchObject({ day: DAY, frozen: true });
    expect(ctx.aggregate).not.toHaveBeenCalled();
  });

  it('refuse aussi une prochaine grille si le contrôle est bloqué pendant sa lecture', async () => {
    const ctx = setup([], [control(), { ...control(), state: 'blocked' }]);
    await expect(ctx.service.previewDay(TENANT, DAY)).rejects.toMatchObject({ status: 503 });
    expect(ctx.aggregate).not.toHaveBeenCalled();
  });

  it('ferme une dérive de plan pendant la lecture, sans afficher une ancienne capacité', async () => {
    const ctx = setup();
    ctx.preview.mockResolvedValueOnce(plan() as never).mockResolvedValueOnce({ ...plan(), slots: [] } as never);
    await expect(ctx.service.readDay(TENANT, DAY)).rejects.toMatchObject({ status: 503 });
  });

  it('scope les preuves au tenant et à la journée demandés, sans données client ni snapshot', async () => {
    const ctx = setup();
    await ctx.service.readDay(TENANT, DAY);
    const pipeline = ctx.aggregate.mock.calls[0]![0] as unknown as Record<string, unknown>[];
    expect(pipeline[0]).toMatchObject({ $match: { tenantId: new Types.ObjectId(TENANT) } });
    expect(pipeline[1]).toEqual({ $project: { _id: 1, state: 1, slot: 1, orderId: 1, capacity: 1 } });
    expect(JSON.stringify(pipeline)).not.toMatch(/proofHash|payloadHash|snapshot|customer/);
  });
});
