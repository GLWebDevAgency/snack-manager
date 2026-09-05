import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import type { PaymentIntentResponse } from "@sm/contracts";
import { PAYMENT_VERIFICATION_MESSAGE, canRequestCounterPayment, checkoutPaymentDecision, paymentSummaryLabel, requestCounterPayment, requestExistingOrderPayment } from "./checkout-payment";
import { orderingApi } from "./api";

const order = { _id: "order-existing", trackingToken: "private-tracking-token" };
const ready: PaymentIntentResponse = {
  unavailable: false, clientSecret: "pi_same_secret", paymentIntentId: "pi_same",
  publishableKey: "pk_test_example", stripeAccount: "acct_restaurant", amount: 1250, currency: "eur",
};

describe("conversion explicite de la même commande au comptoir", () => {
  const pending = { status: "new", payment: { method: "online", status: "pending" } } as const;
  it("propose une demande seulement pour un retrait actif en attente de paiement online", () => {
    expect(canRequestCounterPayment(pending, "pickup")).toBe(true);
    expect(canRequestCounterPayment(pending, "delivery")).toBe(false);
    expect(canRequestCounterPayment(pending, undefined)).toBe(false);
    for (const status of ["paid", "refunded"] as const) expect(canRequestCounterPayment({ ...pending, payment: { method: "online", status } }, "pickup")).toBe(false);
    for (const status of ["cancelled", "delivered"] as const) expect(canRequestCounterPayment({ ...pending, status }, "pickup")).toBe(false);
    expect(canRequestCounterPayment({ ...pending, payment: undefined }, "pickup")).toBe(false);
    expect(canRequestCounterPayment({ ...pending, payment: { method: "counter", status: "pending" } }, "pickup")).toBe(false);
  });

  it("ne confirme qu’une réponse serveur counter/pending de la même commande", async () => {
    const confirmed = { _id: order._id, payment: { method: "counter", status: "pending" } } as const;
    const api = { switchToCounterPayment: vi.fn().mockResolvedValue(confirmed) };
    await expect(requestCounterPayment(api, order)).resolves.toEqual(confirmed);
    expect(api.switchToCounterPayment).toHaveBeenCalledWith(order._id, order.trackingToken);
    for (const response of [null, {}, { ...confirmed, _id: "another-order" }, { ...confirmed, payment: { method: "online", status: "pending" } }, { ...confirmed, payment: { method: "counter", status: "paid" } }]) {
      api.switchToCounterPayment.mockResolvedValue(response);
      await expect(requestCounterPayment(api, order)).rejects.toThrow(PAYMENT_VERIFICATION_MESSAGE);
    }
  });

  it("appelle uniquement la route dédiée avec le jeton encodé, et garde les refus 409 lisibles", async () => {
    const send = vi.fn().mockResolvedValue({ status: 409, body: { message: "Le paiement est en cours de confirmation." } });
    await expect(orderingApi({ send }).switchToCounterPayment("id/1", "secret+token")).rejects.toMatchObject({ status: 409, message: "Le paiement est en cours de confirmation." });
    expect(send).toHaveBeenCalledExactlyOnceWith({ method: "POST", path: "/public/orders/id%2F1/payment-counter?t=secret%2Btoken", body: {} });
  });
});

describe("libellé de paiement autoritaire", () => {
  it("ne transforme jamais un moyen online en paiement réussi", () => {
    const staleTicket = { method: "online", status: "pending", paid: false } as const;
    expect(paymentSummaryLabel(undefined, staleTicket)).toBe("Paiement en ligne à confirmer");
    expect(paymentSummaryLabel({ method: "online", status: "pending" }, { ...staleTicket, paid: true })).toBe("Paiement en ligne à confirmer");
    expect(paymentSummaryLabel({ method: "counter", status: "pending" }, staleTicket)).toBe("À régler au comptoir");
    expect(paymentSummaryLabel({ method: "online", status: "paid" }, staleTicket)).toBe("Payé en ligne");
    expect(paymentSummaryLabel({ method: "counter", status: "paid" }, staleTicket)).toBe("Payé au comptoir");
    expect(paymentSummaryLabel({ method: "online", status: "refunded" }, staleTicket)).toBe("Remboursé");
  });
});

describe("moyen autoritaire de la commande créée ou rejouée", () => {
  it.each(["new", "preparing", "ready"] as const)("confirme au comptoir seulement un paiement pending/counter et une commande %s", (status) => {
    expect(checkoutPaymentDecision({ status, payment: { method: "counter", status: "pending" } }, "counter")).toBe("counter");
  });

  it("ne remplace pas le paiement online d’un POST rejoué par le choix comptoir local", () => {
    expect(checkoutPaymentDecision({ status: "new", payment: { method: "online", status: "pending" } }, "counter")).toBe("online");
  });

  it("permet d’ouvrir le paiement online d’un retrait initialement créé au comptoir", () => {
    expect(checkoutPaymentDecision({ status: "new", payment: { method: "counter", status: "pending" } }, "online")).toBe("online");
  });

  it.each(["online", "counter"] as const)("n’annonce aucun paiement ni comptoir si une réponse ancienne omet payment, choix %s", (method) => {
    expect(checkoutPaymentDecision({ status: "new" }, method)).toBe("verify");
  });

  it.each(["paid", "refunded"] as const)("dirige vers la vérification une commande déjà %s, jamais vers un second encaissement", (status) => {
    expect(checkoutPaymentDecision({ status: "new", payment: { method: "counter", status } }, "counter")).toBe("verify");
    expect(checkoutPaymentDecision({ status: "new", payment: { method: "online", status } }, "online")).toBe("verify");
  });

  it.each(["cancelled", "delivered"] as const)("ne réouvre pas une commande terminale %s même si son ancien paiement était pending/counter", (status) => {
    expect(checkoutPaymentDecision({ status, payment: { method: "counter", status: "pending" } }, "counter")).toBe("verify");
  });
});

describe("reprise du paiement de la commande existante", () => {
  it("rend uniquement une intention exploitable sur le compte du restaurant", async () => {
    const api = { createPaymentIntent: vi.fn().mockResolvedValue(ready) };
    await expect(requestExistingOrderPayment(api, order)).resolves.toEqual(ready);
    expect(api.createPaymentIntent).toHaveBeenCalledWith(order._id, order.trackingToken);
  });

  it.each([
    { unavailable: true, permanent: false, reason: "Vérification bancaire en cours" },
    { unavailable: true, permanent: true, reason: "Stripe indisponible" },
    { ...ready, publishableKey: null },
  ] satisfies PaymentIntentResponse[])("ne transforme pas une réponse inutilisable en règlement comptoir : %j", async (response) => {
    const api = { createPaymentIntent: vi.fn().mockResolvedValue(response) };
    await expect(requestExistingOrderPayment(api, order)).rejects.toThrow(PAYMENT_VERIFICATION_MESSAGE);
    expect(api.createPaymentIntent).toHaveBeenCalledOnce();
  });

  it("après une réponse perdue, réessaie la même commande avec le même jeton sans recréer de panier", async () => {
    const api = { createPaymentIntent: vi.fn()
      .mockRejectedValueOnce(new Error("Réponse perdue après effet bancaire"))
      .mockResolvedValueOnce(ready) };
    await expect(requestExistingOrderPayment(api, order)).rejects.toThrow(PAYMENT_VERIFICATION_MESSAGE);
    await expect(requestExistingOrderPayment(api, order)).resolves.toEqual(ready);
    expect(api.createPaymentIntent.mock.calls).toEqual([
      [order._id, order.trackingToken], [order._id, order.trackingToken],
    ]);
  });

  it("conserve la raison d’indisponibilité sans la présenter comme un accord comptoir", async () => {
    const api = { createPaymentIntent: vi.fn().mockResolvedValue({ unavailable: true, permanent: true, reason: "Le restaurant n’a pas configuré le paiement en ligne." }) };
    await expect(requestExistingOrderPayment(api, order)).rejects.toThrow("Le restaurant n’a pas configuré le paiement en ligne.");
    await expect(requestExistingOrderPayment(api, order)).rejects.toThrow(PAYMENT_VERIFICATION_MESSAGE);
  });

  it.each([null, undefined, {}, { ...ready, clientSecret: "" }, { ...ready, stripeAccount: "" }])(
    "garde la même consigne de vérification si la réponse est absente ou incomplète : %j", async (response) => {
      const api = { createPaymentIntent: vi.fn().mockResolvedValue(response) };
      await expect(requestExistingOrderPayment(api, order)).rejects.toThrow(PAYMENT_VERIFICATION_MESSAGE);
    },
  );
});

// Barrière d'architecture complémentaire aux interactions navigateur : aucun
// consommateur ne peut réintroduire une confirmation comptoir après Stripe.
describe("contrat de l’écran bancaire", () => {
  it("ne fournit plus de sortie qui feint un abandon bancaire confirmé", () => {
    for (const name of ["Checkout.tsx", "StripeCard.tsx", "Tracking.tsx"]) {
      const source = readFileSync(new URL(name, import.meta.url), "utf8");
      expect(source, name).not.toMatch(/onGiveUp|allowCounterFallback|downgraded|setDowngraded/);
    }
  });

  it("n’annonce pas un refus bancaire sur une erreur dont l’issue est inconnue", () => {
    const source = readFileSync(new URL("StripeCard.tsx", import.meta.url), "utf8");
    expect(source).not.toContain('title="Paiement refusé"');
    expect(source).toContain("Suivre ma commande");
  });
});
