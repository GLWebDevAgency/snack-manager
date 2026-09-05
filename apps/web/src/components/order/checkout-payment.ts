import type { CounterPaymentResponse, Fulfillment, PaymentIntentResponse, PaymentMethod, PaymentStatus } from "@sm/contracts";
import type { CreatedOrder, OrderingApi } from "./api";

export const PAYMENT_VERIFICATION_MESSAGE =
  "Votre commande est enregistrée, mais la confirmation du paiement reste à vérifier. Réessayez sur cette commande ou consultez son suivi. Ne payez pas une deuxième fois.";

type ReadyOrderPayment = Extract<PaymentIntentResponse, { unavailable: false }> & { publishableKey: string };

/** Présentation seulement : le serveur vérifie et ferme l'intention bancaire. */
export function canRequestCounterPayment(
  order: Pick<CreatedOrder, "status" | "payment">,
  fulfillment: Fulfillment | undefined,
): boolean {
  return fulfillment === "pickup" && ["new", "preparing", "ready"].includes(order.status)
    && order.payment?.method === "online" && order.payment.status === "pending";
}

export function paymentSummaryLabel(
  payment: { method: PaymentMethod; status: PaymentStatus } | undefined,
  ticket?: { method: PaymentMethod; status: PaymentStatus; paid: boolean },
): string {
  const source = payment ?? ticket;
  if (!source) return "Paiement à vérifier";
  if (source.status === "paid") return source.method === "online" ? "Payé en ligne" : "Payé au comptoir";
  if (source.status === "refunded") return "Remboursé";
  return source.method === "counter" ? "À régler au comptoir" : "Paiement en ligne à confirmer";
}

/** Une confirmation locale ou un timeout ne valent jamais accord comptoir. */
export async function requestCounterPayment(
  api: Pick<OrderingApi, "switchToCounterPayment">,
  order: Pick<CreatedOrder, "_id" | "trackingToken">,
): Promise<CounterPaymentResponse> {
  const response = await api.switchToCounterPayment(order._id, order.trackingToken);
  if (response?._id !== order._id || response.payment?.method !== "counter" || response.payment.status !== "pending") {
    throw new Error(PAYMENT_VERIFICATION_MESSAGE);
  }
  return response;
}

/** Le choix local ne peut pas réécrire le moyen d'une commande déjà créée. */
export function checkoutPaymentDecision(
  order: Pick<CreatedOrder, "status" | "payment">,
  chosenMethod: "online" | "counter",
): "counter" | "online" | "verify" {
  if (!["new", "preparing", "ready"].includes(order.status) || order.payment?.status !== "pending") return "verify";
  if (order.payment.method === "online") return "online";
  if (order.payment.method === "counter") return chosenMethod === "counter" ? "counter" : "online";
  return "verify";
}

/**
 * Toute demande peut avoir atteint Stripe, même sans réponse. La seule reprise
 * autorisée désigne la même commande ; aucun résultat ne vaut accord comptoir.
 */
export async function requestExistingOrderPayment(
  api: Pick<OrderingApi, "createPaymentIntent">,
  order: Pick<CreatedOrder, "_id" | "trackingToken">,
): Promise<ReadyOrderPayment> {
  let response: PaymentIntentResponse;
  try {
    response = await api.createPaymentIntent(order._id, order.trackingToken);
  } catch {
    throw new Error(PAYMENT_VERIFICATION_MESSAGE);
  }
  if (response?.unavailable === true && typeof response.reason === "string" && response.reason.trim()) {
    throw new Error(`${response.reason.trim()} ${PAYMENT_VERIFICATION_MESSAGE}`);
  }
  if (!response || response.unavailable !== false ||
    typeof response.publishableKey !== "string" || !response.publishableKey ||
    typeof response.clientSecret !== "string" || !response.clientSecret ||
    typeof response.stripeAccount !== "string" || !response.stripeAccount ||
    typeof response.paymentIntentId !== "string" || !response.paymentIntentId ||
    response.currency !== "eur" || !Number.isSafeInteger(response.amount) || response.amount <= 0) {
    throw new Error(PAYMENT_VERIFICATION_MESSAGE);
  }
  return { ...response, publishableKey: response.publishableKey };
}
