import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { orderRewardBenefit } from './order-reward-benefit';
const productRef = '507f1f77bcf86cd799439011';
const reward = { id: randomUUID(), name: 'Produit offert', costUnits: 50, kind: 'product', valueCents: null, productRef };
describe('server reward benefit', () => {
  it('offers only one cheapest base unit, preserves paid extras and additional quantities', () => {
    const result = orderRewardBenefit(reward, [{ productId: productRef, unitPrice: 800, qty: 3, options: [{ priceDelta: 100 }] },
      { productId: productRef, unitPrice: 650, qty: 1, options: [{ priceDelta: 50 }] }], 3050);
    expect(result.amountCents).toBe(600);
  });
  it('caps a fixed discount at merchandise and never applies to delivery', () => {
    expect(orderRewardBenefit({ ...reward, kind: 'fixed_discount', valueCents: 2000, productRef: null }, [], 1000).amountCents).toBe(1000);
  });
  it.each([{ ...reward, productRef: 'Boisson' }, { ...reward, kind: 'custom', productRef: null }])('never interprets a legacy description as an executable product: %j', value => {
    expect(() => orderRewardBenefit(value, [], 1000)).toThrow('pas disponible en commande en ligne');
  });
  it('requires a qualifying product already in the basket', () => {
    expect(() => orderRewardBenefit(reward, [], 1000)).toThrow('Ajoutez');
  });
});
