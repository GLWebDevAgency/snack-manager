import { describe, expect, it } from "vitest";
import {
  GET,
  NOMS_CACHES_ECRAN,
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
});
