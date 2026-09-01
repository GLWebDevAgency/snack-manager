import { describe, expect, it, vi } from 'vitest';
import type { CartLine } from '@sm/client-core';
import { buildOrderBody, zFromJournal, type DayEntry } from './pos-state';
import {
  createSaleInFlightGate,
  pendingLoyaltyCount,
  rejectedSaleAmount,
  rejectedSnapshotIds,
  serviceCloseBlockReason,
  serviceCloseStatus,
} from './pos-safety';

const LINE: CartLine = {
  lineId: 'l1',
  productId: 'p1',
  name: 'Tacos',
  variantKey: null,
  variantName: null,
  options: [],
  removed: [],
  qty: 2,
  unitPrice: 1_250,
};

const ENTRY: DayEntry = {
  clientId: 'order-1',
  localNumber: 1,
  serverId: null,
  serverNumber: null,
  mode: 'surplace',
  method: 'cb',
  paid: true,
  total: 2_500,
  items: 2,
  at: 1,
};

describe('verrou synchrone de vente POS', () => {
  it('refuse dans le même tour une deuxième vente et toute mutation du ticket', () => {
    const gate = createSaleInFlightGate();
    const mutation = vi.fn();

    expect(gate.tryStart()).toBe(true);
    expect(gate.tryStart()).toBe(false);
    expect(gate.runWhenIdle(mutation)).toBe(false);
    expect(mutation).not.toHaveBeenCalled();

    gate.finish();
    expect(gate.runWhenIdle(mutation)).toBe(true);
    expect(mutation).toHaveBeenCalledOnce();
  });

  it('diffère synchroniquement le lock jusqu’au commit de la vente', () => {
    const gate = createSaleInFlightGate();
    const lock = vi.fn(() => {
      // Pendant l'exécution du lock différé, une nouvelle vente reste
      // impossible dans le même tour JavaScript.
      expect(gate.tryStart()).toBe(false);
    });

    expect(gate.tryStart()).toBe(true);
    expect(gate.deferUntilIdle(lock)).toBe(false);
    expect(lock).not.toHaveBeenCalled();
    expect(gate.tryStart()).toBe(false);

    gate.finish();
    expect(lock).toHaveBeenCalledOnce();
  });
});

describe('acquittement des refus affichés', () => {
  it('fige les IDs visibles sans absorber un rejet concurrent', () => {
    const rejets = [{ id: 'visible' }];
    const idsAffiches = rejectedSnapshotIds(rejets);
    rejets.push({ id: 'arrivé-après-le-rendu' });

    expect(idsAffiches).toEqual(['visible']);
  });
});

describe('invariant de clôture POS', () => {
  const ready = {
    saleInFlight: false,
    offline: false,
    pendingSync: 0,
    rejectedSync: 0,
    pendingLoyalty: 0,
  };

  it('bloque tant qu’une vente refusée n’est pas traitée', () => {
    const safety = { ...ready, rejectedSync: 2 };
    expect(serviceCloseBlockReason(safety)).toBe('rejected_sync');
    expect(serviceCloseStatus(safety)).toContain('2 ventes refusées');
  });

  it('bloque tant qu’un gain fidélité doit encore être suivi', () => {
    const entries: DayEntry[] = [
      { ...ENTRY, loyalty: { state: 'awaiting_order' } },
      { ...ENTRY, clientId: 'order-2', loyalty: { state: 'queued' } },
      { ...ENTRY, clientId: 'order-3', loyalty: { state: 'credited' } },
      { ...ENTRY, clientId: 'order-4', loyalty: { state: 'failed' } },
    ];
    const pendingLoyalty = pendingLoyaltyCount(entries);
    expect(pendingLoyalty).toBe(2);
    expect(serviceCloseBlockReason({ ...ready, pendingLoyalty })).toBe(
      'pending_loyalty',
    );
  });

  it('autorise uniquement un service complètement résolu', () => {
    expect(serviceCloseBlockReason(ready)).toBeNull();
  });
});

describe('montant des ventes refusées', () => {
  it('le retrouve dans le journal via clientId car le vrai body ne porte aucun total', () => {
    const body = buildOrderBody({
      clientId: ENTRY.clientId,
      mode: 'surplace',
      lines: [LINE],
      note: '',
      customerName: '',
      customerPhone: '',
      slotIso: null,
      method: 'cb',
    });

    expect(body).not.toHaveProperty('totals');
    expect(rejectedSaleAmount({ body }, [ENTRY])).toBe(2_500);
  });

  it('n’invente aucun montant si le rejet ne correspond plus au journal', () => {
    expect(rejectedSaleAmount({ body: { clientId: 'absent' } }, [ENTRY])).toBeNull();
    expect(
      rejectedSaleAmount({ body: { totals: { total: 99_999 } } }, [ENTRY]),
    ).toBeNull();
  });

  it('survit au redémarrage et au changement de jour sans entrer dans le Z', () => {
    const restored = JSON.parse(
      JSON.stringify({ body: { clientId: ENTRY.clientId }, displayAmountCents: 2_500 }),
    ) as { body: unknown; displayAmountCents: number };

    // Le journal du nouveau jour est vide : le montant vient du snapshot local
    // numérique de la file, et non d'une ancienne ligne comptable.
    expect(rejectedSaleAmount(restored, [])).toBe(2_500);
    expect(zFromJournal([])).toMatchObject({ orders: 0, ca: 0, card: 0 });
  });
});
