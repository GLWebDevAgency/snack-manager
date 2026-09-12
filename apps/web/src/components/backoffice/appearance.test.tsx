import { describe, expect, it } from "vitest";
import { parseBackofficeTheme } from "./appearance";

describe("préférence d’apparence du back-office", () => {
  it.each([null, "", "auto", "future", "{}", "LIGHT"])("garde un repli clair pour %s", (raw) => {
    expect(parseBackofficeTheme(raw)).toBe("light");
  });
  it("respecte les deux choix explicites sans parser de données métier", () => {
    expect(parseBackofficeTheme("dark")).toBe("dark");
    expect(parseBackofficeTheme("light")).toBe("light");
  });
});
