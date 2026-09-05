import { describe, expect, it } from "vitest";
import { storefrontHighlights } from "./highlights";
import type { MenuCategory, MenuProduct } from "./api";
import { orderingApi } from "./api";

const product = (id: string, photoUrl: string | null = null, outOfStock = false) => ({ id, photoUrl, outOfStock }) as MenuProduct;
const category = (id: string, products: MenuProduct[], featuredProductIds?: string[], featuredConfigured?: boolean): MenuCategory => ({ id, name: id, products, featuredProductIds, featuredConfigured });

describe("Incontournables partagés avec les écrans", () => {
  it("respecte les choix et leur ordre sans priorité artificielle aux photos", () => {
    const a = product("a"), b = product("b", "/photo"), c = product("c");
    expect(storefrontHighlights([category("one", [a, b], ["a", "b"]), category("two", [c], ["c"])])).toEqual([a, b, c]);
  });
  it("ignore références déplacées, supprimées, en rupture et doublons", () => {
    const a = product("a"), b = product("b", null, true), moved = product("moved");
    expect(storefrontHighlights([category("one", [a, b], ["moved", "missing", "b", "a"]), category("two", [moved, a], ["a"])])).toEqual([a]);
  });
  it("ne remplace pas une sélection volontairement vidée par des suggestions", () => {
    expect(storefrontHighlights([category("one", [product("a")], [], true)])).toEqual([]);
  });
  it("conserve cette intention lorsque la catégorie configurée est masquée", () => {
    expect(storefrontHighlights([category("one", [product("a")])], true)).toEqual([]);
  });
  it("garde le repli photographique de huit produits pour une ancienne carte", () => {
    const ps = Array.from({ length: 10 }, (_, i) => product(String(i), i === 9 ? "/photo" : null));
    expect(storefrontHighlights([category("one", ps)]).map((p) => p.id)).toEqual(["9", "0", "1", "2", "3", "4", "5", "6"]);
  });
  it("n'écarte pas silencieusement les choix des dernières catégories", () => {
    const categories = Array.from({ length: 4 }, (_, i) => category(String(i), [product(`${i}a`), product(`${i}b`), product(`${i}c`)], [`${i}c`, `${i}a`, `${i}b`]));
    expect(storefrontHighlights(categories)).toHaveLength(12);
  });
  it("préserve le marqueur public quand le normaliseur masque une catégorie vide", async () => {
    const site = await orderingApi({ send: async () => ({ status: 200, body: {
      tenant: { slug: "demo", name: "Restaurant" },
      menu: { categories: [{ _id: "empty", name: "Vide", products: [], featuredConfigured: true, featuredProductIds: [] }, { _id: "one", name: "Carte", products: [{ _id: "a", name: "Kebab", price: 800 }] }] },
    } }) }).loadSite("demo");
    expect(site?.categories).toHaveLength(1);
    expect(site?.featuredConfigured).toBe(true);
    expect(storefrontHighlights(site!.categories, site!.featuredConfigured)).toEqual([]);
  });
  it("tolère une ancienne API dont la carte est momentanément indisponible", async () => {
    const site = await orderingApi({ send: async ({ path }) => path.endsWith("/site") ? { status: 404, body: {} }
      : path.endsWith("/menu") ? { status: 503, body: {} }
      : { status: 200, body: { slug: "demo", name: "Restaurant", hours: [] } } }).loadSite("demo");
    expect(site?.categories).toEqual([]);
    expect(site?.featuredConfigured).toBe(false);
  });
});
