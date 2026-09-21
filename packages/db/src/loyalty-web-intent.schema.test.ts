import { randomUUID } from 'node:crypto';
import { Mongoose, Types } from 'mongoose';
import { describe, expect, it } from 'vitest';
import { OrderSchema } from './schemas';
import { validLoyaltyWebIntent } from './loyalty-web-intent.schema';

const odm = new Mongoose();
const Order = odm.model('WebIntentFixture', OrderSchema.clone().set('bufferCommands', false));
function fixture() {
  const tenantRef = new Types.ObjectId().toHexString(), clientId = randomUUID();
  const owner = { parentRef: `AC${'a'.repeat(32)}`, tenantRef, accountId: randomUUID() };
  return { tenantId: tenantRef, clientId, number: 1, channel: 'online', type: 'pickup', lines: [],
    totals: { subtotal: 1000, total: 1000 }, payment: { method: 'counter' }, customerOwner: owner,
    customerSaleAttribution: { version: 1, tenantRef, clientId, owner, capturedAt: Date.now(), decision: 'attributed',
      memberId: randomUUID(), membershipOperationId: randomUUID(), programId: randomUUID(), rulesVersion: 1,
      rule: { mechanism: 'points', minimumPurchaseCents: 0, maximumUnitsPerPurchase: null, spendStepCents: 100, unitsPerStep: 1 },
      basis: { policyVersion: 'merchandise-net-v1', eligiblePurchaseCents: 1000, excludedChargeCents: 0, chargedTotalCents: 1000 } },
    loyaltyWebIntent: { version: 1, operationId: randomUUID() },
    loyaltyWebProcessing: { state: 'pending', attempts: 0, nextAttemptAt: new Date() } };
}
describe('private immutable web earn intention', () => {
  it('stores one intent beside the frozen attribution and hides both scheduling and identity publicly', async () => {
    const source = fixture(), row = new Order(source); await expect(row.validate()).resolves.toBeUndefined();
    expect(row.toObject({ transform: false }).loyaltyWebIntent).toEqual(source.loyaltyWebIntent);
    for (const out of [row.toObject(), row.toJSON(), JSON.parse(JSON.stringify(row))]) {
      expect(out).not.toHaveProperty('loyaltyWebIntent'); expect(out).not.toHaveProperty('loyaltyWebProcessing');
      expect(JSON.stringify(out)).not.toContain(source.loyaltyWebIntent.operationId);
    }
  });
  it.each([null, { version: 1, operationId: randomUUID() }])('does not adopt or replace a persisted intent %#', intent => {
    const row = Order.hydrate({ ...fixture(), loyaltyWebIntent: intent });
    row.set('loyaltyWebIntent', { version: 1, operationId: randomUUID() });
    expect(row.toObject({ transform: false }).loyaltyWebIntent ?? null).toEqual(intent);
    if (intent) { row.set('loyaltyWebIntent.operationId', randomUUID()); expect(row.get('loyaltyWebIntent.operationId')).toBe(intent.operationId); }
  });
  it.each([{}, { version: 2, operationId: randomUUID() }, { version: '1', operationId: randomUUID() },
    { version: 1, operationId: 'invalid' }, { version: 1, operationId: randomUUID(), token: 'not-storable' }])('rejects malformed/private-extra protocol %#', intent => {
    expect(validLoyaltyWebIntent(intent)).toBe(false); expect(new Order({ ...fixture(), loyaltyWebIntent: intent }).validateSync()).toBeDefined();
  });
  it.each([{ channel: 'pos' }, { customerSaleAttribution: null }])('requires a new online attributed ticket %#', patch => {
    expect(new Order({ ...fixture(), ...patch }).validateSync()).toBeDefined();
  });
  it('keeps unadmitted legacy orders null without deriving from customerOwner', () => {
    const source = fixture(); const row = new Order({ ...source, loyaltyWebIntent: undefined, loyaltyWebProcessing: undefined });
    expect(row.get('loyaltyWebIntent')).toBeNull(); expect(row.get('loyaltyWebProcessing')).toBeNull();
  });
  it('keeps the scheduling indexes and a tenant-scoped operation uniqueness guard', () => {
    expect(Order.schema.indexes()).toContainEqual([{ tenantId: 1, 'loyaltyWebIntent.operationId': 1 }, expect.objectContaining({ unique: true })]);
    expect(Order.schema.path('loyaltyWebIntent').options).toMatchObject({ immutable: true, select: false });
  });
});
