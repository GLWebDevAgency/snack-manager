import { describe, expect, it } from "vitest";
import { indexSuivant } from "./use-scene-rotation";

describe("indexSuivant — la boucle du tiroir « Apparence »", () => {
  it("avance, recule, et boucle dans les deux sens", () => {
    expect(indexSuivant(0, 1, 3)).toBe(1);
    expect(indexSuivant(2, 1, 3)).toBe(0);
    expect(indexSuivant(0, -1, 3)).toBe(2);
  });

  it("sans scène, reste à zéro", () => {
    expect(indexSuivant(5, 1, 0)).toBe(0);
  });
});
