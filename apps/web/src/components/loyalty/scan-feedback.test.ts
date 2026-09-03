import { describe, expect, it } from "vitest";
import { DIRECTIONS, type LoyaltyCustomerCard } from "@sm/contracts";
import {
  loyaltyScanSuccessAnnouncement,
  messageDEchecQr,
  messageDeMiseAJour,
} from "./scan-feedback";

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

describe("le message visible d'une mise à jour", () => {
  const menu = {
    id: "22222222-2222-4222-8222-222222222222",
    name: "Menu signature",
    description: "",
    costUnits: 30,
    kind: "product",
    valueCents: null,
    productRef: null,
    affordable: true,
  } as const;
  const boisson = { ...menu, id: "11111111-1111-4111-8111-111111111111", name: "Boisson", costUnits: 8 } as const;

  it("met le palier franchi avant tout le reste — c'est l'événement", () => {
    expect(messageDeMiseAJour(6, [menu], "point", "points")).toBe(
      "« Menu signature » est à vous !",
    );
  });

  it("compte plutôt que d'énumérer au-delà d'un palier", () => {
    expect(messageDeMiseAJour(40, [menu, boisson], "point", "points")).toBe(
      "2 récompenses débloquées !",
    );
  });

  it("annonce le gain avec son signe et l'accord juste", () => {
    expect(messageDeMiseAJour(6, [], "point", "points")).toBe("+6 points");
    expect(messageDeMiseAJour(1, [], "point", "points")).toBe("+1 point");
  });

  it("n'escamote pas un débit — le client doit pouvoir le voir passer", () => {
    expect(messageDeMiseAJour(-8, [], "point", "points")).toBe("−8 points");
  });

  it("répond quand même quand rien n'a changé : « Actualiser » a demandé", () => {
    expect(messageDeMiseAJour(0, [], "point", "points")).toBe("Solde à jour");
  });
});

describe("l'échec du QR est nommé, parce que la conduite à tenir diffère", () => {
  it("distingue les quatre issues réelles de la route", () => {
    expect(messageDEchecQr(null)).toMatch(/hors ligne/i);
    expect(messageDEchecQr(404)).toMatch(/nouveau QR/i);
    expect(messageDEchecQr(429)).toMatch(/patientez/i);
    expect(messageDEchecQr(503)).toMatch(/indisponible/i);
  });

  it("garde un repli lisible pour un statut imprévu", () => {
    expect(messageDEchecQr(418)).toBe("Le QR n’a pas pu être affiché. Réessayez.");
  });
});
