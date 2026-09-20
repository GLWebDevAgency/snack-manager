import { describe, expect, it, vi } from "vitest";
import { contactAttempt, isContactReceipt, validateContactPayload, type ContactPayload } from "./contact-request";

const payload: ContactPayload = {
  name: "Camille Test",
  restaurant: "Restaurant exemple",
  phone: "06 00 00 00 00",
  email: "camille@example.test",
  callbackSlot: "entre-services",
  need: "menu-tv",
  message: "Deux écrans pour présenter la carte.",
  platforms: false,
};

describe("identité d’une demande de rappel", () => {
  it("conserve la même identité pour une nouvelle tentative après une réponse incertaine", () => {
    const uuid = vi.fn(() => "e9866d68-932e-4c31-a222-b1c5e3b023b8");
    const initial = contactAttempt(payload, null, uuid);
    const retry = contactAttempt({ ...payload }, initial, uuid);
    expect(retry.requestId).toBe(initial.requestId);
    expect(uuid).toHaveBeenCalledOnce();
  });

  it.each<Partial<ContactPayload>>([
    { name: "Alex Test" },
    { restaurant: "Autre restaurant" },
    { phone: "07 00 00 00 00" },
    { email: "autre@example.test" },
    { callbackSlot: "matin" },
    { need: "menu-papier" },
    { message: "Une carte trois volets." },
    { platforms: true },
  ])("ne fusionne pas une demande modifiée avec la précédente (%o)", (change) => {
    const initial = contactAttempt(payload, null, () => "e9866d68-932e-4c31-a222-b1c5e3b023b8");
    const next = contactAttempt({ ...payload, ...change }, initial, () => "2d94df9d-286a-424c-9e2e-e939c5a1ec45");
    expect(next.requestId).not.toBe(initial.requestId);
    expect(next.fingerprint).not.toBe(initial.fingerprint);
  });

  it("attribue une nouvelle identité à une autre demande après le reçu de succès", () => {
    const initial = contactAttempt(payload, null, () => "e9866d68-932e-4c31-a222-b1c5e3b023b8");
    const next = contactAttempt(payload, null, () => "2d94df9d-286a-424c-9e2e-e939c5a1ec45");
    expect(next.requestId).not.toBe(initial.requestId);
  });
});

describe("validation du rappel", () => {
  it("permet une demande avec seulement le nom et le téléphone", () => {
    expect(validateContactPayload({
      ...payload, restaurant: "", email: "", need: "", message: "", platforms: false,
    })).toEqual({});
  });

  it("signale séparément les deux coordonnées indispensables", () => {
    expect(validateContactPayload({ ...payload, name: "", phone: "", email: "" })).toEqual({
      name: "Indiquez votre nom.", phone: "Numéro de téléphone invalide.",
    });
  });

  it.each(["camille", "camille@", "camille@restaurant", "camille @restaurant.fr", `${"a".repeat(160)}@restaurant.fr`])(
    "refuse un e-mail renseigné invalide sans le rendre obligatoire (%s)", (email) => {
      expect(validateContactPayload({ ...payload, email })).toEqual({
        email: "Indiquez une adresse e-mail valide, ou laissez ce champ vide.",
      });
    },
  );

  it("accepte une adresse professionnelle et un téléphone international", () => {
    expect(validateContactPayload({ ...payload, email: "contact+site@restaurant.fr", phone: "+33 6 12 34 56 78" })).toEqual({});
  });
});

describe("accusé d’enregistrement", () => {
  const requestId = "e9866d68-932e-4c31-a222-b1c5e3b023b8";
  const receipt = { ok: true, stored: true, requestId };

  it("confirme uniquement l’enregistrement durable de la demande envoyée", () => {
    expect(isContactReceipt(receipt, requestId)).toBe(true);
  });

  it.each([
    null, undefined, "ok", [], {},
    { ...receipt, ok: false }, { ...receipt, ok: "true" },
    { ok: true, requestId }, { ...receipt, stored: false }, { ...receipt, stored: "true" },
    { ok: true, stored: true }, { ...receipt, requestId: "" }, { ...receipt, requestId: 123 },
    { ...receipt, requestId: "invalid" },
    { ...receipt, requestId: "2d94df9d-286a-424c-9e2e-e939c5a1ec45" },
  ])("ne déclenche pas le succès sur une réponse incomplète ou étrangère (%j)", (body) => {
    expect(isContactReceipt(body, requestId)).toBe(false);
  });

  it("refuse une référence concordante qui n’est pas un UUID valide", () => {
    expect(isContactReceipt({ ...receipt, requestId: "invalid" }, "invalid")).toBe(false);
  });

  it("permet de retenter la même demande après un accusé incomplet", () => {
    const initial = contactAttempt(payload, null, () => requestId);
    expect(isContactReceipt({ ok: true, stored: true }, initial.requestId)).toBe(false);
    expect(contactAttempt(payload, initial).requestId).toBe(initial.requestId);
  });
});
