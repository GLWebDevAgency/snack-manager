import { describe, expect, it } from "vitest";
import { customerTrackingHref, deliveryProofAccessFragment, deliveryProofAccessForReceipt, readDeliveryProofAccessFragment } from "./delivery-proof-access";
import type { ReceivedCheckoutAttempt } from "./checkout-attempt";

const access = { clientId: "11111111-1111-4111-8111-111111111111", recoveryProof: "a".repeat(64) };
const fragment = `#remise=v1.${access.clientId}.${access.recoveryProof}`;

describe("fragment privé de remise, distinct du suivi et du QR scanné", () => {
  it("encode uniquement la capacité client dans le fragment, jamais dans une query", () => {
    expect(deliveryProofAccessFragment(access)).toBe(fragment);
    const url = new URL(`/t/507f1f77bcf86cd799439012?t=tracking${fragment}`, "https://restaurant.example");
    expect(url.search).toBe("?t=tracking");
    expect(url.pathname).not.toContain(access.recoveryProof);
    expect(readDeliveryProofAccessFragment(url.hash)).toEqual(access);
  });

  it.each(["", "#", "#remise=", "#remise=tracking", fragment.slice(1), fragment.replace("v1.", "v2."),
    `${fragment}&remise=other`, `${fragment}&source=other`, fragment.replace("#remise", "#invitation"),
    fragment.replace("#remise=", "#remise=%76"), fragment.replace(".aaaa", ".AAAA"),
    fragment.replace("4111", "1111"), `${fragment} `, ` ${fragment}`, `${fragment}.extra`, "#remise=" + "a".repeat(2048),
  ])("refuse sans décodage opportuniste un fragment étranger ou ambigu (%#)", (value) => {
    expect(readDeliveryProofAccessFragment(value)).toBeNull();
  });

  it("valide l’entrée du générateur et refuse tout autre secret ou champ ajouté", () => {
    for (const invalid of [{ ...access, recoveryProof: "pin123" }, { ...access, clientId: "not-a-uuid" },
      { ...access, pin: "123456" }, { ...access, trackingToken: "tracking" }, { ...access, recoveryProof: access.recoveryProof.toUpperCase() }]) {
      expect(() => deliveryProofAccessFragment(invalid)).toThrow("Accès de remise invalide");
    }
  });

  it("borne la restauration d’un reçu privé à son ordre exact et à sept jours", () => {
    const now = Date.UTC(2030, 0, 1);
    const orderId = "507f1f77bcf86cd799439012";
    const attempt: ReceivedCheckoutAttempt = { v: 1, tenant: "classfood", origin: "https://restaurant.example", clientId: access.clientId,
      createdAt: now, updatedAt: now, cartFingerprint: "b".repeat(64), state: "received", receipt: { orderId, trackingToken: "tracking", recoveryProof: access.recoveryProof } };
    expect(deliveryProofAccessForReceipt(attempt, orderId, now)).toEqual(access);
    expect(deliveryProofAccessForReceipt(attempt, "another-order", now)).toBeNull();
    expect(deliveryProofAccessForReceipt(attempt, orderId, now + 7 * 86_400_000 - 1)).toEqual(access);
    expect(deliveryProofAccessForReceipt(attempt, orderId, now + 7 * 86_400_000)).toBeNull();
    expect(deliveryProofAccessForReceipt(attempt, orderId, now - 1)).toBeNull();
    expect(deliveryProofAccessForReceipt({ ...attempt, receipt: { orderId, trackingToken: "tracking" } }, orderId, now)).toBeNull();
    expect(deliveryProofAccessForReceipt(null, orderId, now)).toBeNull();
    expect(customerTrackingHref(orderId, "tracking", attempt, now)).toBe(`/t/${orderId}?t=tracking${fragment}`);
    expect(customerTrackingHref(orderId, "different", attempt, now)).toBe(`/t/${orderId}?t=different`);
    expect(customerTrackingHref(orderId, "tracking", attempt, now + 7 * 86_400_000)).toBe(`/t/${orderId}?t=tracking`);
  });
});
