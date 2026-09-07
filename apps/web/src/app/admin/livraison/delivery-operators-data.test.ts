import { describe, expect, it } from "vitest";
import type { DeliveryOperatorView } from "@sm/contracts";
import {
  DELIVERY_OPERATOR_ATTEMPT_TTL_MS,
  deliveryInvitationLink,
  deliveryOperatorStatus,
  isDeliveryOperatorAttemptExpired,
  mergeDeliveryOperatorPages,
  parseDeliveryInvitation,
  readDeliveryOperatorAttempt,
  removeDeliveryOperatorAttempt,
  saveDeliveryOperatorAttempt,
} from "./delivery-operators-data";

const tenant = "507f1f77bcf86cd799439011";
const other = "507f1f77bcf86cd799439012";
const requestId = "6f64f0ed-4c82-4aba-b66d-7c73725fdaed";
const now = Date.parse("2026-09-07T12:00:00.000Z");
const request = { requestId, name: "Livreur test" };
const operator: DeliveryOperatorView = {
  id: other, name: "Livreur test", staffId: null, active: true,
  effectiveActive: true, blockedReason: null, revision: 2,
  sessionState: "not_connected", inviteExpiresAt: "2026-09-07T12:10:00.000Z",
};
function memoryStorage() {
  const rows = new Map<string, string>();
  return {
    rows,
    getItem: (key: string) => rows.get(key) ?? null,
    setItem: (key: string, value: string) => { rows.set(key, value); },
    removeItem: (key: string) => { rows.delete(key); },
  };
}

describe("reprise de création d’un accès livreur", () => {
  it("sauvegarde un corps canonique avec le même UUID après relecture", () => {
    const storage = memoryStorage();
    const attempt = saveDeliveryOperatorAttempt(storage, tenant, { ...request, name: "  Livreur test  " }, now);
    expect(attempt.request).toEqual(request);
    expect(readDeliveryOperatorAttempt(storage, tenant)).toEqual(attempt);
    expect(saveDeliveryOperatorAttempt(storage, tenant, request, now + 1000)).toEqual(attempt);
  });
  it("isole les restaurants et n’accepte pas un tenant injecté dans la charge", () => {
    const storage = memoryStorage();
    saveDeliveryOperatorAttempt(storage, tenant, request, now);
    expect(readDeliveryOperatorAttempt(storage, other)).toBeNull();
    const [key, raw] = [...storage.rows][0];
    storage.setItem(key, JSON.stringify({ ...JSON.parse(raw), tenantId: other }));
    expect(() => readDeliveryOperatorAttempt(storage, tenant)).toThrow();
  });
  it("refuse de remplacer une demande ambiguë par un autre UUID ou un autre nom", () => {
    const storage = memoryStorage();
    saveDeliveryOperatorAttempt(storage, tenant, request, now);
    expect(() => saveDeliveryOperatorAttempt(storage, tenant, { ...request, name: "Autre livreur" }, now)).toThrow();
    expect(() => saveDeliveryOperatorAttempt(storage, tenant, { ...request, requestId: crypto.randomUUID() }, now)).toThrow();
    expect(readDeliveryOperatorAttempt(storage, tenant)?.request).toEqual(request);
  });
  it("conserve uniquement l’identifiant staff pour une habilitation", () => {
    const storage = memoryStorage();
    const attempt = saveDeliveryOperatorAttempt(storage, tenant, { requestId, staffId: other }, now);
    expect(attempt.request).toEqual({ requestId, staffId: other });
    expect(JSON.stringify(attempt)).not.toContain("Livreur");
  });
  it.each([
    "broken", "null", "[]", "x".repeat(4097),
    JSON.stringify({ v: 8, tenantId: tenant, createdAt: now, request }),
    JSON.stringify({ v: 1, tenantId: tenant, createdAt: now, request, token: "secret" }),
    JSON.stringify({ v: 1, tenantId: tenant, createdAt: now, request: { ...request, staffId: other } }),
  ])("échoue fermée sur un stockage corrompu ou incompatible (%#)", raw => {
    const storage = memoryStorage();
    saveDeliveryOperatorAttempt(storage, tenant, request, now);
    storage.setItem([...storage.rows.keys()][0], raw);
    expect(() => readDeliveryOperatorAttempt(storage, tenant)).toThrow();
    expect(storage.rows.size).toBe(1);
  });
  it("refuse l’envoi si la sauvegarde est refusée", () => {
    const storage = { ...memoryStorage(), setItem: () => { throw new Error("QuotaExceeded"); } };
    expect(() => saveDeliveryOperatorAttempt(storage, tenant, request, now)).toThrow(/stockage/i);
  });
  it("ne retire que l’UUID attendu, après succès ou choix explicite", () => {
    const storage = memoryStorage();
    saveDeliveryOperatorAttempt(storage, tenant, request, now);
    expect(() => removeDeliveryOperatorAttempt(storage, tenant, crypto.randomUUID())).toThrow();
    expect(storage.rows.size).toBe(1);
    removeDeliveryOperatorAttempt(storage, tenant, requestId);
    expect(readDeliveryOperatorAttempt(storage, tenant)).toBeNull();
  });
  it("signale 30 min sans purger ni autoriser automatiquement une autre identité", () => {
    const storage = memoryStorage();
    const attempt = saveDeliveryOperatorAttempt(storage, tenant, request, now);
    expect(isDeliveryOperatorAttemptExpired(attempt, now + DELIVERY_OPERATOR_ATTEMPT_TTL_MS - 1)).toBe(false);
    expect(isDeliveryOperatorAttemptExpired(attempt, now + DELIVERY_OPERATOR_ATTEMPT_TTL_MS)).toBe(true);
    expect(readDeliveryOperatorAttempt(storage, tenant)?.request.requestId).toBe(requestId);
  });
});

describe("présentation du lien et des autorisations", () => {
  it("ajoute les pages sans doublon et conserve les candidats de la première page", () => {
    const first = { operators: [operator], candidates: [{ id: tenant, name: "Équipier test" }], truncated: true, nextCursor: other };
    const next = { operators: [{ ...operator, revision: 3 }, { ...operator, id: tenant }], candidates: [], truncated: false, nextCursor: null };
    expect(mergeDeliveryOperatorPages(first, next)).toEqual({ ...first, operators: next.operators, nextCursor: null });
    expect(first.operators[0].revision).toBe(2);
  });
  it("met le secret uniquement dans le fragment du domaine plateforme", () => {
    const token = "a".repeat(43);
    const url = new URL(deliveryInvitationLink("https://staging.snackmanager.fr/", token));
    expect(url.origin).toBe("https://staging.snackmanager.fr");
    expect(url.pathname).toBe("/livreur");
    expect(url.search).toBe("");
    expect(url.hash).toBe(`#invitation=${token}`);
  });
  it.each(["javascript:alert(1)", "https://user:password@example.test", "http://example.test"]) ("refuse une origine de partage dangereuse : %s", origin => {
    expect(() => deliveryInvitationLink(origin, "a".repeat(43))).toThrow();
  });
  it("valide la corrélation, l’activité et l’expiration avant d’afficher un QR", () => {
    const invitation = { operator, token: "a".repeat(43), expiresAt: operator.inviteExpiresAt };
    expect(parseDeliveryInvitation(invitation, other, now).operator.id).toBe(other);
    expect(() => parseDeliveryInvitation(invitation, tenant, now)).toThrow();
    expect(() => parseDeliveryInvitation({ ...invitation, operator: { ...operator, effectiveActive: false } }, other, now)).toThrow();
    expect(() => parseDeliveryInvitation(invitation, other, now + 600_000)).toThrow();
    expect(() => parseDeliveryInvitation({ ...invitation, token: "invalid" }, other, now)).toThrow();
    expect(() => parseDeliveryInvitation({ ...invitation, expiresAt: "2026-09-07T12:09:00.000Z" }, other, now)).toThrow();
  });
  it("n’interprète jamais téléphone associé comme présence en ligne", () => {
    expect(deliveryOperatorStatus({ ...operator, sessionState: "connected" })).toEqual({ label: "Téléphone associé", tone: "ok", detail: "Cette association ne signale ni présence en ligne ni position GPS." });
    expect(deliveryOperatorStatus({ ...operator, active: false, effectiveActive: false }).label).toBe("Accès révoqué");
    expect(deliveryOperatorStatus({ ...operator, effectiveActive: false, blockedReason: "staff_inactive" }).label).toBe("Équipier inactif");
    expect(deliveryOperatorStatus({ ...operator, effectiveActive: false, blockedReason: "staff_changed" }).label).toBe("Habilitation à renouveler");
    expect(deliveryOperatorStatus({ ...operator, sessionState: "expired" }).label).toBe("Association expirée");
    expect(deliveryOperatorStatus({ ...operator, inviteExpiresAt: null }).label).toBe("Téléphone à associer");
  });
});
