import { describe, expect, it } from "vitest";
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
});
