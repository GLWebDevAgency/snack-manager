import { createServer, type Server } from "node:http";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { afterAll, afterEach, beforeAll, beforeEach, expect, it } from "vitest";

let server: Server, browser: Browser, context: BrowserContext, page: Page, origin: string;
let errors: string[];
beforeAll(async () => {
  const bundle = await build({ stdin: { sourcefile: "fixture.tsx", resolveDir: fileURLToPath(new URL(".", import.meta.url)), loader: "tsx", contents: `
    import React,{useState}from'react';import{createRoot}from'react-dom/client';import{AdminSections}from'./AdminSections';import{Modal}from'../ui/Modal';
    function Draft(){const[value,setValue]=useState('');return <label>Brouillon<input value={value} onChange={e=>setValue(e.target.value)}/></label>}
    function Dialog(){const[open,setOpen]=useState(false);return <><button onClick={()=>setOpen(true)}>Ouvrir la saisie</button><Modal open={open} title='Saisie en cours' onClose={()=>setOpen(false)}><label>Valeur en cours<input/></label><button onClick={()=>setOpen(false)}>Terminer la saisie</button></Modal></>}
    function App(){const[room,setRoom]=useState(true);return <><button onClick={()=>setRoom(x=>!x)}>Droits salle</button><AdminSections label="Établissement" hashSections={{salle:'salle'}} sections={[
      {id:'enseigne',label:'Enseigne',icon:'store',content:<><h2>Identité</h2><Draft/></>},
      ...(room?[{id:'salle',label:'Salle',content:<button>Créer une table</button>}]:[]),
      {id:'identite',label:'Identité visuelle',icon:'edit',modified:true,content:<><p>Apparence</p><Dialog/></>},
      {id:'compte',label:'Mon compte',content:<p>Compte personnel</p>},
      {id:'journal',label:'Journal',content:<p>Gestes sensibles</p>}
    ]}/><button>Après les rubriques</button></>};createRoot(document.getElementById('root')).render(<React.StrictMode><App/></React.StrictMode>);
  ` }, bundle: true, write: false, outfile: "fixture.js", format: "esm", platform: "browser", jsx: "automatic", define: { "process.env.NODE_ENV": '"development"' } });
  const js = bundle.outputFiles.find(file => file.path.endsWith(".js"))!.text;
  const css = ":root{--cf-bg:#fff;--cf-text:#171717;--cf-mut:#555;--cf-surface:#f4f4f4;--cf-focus:#99702c;--cf-line:#ddd}*{box-sizing:border-box}body{margin:0;padding:16px;font-family:Arial}.sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0)}" + bundle.outputFiles.find(file => file.path.endsWith(".css"))!.text;
  server = createServer((request, response) => {
    if (request.url === "/fixture.js") { response.setHeader("Content-Type", "text/javascript"); response.end(js); }
    else if (request.url === "/fixture.css") { response.setHeader("Content-Type", "text/css"); response.end(css); }
    else response.setHeader("Content-Type", "text/html").end('<!doctype html><html lang="fr"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"><div id="root"></div><script type="module" src="/fixture.js"></script></html>');
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); if (!address || typeof address === "string") throw Error("Missing fixture port");
  origin = `http://127.0.0.1:${address.port}`;
  browser = await chromium.launch({ headless: true });
}, 30000);
beforeEach(async () => {
  errors = [];
  context = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: "reduce" });
  await context.route("**/*", route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  page = await context.newPage(); page.setDefaultTimeout(3000);
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(origin + "/?demo=1&source=recette#repere");
  await page.getByRole("tab", { name: "Enseigne", exact: true }).waitFor();
});
afterEach(async () => { await context?.close(); expect(errors).toEqual([]); });
afterAll(async () => { await browser?.close(); if (server) await new Promise<void>(resolve => server.close(() => resolve())); });
const selected = () => page.getByRole("tab", { selected: true });

it("préserve brouillons, paramètres et repère au retour navigateur, sans rechargement", async () => {
  await page.getByLabel("Brouillon").fill("Le nouveau comptoir");
  await page.getByRole("tab", { name: "Salle", exact: true }).click();
  expect(await page.getByRole("tabpanel").count()).toBe(1);
  expect(await page.getByLabel("Brouillon").isVisible()).toBe(false);
  expect(new URL(page.url()).searchParams.get("demo")).toBe("1");
  expect(new URL(page.url()).searchParams.get("source")).toBe("recette");
  expect(new URL(page.url()).hash).toBe("#repere");
  await page.goBack();
  await expect.poll(() => page.getByLabel("Brouillon").inputValue()).toBe("Le nouveau comptoir");
  await expect.poll(() => selected().textContent()).toBe("Enseigne");
  await page.goForward(); await expect.poll(() => selected().textContent()).toBe("Salle");
});

it("associe panneaux et onglets, avec flèches, Home, End et focus roving", async () => {
  await selected().focus(); await page.keyboard.press("ArrowLeft");
  await expect.poll(() => selected().textContent()).toBe("Journal");
  await page.keyboard.press("Home"); await expect.poll(() => selected().textContent()).toBe("Enseigne");
  await page.keyboard.press("ArrowRight"); await expect.poll(() => selected().textContent()).toBe("Salle");
  expect(await selected().evaluate(node => node === document.activeElement)).toBe(true);
  const panel = page.getByRole("tabpanel");
  expect(await panel.getAttribute("id")).toBe(await selected().getAttribute("aria-controls"));
  expect(await panel.getAttribute("aria-labelledby")).toBe(await selected().getAttribute("id"));
  expect(await page.locator('[role="tab"][tabindex="0"]').count()).toBe(1);
  await page.keyboard.press("Tab"); expect(await panel.evaluate(node => node === document.activeElement)).toBe(true);
  await page.keyboard.press("Tab"); expect(await page.getByRole("button", { name: "Créer une table" }).evaluate(node => node === document.activeElement)).toBe(true);
});

it("ouvre les liens directs et les anciens liens salle, avec repli si droits retirés", async () => {
  await page.goto(origin + "/?demo=1#salle");
  await expect.poll(() => selected().textContent()).toBe("Salle");
  await page.getByRole("button", { name: "Droits salle" }).click();
  await expect.poll(() => selected().textContent()).toBe("Enseigne");
  expect(await page.getByRole("tab", { name: "Salle", exact: true }).count()).toBe(0);
  await page.goto(origin + "/?demo=1&section=journal"); await expect.poll(() => selected().textContent()).toBe("Journal");
  await page.goto(origin + "/?section=inconnue"); await expect.poll(() => selected().textContent()).toBe("Enseigne");
});

it.each([320, 390, 568, 768, 1024, 1440, 1920])("garde tous les libellés et cibles tactiles accessibles à %ipx", async width => {
  await page.setViewportSize({ width, height: 800 });
  const sizes = await page.getByRole("tab").evaluateAll(nodes => nodes.map(node => {
    const box = node.getBoundingClientRect(); return { w: box.width, h: box.height, left: box.left, right: box.right, clipped: node.scrollWidth > node.clientWidth + 1 };
  }));
  expect(sizes.every(box => box.w >= 44 && box.h >= 44 && box.left >= 0 && box.right <= width && !box.clipped)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

it("ne masque pas une modale en cours au retour navigateur et libère la rubrique après fermeture", async () => {
  await page.getByRole("tab", { name: "Identité visuelle", exact: true }).click();
  await page.getByRole("button", { name: "Ouvrir la saisie" }).click();
  await page.getByLabel("Valeur en cours").fill("À préserver");
  await page.goBack();
  const dialog = page.getByRole("dialog", { name: "Saisie en cours" });
  expect(await dialog.isVisible()).toBe(true);
  expect(await page.getByLabel("Valeur en cours").inputValue()).toBe("À préserver");
  await page.getByRole("button", { name: "Terminer la saisie" }).click();
  await expect.poll(() => selected().textContent()).toBe("Enseigne");
  await expect.poll(() => selected().evaluate(node => node === document.activeElement)).toBe(true);
  await page.keyboard.press("Tab");
  expect(await page.getByRole("tabpanel").evaluate(node => node === document.activeElement)).toBe(true);
  await page.getByLabel("Brouillon").fill("Focus et formulaire disponibles");
  expect(await page.getByRole("tabpanel").count()).toBe(1);
});
