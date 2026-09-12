import { describe, expect, it } from 'vitest';
import { appendDiningEntry, diningJournalEntry } from './dining-journal';
import { DiningAddOrderSchema } from '@sm/contracts';
import { observeDiningOperation, type DiningOperation } from './dining-operation';
import type { ServerOrderRow } from './service-state';
import { zFromJournal } from './pos-state';
import { reconcileCollectedJournal } from './service-payment';

const id = 'a0173871-811a-43ee-ae1c-504163424661';
const operation: Extract<DiningOperation, { action: 'order' }> = { action: 'order', ownerId: 'tenant:staff', sessionId: id, draftId: id, body: DiningAddOrderSchema.parse({ operationId: id, expectedRevision: 0,
  order: { clientId: id, channel: 'pos', type: 'surplace', payment: { method: 'counter', tender: null }, lines: [{ productId: '65f000000000000000000005', qty: 1, options: [], removed: [] }] } }) };
const row: ServerOrderRow = { _id: '65f000000000000000000007', clientId: id, number: 42, channel: 'pos', type: 'surplace', status: 'new',
  dining: { sessionId: id, tableId: id, tableLabel: 'Terrasse 2' }, createdAt: '2026-09-12T18:00:00.000Z',
  totals: { total: 1450 }, lines: [{ productId: '65f000000000000000000005', name: 'Kebab', qty: 1, options: [], removed: [], unitPrice: 1450, lineTotal: 1450 }], payment: { method: 'counter', status: 'pending' } };

describe('journal des commandes de table', () => {
  it('garde le brouillon original bloqué après reprise dans un autre onglet, sans bloquer le brouillon étranger', () => {
    expect(observeDiningOperation(operation, null, operation.draftId)).toEqual(operation);
    const other: DiningOperation = { action: 'open', ownerId: operation.ownerId, body: { operationId: '849aaf0b-d1d4-4656-b733-1aa1bd489173', tableId: id, guestCount: 1 } };
    expect(observeDiningOperation(operation, other, operation.draftId)).toEqual(operation);
    expect(observeDiningOperation(operation, null, 'foreign-draft')).toBeNull();
    expect(observeDiningOperation(operation, other, 'foreign-draft')).toEqual(other);
  });
  it('journalise le prix et le numéro du serveur, sans déclarer de paiement au premier envoi', () => {
    const entry = diningJournalEntry(operation, row);
    expect(entry).toMatchObject({ total: 1450, serverNumber: 42, serverId: row._id, paid: false, method: 'retrait', items: 1 });
  });
  it('refuse une réponse partielle, une autre table ou une autre commande', () => {
    for (const patch of [{ totals: undefined }, { totals: { total: -1 } }, { number: 0 }, { clientId: 'other' }, { dining: null }, { lines: [] }, { payment: { method: 'counter', status: 'paid', tender: null } }]) {
      expect(() => diningJournalEntry(operation, { ...row, ...patch } as ServerOrderRow)).toThrow();
    }
  });
  it('un rejeu après journal durable garde le règlement plus récent et une seule entrée', () => {
    const pending = diningJournalEntry(operation, row);
    const paid = diningJournalEntry(operation, { ...row, payment: { method: 'counter', status: 'paid', tender: 'cash', cashReceived: 2000, changeGiven: 550 } });
    expect(appendDiningEntry([paid], pending)).toEqual([paid]);
    expect(appendDiningEntry([], pending)).toEqual([pending]);
  });
  it('reprend la remise serveur dans la convention historique brut moins remise, avant et après encaissement', () => {
    const discounted = { ...row, totals: { total: 1250, discount: { amount: 200, reason: 'Remise' } } } as ServerOrderRow;
    const entry = diningJournalEntry(operation, discounted);
    expect(entry).toMatchObject({ total: 1450, discount: 200 });
    expect(zFromJournal([entry])).toMatchObject({ ca: 1250, due: 1250, discounts: 200 });
    const collected = reconcileCollectedJournal([entry], { ...discounted, payment: { method: 'counter', status: 'paid', tender: 'card' } });
    expect(zFromJournal(collected)).toMatchObject({ ca: 1250, due: 0, card: 1250, discounts: 200 });
  });
  it('signale une reprise déjà remboursée sans créer une dette ni doubler son encaissement historique', () => {
    const refunded = diningJournalEntry(operation, { ...row, status: 'delivered', payment: { method: 'counter', status: 'refunded', tender: 'card' } });
    expect(refunded).toMatchObject({ paid: true, refunded: true, method: 'cb' });
    expect(zFromJournal(appendDiningEntry([refunded], refunded))).toMatchObject({ orders: 1, ca: 1450, due: 0, card: 1450 });
    const prior = diningJournalEntry(operation, { ...row, payment: { method: 'counter', status: 'paid', tender: 'card' } });
    expect(appendDiningEntry([prior], refunded)).toEqual([prior]);
    expect(reconcileCollectedJournal([refunded], { ...row, payment: { method: 'counter', status: 'paid', tender: 'card' } })[0].refunded).toBe(true);
  });
  it('refuse une remise partielle ou un total reconstitué non représentable', () => {
    for (const amount of [-1, 1.5, Number.MAX_SAFE_INTEGER]) {
      expect(() => diningJournalEntry(operation, { ...row, totals: { total: 1450, discount: { amount } } } as ServerOrderRow)).toThrow();
    }
  });
});
