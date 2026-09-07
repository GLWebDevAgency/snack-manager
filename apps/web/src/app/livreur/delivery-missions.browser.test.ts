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
import type { DeliveryMissionAssign, DeliveryMissionDispatch, DeliveryMissionResult, DeliveryMissionView } from "@sm/contracts";

/** Full components and DS with native storage; isolated HTTP fixtures, no build output or remote calls. */
const tenantId = "a".repeat(24), operatorId = "b".repeat(24), actorId = "c".repeat(24), id = "d".repeat(24), otherId = "e".repeat(24);
const session = { operatorId, name: "Camille · recette", restaurantName: "Restaurant de recette", restaurantSlug: "recette", expiresAt: "2030-09-14T10:00:00.000Z" };
const initial: DeliveryMissionView = { id, number: 12, createdAt: "2026-09-07T10:00:00.000Z", scheduledAt: "2026-09-07T18:30:00.000Z", orderStatus: "ready", revision: 2,
  operator: { id: operatorId, name: session.name }, assignmentId: "02faab2b-f0b1-47c4-b591-8e88908a91b5", assignedAt: "2026-09-07T10:00:00.000Z", dispatchedAt: null,
  paymentReady: true, canAssign: true, canDispatch: true, customer: { name: "Client de recette", phone: null },
  address: { line1: "10 rue de la Recette", postalCode: "75001", city: "Paris", country: "FR" }, instructions: "Recette locale · aucune livraison réelle", items: [{ name: "Menu kebab", variantName: "Fromage", qty: 2 }] };
const operator = { id: operatorId, name: session.name, staffId: null, active: true, effectiveActive: true, blockedReason: null, revision: 1, sessionState: "connected", inviteExpiresAt: null };
type Recorded = { path: string; body: DeliveryMissionAssign | DeliveryMissionDispatch };
let server: Server, browser: Browser, context: BrowserContext, page: Page, origin: string;
let missions: DeliveryMissionView[], posts: Recorded[], errors: string[], remote: string[], reads: string[];
let revoked: boolean, lossOnce: boolean, removed: Set<string>, refuseNext: boolean, holdNext: boolean, directoryPaged: boolean, changedOnce: boolean, holdRecovery: boolean;
let held: { response: ServerResponse; result: DeliveryMissionResult } | null;
let heldRead: { response: ServerResponse; mission: DeliveryMissionView } | null;
let proofs: Map<string, DeliveryMissionResult>;
let evidenceDir: string | undefined;
const token = (role = "owner", sub = actorId) => `fixture.${Buffer.from(JSON.stringify({ tenantId, sub, kind: role === "caisse" ? "staff" : "user", role })).toString("base64url")}.fixture`;

beforeAll(async () => {
  const root = fileURLToPath(new URL(".", import.meta.url));
  const cssPath = fileURLToPath(new URL("../globals.css", import.meta.url));
  const [bundle, css] = await Promise.all([
    build({ stdin: { contents: `import React from 'react'; import {createRoot} from 'react-dom/client';
      import {DeliveryAccess} from './delivery-access'; import {DeliveryMissionModal} from '../admin/orders/DeliveryMissionModal';
      const bo = location.pathname.startsWith('/admin');
      createRoot(document.getElementById('root')).render(<React.StrictMode>{bo ? <main className="p-6"><h1>Commandes du restaurant</h1><DeliveryMissionModal order={{_id:'${id}',number:12}} onClose={()=>{}} onUpdated={()=>{}} /></main> : <DeliveryAccess />}</React.StrictMode>);`,
    resolveDir: root, sourcefile: "missions-test-entry.tsx", loader: "tsx" },
    bundle: true, write: false, format: "esm", platform: "browser", target: "es2022", jsx: "automatic",
    define: { "process.env.NODE_ENV": '"production"', "process.env.NEXT_PUBLIC_API_URL": '"/api"' } }),
    readFile(cssPath, "utf8").then(source => postcss([tailwind({ base: fileURLToPath(new URL("../..", import.meta.url)) })]).process(source, { from: cssPath })),
  ]);
  server = createServer(async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    if (req.url === "/missions.js" || req.url === "/missions.css") {
      res.setHeader("Content-Type", req.url.endsWith(".js") ? "text/javascript" : "text/css");
      res.end(req.url.endsWith(".js") ? bundle.outputFiles[0].text : css.css); return;
    }
    if (req.url === "/livreur" || req.url?.startsWith("/admin/orders")) {
      res.setHeader("Content-Type", "text/html");
      res.end(`<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Missions — recette locale</title><link rel="stylesheet" href="/missions.css"></head><body><div id="root"></div><script type="module" src="/missions.js"></script></body></html>`); return;
    }
    res.setHeader("Content-Type", "application/json");
    const json = (value: unknown, status = 200) => res.writeHead(status).end(JSON.stringify(value));
    try {
      const path = new URL(req.url ?? "/", origin).pathname;
      if (req.method === "GET") reads.push(path);
      if (path === "/livreur/acces") { json(revoked ? { code: "ACCESS_UNAVAILABLE" } : session, revoked ? 401 : 200); return; }
      if (path === "/api/tenants/me") { json({ _id: tenantId }); return; }
      if (path === "/api/delivery/operators") {
        const firstPage = directoryPaged && !new URL(req.url ?? "/", origin).searchParams.has("after");
        json({ operators: firstPage ? [] : [operator], candidates: [], truncated: false, nextCursor: firstPage ? operatorId : null }); return;
      }
      if (path.startsWith("/livreur/missions") && revoked) { json({ code: "ACCESS_UNAVAILABLE" }, 401); return; }
      if (path === "/livreur/missions") { json({ missions: missions.filter(value => !removed.has(value.id) && value.operator?.id === operatorId), nextCursor: null }); return; }
      const match = /^\/(?:api\/delivery|livreur)\/missions\/([a-f0-9]{24})(?:\/(assignment|dispatch|depart))?$/.exec(path);
      if (match) {
        const target = missions.find(value => value.id === match[1]);
        if (req.method === "GET") {
          if (holdRecovery && target) { holdRecovery = false; heldRead = { response: res, mission: { ...target, revision: target.revision + 1, address: { ...target.address, line1: "99 rue de la Réponse tardive" } } }; return; }
          json(target && !removed.has(target.id) ? target : { code: "MISSION_UNAVAILABLE" }, target && !removed.has(target.id) ? 200 : 404); return;
        }
        const chunks: Buffer[] = []; for await (const chunk of req) chunks.push(Buffer.from(chunk));
        const body = JSON.parse(Buffer.concat(chunks).toString()) as Recorded["body"];
        posts.push({ path, body });
        if (changedOnce) { changedOnce = false; holdRecovery = true; json({ code: "DELIVERY_MISSION_CHANGED" }, 409); return; }
        if (!target || removed.has(target.id)) { json({ code: "MISSION_UNAVAILABLE" }, 404); return; }
        const previous = proofs.get(body.operationId);
        if (previous) { json({ ...previous, replay: true, mission: target }); return; }
        const rejecting = refuseNext; refuseNext = false;
        const updated: DeliveryMissionView = { ...target, revision: target.revision + 1 };
        if (!rejecting && "operatorId" in body) {
          updated.operator = body.operatorId ? { id: body.operatorId, name: session.name } : null;
          updated.assignmentId = body.operatorId ? body.operationId : null; updated.assignedAt = body.operatorId ? "2026-09-07T10:10:00.000Z" : null;
          updated.canDispatch = Boolean(body.operatorId && updated.paymentReady && updated.orderStatus === "ready");
        } else if (!rejecting) { updated.dispatchedAt = "2026-09-07T10:10:00.000Z"; updated.canDispatch = false; updated.canAssign = false; }
        else updated.canDispatch = false;
        missions = missions.map(value => value.id === target.id ? updated : value);
        const common = { operationId: body.operationId, appliedRevision: updated.revision, replay: false, mission: updated };
        const result: DeliveryMissionResult = rejecting ? { ...common, outcome: "rejected", refusalCode: "DELIVERY_OPERATOR_CHANGED" } : { ...common, outcome: "applied", refusalCode: null };
        proofs.set(body.operationId, result);
        if (holdNext) { holdNext = false; held = { response: res, result }; return; }
        if (lossOnce) { lossOnce = false; json({ code: "SERVICE_UNAVAILABLE" }, 503); return; }
        json(result); return;
      }
      if (path !== "/favicon.ico") errors.push(`Unexpected fixture request ${req.method} ${path}`);
      json({}, 404);
    } catch { json({}, 500); }
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); if (!address || typeof address === "string") throw new Error("Missing loopback port");
  origin = `http://127.0.0.1:${address.port}`;
  browser = await chromium.launch({ headless: true });
  if (process.env.QA_DELIVERY_MISSIONS_CAPTURE === "1") evidenceDir = await mkdtemp(join(tmpdir(), "sm-delivery-missions-"));
}, 30_000);
beforeEach(async () => {
  missions = [structuredClone(initial)]; posts = []; errors = []; remote = []; reads = []; revoked = false; lossOnce = false; removed = new Set(); refuseNext = false; holdNext = false; directoryPaged = false; changedOnce = false; holdRecovery = false; held = null; heldRead = null; proofs = new Map();
  context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, reducedMotion: "reduce", serviceWorkers: "block" });
  await context.route("**/*", route => {
    if (new URL(route.request().url()).origin === origin) return route.continue();
    remote.push(route.request().url()); return route.abort();
  });
  page = await context.newPage(); page.setDefaultTimeout(3_000); page.on("pageerror", error => errors.push(error.message));
});
afterEach(async ({ task }) => {
  if (held) { held.response.end(JSON.stringify(held.result)); held = null; }
  if (heldRead) { heldRead.response.end(JSON.stringify(heldRead.mission)); heldRead = null; }
  if (task.result?.state === "fail") console.info("Écran missions de recette en échec :", await page.locator("body").innerText());
  await context.close(); expect(errors).toEqual([]); expect(remote).toEqual([]);
});
afterAll(async () => {
  await browser?.close();
  if (server) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  if (evidenceDir) console.info(`Captures missions locales : ${evidenceDir}`);
});
async function openDriver() {
  await page.goto(`${origin}/livreur`); await page.getByRole("heading", { name: /Mes missions/ }).waitFor();
  expect(await page.title()).toBe("Missions — recette locale");
  await page.getByRole("button", { name: "Voir la mission n°12", exact: true }).waitFor();
}
async function detail(number = 12) { await page.getByRole("button", { name: `Voir la mission n°${number}`, exact: true }).click(); await page.getByRole("dialog").waitFor(); }
async function capture(name: string) { if (evidenceDir) await page.screenshot({ path: join(evidenceDir, name), fullPage: false }); }
async function runningAnimations() {
  return page.evaluate(() => document.getAnimations().filter(animation => animation.pending || animation.playState === "running").map(animation => {
    const effect = animation.effect instanceof KeyframeEffect ? animation.effect : null;
    const timing = effect?.getTiming();
    const target = effect?.target;
    return { type: animation.constructor.name, name: animation instanceof CSSAnimation ? animation.animationName : animation instanceof CSSTransition ? animation.transitionProperty : animation.id,
      target: target instanceof Element ? `${target.tagName}.${target.getAttribute("class") ?? ""}` : null,
      duration: timing?.duration, delay: timing?.delay, iterations: String(timing?.iterations), playbackRate: animation.playbackRate, pending: animation.pending, currentTime: animation.currentTime };
  }));
}
/** A disabled→enabled cf-press transition lasts 0.01ms but remains pending until a frame.
 * Allow only that reduced duration/delay (≤1ms tolerance, one iteration at normal speed), then require
 * complete settlement within 500ms. Remember unsafe observations even if they finish
 * during polling: a real 500ms motion must not become a passing "eventually idle" check.
 */
async function expectReducedMotionSettled(afterFirstSample?: () => Promise<void>) {
  const unsafe = new Map<string, Awaited<ReturnType<typeof runningAnimations>>[number]>();
  let last: Awaited<ReturnType<typeof runningAnimations>> = [];
  let first = true;
  try { await expect.poll(async () => {
    const active = await runningAnimations();
    last = active;
    for (const animation of active) {
      if (typeof animation.duration !== "number" || !Number.isFinite(animation.duration) || animation.duration > 1
        || typeof animation.delay !== "number" || !Number.isFinite(animation.delay) || Math.abs(animation.delay) > 1
        || animation.iterations !== "1" || animation.playbackRate !== 1) {
        const key = `${animation.type}:${animation.name}:${animation.target}`;
        if (!unsafe.has(key)) unsafe.set(key, animation);
      }
    }
    if (first) { first = false; await afterFirstSample?.(); }
    return { unsafe: [...unsafe.values()], active };
  }, { timeout: 500, interval: 20 }).toEqual({ unsafe: [], active: [] }); }
  catch (cause) {
    throw new Error(`Le mode mouvement réduit ne s’est pas stabilisé : ${JSON.stringify({ unsafe: [...unsafe.values()], active: last })}`, { cause });
  }
}
async function openBo(role = "owner") {
  await context.addInitScript(value => localStorage.setItem("sm.token.resto", value), token(role));
  await page.goto(`${origin}/admin/orders`); await page.getByRole("dialog").waitFor();
  await page.getByRole("button", { name: "Actualiser la livraison" }).waitFor();
  await page.getByText("10 rue de la Recette", { exact: false }).waitFor();
}
describe("missions livreur et affectation BO rendues", () => {
  it("liste sans modale en 320px et bureau : contenu utile, sans débordement ni mouvement imposé", async () => {
    await page.setViewportSize({ width: 320, height: 844 }); await openDriver();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    expect(await page.getByRole("button", { name: "Voir la mission n°12" }).isEnabled()).toBe(true);
    await expectReducedMotionSettled();
    await capture("mobile-320-list.png");
    await page.setViewportSize({ width: 1440, height: 1000 }); await capture("desktop-driver-list.png");
  });
  it.each(["longue", "ralentie", "infinie", "bloquée"] as const)("le contrôle du mouvement refuse une animation %s, sans attendre qu’elle disparaisse pour l’oublier", async kind => {
    await openDriver(); await expectReducedMotionSettled();
    await page.evaluate(mode => {
      const target = document.getElementById("delivery-missions-title");
      if (!target) throw new Error("Missing fixture target");
      const animation = target.animate([{ opacity: 1 }, { opacity: 0.5 }], {
        duration: mode === "longue" ? 10_000 : mode === "ralentie" ? 1 : 0.01, iterations: mode === "infinie" ? Infinity : 1,
      });
      animation.id = "fixture-reduced-motion-guard";
      // Slow playback turns a nominal 1ms duration into 100s of visible motion,
      // keeping the negative control observable until its first sample on a busy CI.
      // The long/infinite controls keep normal speed to isolate their own limits.
      animation.playbackRate = mode === "ralentie" ? 0.00001 : mode === "bloquée" ? 0 : 1;
    }, kind);
    const cancelFixture = () => page.evaluate(() => {
      document.getAnimations().filter(animation => animation.id === "fixture-reduced-motion-guard").forEach(animation => animation.cancel());
    });
    try {
      // The slow animation disappears immediately after observation; its violation
      // must still fail. Infinite/stalled variants remain until finally cleanup.
      await expect(expectReducedMotionSettled(kind === "longue" || kind === "ralentie" ? cancelFixture : undefined)).rejects.toThrow(
        kind === "longue" ? '"duration":10000' : kind === "ralentie" ? '"playbackRate":0.00001' : kind === "infinie" ? '"iterations":"Infinity"' : '"playbackRate":0',
      );
    } finally { await cancelFixture(); }
    await expectReducedMotionSettled();
  });
  it("une vérification d’accès conserve la géométrie compacte et désactive les actions", async () => {
    await openDriver();
    const before = await page.getByRole("heading", { name: /Mes missions/ }).boundingBox();
    let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
    await page.route("**/livreur/acces", async route => { await gate; await route.continue(); });
    try {
      await page.evaluate(() => window.dispatchEvent(new Event("focus")));
      await page.getByRole("heading", { name: "Accès à vérifier.", exact: true }).waitFor();
      const during = await page.getByRole("heading", { name: /Mes missions/ }).boundingBox();
      expect(during?.y).toBe(before?.y);
      expect(await page.getByRole("button", { name: "Voir la mission n°12" }).isDisabled()).toBe(true);
    } finally { release(); }
    await page.getByRole("heading", { name: "Accès associé.", exact: true }).waitFor();
  });
  it("mobile : attend préparation/paiement, montre le détail puis le départ réellement confirmé", async () => {
    missions[0] = { ...missions[0], orderStatus: "preparing", paymentReady: false, canDispatch: false };
    await openDriver(); await detail();
    expect(await page.getByRole("button", { name: "Confirmer mon départ" }).isDisabled()).toBe(true);
    expect(posts).toEqual([]); await capture("mobile-payment-waiting.png");
    await page.getByRole("dialog").locator("[data-dialog-footer]").getByRole("button", { name: "Fermer", exact: true }).click(); missions[0] = { ...initial };
    await page.getByRole("button", { name: "Actualiser les missions" }).click(); await detail();
    holdNext = true; await page.getByRole("button", { name: "Confirmer mon départ" }).focus(); await page.keyboard.press("Enter");
    await page.waitForFunction(() => document.querySelector('[aria-busy="true"]'));
    expect(posts).toHaveLength(1); expect(await page.getByRole("button", { name: "Confirmation…" }).isDisabled()).toBe(true);
    expect(await page.getByRole("dialog").innerText()).not.toContain("Départ confirmé.");
    expect(held).not.toBeNull(); held!.response.end(JSON.stringify(held!.result)); held = null;
    await page.getByRole("dialog").getByText("Départ confirmé. La commande est en route.").waitFor();
    await capture("mobile-depart-confirmed.png");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
  it("reprend après réponse perdue et reload, avec UUID et paramètres inchangés, sans coordonnées stockées", async () => {
    await openDriver(); await detail(); lossOnce = true;
    await page.getByRole("button", { name: "Confirmer mon départ" }).click();
    await page.getByRole("button", { name: "Vérifier ce départ" }).waitFor(); await capture("mobile-uncertain.png");
    const first = structuredClone(posts[0]);
    const storage = await page.evaluate(() => JSON.stringify(Object.entries(sessionStorage)));
    expect(storage).toContain(first.body.operationId); expect(storage).not.toContain(initial.customer.name); expect(storage).not.toContain(initial.address.line1);
    await page.reload(); await page.getByRole("button", { name: "Vérifier le départ n°12" }).waitFor(); expect(posts).toHaveLength(1);
    await page.getByRole("button", { name: "Vérifier le départ n°12" }).click();
    await page.getByText("Départ confirmé. La commande est en route.", { exact: true }).waitFor();
    expect(posts).toEqual([first, first]); expect(await page.evaluate(() => sessionStorage.length)).toBe(0);
  });
  it("un stockage refusé ne transmet aucun départ", async () => {
    await openDriver(); await detail();
    await page.evaluate(() => { const native = Storage.prototype.setItem; Storage.prototype.setItem = function(key, value) { if (this === sessionStorage) throw new Error("fixture storage denied"); native.call(this, key, value); }; });
    await page.getByRole("button", { name: "Confirmer mon départ" }).click();
    await page.getByRole("dialog").getByRole("alert").filter({ hasText: "sauvegarde" }).waitFor(); expect(posts).toEqual([]);
  });
  it("404 retire seulement cette mission ; une autre fonctionne, puis 401 efface les coordonnées et ferme le détail", async () => {
    missions.push({ ...initial, id: otherId, number: 13, address: { ...initial.address, line1: "20 rue de la Recette" } });
    await openDriver(); await detail(); removed.add(id);
    await page.getByRole("button", { name: "Confirmer mon départ" }).click();
    await page.getByRole("button", { name: "Voir la mission n°13" }).waitFor(); expect(await page.getByRole("dialog").count()).toBe(0);
    expect(await page.locator("body").innerText()).not.toContain("10 rue de la Recette");
    await detail(13); await page.getByRole("button", { name: "Confirmer mon départ" }).click();
    await page.getByRole("dialog").getByText("Départ confirmé. La commande est en route.").waitFor();
    expect(posts).toHaveLength(2); expect(await page.evaluate(() => sessionStorage.length)).toBe(1);
    revoked = true;
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await page.getByRole("alert").filter({ hasText: "Votre accès a expiré ou a été retiré" }).waitFor();
    expect(await page.getByRole("dialog").count()).toBe(0); expect(await page.locator("body").innerText()).not.toContain("rue de la Recette");
  });
  it("un refus terminal reste un avertissement et n’annonce pas attendre une cuisine déjà prête", async () => {
    await openDriver(); await detail(); refuseNext = true;
    await page.getByRole("button", { name: "Confirmer mon départ" }).click();
    await page.getByRole("dialog").getByRole("alert").filter({ hasText: "L’accès ou l’affectation du livreur a changé" }).waitFor();
    expect(await page.getByRole("dialog").innerText()).not.toContain("Attendez que la cuisine");
    expect(await page.getByRole("dialog").innerText()).not.toContain("Départ confirmé.");
    expect(await page.evaluate(() => sessionStorage.length)).toBe(0); await capture("mobile-access-refused.png");
  });
  it("BO desktop : affecte avant paiement/préparation, puis confirme séparément le départ", async () => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    missions[0] = { ...initial, operator: null, assignmentId: null, assignedAt: null, orderStatus: "preparing", paymentReady: false, canDispatch: false };
    await openBo(); await page.getByLabel("Choisir un livreur", { exact: true }).selectOption(operatorId);
    expect(await page.getByRole("button", { name: "Confirmer le départ", exact: true }).isDisabled()).toBe(true);
    await page.getByRole("button", { name: "Confirmer l’affectation", exact: true }).click();
    await page.getByText("Affectation vérifiée.", { exact: false }).waitFor(); expect(posts).toHaveLength(1); expect(posts[0].path).toContain("assignment");
    expect(missions[0].dispatchedAt).toBeNull(); await capture("desktop-assigned-waiting.png");
    missions[0] = { ...missions[0], orderStatus: "ready", paymentReady: true, canDispatch: true };
    await page.getByRole("button", { name: "Actualiser la livraison" }).click();
    await page.getByRole("button", { name: "Confirmer le départ", exact: true }).click();
    await page.getByText("Départ confirmé. La commande est en route.", { exact: true }).waitFor();
    expect(posts).toHaveLength(2); expect(posts[1].path).toContain("dispatch"); await capture("desktop-depart-confirmed.png");
  });
  it("la caisse voit l’affectation sans annuaire ni contrôle de réaffectation", async () => {
    await openBo("caisse");
    expect(await page.getByRole("combobox").count()).toBe(0); expect(reads).not.toContain("/api/delivery/operators");
    await page.getByRole("button", { name: "Confirmer le départ", exact: true }).click();
    await page.getByText("Départ confirmé. La commande est en route.", { exact: true }).waitFor(); expect(posts).toHaveLength(1);
    await capture("mobile-bo-depart-confirmed.png");
  });
  it("BO : annuaire paginé et lien explicite vers la création d’accès, sans envoyer avant le choix", async () => {
    missions[0] = { ...initial, operator: null, assignmentId: null, assignedAt: null, canDispatch: false }; directoryPaged = true;
    await openBo(); expect(await page.getByRole("link", { name: "Gérer les accès livreur" }).getAttribute("href")).toBe("/admin/livraison");
    await page.getByRole("button", { name: "Charger plus de livreurs" }).click();
    await page.getByLabel("Choisir un livreur", { exact: true }).selectOption(operatorId); expect(posts).toEqual([]);
    await page.getByRole("button", { name: "Confirmer l’affectation", exact: true }).click();
    await page.getByText("Affectation vérifiée.", { exact: false }).waitFor(); expect(posts[0].body).toMatchObject({ operatorId, expectedOperatorRevision: 1 });
  });
  it("BO : changement de personne pendant recovery 409 ne clôture pas son journal et ne repeint pas les anciennes coordonnées", async () => {
    await openBo(); changedOnce = true;
    await page.getByRole("button", { name: "Confirmer le départ", exact: true }).click();
    await expect.poll(() => Boolean(heldRead)).toBe(true);
    await page.evaluate(value => { localStorage.setItem("sm.token.resto", value); window.dispatchEvent(new StorageEvent("storage", { key: "sm.token.resto" })); }, token("owner", "f".repeat(24)));
    await page.getByRole("alert").filter({ hasText: "La session a changé" }).waitFor();
    heldRead!.response.end(JSON.stringify(heldRead!.mission)); heldRead = null;
    await page.waitForFunction(() => !document.querySelector('[aria-busy="true"]'));
    expect(await page.locator("body").innerText()).not.toContain("rue de la");
    expect(await page.evaluate(() => sessionStorage.length)).toBe(1); expect(posts).toHaveLength(1);
  });
  it("BO : un refus durable retire seulement l’intention et reste un avertissement", async () => {
    await openBo(); refuseNext = true;
    await page.getByRole("button", { name: "Confirmer le départ", exact: true }).click();
    const warning = page.getByRole("alert").filter({ hasText: "L’accès ou l’affectation du livreur a changé" }); await warning.waitFor();
    expect(await warning.getAttribute("class")).toContain("text-prept"); expect(await page.evaluate(() => sessionStorage.length)).toBe(0);
    expect(await page.getByRole("dialog").innerText()).not.toContain("Départ confirmé.");
  });
});
