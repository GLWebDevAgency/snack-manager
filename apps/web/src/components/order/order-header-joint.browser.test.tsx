import { createServer, type Server } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

declare global {
  interface Window {
    orderHeaderJointFixture: {
      showLockup: (visible: boolean) => void;
      measurements: number;
    };
  }
}

let server: Server, browser: Browser, context: BrowserContext, page: Page, origin: string;
let faults: string[] = [];

// Real header, category rail, brand resolver, Inter and production CSS. Only
// restaurant/catalogue data are fixtures; no height or geometry is mocked.
beforeAll(async () => {
  const directory = fileURLToPath(new URL(".", import.meta.url));
  const cssPath = fileURLToPath(new URL("../../app/globals.css", import.meta.url));
  const font = await readFile(new URL("../../../../../packages/ui-native/assets/fonts/InterVariable.ttf", import.meta.url));
  const bundle = await build({
    stdin: {
      sourcefile: "order-header-joint-entry.tsx", resolveDir: directory, loader: "tsx", contents: `
        import React from 'react';import{createRoot}from'react-dom/client';
        import{OrderHeader,OrderHero}from'./OrderHeader';import{MenuBoard}from'./MenuBoard';
        import{marqueDeRepli}from'@sm/contracts';import{styleDuMasque}from'../masque/styleDuMasque';
        import './order-v2.css';
        const fixture=window.orderHeaderJointFixture={showLockup:()=>{},measurements:0};
        const brand=marqueDeRepli(null,null);
        const categories=Array.from({length:4},(_,section)=>({id:'section-'+section,name:'La carte '+section,
          products:Array.from({length:10},(_,index)=>({id:section+'-'+index,name:'Recette maison '+index,
            description:'Préparée sur place.',price:890,variants:[],groups:[],removables:[],supplements:[],
            tags:[],isNew:false,popular:false,outOfStock:false,photoUrl:null,fromPrice:890,configurable:false}))}));
        const site={tenant:{slug:'fixture',name:'Le Comptoir',brand,logoUrl:null,brandColor:'#a44a2f',
          address:'',phones:['0102030405'],hours:[]},categories,medias:[],slots:null,
          reviews:{avg:0,count:0,latest:[]},ordering:{paused:false,message:null},
          openNow:true,todayHours:null,timezone:'Europe/Paris'};
        function App(){const[headerHeight,setHeaderHeight]=React.useState(0);
          const[lockup,setLockup]=React.useState(true);fixture.showLockup=setLockup;
          const onHeightChange=React.useCallback(height=>{fixture.measurements++;setHeaderHeight(height)},[]);
          return <div className="sm-order font-body min-h-dvh bg-bg text-ink" style={styleDuMasque(brand)}>
            <OrderHeader site={site} logoUrl={null} lockupUrl={lockup?'/lockup.svg':null}
              account={<button className="sm-order-icon" aria-label="Mon compte">C</button>}
              onHeightChange={onHeightChange}/>
            <main className="mx-auto w-full max-w-[1080px] px-4">
              <OrderHero site={site} src={null} position="center" alt="" onOrder={()=>{}}/>
              <MenuBoard categories={categories} inCart={{}} prixMono={false} stickyTop={headerHeight} onPick={()=>{}}/>
            </main>
          </div>
        }
        createRoot(document.getElementById('root')).render(<React.StrictMode><App/></React.StrictMode>);`,
    },
    bundle: true, write: false, outdir: "/virtual-header-joint", format: "esm", platform: "browser", target: "es2022", jsx: "automatic",
    alias: { react: fileURLToPath(new URL("../../../node_modules/react", import.meta.url)), "react-dom": fileURLToPath(new URL("../../../node_modules/react-dom", import.meta.url)) },
    define: { "process.env": "{}", "process.env.NODE_ENV": '"development"' },
  });
  const css = await postcss([tailwind({ base: fileURLToPath(new URL("../../..", import.meta.url)) })])
    .process(await readFile(cssPath, "utf8"), { from: cssPath });
  const javascript = bundle.outputFiles.find(file => file.path.endsWith(".js"))!.text;
  const stylesheet = css.css + (bundle.outputFiles.find(file => file.path.endsWith(".css"))?.text ?? "")
    + '@font-face{font-family:"Fixture Inter";src:url("/inter.ttf") format("truetype");font-weight:100 900;font-display:swap}:root{--font-inter:"Fixture Inter"}';
  server = createServer((request, response) => {
    response.setHeader("Cache-Control", "no-store");
    if (request.method !== "GET") { faults.push("HTTP mutation refused"); response.writeHead(405).end(); return; }
    switch (request.url) {
      case "/app.js": response.setHeader("Content-Type", "text/javascript"); response.end(javascript); return;
      case "/style.css": response.setHeader("Content-Type", "text/css"); response.end(stylesheet); return;
      case "/inter.ttf": response.setHeader("Content-Type", "font/ttf"); response.end(font); return;
      case "/lockup.svg":
        response.setHeader("Content-Type", "image/svg+xml");
        response.end('<svg xmlns="http://www.w3.org/2000/svg" width="240" height="40" viewBox="0 0 240 40"><rect width="240" height="40" rx="4" fill="#a44a2f"/><text x="12" y="27" fill="white" font-size="22">Le Comptoir</text></svg>'); return;
      case "/favicon.ico": response.writeHead(204).end(); return;
      case "/":
        response.setHeader("Content-Type", "text/html");
        response.end('<!doctype html><html lang="fr"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Joint du header et des catégories</title><link rel="stylesheet" href="/style.css"><div id="root"></div><script type="module" src="/app.js"></script></html>'); return;
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
  context = await browser.newContext({ viewport: { width: 330, height: 844 }, reducedMotion: "reduce", serviceWorkers: "block" });
  await context.route("**/*", route => {
    if (new URL(route.request().url()).origin === origin) return route.continue();
    faults.push("External request refused"); return route.abort();
  });
  page = await context.newPage(); page.setDefaultTimeout(4_000);
  page.on("pageerror", error => faults.push(error.message));
  page.on("console", message => { if (["warning", "error"].includes(message.type())) faults.push(message.text()); });
  await page.goto(origin);
  await page.getByRole("heading", { name: "Le Comptoir", exact: true }).waitFor();
  await page.evaluate(() => document.fonts.ready);
});
afterEach(async () => { await context?.close(); expect(faults).toEqual([]); });
afterAll(async () => { await browser?.close(); if (server) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); });

async function joint() {
  return page.evaluate(() => {
    const header = document.querySelector(".sm-order-header")!.getBoundingClientRect();
    const categories = document.querySelector(".sm-order-categories")!.getBoundingClientRect();
    return { headerTop: header.top, headerHeight: header.height, categoryTop: categories.top, gap: categories.top - header.bottom };
  });
}

async function expectClosedJoint() {
  await page.evaluate(() => window.scrollTo({ top: 450, behavior: "instant" }));
  await expect.poll(async () => Math.abs((await joint()).headerTop)).toBeLessThanOrEqual(1 / 64);
  // Actual painted border boxes must meet: neither a visible slit nor overlap.
  await expect.poll(async () => Math.abs((await joint()).gap)).toBeLessThanOrEqual(1 / 64);
}

async function resizeViewport(width: number) {
  await page.setViewportSize({ width, height: 844 });
  // Let media queries, ResizeObserver and React publish the new layout before
  // recording the identity's height for the subsequent logo round trip.
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
}

describe("OrderHeader — raccord sticky avec les catégories", () => {
  it.each([330, 820, 1280])("ferme le joint à %i px et le recalcule quand l’identité change de hauteur", async width => {
    await resizeViewport(width);
    await expect.poll(async () => (await joint()).headerHeight).toBeGreaterThan(73);
    const withLockup = await joint();
    expect(withLockup.headerHeight % 1, "La typographie réelle doit exercer une hauteur fractionnaire").toBeGreaterThan(0.1);
    await expectClosedJoint();

    const measurements = await page.evaluate(() => window.orderHeaderJointFixture.measurements);
    await page.evaluate(() => window.orderHeaderJointFixture.showLockup(false));
    await expect.poll(() => page.evaluate(() => window.orderHeaderJointFixture.measurements)).toBeGreaterThan(measurements);
    await expect.poll(async () => Math.abs((await joint()).headerHeight - withLockup.headerHeight)).toBeGreaterThan(1);
    await expectClosedJoint();

    await page.evaluate(() => window.orderHeaderJointFixture.showLockup(true));
    await expect.poll(async () => (await joint()).headerHeight).toBe(withLockup.headerHeight);
    await expectClosedJoint();
  });

  it("conserve le raccord pendant les redimensionnements du viewport mobile vers tablette et bureau", async () => {
    for (const width of [330, 820, 1280, 330]) {
      await resizeViewport(width);
      await expectClosedJoint();
    }
  });
});
