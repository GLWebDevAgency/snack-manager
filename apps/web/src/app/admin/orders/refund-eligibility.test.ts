import { describe, expect, it } from "vitest";
import { hasOnlinePaymentToRefund, isConfirmedFreeOrder } from "./refund-eligibility";

describe("online refund eligibility", () => {
  it.each(["pending", "paid", "refunded"])("never refunds a counter payment %s using its retained intent", (status) => {
    expect(hasOnlinePaymentToRefund({ method: "counter", status, stripePaymentIntentId: "pi_canceled" })).toBe(false);
  });
  it.each(["paid", "refunded"])("allows an online payment %s with an intent", (status) => {
    expect(hasOnlinePaymentToRefund({ method: "online", status, stripePaymentIntentId: "pi_paid" })).toBe(true);
  });
  it("requires a confirmed payment and the provider reference", () => {
    expect(hasOnlinePaymentToRefund({ method: "online", status: "pending", stripePaymentIntentId: "pi_pending" })).toBe(false);
    expect(hasOnlinePaymentToRefund({ method: "online", status: "paid" })).toBe(false);
  });
  it.each(["online", "counter"])("recognizes a confirmed explicit zero total via %s without a provider payment", method => {
    expect(isConfirmedFreeOrder({ totals: { total: 0 }, payment: { method, status: "paid" } })).toBe(true);
    expect(isConfirmedFreeOrder({ totals: { total: 0 }, payment: { method, status: "paid", stripePaymentIntentId: null,
      refundedCents: 0, pendingRefundCents: 0 } })).toBe(true);
  });
  it.each([undefined, null, "0", NaN, -1, 150])("does not turn an absent or nonzero total %s into a free order", total => {
    expect(isConfirmedFreeOrder({ totals: { total }, payment: { method: "online", status: "paid" } })).toBe(false);
  });
  it("requires settlement and keeps contradictory provider or refund evidence visible", () => {
    expect(isConfirmedFreeOrder({ payment: { method: "online", status: "paid" } })).toBe(false);
    for (const payment of [undefined, { method: "online", status: "pending" }, { method: "online", status: "refunded" },
      { method: "unknown", status: "paid" }, { method: "online", status: "paid", stripePaymentIntentId: "pi_paid" },
      { method: "online", status: "paid", refundedCents: 150 }, { method: "online", status: "paid", pendingRefundCents: 150 }]) {
      expect(isConfirmedFreeOrder({ totals: { total: 0 }, payment })).toBe(false);
    }
  });
});
