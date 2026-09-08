import { createServer, type Server, type ServerResponse } from "node:http";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

declare global { interface Window { deliveryInvitationFixture: { snapshot: () => unknown; clipboardReads: number; reject: () => void } } }
let server: Server, browser: Browser, context: BrowserContext, page: Page, origin: string;
let posts: unknown[], faults: string[], reads: number, heldReads: ServerResponse[];
let readMode: "normal" | "hold" | "unavailable", firstPost: number;
let evidence: string | undefined;
const token = "I".repeat(43);
const session = { operatorId: "a".repeat(24), name: "Camille Recette", restaurantName: "Restaurant de recette",
  restaurantSlug: "recette", expiresAt: "2030-09-14T10:00:00Z" };
const cookie = "fixture_delivery_access";

// Real client/component/DS in Chromium. The injected port's HTTPS origin is a
// fixture only; native requests go to this isolated HTTP server, never a provider.
beforeAll(async () => {
  const cssPath = fileURLToPath(new URL("../globals.css", import.meta.url));
  const [bundle, css] = await Promise.all([
    build({ stdin: { contents: `import React from 'react';import{createRoot}from'react-dom/client';
      import{DeliveryInvitation}from'./DeliveryInvitation';import{createDeliveryAccessClient,secureNonce}from'./access-client';
      function App(){const[client]=React.useState(()=>createDeliveryAccessClient({origin:()=> 'https://'+location.host,fragment:()=>location.hash,removeFragment:()=>history.replaceState(history.state,'',location.pathname),online:()=>navigator.onLine!==false,
        nonce:()=>secureNonce(crypto),request:(method,body)=>fetch('/livreur/acces',{method,credentials:'same-origin',cache:'no-store',redirect:'error',headers:body?{'Content-Type':'application/json'}:{},...(body?{body:JSON.stringify(body)}:{})})}));
        const state=React.useSyncExternalStore(client.subscribe,client.getSnapshot,client.getServerSnapshot);
        React.useEffect(()=>{window.deliveryInvitationFixture.snapshot=client.getSnapshot;window.deliveryInvitationFixture.reject=client.accessRejected;void client.start()},[client]);
        return <main className="mx-auto min-h-dvh max-w-[460px] bg-bg px-5 py-7 text-ink"><h1 className="mb-6 text-2xl font-semibold">SM Livreur · Recette locale</h1>
          <output data-testid="phase">{state.phase}</output><DeliveryInvitation state={state} canImport={client.canImportInvitation()} onImport={client.importInvitation}/>
          {state.hasInvitation&&!state.session&&<button className="my-4 min-h-12" onClick={()=>void client.associate()}>{state.exchangePending?'Vérifier l’association':'Associer ce téléphone'}</button>}
          {state.session&&<p>{state.session.name}</p>}<button className="min-h-12" onClick={()=>void client.refresh()}>Vérifier mon accès</button></main>}
      window.deliveryInvitationFixture={clipboardReads:0,snapshot:()=>null,reject:()=>{}};
      Object.defineProperty(navigator,'clipboard',{value:{readText:()=>{window.deliveryInvitationFixture.clipboardReads++;throw Error('Clipboard forbidden')}}});
      createRoot(document.getElementById('root')).render(<React.StrictMode><App/></React.StrictMode>);`,
      sourcefile: "delivery-invitation-fixture.tsx", loader: "tsx", resolveDir: fileURLToPath(new URL(".", import.meta.url)) },
      bundle: true, write: false, format: "esm", platform: "browser", target: "es2022", jsx: "automatic",
      define: { "process.env.NODE_ENV": '"development"' } }),
    readFile(cssPath, "utf8").then(source => postcss([tailwind({ base: fileURLToPath(new URL("../..", import.meta.url)) })]).process(source, { from: cssPath })),
  ]);
  server = createServer(async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    if (req.url === "/livreur/acces") {
      res.setHeader("Content-Type", "application/json");
      if (req.method === "GET") {
        reads++;
        if (readMode === "hold") { heldReads.push(res); return; }
        if (readMode === "unavailable") { res.writeHead(503).end("{}"); return; }
        if (req.headers.cookie?.includes(cookie)) res.end(JSON.stringify(session)); else res.writeHead(204).end(); return;
      }
      if (req.method === "POST") {
        const chunks = []; for await (const chunk of req) chunks.push(Buffer.from(chunk));
        posts.push(JSON.parse(Buffer.concat(chunks).toString()));
        if (posts.length === 1 && firstPost !== 200) { res.writeHead(firstPost).end("{}"); return; }
        res.setHeader("Set-Cookie", `${cookie}=present; HttpOnly; SameSite=Strict; Path=/livreur`);
        res.end(JSON.stringify(session)); return;
      }
    }
    if (req.method !== "GET") { faults.push("Unexpected mutation"); res.writeHead(405).end(); return; }
    if (req.url === "/fixture.js") { res.setHeader("Content-Type", "text/javascript"); res.end(bundle.outputFiles[0].text); return; }
    if (req.url === "/fixture.css") { res.setHeader("Content-Type", "text/css"); res.end(css.css); return; }
    if (req.url === "/favicon.ico") { res.writeHead(204).end(); return; }
    if (req.url !== "/livreur") { faults.push("Unexpected path"); res.writeHead(404).end(); return; }
    res.setHeader("Content-Type", "text/html"); res.end('<!doctype html><html lang="fr"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>SM Livreur invitation fixture</title><link rel="stylesheet" href="/fixture.css"><div id="root"></div><script type="module" src="/fixture.js"></script></html>');
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); if (!address || typeof address === "string") throw new Error("No local port");
  origin = `http://127.0.0.1:${address.port}`; browser = await chromium.launch({ headless: true });
  if (process.env.QA_DELIVERY_INVITATION_CAPTURE === "1") { evidence = await mkdtemp(join(tmpdir(), "sm-delivery-invitation-")); process.stdout.write(`Invitation fixture captures: ${evidence}\n`); }
}, 30_000);
beforeEach(async () => {
  posts = []; faults = []; reads = 0; heldReads = []; readMode = "normal"; firstPost = 200;
  context = await browser.newContext({ viewport: { width: 320, height: 780 }, reducedMotion: "reduce", serviceWorkers: "block" });
  await context.route("**/*", route => {
    if (new URL(route.request().url()).origin === origin) return route.continue();
    faults.push("External request refused"); return route.abort();
  });
  page = await context.newPage(); page.setDefaultTimeout(3_000); page.on("pageerror", () => faults.push("Browser runtime error"));
  page.on("console", message => {
    if (!["error", "warning"].includes(message.type())) return;
    if (message.location().url === `${origin}/livreur/acces` && /Failed to load resource:.*(?:401|503)/.test(message.text())) return;
    faults.push("Unexpected browser warning/error");
  });
});
afterEach(async () => { for (const res of heldReads) res.writeHead(204).end(); await context?.close(); expect(faults).toEqual([]); });
afterAll(async () => { await browser?.close(); if (server) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); });
const opener = () => page.getByRole("button", { name: "Coller mon invitation", exact: true });
const field = () => page.getByLabel("Lien d’invitation", { exact: true });
const link = () => `${origin.replace("http:", "https:")}/livreur#invitation=${token}`;
async function open() { await page.goto(`${origin}/livreur`); await expect.poll(() => page.getByTestId("phase").textContent()).toBe("missing"); await opener().click(); }
async function prepare(value = link()) { await field().fill(value); await page.getByRole("button", { name: "Préparer cette invitation", exact: true }).click(); }
async function privateStateClean() {
  expect(await page.evaluate(token => [JSON.stringify(window.deliveryInvitationFixture.snapshot()), JSON.stringify(Object.entries(localStorage)),
    JSON.stringify(Object.entries(sessionStorage)), document.cookie, location.href].some(value => value.includes(token)), token)).toBe(false);
  expect(await page.evaluate(() => window.deliveryInvitationFixture.clipboardReads)).toBe(0);
  expect(await page.evaluate(() => indexedDB.databases())).toHaveLength(0);
}

describe("invitation manuelle — vrai client, formulaire et navigateur", () => {
  it.each([320, 1440])("prépare sans association automatique à %i px puis confirme par un second geste", async width => {
    await page.setViewportSize({ width, height: 780 }); await open();
    expect(await page.title()).toBe("SM Livreur invitation fixture"); expect(page.url() === `${origin}/livreur`).toBe(true);
    expect(await field().evaluate(element => element === document.activeElement)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    if (evidence) await page.screenshot({ path: join(evidence, `form-${width}.png`) });
    await prepare(); expect(posts.length).toBe(0); expect(reads).toBe(1); expect(await field().count()).toBe(0);
    await privateStateClean();
    await page.getByRole("button", { name: "Associer ce téléphone", exact: true }).click();
    await expect.poll(() => page.getByTestId("phase").textContent()).toBe("connected");
    expect(posts.length).toBe(1); expect(reads).toBe(2); await privateStateClean();
  });
  it("un lien étranger est effacé et refusé sans navigation ou requête", async () => {
    await open(); const before = reads; await prepare(`https://foreign.test/livreur#invitation=${token}`);
    expect(await page.getByRole("alert").count()).toBe(1); expect(await field().inputValue()).toBe("");
    expect(posts.length).toBe(0); expect(reads).toBe(before); expect(page.url() === `${origin}/livreur`).toBe(true); await privateStateClean();
  });
  it("fermeture et Échap effacent le champ et rendent le focus au bouton", async () => {
    await open(); await field().fill(link()); await field().press("Escape");
    expect(await field().count()).toBe(0); expect(await opener().evaluate(element => element === document.activeElement)).toBe(true);
    await opener().click(); expect(await field().inputValue()).toBe("");
    await field().fill(link()); await page.getByRole("button", { name: "Fermer la saisie", exact: true }).click();
    await opener().click(); expect(await field().inputValue()).toBe(""); expect(posts.length).toBe(0); await privateStateClean();
  });
  it("une relecture retire la saisie et une réponse inconnue ne permet pas l’import", async () => {
    await open(); await field().fill(link()); readMode = "hold";
    await page.getByRole("button", { name: "Vérifier mon accès", exact: true }).click(); await expect.poll(() => heldReads.length).toBe(1);
    expect(await field().count()).toBe(0); readMode = "unavailable"; heldReads.shift()!.writeHead(503).end("{}");
    await expect.poll(() => page.getByTestId("phase").textContent()).toBe("error");
    expect(await opener().isDisabled()).toBe(true); expect(posts.length).toBe(0);
    readMode = "normal"; await page.getByRole("button", { name: "Vérifier mon accès", exact: true }).click();
    await expect.poll(() => opener().isEnabled()).toBe(true); await opener().click(); expect(await field().inputValue()).toBe("");
  });
  it("une capture invalide demande de rouvrir une page propre, sans promettre un collage bloqué", async () => {
    await page.goto(`${origin}/livreur#invitation=short`);
    await expect.poll(() => page.getByTestId("phase").textContent()).toBe("error");
    expect(await opener().isDisabled()).toBe(true); expect(await field().count()).toBe(0);
    expect(await page.getByText(/Fermez cette page puis rouvrez SM Livreur sans lien/).count()).toBe(1);
    expect(posts.length).toBe(0); expect(reads).toBe(0); expect(page.url() === `${origin}/livreur`).toBe(true);
    await page.reload(); await expect.poll(() => opener().isEnabled()).toBe(true); expect(reads).toBe(1);
  });
  it("le callback révoqué ferme la saisie jusqu’à une nouvelle absence confirmée", async () => {
    await open(); await field().fill(link()); await page.evaluate(() => window.deliveryInvitationFixture.reject());
    await expect.poll(() => opener().isDisabled()).toBe(true); expect(await field().count()).toBe(0);
    expect(posts.length).toBe(0); expect(reads).toBe(1);
    await page.getByRole("button", { name: "Vérifier mon accès", exact: true }).click();
    await expect.poll(() => opener().isEnabled()).toBe(true); await opener().click(); expect(await field().inputValue()).toBe("");
    expect(reads).toBe(2);
  });
  it("un cookie HttpOnly caché par un GET incertain n’autorise aucun remplacement", async () => {
    await context.addCookies([{ name: cookie, value: "present", url: `${origin}/livreur`, httpOnly: true, sameSite: "Strict" }]);
    readMode = "unavailable"; await page.goto(`${origin}/livreur`);
    await expect.poll(() => page.getByTestId("phase").textContent()).toBe("error");
    expect(await opener().isDisabled()).toBe(true); expect(await field().count()).toBe(0);
    expect(await page.evaluate(cookie => document.cookie.includes(cookie), cookie)).toBe(false);
    readMode = "normal"; await page.getByRole("button", { name: "Vérifier mon accès", exact: true }).click();
    await expect.poll(() => page.getByTestId("phase").textContent()).toBe("connected");
    expect(await opener().count()).toBe(0); expect(posts.length).toBe(0); expect(reads).toBe(2);
  });
  it("une réponse d’association perdue garde la même tentative sans nouveau collage", async () => {
    firstPost = 503; await open(); await prepare();
    await page.getByRole("button", { name: "Associer ce téléphone", exact: true }).click();
    await expect.poll(() => page.getByTestId("phase").textContent()).toBe("error");
    expect(await opener().count()).toBe(0); expect(await field().count()).toBe(0);
    await page.getByRole("button", { name: "Vérifier l’association", exact: true }).click();
    await expect.poll(() => page.getByTestId("phase").textContent()).toBe("connected");
    expect(posts.length).toBe(2); expect(JSON.stringify(posts[0]) === JSON.stringify(posts[1])).toBe(true); await privateStateClean();
  });
  it("un lien consommé demande une nouvelle invitation, sans prétendre transférer Safari vers la PWA", async () => {
    firstPost = 401; await open();
    expect(await page.getByText(/déjà utilisé.*nouvelle invitation/).count()).toBe(1);
    await prepare(); await page.getByRole("button", { name: "Associer ce téléphone", exact: true }).click();
    await expect.poll(() => page.getByTestId("phase").textContent()).toBe("error");
    expect(await page.getByText("Camille Recette", { exact: true }).count()).toBe(0); expect(posts.length).toBe(1);
    await opener().click(); expect(await field().inputValue()).toBe(""); await privateStateClean();
  });
});
