import { createServer, type Server } from "node:http";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { GET as worker } from "./sw.js/route";

let server: Server, browser: Browser, context: BrowserContext, page: Page, origin: string;
let requests: string[], violations: string[];
beforeAll(async () => {
  const response = worker();
  const script = await response.text();
  server = createServer((req, res) => {
    const path = new URL(req.url!, "http://fixture.local").pathname;
    requests.push(`${req.method} ${path}`);
    res.setHeader("Cache-Control", "no-store");
    if (req.method !== "GET") { violations.push("Unexpected mutation"); res.writeHead(405).end(); return; }
    if (path === "/livreur/sw.js") {
      for (const [key, value] of response.headers) res.setHeader(key, value);
      res.end(script); return;
    }
    if (path === "/livreur/acces" || path === "/livreur/missions") {
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ fixture: "PRIVATE_MISSION_NOT_FOR_CACHE" })); return;
    }
    if (path === "/favicon.ico") { res.writeHead(204).end(); return; }
    if (path !== "/livreur") { violations.push("Unexpected route"); res.writeHead(404).end(); return; }
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.end('<!doctype html><html lang="fr"><meta charset="utf-8"><title>SM Livreur · Worker fixture</title><h1>Application de recette</h1></html>');
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing fixture port");
  origin = `http://127.0.0.1:${address.port}`;
  browser = await chromium.launch();
});
beforeEach(async () => {
  requests = []; violations = [];
  context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "allow" });
  await context.route("**/*", route => {
    if (new URL(route.request().url()).origin === origin) return route.continue();
    violations.push("External request refused"); return route.abort();
  });
  page = await context.newPage();
  page.setDefaultTimeout(5_000);
  await page.goto(`${origin}/livreur`);
  await page.evaluate(async () => {
    await navigator.serviceWorker.register("/livreur/sw.js", { scope: "/livreur", updateViaCache: "none" });
    await navigator.serviceWorker.ready;
  });
  await page.waitForFunction(() => navigator.serviceWorker.controller?.state === "activated");
});
afterEach(async () => { await context?.close(); expect(violations).toEqual([]); });
afterAll(async () => {
  await browser?.close();
  if (server) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
});

describe("SM Livreur — vrai service worker, réseau et stockage navigateur", () => {
  it("s'active uniquement dans sa portée et ne crée aucun cache", async () => {
    const info = await page.evaluate(async () => {
      const registration = await navigator.serviceWorker.getRegistration();
      return { scope: registration?.scope, script: registration?.active?.scriptURL,
        caches: await caches.keys(), databases: await indexedDB.databases() };
    });
    expect(info).toEqual({ scope: `${origin}/livreur`, script: `${origin}/livreur/sw.js`, caches: [], databases: [] });
  });

  it("ouvre hors réseau un écran autonome puis retrouve l'app par un geste explicite", async () => {
    await context.setOffline(true);
    const response = await page.reload();
    expect(response?.status()).toBe(503);
    expect(response?.fromServiceWorker()).toBe(true);
    expect(await page.title()).toBe("SM Livreur · Hors connexion");
    expect(await page.getByRole("heading", { name: "Connexion nécessaire." }).count()).toBe(1);
    expect(await page.locator("body").textContent()).not.toContain("PRIVATE_MISSION_NOT_FOR_CACHE");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(await page.evaluate(() => caches.keys())).toEqual([]);
    await context.setOffline(false);
    await page.getByRole("link", { name: "Réessayer la connexion" }).click();
    await page.getByRole("heading", { name: "Application de recette" }).waitFor();
    expect(await page.title()).toBe("SM Livreur · Worker fixture");
    expect(requests.filter(request => request.startsWith("POST"))).toEqual([]);
  });

  it("ne conserve ni ne rejoue les réponses privées lors de la perte de réseau", async () => {
    const read = () => page.evaluate(async () => {
      const results = [];
      for (const path of ["/livreur/acces", "/livreur/missions"]) {
        try {
          const response = await fetch(path, { cache: "no-store", credentials: "same-origin" });
          results.push({ path, text: await response.text() });
        } catch { results.push({ path, offline: true }); }
      }
      return results;
    });
    expect((await read()).every(result => result.text?.includes("PRIVATE_MISSION_NOT_FOR_CACHE"))).toBe(true);
    const count = requests.filter(request => /\/livreur\/(acces|missions)$/.test(request)).length;
    expect(count).toBe(2);
    await context.setOffline(true);
    expect(await read()).toEqual([{ path: "/livreur/acces", offline: true }, { path: "/livreur/missions", offline: true }]);
    expect(await page.evaluate(() => caches.keys())).toEqual([]);
    expect(requests.filter(request => /\/livreur\/(acces|missions)$/.test(request))).toHaveLength(count);
    await context.setOffline(false);
    expect((await read()).every(result => result.text?.includes("PRIVATE_MISSION_NOT_FOR_CACHE"))).toBe(true);
    expect(requests.filter(request => /\/livreur\/(acces|missions)$/.test(request))).toHaveLength(4);
  });
});
