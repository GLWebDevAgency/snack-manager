import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { DIRECTIONS } from "@sm/contracts";
import type { TrackingState } from "./api";
import { Tracking } from "./Tracking";

// next/font est transformé par Next, pas par Vitest. Seules les classes de
// polices sont remplacées ; le suivi et ses primitives sont réellement rendus.
vi.mock("@/components/masque/polices", () => ({ classesPolices: "font-fixture" }));

const pending: TrackingState = {
  _id: "order", number: 12, status: "new", statusHistory: [],
  pickupSlot: "2026-09-05T18:30:00.000Z", fulfillment: "delivery",
  payment: { status: "pending", method: "online", refundedCents: 0, pendingRefundCents: 0 },
};

function render(overrides: Partial<TrackingState> = {}) {
  return renderToStaticMarkup(createElement(Tracking, {
    orderId: pending._id, trackingToken: "tracking-token", ticket: null,
    initial: { ...pending, ...overrides }, brand: DIRECTIONS.nuit,
  }));
}

describe("suivi rendu et confirmation du paiement livraison", () => {
  it("attend le paiement avant de présenter la commande comme reçue en cuisine", () => {
    const html = render();
    expect(html).toMatch(/<h1[^>]*>En attente de confirmation du paiement<\/h1>/);
    expect(html).toMatch(/<li[^>]*aria-current="step"[^>]*>[\s\S]*?Confirmation du paiement[\s\S]*?À confirmer/);
    expect(html).toContain("La préparation commencera après confirmation du paiement.");
    expect(html).toContain("Créneau souhaité");
    expect(html).not.toContain("La cuisine a votre commande");
    expect(html).not.toContain("Commande en cours");
    expect(html).not.toContain("Arrivée estimée vers");
    expect(html).not.toMatch(/refusé|Paiement échoué/);
  });

  it("ne déduit pas un paiement confirmé d’une ancienne réponse qui omet payment", () => {
    const html = render({ payment: undefined });
    expect(html).toContain("En attente de confirmation du paiement");
    expect(html).not.toContain("La cuisine a votre commande");
  });

  it.each(["preparing", "ready"] as const)("ne réactive pas la cuisine sur un instantané %s encore impayé", (status) => {
    const html = render({ status });
    expect(html).toMatch(/<h1[^>]*>En attente de confirmation du paiement<\/h1>/);
    expect(html).not.toContain("Ça chauffe");
    expect(html).not.toContain("Votre commande est en route");
  });

  it("présente la réception en cuisine seulement après confirmation serveur", () => {
    const html = render({ payment: { ...pending.payment!, status: "paid" } });
    expect(html).toContain("Commande en cours");
    expect(html).toContain("La cuisine a votre commande");
    expect(html).not.toContain("En attente de confirmation du paiement");
    expect(html).not.toContain("Reprendre le paiement");
  });

  it("conserve la réception immédiate d’un retrait à régler au comptoir", () => {
    const html = render({ fulfillment: "pickup", payment: { ...pending.payment!, method: "counter" } });
    expect(html).toContain("La cuisine a votre commande");
    expect(html).not.toContain("En attente de confirmation du paiement");
  });

  it("ne présente pas le départ du livreur avant son horodatage", () => {
    const html = render({ status: "ready", payment: { ...pending.payment!, status: "paid" } });
    expect(html).toMatch(/<h1[^>]*>Votre commande est prête à partir<\/h1>/);
    expect(html).not.toContain("Votre commande est en route");
  });

  it("présente la livraison en route uniquement après départ confirmé", () => {
    const html = render({ status: "ready", payment: { ...pending.payment!, status: "paid" },
      delivery: { dispatchedAt: "2026-09-05T18:10:00.000Z", deliveredAt: null, estimatedMinutes: 45 } });
    expect(html).toMatch(/<h1[^>]*>Votre commande est en route<\/h1>/);
  });

  it("conserve une remise historique sans rouvrir de paiement", () => {
    const html = render({ status: "delivered" });
    expect(html).toMatch(/<h1[^>]*>Commande livrée<\/h1>/);
    expect(html).toContain("Suivi terminé.");
    expect(html).not.toContain("En attente du départ du livreur");
    expect(html).not.toContain("Ça chauffe");
    expect(html).not.toContain("Reprendre le paiement");
  });

  it("donne priorité à l’annulation sans laisser un parcours de paiement actif", () => {
    const html = render({ status: "cancelled" });
    expect(html).toMatch(/<h1[^>]*>Commande annulée<\/h1>/);
    expect(html).not.toContain("La cuisine a votre commande");
    expect(html).not.toContain("Reprendre le paiement");
  });

  it("n’annonce plus de préparation pour une livraison totalement remboursée non terminée", () => {
    const html = render({ payment: { ...pending.payment!, status: "refunded", refundedCents: 2250 } });
    expect(html).toMatch(/<h1[^>]*>Commande remboursée<\/h1>/);
    expect(html).not.toContain("La cuisine a votre commande");
    expect(html).not.toContain("Reprendre le paiement");
    expect(html).not.toContain("Commande annulée");
  });

  it("distingue remboursement et livraison déjà effectuée", () => {
    const html = render({ status: "delivered", payment: { ...pending.payment!, status: "refunded", refundedCents: 2250 } });
    expect(html).toMatch(/<h1[^>]*>Commande livrée<\/h1>/);
    expect(html).toContain("Remboursement");
    expect(html).toContain("remboursés.");
    expect(html).not.toContain("Reprendre le paiement");
  });

  it.each([
    { refundedCents: 250, pendingRefundCents: 0 },
    { refundedCents: 0, pendingRefundCents: 2250 },
  ])("ne confond pas remboursement partiel ou en cours avec remboursement total : %j", (refund) => {
    const html = render({ status: "preparing", payment: { ...pending.payment!, status: "paid", ...refund } });
    expect(html).toMatch(/<h1[^>]*>Commande en cours<\/h1>/);
    expect(html).toContain("Ça chauffe");
    expect(html).toContain("Remboursement");
    expect(html).not.toContain("Commande remboursée");
    expect(html).not.toContain("Reprendre le paiement");
  });
});
