import { createServer, type Server } from "node:http";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { afterAll, afterEach, beforeAll, beforeEach, expect, it } from "vitest";

let server: Server, browser: Browser, context: BrowserContext, page: Page, origin: string;
let errors: string[];
beforeAll(async () => {
  const built = await build({ stdin: { resolveDir: fileURLToPath(new URL(".", import.meta.url)), sourcefile: "dialog-chain-fixture.tsx", loader: "tsx", contents: `
    import React,{useState}from'react';import{createRoot}from'react-dom/client';import{Modal}from'./Modal';import{Drawer}from'./Drawer';
    function Composer({close}){const[confirm,setConfirm]=useState(false);return <Drawer open title='Composition' onClose={close}><button onClick={()=>setConfirm(true)}>Confirmer abandon</button><input aria-label='Titre de boucle'/><Modal open={confirm} title='Abandonner les modifications ?' onClose={()=>setConfirm(false)}><button onClick={close}>Abandonner tout</button><button onClick={()=>setConfirm(false)}>Continuer la composition</button></Modal></Drawer>}
    function Nested({close}){const[edit,setEdit]=useState(false);return <Modal open title='Réglages ouverts' onClose={close}><button onClick={()=>setEdit(true)}>Ouvrir composition imbriquée</button>{edit&&<Composer close={()=>setEdit(false)}/>}</Modal>}
    function App(){const[composer,setComposer]=useState(false);const[nested,setNested]=useState(false);const[parent,setParent]=useState(false);const[child,setChild]=useState(false);return <main><button onClick={()=>setComposer(true)}>Composer la boucle</button><button onClick={()=>setNested(true)}>Réglages</button><button onClick={()=>setParent(true)}>Ouvrir le parent indépendant</button>{composer&&<Composer close={()=>setComposer(false)}/>} {nested&&<Nested close={()=>setNested(false)}/>}
      <Modal open={parent} title='Parent indépendant' onClose={()=>setParent(false)}><button onClick={()=>setChild(true)}>Ouvrir enfant indépendant</button></Modal>
      <Modal open={child} title='Enfant indépendant' onClose={()=>setChild(false)}><button onClick={()=>setParent(false)}>Retirer seulement le parent</button><button onClick={()=>setChild(false)}>Terminer enfant</button></Modal>
    </main>};createRoot(document.getElementById('root')).render(<React.StrictMode><App/></React.StrictMode>);
  ` }, bundle: true, write: false, format: "esm", platform: "browser", jsx: "automatic", define: { "process.env.NODE_ENV": '"development"' } });
  server = createServer((request, response) => {
    if (request.url === "/app.js") { response.setHeader("Content-Type", "text/javascript").end(built.outputFiles[0].text); return; }
    response.setHeader("Content-Type", "text/html").end('<!doctype html><html><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;font:16px sans-serif}button,input{min-height:44px}[role=dialog]{position:fixed;inset:0;background:white;padding:20px}main{min-height:1600px}</style><div id="root"></div><script type="module" src="/app.js"></script></html>');
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); if (!address || typeof address === "string") throw Error("No local fixture port");
  origin = `http://127.0.0.1:${address.port}`; browser = await chromium.launch({ headless: true });
}, 30000);
beforeEach(async () => {
  errors = []; context = await browser.newContext({ viewport: { width: 320, height: 850 }, serviceWorkers: "block", reducedMotion: "reduce" });
  await context.route("**/*", route => new URL(route.request().url()).origin === origin ? route.continue() : (errors.push("External request blocked"), route.abort()));
  await context.routeWebSocket("**/*", socket => { errors.push("WebSocket blocked"); socket.close(); });
  page = await context.newPage(); page.setDefaultTimeout(3000); page.on("pageerror", error => errors.push(error.message)); await page.goto(origin);
});
afterEach(async () => { await context.close(); expect(errors).toEqual([]); });
afterAll(async () => { await browser?.close(); await new Promise<void>(resolve => server?.close(() => resolve())); });
const button = (name: string) => page.getByRole("button", { name, exact: true });
async function focused(name: string) { await expect.poll(() => button(name).evaluate(node => node === document.activeElement)).toBe(true); }
async function openConfirmation() { await button("Composer la boucle").click(); await button("Confirmer abandon").click(); }

it("restaure le déclencheur de page lorsque la confirmation et le Drawer sont démontés ensemble", async () => {
  await openConfirmation(); await button("Abandonner tout").click(); await focused("Composer la boucle");
  expect(await page.getByRole("dialog").count()).toBe(0);
  expect(await page.locator("[inert]").count()).toBe(0);
  expect(await page.evaluate(() => document.body.style.position)).toBe("");
  await page.keyboard.press("Tab"); await focused("Réglages");
});

it("restaure le déclencheur du parent qui reste ouvert et garde son isolation clavier", async () => {
  await openConfirmation(); await button("Continuer la composition").click(); await focused("Confirmer abandon");
  expect(await page.getByRole("dialog", { name: "Composition", exact: true }).isVisible()).toBe(true);
  await page.getByRole("button", { name: "Composer la boucle", exact: true, includeHidden: true }).evaluate(node => (node as HTMLElement).focus());
  expect(await page.getByRole("dialog", { name: "Composition", exact: true }).evaluate(node => node.contains(document.activeElement))).toBe(true);
  await page.keyboard.press("Escape"); await focused("Composer la boucle");
});

it("retrouve le déclencheur du grand-parent quand deux niveaux enfants ferment ensemble", async () => {
  await button("Réglages").click(); await button("Ouvrir composition imbriquée").click();
  await button("Confirmer abandon").click(); await button("Abandonner tout").click();
  await focused("Ouvrir composition imbriquée");
  expect(await page.getByRole("dialog").count()).toBe(1);
  await page.keyboard.press("Escape"); await focused("Réglages");
});

it("garde l’enfant actif pendant le retrait du parent puis retrouve le déclencheur survivant", async () => {
  await button("Ouvrir le parent indépendant").click(); await button("Ouvrir enfant indépendant").click();
  await button("Retirer seulement le parent").click();
  expect(await page.getByRole("dialog", { name: "Enfant indépendant", exact: true }).evaluate(node => node.contains(document.activeElement))).toBe(true);
  await button("Terminer enfant").click(); await focused("Ouvrir le parent indépendant");
  expect(await page.locator("[inert]").count()).toBe(0);
});
