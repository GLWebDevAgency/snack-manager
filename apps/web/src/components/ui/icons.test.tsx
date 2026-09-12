import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { iconNames, shapes, legacyIconAliases, resolveIconName } from "@sm/design-icons";
import { Icon, ICON_NAMES } from "./icons";

describe("icônes intégrées du projet", () => {
  it("rend chaque icône du kit et garde les clés historiques hors kit", () => {
    for (const name of [...iconNames, "gear", "ticket", "cart", "navigation"] as const) {
      expect(ICON_NAMES).toContain(name);
      const html = renderToStaticMarkup(createElement(Icon, { name }));
      expect(html).toMatch(/<(path|circle|rect) /);
      expect(html).toContain('aria-hidden="true"');
      expect(html).not.toMatch(/undefined|<script|foreignObject/);
    }
  });

  it("conserve les dimensions, le trait et les attributs fournis par l'appelant", () => {
    const html = renderToStaticMarkup(createElement(Icon, { name: "pizza", size: 28, stroke: 2.3, className: "category-icon" }));
    expect(html).toContain('width="28"');
    expect(html).toContain('stroke-width="2.3"');
    expect(html).toContain('class="category-icon"');
  });

  it("rend le tracé du kit pour les anciens noms plutôt que leur ancien dessin", () => {
    for (const [name, target] of Object.entries(legacyIconAliases)) {
      const html = renderToStaticMarkup(createElement(Icon, { name: name as keyof typeof legacyIconAliases }));
      expect(html).toContain(shapes[target]);
      expect(ICON_NAMES).toContain(name);
    }
    expect(resolveIconName('gear')).toBe('settings');
    expect(resolveIconName('receipt')).toBe('orders');
    expect(resolveIconName('drink')).toBe('cup');
    expect(resolveIconName('inconnue')).toBeNull();
    expect(resolveIconName('toString')).toBeNull();
    expect(resolveIconName('trash')).toBeNull();
  });
});
