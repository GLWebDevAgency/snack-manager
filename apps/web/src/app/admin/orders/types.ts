/**
 * Vue « Commandes live » — types & helpers partagés (spec backoffice §6).
 * La forme `Order` reflète le document Mongo renvoyé par GET /orders
 * (montants TOUJOURS en centimes, dates sérialisées en ISO).
 */

import type {
  OrderChannel,
  OrderStatus,
  OrderType,
  PaymentMethod,
  PaymentStatus,
  OrderDelivery,
} from "@sm/contracts";

export type OrderLine = {
  productId: string;
  /** Nom dénormalisé — le ticket survit aux edits du menu. */
  name: string;
  variantKey: string | null;
  variantName: string | null;
  options: { groupKey: string; choiceKey: string; name: string; priceDelta: number }[];
  removed: string[];
  note: string | null;
  qty: number;
  unitPrice: number;
  lineTotal: number;
};

export type Order = {
  _id: string;
  /** N° de retrait — séquence journalière par tenant. */
  number: number;
  clientId: string;
  channel: OrderChannel;
  type: OrderType;
  lines: OrderLine[];
  totals: {
    subtotal: number;
    discount: { amount: number; reason?: string } | null;
    total: number;
    deliveryFee?: number;
  };
  payment: {
    method: PaymentMethod; status: PaymentStatus;
    stripePaymentIntentId?: string | null;
    refundedCents?: number;
    pendingRefundCents?: number;
  };
  delivery?: OrderDelivery | null;
  status: OrderStatus;
  statusHistory: { status: string; at: string; by?: string }[];
  pickup: { slot: string; customerName: string; customerPhone: string | null } | null;
  note: string | null;
  createdAt: string;
  updatedAt: string;
};

export const CHANNEL_LABELS: Record<OrderChannel, string> = {
  online: "En ligne",
  phone: "Téléphone",
  pos: "Caisse",
};

export const TYPE_LABELS: Record<OrderType, string> = {
  surplace: "Sur place",
  emporter: "À emporter",
  pickup: "Retrait",
  delivery: "Livraison",
};

/** Étape suivante du flux new → preparing → ready → delivered (absent = terminal). */
export const NEXT_STATUS: Partial<Record<OrderStatus, OrderStatus>> = {
  new: "preparing",
  preparing: "ready",
  ready: "delivered",
};

/** Aide d'interface ; l'API reste l'autorité sur le paiement, le rôle et le départ. */
export function canAdvanceOrder(order: {
  status: OrderStatus; type: OrderType; payment: { status: PaymentStatus };
  delivery?: { dispatchedAt?: string | null } | null;
}, role: string | null): boolean {
  if (!NEXT_STATUS[order.status] || order.payment.status === "refunded") return false;
  if (order.type !== "delivery") return true;
  if (order.payment.status !== "paid") return false;
  return order.status !== "ready" || Boolean(order.delivery?.dispatchedAt)
    || ["owner", "gerant", "cogerant", "caisse"].includes(role ?? "");
}

/** Libellé du bouton d'avancement selon le statut courant (spec §6.2) — toujours un verbe. */
export const ADVANCE_LABELS: Partial<Record<OrderStatus, string>> = {
  new: "Accepter",
  preparing: "Marquer prête",
  ready: "Remettre",
};

export const isPaid = (o: Order) => o.payment.status === "paid";

/** Heure locale « HH:MM » d'une date ISO. */
export const timeHHMM = (d: string | Date) =>
  new Date(d).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });

/** Créneau de retrait « HH:MM », null si la commande n'a pas de retrait. */
export const slotHHMM = (o: Order) => (o.pickup?.slot ? timeHHMM(o.pickup.slot) : null);

/** Nom client affiché (repli lisible pour les commandes comptoir sans nom). */
export const customerName = (o: Order) =>
  o.pickup?.customerName?.trim() ||
  (o.channel === "pos" ? "Client comptoir" : "Client");

/** Identifiant court affiché/recherché (6 derniers caractères de l'_id). */
export const shortId = (o: Order) => o._id.slice(-6).toUpperCase();

/** « 2× Tacos L, 1× Coca » tronqué à `max` caractères (spec §6.2 : 44). */
export function linesSummary(o: Order, max = 44): string {
  const s = o.lines
    .map((l) => (l.qty > 0 ? `${l.qty}× ${l.name}` : l.name))
    .join(", ");
  return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s;
}

/** Clé de recherche client-side : nom + id (long et court) + n° retrait (§6.1). */
export const searchKey = (o: Order) =>
  `${customerName(o)} ${o._id} ${shortId(o)} ${o.number}`.toLowerCase();
