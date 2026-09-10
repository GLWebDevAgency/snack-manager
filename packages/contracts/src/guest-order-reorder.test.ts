import { describe, expect, it } from 'vitest';
import { GuestOrderReorderResponseSchema } from './guest-order-reorder';

const source = { tenantSlug: 'recette', orderId: 'a'.repeat(24), number: 12,
  lines: [{ productId: 'b'.repeat(24), name: 'Menu', variantKey: null, variantName: null, qty: 1, unitPrice: 900, options: [], removed: [] }] };
describe('source de nouvelle commande invitée', () => {
  it('conserve les références historiques nulles sans inventer de substitution', () => {
    const incomplete = { ...source, lines: [{ ...source.lines[0], productId: null, options: [{ groupKey: null, choiceKey: null }] }] };
    expect(GuestOrderReorderResponseSchema.parse(incomplete)).toEqual(incomplete);
  });
  it.each(['trackingToken', 'customer', 'pickup', 'delivery', 'payment', 'recoveryProof'])('refuse le champ privé %s', field => {
    expect(GuestOrderReorderResponseSchema.safeParse({ ...source, [field]: 'private' }).success).toBe(false);
  });
  it('borne tenant, lignes, argent et identifiants', () => {
    for (const value of [{ ...source, tenantSlug: '../recette' }, { ...source, orderId: 'guess' }, { ...source, lines: Array(101).fill(source.lines[0]) },
      { ...source, lines: [{ ...source.lines[0], unitPrice: -1 }] }, { ...source, lines: [{ ...source.lines[0], note: 'private' }] }]) {
      expect(GuestOrderReorderResponseSchema.safeParse(value).success).toBe(false);
    }
  });
});
