import { createServer, type Server, type ServerResponse } from "node:http";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { afterAll, afterEach, beforeAll, beforeEach, expect, it } from "vitest";
import type { DeliveryHistoryView } from "@sm/contracts";

const operatorId = "b".repeat(24), firstId = "d".repeat(24), secondId = "e".repeat(24);
const completed = (id = firstId, number = 12): DeliveryHistoryView["missions"][number] => ({ id, number,
  createdAt: "2030-09-07T10:00:00.000Z", scheduledAt: null, deliveredAt: "2030-09-07T10:30:00.000Z",
  orderStatus: "delivered", revision: 2, operator: { id: operatorId, name: "Camille" }, assignmentId: "02faab2b-f0b1-47c4-b591-8e88908a91b5",
  assignedAt: "2030-09-07T10:00:00.000Z", dispatchedAt: "2030-09-07T10:10:00.000Z", paymentReady: true, canAssign: false, canDispatch: false,
  customer: { name: `Client ${number}`, phone: null }, address: { line1: "10 rue de la Recette", postalCode: "75001", city: "Paris", country: "FR" },
  instructions: null, items: [], paymentSummary: { totalCents: 1500, method: "online", status: "paid", tender: "online" } });
let server: Server, browser: Browser, context: BrowserContext, page: Page, origin: string;
let requests: string[], errors: string[], revoked: boolean, foreign: boolean, hold: boolean;
let held: ServerResponse | null;

beforeAll(async () => {
  const bundle = await build({ stdin: { contents: `import React,{useState,useCallback} from 'react';import{createRoot}from'react-dom/client';
    import{useDeliveryPreferences,useDeliveryWakeLock,deliveryNavigationUrl,deliverySmsUrl}from'./delivery-preferences';import{DeliveryHistory}from'./DeliveryHistory';
    function App(){const p=useDeliveryPreferences();const[active,setActive]=useState(false);const[available,setAvailable]=useState(true);const[route,setRoute]=useState(false);const wake=useDeliveryWakeLock(p.preferences.wake&&route);const revoke=useCallback(()=>setAvailable(false),[]);return <>
      <output data-theme={p.theme}>{p.theme}</output><output id="wake">{wake}</output><output id="alert">{p.alertMessage}</output>
      <button onClick={()=>p.update({theme:'light'})}>Clair</button><button onClick={()=>p.update({theme:'auto'})}>Système</button>
      <button onClick={()=>p.update({navigation:'waze'})}>Waze</button><button onClick={()=>p.update({wake:!p.preferences.wake})}>Veille</button><button onClick={()=>setRoute(v=>!v)}>Mission en route</button>
      <button onClick={()=>void p.alert(true)}>Tester</button><button onClick={()=>void p.alert()}>Nouvelle mission</button>
      <a id="nav" href={deliveryNavigationUrl({line1:'10 rue & test',postalCode:'75001',city:'Paris',country:'FR'},p.preferences.navigation)}>Itinéraire</a><a id="sms" href={deliverySmsUrl('+33 6 12 34 56 78','Bonjour & à bientôt')}>SMS</a>
      <button onClick={()=>setActive(v=>!v)}>Historique</button><span id="access">{available?'Autorisé':'Révoqué'}</span>
      <DeliveryHistory operatorId="${operatorId}" active={active} available={available} onRevoked={revoke}/></>};
    createRoot(document.getElementById('root')).render(<React.StrictMode><App/></React.StrictMode>);`, resolveDir: fileURLToPath(new URL(".", import.meta.url)), loader: "tsx", sourcefile: "delivery-preferences-entry.tsx" }, bundle: true, write: false, format: "esm", platform: "browser", target: "es2022", jsx: "automatic", define: { "process.env.NODE_ENV": '"production"' } });
  server = createServer((req, res) => {
    res.setHeader("Cache-Control", "no-store");
    if (req.url === "/test.js") { res.setHeader("Content-Type", "text/javascript"); res.end(bundle.outputFiles[0]!.text); return; }
    if (req.url?.startsWith("/livreur/history")) {
      requests.push(`${req.method} ${req.url}`); res.setHeader("Content-Type", "application/json");
      if (hold) { hold = false; held = res; return; }
      if (revoked) { res.writeHead(401).end(JSON.stringify({ code: "ACCESS_UNAVAILABLE" })); return; }
      const more = req.url.includes("after="); const mission = more ? completed(secondId, 13) : completed();
      if (foreign) mission.operator = { id: "a".repeat(24), name: "Autre livreur" };
      res.end(JSON.stringify({ missions: [mission], nextCursor: more ? null : firstId })); return;
    }
    res.setHeader("Content-Type", "text/html"); res.end('<!doctype html><html lang="fr"><body><div id="root"></div><script type="module" src="/test.js"></script></body></html>');
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve)); const address = server.address(); if (!address || typeof address === "string") throw Error("Local port unavailable"); origin = `http://127.0.0.1:${address.port}`;
  browser = await chromium.launch({ headless: true });
}, 30_000);
beforeEach(async () => { requests = []; errors = []; revoked = false; foreign = false; hold = false; held = null;
  context = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: "light", serviceWorkers: "block" });
  page = await context.newPage(); page.setDefaultTimeout(3_000); page.on("pageerror", error => errors.push(error.message));
});
afterEach(async () => { held?.end(JSON.stringify({ missions: [completed()], nextCursor: null })); held = null; await context.close(); expect(errors).toEqual([]); expect(requests.every(request => request.startsWith("GET /livreur/history"))).toBe(true); });
afterAll(async () => { await browser?.close(); if (server) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); });

it("conserve les préférences validées sans identifiants et suit le thème système", async () => {
  await page.goto(origin); await page.getByRole("button", { name: "Clair", exact: true }).click();
  await expect.poll(() => page.locator("[data-theme]").getAttribute("data-theme")).toBe("light");
  await page.getByRole("button", { name: "Waze", exact: true }).click(); await page.reload();
  await expect.poll(() => page.locator("#nav").getAttribute("href")).toBe("https://waze.com/ul?q=10%20rue%20%26%20test%2C%2075001%2C%20Paris%2C%20FR&navigate=yes");
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("sm.delivery.preferences.v2")!));
  expect(stored).toEqual({ theme: "light", navigation: "waze", alerts: false, wake: false, reduceMotion: false, reduceTransparency: false });
  await page.getByRole("button", { name: "Système", exact: true }).click(); await page.emulateMedia({ colorScheme: "dark" });
  await expect.poll(() => page.locator("[data-theme]").getAttribute("data-theme")).toBe("dark");
  expect(await page.locator("#sms").getAttribute("href")).toBe("sms:+33612345678?body=Bonjour%20%26%20%C3%A0%20bient%C3%B4t"); expect(requests).toEqual([]);
});
it("ignore un stockage malformé et applique les préférences même si le stockage est refusé", async () => {
  await context.addInitScript(() => { localStorage.setItem("sm.delivery.preferences.v2", "{malformed"); Storage.prototype.setItem = () => { throw Error("Storage denied"); }; });
  await page.goto(origin); await expect.poll(() => page.locator("[data-theme]").getAttribute("data-theme")).toBe("dark");
  await page.getByRole("button", { name: "Clair", exact: true }).click(); await expect.poll(() => page.locator("[data-theme]").getAttribute("data-theme")).toBe("light");
});
it("ne demande le verrouillage écran qu’en tournée et le libère lorsque la tournée s’arrête", async () => {
  await context.addInitScript(() => {
    const counts = { requests: 0, releases: 0 }; Object.assign(window, { wakeCounts: counts });
    Object.defineProperty(navigator, "wakeLock", { configurable: true, value: { request: async () => { counts.requests++; const sentinel = new EventTarget(); return Object.assign(sentinel, { release: async () => { counts.releases++; sentinel.dispatchEvent(new Event("release")); } }); } } });
  });
  await page.goto(origin); await page.getByRole("button", { name: "Veille", exact: true }).click();
  expect(await page.evaluate(() => (window as unknown as { wakeCounts: { requests: number } }).wakeCounts.requests)).toBe(0);
  await page.getByRole("button", { name: "Mission en route", exact: true }).click(); await expect.poll(() => page.locator("#wake").textContent()).toBe("Actif pendant votre tournée");
  await page.getByRole("button", { name: "Mission en route", exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { wakeCounts: { releases: number } }).wakeCounts.releases)).toBe(1);
});
it("explique un refus audio sans empêcher l’historique", async () => {
  await context.addInitScript(() => Object.defineProperty(window, "AudioContext", { configurable: true, value: undefined }));
  await page.goto(origin); await page.getByRole("button", { name: "Tester", exact: true }).click(); await expect.poll(() => page.locator("#alert").textContent()).toMatch(/n’a pas autorisé/);
  await page.getByRole("button", { name: "Historique", exact: true }).click(); await page.getByText("Client 12", { exact: true }).waitFor();
});
it("charge un historique paginé à la demande sans l’ajouter aux opérations actives", async () => {
  await page.goto(origin); await page.getByRole("button", { name: "Historique", exact: true }).waitFor(); expect(requests).toEqual([]);
  await page.getByRole("button", { name: "Historique", exact: true }).click(); await page.getByText("Client 12", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Charger les livraisons précédentes", exact: true }).click(); await page.getByText("Client 13", { exact: true }).waitFor();
  expect(await page.locator(".lv-history-list>li").count()).toBe(2); expect(requests).toEqual(["GET /livreur/history", `GET /livreur/history?after=${firstId}`]);
});
it("ne montre aucune mission étrangère et efface l’historique après révocation", async () => {
  foreign = true; await page.goto(origin); await page.getByRole("button", { name: "Historique", exact: true }).click(); await page.getByRole("alert").waitFor(); expect(await page.locator(".lv-history-list>li").count()).toBe(0);
  foreign = false; await page.getByRole("button", { name: "Actualiser l’historique", exact: true }).click(); await page.getByText("Client 12", { exact: true }).waitFor();
  revoked = true; await page.getByRole("button", { name: "Actualiser l’historique", exact: true }).click(); await expect.poll(() => page.locator("#access").textContent()).toBe("Révoqué"); expect(await page.locator(".lv-history-list>li").count()).toBe(0);
});
it("ignore une réponse historique arrivée après la fermeture de la vue", async () => {
  hold = true; await page.goto(origin); await page.getByRole("button", { name: "Historique", exact: true }).click(); await expect.poll(() => requests.length).toBe(1);
  await page.getByRole("button", { name: "Historique", exact: true }).click(); held!.end(JSON.stringify({ missions: [completed()], nextCursor: null })); held = null;
  await page.getByRole("button", { name: "Historique", exact: true }).click(); await page.getByText("Client 12", { exact: true }).waitFor(); expect(requests).toHaveLength(2); expect(await page.locator(".lv-history-list>li").count()).toBe(1);
});
