import { describe, expect, it } from "vitest";
import type { MenuProduct } from "./api";
import { draftBlocker, draftFromLine, draftOptions, draftToLine, draftUnitPrice, newDraft, reconcile, setVariant, toOrderLines, toggleChoice } from "./cart";

const product: MenuProduct = {
  id: "kebab-fromage", name: "Kebab Fromage", description: "", price: 850, fromPrice: 850,
  variants: [], groups: [
    { key: "fromage", name: "Fromage", type: "single", min: 1, max: 1, perVariant: null,
      choices: ["cheddar", "chevre", "bleu", "boursin", "raclette"].map(key => ({ key, name: key, priceDelta: 0 })) },
    { key: "pain", name: "Pain", type: "single", min: 1, max: 1, perVariant: null,
      choices: [{ key: "pain", name: "Pain", priceDelta: 0 }, { key: "galette", name: "Galette", priceDelta: 50 }] },
    { key: "supp-1-00", name: "Suppléments +1,00 €", type: "multi", min: 0, max: null, perVariant: null,
      choices: [{ key: "cheddar", name: "Cheddar supplémentaire", priceDelta: 100 }] },
  ],
  supplements: [{ key: "bacon", label: "Bacon", priceCents: 100 }],
  removables: [{ key: "salade", label: "Salade" }, { key: "tomate", label: "Tomate" },
    { key: "oignons", label: "Oignons" }, { key: "crudites", label: "Crudités" }],
  tags: [], isNew: false, outOfStock: false, photoUrl: null, configurable: true,
};

function configured(p = product) {
  return toggleChoice(toggleChoice(newDraft(p), p.groups[0], "raclette"), p.groups[1], "pain");
}

describe("choix inclus et suppléments distincts dans le panier web", () => {
  it("exige un vrai choix parmi cinq fromages, sans présélection arbitraire", () => {
    const draft = newDraft(product);
    expect(draft.picked.fromage).toEqual([]);
    expect(draftBlocker(draft)).toBe("Choisissez : Fromage");
  });

  it("peut présélectionner la seule réponse possible d’un groupe obligatoire", () => {
    const unique = { ...product, groups: [{ ...product.groups[0], choices: [product.groups[0].choices[0]] }] };
    expect(newDraft(unique).picked.fromage).toEqual(["cheddar"]);
  });

  it("garde 850 cents avec fromage inclus et 900 avec Galette", () => {
    const draft = configured();
    expect(draftBlocker(draft)).toBeNull();
    expect(draftUnitPrice(draft)).toBe(850);
    expect(draftUnitPrice(toggleChoice(draft, product.groups[1], "galette"))).toBe(900);
    expect(draftOptions(draft)).toContainEqual(expect.objectContaining({ name: "raclette", priceDelta: 0 }));
  });

  it("facture et transmet le supplément ingrédient dédié une seule fois", () => {
    const draft = { ...configured(), picked: { ...configured().picked, supplements: ["bacon", "bacon"] } };
    expect(draftUnitPrice(draft)).toBe(950);
    const line = draftToLine(draft);
    expect(line.options.filter(option => option.groupKey === "supplements")).toEqual([
      { groupKey: "supplements", groupName: "Suppléments", choiceKey: "bacon", name: "Bacon", priceDelta: 100 },
    ]);
    expect(toOrderLines([line])[0].options).toContainEqual({ groupKey: "supplements", choiceKey: "bacon" });
  });

  it("ne fusionne pas un choix gratuit avec un extra legacy payant de même clé", () => {
    let draft = toggleChoice(configured(), product.groups[0], "cheddar");
    draft = toggleChoice(draft, product.groups[2], "cheddar");
    expect(draftUnitPrice(draft)).toBe(950);
    expect(draftOptions(draft).filter(option => option.choiceKey === "cheddar")).toHaveLength(2);
  });

  it("conserve le supplément en modification et après relecture du menu", () => {
    const draft = { ...configured(), picked: { ...configured().picked, supplements: ["bacon"] } };
    const line = draftToLine(draft);
    expect(draftFromLine(line, product).picked.supplements).toEqual(["bacon"]);
    const restored = reconcile([line], new Map([[product.id, product]]));
    expect(restored.dropped).toEqual([]);
    expect(restored.lines[0].unitPrice).toBe(950);
    expect(restored.lines[0].options.some(option => option.groupKey === "supplements")).toBe(true);
  });

  it("conserve les suppléments au changement de variante et applique l’override du choix inclus", () => {
    const variantProduct = { ...product,
      variants: [{ key: "standard", name: "Standard", price: 850 }, { key: "grand", name: "Grand", price: 1000 }],
      groups: product.groups.map(group => group.key === "fromage" ? { ...group, perVariant: { grand: { priceDelta: 50 } } } : group),
    };
    const draft = configured(variantProduct);
    const changed = setVariant({ ...draft, picked: { ...draft.picked, supplements: ["bacon"] } }, "grand");
    expect(changed.picked.supplements).toEqual(["bacon"]);
    expect(draftUnitPrice(changed)).toBe(1150);
  });

  it("préfère le prix dédié si un vieux cache expose aussi le groupe réservé", () => {
    const duplicated = { ...product, groups: [...product.groups, {
      key: "supplements", name: "Ancien groupe", type: "multi" as const, min: 0, max: null, perVariant: null,
      choices: [{ key: "bacon", name: "Ancien bacon", priceDelta: 200 }],
    }] };
    const draft = configured(duplicated);
    const line = draftToLine({ ...draft, picked: { ...draft.picked, supplements: ["bacon"] } });
    expect(line.unitPrice).toBe(950);
    expect(line.options.filter(option => option.groupKey === "supplements")).toHaveLength(1);
  });

  it("ne limite pas deux suppléments dédiés au maximum d’un ancien groupe masqué", () => {
    const duplicated: MenuProduct = { ...product,
      variants: [{ key: "standard", name: "Standard", price: 850 }, { key: "grand", name: "Grand", price: 1000 }],
      supplements: [...product.supplements, { key: "cheddar", label: "Cheddar supplémentaire", priceCents: 100 }],
      groups: [...product.groups, { key: "supplements", name: "Ancien groupe", type: "multi", min: 0, max: 1,
        perVariant: null, choices: [{ key: "bacon", name: "Ancien bacon", priceDelta: 200 }] }],
    };
    const draft = configured(duplicated);
    const selected = { ...draft, picked: { ...draft.picked, supplements: ["bacon", "cheddar"] } };
    expect(draftBlocker(selected)).toBeNull();
    expect(draftUnitPrice(selected)).toBe(1050);
    const line = draftToLine(selected);
    expect(toOrderLines([line])[0].options.filter(option => option.groupKey === "supplements")).toHaveLength(2);
    const edited = draftFromLine(line, duplicated);
    expect(draftBlocker(edited)).toBeNull();
    expect(setVariant(edited, "grand").picked.supplements).toEqual(["bacon", "cheddar"]);
    expect(reconcile([line], new Map([[duplicated.id, duplicated]])).dropped).toEqual([]);
  });

  it("ne rend pas obligatoire un supplément dédié à cause d’un ancien minimum masqué", () => {
    const duplicated: MenuProduct = { ...product, groups: [...product.groups, {
      key: "supplements", name: "Ancien groupe", type: "multi", min: 1, max: 2, perVariant: null,
      choices: [{ key: "bacon", name: "Ancien bacon", priceDelta: 200 }],
    }] };
    const draft = configured(duplicated);
    expect(draftBlocker(draft)).toBeNull();
    expect(draftUnitPrice(draft)).toBe(850);
    expect(draftOptions(draft).some(option => option.groupKey === "supplements")).toBe(false);
  });

  it("ne présélectionne jamais un supplément payant via l’unique choix obligatoire masqué", () => {
    const duplicated: MenuProduct = { ...product,
      variants: [{ key: "standard", name: "Standard", price: 850 }, { key: "grand", name: "Grand", price: 1000 }],
      groups: [...product.groups, { key: "supplements", name: "Ancien groupe", type: "single", min: 1, max: 1,
        perVariant: null, choices: [{ key: "bacon", name: "Ancien bacon", priceDelta: 200 }] }],
    };
    const draft = configured(duplicated);
    expect(draft.picked.supplements ?? []).toEqual([]);
    expect(draftOptions(draft).some(option => option.groupKey === "supplements")).toBe(false);
    expect(draftUnitPrice(draft)).toBe(850);
    const changed = setVariant(draft, "grand");
    expect(changed.picked.supplements ?? []).toEqual([]);
    expect(draftBlocker(changed)).toBeNull();
    expect(draftUnitPrice(changed)).toBe(1000);
  });

  it("conserve les règles du groupe historique quand il n’y a pas de projection dédiée", () => {
    const legacy: MenuProduct = { ...product, supplements: [], groups: [...product.groups, {
      key: "supplements", name: "Ancien groupe", type: "multi", min: 1, max: 1, perVariant: null,
      choices: [{ key: "bacon", name: "Ancien bacon", priceDelta: 200 }],
    }] };
    const draft = configured(legacy);
    expect(draftBlocker(draft)).toBe("Choisissez : Ancien groupe");
    const selected = toggleChoice(draft, legacy.groups[3], "bacon");
    expect(draftBlocker(selected)).toBeNull();
    expect(draftUnitPrice(selected)).toBe(1050);
  });

  it("écarte seulement un ingrédient devenu indisponible, sans réinventer un supplément", () => {
    const draft = { ...configured(), picked: { ...configured().picked, supplements: ["inconnu"] } };
    expect(draftUnitPrice(draft)).toBe(850);
    expect(draftOptions(draft).some(option => option.groupKey === "supplements")).toBe(false);
  });

  it("transmet les clés des retraits et les conserve à l’édition et à la reprise du panier", () => {
    const draft = { ...configured(), removed: ["salade", "oignons"] };
    const line = draftToLine(draft);
    expect(line.unitPrice).toBe(850);
    expect(toOrderLines([line])[0].removed).toEqual(["salade", "oignons"]);
    expect(draftFromLine(line, product).removed).toEqual(["salade", "oignons"]);
    expect(reconcile([line], new Map([[product.id, product]])).lines[0].removed).toEqual(["salade", "oignons"]);
  });

  it("distingue sans crudités de Complet sans inventer de clés ingrédient", () => {
    const sansCrudites = { ...configured(), removed: ["crudites"] };
    expect(toOrderLines([draftToLine(sansCrudites)])[0].removed).toEqual(["crudites"]);
    const complet = { ...sansCrudites, removed: [] };
    expect(toOrderLines([draftToLine(complet)])[0].removed).toEqual([]);
    expect(draftUnitPrice(complet)).toBe(draftUnitPrice(sansCrudites));
  });
});
