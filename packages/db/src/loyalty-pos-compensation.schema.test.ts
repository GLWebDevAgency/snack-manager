import { randomUUID } from 'node:crypto';
import mongoose from 'mongoose';
import { describe, expect, it } from 'vitest';
import { MODELS } from './schemas';
import { posCompensationWake } from './loyalty-pos-compensation.schema';
const identity = { channel: 'pos', loyaltyEarnState: 'completed', loyaltyEarnOperationId: randomUUID(), loyaltyMemberId: randomUUID() };
describe('private POS compensation scheduling', () => {
  it('initializes a legacy null projection without replacing an existing lease', () => {
    const now = new Date();
    expect(posCompensationWake({ ...identity, loyaltyPosCompensationProcessing: null }, now)).toMatchObject({ loyaltyPosCompensationProcessing: { state: 'pending', dirty: true, nextAttemptAt: now } });
    expect(posCompensationWake({ ...identity, loyaltyPosCompensationProcessing: { state: 'processing', leaseToken: 'owned' } }, now))
      .toEqual({ 'loyaltyPosCompensationProcessing.dirty': true, 'loyaltyPosCompensationProcessing.nextAttemptAt': now });
  });
  it.each([{ channel: 'online' }, { loyaltyEarnState: 'pending' }, { loyaltyMemberId: null }, { loyaltyEarnOperationId: null }])('never schedules a different protocol or unfinished gain: %j', change => {
    expect(posCompensationWake({ ...identity, ...change }, new Date())).toEqual({});
  });
  it('removes all private scheduler data from both fresh document serializers', () => {
    const schema = MODELS.Order.schema;
    const Model = mongoose.model(`PosPrivate_${randomUUID().replaceAll('-', '')}`, schema);
    const row = new Model({ ...identity, ...posCompensationWake(identity, new Date()) });
    expect(row.get('loyaltyPosCompensationProcessing')).toMatchObject({ state: 'pending' });
    expect(schema.path('loyaltyPosCompensationProcessing').options.select).toBe(false);
    expect(row.toJSON()).not.toHaveProperty('loyaltyPosCompensationProcessing');
    expect(row.toObject()).not.toHaveProperty('loyaltyPosCompensationProcessing');
    mongoose.deleteModel(Model.modelName);
  });
});
