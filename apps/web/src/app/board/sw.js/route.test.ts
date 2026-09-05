import { createContext, Script } from "node:vm";
import { describe, expect, it, vi } from "vitest";
import {
  GET,
  NOMS_CACHES_ECRAN,
  actifsReferences,
  estCheminCoquilleEcran,
  estReponseCoquilleEcranCacheable,
} from "./route";

describe("Le service worker de l'écran de salle — ses règles pures", () => {
  it("nomme ses deux caches sous un préfixe commun, versionné", () => {
    expect(NOMS_CACHES_ECRAN.coquille.startsWith(NOMS_CACHES_ECRAN.prefixe)).toBe(true);
    expect(NOMS_CACHES_ECRAN.medias.startsWith(NOMS_CACHES_ECRAN.prefixe)).toBe(true);
    expect(NOMS_CACHES_ECRAN.coquille).not.toBe(NOMS_CACHES_ECRAN.medias);
    expect(NOMS_CACHES_ECRAN.coquille).toMatch(/:v\d+$/);
  });

  it("la coquille, c'est l'appairage et l'affichage — rien d'autre", () => {
    expect(estCheminCoquilleEcran("/board")).toBe(true);
    expect(estCheminCoquilleEcran("/board/")).toBe(true);
    expect(estCheminCoquilleEcran("/board/display")).toBe(true);
    expect(estCheminCoquilleEcran("/board/display/")).toBe(true);
    expect(estCheminCoquilleEcran("/board/sw.js")).toBe(false);
    expect(estCheminCoquilleEcran("/board/autre")).toBe(false);
    expect(estCheminCoquilleEcran("/admin/screens")).toBe(false);
  });

  it("n'écrit dans la coquille qu'une réponse HTML de notre origine, non redirigée", () => {
    const origin = "https://web.test";
    const reponse = (patch: Partial<{ ok: boolean; redirected: boolean; url: string; type: string }>) => ({
      ok: true,
      redirected: false,
      url: `${origin}/board/display`,
      headers: new Headers({ "Content-Type": patch.type ?? "text/html; charset=utf-8" }),
      ...patch,
    });
    expect(estReponseCoquilleEcranCacheable(reponse({}), origin)).toBe(true);
    expect(estReponseCoquilleEcranCacheable(reponse({ redirected: true }), origin)).toBe(false);
    expect(estReponseCoquilleEcranCacheable(reponse({ ok: false }), origin)).toBe(false);
    expect(estReponseCoquilleEcranCacheable(reponse({ type: "application/json" }), origin)).toBe(false);
    expect(estReponseCoquilleEcranCacheable(reponse({ url: "https://ailleurs.test/board" }), origin)).toBe(false);
    expect(estReponseCoquilleEcranCacheable(reponse({ url: `${origin}/board/sw.js` }), origin)).toBe(false);
  });

  it("GET rend le script avec sa portée et sans cache HTTP", async () => {
    const res = GET();
    expect(res.headers.get("Content-Type")).toContain("javascript");
    expect(res.headers.get("Service-Worker-Allowed")).toBe("/board");
    expect(res.headers.get("Cache-Control")).toContain("no-store");
    const source = await res.text();
    expect(source).toContain('addEventListener("fetch"');
    expect(source).toContain('addEventListener("message"');
    expect(source).toContain("sm-board:precache");
  });

  it("le JavaScript réellement servi au navigateur est syntaxiquement valide", async () => {
    const source = await GET().text();
    expect(() => new Script(source, { filename: "/board/sw.js" })).not.toThrow();
  });

  it.each([
    {
      pattern: "ASSET_IN_HTML",
      text: `<link href="/_next/static/chunks/a.css"/><script src="/_next/static/chunks/b.js"></script><script src="/_next/static/chunks/b.js"></script><img src="/photos/x.png"/>`,
      expected: ["/_next/static/chunks/a.css", "/_next/static/chunks/b.js"],
    },
    {
      pattern: "ASSET_IN_CSS",
      text: `@font-face{src:url(/_next/static/media/a.woff2),url("/_next/static/media/b.woff2"),url('/_next/static/media/c.woff2')} .x{src:url(/_next/static/media/a.woff2);background:url("/photos/y.png")}`,
      expected: ["/_next/static/media/a.woff2", "/_next/static/media/b.woff2", "/_next/static/media/c.woff2"],
    },
  ])("le worker émis extrait les actifs avec $pattern", async ({ pattern, text, expected }) => {
    const source = await GET().text();
    // Enregistre les handlers sans déclencher installation, réseau ni cache.
    const context = createContext({ self: { addEventListener: vi.fn() }, inputText: text });
    new Script(source, { filename: "/board/sw.js" }).runInContext(context, { timeout: 1_000 });
    const extract = new Script(`assetsOf(inputText, ${pattern});`);
    expect(extract.runInContext(context, { timeout: 1_000 })).toEqual(expected);
    // Le motif global doit aussi fonctionner au passage suivant.
    expect(extract.runInContext(context, { timeout: 1_000 })).toEqual(expected);
  });

  it("relève les scripts, feuilles et polices que la page référence, une fois chacun", () => {
    const html = `<link rel="stylesheet" href="/_next/static/chunks/a.css"/><script src="/_next/static/chunks/b.js"></script><script src="/_next/static/chunks/b.js"></script><img src="/photos/x.png"/>`;
    expect(actifsReferences(html)).toEqual(["/_next/static/chunks/a.css", "/_next/static/chunks/b.js"]);
    const css = `@font-face{src:url(/_next/static/media/f.woff2) format("woff2")} .x{background:url("/photos/y.png")}`;
    expect(actifsReferences(css)).toEqual(["/_next/static/media/f.woff2"]);
  });

  it("le script du worker embarque le précache des actifs à l'installation", async () => {
    const source = await GET().text();
    expect(source).toContain("cacheAssets(assetsOf(");
    expect(source).toContain("ASSET_IN_CSS");
  });
});
