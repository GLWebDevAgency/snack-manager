import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { EditeurOptions, euxCentimes, figerLesClefs } from "./VariantesOptions";
import type { OptionGroup } from "./types";
import { normaliserGroupesEdition, validerModificationProduit } from "./product-validation";

const group = (overrides: Partial<OptionGroup> = {}): OptionGroup => ({
  key: "fromage", name: "Fromage", type: "single", min: 1,
  choices: [
    { key: "cheddar", name: "Cheddar", priceDelta: 0 },
    { key: "raclette", name: "Raclette", priceDelta: 50 },
  ],
  ...overrides,
});
const render = (value: OptionGroup) => renderToStaticMarkup(createElement(EditeurOptions, {
  groups: [value], onChange: () => undefined,
}));
const maxInput = (html: string) => html.match(/<input[^>]*id="grp-max-fromage"[^>]*>/)?.[0] ?? "";

describe("l’éditeur d’options, rendu accessible", () => {
  it("annonce un maximum fixe de 1 pour Un seul, même si le champ était absent", () => {
    const html = render(group());
    expect(maxInput(html)).toContain('value="1"');
    expect(maxInput(html)).toMatch(/readonly/i);
    expect(maxInput(html)).toContain('aria-label="Maximum de choix pour Fromage"');
    expect(html).toContain("Un seul choix au maximum.");
    expect(html).not.toContain("Vide = autant");
  });

  it("garde le maximum vide modifiable pour Plusieurs", () => {
    const html = render(group({ type: "multi", min: 0 }));
    expect(maxInput(html)).toContain('value=""');
    expect(maxInput(html)).not.toMatch(/readonly/i);
    expect(html).toContain("Vide = tous les choix proposés.");
  });

  it("laisse réparer un ancien maximum contradictoire sans masquer sa vraie valeur", () => {
    const html = render(group({ max: 2 }));
    expect(maxInput(html)).toContain('value="2"');
    expect(maxInput(html)).not.toMatch(/readonly/i);
  });

  it("distingue les choix inclus et payants, sans modifier les montants", () => {
    const html = render(group());
    expect(html).toContain(">Inclus</span>");
    expect(html).toContain(">Supplément</span>");
    expect(html).toContain('value="0,00"');
    expect(html).toContain('value="0,50"');
    expect(euxCentimes("0,00")).toBe(0);
  });

  it("ne promet pas un choix toujours inclus si un tarif par taille le remplace", () => {
    const html = render(group({ perVariant: { xl: { priceDelta: 100 } } }));
    expect(html).toContain("Inclus par défaut");
    expect(html).toContain("règles par taille");
    expect(html).toContain("Elles sont conservées");
  });

  it("valide le payload réel après gel des clés, avec Pain hérité et Fromage gratuit", () => {
    const legacy = [{ ...group(), key: "pain", name: "Pain", perVariant: null }] as unknown as OptionGroup[];
    const nouveau = group({ key: "g2", choices: ["Bleue", "Reblochon", "Raclette", "Camembert", "Cheddar"]
      .map((name, index) => ({ key: `c${index + 1}`, name, priceDelta: euxCentimes("0,00")! })) });
    const patch = { optionGroups: figerLesClefs([...normaliserGroupesEdition(legacy), nouveau], legacy) };
    expect(validerModificationProduit(patch).success).toBe(true);
    expect(patch.optionGroups[0].key).toBe("pain");
    expect(patch.optionGroups[1].key).toBe("fromage");
    expect(patch.optionGroups[1].choices).toHaveLength(5);
    expect(patch.optionGroups[1].choices.every((choice) => choice.priceDelta === 0)).toBe(true);
  });
});
