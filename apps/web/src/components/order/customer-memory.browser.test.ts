import { createServer, type Server } from "node:http";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { CustomerAccountView } from "@sm/contracts";
import { seedCustomerBrowserFixture } from '../customer-account/browser-journal.fixture';

let server: Server;
let browser: Browser;
let context: BrowserContext;
let page: Page;
let origin: string;
let account: CustomerAccountView | null = null;
let accountReads = 0;
let releaseAccount: (() => void) | undefined;
let accountGate: Promise<void> | undefined;
const profile = (name = "Profil Compte"): CustomerAccountView => ({ expiresAt: Date.now() + 60_000,
  profile: { name, phoneE164: "+33600000001", phoneVerifiedAt: Date.now() - 1_000, revision: 0 } });
const key = "sm.customer.v1.classfood";
const saved = () => { const now = Date.now(); return { v: 1, tenant: "classfood", savedAt: now, expiresAt: now + 7 * 86_400_000,
  customer: { name: "Camille Test", phone: "0600000000" } }; };

beforeAll(async () => {
  const bundle = await build({ stdin: {
    contents: `import React from 'react'; import {createRoot} from 'react-dom/client';
      import {useCustomerDetails} from './useCustomerDetails'; import {CustomerMemoryControls} from './CustomerMemoryControls';
      import {useCustomerAccount} from '../customer-account/useCustomerAccount';
      import {Storefront} from './Storefront';import {orderingApi} from './api';import {demoSite} from './demo/fixture';import {marqueDeRepli} from '@sm/contracts';
      function App(){const [tenant,setTenant]=React.useState('classfood');const [demo,setDemo]=React.useState(new URL(location.href).searchParams.has('demo'));const [open,setOpen]=React.useState(true);
        const accountEnabled=!new URL(location.href).searchParams.has('embed');
        const details=useCustomerDetails(tenant,demo,open,accountEnabled);
        const access=useCustomerAccount(tenant,!demo&&open&&accountEnabled);
        return <main><h1>Coordonnées de recette</h1><p>{tenant}</p>
          <output data-testid="account-state">{access.state.status}</output>
          {open&&<div>
          <label>Nom<input value={details.customer.name} onChange={e=>details.change({...details.customer,name:e.target.value})}/></label>
          <label>Téléphone<input value={details.customer.phone} onChange={e=>details.change({...details.customer,phone:e.target.value})}/></label>
          <output data-testid="name-source">{details.provenance?.name}</output><output data-testid="phone-source">{details.provenance?.phone}</output>
          {!demo&&<CustomerMemoryControls details={details}/>}
          </div>}
          <button onClick={()=>setTenant(tenant==='classfood'?'autre':'classfood')}>Changer de restaurant</button>
          <button onClick={()=>setDemo(!demo)}>Changer de démonstration</button>
          <button onClick={()=>access.logout()}>Déconnecter le compte</button>
          <button onClick={()=>setOpen(!open)}>{open?'Fermer le formulaire':'Rouvrir le formulaire'}</button></main>;}
      async function start(){let node=<App/>;
        if(location.pathname==='/embed-storefront'){
          // Fixed HTTP fixture: Monday noon in Europe/Paris, with bookable pickup slots regardless of runner time.
          const raw=demoSite(new Date('2030-09-09T10:00:00.000Z'),()=>0);raw.tenant.slug='classfood';raw.tenant.brand=marqueDeRepli(null,null);
          raw.menu={categories:[{_id:'${"c".repeat(24)}',name:'Boissons',products:[{_id:'${"d".repeat(24)}',name:'Canette recette',price:150,available:true,stockout:false,variants:[],optionGroups:[],ingredients:[],supplements:[],photoUrl:null}]}]};
          const api=orderingApi({send:async request=>({status:200,body:request.path.includes('/slots')?raw.slots:raw})});
          const site=await api.loadSite('classfood');node=<Storefront site={site} api={api} mode="embed" demo={false}/>;
        }
        createRoot(document.getElementById('root')).render(<React.StrictMode>{node}</React.StrictMode>);
      }start();`,
    resolveDir: fileURLToPath(new URL(".", import.meta.url)), sourcefile: "customer-memory-entry.tsx", loader: "tsx",
  }, bundle: true, write: false, outdir: "/virtual-customer-memory", format: "esm", platform: "browser", target: "es2022", jsx: "automatic",
  alias: { react: fileURLToPath(new URL("../../../node_modules/react", import.meta.url)), "react-dom": fileURLToPath(new URL("../../../node_modules/react-dom", import.meta.url)) },
  // Real Storefront/Checkout/hooks; only third-party SDK/font providers are inert.
  plugins: [{ name: "provider-boundaries", setup(builder) {
      builder.onResolve({ filter: /^next\/navigation$/ }, () => ({ path: 'navigation', namespace: 'fixture-navigation' }));
      builder.onLoad({ filter: /.*/, namespace: 'fixture-navigation' }, () => ({ contents: `export const usePathname=()=>window.location.pathname;export const useRouter=()=>({push:href=>window.location.assign(href)});` }));
    builder.onResolve({ filter: /\/StripeCard$/ }, () => ({ path: "stripe", namespace: "memory-fixture" }));
    builder.onLoad({ filter: /^stripe$/, namespace: "memory-fixture" }, () => ({ contents: "export const apparenceStripeDe=()=>({});export function StripeCard(){return null}" }));
    builder.onResolve({ filter: /^next\/font\/google$/ }, () => ({ path: "font", namespace: "memory-fixture" }));
    builder.onLoad({ filter: /^font$/, namespace: "memory-fixture" }, () => ({ contents: `const font=()=>({variable:'',className:'',style:{fontFamily:'Arial'}});export {${["Alegreya_Sans", "Archivo", "Archivo_Black", "Bricolage_Grotesque", "Cormorant_Garamond", "Familjen_Grotesk", "Figtree", "Fraunces", "Instrument_Sans", "JetBrains_Mono", "Lato", "Libre_Baskerville", "Manrope", "Nunito", "Nunito_Sans", "Outfit", "Playfair_Display", "Source_Sans_3"].map(name => `font as ${name}`).join(",")}}` }));
  } }], define: { "process.env": "{}", "process.env.NODE_ENV": '"development"', "process.env.NEXT_PUBLIC_API_URL": '"/api"' } });
  const script = bundle.outputFiles.find(file => file.path.endsWith(".js"))!.text;
  server = createServer((req, res) => {
    if (req.url?.startsWith("/r/") && req.url.includes("/compte/")) {
      res.setHeader("Cache-Control", "no-store"); res.setHeader("Content-Type", "application/json");
      if (req.url.endsWith("/capacites")) { res.end(JSON.stringify({ available: false })); return; }
      if (req.url.endsWith("/session") && req.method === "DELETE") {
        account = null; res.statusCode = 204; res.end(); return;
      }
      if (req.url.endsWith("/session") && req.method === "GET") {
        accountReads++; const snapshot = req.url.startsWith("/r/classfood/") ? account : null;
        void (accountGate ?? Promise.resolve()).then(() => {
          if (res.destroyed) return;
          res.statusCode = snapshot ? 200 : 401;
          res.end(JSON.stringify(snapshot ?? { code: "CUSTOMER_UNAUTHORIZED", message: "Session indisponible." }));
        }); return;
      }
      res.statusCode = 503; res.end(JSON.stringify({ code: "CUSTOMER_UNAVAILABLE", message: "Indisponible." })); return;
    }
    res.setHeader("Cache-Control", "no-store"); res.setHeader("Content-Type", req.url === "/app.js" ? "text/javascript" : "text/html");
    if (req.url === "/lock-holder") { res.end("<!doctype html><title>Verrou local de recette</title>"); return; }
    res.end(req.url === "/app.js" ? script : '<!doctype html><title>Customer memory local fixture</title><div id="root"></div><script type="module" src="/app.js"></script>');
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); if (!address || typeof address === "string") throw new Error("No test port");
  origin = `http://127.0.0.1:${address.port}`; browser = await chromium.launch({ headless: true });
}, 30_000);
beforeEach(async () => { account = null; accountReads = 0; accountGate = undefined; releaseAccount = undefined;
  context = await browser.newContext({ serviceWorkers: "block" });
  await context.route("**/*", route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  page = await context.newPage(); });
afterEach(async () => { releaseAccount?.(); await context?.close(); });
afterAll(async () => { await browser?.close(); if (server) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); });
async function ready(target = page, suffix = "") {
  if (account) { await target.goto(origin + '/lock-holder'); await seedCustomerBrowserFixture(target, 'classfood'); }
  await target.goto(origin + suffix); await target.getByRole("heading", { name: "Coordonnées de recette" }).waitFor();
}
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
function holdAccountResponse() { accountGate = new Promise<void>(resolve => { releaseAccount = resolve; }); }
async function accountRequested() { await expect.poll(() => accountReads).toBeGreaterThan(0); }
async function authenticated() { await expect.poll(() => page.getByTestId("account-state").textContent()).toBe("authenticated"); }

describe("coordonnées du compte : vrai hook et réponses HTTP locales, sans fournisseur", () => {
  it("préremplit uniquement les champs vierges, sans sauvegarde automatique", async () => {
    account = profile(); await ready(); await eventuallyValue(page, "Nom", "Profil Compte");
    await eventuallyValue(page, "Téléphone", "+33600000001");
    expect(await page.getByTestId("name-source").textContent()).toBe("account");
    expect(await page.getByTestId("phone-source").textContent()).toBe("account");
    expect(await page.evaluate(key => localStorage.getItem(key), key)).toBeNull();
    expect(await page.evaluate(() => {
      const persisted = JSON.stringify([Object.entries(localStorage), Object.entries(sessionStorage)]);
      return persisted.includes("Profil Compte") || persisted.includes("+33600000001");
    })).toBe(false);
    await page.reload(); await eventuallyValue(page, "Nom", "Profil Compte");
    expect(await page.evaluate(key => localStorage.getItem(key), key)).toBeNull();
  });
  it("un profil HTTP retardé conserve la saisie volontaire et un champ volontairement vidé", async () => {
    account = profile(); holdAccountResponse(); await ready(); await accountRequested();
    await page.getByLabel("Nom", { exact: true }).fill("Saisie volontaire");
    await page.getByLabel("Téléphone", { exact: true }).fill("06");
    await page.getByLabel("Téléphone", { exact: true }).fill("");
    releaseAccount?.(); await authenticated();
    await eventuallyValue(page, "Nom", "Saisie volontaire"); await eventuallyValue(page, "Téléphone", "");
    expect(await page.getByTestId("name-source").textContent()).toBe("input");
    expect(await page.getByTestId("phone-source").textContent()).toBe("input");
  });
  it("la mémoire consentie passe avant le compte même si sa lecture arrive après le profil", async () => {
    account = profile(); await context.addInitScript(({ key, data }) => localStorage.setItem(key, JSON.stringify(data)), { key, data: saved() });
    const release = await holdMemoryLock();
    try {
      await ready(); await queuedMemoryRequest(); await authenticated();
      expect(await page.getByLabel("Nom", { exact: true }).inputValue()).toBe("");
      await release(); await eventuallyValue(page, "Nom", "Camille Test");
      expect(await page.getByTestId("name-source").textContent()).toBe("memory");
      await eventuallyValue(page, "Téléphone", "0600000000");
    } finally { await release(); }
  });
  it("la mémoire consentie reste prioritaire quand le profil arrive en dernier", async () => {
    account = profile(); holdAccountResponse();
    await context.addInitScript(({ key, data }) => localStorage.setItem(key, JSON.stringify(data)), { key, data: saved() });
    await ready(); await accountRequested(); await eventuallyValue(page, "Nom", "Camille Test");
    releaseAccount?.(); await authenticated(); await eventuallyValue(page, "Nom", "Camille Test");
    expect(await page.getByTestId("name-source").textContent()).toBe("memory");
  });
  it("une mémoire verrouillée ne retarde le compte que jusqu’à sa borne native de cinq secondes", async () => {
    account = profile(); const release = await holdMemoryLock();
    try {
      await ready(); await queuedMemoryRequest(); await accountRequested();
      // AbortSignal.timeout uses the browser's active clock, not Playwright's JS clock.
      await page.getByRole("status").filter({ hasText: "La mémorisation est indisponible" }).waitFor({ timeout: 7_000 });
      await eventuallyValue(page, "Nom", "Profil Compte");
      expect(await page.evaluate(key => localStorage.getItem(key), key)).toBeNull();
    } finally { await release(); }
  }, 10_000);
  it("une modification du nom ne transforme pas le téléphone du compte en saisie volontaire", async () => {
    account = profile(); await ready(); await eventuallyValue(page, "Nom", "Profil Compte");
    await page.getByLabel("Nom", { exact: true }).fill("Mon invité");
    expect(await page.getByTestId("name-source").textContent()).toBe("input");
    expect(await page.getByTestId("phone-source").textContent()).toBe("account");
    await page.getByRole("button", { name: "Déconnecter le compte" }).click();
    await expect.poll(() => page.getByTestId("account-state").textContent()).toBe("guest");
    await eventuallyValue(page, "Téléphone", ""); await eventuallyValue(page, "Nom", "Mon invité");
  });
  it("la mémorisation du profil exige un clic et reste consentie après perte de session et recharge", async () => {
    account = profile(); await ready(); await eventuallyValue(page, "Nom", "Profil Compte");
    await page.getByRole("button", { name: "Mémoriser ces coordonnées" }).click(); await committed();
    account = null; await page.reload(); await eventuallyValue(page, "Nom", "Profil Compte");
    expect(await page.getByTestId("name-source").textContent()).toBe("memory");
    await eventuallyValue(page, "Téléphone", "+33600000001");
    await page.getByRole("button", { name: "Effacer mes coordonnées" }).click();
    await eventuallyValue(page, "Nom", ""); await eventuallyValue(page, "Téléphone", "");
  });
  it("aucune lecture du compte en démonstration et aucune donnée privée transportée au changement de restaurant", async () => {
    account = profile(); await ready(page, "?demo=1"); await memoryCallbacksSettled();
    expect(accountReads).toBe(0);
    await page.getByRole("button", { name: "Changer de démonstration" }).click(); await eventuallyValue(page, "Nom", "Profil Compte");
    await page.getByRole("button", { name: "Changer de restaurant" }).click();
    await eventuallyValue(page, "Nom", ""); await eventuallyValue(page, "Téléphone", "");
  });
  it("le checkout intégré désactive le compte sans désactiver la mémoire invitée", async () => {
    account = profile(); await ready(page, "?embed=1"); await memoryCallbacksSettled();
    expect(accountReads).toBe(0); await eventuallyValue(page, "Nom", "");
    await fill(); await page.getByRole("button", { name: "Mémoriser ces coordonnées" }).click(); await committed();
    await page.reload(); await eventuallyValue(page, "Nom", "Camille Test");
    expect(accountReads).toBe(0);
    expect(await page.getByTestId("name-source").textContent()).toBe("memory");
  });
  it("le vrai Storefront embed raccorde le vrai checkout invité sans aucune route compte", async () => {
    account = profile(); let accountRequests = 0;
    page.on("request", request => { if (new URL(request.url()).pathname.includes("/compte/")) accountRequests++; });
    await page.goto(origin + "/embed-storefront");
    await page.getByRole("region", { name: "Boissons", exact: true }).getByRole("button", { name: /Canette recette/ }).click();
    await expect.poll(() => page.evaluate(() => localStorage.getItem("sm.cart.classfood"))).toContain("Canette recette");
    await page.getByRole("button", { name: /Voir mon panier/ }).click();
    // This boundary fixture does not compile Tailwind or assert layout. Use the
    // native keyboard path inside the real modal, whose body scroll is locked.
    const next = page.getByRole("dialog", { name: "Votre commande", exact: true }).getByRole("button", { name: /^Choisir le retrait/ });
    await expect.poll(() => next.isEnabled()).toBe(true); await next.focus(); await next.press("Enter");
    const toPay = page.getByRole("button", { name: /^Continuer · retrait/ });
    await expect.poll(() => toPay.isEnabled()).toBe(true); await toPay.focus(); await toPay.press("Enter");
    await page.getByRole("textbox", { name: "Prénom et nom", exact: true }).fill("Commande invitée embed");
    await page.getByRole("textbox", { name: "Téléphone", exact: true }).fill("0600000000");
    const save = page.getByRole("button", { name: "Mémoriser ces coordonnées" });
    await expect.poll(() => save.isEnabled()).toBe(true); await save.focus(); await save.press("Enter"); await committed();
    expect(accountReads).toBe(0); expect(accountRequests).toBe(0);
    expect(await page.getByText("Prérempli depuis votre compte", { exact: false }).count()).toBe(0);
    expect(await page.getByRole("button", { name: "Mon compte", exact: true }).count()).toBe(0);
  });
  it.each(["hidden", "offline"])("%s retire uniquement le profil, pas la saisie, même après relecture mémoire", async kind => {
    account = profile(); await ready(); await eventuallyValue(page, "Nom", "Profil Compte");
    await page.getByLabel("Nom", { exact: true }).fill("Saisie à garder");
    await page.evaluate(kind => {
      if (kind === "hidden") {
        Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
        document.dispatchEvent(new Event("visibilitychange"));
      } else {
        Object.defineProperty(navigator, "onLine", { configurable: true, value: false });
        window.dispatchEvent(new Event("offline"));
      }
    }, kind);
    await eventuallyValue(page, "Téléphone", ""); await eventuallyValue(page, "Nom", "Saisie à garder");
    await page.evaluate(() => window.dispatchEvent(new Event("focus"))); await memoryCallbacksSettled();
    await eventuallyValue(page, "Téléphone", ""); await eventuallyValue(page, "Nom", "Saisie à garder");
    expect(await page.evaluate(key => localStorage.getItem(key), key)).toBeNull();
  });
  it("une invalidation interonglets écarte aussi une réponse de profil retardée sans mémorisation", async () => {
    account = profile(); holdAccountResponse(); await ready(); await accountRequested();
    await page.getByLabel("Nom", { exact: true }).fill("Saisie avant réponse");
    const previousReads = accountReads;
    // The old HTTP response already captured a 200. The fresh authority is now
    // revoked: only that new request may determine the post-invalidation view.
    account = null;
    const second = await context.newPage(); await second.goto(origin + "/lock-holder");
    await second.evaluate(() => {
      const bus = new BroadcastChannel("sm:customer:invalidate:classfood");
      bus.postMessage(crypto.randomUUID()); bus.close();
    });
    await expect.poll(() => page.getByTestId("account-state").textContent()).toBe("idle");
    releaseAccount?.(); await expect.poll(() => accountReads).toBeGreaterThan(previousReads);
    await expect.poll(() => page.getByTestId("account-state").textContent()).toBe("guest");
    await memoryCallbacksSettled();
    await eventuallyValue(page, "Nom", "Saisie avant réponse"); await eventuallyValue(page, "Téléphone", "");
    expect(await page.getByTestId("account-state").textContent()).toBe("guest");
    expect(await page.evaluate(key => localStorage.getItem(key), key)).toBeNull();
  });
  it("fermer puis rouvrir relit la mémoire avant de réutiliser le compte", async () => {
    account = profile(); await ready(); await eventuallyValue(page, "Nom", "Profil Compte");
    await page.getByRole("button", { name: "Fermer le formulaire" }).click();
    const release = await holdMemoryLock();
    try {
      await page.getByRole("button", { name: "Rouvrir le formulaire" }).click(); await queuedMemoryRequest(); await authenticated();
      expect(await page.getByLabel("Nom", { exact: true }).inputValue()).toBe("");
      await release(); await eventuallyValue(page, "Nom", "Profil Compte");
    } finally { await release(); }
  });
  it("ne tronque pas un nom compte long : il reste intégral et modifiable", async () => {
    const longName = "Nom de compte ".repeat(7); account = profile(longName); await ready();
    await eventuallyValue(page, "Nom", longName.trim());
    await page.getByLabel("Nom", { exact: true }).fill("Nom pour la commande");
    expect(await page.getByTestId("name-source").textContent()).toBe("input");
  });
});

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
