import { describe, expect, it, vi } from "vitest";
import type { DeliveryHandoffState } from "@sm/contracts";
import { createDeliveryHandoffClient, HandoffHttpError } from "./client";

const missionId = "507f1f77bcf86cd799439011";
const operationId = "11111111-1111-4111-8111-111111111111";
const scope = "driver:recette:507f1f77bcf86cd799439012";
const view: DeliveryHandoffState = { missionId, revision: 0, missionRevision: 3, orderStatus: "ready", proof: { id: "22222222-2222-4222-8222-222222222222", expiresAt: "2030-01-02T00:00:00.000Z", locked: false }, incident: null, canHandoff: true, canOverride: false, canRotate: false };
function harness() {
  const rows = new Map<string, string>();
  const storage = { get length() { return rows.size; }, key: (n: number) => [...rows.keys()][n] ?? null,
    getItem: (key: string) => rows.get(key) ?? null, setItem: (key: string, value: string) => { rows.set(key, value); }, removeItem: (key: string) => { rows.delete(key); } };
  const request = vi.fn<(path: string, body?: unknown) => Promise<unknown>>(async () => view);
  const current = vi.fn(() => true); const revoked = vi.fn(); const online = vi.fn(() => true);
  const create = () => createDeliveryHandoffClient({ missionId, scope, path: `/livreur/missions/${missionId}/handoff`, request, storage: () => storage, current, revoked, online, uuid: () => operationId });
  return { rows, storage, request, current, revoked, online, create };
}
const terminal = (action = "handoff", outcome = "applied") => ({ missionId, operationId, action, appliedRevision: 1, replay: true, outcome,
  refusalCode: outcome === "rejected" ? "proof_incorrect" : outcome === "abandoned" ? "abandoned" : null,
  state: { ...view, revision: 1, orderStatus: outcome === "applied" ? "delivered" : "ready", canHandoff: outcome !== "applied" } });

describe("remise : réponse serveur seule, reprise sans PIN ni geste répété", () => {
  it("lit l’autorité avant envoi, sauvegarde seulement l’identité puis confirme la remise", async () => {
    const h = harness(); const client = h.create(); await client.start();
    h.request.mockImplementation(async (path, body) => {
      if (!body) return view;
      expect(path).toMatch(/\/confirm$/);
      expect(body).toMatchObject({ proof: { kind: "pin", value: "123456" } });
      expect([...h.rows.values()].join()).not.toContain("123456");
      expect(h.rows.size).toBe(1);
      return terminal();
    });
    await client.act("handoff", { proof: { kind: "pin", value: "123456" } });
    expect(h.request.mock.calls.filter(([, body]) => body)).toHaveLength(1);
    expect(client.getSnapshot()).toMatchObject({ pending: null, busy: false, view: { orderStatus: "delivered" }, outcome: "applied" });
    expect(h.rows.size).toBe(0);
  });
  it("après perte de réponse et reload n’envoie rien automatiquement ; resolve reprend le même ID sans preuve", async () => {
    const h = harness(); let client = h.create(); await client.start();
    h.request.mockImplementation(async (_path, body) => { if (body) throw Error("lost"); return view; });
    await client.act("handoff", { proof: { kind: "pin", value: "123456" } });
    expect(client.getSnapshot().pending?.operation.operationId).toBe(operationId);
    await client.act("incident", { code: "customer_absent" });
    expect(h.request.mock.calls.filter(([, body]) => body)).toHaveLength(1);
    client.stop(); client = h.create(); await client.start();
    expect(h.request.mock.calls.filter(([, body]) => body)).toHaveLength(1);
    h.request.mockImplementation(async (path, body) => {
      expect(path).toMatch(/\/resolve$/);
      expect(body).toEqual({ action: "handoff", expectedRevision: 0, expectedMissionRevision: 3, operationId });
      return terminal("handoff", "abandoned");
    });
    await client.resolve();
    expect(client.getSnapshot()).toMatchObject({ pending: null, outcome: "abandoned", view: { orderStatus: "ready" } });
    expect(h.rows.size).toBe(0);
  });
  it("un PIN erroné a un refus terminal visible, jamais un succès vert", async () => {
    const h = harness(); const client = h.create(); await client.start();
    h.request.mockImplementation(async (_path, body) => body ? terminal("handoff", "rejected") : view);
    await client.act("handoff", { proof: { kind: "pin", value: "123456" } });
    expect(client.getSnapshot()).toMatchObject({ outcome: "rejected", pending: null, view: { orderStatus: "ready" } });
    expect(client.getSnapshot().message).toMatch(/code|QR/i);
  });
  it("un changement de mission entre la lecture et le geste exige une nouvelle confirmation", async () => {
    const h = harness(); const client = h.create(); await client.start();
    h.request.mockResolvedValue({ ...view, missionRevision: 4 });
    await client.act("handoff", { proof: { kind: "pin", value: "123456" } });
    expect(h.request.mock.calls.filter(([, body]) => body)).toHaveLength(0);
    expect(h.rows.size).toBe(0);
    expect(client.getSnapshot().view?.missionRevision).toBe(4);
  });
  it("un stockage refusé ou le hors-ligne ne transmet aucune mutation", async () => {
    const h = harness(); const client = h.create(); await client.start();
    h.storage.setItem = () => { throw Error("denied"); };
    await client.act("handoff", { proof: { kind: "pin", value: "123456" } });
    expect(h.request.mock.calls.filter(([, body]) => body)).toHaveLength(0);
    h.online.mockReturnValue(false);
    await client.act("handoff", { proof: { kind: "pin", value: "123456" } });
    expect(h.request.mock.calls.filter(([, body]) => body)).toHaveLength(0);
  });
  it.each([404, 409, 503])("un HTTP %s n’efface pas l’intention et permet encore resolve", async status => {
    const h = harness(); const client = h.create(); await client.start();
    h.request.mockImplementation(async (_path, body) => { if (body) throw new HandoffHttpError(status, "UNKNOWN"); return view; });
    await client.act("incident", { code: "customer_absent" });
    expect(client.getSnapshot().pending).not.toBeNull();
    await client.resolve();
    expect(h.request.mock.calls.filter(([path]) => path.endsWith("/resolve"))).toHaveLength(1);
    expect(h.rows.size).toBe(1);
  });
  it("rejette une ancienne réponse après révocation/changement de session", async () => {
    const h = harness(); const client = h.create(); await client.start();
    h.request.mockImplementation(async (_path, body) => { if (body) { h.current.mockReturnValue(false); return terminal(); } return view; });
    await client.act("handoff", { proof: { kind: "pin", value: "123456" } });
    expect(client.getSnapshot().view).toBeNull();
    expect(client.getSnapshot().outcome).not.toBe("applied");
    expect(h.rows.size).toBe(1);
  });
});
