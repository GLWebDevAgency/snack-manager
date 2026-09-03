import { describe, expect, it } from "vitest";
import {
  DIRECTIONS,
  type LoyaltyCustomerCard,
} from "@sm/contracts";
import {
  analyserInstantane,
  cleInstantane,
  DUREE_DE_VIE_INSTANTANE_MS,
  ecrireInstantaneDansStockage,
  fraicheur,
  lireEtatInstantaneDepuisStockage,
  lireInstantaneDepuisStockage,
  TOLERANCE_FUTUR_INSTANTANE_MS,
  type StockageInstantanes,
} from "./carte-locale";

const MAINTENANT = Date.parse("2026-09-03T12:00:00.000Z");
const SECRET_QR = "s".repeat(43);

const CARTE: LoyaltyCustomerCard = {
  restaurant: {
    slug: "classfood",
    name: "Ancien Classfood",
    brandColor: "#c9a15a",
    brand: DIRECTIONS.nuit,
  },
  program: {
    name: "Ancienne carte",
    mechanism: "points",
    unitLabelSingular: "point",
    unitLabelPlural: "points",
    termsSummary: "Anciennes conditions",
  },
  member: { alias: "Maya", balanceUnits: 24 },
  rewards: [
    {
      id: "11111111-1111-4111-8111-111111111111",
      name: "Ancienne récompense",
      description: "",
      costUnits: 20,
      kind: "product",
      valueCents: null,
      productRef: null,
      affordable: true,
    },
  ],
  activity: [
    {
      kind: "earn",
      deltaUnits: 4,
      balanceAfter: 24,
      label: "Ancien achat",
      recordedAt: "2026-09-03T11:30:00.000Z",
    },
  ],
};

function stockageMemoire(initial?: Record<string, string>): {
  stockage: StockageInstantanes;
  valeur: (cle: string) => string | null;
} {
  const valeurs = new Map(Object.entries(initial ?? {}));
  return {
    stockage: {
      getItem: (cle) => valeurs.get(cle) ?? null,
      setItem: (cle, valeur) => valeurs.set(cle, valeur),
      removeItem: (cle) => {
        valeurs.delete(cle);
      },
    },
    valeur: (cle) => valeurs.get(cle) ?? null,
  };
}

function v2(vuA: string, solde: unknown = 24): string {
  return JSON.stringify({ version: 2, solde, vuA });
}

describe("la clé de stockage", () => {
  it("est nominative par restaurant — un navigateur porte plusieurs cartes", () => {
    expect(cleInstantane("classfood")).toBe("sm_fidelite_classfood");
    expect(cleInstantane("le-comptoir")).not.toBe(cleInstantane("classfood"));
  });
});

describe("l'instantané v2 minimal", () => {
  it("n'écrit que version, solde et vuA — jamais identité, historique, récompenses ou secret", () => {
    const memoire = stockageMemoire();
    ecrireInstantaneDansStockage(
      memoire.stockage,
      "classfood",
      CARTE.member.balanceUnits,
      MAINTENANT,
    );

    const brut = memoire.valeur(cleInstantane("classfood"))!;
    expect(JSON.parse(brut)).toEqual({
      version: 2,
      solde: 24,
      vuA: "2026-09-03T12:00:00.000Z",
    });
    expect(brut).not.toContain(CARTE.member.alias);
    expect(brut).not.toContain(CARTE.activity[0]!.label);
    expect(brut).not.toContain(CARTE.rewards[0]!.name);
    expect(brut).not.toContain(SECRET_QR);
  });

  it("migre immédiatement l'ancienne carte complète vers la v2 minimale", () => {
    const cle = cleInstantane("classfood");
    const memoire = stockageMemoire({
      [cle]: JSON.stringify({
        carte: CARTE,
        vuA: "2026-09-03T11:50:00.000Z",
      }),
    });

    expect(
      lireInstantaneDepuisStockage(memoire.stockage, "classfood", MAINTENANT),
    ).toEqual({
      version: 2,
      solde: 24,
      vuA: "2026-09-03T11:50:00.000Z",
    });
    const migre = memoire.valeur(cle)!;
    expect(Object.keys(JSON.parse(migre))).toEqual(["version", "solde", "vuA"]);
    expect(migre).not.toContain("Maya");
    expect(migre).not.toContain("activity");
    expect(migre).not.toContain("rewards");
    expect(migre).not.toContain(SECRET_QR);
  });

});

describe("validation, expiration et purge", () => {
  it("refuse les charges et soldes invalides", () => {
    expect(analyserInstantane(null, MAINTENANT)).toBeNull();
    expect(analyserInstantane("", MAINTENANT)).toBeNull();
    expect(analyserInstantane("{ pas du json", MAINTENANT)).toBeNull();
    expect(analyserInstantane("[]", MAINTENANT)).toBeNull();
    expect(analyserInstantane('"chaine"', MAINTENANT)).toBeNull();
    expect(analyserInstantane(v2("hier"), MAINTENANT)).toBeNull();
    expect(analyserInstantane(v2("2026-09-03T11:50:00.000Z", -1), MAINTENANT)).toBeNull();
    expect(analyserInstantane(v2("2026-09-03T11:50:00.000Z", 1.5), MAINTENANT)).toBeNull();
    expect(
      analyserInstantane(
        JSON.stringify({ version: 3, solde: 24, vuA: "2026-09-03T11:50:00.000Z" }),
        MAINTENANT,
      ),
    ).toBeNull();
  });

  it("purge une v2 enrichie d'un secret au lieu de l'utiliser", () => {
    const cle = cleInstantane("classfood");
    const memoire = stockageMemoire({
      [cle]: JSON.stringify({
        version: 2,
        solde: 24,
        vuA: "2026-09-03T11:50:00.000Z",
        qrToken: SECRET_QR,
      }),
    });

    expect(
      lireEtatInstantaneDepuisStockage(memoire.stockage, "classfood", MAINTENANT),
    ).toEqual({ etat: "invalide", instantane: null });
    expect(memoire.valeur(cle)).toBeNull();
  });

  it("purge à la lecture un instantané expiré sans afficher son ancien solde", () => {
    const cle = cleInstantane("classfood");
    const vieux = new Date(
      MAINTENANT - DUREE_DE_VIE_INSTANTANE_MS - 1_000,
    ).toISOString();
    const memoire = stockageMemoire({ [cle]: v2(vieux) });

    expect(
      lireEtatInstantaneDepuisStockage(memoire.stockage, "classfood", MAINTENANT),
    ).toEqual({ etat: "expire", instantane: null });
    expect(memoire.valeur(cle)).toBeNull();
  });

  it("accepte la limite d'âge mais refuse et purge une date future de plus de cinq minutes", () => {
    const limiteAge = new Date(
      MAINTENANT - DUREE_DE_VIE_INSTANTANE_MS + 1_000,
    ).toISOString();
    expect(analyserInstantane(v2(limiteAge), MAINTENANT)).not.toBeNull();

    const limiteFuture = new Date(
      MAINTENANT + TOLERANCE_FUTUR_INSTANTANE_MS,
    ).toISOString();
    expect(analyserInstantane(v2(limiteFuture), MAINTENANT)).not.toBeNull();

    const cle = cleInstantane("classfood");
    const tropFuture = new Date(
      MAINTENANT + TOLERANCE_FUTUR_INSTANTANE_MS + 1,
    ).toISOString();
    const memoire = stockageMemoire({ [cle]: v2(tropFuture) });
    expect(
      lireEtatInstantaneDepuisStockage(memoire.stockage, "classfood", MAINTENANT),
    ).toEqual({ etat: "invalide", instantane: null });
    expect(memoire.valeur(cle)).toBeNull();
  });
});

describe("la fraîcheur est dite honnêtement", () => {
  it("signale une petite dérive future au lieu de la faire passer pour une observation certaine", () => {
    expect(
      fraicheur(new Date(MAINTENANT + 60_000).toISOString(), MAINTENANT),
    ).toBe("à l'instant (horloge décalée)");
  });

  it("monte de registre avec l'âge", () => {
    expect(fraicheur(new Date(MAINTENANT - 5_000).toISOString(), MAINTENANT)).toBe(
      "à l'instant",
    );
    expect(fraicheur(new Date(MAINTENANT - 12 * 60_000).toISOString(), MAINTENANT)).toBe(
      "il y a 12 min",
    );
    expect(fraicheur(new Date(MAINTENANT - 3 * 3_600_000).toISOString(), MAINTENANT)).toBe(
      "il y a 3 h",
    );
    expect(fraicheur(new Date(MAINTENANT - 26 * 3_600_000).toISOString(), MAINTENANT)).toBe(
      "hier",
    );
  });
});
