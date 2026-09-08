import { mkdtemp, readFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { NextRequest } from "next/server";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { DELETE, GET, POST } from "./acces/route";
import { GET as GET_MISSIONS } from "./missions/route";
import { INVITATION_BOOTSTRAP } from "./invitation-bootstrap";

/** Real component, DS CSS and Next route handlers; only the upstream API is a local fixture. */
const invitation = "i".repeat(43);
const credential = "s".repeat(43);
const session = { operatorId: "a".repeat(24), name: "Camille Martin", restaurantName: "Restaurant de recette",
  restaurantSlug: "recette", expiresAt: new Date(Date.now() + 6 * 86_400_000).toISOString() };
let server: Server;
let browser: Browser;
let context: BrowserContext;
let page: Page;
let origin: string;
let exchanges: unknown[];
let upstreamSession: boolean;
let firstExchangeUnavailable: boolean;
let firstLogoutUnavailable: boolean;
let logoutRequests: number;
let errors: string[];
let responses: unknown[];
let evidenceDir: string | undefined;

beforeAll(async () => {
  const root = fileURLToPath(new URL(".", import.meta.url));
  const cssPath = fileURLToPath(new URL("../globals.css", import.meta.url));
  const [bundle, css] = await Promise.all([
    build({ stdin: { contents: `import React from 'react'; import {createRoot} from 'react-dom/client';
      import {DeliveryAccess} from './delivery-access';
      createRoot(document.getElementById('root')).render(React.createElement(React.StrictMode,null,React.createElement(DeliveryAccess)));`,
    resolveDir: root, sourcefile: "delivery-access-test-entry.tsx", loader: "tsx" },
    bundle: true, write: false, format: "esm", platform: "browser", target: "es2022", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"production"' } }),
    readFile(cssPath, "utf8").then(source => postcss([tailwind({ base: fileURLToPath(new URL("../..", import.meta.url)) })])
      .process(source, { from: cssPath })),
  ]);
  server = createServer(async (req, res) => {
    try {
      res.setHeader("Cache-Control", "no-store");
      if (req.url === "/delivery.js" || req.url === "/delivery.css") {
        res.setHeader("Content-Type", req.url.endsWith(".js") ? "text/javascript" : "text/css");
        res.end(req.url.endsWith(".js") ? bundle.outputFiles[0].text : css.css); return;
      }
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      const body = Buffer.concat(chunks).toString();
      if (req.url?.startsWith("/api/delivery-access/")) {
        res.setHeader("Content-Type", "application/json");
        if (req.url.endsWith("/exchange")) {
          exchanges.push(JSON.parse(body));
          upstreamSession = true;
          if (firstExchangeUnavailable && exchanges.length === 1) { res.writeHead(503).end("{}"); return; }
          res.end(JSON.stringify({ token: credential, session })); return;
        }
        if (req.headers.authorization !== `Bearer ${credential}`) { res.writeHead(401).end("{}"); return; }
        if (req.url.endsWith("/missions")) {
          if (!upstreamSession) res.writeHead(401).end("{}");
          else res.end(JSON.stringify({ missions: [], nextCursor: null }));
          return;
        }
        if (req.url.endsWith("/session")) {
          if (!upstreamSession) res.writeHead(401).end("{}");
          else res.end(JSON.stringify(session));
          return;
        }
        logoutRequests++;
        if (firstLogoutUnavailable && logoutRequests === 1) { res.writeHead(503).end("{}"); return; }
        upstreamSession = false; res.writeHead(204).end(); return;
      }
      if (req.url === "/livreur/acces" || req.url === "/livreur/missions") {
        const headers = new Headers();
        for (const [key, value] of Object.entries(req.headers)) if (value) headers.set(key, Array.isArray(value) ? value.join(",") : value);
        const request = new NextRequest(`${origin}${req.url}`, { method: req.method, headers,
          ...(body ? { body } : {}) });
        const handler = req.url === "/livreur/missions" ? GET_MISSIONS : req.method === "POST" ? POST : req.method === "DELETE" ? DELETE : GET;
        const result = await handler(request);
        if (result.status >= 400) responses.push({ status: result.status, origin: request.headers.get("origin"),
          site: request.headers.get("sec-fetch-site"), code: (await result.clone().json()).code });
        res.statusCode = result.status;
        result.headers.forEach((value, key) => res.setHeader(key, value));
        res.end(Buffer.from(await result.arrayBuffer())); return;
      }
      res.setHeader("Content-Type", "text/html");
      res.end(`<!doctype html><html lang="fr"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Accès livreur — recette locale</title><link rel="stylesheet" href="/delivery.css"></head><body class="font-sans antialiased"><script>${INVITATION_BOOTSTRAP}</script><div id="root"></div><script type="module" src="/delivery.js"></script></body></html>`);
    } catch { res.writeHead(500).end(); }
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing local port");
  origin = `http://127.0.0.1:${address.port}`;
  vi.stubEnv("NODE_ENV", "test");
  vi.stubEnv("NEXT_PUBLIC_API_URL", `${origin}/api`);
  vi.stubEnv("NEXT_PUBLIC_SITE_URL", origin);
  browser = await chromium.launch({ headless: true });
  if (process.env.QA_DELIVERY_ACCESS_CAPTURE === "1") evidenceDir = await mkdtemp(join(tmpdir(), "sm-delivery-access-"));
}, 30_000);

beforeEach(async () => {
  exchanges = []; upstreamSession = false; firstExchangeUnavailable = false;
  firstLogoutUnavailable = false; logoutRequests = 0; errors = []; responses = [];
  context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true,
    hasTouch: true, reducedMotion: "reduce", serviceWorkers: "block" });
  await context.route("**/*", route => route.request().url().startsWith(`${origin}/`) ? route.continue() : route.abort());
  page = await context.newPage();
  page.setDefaultTimeout(2_500);
  page.on("pageerror", error => errors.push(error.message));
});
afterEach(async ({ task }) => {
  if (task.result?.state === "fail") {
    if (evidenceDir) await page.screenshot({ path: join(evidenceDir, "failure.png"), fullPage: true });
    console.info("Écran de recette en échec :", await page.locator("body").innerText());
    console.info("Réponses de recette en échec :", responses);
  }
  await context?.close(); expect(errors).toEqual([]);
});
afterAll(async () => {
  await browser?.close();
  if (server) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  vi.unstubAllEnvs();
  if (evidenceDir) console.info(`Captures de recette locale : ${evidenceDir}`);
});

async function openInvitation() {
  await page.goto(`${origin}/livreur#invitation=${invitation}`);
  await page.getByRole("heading", { name: "Associez ce téléphone." }).waitFor();
}
async function associate() {
  await page.getByRole("button", { name: "Associer ce téléphone", exact: true }).click();
  await page.getByRole("heading", { name: "Accès associé.", exact: true }).waitFor();
}

describe("accès livreur mobile réel, BFF et API locale", () => {
  it("retire le fragment avant le bundle client et attend une association explicite", async () => {
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    await page.route("**/delivery.js", async route => { await gate; await route.continue(); });
    const navigating = page.goto(`${origin}/livreur#invitation=${invitation}`);
    try {
      await page.waitForFunction(() => typeof window.__smTakeDeliveryInvitation === "function");
      expect(new URL(page.url()).hash).toBe("");
      expect(await page.locator("body").innerText()).not.toContain(invitation);
      expect(exchanges).toEqual([]);
    } finally { release(); }
    await navigating;
    await page.getByRole("heading", { name: "Associez ce téléphone." }).waitFor();
    expect(await page.evaluate(() => typeof window.__smTakeDeliveryInvitation)).toBe("undefined");
    expect(await page.evaluate(() => [localStorage.length, sessionStorage.length])).toEqual([0, 0]);
    expect(exchanges).toEqual([]);
  });

  it("reprend le même échange après 503 puis conserve la session uniquement en cookie HttpOnly", async () => {
    firstExchangeUnavailable = true;
    await openInvitation();
    await page.getByRole("button", { name: "Associer ce téléphone", exact: true }).click();
    await page.getByRole("alert").filter({ hasText: "L’association reste à vérifier" }).waitFor();
    expect(await page.getByRole("heading", { name: "Accès associé.", exact: true }).count()).toBe(0);
    await page.getByRole("button", { name: "Vérifier l’association", exact: true }).click();
    await page.getByRole("heading", { name: "Accès associé.", exact: true }).waitFor();
    expect(exchanges).toHaveLength(2);
    expect(exchanges[0]).toEqual(exchanges[1]);
    expect(exchanges[0]).toMatchObject({ token: invitation, nonce: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/) });
    const cookie = (await context.cookies()).find(value => value.name === "sm_delivery_access");
    expect(cookie).toMatchObject({ value: credential, httpOnly: true, sameSite: "Strict", path: "/livreur" });
    expect(await page.evaluate(() => document.cookie)).toBe("");
    expect(await page.evaluate(() => [localStorage.length, sessionStorage.length])).toEqual([0, 0]);
    expect(await page.content()).not.toContain(credential);
    await page.reload();
    await page.getByRole("heading", { name: "Accès associé.", exact: true }).waitFor();
    expect(exchanges).toHaveLength(2);
  });

  it("montre la révocation serveur et ne conserve aucune identité associée", async () => {
    await openInvitation(); await associate();
    // The connected heading precedes the missions effect. Let its initial GET
    // finish before revoking, so this case exercises the explicit access check.
    await page.getByText("Aucune mission pour le moment", { exact: true }).waitFor();
    expect(await context.cookies()).toHaveLength(1);
    upstreamSession = false;
    const refused = page.waitForResponse(response => response.url() === `${origin}/livreur/acces`
      && response.request().method() === "GET" && response.status() === 401);
    await Promise.all([refused, page.getByRole("button", { name: "Vérifier mon accès", exact: true }).click()]);
    await page.getByRole("alert").filter({ hasText: "Votre accès a expiré ou a été retiré" }).waitFor();
    expect(await page.getByText(session.name, { exact: true }).count()).toBe(0);
    expect(await context.cookies()).toEqual([]);
  });

  it("retire aussi l’identité quand le premier chargement des missions découvre la révocation", async () => {
    let release!: () => void;
    let requested!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const initialMissions = new Promise<void>(resolve => { requested = resolve; });
    await page.route("**/livreur/missions", async route => { requested(); await gate; await route.continue(); });
    try {
      await openInvitation(); await associate(); await initialMissions;
      expect(await context.cookies()).toHaveLength(1);
      upstreamSession = false;
      const refused = page.waitForResponse(response => response.url() === `${origin}/livreur/missions`
        && response.request().method() === "GET" && response.status() === 401);
      release();
      await refused;
      await page.getByRole("alert").filter({ hasText: "Votre accès a expiré ou a été retiré" }).waitFor();
    } finally { release(); }
    expect(await page.getByText(session.name, { exact: true }).count()).toBe(0);
    expect(await page.getByRole("heading", { name: "Accès associé.", exact: true }).count()).toBe(0);
    expect(await context.cookies()).toEqual([]);
  });

  it("hors connexion, retire le succès et attend la confirmation réelle de déconnexion", async () => {
    await openInvitation(); await associate();
    await context.setOffline(true);
    await page.getByRole("alert").filter({ hasText: "Vous êtes hors connexion" }).waitFor();
    expect(await page.getByRole("heading", { name: "Accès associé.", exact: true }).count()).toBe(0);
    expect(await page.getByRole("button", { name: "Déconnecter cet accès", exact: true }).isDisabled()).toBe(true);
    await context.setOffline(false);
    await page.getByRole("heading", { name: "Accès associé.", exact: true }).waitFor();
    firstLogoutUnavailable = true;
    await page.getByRole("button", { name: "Déconnecter cet accès", exact: true }).click();
    await page.getByRole("alert").filter({ hasText: "La déconnexion n’est pas confirmée" }).waitFor();
    expect(await context.cookies()).toHaveLength(1);
    expect(await page.getByRole("button", { name: "Vérifier mon accès", exact: true }).isDisabled()).toBe(true);
    await page.getByRole("button", { name: "Confirmer la déconnexion", exact: true }).click();
    await page.getByRole("heading", { name: "Vous êtes déconnecté.", exact: true }).waitFor();
    expect(await context.cookies()).toEqual([]);
    expect(logoutRequests).toBe(2);
  });

  it("reste utilisable à 320 px, au clavier et avec moins de mouvement", async () => {
    await page.setViewportSize({ width: 320, height: 720 });
    await openInvitation();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const button = page.getByRole("button", { name: "Associer ce téléphone", exact: true });
    expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(48);
    await page.keyboard.press("Tab");
    expect(await button.evaluate(element => element === document.activeElement)).toBe(true);
    expect(await button.evaluate(element => getComputedStyle(element).outlineStyle)).toBe("solid");
    expect(await button.evaluate(element => parseFloat(getComputedStyle(element).transitionDuration))).toBeLessThan(0.001);
    await page.keyboard.press("Enter");
    await page.getByRole("heading", { name: "Accès associé.", exact: true }).waitFor();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });

  it("présente l’invitation et l’identité réelles sur mobile et grand écran", async () => {
    await openInvitation();
    if (evidenceDir) await page.screenshot({ path: join(evidenceDir, "mobile-invitation.png"), fullPage: true });
    await associate();
    if (evidenceDir) await page.screenshot({ path: join(evidenceDir, "mobile-associated.png"), fullPage: true });
    await page.setViewportSize({ width: 1440, height: 1000 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    if (evidenceDir) await page.screenshot({ path: join(evidenceDir, "desktop-associated.png"), fullPage: true });
  });
});
