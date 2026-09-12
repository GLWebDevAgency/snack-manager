import type { DiningSession } from '@sm/contracts';
import type { ServerOrderRow } from './service-state';

/** Précondition de présentation ; le serveur réarbitre toujours la clôture. */
export function canReleaseDiningSession(session: DiningSession | null, orders: readonly ServerOrderRow[] | null): boolean {
  if (!session || session.state !== 'open' || !orders || session.pendingOperationCount > 0
    || orders.length !== session.orderIds.length || new Set(orders.map((row) => row._id)).size !== orders.length
    || orders.some((row) => !session.orderIds.includes(row._id))) return false;
  return orders.every((row) => row.status === 'cancelled'
    || row.status === 'delivered' && ['paid', 'refunded'].includes(row.payment?.status ?? '')
    || row.status === 'ready' && !!row.dining?.servedAt && row.payment?.status === 'paid');
}
