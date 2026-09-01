import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SmClient, TransportUnreachable, type Transport } from './api';
import { setStore, type KeyValueStore } from './storage';

function store(overrides: Partial<KeyValueStore> = {}): KeyValueStore {
  return {
    getItem: async () => null,
    setItem: async () => undefined,
    removeItem: async () => undefined,
    ...overrides,
  };
}

function client(transport: Transport, onCacheError = vi.fn()) {
  return {
    api: new SmClient({ baseUrl: 'https://api.test', transport, onCacheError }),
    onCacheError,
  };
}

describe('cache de lecture non critique', () => {
  beforeEach(() => setStore(store()));

  it("rend la réponse réseau fraîche même si l'écriture du cache échoue", async () => {
    const quota = new Error('QuotaExceededError');
    setStore(store({ setItem: async () => Promise.reject(quota) }));
    const { api, onCacheError } = client({
      send: async () => ({ status: 200, body: { version: 2 } }),
    });

    await expect(api.get('/menu', { cacheKey: 'menu.demo' })).resolves.toEqual({ version: 2 });
    expect(onCacheError).toHaveBeenCalledWith({
      operation: 'write',
      key: 'sm.cache.menu.demo',
      error: quota,
    });
  });

  it("préserve l'erreur réseau originale si le cache est lui-même illisible", async () => {
    const network = new TransportUnreachable('Réseau coupé');
    const storage = new Error('Stockage refusé');
    setStore(store({ getItem: async () => Promise.reject(storage) }));
    const { api, onCacheError } = client({ send: async () => Promise.reject(network) });

    await expect(api.get('/menu', { cacheKey: 'menu.demo' })).rejects.toBe(network);
    expect(onCacheError).toHaveBeenCalledWith({
      operation: 'read',
      key: 'sm.cache.menu.demo',
      error: storage,
    });
  });

  it("ignore un cache corrompu et conserve l'erreur serveur", async () => {
    setStore(store({ getItem: async () => '{json-cassé' }));
    const { api, onCacheError } = client({
      send: async () => ({ status: 503, body: { message: 'Maintenance' } }),
    });

    await expect(api.get('/menu', { cacheKey: 'menu.demo' })).rejects.toMatchObject({
      message: 'Maintenance',
      status: 503,
    });
    expect(onCacheError).toHaveBeenCalledWith(
      expect.objectContaining({ operation: 'read', key: 'sm.cache.menu.demo' }),
    );
  });

  it('retourne null en lecture cache seule lorsque le stockage est indisponible', async () => {
    setStore(store({ getItem: async () => Promise.reject(new Error('indisponible')) }));
    const { api } = client({ send: async () => ({ status: 200, body: {} }) });

    await expect(api.cached('menu.demo')).resolves.toBeNull();
  });
});
