import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Les deux feuilles de l'écran de salle ne connaissent que les jetons du
 * masque, et n'animent que `transform` et `opacity` : une clé HDMI à 30 €
 * tourne douze heures par jour, et un gris codé en dur ne suivrait pas le
 * fond choisi par le gérant.
 */
const FEUILLES = [
  ["board.css", "./board.css"],
  ["comptoir.css", "./scenographies/comptoir/comptoir.css"],
] as const;

for (const [nom, chemin] of FEUILLES) {
  const css = readFileSync(new URL(chemin, import.meta.url), "utf8");

  describe(`${nom} — l'écran de salle ne connaît que les jetons du masque`, () => {
    it("n'écrit aucune couleur en dur hors valeur de repli d'un jeton", () => {
      const sansReplis = css
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/var\(--cf-[a-z0-9-]+,\s*[^)]+\)/g, "")
        .replace(/rgba\(255, 255, 255, 0\)/g, "");
      expect(sansReplis).not.toMatch(/#[0-9a-fA-F]{3,6}\b/);
      expect(sansReplis).not.toMatch(/rgba\(255, 255, 255,/);
      expect(sansReplis).not.toMatch(/rgba\(0, 0, 0,/);
    });

    it("n'anime que transform et opacity", () => {
      const keyframes = css.match(/@keyframes[^{]*\{[\s\S]*?\n\}/g) ?? [];
      expect(keyframes.length).toBeGreaterThan(0);
      for (const bloc of keyframes) {
        const proprietes = [...bloc.matchAll(/(?:^|[{;])\s*([a-z-]+)\s*:/g)].map((m) => m[1]);
        for (const p of proprietes) expect(["transform", "opacity"]).toContain(p);
      }
    });
  });
}
