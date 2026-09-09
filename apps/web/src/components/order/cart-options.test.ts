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

describe("réconciliation sans substitution des choix enregistrés", () => {
  const selectedProduct: MenuProduct = { ...product,
    variants: [{ key: "petit", name: "Petit", price: 850 }, { key: "grand", name: "Grand", price: 1000 }],
    supplements: [...product.supplements, { key: "oeuf", label: "Œuf", priceCents: 150 }],
  };
  function selectedLine() {
    const draft = setVariant(configured(selectedProduct), "grand");
    return draftToLine({ ...draft, qty: 2, note: "Bien cuit",
      picked: { ...draft.picked, "supp-1-00": ["cheddar"], supplements: ["bacon"] }, removed: ["oignons"] });
  }
  const changes: [string, (next: MenuProduct) => void][] = [
    ["variante choisie supprimée alors qu’une autre existe", next => { next.variants = next.variants.slice(0, 1); }],
    ["toutes les variantes supprimées", next => { next.variants = []; }],
    ["groupe facultatif choisi supprimé", next => { next.groups = next.groups.filter(group => group.key !== "supp-1-00"); }],
    ["choix facultatif supprimé", next => { next.groups[2].choices = []; }],
    ["groupe obligatoire choisi supprimé", next => { next.groups = next.groups.filter(group => group.key !== "fromage"); }],
    ["choix obligatoire supprimé", next => { next.groups[0].choices = next.groups[0].choices.filter(choice => choice.key !== "raclette"); }],
    ["supplément dédié choisi supprimé parmi plusieurs", next => { next.supplements = next.supplements.filter(supplement => supplement.key !== "bacon"); }],
    ["derniers suppléments dédiés supprimés", next => { next.supplements = []; }],
    ["exclusion supprimée de la recette", next => { next.removables = next.removables.filter(removable => removable.key !== "oignons"); }],
    ["minimum de groupe augmenté", next => { next.groups[0].min = 2; next.groups[0].max = 2; }],
    ["maximum de groupe diminué", next => { next.groups[2].max = 0; }],
    ["règle de la variante choisie devenue incompatible", next => { next.groups[0].perVariant = { grand: { min: 2, max: 2 } }; }],
    ["nouveau choix obligatoire unique non consenti", next => { next.groups.push({ key: "cuisson", name: "Cuisson", type: "single", min: 1, max: 1,
      perVariant: null, choices: [{ key: "grille", name: "Grillé", priceDelta: 100 }] }); }],
  ];
  it.each(changes)("refuse la ligne entière : %s", (_label, change) => {
    const line = selectedLine();
    const before = structuredClone(line);
    const next = structuredClone(selectedProduct);
    change(next);
    expect(reconcile([line], new Map([[next.id, next]]))).toEqual({ lines: [], dropped: [line.name] });
    expect(line).toEqual(before);
  });

  it("ne choisit pas une première variante pour une ancienne ligne sans variante", () => {
    const line = draftToLine(configured());
    expect(line.variantKey).toBeNull();
    expect(reconcile([line], new Map([[selectedProduct.id, selectedProduct]]))).toEqual({ lines: [], dropped: [line.name] });
  });

  it("actualise prix et libellés sans changer les clés, quantités, note ou identifiant local", () => {
    const line = selectedLine();
    const before = structuredClone(line);
    const next = structuredClone(selectedProduct);
    next.name = "Nouveau nom";
    next.photoUrl = "/nouvelle-photo.webp";
    next.variants[1] = { key: "grand", name: "Grand format", price: 1200 };
    next.groups[0].perVariant = { grand: { priceDelta: 50 } };
    next.groups[0].name = "Fromage inclus";
    next.groups[0].choices.find(choice => choice.key === "raclette")!.name = "Raclette affinée";
    next.supplements[0].priceCents = 200;
    next.supplements[0].label = "Bacon grillé";
    const result = reconcile([line], new Map([[next.id, next]]));
    expect(result.dropped).toEqual([]);
    expect(toOrderLines(result.lines)).toEqual(toOrderLines([line]));
    expect(result.lines[0]).toMatchObject({ lineId: line.lineId, name: "Nouveau nom", photoUrl: "/nouvelle-photo.webp",
      variantKey: "grand", variantName: "Grand format", unitPrice: 1550, qty: 2, note: "Bien cuit", removed: ["oignons"] });
    expect(result.lines[0].options).toContainEqual({ groupKey: "fromage", groupName: "Fromage inclus", choiceKey: "raclette", name: "Raclette affinée", priceDelta: 50 });
    expect(result.lines[0].options).toContainEqual({ groupKey: "supplements", groupName: "Suppléments", choiceKey: "bacon", name: "Bacon grillé", priceDelta: 200 });
    expect(line).toEqual(before);
  });

  it("ne confond pas réordonnancement du catalogue et changement de sélection", () => {
    const line = selectedLine();
    const next = structuredClone(selectedProduct);
    next.groups.reverse();
    next.groups.forEach(group => group.choices.reverse());
    next.variants.reverse();
    next.supplements.reverse();
    next.removables.reverse();
    const result = reconcile([line], new Map([[next.id, next]]));
    expect(result.dropped).toEqual([]);
    expect(result.lines[0]).toEqual({ ...line, options: expect.arrayContaining(line.options) });
    expect(result.lines[0].options).toHaveLength(line.options.length);
  });

  it.each(["supp-1-00", "supplements"])("refuse la déduplication silencieuse d’un choix enregistré dans %s", groupKey => {
    const line = selectedLine();
    line.options.push({ ...line.options.find(option => option.groupKey === groupKey)! });
    expect(reconcile([line], new Map([[selectedProduct.id, selectedProduct]]))).toEqual({ lines: [], dropped: [line.name] });
  });

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1])("refuse une quantité invalide sans la corriger : %s", qty => {
    const line = { ...selectedLine(), qty };
    expect(reconcile([line], new Map([[selectedProduct.id, selectedProduct]]))).toEqual({ lines: [], dropped: [line.name] });
    expect(line.qty).toBe(qty);
  });

  it("conserve une ligne sans variante et les choix valides quand seuls des choix non sélectionnés disparaissent", () => {
    const line = draftToLine(configured());
    const next = structuredClone(product);
    next.groups[0].choices = next.groups[0].choices.filter(choice => choice.key === "raclette");
    next.supplements = [];
    next.removables = [];
    const result = reconcile([line], new Map([[next.id, next]]));
    expect(result).toEqual({ lines: [line], dropped: [] });
  });

  it("garde les autres lignes valides sans appliquer de substitution à la ligne refusée", () => {
    const invalid = selectedLine();
    const valid = draftToLine(setVariant(configured(selectedProduct), "petit"));
    const next = { ...selectedProduct, variants: selectedProduct.variants.slice(0, 1) };
    expect(reconcile([invalid, valid], new Map([[next.id, next]]))).toEqual({ lines: [valid], dropped: [invalid.name] });
  });

  it("conserve le changement explicite de variante et ses plafonds sans le confondre avec une restauration", () => {
    const next = structuredClone(selectedProduct);
    next.groups[0] = { ...next.groups[0], type: "multi", max: 2,
      perVariant: { petit: { min: 1, max: 1 }, grand: { min: 2, max: 2 } } };
    const draft = { ...configured(next), variantKey: "grand", picked: { fromage: ["raclette", "chevre"], pain: ["pain"], supplements: ["bacon"] } };
    const changed = setVariant(draft, "petit");
    expect(changed.picked.fromage).toEqual(["raclette"]);
    expect(changed.picked.supplements).toEqual(["bacon"]);
    expect(draftBlocker(changed)).toBeNull();
    const line = draftToLine(changed);
    expect(reconcile([line], new Map([[next.id, next]]))).toEqual({ lines: [line], dropped: [] });
  });
});
