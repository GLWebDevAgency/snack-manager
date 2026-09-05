import type { PaymentIntentResponse } from "@sm/contracts";
import type { CreatedOrder, OrderingApi } from "./api";

export const PAYMENT_VERIFICATION_MESSAGE =
  "Votre commande est enregistrée, mais la confirmation du paiement reste à vérifier. Réessayez sur cette commande ou consultez son suivi. Ne payez pas une deuxième fois.";

type ReadyOrderPayment = Extract<PaymentIntentResponse, { unavailable: false }> & { publishableKey: string };

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
