import { describe, expect, it, vi } from 'vitest';
import {
  purgeKeysWithIdentityLast,
  restoreIdentityIfUnchanged,
  restoreScopedIdentity,
  type KeyValueStore,
} from './storage';

describe('purge tenant crash-safe', () => {
  it("conserve l'identité si une donnée échoue, puis reprend jusqu'au bout", async () => {
    const values = new Map([
      ['session', 'a'],
      ['device', 'tenant-a'],
      ['tickets', 'pii-a'],
    ]);
    let failTicketsOnce = true;
    const removed: string[] = [];
    const store: KeyValueStore = {
      getItem: async (key) => values.get(key) ?? null,
      setItem: async (key, value) => void values.set(key, value),
      removeItem: vi.fn(async (key: string) => {
        removed.push(key);
        if (key === 'tickets' && failTicketsOnce) {
          failTicketsOnce = false;
          throw new Error('crash simulé');
        }
        values.delete(key);
      }),
    };

    await expect(
      purgeKeysWithIdentityLast(store, ['session', 'device', 'tickets'], 'device'),
    ).rejects.toThrow('crash simulé');
    expect(values.get('device')).toBe('tenant-a');
    expect(removed).toEqual(['session', 'tickets']);

    await purgeKeysWithIdentityLast(store, ['session', 'device', 'tickets'], 'device');
    expect(values.size).toBe(0);
    expect(removed.at(-1)).toBe('device');
  });

  it("refuse une frontière absente au lieu d'effectuer une purge dangereuse", async () => {
    const removeItem = vi.fn();
    const store: KeyValueStore = {
      getItem: async () => null,
      setItem: async () => undefined,
      removeItem,
    };

    await expect(
      purgeKeysWithIdentityLast(store, ['session', 'tickets'], 'device'),
    ).rejects.toThrow("clé d'identité");
    expect(removeItem).not.toHaveBeenCalled();
  });

  it.each([
    ['absente', null],
    ['corrompue', '{pas-json'],
  ])("purge les données A avant de rendre une identité %s", async (_label, identity) => {
    const values = new Map<string, string>([['tickets', 'client-A']]);
    if (identity !== null) values.set('device', identity);
    const store: KeyValueStore = {
      getItem: async (key) => values.get(key) ?? null,
      setItem: async (key, value) => void values.set(key, value),
      removeItem: async (key) => void values.delete(key),
    };

    await expect(
      restoreScopedIdentity(store, ['device', 'tickets'], 'device', (raw) =>
        JSON.parse(raw) as { tenant: string },
      ),
    ).resolves.toBeNull();
    expect(values.size).toBe(0);
  });

  it("ne laisse pas le rollback A supprimer l'identité B déjà commitée", async () => {
    const values = new Map<string, string>();
    const store: KeyValueStore = {
      getItem: async (key) => values.get(key) ?? null,
      setItem: async (key, value) => void values.set(key, value),
      removeItem: async (key) => void values.delete(key),
    };
    const pendingA = JSON.stringify({ tenant: 'A', scope: 'scope-a', pending: true });
    const pendingB = JSON.stringify({ tenant: 'B', scope: 'scope-b', pending: true });
    const committedB = JSON.stringify({ tenant: 'B', scope: 'scope-b' });

    const previousA = await store.getItem('device');
    await store.setItem('device', pendingA);
    await store.setItem('device', pendingB);
    await store.setItem('device', committedB);

    await expect(
      restoreIdentityIfUnchanged(store, 'device', pendingA, previousA),
    ).resolves.toBe(false);
    expect(values.get('device')).toBe(committedB);
  });

  it.each([
    ['la supprime', null],
    ["restaure l'identité précédente", 'tenant-précédent'],
  ])("%s quand l'identité pending appartient encore à l'appel perdant", async (_label, previous) => {
    const pending = JSON.stringify({ tenant: 'A', scope: 'scope-a', pending: true });
    const values = new Map<string, string>([['device', pending]]);
    const store: KeyValueStore = {
      getItem: async (key) => values.get(key) ?? null,
      setItem: async (key, value) => void values.set(key, value),
      removeItem: async (key) => void values.delete(key),
    };

    await expect(
      restoreIdentityIfUnchanged(store, 'device', pending, previous),
    ).resolves.toBe(true);
    expect(values.get('device') ?? null).toBe(previous);
  });
});
