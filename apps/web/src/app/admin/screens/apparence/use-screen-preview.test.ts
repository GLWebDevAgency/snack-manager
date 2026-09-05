import { describe, expect, it } from "vitest";
import { DIRECTIONS, SCREEN_PRESENTATION_DEFAULT } from "@sm/contracts";
import { cleDuBrouillon } from "./use-screen-preview";

describe("cleDuBrouillon — ce qui déclenche un nouvel aperçu", () => {
  it("change avec chaque réglage, pas avec l'ordre des clés", () => {
    const a = cleDuBrouillon({
      screenId: "s1",
      orientation: "landscape",
      theme: "brand",
      scenography: "comptoir",
    });
    const b = cleDuBrouillon({
      scenography: "comptoir",
      theme: "brand",
      orientation: "landscape",
      screenId: "s1",
    });
    const c = cleDuBrouillon({
      screenId: "s1",
      orientation: "portrait",
      theme: "brand",
      scenography: "comptoir",
    });
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });

  it("un brouillon sans écran a sa propre clé", () => {
    const sans = cleDuBrouillon({
      screenId: null,
      orientation: "landscape",
      theme: "brand",
      scenography: "comptoir",
    });
    expect(sans).not.toBe(
      cleDuBrouillon({ screenId: "s1", orientation: "landscape", theme: "brand", scenography: "comptoir" }),
    );
  });

  it("changer de service renouvelle l'aperçu, revenir à Maintenant retrouve la clé initiale", () => {
    const base = { screenId: "s1", orientation: "landscape", theme: "brand", scenography: "comptoir" } as const;
    const now = cleDuBrouillon(base);
    const lunch = cleDuBrouillon({ ...base, service: "lunch" });
    const dinner = cleDuBrouillon({ ...base, service: "dinner" });
    expect(new Set([now, lunch, dinner]).size).toBe(3);
    expect(cleDuBrouillon({ ...base, service: undefined })).toBe(now);
  });

  it("chaque personnalisation renouvelle l'aperçu, les valeurs héritées gardent une clé stable", () => {
    const base = { screenId: "s1", orientation: "landscape", theme: "brand", scenography: "comptoir" } as const;
    const key = cleDuBrouillon(base);
    expect(cleDuBrouillon({ ...base, presentation: { ...SCREEN_PRESENTATION_DEFAULT } })).toBe(key);
    for (const patch of [{ corners: "round" }, { priceScale: "large" }, { motion: "off" }] as const) {
      expect(cleDuBrouillon({ ...base, presentation: { ...SCREEN_PRESENTATION_DEFAULT, ...patch } })).not.toBe(key);
    }
  });

  it("le brouillon d'identité renouvelle l'aperçu sans dépendre de l'ordre des objets", () => {
    const base = { screenId: null, orientation: "landscape", theme: "brand", scenography: "halo" } as const;
    const brandDraft = DIRECTIONS.brasserie;
    const key = cleDuBrouillon({ ...base, brandDraft });
    const reversed = { ...brandDraft, palette: Object.fromEntries(Object.entries(brandDraft.palette).reverse()) as typeof brandDraft.palette };
    expect(cleDuBrouillon({ ...base, brandDraft: reversed })).toBe(key);
    expect(cleDuBrouillon({ ...base, brandDraft: { ...brandDraft, type: { pair: "nuit" } } })).not.toBe(key);
    expect(cleDuBrouillon({ ...base, brandDraft: DIRECTIONS.nuit })).not.toBe(key);
    expect(JSON.parse(key)).toMatchObject({ brandDraft, presentation: SCREEN_PRESENTATION_DEFAULT });
    expect(cleDuBrouillon(base)).not.toBe(key);
  });
});
