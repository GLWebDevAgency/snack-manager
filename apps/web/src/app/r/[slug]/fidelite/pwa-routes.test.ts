import { beforeEach, describe, expect, it, vi } from "vitest";
import { DIRECTIONS } from "@sm/contracts";

const mocks = vi.hoisted(() => ({ load: vi.fn() }));

vi.mock("@/components/loyalty/public-api", () => ({
  loadPublicLoyalty: mocks.load,
}));

const CATALOG = {
  restaurant: {
    slug: "classfood",
    name: "Classfood",
    brandColor: "#c9a15a",
    logoUrl: null,
    brand: DIRECTIONS.soleil,
  },
  program: {
    name: "La carte Classfood",
    mechanism: "points",
    unitLabelSingular: "point",
    unitLabelPlural: "points",
    termsSummary: "Conditions du programme",
  },
  rewards: [],
};

const context = { params: Promise.resolve({ slug: "classfood" }) };

describe("application fidélité installable", () => {
  beforeEach(() => mocks.load.mockReset().mockResolvedValue(CATALOG));

  it("garde l’URL de lancement dans la portée exacte du manifeste", async () => {
    const { GET } = await import("./manifest.webmanifest/route");
    const response = await GET(new Request("https://classfood.example/manifest"), context);
    const manifest = await response.json();

    expect(response.headers.get("Content-Type")).toContain("application/manifest+json");
    expect(manifest).toMatchObject({
      id: "/r/classfood/fidelite",
      start_url: "/r/classfood/fidelite",
      scope: "/r/classfood/fidelite",
      display: "standalone",
      // Le thème de l'installation suit le masque du restaurant, pas la marque grise.
      // En minuscules : `HexSchema` normalise la casse au contrat, une seule fois.
      theme_color: "#f6ebd9",
      background_color: "#f6ebd9",
    });
    /*
     * DEUX ENTRÉES GÉNÉRÉES, ET DEUX RÔLES DISTINCTS. Une seule icône
     * `any maskable` était un compromis perdant : la marge de 20 % qu'exige la
     * découpe d'un lanceur rend l'icône rabougrie quand elle n'est PAS rognée.
     * Même géométrie, deux échelles — voir `icone-carte.ts`.
     */
    expect(manifest.icons).toEqual([
      {
        src: "/r/classfood/fidelite/icon.svg?forme=plein",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "any",
      },
      {
        src: "/r/classfood/fidelite/icon.svg?forme=masquable",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "maskable",
      },
    ]);
  });

  /** Le même catalogue, avec un logo de marque clair à l'URL donnée. */
  const avecLogo = (url: string) => ({
    ...CATALOG,
    restaurant: {
      ...CATALOG.restaurant,
      brand: {
        ...DIRECTIONS.soleil,
        logo: {
          ...DIRECTIONS.soleil.logo,
          mark: { ...DIRECTIONS.soleil.logo.mark, light: url },
        },
      },
    },
  });

  it("expose le logo réel du restaurant comme icône quand il existe", async () => {
    mocks.load.mockResolvedValueOnce(avecLogo("https://r2/logo.png"));
    const { GET } = await import("./manifest.webmanifest/route");
    const response = await GET(new Request("https://classfood.example/manifest"), context);
    const manifest = await response.json();

    expect(manifest.icons[0]).toEqual({
      src: "https://r2/logo.png",
      sizes: "512x512",
      type: "image/png",
      purpose: "any",
    });
  });

  it("garde TOUJOURS l’icône générée MASQUABLE derrière le logo — et elle seule", async () => {
    // Sans elle, un restaurant qui pose son logo perd le seul gabarit
    // masquable du manifeste : Android rogne alors son carré dans un cercle.
    mocks.load.mockResolvedValueOnce(avecLogo("https://r2/logo.png"));
    const { GET } = await import("./manifest.webmanifest/route");
    const manifest = await (await GET(new Request("https://classfood.example/manifest"), context)).json();

    expect(manifest.icons).toHaveLength(2);
    expect(manifest.icons[1]).toEqual({
      src: "/r/classfood/fidelite/icon.svg?forme=masquable",
      sizes: "any",
      type: "image/svg+xml",
      purpose: "maskable",
    });
    /*
     * ET AUCUNE SECONDE ENTRÉE `any`. Le logo du restaurateur est ce qu'on
     * veut voir : lui ajouter la variante `plein` derrière mettrait Chrome en
     * position d'arbitrer entre deux icônes `any`, et un SVG en `sizes: "any"`
     * l'emporte souvent sur un PNG de 512. Le logo perdrait sa place sans que
     * rien ne le dise.
     */
    expect(manifest.icons.filter((i: { purpose: string }) => i.purpose === "any")).toHaveLength(1);
    expect(manifest.icons[0].src).toBe("https://r2/logo.png");
  });

  it("déclare le type MIME du logo d’après son extension — un SVG n’est pas un PNG de 512", async () => {
    const { GET } = await import("./manifest.webmanifest/route");
    const attendus = [
      ["https://r2/logo.svg", { sizes: "any", type: "image/svg+xml" }],
      ["https://r2/logo.jpeg", { sizes: "512x512", type: "image/jpeg" }],
      ["https://r2/logo.webp", { sizes: "512x512", type: "image/webp" }],
      // Une URL signée, sans extension lisible : on retombe sur le format que
      // produit notre chaîne de dépôt plutôt que de mentir sur un autre.
      ["https://r2/9f2c1b?sig=abc", { sizes: "512x512", type: "image/png" }],
    ] as const;
    for (const [url, forme] of attendus) {
      mocks.load.mockResolvedValueOnce(avecLogo(url));
      const manifest = await (await GET(new Request("https://classfood.example/manifest"), context)).json();
      expect(manifest.icons[0], url).toEqual({ src: url, purpose: "any", ...forme });
    }
  });

  it("sert un worker borné à la fidélité et exclut explicitement la carte privée", async () => {
    const { GET, estReponseCoquilleFideliteCacheable } = await import(
      "./sw.js/route"
    );
    const response = await GET(new Request("https://classfood.example/sw.js"), context);
    const source = await response.text();
    const reponse = (
      url: string,
      contentType = "text/html; charset=utf-8",
      redirected = false,
    ) => ({
      ok: true,
      redirected,
      url,
      headers: new Headers({ "Content-Type": contentType }),
    });

    expect(response.headers.get("Content-Type")).toContain("application/javascript");
    expect(response.headers.get("Service-Worker-Allowed")).toBe(
      "/r/classfood/fidelite",
    );
    expect(response.headers.get("Cache-Control")).toContain("no-store");
    expect(source).toContain('APP_PATH + "/card-session"');
    expect(source).toContain('APP_PATH + "/card-qr"');
    expect(source).toContain("if (PRIVATE_PATHS.has(url.pathname)) return;");
    expect(source).toContain(
      'return pathname === APP_PATH || pathname === APP_PATH + "/";',
    );
    expect(source).toContain(
      'request.mode === "navigate" && isAppShellPath(url.pathname)',
    );
    expect(source).not.toContain("const SAFE_ASSETS = new Set([\n  APP_PATH,");
    expect(source).not.toContain('const SAFE_ASSETS = new Set([\n  APP_PATH + "/",');
    expect(source).not.toContain("url.pathname.startsWith(APP_PATH)");
    expect(source).toContain("isCacheableAppShell(response)");
    expect(source).toContain("!response.ok || response.redirected");
    expect(source).toContain("responseUrl.origin === self.location.origin");
    expect(source).toContain('contentType.toLowerCase().startsWith("text/html")');
    expect(source).toContain("fetchAndCacheAppShell(APP_PATH)");
    expect(source).not.toContain("cache.add(APP_PATH)");
    expect(source).toContain("const cache = await caches.open(CACHE_NAME);");
    expect(source).toContain("(await cache.match(APP_PATH)) || Response.error()");
    expect(source).not.toContain("caches.match(");
    expect(source).toContain('request.method !== "GET"');
    expect(source).not.toContain("qrToken");

    // `fetch` suit les redirections : la réponse finale privée doit être
    // refusée même quand la requête initiale visait le shell public.
    expect(
      estReponseCoquilleFideliteCacheable(
        reponse(
          "https://classfood.example/r/classfood/fidelite/card-session",
          "text/html; charset=utf-8",
          true,
        ),
        "/r/classfood/fidelite",
        "https://classfood.example",
      ),
    ).toBe(false);
    expect(
      estReponseCoquilleFideliteCacheable(
        reponse("https://classfood.example/r/classfood/fidelite/card-qr"),
        "/r/classfood/fidelite",
        "https://classfood.example",
      ),
    ).toBe(false);
    expect(
      estReponseCoquilleFideliteCacheable(
        reponse("https://classfood.example/r/classfood/fidelite"),
        "/r/classfood/fidelite",
        "https://classfood.example",
      ),
    ).toBe(true);
    expect(
      estReponseCoquilleFideliteCacheable(
        reponse(
          "https://classfood.example/r/classfood/fidelite",
          "text/html; charset=utf-8",
          true,
        ),
        "/r/classfood/fidelite",
        "https://classfood.example",
      ),
    ).toBe(false);
    expect(
      estReponseCoquilleFideliteCacheable(
        reponse("https://classfood.example/r/classfood/fidelite", "application/json"),
        "/r/classfood/fidelite",
        "https://classfood.example",
      ),
    ).toBe(false);
  });

  it("ne traite comme navigation hors ligne que la racine, avec ou sans slash", async () => {
    const { GET, estCheminCoquilleFidelite } = await import("./sw.js/route");
    const source = await (
      await GET(new Request("https://classfood.example/sw.js"), context)
    ).text();

    const appPath = "/r/classfood/fidelite";
    expect(estCheminCoquilleFidelite(appPath, appPath)).toBe(true);
    expect(estCheminCoquilleFidelite(`${appPath}/`, appPath)).toBe(true);
    expect(estCheminCoquilleFidelite(`${appPath}/card-qr`, appPath)).toBe(false);
    expect(estCheminCoquilleFidelite(`${appPath}/card-session`, appPath)).toBe(false);
    expect(
      estCheminCoquilleFidelite(`${appPath}/future-private-route`, appPath),
    ).toBe(false);

    // Le worker livré doit employer cette égalité exacte, sans ancien préfixe.
    expect(source).toContain("isAppShellPath(url.pathname)");
    expect(source).not.toContain("url.pathname.startsWith(APP_PATH)");
  });

  it("isole les caches de foo et foo-bar, puis ne purge que son ancien nom exact", async () => {
    const { GET, estCacheFideliteObsolete, nomsCachesFidelite } = await import(
      "./sw.js/route"
    );
    mocks.load.mockResolvedValueOnce({
      ...CATALOG,
      restaurant: { ...CATALOG.restaurant, slug: "foo" },
    });
    const source = await (
      await GET(new Request("https://foo.example/sw.js"), {
        params: Promise.resolve({ slug: "foo" }),
      })
    ).text();

    expect(nomsCachesFidelite("foo").actuel).toBe("sm-loyalty:foo:v2");
    expect(estCacheFideliteObsolete("sm-loyalty:foo:v1", "foo")).toBe(true);
    expect(estCacheFideliteObsolete("sm-loyalty-foo-v1", "foo")).toBe(true);
    expect(estCacheFideliteObsolete("sm-loyalty:foo:v2", "foo")).toBe(false);
    expect(estCacheFideliteObsolete("sm-loyalty:foo-bar:v1", "foo")).toBe(false);
    expect(estCacheFideliteObsolete("sm-loyalty-foo-bar-v1", "foo")).toBe(false);
    expect(source).toContain('const CACHE_NAME = "sm-loyalty:foo:v2";');
    expect(source).toContain('const CACHE_PREFIX = "sm-loyalty:foo:";');
    expect(source).toContain('const LEGACY_CACHE_NAME = "sm-loyalty-foo-v1";');
    expect(source).not.toContain('startsWith("sm-loyalty-foo-")');
  });

  it("ne publie ni manifeste ni worker pour un programme inactif", async () => {
    mocks.load.mockRejectedValueOnce(new Error("inactive"));
    const manifest = await import("./manifest.webmanifest/route");
    expect((await manifest.GET(new Request("https://classfood.example/manifest"), context)).status)
      .toBe(404);

    mocks.load.mockRejectedValueOnce(new Error("inactive"));
    const worker = await import("./sw.js/route");
    expect((await worker.GET(new Request("https://classfood.example/sw.js"), context)).status)
      .toBe(404);
  });
});
