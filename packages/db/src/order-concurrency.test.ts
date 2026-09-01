import { Mongoose } from 'mongoose';
import { describe, expect, it } from 'vitest';
import { OrderSchema } from './schemas';

describe('Order — concurrence optimiste', () => {
  it('compare et incrémente __v lors de chaque save', () => {
    expect(OrderSchema.get('optimisticConcurrency')).toBe(true);
  });

  it('retire la carte liée des objets et JSON, y compris juste après création', () => {
    const isolated = new Mongoose();
    const Order = isolated.model('OrderPrivacyTest', OrderSchema.clone());
    const document = new Order({
      loyaltyMemberId: '22222222-2222-4222-8222-222222222222',
    });

    expect(document.get('loyaltyMemberId')).toBe(
      '22222222-2222-4222-8222-222222222222',
    );
    expect(document.toObject()).not.toHaveProperty('loyaltyMemberId');
    expect(document.toJSON()).not.toHaveProperty('loyaltyMemberId');
    expect(JSON.stringify(document)).not.toContain('loyaltyMemberId');
  });
});
