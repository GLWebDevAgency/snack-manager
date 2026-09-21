import { CounterRefundJournalSchema } from '@sm/contracts';
import { dayEntryRefundedCents, type DayEntry } from './pos-state';

/** A server receipt repairs only an existing local sale; never imports a web sale. */
export function reconcileCounterRefundSummary(entries: readonly DayEntry[], received: unknown): DayEntry[] {
  const view = CounterRefundJournalSchema.parse(received);
  if (!view.available) return [...entries];
  return entries.map(entry => {
    if (entry.serverId !== view.orderId || !entry.paid
      || entry.total - (entry.discount ?? 0) !== view.originalPaidCents) return entry;
    const refundedCents = Math.max(dayEntryRefundedCents(entry), view.refundedCents);
    return { ...entry, refundedCents,
      ...(view.originalPaidCents > 0 && refundedCents === view.originalPaidCents ? { refunded: true as const } : {}) };
  });
}
