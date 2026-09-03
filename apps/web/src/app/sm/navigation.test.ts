import { describe, expect, it } from "vitest";
import {
  MOBILE_MORE_GROUPES,
  MOBILE_NAV,
  NAV,
  NAV_ACCUEIL,
  NAV_GROUPES,
  libelleCourt,
  navActive,
} from "./navigation";

/**
 * Ces quatre règles sont celles qu'un œil ne rattrape pas : une icône
 * réemployée, un écran hors table, un nom qui diverge entre la colonne et
 * l'en-tête — tout cela se lit correctement en revue et se paie à l'usage.
 */
describe("navigation du CRM interne", () => {
  it("range les huit écrans en cinq groupes, le tableau de bord en tête", () => {
    expect(NAV_ACCUEIL.href).toBe("/sm");
    expect(NAV_GROUPES.map((g) => g.titre)).toEqual([
      "Vente",
      "Parc",
      "Argent",
      "Atelier",
      "Plateforme",
    ]);
    expect(NAV.map((n) => n.href)).toEqual([
      "/sm",
      "/sm/pipeline",
      "/sm/clients",
      "/sm/signals",
      "/sm/facturation",
      "/sm/production",
      "/sm/erreurs",
      "/sm/reseaux",
    ]);
  });

  it("n'emploie jamais deux fois la même icône dans la barre", () => {
    const icones = NAV.map((n) => n.icon);
    expect(new Set(icones).size).toBe(icones.length);
  });

  it("écarte le rouage de la vitrine — il annonce les réglages partout ailleurs", () => {
    expect(NAV.find((n) => n.href === "/sm/reseaux")?.icon).not.toBe("gear");
    expect(NAV.some((n) => n.icon === "gear")).toBe(false);
  });

  it("ne remplace jamais un nom par son amorce coupée", () => {
    for (const item of NAV) {
      expect(item.label.trim()).not.toBe("");
      // « Tableau » sous « Tableau de bord » était exactement le symptôme :
      // un libellé court est un AUTRE mot, pas le début du même.
      if (item.court !== undefined) {
        expect(item.label.startsWith(item.court)).toBe(false);
      }
    }
  });

  it("désigne l'écran le plus précis, et l'accueil seulement sur sa racine", () => {
    expect(navActive("/sm").label).toBe("Tableau de bord");
    expect(navActive("/sm/clients").label).toBe("Restaurants");
    expect(navActive("/sm/clients/abc123").label).toBe("Restaurants");
    expect(navActive("/sm/reseaux").label).toBe("Vitrine Snack Manager");
    expect(navActive("/sm/inconnue").label).toBe("Tableau de bord");
  });

  it("garde cinq cellules sous le pouce et loge le reste dans les mêmes groupes", () => {
    // Quatre entrées + « Plus » : la cinquième cellule est le bouton.
    expect(MOBILE_NAV).toHaveLength(4);
    expect(MOBILE_NAV.map(libelleCourt)).toEqual([
      "Accueil",
      "Prospection",
      "Restaurants",
      "Facturation",
    ]);
    expect(MOBILE_MORE_GROUPES.map((g) => g.titre)).toEqual([
      "Parc",
      "Atelier",
      "Plateforme",
    ]);
    // Rien ne se perd et rien ne se double entre la barre et sa feuille.
    const sousLePouce = [
      ...MOBILE_NAV,
      ...MOBILE_MORE_GROUPES.flatMap((g) => g.items),
    ].map((n) => n.href);
    expect(new Set(sousLePouce)).toEqual(new Set(NAV.map((n) => n.href)));
    expect(sousLePouce).toHaveLength(NAV.length);
  });
});
