import { describe, expect, it, vi } from 'vitest';
import type { Order } from '@sm/client-core';
import { advanceDeliveryConfirmed, kitchenNextStatus, isKitchenEligible, reconcileKitchenRows } from './delivery-policy';

function order(over: Partial<Order> = {}): Order {
  return { _id: 'order', clientId: 'client', number: 1, type: 'delivery', channel: 'online',
    status: 'new', payment: { status: 'paid', method: 'online' }, totals: { subtotal: 2000, total: 2250, deliveryFee: 250 },
    lines: [], statusHistory: [], createdAt: '2026-09-05T12:00:00Z', ...over };
}

describe('livraison en cuisine', () => {
  it('écarte impayée et remboursée, conserve payée et retrait au comptoir', () => {
    expect(isKitchenEligible(order({ payment: { status: 'pending', method: 'online' } }))).toBe(false);
    expect(isKitchenEligible(order({ payment: { status: 'refunded', method: 'online' } }))).toBe(false);
    expect(isKitchenEligible(order())).toBe(true);
    expect(isKitchenEligible(order({ type: 'pickup', payment: { status: 'pending', method: 'counter' } }))).toBe(true);
  });
  it('la cuisine prépare mais ne remet jamais une livraison, même après le départ', () => {
    expect(kitchenNextStatus(order())).toBe('preparing');
    expect(kitchenNextStatus(order({ status: 'preparing' }))).toBe('ready');
    expect(kitchenNextStatus(order({ status: 'ready' }))).toBeNull();
    expect(kitchenNextStatus(order({ status: 'ready', delivery: { dispatchedAt: '2026-09-05T12:20:00Z' } as never }))).toBeNull();
  });
  it('la cuisine ne confirme pas non plus la remise des retraits', () => {
    expect(kitchenNextStatus(order({ type: 'pickup' }))).toBe('preparing');
    expect(kitchenNextStatus(order({ type: 'pickup', status: 'preparing' }))).toBe('ready');
    expect(kitchenNextStatus(order({ type: 'pickup', status: 'ready' }))).toBeNull();
    expect(kitchenNextStatus(order({ type: 'surplace', status: 'ready' }))).toBeNull();
  });
  it('une commande prête ne déclenche aucune écriture de remise', async () => {
    const send = vi.fn();
    const commit = vi.fn();
    await advanceDeliveryConfirmed(order({ status: 'ready' }), send, commit);
    expect(send).not.toHaveBeenCalled();
    expect(commit).not.toHaveBeenCalled();
  });
  it('répare un ancien état optimiste livraison à la relecture serveur', () => {
    const current = order({ status: 'preparing' });
    expect(reconcileKitchenRows([current], [order()])[0]?.status).toBe('new');
    expect(reconcileKitchenRows([current], [order({ payment: { method: 'online', status: 'pending' } })])).toEqual([]);
  });
  it('toute commande prête serveur reste visible en attente de prise en charge', () => {
    expect(reconcileKitchenRows([], [order({ status: 'ready' })])).toHaveLength(1);
    expect(reconcileKitchenRows([], [order({ type: 'pickup', status: 'ready' })])).toHaveLength(1);
  });
  it('retire du passe une table servie sans confondre service et paiement', () => {
    const dining = { sessionId: 'session-table', tableId: 'table-08', tableLabel: 'Terrasse 08', servedAt: '2026-09-12T12:15:00Z' };
    const served = order({ type: 'surplace', status: 'ready', dining, payment: { status: 'pending', method: 'counter' } });
    expect(isKitchenEligible(served)).toBe(false);
    expect(kitchenNextStatus(served)).toBeNull();
    expect(reconcileKitchenRows([], [served])).toEqual([]);
    expect(served.payment.status).toBe('pending');
    expect(served.status).toBe('ready');
    expect(isKitchenEligible({ ...served, dining: { ...dining, servedAt: null } })).toBe(true);
    expect(isKitchenEligible({ ...served, status: 'preparing' })).toBe(true);
    expect(isKitchenEligible({ ...served, type: 'pickup' })).toBe(true);
    expect(isKitchenEligible({ ...served, type: 'emporter' })).toBe(true);
  });
  it('le repère de service serveur gagne sur un doublon prêt non servi', () => {
    const ready = order({ type: 'surplace', status: 'ready' });
    const served = { ...ready, dining: { sessionId: 'session-table', tableId: 'table-08', tableLabel: '08', servedAt: '2026-09-12T12:15:00Z' } };
    expect(reconcileKitchenRows([ready], [ready, served])).toEqual([]);
    expect(reconcileKitchenRows([ready], [served, ready])).toEqual([]);
  });
  it('ne double pas une livraison qui avance entre deux lectures serveur', () => {
    const rows = reconcileKitchenRows([], [order(), order({ status: 'preparing' })]);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe('preparing');
  });
  it('une réponse remboursée écarte aussi le doublon payé périmé', () => {
    const refunded = order({ status: 'preparing', payment: { status: 'refunded', method: 'online' } });
    expect(reconcileKitchenRows([], [order(), refunded])).toEqual([]);
  });
  it('un refus serveur laisse l’état local intact et ne crée aucun optimisme', async () => {
    const commit = vi.fn();
    const send = vi.fn().mockRejectedValue(new Error('Paiement non confirmé'));
    await expect(advanceDeliveryConfirmed(order(), send, commit)).rejects.toThrow('Paiement non confirmé');
    expect(commit).not.toHaveBeenCalled();
  });
  it('ne valide qu’après la réponse et conserve l’état réellement renvoyé', async () => {
    let resolve!: (value: Order) => void;
    const response = new Promise<Order>((done) => { resolve = done; });
    const commit = vi.fn();
    const pending = advanceDeliveryConfirmed(order(), () => response, commit);
    expect(commit).not.toHaveBeenCalled();
    resolve(order({ status: 'cancelled' }));
    await pending;
    expect(commit).toHaveBeenCalledWith(expect.objectContaining({ status: 'cancelled' }));
  });
});
