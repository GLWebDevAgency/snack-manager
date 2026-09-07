import { describe, expect, it } from "vitest";
import { CUSTOMER_MEMORY_TTL_MS, parseRememberedCustomer, validRememberedCustomer } from "./customer-memory";

const now = 1_800_000_000_000;
const data = { v: 1, tenant: "classfood", savedAt: now, expiresAt: now + CUSTOMER_MEMORY_TTL_MS, customer: { name: "Camille Test", phone: "0600000000" } };
describe("mémoire de coordonnées non vérifiées", () => {
  it("accepte seulement les coordonnées minimales du restaurant demandé", () => {
    expect(parseRememberedCustomer(JSON.stringify(data), "classfood", now)).toEqual(data);
    expect(parseRememberedCustomer(JSON.stringify(data), "autre", now)).toBeNull();
    expect(parseRememberedCustomer(JSON.stringify(data), "../classfood", now)).toBeNull();
  });
  it("expire exactement à sept jours sans prolonger au passage de minuit", () => {
    expect(parseRememberedCustomer(JSON.stringify(data), "classfood", now + CUSTOMER_MEMORY_TTL_MS - 1)).toEqual(data);
    expect(parseRememberedCustomer(JSON.stringify(data), "classfood", now + CUSTOMER_MEMORY_TTL_MS)).toBeNull();
    expect(parseRememberedCustomer(JSON.stringify(data), "classfood", now - 1)).toBeNull();
  });
  it.each([
    { ...data, v: 2 }, { ...data, savedAt: "1800000000000" }, { ...data, expiresAt: data.expiresAt + 1 },
    { ...data, savedAt: -1 }, { ...data, token: "secret" },
    { ...data, customer: { ...data.customer, address: "private" } }, { ...data, customer: { name: "A", phone: "0600000000" } },
    { ...data, customer: { name: "Camille", phone: "not-a-number" } }, { ...data, customer: { name: "X".repeat(121), phone: "0600000000" } },
  ])("refuse les données anciennes, malformées ou trop larges %#", value => {
    expect(parseRememberedCustomer(JSON.stringify(value), "classfood", now)).toBeNull();
  });
  it("ne migre jamais le cache historique sans restaurant ni durée", () => {
    expect(parseRememberedCustomer(JSON.stringify(data.customer), "classfood", now)).toBeNull();
    for (const input of [null, "{", "null", "[]", "x".repeat(2049)]) expect(parseRememberedCustomer(input, "classfood", now)).toBeNull();
    expect(validRememberedCustomer({ name: "Camille", phone: "0600000000", verified: true })).toBe(false);
  });
});
