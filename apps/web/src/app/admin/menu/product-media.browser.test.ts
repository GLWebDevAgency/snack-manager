import { createHash } from "node:crypto";
import { createServer, type Server } from "node:http";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { build } from "esbuild";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { detecterImage, dimensionsImage, MEDIA_MAX_OCTETS, ProductCreateSchema, ProduitMediasSchema, type MediaVue } from "@sm/contracts";
import type { RawProduct } from "./product-normalize";

// Real MenuPage -> EditPanel -> PhotosDuPlat -> transport multipart/JSON.
// The loopback HTTP server is a fixture, never Nest/Mongo or a production account.
type Call = { method: string; path: string; body: unknown };
let server: Server, browser: Browser, context: BrowserContext, page: Page, origin: string, captures: string;
let calls: Call[], errors: string[], products: RawProduct[], media: MediaVue[], files: Map<string, Buffer>;
let uploadFault: number | null, attachmentFault: "refuse" | "timeout-after-write" | null;
const categoryId = "category-local";
const originalPng = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==", "base64");
function view(id: string, bytes: Buffer, alt: string): MediaVue {
  return { id, genre: "photo", type: "image/png", empreinte: createHash("sha256").update(bytes).digest("hex"), octets: bytes.length,
    largeur: dimensionsImage(bytes)?.largeur ?? null, hauteur: dimensionsImage(bytes)?.hauteur ?? null,
    alt, point: { x: .2, y: .7 }, stockage: "objet", origine: "depot", auteur: null, deposeLe: "2026-09-12T10:00:00Z", utilisePar: 0,
    urls: { vignette: `/media/${id}`, carte: `/media/${id}`, fiche: `/media/${id}`, bandeau: `/media/${id}` } };
}
const quota = () => ({ octetsUtilises: media.reduce((sum, value) => sum + value.octets, 0), octetsMax: 268435456, medias: media.length });
const postCount = () => calls.filter(call => call.method === "POST" && call.path === "/api/products").length;
const attachments = () => calls.filter(call => call.method === "PUT" && call.path.endsWith("/medias"));
beforeAll(async () => {
  captures = process.env.REFONTE_ASSETS_CAPTURES ?? await mkdtemp(join(tmpdir(), "sm-product-media-"));
  await mkdir(captures, { recursive: true });
  const source = fileURLToPath(new URL(".", import.meta.url));
  const webRequire = createRequire(new URL("../../../../package.json", import.meta.url));
  const cssPath = fileURLToPath(new URL("../../globals.css", import.meta.url));
  const [bundle, css] = await Promise.all([
    build({ stdin: { loader: "tsx", sourcefile: "product-media-fixture.tsx", resolveDir: source, contents: `
      import React from 'react'; import {createRoot} from 'react-dom/client';
      import MenuPage from './page'; import {ToastProvider} from '../../../components/ui/Toast';
      createRoot(document.getElementById('root')).render(<React.StrictMode><ToastProvider><MenuPage/></ToastProvider></React.StrictMode>);` },
      bundle: true, write: false, format: "esm", platform: "browser", target: "es2022", jsx: "automatic", outdir: "/virtual-product-media",
      alias: { "@": fileURLToPath(new URL("../../../", import.meta.url)), react: fileURLToPath(new URL(".", `file://${webRequire.resolve("react/package.json")}`)), "react-dom": fileURLToPath(new URL(".", `file://${webRequire.resolve("react-dom/package.json")}`)) },
      define: { "process.env": "{}", "process.env.NODE_ENV": '"production"', "process.env.NEXT_PUBLIC_API_URL": '"/api"' } }),
    readFile(cssPath, "utf8").then(value => postcss([tailwind({ base: fileURLToPath(new URL("../../../..", import.meta.url)) })]).process(value, { from: cssPath })),
  ]);
  server = createServer(async (request, response) => {
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; font-src 'self' data:; frame-src 'none'");
    const path = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
    const json = (body: unknown, status = 200) => { response.writeHead(status, { "Content-Type": "application/json" }).end(JSON.stringify(body)); };
    if (path === "/app.js") { response.setHeader("Content-Type", "text/javascript"); response.end(bundle.outputFiles.find(file => file.path.endsWith(".js"))!.text); return; }
    if (path === "/style.css") { response.setHeader("Content-Type", "text/css"); response.end(css.css); return; }
    if (path === "/favicon.ico") { response.writeHead(204).end(); return; }
    if (path === "/" || path === "/admin/menu") { response.setHeader("Content-Type", "text/html"); response.end('<!doctype html><html lang="fr"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Menu — recette locale</title><link rel="stylesheet" href="/style.css"><div id="root"></div><script type="module" src="/app.js"></script></html>'); return; }
    if (path.startsWith("/media/")) { const file = files.get(path.slice(7)); if (!file) { response.writeHead(404).end(); return; } response.writeHead(200, { "Content-Type": "image/png" }).end(file); return; }
    const method = request.method ?? "GET";
    if (method === "GET") {
      calls.push({ method, path, body: null });
      if (path === "/api/menu") { json({ categories: [{ _id: categoryId, name: "Carte de recette", products, order: 0, active: true }], uncategorized: [], medias: media }); return; }
      if (path === "/api/medias") { json({ medias: media, quota: quota() }); return; }
      if (path === "/api/supply/ingredients") { json([]); return; }
      if (path.startsWith("/api/supply/products/") && path.endsWith("/bom")) { json({ recipes: [], options: [] }); return; }
      errors.push(`Unexpected GET ${path}`); json({ message: "Fixture read unavailable" }, 404); return;
    }
    const chunks: Buffer[] = []; for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const raw = Buffer.concat(chunks);
    if (method === "POST" && path === "/api/medias") {
      const multipart = await new Request("http://127.0.0.1/api/medias", { method, headers: { "Content-Type": request.headers["content-type"]! }, body: new Blob([new Uint8Array(raw)]) }).formData();
      const file = multipart.get("fichier") as File;
      const bytes = Buffer.from(await file.arrayBuffer());
      calls.push({ method, path, body: { name: file.name, type: detecterImage(bytes), octets: bytes.length, dimensions: dimensionsImage(bytes) } });
      if (uploadFault) { json({ message: uploadFault === 403 ? "Votre rôle ne permet pas de déposer un média." : "Médiathèque pleine — quota atteint." }, uploadFault); return; }
      if (detecterImage(bytes) !== "image/png" || bytes.length > MEDIA_MAX_OCTETS) { json({ message: "Fixture file invalid" }, 400); return; }
      const hash = createHash("sha256").update(bytes).digest("hex");
      let found = media.find(value => value.empreinte === hash);
      const deduplique = Boolean(found);
      if (!found) { found = view(`media-${media.length + 1}`, bytes, file.name); media.push(found); files.set(found.id, bytes); }
      json({ media: found, quota: quota(), deduplique }); return;
    }
    const body = JSON.parse(raw.toString() || "{}"); calls.push({ method, path, body });
    if (method === "POST" && path === "/api/products") {
      const data = ProductCreateSchema.parse(body);
      const created = { ...data, _id: `product-${products.length + 1}`, medias: [], photoUrl: null };
      products.push(created); json(created, 201); return;
    }
    const match = path.match(/^\/api\/products\/([^/]+)\/medias$/);
    if (method === "PUT" && match) {
      const product = products.find(value => value._id === match[1]);
      if (!product) { json({ message: "Produit introuvable" }, 404); return; }
      const parsed = ProduitMediasSchema.parse(body);
      if (parsed.medias.some(id => !media.some(value => value.id === id))) { json({ message: "Média introuvable" }, 404); return; }
      const fault = attachmentFault; attachmentFault = null;
      if (fault === "refuse") { json({ message: "Attachement indisponible — réessayez." }, 503); return; }
      product.medias = parsed.medias;
      if (fault === "timeout-after-write") { json({ message: "Délai de réponse dépassé après écriture." }, 504); return; }
      json(product); return;
    }
    errors.push(`Unexpected mutation ${method} ${path}`); json({ message: "Fixture mutation unavailable" }, 405);
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); if (!address || typeof address === "string") throw Error("Local server address absent");
  origin = `http://127.0.0.1:${address.port}`; browser = await chromium.launch({ headless: true });
}, 30_000);
beforeEach(async () => {
  calls = []; errors = []; uploadFault = null; attachmentFault = null;
  media = [view("media-original", originalPng, "Photo existante")]; files = new Map([["media-original", originalPng]]);
  products = [{ _id: "product-original", categoryId, name: "Plat existant", description: "Recette conservée", price: 1234, medias: ["media-original"], photoKind: "cover", tags: ["midi"], isNew: true }];
  context = await browser.newContext({ viewport: { width: 1280, height: 1000 }, reducedMotion: "reduce", serviceWorkers: "block" });
  await context.route("**/*", route => new URL(route.request().url()).origin === origin ? route.continue() : (errors.push("External request blocked"), route.abort()));
  page = await context.newPage(); page.setDefaultTimeout(5000); page.on("pageerror", error => errors.push(error.message));
  await page.goto(origin + "/admin/menu"); await page.getByRole("button", { name: "Modifier Plat existant", exact: true }).waitFor();
});
afterEach(async (ctx) => {
  await writeFile(join(captures, ctx.task.name.replace(/[^a-z0-9]+/gi, "-") + ".json"), JSON.stringify({ calls, errors, products, media: media.map(value => ({ id: value.id, alt: value.alt, octets: value.octets, largeur: value.largeur, hauteur: value.hauteur })) }, null, 2));
  await context.close(); expect(errors).toEqual([]);
});
afterAll(async () => { await browser?.close(); await new Promise<void>(resolve => server?.close(() => resolve())); });

async function create(name: string) {
  await page.getByRole("button", { name: "Produit", exact: true }).click();
  await page.getByRole("textbox", { name: "Nom", exact: true }).fill(name);
  await page.getByRole("button", { name: "Choisir une illustration", exact: true }).waitFor();
}
async function illustration(label = "Samoussa", search = "samoussa") {
  await page.getByRole("button", { name: "Choisir une illustration", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Votre médiathèque", exact: true });
  // Open at first visit: no second hidden details gesture is required.
  await dialog.getByRole("searchbox", { name: "Rechercher une illustration" }).fill(search);
  await dialog.getByRole("button", { name: `Ajouter l'illustration ${label}`, exact: true }).click();
  return dialog;
}
async function finishIllustration() {
  const dialog = page.getByRole("dialog", { name: "Votre médiathèque", exact: true });
  await dialog.getByRole("status").filter({ hasText: /Photo envoyée|déjà sur ce plat/ }).waitFor();
  await dialog.getByRole("button", { name: "Terminé", exact: true }).click();
}
describe("création et édition avec illustrations — vraie page Menu", () => {
  it("rend le choix dès création, persiste PNG et attachement, puis retrouve l’image après rechargement", async () => {
    await create("Produit illustré");
    const entry = page.getByRole("button", { name: "Choisir une illustration", exact: true });
    expect(await entry.evaluate(element => {
      const bounds = element.getBoundingClientRect();
      for (let parent = element.parentElement; parent; parent = parent.parentElement) {
        if (getComputedStyle(parent).overflowY === "auto") {
          const clip = parent.getBoundingClientRect();
          if (bounds.top < clip.top || bounds.bottom > clip.bottom) return false;
        }
      }
      return bounds.top >= 0 && bounds.bottom <= innerHeight;
    })).toBe(true);
    await page.screenshot({ path: join(captures, "creation-illustration-visible.png"), fullPage: true });
    const dialog = await illustration();
    expect(await dialog.getByRole("searchbox", { name: "Rechercher une illustration" }).isVisible()).toBe(true);
    await finishIllustration();
    expect(postCount()).toBe(0);
    await page.getByRole("button", { name: "Enregistrer", exact: true }).click();
    await expect.poll(() => attachments().length).toBe(1);
    expect(postCount()).toBe(1); expect(products[1].medias).toEqual(["media-2"]);
    expect(calls.find(call => call.method === "POST" && call.path === "/api/products")!.body).not.toHaveProperty("medias");
    expect(calls.find(call => call.method === "POST" && call.path === "/api/medias")!.body).toMatchObject({ type: "image/png", dimensions: { largeur: 1600, hauteur: 1100 } });
    await page.reload();
    await page.getByRole("button", { name: "Modifier Produit illustré", exact: true }).click();
    await page.getByText(/illustration-samosa.png ·/).waitFor();
    await page.screenshot({ path: join(captures, "produit-persiste.png"), fullPage: true });
  });
  it.each(["refuse", "timeout-after-write"] as const)("reprend le même produit après %s sans deuxième POST", async fault => {
    attachmentFault = fault;
    await create("Création à reprendre"); await illustration(); await finishIllustration();
    await page.getByRole("button", { name: "Enregistrer", exact: true }).click();
    await page.getByRole("alert").filter({ hasText: /a bien été créé/ }).waitFor();
    await page.getByRole("button", { name: "Modifier Création à reprendre", exact: true }).waitFor();
    expect(postCount()).toBe(1); expect(products).toHaveLength(2);
    await page.getByText(/illustration-samosa.png ·/).waitFor();
    await page.screenshot({ path: join(captures, `reprise-${fault}.png`), fullPage: true });
    await page.getByRole("button", { name: "Enregistrer", exact: true }).click();
    await expect.poll(() => attachments().length).toBe(2);
    expect(attachments().map(call => call.path)).toEqual(["/api/products/product-2/medias", "/api/products/product-2/medias"]);
    expect(postCount()).toBe(1); expect(products[1].medias).toEqual(["media-2"]);
  });
  it("ferme puis réouvre le produit confirmé en distinguant la bibliothèque de l’attachement non enregistré", async () => {
    attachmentFault = "refuse";
    await create("Produit durable"); await illustration(); await finishIllustration();
    await page.getByRole("button", { name: "Enregistrer", exact: true }).click();
    await page.getByRole("alert").filter({ hasText: /a bien été créé/ }).waitFor();
    await page.getByRole("button", { name: "Fermer", exact: true }).click();
    await page.getByRole("dialog", { name: "Abandonner les modifications ?" }).getByRole("button", { name: "Abandonner", exact: true }).click();
    await page.reload();
    await page.getByRole("button", { name: "Modifier Produit durable", exact: true }).click();
    expect(products[1].medias).toEqual([]); expect(postCount()).toBe(1);
    await page.getByText(/Pas encore de photo/).waitFor();
    await illustration(); await finishIllustration();
    expect(media).toHaveLength(2); // The existing upload is deduplicated.
    await page.getByRole("button", { name: "Enregistrer", exact: true }).click();
    await expect.poll(() => products[1].medias).toEqual(["media-2"]); expect(postCount()).toBe(1);
  });
  it.each([403, 409])("affiche le refus de dépôt %i sans fausse sélection ni création", async status => {
    uploadFault = status; await create("Image refusée");
    const dialog = await illustration();
    await dialog.getByRole("alert").waitFor(); expect(postCount()).toBe(0); expect(media).toHaveLength(1); expect(attachments()).toHaveLength(0);
  });
  it("préserve photo principale, cadrage, recette et prix en édition", async () => {
    const initial = structuredClone(products[0]); const point = structuredClone(media[0].point);
    await page.getByRole("button", { name: "Modifier Plat existant", exact: true }).click();
    await illustration(); await finishIllustration();
    await page.getByRole("button", { name: "Enregistrer", exact: true }).click();
    await expect.poll(() => attachments().length).toBe(1);
    expect(products[0]).toEqual({ ...initial, medias: ["media-original", "media-2"] }); expect(media[0].point).toEqual(point); expect(postCount()).toBe(0);
  });
  it("garde le dépôt de fichier ordinaire disponible dès création", async () => {
    await create("Photo réelle");
    await page.locator('input[type="file"]').setInputFiles({ name: "photo.png", mimeType: "image/png", buffer: originalPng });
    await page.getByText(/Photo envoyée telle quelle/).waitFor();
    await page.getByRole("button", { name: "Enregistrer", exact: true }).click();
    await expect.poll(() => products[1]?.medias).toEqual(["media-original"]);
    expect(postCount()).toBe(1); expect(media).toHaveLength(1);
  });
  it("bloque Enregistrer pendant la préparation et annule le dépôt si le choix est fermé", async () => {
    await page.addInitScript(() => {
      const original = HTMLCanvasElement.prototype.toBlob;
      HTMLCanvasElement.prototype.toBlob = function (callback, ...args) {
        original.call(this, blob => setTimeout(() => {
          callback(blob); document.documentElement.dataset.rasterTermine = "true";
        }, 1000), ...args);
      };
    });
    await page.reload(); await create("Préparation interrompue");
    const dialog = await illustration();
    const save = page.locator("button").filter({ hasText: "Préparation de l’image…" });
    await expect.poll(() => save.isDisabled()).toBe(true);
    await dialog.getByRole("button", { name: "Fermer", exact: true }).click();
    await page.waitForFunction(() => document.documentElement.dataset.rasterTermine === "true");
    expect(calls.filter(call => call.method === "POST" && call.path === "/api/medias")).toHaveLength(0);
    expect(postCount()).toBe(0); expect(await page.getByRole("button", { name: "Enregistrer", exact: true }).isEnabled()).toBe(true);
  });
  it("montre les 41 choix sur mobile sans dépasser l’écran", async () => {
    await page.setViewportSize({ width: 390, height: 844 }); await create("Produit mobile");
    await page.getByRole("button", { name: "Choisir une illustration", exact: true }).click();
    const region = page.getByRole("region", { name: "Illustrations disponibles" });
    expect(await region.getByRole("button").count()).toBe(41);
    expect(await page.getByRole("searchbox", { name: "Rechercher une illustration" }).isVisible()).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: join(captures, "bibliotheque-mobile.png"), fullPage: false });
  });
});
