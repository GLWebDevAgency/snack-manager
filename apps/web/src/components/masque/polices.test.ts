import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FONT_FAMILIES } from "@sm/contracts";

/**
 * `polices.ts` est LU EN TEXTE, jamais importé : next/font ne s'exécute pas
 * sous vitest, et `.variable` y est de toute façon un nom de classe haché.
 * L'analyse statique que fait le bundler, on la refait donc ici — sur les
 * mêmes littéraux, puisque next/font n'en accepte pas d'autres.
 */
const SOURCE = readFileSync(join(__dirname, "polices.ts"), "utf8");

/** Un appel `X({ … })` par ligne : la contrainte du bundler est aussi la nôtre. */
const APPELS = [...SOURCE.matchAll(/\b[A-Z]\w*\(\{([^}]*)\}\)/g)].map((m) => m[1] ?? "");

const variableDe = (appel: string): string | null =>
  /variable:\s*"--police-([a-z0-9-]+)"/.exec(appel)?.[1] ?? null;

describe("les polices du masque", () => {
  it("chaque famille du contrat est déclarée côté web, et aucune de plus", () => {
    const declarees = APPELS.map(variableDe).filter((v): v is string => v !== null).sort();
    expect(declarees).toEqual([...FONT_FAMILIES]);
  });

  it("aucune famille n’est préchargée — sinon les dix-huit partent sur chaque page", () => {
    /*
     * `preload: true` (le DÉFAUT de next/font) émet un `<link rel=preload>`
     * par famille déclarée dans le module. Les dix-huit sont déclarées à
     * chaque racine client : un seul oubli ferait télécharger dix-huit
     * familles à un client qui n'en lit que deux, sur un téléphone, dans la
     * file d'attente d'un snack. `preload: false` laisse next/font n'émettre
     * que les @font-face, et le navigateur ne tire que ce que le texte
     * utilise vraiment.
     */
    expect(APPELS).toHaveLength(FONT_FAMILIES.length);
    for (const appel of APPELS) {
      const nom = variableDe(appel) ?? appel;
      expect(appel, nom).toContain("preload: false");
      // `swap` : le texte est lisible dans la police de repli pendant le
      // téléchargement, au lieu d'un bloc invisible de trois secondes.
      expect(appel, nom).toContain('display: "swap"');
      expect(appel, nom).toContain('subsets: ["latin"]');
    }
  });
});
