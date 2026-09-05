import { describe, expect, it } from "vitest";
import type { ScreenContent, ScreenProduct, ScreenScenePayload } from "@sm/contracts";
import { galleryPreviewScene } from "./gallery-preview";

const product = (id: string, photoUrl: string | null = null, outOfStock = false): ScreenProduct => ({
  id, name: id, description: "Composition réelle", priceCents: 850, priceMaxCents: 950,
  priceLabel: "8,50 – 9,50 €", photoUrl, photoPoint: null, isNew: false, outOfStock,
});
const scene = (id: string, products: ScreenProduct[], kind: ScreenScenePayload["kind"] = "category"): ScreenScenePayload => ({
  id, kind, title: "Notre carte", subtitle: null, durationMs: 10_000, products, promos: [], nextOpening: null,
});
const content = (scenes: ScreenScenePayload[]) => ({ scenes }) as ScreenContent;

describe("les miniatures illustratives utilisent uniquement la vraie carte", () => {
  it("garde les scènes entières pour les deux modèles historiques", () => {
    const first = scene("menu", [product("a"), product("b")]);
    expect(galleryPreviewScene(content([first]), "ardoise")).toBe(first);
    expect(galleryPreviewScene(content([first]), "comptoir")).toBe(first);
  });

  it("préfère la sélection explicite sans modifier les objets produit ni la boucle", () => {
    const selected = product("signature");
    const value = content([scene("menu", [product("photo", "/vraie-photo.webp")]), scene("selection", [selected], "featured")]);
    const before = JSON.stringify(value);
    const thumbnail = galleryPreviewScene(value, "affiche")!;
    expect(thumbnail.products).toEqual([selected]);
    expect(thumbnail.products[0]).toBe(selected);
    expect(thumbnail.title).toBe(selected.name);
    expect(JSON.stringify(value)).toBe(before);
  });

  it("varie entre un, deux et trois produits réels, avec les photos disponibles en premier", () => {
    const without = product("sans-photo");
    const photo = product("avec-photo", "/photo.webp");
    const other = product("autre-photo", "/autre.webp");
    const value = content([scene("menu", [without, photo, other, product("epuise", "/epuise.webp", true)]), scene("copie", [photo])]);
    expect(galleryPreviewScene(value, "halo")!.products).toEqual([photo]);
    expect(galleryPreviewScene(value, "premiere")!.products).toEqual([photo, other]);
    expect(galleryPreviewScene(value, "prisme")!.products).toEqual([photo, other, without]);
    expect(value.scenes[0]!.products[0]).toBe(without);
  });

  it("ne fabrique aucun produit quand la carte est vide ou fermée", () => {
    const closed = scene("ferme", [], "closed");
    expect(galleryPreviewScene(content([closed]), "halo")).toBe(closed);
    expect(galleryPreviewScene(content([]), "prisme")).toBeNull();
  });
});
