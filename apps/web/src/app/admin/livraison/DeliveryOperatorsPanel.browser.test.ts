import { mkdtemp, readFile } from "node:fs/promises";
import { createServer, type Server, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { DeliveryOperatorCreate } from "@sm/contracts";
import type { DeliveryOperatorAttempt } from "./delivery-operators-data";

/** Full client component + DS, real browser storage; only the API is a loopback fixture.
 * Bundle/CSS stay in memory. The fixed Date clock does not advance network timeouts.
 */
const tenantId = "507f1f77bcf86cd799439011";
const attemptKey = `sm.delivery-operator-create.v1.${tenantId}`;
const startAt = Date.parse("2026-09-07T12:00:00.000Z");
const oldWarning = "Cette demande date de plus de 30 minutes.";
const title = "Accès livreurs — horloge de recette locale";
let server: Server;
let browser: Browser;
let context: BrowserContext;
let page: Page;
let origin: string;
let requests: DeliveryOperatorCreate[];
let heldResponses: ServerResponse[];
let directoryReads: number;
let errors: string[];
let externalRequests: string[];
let evidenceDir: string | undefined;

beforeAll(async () => {
  const root = fileURLToPath(new URL(".", import.meta.url));
  const webRoot = fileURLToPath(new URL("../../../..", import.meta.url));
  const cssPath = fileURLToPath(new URL("../../globals.css", import.meta.url));
  const [bundle, css] = await Promise.all([
    build({
      stdin: {
        contents: `import React from 'react'; import {createRoot} from 'react-dom/client';
          import {DeliveryOperatorsPanel} from './DeliveryOperatorsPanel';
          createRoot(document.getElementById('root')).render(
            <main className="mx-auto max-w-[1120px] p-4"><DeliveryOperatorsPanel /></main>);`,
        resolveDir: root, sourcefile: "delivery-operators-clock-entry.tsx", loader: "tsx",
      },
      bundle: true, write: false, format: "esm", platform: "browser", target: "es2022", jsx: "automatic",
      alias: { "@": fileURLToPath(new URL("../../..", import.meta.url)) },
      define: { "process.env.NODE_ENV": '"production"', "process.env.NEXT_PUBLIC_API_URL": '"/api"', "process.env.NEXT_PUBLIC_SITE_URL": '"https://example.test"' },
    }),
    readFile(cssPath, "utf8").then(source => postcss([tailwind({ base: webRoot })]).process(source, { from: cssPath })),
  ]);
  server = createServer(async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    if (req.url === "/panel.js" || req.url === "/panel.css") {
      res.setHeader("Content-Type", req.url.endsWith(".js") ? "text/javascript; charset=utf-8" : "text/css; charset=utf-8");
      res.end(req.url.endsWith(".js") ? bundle.outputFiles[0].text : css.css); return;
    }
    if (req.url === "/admin/livraison") {
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.end(`<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><link rel="stylesheet" href="/panel.css"></head><body><div id="root"></div><script type="module" src="/panel.js"></script></body></html>`);
      return;
    }
    res.setHeader("Content-Type", "application/json");
    if (req.method === "GET" && req.url === "/api/tenants/me") {
      res.end(JSON.stringify({ _id: tenantId })); return;
    }
    if (req.method === "GET" && req.url === "/api/delivery/operators") {
      directoryReads++;
      res.end(JSON.stringify({ operators: [], candidates: [], truncated: false, nextCursor: null })); return;
    }
    if (req.method === "POST" && req.url === "/api/delivery/operators") {
      try {
        const chunks: Buffer[] = [];
        for await (const chunk of req) chunks.push(Buffer.from(chunk));
        requests.push(JSON.parse(Buffer.concat(chunks).toString()));
        // Keep the real HTTP response pending until teardown, so assertions see the transient UI.
        heldResponses.push(res);
      } catch { res.writeHead(400).end("{}"); }
      return;
    }
    if (req.url !== "/favicon.ico") errors.push(`Unexpected fixture request: ${req.method} ${req.url}`);
    res.writeHead(404).end("{}");
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing loopback port");
  origin = `http://127.0.0.1:${address.port}`;
  browser = await chromium.launch({ headless: true });
  if (process.env.QA_DELIVERY_OPERATOR_CLOCK_CAPTURE === "1") evidenceDir = await mkdtemp(join(tmpdir(), "sm-delivery-operator-clock-"));
}, 30_000);

beforeEach(async () => {
  requests = []; heldResponses = []; directoryReads = 0; errors = []; externalRequests = [];
  context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce", serviceWorkers: "block" });
  await context.route("**/*", route => {
    if (new URL(route.request().url()).origin === origin) return route.continue();
    externalRequests.push(route.request().url()); return route.abort();
  });
  await context.addInitScript(() => localStorage.setItem("sm.token.resto", "local-manager-fixture"));
  page = await context.newPage();
  page.setDefaultTimeout(2_500);
  page.on("pageerror", error => errors.push(error.message));
  await page.clock.setFixedTime(new Date(startAt));
});

afterEach(async () => {
  await context?.close();
  for (const response of heldResponses) response.destroy();
  expect(errors).toEqual([]);
  expect(externalRequests).toEqual([]);
});

afterAll(async () => {
  await browser?.close();
  if (server) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  if (evidenceDir) console.info(`Captures de recette horloge : ${evidenceDir}`);
});

async function openPanel() {
  await page.goto(`${origin}/admin/livraison`);
  await page.getByRole("button", { name: "Actualiser", exact: true }).waitFor();
  expect(await page.title()).toBe(title);
  expect(new URL(page.url()).pathname).toBe("/admin/livraison");
  expect(await page.getByText("Votre première équipe de livraison", { exact: true }).count()).toBe(1);
  expect(directoryReads).toBe(1);
}

async function readAttempt(): Promise<DeliveryOperatorAttempt | null> {
  return page.evaluate(key => {
    const raw = sessionStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  }, attemptKey);
}

async function waitForPendingPost() {
  await expect.poll(() => requests.length).toBe(1);
  const busy = page.getByRole("button", { name: "Vérification…", exact: true });
  await busy.waitFor();
  expect(await busy.isDisabled()).toBe(true);
  expect(await busy.getAttribute("aria-busy")).toBe("true");
  expect(heldResponses).toHaveLength(1);
  expect(heldResponses[0].writableEnded).toBe(false);
}

describe("horloge des ajouts livreurs, panneau complet dans Chromium", () => {
  it("ne vieillit pas une demande fraîche après dix minutes d’inactivité, pendant le POST", async () => {
    await openPanel();
    const createdAt = startAt + 10 * 60_000;
    await page.clock.setFixedTime(new Date(createdAt));
    await page.getByRole("button", { name: "Ajouter un livreur", exact: true }).click();
    await page.getByLabel("Nom du livreur", { exact: true }).fill("Livreur de recette");
    await page.getByRole("button", { name: "Ajouter l’accès", exact: true }).click();
    await waitForPendingPost();

    const attempt = await readAttempt();
    expect(attempt).toMatchObject({ tenantId, createdAt, request: requests[0] });
    expect(attempt?.request.requestId).toMatch(/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
    expect(directoryReads).toBe(1); // No focus/reload refreshed the older observation clock.
    if (evidenceDir) await page.screenshot({ path: join(evidenceDir, "fresh-pending.png"), fullPage: true });
    expect(await page.getByText(oldWarning, { exact: false }).count()).toBe(0);
    expect(await page.getByText("La demande est conservée dans cet onglet.", { exact: false }).count()).toBe(1);
  });

  it("signale une demande de 31 minutes sans rajeunir ni remplacer son UUID à la reprise", async () => {
    const oldAttempt: DeliveryOperatorAttempt = {
      v: 1, tenantId, createdAt: startAt - 31 * 60_000,
      request: { requestId: "fd5a68c4-edb9-434f-82ee-fb59c6965731", name: "Livreur de recette" },
    };
    await context.addInitScript(({ key, attempt }) => sessionStorage.setItem(key, JSON.stringify(attempt)), { key: attemptKey, attempt: oldAttempt });
    await page.setViewportSize({ width: 390, height: 844 });
    await openPanel();
    expect(await page.getByText(oldWarning, { exact: false }).count()).toBe(1);
    expect(requests).toEqual([]); // Directory inspection never automatically replays an old mutation.
    expect(await readAttempt()).toEqual(oldAttempt);

    await page.getByRole("button", { name: "Reprendre l’ajout", exact: true }).click();
    await page.getByRole("button", { name: "Reprendre le même ajout", exact: true }).click();
    await waitForPendingPost();
    expect(requests).toEqual([oldAttempt.request]);
    expect(await readAttempt()).toEqual(oldAttempt);
    expect(await page.getByText(oldWarning, { exact: false }).count()).toBe(1);
    if (evidenceDir) await page.screenshot({ path: join(evidenceDir, "old-retry-pending.png"), fullPage: true });
  });
});
