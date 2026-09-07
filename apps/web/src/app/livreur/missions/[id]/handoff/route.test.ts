import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "./route";
import { POST } from "./[action]/route";

const ORIGIN = "https://staging.snackmanager.fr";
const ID = "a".repeat(24);
const OTHER = "b".repeat(24);
const OP = "11111111-1111-4111-8111-111111111111";
const TOKEN = "S".repeat(43);
const COOKIE = `__Secure-sm_delivery_access=${TOKEN}`;
const state = { missionId: ID, revision: 4, missionRevision: 2, orderStatus: "ready", proof: null, incident: null,
  canHandoff: false, canOverride: false, canRotate: false };
const operation = { operationId: OP, expectedRevision: 3, expectedMissionRevision: 2 };
const endpoints = ["state", "confirm", "incident", "resolve"] as const;
type Endpoint = typeof endpoints[number];
const method = (endpoint: Endpoint) => endpoint === "state" ? "GET" : "POST";
const path = (endpoint: Endpoint) => `/livreur/missions/${ID}/handoff${endpoint === "state" ? "" : `/${endpoint}`}`;
const body = (endpoint: Endpoint) => ({ ...operation, ...(endpoint === "confirm" ? { proof: { kind: "pin", value: "001234" } }
  : endpoint === "incident" ? { code: "customer_absent" } : { action: "handoff" }) });
const response = (endpoint: Endpoint) => endpoint === "state" ? state : { missionId: ID, operationId: OP,
  action: endpoint === "incident" ? "incident" : "handoff", outcome: "applied", refusalCode: null,
  appliedRevision: 4, replay: endpoint === "resolve", state };
const fetchApi = vi.fn<typeof fetch>();
function request(endpoint: Endpoint, options: { cookie?: string | null; origin?: string | null; headers?: Record<string, string>;
  body?: unknown; raw?: string; url?: string } = {}) {
  const headers = new Headers({ "Content-Type": "application/json", "Sec-Fetch-Site": "same-origin", ...options.headers });
  if (options.cookie !== null) headers.set("cookie", options.cookie ?? COOKIE);
  if (options.origin !== null) headers.set("origin", options.origin ?? ORIGIN);
  return new NextRequest(options.url ?? ORIGIN + path(endpoint), { method: method(endpoint), headers,
    ...(endpoint === "state" ? {} : { body: options.raw ?? JSON.stringify(options.body ?? body(endpoint)) }) });
}
function run(endpoint: Endpoint, req: NextRequest) {
  return endpoint === "state" ? GET(req, { params: Promise.resolve({ id: ID }) })
    : POST(req, { params: Promise.resolve({ id: ID, action: endpoint }) });
}
function expectPrivate(result: Response) {
  expect(result.headers.get("cache-control")).toBe("private, no-store, max-age=0");
  expect(result.headers.get("vary")).toBe("Cookie, Origin");
  expect(result.headers.get("referrer-policy")).toBe("no-referrer");
  expect(result.headers.get("location")).toBeNull();
}
beforeEach(() => {
  vi.stubEnv("NODE_ENV", "production"); vi.stubEnv("NEXT_PUBLIC_API_URL", "https://api.example.test");
  vi.stubEnv("NEXT_PUBLIC_SITE_URL", ORIGIN); vi.stubEnv("RAILWAY_ENVIRONMENT_NAME", "staging");
  fetchApi.mockReset(); vi.stubGlobal("fetch", fetchApi);
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe.each(endpoints)("private handoff BFF %s", endpoint => {
  it("validates both identities, schema and transport without forwarding secrets or headers", async () => {
    fetchApi.mockResolvedValue(Response.json(response(endpoint), { headers: { "Set-Cookie": "leak=yes", "Location": "https://other.test", "X-Secret": TOKEN } }));
    const result = await run(endpoint, request(endpoint, { headers: { Authorization: "Bearer injected" } }));
    expect(result.status).toBe(200); expect(await result.json()).toEqual(response(endpoint)); expectPrivate(result);
    expect(result.headers.get("set-cookie")).toBeNull(); expect(result.headers.get("x-secret")).toBeNull();
    const [url, init] = fetchApi.mock.calls[0]!;
    expect(url).toBe(`https://api.example.test/delivery-access/missions/${ID}/handoff${endpoint === "state" ? "" : `/${endpoint}`}`);
    expect(init).toMatchObject({ method: method(endpoint), cache: "no-store", redirect: "error" });
    expect(init?.headers).toEqual({ Accept: "application/json", Authorization: `Bearer ${TOKEN}`, ...(endpoint === "state" ? {} : { "Content-Type": "application/json" }) });
    expect(init?.body).toBe(endpoint === "state" ? undefined : JSON.stringify(body(endpoint)));
  });
  it.each([null, "__Secure-sm_delivery_access=bad", `${COOKIE}; ${COOKIE}`])("rejects missing or ambiguous cookie before upstream", async cookie => {
    const result = await run(endpoint, request(endpoint, { cookie }));
    expect(result.status).toBe(401); expectPrivate(result); expect(fetchApi).not.toHaveBeenCalled();
  });
  it("rejects foreign origin before any upstream call", async () => {
    const result = await run(endpoint, request(endpoint, { origin: "https://attacker.test" }));
    expect(result.status).toBe(403); expectPrivate(result); expect(fetchApi).not.toHaveBeenCalled();
  });
  it.each(["?secret=yes", "?t=x&t=y", "/extra", "/../override"])("rejects path/query pollution %s", async suffix => {
    const result = await run(endpoint, request(endpoint, { url: ORIGIN + path(endpoint) + suffix }));
    expect(result.status).toBe(400); expect(fetchApi).not.toHaveBeenCalled();
  });
  it.each([401, 403, 404, 409, 429, 503])("sanitizes upstream %s without clearing a valid session except 401", async status => {
    fetchApi.mockResolvedValue(Response.json({ pin: "001234", sealed: TOKEN, message: "RAW_INTERNAL_SECRET" }, { status }));
    const result = await run(endpoint, request(endpoint));
    expect(result.status).toBe(status); expectPrivate(result);
    const text = await result.text(); expect(text).not.toContain("001234"); expect(text).not.toContain(TOKEN); expect(text).not.toContain("RAW_INTERNAL_SECRET");
    if (status === 401) expect(result.headers.get("set-cookie")).toContain("Max-Age=0");
    else expect(result.headers.get("set-cookie")).toBeNull();
  });
  it("rejects extra customer fields even on a 200 upstream response", async () => {
    fetchApi.mockResolvedValue(Response.json({ ...response(endpoint), pin: "001234" }));
    const result = await run(endpoint, request(endpoint));
    expect(result.status).toBe(503); expect(await result.text()).not.toContain("001234");
  });
  it("rejects a view for another mission and an accidentally privileged courier view", async () => {
    for (const changed of [{ ...state, missionId: OTHER }, { ...state, canOverride: true }, { ...state, canRotate: true }]) {
      fetchApi.mockResolvedValue(Response.json(endpoint === "state" ? changed : { ...response(endpoint), state: changed }));
      expect((await run(endpoint, request(endpoint))).status).toBe(503);
    }
  });
  it("never treats network failure/redirect as a successful handoff", async () => {
    fetchApi.mockRejectedValueOnce(new Error("RAW_INTERNAL_SECRET"));
    const first = await run(endpoint, request(endpoint));
    expect(first.status).toBe(503); expect(await first.text()).not.toContain("RAW_INTERNAL_SECRET");
    fetchApi.mockResolvedValueOnce(new Response(null, { status: 302, headers: { Location: "https://other.test" } }));
    expect((await run(endpoint, request(endpoint))).status).toBe(503);
  });
});
describe.each(["confirm", "incident", "resolve"] as const)("handoff mutation %s", endpoint => {
  it("requires origin and JSON content type", async () => {
    expect((await run(endpoint, request(endpoint, { origin: null }))).status).toBe(403);
    expect((await run(endpoint, request(endpoint, { headers: { "Content-Type": "text/plain" } }))).status).toBe(415);
    expect(fetchApi).not.toHaveBeenCalled();
  });
  it("rejects oversized/unknown fields before upstream", async () => {
    for (const value of [{ ...body(endpoint), actorId: OTHER }, { ...body(endpoint), arbitrary: "x".repeat(1_100) }]) {
      expect((await run(endpoint, request(endpoint, { body: value }))).status).toBe(400);
    }
    expect(fetchApi).not.toHaveBeenCalled();
  });
  it("correlates operation, action and monotone receipt revisions", async () => {
    for (const patch of [{ operationId: "22222222-2222-4222-8222-222222222222" }, { action: "rotate" },
      { missionId: OTHER }, { appliedRevision: 3 }, { state: { ...state, revision: 3 } }]) {
      fetchApi.mockResolvedValue(Response.json({ ...response(endpoint), ...patch }));
      expect((await run(endpoint, request(endpoint))).status).toBe(503);
    }
  });
});
it.each(["rotate", "override"])("does not expose manager action %s through courier BFF", async action => {
  const result = await POST(request("confirm", { url: `${ORIGIN}/livreur/missions/${ID}/handoff/${action}` }), { params: Promise.resolve({ id: ID, action }) });
  expect(result.status).toBe(400);
  const recover = await run("resolve", request("resolve", { body: { ...operation, action } }));
  expect(recover.status).toBe(400); expect(fetchApi).not.toHaveBeenCalled();
});
it("accepts a terminal minimal receipt after a lost response, without reopening customer details", async () => {
  const terminal = { ...response("resolve"), state: { ...state, orderStatus: "delivered" }, replay: true };
  fetchApi.mockResolvedValue(Response.json(terminal));
  const result = await run("resolve", request("resolve"));
  expect(result.status).toBe(200); expect(await result.json()).toEqual(terminal); expectPrivate(result);
});
