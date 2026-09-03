/**
 * Lecture répétée du service, sans dépendance React ni react-native.
 *
 * Le POS relit les commandes depuis le sondage, la socket et le retour de
 * veille. Les helpers de ce module gardent ces décisions testables : une seule
 * photo à la fois, une projection active indépendante du journal local et des
 * libellés qui ne transforment jamais une inconnue en chiffre exact.
 */
import {
  mostAdvancedStatus,
  type OrdersWindow,
  type OrderStatus,
} from '@sm/client-core';
import type { ServerOrderRow } from './service-state';

export const ACTIVE_ORDER_STATUSES = ['new', 'preparing', 'ready'] as const;
export type ActiveOrderStatus = (typeof ACTIVE_ORDER_STATUSES)[number];

export interface SerialTaskQueue {
  /** Ajoute une tâche et rend son propre résultat ou sa propre erreur. */
  run<T>(task: () => Promise<T>): Promise<T>;
}

/**
 * File FIFO minimale pour les lectures réseau.
 *
 * La queue interne absorbe chaque rejet, mais la promesse rendue à l'appelant
 * le conserve. Une panne n'empoisonne donc pas les tours suivants.
 */
export function createSerialTaskQueue(): SerialTaskQueue {
  let tail: Promise<void> = Promise.resolve();
  return {
    run<T>(task: () => Promise<T>): Promise<T> {
      const result = tail.then(task);
      tail = result.then(
        () => undefined,
        () => undefined,
      );
      return result;
    },
  };
}

/** Lecture du jour utilisée uniquement pour amorcer le numéro provisoire. */
export function ordersSincePath(sinceMs: number): string {
  const since = encodeURIComponent(new Date(sinceMs).toISOString());
  return `/orders?since=${since}`;
}

/** Les commandes actives ne dépendent jamais du reset du journal local. */
export function activeOrdersPath(status: ActiveOrderStatus): string {
  return `/orders?status=${status}`;
}

export interface ServiceStatusCount {
  /** Total annoncé par le serveur, ou estimation issue des lignes observées. */
  value: number;
  /** `false` seulement quand la lecture dédiée à ce statut a échoué. */
  exact: boolean;
  /** Toutes les lignes de ce statut sont présentes dans `rows`. */
  complete: boolean;
}

export type ServiceStatusCounts = Record<ActiveOrderStatus, ServiceStatusCount>;

export interface ServiceProjection {
  /** Lignes actives à montrer ; elles sont indépendantes du journal local. */
  rows: ServerOrderRow[];
  /** Estimation observée ; les trois statuts ne partagent pas de snapshot. */
  activeCount: number;
  activeCountExact: boolean;
  /** Total de la lecture `ready`, exact à l'instant de cette réponse. */
  readyCount: number;
  readyCountExact: boolean;
  statusCounts: ServiceStatusCounts;
  /** Des lignes actives peuvent manquer, même si leur total reste connu. */
  partial: boolean;
  failedStatuses: ActiveOrderStatus[];
  truncatedStatuses: ActiveOrderStatus[];
}

export type StatusWindows = Partial<
  Record<ActiveOrderStatus, OrdersWindow<ServerOrderRow> | null>
>;

function rowsForStatus(
  rows: readonly ServerOrderRow[],
  status: ActiveOrderStatus,
): ServerOrderRow[] {
  return rows.filter((row) => row.status === status);
}

/**
 * Déduplique les trois lectures de statut.
 *
 * Un ticket peut changer d'état pendant les requêtes parallèles et apparaître
 * dans deux réponses. Le statut le plus avancé gagne et une seule carte reste.
 */
function uniqueMostAdvanced(rows: readonly ServerOrderRow[]): ServerOrderRow[] {
  const byId = new Map<string, ServerOrderRow>();
  for (const row of rows) {
    const previous = byId.get(row._id);
    if (!previous) {
      byId.set(row._id, row);
      continue;
    }
    if (!previous.status || !row.status) {
      byId.set(row._id, { ...previous, ...row });
      continue;
    }
    const status = mostAdvancedStatus(
      previous.status as OrderStatus,
      row.status as OrderStatus,
    );
    byId.set(row._id, { ...previous, ...row, status });
  }
  return [...byId.values()];
}

/**
 * Construit la vue active à partir des trois lectures opérationnelles.
 *
 * Chaque statut actif est relu sans borne temporelle : une commande web ou
 * ancienne reste visible tant qu'elle est en cuisine. Le `total` de CHAQUE
 * statut reste exact même si sa liste dépasse elle-même 200 lignes ; leur
 * somme n'est en revanche pas atomique. La vue est marquée partielle si des
 * cartes peuvent manquer.
 */
export function deriveServiceProjection(
  all: OrdersWindow<ServerOrderRow>,
  statusWindows: StatusWindows = {},
): ServiceProjection {
  const failedStatuses: ActiveOrderStatus[] = [];
  const truncatedStatuses: ActiveOrderStatus[] = [];
  const projectedRows: ServerOrderRow[] = [];
  const statusCounts = {} as ServiceStatusCounts;

  for (const status of ACTIVE_ORDER_STATUSES) {
    const fallback = rowsForStatus(all.rows, status);
    const window = statusWindows[status];
    if (!window) {
      failedStatuses.push(status);
      projectedRows.push(...fallback);
      statusCounts[status] = {
        value: fallback.length,
        exact: false,
        complete: false,
      };
      continue;
    }

    projectedRows.push(...window.rows);
    if (window.truncated) truncatedStatuses.push(status);
    statusCounts[status] = {
      value: window.total,
      exact: true,
      complete: !window.truncated,
    };
  }

  const uniqueRows = uniqueMostAdvanced(projectedRows);
  const ready = statusCounts.ready;
  return {
    rows: uniqueRows,
    // Les trois requêtes de statut ne partagent pas de snapshot Mongo. Un
    // ticket qui avance entre deux réponses peut manquer ou être compté deux
    // fois dans la somme de leurs `total`. On n'affiche donc jamais cette
    // somme comme un fait : le nombre de lignes uniques observées (ou le plus
    // grand total individuel s'il est tronqué) reste une estimation. Une ligne
    // peut devenir terminale entre deux réponses, donc ce n'est pas forcément
    // un minimum de l'état réel à un instant donné.
    activeCount: Math.max(
      uniqueRows.length,
      ...ACTIVE_ORDER_STATUSES.map((status) => statusCounts[status].value),
    ),
    activeCountExact: false,
    readyCount: ready.value,
    readyCountExact: ready.exact,
    statusCounts,
    partial: failedStatuses.length > 0 || truncatedStatuses.length > 0,
    failedStatuses,
    truncatedStatuses,
  };
}

/** Compteur de la bascule de vue : initial, vieux et estimé restent visibles. */
export function serviceBadgeLabel({
  loaded,
  stale,
  count,
  exact,
}: {
  loaded: boolean;
  stale: boolean;
  count: number;
  exact: boolean;
}): string {
  if (!loaded) return '—';
  const value = exact ? String(count) : `≈ ${count}`;
  return stale ? `${value} · périmé` : value;
}

export type ServiceBadgeTone = 'warning' | 'ready' | null;

/** La prudence visuelle gagne toujours sur une ancienne commande prête. */
export function serviceBadgeTone({
  stale,
  partial,
  ready,
}: {
  stale: boolean;
  partial: boolean;
  ready: boolean;
}): ServiceBadgeTone {
  if (stale || partial) return 'warning';
  return ready ? 'ready' : null;
}
