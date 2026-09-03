import { describe, expect, it } from "vitest";
import { DIRECTIONS, resoudreMarque } from "@sm/contracts";
import {
  adoucir,
  dureeDuCompte,
  dureeEnMs,
  valeurDuCompte,
} from "./mouvement";

describe("la durée du mouvement se lit dans le masque", () => {
  it("comprend les deux unités que le produit écrit vraiment", () => {
    // Le résolveur émet des millisecondes suffixées…
    expect(dureeEnMs("900ms", 1)).toBe(900);
    // …et le repli de `globals.css`, lu par l'admin, des secondes.
    expect(dureeEnMs("0.6s", 1)).toBe(600);
    expect(dureeEnMs("600", 1)).toBe(600);
    expect(dureeEnMs(240, 1)).toBe(240);
  });

  it("retombe sur le repli plutôt que d'inventer une durée", () => {
    for (const valeur of [undefined, null, "", "auto", "-3s", "NaNms", {}, []]) {
      expect(dureeEnMs(valeur, 900)).toBe(900);
    }
  });

  it("lit la durée « fête » des six directions du catalogue", () => {
    for (const [nom, marque] of Object.entries(DIRECTIONS)) {
      const jeton = resoudreMarque(marque).vars["--sm-t-slow"];
      const duree = dureeEnMs(jeton, 0);
      // 900 ms « posé », 600 ms « vif » — jamais un repli silencieux.
      expect(duree, nom).toBeGreaterThan(0);
      expect([600, 900], nom).toContain(duree);
    }
  });
});

describe("la montée du solde", () => {
  it("part de la valeur d'origine et arrive exactement sur la cible", () => {
    expect(valeurDuCompte(0, 30, 0)).toBe(0);
    expect(valeurDuCompte(0, 30, 1)).toBe(30);
    // Au-delà de 1, la course est finie : jamais de dépassement affiché.
    expect(valeurDuCompte(0, 30, 4.2)).toBe(30);
    expect(valeurDuCompte(24, 30, 1)).toBe(30);
  });

  it("progresse toujours vers la cible, sans jamais reculer", () => {
    let precedent = 24;
    for (let pas = 0; pas <= 20; pas += 1) {
      const valeur = valeurDuCompte(24, 30, pas / 20);
      expect(valeur).toBeGreaterThanOrEqual(precedent);
      expect(valeur).toBeLessThanOrEqual(30);
      precedent = valeur;
    }
  });

  it("descend aussi : un solde débité n'est pas escamoté", () => {
    expect(valeurDuCompte(30, 22, 0)).toBe(30);
    expect(valeurDuCompte(30, 22, 1)).toBe(22);
    expect(valeurDuCompte(30, 22, 0.5)).toBeLessThan(30);
  });

  it("bouge dès la première image, même sur un écart de 1", () => {
    // `Math.floor` collait le compteur sur la valeur de départ et le chiffre
    // ne changeait qu'au tout dernier rendu : le compteur ne comptait pas.
    expect(valeurDuCompte(0, 1, 0.5)).toBe(1);
  });

  it("adoucit sans rebondir — un nombre ne dépasse jamais sa valeur", () => {
    for (let pas = 0; pas <= 10; pas += 1) {
      const sortie = adoucir(pas / 10);
      expect(sortie).toBeGreaterThanOrEqual(0);
      expect(sortie).toBeLessThanOrEqual(1);
    }
    // Sortie douce : à mi-course, plus de la moitié du chemin est faite.
    expect(adoucir(0.5)).toBeGreaterThan(0.5);
    expect(adoucir(-4)).toBe(0);
    expect(adoucir(4)).toBe(1);
  });
});

describe("la durée d'un décompte suit l'écart, sous le plafond du masque", () => {
  it("ne dépasse jamais la durée de fête", () => {
    expect(dureeDuCompte(1_000, 900)).toBe(900);
    expect(dureeDuCompte(-1_000, 600)).toBe(600);
  });

  it("ne descend jamais sous le tiers de la fête — un saut n'est pas une montée", () => {
    expect(dureeDuCompte(1, 900)).toBe(300);
    expect(dureeDuCompte(2, 600)).toBe(200);
  });

  it("suit l'écart entre les deux bornes", () => {
    // 6 unités × 45 ms = 270 ms, au-dessus du plancher (200) et sous le
    // plafond (600) : c'est l'écart qui décide.
    expect(dureeDuCompte(6, 600)).toBe(270);
  });

  it("ne lance rien quand rien ne change", () => {
    expect(dureeDuCompte(0, 900)).toBe(0);
  });
});
