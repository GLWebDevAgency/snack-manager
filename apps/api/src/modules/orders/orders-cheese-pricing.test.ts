import { describe, expect, it, vi } from 'vitest';
import { CreateOrderSchema, type CreateOrder } from '@sm/contracts';
import { OrdersService } from './orders.service';

/**
 * Régression sur le VRAI point d'écriture de develop, pas sur une extraction
 * du calcul réservée à une autre branche. Seuls Mongo/Redis sont simulés.
 * Le catalogue reste constitué de deux produits distincts, sans variante.
 */
const TENANT = '665f0d0a1c2b3d4e5f6a7b80';
const PRODUCT_IDS = { classic: '665f0d0a1c2b3d4e5f6a7b81', cheese: '665f0d0a1c2b3d4e5f6a7b82' };
type ProductKey = keyof typeof PRODUCT_IDS;
type Line = CreateOrder['lines'][number];

const cheeseChoices = ['Bleue', 'Reblochon', 'Raclette', 'Camembert', 'Cheddar']
  .map((name) => ({ key: name.toLowerCase(), name, priceDelta: 0 }));
const bread = {
  key: 'pain', name: 'Pain', type: 'single', min: 1, max: 1, perVariant: null,
  choices: [
    { key: 'pain', name: 'Pain', priceDelta: 0 },
    { key: 'galette', name: 'Galette', priceDelta: 50 },
  ],
};
const includedCheese = {
  key: 'fromage', name: 'Fromage inclus', type: 'single', min: 1, max: 1,
  perVariant: null, choices: cheeseChoices,
};
const products = [
  {
    _id: PRODUCT_IDS.classic, tenantId: TENANT, name: 'Kebab', price: 750,
    active: true, outOfStock: false, variants: [], optionGroups: [bread, {
      key: 'supplements', name: 'Suppléments', type: 'multi', min: 0, max: null, perVariant: null,
      choices: [{ key: 'cheddar', name: 'Cheddar supplémentaire', priceDelta: 100 }],
    }],
  },
  {
    _id: PRODUCT_IDS.cheese, tenantId: TENANT, name: 'Kebab Fromage', price: 850,
    active: true, outOfStock: false, variants: [], optionGroups: [bread, includedCheese],
  },
];

type WrittenOrder = {
  tenantId: string;
  lines: {
    productId: unknown; name: string; variantKey: string | null; variantName: string | null;
    unitPrice: number; lineTotal: number; qty: number;
    options: { groupKey: string; choiceKey: string; name: string; priceDelta: number }[];
  }[];
  totals: { subtotal: number; discount: unknown; total: number };
  payment: { status: string; cashReceived: number | null; changeGiven: number | null };
};

function harness() {
  const create = vi.fn(async (doc: WrittenOrder) => ({ ...doc, toObject: () => doc }));
  const findProducts = vi.fn((filter: { tenantId: string; active: boolean; _id: { $in: string[] } }) => ({
    lean: async () => products.filter((product) => product.tenantId === filter.tenantId
      && product.active === filter.active && filter._id.$in.includes(product._id)),
  }));
  const nextNumber = vi.fn(async () => ({ seq: 1 }));
  const publish = vi.fn(async () => 1);
  const service = new OrdersService(
    { findOne: vi.fn(async () => null), create } as never,
    { find: findProducts } as never,
    { findOneAndUpdate: nextNumber } as never,
    { find: vi.fn(() => ({ lean: async () => [] })) } as never,
    { publish } as never,
    { log: vi.fn() } as never,
  );
  return { service, create, findProducts, nextNumber, publish };
}

function line(productKey: ProductKey, additions: Line['options'] = [], breadChoice = 'pain'): Line {
  return {
    productId: PRODUCT_IDS[productKey], qty: 1, removed: [],
    options: [{ groupKey: 'pain', choiceKey: breadChoice }, ...additions],
  };
}

function order(lines: Line[], channel: 'pos' | 'online' = 'pos'): CreateOrder {
  return CreateOrderSchema.parse({
    clientId: '11111111-1111-4111-8111-111111111111', channel,
    type: channel === 'online' ? 'pickup' : 'emporter', lines,
    payment: { method: 'counter', ...(channel === 'pos' ? { tender: 'card' } : {}) },
  });
}
const withCheese = (key = 'raclette'): Line => line('cheese', [{ groupKey: 'fromage', choiceKey: key }]);

describe('création réelle de commande : fromage inclus et supplément payant séparés', () => {
  it.each(cheeseChoices)('enregistre $name inclus à 850 centimes avec son vrai libellé', async (choice) => {
    const { service, create, findProducts } = harness();
    await service.create(TENANT, order([withCheese(choice.key)]), 'caisse');
    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0]![0]).toMatchObject({
      tenantId: TENANT,
      totals: { subtotal: 850, discount: null, total: 850 },
      lines: [{ name: 'Kebab Fromage', variantKey: null, variantName: null, unitPrice: 850, lineTotal: 850,
        options: [
          { groupKey: 'pain', choiceKey: 'pain', name: 'Pain', priceDelta: 0 },
          { groupKey: 'fromage', choiceKey: choice.key, name: choice.name, priceDelta: 0 },
        ],
      }],
    });
    expect(findProducts).toHaveBeenCalledWith({ tenantId: TENANT, active: true, _id: { $in: [PRODUCT_IDS.cheese] } });
  });

  it.each([
    ['Kebab classique', line('classic'), 750],
    ['Kebab classique + cheddar', line('classic', [{ groupKey: 'supplements', choiceKey: 'cheddar' }]), 850],
    ['Kebab Fromage en galette', line('cheese', [{ groupKey: 'fromage', choiceKey: 'cheddar' }], 'galette'), 900],
    ['Kebab classique en galette + cheddar', line('classic', [{ groupKey: 'supplements', choiceKey: 'cheddar' }], 'galette'), 900],
  ] satisfies [string, Line, number][])('%s : montant serveur sans double facturation', async (_label, item, total) => {
    const { service, create } = harness();
    await service.create(TENANT, order([item]), 'caisse');
    const written = create.mock.calls[0]![0];
    expect(written.totals).toEqual({ subtotal: total, discount: null, total });
    expect(written.lines[0]).toMatchObject({ unitPrice: total, lineTotal: total });
    expect(written.lines[0]!.options.filter((option) => option.groupKey === 'supplements')).toHaveLength(
      item.options.some((option) => option.groupKey === 'supplements') ? 1 : 0,
    );
  });

  it('multiplie la quantité, pas le prix unitaire ni le prix du fromage inclus', async () => {
    const { service, create } = harness();
    await service.create(TENANT, order([{ ...withCheese(), qty: 2 }]), 'caisse');
    const written = create.mock.calls[0]![0];
    expect(written.totals.total).toBe(1700);
    expect(written.lines[0]).toMatchObject({ qty: 2, unitPrice: 850, lineTotal: 1700 });
    expect(written.lines[0]!.options.find((option) => option.groupKey === 'fromage')?.priceDelta).toBe(0);
  });

  it('la commande en ligne utilise le même montant serveur et reste à encaisser au comptoir', async () => {
    const { service, create } = harness();
    await service.create(TENANT, order([withCheese()], 'online'), 'client');
    expect(create.mock.calls[0]![0]).toMatchObject({
      totals: { subtotal: 850, total: 850 }, payment: { status: 'pending' },
    });
  });

  it('ignore les prix et libellés proposés par le navigateur au profit du catalogue', async () => {
    const { service, create } = harness();
    const dto = CreateOrderSchema.parse({
      ...order([withCheese()]),
      lines: [{ ...withCheese(), name: 'Produit falsifié', unitPrice: 1,
        options: withCheese().options.map((option) => ({ ...option, name: 'Offert', priceDelta: -850 })),
      }],
    });
    await service.create(TENANT, dto, 'caisse');
    expect(create.mock.calls[0]![0]).toMatchObject({
      totals: { subtotal: 850, total: 850 },
      lines: [{ name: 'Kebab Fromage', unitPrice: 850, options: [
        { name: 'Pain', priceDelta: 0 }, { name: 'Raclette', priceDelta: 0 },
      ] }],
    });
  });

  it.each([
    ['sans fromage', line('cheese'), '« Fromage inclus » : 1 choix attendu'],
    ['deux fromages inclus', line('cheese', [
      { groupKey: 'fromage', choiceKey: 'cheddar' }, { groupKey: 'fromage', choiceKey: 'raclette' },
    ]), '« Fromage inclus » : 1 choix attendu'],
    ['fromage gratuit détourné vers le classique', line('classic', [{ groupKey: 'fromage', choiceKey: 'cheddar' }]), 'Option inconnue'],
    ['fromage inexistant', withCheese('inconnu'), 'Option inconnue'],
    ['pain manquant', { ...withCheese(), options: [{ groupKey: 'fromage', choiceKey: 'raclette' }] }, 'Pain'],
    ['deux pains', line('cheese', [
      { groupKey: 'fromage', choiceKey: 'raclette' }, { groupKey: 'pain', choiceKey: 'galette' },
    ]), 'Pain'],
  ] satisfies [string, Line, string][])('refuse %s avant toute écriture de commande ou allocation de numéro', async (_label, item, message) => {
    const { service, create, nextNumber, publish } = harness();
    await expect(service.create(TENANT, order([item]), 'caisse')).rejects.toThrow(message);
    expect(create).not.toHaveBeenCalled();
    expect(nextNumber).not.toHaveBeenCalled();
    expect(publish).not.toHaveBeenCalled();
  });
});
