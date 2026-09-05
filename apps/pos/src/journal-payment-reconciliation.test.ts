import { describe, expect, it, vi } from 'vitest';
import { SmApiError } from '@sm/client-core';
import type { DayEntry } from './pos-state';
import type { ServerOrderRow } from './service-state';
import { reconcileCollectedJournal } from './service-payment';
import { createJournalPaymentLookup, JOURNAL_LOOKUP_LIMIT, JOURNAL_LOOKUP_RETRY_MS } from './journal-payment-reconciliation';

const entry = (id = 'one'): DayEntry => ({ clientId: id, serverId: `server-${id}`, serverNumber: 42, localNumber: 1, trackingToken: 'already-known', mode: 'tel', method: 'retrait', paid: false, total: 1250, items: 1, at: Date.now() - 86_400_000 });
const paid = (id = 'one'): ServerOrderRow => ({ _id: `server-${id}`, clientId: id, number: 42, createdAt: new Date(Date.now() - 86_400_000).toISOString(), status: 'delivered', type: 'pickup', payment: { method: 'counter', status: 'paid', tender: 'cash', cashReceived: 2000, changeGiven: 750 }, totals: { total: 1250, subtotal: 1250 } });

describe('réparation ciblée des impayés du journal local', () => {
  it('retrouve exactement une vente remise hier malgré les 200 autres lignes récentes', async () => {
    const recent = Array.from({ length: 200 }, (_, n) => paid(`recent-${n}`));
    const confirmed = paid();
    const lookup = vi.fn().mockResolvedValue(confirmed);
    const found = await createJournalPaymentLookup().readMissing([entry()], recent, lookup, 1000);
    expect(lookup).toHaveBeenCalledExactlyOnceWith('one');
    expect(found).toEqual([confirmed]);
    expect(reconcileCollectedJournal([entry()], found[0])[0]).toMatchObject({ paid: true, method: 'especes', received: 2000, change: 750 });
  });

  it('ne lit ni les ventes payées, ni celles déjà présentes, ni des commandes web absentes du journal', async () => {
    const lookup = vi.fn();
    const found = await createJournalPaymentLookup().readMissing([{ ...entry('paid'), paid: true }, entry('observed')], [paid('observed'), paid('web-only')], lookup, 1000);
    expect(found).toEqual([]);
    expect(lookup).not.toHaveBeenCalled();
  });

  it('borne les requêtes à 5 par tour, espace les reprises et laisse passer les autres entrées', async () => {
    const scheduler = createJournalPaymentLookup();
    const entries = Array.from({ length: 12 }, (_, n) => entry(String(n)));
    const lookup = vi.fn().mockRejectedValue(new Error('Hors ligne'));
    expect(await scheduler.readMissing(entries, [], lookup, 1000)).toEqual([]);
    expect(lookup).toHaveBeenCalledTimes(JOURNAL_LOOKUP_LIMIT);
    await scheduler.readMissing(entries, [], lookup, 1000);
    expect(lookup.mock.calls.map(([id]) => id)).toEqual(entries.slice(0, 10).map((e) => e.clientId));
    await scheduler.readMissing(entries, [], lookup, 1000);
    expect(lookup).toHaveBeenCalledTimes(12);
    await scheduler.readMissing(entries, [], lookup, 1000 + JOURNAL_LOOKUP_RETRY_MS - 1);
    expect(lookup).toHaveBeenCalledTimes(12);
    await scheduler.readMissing(entries, [], lookup, 1000 + JOURNAL_LOOKUP_RETRY_MS);
    expect(lookup).toHaveBeenCalledTimes(17);
  });

  it('404, panne, mauvais clientId ou mauvais serverId ne changent jamais une dette en paiement', async () => {
    for (const result of [null, paid('someone-else'), { ...paid(), _id: 'wrong-server' }]) {
      const found = await createJournalPaymentLookup().readMissing([entry()], [], vi.fn().mockResolvedValue(result), 1000);
      expect(found).toEqual([]);
    }
    const lookup = vi.fn().mockRejectedValue(new SmApiError('Introuvable', 404));
    expect(await createJournalPaymentLookup().readMissing([entry()], [], lookup, 1000)).toEqual([]);
    expect(entry().paid).toBe(false);
  });

  it('ne masque pas une session expirée et ne dispose d’aucun port d’encaissement', async () => {
    const expired = new SmApiError('Session expirée', 401);
    await expect(createJournalPaymentLookup().readMissing([entry()], [], vi.fn().mockRejectedValue(expired), 1000)).rejects.toBe(expired);
  });
});
