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
      theme_color: "#F6EBD9",
      background_color: "#F6EBD9",
    });
    expect(manifest.icons).toHaveLength(1);
    expect(manifest.icons[0].src).toBe("/r/classfood/fidelite/icon.svg");
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

  it("garde TOUJOURS l’icône générée en seconde entrée — c’est elle qui est masquable", async () => {
    // Sans elle, un restaurant qui pose son logo perd le seul gabarit
    // masquable du manifeste : Android rogne alors son carré dans un cercle.
    mocks.load.mockResolvedValueOnce(avecLogo("https://r2/logo.png"));
    const { GET } = await import("./manifest.webmanifest/route");
    const manifest = await (await GET(new Request("https://classfood.example/manifest"), context)).json();

    expect(manifest.icons).toHaveLength(2);
    expect(manifest.icons[1]).toEqual({
      src: "/r/classfood/fidelite/icon.svg",
      sizes: "any",
      type: "image/svg+xml",
      purpose: "any maskable",
    });
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
    const { GET } = await import("./sw.js/route");
    const response = await GET(new Request("https://classfood.example/sw.js"), context);
    const source = await response.text();

    expect(response.headers.get("Content-Type")).toContain("application/javascript");
    expect(response.headers.get("Service-Worker-Allowed")).toBe(
      "/r/classfood/fidelite",
    );
    expect(response.headers.get("Cache-Control")).toContain("no-store");
    expect(source).toContain('APP_PATH + "/card-session"');
    expect(source).toContain('APP_PATH + "/card-qr"');
    expect(source).toContain("if (PRIVATE_PATHS.has(url.pathname)) return;");
    expect(source).toContain('request.method !== "GET"');
    expect(source).not.toContain("qrToken");
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
