import { createServer, type Server } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";
import { chromium, type Browser, type BrowserContext, type Locator, type Page } from "playwright";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { BrandShape } from "@sm/contracts";

type FixtureConfiguration = { layout?: "rows" | "grid"; formats?: number; shape?: BrandShape; sheet?: boolean; variantLabels?: string[] };
declare global {
  interface Window {
    menuLayoutFixture: {
      configure: (configuration: FixtureConfiguration) => void;
      picks: { productId: string; variantKey: string | null }[];
    };
  }
}

let server: Server, browser: Browser, context: BrowserContext, page: Page, origin: string;
let faults: string[] = [];

// Actual MenuBoard, ProductPlate, Sheet, brand resolver and compiled Tailwind.
// Only catalogue data and an 800×600 image are fixtures; no API is contacted.
beforeAll(async () => {
  const directory = fileURLToPath(new URL(".", import.meta.url));
  const cssPath = fileURLToPath(new URL("../../app/globals.css", import.meta.url));
  const bundle = await build({
    stdin: {
      sourcefile: "menu-layout-entry.tsx", resolveDir: directory, loader: "tsx", contents: `
        import React from 'react';import{createRoot}from'react-dom/client';
        import{MenuBoard}from'./MenuBoard';import{Sheet}from'./primitives';
        import{marqueDeRepli}from'@sm/contracts';import{styleDuMasque}from'../masque/styleDuMasque';
        import './order-v2.css';
        const fixture=window.menuLayoutFixture={configure:()=>{},picks:[]};
        function product(index,config){return{
          id:'product-'+index,name:index===0?'Menu généreux aux légumes grillés':'Le suivant '+index,
          description:'Préparé minute, légumes grillés et sauce maison.',price:11990,
          variants:Array.from({length:config.formats},(_,i)=>({key:'format-'+i,name:(config.variantLabels??['M','L','XL','XXL'])[i],price:11990+i*100})),
          groups:[],removables:[],supplements:[],tags:[],isNew:false,popular:false,outOfStock:false,
          photoUrl:config.layout==='grid'?'/photo.svg':null,photoCover:false,fromPrice:11990,configurable:true,
        }}
        function App(){const[config,setConfig]=React.useState({layout:'rows',formats:2,shape:'doux',sheet:false});
          fixture.configure=patch=>setConfig(current=>({...current,...patch}));
          const brand={...marqueDeRepli(null,null),shape:config.shape};
          const products=Array.from({length:4},(_,index)=>product(index,config));
          return <div className="sm-order font-body min-h-dvh bg-bg text-ink" style={styleDuMasque(brand)}
            data-fixture-layout={config.layout} data-fixture-shape={config.shape} data-fixture-formats={config.formats}>
            <main className="mx-auto w-full max-w-[1080px] px-4">
              <MenuBoard categories={[{id:'menu',name:'Notre carte',products}]} inCart={{'product-0':2}} prixMono={false}
                onPick={(product,variantKey)=>fixture.picks.push({productId:product.id,variantKey:variantKey??null})}/>
              <Sheet open={config.sheet} title="Configuration de recette" onClose={()=>setConfig(c=>({...c,sheet:false}))}>
                <p className="p-4">Contenu de la feuille de recette.</p>
              </Sheet>
            </main>
          </div>
        }
        createRoot(document.getElementById('root')).render(<React.StrictMode><App/></React.StrictMode>);`,
    },
    bundle: true, write: false, outdir: "/virtual-menu-layout", format: "esm", platform: "browser", target: "es2022", jsx: "automatic",
    alias: { react: fileURLToPath(new URL("../../../node_modules/react", import.meta.url)), "react-dom": fileURLToPath(new URL("../../../node_modules/react-dom", import.meta.url)) },
    define: { "process.env": "{}", "process.env.NODE_ENV": '"development"' },
  });
  const css = await postcss([tailwind({ base: fileURLToPath(new URL("../../..", import.meta.url)) })])
    .process(await readFile(cssPath, "utf8"), { from: cssPath });
  const javascript = bundle.outputFiles.find(file => file.path.endsWith(".js"))!.text;
  const stylesheet = css.css + (bundle.outputFiles.find(file => file.path.endsWith(".css"))?.text ?? "");
  server = createServer((request, response) => {
    response.setHeader("Cache-Control", "no-store");
    if (request.method !== "GET") { faults.push("HTTP mutation refused"); response.writeHead(405).end(); return; }
    switch (request.url) {
      case "/app.js": response.setHeader("Content-Type", "text/javascript"); response.end(javascript); return;
      case "/style.css": response.setHeader("Content-Type", "text/css"); response.end(stylesheet); return;
      case "/photo.svg":
        response.setHeader("Content-Type", "image/svg+xml");
        response.end('<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600" viewBox="0 0 800 600"><rect x="100" y="100" width="600" height="400" rx="60" fill="#3fae4a"/></svg>'); return;
      case "/favicon.ico": response.writeHead(204).end(); return;
      case "/":
        response.setHeader("Content-Type", "text/html");
        response.end('<!doctype html><html lang="fr"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Menu layout fixture</title><link rel="stylesheet" href="/style.css"><div id="root"></div><script type="module" src="/app.js"></script></html>'); return;
      default: faults.push("Unexpected fixture request"); response.writeHead(404).end();
    }
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); if (!address || typeof address === "string") throw new Error("No fixture port");
  origin = `http://127.0.0.1:${address.port}`;
  browser = await chromium.launch({ headless: true });
}, 30_000);

beforeEach(async () => {
  faults = [];
  context = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: "reduce", serviceWorkers: "block" });
  await context.route("**/*", route => {
    if (new URL(route.request().url()).origin === origin) return route.continue();
    faults.push("External request refused"); return route.abort();
  });
  page = await context.newPage(); page.setDefaultTimeout(4_000);
  page.on("pageerror", error => faults.push(error.message));
  page.on("console", message => { if (["warning", "error"].includes(message.type())) faults.push(message.text()); });
  await page.goto(origin);
  await page.getByRole("article", { name: "Menu généreux aux légumes grillés", exact: true }).waitFor();
});
afterEach(async () => { await context?.close(); expect(faults).toEqual([]); });
afterAll(async () => { await browser?.close(); if (server) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); });

async function configure(configuration: FixtureConfiguration, width = 390) {
  await page.setViewportSize({ width, height: width >= 768 ? 1180 : 844 });
  await page.evaluate(configuration => window.menuLayoutFixture.configure(configuration), configuration);
  if (configuration.layout) await expect.poll(() => page.locator("[data-fixture-layout]").getAttribute("data-fixture-layout")).toBe(configuration.layout);
  if (configuration.formats !== undefined) await expect.poll(() => page.locator("[data-fixture-formats]").getAttribute("data-fixture-formats")).toBe(String(configuration.formats));
  if (configuration.shape) await expect.poll(() => page.locator("[data-fixture-shape]").getAttribute("data-fixture-shape")).toBe(configuration.shape);
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
}
const firstProduct = () => page.getByRole("article", { name: "Menu généreux aux légumes grillés", exact: true });
async function bounds(locator: Locator) {
  return locator.evaluate(element => { const r = element.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height }; });
}
function expectContained(inner: Awaited<ReturnType<typeof bounds>>, outer: Awaited<ReturnType<typeof bounds>>, label: string) {
  expect(inner.left, `${label}: left`).toBeGreaterThanOrEqual(outer.left - 1);
  expect(inner.right, `${label}: right`).toBeLessThanOrEqual(outer.right + 1);
  expect(inner.top, `${label}: top`).toBeGreaterThanOrEqual(outer.top - 1);
  expect(inner.bottom, `${label}: bottom`).toBeLessThanOrEqual(outer.bottom + 1);
}

describe("MenuBoard — géométrie responsive du catalogue réel", () => {
  it("annonce un minimum de section pour les formats et réserve le prix unique aux produits sans variante", async () => {
    await configure({ layout: "rows", formats: 4 }, 320);
    const category = page.locator("#cat-menu");
    expect(await category.getByText(/^À partir de 119,90\s*€$/).count()).toBe(1);
    expect(await category.getByText(/^Tous à /).count()).toBe(0);
    expect(await firstProduct().getByRole("group").getByRole("button").last().innerText()).toMatch(/122,90/);
    await configure({ formats: 0 }, 320);
    expect(await category.getByText(/^Tous à 119,90\s*€$/).count()).toBe(1);
    expect(await category.getByText(/^À partir de /).count()).toBe(0);
  });

  it.each([2, 3, 4])("contient les %i formats de chaque ligne sans recouvrir le produit suivant", async formats => {
    await configure({ layout: "rows", formats });
    const rows = page.locator(".sm-order-product-row");
    expect(await rows.count()).toBe(4);
    for (let index = 0; index < 4; index++) {
      const row = rows.nth(index), rectangle = await bounds(row);
      expectContained(await bounds(row.locator(".sm-order-product-button")), rectangle, `row ${index} button`);
      expectContained(await bounds(row.getByRole("group")), rectangle, `row ${index} variants`);
      if (index < 3) expect(rectangle.bottom).toBeLessThanOrEqual((await bounds(rows.nth(index + 1))).top + 1);
    }
    await firstProduct().getByRole("group").getByRole("button").last().click();
    expect(await page.evaluate(() => window.menuLayoutFixture.picks)).toEqual([{ productId: "product-0", variantKey: `format-${formats - 1}` }]);
  });

  it.each([320, 330, 390])("garde prix dès 119,90 €, compteur et action dans les cartes à %i px", async width => {
    await configure({ layout: "grid", formats: 4 }, width);
    const cards = page.locator(".sm-order-product-card");
    expect(await cards.count()).toBe(4);
    for (let index = 0; index < 4; index++) {
      const card = cards.nth(index), rectangle = await bounds(card), button = card.locator(".sm-order-product-button");
      const footer = card.locator(".sm-order-product-footer");
      expect(await footer.innerText()).toMatch(/119,90/);
      expect((await footer.innerText()).toLowerCase()).toContain("dès");
      expectContained(await bounds(footer), rectangle, `card ${index} footer`);
      const children = footer.locator(":scope > *");
      for (let child = 0; child < await children.count(); child++) expectContained(await bounds(children.nth(child)), rectangle, `card ${index} footer child ${child}`);
      // A fitting wrapper can still hide overflowing price text inside it.
      const textBounds = await footer.evaluate(element => {
        const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT), result = [];
        while (walker.nextNode()) {
          if (!walker.currentNode.textContent?.trim()) continue;
          const range = document.createRange(); range.selectNodeContents(walker.currentNode);
          const r = range.getBoundingClientRect();
          result.push({ left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height });
        }
        return result;
      });
      for (const textRectangle of textBounds) expectContained(textRectangle, rectangle, `card ${index} price/quantity text`);
      const target = await bounds(button);
      expect(target.width).toBeGreaterThanOrEqual(44); expect(target.height).toBeGreaterThanOrEqual(44);
    }
    expect(await firstProduct().locator(".sm-order-product-footer > [aria-hidden]").innerText()).toBe("2");
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  });

  it("contraint la photo intrinsèque 800×600 au plateau contain à 820 px", async () => {
    await configure({ layout: "grid", formats: 0 }, 820);
    const photos = page.locator(".sm-order-product-photo");
    expect(await photos.count()).toBe(4);
    for (let index = 0; index < 4; index++) {
      const frame = photos.nth(index), img = frame.locator("img");
      await img.scrollIntoViewIfNeeded();
      await expect.poll(() => img.evaluate(node => (node as HTMLImageElement).naturalWidth)).toBe(800);
      expect(await img.evaluate(node => (node as HTMLImageElement).naturalHeight)).toBe(600);
      expect(await img.evaluate(node => getComputedStyle(node).objectFit)).toBe("contain");
      const rectangle = await bounds(frame);
      expect(rectangle.height).toBeGreaterThan(0); expect(rectangle.height).toBeLessThanOrEqual(220);
      expectContained(await bounds(img), rectangle, `photo ${index}`);
    }
  });

  it("répartit quatre formats sur deux colonnes quand la carte mobile est assez large", async () => {
    await configure({ layout: "grid", formats: 4 }, 430);
    const chips = firstProduct().getByRole("group").getByRole("button");
    expect(await chips.count()).toBe(4);
    const rectangles = await Promise.all([0, 1, 2, 3].map(index => bounds(chips.nth(index))));
    expect(Math.abs(rectangles[0].top - rectangles[1].top)).toBeLessThanOrEqual(1);
    expect(Math.abs(rectangles[2].top - rectangles[3].top)).toBeLessThanOrEqual(1);
    expect(rectangles[2].top).toBeGreaterThan(rectangles[0].bottom);
    expect(rectangles[1].left).toBeGreaterThan(rectangles[0].right);
    for (const rectangle of rectangles) { expect(rectangle.height).toBeGreaterThanOrEqual(44); expectContained(rectangle, await bounds(firstProduct()), "format chip"); }
  });

  it("garde Classique entier et les prix contenus dans la carte étroite, puis rétablit deux colonnes de formats", async () => {
    for (const width of [330, 390, 430, 820]) {
      await configure({ layout: "grid", formats: 2, variantLabels: ["Classique", "XL"] }, width);
      const card = firstProduct(), group = card.getByRole("group"), chips = group.getByRole("button");
      const columns = await group.evaluate(element => getComputedStyle(element).gridTemplateColumns.split(" ").length);
      expect(columns).toBe(width <= 390 ? 1 : 2);
      expect(await page.locator(".sm-order-product-grid").evaluate(element => getComputedStyle(element).gridTemplateColumns.split(" ").length)).toBe(width === 820 ? 3 : 2);
      const rectangles = await chips.first().evaluate(element => {
        const label = Array.from(element.childNodes).find(node => node.nodeType === Node.TEXT_NODE && node.textContent?.trim() === "Classique")!;
        const range = document.createRange(); range.selectNodeContents(label);
        return Array.from(range.getClientRects()).map(r => ({ left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height }));
      });
      expect(rectangles, `Classique reste sur une ligne à ${width} px, y compris avec la police de repli`).toHaveLength(1);
      for (const rectangle of rectangles) expectContained(rectangle, await bounds(chips.first()), "Classique label");
      for (let index = 0; index < await chips.count(); index++) {
        const button = chips.nth(index), target = await bounds(button);
        expect(target.height).toBeGreaterThanOrEqual(44);
        expectContained(target, await bounds(card), "variant target");
        expectContained(await bounds(button.locator("span")), target, "variant price");
      }
    }
    await firstProduct().getByRole("group").getByRole("button").last().click();
    expect(await page.evaluate(() => window.menuLayoutFixture.picks)).toEqual([{ productId: "product-0", variantKey: "format-1" }]);
  });

  it.each([
    { shape: "net" as const, card: 4, chip: 3, modal: 8 },
    { shape: "doux" as const, card: 10, chip: 8, modal: 18 },
    { shape: "rond" as const, card: 18, chip: 15, modal: 28 },
  ])("applique réellement la forme $shape aux cartes, chips et feuilles", async ({ shape, card, chip, modal }) => {
    await configure({ layout: "grid", formats: 2, shape });
    const radius = (locator: Locator) => locator.evaluate(node => parseFloat(getComputedStyle(node).borderTopLeftRadius));
    expect(await radius(firstProduct())).toBe(card);
    expect(await radius(firstProduct().getByRole("group").getByRole("button").first())).toBe(chip);
    await configure({ sheet: true });
    const dialog = page.getByRole("dialog", { name: "Configuration de recette", exact: true });
    await dialog.waitFor();
    expect(await radius(dialog)).toBe(modal);
  });
});
