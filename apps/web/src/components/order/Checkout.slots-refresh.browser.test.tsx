import { createServer, type Server, type ServerResponse } from "node:http";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";
import { chromium, type Browser, type BrowserContext, type Locator, type Page } from "playwright";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { SlotsResponse } from "@sm/contracts";

declare global { interface Window { checkoutSlotsFixture: { settled: number[]; forbidden: number } } }
let server: Server, browser: Browser, context: BrowserContext, page: Page, origin: string;
let requests: { response: ServerResponse; url: URL }[], faults: string[];
let evidence: string | undefined;
const day = "2030-09-08", tomorrow = "2030-09-09";
function slots(date = day, times = ["18:00", "18:10"], full = false): SlotsResponse {
  return { date, timezone: "Europe/Paris", intervalMin: 10, capacity: 4, leadTimeMin: 30,
    slots: times.map((label, index) => ({ iso: `${date}T${label}:00+02:00`, label, service: "dinner",
      remaining: full && index === 0 ? 0 : 4, full: full && index === 0, load: full && index === 0 ? "full" : "calm" })),
    closedToday: times.length === 0, nextOpenDate: null, closureReason: null, paused: false };
}

// Real Checkout, Sheet, customer/recovery hooks and CSS. Only API/provider ports
// are fixtures; no Next server, real order, payment, account or provider is used.
beforeAll(async () => {
  const cssPath = fileURLToPath(new URL("../../app/globals.css", import.meta.url));
  const bundle = await build({ stdin: { contents: `import React from 'react';import{createRoot}from'react-dom/client';
    import{Checkout}from'./Checkout';import{useCheckoutRecovery}from'./useCheckoutRecovery';
    import{SlotsResponseSchema,marqueDeRepli}from'@sm/contracts';import{styleDuMasque}from'../masque/styleDuMasque';
    const fixture=window.checkoutSlotsFixture={settled:[],forbidden:0};
    const forbid=()=>{fixture.forbidden++;throw Error('Forbidden fixture operation')};
    const cart={lines:[{lineId:'line',productId:'${"a".repeat(24)}',name:'Article de recette',photoUrl:null,variantKey:null,variantName:null,options:[],removed:[],note:null,qty:1,unitPrice:500}],
      note:'',count:1,subtotal:500,hydrated:true,dropped:[],persistenceError:null,clearDropped:()=>{},upsert:forbid,setQty:forbid,remove:forbid,setNote:()=>{},clear:forbid,clearIfUnchanged:forbid};
    const api={loadSlots:async(slug,date,signal,fulfillment)=>{
      // Deliberately finish even after abort: late data must not regain authority.
      const response=await fetch('/slots?'+new URLSearchParams({slug,date:date??'',fulfillment}));
      const body=await response.json();fixture.settled.push(body.id);
      if(body.error)throw Error('Slots fixture unavailable');return SlotsResponseSchema.parse(body.slots);
    },quoteDelivery:async()=>({zoneId:'zone',zoneName:'Zone de recette',feeCents:0,minimumOrderCents:0,subtotalCents:500,totalCents:500,estimatedMinutes:45}),
      createOrder:forbid,paymentIntent:forbid,recoverOrder:forbid,abandonOrderAttempt:forbid};
    function App(){const[open,setOpen]=React.useState(true);const recovery=useCheckoutRecovery('recette',false,false);
      return <main style={styleDuMasque(marqueDeRepli(null,null))} className="min-h-dvh bg-bg text-ink">
        <h1>Créneaux de recette</h1><button onClick={()=>setOpen(true)}>Rouvrir le panier</button>
        <Checkout open={open} onClose={()=>setOpen(false)} onBrowse={()=>{}} onEditLine={()=>{}} slug="recette" tenantName="Restaurant de recette" tenantAddress="Adresse de recette"
          recovery={recovery} cart={cart} paused={false} pauseMessage={null} initialSlots={${JSON.stringify(slots())}}
          delivery={{available:true,zones:[],leadTimeMin:45,paymentRequired:'online'}} stripeApparence={{}} mode="dark" prixMono={false} api={api} customerAccountEnabled={false}/>
      </main>}
    createRoot(document.getElementById('root')).render(<React.StrictMode><App/></React.StrictMode>);`,
    resolveDir: fileURLToPath(new URL(".", import.meta.url)), sourcefile: "checkout-slots-entry.tsx", loader: "tsx" },
    bundle: true, write: false, outdir: "/virtual-checkout-slots", format: "esm", platform: "browser", target: "es2022", jsx: "automatic",
    alias: { react: fileURLToPath(new URL("../../../node_modules/react", import.meta.url)), "react-dom": fileURLToPath(new URL("../../../node_modules/react-dom", import.meta.url)) },
    define: { "process.env": "{}", "process.env.NODE_ENV": '"development"' },
    plugins: [{ name: "no-payment-provider", setup(builder) {
      builder.onResolve({ filter: /\/(StripeCard|TurnstileCheck)$/ }, args => ({ path: args.path.split("/").at(-1)!, namespace: "slots-provider" }));
      builder.onLoad({ filter: /.*/, namespace: "slots-provider" }, args => ({ contents: `export function ${args.path}(){return null}` }));
    } }],
  });
  const css = await postcss([tailwind({ base: fileURLToPath(new URL("../../..", import.meta.url)) })])
    .process(await readFile(cssPath, "utf8"), { from: cssPath });
  server = createServer((req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const url = new URL(req.url!, "http://fixture.local");
    if (req.method !== "GET") { faults.push("Mutation HTTP refused"); res.writeHead(405).end(); return; }
    if (url.pathname === "/slots") { requests.push({ response: res, url }); return; }
    if (url.pathname === "/app.js") { res.setHeader("Content-Type", "text/javascript"); res.end(bundle.outputFiles.find(file => file.path.endsWith(".js"))!.text); return; }
    if (url.pathname === "/style.css") { res.setHeader("Content-Type", "text/css"); res.end(css.css + (bundle.outputFiles.find(file => file.path.endsWith(".css"))?.text ?? "")); return; }
    if (url.pathname === "/favicon.ico") { res.writeHead(204).end(); return; }
    if (url.pathname !== "/") { faults.push("Unexpected local request"); res.writeHead(404).end(); return; }
    res.setHeader("Content-Type", "text/html"); res.end('<!doctype html><html lang="fr"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Checkout slots fixture</title><link rel="stylesheet" href="/style.css"><div id="root"></div><script type="module" src="/app.js"></script></html>');
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); if (!address || typeof address === "string") throw new Error("No fixture port");
  origin = `http://127.0.0.1:${address.port}`; browser = await chromium.launch({ headless: true });
  if (process.env.QA_CHECKOUT_SLOTS_CAPTURE === "1") { evidence = await mkdtemp(join(tmpdir(), "sm-checkout-slots-")); process.stdout.write(`Checkout slots captures: ${evidence}\n`); }
}, 30_000);
beforeEach(async () => {
  requests = []; faults = [];
  context = await browser.newContext({ viewport: { width: 320, height: 780 }, reducedMotion: "reduce", serviceWorkers: "block" });
  await context.route("**/*", route => {
    if (new URL(route.request().url()).origin === origin) return route.continue();
    faults.push("External request refused"); return route.abort();
  });
  page = await context.newPage(); page.setDefaultTimeout(5_000);
  page.on("pageerror", error => faults.push(error.message));
  page.on("console", message => { if (["warning", "error"].includes(message.type())) faults.push(message.text()); });
  await page.goto(origin); await page.getByRole("dialog", { name: "Votre commande", exact: true }).waitFor();
  expect(await page.title()).toBe("Checkout slots fixture");
  expect(page.url()).toBe(origin + "/");
});
afterEach(async () => {
  const forbidden = await page.evaluate(() => window.checkoutSlotsFixture.forbidden).catch(() => -1);
  for (const { response } of requests) if (!response.writableEnded) response.end();
  await context?.close();
  expect(forbidden).toBe(0); expect(faults).toEqual([]);
});
afterAll(async () => { await browser?.close(); if (server) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); });

async function activate(locator: Locator) { await expect.poll(() => locator.isEnabled()).toBe(true); await locator.focus(); await locator.press("Enter"); }
const next = () => page.getByRole("button", { name: /^Continuer · retrait|^Continuer · livraison|^Choisissez un créneau/ });
const slot = (time = "18:00") => page.getByRole("button", { name: new RegExp(`^${time}(?: —|$)`) });
async function frames() { await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))); }
async function requestCount(count: number) { await expect.poll(() => requests.length).toBe(count); }
async function reply(index: number, value = slots(), error = false) {
  requests[index]!.response.setHeader("Content-Type", "application/json");
  requests[index]!.response.end(JSON.stringify({ id: index, slots: value, error }));
  await page.waitForFunction(index => window.checkoutSlotsFixture.settled.includes(index), index); await frames();
}
async function customer() {
  await activate(page.getByRole("button", { name: /^Choisir la livraison/ }));
  await page.getByRole("textbox", { name: "Prénom et nom", exact: true }).fill("Camille Recette");
  await page.getByRole("textbox", { name: "Téléphone", exact: true }).fill("0600000000");
}
async function enterSlots() { await activate(page.getByRole("button", { name: /^Choisir le retrait/ })); await requestCount(1); }
async function manual() { await activate(page.getByRole("radio", { name: /Choisir une heure/ })); }
async function selectedReentry() {
  await enterSlots(); await reply(0); await manual(); await activate(slot()); await activate(next());
  await page.getByRole("dialog", { name: "Paiement", exact: true }).waitFor();
  await activate(page.getByRole("button", { name: /^Retrait — terminé/ })); await requestCount(2);
}

describe("actualisation des créneaux — vrai Checkout et HTTP local retenu", () => {
  it("Au plus tôt utilise le premier créneau libre du serveur et garde les coordonnées au paiement", async () => {
    await enterSlots(); expect(await next().isDisabled()).toBe(true);
    await reply(0, slots(day, undefined, true));
    expect(await next().textContent()).toContain("18:10");
    expect(await page.getByRole("radio", { name: /Au plus tôt/ }).getAttribute("aria-checked")).toBe("true");
    await activate(next());
    expect(await page.getByRole("textbox", { name: "Prénom et nom", exact: true }).count()).toBe(1);
    expect(await page.getByRole("textbox", { name: "Téléphone", exact: true }).count()).toBe(1);
    expect(await page.getByRole("button", { name: /Nom et téléphone requis/ }).isDisabled()).toBe(true);
  });
  it("Au plus tôt n’autorise rien quand aucun créneau n’est disponible", async () => {
    await enterSlots(); await reply(0, { ...slots(), slots: slots().slots.map(slot => ({ ...slot, full: true, remaining: 0, load: "full" })) });
    expect(await next().isDisabled()).toBe(true);
    expect(await page.getByRole("radio", { name: /Au plus tôt/ }).isDisabled()).toBe(true);
  });
  it("revenir à Au plus tôt utilise la dernière liste vérifiée sans refaire une requête", async () => {
    await enterSlots(); await reply(0); await manual(); await activate(slot("18:10"));
    await activate(page.getByRole("radio", { name: /Au plus tôt/ }));
    expect(await next().textContent()).toContain("18:00"); expect(requests).toHaveLength(1);
    await activate(next()); await activate(page.getByRole("button", { name: /^Retrait — terminé/ })); await requestCount(2);
    expect(await next().isDisabled()).toBe(true); await reply(1, slots(day, ["18:20"]));
    expect(await next().textContent()).toContain("18:20");
  });
  it.each([320, 1440])("bloque l’ancienne grille et annonce l’actualisation à %i px", async width => {
    await page.setViewportSize({ width, height: 780 });
    await enterSlots();
    expect(await slot().count()).toBe(0); expect(await next().isDisabled()).toBe(true);
    expect(await page.getByRole("status").filter({ hasText: "Actualisation des créneaux" }).count()).toBe(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    if (evidence) await page.screenshot({ path: join(evidence, `loading-${width}.png`) });
    await reply(0); await manual(); expect(await slot().isEnabled()).toBe(true); expect(await next().isDisabled()).toBe(true);
  });
  it("bloque aussi Continuer avec une sélection antérieure tant que la relecture est retenue", async () => {
    await selectedReentry();
    expect(await slot().isDisabled()).toBe(true); expect(await next().isDisabled()).toBe(true);
    await reply(1); expect(await slot().getAttribute("aria-pressed")).toBe("true");
    expect(await next().textContent()).toContain("18:00"); expect(await next().isEnabled()).toBe(true);
    await activate(next()); expect(await page.getByRole("dialog", { name: "Paiement", exact: true }).count()).toBe(1);
  });
  it.each(["retiré", "complet"])("efface le créneau %s sans sélectionner le suivant", async kind => {
    await selectedReentry(); await reply(1, kind === "retiré" ? slots(day, ["18:10"]) : slots(day, undefined, true));
    expect(await slot("18:10").getAttribute("aria-pressed")).toBe("false");
    expect(await next().isDisabled()).toBe(true);
    await activate(slot("18:10")); expect(await next().textContent()).toContain("18:10");
  });
  it("ne laisse pas continuer sur une erreur, puis conserve l’ISO lors du réessai réussi", async () => {
    await selectedReentry(); await reply(1, slots(), true);
    expect(await page.getByText("Créneaux indisponibles", { exact: true }).count()).toBe(1);
    expect(await next().isDisabled()).toBe(true);
    await activate(page.getByRole("button", { name: "Réessayer", exact: true })); await requestCount(3);
    expect(await slot().isDisabled()).toBe(true); expect(await next().isDisabled()).toBe(true);
    await reply(2); expect(await slot().getAttribute("aria-pressed")).toBe("true"); expect(await next().isEnabled()).toBe(true);
  });
  it("écarte un ancien réessai après sortie/réentrée, même s’il finit après la nouvelle lecture", async () => {
    await enterSlots(); await reply(0, slots(), true);
    await activate(page.getByRole("button", { name: "Réessayer", exact: true })); await requestCount(2);
    await activate(page.getByRole("button", { name: "Étape précédente", exact: true }));
    await activate(page.getByRole("button", { name: /^Choisir le retrait/ })); await requestCount(3);
    await reply(2, slots(day, ["18:10"])); await manual(); await activate(slot("18:10"));
    await reply(1); expect(await slot("18:00").count()).toBe(0);
    expect(await slot("18:10").getAttribute("aria-pressed")).toBe("true");
  });
  it("une date demandée bloque l’ancienne grille et ne réutilise pas l’ISO d’un autre jour", async () => {
    await enterSlots(); await reply(0, { ...slots(), nextOpenDate: tomorrow }); await manual(); await activate(slot());
    await activate(page.getByRole("button", { name: "Lun. 9 septembre", exact: true })); await requestCount(2);
    expect(requests[1]!.url.searchParams.get("date")).toBe(tomorrow);
    expect(await slot().isDisabled()).toBe(true); expect(await next().isDisabled()).toBe(true);
    await reply(1, slots(tomorrow)); expect(await slot().getAttribute("aria-pressed")).toBe("false");
    expect(await next().isDisabled()).toBe(true);
  });
  it("écarte une réponse d’un ancien réessai après sélection d’une autre date", async () => {
    await enterSlots(); await reply(0, slots(), true);
    await activate(page.getByRole("button", { name: "Réessayer", exact: true })); await requestCount(2);
    await activate(page.getByRole("button", { name: "Étape précédente", exact: true }));
    await activate(page.getByRole("button", { name: /^Choisir le retrait/ })); await requestCount(3);
    await reply(2, { ...slots(), nextOpenDate: tomorrow }); await manual();
    await activate(page.getByRole("button", { name: "Lun. 9 septembre", exact: true })); await requestCount(4);
    await reply(3, slots(tomorrow, ["19:00"])); await activate(slot("19:00")); await reply(1);
    expect(await slot("18:00").count()).toBe(0); expect(await slot("19:00").getAttribute("aria-pressed")).toBe("true");
    await activate(next()); expect(await page.getByText("Lun. 9 septembre · 19:00", { exact: true }).count()).toBe(1);
  });
  it("une réponse ne correspondant pas à la date demandée ne rouvre pas la progression", async () => {
    await enterSlots(); await reply(0, { ...slots(), nextOpenDate: tomorrow }); await manual(); await activate(slot());
    await activate(page.getByRole("button", { name: "Lun. 9 septembre", exact: true })); await requestCount(2);
    await reply(1, slots(day));
    expect(await page.getByText("Créneaux indisponibles", { exact: true }).count()).toBe(1);
    expect(await next().isDisabled()).toBe(true);
  });
  it("un ancien retrait ne remplace pas les créneaux de livraison", async () => {
    await enterSlots(); await reply(0, slots(), true);
    await activate(page.getByRole("button", { name: "Réessayer", exact: true })); await requestCount(2);
    await activate(page.getByRole("button", { name: /^Panier — terminé/ }));
    await activate(page.getByRole("radio", { name: /Livraison chez vous/ })); await customer();
    await page.getByLabel("Numéro et rue", { exact: true }).fill("1 rue de Recette");
    await page.getByLabel("Code postal", { exact: true }).fill("69001"); await page.getByLabel("Ville", { exact: true }).fill("Lyon");
    await activate(page.getByRole("button", { name: /Vérifier mon adresse/ }));
    await activate(page.getByRole("button", { name: "Choisir le créneau", exact: true })); await requestCount(3);
    expect(requests[2]!.url.searchParams.get("fulfillment")).toBe("delivery");
    await reply(2, slots(day, ["19:00"])); await activate(slot("19:00")); await reply(1);
    expect(await slot("18:00").count()).toBe(0); expect(await slot("19:00").getAttribute("aria-pressed")).toBe("true");
    expect(await next().textContent()).toContain("livraison 19:00");
  });
});
