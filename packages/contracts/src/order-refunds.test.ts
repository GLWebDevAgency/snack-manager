import { describe, expect, it } from 'vitest';
import { OrderRefundJournalSchema, OrderRefundOperationViewSchema, OrderRefundRequestSchema } from './order-refunds';

const orderId = '665f0d0a1c2b3d4e5f6a7b8c';
const operation = { orderId, operationId: 'e404fe33-f766-471e-a6c0-36541d0b1e53', amountCents: 250,
  reason: 'Produit indisponible', state: 'known', providerStatus: 'succeeded', canResume: false,
  preparedAt: '2026-09-20T04:00:00.000Z' };
const summary = { refundedCents: 250, pendingRefundCents: 0, remainingCents: 1000, status: 'partial',
  refunds: [{ id: 're_observed', amountCents: 250, status: 'succeeded' }] };

describe('journal privé des remboursements', () => {
  it('keeps the existing request contract compatible without persisting its password', () => {
    expect(OrderRefundRequestSchema.parse({ operationId: operation.operationId, amountCents: 250,
      reason: ' Produit indisponible ', password: 'owner-password' }).reason).toBe(operation.reason);
    expect(OrderRefundJournalSchema.parse({ orderId, enabled: false, summary, operations: [operation] }).operations).toEqual([operation]);
  });
  it.each(['pending', 'requires_action', 'succeeded', 'failed', 'canceled'])('accepts a known %s provider receipt', providerStatus => {
    expect(OrderRefundOperationViewSchema.safeParse({ ...operation, providerStatus }).success).toBe(true);
  });
  it.each([
    { state: 'creating' }, { providerStatus: null }, { canResume: true }, { amountCents: 0 },
    { amountCents: 0.25 }, { amountCents: '250' }, { preparedAt: 'yesterday' }, { orderId: 'other' },
    { password: 'secret' }, { actorId: 'owner' }, { paymentIntentId: 'pi_private' }, { metadata: {} },
  ])('rejects inconsistent or overexposed operation %j', patch => {
    expect(OrderRefundOperationViewSchema.safeParse({ ...operation, ...patch }).success).toBe(false);
  });
  it('refuses cross-order and duplicate proofs', () => {
    expect(OrderRefundJournalSchema.safeParse({ orderId, enabled: true, summary,
      operations: [{ ...operation, orderId: '665f0d0a1c2b3d4e5f6a0001' }] }).success).toBe(false);
    expect(OrderRefundJournalSchema.safeParse({ orderId, enabled: true, summary, operations: [operation, operation] }).success).toBe(false);
  });
  it('never advertises a retry when activation is closed', () => {
    const pending = { ...operation, state: 'creating', providerStatus: null, canResume: true };
    expect(OrderRefundJournalSchema.safeParse({ orderId, enabled: false, summary, operations: [pending] }).success).toBe(false);
    expect(OrderRefundJournalSchema.safeParse({ orderId, enabled: true, summary, operations: [pending] }).success).toBe(true);
  });
});
