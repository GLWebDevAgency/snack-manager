import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
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

    it("choreographs the photo, intact live text and exact price independently", () => {
      const html = renderToStaticMarkup(createElement(moduleDe(preset).Component, {
        scene: { ...scene, products: [{ ...product, photoUrl: "/food.webp" }] }, content,
        masque: DIRECTIONS.brasserie, orientation: "landscape", prixMono: false,
      }));
      expect(html).toContain(`data-story="${STUDIO_PROFILES[preset].story}"`);
      for (const part of ["photo", "name", "detail", "price"]) expect(html).toContain(`data-ss-part="${part}"`);
      expect(html).toContain('class="ss-live-text" data-fade="0"');
      expect(count(html, product.name)).toBe(1);
      expect(html).not.toContain('ss-product-halo ss-living');
      expect(html).not.toContain('class="ss-product ss-enter"');
      expect(html).toContain("6,50");
      expect(html).toContain("12,90 €");
    });
  });
}

describe("Studio cinema motion contract", () => {
  const css = readFileSync(new URL("./studio.css", import.meta.url), "utf8");

  it("authors thirteen distinct signatures and caps the beat schedule", () => {
    expect(new Set(Object.values(STUDIO_PROFILES).map((profile) => profile.story)).size).toBe(13);
    for (const profile of Object.values(STUDIO_PROFILES)) {
      for (const beat of Object.values(profile.beats)) expect(beat).toBeLessThanOrEqual(6);
      expect(css).toContain(`[data-story="${profile.story}"]`);
    }
  });

  it("uses host timing, static final states and only composite keyframes", () => {
    for (const variable of ["--bd-reveal-ms", "--bd-beat-ms", "--bd-intro-delay", "--bd-exit-ms", "--bd-travel", "--bd-scene-ms", "--bd-ease"]) expect(css).toContain(variable);
    expect(css).toContain('.ss[data-phase="in"] [data-ss-part]');
    expect(css).toContain('.ss[data-phase="out"] [data-ss-part]');
    expect(css).toContain('[data-still="1"]');
    expect(css).toContain('prefers-reduced-motion');
    expect(css).toContain('[data-paused="1"]');
    expect(css).not.toContain("ss-breathe");
    expect(css).toContain('.ss:not([data-dense="1"]):not([data-camera="still"]) .ss-product:first-child .ss-object');
    expect(css).toContain('.ss:not([data-camera="still"]) .ss-intro .ss-object');
    for (const [, body] of css.matchAll(/@keyframes[^\{]+\{([\s\S]*?)\n\}/g)) {
      for (const [, property] of body!.matchAll(/([a-z-]+)\s*:/g)) expect(["transform", "opacity"]).toContain(property);
    }
  });
});
