import { describe, expect, it } from "vitest";
import {
  DIRECTIONS,
  type LoyaltyCustomerCard,
  type LoyaltyPublicProgram,
} from "@sm/contracts";
import {
  CONSEIL_FIDELITE_APRES_COMMANDE,
  detailSoldeVitrine,
  promesseFidelite,
  provenanceSoldeVitrine,
  resumeFidelite,
  soldeVitrine,
  soldeVitrineDepuisCache,
  soldeVitrineDepuisReseau,
} from "./fidelite";

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
      "« Boisson offerte » dès 8 points. Carte gratuite, avec votre compte ou un QR existant.",
    );
  });

  it("accorde l'unité au singulier", () => {
    const resume = resumeFidelite(catalogue([recompense("a", "Café offert", 1)]))!;
    expect(promesseFidelite(resume)).toContain("dès 1 point.");
  });

  it("ne chiffre rien quand aucune récompense n'est publiée", () => {
    const resume = resumeFidelite(catalogue([]))!;
    expect(promesseFidelite(resume)).toBe(
      "Découvrez les avantages du programme. Carte gratuite, avec votre compte ou un QR existant.",
    );
  });
});

describe("le solde affiché sur la vitrine", () => {
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

describe("provenance du solde dans la vitrine", () => {
  const resume = resumeFidelite(
    catalogue([recompense("a", "Boisson offerte", 30)]),
  )!;
  const vuA = "2026-09-03T11:50:00.000Z";
  const maintenant = Date.parse("2026-09-03T12:00:00.000Z");

  it("réserve la progression exacte à une réponse réseau", () => {
    const reseau = soldeVitrineDepuisReseau(carte(24, [30]), vuA);
    expect(reseau.source).toBe("reseau");
    expect(detailSoldeVitrine(reseau, resume)).toContain(
      "Encore 6 points pour « Récompense 0 »",
    );
    expect(provenanceSoldeVitrine(reseau, maintenant)).toBe(
      "Source : réseau · vérifié il y a 10 min",
    );
  });

  it("ne fabrique aucun palier à partir du cache minimal", () => {
    const cache = soldeVitrineDepuisCache(
      24,
      resume.uniteSingulier,
      resume.unitePluriel,
      vuA,
    );
    expect(cache.source).toBe("cache");
    expect(cache).not.toHaveProperty("reste");
    expect(detailSoldeVitrine(cache, resume)).toBe(
      "Ouvrez votre carte pour consulter les récompenses à jour.",
    );
    expect(detailSoldeVitrine(cache, resume)).not.toContain("Boisson offerte");
    expect(provenanceSoldeVitrine(cache, maintenant)).toBe(
      "Source : copie locale · solde vu il y a 10 min · vérification en cours",
    );
  });

  it("rend visible l'échec du rafraîchissement de la copie locale", () => {
    const cache = soldeVitrineDepuisCache(
      24,
      resume.uniteSingulier,
      resume.unitePluriel,
      vuA,
      "echec",
    );
    expect(provenanceSoldeVitrine(cache, maintenant)).toBe(
      "Source : copie locale · solde vu il y a 10 min · échec du rafraîchissement",
    );
  });
});

describe("la fidélité après une commande en ligne", () => {
  it("ne prétend plus qu'un QR rattache rétroactivement la commande créée", () => {
    expect(CONSEIL_FIDELITE_APRES_COMMANDE).toContain("solde affiché reste celui confirmé par le programme");
    expect(CONSEIL_FIDELITE_APRES_COMMANDE).toContain("ne rattache pas rétroactivement cette commande");
    expect(CONSEIL_FIDELITE_APRES_COMMANDE).toContain("votre solde");
    expect(CONSEIL_FIDELITE_APRES_COMMANDE).not.toMatch(/cette commande en ligne ne crédite|crédité|points gagnés|à chaque commande/i);
    expect(CONSEIL_FIDELITE_APRES_COMMANDE).not.toMatch(/\bQR\b/i);
    expect(CONSEIL_FIDELITE_APRES_COMMANDE).not.toContain("rattacher cette commande");
  });
});
