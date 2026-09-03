import { describe, expect, it } from "vitest";
import {
  DIRECTIONS,
  type LoyaltyCustomerCard,
  type LoyaltyPublicProgram,
} from "@sm/contracts";
import { promesseFidelite, resumeFidelite, soldeVitrine } from "./fidelite";

function recompense(id: string, nom: string, cout: number) {
  return {
    id,
    name: nom,
    description: "",
    costUnits: cout,
    kind: "product" as const,
    valueCents: null,
    productRef: null,
  };
}

function catalogue(
  recompenses: ReturnType<typeof recompense>[],
): LoyaltyPublicProgram {
  return {
    restaurant: {
      slug: "classfood",
      name: "Classfood",
      brand: DIRECTIONS.nuit,
      brandColor: "#c9a15a",
      logoUrl: null,
    },
    program: {
      name: "Le Club",
      mechanism: "points",
      unitLabelSingular: "point",
      unitLabelPlural: "points",
      termsSummary: "",
    },
    rewards: recompenses,
  } as LoyaltyPublicProgram;
}

describe("ce que la vitrine reçoit du programme", () => {
  it("ne descend rien quand le restaurant n'a pas de programme", () => {
    expect(resumeFidelite(null)).toBeNull();
  });

  it("pointe vers la carte du restaurant, pas vers une racine générique", () => {
    expect(resumeFidelite(catalogue([]))?.chemin).toBe("/r/classfood/fidelite");
  });

  it("retient la récompense la MOINS chère, jamais la première saisie", () => {
    // L'ordre du catalogue est celui de la saisie : le restaurateur y met
    // souvent son avantage phare — le plus coûteux — en tête.
    const resume = resumeFidelite(
      catalogue([
        recompense("a", "Menu offert", 300),
        recompense("b", "Boisson offerte", 8),
        recompense("c", "Dessert offert", 12),
      ]),
    );
    expect(resume?.premiere).toEqual({ nom: "Boisson offerte", cout: 8 });
  });

  it("ne fait voyager que le résumé — jamais la marque ni le catalogue entier", () => {
    const resume = resumeFidelite(catalogue([recompense("a", "Boisson", 8)]));
    expect(Object.keys(resume ?? {}).sort()).toEqual([
      "chemin",
      "premiere",
      "programme",
      "unitePluriel",
      "uniteSingulier",
    ]);
  });
});

describe("la promesse écrite sur la bande", () => {
  it("dit l'avantage ET son prix — un lien sans contenu ne se clique pas", () => {
    const resume = resumeFidelite(catalogue([recompense("a", "Boisson offerte", 8)]))!;
    expect(promesseFidelite(resume)).toBe(
      "« Boisson offerte » dès 8 points. Gratuit, sans compte.",
    );
  });

  it("accorde l'unité au singulier", () => {
    const resume = resumeFidelite(catalogue([recompense("a", "Café offert", 1)]))!;
    expect(promesseFidelite(resume)).toContain("dès 1 point.");
  });

  it("ne chiffre rien quand aucune récompense n'est publiée", () => {
    const resume = resumeFidelite(catalogue([]))!;
    expect(promesseFidelite(resume)).toBe(
      "Cumulez des avantages à chaque commande. Gratuit, sans compte.",
    );
  });
});

describe("le solde affiché sur la vitrine", () => {
  function carte(solde: number, couts: number[]): LoyaltyCustomerCard {
    return {
      restaurant: {
        slug: "classfood",
        name: "Classfood",
        brandColor: "#c9a15a",
        brand: DIRECTIONS.nuit,
      },
      program: {
        name: "Le Club",
        mechanism: "points",
        unitLabelSingular: "point",
        unitLabelPlural: "points",
        termsSummary: "",
      },
      member: { alias: "Maya", balanceUnits: solde },
      rewards: couts.map((cout, index) => ({
        ...recompense(`r${index}`, `Récompense ${index}`, cout),
        affordable: cout <= solde,
      })),
      activity: [],
    } as LoyaltyCustomerCard;
  }

  it("dit ce qui manque pour le prochain palier", () => {
    expect(soldeVitrine(carte(24, [8, 30]))).toEqual({
      solde: 24,
      unite: "points",
      reste: { nom: "Récompense 1", manque: 6 },
    });
  });

  it("n'invente pas de palier quand tout est atteint", () => {
    expect(soldeVitrine(carte(40, [8, 30])).reste).toBeNull();
  });

  it("accorde l'unité sur le solde", () => {
    expect(soldeVitrine(carte(1, [8])).unite).toBe("point");
  });
});
