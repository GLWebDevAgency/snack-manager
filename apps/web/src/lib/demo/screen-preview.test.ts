import { beforeEach, describe, expect, it } from "vitest";
import { DIRECTIONS, SCENOGRAPHIES, SCREEN_PRESENTATION_DEFAULT, type ScreenContent, type ScreenView } from "@sm/contracts";
import { demoWorld, resetDemoWorld, routeDemo } from "./router";

beforeEach(() => resetDemoWorld());

describe("apparence dans la démonstration", () => {
  it("prévisualise un brouillon sans changer l'écran, puis relit l'apparence enregistrée", () => {
    const screen = (routeDemo("GET", "/screens").body as ScreenView[])[0]!;
    const before = JSON.stringify(demoWorld().screens);
    const response = routeDemo("POST", "/screens/preview", {
      screenId: screen.id, scenography: "comptoir", theme: "light", orientation: "portrait",
    });
    expect(response.status).toBe(200);
    const content = response.body as ScreenContent;
    expect(content.scenography).toBe("comptoir");
    expect(content.masque.mode).toBe("light");
    expect(content.orientation).toBe("portrait");
    expect(content.scenes.length).toBeGreaterThan(0);
    expect(content.scenes.every((s) => s.products.length <= 8)).toBe(true);
    expect(JSON.stringify(demoWorld().screens)).toBe(before);
    routeDemo("PATCH", `/screens/${screen.id}`, { scenography: "comptoir" });
    const saved = (routeDemo("GET", "/screens").body as ScreenView[]).find((s) => s.id === screen.id)!;
    expect(saved.scenography).toBe("comptoir");
    expect(saved.scenographyLabel).toBe("Comptoir");
  });

  it("un nouvel écran garde son choix et le brouillon sans écran utilise Comptoir", () => {
    expect((routeDemo("POST", "/screens", { name: "Comptoir" }).body as ScreenView).scenography).toBe("comptoir");
    expect((routeDemo("POST", "/screens/preview", {}).body as ScreenContent).scenography).toBe("comptoir");
  });

  it("suit les changements de carte et de prix sans bruit d'horodatage", () => {
    const first = routeDemo("POST", "/screens/preview", {}).body as ScreenContent;
    const repeated = routeDemo("POST", "/screens/preview", {}).body as ScreenContent;
    expect(repeated.contentHash).toBe(first.contentHash);
    const shown = first.scenes.flatMap((s) => s.products).find((p) => p.priceCents === p.priceMaxCents)!;
    const row = demoWorld().products.find((p) => p._id === shown.id)!;
    row.price += 50;
    row.outOfStock = true;
    const changed = routeDemo("POST", "/screens/preview", {}).body as ScreenContent;
    expect(changed.contentHash).not.toBe(first.contentHash);
    expect(changed.scenes.flatMap((s) => s.products).find((p) => p.id === shown.id)).toMatchObject({
      priceCents: shown.priceCents + 50, outOfStock: true,
    });
  });

  it("refuse un écran inconnu et des réglages invalides", () => {
    expect(routeDemo("POST", "/screens/preview", { screenId: "inconnu" }).status).toBe(404);
    expect(routeDemo("POST", "/screens/preview", { scenography: "inconnue" }).status).toBe(400);
  });

  it("le choix midi ou soir filtre la carte sans devenir un réglage enregistré", () => {
    const world = demoWorld();
    const id = world.products[0]!._id;
    world.products[0]!.tags = ["midi"];
    const before = JSON.stringify(world.screens);
    const midi = routeDemo("POST", "/screens/preview", { service: "lunch" }).body as ScreenContent;
    const soir = routeDemo("POST", "/screens/preview", { service: "dinner" }).body as ScreenContent;
    expect(midi.service).toBe("lunch");
    expect(soir.service).toBe("dinner");
    expect(midi.scenes.flatMap((s) => s.products).some((p) => p.id === id)).toBe(true);
    expect(soir.scenes.flatMap((s) => s.products).some((p) => p.id === id)).toBe(false);
    expect(JSON.stringify(world.screens)).toBe(before);
  });

  it("les quinze modèles se prévisualisent et se relisent avec leurs personnalisations", () => {
    const screen = (routeDemo("GET", "/screens").body as ScreenView[])[0]!;
    const presentation = { ...SCREEN_PRESENTATION_DEFAULT, corners: "round", priceScale: "large", motion: "off" } as const;
    for (const scenography of SCENOGRAPHIES) {
      const preview = routeDemo("POST", "/screens/preview", { screenId: screen.id, scenography, presentation });
      expect(preview.status).toBe(200);
      expect(preview.body).toMatchObject({ scenography, presentation });
      expect(routeDemo("PATCH", `/screens/${screen.id}`, { scenography, presentation }).body).toMatchObject({ scenography, presentation });
      expect((routeDemo("GET", "/screens").body as ScreenView[])[0]).toMatchObject({ scenography, presentation });
    }
  });

  it("l'aperçu d'identité ne change ni la marque ni les écrans, même après un PATCH d'apparence", () => {
    const world = demoWorld();
    const beforeBrand = JSON.stringify(world.tenant.brand);
    const beforeScreens = JSON.stringify(world.screens);
    const preview = routeDemo("POST", "/screens/preview", { brandDraft: DIRECTIONS.brasserie });
    expect(preview.status).toBe(200);
    expect(preview.body).toMatchObject({ masque: DIRECTIONS.brasserie });
    expect(JSON.stringify(world.tenant.brand)).toBe(beforeBrand);
    expect(JSON.stringify(world.screens)).toBe(beforeScreens);
    routeDemo("PATCH", `/screens/${world.screens[0]!.id}`, { scenography: "halo", brandDraft: DIRECTIONS.brasserie, service: "lunch" });
    expect(world.screens[0]).not.toHaveProperty("brandDraft");
    expect(world.screens[0]).not.toHaveProperty("service");
    expect(JSON.stringify(world.tenant.brand)).toBe(beforeBrand);
  });

  it("ajoute les choix explicites après les pages de catégorie, en conservant l'ordre", () => {
    const world = demoWorld();
    const category = world.categories[0]!;
    const candidates = world.products.filter((p) => p.categoryId === category._id && p.active).slice(0, 3);
    for (const candidate of candidates) { candidate.outOfStock = false; candidate.tags = []; candidate.isNew = true; }
    category.featuredProductIds = candidates.map((p) => p._id).reverse();
    const playlist = [
      { kind: "category", categoryId: category._id },
      { kind: "category", categoryId: category._id },
    ];
    const content = routeDemo("POST", "/screens/preview", { playlist }).body as ScreenContent;
    const highlights = content.scenes.filter((scene) => scene.id === `featured:category:${category._id}`);
    expect(highlights).toHaveLength(1);
    expect(highlights[0]).toMatchObject({ kind: "featured", title: "Nos nouveautés", durationMs: 10_000 });
    expect(highlights[0]!.products.map((p) => p.id)).toEqual(category.featuredProductIds);
    const at = content.scenes.indexOf(highlights[0]!);
    expect(content.scenes.slice(0, at).every((scene) => scene.kind === "category")).toBe(true);
    expect(content.scenes[at + 1]!.kind).toBe("category");
  });

  it("écarte des mises en avant les ruptures, l'autre service et les doublons manuels", () => {
    const world = demoWorld();
    const category = world.categories[0]!;
    const [stock, evening, manual] = world.products.filter((p) => p.categoryId === category._id && p.active).slice(0, 3);
    stock!.outOfStock = true;
    evening!.tags = ["soir"];
    manual!.outOfStock = false; manual!.tags = [];
    category.featuredProductIds = [stock!._id, evening!._id, manual!._id];
    const content = routeDemo("POST", "/screens/preview", { service: "lunch", playlist: [
      { kind: "category", categoryId: category._id },
      { kind: "featured", productIds: [manual!._id, stock!._id] },
    ] }).body as ScreenContent;
    expect(content.scenes.some((scene) => scene.id === `featured:category:${category._id}`)).toBe(false);
    expect(content.scenes.filter((scene) => scene.kind === "featured").flatMap((scene) => scene.products.map((p) => p.id))).toEqual([manual!._id]);
  });
});
