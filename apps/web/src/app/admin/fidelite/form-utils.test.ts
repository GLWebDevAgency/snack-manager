import { describe, expect, it } from "vitest";
import { centsToInput, parseEuroInput, parsePositiveInteger, parseSignedInteger } from "./form-utils";

describe("saisies monétaires fidélité", () => {
  it("convertit exactement la virgule française en centimes", () => {
    expect(parseEuroInput(" 12,05 ")).toBe(1_205);
    expect(parseEuroInput("0,50")).toBe(50);
    expect(centsToInput(1_205)).toBe("12,05");
  });

  it("refuse les flottants ambigus et les valeurs nulles par défaut", () => {
    expect(parseEuroInput("1,005")).toBeNull();
    expect(parseEuroInput("1e3")).toBeNull();
    expect(parseEuroInput("0")).toBeNull();
    expect(parseEuroInput("0", { allowZero: true })).toBe(0);
  });

  it("n'accepte qu'un entier strictement positif", () => {
    expect(parsePositiveInteger("12")).toBe(12);
    expect(parsePositiveInteger("12.5")).toBeNull();
    expect(parsePositiveInteger("0")).toBeNull();
  });

  it("accepte un delta signé non nul pour une correction", () => {
    expect(parseSignedInteger("-12")).toBe(-12);
    expect(parseSignedInteger("8")).toBe(8);
    expect(parseSignedInteger("0")).toBeNull();
  });
});
