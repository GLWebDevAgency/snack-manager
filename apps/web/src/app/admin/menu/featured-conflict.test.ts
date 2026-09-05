import { describe, expect, it, vi } from "vitest";
import { recoverFeaturedConflict } from "./featured-conflict";
import type { RawMenu } from "./product-normalize";

const current = { categoryId: "c1", featuredProductIds: ["new", "old"], featuredRevision: 4 };

describe("Récupération d’un conflit de mise en avant", () => {
  it("charge le nouveau produit et ses informations sans remplacer l’ordre ni la révision du conflit", async () => {
    const menu: RawMenu = { categories: [{ _id: "c1", name: "Sandwichs renommés", active: false,
      featuredProductIds: ["old"], featuredRevision: 5,
      products: [{ _id: "old", name: "Classique", price: 800 },
        { _id: "new", name: "Nouveau burger", price: 0, variants: [{ key: "xl", name: "XL", price: 1200 }], medias: ["m1"], photoUrl: "/nouveau.webp", outOfStock: true }],
    }] };
    const before = structuredClone(menu);
    const read = vi.fn(async () => menu);
    const recovered = await recoverFeaturedConflict(current, read);
    expect(read).toHaveBeenCalledOnce();
    expect(recovered.selection).toEqual(current);
    expect(recovered.details).toMatchObject({ name: "Sandwichs renommés", active: false });
    expect(recovered.details?.products.find((p) => p._id === "new")).toMatchObject({
      name: "Nouveau burger", categoryId: "c1", medias: ["m1"], photoUrl: "/nouveau.webp", outOfStock: true,
      variants: [{ key: "xl", name: "XL", price: 1200 }],
    });
    expect(menu).toEqual(before);
  });

  it.each(["network", "category-missing"])("préserve tous les IDs courants si les informations ne sont pas disponibles (%s)", async (failure) => {
    const recovered = await recoverFeaturedConflict(current, async () => {
      if (failure === "network") throw new Error("Hors ligne");
      return { categories: [{ _id: "neighbor", products: [{ _id: "new", name: "Autre catégorie" }] }] };
    });
    expect(recovered.selection).toEqual(current);
    expect(recovered.details).toBeNull();
  });

  it("une référence absente du GET reste sélectionnée jusqu’à une décision explicite", async () => {
    const recovered = await recoverFeaturedConflict(current, async () => ({ categories: [{ _id: "c1", products: [] }] }));
    expect(recovered.selection.featuredProductIds).toEqual(["new", "old"]);
    expect(recovered.details?.products).toEqual([]);
  });
});
