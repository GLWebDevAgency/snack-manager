import { describe, expect, it } from 'vitest';
import type { CartLine } from '@sm/client-core';
import {
  buildOrderBody,
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
