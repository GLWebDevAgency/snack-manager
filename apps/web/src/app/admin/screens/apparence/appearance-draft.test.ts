import { describe, expect, it } from "vitest";
import { appearanceDraft, appearancePatch, editAppearance, type Appearance } from "./appearance-draft";

const initial: Appearance = { orientation: "landscape", theme: "brand", scenography: "ardoise" };

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
});
