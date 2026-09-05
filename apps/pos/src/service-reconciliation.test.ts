import { describe, expect, it, vi } from 'vitest';
import type { OrdersWindow } from '@sm/client-core';
import {
  activeOrdersPath,
  createSerialTaskQueue,
  deriveServiceProjection,
  ordersSincePath,
  serviceBadgeLabel,
  serviceBadgeTone,
  type StatusWindows,
} from './service-reconciliation';
import type { ServerOrderRow } from './service-state';

function row(id: string, status: ServerOrderRow['status']): ServerOrderRow {
  return { _id: id, clientId: `c-${id}`, number: 1, status };
}

function window(
  rows: ServerOrderRow[],
  total = rows.length,
  truncated = total > rows.length,
): OrdersWindow<ServerOrderRow> {
  return { rows, total, truncated };
}

describe('file des lectures du service', () => {
  it('ne démarre jamais une seconde lecture avant la fin de la première', async () => {
    const queue = createSerialTaskQueue();
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const events: string[] = [];

    const first = queue.run(async () => {
      events.push('first:start');
      await blocked;
      events.push('first:end');
    });
    const second = queue.run(async () => {
      events.push('second:start');
    });

    await Promise.resolve();
    expect(events).toEqual(['first:start']);
    release();
    await Promise.all([first, second]);
    expect(events).toEqual(['first:start', 'first:end', 'second:start']);
  });

  it('continue après une erreur sans la cacher à son appelant', async () => {
    const queue = createSerialTaskQueue();
    const next = vi.fn(async () => 'ok');
    const failed = queue.run(async () => {
      throw new Error('réseau');
    });
    const recovered = queue.run(next);

    await expect(failed).rejects.toThrow('réseau');
    await expect(recovered).resolves.toBe('ok');
    expect(next).toHaveBeenCalledOnce();
  });
});

describe('requête opérationnelle', () => {
  it('retire les livraisons impayées de la projection et des compteurs complets', () => {
    const pending = { ...row('p', 'new'), type: 'delivery', payment: { status: 'pending' } } as ServerOrderRow;
    const paid = { ...row('a', 'new'), type: 'delivery', payment: { status: 'paid' } } as ServerOrderRow;
    const projection = deriveServiceProjection(window([pending, paid]), { new: window([pending, paid]), preparing: window([]), ready: window([]) });
    expect(projection.rows.map((order) => order._id)).toEqual(['a']);
    expect(projection.statusCounts.new).toMatchObject({ value: 1, exact: true });
    expect(projection.activeCount).toBe(1);
  });
  it('conserve exactement la borne passée à la lecture d’amorce journalière', () => {
    const dayStart = Date.parse('2026-09-03T00:00:00.000Z');
    const path = ordersSincePath(dayStart);
    const query = new URLSearchParams(path.split('?')[1]);

    expect(query.get('since')).toBe('2026-09-03T00:00:00.000Z');
  });

  it('ne borne pas un statut actif au journal local', () => {
    const query = new URLSearchParams(activeOrdersPath('ready').split('?')[1]);

    expect(query.get('status')).toBe('ready');
    expect(query.has('since')).toBe(false);
  });
});

describe('projection des commandes actives', () => {
  const all = window(
    [row('delivered', 'delivered'), row('visible-ready', 'ready')],
    240,
    true,
  );

  it('ne présente pas un total tronqué comme exact, car il peut inclure des livraisons impayées', () => {
    const statuses: StatusWindows = {
      new: window([row('new', 'new')], 1),
      preparing: window([row('prep-1', 'preparing'), row('prep-2', 'preparing')], 2),
      ready: window([row('ready-1', 'ready')], 7),
    };
    const projection = deriveServiceProjection(all, statuses);

    expect(projection.activeCount).toBe(4);
    expect(projection.activeCountExact).toBe(false);
    expect(projection.readyCount).toBe(1);
    expect(projection.readyCountExact).toBe(false);
    expect(projection.partial).toBe(true);
    expect(projection.truncatedStatuses).toEqual(['ready']);
  });

  it('signale explicitement une lecture de statut échouée et garde une estimation', () => {
    const projection = deriveServiceProjection(all, {
      new: window([row('new', 'new')]),
      preparing: null,
      ready: window([row('ready', 'ready')]),
    });

    expect(projection.failedStatuses).toEqual(['preparing']);
    expect(projection.partial).toBe(true);
    expect(projection.activeCountExact).toBe(false);
    expect(projection.statusCounts.preparing).toEqual({
      value: 0,
      exact: false,
      complete: false,
    });
  });

  it('déduplique un ticket qui avance entre deux lectures de statut', () => {
    const projection = deriveServiceProjection(all, {
      new: window([row('moving', 'new')]),
      preparing: window([row('moving', 'preparing')]),
      ready: window([]),
    });

    expect(projection.rows).toHaveLength(1);
    expect(projection.rows[0]?.status).toBe('preparing');
    expect(projection.activeCount).toBe(1);
    expect(projection.activeCountExact).toBe(false);
  });

  it('un remboursement aperçu dans une lecture écarte aussi le doublon payé périmé', () => {
    const projection = deriveServiceProjection(window([]), {
      new: window([{ ...row('moving', 'new'), type: 'delivery', payment: { status: 'paid' } }]),
      preparing: window([{ ...row('moving', 'preparing'), type: 'delivery', payment: { status: 'refunded' } }]),
      ready: window([]),
    });
    expect(projection.rows).toEqual([]);
    expect(projection.activeCount).toBe(0);
  });

  it('conserve une active ancienne hors du journal local', () => {
    const projection = deriveServiceProjection(
      window([row('done', 'delivered')]),
      {
        new: window([]),
        preparing: window([]),
        ready: window([row('before-reset', 'ready')]),
      },
    );
    expect(projection.activeCount).toBe(1);
    expect(projection.activeCountExact).toBe(false);
    expect(projection.readyCount).toBe(1);
    expect(projection.partial).toBe(false);
    expect(projection.rows.map(({ _id }) => _id)).toEqual(['before-reset']);
  });
});

describe('pastille du service', () => {
  it('montre un tiret avant la première lecture', () => {
    expect(serviceBadgeLabel({ loaded: false, stale: true, count: 0, exact: true })).toBe(
      '—',
    );
  });

  it('réserve le signe approximatif aux comptes non atomiques', () => {
    expect(serviceBadgeLabel({ loaded: true, stale: false, count: 12, exact: true })).toBe(
      '12',
    );
    expect(serviceBadgeLabel({ loaded: true, stale: false, count: 12, exact: false })).toBe(
      '≈ 12',
    );
  });

  it('marque une photo périmée jusque dans la barre haute', () => {
    expect(serviceBadgeLabel({ loaded: true, stale: true, count: 4, exact: true })).toBe(
      '4 · périmé',
    );
  });

  it('reste ambre si la photo est périmée ou partielle, même avec une prête', () => {
    expect(serviceBadgeTone({ stale: true, partial: false, ready: true })).toBe(
      'warning',
    );
    expect(serviceBadgeTone({ stale: false, partial: true, ready: true })).toBe(
      'warning',
    );
    expect(serviceBadgeTone({ stale: false, partial: false, ready: true })).toBe(
      'ready',
    );
  });
});
