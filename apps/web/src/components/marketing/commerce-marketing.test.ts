import { describe, expect, it } from "vitest";
import { COMMERCE_PRICES } from "@sm/contracts/commerce";
import { COMMERCE_OFFERS, COMMERCE_TERMS, PUBLISHED_COMMERCE_OFFERS } from "./commerce-offers";
import { currentOperatingCost } from "./cost-model";
import { PLAN_MODULES, PLANS } from "./content";

describe("catalogue commercial public", () => {
  it("reprend les prix contractuels, sans doublon fidélité + collect + livraison", () => {
    expect(COMMERCE_OFFERS.map((offer) => offer.monthlyCents)).toEqual([
      COMMERCE_PRICES.loyaltyMonthlyCents,
      COMMERCE_PRICES.collectMonthlyCents,
      COMMERCE_PRICES.deliveryMonthlyCents,
    ]);
    expect(COMMERCE_PRICES.deliveryMonthlyCents).toBe(COMMERCE_PRICES.collectMonthlyCents + COMMERCE_TERMS.supplement);
  });

  it("ne publie pas la livraison pilote comme offre prête à acheter", () => {
    expect(PUBLISHED_COMMERCE_OFFERS.map((offer) => offer.id)).toEqual(["loyalty", "collect"]);
    expect(COMMERCE_OFFERS.find((offer) => offer.id === "delivery")?.pilot).toBe(true);
  });

  it("distingue livraison optionnelle et suite Boost", () => {
    expect(PLAN_MODULES.some((module) => module.id === "delivery")).toBe(true);
    const boost = PLANS.find((plan) => plan.id === "boost");
    expect(boost).toBeDefined();
    expect(boost?.modules).not.toContain("delivery");
  });
});

describe("coût courant déclaré, sans promesse de ROI", () => {
  it("ne produit aucun bénéfice prérempli", () => {
    expect(currentOperatingCost({ coordinationHours: 0, hourlyCostEuros: 0, remakes: 0, remakeCostEuros: 0 })).toEqual({ coordinationCents: 0, remakesCents: 0, totalCents: 0 });
  });

  it("additionne les deux coûts saisis en centimes", () => {
    expect(currentOperatingCost({ coordinationHours: 3.5, hourlyCostEuros: 20, remakes: 4, remakeCostEuros: 3.25 })).toEqual({ coordinationCents: 7000, remakesCents: 1300, totalCents: 8300 });
  });

  it("neutralise les saisies négatives et non finies", () => {
    expect(currentOperatingCost({ coordinationHours: -4, hourlyCostEuros: 20, remakes: Number.NaN, remakeCostEuros: Number.POSITIVE_INFINITY }).totalCents).toBe(0);
  });

  it("arrondit chaque poste au centime", () => {
    expect(currentOperatingCost({ coordinationHours: 0.1, hourlyCostEuros: 0.2, remakes: 1, remakeCostEuros: 3.456 })).toEqual({ coordinationCents: 2, remakesCents: 346, totalCents: 348 });
  });
});
