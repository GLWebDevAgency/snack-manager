import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { MenuService } from './menu.service';
import { MenuController } from './menu.controller';
import { ROLES } from '../../common/auth';

const tenant = '65f000000000000000000001';
const neighbor = '65f000000000000000000002';
const categoryId = '65f000000000000000000010';
const otherCategoryId = '65f000000000000000000011';
const ids = ['65f000000000000000000020', '65f000000000000000000021', '65f000000000000000000022', '65f000000000000000000023'];
type CategoryRow = { _id: string; tenantId: string; name: string; active: boolean; featuredProductIds?: string[]; featuredRevision?: number };
type ProductRow = { _id: string; tenantId: string; categoryId: string; name: string; active: boolean; outOfStock: boolean };

function setup() {
  const category: CategoryRow = { _id: categoryId, tenantId: tenant, name: 'Burgers', active: true };
  const rows: CategoryRow[] = [category, { _id: otherCategoryId, tenantId: tenant, name: 'Menus', active: true }];
  const products: ProductRow[] = ids.map((_id) => ({ _id, tenantId: tenant, categoryId, name: _id, active: true, outOfStock: false }));
  type Filter = { _id?: string | { $ne?: string; $in?: string[] }; tenantId?: string; active?: boolean; categoryId?: string; featuredProductIds?: string; featuredRevision?: number; $or?: unknown[] };
  const matches = (row: CategoryRow | ProductRow, filter: Filter) => {
    if (filter.tenantId && row.tenantId !== filter.tenantId) return false;
    if (typeof filter._id === 'string' && row._id !== filter._id) return false;
    if (typeof filter._id === 'object' && (filter._id.$ne === row._id || (filter._id.$in && !filter._id.$in.includes(row._id)))) return false;
    if (filter.active !== undefined && row.active !== filter.active) return false;
    if (filter.categoryId && (!('categoryId' in row) || row.categoryId !== filter.categoryId)) return false;
    return true;
  };
  const list = <T>(values: T[]) => ({ sort: () => ({ lean: async () => values }), lean: async () => values });
  const categoryModel = {
    findOne: (filter: Filter) => {
      const row = rows.find((r) => matches(r, filter));
      return { lean: async () => row ? { ...row } : null, then: (resolve: (v: unknown) => unknown) => Promise.resolve(resolve(row ?? null)) };
    },
    find: (filter: Filter) => list(rows.filter((r) => matches(r, filter))),
    findOneAndUpdate: vi.fn((filter: Filter, update: { $set: { featuredProductIds: string[] }; $inc: { featuredRevision: number } }) => ({
      lean: async () => {
        const row = rows.find((r) => matches(r, filter));
        // La comparaison et l'écriture Mongo sont une opération indivisible.
        const expected = filter.$or ? 0 : filter.featuredRevision;
        if (!row || (row.featuredRevision ?? 0) !== expected) return null;
        row.featuredProductIds = [...update.$set.featuredProductIds];
        row.featuredRevision = (row.featuredRevision ?? 0) + update.$inc.featuredRevision;
        return { ...row };
      },
    })),
    updateMany: vi.fn(async (filter: Filter, update: { $pull: { featuredProductIds: string }; $inc: { featuredRevision: number } }) => {
      for (const row of rows.filter((r) => matches(r, filter) && r.featuredProductIds?.includes(filter.featuredProductIds!))) {
        row.featuredProductIds = row.featuredProductIds!.filter((id) => id !== update.$pull.featuredProductIds);
        row.featuredRevision = (row.featuredRevision ?? 0) + update.$inc.featuredRevision;
      }
    }),
  };
  const productModel = {
    find: (filter: Filter) => list(products.filter((p) => matches(p, filter))),
    findOne: (filter: Filter) => ({ lean: async () => products.find((p) => matches(p, filter)) ?? null }),
    findOneAndUpdate: async (filter: Filter, update: { $set: Partial<ProductRow> }) => {
      const row = products.find((p) => matches(p, filter));
      if (!row) return null;
      Object.assign(row, update.$set);
      return row;
    },
    deleteOne: async (filter: Filter) => {
      const index = products.findIndex((p) => matches(p, filter));
      if (index < 0) return { deletedCount: 0 };
      products.splice(index, 1);
      return { deletedCount: 1 };
    },
  };
  const publish = vi.fn();
  const service = new MenuService(categoryModel as never, productModel as never, { publish } as never,
    { modifiersForMenu: async () => new Map() } as never,
    { log: async () => {} } as never, { catalogue: async () => [] } as never);
  return { service, category, rows, products, categoryModel, publish };
}

describe('Sélection commune de la carte — écriture atomique par catégorie', () => {
  it('la route exige les droits de gestion de carte', () => {
    expect(Reflect.getMetadata(ROLES, MenuController.prototype.updateFeatured)).toEqual(['owner', 'gerant']);
  });
  it('une ancienne catégorie sans révision accepte la première sélection puis compare la révision', async () => {
    const { service, categoryModel } = setup();
    const result = await service.updateFeatured(tenant, categoryId, { productIds: [ids[2]!, ids[0]!], expectedRevision: 0 });
    expect(result).toEqual({ categoryId, featuredProductIds: [ids[2], ids[0]], featuredRevision: 1 });
    expect(categoryModel.findOneAndUpdate.mock.calls[0]?.[0]).toMatchObject({ _id: categoryId, tenantId: tenant, $or: [{ featuredRevision: 0 }, { featuredRevision: { $exists: false } }] });
    await expect(service.updateFeatured(tenant, categoryId, { productIds: [], expectedRevision: 0 })).rejects.toMatchObject({ response: { code: 'FEATURED_SELECTION_CHANGED', current: result } });
  });
  it('deux gérants avec la même révision produisent un gagnant et un conflit, sans sélection fusionnée', async () => {
    const { service, category } = setup();
    const results = await Promise.allSettled([
      service.updateFeatured(tenant, categoryId, { productIds: ids.slice(0, 3), expectedRevision: 0 }),
      service.updateFeatured(tenant, categoryId, { productIds: ids.slice(1), expectedRevision: 0 }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect(rejected.reason).toBeInstanceOf(ConflictException);
    expect(category.featuredProductIds).toEqual(ids.slice(0, 3));
    expect(category.featuredRevision).toBe(1);
  });
  it('refuse le quatrième et les produits d’une autre catégorie ou d’un autre établissement', async () => {
    const { service, products, category } = setup();
    await expect(service.updateFeatured(tenant, categoryId, { productIds: ids, expectedRevision: 0 })).rejects.toBeInstanceOf(BadRequestException);
    products[0]!.categoryId = otherCategoryId;
    await expect(service.updateFeatured(tenant, categoryId, { productIds: [ids[0]!], expectedRevision: 0 })).rejects.toBeInstanceOf(BadRequestException);
    products[1]!.tenantId = neighbor;
    await expect(service.updateFeatured(tenant, categoryId, { productIds: [ids[1]!], expectedRevision: 0 })).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.updateFeatured(neighbor, categoryId, { productIds: [], expectedRevision: 0 })).rejects.toBeInstanceOf(NotFoundException);
    expect(category.featuredProductIds).toBeUndefined();
  });
  it('un retrait total reste une intention publique sans exposer la révision administrative', async () => {
    const { service } = setup();
    expect((await service.publicMenu(tenant)).categories[0]).toMatchObject({ featuredConfigured: false, featuredProductIds: [] });
    await service.updateFeatured(tenant, categoryId, { productIds: [], expectedRevision: 0 });
    const admin = (await service.fullMenu(tenant)).categories[0];
    const publicCategory = (await service.publicMenu(tenant)).categories[0];
    expect(admin).toMatchObject({ featuredRevision: 1, featuredProductIds: [] });
    expect(publicCategory).toMatchObject({ featuredConfigured: true, featuredProductIds: [] });
    expect(publicCategory).not.toHaveProperty('featuredRevision');
  });
  it('garde la sélection suspendue quand un produit est désactivé ou en rupture', async () => {
    const { service, category } = setup();
    await service.updateFeatured(tenant, categoryId, { productIds: [ids[0]!], expectedRevision: 0 });
    await service.updateProduct(tenant, ids[0]!, { active: false, outOfStock: true });
    expect(category.featuredProductIds).toEqual([ids[0]]);
    expect((await service.publicMenu(tenant)).categories[0]?.products.some((p) => String(p._id) === ids[0])).toBe(false);
  });
  it('un déplacement retire la référence source sans remplir la catégorie destination ; une suppression retire la sélection', async () => {
    const { service, category, rows } = setup();
    await service.updateFeatured(tenant, categoryId, { productIds: ids.slice(0, 2), expectedRevision: 0 });
    await service.updateProduct(tenant, ids[0]!, { categoryId: otherCategoryId });
    expect(category.featuredProductIds).toEqual([ids[1]]);
    expect(category.featuredRevision).toBe(2);
    expect(rows[1]?.featuredProductIds).toBeUndefined();
    await service.deleteProduct(tenant, ids[1]!);
    expect(category.featuredProductIds).toEqual([]);
    expect(category.featuredRevision).toBe(3);
  });
});
