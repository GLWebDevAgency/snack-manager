import type { Model } from 'mongoose';
import { ORDER_CAPACITY_DAY_INDEX, ORDER_CAPACITY_INDEXES, type Order, type OrderCapacityDay, type PublicOrderAdmission } from '@sm/db';
import { describe, expect, it, vi } from 'vitest';
import { OrderCapacityCommitStore } from './order-capacity-commit.store';

function readyStats() {
  return {
    calendar: [{ name: ORDER_CAPACITY_DAY_INDEX, key: { tenantId: 1, day: 1 },
      spec: { name: ORDER_CAPACITY_DAY_INDEX, key: { tenantId: 1, day: 1 }, unique: true } }],
    admissions: ORDER_CAPACITY_INDEXES.map(({ name, field }) => ({ name,
      key: { tenantId: 1, 'capacity.slot': 1, [`capacity.${field}`]: 1 },
      spec: { name, key: { tenantId: 1, 'capacity.slot': 1, [`capacity.${field}`]: 1 }, unique: true,
        partialFilterExpression: { [`capacity.${field}`]: { $type: 'number' } } },
    })),
  };
}

function fixture() {
  const stats = readyStats();
  const collection = (rows: Record<string, unknown>[]) => ({
    aggregate: vi.fn(() => ({ toArray: vi.fn(async () => rows) })),
    // Le pilote listIndexes() expose la spec sans indiquer si elle est prête.
    listIndexes: vi.fn(() => ({ toArray: vi.fn(async () => rows.map((row) => row.spec)) })),
  });
  const calendar = collection(stats.calendar);
  const admissions = collection(stats.admissions);
  const store = new OrderCapacityCommitStore({ collection: admissions } as unknown as Model<PublicOrderAdmission>,
    {} as Model<Order>, { collection: calendar } as unknown as Model<OrderCapacityDay>);
  const run = () => (store as unknown as { assertIndexes(): Promise<void> }).assertIndexes();
  return { stats, calendar, admissions, run };
}

describe('preuve de disponibilité des index — raccordement réel du noyau', () => {
  it('accepte les trois index uniques terminés', async () => {
    await expect(fixture().run()).resolves.toBeUndefined();
  });

  it.each(['calendar', 'kitchen', 'delivery'] as const)('refuse l’index %s encore en construction même si sa spec existe', async (target) => {
    const ctx = fixture();
    const entry = target === 'calendar' ? ctx.stats.calendar[0]! : ctx.stats.admissions[target === 'kitchen' ? 0 : 1]!;
    Object.assign(entry, { building: true });
    await expect(ctx.run()).rejects.toMatchObject({ status: 503 });
  });

  it('lit les stats sur le primaire, avec délai et projection bornés, jamais listIndexes', async () => {
    const ctx = fixture();
    await ctx.run();
    for (const collection of [ctx.calendar, ctx.admissions]) {
      expect(collection.aggregate).toHaveBeenCalledWith([
        { $indexStats: {} },
        { $project: { _id: 0, name: 1, key: 1, spec: 1, building: 1 } },
        { $limit: 129 },
      ], { readPreference: 'primary', maxTimeMS: 10_000, timeoutMS: 10_000 });
      expect(collection.listIndexes).not.toHaveBeenCalled();
    }
  });

  it.each(['calendar', 'kitchen', 'delivery'] as const)('refuse l’absence de l’index %s', async (target) => {
    const ctx = fixture();
    if (target === 'calendar') ctx.stats.calendar.splice(0, 1);
    else ctx.stats.admissions.splice(target === 'kitchen' ? 0 : 1, 1);
    await expect(ctx.run()).rejects.toMatchObject({ status: 503 });
  });

  it.each([
    ['building illisible', { building: 'false' }],
    ['spec absente', { spec: undefined }],
    ['spec non objet', { spec: [] }],
    ['clé du résultat incohérente', { key: { tenantId: 1, 'capacity.slot': 1, other: 1 } }],
  ])('refuse %s', async (_label, patch) => {
    const ctx = fixture();
    Object.assign(ctx.stats.admissions[0]!, patch);
    await expect(ctx.run()).rejects.toMatchObject({ status: 503 });
  });

  it.each([
    ['pas unique', { unique: false }],
    ['unique non booléen', { unique: 1 }],
    ['mauvais nom', { name: 'another_index' }],
    ['mauvaise clé', { key: { tenantId: 1, 'capacity.slot': 1 } }],
    ['ordre de clé différent', { key: { 'capacity.slot': 1, tenantId: 1, 'capacity.kitchenSeat': 1 } }],
    ['sens différent', { key: { tenantId: 1, 'capacity.slot': 1, 'capacity.kitchenSeat': -1 } }],
    ['partiel absent', { partialFilterExpression: undefined }],
    ['partiel trop large', { partialFilterExpression: { 'capacity.kitchenSeat': { $exists: true } } }],
    ['partiel trop étroit', { partialFilterExpression: { 'capacity.kitchenSeat': { $type: 'number' }, state: 'committing' } }],
    ['type différent', { partialFilterExpression: { 'capacity.kitchenSeat': { $type: 'int' } } }],
    ['expression en plus', { partialFilterExpression: { 'capacity.kitchenSeat': { $type: 'number', $gte: 0 } } }],
    ['sparse', { sparse: true }],
    ['TTL', { expireAfterSeconds: 60 }],
  ])('refuse une spec de siège non conforme : %s', async (_label, patch) => {
    const ctx = fixture();
    Object.assign(ctx.stats.admissions[0]!.spec, patch);
    await expect(ctx.run()).rejects.toMatchObject({ status: 503 });
  });

  it.each([
    { partialFilterExpression: { state: 'ready' } }, { sparse: true }, { unique: false }, { expireAfterSeconds: 0 },
  ])('refuse une spec calendrier non conforme : %j', async (patch) => {
    const ctx = fixture();
    Object.assign(ctx.stats.calendar[0]!.spec, patch);
    await expect(ctx.run()).rejects.toMatchObject({ status: 503 });
  });

  it('refuse un résultat ambigu portant deux fois le même index', async () => {
    const ctx = fixture();
    ctx.stats.admissions.push(ctx.stats.admissions[0]!);
    await expect(ctx.run()).rejects.toMatchObject({ status: 503 });
  });

  it.each([null, {}, [null], Array.from({ length: 129 }, () => ({}))].map((rows) => ({ rows })))('refuse les résultats invalides ou tronqués : $rows', async ({ rows }) => {
    const ctx = fixture();
    ctx.calendar.aggregate.mockImplementation(() => ({ toArray: vi.fn(async () => rows as never) }));
    await expect(ctx.run()).rejects.toMatchObject({ status: 503 });
  });

  it.each(['aggregate', 'cursor'] as const)('refuse les erreurs %s sans exposer les détails du driver ni fallback', async (phase) => {
    const ctx = fixture();
    const sensitive = new Error('internal-host:27017 privilege detail should stay private');
    if (phase === 'aggregate') ctx.calendar.aggregate.mockImplementation(() => { throw sensitive; });
    else ctx.calendar.aggregate.mockImplementation(() => ({ toArray: vi.fn(async () => { throw sensitive; }) }));
    const error = await ctx.run().catch((value: unknown) => value);
    expect(error).toMatchObject({ status: 503 });
    expect(JSON.stringify(error)).not.toContain('internal-host');
    expect(JSON.stringify(error)).not.toContain('privilege');
    expect(ctx.calendar.listIndexes).not.toHaveBeenCalled();
  });

  it('ne conserve aucun cache positif après une suppression ultérieure', async () => {
    const ctx = fixture();
    await ctx.run();
    ctx.stats.admissions.splice(0, 1);
    await expect(ctx.run()).rejects.toMatchObject({ status: 503 });
    expect(ctx.calendar.aggregate).toHaveBeenCalledTimes(2);
    expect(ctx.admissions.aggregate).toHaveBeenCalledTimes(2);
  });

  it('ne bloque pas la construction d’un index sans rôle dans la capacité', async () => {
    const ctx = fixture();
    ctx.stats.admissions.push({ name: 'unrelated', key: { tenantId: 1, 'capacity.slot': 1 },
      spec: { name: 'unrelated', unique: true, key: { tenantId: 1, 'capacity.slot': 1 }, partialFilterExpression: {} } } as never);
    Object.assign(ctx.stats.admissions.at(-1)!, { building: true });
    await expect(ctx.run()).resolves.toBeUndefined();
  });
});
