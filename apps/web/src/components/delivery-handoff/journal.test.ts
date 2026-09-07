import { describe, expect, it } from "vitest";
import { completeHandoffOperation, prepareHandoffOperation, readHandoffOperations } from "./journal";

const missionId = "507f1f77bcf86cd799439011";
const scope = "driver:recette:507f1f77bcf86cd799439012";
const operation = { operationId: "11111111-1111-4111-8111-111111111111", expectedRevision: 2, expectedMissionRevision: 4, action: "handoff" as const };
function storage() {
  const rows = new Map<string, string>();
  return { rows, get length() { return rows.size; }, key: (index: number) => [...rows.keys()][index] ?? null,
    getItem: (key: string) => rows.get(key) ?? null, setItem: (key: string, value: string) => { rows.set(key, value); }, removeItem: (key: string) => { rows.delete(key); } };
}
const state = { missionId, revision: 3, missionRevision: 4, orderStatus: "delivered", proof: null, incident: null, canHandoff: false, canOverride: false, canRotate: false };
const result = { missionId, operationId: operation.operationId, action: operation.action, appliedRevision: 3, replay: false, state, outcome: "applied", refusalCode: null };

describe("journal de remise : identité uniquement, jamais une preuve ni un motif libre", () => {
  it("prépare une identité durable par mission sans conserver le PIN, QR ou texte", () => {
    const store = storage();
    const saved = prepareHandoffOperation(store, scope, missionId, operation);
    expect(readHandoffOperations(store, scope)).toEqual([saved]);
    expect(prepareHandoffOperation(store, scope, missionId, operation)).toEqual(saved);
    expect(() => prepareHandoffOperation(store, scope, missionId, { ...operation, operationId: crypto.randomUUID() })).toThrow();
    expect(readHandoffOperations(store, scope.replace("recette", "other"))).toEqual([]);
    expect(readHandoffOperations(store, scope.replace("9012", "9099"))).toEqual([]);
    for (const secret of [{ proof: { kind: "pin", value: "123456" } }, { reason: "Informations personnelles" }, { code: "customer_absent" }]) {
      expect(() => prepareHandoffOperation(store, scope, missionId, { ...operation, ...secret })).toThrow();
    }
    expect([...store.rows.values()].join()).not.toMatch(/123456|Informations|customer_absent/);
  });
  it.each(["applied", "rejected", "abandoned"])("clôture seulement une preuve terminale corrélée (%s)", outcome => {
    const store = storage();
    const saved = prepareHandoffOperation(store, scope, missionId, operation);
    for (const invalid of [{ ...result, operationId: crypto.randomUUID() }, { ...result, action: "incident" }, { ...result, appliedRevision: 2 }, { ...result, state: { ...state, revision: 2 } }, { ...result, missionId: "f".repeat(24) }]) {
      expect(() => completeHandoffOperation(store, saved, invalid)).toThrow();
      expect(readHandoffOperations(store, scope)).toEqual([saved]);
    }
    completeHandoffOperation(store, saved, { ...result, outcome, refusalCode: outcome === "applied" ? null : outcome === "abandoned" ? "abandoned" : "proof_incorrect" });
    expect(readHandoffOperations(store, scope)).toEqual([]);
  });
  it("ne confond jamais une photographie ou un 404 avec une réponse terminale", () => {
    const store = storage();
    const saved = prepareHandoffOperation(store, scope, missionId, operation);
    for (const incomplete of [state, { status: 404 }, { status: 409 }, null]) expect(() => completeHandoffOperation(store, saved, incomplete)).toThrow();
    expect(readHandoffOperations(store, scope)).toEqual([saved]);
  });
  it("refuse le stockage corrompu, les erreurs et la 129e mission sans empoisonner les reprises", () => {
    const store = storage();
    expect(() => prepareHandoffOperation({ ...store, setItem() { throw Error("denied"); } }, scope, missionId, operation)).toThrow();
    for (let n = 1; n <= 128; n++) prepareHandoffOperation(store, scope, n.toString(16).padStart(24, "0"), operation);
    expect(() => prepareHandoffOperation(store, scope, "f".repeat(24), operation)).toThrow();
    expect(readHandoffOperations(store, scope)).toHaveLength(128);
    store.rows.set([...store.rows.keys()][0], "{broken");
    expect(() => readHandoffOperations(store, scope)).toThrow();
    expect(store.rows.size).toBe(128);
  });
});
