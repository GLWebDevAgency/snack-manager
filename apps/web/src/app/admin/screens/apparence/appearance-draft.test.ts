import { describe, expect, it } from "vitest";
import { SCREEN_PRESENTATION_DEFAULT } from "@sm/contracts";
import { appearanceDraft, appearanceOf, appearancePatch, editAppearance, type Appearance } from "./appearance-draft";

const initial: Appearance = { orientation: "landscape", theme: "brand", scenography: "ardoise", presentation: { ...SCREEN_PRESENTATION_DEFAULT } };

describe("le brouillon d'apparence face aux mises à jour d'un autre poste", () => {
  it("suit les réglages reçus sans inventer de modifications locales", () => {
    const refreshed: Appearance = { ...initial, orientation: "portrait", theme: "dark" };
    expect(appearanceDraft(refreshed, {})).toEqual(refreshed);
    expect(appearancePatch(refreshed, {})).toEqual({});
  });

  it("conserve le fond essayé et adopte l'orientation changée ailleurs", () => {
    const edits = editAppearance(initial, {}, "theme", "light");
    const refreshed: Appearance = { ...initial, orientation: "portrait", scenography: "comptoir" };
    expect(appearanceDraft(refreshed, edits)).toEqual({ ...refreshed, theme: "light" });
    expect(appearancePatch(refreshed, edits)).toEqual({ theme: "light" });
  });

  it("revenir au réglage enregistré rend le champ à la synchronisation", () => {
    const edits = editAppearance(initial, {}, "theme", "light");
    const undone = editAppearance(initial, edits, "theme", "brand");
    expect(undone).toEqual({});
    expect(appearanceDraft({ ...initial, theme: "dark" }, undone).theme).toBe("dark");
  });

  it("ne réenvoie pas une valeur déjà appliquée ailleurs", () => {
    expect(appearancePatch({ ...initial, theme: "light" }, { theme: "light" })).toEqual({});
  });

  it("n'efface pas un autre choix local quand on annule un seul réglage", () => {
    const edits = { theme: "light", orientation: "portrait" } as const;
    expect(editAppearance(initial, edits, "theme", "brand")).toEqual({ orientation: "portrait" });
    expect(edits).toEqual({ theme: "light", orientation: "portrait" });
  });

  it("hérite de l'identité pour un ancien écran sans personnalisation", () => {
    const base = appearanceOf({ orientation: "portrait", theme: "brand", scenography: "ardoise" });
    expect(base.presentation).toEqual(SCREEN_PRESENTATION_DEFAULT);
    expect(appearancePatch(base, {})).toEqual({});
  });

  it("préserve le mouvement changé ailleurs lorsqu'on agrandit seulement les prix", () => {
    const edits = editAppearance(initial, {}, "presentation", { ...initial.presentation, priceScale: "large" });
    expect(edits).toEqual({ presentation: { priceScale: "large" } });
    const refreshed: Appearance = { ...initial, presentation: { ...initial.presentation, motion: "off" } };
    const merged = { ...refreshed.presentation, priceScale: "large" };
    expect(appearanceDraft(refreshed, edits).presentation).toEqual(merged);
    expect(appearancePatch(refreshed, edits)).toEqual({ presentation: merged });
  });

  it("réinitialise les personnalisations sans réécrire le modèle ni la marque", () => {
    const base: Appearance = { ...initial, scenography: "halo", presentation: { ...initial.presentation, corners: "round", motion: "expressive" } };
    const edits = editAppearance(base, {}, "presentation", { ...SCREEN_PRESENTATION_DEFAULT });
    expect(appearancePatch(base, edits)).toEqual({ presentation: SCREEN_PRESENTATION_DEFAULT });
    expect(appearanceDraft(base, edits).scenography).toBe("halo");
    expect(editAppearance(base, edits, "presentation", { ...base.presentation })).toEqual({});
  });

  it("ne réécrit pas une personnalisation appliquée entre-temps", () => {
    const edits = editAppearance(initial, {}, "presentation", { ...initial.presentation, corners: "soft" });
    expect(appearancePatch({ ...initial, presentation: { ...initial.presentation, corners: "soft" } }, edits)).toEqual({});
  });
});
