import { createServer, type Server } from "node:http";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { CartApi } from "./cart";

declare global {
  interface Window {
    testCart: CartApi;
    savedClear: () => Promise<boolean>;
    releaseCartLock: () => void;
    holdingCartLock: boolean;
    checkoutCanClear: boolean;
    savedAppend: CartApi['appendIfUnchanged'];
  }
}

let server: Server;
let browser: Browser;
let context: BrowserContext;
let page: Page;
let origin: string;

beforeAll(async () => {
  const bundle = await build({
    stdin: {
      contents: `import React from 'react';
        import {createRoot} from 'react-dom/client';
        import {useCart} from './cart';
        const product = {id:'burger',name:'Burger',description:'',price:1000,fromPrice:1000,variants:[],groups:[],supplements:[],removables:[],tags:[],isNew:false,outOfStock:false,photoUrl:null,configurable:false};
        const index = new Map([[product.id, product]]);
        const line = {lineId:'line-burger',productId:'burger',name:'Burger',photoUrl:null,variantKey:null,variantName:null,options:[],removed:[],note:null,qty:1,unitPrice:1000};
        function App(){
          const slug=new URL(location.href).searchParams.get('tenant') || 'classfood';
          const cart=useCart(slug,index);
          React.useLayoutEffect(()=>{window.testCart=cart},[cart]);
          return React.createElement('main',null,
            React.createElement('p',{'data-testid':'count'},String(cart.count)),
            React.createElement('p',{'data-testid':'error'},cart.persistenceError||''),
            React.createElement('p',{'data-testid':'dropped',role:'status'},cart.dropped.join(', ')),
            React.createElement('button',{onClick:()=>cart.upsert(line),disabled:!cart.hydrated},'Ajouter'),
            React.createElement('button',{onClick:()=>cart.setQty('line-burger',2)},'Deux'),
            React.createElement('button',{onClick:()=>cart.remove('line-burger')},'Retirer'),
            React.createElement('button',{onClick:()=>cart.clear()},'Vider'),
            React.createElement('input',{'aria-label':'Note',value:cart.note,onChange:e=>cart.setNote(e.target.value)}));
        }
        createRoot(document.getElementById('root')).render(React.createElement(React.StrictMode,null,React.createElement(App)));`,
      resolveDir: fileURLToPath(new URL(".", import.meta.url)),
      sourcefile: "cart-test-entry.tsx", loader: "tsx",
    },
    bundle: true, write: false, format: "esm", platform: "browser", target: "es2022",
    define: { "process.env.NODE_ENV": '"development"' },
  });
  server = createServer((req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Content-Type", req.url === "/cart.js" ? "text/javascript" : "text/html");
    res.end(req.url === "/cart.js" ? bundle.outputFiles[0].text : '<!doctype html><title>Native cart concurrency test</title><div id="root"></div><script type="module" src="/cart.js"></script>');
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing local port");
  origin = `http://127.0.0.1:${address.port}`;
  browser = await chromium.launch({ headless: true });
}, 30_000);

beforeEach(async () => {
  context = await browser.newContext({ serviceWorkers: "block" });
  page = await context.newPage();
  await page.goto(origin);
  await page.waitForFunction(() => window.testCart?.hydrated);
});
afterEach(async () => { await context?.close(); });
afterAll(async () => {
  await browser?.close();
  if (server) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
});

async function secondTab(tenant = "classfood") {
  const second = await context.newPage();
  await second.goto(`${origin}?tenant=${tenant}`);
  await second.waitForFunction(() => window.testCart?.hydrated);
  return second;
}
async function addBurger(target = page) {
  await target.getByRole("button", { name: "Ajouter", exact: true }).click();
  await target.waitForFunction(() => window.testCart.count === 1);
}

describe("panier réel React et verrou inter-onglets", () => {
  it('ajoute une reprise explicitement confirmée sans écraser le panier ni réutiliser les identifiants de prévisualisation', async () => {
    await addBurger();
    const result = await page.evaluate(() => window.testCart.appendIfUnchanged([{ ...window.testCart.lines[0], qty: 2 }], async () => true));
    expect(result).toBe(true);
    expect(await page.evaluate(() => window.testCart.count)).toBe(3);
    expect(await page.evaluate(() => new Set(window.testCart.lines.map(line => line.lineId)).size)).toBe(2);
    await page.reload(); await page.waitForFunction(() => window.testCart?.hydrated);
    expect(await page.evaluate(() => window.testCart.count)).toBe(3);
  });
  it('refuse la reprise si le panier a changé depuis la confirmation affichée', async () => {
    await addBurger();
    await page.evaluate(() => { window.savedAppend = window.testCart.appendIfUnchanged; });
    const second = await secondTab();
    await second.getByRole('button', { name: 'Deux', exact: true }).click();
    await second.waitForFunction(() => window.testCart.count === 2);
    expect(await page.evaluate(() => window.savedAppend([window.testCart.lines[0]], async () => true))).toBe(false);
    expect(await page.evaluate(() => window.testCart.count)).toBe(2);
  });
  it('réévalue l’accès après attente du verrou panier avant tout ajout privé', async () => {
    await addBurger();
    const second = await secondTab();
    await second.evaluate(() => { void navigator.locks.request('sm.cart.write.classfood', () => new Promise<void>(resolve => {
      window.holdingCartLock = true; window.releaseCartLock = resolve;
    })); });
    await second.waitForFunction(() => window.holdingCartLock);
    await page.evaluate(() => { window.checkoutCanClear = true; });
    const adding = page.evaluate(() => window.testCart.appendIfUnchanged([window.testCart.lines[0]], async () => window.checkoutCanClear));
    await page.waitForFunction(async () => (await navigator.locks.query()).pending!.length >= 1);
    await page.evaluate(() => { window.checkoutCanClear = false; });
    await second.evaluate(() => window.releaseCartLock());
    expect(await adding).toBe(false);
    expect(await page.evaluate(() => window.testCart.count)).toBe(1);
  });
  it('refuse un ajout partiel ou retarifé en silence', async () => {
    await addBurger();
    for (const change of [{ productId: 'absent' }, { unitPrice: 1 }, { variantKey: 'absent' }, { qty: 51 }]) {
      expect(await page.evaluate(delta => window.testCart.appendIfUnchanged([{ ...window.testCart.lines[0], ...delta }], async () => true), change)).toBe(false);
    }
    expect(await page.evaluate(() => window.testCart.count)).toBe(1);
  });
  it('ne confirme jamais une reprise qui dépasserait les 50 lignes acceptées au checkout', async () => {
    await addBurger();
    await page.evaluate(() => {
      const stored = JSON.parse(localStorage.getItem('sm.cart.classfood')!);
      stored.lines = Array.from({ length: 49 }, (_, i) => ({ ...stored.lines[0], lineId: `existing-${i}` }));
      localStorage.setItem('sm.cart.classfood', JSON.stringify(stored));
    });
    await page.reload(); await page.waitForFunction(() => window.testCart?.hydrated && window.testCart.lines.length === 49);
    expect(await page.evaluate(() => window.testCart.appendIfUnchanged([window.testCart.lines[0], window.testCart.lines[0]], async () => true))).toBe(false);
    expect(await page.evaluate(() => window.testCart.lines.length)).toBe(49);
    expect(await page.evaluate(() => window.testCart.appendIfUnchanged([window.testCart.lines[0]], async () => true))).toBe(true);
    await page.waitForFunction(() => window.testCart.lines.length === 50);
  });
  it("signale une sélection disparue après relecture sans réécrire le stockage ni perdre la ligne valide", async () => {
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await addBurger();
    const raw = await page.evaluate(() => {
      const stored = JSON.parse(localStorage.getItem("sm.cart.classfood")!);
      const line = stored.lines[0];
      stored.lines = [{ ...line, variantKey: "grand", variantName: "Grand", removed: ["oignons"] },
        { ...line, lineId: "line-valid", qty: 2 }];
      const value = JSON.stringify(stored);
      localStorage.setItem("sm.cart.classfood", value);
      return value;
    });
    await page.reload();
    await page.waitForFunction(() => window.testCart?.hydrated);
    expect(await page.getByTestId("count").textContent()).toBe("2");
    expect(await page.getByTestId("dropped").textContent()).toBe("Burger");
    expect(await page.evaluate(() => localStorage.getItem("sm.cart.classfood"))).toBe(raw);
    const second = await secondTab();
    expect(await second.getByTestId("dropped").textContent()).toBe("Burger");
    await page.evaluate(() => { window.dispatchEvent(new Event("focus")); window.dispatchEvent(new Event("pageshow")); });
    await page.evaluate(async () => { await navigator.locks.request("sm.cart.write.classfood", () => undefined); });
    expect(await page.getByTestId("count").textContent()).toBe("2");
    expect(await page.evaluate(() => localStorage.getItem("sm.cart.classfood"))).toBe(raw);
    expect(errors).toEqual([]);
  });

  it("écrit les actions avant publication et conserve quantité/note après recharge", async () => {
    await addBurger();
    await page.getByRole("button", { name: "Deux", exact: true }).click();
    await page.getByRole("textbox", { name: "Note", exact: true }).fill("Nouvelle commande");
    await page.waitForFunction(() => window.testCart.count === 2 && window.testCart.note === "Nouvelle commande");
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem("sm.cart.classfood")!).lines[0].qty)).toBe(2);
    await page.reload();
    await page.waitForFunction(() => window.testCart?.hydrated && window.testCart.count === 2);
    expect(await page.getByRole("textbox", { name: "Note", exact: true }).inputValue()).toBe("Nouvelle commande");
  });

  it("un callback A ancien ne vide pas le panier B et recharge son contenu", async () => {
    await addBurger();
    await page.evaluate(() => { window.savedClear = window.testCart.clearIfUnchanged; });
    const second = await secondTab();
    await second.getByRole("button", { name: "Deux", exact: true }).click();
    await second.getByRole("textbox", { name: "Note", exact: true }).fill("Panier B");
    await second.waitForFunction(() => window.testCart.count === 2 && window.testCart.note === "Panier B");
    expect(await page.evaluate(() => window.savedClear())).toBe(false);
    await page.waitForFunction(() => window.testCart.count === 2 && window.testCart.note === "Panier B");
    await second.reload();
    await second.waitForFunction(() => window.testCart?.hydrated && window.testCart.count === 2);
    expect(await second.getByRole("textbox", { name: "Note", exact: true }).inputValue()).toBe("Panier B");
  });

  it("ne réinjecte pas A après vidage, sous StrictMode, focus et recharge", async () => {
    await addBurger();
    const second = await secondTab();
    expect(await page.evaluate(() => window.testCart.clearIfUnchanged())).toBe(true);
    await second.waitForFunction(() => window.testCart.count === 0);
    await page.evaluate(() => { window.dispatchEvent(new Event("focus")); window.dispatchEvent(new Event("pageshow")); });
    await page.reload();
    await page.waitForFunction(() => window.testCart?.hydrated);
    expect(await page.evaluate(() => window.testCart.count)).toBe(0);
    expect(await page.evaluate(() => localStorage.getItem("sm.cart.classfood"))).toBeNull();
  });

  it("sérialise clear et une écriture en attente sans publication optimiste", async () => {
    await addBurger();
    const second = await secondTab();
    await second.evaluate(() => {
      void navigator.locks.request("sm.cart.write.classfood", () => new Promise<void>((resolve) => {
        window.releaseCartLock = resolve;
        window.holdingCartLock = true;
      }));
    });
    await second.waitForFunction(() => window.holdingCartLock);
    const clearing = page.evaluate(() => window.testCart.clearIfUnchanged());
    await page.waitForFunction(async () => (await navigator.locks.query()).pending!.length >= 1);
    await second.evaluate(() => window.testCart.setQty("line-burger", 2));
    expect(await second.evaluate(() => window.testCart.count)).toBe(1);
    await second.evaluate(() => window.releaseCartLock());
    expect(await clearing).toBe(true);
    await second.waitForFunction(() => window.testCart.count === 2);
    expect(await second.evaluate(() => JSON.parse(localStorage.getItem("sm.cart.classfood")!).lines[0].qty)).toBe(2);
  });

  it("réévalue l’autorisation du reçu dans le verrou avant de vider le panier", async () => {
    await addBurger();
    const raw = await page.evaluate(() => localStorage.getItem("sm.cart.classfood"));
    const second = await secondTab();
    await second.evaluate(() => {
      void navigator.locks.request("sm.cart.write.classfood", () => new Promise<void>(resolve => {
        window.releaseCartLock = resolve;
        window.holdingCartLock = true;
      }));
    });
    await second.waitForFunction(() => window.holdingCartLock);
    await page.evaluate(() => { window.checkoutCanClear = true; });
    const clearing = page.evaluate(() => window.testCart.clearIfUnchanged(() => window.checkoutCanClear));
    await page.waitForFunction(async () => (await navigator.locks.query()).pending!.some(lock => lock.name === "sm.cart.write.classfood"));
    await page.evaluate(() => { window.checkoutCanClear = false; });
    await second.evaluate(() => window.releaseCartLock());
    expect(await clearing).toBe(false);
    expect(await page.getByTestId("count").textContent()).toBe("1");
    expect(await page.evaluate(() => localStorage.getItem("sm.cart.classfood"))).toBe(raw);
    expect(await page.getByTestId("error").textContent()).toBe("");
    expect(await page.evaluate(() => window.testCart.clearIfUnchanged(() => true))).toBe(true);
    expect(await page.evaluate(() => localStorage.getItem("sm.cart.classfood"))).toBeNull();
  });

  it("sans Web Locks, ne vide ni modifie le panier et retourne false", async () => {
    await addBurger();
    await page.evaluate(() => { Object.defineProperty(navigator, "locks", { configurable: true, value: undefined }); });
    expect(await page.evaluate(() => window.testCart.clearIfUnchanged())).toBe(false);
    await page.getByRole("button", { name: "Deux", exact: true }).click();
    await page.waitForFunction(() => !!window.testCart.persistenceError);
    expect(await page.evaluate(() => window.testCart.count)).toBe(1);
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem("sm.cart.classfood")!).lines[0].qty)).toBe(1);
  });

  it("un quota atteint conserve l’écran et le panier existants sans promesse rejetée non gérée", async () => {
    await addBurger();
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.evaluate(() => {
      Storage.prototype.removeItem = () => { throw new DOMException("quota", "QuotaExceededError"); };
      Storage.prototype.setItem = () => { throw new DOMException("quota", "QuotaExceededError"); };
    });
    expect(await page.evaluate(() => window.testCart.clearIfUnchanged())).toBe(false);
    await page.getByRole("button", { name: "Deux", exact: true }).click();
    await page.waitForFunction(() => !!window.testCart.persistenceError);
    expect(await page.evaluate(() => window.testCart.count)).toBe(1);
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem("sm.cart.classfood")!).lines[0].qty)).toBe(1);
    expect(errors).toEqual([]);
  });

  it("isole les restaurateurs même dans un contexte navigateur partagé", async () => {
    await addBurger();
    const second = await secondTab("pizza-vita");
    expect(await second.evaluate(() => window.testCart.count)).toBe(0);
    await addBurger(second);
    expect(await page.evaluate(() => window.testCart.clearIfUnchanged())).toBe(true);
    expect(await second.evaluate(() => window.testCart.count)).toBe(1);
    expect(await second.evaluate(() => JSON.parse(localStorage.getItem("sm.cart.pizza-vita")!).lines[0].qty)).toBe(1);
  });
});
