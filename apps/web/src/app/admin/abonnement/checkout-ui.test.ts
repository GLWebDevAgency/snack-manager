import { describe, expect, it } from "vitest";
import type { CrmInvoice } from "@sm/contracts";
import { canPayInvoice, safeCheckoutUrl } from "./checkout-ui";

const invoice = (over: Partial<CrmInvoice> = {}) => ({ kind: "abonnement", status: "envoyee", issuedAt: "2026-09-05T10:00:00Z", totals: { ttcCents: 4680 }, ...over }) as CrmInvoice;

describe("paiement d'une facture dans le back-office", () => {
  it("propose les factures émises dues et non les brouillons, avoirs ou pièces réglées", () => {
    expect(canPayInvoice(invoice())).toBe(true);
    expect(canPayInvoice(invoice({ status: "en_retard" }))).toBe(true);
    for (const status of ["brouillon", "payee", "annulee"] as const) expect(canPayInvoice(invoice({ status }))).toBe(false);
    expect(canPayInvoice(invoice({ kind: "avoir" }))).toBe(false);
    expect(canPayInvoice(invoice({ issuedAt: null }))).toBe(false);
    expect(canPayInvoice(invoice({ totals: undefined }))).toBe(false);
  });

  it("accepte uniquement le Checkout HTTPS hébergé Stripe", () => {
    expect(safeCheckoutUrl("https://checkout.stripe.com/c/pay/test")).toBe("https://checkout.stripe.com/c/pay/test");
    for (const value of ["http://checkout.stripe.com", "https://checkout.stripe.com.evil.example", "https://user@checkout.stripe.com", "javascript:alert(1)"]) {
      expect(() => safeCheckoutUrl(value)).toThrow();
    }
  });
});
