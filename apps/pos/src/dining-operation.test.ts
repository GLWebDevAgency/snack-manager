import { describe, expect, it, vi } from 'vitest';
import { SmApiError, type KeyValueStore } from '@sm/client-core';
import { KEYS, minimizeParkedTicket, type ParkedTicket } from './pos-state';
import { assertDiningPurgeSafe, clearDiningOperation, diningOperationPath, diningOperationRejected, diningOwner,
  parseDiningOperation, prepareDiningOperation, readDiningOperation, withDiningDeadline, type DiningOperation } from './dining-operation';

const id = 'a0173871-811a-43ee-ae1c-504163424661';
const tableId = '849aaf0b-d1d4-4656-b733-1aa1bd489173';
const op: DiningOperation = { action: 'open', ownerId: 'tenant:staff', body: { operationId: id, tableId, guestCount: 2 } };
function store(): KeyValueStore {
  const values = new Map<string, string>();
  return { getItem: async (key) => values.get(key) ?? null, setItem: async (key, value) => { values.set(key, value); }, removeItem: async (key) => { values.delete(key); } };
}

describe('intentions durables de salle', () => {
  it('persiste les paramètres exacts et interdit un deuxième geste avant confirmation', async () => {
    const s = store(); await prepareDiningOperation(s, op);
    expect(await readDiningOperation(s)).toEqual(op);
    expect(await prepareDiningOperation(s, op)).toEqual(op);
    await expect(prepareDiningOperation(s, { ...op, body: { ...op.body, guestCount: 3 } })).rejects.toThrow('reste à vérifier');
    await expect(prepareDiningOperation(s, { ...op, ownerId: 'tenant:other' })).rejects.toThrow('reste à vérifier');
    expect(await readDiningOperation(s)).toEqual(op);
  });
  it('deux onglets concurrents ne remplacent jamais la première intention', async () => {
    const s = store(); const results = await Promise.allSettled([prepareDiningOperation(s, op), prepareDiningOperation(s, { ...op, body: { ...op.body, operationId: tableId } })]);
    expect(results.map((result) => result.status)).toEqual(['fulfilled', 'rejected']);
    expect(await readDiningOperation(s)).toEqual(op);
  });
  it('ne purge ni identité ni intention tant que la même référence reste non confirmée', async () => {
    const s = store(); await prepareDiningOperation(s, op);
    await expect(assertDiningPurgeSafe(s)).rejects.toThrow('désappairé');
    await clearDiningOperation(s, tableId); expect(await readDiningOperation(s)).toEqual(op);
    await clearDiningOperation(s, id); expect(await readDiningOperation(s)).toBeNull();
    await expect(assertDiningPurgeSafe(s)).resolves.toBeUndefined();
  });
  it('échoue fermé sur quota ou journal corrompu sans supprimer le brut', async () => {
    const s = store(); s.setItem = async () => { throw new Error('Quota'); };
    await expect(prepareDiningOperation(s, op)).rejects.toThrow('Quota');
    const broken = store(); await broken.setItem(KEYS.diningOperation, '{broken');
    await expect(prepareDiningOperation(broken, op)).rejects.toThrow('illisible');
    await expect(assertDiningPurgeSafe(broken)).rejects.toThrow('illisible');
    expect(await broken.getItem(KEYS.diningOperation)).toBe('{broken');
  });
  it('seul un rejet enregistré pour le même UUID est une preuve de refus définitif', () => {
    expect(diningOperationRejected(new SmApiError('Rejet', 409, { code: 'DINING_OPERATION_REJECTED', operationId: id }), id)).toBe(true);
    for (const error of [new Error('Réseau'), new SmApiError('Droits', 403), new SmApiError('Conflit', 409, { code: 'DINING_CONFLICT', operationId: id }),
      new SmApiError('Autre', 409, { code: 'DINING_OPERATION_REJECTED', operationId: tableId }), new SmApiError('Sans identité', 409, { code: 'DINING_OPERATION_REJECTED' })]) {
      expect(diningOperationRejected(error, id)).toBe(false);
    }
  });
  it('borne le silence réseau et conserve la référence même si le serveur répond ensuite', async () => {
    vi.useFakeTimers();
    try {
      const s = store(); await prepareDiningOperation(s, op);
      let finish!: (value: string) => void;
      const work = new Promise<string>((resolve) => { finish = resolve; });
      const result = withDiningDeadline(work); const rejection = expect(result).rejects.toThrow('sans la recréer');
      await vi.advanceTimersByTimeAsync(15_000); await rejection; finish('confirmed');
      expect(await readDiningOperation(s)).toEqual(op); expect(vi.getTimerCount()).toBe(0);
    } finally { vi.useRealTimers(); }
  });
  it('valide route, identité et corps sans accepter une action inconnue', () => {
    expect(diningOperationPath(op)).toBe('/dining/sessions');
    const close: DiningOperation = { action: 'close', ownerId: op.ownerId, sessionId: id, body: { operationId: tableId, expectedRevision: 3 } };
    expect(diningOperationPath(close)).toBe(`/dining/sessions/${id}/close`);
    expect(parseDiningOperation(JSON.stringify({ version: 1, operation: close }))).toEqual(close);
    for (const operation of [{ ...close, sessionId: '../orders' }, { ...close, action: 'delete' }, { ...op, ownerId: undefined }]) {
      expect(() => parseDiningOperation(JSON.stringify({ version: 1, operation }))).toThrow('illisible');
    }
  });
  it('conserve un repère auteur stable au renouvellement de session, distinct des autres équipiers', () => {
    const token = (sub: string, exp: number) => `header.${btoa(JSON.stringify({ sub, tenantId: 'tenant', exp }))}.signature`;
    expect(diningOwner(token('staff', 1))).toBe(diningOwner(token('staff', 2)));
    expect(diningOwner(token('other', 2))).not.toBe(diningOwner(token('staff', 2)));
    expect(diningOwner('broken')).toBeNull();
  });
  it('un ticket parqué reste attaché à sa tablée, jamais à un mode téléphone ou identifiant corrompu', () => {
    const ticket: ParkedTicket = { code: 'A1', lines: [], mode: 'surplace', customerName: '', customerPhone: '', slot: null, note: '', at: 1, diningSessionId: id };
    expect(minimizeParkedTicket(ticket).diningSessionId).toBe(id);
    expect(minimizeParkedTicket({ ...ticket, mode: 'tel' }).diningSessionId).toBeUndefined();
    expect(minimizeParkedTicket({ ...ticket, diningSessionId: 'invalid' }).diningSessionId).toBeUndefined();
  });
});
