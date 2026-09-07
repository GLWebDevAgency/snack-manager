import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DIRECTIONS } from "@sm/contracts";

const mocks = vi.hoisted(() => ({ logo: vi.fn() }));
vi.mock("@/components/loyalty/logo-incorpore", () => ({ logoIncorpore: mocks.logo }));
import { GET } from "./route";

const context = (slug = "classfood") => ({ params: Promise.resolve({ slug }) });
const request = new Request("https://classfood.example/r/classfood/icon.svg");
const tenant = { slug: "classfood", name: "Classfood", brand: DIRECTIONS.soleil };
const api = vi.fn();

beforeEach(() => {
  api.mockReset().mockResolvedValue(Response.json(tenant));
  mocks.logo.mockReset().mockResolvedValue(null);
  vi.stubGlobal("fetch", api);
});
afterEach(() => vi.unstubAllGlobals());

describe("icône publique du restaurant, indépendante de son offre", () => {
  it("lit seulement la fiche publique et dessine une icône autonome aux couleurs de l'enseigne", async () => {
    const response = await GET(request, context());
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toContain("image/svg+xml");
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(response.headers.get("Cache-Control")).toBe("public, max-age=60, must-revalidate");
    const svg = await response.text();
    expect(svg).toContain(DIRECTIONS.soleil.palette.ground);
    expect(svg).toContain(DIRECTIONS.soleil.palette.accent);
    expect(svg).not.toMatch(/<script|<text|Snack|href="https?:/);
    expect(api).toHaveBeenCalledExactlyOnceWith(expect.stringMatching(/\/public\/tenants\/classfood$/), expect.objectContaining({ cache: "no-store", redirect: "error", signal: expect.any(AbortSignal) }));
    expect(mocks.logo).not.toHaveBeenCalled();
  });

  it("incorpore le vrai logo raster sans ressource distante dans le SVG", async () => {
    api.mockResolvedValue(Response.json({ ...tenant, brand: {
      ...DIRECTIONS.soleil,
      logo: { ...DIRECTIONS.soleil.logo, mark: { light: "https://api.example/logo", dark: null } },
    } }));
    mocks.logo.mockResolvedValue("data:image/png;base64,aGVsbG8=");
    const svg = await (await GET(request, context())).text();
    expect(svg).toContain('href="data:image/png;base64,aGVsbG8="');
    expect(svg).not.toContain("https://api.example/logo");
  });

  it("n'immobilise pas un repli quand le logo est temporairement indisponible", async () => {
    api.mockResolvedValue(Response.json({ ...tenant, brand: {
      ...DIRECTIONS.soleil, logo: { ...DIRECTIONS.soleil.logo, mark: { light: "https://api.example/logo", dark: null } },
    } }));
    const response = await GET(request, context());
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it.each([404, 500, 429])("ne cache ni n'invente une marque après une erreur API %s", async (status) => {
    api.mockResolvedValue(new Response(null, { status }));
    const response = await GET(request, context());
    expect(response.status).toBe(status === 404 ? 404 : 503);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.text()).toBe("");
  });

  it.each([null, { ...tenant, slug: "concurrent" }, { ...tenant, brand: { palette: { ground: '<script>' } } }])(
    "refuse une identité absente, invalide ou appartenant à un autre restaurant", async (payload) => {
      api.mockResolvedValue(Response.json(payload));
      const response = await GET(request, context());
      expect(response.status).toBe(503);
      expect(response.headers.get("Cache-Control")).toBe("no-store");
    },
  );

  it("échoue sobrement en cas de panne réseau", async () => {
    api.mockRejectedValue(new Error("private upstream detail"));
    const response = await GET(request, context());
    expect(response.status).toBe(503);
    expect(await response.text()).toBe("");
  });

  it("ne demande pas l'API pour un slug malformé", async () => {
    expect((await GET(request, context("../concurrent"))).status).toBe(404);
    expect(api).not.toHaveBeenCalled();
  });
});
