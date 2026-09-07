import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { DELETE, GET, POST } from "./route";

const INVITATION = "I".repeat(43);
const NONCE = "N".repeat(43);
const SESSION_TOKEN = "S".repeat(43);
const NOW = new Date("2026-09-07T10:00:00Z");
const SESSION = { operatorId: "507f1f77bcf86cd799439011", name: "Maya", restaurantName: "Restaurant de test",
  restaurantSlug: "restaurant-test", expiresAt: "2026-09-14T10:00:00Z" };
const fetchApi = vi.fn();

function request(method: "GET" | "POST" | "DELETE", options: {
  body?: unknown; rawBody?: string; origin?: string | null; cookie?: string; headers?: Record<string, string>; url?: string;
} = {}) {
  const headers = new Headers({ "Content-Type": "application/json", "Sec-Fetch-Site": "same-origin", ...options.headers });
  if (options.origin !== null) headers.set("Origin", options.origin ?? "https://staging.snackmanager.fr");
  if (options.cookie) headers.set("Cookie", options.cookie);
  return new NextRequest(options.url ?? "https://staging.snackmanager.fr/livreur/acces", {
    method, headers, ...(method === "POST" ? { body: options.rawBody ?? JSON.stringify(options.body ?? { token: INVITATION, nonce: NONCE }) } : {}),
  });
}

beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(NOW);
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("NEXT_PUBLIC_API_URL", "https://api.example.test");
  vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://staging.snackmanager.fr");
  vi.stubEnv("RAILWAY_ENVIRONMENT_NAME", "staging");
  fetchApi.mockReset(); vi.stubGlobal("fetch", fetchApi);
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("BFF de l’accès livreur", () => {
  it("place uniquement la session opaque dans un cookie HttpOnly limité et rend l’identité publique", async () => {
    fetchApi.mockResolvedValue(Response.json({ token: SESSION_TOKEN, session: SESSION }));
    const result = await POST(request("POST"));
    expect(result.status).toBe(200);
    expect(await result.json()).toEqual(SESSION);
    const cookie = result.headers.get("set-cookie")!;
    for (const value of [`__Secure-sm_delivery_access=${SESSION_TOKEN}`, "HttpOnly", "Secure", "SameSite=strict", "Path=/livreur", "Max-Age=604800"]) expect(cookie).toContain(value);
    expect(cookie).not.toContain("Domain=");
    expect(cookie).not.toContain(INVITATION);
    expect(result.headers.get("cache-control")).toContain("no-store");
    expect(fetchApi).toHaveBeenCalledWith("https://api.example.test/delivery-access/exchange", expect.objectContaining({
      method: "POST", body: JSON.stringify({ token: INVITATION, nonce: NONCE }), cache: "no-store", redirect: "error",
    }));
  });

  it.each([null, "null", "https://attacker.example", "https://staging.snackmanager.fr/path", "https://user@staging.snackmanager.fr"])("refuse une origine d’écriture invalide : %s", async origin => {
    for (const method of ["POST", "DELETE"] as const) expect((await (method === "POST" ? POST : DELETE)(request(method, { origin }))).status).toBe(403);
    expect(fetchApi).not.toHaveBeenCalled();
  });

  it.each(["cross-site", "same-site"])("refuse également Fetch Metadata %s", async site => {
    expect((await POST(request("POST", { headers: { "Sec-Fetch-Site": site } }))).status).toBe(403);
    expect((await GET(request("GET", { headers: { "Sec-Fetch-Site": site } }))).status).toBe(403);
    expect(fetchApi).not.toHaveBeenCalled();
  });

  it("reconnaît l’origine publique Railway et ferme les forwarded partiels ou multiples", async () => {
    fetchApi.mockResolvedValue(Response.json({ token: SESSION_TOKEN, session: SESSION }));
    const headers = { "X-Forwarded-Host": "staging.snackmanager.fr", "X-Forwarded-Proto": "https" };
    expect((await POST(request("POST", { url: "http://localhost:8080/livreur/acces", headers }))).status).toBe(200);
    expect((await POST(request("POST", { headers: { "X-Forwarded-Host": "staging.snackmanager.fr" } }))).status).toBe(403);
    expect((await POST(request("POST", { headers: { ...headers, "X-Forwarded-Host": "staging.snackmanager.fr,evil.example" } }))).status).toBe(403);
  });

  it("refuse Origin et forwarded forgés ensemble vers un hôte non configuré", async () => {
    const incoming = request("POST", { origin: "https://attacker.example", url: "http://localhost:8080/livreur/acces",
      headers: { "X-Forwarded-Host": "attacker.example", "X-Forwarded-Proto": "https" } });
    expect((await POST(incoming)).status).toBe(403);
    expect(fetchApi).not.toHaveBeenCalled();
  });

  it("autorise également le domaine Railway exact du staging", async () => {
    fetchApi.mockResolvedValue(Response.json({ token: SESSION_TOKEN, session: SESSION }));
    expect((await POST(request("POST", { origin: "https://web-staging-6f5f.up.railway.app",
      url: "http://localhost:8080/livreur/acces", headers: {
        "X-Forwarded-Host": "web-staging-6f5f.up.railway.app", "X-Forwarded-Proto": "https",
      } }))).status).toBe(200);
  });

  it("garde l’hôte navigateur local malgré la normalisation NextURL en localhost", async () => {
    vi.stubEnv("NODE_ENV", "test");
    fetchApi.mockResolvedValue(Response.json({ token: SESSION_TOKEN, session: SESSION }));
    const incoming = request("POST", { origin: "http://127.0.0.1:3218", url: "http://127.0.0.1:3218/livreur/acces",
      headers: { Host: "127.0.0.1:3218" } });
    expect(incoming.nextUrl.hostname).toBe("localhost");
    expect((await POST(incoming)).status).toBe(200);
  });

  it.each([
    { token: INVITATION }, { token: INVITATION, nonce: "weak" }, { token: INVITATION, nonce: NONCE, tenantId: "injected" },
  ])("refuse le corps invalide avant l’API", async body => {
    expect((await POST(request("POST", { body }))).status).toBe(400);
    expect(fetchApi).not.toHaveBeenCalled();
  });

  it("borne le corps réellement lu et refuse les formulaires", async () => {
    expect((await POST(request("POST", { rawBody: "x".repeat(1_025) }))).status).toBe(400);
    expect((await POST(request("POST", { headers: { "Content-Type": "text/plain" } }))).status).toBe(415);
    expect(fetchApi).not.toHaveBeenCalled();
  });

  it("lit la session du cookie sans transmettre cookies ou Authorization reçus à l’API", async () => {
    fetchApi.mockResolvedValue(Response.json(SESSION));
    const result = await GET(request("GET", { origin: null, cookie: `other=private; __Secure-sm_delivery_access=${SESSION_TOKEN}`,
      headers: { Authorization: "Bearer injected" } }));
    expect(await result.json()).toEqual(SESSION);
    expect(result.headers.get("set-cookie")).toBeNull();
    expect(fetchApi).toHaveBeenCalledWith("https://api.example.test/delivery-access/session", expect.objectContaining({
      headers: { Accept: "application/json", Authorization: `Bearer ${SESSION_TOKEN}` },
    }));
  });

  it("ne contacte pas l’API en l’absence de cookie, ou pour une identité ambiguë", async () => {
    for (const cookie of [undefined, "__Secure-sm_delivery_access=invalid", `__Secure-sm_delivery_access=${SESSION_TOKEN}; __Secure-sm_delivery_access=${INVITATION}`]) {
      expect((await GET(request("GET", { cookie }))).status).toBe(204);
    }
    expect(fetchApi).not.toHaveBeenCalled();
  });

  it("retire le cookie après révocation mais le conserve sur indisponibilité", async () => {
    const cookie = `__Secure-sm_delivery_access=${SESSION_TOKEN}`;
    fetchApi.mockResolvedValueOnce(new Response(null, { status: 401 })).mockRejectedValueOnce(new Error(`internal ${SESSION_TOKEN}`));
    const revoked = await GET(request("GET", { cookie }));
    expect(revoked.status).toBe(401); expect(revoked.headers.get("set-cookie")).toContain("Max-Age=0");
    const unavailable = await GET(request("GET", { cookie }));
    expect(unavailable.status).toBe(503); expect(unavailable.headers.get("set-cookie")).toBeNull();
    expect(await unavailable.text()).not.toContain(SESSION_TOKEN);
  });

  it("ne prolonge pas l’expiration renvoyée lors d’une reprise", async () => {
    fetchApi.mockResolvedValue(Response.json({ token: SESSION_TOKEN, session: { ...SESSION, expiresAt: "2026-09-07T11:00:00Z" } }));
    expect((await POST(request("POST"))).headers.get("set-cookie")).toContain("Max-Age=3600");
  });

  it.each([
    { token: SESSION_TOKEN, session: { ...SESSION, extraSecret: INVITATION } },
    { token: "invalid", session: SESSION },
    { token: SESSION_TOKEN, session: { ...SESSION, expiresAt: "2026-09-07T09:00:00Z" } },
    { token: SESSION_TOKEN, session: SESSION, internal: INVITATION },
  ])("ne pose aucun cookie sur une réponse amont non conforme", async body => {
    fetchApi.mockResolvedValue(Response.json(body));
    const result = await POST(request("POST"));
    expect(result.status).toBe(503); expect(result.headers.get("set-cookie")).toBeNull();
    expect(await result.text()).not.toContain(INVITATION);
  });

  it.each([429, 503, 302])("préserve la reprise sur HTTP %s sans relayer la réponse amont", async status => {
    fetchApi.mockResolvedValue(Response.json({ token: SESSION_TOKEN, message: INVITATION }, { status }));
    const result = await POST(request("POST"));
    expect(result.status).toBe(status === 429 ? 429 : 503);
    expect(result.headers.get("set-cookie")).toBeNull();
    const body = await result.text(); expect(body).not.toContain(INVITATION); expect(body).not.toContain(SESSION_TOKEN);
  });

  it("confirme la déconnexion après révocation API ; une réponse perdue reste à reprendre", async () => {
    const cookie = `__Secure-sm_delivery_access=${SESSION_TOKEN}`;
    fetchApi.mockRejectedValueOnce(new Error("network")).mockResolvedValueOnce(new Response(null, { status: 204 }));
    const unknown = await DELETE(request("DELETE", { cookie }));
    expect(unknown.status).toBe(503); expect(unknown.headers.get("set-cookie")).toBeNull();
    const done = await DELETE(request("DELETE", { cookie }));
    expect(done.status).toBe(204); expect(done.headers.get("set-cookie")).toContain("Max-Age=0");
    expect(fetchApi).toHaveBeenLastCalledWith("https://api.example.test/delivery-access/logout", expect.objectContaining({ method: "POST" }));
  });
});
