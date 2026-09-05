import { describe, expect, it } from "vitest";
import type { DeliverySettings } from "@sm/contracts";
import { parseDeliveryEuro, parseDeliveryDraft, toDeliveryDraft, withDeliveryPricingMode, zonePricingSummary } from "./delivery-draft";

const settings: DeliverySettings = { enabled: true, leadTimeMin: 45, slotCapacity: 2,
  zones: [{ id: "centre", name: "Centre", postalCodes: ["69001"], feeCents: 500, minimumOrderCents: 1500 }] };

describe("tarifs de livraison saisis en euros", () => {
  it.each([["5", 500], ["5,25", 525], ["0.01", 1], [" 30,00 ", 3000], ["0", 0]] as const)("convertit exactement %s en %i cents", (input, cents) => {
    expect(parseDeliveryEuro(input)).toBe(cents);
  });
  it.each(["", "5,001", "1e2", "-5", "+5", "5€", "1 000", "1,2.3", "NaN"])("refuse un montant ambigu : %s", input => {
    expect(parseDeliveryEuro(input)).toBeNull();
  });
  it("normalise les anciens documents sans créer de modification initiale", () => {
    const loaded = toDeliveryDraft(settings);
    const explicitNull = toDeliveryDraft({ ...settings, zones: [{ ...settings.zones[0], freeDeliveryFromCents: null }] });
    expect(loaded).toEqual(explicitNull);
    expect(loaded.zones[0]).toMatchObject({ pricingMode: "fixed", fee: "5,00", minimum: "15,00", freeFrom: "" });
    const result = parseDeliveryDraft(loaded);
    expect(result.success).toBe(true);
    if (!result.success) throw new Error(result.message);
    expect(toDeliveryDraft(result.data)).toEqual(loaded);
    expect(JSON.stringify(loaded)).toBe(JSON.stringify(explicitNull));
  });
  it("conserve tarif et seuil saisis pendant les changements de mode", () => {
    const zone = { ...toDeliveryDraft(settings).zones[0], freeFrom: "30,00" };
    const free = withDeliveryPricingMode(zone, "free");
    const threshold = withDeliveryPricingMode(free, "threshold");
    const fixed = withDeliveryPricingMode(threshold, "fixed");
    expect(fixed).toEqual(zone);
    const result = parseDeliveryDraft({ ...toDeliveryDraft(settings), zones: [free] });
    expect(result.success).toBe(true);
    if (!result.success) throw new Error(result.message);
    expect(result.data.zones[0]).toMatchObject({ feeCents: 0, freeDeliveryFromCents: null, minimumOrderCents: 1500 });
  });
  it("garde le minimum indépendant du seuil de gratuité", () => {
    const draft = toDeliveryDraft(settings);
    draft.zones[0] = { ...draft.zones[0], pricingMode: "threshold", freeFrom: "30,00" };
    const result = parseDeliveryDraft(draft);
    expect(result.success).toBe(true);
    if (!result.success) throw new Error(result.message);
    expect(result.data.zones[0]).toMatchObject({ feeCents: 500, freeDeliveryFromCents: 3000, minimumOrderCents: 1500 });
    expect(zonePricingSummary(draft.zones[0])).toBe("5,00 € · offerte dès 30,00 € · minimum 15,00 €");
  });
  it("identifie une ancienne zone à zéro comme toujours offerte", () => {
    const draft = toDeliveryDraft({ ...settings, zones: [{ ...settings.zones[0], feeCents: 0, freeDeliveryFromCents: 3000 }] });
    expect(draft.zones[0].pricingMode).toBe("free");
    expect(zonePricingSummary(draft.zones[0])).toBe("Livraison offerte · minimum 15,00 €");
  });
  it.each([
    { fee: "0", pricingMode: "fixed" as const, expected: "Toujours offerte" },
    { fee: "100,01", expected: "100,00" },
    { freeFrom: "", pricingMode: "threshold" as const, expected: "seuil" },
    { freeFrom: "0", pricingMode: "threshold" as const, expected: "seuil" },
    { freeFrom: "1000,01", pricingMode: "threshold" as const, expected: "1 000,00" },
    { minimum: "-1", expected: "minimum" },
    { minimum: "1000,01", expected: "minimum" },
  ])("refuse clairement les incohérences sans les convertir en gratuité : %j", ({ expected, ...patch }) => {
    const draft = toDeliveryDraft(settings);
    draft.zones[0] = { ...draft.zones[0], ...patch };
    const result = parseDeliveryDraft(draft);
    expect(result.success).toBe(false);
    if (result.success) throw new Error("Le tarif doit être refusé");
    expect(result.message).toContain(expected);
    expect(result.message).toContain("Centre");
  });
});
