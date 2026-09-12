import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { shapes } from "@sm/design-icons";
import { Glyph } from "./primitives";

describe("signes de la commande issus du kit", () => {
  it.each([["pin", "pin"], ["bag", "bag"], ["fire", "spicy"]] as const)("%s utilise le vecteur %s sans changer ses attributs", (name, target) => {
    const html = renderToStaticMarkup(createElement(Glyph, { name, size: 27, stroke: 2.2, filled: true, className: "pickup-icon" }));
    expect(html).toContain(shapes[target]);
    expect(html).toContain('width="27"');
    expect(html).toContain('stroke-width="2.2"');
    expect(html).toContain('fill="currentColor"');
    expect(html).toContain('class="pickup-icon"');
    expect(html).toContain('aria-hidden="true"');
  });

  it.each(["spark", "sliders"] as const)("conserve %s, absent du kit", (name) => {
    const html = renderToStaticMarkup(createElement(Glyph, { name }));
    expect(html).toContain('<path ');
    expect(html).toContain('fill="none"');
  });
});
