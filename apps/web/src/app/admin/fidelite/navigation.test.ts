import { describe, expect, it } from "vitest";
import { LOYALTY_NAVIGATION, isLoyaltyRouteActive } from "./navigation";

describe("navigation fidélité", () => {
  it("expose les quatre destinations manager dans l'ordre", () => {
    expect(LOYALTY_NAVIGATION.map(({ href }) => href)).toEqual([
      "/admin/fidelite",
      "/admin/fidelite/programme",
      "/admin/fidelite/recompenses",
      "/admin/fidelite/clients",
    ]);
  });

  it("ne garde la vue d'ensemble active que sur la racine", () => {
    expect(isLoyaltyRouteActive("/admin/fidelite", LOYALTY_NAVIGATION[0])).toBe(true);
    expect(
      isLoyaltyRouteActive("/admin/fidelite/programme", LOYALTY_NAVIGATION[0]),
    ).toBe(false);
  });

  it("active une section sur ses routes descendantes", () => {
    expect(
      isLoyaltyRouteActive(
        "/admin/fidelite/clients/123",
        LOYALTY_NAVIGATION[3],
      ),
    ).toBe(true);
  });
});
