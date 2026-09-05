import { describe, expect, it, vi } from 'vitest';
import { DIRECTIONS, ProductUpdateSchema } from '@sm/contracts';
import { MenuService } from '../menu/menu.service';
import { MenuModule } from '../menu/menu.module';
import { SupplyService } from '../supply/supply.service';
import { OrderingModule } from './ordering.module';
import { SiteService } from './site.service';

const TENANT = '665f0d0a1c2b3d4e5f6a7b80';
const PRODUCT = '665f0d0a1c2b3d4e5f6a7b81';
const CATEGORY = '665f0d0a1c2b3d4e5f6a7b70';
const recipe = [
  { ingredientId: 'bread', name: 'Pain', category: 'pain', removable: false },
  { ingredientId: 'lettuce', name: 'Salade', category: 'legume', removable: true },
  { ingredientId: 'tomato', name: 'Tomates', category: 'legume', removable: true },
  { ingredientId: 'onion', name: 'Oignons', category: 'legume', removable: true },
].map((ingredient) => ({ ...ingredient, productRef: PRODUCT, displayName: null, supplementPriceCents: null, isOut: false }));

function fixture({ supplyDown = false, online = true, paused = false, suspended = false } = {}) {
  const rawProduct = {
    _id: PRODUCT, tenantId: TENANT, categoryId: CATEGORY, active: true, name: 'Kebab', price: 750,
    description: '', variants: [], removables: ['crudités'], tags: ['maison'], isNew: true, outOfStock: true,
    // Champs internes : la nouvelle source commune ne doit pas élargir la projection publique.
    costCents: 320, internalNote: 'ne doit pas sortir',
    optionGroups: [
      { key: 'pain', name: 'Pain', type: 'single', min: 1, max: null, perVariant: null, choices: [{ key: 'pain', name: 'Pain', priceDelta: 0 }] },
      { key: 'supp-1-00', name: 'Extra maison', type: 'multi', min: 0, max: 1, perVariant: null, choices: [{ key: 'bacon', name: 'Bacon', priceDelta: 100 }] },
      { key: 'supplements', name: 'Suppléments', type: 'multi', min: 0, max: null, perVariant: null, choices: [{ key: 'cheddar', name: 'Cheddar', priceDelta: 100 }] },
    ],
  };
  const allProducts = [rawProduct, { ...rawProduct, _id: 'inactive', active: false }, { ...rawProduct, _id: 'orphan', categoryId: null }];
  const allCategories = [{ _id: CATEGORY, tenantId: TENANT, name: 'Sandwichs', active: true }, { _id: 'inactive-category', tenantId: TENANT, name: 'Masquée', active: false }];
  const query = <T extends { tenantId: string; active: boolean }>(rows: T[]) => vi.fn((filter: { tenantId: string; active?: boolean }) => ({
    sort: () => ({ lean: async () => rows.filter((row) => row.tenantId === filter.tenantId && (filter.active === undefined || row.active === filter.active)) }),
  }));
  const products = { find: query(allProducts), bulkWrite: vi.fn(async () => ({ modifiedCount: 1 })) };
  const categories = { find: query(allCategories) };
  let reads = 0;
  const db = {
    select: () => {
      const rows = reads++ % 2 === 0 ? recipe : [{ ingredientId: 'cheddar', name: 'Cheddar', displayName: null, category: 'fromage', removable: true, supplementPriceCents: 100, isOut: false }];
      const chain = { from: () => chain, innerJoin: () => chain, where: async () => {
        if (supplyDown) throw new Error('Supply indisponible (test)');
        return rows;
      } };
      return chain;
    },
  };
  const supply = new SupplyService(db as never, products as never, { publish: vi.fn() } as never, { log: vi.fn() } as never);
  const medias = { catalogue: vi.fn(async () => []) };
  const menu = new MenuService(categories as never, products as never, { publish: vi.fn() } as never, supply, { log: vi.fn() } as never, medias as never);
  const tenant = { _id: TENANT, slug: 'restaurant', name: 'Restaurant', brand: DIRECTIONS.nuit, account: { status: suspended ? 'suspended' : 'active' }, plan: 'essentiel', onlineOrdering: online, settings: { onlineOrderingPaused: paused }, hours: [], phones: [] };
  const tenants = { bySlug: vi.fn(async () => tenant) };
  const slots = { compute: vi.fn(async () => ({ timezone: 'Europe/Paris', slots: [] })), isOpenNow: () => true, todayHours: () => [] };
  const reviews = { aggregate: vi.fn(async () => []), find: vi.fn(() => ({ sort: () => ({ limit: () => ({ lean: async () => [] }) }) })) };
  const site = new SiteService(reviews as never, tenants as never, slots as never, menu);
  return { site, menu, products, categories, medias };
}

describe('site commande et carte caisse : une seule projection métier', () => {
  it('importe le fournisseur de menu partagé dans le module ordering', () => {
    expect(Reflect.getMetadata('imports', OrderingModule)).toContain(MenuModule);
    expect(Reflect.getMetadata('exports', MenuModule)).toContain(MenuService);
  });

  it('joint les crudités de la recette et les suppléments tarifés, sans exposer deux fois le groupe réservé', async () => {
    const { site } = fixture();
    const result = await site.build('restaurant');
    expect(result.ordering.paused).toBe(false);
    const product = result.menu.categories[0]!.products[0]!;
    expect(product.removables).toEqual([
      { key: 'oignons', label: 'Oignons' }, { key: 'salade', label: 'Salade' }, { key: 'tomates', label: 'Tomates' }, { key: 'crudites', label: 'crudités' },
    ]);
    expect(product).toHaveProperty('supplements', [{ key: 'cheddar', label: 'Cheddar', priceCents: 100, category: 'fromage' }]);
    expect(product.optionGroups.map((group) => (group as { key: string }).key)).toEqual(['pain', 'supp-1-00']);
    expect(ProductUpdateSchema.safeParse({ optionGroups: product.optionGroups }).success).toBe(true);
  });

  it('sert les mêmes règles et ingrédients que le menu public du POS', async () => {
    const { site, menu } = fixture();
    const publicMenu = await menu.publicMenu(TENANT);
    const { menu: onlineMenu } = await site.build('restaurant');
    const posProduct = publicMenu.categories[0]!.products[0]!;
    expect(onlineMenu.categories[0]!.products[0]).toMatchObject({
      price: posProduct.price, variants: posProduct.variants, optionGroups: posProduct.optionGroups,
      removables: posProduct.removables, supplements: posProduct.supplements,
    });
  });

  it('conserve le tenant, les catégories/produits actifs, les ruptures et une projection publique limitée', async () => {
    const { site, categories, products, medias } = fixture();
    const result = await site.build('restaurant');
    expect(categories.find).toHaveBeenCalledWith({ tenantId: TENANT, active: true });
    expect(products.find).toHaveBeenCalledWith({ tenantId: TENANT, active: true });
    expect(medias.catalogue).toHaveBeenCalledWith(TENANT);
    expect(result.menu.categories).toHaveLength(1);
    expect(result.menu.categories[0]!.products).toHaveLength(1);
    const product = result.menu.categories[0]!.products[0]!;
    expect(product).toMatchObject({ _id: PRODUCT, price: 750, tags: ['maison'], isNew: true, outOfStock: true, photoUrl: null, medias: [] });
    expect(product).not.toHaveProperty('tenantId');
    expect(product).not.toHaveProperty('costCents');
    expect(product).not.toHaveProperty('internalNote');
  });

  it('conserve le cadrage carte du site sans changer le défaut vignette du POS', async () => {
    const { site, menu } = fixture();
    const publicMenu = vi.spyOn(menu, 'publicMenu');
    await site.build('restaurant');
    expect(publicMenu).toHaveBeenCalledExactlyOnceWith(TENANT, 'carte');
  });

  it('conserve le repli de service sans Postgres : retraits historiques, aucun supplément frais inventé', async () => {
    const { site } = fixture({ supplyDown: true });
    const result = await site.build('restaurant');
    expect(result.menu.categories[0]!.products[0]).toMatchObject({
      price: 750, removables: [{ key: 'crudites', label: 'crudités' }], supplements: [],
    });
  });

  it('ne contourne pas la fermeture de commande liée à l’offre', async () => {
    const { site } = fixture({ online: false });
    const result = await site.build('restaurant');
    expect(result.ordering.paused).toBe(true);
    expect(result.menu.categories[0]!.products[0]!.name).toBe('Kebab');
  });

  it.each([{ paused: true }, { suspended: true }])('conserve la fermeture de service %j', async (options) => {
    const { site } = fixture(options);
    const result = await site.build('restaurant');
    expect(result.ordering.paused).toBe(true);
    expect(result.menu.categories[0]!.products[0]!.name).toBe('Kebab');
  });
});
