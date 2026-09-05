import { beforeEach, describe, expect, it } from "vitest";
import type { ScreenContent, ScreenView } from "@sm/contracts";
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
});
