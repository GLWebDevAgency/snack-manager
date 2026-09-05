import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DIRECTIONS, type ScreenContent, type ScreenProduct, type ScreenScenePayload } from "@sm/contracts";
import { Ardoise } from "./Ardoise";

const product: ScreenProduct = {
  id: "burger", name: "Le Suprême", description: "Cheddar, salade et sauce maison",
  priceLabel: "9,50 €", priceCents: 950, priceMaxCents: 950,
  photoUrl: "/burger.webp", photoPoint: { x: 35, y: 65 }, isNew: true, outOfStock: false,
};
const content = { brand: { name: "Chez Nino", logoUrl: "/logo.svg" } } as ScreenContent;
function render(patch: Partial<ScreenScenePayload> = {}, orientation: "portrait" | "landscape" = "landscape") {
  return renderToStaticMarkup(createElement(Ardoise.Component, {
    scene: { id: "scene", kind: "category", title: "Nos burgers", subtitle: "1 / 2", durationMs: 4_000,
      products: [product], promos: [], nextOpening: null, ...patch },
    content, orientation, masque: DIRECTIONS.nuit, prixMono: false,
  }));
}

describe("Ardoise — compositions et prix conservés pendant le film", () => {
  it.each(["portrait", "landscape"] as const)("conserve huit lignes, les vraies étiquettes et les ruptures en %s", (orientation) => {
    const html = render({ products: Array.from({ length: 8 }, (_, i) => ({ ...product, id: `p${i}`, outOfStock: i === 2 })) }, orientation);
    expect(html.split('class="bd-row"')).toHaveLength(9);
    expect(html.split('9,50 €')).toHaveLength(9);
    expect(html).toContain('data-out="1"');
    expect(html).toContain('Épuisé');
    expect(html).toContain('--bd-i:7');
  });

  it("garde la photo décodée séparée de son mouvement et les prix hors fondu live", () => {
    const html = render();
    expect(html).toContain('class="ct-photo-frame"');
    expect(html).toContain('<div class="bd-hero-price">9,50 €</div>');
    expect(html).not.toContain('data-fade');
    expect(html).toContain('Le Suprême');
  });

  it("ne retire ni la promotion ni l'annonce de réouverture", () => {
    expect(render({ kind: "promo", promos: [{ id: "offre", title: "Menu du soir", description: "Une boisson incluse", label: "−20 %" }] })).toContain('−20 %');
    expect(render({ kind: "closed", nextOpening: { dayLabel: "demain", date: "2026-09-06", windows: ["11:30 – 14:30"], opensAt: "" } })).toContain('11:30 – 14:30');
    expect(render({ products: [], title: "Bienvenue" })).toContain('Bienvenue');
  });
});

describe("Ardoise — grammaire d'animation locale", () => {
  it("orchestration à l'entrée seulement, aucun filtre coûteux ni prix animé en continu", () => {
    const css = readFileSync(new URL("./ardoise-motion.css", import.meta.url), "utf8");
    expect(css).toContain('.bd-layer[data-phase="in"]');
    expect(css).toContain('.bd-layer[data-phase="out"] .ct-drift');
    expect(css).toContain('var(--bd-reveal-ms)');
    expect(css).toContain('var(--bd-beat-ms)');
    for (const block of css.match(/@keyframes[^{]*\{[\s\S]*?\n\}/g) ?? []) {
      const properties = [...block.matchAll(/(?:^|[{;])\s*([a-z-]+)\s*:/g)].map((m) => m[1]);
      for (const property of properties) expect(["transform", "opacity"]).toContain(property);
    }
    expect(css).not.toMatch(/#[0-9a-fA-F]{3,6}\b/);
  });
});
