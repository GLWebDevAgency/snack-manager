import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { DeliveryOperatorView } from "@sm/contracts";
import { DeliveryOperatorRow, DeliveryOperatorsPanel } from "./DeliveryOperatorsPanel";

const operator: DeliveryOperatorView = {
  id: "507f1f77bcf86cd799439011", name: "Samir test", staffId: null,
  active: true, effectiveActive: true, blockedReason: null, revision: 0,
  sessionState: "not_connected", inviteExpiresAt: null,
};
function render(patch: Partial<DeliveryOperatorView> = {}, disabled = false) {
  return renderToStaticMarkup(createElement(DeliveryOperatorRow, { operator: { ...operator, ...patch }, disabled, onAction: vi.fn() }));
}
describe("annuaire livreurs rendu", () => {
  it("décrit la remise par code sur téléphone et conserve la limite sans géolocalisation", () => {
    const html = renderToStaticMarkup(createElement(DeliveryOperatorsPanel));
    expect(html).toContain("Consultez et affectez les missions depuis Commandes.");
    expect(html).toContain("Le livreur peut consulter ses missions et confirmer son départ sur son téléphone associé.");
    expect(html).toContain("La remise se confirme avec le code du client, depuis Commandes ou le téléphone du livreur.");
    expect(html).toContain("ne signifie pas que le livreur est en ligne ou géolocalisé");
    expect(html).not.toContain("seront proposées dans une prochaine étape");
  });
  it("expose des actions nominatives accessibles sans transformer l’association en présence", () => {
    const html = render({ sessionState: "connected" });
    expect(html).toContain("Téléphone associé");
    expect(html).toContain("ni présence en ligne ni position GPS");
    expect(html).toContain('aria-label="Associer le téléphone de Samir test"');
    expect(html).toContain('aria-label="Révoquer l’accès de Samir test"');
    expect(html).toContain("min-h-11");
    expect(html).toContain("cf-press");
  });
  it("sépare habilitation équipier et création RH", () => {
    const html = render({ staffId: "507f1f77bcf86cd799439012" });
    expect(html).toContain("Équipier polyvalent");
    expect(html).not.toContain('href="/admin/team');
  });
  it("ne permet pas d’associer un téléphone à un accès révoqué", () => {
    const html = render({ active: false, effectiveActive: false });
    expect(html).toContain("Accès révoqué");
    expect(html).toContain("Autoriser l’accès");
    expect(html).not.toContain("Associer un téléphone");
    expect(html).not.toContain('aria-label="Révoquer');
  });
  it("propose de renouveler une habilitation staff modifiée", () => {
    const html = render({ staffId: "507f1f77bcf86cd799439012", effectiveActive: false, blockedReason: "staff_changed" });
    expect(html).toContain("Renouveler l’habilitation");
    expect(html).not.toContain("Associer un téléphone");
  });
  it("garde le refus d’un équipier inactif explicite", () => {
    const html = render({ effectiveActive: false, blockedReason: "staff_inactive" });
    expect(html).toContain("Équipier inactif");
    expect(html).not.toContain("Associer un téléphone");
    expect(html).not.toContain("Autoriser l’accès");
  });
  it("désactive toutes les actions pendant une mutation ou une lecture incertaine", () => {
    const html = render({}, true);
    expect(html.match(/disabled=""/g)).toHaveLength(2);
  });
  it("échappe le nom sans le convertir en HTML", () => {
    expect(render({ name: "<script>test</script>" })).toContain("&lt;script&gt;test&lt;/script&gt;");
    expect(render({ name: "<script>test</script>" })).not.toContain("<script>");
  });
});
