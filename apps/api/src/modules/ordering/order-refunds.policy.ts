import { BadRequestException } from '@nestjs/common';
import type { OrderRefundSummary } from '@sm/contracts';

export type ProviderRefund = {
  id: string;
  amount: number;
  status: string | null;
  metadata?: Record<string, string> | null;
};

export function refundSummary(totalCents: number, rows: readonly ProviderRefund[]): OrderRefundSummary {
  let refundedCents = 0;
  let pendingRefundCents = 0;
  const seen = new Set<string>();
  const refunds: OrderRefundSummary['refunds'] = [];
  for (const row of rows) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    if (!Number.isSafeInteger(row.amount) || row.amount <= 0) {
      throw new BadRequestException('Montant de remboursement Stripe invalide.');
    }
    const status = row.status ?? 'pending';
    if (status === 'succeeded') refundedCents += row.amount;
    else if (status !== 'failed' && status !== 'canceled') pendingRefundCents += row.amount;
    refunds.push({ id: row.id, amountCents: row.amount, status });
  }
  return {
    refundedCents, pendingRefundCents,
    remainingCents: Math.max(0, totalCents - refundedCents - pendingRefundCents),
    status: pendingRefundCents > 0 ? 'pending' : refundedCents >= totalCents && totalCents > 0
      ? 'refunded' : refundedCents > 0 ? 'partial' : 'none',
    refunds,
  };
}
