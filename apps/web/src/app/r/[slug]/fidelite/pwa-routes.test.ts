import { beforeEach, describe, expect, it, vi } from "vitest";

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
      theme_color: "#c9a15a",
    });
    expect(manifest.icons[0].src).toBe("/r/classfood/fidelite/icon.svg");
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
