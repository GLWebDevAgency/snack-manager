import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FONT_FAMILIES } from "@sm/contracts";

describe("les polices du masque", () => {
  it("chaque famille du contrat est déclarée côté web, et aucune de plus", () => {
    const src = readFileSync(join(__dirname, "polices.ts"), "utf8");
    const declarees = [...src.matchAll(/variable:\s*"--police-([a-z0-9-]+)"/g)].map((m) => m[1]).sort();
    expect(declarees).toEqual([...FONT_FAMILIES]);
  });
});
