import { describe, expect, it } from "vitest";
import { DIRECTIONS, type LoyaltyCustomerCard } from "@sm/contracts";
import {
  analyserInstantane,
  cleInstantane,
  DUREE_DE_VIE_INSTANTANE_MS,
  fraicheur,
} from "./carte-locale";

const MAINTENANT = Date.parse("2026-09-03T12:00:00.000Z");

const CARTE: LoyaltyCustomerCard = {
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
    termsSummary: "Conditions",
  },
  member: { alias: "Maya", balanceUnits: 24 },
  rewards: [],
  activity: [],
} as LoyaltyCustomerCard;

function instantane(vuA: string, carte: unknown = CARTE): string {
  return JSON.stringify({ carte, vuA });
}

describe("la clé de stockage", () => {
  it("est nominative par restaurant — un navigateur porte plusieurs cartes", () => {
    expect(cleInstantane("classfood")).toBe("sm_fidelite_classfood");
    expect(cleInstantane("le-comptoir")).not.toBe(cleInstantane("classfood"));
  });
});

describe("l'instantané est une entrée NON FIABLE, repassée par le contrat", () => {
  it("accepte un instantané bien formé et récent", () => {
    const lu = analyserInstantane(
      instantane("2026-09-03T11:50:00.000Z"),
      MAINTENANT,
    );
    expect(lu?.carte.member.balanceUnits).toBe(24);
    expect(lu?.vuA).toBe("2026-09-03T11:50:00.000Z");
  });

  it("refuse tout ce qui n'est pas une carte du contrat", () => {
    expect(analyserInstantane(null, MAINTENANT)).toBeNull();
    expect(analyserInstantane("", MAINTENANT)).toBeNull();
    expect(analyserInstantane("{ pas du json", MAINTENANT)).toBeNull();
    expect(analyserInstantane("[]", MAINTENANT)).toBeNull();
    expect(analyserInstantane('"chaine"', MAINTENANT)).toBeNull();
    // Une charge sans date : rien ne pourrait dire au client si son solde
    // date d'une minute ou d'un an.
    expect(analyserInstantane(JSON.stringify({ carte: CARTE }), MAINTENANT)).toBeNull();
    expect(analyserInstantane(instantane("hier"), MAINTENANT)).toBeNull();
    // Une carte amputée, laissée par une version antérieure du produit.
    expect(
      analyserInstantane(
        instantane("2026-09-03T11:50:00.000Z", { member: { alias: "Maya" } }),
        MAINTENANT,
      ),
    ).toBeNull();
  });

  it("oublie un instantané trop vieux plutôt que d'afficher un solde mort", () => {
    const vieux = new Date(
      MAINTENANT - DUREE_DE_VIE_INSTANTANE_MS - 1_000,
    ).toISOString();
    expect(analyserInstantane(instantane(vieux), MAINTENANT)).toBeNull();

    const limite = new Date(MAINTENANT - DUREE_DE_VIE_INSTANTANE_MS + 1_000).toISOString();
    expect(analyserInstantane(instantane(limite), MAINTENANT)).not.toBeNull();
  });

  it("ne perd pas la carte pour une horloge déréglée en avance", () => {
    const futur = new Date(MAINTENANT + 3_600_000).toISOString();
    expect(analyserInstantane(instantane(futur), MAINTENANT)).not.toBeNull();
  });
});

describe("la fraîcheur est dite honnêtement", () => {
  it("ne prétend pas à une heure quand il s'agit de secondes", () => {
    expect(fraicheur(new Date(MAINTENANT - 5_000).toISOString(), MAINTENANT)).toBe(
      "à l'instant",
    );
  });

  it("monte de registre avec l'âge", () => {
    expect(fraicheur(new Date(MAINTENANT - 12 * 60_000).toISOString(), MAINTENANT)).toBe(
      "il y a 12 min",
    );
    expect(fraicheur(new Date(MAINTENANT - 3 * 3_600_000).toISOString(), MAINTENANT)).toBe(
      "il y a 3 h",
    );
    expect(fraicheur(new Date(MAINTENANT - 26 * 3_600_000).toISOString(), MAINTENANT)).toBe(
      "hier",
    );
    expect(fraicheur(new Date(MAINTENANT - 5 * 86_400_000).toISOString(), MAINTENANT)).toBe(
      "il y a 5 jours",
    );
  });

  it("le dit plutôt que d'inventer une date", () => {
    expect(fraicheur("n'importe quoi", MAINTENANT)).toBe("date inconnue");
  });
});
