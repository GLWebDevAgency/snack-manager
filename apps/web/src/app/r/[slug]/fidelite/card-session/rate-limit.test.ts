import { beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import {
  LOYALTY_CARD_READ_RATE_LIMIT,
  LOYALTY_CARD_READ_GLOBAL_RATE_LIMIT,
  LOYALTY_CARD_READ_SOURCE_RATE_LIMIT,
  LOYALTY_SESSION_INIT_CLIENT_RATE_LIMIT,
  LOYALTY_SESSION_INIT_GLOBAL_RATE_LIMIT,
  LOYALTY_SESSION_INIT_SOURCE_RATE_LIMIT,
  LOYALTY_SESSION_INIT_TOKEN_RATE_LIMIT,
  loyaltyCardQuotaBucketCountForTests,
  resetLoyaltyCardQuotaForTests,
  takeLoyaltyCardReadQuota,
  takeLoyaltySessionInitQuota,
  trustedLoyaltyClientIdentity,
} from "./rate-limit";

function request(realIp?: string, forwardedFor?: string) {
  const headers = new Headers();
  if (realIp) headers.set("X-Real-IP", realIp);
  if (forwardedFor) headers.set("X-Forwarded-For", forwardedFor);
  return new NextRequest("https://commande.example/r/classfood/fidelite", { headers });
}

function token(index: number): string {
  return `${"A".repeat(39)}${index.toString(36).padStart(4, "0")}`;
}

function clientIdentity(realIp: string): string {
  const identity = trustedLoyaltyClientIdentity(request(realIp));
  if (!identity) throw new Error(`Adresse de test invalide : ${realIp}`);
  return identity;
}

describe("budgets du relais de carte fidélité", () => {
  beforeEach(() => resetLoyaltyCardQuotaForTests());

  it("ne fait confiance qu’à l’adresse reconstruite par l’edge", () => {
    expect(
      trustedLoyaltyClientIdentity(request("203.0.113.9", "198.51.100.1")),
    ).toBe("edge-ip:203.0.113.9");
    expect(trustedLoyaltyClientIdentity(request(undefined, "198.51.100.1"))).toBeNull();
    expect(
      takeLoyaltySessionInitQuota(
        request(undefined, "198.51.100.1"),
        "classfood",
        token(1),
      ),
    ).toEqual({ allowed: false, reason: "unverified-client" });
  });

  it("laisse un NAT initialiser plus de dix cartes, sous plafond client et tenant", () => {
    const incoming = request("203.0.113.9");
    for (let index = 0; index < LOYALTY_SESSION_INIT_CLIENT_RATE_LIMIT; index += 1) {
      expect(
        takeLoyaltySessionInitQuota(incoming, "classfood", token(index)).allowed,
      ).toBe(true);
    }
    expect(
      takeLoyaltySessionInitQuota(incoming, "classfood", token(999)),
    ).toMatchObject({ allowed: false, reason: "rate-limited" });
    expect(
      takeLoyaltySessionInitQuota(request("203.0.113.10"), "classfood", token(999)).allowed,
    ).toBe(true);
  });

  it("borne un même secret même si l’appelant change d’IP", () => {
    for (let index = 0; index < LOYALTY_SESSION_INIT_TOKEN_RATE_LIMIT; index += 1) {
      expect(
        takeLoyaltySessionInitQuota(
          request(`203.0.113.${index + 1}`),
          "classfood",
          token(1),
        ).allowed,
      ).toBe(true);
    }
    expect(
      takeLoyaltySessionInitQuota(request("203.0.113.99"), "classfood", token(1)),
    ).toMatchObject({ allowed: false, reason: "rate-limited" });
  });

  it("bloque une rotation massive de tenants et secrets sans saturer les autres sources", () => {
    const attacker = request("203.0.113.9");
    for (let index = 0; index < LOYALTY_SESSION_INIT_SOURCE_RATE_LIMIT; index += 1) {
      expect(
        takeLoyaltySessionInitQuota(attacker, `restaurant-${index}`, token(index))
          .allowed,
      ).toBe(true);
    }

    const bucketsAtSourceLimit = loyaltyCardQuotaBucketCountForTests();
    expect(bucketsAtSourceLimit).toBeLessThan(500);
    for (
      let index = LOYALTY_SESSION_INIT_SOURCE_RATE_LIMIT;
      index < LOYALTY_SESSION_INIT_SOURCE_RATE_LIMIT + 5_000;
      index += 1
    ) {
      expect(
        takeLoyaltySessionInitQuota(attacker, `restaurant-${index}`, token(index)),
      ).toMatchObject({ allowed: false, reason: "rate-limited" });
    }
    expect(loyaltyCardQuotaBucketCountForTests()).toBe(bucketsAtSourceLimit);

    expect(
      takeLoyaltySessionInitQuota(
        request("203.0.113.10"),
        "restaurant-legitime",
        token(9_999),
      ).allowed,
    ).toBe(true);
  });

  it("applique un bucket process-global constant à travers sources et tenants", () => {
    for (let index = 0; index < LOYALTY_SESSION_INIT_GLOBAL_RATE_LIMIT; index += 1) {
      const thirdOctet = Math.floor(index / 250);
      const fourthOctet = (index % 250) + 1;
      expect(
        takeLoyaltySessionInitQuota(
          request(`198.51.${thirdOctet}.${fourthOctet}`),
          `restaurant-${index}`,
          token(index),
        ).allowed,
      ).toBe(true);
    }

    const bucketsAtGlobalLimit = loyaltyCardQuotaBucketCountForTests();
    expect(bucketsAtGlobalLimit).toBeLessThan(2_000);
    expect(
      takeLoyaltySessionInitQuota(
        request("192.0.2.1"),
        "nouveau-restaurant",
        token(10_000),
      ),
    ).toMatchObject({ allowed: false, reason: "rate-limited" });
    expect(loyaltyCardQuotaBucketCountForTests()).toBe(bucketsAtGlobalLimit);
  });

  it("isole les lectures par carte et du budget d’initialisation", () => {
    const reader = clientIdentity("203.0.113.9");
    for (let index = 0; index < LOYALTY_CARD_READ_RATE_LIMIT; index += 1) {
      expect(takeLoyaltyCardReadQuota("classfood", token(1), reader).allowed).toBe(
        true,
      );
    }
    expect(takeLoyaltyCardReadQuota("classfood", token(1), reader).allowed).toBe(
      false,
    );
    expect(takeLoyaltyCardReadQuota("classfood", token(2), reader).allowed).toBe(
      true,
    );
    expect(
      takeLoyaltySessionInitQuota(request("203.0.113.9"), "classfood", token(3)).allowed,
    ).toBe(true);
  });

  it("borne une rotation massive de lectures sans pénaliser une autre source", () => {
    const attacker = clientIdentity("203.0.113.9");
    for (let index = 0; index < LOYALTY_CARD_READ_SOURCE_RATE_LIMIT; index += 1) {
      expect(
        takeLoyaltyCardReadQuota(`restaurant-${index}`, token(index), attacker)
          .allowed,
      ).toBe(true);
    }

    const bucketsAtSourceLimit = loyaltyCardQuotaBucketCountForTests();
    expect(bucketsAtSourceLimit).toBeLessThan(1_000);
    for (
      let index = LOYALTY_CARD_READ_SOURCE_RATE_LIMIT;
      index < LOYALTY_CARD_READ_SOURCE_RATE_LIMIT + 5_000;
      index += 1
    ) {
      expect(
        takeLoyaltyCardReadQuota(`restaurant-${index}`, token(index), attacker),
      ).toMatchObject({ allowed: false, reason: "rate-limited" });
    }
    expect(loyaltyCardQuotaBucketCountForTests()).toBe(bucketsAtSourceLimit);
    expect(
      takeLoyaltyCardReadQuota(
        "restaurant-legitime",
        token(9_999),
        clientIdentity("203.0.113.10"),
      ).allowed,
    ).toBe(true);
  });

  it("borne globalement les lectures malgré une rotation de toutes les dimensions", () => {
    for (let index = 0; index < LOYALTY_CARD_READ_GLOBAL_RATE_LIMIT; index += 1) {
      const thirdOctet = Math.floor(index / 250);
      const fourthOctet = (index % 250) + 1;
      expect(
        takeLoyaltyCardReadQuota(
          `restaurant-${index}`,
          token(index),
          clientIdentity(`198.18.${thirdOctet}.${fourthOctet}`),
        ).allowed,
      ).toBe(true);
    }

    const bucketsAtGlobalLimit = loyaltyCardQuotaBucketCountForTests();
    expect(bucketsAtGlobalLimit).toBeLessThan(5_000);
    expect(
      takeLoyaltyCardReadQuota(
        "nouveau-restaurant",
        token(10_000),
        clientIdentity("192.0.2.1"),
      ),
    ).toMatchObject({ allowed: false, reason: "rate-limited" });
    expect(loyaltyCardQuotaBucketCountForTests()).toBe(bucketsAtGlobalLimit);
  });
});
