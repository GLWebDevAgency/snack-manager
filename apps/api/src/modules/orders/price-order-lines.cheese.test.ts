import { describe, expect, it } from 'vitest';
import { Mongoose } from 'mongoose';
import { ProductSchema } from '@sm/db';
import { priceOrderLines } from './price-order-lines';

type Line = Parameters<typeof priceOrderLines>[1][number];
const ProductModel = new Mongoose().model('MenuCheesePricingProduct', ProductSchema);
const PRODUCT_IDS = { classic: '665f0d0a1c2b3d4e5f6a7b81', cheese: '665f0d0a1c2b3d4e5f6a7b82' };
type ProductKey = keyof typeof PRODUCT_IDS;

const bread = {
  key: 'pain', name: 'Pain', type: 'single' as const, min: 1, max: 1,
  perVariant: null,
  choices: [
    { key: 'pain', name: 'Pain', priceDelta: 0 },
    { key: 'galette', name: 'Galette', priceDelta: 50 },
  ],
};
const includedCheese = {
  key: 'fromage', name: 'Fromage inclus', type: 'single' as const, min: 1, max: 1,
  perVariant: null,
  choices: ['cheddar', 'raclette', 'chevre', 'boursin', 'emmental'].map((key) => ({ key, name: key, priceDelta: 0 })),
};
const products = [
  { _id: PRODUCT_IDS.classic, name: 'Kebab', price: 750, variants: [], outOfStock: false, optionGroups: [bread, {
    key: 'supplements', name: 'Suppléments', type: 'multi', min: 0, max: null, perVariant: null,
    choices: [{ key: 'cheddar', name: 'Cheddar', priceDelta: 100 }],
  }] },
  { _id: PRODUCT_IDS.cheese, name: 'Kebab Fromage', price: 850, variants: [], outOfStock: false, optionGroups: [bread, includedCheese] },
].map((product) => new ProductModel({
  ...product, tenantId: '665f0d0a1c2b3d4e5f6a7b80', categoryId: '665f0d0a1c2b3d4e5f6a7b70',
}));

function line(productKey: ProductKey, additions: Line['options'] = [], breadChoice = 'pain'): Line {
  return { productId: PRODUCT_IDS[productKey], qty: 1, removed: [], options: [{ groupKey: 'pain', choiceKey: breadChoice }, ...additions] };
}

describe('deux produits distincts : Kebab et Kebab Fromage', () => {
  it.each(includedCheese.choices.map((choice) => choice.key))('fromage %s inclus : reste à 850 centimes', (choiceKey) => {
    const result = priceOrderLines(products, [line('cheese', [{ groupKey: 'fromage', choiceKey }])]);
    expect(result.subtotal).toBe(850);
    expect(result.lines[0]?.options.at(-1)?.priceDelta).toBe(0);
  });

  it('le Kebab classique reste à 750 et n’exige aucun choix de fromage', () => {
    expect(priceOrderLines(products, [line('classic')]).subtotal).toBe(750);
  });

  it('le supplément cheddar du classique ajoute 100 centimes, une seule fois', () => {
    expect(priceOrderLines(products, [line('classic', [{ groupKey: 'supplements', choiceKey: 'cheddar' }])]).subtotal).toBe(850);
  });

  it('galette + fromage inclus : 850 + 50, sans refacturer le fromage', () => {
    expect(priceOrderLines(products, [line('cheese', [{ groupKey: 'fromage', choiceKey: 'cheddar' }], 'galette')]).subtotal).toBe(900);
  });

  it('galette + supplément cheddar du classique : 750 + 50 + 100', () => {
    expect(priceOrderLines(products, [line('classic', [{ groupKey: 'supplements', choiceKey: 'cheddar' }], 'galette')]).subtotal).toBe(900);
  });

  it('le produit fromage exige exactement un choix inclus', () => {
    expect(() => priceOrderLines(products, [line('cheese')])).toThrow('1 choix attendu');
    expect(() => priceOrderLines(products, [line('cheese', [
      { groupKey: 'fromage', choiceKey: 'cheddar' }, { groupKey: 'fromage', choiceKey: 'raclette' },
    ])])).toThrow('1 choix attendu');
  });

  it('on ne détourne pas l’option gratuite du produit fromage vers le classique', () => {
    expect(() => priceOrderLines(products, [line('classic', [{ groupKey: 'fromage', choiceKey: 'cheddar' }])])).toThrow('Option inconnue');
  });

  it('le groupe Pain reste obligatoire et à choix unique sur les deux produits', () => {
    for (const productKey of ['classic', 'cheese'] as const) {
      const cheeses = productKey === 'cheese' ? [{ groupKey: 'fromage', choiceKey: 'cheddar' }] : [];
      expect(() => priceOrderLines(products, [{ productId: PRODUCT_IDS[productKey], qty: 1, removed: [], options: cheeses }])).toThrow('Pain');
      expect(() => priceOrderLines(products, [line(productKey, [...cheeses, { groupKey: 'pain', choiceKey: 'galette' }])])).toThrow('Pain');
    }
  });
});
