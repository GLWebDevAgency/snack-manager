import { randomUUID } from 'node:crypto';
import { Types } from 'mongoose';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { COUNTER_REFUND_DISBURSE_WINDOW_MS, type CounterRefundIntent } from '@sm/contracts';
import { customerOrdersMongoFixture } from '../orders/customer-orders.test-fixture';
import { OrderCounterRefundService } from './order-counter-refund.service';

const target = process.env.CUSTOMER_ORDERS_TEST_MONGO_URL;
const integration = target ? describe : describe.skip;
integration('counter refunds — durable physical permission on real Mongo', () => {
  const tenantId = new Types.ObjectId().toHexString();
  const actor = { tenantId, sub: new Types.ObjectId().toHexString(), kind: 'user' as const, role: 'owner' as const };
  const manager = { sub: new Types.ObjectId().toHexString(), kind: 'staff' as const, role: 'gerant' as const };
  let fixture: Awaited<ReturnType<typeof customerOrdersMongoFixture>>;
  let service: OrderCounterRefundService, orderId: string;
  const audit = { logOnce: vi.fn(async (..._args: unknown[]) => undefined) };
  const redis = { publish: vi.fn(async () => 1) };
  const intent = (amountCents = 500): CounterRefundIntent => ({ operationId: randomUUID(), amountCents,
    tender: 'cash', reason: 'Article rendu au comptoir', allocation: { version: 1, merchandiseCents: amountCents, deliveryCents: 0 } });
  const execute = (action: Parameters<OrderCounterRefundService['execute']>[0], body: CounterRefundIntent,
    evidence: Parameters<OrderCounterRefundService['execute']>[6] = {}) => service.execute(action, tenantId, orderId, actor, actor, body, evidence);
  beforeAll(async () => { fixture = await customerOrdersMongoFixture(target!, { tenantId, slot: '2030-05-02T09:00:00Z' }); }, 30_000);
  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2030-05-02T07:00:00Z'));
    vi.stubEnv('ORDER_COUNTER_REFUNDS_ENABLED', 'true'); audit.logOnce.mockReset().mockResolvedValue(undefined);
    await fixture.reset();
    const created = await fixture.replica().orders.create(tenantId, { clientId: randomUUID(), channel: 'pos', type: 'emporter',
      lines: [{ productId: fixture.productId, qty: 1, options: [], removed: [] }],
      payment: { method: 'counter', tender: 'cash', cashReceived: 1500 } }, actor.sub);
    orderId = String(created._id);
    service = new OrderCounterRefundService(fixture.models.orders,
      { pourTenant: async () => ['bo', 'online'] } as never, audit as never, redis as never);
  });
  afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); vi.unstubAllEnvs(); });
  afterAll(async () => { await fixture?.close(); });

  it('keeps the actual POS creation proof and refunds 500 + 750 exactly once, without inventing a bank refund', async () => {
    const first = intent();
    expect(await service.journal(tenantId, orderId, actor)).toMatchObject({ available: true, originalPaidCents: 1250, remainingCents: 1250 });
    await execute('prepare', first);
    const start = await execute('start', first);
    expect(start).toMatchObject({ mayDisburse: true, journal: { pendingRefundCents: 500 } });
    expect(Date.parse(start.journal.operations[0]!.disburseExpiresAt!) - Date.parse(start.journal.observedAt)).toBe(COUNTER_REFUND_DISBURSE_WINDOW_MS);
    expect((await execute('start', first)).mayDisburse).toBe(false);
    const confirmed = await execute('confirm', first, { attestation: 'cash_returned' });
    expect(confirmed.journal).toMatchObject({ refundedCents: 500, pendingRefundCents: 0, remainingCents: 750 });
    const beforeReplay = await fixture.models.orders.collection.findOne({ _id: new Types.ObjectId(orderId) });
    await execute('confirm', first, { attestation: 'cash_returned' });
    expect(await fixture.models.orders.collection.findOne({ _id: new Types.ObjectId(orderId) })).toEqual(beforeReplay);
    const second = intent(750); await execute('prepare', second); await execute('start', second); await execute('confirm', second, { attestation: 'cash_returned' });
    const stored = await fixture.models.orders.collection.findOne({ _id: new Types.ObjectId(orderId) });
    expect(stored?.payment).toMatchObject({ status: 'refunded', refundedCents: 1250, pendingRefundCents: 0, refundSyncVersion: 6, refunds: [] });
    expect(stored?.counterCollection).toBeNull();
    expect(stored?.counterRefundFlow.operations).toHaveLength(2);
    expect((await fixture.models.orders.findById(orderId).lean())?.counterRefundFlow).toBeUndefined();
    expect(JSON.stringify(redis.publish.mock.calls)).not.toContain('counterRefundFlow');
    await expect(execute('prepare', intent(1))).rejects.toThrow();
  });
  it('uses CAS to issue only one physical permission under two concurrent starts', async () => {
    const body = intent(); await execute('prepare', body);
    const results = await Promise.all([execute('start', body), execute('start', body)]);
    expect(results.map(row => row.mayDisburse).sort()).toEqual([false, true]);
    expect((await service.journal(tenantId, orderId, actor)).operations).toHaveLength(1);
  });
  it('only reserves one of two different concurrent requests and preserves the winning amount', async () => {
    const results = await Promise.allSettled([execute('prepare', intent(700)), execute('prepare', intent(700))]);
    expect(results.filter(row => row.status === 'fulfilled')).toHaveLength(1);
    expect((await service.journal(tenantId, orderId, actor)).pendingRefundCents).toBe(700);
  });
  it('never reissues permission after the start ACK was lost, even when its durable receipt is readable', async () => {
    const body = intent(); await execute('prepare', body);
    const model = fixture.models.orders, original = model.findOneAndUpdate.bind(model);
    const spy = vi.spyOn(model, 'findOneAndUpdate').mockImplementationOnce((...args: unknown[]) => {
      const query = original(...args as Parameters<typeof original>), run = query.exec.bind(query);
      query.exec = (async () => { await run(); throw new Error('synthetic ACK loss after commit'); }) as typeof query.exec;
      return query;
    });
    const result = await execute('start', body); spy.mockRestore();
    expect(result.mayDisburse).toBe(false);
    expect(result.journal.operations[0]?.state).toBe('started');
    expect((await execute('start', body)).mayDisburse).toBe(false);
    await expect(execute('withdraw', body)).rejects.toThrow();
    await expect(execute('prepare', intent())).rejects.toThrow();
  });
  it('expires a delayed start response and lets a different owner attest no effect without transferring authorship', async () => {
    const body = intent(); await execute('prepare', body);
    let release!: () => void, reached!: () => void;
    const ready = new Promise<void>(resolve => { reached = resolve; });
    const held = new Promise<void>(resolve => { release = resolve; });
    audit.logOnce.mockImplementationOnce(async () => { reached(); await held; });
    const starting = execute('start', body); await ready;
    await expect(execute('no_effect', body, { resolutionReason: 'Aucun argent rendu ni remboursement terminal en cours' })).rejects.toMatchObject({ response: { code: 'COUNTER_REFUND_PERMISSION_ACTIVE' } });
    vi.setSystemTime(Date.now() + COUNTER_REFUND_DISBURSE_WINDOW_MS);
    const other = { ...actor, sub: new Types.ObjectId().toHexString() };
    const decision = await service.execute('no_effect', tenantId, orderId, other, other, body,
      { resolutionReason: 'Aucun argent rendu ni remboursement terminal en cours' });
    expect(decision.journal).toMatchObject({ pendingRefundCents: 0, remainingCents: 1250, operations: [{ state: 'not_executed' }] });
    release(); expect((await starting).mayDisburse).toBe(false);
    const stored = await fixture.models.orders.collection.findOne({ _id: new Types.ObjectId(orderId) });
    expect(stored?.counterRefundFlow.operations[0]).toMatchObject({ actor: { sub: actor.sub }, approver: { sub: actor.sub }, resolution: { actor: { sub: other.sub } } });
    await expect(execute('start', body)).rejects.toThrow();
    await expect(execute('confirm', body, { attestation: 'cash_returned' })).rejects.toThrow();
  });
  it('allows late confirmation of the act already performed, even when the gate has closed', async () => {
    const body = intent(); await execute('prepare', body); await execute('start', body);
    vi.setSystemTime(Date.now() + COUNTER_REFUND_DISBURSE_WINDOW_MS + 1); vi.stubEnv('ORDER_COUNTER_REFUNDS_ENABLED', 'false');
    expect((await execute('confirm', body, { attestation: 'cash_returned' })).journal.refundedCents).toBe(500);
    await expect(execute('prepare', intent())).rejects.toThrow('suspendus');
  });
  it('closes a never-started UUID permanently, including a request whose preparation was never received', async () => {
    const body = intent(); await execute('withdraw', body); await execute('withdraw', body);
    expect((await service.journal(tenantId, orderId, actor)).operations[0]?.state).toBe('withdrawn');
    await expect(execute('start', body)).rejects.toThrow();
    await execute('prepare', intent());
  });
  it('never turns missing or incompatible payment evidence into a refund permission', async () => {
    await fixture.models.orders.collection.updateOne({ _id: new Types.ObjectId(orderId) }, { $set: { paymentFlow: null } });
    expect((await service.journal(tenantId, orderId, actor))).toMatchObject({ available: false, unavailableReason: 'payment_proof_missing' });
    await expect(execute('prepare', intent())).rejects.toMatchObject({ response: { code: 'COUNTER_REFUND_PROOF_REQUIRED' } });
    expect((await fixture.models.orders.collection.findOne({ _id: new Types.ObjectId(orderId) }))?.counterRefundFlow).toBeNull();
  });
  it('rejects foreign scope, different initiator/approver and changed UUID body before any financial write', async () => {
    const body = intent(); await execute('prepare', body);
    await expect(service.journal(new Types.ObjectId().toHexString(), orderId, actor)).rejects.toThrow();
    const other = { ...actor, sub: new Types.ObjectId().toHexString() };
    await expect(service.execute('start', tenantId, orderId, other, actor, body)).rejects.toThrow('auteur');
    await expect(service.execute('start', tenantId, orderId, actor, manager, body)).rejects.toThrow('auteur');
    await expect(execute('start', { ...body, reason: 'Autre raison' })).rejects.toThrow();
    expect((await service.journal(tenantId, orderId, actor)).operations[0]?.state).toBe('prepared');
  });
  it('preserves the refund receipt on audit failure and repairs only the audit with the same request', async () => {
    const body = intent(); await execute('prepare', body); await execute('start', body);
    audit.logOnce.mockRejectedValueOnce(new Error('synthetic audit unavailable'));
    await expect(execute('confirm', body, { attestation: 'cash_returned' })).rejects.toMatchObject({ response: { code: 'COUNTER_REFUND_AUDIT_PENDING' } });
    expect((await service.journal(tenantId, orderId, actor)).refundedCents).toBe(500);
    const before = await fixture.models.orders.collection.findOne({ _id: new Types.ObjectId(orderId) });
    await execute('confirm', body, { attestation: 'cash_returned' });
    expect(await fixture.models.orders.collection.findOne({ _id: new Types.ObjectId(orderId) })).toEqual(before);
  });
});
