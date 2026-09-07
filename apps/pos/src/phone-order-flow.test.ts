import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type KeyValueStore } from '@sm/client-core';
import { createPhoneOrderFlow } from './phone-order-flow';
import { readPhoneOrderAttempt } from './phone-order-attempt';

const tenantId = '507f1f77bcf86cd799439011';
const draftId = '11111111-1111-4111-8111-111111111111';
const otherDraft = '22222222-2222-4222-8222-222222222222';
const body = { channel: 'phone', type: 'pickup', lines: [{ productId: '507f1f77bcf86cd799439099', qty: 1, options: [], removed: [] }],
  pickup: { slot: '2030-09-09T18:00:00.000Z', customerName: 'Recette', customerPhone: '0000000000' }, payment: { method: 'counter', tender: null } };
function fixture() {
  const values = new Map<string, string>();
  const store: KeyValueStore = { getItem: async (key) => values.get(key) ?? null,
    setItem: async (key, value) => { values.set(key, value); }, removeItem: async (key) => { values.delete(key); } };
  const order = (input: typeof body & { clientId: string }) => ({ ...input, _id: '507f1f77bcf86cd799439022', tenantId, number: 42,
    status: 'new', trackingToken: 'a'.repeat(32), totals: { total: 1500 },
    payment: { method: 'counter', tender: null, status: 'pending' } });
  const request = vi.fn(async (_path: string, input: unknown): Promise<unknown> => order(input as Parameters<typeof order>[0]));
  const flow = createPhoneOrderFlow({ store, tenantId, request, assertReady: () => undefined });
  return { values, store, request, flow, order };
}
beforeEach(() => {
  // Minimal external lock port. Browser recipe separately proves real Web Locks.
  const held = new Set<string>();
  vi.stubGlobal('navigator', { locks: { request: async (name: string, opts: { ifAvailable?: boolean }, callback: (lock: unknown) => unknown) => {
    if (held.has(name) && opts.ifAvailable) return callback(null);
    held.add(name); try { return await callback({ name }); } finally { held.delete(name); }
  } } });
});
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('réservation téléphone avant perception', () => {
  it('persiste le corps avant le POST direct et le reçu avant de terminer', async () => {
    const f = fixture();
    f.request.mockImplementation(async (_path, input) => {
      expect((await readPhoneOrderAttempt(f.store, tenantId))?.state).toBe('uncertain');
      expect((input as typeof body).payment).toEqual({ method: 'counter', tender: null });
      return f.order(input as Parameters<typeof f.order>[0]);
    });
    const result = await f.flow.submit(body, draftId);
    expect(result.state).toBe('received');
    expect(f.request).toHaveBeenCalledOnce();
    const repair = vi.fn(async () => { expect((await readPhoneOrderAttempt(f.store, tenantId))?.state).toBe('received'); });
    await f.flow.finish(repair);
    expect(repair).toHaveBeenCalledOnce();
    expect(await readPhoneOrderAttempt(f.store, tenantId)).toBeNull();
  });

  it('aucun POST quand le stockage ou les vrais verrous sont indisponibles', async () => {
    const f = fixture();
    f.store.setItem = async () => { throw new Error('Quota'); };
    await expect(f.flow.submit(body, draftId)).rejects.toThrow('Quota');
    vi.stubGlobal('navigator', {});
    await expect(f.flow.submit(body, draftId)).rejects.toThrow('navigateur');
    expect(f.request).not.toHaveBeenCalled();
  });

  it('réponse perdue puis autre onglet : garde UUID/corps et ne remplace jamais son brouillon', async () => {
    const f = fixture();
    f.request.mockRejectedValueOnce(new Error('Réponse perdue'));
    await expect(f.flow.submit(body, draftId)).rejects.toThrow();
    const first = await readPhoneOrderAttempt(f.store, tenantId);
    const second = await f.flow.submit({ ...body, lines: [{ ...body.lines[0]!, qty: 2 }] }, otherDraft);
    expect(second).toEqual(first);
    expect(f.request).toHaveBeenCalledOnce();
    f.request.mockImplementation(async (path, input) => path.endsWith('/recovery')
      ? { tenantId, clientId: first!.clientId, channel: 'phone', state: 'pending' } : f.order(input as Parameters<typeof f.order>[0]));
    expect((await f.flow.resume()).state).toBe('received');
    expect(f.request.mock.calls.at(-1)?.[1]).toEqual(first!.body);
  });

  it('un 404 de reprise ne libère jamais la tentative ni ne relance une création', async () => {
    const f = fixture();
    f.request.mockRejectedValue(new Error('404'));
    await expect(f.flow.submit(body, draftId)).rejects.toThrow();
    const first = await readPhoneOrderAttempt(f.store, tenantId);
    await expect(f.flow.resume()).rejects.toThrow();
    expect(await readPhoneOrderAttempt(f.store, tenantId)).toEqual(first);
    expect(f.request.mock.calls.map(([path]) => path)).toEqual(['/orders', '/orders/recovery']);
  });

  it('ne perd jamais un reçu après une panne de réparation du journal local', async () => {
    const f = fixture(); await f.flow.submit(body, draftId);
    await expect(f.flow.finish(async () => { throw new Error('Journal plein'); })).rejects.toThrow('Journal plein');
    expect((await readPhoneOrderAttempt(f.store, tenantId))?.state).toBe('received');
    await f.flow.finish(async () => undefined);
    expect(f.request).toHaveBeenCalledOnce();
  });

  it('la clôture serveur prime, et seule une action explicite libère son rejet', async () => {
    const f = fixture(); f.request.mockRejectedValueOnce(new Error('Réseau'));
    await expect(f.flow.submit(body, draftId)).rejects.toThrow();
    const first = await readPhoneOrderAttempt(f.store, tenantId);
    f.request.mockResolvedValue({ tenantId, clientId: first!.clientId, channel: 'phone', state: 'rejected', code: 'ORDER_ATTEMPT_REJECTED', reason: 'abandoned', message: 'Clôturée' });
    expect((await f.flow.abandon()).state).toBe('rejected');
    expect((await readPhoneOrderAttempt(f.store, tenantId))?.state).toBe('rejected');
    await f.flow.releaseRejected();
    expect(await readPhoneOrderAttempt(f.store, tenantId)).toBeNull();
  });

  it('un silence réseau finit sans annuler ni remplacer son UUID', async () => {
    vi.useFakeTimers(); const f = fixture();
    f.request.mockImplementation(() => new Promise(() => undefined));
    const pending = f.flow.submit(body, draftId);
    const failed = expect(pending).rejects.toThrow('même référence');
    await vi.advanceTimersByTimeAsync(15_001); await failed;
    expect((await readPhoneOrderAttempt(f.store, tenantId))?.state).toBe('uncertain');
  });
});
