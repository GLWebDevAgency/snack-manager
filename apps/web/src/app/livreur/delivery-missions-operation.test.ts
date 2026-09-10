import { afterEach, describe, expect, it, vi } from "vitest";
import { DELIVERY_VIEW_VERSION, DELIVERY_VIEW_VERSION_HEADER, type DeliveryMissionView } from "@sm/contracts";
import { missionRequest, completeMissionOperation, prepareMissionOperation, readMissionOperation, releaseChangedMissionOperation } from "./delivery-missions-operation";

const missionId = "507f1f77bcf86cd799439011";
const scope = "driver:recette:507f1f77bcf86cd799439012";
const body = { operationId: "d0e72f74-0bc2-4877-b33b-017646f81fd3", expectedRevision: 2 };
const mission: DeliveryMissionView = {
  id: missionId, number: 12, createdAt: "2026-09-07T10:00:00.000Z", scheduledAt: null,
  orderStatus: "ready", revision: 3, operator: { id: "507f1f77bcf86cd799439012", name: "Livreur test" },
  assignmentId: "02faab2b-f0b1-47c4-b591-8e88908a91b5", assignedAt: "2026-09-07T10:00:00.000Z", dispatchedAt: "2026-09-07T10:10:00.000Z",
  paymentReady: true, canAssign: false, canDispatch: false,
  customer: { name: "Client test", phone: null }, address: { line1: "10 rue de la Recette", postalCode: "75001", city: "Paris", country: "FR" }, instructions: null, items: [],
};
function storage() {
  const rows = new Map<string, string>();
  return { rows, get length() { return rows.size; }, key: (index: number) => [...rows.keys()][index] ?? null,
    getItem: (key: string) => rows.get(key) ?? null, setItem: (key: string, value: string) => { rows.set(key, value); }, removeItem: (key: string) => { rows.delete(key); } };
}
describe("intention durable de mission, sans données client", () => {
  it("conserve les mêmes paramètres et refuse une autre action avant résolution", () => {
    const store = storage();
    const saved = prepareMissionOperation(store, scope, missionId, "dispatch", body);
    expect(readMissionOperation(store, scope)).toEqual(saved);
    expect(prepareMissionOperation(store, scope, missionId, "dispatch", body)).toEqual(saved);
    expect(() => prepareMissionOperation(store, scope, missionId, "dispatch", { ...body, operationId: crypto.randomUUID() })).toThrow();
    expect(prepareMissionOperation(store, scope, "507f1f77bcf86cd799439099", "dispatch", { ...body, operationId: crypto.randomUUID() }).missionId).toBe("507f1f77bcf86cd799439099");
    expect([...store.rows.values()].join()).not.toContain("customer");
  });
  it("isole restaurant et opérateur", () => {
    const store = storage();
    prepareMissionOperation(store, scope, missionId, "dispatch", body);
    expect(readMissionOperation(store, "driver:autre:507f1f77bcf86cd799439012")).toBeNull();
    expect(readMissionOperation(store, "driver:recette:507f1f77bcf86cd799439099")).toBeNull();
  });
  it("refuse la 129e mission avant écriture et laisse les 128 reprises lisibles", () => {
    const store = storage();
    for (let i = 1; i <= 128; i++) prepareMissionOperation(store, scope, i.toString(16).padStart(24, "0"), "dispatch", body);
    expect(() => prepareMissionOperation(store, scope, "f".repeat(24), "dispatch", body)).toThrow();
    expect(store.rows.size).toBe(128);
    expect(readMissionOperation(store, scope, "1".padStart(24, "0"))?.body).toEqual(body);
  });
  it("échoue fermée si stockage inaccessible ou corrompu", () => {
    const store = storage();
    expect(() => prepareMissionOperation({ ...store, setItem() { throw new Error("denied"); } }, scope, missionId, "dispatch", body)).toThrow();
    prepareMissionOperation(store, scope, missionId, "dispatch", body);
    const key = [...store.rows.keys()][0];
    store.setItem(key, "{broken");
    expect(() => readMissionOperation(store, scope)).toThrow();
    expect(store.rows.size).toBe(1);
  });
  it("n’accepte ni mutation des paramètres ni données supplémentaires persistées", () => {
    const store = storage();
    const mutable = { ...body };
    prepareMissionOperation(store, scope, missionId, "dispatch", mutable);
    mutable.expectedRevision = 9;
    expect(readMissionOperation(store, scope)?.body.expectedRevision).toBe(2);
    const key = [...store.rows.keys()][0];
    store.setItem(key, JSON.stringify({ ...JSON.parse(store.getItem(key)!), customer: "not allowed" }));
    expect(() => readMissionOperation(store, scope)).toThrow();
  });
  it("retire seulement après résultat corrélé, pas sur une photographie payée ou partie", () => {
    const store = storage();
    const saved = prepareMissionOperation(store, scope, missionId, "dispatch", body);
    expect(() => completeMissionOperation(store, saved, { operationId: crypto.randomUUID(), appliedRevision: 3, replay: true, outcome: "applied", refusalCode: null, mission })).toThrow();
    expect(readMissionOperation(store, scope)).toEqual(saved);
    const result = completeMissionOperation(store, saved, { operationId: body.operationId, appliedRevision: 3, replay: true, outcome: "applied", refusalCode: null, mission });
    expect(result.mission).toEqual(mission);
    expect(readMissionOperation(store, scope)).toBeNull();
  });
  it("refuse une preuve de changement périmée, étrangère ou sans le code métier attendu", () => {
    const store = storage();
    const saved = prepareMissionOperation(store, scope, missionId, "dispatch", body);
    expect(() => releaseChangedMissionOperation(store, saved, "OTHER", mission)).toThrow();
    expect(() => releaseChangedMissionOperation(store, saved, "DELIVERY_MISSION_CHANGED", { ...mission, revision: 2 })).toThrow();
    expect(() => releaseChangedMissionOperation(store, saved, "DELIVERY_MISSION_CHANGED", { ...mission, id: "507f1f77bcf86cd799439099" })).toThrow();
    expect(readMissionOperation(store, scope)).toEqual(saved);
    releaseChangedMissionOperation(store, saved, "DELIVERY_MISSION_CHANGED", mission);
    expect(readMissionOperation(store, scope)).toBeNull();
  });
  it("ne persiste que des motifs prédéfinis, pas une note libre avec données personnelles", () => {
    const store = storage();
    expect(() => prepareMissionOperation(store, scope, missionId, "assignment", { ...body, operatorId: mission.operator!.id, expectedOperatorRevision: 0, reason: "Appeler le client au numéro privé" })).toThrow();
    const saved = prepareMissionOperation(store, "bo:507f1f77bcf86cd799439013:user:507f1f77bcf86cd799439014", missionId, "assignment", { ...body, operatorId: mission.operator!.id, expectedOperatorRevision: 0, reason: "Organisation de la tournée" });
    expect(saved.kind).toBe("assignment");
  });
});


afterEach(() => vi.unstubAllGlobals());

describe("transport privé des missions", () => {
  it.each([
    ["/livreur/missions", undefined],
    ["/livreur/missions?after=507f1f77bcf86cd799439099", undefined],
    [`/livreur/missions/${missionId}`, undefined],
    [`/livreur/missions/${missionId}/depart`, body],
    ["/livreur/history", undefined],
  ] as const)("annonce la vue enrichie sur %s sans changer la requête", async (path, input) => {
    const payload = { missions: [mission], nextCursor: null };
    const request = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json(payload));
    vi.stubGlobal("fetch", request);
    expect(await missionRequest(path, input)).toEqual(payload);
    expect(request).toHaveBeenCalledOnce();
    const [url, init] = request.mock.calls[0]!;
    expect(url).toBe(path);
    expect(init).toMatchObject({ method: input ? "POST" : "GET", credentials: "same-origin", cache: "no-store", redirect: "error" });
    const headers = new Headers(init?.headers);
    expect(headers.get(DELIVERY_VIEW_VERSION_HEADER)).toBe(DELIVERY_VIEW_VERSION);
    expect(headers.get("Accept")).toBe("application/json");
    expect(headers.get("Content-Type")).toBe(input ? "application/json" : null);
    expect(headers.has("Authorization")).toBe(false);
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    expect(init?.body).toBe(input ? JSON.stringify(input) : undefined);
  });
  it.each([false, true])("confirme un résultat corrélé ancien ou enrichi : enrichi=%s", enriched => {
    const store = storage(), saved = prepareMissionOperation(store, scope, missionId, "dispatch", body);
    const view = enriched ? { ...mission, deliveredAt: null, paymentSummary: { totalCents: 900, method: "online", status: "paid", tender: "online" } } : mission;
    const result = { operationId: body.operationId, appliedRevision: 3, replay: false, outcome: "applied", refusalCode: null, mission: view };
    expect(completeMissionOperation(store, saved, result)).toEqual(result);
    expect(readMissionOperation(store, scope)).toBeNull();
  });
});
