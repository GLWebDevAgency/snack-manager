import { describe, expect, it } from "vitest";
import type { MenuCategory, MenuProduct } from "./api";
import type { CartLine } from "./cart";
import { orderRecommendations } from "./recommendation-model";
const product = (id: string, changes: Partial<MenuProduct> = {}): MenuProduct => ({ id, name: id, description: "", price: 200, fromPrice: 200, photoUrl: null,
  outOfStock: false, configurable: false, variants: [], groups: [], removables: [], supplements: [], tags: [], isNew: false, ...changes });
const category = (name: string, products: MenuProduct[]): MenuCategory => ({ id: name, name, products });
describe("suggestions de la commande depuis la carte réelle", () => {
  it("retire toute catégorie déjà présente au panier et toute rupture", () => {
    const menu = [category("Boissons", [product("eau"), product("jus")]), category("Desserts", [product("tarte", { photoUrl: "/tarte.png" }), product("rupture", { photoUrl: "/x.png", outOfStock: true })])];
    expect(orderRecommendations(menu, [{ productId: "eau" } as CartLine]).map(product => product.id)).toEqual(["tarte"]);
  });
  it("ne suggère depuis la fiche que des ajouts simples, sans faire perdre les choix du plat", () => {
    const menu = [category("Desserts", [product("dessert", { photoUrl: "/d.png", configurable: true })]), category("Boissons", [product("eau")])];
    expect(orderRecommendations(menu, [], "plat", true).map(product => product.id)).toEqual(["eau"]);
    expect(orderRecommendations(menu, []).map(product => product.id)).toEqual(["eau", "dessert"]);
  });
  it("n’invente ni photo, ni catégorie similaire, ni disponibilité", () => {
    expect(orderRecommendations([category("Desserts", [product("invisible")]), category("Boissons premium", [product("produit")])], [])).toEqual([]);
  });
});
