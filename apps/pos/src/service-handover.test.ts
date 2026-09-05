import { describe, expect, it, vi } from 'vitest';
import type { ServerOrderRow } from './service-state';
import { applyConfirmedHandover, canConfirmCounterHandover, confirmCounterHandover, isCounterHandoverRole } from './service-handover';
import { deriveServiceProjection } from './service-reconciliation';

function ready(over: Partial<ServerOrderRow> = {}): ServerOrderRow {
  return { _id: 'order', clientId: 'client', number: 42, type: 'pickup', status: 'ready', payment: { status: 'paid' }, ...over };
}

describe('remise à la caisse confirmée par le serveur', () => {
  it('ne propose pas de remise avec un rôle cuisine ou inconnu', () => {
    expect(isCounterHandoverRole('cuisine')).toBe(false);
    expect(isCounterHandoverRole('inconnu')).toBe(false);
    for (const role of ['owner', 'gerant', 'cogerant', 'caisse']) expect(isCounterHandoverRole(role)).toBe(true);
  });
  it('autorise uniquement une commande prête, payée et remise sur place', () => {
    for (const type of ['pickup', 'surplace', 'emporter'] as const) {
      expect(canConfirmCounterHandover(ready({ type }))).toBe(true);
    }
    expect(canConfirmCounterHandover(ready({ type: 'delivery' }))).toBe(false);
    expect(canConfirmCounterHandover(ready({ type: undefined }))).toBe(false);
    expect(canConfirmCounterHandover(ready({ status: 'preparing' }))).toBe(false);
    expect(canConfirmCounterHandover(ready({ payment: { status: 'pending' } }))).toBe(false);
    expect(canConfirmCounterHandover(ready({ payment: { status: 'refunded' } }))).toBe(false);
  });

  it('n’appelle pas l’API pour une commande impayée et n’encaisse rien implicitement', async () => {
    const send = vi.fn();
    await expect(confirmCounterHandover(ready({ payment: { status: 'pending' } }), send)).rejects.toThrow('prête et payée');
    expect(send).not.toHaveBeenCalled();
  });

  it('attend la réponse serveur, avec seulement la transition de remise', async () => {
    let resolve!: (row: ServerOrderRow) => void;
    const response = new Promise<ServerOrderRow>((done) => { resolve = done; });
    const send = vi.fn(() => response);
    const committed = vi.fn();
    const result = confirmCounterHandover(ready(), send).then(committed);
    await Promise.resolve();
    expect(committed).not.toHaveBeenCalled();
    expect(send).toHaveBeenCalledWith('order', 'delivered');
    resolve(ready({ status: 'delivered' }));
    await result;
    expect(committed).toHaveBeenCalledWith(expect.objectContaining({ status: 'delivered' }));
  });

  it('un refus reste explicite et ne crée pas de fausse remise', async () => {
    const send = vi.fn().mockRejectedValue(new Error('Session expirée'));
    await expect(confirmCounterHandover(ready(), send)).rejects.toThrow('Session expirée');
    const wrongStatus = vi.fn().mockResolvedValue(ready());
    await expect(confirmCounterHandover(ready(), wrongStatus)).rejects.toThrow('pas confirmé');
  });

  it('retire seulement la remise confirmée et actualise les compteurs sans inventer une lecture fraîche', () => {
    const empty = { rows: [], total: 0, truncated: false };
    const projection = deriveServiceProjection(empty, { new: empty, preparing: empty, ready: { rows: [ready()], total: 1, truncated: false } });
    expect(applyConfirmedHandover(projection, ready())).toBe(projection);
    const confirmed = applyConfirmedHandover(projection, ready({ status: 'delivered' }));
    expect(confirmed.rows).toEqual([]);
    expect(confirmed.activeCount).toBe(0);
    expect(confirmed.readyCount).toBe(0);
    expect(confirmed.statusCounts.ready.value).toBe(0);
  });
});
