/**
 * Stockage clé/valeur asynchrone, indépendant de la plateforme.
 *
 * Le noyau offline doit tourner à l'identique sur tablette (AsyncStorage /
 * SQLite) et sur navigateur (localStorage). Les apps injectent leur
 * implémentation au démarrage ; à défaut on retombe sur la mémoire, ce qui
 * garde le code testable mais NE survit pas à un redémarrage — d'où
 * l'avertissement explicite plutôt qu'un échec silencieux.
 */
export interface KeyValueStore {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

class MemoryStore implements KeyValueStore {
  private map = new Map<string, string>();
  async getItem(key: string) {
    return this.map.get(key) ?? null;
  }
  async setItem(key: string, value: string) {
    this.map.set(key, value);
  }
  async removeItem(key: string) {
    this.map.delete(key);
  }
}

/** localStorage enveloppé en promesses (navigateur, y compris react-native-web). */
export function webStore(): KeyValueStore {
  return {
    async getItem(key) {
      try {
        return globalThis.localStorage?.getItem(key) ?? null;
      } catch {
        return null;
      }
    },
    async setItem(key, value) {
      try {
        globalThis.localStorage?.setItem(key, value);
      } catch {
        // quota dépassé ou stockage bloqué : la file reste en mémoire
      }
    },
    async removeItem(key) {
      try {
        globalThis.localStorage?.removeItem(key);
      } catch {
        /* ignore */
      }
    },
  };
}

let current: KeyValueStore = new MemoryStore();
let warned = false;

export function setStore(store: KeyValueStore) {
  current = store;
  warned = true;
}

export function getStore(): KeyValueStore {
  if (!warned && current instanceof MemoryStore) {
    warned = true;
    // eslint-disable-next-line no-console
    console.warn(
      '[sm] Aucun stockage persistant configuré : la file offline ne survivra pas à un redémarrage. Appelez setStore().',
    );
  }
  return current;
}
