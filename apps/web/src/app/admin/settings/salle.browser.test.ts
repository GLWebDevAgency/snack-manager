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
import { DIRECTIONS, DiningTableCreateSchema, DiningTableUpdateSchema, type AuthMe, type DiningRoom, type DiningTable } from "@sm/contracts";
import { cleSalle } from "./salle-operation";

// True SettingsPage, network client and forms. Only HTTP data and next/font's
// build-time adapter are supplied locally; no application component is mocked.
type Call = { method: string; path: string; body: unknown };
let server: Server, browser: Browser, context: BrowserContext, page: Page, origin: string, captures: string;
let calls: Call[], errors: string[], room: DiningRoom, actor: AuthMe, capabilities: string[];
let fault: "after-write" | "conflict" | "rejected" | null;
let receipts: Map<string, { body: string; table: DiningTable }>;
const tenantId = "restaurant-local";
const tableId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const mutations = () => calls.filter(call => call.method !== "GET");
const section = () => page.getByRole("region", { name: "Configuration de la salle" });

beforeAll(async () => {
  captures = process.env.REFONTE_SALLE_CAPTURES ?? await mkdtemp(join(tmpdir(), "sm-salle-"));
  await mkdir(captures, { recursive: true });
  const source = fileURLToPath(new URL(".", import.meta.url));
  const requireWeb = createRequire(new URL("../../../../package.json", import.meta.url));
  const cssPath = fileURLToPath(new URL("../../globals.css", import.meta.url));
  const [bundle, css] = await Promise.all([
    build({ stdin: { loader: "tsx", sourcefile: "salle-fixture.tsx", resolveDir: source, contents: `
      import React from 'react'; import {createRoot} from 'react-dom/client';
      import SettingsPage from './page'; import {ToastProvider} from '../../../components/ui/Toast';
      createRoot(document.getElementById('root')).render(<React.StrictMode><ToastProvider><SettingsPage/></ToastProvider></React.StrictMode>);` },
      bundle: true, write: false, format: "esm", platform: "browser", target: "es2022", jsx: "automatic", outdir: "/virtual-salle",
      alias: { "@": fileURLToPath(new URL("../../../", import.meta.url)), react: fileURLToPath(new URL(".", `file://${requireWeb.resolve("react/package.json")}`)), "react-dom": fileURLToPath(new URL(".", `file://${requireWeb.resolve("react-dom/package.json")}`)) },
      plugins: [{ name: "local-fonts", setup(build) {
        build.onResolve({ filter: /masque\/polices$/ }, () => ({ path: "polices", namespace: "local-fonts" }));
        build.onLoad({ filter: /.*/, namespace: "local-fonts" }, () => ({ contents: 'export const classesPolices = "";', loader: "js" }));
      } }],
      define: { "process.env": "{}", "process.env.NODE_ENV": '"production"', "process.env.NEXT_PUBLIC_API_URL": '"/api"' } }),
    readFile(cssPath, "utf8").then(value => postcss([tailwind({ base: fileURLToPath(new URL("../../../..", import.meta.url)) })]).process(value, { from: cssPath })),
  ]);
  server = createServer(async (request, response) => {
    response.setHeader("Cache-Control", "no-store");
    const path = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
    const json = (value: unknown, status = 200) => { response.writeHead(status, { "Content-Type": "application/json" }).end(JSON.stringify(value)); };
    if (path === "/app.js") { response.setHeader("Content-Type", "text/javascript"); response.end(bundle.outputFiles.find(file => file.path.endsWith(".js"))!.text); return; }
    if (path === "/style.css") { response.setHeader("Content-Type", "text/css"); response.end(css.css + (bundle.outputFiles.find(file => file.path.endsWith(".css"))?.text ?? "")); return; }
    if (path === "/favicon.ico") { response.writeHead(204).end(); return; }
    if (path === "/" || path === "/admin/settings") { response.setHeader("Content-Type", "text/html"); response.end('<!doctype html><html lang="fr"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Salle — recette locale</title><link rel="stylesheet" href="/style.css"><div id="root"></div><script type="module" src="/app.js"></script></html>'); return; }
    const method = request.method ?? "GET";
    if (method === "GET") {
      calls.push({ method, path, body: null });
      if (path === "/api/auth/me") { json(actor); return; }
      if (path === "/api/tenants/me") { json({ _id: tenantId, name: "Restaurant de recette", slug: "local", brand: DIRECTIONS.nuit, brandColor: "#e8af30", logoUrl: null, address: "", phones: [], hours: [], closures: [], plan: null, onlineOrdering: false, account: { status: "active" }, capacites: capabilities, settings: {} }); return; }
      if (path === "/api/audit") { json({ entries: [] }); return; }
      if (path === "/api/medias") { json({ medias: [], quota: { octetsUtilises: 0, octetsMax: 268435456, medias: 0 } }); return; }
      if (path === "/api/dining/room") { json(room); return; }
      errors.push(`Unexpected GET ${path}`); json({ message: "Unavailable fixture route" }, 404); return;
    }
    const chunks: Buffer[] = []; for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const body = JSON.parse(Buffer.concat(chunks).toString() || "{}");
    calls.push({ method, path, body });
    const rejected = () => json({ code: "DINING_OPERATION_REJECTED", operationId: body.operationId, message: "Le nom de cette table est déjà utilisé." }, 409);
    if (!["owner", "cogerant", "gerant"].includes(actor.role)) { json({ message: "Accès refusé" }, 403); return; }
    if (fault === "conflict") { fault = null; json({ code: "DINING_CONFLICT", message: "La salle a changé. Actualisez avant de poursuivre." }, 409); return; }
    if (fault === "rejected") { fault = null; rejected(); return; }
    const previous = receipts.get(body.operationId);
    if (previous) { expect(previous.body).toBe(JSON.stringify(body)); json(previous.table); return; }
    let result: DiningTable;
    if (method === "POST" && path === "/api/dining/tables") {
      const parsed = DiningTableCreateSchema.parse(body);
      if (room.tables.some(table => table.label.toLocaleLowerCase("fr") === parsed.label.toLocaleLowerCase("fr"))) { rejected(); return; }
      result = { id: parsed.operationId, label: parsed.label, seats: parsed.seats, active: true, revision: 0 };
      room.tables.push(result);
    } else if (method === "PATCH" && path.startsWith("/api/dining/tables/")) {
      const parsed = DiningTableUpdateSchema.parse(body);
      const table = room.tables.find(table => table.id === path.split("/").pop());
      if (!table) { json({ message: "Table introuvable" }, 404); return; }
      if (parsed.expectedRevision !== table.revision) { rejected(); return; }
      result = { ...table, label: parsed.label ?? table.label, seats: parsed.seats ?? table.seats, active: parsed.active ?? table.active, revision: table.revision + 1 };
      room.tables = room.tables.map(table => table.id === result.id ? result : table);
    } else { errors.push(`Unexpected mutation ${method} ${path}`); json({}, 405); return; }
    receipts.set(body.operationId, { body: JSON.stringify(body), table: result });
    if (fault === "after-write") { fault = null; json({ message: "La confirmation a été interrompue." }, 504); return; }
    json(result);
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); if (!address || typeof address === "string") throw Error("Local address missing");
  origin = `http://127.0.0.1:${address.port}`;
  browser = await chromium.launch({ headless: true });
}, 30_000);

beforeEach(async () => {
  calls = []; errors = []; fault = null; receipts = new Map(); capabilities = ["bo", "pos"];
  actor = { id: "owner-local", nom: "Camille", genre: "user", role: "owner", tenantId, email: "local@example.test" };
  room = { tables: [{ id: tableId, label: "Terrasse 1", seats: 4, active: true, revision: 7 }], sessions: [{ id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", tableId, tableLabel: "Terrasse 1", guestCount: 3, revision: 2, state: "open", openedAt: "2026-09-12T10:00:00.000Z", closedAt: null, orderIds: ["111111111111111111111111"], pendingOperationCount: 1 }] };
  context = await browser.newContext({ viewport: { width: 1280, height: 1000 }, reducedMotion: "reduce", serviceWorkers: "block" });
  await context.route("**/*", route => new URL(route.request().url()).origin === origin ? route.continue() : (errors.push("External request blocked"), route.abort()));
  await context.addInitScript(() => { localStorage.setItem("sm.token.resto", "local-token"); });
  page = await context.newPage(); page.setDefaultTimeout(5000); page.on("pageerror", error => errors.push(error.message));
});
afterEach(async (ctx) => {
  await writeFile(join(captures, ctx.task.name.replace(/[^a-z0-9]+/gi, "-") + ".json"), JSON.stringify({ calls, errors, room }, null, 2));
  await context.close(); expect(errors).toEqual([]);
});
afterAll(async () => { await browser?.close(); await new Promise<void>(resolve => server?.close(() => resolve())); });
async function visit() { await page.goto(origin + "/admin/settings"); await page.getByRole("heading", { name: "L'identité de l'enseigne" }).waitFor(); }
async function add(name = "Salle 2") {
  await section().getByRole("button", { name: "Ajouter une table", exact: true }).click();
  await page.getByRole("textbox", { name: "Nom de la table" }).fill(name);
  await page.getByRole("spinbutton", { name: "Nombre de couverts" }).fill("6");
  await page.getByRole("button", { name: "Enregistrer la table", exact: true }).click();
}
async function confirmed() { await section().getByRole("status").filter({ hasText: /enregistrée/ }).waitFor(); }

describe("Salle dans les vrais réglages restaurant", () => {
  it("crée une table avec couverts et la retrouve après rechargement", async () => {
    await visit(); await add(); await confirmed();
    expect(mutations()).toHaveLength(1);
    expect(mutations()[0]).toMatchObject({ method: "POST", path: "/api/dining/tables", body: { label: "Salle 2", seats: 6 } });
    expect(await page.evaluate(key => localStorage.getItem(key), cleSalle(tenantId))).toBeNull();
    await page.reload(); await section().getByRole("article", { name: "Table Salle 2", exact: true }).waitFor();
    expect(await section().getByRole("article", { name: "Table Salle 2", exact: true }).innerText()).toContain("6 couverts");
    await section().screenshot({ path: join(captures, "salle-configuree.png") });
  });
  it("renomme et désactive une table occupée en gardant sa tablée", async () => {
    await visit(); await section().getByRole("button", { name: "Modifier la table Terrasse 1", exact: true }).click();
    await page.getByText("Cette table accueille actuellement 3 convives.", { exact: false }).waitFor();
    await page.getByRole("textbox", { name: "Nom de la table" }).fill("Terrasse côté cour");
    await page.getByRole("spinbutton", { name: "Nombre de couverts" }).fill("5");
    await page.getByRole("checkbox", { name: "Table active pour les nouvelles tablées" }).uncheck();
    await page.getByRole("button", { name: "Enregistrer la table", exact: true }).click(); await confirmed();
    expect(mutations()[0]).toMatchObject({ method: "PATCH", path: `/api/dining/tables/${tableId}`, body: { expectedRevision: 7, active: false, seats: 5 } });
    expect(room.sessions).toHaveLength(1); expect(room.sessions[0].state).toBe("open");
    const card = section().getByRole("article", { name: "Table Terrasse côté cour", exact: true });
    expect(await card.innerText()).toContain("Occupée"); expect(await card.innerText()).toContain("Inactive pour les prochaines tablées");
    expect(await card.innerText()).toContain("1 enregistrement à vérifier en caisse");
    await section().screenshot({ path: join(captures, "table-desactivee-occupee.png") });
  });
  it("reprend un timeout après écriture avec exactement le même UUID et corps après rechargement", async () => {
    fault = "after-write"; await visit(); await add();
    await section().getByRole("button", { name: "Vérifier l’enregistrement" }).waitFor();
    expect(await section().getByRole("button", { name: "Ajouter une table", exact: true }).isDisabled()).toBe(true);
    await page.reload(); await section().getByRole("button", { name: "Vérifier l’enregistrement" }).waitFor();
    await section().screenshot({ path: join(captures, "salle-reprise.png") });
    await section().getByRole("button", { name: "Vérifier l’enregistrement" }).click(); await confirmed();
    expect(mutations()).toHaveLength(2); expect(mutations()[1]).toEqual(mutations()[0]);
    expect(room.tables.filter(table => table.label === "Salle 2")).toHaveLength(1);
  });
  it("conserve un conflit non définitif puis rejoue la référence sans créer une autre intention", async () => {
    fault = "conflict"; await visit(); await add();
    await section().getByRole("alert").filter({ hasText: /La salle a changé/ }).waitFor();
    expect(await page.evaluate(key => localStorage.getItem(key), cleSalle(tenantId))).not.toBeNull();
    await section().getByRole("button", { name: "Vérifier l’enregistrement" }).click(); await confirmed();
    expect(mutations()[1]).toEqual(mutations()[0]);
  });
  it("autorise la correction uniquement après le refus serveur rattaché à la référence", async () => {
    fault = "rejected"; await visit(); await add();
    await section().getByRole("alert").filter({ hasText: /déjà utilisé/ }).waitFor();
    expect(await page.evaluate(key => localStorage.getItem(key), cleSalle(tenantId))).toBeNull();
    await add("Salle 3"); await confirmed();
    expect(room.tables.some(table => table.label === "Salle 2")).toBe(false);
    expect(room.tables.some(table => table.label === "Salle 3")).toBe(true);
  });
  it("interdit une reprise par un autre auteur", async () => {
    fault = "after-write"; await visit(); await add(); await section().getByRole("button", { name: "Vérifier l’enregistrement" }).waitFor();
    actor = { ...actor, id: "other-owner" };
    await page.reload(); await section().getByText("Cette demande a été préparée par une autre personne.", { exact: false }).waitFor();
    expect(await section().getByRole("button", { name: "Vérifier l’enregistrement" }).count()).toBe(0);
    expect(await section().getByRole("button", { name: "Ajouter une table", exact: true }).isDisabled()).toBe(true);
    expect(mutations()).toHaveLength(1);
  });
  it.each(["cogerant", "gerant"] as const)("ouvre la configuration au rôle %s", async role => {
    actor.role = role; actor.genre = role === "gerant" ? "staff" : "user";
    await visit(); await add(); await confirmed(); expect(mutations()).toHaveLength(1);
  });
  it.each(["caisse", "cuisine"] as const)("limite le rôle %s à la lecture de l'occupation", async role => {
    actor.role = role; actor.genre = "staff"; await visit();
    await section().getByRole("article", { name: "Table Terrasse 1", exact: true }).waitFor();
    expect(await section().getByRole("button", { name: "Ajouter une table", exact: true }).count()).toBe(0);
    expect(await section().getByRole("button", { name: /Modifier la table/ }).count()).toBe(0);
    expect(mutations()).toHaveLength(0);
  });
  it("respecte l'absence de capacité et ne charge pas une fausse salle", async () => {
    capabilities = ["online"]; await visit();
    await page.getByText("Le service à table nécessite la caisse de cet établissement.").waitFor();
    expect(calls.some(call => call.path === "/api/dining/room")).toBe(false);
  });
  it("n'ouvre pas la salle au comptable", async () => {
    actor.role = "comptable"; await visit();
    await page.getByRole("textbox", { name: "Nom de l'enseigne" }).waitFor();
    expect(await section().count()).toBe(0);
    expect(calls.some(call => call.path === "/api/dining/room")).toBe(false);
  });
  it("verrouille une deuxième fenêtre pendant un enregistrement en cours", async () => {
    await visit();
    const other = await context.newPage();
    await other.goto(origin + "/admin/settings");
    const otherSection = other.getByRole("region", { name: "Configuration de la salle" });
    await otherSection.getByRole("button", { name: "Ajouter une table", exact: true }).click();
    await page.route("**/api/dining/tables", async route => {
      await new Promise(resolve => setTimeout(resolve, 700)); await route.continue();
    });
    await add();
    await other.getByRole("button", { name: "Enregistrer la table", exact: true }).waitFor();
    await expect.poll(() => other.getByRole("button", { name: "Enregistrer la table", exact: true }).isDisabled()).toBe(true);
    await confirmed();
    expect(mutations()).toHaveLength(1);
    await other.close();
  });
  it("bloque l'envoi si le journal est illisible", async () => {
    await page.addInitScript(key => { localStorage.setItem(key, "{"); }, cleSalle(tenantId));
    await visit(); await section().getByRole("alert").filter({ hasText: /illisible/ }).waitFor();
    expect(await section().getByRole("button", { name: "Ajouter une table", exact: true }).isDisabled()).toBe(true);
    expect(mutations()).toHaveLength(0);
  });
  it("n'envoie rien quand le navigateur refuse de conserver la référence", async () => {
    await page.addInitScript(() => {
      const original = Storage.prototype.setItem;
      Storage.prototype.setItem = function(key, value) {
        if (key.startsWith("sm.admin.salle.operation")) throw Error("Stockage plein — référence non enregistrée.");
        original.call(this, key, value);
      };
    });
    await visit(); await add();
    await page.getByRole("dialog").getByRole("alert").filter({ hasText: /Stockage plein/ }).waitFor();
    expect(mutations()).toHaveLength(0);
  });
  it("refuse l'envoi après changement de session dans le même onglet", async () => {
    await visit(); await section().getByRole("button", { name: "Ajouter une table", exact: true }).waitFor();
    await page.evaluate(() => localStorage.setItem("sm.token.resto", "different-local-token"));
    await add(); await page.getByRole("dialog").getByRole("alert").filter({ hasText: /La session a changé/ }).waitFor();
    expect(mutations()).toHaveLength(0);
  });
  it("reste utilisable sur téléphone sans débordement horizontal", async () => {
    await page.setViewportSize({ width: 390, height: 844 }); await visit();
    await section().getByRole("button", { name: "Ajouter une table", exact: true }).waitFor();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: join(captures, "salle-mobile.png") });
    await section().getByRole("button", { name: "Ajouter une table", exact: true }).click();
    const save = page.getByRole("button", { name: "Enregistrer la table", exact: true });
    expect(await save.evaluate(element => element.getBoundingClientRect().bottom <= innerHeight)).toBe(true);
    await page.getByRole("dialog").screenshot({ path: join(captures, "salle-formulaire-mobile.png") });
  });
});
