import { describe, expect, it } from 'vitest';
import { DeliveryAvailableOperatorsViewSchema } from './delivery-operators';

const operator = { id: '507f1f77bcf86cd799439011', name: 'Camille', revision: 2, assignedCount: 3, departedCount: 0 };
describe('choix des livreurs affectables depuis la caisse', () => {
  it('valide une projection minimale et une pagination bornée', () => {
    expect(DeliveryAvailableOperatorsViewSchema.parse({ operators: [operator], nextCursor: null })).toEqual({ operators: [operator], nextCursor: null });
    expect(DeliveryAvailableOperatorsViewSchema.safeParse({ operators: Array(51).fill(operator), nextCursor: null }).success).toBe(false);
    expect(DeliveryAvailableOperatorsViewSchema.safeParse({ operators: [], nextCursor: operator.id }).success).toBe(true);
  });
  it.each(['staffId', 'sessionState', 'token', 'inviteExpiresAt', 'phone'])('refuse une fuite de gestion %s', field => {
    expect(DeliveryAvailableOperatorsViewSchema.safeParse({ operators: [{ ...operator, [field]: 'private' }], nextCursor: null }).success).toBe(false);
  });
  it.each(['assignedCount', 'departedCount', 'revision'])('refuse un compteur invalide %s', field => {
    for (const value of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      expect(DeliveryAvailableOperatorsViewSchema.safeParse({ operators: [{ ...operator, [field]: value }], nextCursor: null }).success).toBe(false);
    }
  });
});
