import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DIRECTIONS, SCENOGRAPHIES, type ScreenContent, type ScreenProduct, type ScreenScenePayload } from "@sm/contracts";
import { moduleDe } from "../registry";
import { STUDIO_PROFILES } from "./profiles";

const product: ScreenProduct = {
  id: "p", name: "Milkshake Fraise et vanille de Madagascar", description: "Préparé à la commande",
  priceCents: 650, priceMaxCents: 1290, priceLabel: "6,50 – 12,90 €", photoUrl: null, photoPoint: null, isNew: true, outOfStock: false,
};
const scene: ScreenScenePayload = { id: "s", kind: "featured", title: "Notre sélection", subtitle: null, durationMs: 12000, products: [], promos: [], nextOpening: null };
const content: ScreenContent = {
  screenId: "screen", name: "TV", orientation: "landscape", theme: "brand", scenography: "affiche", masque: DIRECTIONS.brasserie,
  brand: { name: "Chez Nino", slug: "nino", logoUrl: null, accent: DIRECTIONS.brasserie.palette.accent },
  service: "lunch", serviceLabel: "Service du midi", open: true, scenes: [], contentHash: "hash", generatedAt: "", dailyReloadAt: "", pollIntervalMs: 60000, timezone: "Europe/Paris",
};
const count = (html: string, needle: string) => html.split(needle).length - 1;

describe("all fifteen scenographies are real modules", () => {
  it("registers every contract id, with thirteen independently authored profiles", () => {
    expect(SCENOGRAPHIES).toHaveLength(15);
    expect(Object.keys(STUDIO_PROFILES)).toHaveLength(13);
    for (const slug of SCENOGRAPHIES.filter((id) => id !== "ardoise")) expect(moduleDe(slug)).not.toBe(moduleDe("unknown"));
  });
});

// Counts cover spotlight selections, an ordinary category, and the hardest dense portrait.
for (const preset of Object.keys(STUDIO_PROFILES) as (keyof typeof STUDIO_PROFILES)[]) {
  describe(preset, () => {
    for (const orientation of ["landscape", "portrait"] as const) {
      it.each([1, 2, 3, 4, 8])(`keeps every full product name and range in ${orientation} (%i products)`, (n) => {
        const products = Array.from({ length: n }, (_, i) => ({ ...product, id: `p${i}`, outOfStock: i === n - 1 }));
        const html = renderToStaticMarkup(createElement(moduleDe(preset).Component, {
          scene: { ...scene, kind: n > 3 ? "category" : "featured", products }, content, masque: DIRECTIONS.brasserie, orientation, prixMono: false,
        }));
        expect(count(html, "data-product-id=")).toBe(n);
        expect(count(html, product.name)).toBe(n);
        expect(count(html, 'class="ss-price"')).toBe(n);
        expect(count(html, "12,90 €")).toBe(n);
        expect(html).toContain("Nouveau");
        expect(html).toContain("Épuisé");
        expect(html).toContain("Chez Nino");
        expect(html).not.toContain('src="null"');
      });
    }

    it("preserves the offer wording, closed hours and empty brand panel", () => {
      const render = (patch: Partial<ScreenScenePayload>) => renderToStaticMarkup(createElement(moduleDe(preset).Component, {
        scene: { ...scene, ...patch }, content, masque: DIRECTIONS.brasserie, orientation: "portrait", prixMono: false, phase: "out",
      }));
      const offers = render({ kind: "promo", promos: [{ id: "o", title: "Le midi", description: "Sur les menus éligibles", label: "−20 %" }] });
      expect(offers).toContain("−20 %");
      expect(offers).not.toContain('class="ss-price"');
      expect(offers).toContain('data-phase="out"');
      const closed = render({ kind: "closed", title: "À bientôt", nextOpening: { dayLabel: "Demain", date: "2026-09-06", windows: ["11:30 – 14:30"], opensAt: "" } });
      expect(closed).toContain("Réouverture Demain");
      expect(closed).toContain("11:30 – 14:30");
      expect(render({ kind: "custom", title: "Bienvenue" })).toContain("Bienvenue");
    });
  });
}
