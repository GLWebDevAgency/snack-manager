import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  PermanentError,
  QueueContainsUnsyncedDataError,
  QueueScopeChangedError,
  QueueScopeNotBoundError,
  QueueScopeRetiredError,
  QueueStorageCorruptedError,
  SYNC_QUEUE_STORAGE_KEY,
  SyncQueue,
  type QueueEntry,
} from './sync-queue';
import { setStore, webStore, type KeyValueStore } from './storage';

/**
 * LA FILE OFFLINE — ce qui tient le service quand le réseau tombe.
 *
 * Elle n'avait aucun test, alors qu'elle porte des ventes déjà encaissées : sur
 * une tablette de comptoir, une entrée perdue est de l'argent dans le tiroir
 * sans commande en face.
 *
 * Le défaut réparé ici : un refus définitif du serveur (4xx) retirait l'entrée
 * et la JETAIT. Le commentaire disait « on retire pour ne pas bloquer le
 * service » — juste — mais retirer sans trace ne l'est pas. Rien à l'écran ne
 * disait quelle vente venait de disparaître, ni pourquoi.
 */

/**
 * `enqueue` déclenche un envoi de son propre chef (`void this.flush()`), sans
 * l'attendre : sans ce point d'arrêt, un test verrait deux passes se marcher
 * dessus et compterait des appels qui ne sont pas les siens.
 */
const laisserPartir = () => new Promise((r) => setTimeout(r, 0));

/** Un stockage en mémoire, remis à neuf entre chaque test. */
function stockage() {
  const donnees = new Map<string, string>();
  setStore({
    getItem: async (k: string) => donnees.get(k) ?? null,
    setItem: async (k: string, v: string) => void donnees.set(k, v),
    removeItem: async (k: string) => void donnees.delete(k),
  });
  return donnees;
}

function etatPersiste(entries: QueueEntry[] = [], rejected: unknown[] = []) {
  return JSON.stringify({ version: 2, entries, rejected });
}

function lireEtat(raw: string | undefined) {
  if (!raw) throw new Error('État de file absent');
  return JSON.parse(raw) as { version: 2; entries: QueueEntry[]; rejected: unknown[] };
}

const commande = (id: string) => ({
  method: 'POST' as const,
  path: '/orders',
  body: { clientId: id, total: 1_850 },
  subject: id,
});

let donnees: Map<string, string>;
beforeEach(() => {
  donnees = stockage();
});

describe('une mutation refusée définitivement', () => {
  it('est CONSERVÉE avec son motif — sinon la vente disparaît', async () => {
    const envoyer = vi.fn().mockRejectedValue(new PermanentError('Produit supprimé', 409));
    const file = new SyncQueue(envoyer);
    await file.enqueue(commande('c1'));
    await laisserPartir();

    const rejets = file.getState().rejected;
    expect(rejets).toHaveLength(1);
    expect(rejets[0]).toMatchObject({ path: '/orders', reason: 'Produit supprimé', status: 409 });
    // Le CORPS est gardé : c'est lui qui permet de ressaisir la vente perdue.
    expect(rejets[0]!.body).toEqual({ clientId: 'c1', total: 1_850 });
  });

  it('quitte quand même la file — un refus définitif ne doit pas bloquer le service', async () => {
    const envoyer = vi.fn().mockRejectedValue(new PermanentError('Déjà servie', 409));
    const file = new SyncQueue(envoyer);
    await file.enqueue(commande('c1'));
    await laisserPartir();
    expect(file.getState().pending).toBe(0);
  });

  it('survit au redémarrage de la tablette', async () => {
    const envoyer = vi.fn().mockRejectedValue(new PermanentError('Produit supprimé', 409));
    const premiere = new SyncQueue(envoyer);
    await premiere.enqueue(commande('c1'));
    await laisserPartir();

    // Même stockage, instance neuve : c'est la tablette qu'on rallume.
    const seconde = new SyncQueue(vi.fn());
    await seconde.enqueue(commande('c2'));
    expect(seconde.getState().rejected).toHaveLength(1);
    expect(seconde.getState().rejected[0]!.reason).toBe('Produit supprimé');
  });

  it('conserve son montant local numérique après rejet et redémarrage', async () => {
    const envoyer = vi.fn().mockRejectedValue(new PermanentError('Produit supprimé', 409));
    const premiere = new SyncQueue(envoyer);
    await premiere.enqueue({ ...commande('c1'), displayAmountCents: 1_850 });
    await laisserPartir();

    expect(premiere.getState().rejected[0]).toMatchObject({
      id: expect.any(String),
      displayAmountCents: 1_850,
    });
    expect(lireEtat(donnees.get(SYNC_QUEUE_STORAGE_KEY)).rejected[0]).toMatchObject({
      displayAmountCents: 1_850,
    });

    const reboot = new SyncQueue(vi.fn());
    await reboot.pending();
    expect(reboot.getState().rejected[0]).toMatchObject({ displayAmountCents: 1_850 });
  });

  it('refuse toute métadonnée de montant qui ne soit pas un entier en centimes', async () => {
    const file = new SyncQueue(vi.fn());
    await expect(
      file.enqueue({
        ...commande('c1'),
        displayAmountCents: 'secret-ou-pii',
      } as unknown as Omit<QueueEntry, 'id' | 'createdAt' | 'attempts'>),
    ).rejects.toBeInstanceOf(TypeError);
  });

  it('ne perd aucun refus lors d’un incident de masse', async () => {
    const envoyer = vi.fn().mockRejectedValue(new PermanentError('Refus', 400));
    const file = new SyncQueue(envoyer);
    for (let i = 0; i < 25; i += 1) {
      await file.enqueue(commande(`c${i}`));
      await laisserPartir();
    }

    const rejets = file.getState().rejected;
    expect(rejets).toHaveLength(25);
    // Les plus récents restent devant, sans sacrifier le tout premier refus.
    expect(rejets[0]!.body).toMatchObject({ clientId: 'c24' });
    expect(rejets[24]!.body).toMatchObject({ clientId: 'c0' });
    expect(lireEtat(donnees.get(SYNC_QUEUE_STORAGE_KEY)).rejected).toHaveLength(25);
  });

  it('ne s’efface que sur un geste EXPLICITE', async () => {
    const envoyer = vi.fn().mockRejectedValue(new PermanentError('Refus', 400));
    const file = new SyncQueue(envoyer);
    await file.enqueue(commande('c1'));
    await laisserPartir();
    expect(file.getState().rejected).toHaveLength(1);

    // Une seconde passe ne doit pas les faire disparaître : un rejet qui
    // s'efface tout seul ramène exactement le défaut qu'on répare.
    await file.flush();
    expect(file.getState().rejected).toHaveLength(1);

    await file.acquitterRejets();
    expect(file.getState().rejected).toHaveLength(0);
    expect(lireEtat(donnees.get(SYNC_QUEUE_STORAGE_KEY)).rejected).toEqual([]);
  });
});

describe('une panne passagère', () => {
  it('garde l’entrée en file et ne la compte pas comme rejetée', async () => {
    const envoyer = vi.fn().mockRejectedValue(new Error('réseau indisponible'));
    const file = new SyncQueue(envoyer);
    await file.enqueue(commande('c1'));
    await laisserPartir();

    expect(file.getState().pending).toBe(1);
    expect(file.getState().rejected).toHaveLength(0);
    expect(file.getState().lastError).toBe('réseau indisponible');
  });

  it('bloque les mutations SUIVANTES du même sujet, pour préserver leur ordre', async () => {
    // Une commande dont la création échoue ne doit pas voir son changement de
    // statut partir devant : le serveur recevrait une mise à jour d'une
    // commande qui n'existe pas encore.
    const envoyer = vi.fn().mockRejectedValue(new Error('réseau'));
    const file = new SyncQueue(envoyer);
    await file.enqueue(commande('c1'));
    await laisserPartir();
    envoyer.mockClear();

    await file.enqueue({ method: 'PATCH', path: '/orders/c1/status', subject: 'c1' });
    await laisserPartir();

    // La création est en tête et a échoué : la mise à jour ne doit pas partir
    // devant elle, sinon le serveur reçoit un changement de statut pour une
    // commande qui n'existe pas encore.
    expect(envoyer).toHaveBeenCalledTimes(1);
    expect(envoyer.mock.calls[0]![0]).toMatchObject({ path: '/orders' });
    expect(file.getState().pending).toBe(2);
  });
});

describe('purge protégée au désappairage', () => {
  it('refuse atomiquement une vente en attente puis autorise la purge après preuve serveur', async () => {
    const envoyer = vi.fn().mockRejectedValue(new Error('réseau'));
    const file = new SyncQueue(envoyer);
    await file.enqueue(commande('c1'));
    await laisserPartir();

    await expect(file.clear({ requireEmpty: true })).rejects.toMatchObject({
      pending: 1,
      rejected: 0,
    });
    expect(file.getState().pending).toBe(1);

    // Le refus de purge n'a pas condamné la file : elle peut se synchroniser,
    // puis le même clear protégé constate le snapshot vide sous verrou.
    envoyer.mockResolvedValue(undefined);
    await file.flush();
    expect(file.getState().pending).toBe(0);
    await expect(file.clear({ requireEmpty: true })).resolves.toBeUndefined();
  });

  it('conserve aussi les refus jusqu’à leur traitement explicite', async () => {
    const envoyer = vi.fn().mockRejectedValue(new PermanentError('Refus', 409));
    const file = new SyncQueue(envoyer);
    await file.enqueue(commande('c1'));
    await laisserPartir();

    await expect(file.clear({ requireEmpty: true })).rejects.toBeInstanceOf(
      QueueContainsUnsyncedDataError,
    );
    expect(file.getState().rejected).toHaveLength(1);
    await file.acquitterRejets();
    await expect(file.clear({ requireEmpty: true })).resolves.toBeUndefined();
  });
});

describe('durabilité sous concurrence', () => {
  it("refuse toute opération terrain avant la restauration de l'appairage", async () => {
    const file = new SyncQueue(vi.fn(), { requireScope: true });

    await expect(file.pending()).rejects.toBeInstanceOf(QueueScopeNotBoundError);
    await expect(file.enqueue(commande('orpheline'))).rejects.toBeInstanceOf(
      QueueScopeNotBoundError,
    );
    await expect(file.flush()).rejects.toBeInstanceOf(QueueScopeNotBoundError);
  });

  it("ne laisse pas une instance non hydratée ressusciter l'ancien appairage", async () => {
    const active = new SyncQueue(() => new Promise<never>(() => undefined), {
      requireScope: true,
    });
    // Construite avant le clear, mais volontairement jamais hydratée : c'est
    // l'onglet suspendu qui révélait le mélange A -> B.
    const stale = new SyncQueue(() => new Promise<never>(() => undefined), {
      requireScope: true,
    });

    await active.bindScope('pairing-a', { freshPairing: true });
    await active.clear();
    await active.completeClear();
    await active.bindScope('pairing-b', { freshPairing: true });
    await active.enqueue(commande('tenant-b'));

    await expect(stale.bindScope('pairing-a')).rejects.toBeInstanceOf(
      QueueScopeRetiredError,
    );
    await expect(stale.enqueue(commande('tenant-a'))).rejects.toBeInstanceOf(
      QueueScopeNotBoundError,
    );

    const rallumee = new SyncQueue(vi.fn(), { requireScope: true });
    await rallumee.bindScope('pairing-b');
    expect(
      (await rallumee.pending()).map(
        (entry) => (entry.body as { clientId: string }).clientId,
      ),
    ).toEqual(['tenant-b']);
  });

  it("refuse qu'un onglet resté non appairé remplace A par B sans clear explicite", async () => {
    const staleUnpaired = new SyncQueue(vi.fn(), { requireScope: true });
    const active = new SyncQueue(vi.fn(), { requireScope: true });

    await active.bindScope('scope-a', { freshPairing: true });
    await active.scopedStore().setItem('sm.ui.tenant', 'PII-A');

    await expect(
      staleUnpaired.bindScope('scope-b', { freshPairing: true }),
    ).rejects.toBeInstanceOf(QueueScopeChangedError);
    await expect(
      staleUnpaired.scopedStore().getItem('sm.ui.tenant'),
    ).rejects.toBeInstanceOf(QueueScopeNotBoundError);

    const restartA = new SyncQueue(vi.fn(), { requireScope: true });
    await restartA.bindScope('scope-a');
    await expect(
      restartA.scopedStore().getItem('sm.ui.tenant'),
    ).resolves.toBe('PII-A');

    expect(
      JSON.parse(donnees.get(SYNC_QUEUE_STORAGE_KEY) ?? '{}') as {
        scope?: string | null;
        retiredScopes?: string[];
      },
    ).toMatchObject({ scope: 'scope-a', retiredScopes: [] });
  });

  it("ne laisse pas B lire les caches A entre le clear de la file et la purge applicative", async () => {
    const staleUnpaired = new SyncQueue(vi.fn(), { requireScope: true });
    const active = new SyncQueue(vi.fn(), { requireScope: true });

    await active.bindScope('scope-gap-a', { freshPairing: true });
    await active.scopedStore().setItem('sm.ui.tenant-gap', 'PII-A');

    // Ordre actuel de POS/KDS : le tombstone de file est durable, puis seulement
    // les caches et l'identité sont purgés. Un autre onglet peut s'insérer ici.
    await active.clear();

    let valueVisibleByB: string | null = null;
    try {
      await staleUnpaired.bindScope('scope-gap-b', { freshPairing: true });
      valueVisibleByB = await staleUnpaired.scopedStore().getItem('sm.ui.tenant-gap');
    } catch (error) {
      expect(error).toBeInstanceOf(QueueScopeChangedError);
    }

    expect(valueVisibleByB).not.toBe('PII-A');
  });

  it("interdit à l'ancien onglet de réécrire des données UI après le passage A vers B", async () => {
    const active = new SyncQueue(vi.fn(), { requireScope: true });
    const stale = new SyncQueue(vi.fn(), { requireScope: true });
    await active.bindScope('scope-ui-a', { freshPairing: true });
    await stale.bindScope('scope-ui-a');
    await stale.scopedStore().setItem('sm.ui.tenant', 'tickets-A');

    await active.clear();
    // La purge applicative se déroule entre clear et le nouvel appairage.
    donnees.delete('sm.ui.tenant');
    await active.completeClear();
    await active.bindScope('scope-ui-b', { freshPairing: true });

    await expect(
      stale.scopedStore().setItem('sm.ui.tenant', 'tickets-A-retardés'),
    ).rejects.toBeInstanceOf(QueueScopeRetiredError);
    await active.scopedStore().setItem('sm.ui.tenant', 'tickets-B');
    expect(donnees.get('sm.ui.tenant')).toBe('tickets-B');
  });

  it("refuse une écriture métier démarrée pendant que le clear attend son commit", async () => {
    const disk = new Map<string, string>();
    let signalerTombstone: () => void = () => undefined;
    const tombstoneCommencee = new Promise<void>((resolve) => {
      signalerTombstone = resolve;
    });
    let libererTombstone: () => void = () => undefined;
    const tombstoneGate = new Promise<void>((resolve) => {
      libererTombstone = resolve;
    });
    setStore({
      getItem: async (key) => disk.get(key) ?? null,
      async setItem(key, value) {
        if (
          key === SYNC_QUEUE_STORAGE_KEY &&
          (JSON.parse(value) as { scope?: string | null }).scope === null &&
          disk.has(SYNC_QUEUE_STORAGE_KEY)
        ) {
          signalerTombstone();
          await tombstoneGate;
        }
        disk.set(key, value);
      },
      removeItem: async (key) => void disk.delete(key),
    });

    const file = new SyncQueue(vi.fn(), { requireScope: true });
    await file.bindScope('scope-clear-race', { freshPairing: true });
    const clear = file.clear();
    await tombstoneCommencee;
    const late = file.scopedStore().setItem('sm.ui.late', 'A');
    libererTombstone();

    await expect(clear).resolves.toBeUndefined();
    await expect(late).rejects.toBeInstanceOf(QueueScopeChangedError);
    expect(disk.has('sm.ui.late')).toBe(false);
  });

  it("verrouille immédiatement l'ancien onglet quand le navigateur signale le nouveau scope", async () => {
    const storageListeners: Array<(event: Event) => void> = [];
    const previous = globalThis.addEventListener;
    Object.defineProperty(globalThis, 'addEventListener', {
      configurable: true,
      value: (type: string, listener: (event: Event) => void) => {
        if (type === 'storage') storageListeners.push(listener);
      },
    });

    try {
      const active = new SyncQueue(vi.fn(), { requireScope: true });
      const stale = new SyncQueue(vi.fn(), { requireScope: true });
      await active.bindScope('scope-event-a', { freshPairing: true });
      await stale.bindScope('scope-event-a');
      await active.clear();

      for (const listener of storageListeners) {
        listener({ key: SYNC_QUEUE_STORAGE_KEY } as StorageEvent);
      }
      await laisserPartir();

      expect(stale.getState().scopeValid).toBe(false);
      expect(stale.getState().lastError).toContain('révoqué');
    } finally {
      if (previous) {
        Object.defineProperty(globalThis, 'addEventListener', {
          configurable: true,
          value: previous,
        });
      } else {
        delete (globalThis as { addEventListener?: unknown }).addEventListener;
      }
    }
  });

  it('reconnaît un clear durable interrompu avant la suppression de la clé appareil', async () => {
    const active = new SyncQueue(vi.fn(), { requireScope: true });
    await active.bindScope('pairing-interrompu', { freshPairing: true });
    await active.clear();

    const reboot = new SyncQueue(vi.fn(), { requireScope: true });
    await expect(reboot.bindScope('pairing-interrompu')).rejects.toBeInstanceOf(
      QueueScopeRetiredError,
    );
    await expect(
      reboot.bindScope('pairing-interrompu', { freshPairing: true }),
    ).rejects.toBeInstanceOf(QueueScopeRetiredError);
  });

  it('partage un seul passage réseau entre deux flush immédiats', async () => {
    const entry: QueueEntry = {
      id: 'single-flight',
      ...commande('single-flight'),
      createdAt: 1,
      attempts: 0,
    };
    donnees.set(SYNC_QUEUE_STORAGE_KEY, etatPersiste([entry]));

    let liberer: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      liberer = resolve;
    });
    const envoyer = vi.fn(() => gate);
    const file = new SyncQueue(envoyer);

    const premier = file.flush();
    const second = file.flush();
    while (envoyer.mock.calls.length === 0) await laisserPartir();
    expect(envoyer).toHaveBeenCalledTimes(1);

    liberer();
    await expect(Promise.all([premier, second])).resolves.toEqual([
      { sent: 1, failed: 0, remaining: 0 },
      { sent: 1, failed: 0, remaining: 0 },
    ]);
    expect(envoyer).toHaveBeenCalledTimes(1);
  });

  it('hydrate une seule fois quand deux enqueue démarrent ensemble', async () => {
    const disque = new Map<string, string>([[SYNC_QUEUE_STORAGE_KEY, etatPersiste([])]]);
    let lecturesInitiales = 0;
    let signalerLecture: () => void = () => undefined;
    const lectureCommencee = new Promise<void>((resolve) => {
      signalerLecture = resolve;
    });
    let libererLecture: () => void = () => undefined;
    const lectureBloquee = new Promise<void>((resolve) => {
      libererLecture = resolve;
    });

    setStore({
      async getItem(key) {
        if (key === SYNC_QUEUE_STORAGE_KEY) {
          lecturesInitiales += 1;
          if (lecturesInitiales === 1) {
            signalerLecture();
            await lectureBloquee;
          }
        }
        return disque.get(key) ?? null;
      },
      async setItem(key, value) {
        disque.set(key, value);
      },
      async removeItem(key) {
        disque.delete(key);
      },
    });

    const file = new SyncQueue(vi.fn().mockRejectedValue(new Error('hors ligne')));
    const premiere = file.enqueue(commande('c1'));
    const seconde = file.enqueue(commande('c2'));

    await lectureCommencee;
    await laisserPartir();
    // Les deux appels partagent bien la même hydratation. Les lectures
    // suivantes seront les refresh intentionnels sous verrou avant commit.
    expect(lecturesInitiales).toBe(1);
    libererLecture();
    await Promise.all([premiere, seconde]);

    expect((await file.pending()).map((e) => (e.body as { clientId: string }).clientId)).toEqual([
      'c1',
      'c2',
    ]);
  });

  it('empêche une ancienne écriture retardée d’écraser la plus récente au redémarrage', async () => {
    const disque = new Map<string, string>();
    const store: KeyValueStore = {
      async getItem(key) {
        return disque.get(key) ?? null;
      },
      async setItem(key, value) {
        const parsed = JSON.parse(value) as
          | QueueEntry[]
          | { version?: number; entries?: QueueEntry[] };
        const entries = Array.isArray(parsed) ? parsed : (parsed.entries ?? []);
        // La photo la plus ancienne finit volontairement après la seconde.
        if (entries.length === 1) {
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
        disque.set(key, value);
      },
      async removeItem(key) {
        disque.delete(key);
      },
    };
    setStore(store);

    // L'envoi ne se termine pas : il ne vient donc pas brouiller la preuve de
    // persistance en retirant les entrées pendant le test.
    const file = new SyncQueue(() => new Promise(() => undefined));
    await Promise.all([file.enqueue(commande('c1')), file.enqueue(commande('c2'))]);

    const rallumee = new SyncQueue(vi.fn());
    const ids = (await rallumee.pending()).map(
      (entry) => (entry.body as { clientId: string }).clientId,
    );
    expect(ids).toEqual(['c1', 'c2']);
  });

  it('fusionne deux enqueue provenant de deux instances partageant le même stockage', async () => {
    const disque = new Map<string, string>();
    setStore({
      async getItem(key) {
        return disque.get(key) ?? null;
      },
      async setItem(key, value) {
        // Agrandit volontairement la fenêtre de collision inter-instance.
        await new Promise((resolve) => setTimeout(resolve, 5));
        disque.set(key, value);
      },
      async removeItem(key) {
        disque.delete(key);
      },
    });
    const neRepondJamais = () => new Promise<never>(() => undefined);
    const premiere = new SyncQueue(neRepondJamais);
    const seconde = new SyncQueue(neRepondJamais);

    await Promise.all([premiere.enqueue(commande('a')), seconde.enqueue(commande('b'))]);

    const rallumee = new SyncQueue(vi.fn());
    expect(
      (await rallumee.pending()).map(
        (entry) => (entry.body as { clientId: string }).clientId,
      ),
    ).toEqual(['a', 'b']);
  });

  it('invalide une autre instance après un désappairage durable', async () => {
    const ancienne = new SyncQueue(() => new Promise<never>(() => undefined));
    const autreOnglet = new SyncQueue(() => new Promise<never>(() => undefined));
    await Promise.all([ancienne.pending(), autreOnglet.pending()]);

    await ancienne.clear();

    await expect(autreOnglet.enqueue(commande('tenant-a'))).rejects.toBeInstanceOf(
      QueueScopeChangedError,
    );
    const rallumee = new SyncQueue(vi.fn());
    await expect(rallumee.pending()).resolves.toEqual([]);
  });

  it("interdit à un ancien onglet de purger la file du nouvel établissement", async () => {
    const active = new SyncQueue(() => new Promise<never>(() => undefined));
    const stale = new SyncQueue(() => new Promise<never>(() => undefined));
    await Promise.all([active.pending(), stale.pending()]);

    await active.clear();
    await active.enqueue(commande('tenant-b'));
    await expect(stale.clear()).rejects.toBeInstanceOf(QueueScopeChangedError);

    const rallumee = new SyncQueue(vi.fn());
    expect(
      (await rallumee.pending()).map(
        (entry) => (entry.body as { clientId: string }).clientId,
      ),
    ).toEqual(['tenant-b']);
  });

  it("reprend une vente durable ajoutée par l'onglet qui a disparu", async () => {
    const writer = new SyncQueue(() => new Promise<never>(() => undefined));
    const envoyerSurvivant = vi.fn().mockResolvedValue(null);
    const survivor = new SyncQueue(envoyerSurvivant);
    await Promise.all([writer.pending(), survivor.pending()]);

    await writer.enqueue(commande('venue-autre-onglet'));
    await survivor.flush();

    expect(envoyerSurvivant).toHaveBeenCalledTimes(1);
    expect(envoyerSurvivant.mock.calls[0]![0]).toMatchObject({
      body: { clientId: 'venue-autre-onglet' },
    });
    const rallumee = new SyncQueue(vi.fn());
    await expect(rallumee.pending()).resolves.toEqual([]);
  });

  it("arrête le réseau d'un onglet invalidé entre deux envois", async () => {
    const a1: QueueEntry = {
      id: 'a1-cross-tab',
      ...commande('a1'),
      createdAt: 1,
      attempts: 0,
    };
    const a2: QueueEntry = {
      id: 'a2-cross-tab',
      ...commande('a2'),
      createdAt: 2,
      attempts: 0,
    };
    donnees.set(SYNC_QUEUE_STORAGE_KEY, etatPersiste([a1, a2]));

    let libererPremier: () => void = () => undefined;
    const premier = new Promise<void>((resolve) => {
      libererPremier = resolve;
    });
    const envoyer = vi.fn(async (entry: QueueEntry) => {
      if (entry.id === a1.id) await premier;
    });
    const stale = new SyncQueue(envoyer);
    const autreOnglet = new SyncQueue(vi.fn());
    await Promise.all([stale.pending(), autreOnglet.pending()]);

    const flush = stale.flush();
    while (envoyer.mock.calls.length === 0) await laisserPartir();
    await autreOnglet.clear();
    libererPremier();

    await expect(flush).rejects.toBeInstanceOf(QueueScopeChangedError);
    expect(envoyer.mock.calls.map(([entry]) => (entry as QueueEntry).id)).toEqual([a1.id]);
    await expect(stale.flush()).rejects.toBeInstanceOf(QueueScopeChangedError);
    expect(envoyer).toHaveBeenCalledTimes(1);
    const rallumee = new SyncQueue(vi.fn());
    await expect(rallumee.pending()).resolves.toEqual([]);
  });
});

describe('panne et corruption du stockage', () => {
  it("reprend après reboot le nettoyage des anciennes clés si la migration a été interrompue", async () => {
    const legacyQueueKey = 'sm.sync.queue.v1';
    const legacyRejectedKey = 'sm.sync.rejected.v1';
    const entry: QueueEntry = {
      id: 'legacy-entry',
      ...commande('legacy'),
      createdAt: 1,
      attempts: 0,
    };
    const disk = new Map<string, string>([
      [legacyQueueKey, JSON.stringify([entry])],
      [
        legacyRejectedKey,
        JSON.stringify([
          {
            id: 'legacy-rejected',
            path: '/orders',
            body: { customerName: 'PII ancienne' },
            reason: 'ancien refus',
            status: 400,
            at: 1,
          },
        ]),
      ],
    ]);
    let refuseOnce = true;
    setStore({
      getItem: async (key) => disk.get(key) ?? null,
      async setItem(key, value) {
        if (key === legacyRejectedKey && value === '[]' && refuseOnce) {
          refuseOnce = false;
          throw new Error('nettoyage interrompu');
        }
        disk.set(key, value);
      },
      removeItem: async (key) => void disk.delete(key),
    });

    const firstBoot = new SyncQueue(() => new Promise<never>(() => undefined), {
      requireScope: true,
    });
    await firstBoot.bindScope('legacy-scope');
    expect(disk.has(legacyRejectedKey)).toBe(true);

    const reboot = new SyncQueue(() => new Promise<never>(() => undefined), {
      requireScope: true,
    });
    await reboot.bindScope('legacy-scope');
    await reboot.enqueue(commande('après-reboot'));

    expect(disk.has(legacyQueueKey)).toBe(false);
    expect(disk.has(legacyRejectedKey)).toBe(false);
  });

  it('refuse enqueue et n’appelle jamais le réseau quand localStorage est bloqué', async () => {
    const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: {
        getItem: () => null,
        setItem: () => {
          throw new Error('quota dépassé');
        },
        removeItem: () => undefined,
      },
    });

    try {
      setStore(webStore());
      const envoyer = vi.fn();
      const file = new SyncQueue(envoyer);

      await expect(file.enqueue(commande('c1'))).rejects.toThrow('quota dépassé');
      expect(envoyer).not.toHaveBeenCalled();
      expect(file.getState().pending).toBe(0);
    } finally {
      if (previous) Object.defineProperty(globalThis, 'localStorage', previous);
      else Reflect.deleteProperty(globalThis, 'localStorage');
    }
  });

  it('n’écrase jamais silencieusement une file corrompue', async () => {
    donnees.set(SYNC_QUEUE_STORAGE_KEY, '{illisible');
    const envoyer = vi.fn();
    const file = new SyncQueue(envoyer);

    await expect(file.enqueue(commande('c1'))).rejects.toBeInstanceOf(QueueStorageCorruptedError);
    expect(envoyer).not.toHaveBeenCalled();
    expect(donnees.get(SYNC_QUEUE_STORAGE_KEY)).toBe('{illisible');
  });

  it('refuse un snapshot avec deux identités identiques avant tout envoi', async () => {
    const duplique: QueueEntry = {
      id: 'dup',
      ...commande('c1'),
      createdAt: 1,
      attempts: 0,
    };
    const brut = etatPersiste([
      duplique,
      { ...duplique, body: { clientId: 'c2', total: 2_200 }, createdAt: 2 },
    ]);
    donnees.set(SYNC_QUEUE_STORAGE_KEY, brut);
    const envoyer = vi.fn();
    const file = new SyncQueue(envoyer);

    await expect(file.flush()).rejects.toBeInstanceOf(QueueStorageCorruptedError);
    expect(envoyer).not.toHaveBeenCalled();
    expect(donnees.get(SYNC_QUEUE_STORAGE_KEY)).toBe(brut);
  });

  it('refuse aussi une identité partagée entre file et rejet', async () => {
    const entry: QueueEntry = {
      id: 'collision',
      ...commande('c1'),
      createdAt: 1,
      attempts: 0,
    };
    const brut = etatPersiste([entry], [
      {
        id: 'collision',
        path: '/orders',
        reason: 'Ancien refus',
        status: 409,
        at: 2,
      },
    ]);
    donnees.set(SYNC_QUEUE_STORAGE_KEY, brut);
    const envoyer = vi.fn();
    const file = new SyncQueue(envoyer);

    await expect(file.pending()).rejects.toBeInstanceOf(QueueStorageCorruptedError);
    expect(envoyer).not.toHaveBeenCalled();
    expect(donnees.get(SYNC_QUEUE_STORAGE_KEY)).toBe(brut);
  });

  it('libère toujours syncing quand la persistance finale échoue', async () => {
    const entry: QueueEntry = {
      id: 'q1',
      ...commande('c1'),
      createdAt: 1,
      attempts: 0,
    };
    const disque = new Map([[SYNC_QUEUE_STORAGE_KEY, etatPersiste([entry])]]);
    setStore({
      async getItem(key) {
        return disque.get(key) ?? null;
      },
      async setItem() {
        throw new Error('disque plein');
      },
      async removeItem(key) {
        disque.delete(key);
      },
    });
    const file = new SyncQueue(vi.fn().mockResolvedValue(null));

    await expect(file.flush()).rejects.toThrow('disque plein');
    expect(file.getState().syncing).toBe(false);
    expect(file.getState().lastError).toBe('disque plein');
    // Le serveur a pu répondre avant la panne disque : tant que son retrait
    // n'est pas durable, la mutation reste rejouable dans CETTE instance.
    expect(file.getState().pending).toBe(1);
  });

  it('retente dans la même instance après une panne de persistance finale', async () => {
    const entry: QueueEntry = {
      id: 'q1',
      ...commande('c1'),
      createdAt: 1,
      attempts: 0,
    };
    const disque = new Map([[SYNC_QUEUE_STORAGE_KEY, etatPersiste([entry])]]);
    let echec = true;
    setStore({
      async getItem(key) {
        return disque.get(key) ?? null;
      },
      async setItem(key, value) {
        if (echec) throw new Error('disque plein');
        disque.set(key, value);
      },
      async removeItem(key) {
        disque.delete(key);
      },
    });
    const envoyer = vi.fn().mockResolvedValue(null);
    const file = new SyncQueue(envoyer);

    await expect(file.flush()).rejects.toThrow('disque plein');
    expect((await file.pending()).map((e) => e.id)).toEqual(['q1']);

    echec = false;
    await expect(file.flush()).resolves.toMatchObject({ sent: 1, remaining: 0 });
    expect(envoyer).toHaveBeenCalledTimes(2);
    expect(lireEtat(disque.get(SYNC_QUEUE_STORAGE_KEY)).entries).toEqual([]);
  });

  it('garde la mutation récupérable si le journal de rejet ne peut pas être écrit', async () => {
    const entry: QueueEntry = {
      id: 'q1',
      ...commande('c1'),
      createdAt: 1,
      attempts: 0,
    };
    const brutInitial = etatPersiste([entry]);
    const disque = new Map([[SYNC_QUEUE_STORAGE_KEY, brutInitial]]);
    let panne = true;
    const store: KeyValueStore = {
      async getItem(key) {
        return disque.get(key) ?? null;
      },
      async setItem(key, value) {
        if (panne) throw new Error('coupure pendant le journal');
        disque.set(key, value);
      },
      async removeItem(key) {
        disque.delete(key);
      },
    };
    setStore(store);
    const refuse = vi.fn().mockRejectedValue(new PermanentError('Produit supprimé', 409));
    const file = new SyncQueue(refuse);

    await expect(file.flush()).rejects.toThrow('coupure pendant le journal');
    // Le snapshot précédent contient encore la mutation : elle n'est ni
    // perdue entre deux clés, ni faussement considérée comme acquittée.
    expect(disque.get(SYNC_QUEUE_STORAGE_KEY)).toBe(brutInitial);

    panne = false;
    const rallumee = new SyncQueue(refuse);
    await rallumee.flush();
    expect(rallumee.getState().pending).toBe(0);
    expect(rallumee.getState().rejected).toHaveLength(1);
  });
});

describe('purge au désappairage', () => {
  it('attend un flush tardif puis efface file, rejets et clés héritées', async () => {
    const entry: QueueEntry = {
      id: 'q1',
      ...commande('c1'),
      createdAt: 1,
      attempts: 0,
    };
    const disque = new Map<string, string>([
      [SYNC_QUEUE_STORAGE_KEY, etatPersiste([entry])],
      ['sm.sync.queue.v1', JSON.stringify([{ body: { phone: '0612345678' } }])],
      ['sm.sync.rejected.v1', JSON.stringify([{ body: { phone: '0612345678' } }])],
    ]);
    setStore({
      async getItem(key) {
        return disque.get(key) ?? null;
      },
      async setItem(key, value) {
        disque.set(key, value);
      },
      async removeItem(key) {
        disque.delete(key);
      },
    });

    let refuser: (error: Error) => void = () => undefined;
    const envoyer = vi.fn(
      () =>
        new Promise((_, reject) => {
          refuser = reject;
        }),
    );
    const file = new SyncQueue(envoyer);
    const flush = file.flush();
    while (envoyer.mock.calls.length === 0) await laisserPartir();

    const purge = file.clear();
    refuser(new PermanentError('Déjà annulée', 409));
    await flush;
    await purge;

    expect(file.getState().pending).toBe(0);
    expect(file.getState().rejected).toEqual([]);
    expect(lireEtat(disque.get(SYNC_QUEUE_STORAGE_KEY))).toMatchObject({
      entries: [],
      rejected: [],
    });
    expect(disque.has('sm.sync.queue.v1')).toBe(false);
    expect(disque.has('sm.sync.rejected.v1')).toBe(false);
  });

  it('n’envoie jamais une ancienne entrée avec l’identité du tenant suivant', async () => {
    const a1: QueueEntry = {
      id: 'a1',
      ...commande('a1'),
      createdAt: 1,
      attempts: 0,
    };
    const a2: QueueEntry = {
      id: 'a2',
      ...commande('a2'),
      createdAt: 2,
      attempts: 0,
    };
    const disque = new Map([[SYNC_QUEUE_STORAGE_KEY, etatPersiste([a1, a2])]]);
    setStore({
      async getItem(key) {
        return disque.get(key) ?? null;
      },
      async setItem(key, value) {
        disque.set(key, value);
      },
      async removeItem(key) {
        disque.delete(key);
      },
    });

    let tenant = 'A';
    let finirPremier: () => void = () => undefined;
    const premier = new Promise<void>((resolve) => {
      finirPremier = resolve;
    });
    const appels: Array<{ entry: string; tenant: string }> = [];
    const envoyer = vi.fn(async (entry: QueueEntry) => {
      appels.push({ entry: entry.id, tenant });
      if (entry.id === 'a1') await premier;
    });
    const file = new SyncQueue(envoyer);
    const flush = file.flush();
    while (appels.length === 0) await laisserPartir();

    // Même ordre que l'application : le désappairage démarre, puis le client
    // adopte plus tard les identifiants du restaurant suivant.
    const purge = file.clear();
    tenant = 'B';
    finirPremier();
    await flush;
    await purge;

    expect(appels).toEqual([{ entry: 'a1', tenant: 'A' }]);
    expect(file.getState().pending).toBe(0);
  });

  it('ne dépend jamais de la fin d’un sender réseau bloqué', async () => {
    const entry: QueueEntry = {
      id: 'q1',
      ...commande('c1'),
      createdAt: 1,
      attempts: 0,
    };
    const disque = new Map([[SYNC_QUEUE_STORAGE_KEY, etatPersiste([entry])]]);
    setStore({
      async getItem(key) {
        return disque.get(key) ?? null;
      },
      async setItem(key, value) {
        disque.set(key, value);
      },
      async removeItem(key) {
        disque.delete(key);
      },
    });
    const file = new SyncQueue(() => new Promise(() => undefined));
    void file.flush();
    await laisserPartir();

    await expect(
      Promise.race([
        file.clear().then(() => 'purged'),
        new Promise<string>((resolve) => setTimeout(() => resolve('timeout'), 50)),
      ]),
    ).resolves.toBe('purged');
    expect(file.getState().pending).toBe(0);
  });

  it('ne publie pas une purge que le stockage a refusée et permet de la retenter', async () => {
    const entry: QueueEntry = {
      id: 'q1',
      ...commande('c1'),
      createdAt: 1,
      attempts: 0,
    };
    const disque = new Map([[SYNC_QUEUE_STORAGE_KEY, etatPersiste([entry])]]);
    let refuserV2 = true;
    setStore({
      async getItem(key) {
        return disque.get(key) ?? null;
      },
      async setItem(key, value) {
        if (key === SYNC_QUEUE_STORAGE_KEY && refuserV2) throw new Error('quota dépassé');
        disque.set(key, value);
      },
      async removeItem(key) {
        disque.delete(key);
      },
    });
    const file = new SyncQueue(vi.fn());

    await expect(file.clear()).rejects.toThrow('quota dépassé');
    expect(file.getState().pending).toBe(1);
    expect((await file.pending()).map((e) => e.id)).toEqual(['q1']);
    // Le poste reste fermé tant que la purge n'est pas durable.
    await expect(file.enqueue(commande('c2'))).rejects.toThrow('Réinitialisation');

    refuserV2 = false;
    const premiereRelance = file.clear();
    const secondeRelance = file.clear();
    expect(secondeRelance).toBe(premiereRelance);
    await premiereRelance;
    expect(file.getState().pending).toBe(0);
  });
});

describe('acquittement ciblé des refus', () => {
  it('ne supprime jamais un nouveau rejet qui n’était pas encore affiché', async () => {
    const oldRejected = {
      id: 'old-r',
      path: '/orders/old',
      reason: 'Ancien refus',
      status: 409,
      at: 1,
    };
    const q1: QueueEntry = {
      id: 'new-r',
      ...commande('c1'),
      createdAt: 2,
      attempts: 0,
    };
    const q2: QueueEntry = {
      id: 'wait-r',
      ...commande('c2'),
      createdAt: 3,
      attempts: 0,
    };
    const disque = new Map([
      [SYNC_QUEUE_STORAGE_KEY, etatPersiste([q1, q2], [oldRejected])],
    ]);
    setStore({
      async getItem(key) {
        return disque.get(key) ?? null;
      },
      async setItem(key, value) {
        disque.set(key, value);
      },
      async removeItem(key) {
        disque.delete(key);
      },
    });

    let finirSecond: () => void = () => undefined;
    const second = new Promise<void>((resolve) => {
      finirSecond = resolve;
    });
    const envoyer = vi.fn(async (entry: QueueEntry) => {
      if (entry.id === 'new-r') throw new PermanentError('Nouveau refus', 409);
      await second;
      throw new Error('réseau');
    });
    const file = new SyncQueue(envoyer);
    const flush = file.flush();
    while (envoyer.mock.calls.length < 2) await laisserPartir();

    // Le geste correspond uniquement à la ligne que le gérant avait sous les yeux.
    await file.acquitterRejets(['old-r']);
    finirSecond();
    await flush;

    expect(file.getState().rejected.map((entry) => entry.id)).toEqual(['new-r']);
    expect(
      lireEtat(disque.get(SYNC_QUEUE_STORAGE_KEY)).rejected.map(
        (entry) => (entry as { id: string }).id,
      ),
    ).toEqual(['new-r']);
  });
});
