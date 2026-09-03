import type { Order } from "./types";

export type OrdersListResponse = {
  rows: Order[];
  total: number;
  truncated?: boolean;
};

export type OrdersListSnapshot = {
  rows: Order[];
  /** Nombre exact de commandes correspondant à la requête, côté serveur. */
  total: number;
  /** `true` quand `rows` n'est qu'une fenêtre des commandes correspondantes. */
  truncated: boolean;
};

/** Même plafond que `GET /orders` ; la fenêtre locale ne le dépasse jamais. */
export const ORDERS_WINDOW_MAX = 200;

export type OrdersListMutation =
  | { kind: "created"; order: Order }
  | { kind: "replaced"; order: Order }
  | { kind: "patched"; orderId: string; patch: Partial<Order> };

/**
 * Normalise aussi l'ancien tableau nu pour qu'un déploiement roulant ne fasse
 * pas disparaître l'écran pendant les quelques secondes où web et API peuvent
 * servir deux versions voisines.
 */
export function normalizeOrdersList(
  response: OrdersListResponse | Order[],
): OrdersListSnapshot {
  if (Array.isArray(response)) {
    return { rows: response, total: response.length, truncated: false };
  }

  const rows = Array.isArray(response?.rows) ? response.rows : [];
  const reportedTotal = response?.total;
  const total =
    typeof reportedTotal === "number" &&
    Number.isSafeInteger(reportedTotal) &&
    reportedTotal >= rows.length
      ? reportedTotal
      : rows.length;

  return {
    rows,
    total,
    // Le total suffit à détecter une coupe même face à une API intermédiaire
    // qui ne servirait pas encore le booléen pendant un déploiement roulant.
    truncated: response?.truncated === true || total > rows.length,
  };
}

/** Un compteur de statut sur une fenêtre tronquée est un minimum, jamais un total. */
export function loadedStatusCountLabel(count: number, truncated: boolean): string {
  return truncated ? `≥ ${count}` : String(count);
}

/**
 * Applique un fait plus récent à une fenêtre issue du serveur.
 *
 * Cette fonction sert autant à l'affichage immédiat qu'au rejeu des faits
 * arrivés pendant un GET : un snapshot pris avant un événement ne peut donc
 * jamais faire disparaître cet événement lorsqu'il revient plus tard.
 */
export function applyOrdersListMutation(
  snapshot: OrdersListSnapshot,
  mutation: OrdersListMutation,
): OrdersListSnapshot {
  if (mutation.kind === "created") {
    const index = snapshot.rows.findIndex((order) => order._id === mutation.order._id);
    if (index >= 0) {
      const rows = [...snapshot.rows];
      rows[index] = mutation.order;
      return { ...snapshot, rows };
    }

    const total = snapshot.total + 1;
    const rows = [mutation.order, ...snapshot.rows].slice(0, ORDERS_WINDOW_MAX);
    return {
      rows,
      total,
      truncated: snapshot.truncated || total > rows.length,
    };
  }

  const index = snapshot.rows.findIndex((order) =>
    order._id ===
    (mutation.kind === "replaced" ? mutation.order._id : mutation.orderId),
  );
  if (index < 0) return snapshot;

  const rows = [...snapshot.rows];
  rows[index] =
    mutation.kind === "replaced"
      ? mutation.order
      : { ...rows[index]!, ...mutation.patch };
  return { ...snapshot, rows };
}

/** Rejoue dans l'ordre tous les faits survenus après la prise du snapshot. */
export function applyOrdersListMutations(
  snapshot: OrdersListSnapshot,
  mutations: readonly OrdersListMutation[],
): OrdersListSnapshot {
  return mutations.reduce(applyOrdersListMutation, snapshot);
}
