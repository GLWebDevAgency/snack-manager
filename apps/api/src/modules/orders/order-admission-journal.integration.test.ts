import { randomUUID } from 'node:crypto';
import { Types } from 'mongoose';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { customerOrdersMongoFixture } from './customer-orders.test-fixture';
import { OrderAdmissionJournal } from './order-admission-journal';
import { orderAdmissionId } from './order-admission-identity';
import { publicRecoveryBinding } from './order-recovery';
import { OrderRewardSnapshotSchema } from '../loyalty/order-reward.store';

const TENANT = '507f1f77bcf86cd799439011';
const SLOT = '2030-05-02T09:00:00.000Z';
const integration = process.env.CUSTOMER_ORDERS_TEST_MONGO_URL ? describe : describe.skip;
type Fixture = Awaited<ReturnType<typeof customerOrdersMongoFixture>>;

integration('C01 reward materialization — actual Mongo', () => {
  let f: Fixture;
  const redis = { publish: vi.fn().mockResolvedValue(1) };
  beforeAll(async () => { f = await customerOrdersMongoFixture(process.env.CUSTOMER_ORDERS_TEST_MONGO_URL!, { tenantId: TENANT, slot: SLOT }); }, 20_000);
  beforeEach(async () => { await f.reset(); redis.publish.mockClear(); });
  afterAll(async () => { await f?.close(); });

  async function pending(withReward = true) {
    const body = f.request();
    const owner = { tenantRef: TENANT, parentRef: `AC${'a'.repeat(32)}`, accountId: randomUUID() };
    const binding = publicRecoveryBinding(TENANT, body, owner)!;
    const reward = OrderRewardSnapshotSchema.parse({ version: 1, reservationId: randomUUID(), clientId: body.clientId, owner,
      memberId: randomUUID(), programId: randomUUID(), rulesVersion: 3, pricingHash: 'b'.repeat(64),
      benefit: { rewardId: randomUUID(), name: 'Récompense de recette', costUnits: 60, kind: 'fixed_discount', amountCents: 300,
        productRef: null, policy: 'one-reward-no-promotion-v1' } });
    const snapshot = { _id: new Types.ObjectId(), tenantId: new Types.ObjectId(TENANT), clientId: body.clientId, channel: 'online', type: 'pickup', number: 12,
      lines: [], totals: { subtotal: 1250, total: withReward ? 950 : 1250,
        ...(withReward ? { discount: { amount: 300, reason: 'Récompense fidélité' } } : {}) },
      payment: { method: 'counter', status: 'pending' }, status: 'new', statusHistory: [],
      pickup: { ...body.pickup, slot: new Date(SLOT) }, publicRecovery: { version: 1, proofHash: binding.proofHash, payloadHash: binding.payloadHash },
      customerOwner: owner, ...(withReward ? { loyaltyReward: reward } : {}) };
    await f.models.admissions.collection.insertOne({ _id: orderAdmissionId(TENANT, body.clientId), tenantId: snapshot.tenantId,
      clientId: body.clientId, kind: 'public', channel: 'online', proofHash: binding.proofHash, payloadHash: binding.payloadHash,
      customerOwner: owner, state: 'committing', orderId: snapshot._id, slot: new Date(SLOT), snapshot } as never);
    const journal = new OrderAdmissionJournal(f.models.admissions, f.models.orders, redis as never);
    const admission = await journal.read(TENANT, body.clientId);
    if (!admission) throw new Error('Missing fixture admission');
    return { journal, admission, snapshot, reward };
  }

  it.each(['missing', 'reservation', 'member', 'amount'] as const)('retains the winning snapshot and publishes nothing when reward is %s', async variation => {
    const { journal, admission, snapshot, reward } = await pending();
    const changed = variation === 'missing' ? null : variation === 'reservation' ? { ...reward, reservationId: randomUUID() }
      : variation === 'member' ? { ...reward, memberId: randomUUID() } : { ...reward, benefit: { ...reward.benefit, amountCents: 301 } };
    // Reproduce a committed insert from an incompatible or interrupted writer.
    await f.models.orders.collection.insertOne({ ...snapshot, loyaltyReward: changed } as never);
    const before = await f.models.orders.collection.findOne({ _id: snapshot._id });
    await expect(journal.committedOrder(admission)).rejects.toMatchObject({ status: 503, response: { code: 'ORDER_ATTEMPT_UNCERTAIN' } });
    expect(await journal.read(TENANT, snapshot.clientId)).toMatchObject({ state: 'committing', snapshot: { loyaltyReward: reward } });
    expect(await f.models.orders.collection.findOne({ _id: snapshot._id })).toEqual(before);
    expect(await f.models.orders.countDocuments()).toBe(1);
    expect(redis.publish).not.toHaveBeenCalled();
  });

  it('rejects an unexpected materialized reward on an admission without one', async () => {
    const { journal, admission, snapshot, reward } = await pending(false);
    await f.models.orders.collection.insertOne({ ...snapshot, loyaltyReward: reward } as never);
    await expect(journal.committedOrder(admission)).rejects.toMatchObject({ status: 503 });
    expect(await journal.read(TENANT, snapshot.clientId)).toMatchObject({ state: 'committing' });
    expect(redis.publish).not.toHaveBeenCalled();
  });

  it.each([false, true])('completes exact materialization (reward=%s), conceals its private fields and replays one order', async withReward => {
    const { journal, admission, snapshot, reward } = await pending(withReward);
    const order = await journal.committedOrder(admission);
    const completed = await journal.read(TENANT, snapshot.clientId);
    expect(completed).toMatchObject({ state: 'created', snapshot: null });
    expect(order.totals.total).toBe(withReward ? 950 : 1250);
    const raw = await f.models.orders.collection.findOne({ _id: snapshot._id });
    if (withReward) expect(raw?.loyaltyReward).toEqual(reward);
    expect(JSON.stringify(order.toObject())).not.toMatch(/loyaltyReward|reservationId|pricingHash|customerOwner/);
    expect(JSON.stringify(redis.publish.mock.calls)).not.toMatch(/loyaltyReward|reservationId|pricingHash|customerOwner/);
    await journal.committedOrder(completed!);
    expect(await f.models.orders.countDocuments()).toBe(1);
    expect(redis.publish).toHaveBeenCalledOnce();
  });
});
