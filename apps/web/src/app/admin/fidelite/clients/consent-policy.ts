import type { LoyaltyConsentStateView, LoyaltyMemberSummary } from "@sm/contracts";

/**
 * Le pilote ne recueille aucun nouvel accord SMS. Il permet uniquement de
 * retirer un accord historique tant que la carte n'est pas anonymisée.
 */
export function canWithdrawHistoricalSmsConsent(
  status: LoyaltyMemberSummary["status"],
  decision: LoyaltyConsentStateView["decision"] | undefined,
): boolean {
  return decision === "granted" && status !== "anonymized";
}
