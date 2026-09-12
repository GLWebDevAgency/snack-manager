import { describe, expect, it } from "vitest";
import { dark, light } from "@sm/design-tokens";
import { melanger, ratioContraste } from "@sm/contracts";
import { tenantAccentPalette } from "@/lib/tenant-accent";
import { backofficeStyle, backofficeVisualStyle as style } from "./visual-style";

describe("staff presentation boundaries", () => {
  it("keeps readable text, focus and field boundaries on every new surface", () => {
    for (const background of [dark.canvas, dark.surface, dark.secondary]) {
      for (const foreground of [style["--cf-text"], style["--cf-mut"]]) {
        expect(ratioContraste(foreground, background)).toBeGreaterThanOrEqual(4.5);
      }
      for (const foreground of [style["--cf-focus"], style["--cf-line-firm"]]) {
        expect(ratioContraste(foreground, background)).toBeGreaterThanOrEqual(3);
      }
    }
  });

  it("keeps the existing tenant accent readable in active navigation", () => {
    for (const source of ["#000000", "#ffffff", "#ed612e", "#c9a15a", "#0000ff", "#ffff00"]) {
      const { accent, onAccent } = tenantAccentPalette(source);
      expect(ratioContraste(onAccent, accent)).toBeGreaterThanOrEqual(4.5);
      expect(ratioContraste(accent, melanger(dark.surface, accent, .14))).toBeGreaterThanOrEqual(4.5);
    }
  });

  it.each([
    { label: "alert", ink: "--cf-red-t", fill: "#c94b3f", tints: [.1, .12, .15] },
    { label: "ready", ink: "--cf-green-t", fill: "#3fae4a", tints: [.1, .14, .16] },
    { label: "preparing", ink: "--cf-amber-t", fill: "#e0973f", tints: [.1, .12, .15] },
  ] as const)("keeps $label labels readable on hovered, tinted surfaces", ({ ink, fill, tints }) => {
    // Actual composition: ClientLine (sm/clients/page.tsx) applies white 4%
    // on hover, then AccountPill (sm/clients/ui.tsx) paints red 12% above it.
    // Other existing pills and SlotToggle use the listed functional washes.
    for (const background of [dark.canvas, dark.surface, dark.secondary]) {
      for (const hover of [0, .04]) {
        const row = melanger(background, "#ffffff", hover);
        for (const tint of [0, ...tints]) {
          const composed = melanger(row, fill, tint);
          expect(ratioContraste(style[ink], composed), `${ink} on ${background}, hover ${hover}, tint ${tint}`)
            .toBeGreaterThanOrEqual(4.5);
        }
      }
    }
  });

  it("does not take ownership of brand identity or functional verdicts", () => {
    for (const key of ["--cf-accent", "--cf-on-accent", "--cf-accent-hover", "--cf-green", "--cf-red", "--cf-amber", "--cf-gold", "--cf-font-body", "--cf-font-display"]) {
      expect(Object.hasOwn(style, key)).toBe(false);
    }
  });
});

for (const mode of ["light", "dark"] as const) {
  describe(`staff ${mode} appearance`, () => {
    const tokens = mode === "light" ? light : dark;
    it("keeps neutral and functional text AA in rows, hover and status washes", () => {
      const current = backofficeStyle(mode);
      for (const background of [tokens.canvas, tokens.surface, tokens.secondary]) {
        for (const hover of [0, .04, .08]) {
          const row = melanger(background, mode === "light" ? tokens.ink : "#ffffff", hover);
          expect(ratioContraste(current["--cf-text"], row)).toBeGreaterThanOrEqual(4.5);
          expect(ratioContraste(current["--cf-mut"], row)).toBeGreaterThanOrEqual(4.5);
          for (const [key, fill] of [["--cf-red-t", "#c94b3f"], ["--cf-green-t", "#3fae4a"], ["--cf-amber-t", "#e0973f"], ["--cf-gold-ink", "#c9a15a"]] as const) {
            for (const tint of [.1, .12, .15, .16]) expect(ratioContraste(current[key], melanger(row, fill, tint)), `${mode}/${key}/${hover}/${tint}`).toBeGreaterThanOrEqual(4.5);
          }
        }
      }
    });
    it("adapts accent ink while keeping brand fills and customer typography outside its ownership", () => {
      for (const accent of ["#000000", "#ffffff", "#ed612e", "#c9a15a", "#0000ff", "#ffff00"]) {
        const current = backofficeStyle(mode, accent);
        for (const background of [tokens.canvas, tokens.surface, tokens.secondary]) {
          expect(ratioContraste(current["--cf-accent-ink"], melanger(background, accent, .2))).toBeGreaterThanOrEqual(4.5);
        }
        for (const key of ["--cf-accent", "--cf-on-accent", "--cf-green", "--cf-red", "--cf-amber", "--cf-font-body", "--cf-font-display"]) expect(Object.hasOwn(current, key)).toBe(false);
      }
    });
  });
}
