import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { DeliveryQuote } from "@sm/contracts";
import { activeCheckoutDeliveryQuote, checkoutDeliveryQuoteKey, checkoutDeliveryQuoteReducer, type CheckoutDeliveryQuoteState } from "./Checkout";
import { DeliveryFields } from "./DeliveryFields";
import type { CartLine } from "./cart";

vi.mock("@/components/masque/polices", () => ({ classesPolices: "font-fixture" }));

const quote: DeliveryQuote = { zoneId: "centre", zoneName: "Centre", feeCents: 250,
  minimumOrderCents: 1500, subtotalCents: 2000, totalCents: 2250, estimatedMinutes: 45 };
const ready: CheckoutDeliveryQuoteState = { status: "ready", requestId: 1, key: "panier-A", value: quote };

describe("devis effectivement applicable au checkout", () => {
  it("n’affiche jamais les frais d’un ancien devis lorsque le client choisit le retrait", () => {
    expect(activeCheckoutDeliveryQuote(ready, false, "panier-A")).toBeNull();
  });
  it("ne réutilise que le devis terminé du panier et de l’adresse courants", () => {
    expect(activeCheckoutDeliveryQuote(ready, true, "panier-A")).toBe(quote);
    expect(activeCheckoutDeliveryQuote(ready, true, "panier-B")).toBeNull();
  });
  it.each(["pending", "error"] as const)("ne propose aucun total serveur en état %s", (status) => {
    const state: CheckoutDeliveryQuoteState = status === "pending"
      ? { status, requestId: 2, key: "panier-A" }
      : { status, requestId: 2, key: "panier-A", message: "Indisponible" };
    expect(activeCheckoutDeliveryQuote(state, true, "panier-A")).toBeNull();
  });
});

describe("réponses de devis concurrentes et invalidation", () => {
  it("retire immédiatement le devis précédent pendant sa revérification", () => {
    const state = checkoutDeliveryQuoteReducer(ready, { type: "start", requestId: 2, key: "panier-A" });
    expect(activeCheckoutDeliveryQuote(state, true, "panier-A")).toBeNull();
    expect(state?.status).toBe("pending");
  });
  it("ne restaure pas un ancien résultat après livraison → retrait → livraison", () => {
    let state = checkoutDeliveryQuoteReducer(null, { type: "start", requestId: 1, key: "panier-A" });
    state = checkoutDeliveryQuoteReducer(state, { type: "invalidate" });
    state = checkoutDeliveryQuoteReducer(state, { type: "resolve", requestId: 1, key: "panier-A", value: quote });
    expect(activeCheckoutDeliveryQuote(state, true, "panier-A")).toBeNull();
    expect(state).toBeNull();
  });
  it("n’autorise pas la réponse du panier précédent à écraser la nouvelle requête", () => {
    let state = checkoutDeliveryQuoteReducer(null, { type: "start", requestId: 1, key: "panier-A" });
    state = checkoutDeliveryQuoteReducer(state, { type: "start", requestId: 2, key: "panier-B" });
    state = checkoutDeliveryQuoteReducer(state, { type: "resolve", requestId: 1, key: "panier-A", value: quote });
    expect(state).toEqual({ status: "pending", requestId: 2, key: "panier-B" });
    const newer = { ...quote, subtotalCents: 3000, totalCents: 3250 };
    state = checkoutDeliveryQuoteReducer(state, { type: "resolve", requestId: 2, key: "panier-B", value: newer });
    state = checkoutDeliveryQuoteReducer(state, { type: "reject", requestId: 1, key: "panier-A", message: "Ancien échec" });
    expect(activeCheckoutDeliveryQuote(state, true, "panier-B")).toBe(newer);
  });
  it("ne conserve aucun total exploitable après l’échec de la demande courante", () => {
    let state = checkoutDeliveryQuoteReducer(ready, { type: "start", requestId: 2, key: "panier-A" });
    state = checkoutDeliveryQuoteReducer(state, { type: "reject", requestId: 2, key: "panier-A", message: "Minimum non atteint" });
    expect(activeCheckoutDeliveryQuote(state, true, "panier-A")).toBeNull();
    expect(state?.status).toBe("error");
  });
});

const line: CartLine = { lineId: "line", productId: "kebab", name: "Kebab", photoUrl: null,
  variantKey: null, variantName: null, options: [], removed: [], note: null, qty: 2, unitPrice: 1000 };
const input = { slug: "classfood", fulfillment: "delivery" as const, promoCode: "BIENVENUE10", lines: [line],
  address: { line1: "12 rue des Fleurs", postalCode: "69001", city: "Lyon", country: "FR" as const } };

describe("identité du devis : tout ce qui détermine sa validité", () => {
  it.each([
    { ...input, fulfillment: "pickup" as const },
    { ...input, slug: "autre-restaurant" },
    { ...input, promoCode: "AUTRE" },
    { ...input, address: { ...input.address, postalCode: "69002" } },
    { ...input, lines: [{ ...line, qty: 3 }] },
    { ...input, lines: [{ ...line, removed: ["crudites"] }] },
    { ...input, lines: [{ ...line, variantKey: "grand" }] },
    { ...input, lines: [{ ...line, unitPrice: 1100 }] },
    { ...input, lines: [{ ...line, options: [{ groupKey: "supplements", groupName: "Suppléments", choiceKey: "bacon", name: "Bacon", priceDelta: 100 }] }] },
  ])("invalide le résultat lorsque l’entrée change : %j", (changed) => {
    expect(checkoutDeliveryQuoteKey(changed)).not.toBe(checkoutDeliveryQuoteKey(input));
  });
  it("normalise le code promo de la même manière que la requête envoyée", () => {
    expect(checkoutDeliveryQuoteKey({ ...input, promoCode: " bienvenue10 " })).toBe(checkoutDeliveryQuoteKey(input));
  });
});

describe("affichage de la proposition serveur avec remise", () => {
  it("présente les produits nets, frais et total sans appliquer deux fois la remise", () => {
    const discounted = { ...quote, originalSubtotalCents: 2000, subtotalCents: 1800,
      discount: { amount: 200, reason: "Bienvenue" }, totalCents: 2050 };
    const html = renderToStaticMarkup(createElement(DeliveryFields, {
      address: input.address, instructions: "", quote: discounted, busy: false, error: null,
      onAddress: vi.fn(), onInstructions: vi.fn(), onVerify: vi.fn(),
    }));
    expect(html).toContain("Bienvenue");
    expect(html).toContain("Produits après remise");
    for (const amount of ["18,00", "2,50", "20,50"]) expect(html).toContain(amount);
    expect(html).not.toContain("18,50");
    expect(html).toContain("Prix et disponibilité de l’offre revérifiés à la validation");
  });

  it("affiche Offerts à partir des frais effectifs nuls, sans inventer de montant", () => {
    const free = { ...quote, feeCents: 0, standardFeeCents: 500, freeDeliveryFromCents: 3000,
      remainingForFreeDeliveryCents: 0, subtotalCents: 3000, totalCents: 3000 };
    const html = renderToStaticMarkup(createElement(DeliveryFields, {
      address: input.address, instructions: "", quote: free, busy: false, error: null,
      onAddress: vi.fn(), onInstructions: vi.fn(), onVerify: vi.fn(),
    }));
    expect(html).toContain("Offerts");
    expect(html).toContain("30,00");
    expect(html).not.toContain("Il manque");
    expect(html).not.toContain("35,00");
  });

  it("utilise le complément serveur calculé après remise, même à un centime du seuil", () => {
    const below = { ...quote, feeCents: 500, standardFeeCents: 500, freeDeliveryFromCents: 3000,
      remainingForFreeDeliveryCents: 1, originalSubtotalCents: 3199, discount: { amount: 200, reason: "Bienvenue" },
      subtotalCents: 2999, totalCents: 3499 };
    const html = renderToStaticMarkup(createElement(DeliveryFields, {
      address: input.address, instructions: "", quote: below, busy: false, error: null,
      onAddress: vi.fn(), onInstructions: vi.fn(), onVerify: vi.fn(),
    }));
    expect(html).toContain("Il manque");
    expect(html).toContain("0,01");
    expect(html).toContain("après remise pour la livraison offerte");
    expect(html).toContain("34,99");
    expect(html).not.toContain("Offerts");
  });
});
