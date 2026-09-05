import { describe, expect, it } from "vitest";
import { DIRECTIONS, type ScreenContent, type ScreenScenePayload } from "@sm/contracts";
import { mediasDuContenu } from "./board-autonomie";

function scene(photos: (string | null)[]): ScreenScenePayload {
  return {
    id: `s-${photos.length}`,
    kind: "category",
    title: "Nos burgers",
    subtitle: null,
    durationMs: 10_000,
    products: photos.map((photoUrl, i) => ({
      id: `p${i}`,
      name: `Produit ${i}`,
      description: "",
      priceLabel: "9,50 €",
      priceCents: 950,
      priceMaxCents: 950,
      photoUrl,
      photoPoint: null,
      isNew: false,
      outOfStock: false,
    })),
    promos: [],
    nextOpening: null,
  };
}

function contenu(scenes: ScreenScenePayload[], logoUrl: string | null): ScreenContent {
  return {
    screenId: "s",
    name: "Comptoir",
    orientation: "landscape",
    theme: "brand",
    scenography: "comptoir",
    masque: {
      ...DIRECTIONS.nuit,
      logo: {
        mark: { light: "https://api.test/public/medias/t/logo-clair", dark: null },
        lockup: { light: null, dark: "https://api.test/public/medias/t/verrou-sombre" },
      },
    },
    brand: { slug: "demo", name: "Chez Nino", logoUrl, accent: DIRECTIONS.nuit.palette.accent },
    service: "dinner",
    serviceLabel: "Service du soir",
    open: true,
    scenes,
    contentHash: "x",
    generatedAt: "2026-09-05T18:00:00.000Z",
    dailyReloadAt: "2026-09-06T02:00:00.000Z",
    pollIntervalMs: 60_000,
    timezone: "Europe/Paris",
  };
}

describe("mediasDuContenu — tout ce que la boucle affiche, une fois chacun", () => {
  it("réunit les photos de toutes les scènes, le logo et les emplacements du masque, sans doublon", () => {
    const urls = mediasDuContenu(
      contenu(
        [
          scene(["https://api.test/public/medias/t/a", null, "https://api.test/public/medias/t/b"]),
          scene(["https://api.test/public/medias/t/b", "/photos/kebab.png"]),
        ],
        "https://api.test/public/medias/t/logo-clair",
      ),
    );
    expect(urls).toEqual([
      "https://api.test/public/medias/t/a",
      "https://api.test/public/medias/t/b",
      "/photos/kebab.png",
      "https://api.test/public/medias/t/logo-clair",
      "https://api.test/public/medias/t/verrou-sombre",
    ]);
  });

  it("ignore les adresses vides et les données en ligne", () => {
    const urls = mediasDuContenu(contenu([scene(["", "data:image/png;base64,AAAA"])], null));
    expect(urls).toEqual([
      "https://api.test/public/medias/t/logo-clair",
      "https://api.test/public/medias/t/verrou-sombre",
    ]);
  });

  it("sans contenu, rien à précacher", () => {
    expect(mediasDuContenu(null)).toEqual([]);
  });
});
