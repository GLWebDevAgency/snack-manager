import { createServer, type Server } from "node:http";
import { fileURLToPath } from "node:url";
import { mkdir, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build } from "esbuild";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { afterAll, afterEach, beforeAll, beforeEach, expect, it } from "vitest";
import { EMPTY_BILLING_IDENTITY, TenantBillingIdentitySchema, type TenantBillingIdentity } from "@sm/contracts";
import { SNAP_BILLING } from "@/lib/demo/snapshot";

// Actual pages, transport, fields and shared navigation, with an isolated loopback API.
// No account, database, checkout or remote resource is contacted.
type Call = { method: string; path: string; body: Record<string, unknown> };
let server: Server, browser: Browser, context: BrowserContext, page: Page, origin: string, captures: string;
let calls: Call[], errors: string[], failMutation: boolean, suspended: boolean;
let identity: TenantBillingIdentity;
let tenant: ReturnType<typeof initialTenant>;
function initialTenant() {
  return { hours: Array.from({ length: 7 }, (_, day) => ({ day: day + 1, lunch: { open: "11:30", close: "14:30" }, dinner: { open: "18:00", close: "22:00" } })),
    closures: [] as { from: string; to: string; reason: string }[],
    settings: { slotIntervalMin: 10, slotCapacity: 4, onlineOrderingPaused: false, pauseMessage: "", printTicketOn: "ready", printStickerOn: "ready" } };
}
const mutations = () => calls.filter(call => call.method !== "GET");
const tab = (name: string) => page.getByRole("tab", { name, exact: true });
async function selected(name: string) { await expect.poll(() => tab(name).getAttribute("aria-selected")).toBe("true"); }

beforeAll(async () => {
  captures = process.env.ADMIN_HOURS_BILLING_CAPTURES ?? await mkdtemp(join(tmpdir(), "sm-admin-hours-billing-"));
  await mkdir(captures, { recursive: true });
  const source = fileURLToPath(new URL(".", import.meta.url));
  const cssPath = fileURLToPath(new URL("../../globals.css", import.meta.url));
  const [bundle, css] = await Promise.all([
    build({ stdin: { sourcefile: "hours-billing-fixture.tsx", resolveDir: source, loader: "tsx", contents: `
      import React from 'react';import{createRoot}from'react-dom/client';
      import HoursPage from './page';import AbonnementPage from '../abonnement/page';
      import{ToastProvider}from'../../../components/ui/Toast';import{AdminAccess}from'../access';
      import{backofficeStyle}from'../../../components/backoffice/visual-style';
      const theme=new URLSearchParams(location.search).get('theme')==='dark'?'dark':'light';
      createRoot(document.getElementById('root')).render(<React.StrictMode><div style={{...backofficeStyle(theme),minHeight:'100vh',background:'var(--cf-bg)',color:'var(--cf-text)'}}><ToastProvider><AdminAccess pathname={location.pathname} context={{role:'owner',suspendu:false,capacites:['online','bo']}} pending={false} failed={false} demo={false}>{location.pathname.endsWith('/hours')?<HoursPage/>:<AbonnementPage/>}</AdminAccess></ToastProvider></div></React.StrictMode>);` },
      bundle: true, write: false, outdir: "/virtual-hours-billing", format: "esm", platform: "browser", jsx: "automatic", target: "es2022",
      alias: { "@": fileURLToPath(new URL("../../../", import.meta.url)) },
      define: { "process.env": "{}", "process.env.NODE_ENV": '"production"', "process.env.NEXT_PUBLIC_API_URL": '"/api"' } }),
    readFile(cssPath, "utf8").then(value => postcss([tailwind({ base: fileURLToPath(new URL("../../../..", import.meta.url)) })]).process(value, { from: cssPath })),
  ]);
  server = createServer(async (request, response) => {
    const path = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self' data:; img-src 'self' data: blob:; connect-src 'self'; frame-src 'none'");
    if (path === "/app.js") { response.setHeader("Content-Type", "text/javascript"); response.end(bundle.outputFiles.find(file => file.path.endsWith(".js"))!.text); return; }
    if (path === "/style.css") { response.setHeader("Content-Type", "text/css"); response.end(css.css + bundle.outputFiles.filter(file => file.path.endsWith(".css")).map(file => file.text).join("\n")); return; }
    if (path === "/favicon.ico") { response.writeHead(204).end(); return; }
    if (path === "/admin/hours" || path === "/admin/abonnement") {
      response.setHeader("Content-Type", "text/html"); response.end('<!doctype html><html lang="fr"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Navigation — recette locale</title><link rel="stylesheet" href="/style.css"><div id="root"></div><script type="module" src="/app.js"></script></html>'); return;
    }
    const json = (body: unknown, status = 200) => { response.writeHead(status, { "Content-Type": "application/json" }).end(JSON.stringify(body)); };
    const method = request.method ?? "GET";
    const chunks: Buffer[] = []; for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const body = JSON.parse(Buffer.concat(chunks).toString() || "{}"); calls.push({ method, path, body });
    if (path === "/api/tenants/me" && method === "GET") { json(tenant); return; }
    if (path === "/api/billing/me" && method === "GET") {
      const billing = JSON.parse(JSON.stringify(SNAP_BILLING), (_key, value) => typeof value === "string" && /^@-?\d+$/.test(value) ? "2026-09-13T12:00:00.000Z" : value);
      billing.subscription.accessBlocked = suspended; billing.identity = identity; billing.identityEditable = !suspended;
      billing.invoices[0].totals = { htCents: 13900, vatCents: 2780, ttcCents: 16680, rateLabel: "20 %" };
      json(billing); return;
    }
    if (path === "/api/billing/me/checkout-availability" && method === "GET") { json({ enabled: true }); return; }
    if (path.endsWith("/pdf") && method === "GET") { response.writeHead(200, { "Content-Type": "application/pdf" }).end("%PDF-1.7\n% Local download fixture\n%%EOF"); return; }
    if (failMutation) { failMutation = false; json({ message: "Échec local — saisie conservée." }, 503); return; }
    if (path === "/api/tenants/me/hours" && method === "PATCH") { tenant = { ...tenant, ...body }; json(tenant); return; }
    if (path === "/api/tenants/me/settings" && method === "PATCH") { tenant.settings = { ...tenant.settings, ...body }; json(tenant); return; }
    if (path === "/api/billing/me/identity" && method === "PUT") { identity = TenantBillingIdentitySchema.parse(body); json(identity); return; }
    if (path.endsWith("/checkout") && method === "POST") { json({ message: "Paiement de recette indisponible." }, 503); return; }
    errors.push(`Unexpected ${method} ${path}`); json({ message: "Unexpected local call" }, 405);
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); if (!address || typeof address === "string") throw Error("No local port");
  origin = `http://127.0.0.1:${address.port}`; browser = await chromium.launch({ headless: true });
}, 30_000);

beforeEach(async () => {
  calls = []; errors = []; failMutation = false; suspended = false; identity = { ...EMPTY_BILLING_IDENTITY }; tenant = initialTenant();
  context = await browser.newContext({ viewport: { width: 320, height: 850 }, serviceWorkers: "block", reducedMotion: "reduce" });
  await context.route("**/*", route => new URL(route.request().url()).origin === origin ? route.continue() : (errors.push("External request blocked"), route.abort()));
  await context.routeWebSocket("**/*", socket => { errors.push("WebSocket blocked"); socket.close(); });
  await context.addInitScript(() => { localStorage.setItem("sm.token.resto", "local." + btoa(JSON.stringify({ role: "owner", kind: "user", exp: 4_000_000_000 })) + ".fixture"); });
  page = await context.newPage(); page.setDefaultTimeout(5_000); page.on("pageerror", error => errors.push(error.message));
});
afterEach(async () => { await context.close(); expect(errors).toEqual([]); });
afterAll(async () => { await browser?.close(); await new Promise<void>(resolve => server?.close(() => resolve())); });

it("conserve les horaires en brouillon entre sections et historique, puis sauvegarde le même contenu après erreur", async () => {
  await page.goto(origin + "/admin/hours?demo=0&trace=garder"); await selected("Ouverture");
  const opening = page.getByLabel("Lundi midi — ouverture", { exact: true });
  await opening.fill("12:00"); await tab("Fermetures").click(); await selected("Fermetures");
  expect(mutations()).toHaveLength(0); expect(new URL(page.url()).searchParams.get("trace")).toBe("garder");
  await page.goBack(); await selected("Ouverture"); expect(await opening.inputValue()).toBe("12:00");
  await page.goForward(); await selected("Fermetures"); await tab("Ouverture").click();
  failMutation = true; await page.getByRole("button", { name: "Enregistrer", exact: true }).click();
  await expect.poll(() => mutations().length).toBe(1); expect(await opening.inputValue()).toBe("12:00");
  await page.getByRole("button", { name: "Enregistrer", exact: true }).click();
  await expect.poll(() => mutations().length).toBe(2); expect(mutations()[1].body).toEqual(mutations()[0].body);
  await page.reload(); await selected("Ouverture"); expect(await opening.inputValue()).toBe("12:00");
});

it("préserve capacité et message quand on consulte ailleurs ou active la pause, sans sauvegarde implicite", async () => {
  await page.goto(origin + "/admin/hours?section=commande&trace=garder"); await selected("Commande en ligne");
  await page.getByLabel("Commandes par créneau", { exact: true }).fill("7");
  await page.getByLabel("Message de pause", { exact: true }).fill("Retour après le service");
  await tab("Ouverture").click(); await tab("Commande en ligne").click();
  expect(mutations()).toHaveLength(0);
  expect(await page.getByLabel("Commandes par créneau", { exact: true }).inputValue()).toBe("7");
  await page.getByRole("switch", { name: "Mettre la commande en ligne en pause" }).click();
  await expect.poll(() => tenant.settings.onlineOrderingPaused).toBe(true);
  expect(await page.getByLabel("Commandes par créneau", { exact: true }).inputValue()).toBe("7");
  await page.getByRole("button", { name: "Enregistrer les créneaux" }).click();
  await expect.poll(() => tenant.settings.slotCapacity).toBe(7);
  await page.getByRole("button", { name: "Enregistrer le message" }).click();
  await expect.poll(() => tenant.settings.pauseMessage).toBe("Retour après le service");
  await tab("Fermetures").click(); expect(await page.getByText("Commande en ligne en pause", { exact: true }).isVisible()).toBe(true);
  await page.reload(); await tab("Commande en ligne").click(); expect(await page.getByLabel("Message de pause", { exact: true }).inputValue()).toBe("Retour après le service");
});

it("ajoute une fermeture avec la semaine enregistrée sans publier le brouillon hebdomadaire", async () => {
  await page.goto(origin + "/admin/hours"); await selected("Ouverture");
  await page.getByLabel("Lundi midi — ouverture", { exact: true }).fill("12:00");
  await tab("Fermetures").click(); await page.getByRole("button", { name: "Ajouter", exact: true }).click();
  await page.getByLabel("Du", { exact: true }).fill("2026-12-25"); await page.getByLabel("Motif", { exact: true }).fill("Fermeture locale");
  await page.getByRole("button", { name: "Ajouter la fermeture", exact: true }).click();
  await expect.poll(() => tenant.closures.length).toBe(1); expect(tenant.hours[0].lunch.open).toBe("11:30");
  await tab("Ouverture").click(); expect(await page.getByLabel("Lundi midi — ouverture", { exact: true }).inputValue()).toBe("12:00");
});

it("conserve l’identité et sa validation entre les sections puis après un échec de sauvegarde", async () => {
  await page.goto(origin + "/admin/abonnement?section=informations&trace=garder"); await selected("Informations");
  await page.getByLabel("Raison sociale", { exact: true }).fill("Restaurant local SARL");
  await tab("Factures").click(); await tab("Vue d’ensemble").click(); expect(mutations()).toHaveLength(0);
  await page.goBack(); await selected("Factures"); await page.goBack(); await selected("Informations");
  expect(await page.getByLabel("Raison sociale", { exact: true }).inputValue()).toBe("Restaurant local SARL");
  failMutation = true; await page.getByRole("button", { name: "Enregistrer", exact: true }).click();
  await page.getByRole("alert").filter({ hasText: "Échec local" }).waitFor();
  await tab("Factures").click(); await tab("Informations").click();
  await page.getByRole("button", { name: "Enregistrer", exact: true }).click();
  await expect.poll(() => identity.legalName).toBe("Restaurant local SARL");
  expect(mutations()[1].body).toEqual(mutations()[0].body);
  await page.reload(); await selected("Informations"); expect(await page.getByLabel("Raison sociale", { exact: true }).inputValue()).toBe("Restaurant local SARL");
});

it("ouvre les factures au retour de paiement, garde les avertissements et utilise les actions réelles à 320 px", async () => {
  await page.goto(origin + "/admin/abonnement?payment=return&trace=garder"); await selected("Factures");
  const invoice = page.getByRole("article", { name: "Facture SM-2026-0003", exact: true });
  expect(await invoice.isVisible()).toBe(true); expect(await invoice.getByText("166,80 €", { exact: true }).isVisible()).toBe(true);
  await invoice.getByRole("button", { name: /Payer par carte/ }).click();
  await page.getByText("Paiement de recette indisponible.", { exact: true }).waitFor();
  expect(mutations()).toHaveLength(1); expect(mutations()[0].path).toMatch(/checkout$/);
  const download = page.waitForEvent("download"); await invoice.getByRole("button", { name: /Télécharger la facture/ }).click();
  expect((await download).suggestedFilename()).toContain("SM-2026-0003");
  await tab("Informations").click(); expect(new URL(page.url()).searchParams.get("payment")).toBe("return");
  expect(await page.getByText(/La facture sera marquée payée après confirmation/).isVisible()).toBe(true);
});

it("garde la régularisation et l’identité consultables sans réactiver les champs d’un compte suspendu", async () => {
  suspended = true; await page.goto(origin + "/admin/abonnement"); await selected("Factures");
  await tab("Informations").click(); expect(await page.getByLabel("Raison sociale", { exact: true }).isDisabled()).toBe(true);
  expect(await page.getByText("Accès suspendu — le reste du back-office est fermé.", { exact: true }).isVisible()).toBe(true);
  expect(await page.getByRole("button", { name: "Enregistrer", exact: true }).count()).toBe(0); expect(mutations()).toHaveLength(0);
});

it("rend les sections sans débordement global aux quatre largeurs en clair et sombre", async () => {
  for (const theme of ["light", "dark"]) for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    for (const route of ["hours", "abonnement"]) {
      await page.goto(`${origin}/admin/${route}?theme=${theme}`); await page.getByRole("tablist").waitFor();
      for (const name of route === "hours" ? ["Ouverture", "Fermetures", "Commande en ligne"] : ["Vue d’ensemble", "Factures", "Informations"]) {
        await tab(name).click(); await selected(name);
        const overflow = await page.evaluate(() => ({ width: innerWidth, document: document.documentElement.scrollWidth,
          outside: Array.from(document.querySelectorAll('body *')).filter(node => node.getBoundingClientRect().right > innerWidth + 1 && node.getBoundingClientRect().width > 0).slice(0, 8).map(node => ({ tag: node.tagName, text: node.textContent?.slice(0, 60), classes: node.className, parents: [node.parentElement, node.parentElement?.parentElement, node.parentElement?.parentElement?.parentElement].filter(Boolean).map(parent => ({cls: parent!.className, width: parent!.getBoundingClientRect().width, overflow: getComputedStyle(parent!).overflowX})) })) }));
        expect(overflow.document <= overflow.width, JSON.stringify({ theme, width, route, name, overflow })).toBe(true);
        for (const button of await page.getByRole("tab").all()) expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44);
        if (width === 320 || width === 1440) await page.screenshot({ path: join(captures, `${route}-${width}-${theme}-${new URL(page.url()).searchParams.get("section") ?? "default"}.png`), fullPage: true });
      }
      await page.screenshot({ path: join(captures, `${route}-${width}-${theme}.png`), fullPage: true });
    }
  }
}, 30_000);
