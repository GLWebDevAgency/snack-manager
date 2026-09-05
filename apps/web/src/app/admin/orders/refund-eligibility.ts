/** A retained, canceled Stripe intent is not a counter-payment receipt. */
export function hasOnlinePaymentToRefund(payment: {
  method: string;
  status: string;
  stripePaymentIntentId?: string | null;
}): boolean {
  return payment.method === "online" && ["paid", "refunded"].includes(payment.status)
    && Boolean(payment.stripePaymentIntentId);
}
