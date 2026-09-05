import { describe, expect, it } from "vitest";
import { hasOnlinePaymentToRefund } from "./refund-eligibility";

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
});
