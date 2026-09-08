import { createServer, type Server } from "node:http";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

type Choice = "accepted" | "dismissed";
declare global {
  interface Window {
    installFixture: {
      calls: number; registers: { url: string; options: RegistrationOptions }[];
      emit: (failure?: "prompt" | "choice") => void; finish: (choice: Choice) => void;
      standalone: (value: boolean) => void; unmount: () => void;
    };
  }
}
let server: Server, browser: Browser, context: BrowserContext, page: Page, origin: string;
let faults: string[], evidence: string | undefined;

// Real component and design-system CSS. Native install events/registration are
// explicit browser fixtures: this suite does not claim an OS-level installation.
beforeAll(async () => {
  const cssPath = fileURLToPath(new URL("../globals.css", import.meta.url));
  const [bundle, css] = await Promise.all([
    build({ stdin: { contents: `import React from 'react';import{createRoot}from'react-dom/client';
      import{DeliveryInstall}from'./DeliveryInstall';
      const root=createRoot(document.getElementById('root'));window.installFixture.unmount=()=>root.unmount();
      root.render(<React.StrictMode><main className="mx-auto min-h-dvh max-w-[460px] px-5 py-7 text-ink">
        <header className="border-b border-line pb-5"><h1 className="text-lg font-bold">SM Livreur</h1></header>
        <section aria-label="Missions de recette" className="py-6"><h2 className="text-2xl font-semibold">Vos missions</h2>
          <p className="mt-2 text-sm text-mut">Aucune mission pour le moment.</p>
          <button className="mt-5 min-h-11" onClick={e=>e.currentTarget.textContent='Missions actualisées'}>Actualiser les missions</button></section>
        <DeliveryInstall associated={true}/></main></React.StrictMode>);`,
      sourcefile: "delivery-install-fixture.tsx", loader: "tsx", resolveDir: fileURLToPath(new URL(".", import.meta.url)) },
      bundle: true, write: false, format: "esm", platform: "browser", target: "es2022", jsx: "automatic",
      define: { "process.env.NODE_ENV": '"development"' } }),
    readFile(cssPath, "utf8").then(source => postcss([tailwind({ base: fileURLToPath(new URL("../..", import.meta.url)) })]).process(source, { from: cssPath })),
  ]);
  server = createServer((req, res) => {
    res.setHeader("Cache-Control", "no-store");
    if (req.method !== "GET") { faults.push("Unexpected mutation"); res.writeHead(405).end(); return; }
    if (req.url === "/install.js") { res.setHeader("Content-Type", "text/javascript"); res.end(bundle.outputFiles[0].text); return; }
    if (req.url === "/install.css") { res.setHeader("Content-Type", "text/css"); res.end(css.css); return; }
    if (req.url === "/favicon.ico") { res.writeHead(204).end(); return; }
    if (!["/livreur", "/livreur/", "/autre"].includes(req.url ?? "")) { faults.push("Unexpected HTTP path"); res.writeHead(404).end(); return; }
    res.setHeader("Content-Type", "text/html");
    res.end('<!doctype html><html lang="fr"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>SM Livreur — installation de recette</title><link rel="stylesheet" href="/install.css"><div id="root"></div><script type="module" src="/install.js"></script></html>');
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); if (!address || typeof address === "string") throw new Error("Missing fixture port");
  origin = `http://127.0.0.1:${address.port}`;
  browser = await chromium.launch({ headless: true });
  if (process.env.QA_DELIVERY_INSTALL_CAPTURE === "1") { evidence = await mkdtemp(join(tmpdir(), "sm-delivery-install-")); console.info(`Installation captures: ${evidence}`); }
}, 30_000);

beforeEach(async () => {
  faults = [];
  context = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: "reduce", serviceWorkers: "block" });
  await context.route("**/*", route => {
    if (new URL(route.request().url()).origin === origin) return route.continue();
    faults.push("External request refused"); return route.abort();
  });
  page = await context.newPage(); page.setDefaultTimeout(3_000);
  page.on("pageerror", error => faults.push(error.message));
  page.on("console", message => { if (["error", "warning"].includes(message.type())) faults.push(message.text()); });
});
afterEach(async () => { await context?.close(); expect(faults).toEqual([]); });
afterAll(async () => { await browser?.close(); if (server) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); });

async function open(options: { ios?: boolean; ipad?: boolean; android?: boolean; standalone?: boolean; iosStandalone?: boolean; workerError?: boolean; path?: string } = {}) {
  await page.addInitScript(options => {
    const nativeMatch = window.matchMedia.bind(window);
    let standalone = Boolean(options.standalone), resolveChoice: (value: { outcome: Choice }) => void;
    const media = new EventTarget() as MediaQueryList;
    Object.defineProperty(media, "matches", { get: () => standalone });
    window.matchMedia = query => query === "(display-mode: standalone)" ? media : nativeMatch(query);
    if (options.ios || options.ipad) Object.defineProperty(navigator, "userAgent", { value: options.ipad ? "Mozilla/5.0 Macintosh" : "Mozilla/5.0 iPhone" });
    if (options.ipad) Object.defineProperty(navigator, "maxTouchPoints", { value: 5 });
    if (options.android) Object.defineProperty(navigator, "userAgent", { value: "Mozilla/5.0 Android" });
    if (options.iosStandalone) Object.defineProperty(navigator, "standalone", { value: true });
    const fixture: Window["installFixture"] = window.installFixture = {
      calls: 0, registers: [], unmount: () => {},
      emit: failure => {
        const event = new Event("beforeinstallprompt", { cancelable: true });
        let rejectChoice!: (error: Error) => void;
        const userChoice = new Promise<{ outcome: Choice }>((resolve, reject) => { resolveChoice = resolve; rejectChoice = reject; });
        Object.assign(event, { userChoice, prompt: () => {
          fixture.calls++;
          if (failure === "prompt") return Promise.reject(new Error("Browser fixture prompt failed"));
          if (failure === "choice") rejectChoice(new Error("Browser fixture choice failed"));
          return Promise.resolve();
        } });
        window.dispatchEvent(event);
      },
      finish: outcome => resolveChoice({ outcome }),
      standalone: value => { standalone = value; media.dispatchEvent(new Event("change")); },
    };
    Object.defineProperty(navigator, "serviceWorker", { value: { register: (url: string, registrationOptions: RegistrationOptions) => {
      fixture.registers.push({ url, options: registrationOptions });
      return options.workerError ? Promise.reject(new Error("Fixture worker refused")) : Promise.resolve({});
    } } });
  }, options);
  await page.goto(origin + (options.path ?? "/livreur"));
  await page.getByRole("heading", { name: "SM Livreur", exact: true }).waitFor();
  if (options.path !== "/autre") await expect.poll(() => page.evaluate(() => window.installFixture.registers.length)).toBe(1);
  if (!options.standalone && !options.iosStandalone && options.path !== "/autre") await help().waitFor();
  expect(await page.title()).toBe("SM Livreur — installation de recette");
  expect(new URL(page.url()).pathname).toBe(options.path ?? "/livreur");
  expect(await page.locator("nextjs-portal, vite-error-overlay").count()).toBe(0);
}
const install = () => page.getByRole("button", { name: "Installer SM Livreur", exact: true });
const help = () => page.getByRole("button", { name: "Comment l’installer ?", exact: true });
const prompt = () => page.evaluate(() => window.installFixture.emit());

describe("SM Livreur — installation progressive indépendante des accès privés", () => {
  it("prépare seulement le worker dédié, sans API privée ni écriture persistante", async () => {
    await open();
    expect(await page.evaluate(() => window.installFixture.registers)).toEqual([{ url: "/livreur/sw.js", options: { scope: "/livreur", updateViaCache: "none" } }]);
    expect(await install().count()).toBe(0);
    expect(await page.evaluate(async () => ({ local: localStorage.length, session: sessionStorage.length, databases: await indexedDB.databases(), caches: await caches.keys() })))
      .toEqual({ local: 0, session: 0, databases: [], caches: [] });
  });
  it("ne prépare aucun worker hors de la route livreur", async () => {
    await open({ path: "/autre" }); expect(await page.evaluate(() => window.installFixture.registers)).toEqual([]);
  });
  it("accueille un événement tardif, demande un geste et ne consomme le prompt qu’une fois", async () => {
    await open(); expect(await install().count()).toBe(0); await prompt(); await install().waitFor();
    expect(await page.evaluate(() => window.installFixture.calls)).toBe(0);
    await install().focus(); await page.keyboard.press("Enter");
    await page.getByRole("button", { name: "Actualiser les missions", exact: true }).click();
    expect(await page.getByRole("button", { name: "Missions actualisées" }).count()).toBe(1);
    await page.evaluate(() => window.installFixture.finish("dismissed"));
    await page.getByText("Installation reportée.", { exact: false }).waitFor();
    expect(await install().count()).toBe(0); expect(await page.evaluate(() => window.installFixture.calls)).toBe(1);
  });
  it("un événement consommé ailleurs ne laisse pas de faux bouton Installer", async () => {
    await open(); await prompt(); await install().waitFor(); await page.evaluate(() => window.installFixture.finish("dismissed"));
    await expect.poll(() => install().count()).toBe(0); expect(await page.evaluate(() => window.installFixture.calls)).toBe(0);
  });
  it("deux clics dans le même tour navigateur n’affichent qu’une seule demande native", async () => {
    await open(); await prompt(); await install().evaluate(element => { (element as HTMLButtonElement).click(); (element as HTMLButtonElement).click(); });
    expect(await page.evaluate(() => window.installFixture.calls)).toBe(1);
    await page.evaluate(() => window.installFixture.finish("dismissed"));
  });
  it("accepted n’est pas présenté comme une installation OS vérifiée", async () => {
    await open(); await prompt(); await install().click(); await page.evaluate(() => window.installFixture.finish("accepted"));
    await page.getByText("Installation demandée.", { exact: false }).waitFor();
    expect(await install().count()).toBe(0);
    await page.evaluate(() => window.dispatchEvent(new Event("appinstalled")));
    await page.getByText("Le navigateur a signalé l’installation.", { exact: false }).waitFor();
  });
  it("un nouveau prompt après un refus correspond à une nouvelle possibilité native", async () => {
    await open(); await prompt(); await install().click(); await page.evaluate(() => window.installFixture.finish("dismissed"));
    await expect.poll(() => install().count()).toBe(0); await prompt(); await install().waitFor();
    await install().click(); expect(await page.evaluate(() => window.installFixture.calls)).toBe(2);
    await page.evaluate(() => window.installFixture.finish("dismissed"));
  });
  it.each(["prompt", "choice"] as const)("une promesse %s refusée reste honnête et ne bloque pas les missions", async failure => {
    await open(); await page.evaluate(failure => window.installFixture.emit(failure), failure); await install().click();
    await page.getByText("L’installation n’a pas été confirmée.", { exact: false }).waitFor();
    expect(await install().count()).toBe(0); await help().click();
    expect(await page.getByRole("region", { name: "Installer depuis le navigateur" }).count()).toBe(1);
  });
  it.each([{ ios: true }, { ipad: true }])("explique le geste iOS/iPad sans bouton d’installation fictif (%j)", async device => {
    await open(device); await help().focus(); await page.keyboard.press("Enter");
    const region = page.getByRole("region", { name: "Installer depuis le navigateur" }); await region.waitFor();
    expect(await region.innerText()).toContain("Safari"); expect(await region.innerText()).toContain("Partager");
    expect(await install().count()).toBe(0);
    await page.keyboard.press("Escape");
    expect(await region.count()).toBe(0); expect(await help().evaluate(element => element === document.activeElement)).toBe(true);
    await page.keyboard.press("Enter"); await page.getByRole("button", { name: "Fermer l’aide", exact: true }).click();
    expect(await help().evaluate(element => element === document.activeElement)).toBe(true);
  });
  it("explique le menu Android quand aucun prompt natif n’est proposé", async () => {
    await open({ android: true }); await help().click();
    expect(await page.getByRole("region", { name: "Installer depuis le navigateur" }).innerText()).toContain("navigateur Android");
    expect(await install().count()).toBe(0);
  });
  it("suit display-mode et appinstalled sans drapeau persistant d’installation", async () => {
    await open(); await prompt(); await install().waitFor();
    await page.evaluate(() => window.installFixture.standalone(true)); await expect.poll(() => help().count()).toBe(0);
    await page.evaluate(() => window.installFixture.standalone(false)); await help().waitFor(); expect(await install().count()).toBe(0);
    await page.reload(); await help().waitFor(); expect(await install().count()).toBe(0);
  });
  it("masque la proposition dès l’ouverture standalone et ignore les événements tardifs après démontage", async () => {
    await open({ standalone: true }); expect(await help().count()).toBe(0);
    await page.evaluate(() => { window.installFixture.unmount(); window.installFixture.emit(); window.installFixture.finish("dismissed"); });
    expect(await page.evaluate(() => window.installFixture.calls)).toBe(0);
  });
  it("reconnaît le signal standalone historique d’iOS sans inventer un état installé en stockage", async () => {
    await open({ ios: true, iosStandalone: true }); expect(await help().count()).toBe(0);
    expect(await page.evaluate(() => localStorage.length + sessionStorage.length)).toBe(0);
  });
  it.each([false, true])("un échec du worker annonce la limite sans bloquer l’accès en ligne (standalone=%s)", async standalone => {
    await open({ workerError: true, standalone }); await page.getByText("Le mode hors connexion n’a pas pu être préparé.", { exact: false }).waitFor();
    await page.getByRole("button", { name: "Actualiser les missions", exact: true }).click();
    expect(await page.getByRole("button", { name: "Missions actualisées" }).count()).toBe(1);
  });
  it("garde l’aide lisible, refermable et sans mouvement persistant à 320, 390 et 1440 px", async () => {
    await open();
    if (evidence) await page.screenshot({ path: join(evidence, "card-390.png") });
    for (const width of [320, 390, 1440]) {
      await page.setViewportSize({ width, height: width === 1440 ? 900 : 844 }); await help().click();
      await page.getByRole("region", { name: "Installer depuis le navigateur" }).waitFor();
      const geometry = await page.evaluate(() => ({ width: innerWidth, content: document.documentElement.scrollWidth,
        buttons: [...document.querySelectorAll('button')].map(element => ({ ...element.getBoundingClientRect().toJSON() })) }));
      expect(geometry.content).toBeLessThanOrEqual(geometry.width);
      expect(geometry.buttons.every(button => button.width >= 44 && button.height >= 44 && button.x >= 0 && button.right <= width)).toBe(true);
      expect(await page.evaluate(() => document.getAnimations().filter(animation => animation.playState === "running" || animation.pending).map(animation => {
        const timing = animation.effect!.getTiming();
        return typeof timing.duration !== "number" || !Number.isFinite(timing.duration) || timing.duration > 1 || Math.abs(timing.delay ?? 0) > 1 || timing.iterations !== 1 || animation.playbackRate !== 1;
      }))).not.toContain(true);
      await expect.poll(() => page.evaluate(() => document.getAnimations().filter(animation => animation.playState === "running" || animation.pending).length), { timeout: 500 }).toBe(0);
      if (evidence) await page.screenshot({ path: join(evidence, `help-${width}.png`) });
      await page.getByRole("button", { name: "Fermer l’aide", exact: true }).click();
    }
  });
});
