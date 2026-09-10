import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest, type NextResponse } from "next/server";
import {
  getRedirectUrl,
  getRewrittenUrl,
  isRewrite,
  unstable_doesMiddlewareMatch,
} from "next/experimental/testing/server";
import { config, proxy } from "./proxy";

const SELF = "frame-ancestors 'self'";

function request(pathname: string, host = "snackmanager.fr", headers?: HeadersInit) {
  return new NextRequest(`https://${host}${pathname}`, {
    headers: { host, ...Object.fromEntries(new Headers(headers)) },
  });
}

function expectSameOrigin(response: NextResponse) {
  expect(response.headers.get("Content-Security-Policy")).toBe(SELF);
  expect(response.headers.get("X-Frame-Options")).toBe("SAMEORIGIN");
}

function expectEmbeddable(response: NextResponse) {
  expect(response.headers.get("Content-Security-Policy")).toBe("frame-ancestors *");
  expect(response.headers.get("X-Frame-Options")).toBeNull();
}

function resolvesTo(slug: string) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json({ slug }, { status: 200 })),
  );
}

afterEach(() => vi.unstubAllGlobals());

describe("routes privées compte client sur domaine restaurant", () => {
  it.each(['capacites', 'navigateur', 'intention', 'verification', 'confirmation', 'resultat', 'protection', 'cle-acces', 'secours', 'session', 'profil', 'commandes', 'commandes/recherche', 'commandes/detail'])(
    'autorise uniquement le point d’entrée exact %s du restaurant', async action => {
      resolvesTo('classfood');
      const response = await proxy(request(`/r/classfood/compte/${action}`, `compte-${action.replaceAll('/', '-')}.example`, { 'sec-fetch-mode': 'cors' }));
      expect(response.status).toBe(200);
      expect(isRewrite(response)).toBe(false);
      expectSameOrigin(response);
    });
  it.each(['/r/concurrent/compte/session', '/r/classfood/compte', '/r/classfood/compte/session/nested',
    '/r/classfood/compte/admin', '/r/classfood/compte/session/', '/r/classfood/compte/SESSION', '/api/customer/session',
    '/r/classfood/compte/commandes/export', '/r/classfood/compte/commandes/detail/nested', '/r/concurrent/compte/commandes/recherche'])(
    'ne crée aucune exception large : %s', async path => {
      resolvesTo('classfood');
      expect((await proxy(request(path, 'compte-denied.example', { 'sec-fetch-mode': 'cors' }))).status).toBe(404);
    });
});

describe("politique anti-cadrage", () => {
  it.each(["/admin/menu", "/admin/login", "/sm", "/sm/login"])(
    "protège la surface authentifiée %s",
    async (pathname) => expectSameOrigin(await proxy(request(pathname))),
  );

  it.each(["/admin/dashboard?demo=1", "/r/demo?demo=1"])(
    "conserve la démonstration de même origine %s",
    async (pathname) => expectSameOrigin(await proxy(request(pathname))),
  );

  it.each(["/embed/classfood", "/embed/classfood/", "/embed/inconnu"])(
    "laisse l’embed public %s vivre sur un site tiers",
    async (pathname) => expectEmbeddable(await proxy(request(pathname))),
  );

  it.each(["/embed", "/embed/classfood/nested"])(
    "n’élargit pas l’exception à %s",
    async (pathname) => expectSameOrigin(await proxy(request(pathname))),
  );

  it("préserve l’embarquement et le cache du chargeur", async () => {
    const response = await proxy(request("/w.js?cache-bust=1"));
    expectEmbeddable(response);
    expect(response.headers.get("Cache-Control")).toBe(
      "public, max-age=300, s-maxage=3600, stale-while-revalidate=86400",
    );
  });

  it("ne met jamais en cache le 404 temporaire du widget d’un hôte inconnu", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 404 })));
    const response = await proxy(request("/w.js", "widget-en-activation.example"));
    expect(response.status).toBe(404);
    expectEmbeddable(response);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it("décore aussi la réécriture d’un domaine restaurant", async () => {
    resolvesTo("classfood");
    const response = await proxy(request("/", "commande-classfood.example"));
    expect(isRewrite(response)).toBe(true);
    expect(getRewrittenUrl(response)).toBe("https://commande-classfood.example/r/classfood");
    expect(response.headers.get("x-sm-tenant")).toBe("classfood");
    expectSameOrigin(response);
  });

  it("décore aussi la redirection d’une route interdite au domaine restaurant", async () => {
    resolvesTo("classfood");
    const response = await proxy(
      request("/admin", "commande-redirection.example", { "sec-fetch-mode": "navigate" }),
    );
    expect(response.status).toBe(308);
    expect(getRedirectUrl(response)).toBe("https://commande-redirection.example/");
    expectSameOrigin(response);
  });

  it.each(["carte", "recherche", "commandes", "sw.js", "manifest.webmanifest", "icon.png"])("sert la surface Commande %s uniquement pour le bon restaurant", async suffix => {
    resolvesTo("classfood");
    const allowed = await proxy(request(`/r/classfood/${suffix}`, `commande-${suffix.replaceAll('.', '-')}.example`, { "sec-fetch-mode": "cors" }));
    expect(allowed.status).toBe(200); expect(isRewrite(allowed)).toBe(false); expectSameOrigin(allowed);
    const denied = await proxy(request(`/r/concurrent/${suffix}`, `commande-refus-${suffix.replaceAll('.', '-')}.example`, { "sec-fetch-mode": "cors" }));
    expect(denied.status).toBe(404);
  });
  it.each([
    "/r/classfood/fidelite",
    "/r/classfood/fidelite/",
    "/r/classfood/fidelite/manifest.webmanifest",
    "/r/classfood/fidelite/icon.svg",
  ])("sert l’application fidélité du bon restaurant sur son domaine : %s", async (pathname) => {
    resolvesTo("classfood");
    const response = await proxy(request(pathname, `fidelite-${pathname.length}.example`));
    expect(response.status).toBe(200);
    expect(isRewrite(response)).toBe(false);
    expectSameOrigin(response);
  });

  it("ne sert jamais la fidélité d’un autre restaurant sous le domaine du client", async () => {
    resolvesTo("classfood");
    const navigation = await proxy(
      request("/r/concurrent/fidelite", "fidelite-isolation.example", {
        "sec-fetch-mode": "navigate",
      }),
    );
    expect(navigation.status).toBe(308);
    expect(getRedirectUrl(navigation)).toBe("https://fidelite-isolation.example/");

    const machine = await proxy(
      request(
        "/r/concurrent/fidelite/manifest.webmanifest",
        "fidelite-isolation-machine.example",
      ),
    );
    expect(machine.status).toBe(404);
    expectSameOrigin(machine);
  });

  it("sert seulement l'icône du restaurant lié au domaine", async () => {
    resolvesTo("classfood");
    const response = await proxy(request("/r/classfood/icon.svg", "restaurant-icon.example"));
    expect(response.status).toBe(200);
    expect(isRewrite(response)).toBe(false);
    expectSameOrigin(response);
  });

  it.each(["/r/concurrent/icon.svg", "/r/classfood/nested/icon.svg", "/icon.svg", "/favicon.ico", "/apple-icon.png", "/manifest.webmanifest"])(
    "n'ouvre pas les actifs hors périmètre : %s", async (pathname) => {
      resolvesTo("classfood");
      expect((await proxy(request(pathname, "restaurant-icon-denied.example"))).status).toBe(404);
    },
  );

  it("décore les refus machine et les hôtes inconnus", async () => {
    resolvesTo("classfood");
    const machine = await proxy(request("/manifest.webmanifest", "commande-machine.example"));
    expect(machine.status).toBe(404);
    expectSameOrigin(machine);

    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 404 })));
    const unknown = await proxy(request("/", "inconnu.example"));
    expect(unknown.status).toBe(404);
    expectSameOrigin(unknown);
  });

  it("couvre les documents mais pas les ressources de build Next", () => {
    expect(
      unstable_doesMiddlewareMatch({
        config,
        nextConfig: {},
        url: "https://snackmanager.fr/admin",
      }),
    ).toBe(true);
    expect(
      unstable_doesMiddlewareMatch({
        config,
        nextConfig: {},
        url: "https://snackmanager.fr/_next/static/chunk.js",
      }),
    ).toBe(false);
  });
});
