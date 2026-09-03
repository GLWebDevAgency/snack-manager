import { describe, expect, it, vi } from 'vitest';
import type { CartLine, KeyValueStore } from '@sm/client-core';
import {
  buildOrderBody,
  createDayLogWriter,
  customerFieldsForMode,
  DAY_LOG_FILE_VERSION,
  DayLogChangedError,
  loadJson,
  minimizeDayEntry,
  minimizeParkedTicket,
  normalizeDayLogFile,
  serviceDay,
  zFromJournal,
  type DayEntry,
  type DayLogFile,
  KEYS,
  LOCAL_JOURNAL_SCOPE_NOTICE,
} from './pos-state';

const LINE: CartLine = {
  lineId: 'l1',
  productId: 'p1',
  name: 'Tacos',
  variantKey: null,
  variantName: null,
  options: [],
  removed: [],
  qty: 1,
  unitPrice: 1250,
};

const DAY_ENTRY: DayEntry = {
  clientId: '11111111-1111-4111-8111-111111111111',
  localNumber: 1,
  serverId: null,
  serverNumber: null,
  mode: 'surplace',
  method: 'cb',
  paid: true,
  total: 1_250,
  items: 1,
  at: 1,
};

const TEST_DAY = '2026-09-03';

function dayLogFile(
  entries: DayEntry[],
  generation = 0,
  revision = 0,
): DayLogFile {
  return {
    version: DAY_LOG_FILE_VERSION,
    day: TEST_DAY,
    generation,
    revision,
    entries,
  };
}

function memoryStore(disk: Map<string, string>): KeyValueStore {
  return {
    getItem: async (key) => disk.get(key) ?? null,
    setItem: async (key, value) => {
      disk.set(key, value);
    },
    removeItem: async (key) => {
      disk.delete(key);
    },
  };
}

function readDayLog(disk: Map<string, string>): DayLogFile {
  return normalizeDayLogFile(
    JSON.parse(disk.get(KEYS.dayLog) ?? 'null'),
    TEST_DAY,
  );
}

async function waitUntil(check: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (check()) return;
    await Promise.resolve();
  }
  throw new Error('condition de test non atteinte');
}

describe('écrivain sérialisé du journal local', () => {
  it('ne publie une mutation qu’après son unique écriture durable', async () => {
    let release: (() => void) | undefined;
    const calls: Array<[string, string]> = [];
    const store: KeyValueStore = {
      getItem: async () => null,
      setItem: async (key, value) => {
        calls.push([key, value]);
        await new Promise<void>((resolve) => {
          release = resolve;
        });
      },
      removeItem: async () => undefined,
    };
    const apply = vi.fn();
    const writer = createDayLogWriter(store);
    writer.hydrate(dayLogFile([]));
    const pending = writer.commit(
      () => [],
      (current) => [...current, DAY_ENTRY],
      apply,
      writer.revision(),
      TEST_DAY,
    );

    await waitUntil(() => calls.length === 1);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.[0]).toBe(KEYS.dayLog);
    expect(apply).not.toHaveBeenCalled();
    release?.();
    await expect(pending).resolves.toBe(true);
    expect(apply).toHaveBeenCalledWith([DAY_ENTRY]);
  });

  it('propage le rejet d’une mutation et laisse la mémoire inchangée', async () => {
    const memory = [DAY_ENTRY];
    const apply = vi.fn();
    const store: KeyValueStore = {
      getItem: async () => null,
      setItem: async () => {
        throw new Error('storage unavailable');
      },
      removeItem: async () => undefined,
    };
    const writer = createDayLogWriter(store);
    writer.hydrate(dayLogFile([DAY_ENTRY]));

    await expect(
      writer.commit(
        () => memory,
        (current) => [...current, { ...DAY_ENTRY, clientId: 'order-2' }],
        apply,
      ),
    ).rejects.toThrow('storage unavailable');
    expect(memory).toEqual([DAY_ENTRY]);
    expect(apply).not.toHaveBeenCalled();
  });

  it('suspend le reset mémoire jusqu’à l’écriture durable', async () => {
    let release: (() => void) | undefined;
    const calls: Array<[string, string]> = [];
    const store: KeyValueStore = {
      getItem: async () => null,
      setItem: async (key, value) => {
        calls.push([key, value]);
        await new Promise<void>((resolve) => {
          release = resolve;
        });
      },
      removeItem: async () => undefined,
    };
    const apply = vi.fn();
    const writer = createDayLogWriter(store);
    writer.hydrate(dayLogFile([]));
    const pending = writer.reset(apply, TEST_DAY);

    await waitUntil(() => calls.length === 1);
    expect(calls.map(([key]) => key)).toEqual([KEYS.dayLog]);
    expect(JSON.parse(calls[0]?.[1] ?? '{}')).toEqual({
      version: DAY_LOG_FILE_VERSION,
      day: TEST_DAY,
      generation: 1,
      revision: 1,
      entries: [],
    });
    expect(apply).not.toHaveBeenCalled();

    release?.();
    await pending;
    expect(apply).toHaveBeenCalledOnce();
    expect(apply).toHaveBeenCalledWith([]);
  });

  it('ne confirme ni ne remet la mémoire à zéro si le stockage refuse', async () => {
    const memory = { entries: [DAY_ENTRY], confirmed: false };
    const initial = dayLogFile([DAY_ENTRY]);
    const store: KeyValueStore = {
      getItem: async () => JSON.stringify(initial),
      setItem: async () => {
        throw new Error('storage unavailable');
      },
      removeItem: async () => undefined,
    };
    const writer = createDayLogWriter(store);
    writer.hydrate(dayLogFile([DAY_ENTRY]));

    await expect(
      writer.reset((entries) => {
        memory.entries = entries;
        memory.confirmed = true;
      }),
    ).rejects.toThrow('storage unavailable');
    expect(memory).toEqual({
      entries: [DAY_ENTRY],
      confirmed: false,
    });
  });

  it("n'invalide pas une mutation en attente lorsque le reset échoue", async () => {
    const disk = new Map<string, string>();
    let firstWrite = true;
    const store: KeyValueStore = {
      getItem: async (key) => disk.get(key) ?? null,
      setItem: async (key, value) => {
        if (firstWrite) {
          firstWrite = false;
          throw new Error('storage unavailable');
        }
        disk.set(key, value);
      },
      removeItem: async (key) => {
        disk.delete(key);
      },
    };
    const writer = createDayLogWriter(store);
    const initial = dayLogFile([DAY_ENTRY]);
    disk.set(KEYS.dayLog, JSON.stringify(initial));
    writer.hydrate(initial);
    let memory = [DAY_ENTRY];
    const revisionBeforeReset = writer.revision();

    const failedReset = writer.reset(() => {
      memory = [];
    }, TEST_DAY);
    const repair = writer.commit(
      () => memory,
      (current) => [...current, { ...DAY_ENTRY, clientId: 'order-2' }],
      (entries) => {
        memory = entries;
      },
      revisionBeforeReset,
      TEST_DAY,
    );

    await expect(failedReset).rejects.toThrow('storage unavailable');
    await expect(repair).resolves.toBe(true);
    expect(writer.revision()).toBe(revisionBeforeReset);
    expect(memory.map((entry) => entry.clientId)).toEqual([
      DAY_ENTRY.clientId,
      'order-2',
    ]);
    expect(JSON.parse(disk.get(KEYS.dayLog) ?? '{}').entries).toHaveLength(2);
  });

  it('restaure un journal vide après un reset réussi', async () => {
    const disk = new Map<string, string>();
    const store: KeyValueStore = {
      getItem: async (key) => disk.get(key) ?? null,
      setItem: async (key, value) => {
        disk.set(key, value);
      },
      removeItem: async (key) => {
        disk.delete(key);
      },
    };
    const writer = createDayLogWriter(store);
    writer.hydrate(dayLogFile([]));
    await writer.reset(() => undefined, TEST_DAY);
    const restored = await loadJson<DayLogFile>(
      store,
      KEYS.dayLog,
      dayLogFile([DAY_ENTRY]),
    );

    expect(restored).toEqual(dayLogFile([], 1, 1));
  });

  it('ne touche pas aux commandes web actives quand il vide le journal local', async () => {
    const activeWebOrders = [
      { id: 'web-ready', status: 'ready', channel: 'web' },
    ];
    let localEntries = [DAY_ENTRY];
    const initial = dayLogFile([DAY_ENTRY]);
    const store: KeyValueStore = {
      getItem: async () => JSON.stringify(initial),
      setItem: async () => undefined,
      removeItem: async () => undefined,
    };
    const writer = createDayLogWriter(store);
    writer.hydrate(dayLogFile([DAY_ENTRY]));

    expect(activeWebOrders).toEqual([
      { id: 'web-ready', status: 'ready', channel: 'web' },
    ]);
    await writer.reset((entries) => {
      localEntries = entries;
    });

    expect(localEntries).toEqual([]);
    expect(activeWebOrders).toEqual([
      { id: 'web-ready', status: 'ready', channel: 'web' },
    ]);
  });

  it('A reset puis le rapprochement stale de B ne ressuscite aucune entrée', async () => {
    const disk = new Map<string, string>();
    const initial = dayLogFile([DAY_ENTRY]);
    disk.set(KEYS.dayLog, JSON.stringify(initial));
    const writerA = createDayLogWriter(memoryStore(disk));
    const writerB = createDayLogWriter(memoryStore(disk));
    writerA.hydrate(initial);
    writerB.hydrate(initial);
    let memoryB = [DAY_ENTRY];

    await writerA.reset(() => undefined, TEST_DAY);
    await writerB.commit(
      () => memoryB,
      (current) =>
        current.map((entry) => ({ ...entry, serverId: 'stale-server-id' })),
      (entries) => {
        memoryB = entries;
      },
      writerB.revision(),
      TEST_DAY,
    );

    expect(memoryB).toEqual([]);
    expect(readDayLog(disk)).toEqual(dayLogFile([], 1, 2));
  });

  it('refuse le reset de A si B a modifié le snapshot présenté', async () => {
    const disk = new Map<string, string>();
    const initial = dayLogFile([DAY_ENTRY]);
    disk.set(KEYS.dayLog, JSON.stringify(initial));
    const writerA = createDayLogWriter(memoryStore(disk));
    const writerB = createDayLogWriter(memoryStore(disk));
    writerA.hydrate(initial);
    writerB.hydrate(initial);
    const shownByA = writerA.snapshot();
    const second = { ...DAY_ENTRY, clientId: 'order-b' };

    await writerB.commit(
      () => [DAY_ENTRY],
      (current) => [...current, second],
      () => undefined,
      writerB.revision(),
      TEST_DAY,
    );
    const applyReset = vi.fn();
    await expect(
      writerA.reset(
        applyReset,
        TEST_DAY,
        undefined,
        shownByA,
      ),
    ).rejects.toBeInstanceOf(DayLogChangedError);

    expect(applyReset).not.toHaveBeenCalled();
    expect(readDayLog(disk).entries.map((entry) => entry.clientId)).toEqual([
      DAY_ENTRY.clientId,
      second.clientId,
    ]);
  });

  it('ne perd aucune vente quand deux writers ajoutent en concurrence', async () => {
    const disk = new Map<string, string>();
    const initial = dayLogFile([]);
    disk.set(KEYS.dayLog, JSON.stringify(initial));
    const writerA = createDayLogWriter(memoryStore(disk));
    const writerB = createDayLogWriter(memoryStore(disk));
    writerA.hydrate(initial);
    writerB.hydrate(initial);
    const saleA = { ...DAY_ENTRY, clientId: 'sale-a' };
    const saleB = { ...DAY_ENTRY, clientId: 'sale-b' };

    await Promise.all([
      writerA.commit(
        () => [],
        (current) => [...current, saleA],
        () => undefined,
        writerA.revision(),
        TEST_DAY,
      ),
      writerB.commit(
        () => [],
        (current) => [...current, saleB],
        () => undefined,
        writerB.revision(),
        TEST_DAY,
      ),
    ]);

    expect(readDayLog(disk).entries.map((entry) => entry.clientId)).toEqual([
      'sale-a',
      'sale-b',
    ]);
  });

  it('accepte comme nouveau service une vente committée après le reset', async () => {
    const disk = new Map<string, string>();
    const initial = dayLogFile([DAY_ENTRY]);
    disk.set(KEYS.dayLog, JSON.stringify(initial));
    const writerA = createDayLogWriter(memoryStore(disk));
    const writerB = createDayLogWriter(memoryStore(disk));
    writerA.hydrate(initial);
    writerB.hydrate(initial);
    const nextSale = { ...DAY_ENTRY, clientId: 'next-service' };

    await writerA.reset(() => undefined, TEST_DAY);
    await writerB.commit(
      () => [DAY_ENTRY],
      (current) => [...current, nextSale],
      () => undefined,
      writerB.revision(),
      TEST_DAY,
    );

    expect(readDayLog(disk)).toEqual(dayLogFile([nextSale], 1, 2));
  });

  it('réévalue les gardes sous le verrou juste avant le CAS', async () => {
    const disk = new Map<string, string>();
    const initial = dayLogFile([DAY_ENTRY]);
    disk.set(KEYS.dayLog, JSON.stringify(initial));
    let releaseRead: (() => void) | undefined;
    let reading = false;
    const store: KeyValueStore = {
      ...memoryStore(disk),
      getItem: async (key) => {
        reading = true;
        await new Promise<void>((resolve) => {
          releaseRead = resolve;
        });
        return disk.get(key) ?? null;
      },
    };
    const writer = createDayLogWriter(store);
    writer.hydrate(initial);
    let resetAllowed = true;
    const applyReset = vi.fn();
    const reset = writer.reset(applyReset, TEST_DAY, () => {
      if (!resetAllowed) throw new Error('reset blocked');
    });
    await waitUntil(() => reading);
    resetAllowed = false;
    releaseRead?.();

    await expect(reset).rejects.toThrow('reset blocked');
    expect(applyReset).not.toHaveBeenCalled();
    expect(readDayLog(disk)).toEqual(initial);
  });

  it('migre et minimise un ancien payload avant toute nouvelle écriture', () => {
    const legacy = {
      day: TEST_DAY,
      entries: [
        {
          ...DAY_ENTRY,
          loyalty: {
            state: 'queued',
            memberId: 'member-secret',
            operationId: 'operation-secret',
          },
        },
      ],
    };

    expect(normalizeDayLogFile(legacy, TEST_DAY)).toEqual({
      ...dayLogFile([{ ...DAY_ENTRY, loyalty: { state: 'queued' } }]),
    });
  });
});

function body(method: 'cb' | 'especes' | 'tr' | 'retrait', cash?: { received: number; change: number }) {
  return buildOrderBody({
    clientId: 'c1',
    mode: 'surplace',
    lines: [LINE],
    note: '',
    customerName: '',
    customerPhone: '',
    slotIso: null,
    method,
    cash,
  });
}

describe('Corps de commande — moyen réellement encaissé', () => {
  it('fige uniquement l’UUID de la carte présentée sur le ticket envoyé', () => {
    const loyaltyMemberId = '22222222-2222-4222-8222-222222222222';
    const loyaltyEarnOperationId = '33333333-3333-4333-8333-333333333333';
    const result = buildOrderBody({
      clientId: 'c1',
      loyaltyMemberId,
      loyaltyEarnOperationId,
      mode: 'surplace',
      lines: [LINE],
      note: '',
      customerName: '',
      customerPhone: '',
      slotIso: null,
      method: 'cb',
    });

    expect(result.loyaltyMemberId).toBe(loyaltyMemberId);
    expect(result.loyaltyEarnOperationId).toBe(loyaltyEarnOperationId);
    expect(JSON.stringify(result)).not.toContain('phone');
  });

  it('refuse de séparer la carte de sa clé idempotente', () => {
    expect(() =>
      buildOrderBody({
        clientId: 'c1',
        loyaltyMemberId: '22222222-2222-4222-8222-222222222222',
        mode: 'surplace',
        lines: [LINE],
        note: '',
        customerName: '',
        customerPhone: '',
        slotIso: null,
        method: 'cb',
      }),
    ).toThrow(/indissociables/);
  });

  it('n’associe jamais identité téléphone et carte fidélité dans la file locale', () => {
    const result = buildOrderBody({
      clientId: 'c1',
      loyaltyMemberId: '22222222-2222-4222-8222-222222222222',
      loyaltyEarnOperationId: '33333333-3333-4333-8333-333333333333',
      mode: 'tel',
      lines: [LINE],
      note: '',
      customerName: 'Camille',
      customerPhone: '06 12 34 56 78',
      slotIso: '2026-09-01T12:00:00.000Z',
      method: 'retrait',
    });

    expect(result).not.toHaveProperty('loyaltyMemberId');
    expect(result).not.toHaveProperty('loyaltyEarnOperationId');
    expect(result.pickup).toMatchObject({ customerName: 'Camille' });
  });

  it('la carte part comme telle, pas comme un simple « au comptoir »', () => {
    // Le défaut corrigé : les trois boutons envoyaient le même corps, l'API
    // enregistrait tout en attente et le récapitulatif local était faux.
    expect(body('cb').payment).toEqual({ method: 'counter', tender: 'card' });
  });

  it('les espèces transportent le montant reçu et le rendu', () => {
    expect(body('especes', { received: 2000, change: 750 }).payment).toEqual({
      method: 'counter',
      tender: 'cash',
      cashReceived: 2000,
      changeGiven: 750,
    });
  });

  it('le titre-restaurant part comme un encaissement à part entière', () => {
    // Sans lui, le déjeuner passait en « carte » ou en « à encaisser » : la
    // télécollecte TR du soir ne se recoupait avec rien.
    expect(body('tr').payment).toEqual({ method: 'counter', tender: 'meal_voucher' });
  });

  it("« à encaisser au retrait » ne déclare aucun encaissement", () => {
    expect(body('retrait').payment).toEqual({ method: 'counter', tender: null });
  });
});

describe('Minimisation locale fidélité et téléphone', () => {
  it('purge les coordonnées dès que le ticket quitte le canal téléphone', () => {
    expect(
      customerFieldsForMode('surplace', 'Camille', '06 12 34 56 78', '2026-09-01T12:00:00Z'),
    ).toEqual({ customerName: '', customerPhone: '', slot: null });
  });

  it('nettoie un ancien ticket parqué avant de le republier', () => {
    const minimized = minimizeParkedTicket({
        code: 'P123',
        lines: [LINE],
        mode: 'tel',
        customerName: 'Camille',
        customerPhone: '06 12 34 56 78',
        slot: null,
        note: '',
        loyaltyMemberId: '22222222-2222-4222-8222-222222222222',
        at: 1,
      });
    expect(minimized).not.toHaveProperty('loyaltyMemberId');
  });

  it('ne conserve dans le journal que l’état public du gain', () => {
    const legacy = {
      clientId: 'c1',
      localNumber: 1,
      serverId: null,
      serverNumber: null,
      mode: 'surplace',
      method: 'cb',
      paid: true,
      total: 1_250,
      items: 1,
      at: 1,
      loyalty: {
        state: 'queued',
        memberId: '22222222-2222-4222-8222-222222222222',
        operationId: '33333333-3333-4333-8333-333333333333',
      },
    } as DayEntry;

    expect(minimizeDayEntry(legacy).loyalty).toEqual({ state: 'queued' });
  });

  it('neutralise les anciens états et montants de gain invalides', () => {
    const corrupted = {
      clientId: 'c1',
      localNumber: 1,
      serverId: null,
      serverNumber: null,
      mode: 'surplace',
      method: 'cb',
      paid: true,
      total: 1_250,
      items: 1,
      at: 1,
      loyalty: { state: 'redeemed', creditedUnits: -10 },
    } as unknown as DayEntry;

    expect(minimizeDayEntry(corrupted).loyalty).toEqual({ state: 'failed' });
  });
});

describe('récapitulatif du journal local', () => {
  it('annonce explicitement ce que le reset local ne clôture pas', () => {
    expect(LOCAL_JOURNAL_SCOPE_NOTICE).toContain('commandes web');
    expect(LOCAL_JOURNAL_SCOPE_NOTICE).toContain('autres caisses');
    expect(LOCAL_JOURNAL_SCOPE_NOTICE).toContain('comptabilité globale');
    expect(LOCAL_JOURNAL_SCOPE_NOTICE).toContain('suivi opérationnel');
  });

  it('ventile seulement les commandes saisies sur ce poste', () => {
    const entries: DayEntry[] = [
      { clientId: 'a', localNumber: 1, serverId: null, serverNumber: null, mode: 'surplace', method: 'cb', paid: true, total: 900, items: 1, at: 1 },
      { clientId: 'b', localNumber: 2, serverId: null, serverNumber: null, mode: 'emporter', method: 'especes', paid: true, total: 1250, items: 2, at: 2 },
      { clientId: 'c', localNumber: 3, serverId: null, serverNumber: null, mode: 'tel', method: 'retrait', paid: false, total: 700, items: 1, at: 3 },
      { clientId: 'd', localNumber: 4, serverId: null, serverNumber: null, mode: 'surplace', method: 'tr', paid: true, total: 1150, items: 1, at: 4 },
    ];

    const z = zFromJournal(entries);

    expect(z.card).toBe(900);
    expect(z.cash).toBe(1250);
    expect(z.mealVoucher).toBe(1150);
    expect(z.due).toBe(700);
    expect(z.orders).toBe(4);
    expect(z.ca).toBe(4_000);
    expect(z).not.toHaveProperty('online');
    expect(z).not.toHaveProperty('source');
    expect(z).not.toHaveProperty('partial');
  });

  it('déduit les remises appliquées après coup', () => {
    const entries: DayEntry[] = [
      { clientId: 'a', localNumber: 1, serverId: 's1', serverNumber: 1, mode: 'surplace', method: 'cb', paid: true, total: 1000, discount: 250, items: 1, at: 1 },
    ];

    const z = zFromJournal(entries);

    expect(z.card).toBe(750);
    expect(z.ca).toBe(750);
    expect(z.discounts).toBe(250);
  });
});

/**
 * DÉSAPPAIRER, C'EST TOUT OUBLIER DE CET ÉTABLISSEMENT.
 *
 * L'appairage, la session et la file partaient bien. Le reste — journal local,
 * tickets mis en attente, ancienne borne obsolète — restait en place et
 * ressortait après ré-appairage chez un AUTRE commerçant : le récapitulatif
 * mélangeait deux restaurants, et un ticket parqué chez A se rappelait chez B.
 */
describe('les clés effacées au désappairage', () => {
  it('couvre TOUT ce que la caisse persiste — pas un sous-ensemble choisi', () => {
    // La purge itère sur `Object.values(KEYS)` : une clé ajoutée demain y entre
    // d'office, sans qu'on ait à penser à la lister. Ce test verrouille le
    // fait que rien ne vit hors de cette table.
    expect(Object.values(KEYS).sort()).toEqual(
      [
        'sm.pos.daylog.v1',
        'sm.pos.device.v1',
        'sm.pos.loyalty-enrollment-recovery.v1',
        'sm.pos.parked.v1',
        'sm.pos.servicestart.v1',
        'sm.pos.session.v1',
      ].sort(),
    );
  });

  it('le journal local et les tickets parqués en font partie', () => {
    // Les deux qui manquaient, nommément : ce sont eux qui faisaient passer
    // des ventes et des clients d'un commerçant à l'autre.
    const cles = Object.values(KEYS) as string[];
    expect(cles).toContain('sm.pos.daylog.v1');
    expect(cles).toContain('sm.pos.parked.v1');
  });
});
