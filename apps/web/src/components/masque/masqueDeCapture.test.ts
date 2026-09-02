import { afterEach, describe, expect, it } from "vitest";
import { DIRECTIONS } from "@sm/contracts";
import { directionDepuisUrl } from "./masqueDeCapture";

/**
 * `?masque=` REPEINT UNE PAGE ENTIÈRE : sa garde mérite un test à elle.
 *
 * Le paramètre n'existe que pour la matrice de captures, mais il est lu sur
 * une page publique (la démonstration) : tout ce qu'il accepte finit dans
 * `styleDuMasque()`, qui déréférence `brand.palette.ground` sans filet.
 */
const avecRecherche = (search: string) => {
  (globalThis as { window?: unknown }).window = { location: { search } };
};

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
});

describe("la direction demandée par l’URL", () => {
  it("ne lit rien au rendu serveur — il n’y a pas de `window`", () => {
    expect(directionDepuisUrl()).toBeNull();
  });

  it("rend la direction demandée, et TOUJOURS la même référence", () => {
    avecRecherche("?masque=soleil");
    expect(directionDepuisUrl()).toBe(DIRECTIONS.soleil);
    // La stabilité de la référence est ce qui empêche `useSyncExternalStore`
    // de rejouer un rendu à chaque lecture.
    expect(directionDepuisUrl()).toBe(directionDepuisUrl());
  });

  it("ignore l’absence de paramètre et les clés hors catalogue", () => {
    for (const search of ["", "?", "?masque=", "?masque=bistrot", "?masque=NUIT"]) {
      avecRecherche(search);
      expect(directionDepuisUrl(), search).toBeNull();
    }
  });

  it("ignore les clés de PROTOTYPE — `cle in DIRECTIONS` les acceptait", () => {
    /*
     * `"constructor" in {}` vaut `true`. Avant la garde du contrat,
     * `?masque=constructor` rendait la fonction `Object` : une référence
     * stable, retenue par le store, puis un `TypeError` sur
     * `brand.palette.ground` — la page de démonstration tombait dans son
     * error boundary depuis une simple URL.
     */
    for (const cle of ["constructor", "toString", "valueOf", "hasOwnProperty", "__proto__"]) {
      avecRecherche(`?masque=${cle}`);
      expect(directionDepuisUrl(), cle).toBeNull();
    }
  });
});
