import { Mongoose, Types } from 'mongoose';
import { describe, expect, it } from 'vitest';
import { OrderSchema } from './schemas';

const odm = new Mongoose();
odm.set('autoCreate', false); odm.set('autoIndex', false);
const Order = odm.model('CustomerSaleAttributionFixture', OrderSchema.clone().set('bufferCommands', false));
const tenantRef = '507f1f77bcf86cd799439011';
const clientId = '11111111-1111-4111-8111-111111111111';
const accountId = '22222222-2222-4222-8222-222222222222';
const owner = { parentRef: `AC${'a'.repeat(32)}`, tenantRef, accountId };
const attribution = { version: 1, tenantRef, clientId, owner, capturedAt: 1789034400000,
  basis: { policyVersion: 'merchandise-net-v1', eligiblePurchaseCents: 800, excludedChargeCents: 200, chargedTotalCents: 1000 },
  decision: 'attributed', memberId: '33333333-3333-4333-8333-333333333333',
  membershipOperationId: '44444444-4444-4444-8444-444444444444', programId: '55555555-5555-4555-8555-555555555555',
  rulesVersion: 1, rule: { mechanism: 'points', minimumPurchaseCents: 0, maximumUnitsPerPurchase: null,
    spendStepCents: 100, unitsPerStep: 1 } };
const fixture = (patch: Record<string, unknown> = {}) => ({ tenantId: new Types.ObjectId(tenantRef), number: 1, clientId,
  customerOwner: owner, channel: 'online', type: 'delivery', lines: [],
  totals: { subtotal: 900, discount: { amount: 100 }, deliveryFee: 200, total: 1000 },
  payment: { method: 'online' }, customerSaleAttribution: attribution, ...patch });

/** Invoke the installed ODM's casting and update validators, without replacing
 * them or reaching its collection transport. These are the same two native
 * stages Query._updateThunk executes before a Mongo write. */
async function validateInsert(patch: Record<string, unknown> = {}) {
  const update = { $setOnInsert: fixture(patch) };
  const query = Order.updateOne({ tenantId: new Types.ObjectId(tenantRef), clientId }, update, { upsert: true, runValidators: true });
  const native = query as unknown as {
    _castUpdate(value: unknown): Record<string, unknown>;
    validate(value: unknown, options: unknown, replacing: boolean): Promise<void>;
  };
  const casted = native._castUpdate(update);
  query.setUpdate(casted);
  await native.validate(casted, { runValidators: true }, false);
  return casted;
}

describe('immutable private customer sale attribution — native ODM, no server', () => {
  it('validates the complete snapshot against the actual order and retains its exact internal shape', async () => {
    const row = new Order(fixture());
    expect(row.validateSync()).toBeUndefined();
    await expect(row.validate()).resolves.toBeUndefined();
    expect(row.toObject({ transform: false })).toHaveProperty('customerSaleAttribution', attribution);
    expect(row.get('loyaltyEarnState')).toBeNull();
    expect(row.get('loyaltyEarnOperationId')).toBeNull();
  });
  it('hides even newly created snapshots from normal object, JSON and JSON.stringify output', () => {
    const row = new Order(fixture());
    for (const output of [row.toObject(), row.toJSON(), JSON.parse(JSON.stringify(row))]) {
      expect(output).not.toHaveProperty('customerSaleAttribution');
      expect(JSON.stringify(output)).not.toContain(attribution.membershipOperationId);
    }
    expect(Order.schema.path('customerSaleAttribution').options).toMatchObject({ select: false, immutable: true });
  });
  it('preserves historical null without deriving attribution from owner or old loyaltyMemberId', () => {
    const row = new Order(fixture({ customerSaleAttribution: undefined, loyaltyMemberId: attribution.memberId }));
    expect(row.toObject({ transform: false })).toHaveProperty('customerSaleAttribution', null);
    expect(row.validateSync()).toBeUndefined();
  });
  it.each(['not_enrolled', 'program_inactive', 'feature_unavailable', 'member_inactive'])('persists explicit none reason %s', reason => {
    const { memberId: _member, membershipOperationId: _operation, programId: _program, rulesVersion: _version, rule: _rule, ...common } = attribution;
    const value = { ...common, decision: 'none', reason };
    const row = new Order(fixture({ customerSaleAttribution: value }));
    expect(row.validateSync()).toBeUndefined();
    expect(row.toObject({ transform: false })).toHaveProperty('customerSaleAttribution', value);
  });
  it.each([
    { tenantId: new Types.ObjectId('507f1f77bcf86cd799439012') }, { clientId: '66666666-6666-4666-8666-666666666666' },
    { customerOwner: null }, { customerOwner: { ...owner, accountId: '66666666-6666-4666-8666-666666666666' } },
    { customerOwner: { ...owner, parentRef: `AC${'b'.repeat(32)}` } },
    { totals: { subtotal: 900, discount: { amount: 50 }, deliveryFee: 150, total: 1000 } },
    { totals: { subtotal: 900, discount: { amount: 100 }, deliveryFee: 300, total: 1100 } },
    { totals: { subtotal: 900, discount: { amount: 100 }, deliveryFee: 200, total: 999 } },
    { totals: { subtotal: 900, discount: { amount: -1 }, deliveryFee: 200, total: 1101 } },
  ])('refuses a snapshot for another ticket, owner or server amount %#', patch => {
    expect(new Order(fixture(patch)).validateSync()).toBeDefined();
  });
  it.each([
    { version: '1' }, { capturedAt: '1789034400000' }, { phone: '+33600000000' }, { qrToken: 'private' },
    { owner: { ...owner, phone: '+33600000000' } }, { owner: { ...owner, accountId: 'invalid' } },
    { basis: { ...attribution.basis, extra: true } }, { basis: { ...attribution.basis, eligiblePurchaseCents: '800' } },
    { basis: { ...attribution.basis, chargedTotalCents: 999 } }, { rule: { ...attribution.rule, token: 'private' } },
    { rule: { ...attribution.rule, unitsPerVisit: 1 } }, { rule: undefined }, { rulesVersion: 0 },
    { memberId: undefined }, { decision: 'none', reason: 'not_enrolled' },
  ])('rejects unknown or malformed nested shape before ODM coercion %#', patch => {
    expect(new Order(fixture({ customerSaleAttribution: { ...attribution, ...patch } })).validateSync()).toBeDefined();
  });
  it.each(['owner.accountId', 'basis.eligiblePurchaseCents', 'rule.unitsPerStep', 'rulesVersion', 'memberId'])('never changes persisted nested %s', path => {
    const row = Order.hydrate(fixture());
    const before = row.get(`customerSaleAttribution.${path}`);
    expect(before).toBeDefined();
    row.set(`customerSaleAttribution.${path}`, typeof before === 'number' ? 999 : clientId);
    expect(row.get(`customerSaleAttribution.${path}`)).toBe(before);
  });
  it('never adopts a historical null on an already persisted order', () => {
    const row = Order.hydrate(fixture({ customerSaleAttribution: null }));
    row.set('customerSaleAttribution', attribution);
    expect(row.get('customerSaleAttribution')).toBeNull();
  });
  it('validates a complete insert-only update including its sibling owner and totals', async () => {
    const casted = await validateInsert();
    expect(casted).toHaveProperty('$setOnInsert.customerSaleAttribution');
  });
  it.each([
    { customerOwner: undefined }, { tenantId: new Types.ObjectId('507f1f77bcf86cd799439012') },
    { clientId: '66666666-6666-4666-8666-666666666666' },
    { customerOwner: { ...owner, accountId: clientId } },
    { totals: { subtotal: 900, discount: { amount: 100 }, deliveryFee: 201, total: 1001 } },
    { customerSaleAttribution: { ...attribution, basis: { ...attribution.basis, eligiblePurchaseCents: '800' } } },
    { customerSaleAttribution: { ...attribution, rule: { ...attribution.rule, unexpected: true } } },
    { customerSaleAttribution: { ...attribution, rule: undefined } },
  ])('rejects invalid insert-only updates including complete nested validation %#', async patch => {
    await expect(validateInsert(patch)).rejects.toThrow();
  });
  it.each([
    { customerSaleAttribution: { ...attribution, rulesVersion: 2 } },
    { 'customerSaleAttribution.rulesVersion': 2 },
    { 'customerSaleAttribution.owner.accountId': clientId },
    { 'customerSaleAttribution.basis.eligiblePurchaseCents': 1 },
    { 'customerSaleAttribution.rule.unitsPerStep': 50 },
  ])('strips immutable parent and nested paths from native update casting %#', values => {
    const update = { $set: { ...values, 'payment.status': 'paid' } };
    const query = Order.updateOne({}, update);
    const native = query as unknown as { _castUpdate(value: unknown): Record<string, unknown> };
    expect(native._castUpdate(update)).toEqual({ $set: { 'payment.status': 'paid' } });
  });
});
