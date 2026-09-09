import { describe, expect, it, vi } from "vitest";
import { randomUUID } from 'node:crypto';
import { CustomerAccountHttpError, createCustomerAccountClient, customerAccountRequest, type CustomerAccountSelection } from "./client";

const now = 1_800_000_000_000;
const view = (name = "Camille", revision = 0, phoneE164 = "+33600000001") => ({
  expiresAt: now + 60_000, profile: { name, revision, phoneE164, phoneVerifiedAt: now - 1_000 },
});
const deferred = <T>() => { let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; };
function setup() {
  let current = view(); let active = true;
  let selected = { browserRef: randomUUID(), publication: { expectedOperationId: randomUUID(), expectedCheckId: randomUUID() } };
  const selection = vi.fn(async () => structuredClone(selected));
  const request = Object.assign(vi.fn<(action: string, body?: unknown, selection?: CustomerAccountSelection) => Promise<unknown>>(async (action, body) => {
    if (action === "status") return { available: false };
    if (action === "session") return current;
    if (action === "logout") return undefined;
    if (action === "name") { current = view((body as { name: string }).name, 1); return current; }
    throw Error("Unexpected endpoint");
  }), { selection });
  const announce = vi.fn();
  const lock = vi.fn(async (job: () => Promise<void>) => job());
  const client = createCustomerAccountClient({ request, lock, announce, now: () => now, active: () => active });
  return { client, request, announce, lock, selection,
    changePublication: () => { selected = { ...selected, publication: { expectedOperationId: randomUUID(), expectedCheckId: randomUUID() } }; },
    change: (next: ReturnType<typeof view>) => { current = next; }, hide: () => { active = false; client.invalidate("idle"); } };
}

describe("Compte client — vues privées et mutations sérialisées", () => {
  it('expose seulement la publication publique de la vue affichée, puis la retire à invalidation', async () => {
    const f = setup(); expect(f.client.currentAccess()).toBeNull(); await f.client.refresh();
    const snapshot = f.client.currentAccess()!;
    expect(snapshot).toEqual({ selection: await f.request.selection(), expiresAt: now + 60_000 });
    f.changePublication(); expect(f.client.currentAccess()).toEqual(snapshot); // Never adopt B from a late journal read.
    snapshot.selection.publication.expectedCheckId = randomUUID(); expect(f.client.currentAccess()).not.toEqual(snapshot);
    f.client.invalidate(); expect(f.client.currentAccess()).toBeNull();
  });
  it.each(['name', 'logout'] as const)('refuse %s préparé sur A si la publication devient B pendant le verrou, même avec une vue identique', async action => {
    const f = setup(); await f.client.refresh(); const displayed = f.client.getSnapshot().view;
    const release = deferred<void>();
    f.lock.mockImplementation(async job => { await release.promise; return job(); });
    const pending = action === 'name' ? f.client.saveName('Brouillon de A') : f.client.logout();
    f.changePublication(); // Cross-tab notification has not arrived; PII, revision and expiry are unchanged.
    release.resolve(); expect(await pending).toBe(false);
    expect(displayed).toEqual(view());
    expect(f.request.mock.calls.filter(([called]) => called === action)).toHaveLength(0);
    expect(f.client.getSnapshot().view).toBeNull();
  });
  it.each(['name', 'logout'] as const)('refuse %s si la publication change pendant la relecture préalable, sans changement de profil', async action => {
    const f = setup(); await f.client.refresh();
    f.request.mockImplementation(async called => {
      if (called === 'session') { f.changePublication(); return view(); }
      return undefined;
    });
    expect(await (action === 'name' ? f.client.saveName('Ancien brouillon') : f.client.logout())).toBe(false);
    expect(f.request.mock.calls.filter(([called]) => called === action)).toHaveLength(0);
    expect(f.client.getSnapshot().view).toBeNull();
  });
  it('ne publie pas une vue dont la sélection a changé pendant la lecture de disponibilité', async () => {
    const f = setup(), availability = deferred<unknown>();
    f.request.mockImplementation(async action => action === 'status' ? availability.promise : view());
    const pending = f.client.refresh(); await vi.waitFor(() => expect(f.request).toHaveBeenCalledTimes(2));
    f.changePublication(); availability.resolve({ available: false }); await pending;
    expect(f.client.getSnapshot().view).toBeNull(); expect(await f.client.logout()).toBe(false);
  });
  it('ne déduit aucune sélection personnelle d’un simple profil retourné par un port incomplet', async () => {
    const request = vi.fn(async () => view());
    const client = createCustomerAccountClient({ request, lock: async job => job(), now: () => now });
    await client.refresh(); expect(client.getSnapshot().view).toBeNull(); expect(await client.logout()).toBe(false);
    expect(request.mock.calls).toHaveLength(1); // Status only, never a private call.
  });
  it.each(['name', 'logout'] as const)('le transport %s conserve la publication A attendue plutôt que signer B au dernier instant', async action => {
    const f = setup(), expected = await f.selection(); f.changePublication();
    const request = customerAccountRequest('fixture', async () => expected.browserRef, async () => (await f.selection()).publication);
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    try {
      await expect(request(action, action === 'name' ? { name: 'A', expectedRevision: 0 } : { all: false }, expected))
        .rejects.toMatchObject({ status: 409 });
      expect(fetch).not.toHaveBeenCalled();
    } finally { vi.unstubAllGlobals(); }
  });
  it("ne confond pas disponibilité SMS et session personnelle valide", async () => {
    const { client, request } = setup(); await client.refresh();
    expect(client.getSnapshot()).toMatchObject({ status: "authenticated", available: false, view: view() });
    expect(request.mock.calls.map(([action]) => action)).toEqual(["status", "session"]);
  });
  it("efface immédiatement le profil caché et ignore un ancien 200", async () => {
    const { client, request, hide } = setup(); const late = deferred<unknown>();
    request.mockImplementation(async action => action === "status" ? { available: false } : late.promise);
    const read = client.refresh(); await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(2));
    hide(); late.resolve(view()); await read;
    expect(client.getSnapshot().view).toBeNull();
  });
  it("un 401 devient invité, sans masquer les autres erreurs en déconnexion réussie", async () => {
    const { client, request } = setup(); await client.refresh();
    request.mockImplementation(async action => { if (action === "status") return { available: false }; throw new CustomerAccountHttpError(401); });
    await client.refresh(); expect(client.getSnapshot()).toMatchObject({ status: "guest", view: null });
    request.mockRejectedValue(new CustomerAccountHttpError(503)); await client.refresh();
    expect(client.getSnapshot()).toMatchObject({ status: "unavailable", view: null });
  });
  it("refuse un profil expiré, un secret inattendu ou une forme non contractuelle", async () => {
    for (const raw of [{ ...view(), expiresAt: now }, { ...view(), token: "never-browser-json" }, { profile: view().profile }]) {
      const { client, request } = setup();
      request.mockImplementation(async action => action === "status" ? { available: false } : raw);
      await client.refresh(); expect(client.getSnapshot().view).toBeNull();
      expect(client.getSnapshot().status).not.toBe("authenticated");
    }
  });
  it("revalide l’auteur et sa révision sous verrou avant de modifier", async () => {
    const { client, request, announce } = setup(); await client.refresh();
    expect(await client.saveName("Nouveau nom")).toBe(true);
    expect(request.mock.calls.map(([action]) => action)).toEqual(["status", "session", "session", "name"]);
    expect(request).toHaveBeenLastCalledWith("name", { name: "Nouveau nom", expectedRevision: 0 }, await request.selection());
    expect(announce).toHaveBeenCalledTimes(2);
    expect(client.getSnapshot()).toMatchObject({ busy: false, view: view("Nouveau nom", 1) });
  });
  it.each(["name", "logout"])("refuse %s si le cookie vise maintenant un autre compte", async action => {
    const { client, request, change } = setup(); await client.refresh(); change(view("Autre", 0, "+33600000002"));
    expect(await (action === "name" ? client.saveName("Nom A") : client.logout())).toBe(false);
    expect(request.mock.calls.filter(([called]) => called === action)).toHaveLength(0);
    expect(client.getSnapshot().view).toBeNull();
  });
  it("refuse une révision modifiée ailleurs plutôt que la réécrire", async () => {
    const { client, change, request } = setup(); await client.refresh(); change(view("Modifié ailleurs", 1));
    expect(await client.saveName("Ancien brouillon")).toBe(false);
    expect(request.mock.calls.filter(([action]) => action === "name")).toHaveLength(0);
  });
  it("n’envoie rien après invalidation pendant l’attente du verrou", async () => {
    const { client, lock, request, hide } = setup(); await client.refresh(); const release = deferred<void>();
    lock.mockImplementation(async job => { await release.promise; return job(); });
    const saving = client.saveName("Ne pas envoyer"); hide(); release.resolve(); await saving;
    expect(request.mock.calls.filter(([action]) => action === "name")).toHaveLength(0);
  });
  it.each(["name", "logout"])("ne rejoue pas %s après réponse perdue et ne conserve pas le profil", async action => {
    const { client, request } = setup(); await client.refresh();
    request.mockImplementation(async called => { if (called === "session") return view(); throw Error("Response lost with private details"); });
    expect(await (action === "name" ? client.saveName("Nom") : client.logout())).toBe(false);
    expect(request.mock.calls.filter(([called]) => called === action)).toHaveLength(1);
    expect(client.getSnapshot()).toMatchObject({ view: null, busy: false, status: "error" });
    expect(client.getSnapshot().message).toContain("pas confirmée");
    expect(client.getSnapshot().message).not.toContain("private details");
  });
  it("double clic = une seule mutation, déconnexion confirmée uniquement après 204", async () => {
    const { client, request } = setup(); await client.refresh(); const late = deferred<unknown>();
    request.mockImplementation(async action => action === "session" ? view() : late.promise);
    const first = client.logout(true); expect(await client.logout(true)).toBe(false);
    await vi.waitFor(() => expect(request).toHaveBeenCalledWith("logout", { all: true }, expect.any(Object)));
    expect(client.getSnapshot()).toMatchObject({ view: null, busy: true });
    late.resolve(undefined); expect(await first).toBe(true);
    expect(client.getSnapshot()).toMatchObject({ view: null, busy: false, status: "guest" });
  });
  it("n’expose aucune mutation sans verrou interonglets", async () => {
    const { request } = setup(); const client = createCustomerAccountClient({ request, now: () => now });
    await client.refresh(); expect(await client.logout()).toBe(false);
    expect(request.mock.calls.filter(([action]) => action === "logout")).toHaveLength(0);
  });
  it("conserve une revalidation demandée après invalidation pendant une mutation", async () => {
    const { client, request } = setup(); await client.refresh(); const late = deferred<unknown>();
    let loggedOut = false;
    request.mockImplementation(async action => {
      if (action === "status") return { available: false };
      if (action === "session") { if (loggedOut) throw new CustomerAccountHttpError(401); return view(); }
      const result = await late.promise; loggedOut = true; return result;
    });
    const write = client.logout(); await vi.waitFor(() => expect(request).toHaveBeenCalledWith("logout", { all: false }, expect.any(Object)));
    client.invalidate(); await client.refresh(); late.resolve(undefined); await write;
    await vi.waitFor(() => expect(client.getSnapshot()).toMatchObject({ status: "guest", view: null, busy: false }));
    expect(request.mock.calls.filter(([action]) => action === "logout")).toHaveLength(1);
    expect(request.mock.calls.filter(([action]) => action === "session")).toHaveLength(3);
  });
});
