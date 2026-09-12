import { mostAdvancedStatus, type Order, type OrderStatus } from '@sm/client-core';

/** La livraison exige le paiement ; une table déjà servie sort du passe,
 * même si son encaissement doit encore être confirmé par la caisse. */
export function isKitchenEligible(order: Pick<Order, 'type' | 'payment' | 'status' | 'dining'>): boolean {
  if (order.type === 'surplace' && order.status === 'ready' && order.dining?.servedAt) return false;
  return order.type !== 'delivery' || order.payment?.status === 'paid';
}

export function kitchenNextStatus(order: Order): OrderStatus | null {
  if (!isKitchenEligible(order)) return null;
  if (order.status === 'new') return 'preparing';
  if (order.status === 'preparing') return 'ready';
  // La remise physique appartient à la caisse ou au livreur, jamais au KDS.
  return null;
}

/** Livraison = réponse serveur autoritaire ; seul le retrait garde l'optimisme offline. */
export function reconcileKitchenRows(current: Order[], incoming: Order[]): Order[] {
  const previous = new Map(current.map((order) => [order._id, order]));
  // Une transition peut être présente dans deux lectures de statut. Une
  // information de remboursement l'emporte sur une ancienne photo payée.
  const ineligible = new Set(incoming.filter((order) => !isKitchenEligible(order)).map((order) => order._id));
  const unique = new Map<string, Order>();
  for (const order of incoming) {
    const duplicate = unique.get(order._id);
    unique.set(order._id, duplicate
      ? { ...duplicate, ...order, status: mostAdvancedStatus(duplicate.status, order.status) }
      : order);
  }
  return [...unique.values()].filter((order) => !ineligible.has(order._id)
    && ['new', 'preparing', 'ready'].includes(order.status))
    .map((order) => {
      const old = previous.get(order._id);
      return old && order.type !== 'delivery'
        ? { ...old, ...order, status: mostAdvancedStatus(old.status, order.status) }
        : order;
    });
}

/** Le callback d'affichage ne s'exécute JAMAIS si la requête est refusée. */
export async function advanceDeliveryConfirmed(
  order: Order,
  send: (id: string, status: OrderStatus) => Promise<Order>,
  commit: (order: Order) => void,
): Promise<void> {
  const next = kitchenNextStatus(order);
  if (!next) return;
  commit(await send(order._id, next));
}
