import { describe, expect, it } from "vitest";
import { cleSalle, lireOperationSalle, preparerOperationSalle, terminerOperationSalle, type OperationSalle } from "./salle-operation";

const op: OperationSalle = { version: 1, tenantId: "restaurant-a", auteur: "user:a", libelle: "Terrasse 1", action: "create", body: { operationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", label: "Terrasse 1", seats: 4 } };
function storage() {
  const values = new Map<string, string>();
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
}
describe("référence durable des réglages Salle", () => {
  it("refuse un journal corrompu, étranger ou un corps hors contrat", () => {
    expect(lireOperationSalle(null, op.tenantId)).toBeNull();
    for (const raw of ["{", JSON.stringify({ ...op, tenantId: "autre" }), JSON.stringify({ ...op, body: { ...op.body, seats: 0 } })]) {
      expect(() => lireOperationSalle(raw, op.tenantId)).toThrow(/illisible/);
    }
  });
  it("conserve le corps exact et bloque tout remplacement d'une référence pendante", () => {
    const store = storage();
    expect(preparerOperationSalle(store, op)).toEqual(op);
    expect(preparerOperationSalle(store, op)).toEqual(op);
    expect(() => preparerOperationSalle(store, { ...op, auteur: "user:b" })).toThrow(/reste à vérifier/);
    expect(() => preparerOperationSalle(store, { ...op, body: { ...op.body, label: "Autre" } })).toThrow(/reste à vérifier/);
    expect(lireOperationSalle(store.getItem(cleSalle(op.tenantId)), op.tenantId)).toEqual(op);
  });
  it("ne retire pas l'intention d'un autre auteur ou d'une autre opération", () => {
    const store = storage(); preparerOperationSalle(store, op);
    terminerOperationSalle(store, { ...op, auteur: "user:b" });
    terminerOperationSalle(store, { ...op, body: { ...op.body, operationId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" } });
    expect(store.getItem(cleSalle(op.tenantId))).not.toBeNull();
    terminerOperationSalle(store, op);
    expect(store.getItem(cleSalle(op.tenantId))).toBeNull();
  });
  it("refuse un stockage qui n'enregistre pas réellement la préparation", () => {
    const store = { getItem: () => null, setItem: () => undefined };
    expect(() => preparerOperationSalle(store, op)).toThrow(/n’a pas été conservée/);
  });
});
