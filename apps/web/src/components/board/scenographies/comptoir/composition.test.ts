import { describe, expect, it } from "vitest";
import {
  PLANCHERS,
  disposition,
  tailles,
  variablesDeScene,
  vignettes,
  type Disposition,
} from "./composition";

const O = ["landscape", "portrait"] as const;

describe("disposition — combien de produits, quelle composition", () => {
  it("les cas qui ne dépendent pas de l'effectif", () => {
    expect(disposition("closed", 5, "landscape")).toBe("closed");
    expect(disposition("promo", 0, "portrait")).toBe("promo");
    expect(disposition("category", 0, "landscape")).toBe("empty");
    expect(disposition("custom", 1, "portrait")).toBe("hero");
    expect(disposition("featured", 4, "landscape")).toBe("featured");
    expect(disposition("featured", 1, "landscape")).toBe("hero");
  });

  it("en paysage : 2, 3, 4 en ligne ; 5 à 6 en 3 × 2 ; 7 à 8 en 4 × 2", () => {
    expect(disposition("category", 2, "landscape")).toBe("g2x1");
    expect(disposition("category", 3, "landscape")).toBe("g3x1");
    expect(disposition("category", 4, "landscape")).toBe("g4x1");
    expect(disposition("category", 5, "landscape")).toBe("g3x2");
    expect(disposition("category", 6, "landscape")).toBe("g3x2");
    expect(disposition("category", 7, "landscape")).toBe("g4x2");
    expect(disposition("category", 8, "landscape")).toBe("g4x2");
  });

  it("en portrait : 2 empilés ; 3 à 4 en 2 × 2 ; 5 à 8 en liste", () => {
    expect(disposition("category", 2, "portrait")).toBe("stack2");
    expect(disposition("category", 3, "portrait")).toBe("g2x2");
    expect(disposition("category", 4, "portrait")).toBe("g2x2");
    expect(disposition("category", 5, "portrait")).toBe("list");
    expect(disposition("category", 8, "portrait")).toBe("list");
  });
});

describe("tailles — jamais sous les planchers, et ça monte quand il y a de la place", () => {
  const atteignables: Record<(typeof O)[number], Disposition[]> = {
    landscape: ["closed", "promo", "empty", "hero", "featured", "g2x1", "g3x1", "g4x1", "g3x2", "g4x2"],
    portrait: ["closed", "promo", "empty", "hero", "featured", "stack2", "g2x2", "list"],
  };
  for (const o of O) {
    for (const d of atteignables[o]) {
      it(`${o} · ${d}`, () => {
        const t = tailles(o, d);
        const p = PLANCHERS[o];
        expect(t.nom).toBeGreaterThanOrEqual(p.nom);
        expect(t.desc).toBeGreaterThanOrEqual(p.desc);
        expect(t.prix).toBeGreaterThanOrEqual(p.prix);
        expect(t.titre).toBeGreaterThanOrEqual(p.titre);
        expect(t.nomHeros).toBeGreaterThanOrEqual(t.nom);
        expect(t.prixHeros).toBeGreaterThanOrEqual(t.prix);
      });
    }
  }

  it("deux produits en paysage se lisent de plus loin que huit", () => {
    expect(tailles("landscape", "g2x1").nom).toBeGreaterThan(tailles("landscape", "g4x2").nom);
  });
});

describe("vignettes — des pixels de référence, jamais la taille du téléviseur", () => {
  it("une liste portrait de 8 lignes partage 1522 px moins les 7 interlignes", () => {
    expect(vignettes("portrait", "list", 8).liste).toBe(176);
  });

  it("la liste latérale d'une sélection de 8 en paysage tient dans 740 px", () => {
    expect(vignettes("landscape", "featured", 8).laterale).toBe(77);
  });

  it("une liste latérale ne descend jamais sous 56 ni au-dessus de 120", () => {
    expect(vignettes("landscape", "featured", 2).laterale).toBe(120);
    expect(vignettes("portrait", "featured", 8).laterale).toBeGreaterThanOrEqual(56);
  });
});

describe("variablesDeScene — ce que la feuille lit", () => {
  it("pose les tailles, les vignettes et l'effectif", () => {
    const vars = variablesDeScene("portrait", "list", 6) as Record<string, string | number>;
    expect(vars["--ct-fs-nom"]).toBe("56px");
    expect(vars["--ct-n"]).toBe(6);
    expect(vars["--ct-thumb"]).toMatch(/px$/);
  });
});
