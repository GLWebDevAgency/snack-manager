import { beforeEach, describe, expect, it } from "vitest";
import { demoWorld, resetDemoWorld, routeDemo } from "./router";

beforeEach(() => resetDemoWorld());
const fixture = () => {
  const w = demoWorld();
  const cat = w.categories.find((c) => w.products.filter((p) => p.categoryId === c._id).length >= 4)!;
  return { w, cat, products: w.products.filter((p) => p.categoryId === cat._id) };
};
describe("Mise en avant dans la démonstration", () => {
  it("enregistre la sélection ordonnée et refuse un second poste périmé", () => {
    const { cat, products } = fixture();
    const ids = [products[2]!._id, products[0]!._id];
    expect(routeDemo("PUT", `/categories/${cat._id}/featured`, { productIds: ids, expectedRevision: 0 })).toMatchObject({ status: 200, body: { featuredProductIds: ids, featuredRevision: 1 } });
    expect(routeDemo("PUT", `/categories/${cat._id}/featured`, { productIds: [], expectedRevision: 0 })).toMatchObject({ status: 409, body: { current: { featuredProductIds: ids, featuredRevision: 1 } } });
  });
  it("refuse plus de trois, doublons et produit d'une autre catégorie", () => {
    const { w, cat, products } = fixture();
    for (const ids of [products.slice(0, 4).map((p) => p._id), [products[0]!._id, products[0]!._id], [w.products.find((p) => p.categoryId !== cat._id)!._id]]) {
      expect(routeDemo("PUT", `/categories/${cat._id}/featured`, { productIds: ids, expectedRevision: 0 }).status).toBe(400);
    }
  });
  it("garde les ruptures sélectionnées et purge les produits déplacés ou supprimés", () => {
    const { cat, products } = fixture();
    routeDemo("PUT", `/categories/${cat._id}/featured`, { productIds: products.slice(0, 3).map((p) => p._id), expectedRevision: 0 });
    routeDemo("POST", `/products/${products[0]!._id}/stock`, { outOfStock: true });
    expect(cat.featuredProductIds).toHaveLength(3);
    routeDemo("PATCH", `/products/${products[1]!._id}`, { categoryId: null });
    routeDemo("DELETE", `/products/${products[2]!._id}`);
    expect(cat.featuredProductIds).toEqual([products[0]!._id]);
    expect(cat.featuredRevision).toBe(3);
  });
});
