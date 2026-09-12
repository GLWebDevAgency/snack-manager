import { createServer, type Server } from "node:http";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { afterAll, afterEach, beforeAll, beforeEach, expect, it } from "vitest";

// Two real theme consumers and buttons, with native storage. No remote API.
const KEY = "sm.backoffice.theme.v1";
let server: Server, browser: Browser, context: BrowserContext, page: Page, origin: string;
let errors: string[];
declare global { interface Window { themeFixture: { failWrites: boolean } } }

beforeAll(async () => {
  const bundle = await build({ stdin: { contents: `import React from 'react';import{createRoot}from'react-dom/client';import{useBackofficeTheme,AppearanceButton}from'./appearance';function Panel(){const {theme,toggleTheme}=useBackofficeTheme();return <section data-theme={theme}><AppearanceButton theme={theme} onToggle={toggleTheme}/></section>};createRoot(document.getElementById('root')).render(<React.StrictMode><Panel/><Panel/></React.StrictMode>);`,
    resolveDir: fileURLToPath(new URL(".", import.meta.url)), sourcefile: "appearance-fixture.tsx", loader: "tsx" },
    bundle: true, write: false, format: "esm", platform: "browser", jsx: "automatic", define: { "process.env.NODE_ENV": '"production"' } });
  server = createServer((request, response) => {
    if (request.url === "/app.js") { response.setHeader("Content-Type", "text/javascript"); response.end(bundle.outputFiles[0].text); return; }
    response.setHeader("Content-Type", "text/html"); response.end('<!doctype html><html lang="fr"><div id="root"></div><script type="module" src="/app.js"></script></html>');
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); if (!address || typeof address === "string") throw Error("Missing local port"); origin = `http://127.0.0.1:${address.port}`;
  browser = await chromium.launch({ headless: true });
}, 30000);
beforeEach(async () => {
  errors = []; context = await browser.newContext({ serviceWorkers: "block" });
  await context.route("**/*", route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  page = await context.newPage(); page.setDefaultTimeout(3000); page.on("pageerror", error => errors.push(error.message));
});
afterEach(async () => { await context.close(); expect(errors).toEqual([]); });
afterAll(async () => { await browser.close(); await new Promise<void>(resolve => server.close(() => resolve())); });

it("change les deux coquilles quand le quota bloque l’écriture mais laisse lire l’ancien thème", async () => {
  await context.addInitScript(key => {
    localStorage.setItem(key, "light"); window.themeFixture = { failWrites: true };
    const write = Storage.prototype.setItem;
    Storage.prototype.setItem = function (name, value) {
      if (name === key && window.themeFixture.failWrites) throw new DOMException("Full", "QuotaExceededError");
      return write.call(this, name, value);
    };
  }, KEY);
  await page.goto(origin);
  const dark = () => page.getByRole("button", { name: "Activer le thème sombre", exact: true }).first();
  const light = () => page.getByRole("button", { name: "Activer le thème clair", exact: true }).first();
  await dark().click(); await expect.poll(() => page.locator('[data-theme="dark"]').count()).toBe(2);
  expect(await page.evaluate(key => localStorage.getItem(key), KEY)).toBe("light");
  await light().click(); await expect.poll(() => page.locator('[data-theme="light"]').count()).toBe(2);
  await dark().click(); await expect.poll(() => page.locator('[data-theme="dark"]').count()).toBe(2);
  await page.evaluate(() => { window.themeFixture.failWrites = false; });
  await light().click(); await dark().click();
  expect(await page.evaluate(key => localStorage.getItem(key), KEY)).toBe("dark");
  // A later confirmed write in another tab regains authority over memory.
  await page.evaluate(key => { localStorage.setItem(key, "light"); window.dispatchEvent(new StorageEvent("storage", { key, newValue: "light" })); }, KEY);
  await expect.poll(() => page.locator('[data-theme="light"]').count()).toBe(2);
});
