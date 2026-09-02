import { describe, expect, it } from "vitest";
import { messageDeRefus } from "./refus";

/**
 * Trois écrans écrivaient chacun leur version de cette règle, et une seule
 * savait lire les refus de schéma. Les autres affichaient « Validation
 * failed » — en anglais, dans un toast de 2,2 secondes, devant un opérateur
 * qui ne saura jamais quel champ a été refusé.
 */
describe("le message montré quand l’API refuse", () => {
  const REPLI = "Enregistrement impossible — réessayez";

  it("préfère le refus de SCHÉMA : c’est le seul qui nomme le champ", () => {
    const body = { issues: [{ message: "Motif obligatoire" }, { message: "Autre" }] };
    expect(messageDeRefus(body, "Validation failed", REPLI)).toBe("Motif obligatoire");
  });

  it("prend le message de l’API quand aucun schéma n’a parlé", () => {
    expect(messageDeRefus({}, "Ce code n’autorise aucune remise", REPLI)).toBe(
      "Ce code n’autorise aucune remise",
    );
  });

  it("écarte « Validation failed » — le libellé qui n’apprend rien", () => {
    expect(messageDeRefus({}, "Validation failed", REPLI)).toBe(REPLI);
    expect(messageDeRefus(null, "Validation failed", REPLI)).toBe(REPLI);
  });

  it("retombe sur le repli devant un corps illisible", () => {
    // Une passerelle en panne rend du HTML, pas du JSON : l'écran ne doit pas
    // afficher une balise à l'opérateur.
    for (const corps of [null, undefined, "<html>502</html>", 42, []]) {
      expect(messageDeRefus(corps, "", REPLI)).toBe(REPLI);
    }
  });

  it("ignore un tableau d’issues vide ou mal formé", () => {
    expect(messageDeRefus({ issues: [] }, "Trop de requêtes", REPLI)).toBe("Trop de requêtes");
    expect(messageDeRefus({ issues: [{}] }, "Trop de requêtes", REPLI)).toBe("Trop de requêtes");
    expect(messageDeRefus({ issues: "pas un tableau" }, "", REPLI)).toBe(REPLI);
  });

  it("ignore un message de schéma vide plutôt que d’afficher du blanc", () => {
    expect(messageDeRefus({ issues: [{ message: "   " }] }, "Conflit", REPLI)).toBe("Conflit");
  });
});
