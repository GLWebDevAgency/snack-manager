import { describe, expect, it, vi } from "vitest";
import { orderingApi } from "./api";

const identity = { clientId: "11111111-1111-4111-8111-111111111111", recoveryProof: "a".repeat(64) };
const payload = {
  ...identity,
  lines: [{ productId: "507f1f77bcf86cd799439011", qty: 1, options: [], removed: [] }],
  payment: { method: "online" as const },
  pickup: { slot: "2030-01-10T12:00:00.000Z", customerName: "Test", customerPhone: "0600000000" },
};

describe("récupération publique de la tentative", () => {
  it("transmet la preuve dans un corps POST, jamais dans l’URL ni par téléphone", async () => {
    const send = vi.fn().mockResolvedValue({ status: 200, body: { state: "pending" } });
    await expect(orderingApi({ send }).recoverOrder("restaurant/1", identity)).resolves.toEqual({ state: "pending" });
    expect(send).toHaveBeenCalledExactlyOnceWith({
      method: "POST", path: "/public/tenants/restaurant%2F1/orders/recovery", body: identity,
    });
  });

  it("ne transforme pas un 404 en refus définitif autorisant une nouvelle clé", async () => {
    const send = vi.fn().mockResolvedValue({ status: 404, body: { code: "ORDER_RECOVERY_NOT_FOUND", message: "Commande introuvable" } });
    await expect(orderingApi({ send }).recoverOrder("classfood", identity)).rejects.toMatchObject({
      status: 404, code: "ORDER_RECOVERY_NOT_FOUND", message: "Commande introuvable",
    });
  });

  it.each([null, {}, { state: "rejected" }, { state: "created", order: {} },
    { state: "rejected", code: "ORDER_ATTEMPT_REJECTED", reason: "invalid_order", message: "Refus", trackingToken: "unexpected" },
  ])("refuse une réponse de reprise invalide ou ambiguë %j", async (body) => {
    const send = vi.fn().mockResolvedValue({ status: 200, body });
    await expect(orderingApi({ send }).recoverOrder("classfood", identity)).rejects.toThrow();
    await expect(orderingApi({ send }).abandonOrderAttempt("classfood", payload)).rejects.toThrow();
  });

  it("confirme une fermeture de tentative avec le même corps et sans annuler une commande", async () => {
    const rejected = { state: "rejected", code: "ORDER_ATTEMPT_REJECTED", reason: "abandoned", message: "Demande fermée" };
    const send = vi.fn().mockResolvedValue({ status: 200, body: rejected });
    await expect(orderingApi({ send }).abandonOrderAttempt("classfood", payload)).resolves.toEqual(rejected);
    expect(send).toHaveBeenCalledExactlyOnceWith({ method: "POST", path: "/public/tenants/classfood/orders/abandon", body: payload });
  });

  it("l’abandon qui perd contre la création rend le reçu existant, sans seconde commande", async () => {
    const created = { state: "created", order: {
      _id: "507f1f77bcf86cd799439012", number: 2, status: "new", type: "pickup", trackingToken: "existing-token",
      payment: { method: "online", status: "pending" }, totals: { total: 1_000 }, pickup: { slot: payload.pickup.slot },
    } };
    const send = vi.fn().mockResolvedValue({ status: 200, body: created });
    await expect(orderingApi({ send }).abandonOrderAttempt("classfood", payload)).resolves.toEqual(created);
    expect(send).toHaveBeenCalledOnce();
  });
});
