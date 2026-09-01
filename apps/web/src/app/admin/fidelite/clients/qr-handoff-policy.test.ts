import { describe, expect, it } from "vitest";
import {
  loyaltyQrDownloadFilename,
  mustConfirmQrHandoffClose,
  qrHandoffPresentation,
} from "./qr-handoff-policy";

describe("politique de remise d'un QR fidélité", () => {
  it("bloque la fermeture tant qu'un secret à affichage unique est en mémoire", () => {
    expect(mustConfirmQrHandoffClose("A".repeat(43))).toBe(true);
    expect(mustConfirmQrHandoffClose(null)).toBe(false);
  });

  it("exporte sous un nom générique sans identité client", () => {
    expect(loyaltyQrDownloadFilename()).toBe("carte-fidelite.png");
    expect(loyaltyQrDownloadFilename()).not.toMatch(/client|alias|secret/i);
    expect(loyaltyQrDownloadFilename(true)).toBe("carte-fidelite-demonstration.png");
  });

  it("ouvre une carte cross-device dédiée sans publier le jeton de démonstration", () => {
    const token = "D".repeat(43);
    const handoff = qrHandoffPresentation({
      demo: true,
      siteUrl: "https://snackmanager.fr",
      tenantSlug: "classfood",
      token,
    });
    expect(handoff).toEqual({
      kind: "demo-link",
      payload: "https://snackmanager.fr/r/demo/fidelite?demo=1#carte-fictive",
    });
    expect(handoff.payload).not.toContain(token);
    expect(handoff.payload).not.toContain("/r/classfood/fidelite");
  });

  it("réserve le deep-link à une vraie remise rattachée au tenant", () => {
    const token = "A".repeat(43);
    expect(
      qrHandoffPresentation({
        demo: false,
        siteUrl: "https://commande.example",
        tenantSlug: "classfood",
        token,
      }),
    ).toEqual({
      kind: "activation-link",
      payload: `https://commande.example/r/classfood/fidelite#card=${token}`,
    });
  });
});
