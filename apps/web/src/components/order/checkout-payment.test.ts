import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import type { PaymentIntentResponse } from "@sm/contracts";
import { PAYMENT_VERIFICATION_MESSAGE, checkoutPaymentDecision, requestExistingOrderPayment } from "./checkout-payment";

const order = { _id: "order-existing", trackingToken: "private-tracking-token" };
const ready: PaymentIntentResponse = {
  unavailable: false, clientSecret: "pi_same_secret", paymentIntentId: "pi_same",
  publishableKey: "pk_test_example", stripeAccount: "acct_restaurant", amount: 1250, currency: "eur",
};

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
