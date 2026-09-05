import { describe, expect, it } from "vitest";
import type { PublicSiteProduct } from "@sm/contracts";
import { createDemoState, priceLine } from "./state";

describe("retraits du menu démo et contrat public enrichi", () => {
  it.each<{ removables: PublicSiteProduct["removables"] }>([
    { removables: ["crudites"] },
    { removables: [{ key: "crudites", label: "Crudités" }] },
  ])("accepte la clé fournie, jamais son libellé inventé : %j", ({ removables }) => {
    const state = createDemoState();
    const first = state.products.values().next().value!;
    const product = { ...first, variants: [], optionGroups: [], removables };
    const priced = priceLine(new Map([[product._id, product]]), {
      productId: product._id, options: [], removed: ["crudites", "inconnu"], qty: 1,
    });
    expect(priced.removed).toEqual(["crudites"]);
  });
});
