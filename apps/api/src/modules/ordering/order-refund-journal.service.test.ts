import { describe, expect, it, vi } from 'vitest';
import { OrderRefundsService, type RefundStripeClient } from './order-refunds.service';
import type { RefundSnapshot } from './order-refund-flow.policy';

const TENANT = '111111111111111111111111';
const ORDER = '222222222222222222222222';
const ACTOR = '333333333333333333333333';
const OPERATION = '11111111-1111-4111-8111-111111111111';
function recorded(): RefundSnapshot {
  return { _id: ORDER, tenantId: TENANT, __v: 1, totals: { total: 1000 },
    payment: { method: 'online', status: 'paid', stripePaymentIntentId: 'pi_current', stripeAccountId: 'acct_current',
      refundedCents: 100, pendingRefundCents: 0 },
    paymentFlow: { attempt: { environment: 'test' } },
    refundFlow: { version: 1, operations: [{ operationId: OPERATION, amountCents: 100, reason: 'Motif test', actorId: ACTOR,
      environment: 'test', paymentIntentId: 'pi_current', accountId: 'acct_current',
      idempotencyKey: `order-refund:${ORDER}:${OPERATION}`, preparedAt: new Date('2026-09-20T00:00:00.000Z'),
      requestStartedAt: new Date('2026-09-20T00:00:01.000Z'), state: 'known',
      refund: { id: 're_observed', amount: 100, currency: 'eur', payment_intent: 'pi_current', status: 'succeeded',
        metadata: { operationId: OPERATION, orderId: ORDER, tenantId: TENANT, requestedBy: ACTOR, reason: 'Motif test' } },
    }] } };
}

function harness(order: RefundSnapshot, environment: 'test' | 'live' | null = null) {
  const writes = vi.fn<(filter: Record<string, unknown>, update: { $set: Record<string, unknown> }) => Promise<RefundSnapshot | null>>()
    .mockRejectedValue(new Error('Journal reads must never write'));
  const query = (load: () => Promise<RefundSnapshot | null>) => ({ select() { return this; }, read() { return this; }, readConcern() { return this; },
    maxTimeMS() { return this; }, lean: load });
  const model = { findOne: vi.fn(() => query(async () => structuredClone(order))),
    findOneAndUpdate: (filter: Record<string, unknown>, update: { $set: Record<string, unknown> }) => query(() => writes(filter, update)) };
  const provider = { refunds: { list: vi.fn(), create: vi.fn() }, charges: { retrieve: vi.fn() } };
  const audit = { logOnce: vi.fn() }, redis = { publish: vi.fn() };
  const factory = vi.fn(async (): Promise<RefundStripeClient | null> => environment ? { ...provider, environment } : null);
  const service = new OrderRefundsService(model as never, factory, redis as never,
    { pourTenant: async () => ['bo'] } as never, audit as never);
  function expectReadOnly() {
    expect(writes).not.toHaveBeenCalled(); expect(audit.logOnce).not.toHaveBeenCalled();
    expect(redis.publish).not.toHaveBeenCalled(); expect(provider.refunds.list).not.toHaveBeenCalled();
    expect(provider.refunds.create).not.toHaveBeenCalled(); expect(provider.charges.retrieve).not.toHaveBeenCalled();
  }
  return { service, expectReadOnly, writes, provider };
}

describe('refund journal receipt provenance, independent of activation', () => {
  it.each(['account', 'intent', 'environment', 'method'] as const)('refuses a stored receipt with contradictory %s while activation is closed', async mismatch => {
    const order = recorded();
    const operation = order.refundFlow!.operations[0]!;
    if (mismatch === 'account') operation.accountId = 'acct_another';
    if (mismatch === 'intent') operation.paymentIntentId = 'pi_another';
    if (mismatch === 'environment') operation.environment = 'live';
    if (mismatch === 'method') order.payment.method = 'counter';
    const before = structuredClone(order);
    const { service, expectReadOnly } = harness(order);
    await expect(service.journal(TENANT, ORDER, ACTOR)).rejects.toThrow('Remboursement');
    expect(order).toEqual(before); expectReadOnly();
  });

  it.each([null, 'live'] as const)('keeps a valid historical receipt readable under current configuration %s', async environment => {
    const order = recorded();
    const before = structuredClone(order);
    const { service, expectReadOnly } = harness(order, environment);
    const result = await service.journal(TENANT, ORDER, ACTOR);
    expect(result).toMatchObject({ enabled: false, operations: [{ operationId: OPERATION, state: 'known', providerStatus: 'succeeded', canResume: false }] });
    for (const privateValue of [ACTOR, 'acct_current', 'pi_current', 'idempotencyKey', 'metadata', 'environment']) {
      expect(JSON.stringify(result)).not.toContain(privateValue);
    }
    expect(order).toEqual(before); expectReadOnly();
  });

  it('does not invent a durable operation for a historical provider-only refund', async () => {
    const order = recorded();
    order.refundFlow = null;
    order.payment.refunds = [{ id: 're_observed', amountCents: 100, status: 'succeeded', operationId: OPERATION, reason: 'Motif test' }];
    const { service, expectReadOnly } = harness(order);
    expect(await service.journal(TENANT, ORDER, ACTOR)).toMatchObject({ enabled: false, operations: [],
      summary: { refundedCents: 100, pendingRefundCents: 0, remainingCents: 900 } });
    expectReadOnly();
  });

  it('refuses an unexplained historical aggregate instead of manufacturing a receipt', async () => {
    const order = recorded(); order.refundFlow = null;
    const { service, expectReadOnly } = harness(order);
    await expect(service.journal(TENANT, ORDER, ACTOR)).rejects.toThrow('Historique de remboursement incomplet');
    expectReadOnly();
  });

  it.each(['pending', 'requires_action', 'succeeded', 'failed', 'canceled'])(
    'refuses withdrawal when a historical %s receipt already proves dispatch despite an incomplete prepared operation', async status => {
      const order = recorded();
      const operation = order.refundFlow!.operations[0]!;
      operation.state = 'prepared'; operation.requestStartedAt = null; delete operation.refund;
      const operationId = 'abcddcba-abcd-4abc-8abc-abcddcbaabcd'; operation.operationId = operationId;
      order.payment.refunds = [{ id: 're_observed', amountCents: 100, status, operationId: operationId.toUpperCase() }];
      order.payment.refundedCents = status === 'succeeded' ? 100 : 0;
      order.payment.pendingRefundCents = 100;
      const before = structuredClone(order);
      const { service, expectReadOnly } = harness(order, 'test');
      await expect(service.withdraw(TENANT, ORDER, ACTOR, { operationId, amountCents: 100,
        reason: 'Motif test', password: 'local-test-only' })).rejects.toThrow('déjà pu être envoyée');
      expect(order).toEqual(before); expectReadOnly();
    });

  it.each(['pending', 'requires_action', 'succeeded', 'failed', 'canceled'])(
    'never exposes a negative receipt contradicted by an existing %s provider receipt', async status => {
      const order = recorded();
      const operation = order.refundFlow!.operations[0]!;
      operation.state = 'withdrawn'; operation.requestStartedAt = null; delete operation.refund;
      operation.operationId = 'abcddcba-abcd-4abc-8abc-abcddcbaabcd';
      order.payment.refunds = [{ id: 're_observed', amountCents: 100, status, operationId: operation.operationId.toUpperCase() }];
      order.payment.refundedCents = status === 'succeeded' ? 100 : 0;
      order.payment.pendingRefundCents = ['pending', 'requires_action'].includes(status) ? 100 : 0;
      const { service, expectReadOnly } = harness(order);
      await expect(service.journal(TENANT, ORDER, ACTOR)).rejects.toThrow('Remboursement');
      expectReadOnly();
    });

  it('does not reopen an old refunded payment when withdrawing an unsent local request without provider evidence', async () => {
    const order = recorded();
    order.refundFlow = null; order.payment.status = 'refunded'; order.payment.refundedCents = 0;
    order.payment.pendingRefundCents = 0; order.payment.refunds = [];
    const { service, writes, provider } = harness(order, 'test');
    writes.mockImplementation(async (_filter, update) => {
      expect(Object.hasOwn(update.$set, 'payment.status')).toBe(false);
      for (const [path, value] of Object.entries(update.$set)) {
        const parts = path.split('.');
        let cursor = order as unknown as Record<string, unknown>;
        for (const part of parts.slice(0, -1)) cursor = cursor[part] as Record<string, unknown>;
        cursor[parts.at(-1)!] = structuredClone(value);
      }
      order.__v = (order.__v ?? 0) + 1;
      order.payment.refundSyncVersion = (order.payment.refundSyncVersion ?? 0) + 1;
      return structuredClone(order);
    });
    const result = await service.withdraw(TENANT, ORDER, ACTOR, { operationId: OPERATION, amountCents: 100,
      reason: 'Motif test', password: 'local-test-only' });
    expect(result.operations[0]).toMatchObject({ operationId: OPERATION, state: 'withdrawn' });
    expect(order.payment.status).toBe('refunded'); expect(writes).toHaveBeenCalledOnce();
    expect(provider.refunds.list).not.toHaveBeenCalled(); expect(provider.refunds.create).not.toHaveBeenCalled();
  });
});
