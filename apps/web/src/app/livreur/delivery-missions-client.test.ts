import { describe, expect, it, vi } from "vitest";
import type { DeliveryMissionResult, DeliveryMissionView } from "@sm/contracts";
import { createDeliveryMissionsClient } from "./delivery-missions-client";
import { MissionHttpError, readMissionOperation } from "./delivery-missions-operation";

const operatorId = "507f1f77bcf86cd799439012";
const id = "507f1f77bcf86cd799439011";
const scope = `driver:recette:${operatorId}`;
const operationId = "d0e72f74-0bc2-4877-b33b-017646f81fd3";
const mission: DeliveryMissionView = {
  id, number: 12, createdAt: "2026-09-07T10:00:00.000Z", scheduledAt: null,
  orderStatus: "ready", revision: 2, operator: { id: operatorId, name: "Livreur test" },
  assignmentId: "02faab2b-f0b1-47c4-b591-8e88908a91b5", assignedAt: "2026-09-07T10:00:00.000Z", dispatchedAt: null,
  paymentReady: true, canAssign: true, canDispatch: true,
  customer: { name: "Client test", phone: null }, address: { line1: "10 rue de la Recette", postalCode: "75001", city: "Paris", country: "FR" }, instructions: null, items: [],
};
const list = (missions = [mission], nextCursor: string | null = null) => ({ missions, nextCursor });
const result = (patch: Partial<DeliveryMissionView> = {}): DeliveryMissionResult => ({
  operationId, appliedRevision: 3, replay: false, outcome: "applied", refusalCode: null,
  mission: { ...mission, revision: 3, dispatchedAt: "2026-09-07T10:10:00.000Z", canAssign: false, canDispatch: false, ...patch },
});
function fixture() {
  const rows = new Map<string, string>();
  const storage: Storage = { get length() { return rows.size; }, key: index => [...rows.keys()][index] ?? null,
    getItem: key => rows.get(key) ?? null, setItem: (key, value) => { rows.set(key, value); }, removeItem: key => { rows.delete(key); }, clear: () => rows.clear() };
  const request = vi.fn<(path: string, body?: unknown) => Promise<unknown>>().mockResolvedValue(list());
  const revoked = vi.fn();
  let online = true;
  const port = { scope, operatorId, request, storage: () => storage, online: () => online, uuid: () => operationId, revoked };
  return { port, client: createDeliveryMissionsClient(port), storage, request, revoked, offline: () => { online = false; } };
}

describe("missions privées et reprise de départ", () => {
  it("charge seulement la liste et ne persiste aucune coordonnée", async () => {
    const f = fixture(); await f.client.start();
    expect(f.client.getSnapshot()).toMatchObject({ loaded: true, stale: false, missions: [mission] });
    expect(f.request.mock.calls).toEqual([["/livreur/missions"]]);
    expect(f.storage.length).toBe(0);
  });
  it("refuse toute mission étrangère à l’opérateur", async () => {
    const f = fixture(); f.request.mockResolvedValueOnce(list([{ ...mission, operator: { id, name: "Autre" } }]));
    await f.client.start();
    expect(f.client.getSnapshot()).toMatchObject({ stale: true, missions: [] });
  });
  it("sauvegarde avant POST, interdit les doubles appuis et ne montre pas de départ optimiste", async () => {
    const f = fixture(); await f.client.start();
    let resolve!: (value: unknown) => void;
    f.request.mockImplementationOnce(async () => {
      expect(readMissionOperation(f.storage, scope)?.body.operationId).toBe(operationId);
      return new Promise(done => { resolve = done; });
    });
    const sending = f.client.dispatch(id);
    await f.client.dispatch(id);
    expect(f.request).toHaveBeenCalledTimes(2);
    expect(f.client.getSnapshot()).toMatchObject({ busy: true, missions: [mission] });
    resolve(result()); await sending;
    expect(f.client.getSnapshot()).toMatchObject({ busy: false, operations: [], missions: [result().mission] });
    expect(f.storage.length).toBe(0);
  });
  it("après réponse perdue et reload, reprend exactement le POST sans auto-rejeu ni nouvelle clé", async () => {
    const f = fixture(); await f.client.start();
    f.request.mockRejectedValueOnce(new Error("response lost")); await f.client.dispatch(id);
    const pending = readMissionOperation(f.storage, scope);
    const restored = createDeliveryMissionsClient(f.port); await restored.start();
    expect(restored.getSnapshot().operations).toEqual([pending]);
    expect(f.request.mock.calls.filter(call => call[1])).toHaveLength(1);
    f.request.mockResolvedValueOnce({ ...result(), replay: true }); await restored.resume();
    const posts = f.request.mock.calls.filter(call => call[1]);
    expect(posts).toHaveLength(2); expect(posts[1]).toEqual(posts[0]);
    expect(restored.getSnapshot().operations).toEqual([]);
  });
  it.each(["preparing", "new"] as const)("ne poste pas avant préparation : %s", async orderStatus => {
    const f = fixture(); f.request.mockResolvedValueOnce(list([{ ...mission, orderStatus, canDispatch: false }]));
    await f.client.start(); await f.client.dispatch(id);
    expect(f.request).toHaveBeenCalledTimes(1); expect(f.storage.length).toBe(0);
  });
  it("refuse le départ sans paiement, hors réseau ou sans stockage", async () => {
    const f = fixture(); f.request.mockResolvedValueOnce(list([{ ...mission, paymentReady: false, canDispatch: false }]));
    await f.client.start(); await f.client.dispatch(id); expect(f.request).toHaveBeenCalledTimes(1);
    await f.client.refresh(); f.offline(); await f.client.dispatch(id); expect(f.request).toHaveBeenCalledTimes(2);
    const g = fixture(); await g.client.start(); g.storage.setItem = () => { throw new Error("denied"); };
    await g.client.dispatch(id); expect(g.request).toHaveBeenCalledTimes(1); expect(g.client.getSnapshot().stale).toBe(true);
  });
  it("clôture un refus durable sans affirmer que le départ a réussi", async () => {
    const f = fixture(); await f.client.start();
    f.request.mockResolvedValueOnce({ ...result({ dispatchedAt: null, canDispatch: false }), outcome: "rejected", refusalCode: "delivery.mission.payment_blocked" });
    await f.client.dispatch(id);
    expect(f.storage.length).toBe(0);
    expect(f.client.getSnapshot().message).toContain("paiement");
    expect(f.client.getSnapshot()).toMatchObject({ tone: "warning", stale: false });
    expect(f.client.getSnapshot().missions[0].dispatchedAt).toBeNull();
  });
  it("une mission retirée conserve sa preuve incertaine sans bloquer le départ d’une autre mission", async () => {
    const f = fixture(); const other = { ...mission, id: "507f1f77bcf86cd799439099", number: 13 };
    f.request.mockResolvedValueOnce(list([mission, other])); await f.client.start();
    f.request.mockRejectedValueOnce(new MissionHttpError(404, "MISSION_UNAVAILABLE", "removed"));
    await f.client.dispatch(id);
    f.request.mockResolvedValueOnce(result({ ...other, revision: 3, dispatchedAt: "2026-09-07T10:10:00.000Z" }));
    await f.client.dispatch(other.id);
    expect(f.request.mock.calls.filter(call => call[1])).toHaveLength(2);
    expect(readMissionOperation(f.storage, scope, id)).not.toBeNull();
    expect(readMissionOperation(f.storage, scope, other.id)).toBeNull();
    expect(f.client.getSnapshot().missions.map(value => value.id)).toEqual([other.id]);
    expect(f.client.getSnapshot().operations.map(value => value.missionId)).toEqual([id]);
  });
  it("ne clôture 409 que sur le code de changement et une révision courante supérieure", async () => {
    const f = fixture(); await f.client.start();
    f.request.mockRejectedValueOnce(new MissionHttpError(409, "DELIVERY_MISSION_CHANGED", "changed"));
    f.request.mockResolvedValueOnce({ ...mission, revision: 3, canDispatch: false });
    await f.client.dispatch(id);
    expect(f.storage.length).toBe(0); expect(f.client.getSnapshot().message).toContain("a changé");
    expect(f.client.getSnapshot().missions[0].dispatchedAt).toBeNull();
  });
  it.each([404, 409, 503])("conserve l’intention sur HTTP %s sans preuve terminale", async status => {
    const f = fixture(); await f.client.start();
    f.request.mockRejectedValueOnce(new MissionHttpError(status, "UNKNOWN", "unconfirmed")); await f.client.dispatch(id);
    expect(readMissionOperation(f.storage, scope)).not.toBeNull();
    expect(f.client.getSnapshot().stale).toBe(status !== 404);
    expect(f.revoked).not.toHaveBeenCalled();
    if (status === 404) expect(f.client.getSnapshot().missions).toEqual([]);
  });
  it("401 retire toutes les coordonnées et informe l’accès, contrairement à 404", async () => {
    const f = fixture(); await f.client.start();
    f.request.mockRejectedValueOnce(new MissionHttpError(401, "ACCESS_UNAVAILABLE", "revoked")); await f.client.refresh();
    expect(f.client.getSnapshot().missions).toEqual([]); expect(f.revoked).toHaveBeenCalledOnce();
  });
  it("remplace les pages à l’actualisation et retire les missions réaffectées", async () => {
    const f = fixture(); f.request.mockResolvedValueOnce(list([mission], id)); await f.client.start();
    const next = { ...mission, id: "507f1f77bcf86cd799439099" };
    f.request.mockResolvedValueOnce(list([next])); await f.client.loadMore();
    expect(f.client.getSnapshot().missions).toEqual([mission, next]);
    f.request.mockResolvedValueOnce(list([next])); await f.client.refresh();
    expect(f.client.getSnapshot().missions).toEqual([next]);
  });
  it("ignore une ancienne réponse après démontage/remontage du contrôleur", async () => {
    const f = fixture(); let finish!: (value: unknown) => void;
    f.request.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const first = f.client.start(); f.client.stop();
    f.request.mockResolvedValueOnce(list([])); await f.client.start();
    finish(list()); await first;
    expect(f.client.getSnapshot()).toMatchObject({ loaded: true, loading: false, missions: [] });
  });
});
