import { describe, expect, it } from 'vitest';
import { refundSummary } from './order-refunds.policy';

describe('refund amounts and provider states', () => {
  it('records cents for a partial refund without declaring the order fully refunded', () => {
    expect(refundSummary(1250, [{ id: 're_1', amount: 250, status: 'succeeded' }]))
      .toMatchObject({ refundedCents: 250, remainingCents: 1000, status: 'partial' });
  });
  it('counts each provider refund once despite duplicated delivery', () => {
    const row = { id: 're_1', amount: 1250, status: 'succeeded' };
    expect(refundSummary(1250, [row, row])).toMatchObject({ refundedCents: 1250, status: 'refunded' });
  });
  it('reserves pending refunds but never calls them paid back', () => {
    expect(refundSummary(1250, [{ id: 're_1', amount: 1250, status: 'pending' }]))
      .toMatchObject({ refundedCents: 0, pendingRefundCents: 1250, remainingCents: 0, status: 'pending' });
  });
  it('releases a failed or canceled refund when the provider state is reconciled', () => {
    expect(refundSummary(1250, [{ id: 're_1', amount: 1250, status: 'failed' }]))
      .toMatchObject({ refundedCents: 0, remainingCents: 1250, status: 'none' });
  });
  it('rejects fractional cents', () => {
    expect(() => refundSummary(1250, [{ id: 're_1', amount: 1.5, status: 'succeeded' }])).toThrow();
  });
});
