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
  /** Lecture-modification-écriture exécutée sous la frontière partagée. */
  mutateItem?<T>(
    key: string,
    mutate: (current: string | null) => StoreItemMutation<T> | Promise<StoreItemMutation<T>>,
  ): Promise<T>;
}

export interface StoreItemMutation<T> {
  /** `null` supprime la clé ; une chaîne la remplace. */
  value: string | null;
  result: T;
}

const STORE_LOCK_NAME = 'sm.sync.state.v2.commit';
let fallbackStoreTail: Promise<void> = Promise.resolve();

/** Verrou commun à la file et aux données métier liées à son appairage. */
export function withStoreLock<T>(work: () => Promise<T>): Promise<T> {
  const locks = globalThis.navigator?.locks;
  if (locks) {
    return locks.request<Promise<T>>(STORE_LOCK_NAME, { mode: 'exclusive' }, work).then((v) => v);
  }
  const operation = fallbackStoreTail.then(work);
  fallbackStoreTail = operation.then(
    () => undefined,
    () => undefined,
  );
  return operation;
}

async function mutateStoreItemUnlocked<T>(
  store: KeyValueStore,
  key: string,
  mutate: (current: string | null) => StoreItemMutation<T> | Promise<StoreItemMutation<T>>,
): Promise<T> {
  const mutation = await mutate(await store.getItem(key));
  if (mutation.value === null) await store.removeItem(key);
  else await store.setItem(key, mutation.value);
  return mutation.result;
}

/**
 * Compare et remplace une clé sous le même verrou que la file offline.
 *
 * `scopedStore()` fournit sa propre implémentation afin de revalider le tenant
 * et d'éviter un verrou imbriqué. Les stores simples utilisent le verrou
 * partagé directement, ce qui rend aussi les tests multi-instance fidèles.
 */
export function mutateStoreItem<T>(
  store: KeyValueStore,
  key: string,
  mutate: (current: string | null) => StoreItemMutation<T> | Promise<StoreItemMutation<T>>,
): Promise<T> {
  if (store.mutateItem) return store.mutateItem(key, mutate);
  return withStoreLock(() => mutateStoreItemUnlocked(store, key, mutate));
}

async function purgeKeysWithIdentityLastUnlocked(
  store: KeyValueStore,
  keys: readonly string[],
  identityKey: string,
): Promise<void> {
  const unique = [...new Set(keys)];
  if (!identityKey || !unique.includes(identityKey)) {
    throw new Error("La clé d'identité doit appartenir au périmètre de purge");
  }
  for (const key of unique) {
    if (key !== identityKey) await store.removeItem(key);
  }
  await store.removeItem(identityKey);
}

/**
 * Purge un périmètre locataire en gardant sa clé d'identité comme frontière.
 *
 * Si le processus tombe au milieu, l'identité reste présente : au prochain
 * démarrage l'application sait qu'elle doit reprendre la purge. La supprimer
 * avant les données autoriserait un nouvel appairage à voir les restes de
 * l'ancien établissement.
 */
export async function purgeKeysWithIdentityLast(
  store: KeyValueStore,
  keys: readonly string[],
  identityKey: string,
): Promise<void> {
  await withStoreLock(() => purgeKeysWithIdentityLastUnlocked(store, keys, identityKey));
}

/**
 * Annule une écriture d'identité seulement si elle appartient encore à l'appelant.
 *
 * Deux onglets peuvent appairer A et B en parallèle. Le perdant ne doit jamais
 * restaurer son ancien snapshot au-dessus de l'identité que le gagnant vient de
 * committer. La comparaison et la restauration partagent donc le même verrou.
 */
export async function restoreIdentityIfUnchanged(
  store: KeyValueStore,
  identityKey: string,
  expectedCurrentValue: string,
  previousValue: string | null,
): Promise<boolean> {
  return withStoreLock(async () => {
    if ((await store.getItem(identityKey)) !== expectedCurrentValue) return false;
    if (previousValue === null) await store.removeItem(identityKey);
    else await store.setItem(identityKey, previousValue);
    return true;
  });
}

/**
 * Restaure une identité locataire ou assainit entièrement son ancien périmètre.
 * Une clé absente, un JSON cassé ou une forme obsolète ne valent jamais
 * autorisation d'appairer le tenant suivant au-dessus des données restantes.
 */
export async function restoreScopedIdentity<T>(
  store: KeyValueStore,
  keys: readonly string[],
  identityKey: string,
  decode: (raw: string) => T | null,
): Promise<T | null> {
  return withStoreLock(async () => {
    const raw = await store.getItem(identityKey);
    if (raw !== null) {
      try {
        const identity = decode(raw);
        if (identity !== null) return identity;
      } catch {
        // La purge ci-dessous est volontairement stricte et doit, elle, remonter.
      }
    }
    await purgeKeysWithIdentityLastUnlocked(store, keys, identityKey);
    return null;
  });
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

/**
 * localStorage enveloppé en promesses (navigateur, y compris react-native-web).
 *
 * Une écriture qui échoue DOIT remonter. La file offline appelle `setItem`
 * avant de rendre la main au POS : avaler un quota dépassé reviendrait à dire
 * « vente enregistrée » alors qu'un redémarrage l'effacerait. Les caches non
 * critiques peuvent choisir de gérer l'erreur chez eux ; le stockage partagé,
 * lui, ne ment jamais sur la durabilité.
 */
export function webStore(): KeyValueStore {
  const local = () => {
    const store = globalThis.localStorage;
    if (!store) throw new Error('Stockage local indisponible');
    return store;
  };

  return {
    async getItem(key) {
      return local().getItem(key);
    },
    async setItem(key, value) {
      local().setItem(key, value);
    },
    async removeItem(key) {
      local().removeItem(key);
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
