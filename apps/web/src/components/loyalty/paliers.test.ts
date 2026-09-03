import { describe, expect, it } from "vitest";
import { DIRECTIONS, type LoyaltyCustomerCard } from "@sm/contracts";
import {
  deltaDeSolde,
  paliersFranchis,
  phraseDeProgression,
  prochainPalier,
  progressionVers,
  unitePour,
  type Recompense,
} from "./paliers";

function recompense(
  id: string,
  nom: string,
  cout: number,
  accessible: boolean,
): Recompense {
  return {
    id,
    name: nom,
    description: "",
    costUnits: cout,
    kind: "product",
    valueCents: null,
    productRef: null,
    affordable: accessible,
  };
}

function carte(solde: number, recompenses: Recompense[]): LoyaltyCustomerCard {
  return {
    restaurant: {
      slug: "classfood",
      name: "Classfood",
      brandColor: "#c9a15a",
      brand: DIRECTIONS.nuit,
    },
    program: {
      name: "La carte",
      mechanism: "points",
      unitLabelSingular: "point",
      unitLabelPlural: "points",
      termsSummary: "",
    },
    member: { alias: "Maya", balanceUnits: solde },
    rewards: recompenses,
    activity: [],
  } as LoyaltyCustomerCard;
}

describe("le palier visé", () => {
  it("est le moins cher de ceux qui restent hors de portée", () => {
    const paliers = [
      recompense("a", "Menu offert", 30, false),
      recompense("b", "Boisson offerte", 8, true),
      recompense("c", "Dessert offert", 12, false),
    ];
    expect(prochainPalier(paliers, 8)?.name).toBe("Dessert offert");
    expect(prochainPalier(paliers, 12)?.name).toBe("Menu offert");
  });

  it("n'existe plus quand tout est atteint — et la jauge est alors PLEINE", () => {
    const paliers = [recompense("a", "Boisson", 8, true)];
    expect(prochainPalier(paliers, 40)).toBeNull();
    // Le piège d'un `find()` sans repli : une jauge vide chez le meilleur
    // client du restaurant.
    expect(progressionVers(40, null)).toBe(100);
  });

  it("n'existe pas non plus quand le catalogue est vide", () => {
    expect(prochainPalier([], 0)).toBeNull();
  });
});

describe("la progression", () => {
  it("est bornée à 0 et 100 et ne rend jamais NaN", () => {
    const cible = recompense("a", "Menu", 30, false);
    expect(progressionVers(0, cible)).toBe(0);
    expect(progressionVers(24, cible)).toBe(80);
    expect(progressionVers(90, cible)).toBe(100);
    expect(progressionVers(-4, cible)).toBe(0);
    // Un coût nul ne peut pas venir du contrat, mais une division par zéro
    // irait jusque dans un attribut ARIA.
    expect(progressionVers(5, recompense("z", "Cassée", 0, false))).toBe(100);
  });
});

describe("ce qui se célèbre est une TRANSITION, jamais un état", () => {
  const avant = carte(24, [
    recompense("a", "Boisson", 8, true),
    recompense("b", "Menu", 30, false),
  ]);
  const apres = carte(30, [
    recompense("a", "Boisson", 8, true),
    recompense("b", "Menu", 30, true),
  ]);

  it("ne retient que la récompense qui vient de basculer", () => {
    const franchis = paliersFranchis(avant, apres);
    expect(franchis.map((r) => r.name)).toEqual(["Menu"]);
  });

  it("ne fête rien à la première ouverture — on ne fête pas ce qu'on découvre", () => {
    expect(paliersFranchis(null, apres)).toEqual([]);
    expect(deltaDeSolde(null, apres)).toBe(0);
  });

  it("ne fête rien quand rien n'a bougé", () => {
    expect(paliersFranchis(apres, apres)).toEqual([]);
    expect(deltaDeSolde(apres, apres)).toBe(0);
  });

  it("compare par identifiant : un catalogue réordonné ne déclenche pas de fête", () => {
    const reordonne = carte(24, [
      recompense("b", "Menu", 30, false),
      recompense("a", "Boisson", 8, true),
    ]);
    expect(paliersFranchis(avant, reordonne)).toEqual([]);
  });

  it("mesure le gain comme la perte", () => {
    expect(deltaDeSolde(avant, apres)).toBe(6);
    expect(deltaDeSolde(apres, avant)).toBe(-6);
  });
});

describe("la phrase du bas de jauge", () => {
  it("dit ce qui reste à faire", () => {
    const cible = recompense("b", "Menu signature", 30, false);
    expect(phraseDeProgression(24, cible, "point", "points")).toBe(
      "Encore 6 points pour « Menu signature »",
    );
    expect(phraseDeProgression(29, cible, "point", "points")).toBe(
      "Encore 1 point pour « Menu signature »",
    );
  });

  it("dit que c'est gagné plutôt que « encore 0 »", () => {
    const cible = recompense("b", "Menu", 30, true);
    expect(phraseDeProgression(30, cible, "point", "points")).toBe(
      "« Menu » est à vous.",
    );
  });

  it("dit la fin du catalogue sans laisser la phrase vide", () => {
    expect(phraseDeProgression(90, null, "point", "points")).toBe(
      "Votre solde atteint tous les paliers publiés.",
    );
  });
});

describe("l'accord du nom d'unité", () => {
  it("suit la valeur absolue — « −1 point », jamais « −1 points »", () => {
    expect(unitePour(1, "point", "points")).toBe("point");
    expect(unitePour(-1, "point", "points")).toBe("point");
    expect(unitePour(0, "point", "points")).toBe("points");
    expect(unitePour(2, "point", "points")).toBe("points");
  });
});
