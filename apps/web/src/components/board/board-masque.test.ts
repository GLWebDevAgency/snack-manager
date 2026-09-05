import { describe, expect, it } from "vitest";
import { DIRECTIONS, type ScreenContent } from "@sm/contracts";
import { masqueDuContenu } from "./board-masque";
import { Ardoise } from "./scenographies/ardoise/Ardoise";
import { Comptoir } from "./scenographies/comptoir/Comptoir";
import { moduleDe } from "./scenographies/registry";

/** Un contenu tel qu'une version ANTÉRIEURE l'a mis en cache : ni masque, ni scénographie. */
function cacheAncien(): ScreenContent {
  return {
    screenId: "s",
    name: "Comptoir",
    orientation: "landscape",
    theme: "brand",
    brand: { slug: "demo", name: "Chez Nino", logoUrl: "https://cdn.test/logo.png", accent: "#7a2e2a" },
    service: "lunch",
    serviceLabel: "Service du midi",
    open: true,
    scenes: [],
    contentHash: "x",
    generatedAt: "2026-09-05T10:00:00.000Z",
    dailyReloadAt: "2026-09-06T02:00:00.000Z",
    pollIntervalMs: 60_000,
    timezone: "Europe/Paris",
  } as unknown as ScreenContent;
}

describe("masqueDuContenu — le repli d'un cache antérieur", () => {
  it("rend le masque du contenu tel quel quand il est là", () => {
    const content = { ...cacheAncien(), masque: DIRECTIONS.soleil };
    expect(masqueDuContenu(content)).toBe(DIRECTIONS.soleil);
  });

  it("sans masque, replie sur l'accent et le logo plats plutôt que sur un écran noir", () => {
    const masque = masqueDuContenu(cacheAncien());
    expect(masque.palette.accent).toBe("#7a2e2a");
    expect(masque.logo.mark.dark).toBe("https://cdn.test/logo.png");
    expect(masque.preset).toBe("nuit");
  });

  it("sans contenu du tout, rend la direction de repli", () => {
    expect(masqueDuContenu(null).preset).toBe("nuit");
  });
});

describe("moduleDe — la scénographie d'un contenu", () => {
  it("un cache sans scénographie rend Ardoise, l'écran qu'il a toujours eu", () => {
    expect(moduleDe(undefined)).toBe(Ardoise);
    expect(moduleDe("inconnue")).toBe(Ardoise);
  });

  it("et le registre connaît Comptoir", () => {
    expect(moduleDe("comptoir")).toBe(Comptoir);
    expect(Comptoir.chrome).toBe("none");
    expect(Ardoise.chrome).toBe("header");
  });
});
