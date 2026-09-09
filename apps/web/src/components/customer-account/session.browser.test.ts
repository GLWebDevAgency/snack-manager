import { createServer, type Server, type ServerResponse } from "node:http";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { seedCustomerBrowserFixture } from './browser-journal.fixture';

let server: Server, browser: Browser, context: BrowserContext, page: Page, origin: string;
let session: { expiresAt: number; profile: { name: string; phoneE164: string; phoneVerifiedAt: number; revision: number } } | null;
let requests: string[], faults: string[], paused: ServerResponse | null, holdPatch: boolean;

// Browser plugin not available. Native Chromium, HTTP, Web Locks and
// BroadcastChannel; the BFF/provider boundary is a loopback test fixture only.
beforeAll(async () => {
  const bundle = await build({ stdin: { contents: `import React,{useState} from 'react';import {createRoot} from 'react-dom/client';import {useCustomerAccount} from './useCustomerAccount';
    function App(){const[enabled,setEnabled]=useState(true);const a=useCustomerAccount('recette',enabled);return <main><h1>Session de recette</h1><output>{JSON.stringify(a.state)}</output><button onClick={()=>a.refresh()}>Lire</button><button onClick={()=>a.saveName('Après modification')}>Nom</button><button onClick={()=>a.logout()}>Quitter</button><button onClick={()=>setEnabled(!enabled)}>Activer</button></main>}createRoot(document.getElementById('root')).render(<React.StrictMode><App/></React.StrictMode>);`, resolveDir: fileURLToPath(new URL(".", import.meta.url)), loader: "tsx" },
    bundle: true, write: false, format: "esm", platform: "browser", target: "es2022", jsx: "automatic",
    alias: { react: fileURLToPath(new URL("../../../node_modules/react", import.meta.url)), "react-dom": fileURLToPath(new URL("../../../node_modules/react-dom", import.meta.url)) },
    define: { "process.env.NODE_ENV": '"production"' } });
  server = createServer(async (req, res) => {
    res.setHeader("Cache-Control", "private, no-store");
    if (req.url === '/fixture-empty') { res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><title>Fixture setup</title>'); return; }
    if (req.url === "/bundle.js") { res.setHeader("Content-Type", "text/javascript"); res.end(bundle.outputFiles[0]!.text); return; }
    if (req.url === "/") { res.setHeader("Content-Type", "text/html"); res.end('<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Recette compte</title></head><body><div id="root"></div><script type="module" src="/bundle.js"></script></body></html>'); return; }
    res.setHeader("Content-Type", "application/json");
    if (req.url === "/favicon.ico") { res.end("{}"); return; }
    requests.push(`${req.method} ${req.url}`);
    if (req.url === "/r/recette/compte/capacites") { res.end('{"available":false}'); return; }
    if (req.url === "/r/recette/compte/session") {
      if (req.method === "DELETE") { session = null; res.writeHead(204).end(); return; }
      res.writeHead(session ? 200 : 401).end(JSON.stringify(session ?? { code: "CUSTOMER_UNAUTHORIZED" })); return;
    }
    if (req.url === "/r/recette/compte/profil" && req.method === "PATCH") {
      const chunks: Buffer[] = []; for await (const data of req) chunks.push(Buffer.from(data));
      const body = JSON.parse(Buffer.concat(chunks).toString()) as { name: string; expectedRevision: number };
      if (!session || body.expectedRevision !== session.profile.revision) { res.writeHead(409).end("{}"); return; }
      session = { ...session, profile: { ...session.profile, name: body.name, revision: session.profile.revision + 1 } };
      if (holdPatch) { paused = res; return; } res.end(JSON.stringify(session)); return;
    }
    faults.push(`Unexpected fixture endpoint ${req.method} ${req.url}`); res.writeHead(404).end("{}");
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); if (!address || typeof address === "string") throw Error("Missing address");
  origin = `http://127.0.0.1:${address.port}`; browser = await chromium.launch({ headless: true });
});
beforeEach(async () => {
  requests = []; faults = []; paused = null; holdPatch = false;
  session = { expiresAt: Date.now() + 60_000, profile: { name: "Avant modification", phoneE164: "+33600000001", phoneVerifiedAt: Date.now() - 1_000, revision: 0 } };
  context = await browser.newContext({ serviceWorkers: "block" });
  context.on("page", p => p.on("pageerror", error => faults.push(error.message)));
  page = await context.newPage(); page.setDefaultTimeout(5_000); await page.goto(origin + '/fixture-empty');
  await seedCustomerBrowserFixture(page, 'recette'); await page.goto(origin);
});
afterEach(async () => { paused?.destroy(); await context.close(); expect(faults).toEqual([]); });
afterAll(async () => { await browser?.close(); if (server) await new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()); }); });
const value = (p = page) => p.locator("output").textContent();
const authenticated = (p = page) => expect.poll(() => value(p)).toContain('"status":"authenticated"');

describe("Session personnelle — navigateur natif et plusieurs onglets", () => {
  it("refuse le DELETE et masque le profil si la barrière privée du checkout ne peut pas être persistée", async () => {
    await authenticated();
    await page.evaluate(() => {
      const open = IDBFactory.prototype.open;
      IDBFactory.prototype.open = function(name, version) {
        if (name === 'sm.checkout-attempts') throw new DOMException('Fixture storage denied', 'SecurityError');
        return open.call(this, name, version);
      };
    });
    await page.getByRole('button', { name: 'Quitter', exact: true }).click();
    await expect.poll(() => value()).toContain('"busy":false');
    expect(requests.filter(request => request.startsWith('DELETE'))).toEqual([]);
    expect(await value()).not.toContain('Avant modification');
    expect(await value()).toContain('La protection locale de vos commandes');
    expect(await value()).not.toContain('Déconnexion confirmée');
  });
  it.each(['Nom', 'Quitter'] as const)('ne laisse pas %s préparé sur A viser B après le verrou natif, malgré des projections identiques', async button => {
    await authenticated(); const displayed = await value();
    const second = await context.newPage(); await second.goto(origin + '/fixture-empty');
    await second.evaluate(() => {
      const state = { held: false, release: () => {}, work: Promise.resolve() };
      const gate = new Promise<void>(resolve => { state.release = resolve; });
      state.work = navigator.locks.request('sm:customer:recette', async () => { state.held = true; await gate; }).then(() => undefined);
      Object.assign(window, { customerFixtureLock: state });
    });
    try {
      await expect.poll(() => second.evaluate(() => (window as unknown as { customerFixtureLock: { held: boolean } }).customerFixtureLock.held)).toBe(true);
      await page.getByRole('button', { name: button, exact: true }).click();
      await expect.poll(() => value()).toContain('"busy":true');
      // Real shared IDB changes before the queued mutation runs. Deliberately
      // no invalidation event: its delivery can lag behind lock acquisition.
      await second.evaluate(async () => {
        const db = await new Promise<IDBDatabase>((resolve, reject) => {
          const request = indexedDB.open('sm-customer-preparation-v1', 1);
          request.onsuccess = () => resolve(request.result); request.onerror = () => reject(new Error('Fixture IDB unavailable'));
        });
        try {
          await new Promise<void>((resolve, reject) => {
            const tx = db.transaction('preparations', 'readwrite', { durability: 'strict' }), store = tx.objectStore('preparations');
            const read = store.get('recette');
            read.onsuccess = () => store.put({ ...read.result, verification: { ...read.result.verification,
              operationId: crypto.randomUUID(), checkId: crypto.randomUUID(), challengeId: crypto.randomUUID() } }, 'recette');
            tx.oncomplete = () => resolve(); tx.onabort = tx.onerror = () => reject(new Error('Fixture IDB failed'));
          });
        } finally { db.close(); }
      });
    } finally {
      await second.evaluate(async () => {
        const lock = (window as unknown as { customerFixtureLock: { release(): void; work: Promise<void> } }).customerFixtureLock;
        lock.release(); await lock.work;
      });
    }
    await expect.poll(() => value()).toContain('"busy":false');
    await expect.poll(() => value()).toContain('"status":"error"');
    expect(await value()).not.toContain('33600000001');
    expect(requests.some(request => request.startsWith('PATCH') || request.startsWith('DELETE'))).toBe(false);
    expect(JSON.parse(displayed!).view).toEqual(session); // Same PII, revision and expiry throughout.
  });
  it("un PATCH invalide l’autre onglet, attend le verrou puis publie le profil à jour", async () => {
    await authenticated(); const second = await context.newPage(); await second.goto(origin); await authenticated(second);
    holdPatch = true; await second.getByRole("button", { name: "Nom", exact: true }).click(); await expect.poll(() => paused !== null).toBe(true);
    await expect.poll(() => value()).not.toContain("Avant modification");
    const whileLocked = requests.filter(r => r === "GET /r/recette/compte/session").length;
    await page.getByRole("button", { name: "Lire", exact: true }).click();
    // Acquiring a competing native lock cannot run until PATCH completes.
    expect(requests.filter(r => r === "GET /r/recette/compte/session")).toHaveLength(whileLocked);
    holdPatch = false; paused!.end(JSON.stringify(session)); paused = null;
    await authenticated(); await expect.poll(() => value()).toContain("Après modification");
    await expect.poll(() => value(second)).toContain("Après modification");
    expect(requests.filter(r => r === "PATCH /r/recette/compte/profil")).toHaveLength(1);
  });
  it("déconnexion dans B : A perd son profil et redevient invité sans conserver de PII locale", async () => {
    await authenticated(); const second = await context.newPage(); await second.goto(origin); await authenticated(second);
    await second.getByRole("button", { name: "Quitter", exact: true }).click();
    await expect.poll(() => value()).toContain('"status":"guest"');
    await expect.poll(() => value(second)).toContain('"status":"guest"');
    const saved = await page.evaluate(async () => ({ local: { ...localStorage }, session: { ...sessionStorage }, cache: await caches.keys() }));
    expect(JSON.stringify(saved)).not.toMatch(/Avant|Après|33600000001|phoneE164|expiresAt/);
    expect(saved.session).toEqual({}); expect(saved.cache).toEqual([]);
    expect(Object.keys(saved.local)).toEqual(["sm:customer:invalidate:recette"]);
    expect(Object.values(saved.local)[0]).toMatch(/^[0-9a-f-]{36}$/);
  });
  it("hors ligne, pagehide et expiration ne laissent aucune projection personnelle", async () => {
    await authenticated(); await context.setOffline(true);
    await expect.poll(() => value()).toContain('"status":"offline"');
    expect(await value()).not.toContain("33600000001");
    await context.setOffline(false); await authenticated();
    await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: true })));
    await expect.poll(() => value()).not.toContain("33600000001");
    await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }))); await authenticated();
    const expires = session!.expiresAt; await page.clock.install();
    await page.getByRole("button", { name: "Lire", exact: true }).click(); await authenticated();
    await page.clock.fastForward(expires - Date.now() + 1_000);
    await expect.poll(() => value()).toContain('"status":"guest"'); expect(await value()).not.toContain("33600000001");
  });
  it("le dernier consommateur fermé efface la vue ; aucune route OTP n’est appelée", async () => {
    await authenticated(); await page.getByRole("button", { name: "Activer", exact: true }).click();
    await expect.poll(() => value()).toContain('"view":null');
    const count = requests.length; await page.getByRole("button", { name: "Lire", exact: true }).click(); expect(requests).toHaveLength(count);
    await page.getByRole("button", { name: "Activer", exact: true }).click(); await authenticated();
    expect(requests.every(r => /\/compte\/(session|capacites)$/.test(r))).toBe(true);
  });
  it("aucune mutation quand les deux canaux d’invalidation sont indisponibles", async () => {
    await authenticated();
    // Reload builds a runtime with neither transport. Storage remains readable,
    // but no cross-tab write succeeds. Native locks alone do not notify readers.
    await page.addInitScript(() => {
      Object.defineProperty(window, "BroadcastChannel", { value: class { constructor() { throw Error("Unavailable"); } } });
      Storage.prototype.setItem = () => { throw Error("Storage unavailable"); };
    });
    await page.reload(); await authenticated();
    await page.getByRole("button", { name: "Nom", exact: true }).click();
    await expect.poll(() => value()).toContain('"status":"error"');
    expect(requests.some(r => r.startsWith("PATCH") || r.startsWith("DELETE"))).toBe(false);
  });
});
