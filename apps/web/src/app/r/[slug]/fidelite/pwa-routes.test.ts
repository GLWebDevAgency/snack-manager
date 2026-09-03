import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
      ["https://r2/logo.png", { sizes: "512x512", type: "image/png" }],
      /*
       * SANS EXTENSION LISIBLE, ON NE DÉCLARE RIEN — et c'est le correctif.
       *
       * Ce test attendait « image/png », au motif que c'était le format de
       * notre chaîne de dépôt. C'était faux : la médiathèque admet PNG, JPEG
       * ET WebP, et sert les octets d'origine sous une adresse SANS extension.
       * Le logo du pilote est un WebP : il était donc annoncé PNG, très
       * exactement le refus d'Android que ce fichier documente par ailleurs.
       *
       * La spécification ne rend obligatoire que `src`. Omettre `type` et
       * `sizes` laisse le navigateur lire les octets — déclarer faux est pire
       * que ne rien déclarer.
       */
      ["https://r2/9f2c1b?sig=abc", {}],
      ["https://api.exemple.fr/public/medias/abc/def", {}],
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

  /**
   * ═══════════════════════════════════════════════════════════════════════
   * L'ICÔNE MASQUABLE COMPOSÉE AVEC LE LOGO
   * ═══════════════════════════════════════════════════════════════════════
   *
   * C'est le rôle que Chrome sur Android préfère pour l'écran d'accueil. Tant
   * qu'il rendait notre seul dessin, déposer son logo ne changeait rien là où
   * le restaurateur regardait. Ces tests tiennent les deux bouts : le logo
   * entre quand il le doit, et RIEN d'autre n'entre jamais.
   */
  describe("l’icône de lancement", () => {
    const ICONE = "https://classfood.example/r/classfood/fidelite/icon.svg";
    /** Un WebP minimal, servi par l'hôte de l'API que ce Web interroge. */
    const OCTETS = (() => {
      const b = Buffer.alloc(32);
      b.write("RIFF", 0, "latin1");
      b.write("WEBP", 8, "latin1");
      return Uint8Array.from(b);
    })();
    const LOGO = "http://localhost:3001/public/medias/t1/9f2c1b";

    const servirLogo = (impl: () => Promise<Response>) => {
      const espion = vi.fn(impl);
      vi.stubGlobal("fetch", espion);
      return espion;
    };

    afterEach(() => vi.unstubAllGlobals());

    const icone = async (query: string) => {
      const { GET } = await import("./icon.svg/route");
      return GET(new Request(`${ICONE}${query}`), context);
    };

    it("incorpore le logo en `data:` et l’AJUSTE dans la zone sûre", async () => {
      /*
       * Un SVG servi comme image ne charge aucune ressource externe : un
       * `href` http y rendrait du vide. L'incorporation n'est donc pas une
       * optimisation, c'est la seule voie — et le test la vérifie sur la
       * sortie réelle de la route, pas sur l'intention.
       */
      mocks.load.mockResolvedValueOnce(avecLogo(LOGO));
      servirLogo(async () => new Response(OCTETS, { status: 200 }));
      const reponse = await icone("?forme=masquable");
      const svg = await reponse.text();

      expect(svg).toContain("<image href=\"data:image/webp;base64,");
      expect(svg).toContain('preserveAspectRatio="xMidYMid meet"');
      expect(svg).not.toContain(LOGO);
      // Le fond couvre tout le carré : le lanceur rogne sans trouver de vide.
      expect(svg).toContain('<rect width="512" height="512" fill=');
      expect(reponse.headers.get("Cache-Control")).toBe(
        "public, max-age=300, stale-while-revalidate=86400",
      );
    });

    it("ne va chercher le logo QUE pour le rôle masquable", async () => {
      /*
       * L'URL nue sert de favicon à chaque ouverture de la page. Lui faire
       * télécharger une image serait payer un appel réseau pour un dessin que
       * le manifeste ne lui demande même pas.
       */
      mocks.load.mockResolvedValue(avecLogo(LOGO));
      const espion = servirLogo(async () => new Response(OCTETS, { status: 200 }));
      const svg = await (await icone("")).text();
      expect(espion).not.toHaveBeenCalled();
      expect(svg).not.toContain("<image");
      expect(svg).toContain("<path");
    });

    it("retombe sur le dessin généré quand la récupération échoue, et le dit au cache", async () => {
      /*
       * Une icône qui ne rend rien est pire qu'une icône générique : Android
       * fige ce qu'il a reçu à l'installation. Le repli est donc un vrai
       * dessin — et il n'est mis en cache qu'une minute, parce qu'un réseau
       * coupé pendant deux secondes ne doit pas coûter une journée
       * d'installations.
       */
      mocks.load.mockResolvedValueOnce(avecLogo(LOGO));
      servirLogo(async () => {
        throw new Error("réseau");
      });
      const reponse = await icone("?forme=masquable");
      const svg = await reponse.text();

      expect(svg).not.toContain("<image");
      expect(svg).toContain("<path");
      expect(reponse.headers.get("Cache-Control")).toBe("public, max-age=60");
    });

    it("n’incorpore RIEN qui vienne d’un autre hôte que le nôtre", async () => {
      mocks.load.mockResolvedValueOnce(avecLogo("https://mechant.fr/logo.png"));
      const espion = servirLogo(async () => new Response(OCTETS, { status: 200 }));
      const svg = await (await icone("?forme=masquable")).text();
      expect(espion, "notre serveur est allé chercher chez un tiers").not.toHaveBeenCalled();
      expect(svg).not.toContain("<image");
    });

    it("garde l’en-tête long quand AUCUN logo n’est posé — c’est un état stable", async () => {
      const reponse = await icone("?forme=masquable");
      expect(reponse.headers.get("Cache-Control")).toBe(
        "public, max-age=300, stale-while-revalidate=86400",
      );
      expect(reponse.headers.get("X-Content-Type-Options")).toBe("nosniff");
      expect(reponse.headers.get("Content-Type")).toContain("image/svg+xml");
    });

    it("ne publie pas d’icône pour un programme inactif", async () => {
      mocks.load.mockRejectedValueOnce(new Error("inactive"));
      expect((await icone("?forme=masquable")).status).toBe(404);
    });
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
