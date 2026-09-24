import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { getRedirectUrl, getRewrittenUrl, unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
import { config, proxy } from "./proxy";

vi.mock("@/lib/site", () => ({ SITE_URL: "https://snackmanager.fr" }));

function request(pathname: string, host = "snackmanager.fr") {
  return new NextRequest(`https://${host}${pathname}`, { headers: { host } });
}

beforeEach(() => {
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("RAILWAY_ENVIRONMENT_NAME", "production");
  vi.stubEnv("VERCEL_ENV", undefined);
  vi.stubEnv("SM_ENV", undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("indexabilité des réponses du proxy", () => {
  it.each(["/admin", "/admin/", "/admin/login", "/admin/dashboard?demo=1", "/sm", "/sm/login",
    "/board", "/board/display", "/api/contact", "/embed/classfood", "/t/order-123", "/r/demo",
    "/r/demo/fidelite", "/newsletter/confirmation"])("exclut la surface interne %s", async (path) => {
    const response = await proxy(request(path));
    expect(response.headers.get("X-Robots-Tag")).toBe("noindex, nofollow");
    expect(response.headers.get("X-Frame-Options")).toBe(path.startsWith("/embed/") ? null : "SAMEORIGIN");
  });

  it.each(["/", "/blog", "/blog/la-redaction", "/offres", "/r/classfood", "/r/demonstration", "/administer"])(
    "conserve l’indexabilité publique et les frontières de chemin : %s", async (path) => {
      expect((await proxy(request(path))).headers.get("X-Robots-Tag")).toBeNull();
    },
  );

  it.each(["web-staging-6f5f.up.railway.app", "web-production-99b58c.up.railway.app", "branch.vercel.app",
    "localhost:3000", "hq.snackmanager.fr"])("exclut l’alias ou l’hôte non public %s", async (host) => {
    const response = await proxy(request("/blog", host));
    expect(response.headers.get("X-Robots-Tag")).toBe("noindex, nofollow");
  });

  it.each(["RAILWAY_ENVIRONMENT_NAME", "VERCEL_ENV", "SM_ENV"])(
    "honore %s même si NODE_ENV et l’hôte ressemblent à la production", async (key) => {
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv(key, "staging");
      expect((await proxy(request("/blog"))).headers.get("X-Robots-Tag")).toBe("noindex, nofollow");
    },
  );

  it("exclut aussi un serveur de développement derrière le nom public", async () => {
    vi.stubEnv("NODE_ENV", "development");
    expect((await proxy(request("/blog"))).headers.get("X-Robots-Tag")).toBe("noindex, nofollow");
  });

  it("préserve la réécriture et l’indexabilité d’un domaine client en production", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ slug: "classfood" })));
    const response = await proxy(request("/", "commander.seo-restaurant.example"));
    expect(getRewrittenUrl(response)).toBe("https://commander.seo-restaurant.example/r/classfood");
    expect(response.headers.get("x-sm-tenant")).toBe("classfood");
    expect(response.headers.get("X-Robots-Tag")).toBeNull();
  });

  it("exclut aussi un domaine client servi par un environnement staging", async () => {
    vi.stubEnv("RAILWAY_ENVIRONMENT_NAME", "staging");
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ slug: "classfood" })));
    const response = await proxy(request("/", "commander.seo-staging.example"));
    expect(getRewrittenUrl(response)).toBe("https://commander.seo-staging.example/r/classfood");
    expect(response.headers.get("X-Robots-Tag")).toBe("noindex, nofollow");
  });

  it("conserve les refus et redirections du domaine client", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ slug: "classfood" })));
    const response = await proxy(request("/admin", "commander.seo-refus.example"));
    expect(response.status).toBe(308);
    expect(getRedirectUrl(response)).toBe("https://commander.seo-refus.example/");
    expect(response.headers.get("X-Robots-Tag")).toBe("noindex, nofollow");

    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 404 })));
    const unknown = await proxy(request("/", "commander.seo-unknown.example"));
    expect(unknown.status).toBe(404);
    expect(unknown.headers.get("Cache-Control")).toBe("no-store");
  });

  it("ne transporte pas le noindex d’une requête de preview vers la production", async () => {
    const preview = await proxy(request("/blog", "blog-preview.vercel.app"));
    const production = await proxy(request("/blog"));
    expect(preview.headers.get("X-Robots-Tag")).toBe("noindex, nofollow");
    expect(production.headers.get("X-Robots-Tag")).toBeNull();
    expect(production.headers.get("Cache-Control")).toBeNull();
  });

  it("couvre robots, sitemap et chemins internes, sans toucher aux actifs Next", () => {
    for (const pathname of ["/admin", "/sm", "/robots.txt", "/sitemap.xml", "/blog"]) {
      expect(unstable_doesMiddlewareMatch({ config, nextConfig: {}, url: `https://snackmanager.fr${pathname}` })).toBe(true);
    }
    expect(unstable_doesMiddlewareMatch({ config, nextConfig: {}, url: "https://snackmanager.fr/_next/static/chunk.js" })).toBe(false);
  });
});
