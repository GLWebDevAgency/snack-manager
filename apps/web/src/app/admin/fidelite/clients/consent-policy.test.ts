import { describe, expect, it } from "vitest";
import { canWithdrawHistoricalSmsConsent } from "./consent-policy";

describe("politique de consentement SMS du pilote", () => {
  it("permet le retrait historique sur une carte active ou bloquée", () => {
    expect(canWithdrawHistoricalSmsConsent("active", "granted")).toBe(true);
    expect(canWithdrawHistoricalSmsConsent("blocked", "granted")).toBe(true);
  });

  it("ne crée jamais un retrait sans accord actif et refuse l'anonymisé", () => {
    expect(canWithdrawHistoricalSmsConsent("active", "withdrawn")).toBe(false);
    expect(canWithdrawHistoricalSmsConsent("blocked", undefined)).toBe(false);
    expect(canWithdrawHistoricalSmsConsent("anonymized", "granted")).toBe(false);
  });
});
