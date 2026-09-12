import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { MenuProduct } from "./api";
import { newDraft } from "./cart";
import { ProductSheet } from "./ProductSheet";

// Le portail animé attend le DOM ; seul son conteneur est remplacé pour le SSR.
// Les choix, prix, boutons et règles de la fiche sont réellement rendus.
vi.mock("./primitives", async (importOriginal) => ({
  ...await importOriginal<typeof import("./primitives")>(),
  Sheet: ({ children, footer }: { children: ReactNode; footer: ReactNode }) =>
    createElement("section", null, children, footer),
}));

const product: MenuProduct = {
  id: "kebab-fromage", name: "Kebab Fromage", description: "", price: 850, fromPrice: 850,
  variants: [], groups: [
    { key: "fromage", name: "Fromage", type: "single", min: 1, max: 1, perVariant: null,
      choices: ["Cheddar", "Chèvre", "Bleu", "Boursin", "Raclette"].map(name => ({ key: name, name, priceDelta: 0 })) },
    { key: "pain", name: "Pain", type: "single", min: 1, max: 1, perVariant: null,
      choices: [{ key: "pain", name: "Pain", priceDelta: 0 }, { key: "galette", name: "Galette", priceDelta: 50 }] },
  ],
  removables: [{ key: "salade", label: "Salade" }, { key: "tomate", label: "Tomate" },
    { key: "oignons", label: "Oignons" }, { key: "crudites", label: "Crudités" }],
  supplements: [{ key: "bacon", label: "Bacon", priceCents: 100 }],
  tags: [], isNew: false, outOfStock: false, photoUrl: null, configurable: true,
};

function render(p = product, removed: string[] = []) {
  return renderToStaticMarkup(createElement(ProductSheet, {
    draft: { ...newDraft(p), removed }, onChange: vi.fn(), onClose: vi.fn(), onSubmit: vi.fn(), prixMono: false,
  }));
}

function controls(html: string) {
  return (html.match(/<button\b[^>]*>[\s\S]*?<\/button>/g) ?? []).map(markup => ({
    markup, label: markup.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(),
  }));
}

describe("fiche web : choix inclus et retraits du menu commun", () => {
  it("annonce les cinq fromages inclus sans en choisir un à la place du client", () => {
    const html = render();
    const cheddar = controls(html).find(control => control.label === "Cheddar Inclus");
    expect(cheddar?.markup).toContain('role="radio"');
    expect(cheddar?.markup).toContain('aria-checked="false"');
    expect(controls(html).filter(control => control.label.endsWith(" Inclus"))).toHaveLength(6);
    expect(html).toMatch(/disabled=""[^>]*>[\s\S]*?Choisissez : Fromage/);
    expect(html).toContain("+0,50");
    expect(html).toContain("+1,00");
  });

  it("applique un override de variante au lieu d’annoncer faussement Inclus", () => {
    const p = { ...product, variants: [{ key: "grand", name: "Grand", price: 1000 }],
      groups: [{ ...product.groups[0], perVariant: { grand: { priceDelta: 50 } } }] };
    const html = render(p);
    expect(html).not.toContain(">Inclus<");
    expect(html.match(/\+0,50/g)).toHaveLength(5);
  });

  it("présente Complet et tous les retraits réellement fournis, y compris sans crudités", () => {
    const html = render();
    expect(controls(html).find(control => control.label.startsWith("Complet"))?.markup).toContain('aria-pressed="true"');
    for (const item of ["salade", "tomate", "oignons", "crudités"]) {
      expect(controls(html).filter(control => new RegExp(`^sans ${item}s?$`, "i").test(control.label))).toHaveLength(1);
    }
    expect(render({ ...product, removables: [] })).not.toContain("sans crudités");
    expect(controls(render(product, ["crudites"])).find(control => control.label === "sans crudités")?.markup).toContain('aria-checked="true"');
  });

  it("ne déduit pas un retrait de crudités absent de la carte à partir de trois ingrédients", () => {
    const html = render({ ...product, removables: product.removables.filter(item => item.key !== "crudites") });
    expect(html.toLowerCase()).not.toContain("sans crudités");
    for (const item of ["salade", "tomate", "oignons"]) expect(html).toContain(`sans ${item}`);
  });

  it("conserve des choix de même libellé quand le restaurant leur donne des identités distinctes", () => {
    const html = render({ ...product, removables: [
      { key: "garniture-oignons", label: "Oignons" }, { key: "accompagnement-oignons", label: "Oignons" },
    ], groups: product.groups.map(group => ({ ...group, choices: [{ key: `${group.key}-nature`, name: "Nature", priceDelta: 0 }] })) });
    expect(controls(html).filter(control => control.label === "sans oignons")).toHaveLength(2);
    const defaults = controls(html).filter(control => control.label === "Nature Inclus");
    expect(defaults).toHaveLength(2);
    for (const control of defaults) expect(control.markup).toContain('aria-checked="true"');
  });

  it("ne présente pas deux fois un supplément dédié dans un ancien menu dupliqué", () => {
    const html = render({ ...product, groups: [...product.groups, {
      key: "supplements", name: "Ancien groupe", type: "multi", min: 0, max: null, perVariant: null,
      choices: [{ key: "bacon", name: "Ancien bacon", priceDelta: 200 }],
    }] });
    expect(html).not.toContain("Ancien bacon");
    expect(html).toContain("Bacon");
  });
});
