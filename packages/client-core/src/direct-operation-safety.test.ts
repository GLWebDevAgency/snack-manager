import { afterEach, describe, expect, it, vi } from 'vitest';
import { purgeKeysWithIdentityLast, requireCrossContextStoreLock, restoreScopedIdentity,
  setStore, withStoreLock, type KeyValueStore } from './storage';
import { SyncQueue } from './sync-queue';

afterEach(() => vi.unstubAllGlobals());

describe('opérations directes protégées avant purge', () => {
  it('refuse le repli mono-processus quand une exclusion inter-onglets est requise', () => {
    vi.stubGlobal('navigator', {});
    expect(() => requireCrossContextStoreLock()).toThrow('navigateur');
  });

  it('accepte seulement le vrai port de verrou navigateur', () => {
    vi.stubGlobal('navigator', { locks: { request: vi.fn() } });
    expect(() => requireCrossContextStoreLock()).not.toThrow();
  });

  it('refuse la purge avant toute écriture et permet la réparation de la tentative', async () => {
    const data = new Map<string, string>();
    const store: KeyValueStore = { getItem: async (key) => data.get(key) ?? null,
      setItem: async (key, value) => { data.set(key, value); }, removeItem: async (key) => { data.delete(key); } };
    setStore(store);
    const queue = new SyncQueue(vi.fn(), { requireScope: true });
    await queue.bindScope('pairing-a', { freshPairing: true });
    await queue.scopedStore().setItem('direct-attempt', 'uncertain');
    const before = [...data];
    const beforeClear = async (raw: KeyValueStore) => {
      if (await raw.getItem('direct-attempt')) throw new Error('Tentative à vérifier');
    };
    await expect(queue.clear({ requireEmpty: true, beforeClear })).rejects.toThrow('Tentative à vérifier');
    expect([...data]).toEqual(before);
    await queue.scopedStore().removeItem('direct-attempt');
    await expect(queue.clear({ requireEmpty: true, beforeClear })).resolves.toBeUndefined();
  });

  it('la précondition relit après la mutation concurrente, sous le même verrou', async () => {
    const data = new Map<string, string>();
    const store: KeyValueStore = { getItem: async (key) => data.get(key) ?? null,
      setItem: async (key, value) => { data.set(key, value); }, removeItem: async (key) => { data.delete(key); } };
    setStore(store);
    const queue = new SyncQueue(vi.fn(), { requireScope: true });
    await queue.bindScope('pairing-a', { freshPairing: true });
    let release!: () => void;
    let entered!: () => void;
    const started = new Promise<void>((resolve) => { entered = resolve; });
    const writer = withStoreLock(async () => {
      entered(); await new Promise<void>((resolve) => { release = resolve; });
      await store.setItem('direct-attempt', 'uncertain');
    });
    await started;
    const clearing = queue.clear({ requireEmpty: true, beforeClear: async (raw) => {
      if (await raw.getItem('direct-attempt')) throw new Error('Tentative à vérifier');
    } });
    const rejected = expect(clearing).rejects.toThrow('Tentative à vérifier');
    release(); await writer; await rejected;
    expect(data.get('direct-attempt')).toBe('uncertain');
  });

  it.each([null, '{illisible'])('une identité absente ou cassée (%s) ne purge pas une tentative directe', async (identity) => {
    const data = new Map<string, string>([['direct-attempt', 'uncertain'], ['menu', 'cache']]);
    if (identity !== null) data.set('device', identity);
    const store: KeyValueStore = { getItem: async (key) => data.get(key) ?? null,
      setItem: async (key, value) => { data.set(key, value); }, removeItem: vi.fn(async (key) => { data.delete(key); }) };
    const guard = vi.fn(async (raw: KeyValueStore) => {
      expect(raw).toBe(store);
      if (await raw.getItem('direct-attempt')) throw new Error('Tentative à vérifier');
    });
    const before = [...data];
    await expect(restoreScopedIdentity(store, ['device', 'direct-attempt', 'menu'], 'device',
      (raw) => JSON.parse(raw), guard)).rejects.toThrow('Tentative à vérifier');
    expect(guard).toHaveBeenCalledOnce();
    expect(store.removeItem).not.toHaveBeenCalled();
    expect([...data]).toEqual(before);
    await expect(purgeKeysWithIdentityLast(store, ['device', 'direct-attempt', 'menu'], 'device', guard))
      .rejects.toThrow('Tentative à vérifier');
    expect(store.removeItem).not.toHaveBeenCalled();
    expect([...data]).toEqual(before);
  });
});
