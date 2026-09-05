import { ACTIVE_ORDER_STATUSES, type ActiveOrderStatus, type ServiceProjection } from './service-reconciliation';
import type { ServerOrderRow } from './service-state';

export function isCounterHandoverRole(role: string): boolean {
  return ['owner', 'gerant', 'cogerant', 'caisse'].includes(role);
}

/** Remettre n'encaisse jamais : le paiement a son propre parcours. */
export function canConfirmCounterHandover(row: ServerOrderRow): boolean {
  return row.status === 'ready' && row.payment?.status === 'paid'
    && ['pickup', 'surplace', 'emporter'].includes(row.type ?? '');
}

export async function confirmCounterHandover(
  row: ServerOrderRow,
  send: (id: string, status: 'delivered') => Promise<ServerOrderRow>,
): Promise<ServerOrderRow> {
  if (!canConfirmCounterHandover(row)) throw new Error('La commande doit être prête et payée avant la remise au comptoir.');
  const confirmed = await send(row._id, 'delivered');
  if (confirmed._id !== row._id || confirmed.status !== 'delivered') {
    throw new Error('Le serveur n’a pas confirmé la remise. Actualisez la vue avant de réessayer.');
  }
  return confirmed;
}

/** Projection locale d'un fait serveur, jamais un avancement optimiste. */
export function applyConfirmedHandover(projection: ServiceProjection, confirmed: ServerOrderRow): ServiceProjection {
  if (confirmed.status !== 'delivered') return projection;
  const previous = projection.rows.find((row) => row._id === confirmed._id);
  if (!previous) return projection;
  const rows = projection.rows.filter((row) => row._id !== confirmed._id);
  const statusCounts = { ...projection.statusCounts };
  if (ACTIVE_ORDER_STATUSES.includes(previous.status as ActiveOrderStatus)) {
    const status = previous.status as ActiveOrderStatus;
    statusCounts[status] = { ...statusCounts[status], value: Math.max(0, statusCounts[status].value - 1) };
  }
  return {
    ...projection,
    rows,
    statusCounts,
    activeCount: Math.max(rows.length, ...ACTIVE_ORDER_STATUSES.map((status) => statusCounts[status].value)),
    readyCount: statusCounts.ready.value,
  };
}
