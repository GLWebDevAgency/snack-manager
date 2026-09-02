import { describe, expect, it } from "vitest";
import { DIRECTIONS } from "@sm/contracts";
import { styleDuMasque } from "./styleDuMasque";

describe("styleDuMasque", () => {
  it("rend toutes les variables du résolveur plus colorScheme", () => {
    const s = styleDuMasque(DIRECTIONS.brasserie) as Record<string, string>;
    expect(s["--cf-bg"]).toBe("#f5efe3");
    expect(s["--cf-font-display"]).toContain("var(--police-fraunces)");
    expect(s.colorScheme).toBe("light");
  });
});
