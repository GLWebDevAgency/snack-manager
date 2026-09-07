import { describe, expect, it } from "vitest";
import { publicRestaurantMetadata, restaurantMetadata } from "./restaurant-metadata";

describe("métadonnées des surfaces restaurant", () => {
  it("neutralise les icônes et l'installation plateforme même sans restaurant connu", () => {
    expect(publicRestaurantMetadata).toMatchObject({ title: "Restaurant", description: null, manifest: null, appleWebApp: null });
    expect(publicRestaurantMetadata.icons).toMatchObject({ apple: [], shortcut: [] });
    expect(JSON.stringify(publicRestaurantMetadata.icons)).toContain("data:image/svg+xml,");
    expect(JSON.stringify(publicRestaurantMetadata)).not.toMatch(/Snack|favicon\.ico|apple-icon\.png/);
  });

  it("ne publie qu'une icône publique, bornée au slug, sans manifeste commande", () => {
    expect(restaurantMetadata("classfood")).toMatchObject({
      manifest: null,
      appleWebApp: null,
      icons: { icon: [{ url: "/r/classfood/icon.svg", type: "image/svg+xml", sizes: "any" }], apple: [], shortcut: [] },
    });
  });

  it.each(["", "../demo", "classfood/ticket?t=secret", "a%2fb", "<script>"])(
    "ne fabrique pas d'adresse pour un slug invalide : %s", (slug) => {
      expect(restaurantMetadata(slug)).toEqual(publicRestaurantMetadata);
    },
  );
});
