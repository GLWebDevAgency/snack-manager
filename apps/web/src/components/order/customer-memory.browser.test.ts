import { createServer, type Server } from "node:http";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

let server: Server;
let browser: Browser;
let context: BrowserContext;
let page: Page;
let origin: string;
const key = "sm.customer.v1.classfood";
const saved = () => { const now = Date.now(); return { v: 1, tenant: "classfood", savedAt: now, expiresAt: now + 7 * 86_400_000,
  customer: { name: "Camille Test", phone: "0600000000" } }; };

beforeAll(async () => {
  const bundle = await build({ stdin: {
    contents: `import React from 'react'; import {createRoot} from 'react-dom/client';
      import {useCustomerDetails} from './useCustomerDetails'; import {CustomerMemoryControls} from './CustomerMemoryControls';
      function App(){const [tenant,setTenant]=React.useState('classfood');const [demo,setDemo]=React.useState(new URL(location.href).searchParams.has('demo'));const [open,setOpen]=React.useState(true);
        const details=useCustomerDetails(tenant,demo,open);
        return <main><h1>Coordonnées de recette</h1><p>{tenant}</p>
          {open&&<div>
          <label>Nom<input value={details.customer.name} onChange={e=>details.change({...details.customer,name:e.target.value})}/></label>
          <label>Téléphone<input value={details.customer.phone} onChange={e=>details.change({...details.customer,phone:e.target.value})}/></label>
          {!demo&&<CustomerMemoryControls details={details}/>}
          </div>}
          <button onClick={()=>setTenant(tenant==='classfood'?'autre':'classfood')}>Changer de restaurant</button>
          <button onClick={()=>setDemo(!demo)}>Changer de démonstration</button>
          <button onClick={()=>setOpen(!open)}>{open?'Fermer le formulaire':'Rouvrir le formulaire'}</button></main>;}
      createRoot(document.getElementById('root')).render(<React.StrictMode><App/></React.StrictMode>);`,
    resolveDir: fileURLToPath(new URL(".", import.meta.url)), sourcefile: "customer-memory-entry.tsx", loader: "tsx",
  }, bundle: true, write: false, format: "esm", platform: "browser", target: "es2022", define: { "process.env.NODE_ENV": '"development"' } });
  server = createServer((req, res) => {
    res.setHeader("Cache-Control", "no-store"); res.setHeader("Content-Type", req.url === "/app.js" ? "text/javascript" : "text/html");
    if (req.url === "/lock-holder") { res.end("<!doctype html><title>Verrou local de recette</title>"); return; }
    res.end(req.url === "/app.js" ? bundle.outputFiles[0].text : '<!doctype html><title>Customer memory local fixture</title><div id="root"></div><script type="module" src="/app.js"></script>');
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); if (!address || typeof address === "string") throw new Error("No test port");
  origin = `http://127.0.0.1:${address.port}`; browser = await chromium.launch({ headless: true });
}, 30_000);
beforeEach(async () => { context = await browser.newContext({ serviceWorkers: "block" }); page = await context.newPage(); });
afterEach(async () => { await context?.close(); });
afterAll(async () => { await browser?.close(); if (server) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); });
async function ready(target = page, suffix = "") { await target.goto(origin + suffix); await target.getByRole("heading", { name: "Coordonnées de recette" }).waitFor(); }
async function fill(target = page, name = "Camille Test") {
  await target.getByLabel("Nom", { exact: true }).fill(name); await target.getByLabel("Téléphone", { exact: true }).fill("0600000000");
}
async function eventuallyValue(target: Page, name: string, expected: string) { await expect.poll(() => target.getByLabel(name, { exact: true }).inputValue()).toBe(expected); }
async function committed(target = page) { await target.getByRole("button", { name: "Coordonnées mémorisées", exact: true }).waitFor(); }
/** Native Web Lock held by another tab, not a mocked storage implementation. */
async function holdMemoryLock() {
  const holder = await context.newPage(); await holder.goto(origin + "/lock-holder");
  await holder.evaluate(name => new Promise<void>(acquired => {
    void navigator.locks.request(name, () => new Promise<void>(release => {
      (window as Window & { releaseMemoryFixtureLock?: () => void }).releaseMemoryFixtureLock = release;
      acquired();
    }));
  }), key);
  return async () => {
    if (!holder.isClosed()) {
      await holder.evaluate(() => (window as Window & { releaseMemoryFixtureLock?: () => void }).releaseMemoryFixtureLock?.());
      await holder.close();
    }
  };
}
async function queuedMemoryRequest(target = page) {
  await expect.poll(() => target.evaluate(async name => (await navigator.locks.query()).pending?.some(lock => lock.name === name) ?? false, key)).toBe(true);
}
async function memoryCallbacksSettled(target = page) {
  await target.evaluate(async name => {
    await navigator.locks.request(name, () => undefined);
    await new Promise<void>(done => requestAnimationFrame(() => requestAnimationFrame(() => done())));
  }, key);
}

describe("coordonnées : vrais contrôles React et stockage navigateur", () => {
  it("ne sauvegarde rien sans geste explicite puis préremplit après recharge", async () => {
    await ready(); await fill();
    expect(await page.evaluate(key => localStorage.getItem(key), key)).toBeNull();
    await page.getByRole("button", { name: "Mémoriser ces coordonnées" }).click();
    await page.getByRole("button", { name: "Coordonnées mémorisées", exact: true }).waitFor();
    await page.reload(); await eventuallyValue(page, "Nom", "Camille Test");
    const raw = await page.evaluate(key => localStorage.getItem(key), key);
    const value = JSON.parse(raw!); expect(Object.keys(value.customer).sort()).toEqual(["name", "phone"]);
  });
  it("écarte la clé globale ancienne sans la rattacher à un restaurant", async () => {
    await context.addInitScript(() => { localStorage.setItem("sm.customer", JSON.stringify({ name: "Autre personne", phone: "0699999999" })); });
    await ready(); await eventuallyValue(page, "Nom", "");
    await expect.poll(() => page.evaluate(() => localStorage.getItem("sm.customer"))).toBeNull();
  });
  it("ne transporte ni saisie ni cache vers un autre restaurant", async () => {
    await ready(); await fill(); await page.getByRole("button", { name: "Mémoriser ces coordonnées" }).click();
    await page.getByRole("button", { name: "Changer de restaurant" }).click(); await eventuallyValue(page, "Nom", "");
    await page.getByRole("button", { name: "Changer de restaurant" }).click(); await eventuallyValue(page, "Nom", "Camille Test");
  });
  it("la démonstration ne lit, retire ni écrit aucune mémoire réelle", async () => {
    await context.addInitScript(({ key, data }) => { localStorage.setItem(key, JSON.stringify(data)); localStorage.setItem("sm.customer", "legacy-fixture"); }, { key, data: saved() });
    await ready(page, "?demo=1"); await fill(page, "Demo Test");
    expect(await page.getByRole("region", { name: "Mémorisation des coordonnées" }).count()).toBe(0);
    expect(await page.evaluate(key => JSON.parse(localStorage.getItem(key)!).customer.name, key)).toBe("Camille Test");
    expect(await page.evaluate(() => localStorage.getItem("sm.customer"))).toBe("legacy-fixture");
  });
  it("efface la mémoire inter-onglets sans effacer un brouillon nouvellement saisi", async () => {
    await ready(); await fill(); await page.getByRole("button", { name: "Mémoriser ces coordonnées" }).click();
    const second = await context.newPage(); await ready(second); await eventuallyValue(second, "Nom", "Camille Test");
    await second.getByLabel("Nom", { exact: true }).fill("Une autre personne");
    await page.getByRole("button", { name: "Effacer mes coordonnées" }).click();
    await eventuallyValue(page, "Nom", ""); await eventuallyValue(second, "Nom", "Une autre personne"); await eventuallyValue(second, "Téléphone", "");
    await second.evaluate(() => { window.dispatchEvent(new Event("focus")); });
    expect(await second.evaluate(key => localStorage.getItem(key), key)).toBeNull();
  });
  it("un oubli dans B efface aussi le formulaire ayant sauvegardé dans A", async () => {
    await ready(); await fill(); await page.getByRole("button", { name: "Mémoriser ces coordonnées" }).click(); await committed();
    const second = await context.newPage(); await ready(second); await eventuallyValue(second, "Nom", "Camille Test");
    await second.getByRole("button", { name: "Effacer mes coordonnées" }).click();
    await eventuallyValue(page, "Nom", ""); await eventuallyValue(page, "Téléphone", "");
    await eventuallyValue(second, "Nom", ""); await eventuallyValue(second, "Téléphone", "");
    expect(await page.evaluate(key => localStorage.getItem(key), key)).toBeNull();
    expect(await page.getByRole("button", { name: "Coordonnées mémorisées", exact: true }).count()).toBe(0);
    await page.evaluate(() => window.dispatchEvent(new Event("focus"))); await memoryCallbacksSettled();
    expect(await page.evaluate(key => localStorage.getItem(key), key)).toBeNull();
  });
  it("la saisie pendant une sauvegarde en attente reste un brouillon non mémorisé", async () => {
    await ready(); await fill();
    const release = await holdMemoryLock();
    try {
      await page.getByRole("button", { name: "Mémoriser ces coordonnées" }).click(); await queuedMemoryRequest();
      await page.getByRole("button", { name: "Enregistrement…", exact: true }).waitFor();
      await page.getByLabel("Nom", { exact: true }).fill("Brouillon plus récent");
      await page.getByLabel("Téléphone", { exact: true }).fill("0699999999");
      await release(); await memoryCallbacksSettled();
      await eventuallyValue(page, "Nom", "Brouillon plus récent"); await eventuallyValue(page, "Téléphone", "0699999999");
      const stored = await page.evaluate(key => JSON.parse(localStorage.getItem(key)!).customer, key);
      expect(stored).toEqual({ name: "Camille Test", phone: "0600000000" });
      expect(await page.getByRole("button", { name: "Mettre à jour la mémorisation" }).isEnabled()).toBe(true);
    } finally { await release(); }
  });
  it("une saisie nouvelle pendant un effacement en attente reste un brouillon non mémorisé", async () => {
    await ready(); await fill(); await page.getByRole("button", { name: "Mémoriser ces coordonnées" }).click(); await committed();
    const release = await holdMemoryLock();
    try {
      await page.getByRole("button", { name: "Effacer mes coordonnées" }).click(); await queuedMemoryRequest();
      await page.getByLabel("Nom", { exact: true }).fill("Nouvelle commande invitée");
      await page.getByLabel("Téléphone", { exact: true }).fill("0699999999");
      await release(); await memoryCallbacksSettled();
      expect(await page.evaluate(key => localStorage.getItem(key), key)).toBeNull();
      await eventuallyValue(page, "Nom", "Nouvelle commande invitée"); await eventuallyValue(page, "Téléphone", "0699999999");
      expect(await page.getByRole("button", { name: "Mémoriser ces coordonnées" }).isEnabled()).toBe(true);
    } finally { await release(); }
  });
  it.each(["restaurant", "démonstration"] as const)("une lecture retardée ne fuit pas après changement de %s", async kind => {
    await ready(); await fill(); await page.getByRole("button", { name: "Mémoriser ces coordonnées" }).click(); await committed();
    const release = await holdMemoryLock();
    try {
      await page.reload(); await page.getByRole("heading", { name: "Coordonnées de recette" }).waitFor(); await queuedMemoryRequest();
      await page.getByRole("button", { name: `Changer de ${kind}` }).click();
      await eventuallyValue(page, "Nom", ""); await eventuallyValue(page, "Téléphone", "");
      await fill(page, "Nouveau contexte");
      await page.getByLabel("Téléphone", { exact: true }).fill("0699999999");
      await release(); await memoryCallbacksSettled();
      await eventuallyValue(page, "Nom", "Nouveau contexte"); await eventuallyValue(page, "Téléphone", "0699999999");
      expect(await page.evaluate(key => JSON.parse(localStorage.getItem(key)!).customer.name, key)).toBe("Camille Test");
      expect(await page.evaluate(() => localStorage.getItem("sm.customer.v1.autre"))).toBeNull();
    } finally { await release(); }
  });
  it.each(["formulaire", "démonstration"] as const)("un retour au même contexte après sauvegarde en attente ne reste pas occupé : %s", async kind => {
    await ready(); await fill();
    const release = await holdMemoryLock();
    try {
      await page.getByRole("button", { name: "Mémoriser ces coordonnées" }).click(); await queuedMemoryRequest();
      await page.getByRole("button", { name: kind === "formulaire" ? "Fermer le formulaire" : "Changer de démonstration" }).click();
      await release(); await memoryCallbacksSettled();
      await page.getByRole("button", { name: kind === "formulaire" ? "Rouvrir le formulaire" : "Changer de démonstration" }).click();
      await committed(); await eventuallyValue(page, "Nom", "Camille Test");
      await page.getByLabel("Nom", { exact: true }).fill("Nouvelle saisie");
      expect(await page.getByRole("button", { name: "Mettre à jour la mémorisation" }).isEnabled()).toBe(true);
    } finally { await release(); }
  });
  it("un oubli après sauvegarde terminée formulaire fermé ne restaure pas les anciennes coordonnées", async () => {
    await ready(); await fill();
    const release = await holdMemoryLock();
    try {
      await page.getByRole("button", { name: "Mémoriser ces coordonnées" }).click(); await queuedMemoryRequest();
      await page.getByRole("button", { name: "Fermer le formulaire" }).click();
      await release(); await memoryCallbacksSettled();
      const second = await context.newPage(); await ready(second); await eventuallyValue(second, "Nom", "Camille Test");
      await second.getByRole("button", { name: "Effacer mes coordonnées" }).click();
      await eventuallyValue(second, "Nom", "");
      expect(await second.evaluate(key => localStorage.getItem(key), key)).toBeNull();
      await page.getByRole("button", { name: "Rouvrir le formulaire" }).click(); await memoryCallbacksSettled();
      await eventuallyValue(page, "Nom", ""); await eventuallyValue(page, "Téléphone", "");
    } finally { await release(); }
  });
  it("une mise à jour externe ne remplace pas le champ déjà modifié", async () => {
    await ready(); await fill(); await page.getByRole("button", { name: "Mémoriser ces coordonnées" }).click();
    const second = await context.newPage(); await ready(second); await eventuallyValue(second, "Nom", "Camille Test");
    await second.getByLabel("Nom", { exact: true }).fill("Mon brouillon");
    await page.getByLabel("Nom", { exact: true }).fill("Nouvelle mémoire"); await page.getByRole("button", { name: "Mettre à jour la mémorisation" }).click();
    await eventuallyValue(second, "Nom", "Mon brouillon");
  });
  it("retire le préremplissage à expiration sans prolonger la durée au focus", async () => {
    await page.clock.install(); await ready(); await fill(); await page.getByRole("button", { name: "Mémoriser ces coordonnées" }).click();
    await committed();
    const remaining = await page.evaluate(key => JSON.parse(localStorage.getItem(key)!).expiresAt - Date.now(), key);
    await page.clock.fastForward(remaining); await eventuallyValue(page, "Nom", "");
    expect(await page.evaluate(key => localStorage.getItem(key), key)).toBeNull();
    await page.evaluate(() => window.dispatchEvent(new Event("focus"))); await eventuallyValue(page, "Téléphone", "");
  });
  it("une erreur de relecture retire le préremplissage sans bloquer une nouvelle saisie", async () => {
    await ready(); await fill(); await page.getByRole("button", { name: "Mémoriser ces coordonnées" }).click(); await committed();
    await page.evaluate(key => {
      const original = Storage.prototype.getItem;
      Storage.prototype.getItem = function (name: string) {
        if (name === key) throw new DOMException("fixture", "SecurityError");
        return original.call(this, name);
      };
      window.dispatchEvent(new Event("focus"));
    }, key);
    await page.getByRole("status").filter({ hasText: "La mémorisation est indisponible" }).waitFor();
    await eventuallyValue(page, "Nom", ""); await eventuallyValue(page, "Téléphone", "");
    expect(await page.getByRole("button", { name: "Coordonnées mémorisées", exact: true }).count()).toBe(0);
    await fill(page, "Saisie malgré la panne"); await eventuallyValue(page, "Nom", "Saisie malgré la panne");
  });
  it("une erreur de stockage est explicite et n’empêche pas la saisie", async () => {
    await context.addInitScript(() => { Storage.prototype.setItem = () => { throw new DOMException("fixture", "QuotaExceededError"); }; });
    await ready(); await fill(); await page.getByRole("button", { name: "Mémoriser ces coordonnées" }).click();
    await page.getByRole("status").filter({ hasText: "n’ont pas pu être mémorisées" }).waitFor(); await eventuallyValue(page, "Nom", "Camille Test");
  });
  it("l’effacement ne touche ni panier, tentative C01, ni accès de remise", async () => {
    await ready(); await fill(); await page.getByRole("button", { name: "Mémoriser ces coordonnées" }).click();
    await page.evaluate(() => localStorage.setItem("sm.cart.classfood", "cart-fixture"));
    await page.getByRole("button", { name: "Effacer mes coordonnées" }).click();
    expect(await page.evaluate(() => localStorage.getItem("sm.cart.classfood"))).toBe("cart-fixture");
    // This component never opens IndexedDB, where C01 and delivery capabilities live.
    expect(await page.evaluate(() => indexedDB.databases())).toEqual([]);
  });
});
