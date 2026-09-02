import { describe, expect, it } from "vitest";
import { DIRECTIONS, type Brand } from "@sm/contracts";
import { FeuilleDuMasque } from "./FeuilleDuMasque";

/**
 * La feuille est appelée comme une FONCTION, pas rendue : elle n'a ni état ni
 * effet, et ce qu'il faut prouver — le CSS écrit et la garde qui le précède —
 * tient entièrement dans l'élément qu'elle rend.
 */
const feuille = (brand: Brand) =>
  FeuilleDuMasque({ brand }) as { props: { href: string; precedence: string; children: string } } | null;

describe("la feuille de document du masque", () => {
  it("peint le canevas et le schéma de couleur du DOCUMENT", () => {
    const el = feuille(DIRECTIONS.brasserie);
    // Le fond de la fenêtre vient de `html` : une div, si haute soit-elle, ne
    // couvre jamais le rebond élastique d'iOS.
    expect(el?.props.children).toBe("html,body{background:#f5efe3}html{color-scheme:light}");
    expect(el?.props.precedence).toBe("masque");
  });

  it("dédoublonne par `href` : deux racines d’un même masque, une seule règle", () => {
    expect(feuille(DIRECTIONS.nuit)?.props.href).toBe(feuille(DIRECTIONS.nuit)?.props.href);
    expect(feuille(DIRECTIONS.nuit)?.props.href).not.toBe(feuille(DIRECTIONS.soleil)?.props.href);
  });

  it("suit le mode de chaque direction", () => {
    for (const key of ["brasserie", "atelier", "marche", "soleil"] as const) {
      expect(feuille(DIRECTIONS[key])?.props.children, key).toContain("color-scheme:light");
    }
    for (const key of ["neon", "nuit"] as const) {
      expect(feuille(DIRECTIONS[key])?.props.children, key).toContain("color-scheme:dark");
    }
  });

  it("n’écrit RIEN si le fond n’est pas un hex — un `<style>` est du CSS brut", () => {
    /*
     * Le contenu d'un `<style>` n'est échappé par personne : une accolade
     * dans `ground` ouvrirait une autre règle. La palette traverse pourtant
     * `BrandSchema`, mais la garde qui compte est celle du point d'écriture.
     */
    for (const fond of ["#f5efe3}html{display:none", "red", "", "#fff"]) {
      const casse = { ...DIRECTIONS.nuit, palette: { ...DIRECTIONS.nuit.palette, ground: fond } };
      expect(feuille(casse), fond).toBeNull();
    }
  });
});
