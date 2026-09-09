import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer, type Server, type ServerResponse } from "node:http";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type * as Journal from "./checkout-attempt";
import type { deviceOrderSummary } from "./DeviceOrdersSheet";

declare global {
  interface Window { deviceOrdersFixture: { journal: typeof Journal; summary: typeof deviceOrderSummary; slowResponses?: number } }
}
const orderId = (n: number) => n.toString(16).padStart(24, "0");
const response = (n: number, changes: Record<string, unknown> = {}) => ({ _id: orderId(n), number: n, status: "preparing", fulfillment: "pickup", pickupSlot: null, ...changes });
let server: Server, browser: Browser, context: BrowserContext, page: Page, origin: string;
let faults: string[], requests: string[], states: Map<string, unknown>, hold: boolean;
let waiting: { res: ServerResponse; body: unknown }[], inFlight: number, maxInFlight: number;
let evidence: string | undefined;

// The real Sheet, Storefront, tracking client and native IndexedDB execute.
// Only the server API is a local fixture. This is not a Next/Stripe/real-order test.
beforeAll(async () => {
  const root = fileURLToPath(new URL(".", import.meta.url));
  const cssPath = fileURLToPath(new URL("../../app/globals.css", import.meta.url));
  const [bundle, css] = await Promise.all([
    build({ stdin: { contents: `import React,{useState} from 'react';import {createRoot} from 'react-dom/client';
      import {DeviceOrdersSheet,deviceOrderSummary} from './DeviceOrdersSheet';import * as journal from './checkout-attempt';
      import {Storefront} from './Storefront';import {orderingApi} from './api';import {demoSite} from './demo/fixture';
      import {marqueDeRepli} from '@sm/contracts';import {styleDuMasque} from '../masque/styleDuMasque';
      window.deviceOrdersFixture={journal,summary:deviceOrderSummary};
      function Fixture(){const [open,setOpen]=useState(false);const [slug,setSlug]=useState('recette');return <main style={styleDuMasque(marqueDeRepli(null,null))} className="min-h-dvh bg-bg p-4 text-ink"><button onClick={()=>setOpen(true)}>Mes commandes sur cet appareil</button><button onClick={()=>setSlug('autre')}>Changer le restaurant de recette</button><DeviceOrdersSheet open={open} onClose={()=>setOpen(false)} slug={slug} tenantName={slug==='recette'?'Le Comptoir':'Autre restaurant'}/></main>}
      async function start(){let node=<Fixture/>;if(location.pathname==='/storefront'){const raw=demoSite(new Date(),()=>0);raw.tenant.slug='recette';raw.tenant.brand=marqueDeRepli(null,null);raw.menu={categories:[{_id:'${"c".repeat(24)}',name:'Boissons',products:[{_id:'${"d".repeat(24)}',name:'Canette recette',price:150,available:true,stockout:false,variants:[],optionGroups:[],ingredients:[],supplements:[],photoUrl:null}]}]};const site=await orderingApi({send:async()=>({status:200,body:raw})}).loadSite('recette');node=<Storefront site={site}/>;}createRoot(document.getElementById('root')).render(<React.StrictMode>{node}</React.StrictMode>)}start();`, resolveDir: root, sourcefile: "device-orders-fixture.tsx", loader: "tsx" },
      bundle: true, write: false, outdir: "/virtual-device-orders", format: "esm", platform: "browser", target: "es2022", jsx: "automatic",
      // Next is hoisted, React is also present in the app. Match Next's single
      // React runtime instead of bundling two physical copies in this renderer.
      alias: { react: fileURLToPath(new URL("../../../node_modules/react", import.meta.url)), "react-dom": fileURLToPath(new URL("../../../node_modules/react-dom", import.meta.url)) },
      plugins: [{ name: "provider-boundaries", setup(builder) {
        builder.onResolve({ filter: /\/StripeCard$/ }, () => ({ path: "stripe", namespace: "device-fixture" }));
        builder.onLoad({ filter: /^stripe$/, namespace: "device-fixture" }, () => ({ contents: "export const apparenceStripeDe=()=>({});export function StripeCard(){return null}" }));
        builder.onResolve({ filter: /^next\/font\/google$/ }, () => ({ path: "font", namespace: "device-fixture" }));
        builder.onLoad({ filter: /^font$/, namespace: "device-fixture" }, () => ({ contents: `const font=()=>({variable:'',className:'',style:{fontFamily:'Arial'}});export {${["Alegreya_Sans", "Archivo", "Archivo_Black", "Bricolage_Grotesque", "Cormorant_Garamond", "Familjen_Grotesk", "Figtree", "Fraunces", "Instrument_Sans", "JetBrains_Mono", "Lato", "Libre_Baskerville", "Manrope", "Nunito", "Nunito_Sans", "Outfit", "Playfair_Display", "Source_Sans_3"].map(name => `font as ${name}`).join(",")}}` }));
      } }], define: { "process.env": "{}", "process.env.NODE_ENV": '"production"', "process.env.NEXT_PUBLIC_API_URL": '"/api"' } }),
    readFile(cssPath, "utf8").then(source => postcss([tailwind({ base: fileURLToPath(new URL("../../..", import.meta.url)) })]).process(source, { from: cssPath })),
  ]);
  const js = bundle.outputFiles.find(file => file.path.endsWith(".js"))!.text;
  const styles = css.css + (bundle.outputFiles.find(file => file.path.endsWith(".css"))?.text ?? "");
  server = createServer((req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const path = new URL(req.url ?? "/", origin).pathname;
    if (path === "/bundle.js" || path === "/style.css") { res.setHeader("Content-Type", path.endsWith("js") ? "text/javascript" : "text/css"); res.end(path.endsWith("js") ? js : styles); return; }
    if (path === "/sheet" || path === "/storefront") { res.setHeader("Content-Type", "text/html"); res.end('<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"></head><body><div id="root"></div><script type="module" src="/bundle.js"></script></body></html>'); return; }
    res.setHeader("Content-Type", "application/json");
    if (path.startsWith("/api/public/orders/") && req.method === "GET") {
      requests.push(path); const body = states.get(path.split("/").pop()!);
      if (!body) { res.writeHead(404).end("{}"); return; }
      if (hold) { inFlight++; maxInFlight = Math.max(maxInFlight, inFlight); res.on("close", () => { inFlight--; }); waiting.push({ res, body }); return; }
      res.end(JSON.stringify(body)); return;
    }
    if (path === "/api/public/funnel" || path === "/favicon.ico") { res.end("{}"); return; }
    // Storefront recovery may check the closed account capability. This fixture
    // has no account publication and must never issue a private session/write.
    if (path === "/r/recette/compte/capacites" && req.method === "GET") { res.writeHead(503).end('{"code":"CUSTOMER_UNAVAILABLE"}'); return; }
    // No customer account, payment or external resources are supplied here.
    if (path.includes("loyalty")) { res.writeHead(401).end("{}"); return; }
    faults.push(`Unexpected fixture route ${path}`); res.writeHead(404).end("{}");
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); if (!address || typeof address === "string") throw new Error("No local port"); origin = `http://127.0.0.1:${address.port}`;
  browser = await chromium.launch({ headless: true });
  if (process.env.QA_DEVICE_ORDERS_CAPTURE === "1") { evidence = await mkdtemp(join(tmpdir(), "sm-device-orders-")); process.stdout.write(`Device-orders fixture captures: ${evidence}\n`); }
}, 30_000);
beforeEach(async () => {
  faults = []; requests = []; states = new Map(); hold = false; waiting = []; inFlight = 0; maxInFlight = 0;
  context = await browser.newContext({ viewport: { width: 320, height: 780 }, reducedMotion: "reduce", serviceWorkers: "block" });
  await context.route("**/*", route => { if (new URL(route.request().url()).origin === origin) return route.continue(); faults.push("External request refused"); return route.abort(); });
  page = await context.newPage(); page.setDefaultTimeout(5_000); page.on("pageerror", error => faults.push(error.stack ?? error.message));
  await page.goto(origin + "/sheet"); await page.waitForFunction(() => Boolean(window.deviceOrdersFixture));
});
afterEach(async () => { waiting.forEach(({ res }) => res.destroy()); await context?.close(); expect(faults).toEqual([]); });
afterAll(async () => { await browser?.close(); if (server) await new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()); }); });
const seed = (number = 1, active = false, tenant = "recette", delivery = false) => page.evaluate(async ({ number, active, tenant, delivery, id }) => {
  const journal = window.deviceOrdersFixture.journal;
  const payload: Journal.CheckoutBusinessPayload = { lines: [{ productId: "d".repeat(24), options: [], removed: [], qty: 1 }], payment: { method: "online" }, pickup: { slot: "2030-09-07T12:00:00.000Z", customerName: "Recette locale", customerPhone: "0000000000" }, ...(delivery ? { fulfillment: "delivery" as const, delivery: { address: { line1: "1 rue de Test", postalCode: "27910", city: "Ville Test", country: "FR" as const } } } : {}) };
  const result = await journal.acquireCheckoutAttempt(tenant, { payload, cartFingerprint: "a".repeat(64) });
  await journal.recordCheckoutReceipt(tenant, result.attempt.clientId, { orderId: id, trackingToken: `tracking-${number}`, number, type: delivery ? "delivery" : "pickup", status: "delivered", payment: { method: "online", status: "paid" } });
  if (!active) await journal.archiveCheckoutAttempt(tenant, result.attempt.clientId);
}, { number, active, tenant, delivery, id: orderId(number) });
const open = async () => { await page.getByRole("button", { name: "Mes commandes sur cet appareil", exact: true }).click(); await page.getByRole("dialog", { name: "Mes commandes", exact: true }).waitFor(); };
const row = (n: number) => page.getByRole("listitem").filter({ has: page.getByRole("heading", { name: `Commande n° ${n}`, exact: true }) });
const idle = () => page.getByRole("button", { name: "Actualiser les états", exact: true }).waitFor();
const read = () => page.evaluate(() => window.deviceOrdersFixture.journal.readDeviceCheckoutReceipts("recette"));

describe("Mes commandes sur cet appareil — rendu et IndexedDB natifs", () => {
  it("ouvre à la demande, distingue les états serveur et inconnus, sans faux payé depuis le reçu", async () => {
    for (let n = 1; n <= 4; n++) await seed(n, false, "recette", n === 2);
    states.set(orderId(1), response(1, { status: "ready", payment: { method: "online", status: "pending" } }));
    states.set(orderId(2), response(2, { status: "ready", fulfillment: "delivery", delivery: { dispatchedAt: "2030-09-07T12:00:00.000Z" }, payment: { method: "online", status: "paid" } }));
    states.set(orderId(3), response(3, { status: "delivered" }));
    expect(requests).toEqual([]); await open(); await idle();
    expect(await row(1).textContent()).toContain("Paiement à confirmer"); expect(await row(2).textContent()).toContain("En route");
    expect(await row(3).textContent()).toContain("Remise au client"); expect(await row(4).textContent()).toContain("État inconnu");
    expect(await page.getByRole("region", { name: "En cours" }).count()).toBe(1); expect(await page.getByText("Payé", { exact: false }).count()).toBe(0);
    const hrefs = await page.getByRole("link").evaluateAll(links => links.map(link => (link as HTMLAnchorElement).getAttribute("href")));
    expect(hrefs).toHaveLength(4); expect(hrefs.every(href => href?.startsWith("/t/") && !href.includes("#"))).toBe(true);
    if (evidence) await page.screenshot({ path: join(evidence, "orders-320.png"), fullPage: true });
  });
  it("limite la lecture à huit reçus et trois requêtes simultanées puis charge explicitement la suite", async () => {
    for (let n = 1; n <= 10; n++) { await seed(n); states.set(orderId(n), response(n)); }
    hold = true; await open(); await expect.poll(() => waiting.length).toBe(3); expect(requests).toHaveLength(3);
    hold = false; waiting.splice(0).forEach(({ res, body }) => res.end(JSON.stringify(body))); await idle();
    expect(maxInFlight).toBe(3); expect(requests).toHaveLength(8); expect(await page.getByRole("listitem").count()).toBe(8);
    await page.getByRole("button", { name: "Afficher plus de commandes (2)" }).click(); await expect.poll(() => page.getByRole("listitem").count()).toBe(10); await idle();
  });
  it("ne recommence pas un lot paginé encore en cours au tick périodique et atteint le dernier reçu", async () => {
    for (let n = 1; n <= 16; n++) { await seed(n); states.set(orderId(n), response(n)); }
    await open(); await idle(); await page.clock.install();
    // Keep real HTTP and response bodies; delay each response below the 8s
    // timeout using the browser clock. Six batches take longer than one tick.
    await page.evaluate(() => {
      const nativeFetch = window.fetch.bind(window);
      window.deviceOrdersFixture.slowResponses = 0;
      window.fetch = async (...args) => {
        const result = await nativeFetch(...args);
        if (String(args[0]).includes("/public/orders/")) {
          window.deviceOrdersFixture.slowResponses!++;
          await new Promise(resolve => setTimeout(resolve, 7_000));
        }
        return result;
      };
    });
    await page.getByRole("button", { name: "Afficher plus de commandes (8)" }).click();
    for (let batch = 1; batch <= 6; batch++) {
      // Join the real HTTP response before advancing its synthetic 7s delay.
      await expect.poll(() => page.evaluate(() => window.deviceOrdersFixture.slowResponses)).toBe(Math.min(batch * 3, 16));
      await page.clock.runFor(7_000);
    }
    await idle();
    expect(requests).toContain(`/api/public/orders/${orderId(1)}`);
    expect(await row(1).textContent()).toContain("En préparation");
    expect(await page.getByText("En préparation", { exact: true }).count()).toBe(16);
  });
  it.each([undefined, { method: "counter", status: "pending" }, { method: "online", status: "pending" }])("ne promet pas de progression livraison sans paiement confirmé (%j)", async payment => {
    await seed(1, false, "recette", true);
    states.set(orderId(1), response(1, { status: "ready", fulfillment: "delivery", delivery: { dispatchedAt: "2030-09-07T12:00:00.000Z" }, ...(payment ? { payment } : {}) }));
    await open(); await idle();
    expect(await row(1).textContent()).toContain("Paiement à confirmer");
    expect(await row(1).textContent()).not.toMatch(/En route|Prête à partir|En préparation/);
  });
  it.each(["hidden", "offline"])("efface les anciens états et ignore une réponse après %s, puis vérifie au retour", async mode => {
    await seed(); states.set(orderId(1), response(1)); await open(); await idle();
    hold = true; await page.getByRole("button", { name: "Actualiser les états" }).click(); await expect.poll(() => waiting.length).toBe(1);
    await page.evaluate(mode => {
      if (mode === "hidden") { Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" }); document.dispatchEvent(new Event("visibilitychange")); }
      else { Object.defineProperty(navigator, "onLine", { configurable: true, value: false }); window.dispatchEvent(new Event("offline")); }
    }, mode);
    waiting.splice(0).forEach(({ res, body }) => res.end(JSON.stringify(body)));
    await page.getByText("Connexion requise", { exact: false }).waitFor(); expect(await row(1).textContent()).toContain("État inconnu");
    await page.clock.install(); await page.clock.runFor(31_000); expect(requests).toHaveLength(2);
    hold = false; states.set(orderId(1), response(1, { status: "ready" }));
    await page.evaluate(mode => {
      if (mode === "hidden") { Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" }); document.dispatchEvent(new Event("visibilitychange")); }
      else { Object.defineProperty(navigator, "onLine", { configurable: true, value: true }); window.dispatchEvent(new Event("online")); }
    }, mode);
    await page.getByText("Prête à retirer", { exact: true }).waitFor();
  });
  it("oublie seulement après confirmation, conserve la preuve privée et refuse le reçu encore actif durablement", async () => {
    await seed(1, false, "recette", true); await seed(2, true); states.set(orderId(1), response(1)); states.set(orderId(2), response(2));
    await open(); await idle(); await row(1).getByRole("button", { name: "Oublier ce raccourci", exact: true }).click();
    await expect.poll(() => page.getByRole("button", { name: "Garder le raccourci" }).evaluate(element => element === document.activeElement)).toBe(true);
    await page.getByRole("button", { name: "Garder le raccourci" }).click(); expect(await read()).toHaveLength(2);
    await row(1).getByRole("button", { name: "Oublier ce raccourci", exact: true }).click(); await page.getByRole("button", { name: "Oublier le raccourci", exact: true }).click(); await idle();
    await expect.poll(async () => (await read()).length).toBe(1);
    expect(await page.evaluate(id => window.deviceOrdersFixture.journal.readDeliveryCheckoutReceipt("recette", id), orderId(1))).not.toBeNull();
    await row(2).getByRole("button", { name: "Oublier ce raccourci", exact: true }).click(); await page.getByRole("button", { name: "Oublier le raccourci", exact: true }).click(); await idle();
    await page.getByRole("alert").filter({ hasText: "protège encore" }).waitFor(); expect(await read()).toHaveLength(1);
    await page.getByRole("button", { name: "Actualiser les états" }).click(); await idle(); expect(await page.getByRole("alert").textContent()).toContain("protège encore");
  });
  it("respecte le focus, le clavier, le mouvement réduit et les largeurs 320px/bureau", async () => {
    await seed(); states.set(orderId(1), response(1)); await open(); await idle();
    for (const width of [320, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      expect(await page.getByRole("dialog").evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
      await page.keyboard.press("Tab"); expect(await page.getByRole("dialog").evaluate(element => element.contains(document.activeElement))).toBe(true);
    }
    const unsafe: unknown[] = [];
    await expect.poll(async () => {
      const animations = await page.evaluate(() => document.getAnimations().filter(animation => animation.playState !== "finished" && animation.playState !== "idle").map(animation => {
      const timing = animation.effect?.getComputedTiming(); return { duration: timing?.duration, iterations: timing?.iterations, rate: animation.playbackRate };
      }));
      unsafe.push(...animations.filter(timing => typeof timing.duration !== "number" || timing.duration > 1 || timing.iterations !== 1 || timing.rate !== 1));
      return { unsafe, remaining: animations.length };
    }, { timeout: 500 }).toEqual({ unsafe: [], remaining: 0 });
    if (evidence) await page.screenshot({ path: join(evidence, "orders-desktop.png"), fullPage: true });
    await page.keyboard.press("Escape"); await page.getByRole("dialog").waitFor({ state: "detached" });
    expect(await page.getByRole("button", { name: "Mes commandes sur cet appareil" }).evaluate(element => element === document.activeElement)).toBe(true);
    await page.clock.install(); await page.clock.runFor(31_000); expect(requests).toHaveLength(1);
  });
  it("aucun reçu d’un autre restaurant, et une erreur de stockage ne se fait pas passer pour une liste vide", async () => {
    await seed(1, false, "autre"); await open(); await page.getByText("Aucune commande enregistrée ici").waitFor(); expect(requests).toEqual([]);
    await page.keyboard.press("Escape"); await page.getByRole("dialog").waitFor({ state: "detached" });
    await page.evaluate(() => { IDBFactory.prototype.open = () => { throw new DOMException("Denied", "SecurityError"); }; });
    await open(); await page.getByRole("alert").filter({ hasText: "ne peuvent pas être relus" }).waitFor(); expect(requests).toEqual([]);
    expect(await page.getByText("Aucune commande enregistrée ici").count()).toBe(0);
  });
  it("raccorde le vrai Storefront indépendamment du panier et laisse la reprise disponible", async () => {
    await page.goto(origin + "/storefront"); await page.getByRole("button", { name: "Mes commandes sur cet appareil" }).waitFor();
    await page.getByRole("region", { name: "Boissons", exact: true }).getByRole("button", { name: /Canette recette/ }).click();
    await expect.poll(() => page.evaluate(() => localStorage.getItem("sm.cart.recette"))).toContain("Canette recette");
    const before = await page.evaluate(() => localStorage.getItem("sm.cart.recette"));
    await seed(1, true); states.set(orderId(1), response(1)); await open(); await idle(); await page.keyboard.press("Escape"); await page.getByRole("dialog").waitFor({ state: "detached" });
    expect(await page.evaluate(() => localStorage.getItem("sm.cart.recette"))).toBe(before);
    await page.getByRole("button", { name: /Ma commande en cours/ }).waitFor();
  });
  it("classe uniquement une réponse corrélée et valide : annulation, remboursement et absence de paiement", async () => {
    const result = await page.evaluate(({ id }) => {
      const summarize = window.deviceOrdersFixture.summary;
      const base = { _id: id, number: 1, status: "new" };
      const rejects = (value: unknown) => { try { summarize(value, id); return false; } catch { return true; } };
      return { legacy: summarize(base, id), cancelled: summarize({ ...base, status: "cancelled" }, id), refunded: summarize({ ...base, payment: { method: "online", status: "refunded" } }, id), wrong: rejects({ ...base, _id: "wrong" }), malformed: rejects({ ...base, status: "invented" }) };
    }, { id: orderId(1) });
    expect(result.legacy.label).toBe("Commande reçue"); expect(result.cancelled.section).toBe("finished"); expect(result.refunded.label).toContain("remboursé"); expect(result.wrong).toBe(true); expect(result.malformed).toBe(true);
  });
});
