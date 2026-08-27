import { describe, expect, it } from "vitest";
import { supplementDepuisSaisie } from "./montants";

/**
 * « VIDE » ET « ZÉRO » NE VEULENT PAS DIRE LA MÊME CHOSE.
 *
 * `supplementPriceCents: null` retire l'ingrédient du catalogue des
 * suppléments : le comptoir ne le propose plus. `0` l'y laisse, offert.
 *
 * Le piège est que `parseEurosToCents`, le convertisseur déjà utilisé par le
 * reste du tiroir, mappe la chaîne vide sur `0`. Le réutiliser tel quel aurait
 * transformé « désactiver ce supplément » en « l'offrir à tout le monde » — un
 * défaut qui ne se voit pas à l'écran et se découvre sur la marge du mois.
 */
describe("le prix d’un supplément", () => {
  it("vide veut dire « pas proposé », jamais « gratuit »", () => {
    expect(supplementDepuisSaisie("")).toBeNull();
    expect(supplementDepuisSaisie("   ")).toBeNull();
  });

  it("zéro veut dire « proposé, offert »", () => {
    expect(supplementDepuisSaisie("0")).toBe(0);
    expect(supplementDepuisSaisie("0,00")).toBe(0);
  });

  it("convertit les euros en centimes, virgule française comprise", () => {
    expect(supplementDepuisSaisie("1")).toBe(100);
    expect(supplementDepuisSaisie("1,50")).toBe(150);
    expect(supplementDepuisSaisie("0,80")).toBe(80);
  });

  it("une saisie illisible ne devient pas zéro par accident", () => {
    // Rendre 0 sur « abc » ferait apparaître un supplément gratuit que
    // personne n'a demandé.
    expect(supplementDepuisSaisie("abc")).toBeNull();
  });
});
