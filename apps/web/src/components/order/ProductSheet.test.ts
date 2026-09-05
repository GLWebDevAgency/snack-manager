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

describe("fiche web : choix inclus et retraits du menu commun", () => {
  it("annonce les cinq fromages inclus sans en choisir un à la place du client", () => {
    const html = render();
    expect(html).toMatch(/aria-pressed="false"[^>]*>Cheddar<span[^>]*>Inclus/);
    expect(html.match(/>Inclus</g)).toHaveLength(6);
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
    expect(html).toMatch(/aria-pressed="true"[^>]*>[\s\S]*?Complet<\/button>/);
    for (const item of ["salade", "tomate", "oignons", "crudités"]) expect(html).toContain(`sans ${item}`);
    expect(render({ ...product, removables: [] })).not.toContain("sans crudités");
    expect(render(product, ["crudites"])).toMatch(/aria-pressed="true"[^>]*>[\s\S]*?sans crudités<\/button>/);
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
