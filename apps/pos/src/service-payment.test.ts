import { describe, expect, it, vi } from 'vitest';
import type { CollectOrderPayment } from '@sm/contracts';
import { SmApiError, type KeyValueStore } from '@sm/client-core';
import { KEYS, zFromJournal, type DayEntry } from './pos-state';
import type { ServerOrderRow } from './service-state';
import {
  canCollectOrder, collectionRecovery, prepareCollection, clearPaidCollection,
  collectExistingOrder, reconcileCollectedJournal, serviceAgeLabel,
  discardRejectedCollection, isCollectionRejected, isCollectedElsewhere, pendingCollectionIds,
  withCollectionDeadline, COLLECTION_DEADLINE_MS,
} from './service-payment';

const operation: CollectOrderPayment = { operationId: 'a0173871-811a-43ee-ae1c-504163424661', tender: 'cash', expectedTotalCents: 1250, cashReceivedCents: 2000 };
const other: CollectOrderPayment = { operationId: '849aaf0b-d1d4-4656-b733-1aa1bd489173', tender: 'card', expectedTotalCents: 1250 };
const order = (patch: Partial<ServerOrderRow> = {}): ServerOrderRow => ({ _id: 'order-42', number: 42, clientId: 'client-42', type: 'pickup', status: 'ready', payment: { method: 'counter', status: 'pending' }, totals: { subtotal: 1250, total: 1250 }, ...patch });
const paid = (): ServerOrderRow => order({ payment: { method: 'counter', status: 'paid', tender: 'cash', cashReceived: 2000, changeGiven: 750 } });
function store(): KeyValueStore {
  const entries = new Map<string, string>();
  return { getItem: async (key) => entries.get(key) ?? null, setItem: async (key, value) => { entries.set(key, value); }, removeItem: async (key) => { entries.delete(key); } };
}

describe('encaissement de la commande existante', () => {
  it('borne un silence réseau sans annuler la requête ni supprimer sa référence durable', async () => {
    vi.useFakeTimers();
    try {
      const storage = store();
      await prepareCollection(storage, 'order-42', operation);
      let complete!: (row: ServerOrderRow) => void;
      const late = new Promise<ServerOrderRow>((resolve) => { complete = resolve; });
      const result = withCollectionDeadline(late);
      const rejected = expect(result).rejects.toThrow('sans percevoir un second règlement');
      await vi.advanceTimersByTimeAsync(COLLECTION_DEADLINE_MS);
      await rejected;
      complete(paid());
      expect(await collectionRecovery(storage, 'order-42')).toEqual(operation);
      expect(await withCollectionDeadline(Promise.resolve('ok'))).toBe('ok');
      expect(vi.getTimerCount()).toBe(0);
    } finally { vi.useRealTimers(); }
  });
  it('autorise seulement un montant serveur valide, au comptoir, actif et en attente', () => {
    for (const type of ['pickup', 'surplace', 'emporter'] as const) {
      for (const status of ['new', 'preparing', 'ready']) expect(canCollectOrder(order({ type, status }))).toBe(true);
    }
    for (const patch of [
      { type: 'delivery' }, { type: undefined }, { status: 'delivered' }, { status: 'cancelled' },
      { payment: undefined }, { payment: { status: 'paid', method: 'counter' } },
      { payment: { status: 'pending', method: 'online' } }, { payment: { status: 'processing', method: 'counter' } },
      { totals: undefined }, { totals: { total: -1 } }, { totals: { total: 12.5 } },
    ] as Partial<ServerOrderRow>[]) expect(canCollectOrder(order(patch))).toBe(false);
  });

  it('persiste avant la requête et réutilise UUID et paramètres après rechargement / réponse perdue', async () => {
    const storage = store();
    await prepareCollection(storage, 'order-42', operation);
    expect(await collectionRecovery(storage, 'order-42')).toEqual(operation);
    expect(await prepareCollection(storage, 'order-42', other)).toEqual(operation);
    const request = vi.fn().mockRejectedValue(new Error('Connexion interrompue'));
    await expect(collectExistingOrder(order(), operation, request)).rejects.toThrow('interrompue');
    expect(await collectionRecovery(storage, 'order-42')).toEqual(operation);
    expect(request).toHaveBeenCalledExactlyOnceWith('order-42', operation);
  });

  it('deux onglets choisissent une seule référence durable sans écraser le premier moyen', async () => {
    const storage = store();
    const results = await Promise.all([prepareCollection(storage, 'order-42', operation), prepareCollection(storage, 'order-42', other)]);
    expect(results).toEqual([operation, operation]);
  });

  it('stockage indisponible ou corrompu : pas de référence neuve ni de perte silencieuse', async () => {
    const storage = store();
    storage.setItem = async () => { throw new Error('Quota'); };
    await expect(prepareCollection(storage, 'order-42', operation)).rejects.toThrow('Quota');
    const corrupted = store();
    await corrupted.setItem(KEYS.collectionRecovery, '{broken');
    await expect(prepareCollection(corrupted, 'order-42', operation)).rejects.toThrow('récupération');
    expect(await corrupted.getItem(KEYS.collectionRecovery)).toBe('{broken');
  });

  it('ne retire la référence que pour la même commande effectivement payée', async () => {
    const storage = store();
    await prepareCollection(storage, 'order-42', operation);
    await clearPaidCollection(storage, order());
    expect(await collectionRecovery(storage, 'order-42')).toEqual(operation);
    await clearPaidCollection(storage, paid(), other.operationId);
    expect(await collectionRecovery(storage, 'order-42')).toEqual(operation);
    await clearPaidCollection(storage, paid());
    expect(await collectionRecovery(storage, 'order-42')).toBeNull();
  });

  it('reprend aussi un snapshot paid avec son UUID pour terminer un audit après réponse perdue', async () => {
    const storage = store();
    await prepareCollection(storage, 'order-42', operation);
    expect(await pendingCollectionIds(storage)).toEqual(['order-42']);
    const request = vi.fn().mockResolvedValue(paid());
    await expect(collectExistingOrder(paid(), operation, request, { resume: true })).resolves.toMatchObject({ payment: { status: 'paid' } });
    expect(request).toHaveBeenCalledExactlyOnceWith('order-42', operation);
    expect(await collectionRecovery(storage, 'order-42')).toEqual(operation);
  });

  it('un replay après remboursement clôture la référence sans réécrire paid ni remettre la commande', async () => {
    const storage = store();
    await prepareCollection(storage, 'order-42', operation);
    const refunded = order({ status: 'cancelled', payment: { method: 'counter', status: 'refunded', tender: 'cash' } });
    const result = await collectExistingOrder(refunded, operation, vi.fn().mockResolvedValue(refunded), { resume: true });
    expect(result.payment?.status).toBe('refunded');
    await clearPaidCollection(storage, result, operation.operationId);
    expect(await pendingCollectionIds(storage)).toEqual([]);
  });

  it('seul un rejet définitif structuré ou une autre opération prouvée permet de clôturer la tentative', async () => {
    expect(isCollectionRejected(new SmApiError('Refus', 409, { code: 'ORDER_COLLECTION_REJECTED' }))).toBe(true);
    for (const cause of [new Error('Refus'), new SmApiError('Conflit', 409), new SmApiError('Conflit', 409, { code: 'ORDER_COLLECTION_OPERATION_CONFLICT' }), new SmApiError('À réconcilier', 503, { code: 'ORDER_COLLECTION_RECONCILIATION_REQUIRED' })]) {
      expect(isCollectionRejected(cause)).toBe(false);
      expect(isCollectedElsewhere(cause)).toBe(false);
    }
    expect(isCollectedElsewhere(new SmApiError('Autre opération', 409, { code: 'ORDER_COLLECTION_ALREADY_COLLECTED' }))).toBe(true);
    const storage = store();
    await prepareCollection(storage, 'order-42', operation);
    await discardRejectedCollection(storage, 'order-42', other.operationId);
    expect(await collectionRecovery(storage, 'order-42')).toEqual(operation);
    await discardRejectedCollection(storage, 'order-42', operation.operationId);
    expect(await collectionRecovery(storage, 'order-42')).toBeNull();
  });

  it('refuse de lancer une nouvelle perception sur total modifié, livraison ou commande déjà payée', async () => {
    const request = vi.fn();
    for (const current of [paid(), order({ type: 'delivery' }), order({ totals: { total: 1300 } })]) {
      await expect(collectExistingOrder(current, operation, request)).rejects.toThrow();
    }
    expect(request).not.toHaveBeenCalled();
  });

  it('attend une réponse réellement payée et de même identité sans confirmer de remise', async () => {
    const request = vi.fn().mockResolvedValue(paid());
    const result = await collectExistingOrder(order(), operation, request);
    expect(result.status).toBe('ready');
    expect(result.payment?.status).toBe('paid');
    for (const response of [null, order(), { ...paid(), _id: 'autre' }]) {
      await expect(collectExistingOrder(order(), operation, vi.fn().mockResolvedValue(response))).rejects.toThrow('confirmation');
    }
  });

  it('met à jour une vente locale sans ajouter les ventes web ni compter deux fois son CA', () => {
    const entry: DayEntry = { clientId: 'client-42', localNumber: 1, serverId: 'order-42', serverNumber: 42, mode: 'tel', method: 'retrait', paid: false, total: 1250, items: 1, at: Date.now() };
    const updated = reconcileCollectedJournal([entry], paid());
    expect(updated).toHaveLength(1);
    expect(updated[0]).toMatchObject({ paid: true, method: 'especes', received: 2000, change: 750 });
    expect(zFromJournal(updated).ca).toBe(1250);
    expect(zFromJournal(updated).ca).toBe(zFromJournal([entry]).ca);
    expect(zFromJournal(updated)).toMatchObject({ orders: 1, cash: 1250, due: 0 });
    expect(reconcileCollectedJournal([], paid())).toEqual([]);
    expect(reconcileCollectedJournal([entry], order())).toEqual([entry]);
  });

  it('affiche les attentes longues en heures et jours sans minuteur de milliers de minutes', () => {
    expect(serviceAgeLabel(68)).toBe('01:08');
    expect(serviceAgeLabel(3601)).toBe('1 h 00 min');
    expect(serviceAgeLabel(25954 * 60 + 8)).toBe('18 j 00 h');
  });
});
