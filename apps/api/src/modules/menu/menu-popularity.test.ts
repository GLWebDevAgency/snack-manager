import { afterEach, describe, expect, it, vi } from 'vitest';
import { Types } from 'mongoose';
import { Logger } from '@nestjs/common';
import { MenuPopularityService, POPULAR_CACHE_MS, POPULAR_WINDOW_MS, popularityPipeline } from './menu-popularity.service';
import { MenuService } from './menu.service';

const TENANT = '665f0d0a1c2b3d4e5f6a7b80';
const OTHER = '665f0d0a1c2b3d4e5f6a7b81';
const CATEGORY = '665f0d0a1c2b3d4e5f6a7b70';
const id = (n: number) => n.toString(16).padStart(24, '0');
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('classement des plats payés sur 30 jours', () => {
  it('borne avant dépliage le tenant, les dates et le paiement, puis chaque ligne éligible', () => {
    const now = new Date('2026-09-10T10:00:00Z');
    const pipeline = popularityPipeline(TENANT, [id(1)], now);
    expect(pipeline[0]).toEqual({ $match: {
      tenantId: new Types.ObjectId(TENANT), createdAt: { $gte: new Date(now.getTime() - POPULAR_WINDOW_MS), $lte: now },
      status: { $ne: 'cancelled' }, 'payment.status': 'paid', 'lines.productId': { $in: [new Types.ObjectId(id(1))] },
    } });
    expect(pipeline[2]).toEqual({ $match: { 'lines.productId': { $in: [new Types.ObjectId(id(1))] }, 'lines.qty': { $gt: 0 } } });
    expect(pipeline[3]).toEqual({ $group: { _id: '$lines.productId', quantity: { $sum: '$lines.qty' } } });
    expect(pipeline.slice(-2)).toEqual([{ $sort: { quantity: -1, _id: 1 } }, { $limit: 8 }]);
  });

  it('coalesce deux surfaces et sépare tenants et éligibilité, sans conserver un classement périmé', async () => {
    vi.useFakeTimers();
    let finish!: (value: { _id: Types.ObjectId; quantity: number }[]) => void;
    const option = vi.fn(() => new Promise<{ _id: Types.ObjectId; quantity: number }[]>((resolve) => { finish = resolve; }));
    const aggregate = vi.fn(() => ({ option }));
    const service = new MenuPopularityService({ aggregate } as never);
    const first = service.top(TENANT, [id(1), id(2)]);
    const second = service.top(TENANT, [id(2), id(1), id(1)]);
    expect(aggregate).toHaveBeenCalledTimes(1);
    finish([{ _id: new Types.ObjectId(id(2)), quantity: 9 }]);
    expect([...(await first)]).toEqual([id(2)]);
    expect(await second).toBe(await first);
    await service.top(TENANT, [id(1), id(2)]);
    expect(aggregate).toHaveBeenCalledTimes(1);
    option.mockImplementation(() => Promise.resolve([]));
    await service.top(OTHER, [id(1), id(2)]);
    await service.top(TENANT, [id(1)]);
    expect(aggregate).toHaveBeenCalledTimes(3);
    vi.advanceTimersByTime(POPULAR_CACHE_MS);
    await service.top(TENANT, [id(1), id(2)]);
    expect(aggregate).toHaveBeenCalledTimes(4);
    expect(option).toHaveBeenCalledWith({ maxTimeMS: 2_000 });
  });

  it('réessaie après une panne et ne prétend pas qu’un plat a été vendu', async () => {
    vi.useFakeTimers();
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
    const option = vi.fn().mockRejectedValueOnce(new Error('timeout')).mockResolvedValue([{ _id: new Types.ObjectId(id(1)), quantity: 1 }]);
    const service = new MenuPopularityService({ aggregate: () => ({ option }) } as never);
    expect([...(await service.top(TENANT, [id(1)]))]).toEqual([]);
    await service.top(TENANT, [id(1)]);
    expect(option).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(5_000);
    expect([...(await service.top(TENANT, [id(1)]))]).toEqual([id(1)]);
  });

  it('borne le cache par éviction et ne requête pas un menu sans candidat', async () => {
    const aggregate = vi.fn(() => ({ option: async () => [] }));
    const service = new MenuPopularityService({ aggregate } as never);
    await service.top(TENANT, []);
    await service.top('invalide', [id(1)]);
    expect(aggregate).not.toHaveBeenCalled();
    for (let n = 1; n <= 129; n++) await service.top(TENANT, [id(n)]);
    await service.top(TENANT, [id(129)]);
    expect(aggregate).toHaveBeenCalledTimes(129);
    await service.top(TENANT, [id(1)]);
    expect(aggregate).toHaveBeenCalledTimes(130);
  });
});

describe('présentation du menu sans modification du tarif ni des sélections', () => {
  it('prend les photos résolues, honore le choix manuel et garde featured indépendant', async () => {
    const products = [
      { _id: id(1), popularOverride: null },
      { _id: id(2), popularOverride: true, photoKind: 'cover' },
      { _id: id(3), popularOverride: false },
      { _id: id(4), popularOverride: true, photoUrl: null },
      { _id: id(5), popularOverride: true, categoryId: OTHER },
    ].map((p) => ({ name: 'Plat', categoryId: CATEGORY, active: true, price: 875, variants: [], optionGroups: [], photoUrl: '/photos/plat.webp', ...p }));
    const categories = [{ _id: CATEGORY, active: true, featuredProductIds: [id(3)], featuredRevision: 2 }, { _id: OTHER, active: false }];
    const query = (rows: unknown[]) => ({ find: () => ({ sort: () => ({ lean: async () => rows }) }) });
    const top = vi.fn(async () => new Set([id(1)]));
    const service = new MenuService(query(categories) as never, query(products) as never, {} as never,
      { modifiersForMenu: async () => new Map() } as never, {} as never, { catalogue: async () => [] } as never, { top } as never);
    const menu = await service.publicMenu(TENANT);
    expect(top).toHaveBeenCalledWith(TENANT, [id(1), id(2)]);
    expect(menu.categories).toHaveLength(1);
    const served = menu.categories[0]!;
    expect(served.featuredProductIds).toEqual([id(3)]);
    expect(served.products.map((p) => p.popular)).toEqual([true, true, false, false]);
    expect(served.products[1]).toMatchObject({ photoKind: 'cover', photoCover: true, price: 875, photoUrl: '/photos/plat.webp' });
    expect(served.products[0]).toMatchObject({ photoKind: 'cutout', photoCover: false, price: 875 });
  });
});
