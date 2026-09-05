import { SmApiError } from '@sm/client-core';
import type { DayEntry } from './pos-state';
import type { ServerOrderRow } from './service-state';

export const JOURNAL_LOOKUP_LIMIT = 5;
export const JOURNAL_LOOKUP_RETRY_MS = 60_000;

/**
 * The recent/active windows are not a payment ledger. Repair only local debts
 * missing from those windows, with exact reads and a bounded, fair retry budget.
 * No history scan, order creation or payment mutation is available here.
 */
export function createJournalPaymentLookup() {
  const attemptedAt = new Map<string, number>();
  return {
    async readMissing(
      entries: readonly DayEntry[],
      observed: readonly ServerOrderRow[],
      lookup: (clientId: string) => Promise<ServerOrderRow | null>,
      now = Date.now(),
    ): Promise<ServerOrderRow[]> {
      const observedIds = new Set(observed.map((row) => row.clientId));
      const missing = new Map(entries
        .filter((entry) => !entry.paid && !!entry.clientId && !observedIds.has(entry.clientId))
        .map((entry) => [entry.clientId, entry]));
      // Drop obsolete scheduling state after payment or a journal reset.
      for (const id of attemptedAt.keys()) if (!missing.has(id)) attemptedAt.delete(id);
      const candidates = [...missing.values()]
        .filter((entry) => !attemptedAt.has(entry.clientId) || now - attemptedAt.get(entry.clientId)! >= JOURNAL_LOOKUP_RETRY_MS)
        .sort((left, right) => (attemptedAt.get(left.clientId) ?? 0) - (attemptedAt.get(right.clientId) ?? 0))
        .slice(0, JOURNAL_LOOKUP_LIMIT);
      const results = await Promise.all(candidates.map(async (entry) => {
        attemptedAt.set(entry.clientId, now);
        try {
          const row = await lookup(entry.clientId);
          if (!row || row.clientId !== entry.clientId || (entry.serverId && row._id !== entry.serverId)) return null;
          return row;
        } catch (error) {
          // Absence/error is not proof of an unpaid or paid order. Retry later.
          if (error instanceof SmApiError && error.status === 401) throw error;
          return null;
        }
      }));
      return results.filter((row): row is ServerOrderRow => row !== null);
    },
  };
}
