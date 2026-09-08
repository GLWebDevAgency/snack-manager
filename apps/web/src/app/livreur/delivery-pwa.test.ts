import { readFileSync } from "node:fs";
import { Script } from "node:vm";
import { describe, expect, it, vi } from "vitest";
import { GET as manifest } from "./manifest.webmanifest/route";
import { GET as worker } from "./sw.js/route";

describe("SM Livreur — identité installable indépendante", () => {
  it("ouvre la bonne application sans invitation, tenant ni données privées", async () => {
    const response = manifest();
    expect(response.headers.get("Content-Type")).toBe("application/manifest+json");
    expect(response.headers.get("Cache-Control")).toContain("max-age=0");
    const body = await response.json();
    expect(body).toMatchObject({ id: "/livreur", name: "SM Livreur", short_name: "SM Livreur",
      start_url: "/livreur", scope: "/livreur", display: "standalone", lang: "fr" });
    expect(body.icons).toEqual(expect.arrayContaining([
      expect.objectContaining({ sizes: "192x192", purpose: "any" }),
      expect.objectContaining({ sizes: "512x512", purpose: "any" }),
      expect.objectContaining({ sizes: "512x512", purpose: "maskable" }),
    ]));
    for (const icon of body.icons) {
      expect(icon.src).toMatch(/^\/icons\/[a-z0-9-]+\.png$/);
      expect(readFileSync(new URL(`../../../public${icon.src}`, import.meta.url)).byteLength).toBeGreaterThan(100);
    }
    expect(JSON.stringify(body)).not.toMatch(/invitation|token|operatorId|restaurantSlug/);
  });

  it("remplace le manifeste vitrine uniquement pour le livreur", () => {
    const page = readFileSync(new URL("./page.tsx", import.meta.url), "utf8");
    expect(page).toContain('manifest: "/livreur/manifest.webmanifest"');
    expect(page).toContain('title: "SM Livreur"');
    expect(page).toContain('appleWebApp: { capable: true, title: "SM Livreur"');
    expect(readFileSync(new URL("../../lib/platform-manifest.ts", import.meta.url), "utf8"))
      .toContain('display: "browser"');
  });
});

async function workerHarness(fetcher = vi.fn<typeof fetch>()) {
  const response = worker();
  const source = await response.text();
  const handlers = new Map<string, (event: Record<string, unknown>) => void>();
  const forbidden = vi.fn(() => { throw new Error("No private cache or replay"); });
  const self = { location: new URL("https://web.test/livreur/sw.js"),
    addEventListener: (name: string, handler: (event: Record<string, unknown>) => void) => handlers.set(name, handler),
    skipWaiting: vi.fn(async () => undefined), clients: { claim: vi.fn(async () => undefined) } };
  new Script(source, { filename: "/livreur/sw.js" }).runInNewContext({
    self, fetch: fetcher, Response, URL, caches: { open: forbidden, match: forbidden, delete: forbidden },
    indexedDB: { open: forbidden },
  }, { timeout: 1_000 });
  function navigate(path: string, method = "GET", mode = "navigate") {
    const respondWith = vi.fn();
    const request = { url: new URL(path, self.location).href, method, mode };
    handlers.get("fetch")!({ request, respondWith });
    return { respondWith, request };
  }
  return { response, source, handlers, forbidden, self, navigate };
}

describe("SM Livreur — repli réseau sans données privées", () => {
  it("sert un worker borné à /livreur et revalidé", async () => {
    const { response, handlers, forbidden } = await workerHarness();
    expect(response.headers.get("Service-Worker-Allowed")).toBe("/livreur");
    expect(response.headers.get("Cache-Control")).toContain("no-store");
    expect(response.headers.get("Content-Type")).toContain("javascript");
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect([...handlers.keys()].sort()).toEqual(["activate", "fetch", "install"]);
    expect(forbidden).not.toHaveBeenCalled();
  });

  it.each(["/livreur/acces", "/livreur/missions", "/livreur/missions/123/handoff", "/livreur/autre",
    "/livreur-secret", "/admin", "/r/classfood", "/_next/static/app.js", "https://other.test/livreur"])
  ("ne traite ni ne mémorise %s", async (path) => {
    const { navigate, forbidden } = await workerHarness();
    expect(navigate(path).respondWith).not.toHaveBeenCalled();
    expect(forbidden).not.toHaveBeenCalled();
  });

  it.each([["POST", "navigate"], ["GET", "cors"], ["DELETE", "same-origin"]])
  ("ne traite pas %s en mode %s", async (method, mode) => {
    const { navigate } = await workerHarness();
    expect(navigate("/livreur", method, mode).respondWith).not.toHaveBeenCalled();
  });

  it.each(["/livreur", "/livreur/"])("conserve la réponse serveur de %s sans cache", async (path) => {
    const expected = new Response("server unavailable", { status: 503 });
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(expected);
    const { navigate, forbidden } = await workerHarness(fetcher);
    const { respondWith, request } = navigate(path);
    expect(await respondWith.mock.calls[0]![0]).toBe(expected);
    expect(fetcher).toHaveBeenCalledExactlyOnceWith(request);
    expect(forbidden).not.toHaveBeenCalled();
  });

  it("affiche un écran hors réseau autonome, pas d'anciennes missions ou de faux succès", async () => {
    const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new TypeError("offline"));
    const { navigate, forbidden } = await workerHarness(fetcher);
    const { respondWith } = navigate("/livreur");
    const response: Response = await respondWith.mock.calls[0]![0];
    const html = await response.text();
    expect(response.headers.get("Cache-Control")).toContain("no-store");
    expect(response.headers.get("Content-Security-Policy")).toContain("script-src 'none'");
    expect(html).toContain("SM Livreur");
    expect(html).toContain("Connexion nécessaire");
    expect(html).toContain('href="/livreur"');
    expect(html).not.toMatch(/<script|<img|<iframe|operatorId|customerName|trackingToken/);
    expect(forbidden).not.toHaveBeenCalled();
  });
});
