import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { EMPTY_SERVICES } from "@sm/contracts";
import { OffreFields } from "./parts";

function renderFields(plan: "boost" | "complet" | null, flags = { module: false, delivery: false, loyalty: false }) {
  const setters = { setPlan: vi.fn(), setModule: vi.fn(), setDelivery: vi.fn(), setLoyalty: vi.fn(), setBilling: vi.fn(), setServices: vi.fn() };
  const html = renderToStaticMarkup(createElement(OffreFields, {
    plan,
    ...flags,
    ...setters,
    billing: "mensuel",
    services: { ...EMPTY_SERVICES },
  }));
  const selector = html.match(/<select[^>]*id="prop-commerce"[\s\S]*?<\/select>/)?.[0];
  expect(selector).toBeDefined();
  return { html, selector: selector!, setters };
}

describe("modules inclus dans l’offre CRM", () => {
  it.each([
    { module: false, delivery: false, loyalty: false },
    { module: true, delivery: false, loyalty: false },
    { module: false, delivery: false, loyalty: true },
    { module: true, delivery: true, loyalty: true },
  ])("affiche la livraison incluse pour un Boost même avec les anciens drapeaux %j", (flags) => {
    const { selector, setters } = renderFields("boost", flags);
    expect(selector).toContain('disabled=""');
    expect(selector).toMatch(/<option value="delivery" selected="">/);
    expect(selector).toContain("inclus dans Boost");
    expect(selector.match(/<option /g)).toHaveLength(1);
    expect(selector).not.toContain("/mois");
    for (const setter of Object.values(setters)) expect(setter).not.toHaveBeenCalled();
  });

  it.each(["complet", null] as const)("conserve les choix à la carte hors Boost (%s)", (plan) => {
    const { selector } = renderFields(plan);
    expect(selector).not.toContain('disabled=""');
    expect(selector.match(/<option /g)).toHaveLength(4);
    expect(selector).toMatch(/<option value="none" selected="">/);
    expect(selector).toContain("/mois");
  });

  it("ne réécrit pas le choix à la carte lors d’un passage par Boost", () => {
    const flags = Object.freeze({ module: true, delivery: false, loyalty: false });
    expect(renderFields("complet", flags).selector).toMatch(/<option value="collect" selected="">/);
    expect(renderFields("boost", flags).selector).toMatch(/<option value="delivery" selected="">/);
    expect(renderFields("complet", flags).selector).toMatch(/<option value="collect" selected="">/);
  });

  it("ne refacture pas de module mensuel Boost dans l’intégration sur site existant", () => {
    const { html } = renderFields("boost");
    const integration = html.match(/Commande en ligne greffée[\s\S]*?<\/div>/)?.[0];
    expect(integration).toContain("190,00 €");
    expect(integration).toContain("module inclus dans Boost, sans supplément mensuel");
    expect(integration).not.toContain("/mois");
  });

  it.each([
    [{ module: false, delivery: false, loyalty: false }, "79,00 €"],
    [{ module: true, delivery: false, loyalty: false }, "79,00 €"],
    [{ module: false, delivery: false, loyalty: true }, "79,00 €"],
    [{ module: true, delivery: true, loyalty: false }, "119,00 €"],
  ])("chiffre le module effectivement associé à l’intégration hors Boost (%j)", (flags, monthlyPrice) => {
    const { html } = renderFields("complet", flags);
    const integration = html.match(/Commande en ligne greffée[\s\S]*?<\/div>/)?.[0];
    expect(integration).toContain(`puis le module ${monthlyPrice}/mois`);
    expect(integration).not.toContain("inclus dans Boost");
  });
});
