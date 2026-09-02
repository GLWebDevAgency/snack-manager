import { describe, expect, it } from "vitest";
import { DIRECTIONS, type LoyaltyCustomerCard } from "@sm/contracts";
import { loyaltyScanSuccessAnnouncement } from "./scan-feedback";

describe("retour accessible après scan", () => {
  it("annonce la carte et son solde sans répéter le secret QR", () => {
    const card = {
      member: { alias: "Maya", balanceUnits: 12 },
      restaurant: { slug: "classfood", name: "Classfood", brandColor: "#c9a15a", brand: DIRECTIONS.nuit },
      program: {
        name: "La carte",
        status: "active",
        mechanism: "points",
        unitLabelSingular: "point",
        unitLabelPlural: "points",
        termsSummary: "Conditions",
      },
      rewards: [],
      activity: [],
    } as LoyaltyCustomerCard;
    const message = loyaltyScanSuccessAnnouncement(card, "point", "points");
    expect(message).toBe("Carte de Maya chargée. Solde : 12 points.");
    expect(message).not.toMatch(/qr|jeton|secret/i);
  });
});
