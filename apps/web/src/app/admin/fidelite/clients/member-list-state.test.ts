import type { LoyaltyMemberSummary } from "@sm/contracts";
import { describe, expect, it } from "vitest";
import { reconcileLoyaltyMemberList } from "./member-list-state";

const member = (
  id: string,
  status: LoyaltyMemberSummary["status"],
): LoyaltyMemberSummary => ({
  id,
  alias: `Carte ${id.slice(0, 4)}`,
  maskedPhone: null,
  status,
  balanceUnits: 0,
  lifetimeEarnedUnits: 0,
  lifetimeRedeemedUnits: 0,
  lastActivityAt: null,
  joinedAt: "2026-09-01T10:00:00.000Z",
});

describe("réconciliation de la liste fidélité filtrée", () => {
  it("retire immédiatement une carte qui sort du filtre courant", () => {
    const active = member("11111111-1111-4111-8111-111111111111", "active");
    const blocked = { ...active, status: "blocked" as const };

    expect(reconcileLoyaltyMemberList([active], blocked, "active")).toEqual([]);
  });

  it("insère une carte qui entre dans le filtre et met à jour sans doublon", () => {
    const first = member("11111111-1111-4111-8111-111111111111", "blocked");
    const second = member("22222222-2222-4222-8222-222222222222", "blocked");

    expect(reconcileLoyaltyMemberList([first], second, "blocked")).toEqual([second, first]);
    expect(
      reconcileLoyaltyMemberList([first, second], { ...second, balanceUnits: 12 }, "blocked"),
    ).toEqual([first, { ...second, balanceUnits: 12 }]);
  });

  it("conserve tous les états dans la vue globale", () => {
    const active = member("11111111-1111-4111-8111-111111111111", "active");
    const anonymized = { ...active, status: "anonymized" as const, alias: "Carte anonymisée" };

    expect(reconcileLoyaltyMemberList([active], anonymized, "all")).toEqual([anonymized]);
  });
});
