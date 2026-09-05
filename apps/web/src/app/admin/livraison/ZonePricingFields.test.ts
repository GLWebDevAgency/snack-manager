import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ZonePricingFields } from "./ZonePricingFields";
import { newDeliveryZone, type DeliveryPricingMode } from "./delivery-draft";

function render(pricingMode: DeliveryPricingMode) {
  return renderToStaticMarkup(createElement(ZonePricingFields, {
    zone: { ...newDeliveryZone("centre"), pricingMode }, onChange: vi.fn(),
  }));
}

describe("tarification de zone rendue dans le back-office", () => {
  it("nomme le groupe et propose trois radios natifs avec un seul choix actif", () => {
    const html = render("fixed");
    expect(html).toContain('role="radiogroup" aria-labelledby="centre-pricing-label"');
    expect(html.match(/type="radio"/g)).toHaveLength(3);
    expect(html.match(/checked=""/g)).toHaveLength(1);
    for (const label of ["Tarif fixe", "Offerte dès un seuil", "Toujours offerte"]) expect(html).toContain(label);
    expect(html).toContain("focus-within:outline-focus");
  });
  it("sépare le seuil gratuit et le minimum de commande en mode seuil", () => {
    const html = render("threshold");
    expect(html).toContain('for="centre-fee"');
    expect(html).toContain('for="centre-free-from"');
    expect(html).toContain('for="centre-minimum"');
    expect(html).toContain("5,00 € · offerte dès 30,00 € · minimum 15,00 €");
  });
  it("ne présente aucun champ de frais ou seuil quand la livraison est toujours offerte", () => {
    const html = render("free");
    expect(html).not.toContain('id="centre-fee"');
    expect(html).not.toContain('id="centre-free-from"');
    expect(html).toContain('id="centre-minimum"');
    expect(html).toContain("Livraison offerte · minimum 15,00 €");
  });
  it("ne présente pas de seuil caché comme actif en mode fixe", () => {
    const html = render("fixed");
    expect(html).not.toContain('id="centre-free-from"');
    expect(html).toContain("5,00 € · minimum 15,00 €");
    expect(html).not.toContain("offerte dès 30,00");
  });
});
