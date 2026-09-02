import { describe, expect, it } from 'vitest';
import type { CartLine, KeyValueStore } from '@sm/client-core';
import {
  appendDayEntryDurably,
  buildOrderBody,
  commitQueuedSaleJournal,
  customerFieldsForMode,
  minimizeDayEntry,
  minimizeParkedTicket,
  zFromJournal,
  zFromServer,
  type DayEntry,
  type ServiceOrderRow,
  KEYS,
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

describe('commit durable du journal de vente', () => {
  it('ne confirme l’ajout qu’après l’écriture physique du snapshot', async () => {
    let release: (() => void) | undefined;
    const write = new Promise<void>((resolve) => { release = resolve; });
    const calls: Array<[string, string]> = [];
    const store: KeyValueStore = {
      getItem: async () => null,
      setItem: async (key, value) => {
        calls.push([key, value]);
        await write;
      },
      removeItem: async () => undefined,
    };

    let settled = false;
    const commit = appendDayEntryDurably(
      store,
      [],
      DAY_ENTRY,
      '2026-09-01',
    ).then((entries) => {
      settled = true;
      return entries;
    });
    await Promise.resolve();

    expect(settled).toBe(false);
    expect(calls[0]?.[0]).toBe(KEYS.dayLog);
    expect(JSON.parse(calls[0]?.[1] ?? '{}')).toEqual({
      day: '2026-09-01',
      entries: [DAY_ENTRY],
    });
    release?.();
    await expect(commit).resolves.toEqual([DAY_ENTRY]);
  });

  it('propage un refus de stockage au lieu de prétendre la vente durable', async () => {
    const store: KeyValueStore = {
      getItem: async () => null,
      setItem: async () => { throw new Error('storage unavailable'); },
      removeItem: async () => undefined,
    };

    await expect(
      appendDayEntryDurably(store, [], DAY_ENTRY, '2026-09-01'),
    ).rejects.toThrow('storage unavailable');
  });

  it('marque le journal dégradé sans transformer une vente déjà en file en nouvel essai', async () => {
    const store: KeyValueStore = {
      getItem: async () => null,
      setItem: async () => { throw new Error('storage unavailable'); },
      removeItem: async () => undefined,
    };

    await expect(
      commitQueuedSaleJournal(store, [], DAY_ENTRY, '2026-09-01'),
    ).resolves.toEqual({ entries: [DAY_ENTRY], durable: false });
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
    // enregistrait tout en attente et le Z du soir était faux.
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

describe('Z — ventilation par moyen de paiement', () => {
  const since = Date.parse('2026-08-18T10:00:00Z');
  const at = (iso: string) => ({ createdAt: iso });

  const rows: ServiceOrderRow[] = [
    { ...at('2026-08-18T11:00:00Z'), totals: { total: 1250 }, payment: { status: 'paid', tender: 'cash' } },
    { ...at('2026-08-18T11:10:00Z'), totals: { total: 900 }, payment: { status: 'paid', tender: 'card' } },
    { ...at('2026-08-18T11:20:00Z'), totals: { total: 1800 }, payment: { status: 'paid', tender: 'online' } },
    { ...at('2026-08-18T11:30:00Z'), totals: { total: 700 }, payment: { status: 'pending', tender: null } },
  ];

  it('sépare espèces, carte, en ligne et reste dû', () => {
    const z = zFromServer(rows, since);

    expect(z.cash).toBe(1250);
    expect(z.card).toBe(900);
    // La vente en ligne n'existe pas dans le journal du poste : sans les
    // commandes serveur, ces 18,00 € manqueraient au Z.
    expect(z.online).toBe(1800);
    expect(z.due).toBe(700);
    expect(z.ca).toBe(1250 + 900 + 1800 + 700);
    expect(z.orders).toBe(4);
    expect(z.source).toBe('server');
  });

  it('ventile les titres-restaurant à part', () => {
    const z = zFromServer(
      [
        ...rows,
        { ...at('2026-08-18T12:00:00Z'), totals: { total: 1150 }, payment: { status: 'paid', tender: 'meal_voucher' } },
      ],
      since,
    );

    expect(z.mealVoucher).toBe(1150);
    expect(z.cash).toBe(1250); // rien ne fuit d'une colonne à l'autre
  });

  it('écarte les commandes annulées et celles du service précédent', () => {
    const z = zFromServer(
      [
        ...rows,
        { ...at('2026-08-18T11:40:00Z'), status: 'cancelled', totals: { total: 5000 }, payment: { status: 'paid', tender: 'card' } },
        { ...at('2026-08-18T09:00:00Z'), totals: { total: 4000 }, payment: { status: 'paid', tender: 'cash' } },
      ],
      since,
    );

    expect(z.orders).toBe(4);
    expect(z.card).toBe(900);
    expect(z.cash).toBe(1250);
  });

  it('déduit les remises du chiffre et les affiche à part', () => {
    const z = zFromServer(
      [
        {
          ...at('2026-08-18T11:00:00Z'),
          totals: { total: 1000, discount: { amount: 250 } },
          payment: { status: 'paid', tender: 'card' },
        },
      ],
      since,
    );

    expect(z.ca).toBe(1000); // total serveur, remise déjà déduite
    expect(z.discounts).toBe(250);
  });

  it('hors ligne, le repli local se déclare comme tel', () => {
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
    expect(z.online).toBe(0);
    // `local` doit rester visible à l'écran : ce zéro « en ligne » est une
    // absence d'information, pas un fait comptable.
    expect(z.source).toBe('local');
  });

  it('le repli local déduit les remises appliquées après coup', () => {
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
 * L'appairage, la session et la file partaient bien. Le reste — journal du
 * service, tickets mis en attente, heure d'ouverture — restait en place et
 * ressortait après ré-appairage chez un AUTRE commerçant : le Z du soir
 * mélangeait deux restaurants, et un ticket parqué chez A se rappelait chez B
 * avec ses lignes et le nom de son client.
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

  it('le journal du service et les tickets parqués en font partie', () => {
    // Les deux qui manquaient, nommément : ce sont eux qui faisaient passer
    // des ventes et des clients d'un commerçant à l'autre.
    const cles = Object.values(KEYS) as string[];
    expect(cles).toContain('sm.pos.daylog.v1');
    expect(cles).toContain('sm.pos.parked.v1');
  });
});

/**
 * CE QUE LE Z NE DOIT PAS TAIRE.
 *
 * Le montant « encaissé sans moyen saisi » était documenté comme n'existant
 * « que sur des données anciennes ». C'est faux : il se produit à chaque
 * commande « à régler au retrait » que la cuisine fait passer à « Remis ».
 * L'API bascule alors le paiement en réglé — l'argent rentre — mais personne
 * n'a dit comment : ni le KDS, qui ne connaît pas le tiroir, ni la caisse, qui
 * n'a pas été sollicitée.
 */
describe('la ventilation du Z', () => {
  const commande = (over: Record<string, unknown> = {}) => ({
    createdAt: new Date(2_000_000).toISOString(),
    status: 'delivered',
    totals: { total: 1_500 },
    ...over,
  });

  it('range le retrait encaissé sans moyen dans « à ventiler », pas dans le vide', () => {
    const z = zFromServer(
      [commande({ payment: { status: 'paid', tender: null } })] as never,
      0,
    );
    expect(z.unspecified).toBe(1_500);
    // Il compte dans le chiffre d'affaires : l'argent est bien rentré.
    expect(z.ca).toBe(1_500);
    // Et il n'est pas confondu avec ce qui reste dû.
    expect(z.due).toBe(0);
  });

  it('sépare ce qui reste DÛ de ce qui est encaissé sans moyen', () => {
    const z = zFromServer(
      [
        commande({ payment: { status: 'pending', tender: null } }),
        commande({ payment: { status: 'paid', tender: null } }),
      ] as never,
      0,
    );
    expect(z.due).toBe(1_500);
    expect(z.unspecified).toBe(1_500);
  });

  it('ventile normalement quand le moyen est connu', () => {
    const z = zFromServer(
      [
        commande({ payment: { status: 'paid', tender: 'cash' } }),
        commande({ payment: { status: 'paid', tender: 'meal_voucher' } }),
      ] as never,
      0,
    );
    expect(z.cash).toBe(1_500);
    expect(z.mealVoucher).toBe(1_500);
    expect(z.unspecified).toBe(0);
  });
});
