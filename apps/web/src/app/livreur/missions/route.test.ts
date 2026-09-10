import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET as list } from "./route";
import { GET as history } from "../history/route";
import { GET as detail } from "./[id]/route";
import { POST as dispatch } from "./[id]/depart/route";

const ORIGIN = "https://staging.snackmanager.fr";
const ID = "507f1f77bcf86cd799439011";
const OTHER_ID = "507f1f77bcf86cd799439012";
const TOKEN = "S".repeat(43);
const COOKIE = `__Secure-sm_delivery_access=${TOKEN}`;
const PRIVATE = "pi_fixture_secret_do_not_expose";
const OPERATION = "51077f1a-7c7e-4a78-9f44-c6e1aabef058";
const INPUT = { operationId: OPERATION, expectedRevision: 2 };
const MISSION = {
  id: ID, number: 7, createdAt: "2026-09-07T10:00:00Z", scheduledAt: null, orderStatus: "ready", revision: 2,
  operator: { id: OTHER_ID, name: "Livreur de recette" }, assignmentId: OPERATION,
  assignedAt: "2026-09-07T10:05:00Z", dispatchedAt: null, paymentReady: true, canAssign: true, canDispatch: true,
  customer: { name: "Client de recette", phone: null },
  address: { line1: "10 rue de Recette", postalCode: "75001", city: "Paris", country: "FR" },
  instructions: null, items: [{ name: "Menu de recette", variantName: null, qty: 1 }],
};
const LIST = { missions: [MISSION], nextCursor: ID };
const HISTORY = { missions: [{ ...MISSION, orderStatus: "delivered", deliveredAt: "2026-09-07T11:00:00Z", canAssign: false, canDispatch: false }], nextCursor: null };
const RESULT = { operationId: OPERATION, appliedRevision: 3, replay: false, outcome: "applied", refusalCode: null,
  mission: { ...MISSION, revision: 3, canDispatch: false, dispatchedAt: "2026-09-07T10:10:00Z" } };
const fetchApi = vi.fn<typeof fetch>();
const context = (id = ID) => ({ params: Promise.resolve({ id }) });
const endpoints = [
  { name: "liste", method: "GET", path: "/livreur/missions", upstream: "missions", run: list, view: LIST },
  { name: "détail", method: "GET", path: `/livreur/missions/${ID}`, upstream: `missions/${ID}`,
    run: (request: NextRequest) => detail(request, context()), view: MISSION },
  { name: "départ", method: "POST", path: `/livreur/missions/${ID}/depart`, upstream: `missions/${ID}/dispatch`,
    run: (request: NextRequest) => dispatch(request, context()), view: RESULT },
  { name: "historique", method: "GET", path: "/livreur/history", upstream: "history", run: history, view: HISTORY },
] as const;
type Endpoint = typeof endpoints[number];

function request(endpoint: Endpoint, options: {
  path?: string; url?: string; origin?: string | null; cookie?: string | null;
  headers?: Record<string, string>; body?: unknown; rawBody?: string; signal?: AbortSignal;
} = {}) {
  const headers = new Headers({ "Content-Type": "application/json", "Sec-Fetch-Site": "same-origin", ...options.headers });
  if (options.origin !== null) headers.set("Origin", options.origin ?? ORIGIN);
  if (options.cookie !== null) headers.set("Cookie", options.cookie ?? COOKIE);
  return new NextRequest(options.url ?? `${ORIGIN}${options.path ?? endpoint.path}`, {
    method: endpoint.method, headers, signal: options.signal,
    ...(endpoint.method === "POST" ? { body: options.rawBody ?? JSON.stringify(options.body ?? INPUT) } : {}),
  });
}
function privateHeaders(response: Response) {
  expect(response.headers.get("cache-control")).toBe("private, no-store, max-age=0");
  expect(response.headers.get("pragma")).toBe("no-cache");
  expect(response.headers.get("vary")).toBe("Cookie, Origin");
  expect(response.headers.get("referrer-policy")).toBe("no-referrer");
  expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  expect(response.headers.get("location")).toBeNull();
}

beforeEach(() => {
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("NEXT_PUBLIC_API_URL", "https://api.example.test/");
  vi.stubEnv("NEXT_PUBLIC_SITE_URL", ORIGIN);
  vi.stubEnv("RAILWAY_ENVIRONMENT_NAME", "staging");
  fetchApi.mockReset(); vi.stubGlobal("fetch", fetchApi);
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe.each(endpoints)("BFF missions — $name", endpoint => {
  it("valide la projection et ne propage aucun en-tête ou credential amont", async () => {
    fetchApi.mockResolvedValue(Response.json(endpoint.view, { headers: {
      "Set-Cookie": `stripe=${PRIVATE}`, Location: `https://attacker.test/${PRIVATE}`, "X-Internal": TOKEN,
    } }));
    const timeout = vi.spyOn(AbortSignal, "timeout");
    const result = await endpoint.run(request(endpoint, { headers: {
      Authorization: `Bearer ${PRIVATE}`, "X-Forwarded-For": "203.0.113.7", "X-Internal": PRIVATE,
    } }));
    expect(result.status).toBe(200); expect(await result.json()).toEqual(endpoint.view);
    privateHeaders(result);
    expect(result.headers.get("set-cookie")).toBeNull();
    expect(result.headers.get("x-internal")).toBeNull();
    expect(timeout).toHaveBeenCalledWith(10_000);
    const [url, options] = fetchApi.mock.calls[0]!;
    expect(url).toBe(`https://api.example.test/delivery-access/${endpoint.upstream}`);
    expect(options).toMatchObject({ method: endpoint.method, cache: "no-store", redirect: "error" });
    expect(options!.headers).toEqual({ Accept: "application/json", Authorization: `Bearer ${TOKEN}`,
      ...(endpoint.method === "POST" ? { "Content-Type": "application/json" } : {}) });
    expect(options!.body).toBe(endpoint.method === "POST" ? JSON.stringify(INPUT) : undefined);
    expect(options!.signal).toBeInstanceOf(AbortSignal);
  });

  it.each([null, "__Secure-sm_delivery_access=invalid", `${COOKIE}; ${COOKIE}`])("refuse l’identité absente, invalide ou ambiguë : %s", async cookie => {
    const result = await endpoint.run(request(endpoint, { cookie }));
    expect(result.status).toBe(401); privateHeaders(result);
    expect(result.headers.get("set-cookie")).toContain("Max-Age=0");
    expect(fetchApi).not.toHaveBeenCalled();
  });

  it.each(["cross-site", "same-site"])("refuse Fetch Metadata %s avant l’API", async site => {
    const result = await endpoint.run(request(endpoint, { headers: { "Sec-Fetch-Site": site } }));
    expect(result.status).toBe(403); privateHeaders(result);
    expect(result.headers.get("set-cookie")).toBeNull(); expect(fetchApi).not.toHaveBeenCalled();
  });

  it("refuse une origine et des forwarded falsifiés ensemble", async () => {
    const result = await endpoint.run(request(endpoint, { origin: "https://attacker.test",
      headers: { "X-Forwarded-Host": "attacker.test", "X-Forwarded-Proto": "https" } }));
    expect(result.status).toBe(403); expect(fetchApi).not.toHaveBeenCalled();
  });

  it("reconnaît exactement l’origine publique derrière le proxy Railway", async () => {
    fetchApi.mockResolvedValue(Response.json(endpoint.view));
    const result = await endpoint.run(request(endpoint, { url: `http://localhost:8080${endpoint.path}`,
      headers: { "X-Forwarded-Host": "staging.snackmanager.fr", "X-Forwarded-Proto": "https" } }));
    expect(result.status).toBe(200);
  });

  it.each([401, 403, 404, 409, 429, 503])( "assainit HTTP %s sans confondre mission et session", async status => {
    fetchApi.mockResolvedValue(Response.json({ message: PRIVATE, token: TOKEN, order: { stripe: PRIVATE } }, {
      status, headers: { "Set-Cookie": `leak=${TOKEN}`, "Retry-After": "12", Location: `https://attacker.test/${PRIVATE}` },
    }));
    const result = await endpoint.run(request(endpoint));
    expect(result.status).toBe(status); privateHeaders(result);
    const body = await result.text(); expect(body).not.toContain(TOKEN); expect(body).not.toContain(PRIVATE);
    if (status === 401) expect(result.headers.get("set-cookie")).toContain("Max-Age=0");
    else expect(result.headers.get("set-cookie")).toBeNull();
    if (status === 404 || status === 409) expect(body).not.toMatch(/invitation|expiré/);
    expect(result.headers.get("retry-after")).toBe(status === 429 ? "12" : null);
  });

  it.each([201, 204, 206, 302, 500])("ne transforme pas un statut amont inattendu %s en succès", async status => {
    fetchApi.mockResolvedValue(new Response(status === 204 ? null : JSON.stringify(endpoint.view), {
      status, headers: { Location: `https://attacker.test/${PRIVATE}` },
    }));
    const result = await endpoint.run(request(endpoint));
    expect(result.status).toBe(503); privateHeaders(result); expect(result.headers.get("set-cookie")).toBeNull();
  });

  it("refuse un document Order ou un secret ajouté à une réponse pourtant 200", async () => {
    fetchApi.mockResolvedValue(Response.json({ ...endpoint.view, stripeClientSecret: PRIVATE, sessionToken: TOKEN }));
    const result = await endpoint.run(request(endpoint));
    expect(result.status).toBe(503); expect(result.headers.get("set-cookie")).toBeNull();
    const text = await result.text(); expect(text).not.toContain(TOKEN); expect(text).not.toContain(PRIVATE);
  });

  it("garde la session sur JSON invalide, erreur réseau ou annulation de la requête", async () => {
    fetchApi.mockResolvedValueOnce(new Response("not json", { status: 200 }))
      .mockRejectedValueOnce(new Error(`upstream ${PRIVATE}`));
    for (let attempt = 0; attempt < 2; attempt++) {
      const result = await endpoint.run(request(endpoint));
      expect(result.status).toBe(503); expect(result.headers.get("set-cookie")).toBeNull();
      expect(await result.text()).not.toContain(PRIVATE);
    }
    const abort = new AbortController(); abort.abort();
    fetchApi.mockImplementationOnce(async (_url, options) => {
      expect(options!.signal!.aborted).toBe(true); throw new DOMException("aborted", "AbortError");
    });
    expect((await endpoint.run(request(endpoint, { signal: abort.signal }))).status).toBe(503);
  });

  it("refuse un chemin non canonique sans le transmettre à l’API", async () => {
    for (const path of [`${endpoint.path}/`, endpoint.path.replace("/livreur/", "/livreur//"), `${endpoint.path}/extra`]) {
      expect((await endpoint.run(request(endpoint, { path }))).status).toBe(400);
    }
    expect(fetchApi).not.toHaveBeenCalled();
  });
});

describe("paramètres, contenu et preuve de départ", () => {
  it("borne la pagination à un curseur canonique unique, sans transmettre d’autre filtre", async () => {
    fetchApi.mockResolvedValue(Response.json(LIST));
    expect((await list(request(endpoints[0], { path: `/livreur/missions?after=${ID}`, origin: null }))).status).toBe(200);
    expect(fetchApi.mock.calls[0]![0]).toBe(`https://api.example.test/delivery-access/missions?after=${ID}`);
    fetchApi.mockClear();
    for (const suffix of ["?after=", `?after=${ID}&after=${ID}`, `?after=${ID}&%61fter=${ID}`,
      `?after[]=${ID}`, `?after=${ID}&tenantId=${ID}`, "?redirect=https://attacker.test", `?after=${ID.toUpperCase()}`]) {
      expect((await list(request(endpoints[0], { path: `/livreur/missions${suffix}` }))).status).toBe(400);
    }
    expect(fetchApi).not.toHaveBeenCalled();
  });

  it("refuse tout paramètre de requête sur un détail ou une mutation", async () => {
    for (const endpoint of endpoints.slice(1, 3)) {
      for (const query of [`?after=${ID}`, "?id=first&id=second", "?extra="]) {
        expect((await endpoint.run(request(endpoint, { path: `${endpoint.path}${query}` }))).status).toBe(400);
      }
    }
    expect(fetchApi).not.toHaveBeenCalled();
  });

  it.each(["invalid", ID.toUpperCase(), `${ID}/${OTHER_ID}`, "..", `${ID}?token=secret`])("refuse l’identifiant de chemin %s", async id => {
    expect((await detail(request(endpoints[1]), context(id))).status).toBe(400);
    expect((await dispatch(request(endpoints[2]), context(id))).status).toBe(400);
    expect(fetchApi).not.toHaveBeenCalled();
  });

  it("refuse un id valide qui ne correspond pas au chemin et des params surnuméraires", async () => {
    expect((await detail(request(endpoints[1]), context(OTHER_ID))).status).toBe(400);
    expect((await dispatch(request(endpoints[2]), context(OTHER_ID))).status).toBe(400);
    expect((await detail(request(endpoints[1]), { params: Promise.resolve({ id: ID, extra: PRIVATE }) })).status).toBe(400);
    expect(fetchApi).not.toHaveBeenCalled();
  });

  it.each([null, "null", "https://attacker.test", "https://staging.snackmanager.fr/path"])("exige Origin exact pour POST : %s", async origin => {
    expect((await dispatch(request(endpoints[2], { origin }), context())).status).toBe(403);
    expect(fetchApi).not.toHaveBeenCalled();
  });

  it.each([
    {}, { ...INPUT, expectedRevision: -1 }, { ...INPUT, expectedRevision: 0.5 }, { ...INPUT, operationId: "weak" },
    { ...INPUT, expectedRevision: "2" }, { ...INPUT, driverName: "injected" }, { ...INPUT, operatorId: OTHER_ID },
  ])("refuse un départ non conforme au contrat", async body => {
    expect((await dispatch(request(endpoints[2], { body }), context())).status).toBe(400);
    expect(fetchApi).not.toHaveBeenCalled();
  });

  it("refuse les formulaires et borne le corps lu à 1024 octets", async () => {
    expect((await dispatch(request(endpoints[2], { headers: { "Content-Type": "text/plain" } }), context())).status).toBe(415);
    for (const options of [{ rawBody: " ".repeat(1_025) }, { rawBody: "{" },
      { headers: { "Content-Length": "1025" } }, { headers: { "Content-Length": "not-a-length" } }]) {
      expect((await dispatch(request(endpoints[2], options), context())).status).toBe(400);
    }
    expect(fetchApi).not.toHaveBeenCalled();
  });

  it("valide aussi les champs imbriqués des projections liste et détail", async () => {
    const contaminated = { ...MISSION, customer: { ...MISSION.customer, trackingToken: PRIVATE } };
    fetchApi.mockResolvedValueOnce(Response.json({ ...LIST, missions: [contaminated] }))
      .mockResolvedValueOnce(Response.json(contaminated));
    expect((await list(request(endpoints[0]))).status).toBe(503);
    expect((await detail(request(endpoints[1]), context())).status).toBe(503);
  });

  it("ne confirme ni un autre id de mission ni une autre opération", async () => {
    fetchApi.mockResolvedValueOnce(Response.json({ ...MISSION, id: OTHER_ID }))
      .mockResolvedValueOnce(Response.json({ ...RESULT, mission: { ...RESULT.mission, id: OTHER_ID } }))
      .mockResolvedValueOnce(Response.json({ ...RESULT, operationId: "5bfcfd74-d4da-48a2-a919-3516fa88e965" }));
    expect((await detail(request(endpoints[1]), context())).status).toBe(503);
    expect((await dispatch(request(endpoints[2]), context())).status).toBe(503);
    expect((await dispatch(request(endpoints[2]), context())).status).toBe(503);
  });

  it("transmet un refus terminal enregistré sans le convertir en départ appliqué", async () => {
    const rejected = { ...RESULT, outcome: "rejected", refusalCode: "delivery.mission.payment_blocked",
      mission: { ...MISSION, revision: 3, paymentReady: false, canDispatch: false } };
    fetchApi.mockResolvedValue(Response.json(rejected));
    const result = await dispatch(request(endpoints[2]), context());
    expect(result.status).toBe(200); expect(await result.json()).toEqual(rejected);
    expect(result.headers.get("set-cookie")).toBeNull();
  });

  it("refuse une issue incohérente ou un code de refus hors contrat", async () => {
    for (const body of [{ ...RESULT, refusalCode: "delivery.mission.not_ready" },
      { ...RESULT, outcome: "rejected", refusalCode: PRIVATE }, { ...RESULT, outcome: "rejected", refusalCode: null }]) {
      fetchApi.mockResolvedValueOnce(Response.json(body));
      expect((await dispatch(request(endpoints[2]), context())).status).toBe(503);
    }
  });

  it.each(["DELIVERY_MISSION_CHANGED", "DELIVERY_MISSION_OPERATION_CONFLICT", "DELIVERY_OPERATOR_CHANGED",
    "DELIVERY_MISSION_LIMIT", "delivery.mission.payment_blocked", "delivery.mission.not_ready"])("préserve le code métier autorisé %s, jamais son message amont", async code => {
    fetchApi.mockResolvedValue(Response.json({ code, message: PRIVATE, token: TOKEN }, { status: 409 }));
    const result = await dispatch(request(endpoints[2]), context());
    expect(result.status).toBe(409); expect(result.headers.get("set-cookie")).toBeNull();
    const body = await result.json(); expect(body.code).toBe(code);
    expect(Object.keys(body).sort()).toEqual(["code", "message"]);
    expect(JSON.stringify(body)).not.toContain(PRIVATE); expect(JSON.stringify(body)).not.toContain(TOKEN);
  });

  it("un conflit inconnu ou un mauvais statut n’est jamais une preuve DELIVERY_MISSION_CHANGED", async () => {
    for (const [status, code] of [[409, "constructor"], [409, PRIVATE], [503, "DELIVERY_MISSION_CHANGED"]] as const) {
      fetchApi.mockResolvedValueOnce(Response.json({ code, message: PRIVATE }, { status }));
      const result = await dispatch(request(endpoints[2]), context());
      expect(result.headers.get("set-cookie")).toBeNull();
      expect((await result.json()).code).toBe(status === 409 ? "MISSION_CONFLICT" : "SERVICE_UNAVAILABLE");
    }
  });
});

describe("historique privé livreur", () => {
  it("refuse une mission active, sans heure serveur ou enrichie de secrets", async () => {
    for (const mission of [MISSION, { ...HISTORY.missions[0], deliveredAt: null }, { ...HISTORY.missions[0], paymentSummary: { totalCents: 1500, method: "online", status: "paid", tender: "online", stripePaymentIntentId: PRIVATE } }]) {
      fetchApi.mockResolvedValueOnce(Response.json({ missions: [mission], nextCursor: null }));
      const result = await history(request(endpoints[3])); expect(result.status).toBe(503); expect(await result.text()).not.toContain(PRIVATE);
    }
  });
  it("borne le curseur et refuse un filtre opérateur injecté", async () => {
    fetchApi.mockResolvedValue(Response.json(HISTORY));
    expect((await history(request(endpoints[3], { path: `/livreur/history?after=${ID}` }))).status).toBe(200);
    expect(fetchApi.mock.calls[0]![0]).toBe(`https://api.example.test/delivery-access/history?after=${ID}`);
    fetchApi.mockClear();
    for (const suffix of [`?after=${ID}&after=${ID}`, `?operatorId=${ID}`, "?after=bad", `?after=${ID}&tenantId=${ID}`]) {
      expect((await history(request(endpoints[3], { path: `/livreur/history${suffix}` }))).status).toBe(400);
    }
    expect(fetchApi).not.toHaveBeenCalled();
  });
});
