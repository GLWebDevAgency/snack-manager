import { describe, expect, it } from 'vitest';
import { CollectOrderPaymentSchema } from './order-counter';

const base = { operationId: '9e36ab4c-b034-4531-bdbd-ae680325f81d', expectedTotalCents: 1250 };
describe('encaissement explicite d’une commande existante', () => {
  it.each(['card', 'meal_voucher'])('autorise la confirmation %s sans données espèces', (tender) => {
    expect(CollectOrderPaymentSchema.parse({ ...base, tender })).toEqual({ ...base, tender });
  });
  it('exige le montant reçu pour les espèces', () => {
    expect(CollectOrderPaymentSchema.safeParse({ ...base, tender: 'cash' }).success).toBe(false);
    expect(CollectOrderPaymentSchema.parse({ ...base, tender: 'cash', cashReceivedCents: 2000 })).toMatchObject({ cashReceivedCents: 2000 });
  });
  it.each(['method', 'status', 'changeGiven', 'amount', 'cashReceivedCents'])('interdit le champ client %s sur une confirmation carte', (key) => {
    expect(CollectOrderPaymentSchema.safeParse({ ...base, tender: 'card', [key]: 1250 }).success).toBe(false);
  });
  it.each([-1, 1.5, NaN, Infinity, 100_000_001, Number.MAX_SAFE_INTEGER])('refuse le montant non borné en centimes %s', (amount) => {
    expect(CollectOrderPaymentSchema.safeParse({ ...base, tender: 'cash', cashReceivedCents: amount }).success).toBe(false);
    expect(CollectOrderPaymentSchema.safeParse({ ...base, tender: 'card', expectedTotalCents: amount }).success).toBe(false);
  });
  it.each(['online', 'counter', 'tr', 'cash-card'])('refuse le moyen non pris en charge %s', (tender) => {
    expect(CollectOrderPaymentSchema.safeParse({ ...base, tender }).success).toBe(false);
  });
  it('exige une vraie clé de rejeu UUIDv4', () => {
    expect(CollectOrderPaymentSchema.safeParse({ ...base, tender: 'card', operationId: 'order-42' }).success).toBe(false);
  });
});
