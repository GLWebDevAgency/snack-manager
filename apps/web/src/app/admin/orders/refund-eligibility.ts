/** A retained, canceled Stripe intent is not a counter-payment receipt. */
export function hasOnlinePaymentToRefund(payment: {
  method: string;
  status: string;
  stripePaymentIntentId?: string | null;
}): boolean {
  return payment.method === "online" && ["paid", "refunded"].includes(payment.status)
    && Boolean(payment.stripePaymentIntentId);
}

/** Presentation only: missing legacy totals never mean a free order. */
export function isConfirmedFreeOrder(order: {
  totals?: { total?: unknown } | null;
  payment?: { method?: string; status?: string; stripePaymentIntentId?: string | null;
    refundedCents?: number | null; pendingRefundCents?: number | null } | null;
}): boolean {
  const payment = order.payment;
  return order.totals?.total === 0 && payment?.status === "paid"
    && ["online", "counter"].includes(payment.method ?? "")
    && payment.stripePaymentIntentId == null
    && (payment.refundedCents ?? 0) === 0 && (payment.pendingRefundCents ?? 0) === 0;
}
