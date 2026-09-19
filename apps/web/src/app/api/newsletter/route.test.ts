import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";

const EMAIL = "marqueur.newsletter@example.invalid";
const INPUT = { email: EMAIL, consent: true, newsletterWebsite: "" };
const TOKEN = "fixture-ingestion-token";
const fetchApi = vi.fn<typeof fetch>();

function request(body: unknown = INPUT, headers: Record<string, string> = {}) {
  return new NextRequest("https://snackmanager.test/api/newsletter", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "https://snackmanager.test", "Sec-Fetch-Site": "same-origin", ...headers },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://snackmanager.test");
  vi.stubEnv("API_URL", "https://api.snackmanager.test/");
  vi.stubEnv("SM_CONTACT_INGEST_TOKEN", TOKEN);
  vi.stubGlobal("fetch", fetchApi);
  fetchApi.mockReset();
  fetchApi.mockResolvedValue(Response.json({ ok: true, pending: true }, { status: 202 }));
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("POST /api/newsletter", () => {
  it("transmet uniquement le contrat consenti avec le secret serveur et annonce une attente", async () => {
    const timeout = vi.spyOn(AbortSignal, "timeout");
    const result = await POST(request({ ...INPUT, email: "  MARQUEUR.NEWSLETTER@EXAMPLE.INVALID  " }, {
      Authorization: "Bearer browser-secret", Cookie: "private=browser-value", "X-Forwarded-For": "203.0.113.10",
    }));

    expect(result.status).toBe(202);
    expect(await result.json()).toEqual({ ok: true, pending: true });
    expect(result.headers.get("cache-control")).toContain("no-store");
    expect(result.headers.get("set-cookie")).toBeNull();
    expect(fetchApi).toHaveBeenCalledOnce();
    expect(fetchApi).toHaveBeenCalledWith("https://api.snackmanager.test/public/newsletter", expect.objectContaining({
      method: "POST", redirect: "error", cache: "no-store",
      headers: { Accept: "application/json", "Content-Type": "application/json", Authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({ email: EMAIL, consent: true, source: "site-vitrine" }),
      signal: expect.any(AbortSignal),
    }));
    expect(timeout).toHaveBeenCalledWith(15000);
  });

  it.each([
    { Origin: "https://attacker.test" },
    { Origin: "" },
    { "Sec-Fetch-Site": "cross-site" },
    { "Sec-Fetch-Site": "same-site" },
    { "X-Forwarded-Host": "attacker.test", "X-Forwarded-Proto": "https", Origin: "https://attacker.test" },
    { "X-Forwarded-Host": "snackmanager.test" },
  ] as Record<string, string>[])("refuse une origine absente, étrangère ou ambiguë avant tout envoi (%j)", async (headers) => {
    const result = await POST(request(INPUT, headers));
    expect(result.status).toBe(403);
    expect(fetchApi).not.toHaveBeenCalled();
  });

  it("accepte le proxy HTTPS configuré, sans faire confiance à un hôte arbitraire", async () => {
    const result = await POST(request(INPUT, { "X-Forwarded-Host": "snackmanager.test", "X-Forwarded-Proto": "https" }));
    expect(result.status).toBe(202);
  });

  it.each([
    { email: EMAIL, consent: false },
    { email: EMAIL, consent: "true" },
    { email: EMAIL },
    { ...INPUT, email: "pas-une-adresse" },
    { ...INPUT, email: `${"a".repeat(250)}@example.invalid` },
    { ...INPUT, newsletterWebsite: "robot.example" },
    { ...INPUT, source: "other" },
    { ...INPUT, redirectUrl: "https://attacker.test" },
    [INPUT],
    null,
  ])("refuse le consentement absent et les corps invalides sans appel API (%j)", async (body) => {
    const result = await POST(request(body));
    expect(result.status).toBe(400);
    expect(fetchApi).not.toHaveBeenCalled();
  });

  it("refuse les formats autres que JSON", async () => {
    expect((await POST(request(INPUT, { "Content-Type": "text/plain" }))).status).toBe(415);
    expect(fetchApi).not.toHaveBeenCalled();
  });

  it.each(["invalid", "2048"])("borne aussi Content-Length déclaré : %s", async (size) => {
    expect((await POST(request(INPUT, { "Content-Length": size }))).status).toBe(400);
    expect(fetchApi).not.toHaveBeenCalled();
  });

  it("borne les octets réellement lus même avec une taille déclarée mensongère", async () => {
    const result = await POST(request({ ...INPUT, newsletterWebsite: "界".repeat(400) }, { "Content-Length": "100" }));
    expect(result.status).toBe(400);
    expect(fetchApi).not.toHaveBeenCalled();
  });

  it("refuse un document JSON tronqué", async () => {
    const result = await POST(new NextRequest("https://snackmanager.test/api/newsletter", {
      method: "POST", headers: { Origin: "https://snackmanager.test", "Content-Type": "application/json" }, body: "{",
    }));
    expect(result.status).toBe(400);
    expect(fetchApi).not.toHaveBeenCalled();
  });

  it.each(["SM_CONTACT_INGEST_TOKEN", "API_URL"])("échoue fermé si %s manque", async (setting) => {
    vi.stubEnv(setting, "");
    if (setting === "API_URL") vi.stubEnv("NEXT_PUBLIC_API_URL", "");
    const result = await POST(request());
    expect(result.status).toBe(503);
    expect(fetchApi).not.toHaveBeenCalled();
  });

  it("préserve un refus de quota sans divulguer les détails du fournisseur", async () => {
    fetchApi.mockResolvedValue(Response.json({ secret: EMAIL }, { status: 429, headers: { "Retry-After": "999", "Set-Cookie": "secret=x" } }));
    const result = await POST(request());
    expect(result.status).toBe(429);
    expect(result.headers.get("retry-after")).toBe("300");
    expect(result.headers.get("set-cookie")).toBeNull();
    expect(await result.text()).not.toContain(EMAIL);
  });

  it.each([200, 201, 204, 401, 403, 404, 500, 503])("ne transforme pas HTTP %i en inscription acceptée", async (status) => {
    fetchApi.mockResolvedValue(new Response(status === 204 ? null : JSON.stringify({ ok: true, pending: true, email: EMAIL }), { status }));
    const result = await POST(request());
    expect(result.status).toBe(503);
    expect(await result.text()).not.toContain(EMAIL);
  });

  it.each([{}, { ok: true }, { ok: true, pending: false }, { ok: true, pending: true, email: EMAIL }])("exige l’accusé exact même après HTTP 202 (%j)", async (body) => {
    fetchApi.mockResolvedValue(Response.json(body, { status: 202 }));
    expect((await POST(request())).status).toBe(503);
  });

  it.each([new Error(`network ${EMAIL}`), new DOMException(`timeout ${EMAIL}`, "TimeoutError")])("n’expose ni ne journalise de PII lors d’un échec réseau", async (failure) => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    fetchApi.mockRejectedValue(failure);
    const result = await POST(request());
    expect(result.status).toBe(503);
    expect(await result.text()).not.toContain(EMAIL);
    expect(JSON.stringify([...warn.mock.calls, ...error.mock.calls])).not.toContain(EMAIL);
  });
});
