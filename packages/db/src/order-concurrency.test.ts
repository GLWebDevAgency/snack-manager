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
      loyaltyEarnOperationId: '33333333-3333-4333-8333-333333333333',
      loyaltyActorRef: 'staff-secret',
      loyaltyDeviceRef: 'device-secret',
      loyaltyEarnState: 'pending',
      loyaltyEarnAttempts: 2,
      loyaltyEarnLastError: 'http_409',
      loyaltyEarnNextAttemptAt: new Date('2026-09-01T08:00:00Z'),
      loyaltyEarnLeaseUntil: new Date('2026-09-01T08:01:00Z'),
    });

    expect(document.get('loyaltyMemberId')).toBe(
      '22222222-2222-4222-8222-222222222222',
    );
    expect(document.toObject()).not.toHaveProperty('loyaltyMemberId');
    expect(document.toObject()).not.toHaveProperty('loyaltyEarnOperationId');
    expect(document.toObject()).not.toHaveProperty('loyaltyActorRef');
    expect(document.toObject()).not.toHaveProperty('loyaltyDeviceRef');
    expect(document.toObject()).not.toHaveProperty('loyaltyEarnState');
    expect(document.toObject()).not.toHaveProperty('loyaltyEarnAttempts');
    expect(document.toObject()).not.toHaveProperty('loyaltyEarnLastError');
    expect(document.toObject()).not.toHaveProperty('loyaltyEarnCompletedAt');
    expect(document.toObject()).not.toHaveProperty('loyaltyEarnNextAttemptAt');
    expect(document.toObject()).not.toHaveProperty('loyaltyEarnLeaseUntil');
    expect(document.toJSON()).not.toHaveProperty('loyaltyMemberId');
    expect(JSON.stringify(document)).not.toContain('loyaltyMemberId');
  });
});
