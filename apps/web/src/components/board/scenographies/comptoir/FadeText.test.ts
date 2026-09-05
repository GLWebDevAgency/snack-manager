import { describe, expect, it } from "vitest";
import { dureeMs } from "./FadeText";

describe("dureeMs — la durée d'un jeton de mouvement", () => {
  it("lit des millisecondes, des secondes, et replie à 240 ms sur une valeur vide", () => {
    expect(dureeMs("240ms")).toBe(240);
    expect(dureeMs(" 0.32s ")).toBe(320);
    expect(dureeMs("")).toBe(240);
  });
});
