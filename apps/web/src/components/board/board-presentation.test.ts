import { describe, expect, it } from "vitest";
import { DIRECTIONS } from "@sm/contracts";
import { boardPresentation } from "./board-presentation";

describe("screen presentation preserves the restaurant identity", () => {
  it("inherits a valid legacy default without overriding a font, logo or colour", () => {
    const brand = DIRECTIONS.brasserie;
    const before = JSON.stringify(brand);
    const result = boardPresentation(brand, undefined);
    expect(result.presentation.corners).toBe("brand");
    expect(result.motion).toBe("subtle");
    expect(Object.keys(result.style).some((key) => /font|logo|accent|text|bg/.test(key))).toBe(false);
    expect(JSON.stringify(brand)).toBe(before);
  });

  it("local knobs affect only size, geometry and movement", () => {
    const result = boardPresentation(DIRECTIONS.neon, { version: 1, corners: "square", priceScale: "large", motion: "off" });
    expect(result.style).toMatchObject({ "--bd-corner": "0px", "--cf-r-lg": "0px", "--bd-price-scale": 1.14 });
    expect(result.motion).toBe("off");
  });

  it("the vivid brand has its own rhythm while an explicit subtle choice takes precedence", () => {
    expect(boardPresentation(DIRECTIONS.neon, undefined).motion).toBe("expressive");
    expect(boardPresentation(DIRECTIONS.neon, { version: 1, motion: "subtle" }).motion).toBe("subtle");
  });
});
