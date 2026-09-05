import { describe, expect, it, vi } from 'vitest';
import { Mongoose, Types } from 'mongoose';
import { ProductSchema } from '@sm/db';
import { ProductUpdateSchema } from '@sm/contracts';
import { MenuService } from './menu.service';
import { ZodValidationPipe } from '../../common/zod.pipe';

const TENANT = new Types.ObjectId('665f0d0a1c2b3d4e5f6a7b80');
const CATEGORY = new Types.ObjectId('665f0d0a1c2b3d4e5f6a7b70');
// Vrai casting/defaults Mongoose, sans connexion ni écriture en base.
const ProductModel = new Mongoose().model('MenuOptionRoundtripProduct', ProductSchema);

function fixture(includeNullGroup = false) {
  const raw = new ProductModel({
    tenantId: TENANT, categoryId: CATEGORY, name: 'Kebab Fromage', price: 850, variants: [],
    optionGroups: [
      { key: 'pain', name: 'Pain', type: 'single', min: 1, choices: [{ key: 'pain', name: 'Pain', priceDelta: 0 }] },
      { key: 'sauces', name: 'Sauces', type: 'multi', min: 0, max: 2, choices: [
        { key: 'blanche', name: 'Blanche', priceDelta: 0 }, { key: 'samourai', name: 'Samouraï', priceDelta: 0 },
      ] },
      ...(includeNullGroup ? [null] : []),
    ],
  }).toObject();
  const products = { find: vi.fn(() => ({ sort: () => ({ lean: async () => [raw] }) })) };
  const categories = { find: vi.fn(() => ({ sort: () => ({ lean: async () => [{ _id: CATEGORY, name: 'Sandwichs' }] }) })) };
  const service = new MenuService(
    categories as never, products as never, { publish: vi.fn() } as never,
    { modifiersForMenu: async () => new Map() } as never,
    { log: vi.fn() } as never, { catalogue: async () => [] } as never,
  );
  return { service, raw };
}

describe('lecture menu Mongoose → ajout Fromage → contrat PATCH strict', () => {
  it.each(['fullMenu', 'publicMenu'] as const)('%s conserve un groupe null corrompu sans faire échouer la lecture', async (method) => {
    const { service, raw } = fixture(true);
    expect(raw.optionGroups[2]).toBeNull();
    const read = await service[method](String(TENANT));
    const groups = read.categories[0]!.products[0]!.optionGroups;
    expect(groups[2]).toBeNull();
    expect(ProductUpdateSchema.safeParse({ optionGroups: groups }).success).toBe(false);
  });

  it.each(['fullMenu', 'publicMenu'] as const)('%s ne réémet pas les null refusés en écriture', async (method) => {
    const { service, raw } = fixture();
    expect(raw.optionGroups[0]).toMatchObject({ max: null, perVariant: null });
    expect(raw.optionGroups[1]).toMatchObject({ max: 2, perVariant: null });
    const read = await service[method](String(TENANT));
    const product = read.categories[0]!.products[0]!;
    const patch = {
      optionGroups: [...product.optionGroups, {
        key: 'fromage', name: 'Fromage', type: 'single', min: 1,
        choices: ['Cheddar', 'Raclette', 'Chèvre', 'Boursin', 'Emmental'].map((name, i) => ({
          key: `cheese-${i}`, name, priceDelta: 0,
        })),
      }],
    };
    const parsed = new ZodValidationPipe(ProductUpdateSchema).transform(patch);
    expect(parsed).toMatchObject({ optionGroups: [
      { key: 'pain', min: 1, max: 1 }, { key: 'sauces', min: 0, max: 2 }, { key: 'fromage', min: 1, max: 1 },
    ] });
    expect(parsed).not.toHaveProperty('variants');
    expect(parsed).not.toHaveProperty('price');
    expect(product).toMatchObject({ name: 'Kebab Fromage', price: 850, variants: [] });
    expect(raw.optionGroups[0]).toMatchObject({ max: null, perVariant: null });
  });
});
