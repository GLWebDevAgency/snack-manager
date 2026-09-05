import { describe, expect, it } from "vitest";
import { canAdvanceOrder } from "./types";

const ready = { status: "ready", type: "delivery", payment: { status: "paid" } } as const;

describe("avancement des livraisons dans le back-office", () => {
  it.each(["owner", "gerant", "cogerant", "caisse"])("autorise le départ au rôle %s", (role) => {
    expect(canAdvanceOrder(ready, role)).toBe(true);
  });
  it.each(["cuisine", "comptable", null])("refuse le départ au rôle %s", (role) => {
    expect(canAdvanceOrder(ready, role)).toBe(false);
  });
  it("exige le paiement et conserve les états terminaux", () => {
    expect(canAdvanceOrder({ ...ready, payment: { status: "pending" } }, "owner")).toBe(false);
    expect(canAdvanceOrder({ ...ready, payment: { status: "refunded" } }, "owner")).toBe(false);
    expect(canAdvanceOrder({ ...ready, status: "delivered" }, "owner")).toBe(false);
    expect(canAdvanceOrder({ ...ready, status: "cancelled" }, "owner")).toBe(false);
  });
  it("permet la confirmation après départ et conserve le retrait au comptoir", () => {
    expect(canAdvanceOrder({ ...ready, delivery: { dispatchedAt: "2026-09-05T10:00:00Z" } }, "cuisine")).toBe(true);
    expect(canAdvanceOrder({ ...ready, type: "pickup", payment: { status: "pending" } }, "caisse")).toBe(true);
  });
});
