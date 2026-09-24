import { Mongoose, Types } from 'mongoose';
import { describe, expect, it } from 'vitest';
import { OrderSchema } from './schemas';

const odm = new Mongoose();
odm.set('autoCreate', false); odm.set('autoIndex', false);
const Order = odm.model('ImmutableOrderRewardFixture', OrderSchema.clone().set('bufferCommands', false));
const tenantRef = '507f1f77bcf86cd799439011';
const clientId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const accountId = '22222222-2222-4222-8222-222222222222';
const owner = { tenantRef, parentRef: `AC${'a'.repeat(32)}`, accountId };
const reward = { version: 1, reservationId: '11111111-1111-4111-8111-111111111111', clientId, owner,
  memberId: '33333333-3333-4333-8333-333333333333', programId: '44444444-4444-4444-8444-444444444444', rulesVersion: 1,
  pricingHash: 'a'.repeat(64), benefit: { rewardId: '55555555-5555-4555-8555-555555555555', name: 'Réduction de recette',
    costUnits: 60, kind: 'fixed_discount', amountCents: 300, productRef: null, policy: 'one-reward-no-promotion-v1' } };
const fixture = (patch: Record<string, unknown> = {}) => ({ tenantId: new Types.ObjectId(tenantRef), number: 1, clientId,
  customerOwner: owner, channel: 'online', type: 'delivery', lines: [],
  totals: { subtotal: 1250, discount: { amount: 300 }, deliveryFee: 200, total: 1150 },
  payment: { method: 'online' }, loyaltyReward: reward, ...patch });

async function validateInsert(patch: Record<string, unknown> = {}) {
  const update = { $setOnInsert: fixture(patch) };
  const query = Order.updateOne({ tenantId: new Types.ObjectId(tenantRef), clientId }, update, { upsert: true, runValidators: true });
  const native = query as unknown as {
    _castUpdate(value: unknown): Record<string, unknown>;
    validate(value: unknown, options: unknown, replacing: boolean): Promise<void>;
  };
  const casted = native._castUpdate(update); query.setUpdate(casted);
  await native.validate(casted, { runValidators: true }, false);
  return casted;
}

describe('order reward — native ODM, no database transport', () => {
  it('retains the exact private snapshot after document and insert-only validation', async () => {
    const row = new Order(fixture());
    expect(row.validateSync()).toBeUndefined();
    await expect(row.validate()).resolves.toBeUndefined();
    expect(row.toObject({ transform: false }).loyaltyReward).toEqual(reward);
    await expect(validateInsert()).resolves.toHaveProperty('$setOnInsert.loyaltyReward');
  });
  it('allows a fully discounted pickup without treating delivery as merchandise', async () => {
    await expect(validateInsert({ type: 'pickup', totals: { subtotal: 300, discount: { amount: 300 }, total: 0 } })).resolves.toBeDefined();
  });
  it('preserves absent historical reward and does not invent one from a discount', () => {
    const row = new Order(fixture({ loyaltyReward: undefined }));
    expect(row.toObject({ transform: false }).loyaltyReward).toBeNull();
    expect(row.validateSync()).toBeUndefined();
  });
  it('hides snapshot and processing from ordinary object, JSON and stringify output', () => {
    const row = new Order(fixture({ loyaltyRewardProcessing: { state: 'pending', orderVersion: -1, zeroPaid: false } }));
    for (const value of [row.toObject(), row.toJSON(), JSON.parse(JSON.stringify(row))]) {
      expect(value).not.toHaveProperty('loyaltyReward');
      expect(value).not.toHaveProperty('loyaltyRewardProcessing');
      expect(JSON.stringify(value)).not.toContain(reward.reservationId);
    }
    expect(Order.schema.path('loyaltyReward').options).toMatchObject({ select: false, immutable: true });
  });
  it.each([
    { tenantId: new Types.ObjectId('507f1f77bcf86cd799439012') }, { clientId: accountId }, { customerOwner: null },
    { customerOwner: { ...owner, parentRef: 'AC-other' } }, { customerOwner: { ...owner, accountId: clientId } },
    { channel: 'pos' }, { channel: 'phone' }, { type: 'dine-in' },
    { totals: { subtotal: 1250, discount: { amount: 301 }, deliveryFee: 200, total: 1149 } },
    { totals: { subtotal: 1250, discount: { amount: 300, promotionId: new Types.ObjectId() }, deliveryFee: 200, total: 1150 } },
    { totals: { subtotal: 1250, discount: { amount: 300 }, deliveryFee: 200, total: 1151 } },
    { totals: { subtotal: 299, discount: { amount: 300 }, deliveryFee: 200, total: 199 } },
  ])('rejects a mismatched owner, channel or server-priced ticket in documents and insert-only updates %#', async patch => {
    expect(new Order(fixture(patch)).validateSync()).toBeDefined();
    await expect(validateInsert(patch)).rejects.toThrow();
  });
  it.each([
    { version: '1' }, { version: 2 }, { clientId: clientId.toUpperCase() }, { rulesVersion: '1' }, { rulesVersion: 0 },
    { reservationId: 'bad' }, { pricingHash: 'bad' }, { phone: '+33600000000' }, { owner: { ...owner, token: 'private' } },
    { memberId: undefined }, { benefit: undefined }, { benefit: { ...reward.benefit, costUnits: '60' } },
    { benefit: { ...reward.benefit, amountCents: 0 } }, { benefit: { ...reward.benefit, unexpected: true } },
    { benefit: { ...reward.benefit, productRef: tenantRef } }, { benefit: { ...reward.benefit, kind: 'product', productRef: null } },
  ])('rejects malformed or coerced private snapshots %#', async patch => {
    const changed = { loyaltyReward: { ...reward, ...patch } };
    expect(new Order(fixture(changed)).validateSync()).toBeDefined();
    await expect(validateInsert(changed)).rejects.toThrow();
  });
  it.each(['reservationId', 'clientId', 'memberId', 'programId', 'rulesVersion', 'pricingHash', 'owner.accountId', 'owner.tenantRef', 'owner.parentRef',
    'benefit.costUnits', 'benefit.amountCents', 'benefit.productRef', 'benefit.policy', 'benefit.rewardId', 'benefit.kind', 'benefit.name'])('keeps persisted nested %s immutable', path => {
    const row = Order.hydrate(fixture());
    const previous = row.get(`loyaltyReward.${path}`);
    row.set(`loyaltyReward.${path}`, typeof previous === 'number' ? 999 : clientId);
    expect(row.get(`loyaltyReward.${path}`)).toEqual(previous);
  });
  it('refuses whole replacement and late adoption on a persisted ticket', () => {
    const row = Order.hydrate(fixture());
    row.set('loyaltyReward', { ...reward, reservationId: accountId });
    expect(row.toObject({ transform: false }).loyaltyReward).toEqual(reward);
    const legacy = Order.hydrate(fixture({ loyaltyReward: null })); legacy.set('loyaltyReward', reward);
    expect(legacy.get('loyaltyReward')).toBeNull();
  });
  it.each([
    { loyaltyReward: { ...reward, reservationId: accountId } }, { 'loyaltyReward.reservationId': accountId },
    { 'loyaltyReward.owner.accountId': clientId }, { 'loyaltyReward.benefit.amountCents': 1 },
    { 'loyaltyReward.benefit.costUnits': 1 },
  ])('strips immutable paths from native query update casting while leaving payment updates %#', values => {
    const update = { $set: { ...values, 'payment.status': 'paid' } };
    const native = Order.updateOne({}, update) as unknown as { _castUpdate(value: unknown): Record<string, unknown> };
    expect(native._castUpdate(update)).toEqual({ $set: { 'payment.status': 'paid' } });
  });
});
