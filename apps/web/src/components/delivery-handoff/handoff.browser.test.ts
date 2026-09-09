import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer, type Server, type ServerResponse } from "node:http";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { DeliveryHandoffState, DeliveryHandoffResult, DeliveryHandoffResolve } from "@sm/contracts";

const id = "d".repeat(24), operatorId = "b".repeat(24), tenantId = "a".repeat(24);
const proofId = "00000000-0000-4000-8000-000000000001", clientId = "00000000-0000-4000-8000-000000000002";
const secret = "a".repeat(64), qrToken = "b".repeat(43);
const base: DeliveryHandoffState = { missionId: id, revision: 1, missionRevision: 3, orderStatus: "ready",
  proof: { id: proofId, expiresAt: "2030-09-07T15:00:00.000Z", locked: false }, incident: null, canHandoff: true, canOverride: false, canRotate: true };
type Post = { path: string; body: Record<string, unknown> };
let server: Server, browser: Browser, context: BrowserContext, page: Page, origin: string;
let state: DeliveryHandoffState, posts: Post[], faults: string[], loss: boolean, hold: boolean, revoked: boolean, missing: boolean;
let held: { response: ServerResponse; result: unknown } | null;
let receipts: Map<string, DeliveryHandoffResult>;
let evidence: string | null = null;
let holdProof = false, recoveryFault = "";
const tracking = { _id: id, number: 12, status: "new", fulfillment: "delivery", payment: { method: "online", status: "pending", refundedCents: 0, pendingRefundCents: 0 } };

beforeAll(async () => {
  const root = fileURLToPath(new URL(".", import.meta.url));
  const cssPath = fileURLToPath(new URL("../../app/globals.css", import.meta.url));
  const [bundle, css] = await Promise.all([
    build({ stdin: { contents: `import React from 'react';import {createRoot} from 'react-dom/client';
      import {DeliveryHandoffPanel} from './Panel'; import {DeliveryHandoffRecoveries} from './Recoveries';
      import {CustomerDeliveryProof} from '../order/CustomerDeliveryProof'; import {marqueDeRepli} from '@sm/contracts';import {styleDuMasque} from '../masque/styleDuMasque';
      import {Tracking} from '../order/Tracking';
      import QRCode from 'qrcode';
      let scanCanvas,scanStream;
      window.__handoffFixtureQr=async raw=>{if(!scanCanvas){scanCanvas=document.createElement('canvas');navigator.mediaDevices.getUserMedia=async()=>{scanStream=scanCanvas.captureStream(0);const timer=setInterval(()=>{if(scanStream.getTracks().every(track=>track.readyState==='ended'))clearInterval(timer);else {const ctx=scanCanvas.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,1,1);scanStream.getVideoTracks().forEach(track=>track.requestFrame?.());}},50);return scanStream;};}await QRCode.toCanvas(scanCanvas,raw,{width:400,margin:4});scanStream?.getVideoTracks().forEach(track=>track.requestFrame?.());};
      window.__handoffFixtureTracks=()=>scanStream?.getTracks().map(track=>track.readyState)??[];
      const manager=location.pathname==='/manager',customer=location.pathname==='/customer';
      const scope=manager?'bo:${tenantId}:user:${operatorId}':'driver:recette:${operatorId}';
      createRoot(document.getElementById('root')).render(<React.StrictMode><main style={customer?styleDuMasque(marqueDeRepli(null,null)):undefined} className="min-h-dvh bg-bg text-ink p-4"><div className="mx-auto max-w-[460px]">
      <h1 className="text-2xl font-semibold">{customer?'Suivi de commande':'Mission n°12'}</h1>
      {location.pathname==='/tracking'?<Tracking orderId='${id}' trackingToken='tracking-fixture' initial={${JSON.stringify(tracking)}} brand={marqueDeRepli(null,null)} ticket={{type:'delivery',header:{slug:'recette',tenantName:'Restaurant de recette',phones:[]},lines:[],totals:{total:1500},payment:{paid:false}}}/>
      :customer?<CustomerDeliveryProof orderId='${id}' tenant='recette' ready={new URLSearchParams(location.search).get('ready')!=='0'} finished={false}/>
      :location.pathname==='/recovery'?<DeliveryHandoffRecoveries scope={scope} available selectedMission={null} onRevoked={()=>{document.title='Access revoked'}}/>
      :<DeliveryHandoffPanel missionId='${id}' scope={scope} path='/handoff' available manager={manager} onRevoked={()=>{document.title='Access revoked'}}/>}
      </div></main></React.StrictMode>);`, resolveDir: root, sourcefile: "handoff-fixture.tsx", loader: "tsx" },
    outdir: "/virtual-handoff-fixture", bundle: true, write: false, format: "esm", platform: "browser", target: "es2022", jsx: "automatic",
    // Only the external provider boundary is substituted: Tracking, recovery,
    // IndexedDB and HTTP execute unchanged. No Stripe SDK/payment is exercised.
    plugins: [{ name: "stripe-boundary", setup(builder) {
      builder.onResolve({ filter: /\/StripeCard$/ }, () => ({ path: "StripeCard", namespace: "stripe-fixture" }));
      builder.onLoad({ filter: /.*/, namespace: "stripe-fixture" }, () => ({ contents: `import React from 'react';export const apparenceStripeDe=()=>({});export function StripeCard({returnUrl}){return <output aria-label="Retour fournisseur" data-return={returnUrl}>Paiement fournisseur isolé</output>}`, loader: "tsx", resolveDir: root }));
      // next/font is transformed by Next at build time. This lightweight
      // renderer uses system fonts; font loading is not a claimed QA result.
      builder.onResolve({ filter: /^next\/font\/google$/ }, () => ({ path: "font", namespace: "font-fixture" }));
      builder.onLoad({ filter: /.*/, namespace: "font-fixture" }, () => ({ contents: `const font=()=>({variable:'',className:'',style:{fontFamily:'Arial'}});export {${["Alegreya_Sans", "Archivo", "Archivo_Black", "Bricolage_Grotesque", "Cormorant_Garamond", "Familjen_Grotesk", "Figtree", "Fraunces", "Instrument_Sans", "JetBrains_Mono", "Lato", "Libre_Baskerville", "Manrope", "Nunito", "Nunito_Sans", "Outfit", "Playfair_Display", "Source_Sans_3"].map(name => `font as ${name}`).join(",")}}` }));
    } }],
    define: { "process.env.NODE_ENV": '"production"', "process.env.NEXT_PUBLIC_API_URL": '"/api"' } }),
    readFile(cssPath, "utf8").then(source => postcss([tailwind({ base: fileURLToPath(new URL("../../..", import.meta.url)) })]).process(source, { from: cssPath })),
  ]);
  const js = bundle.outputFiles.find(file => file.path.endsWith(".js"))!.text;
  const styles = css.css + (bundle.outputFiles.find(file => file.path.endsWith(".css"))?.text ?? "");
  server = createServer(async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const path = new URL(req.url ?? "/", origin).pathname;
    if (path === "/bundle.js" || path === "/style.css") { res.setHeader("Content-Type", path.endsWith("js") ? "text/javascript" : "text/css"); res.end(path.endsWith("js") ? js : styles); return; }
    if (["/driver", "/manager", "/cashier", "/customer", "/recovery", "/tracking"].includes(path)) {
      res.setHeader("Content-Type", "text/html"); res.end('<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><title>Recette locale</title><link rel="stylesheet" href="/style.css"></head><body><div id="root"></div><script type="module" src="/bundle.js"></script></body></html>'); return;
    }
    res.setHeader("Content-Type", "application/json");
    const json = (value: unknown, status = 200) => res.writeHead(status).end(JSON.stringify(value));
    try {
      if (path === "/favicon.ico") { res.end("{}"); return; }
      if (req.method === "GET") {
        if (path === `/api/public/orders/${id}`) { json(tracking); return; }
        if (revoked) { json({ code: "ACCESS_UNAVAILABLE" }, 401); return; }
        if (missing) { json({ code: "MISSION_UNAVAILABLE" }, 404); return; }
        json(state); return;
      }
      const chunks: Buffer[] = []; for await (const chunk of req) chunks.push(Buffer.from(chunk));
      const body = JSON.parse(Buffer.concat(chunks).toString()) as Record<string, unknown>; posts.push({ path, body });
      if (path.endsWith("/orders/recovery")) {
        if (recoveryFault === "lost") { recoveryFault = ""; json({}, 503); return; }
        if (recoveryFault === "pending") { json({ state: "pending" }); return; }
        json({ state: "created", order: { _id: id, number: 12, status: "new", type: "delivery", trackingToken: recoveryFault === "wrong" ? "another-tracking" : "tracking-fixture",
          payment: { method: "online", status: "pending" }, totals: { total: 1500 }, pickup: { slot: "2026-09-07T16:00:00.000Z" } } }); return;
      }
      if (path.endsWith("/payment-intent")) { json({ clientSecret: "provider-fixture", publishableKey: "provider-fixture", amount: 1500 }); return; }
      if (path.endsWith("/delivery-proof")) {
        if (body.clientId !== clientId || body.recoveryProof !== secret) { json({}, 404); return; }
        const result = { missionId: id, proofId, pin: "654321", qr: `sm-handoff:v1:${id}:${proofId}:${qrToken}`, expiresAt: base.proof!.expiresAt };
        if (holdProof) { holdProof = false; held = { response: res, result }; return; }
        json(result); return;
      }
      const operation = body as DeliveryHandoffResolve;
      const prior = receipts.get(operation.operationId);
      if (prior) { json({ ...prior, replay: true, state }); return; }
      const action = path.endsWith("/confirm") ? "handoff" : path.endsWith("/incident") ? "incident" : path.endsWith("/override") ? "override" : path.endsWith("/rotate") ? "rotate" : operation.action;
      state = { ...state, revision: state.revision + 1 };
      let result: DeliveryHandoffResult;
      if (path.endsWith("/resolve")) result = { missionId: id, operationId: operation.operationId, action, appliedRevision: state.revision, replay: false, state, outcome: "abandoned", refusalCode: "abandoned" };
      else {
        const rejected = action === "handoff" && !["654321", `sm-handoff:v1:${id}:${proofId}:${qrToken}`].includes((body.proof as { value: string }).value);
        if (!rejected && ["handoff", "override"].includes(action)) state = { ...state, orderStatus: "delivered", canHandoff: false, canOverride: false, canRotate: false };
        if (action === "incident") state = { ...state, incident: { code: "customer_absent", reportedAt: "2026-09-07T13:00:00.000Z" }, canOverride: true };
        if (action === "rotate") state = { ...state, incident: null, canOverride: false };
        const common = { missionId: id, operationId: operation.operationId, action, appliedRevision: state.revision, replay: false, state };
        result = rejected ? { ...common, outcome: "rejected", refusalCode: "proof_incorrect" } : { ...common, outcome: "applied", refusalCode: null };
      }
      receipts.set(operation.operationId, result);
      if (hold) { hold = false; held = { response: res, result }; return; }
      if (loss) { loss = false; json({ code: "SERVICE_UNAVAILABLE" }, 503); return; }
      json(result);
    } catch { json({}, 500); }
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); if (!address || typeof address === "string") throw new Error("No local port"); origin = `http://127.0.0.1:${address.port}`;
  browser = await chromium.launch({ headless: true });
  if (process.env.QA_HANDOFF_CAPTURE === "1") { evidence = await mkdtemp(join(tmpdir(), "sm-handoff-ui-")); process.stdout.write(`Handoff fixture screenshots: ${evidence}\n`); }
}, 30_000);
beforeEach(async () => {
  state = structuredClone(base); posts = []; faults = []; loss = false; hold = false; revoked = false; missing = false; held = null; receipts = new Map(); holdProof = false; recoveryFault = "";
  context = await browser.newContext({ viewport: { width: 320, height: 780 }, reducedMotion: "reduce", serviceWorkers: "block" });
  await context.route("**/*", route => {
    if (new URL(route.request().url()).origin === origin) return route.continue();
    faults.push("Unexpected external request"); return route.abort();
  });
  page = await context.newPage(); page.setDefaultTimeout(4_000); page.on("pageerror", error => faults.push(error.name));
});
afterEach(async () => { held?.response.destroy(); await context?.close(); expect(faults).toEqual([]); });
afterAll(async () => { await browser?.close(); if (server) await new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()); }); });
const open = async (path = "/driver") => { await page.goto(origin + path); await page.getByLabel("Code de remise à six chiffres").waitFor(); };
const confirm = async (pin = "654321") => { await page.getByLabel("Code de remise à six chiffres").fill(pin); await page.getByRole("button", { name: "Confirmer la remise au client", exact: true }).click(); };
const stored = () => page.evaluate(() => Object.values(sessionStorage).join(""));

describe("remise livraison rendue, navigateur et stockage natifs", () => {
  it("code confirmé, clavier, pas de double POST ni secret persistant et aucun débordement à 320px", async () => {
    await open(); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    if (evidence) await page.screenshot({ path: join(evidence, "driver-320.png"), fullPage: true });
    hold = true; await confirm(); await expect.poll(() => posts.length).toBe(1);
    expect(await stored()).not.toContain("654321"); expect(await stored()).not.toContain('"proof"');
    await page.keyboard.press("Enter"); expect(posts).toHaveLength(1);
    held!.response.end(JSON.stringify(held!.result)); held = null;
    await page.getByText("Remise confirmée. La commande est livrée.").waitFor(); expect(await stored()).toBe("");
  });
  it("code incorrect terminal : avertissement, nouvelle saisie explicite, UUID différent", async () => {
    await open(); await confirm("111111"); await page.getByRole("alert").filter({ hasText: "ne correspond pas" }).waitFor();
    expect(await stored()).toBe(""); expect(await page.getByLabel("Code de remise à six chiffres").inputValue()).toBe("");
    await confirm(); await page.getByText("Remise confirmée. La commande est livrée.").waitFor();
    expect(posts[0].body.operationId).not.toBe(posts[1].body.operationId);
  });
  it("réponse perdue puis mission disparue : reprise dédiée sans PIN et même opération", async () => {
    await open(); loss = true; await confirm(); await page.getByRole("button", { name: "Vérifier cette action" }).waitFor();
    const first = posts[0]; missing = true;
    await page.goto(origin + "/recovery"); await page.getByRole("button", { name: "Vérifier la remise en attente 1" }).click();
    await page.getByRole("button", { name: "Vérifier cette action" }).click();
    await page.getByText("Remise confirmée. La commande est livrée.").waitFor();
    expect(posts).toHaveLength(2); expect(posts[1].body.operationId).toBe(first.body.operationId); expect(posts[1].body).not.toHaveProperty("proof"); expect(await stored()).toBe("");
  });
  it("incident puis exception motivée côté gérant, sans faux paiement ni livraison à l’incident", async () => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await open("/manager"); expect(await page.getByRole("button", { name: "Remise exceptionnelle", exact: true }).count()).toBe(0);
    await page.getByRole("button", { name: "Signaler un incident" }).click(); await page.getByRole("button", { name: "Enregistrer l’incident" }).click();
    await page.getByText("Incident enregistré.", { exact: false }).waitFor(); expect(state.orderStatus).toBe("ready");
    await page.getByRole("button", { name: "Remise exceptionnelle", exact: true }).click();
    if (evidence) await page.screenshot({ path: join(evidence, "manager-exception-desktop.png"), fullPage: true });
    expect(await page.getByRole("button", { name: "Confirmer la remise exceptionnelle" }).isDisabled()).toBe(true);
    await page.getByLabel("Motif de votre décision (10 caractères minimum)").fill("Remise vérifiée avec le responsable");
    await page.getByRole("button", { name: "Confirmer la remise exceptionnelle" }).click(); await page.getByText("Remise confirmée. La commande est livrée.").waitFor();
    expect(await stored()).not.toContain("responsable");
  });
  it("caisse sans exception, caméra refusée avec retour PIN, stockage refusé sans POST", async () => {
    state.canOverride = true; await open("/cashier"); expect(await page.getByRole("button", { name: "Remise exceptionnelle", exact: true }).count()).toBe(0);
    await page.evaluate(() => { navigator.mediaDevices.getUserMedia = async () => { throw new DOMException("Denied", "NotAllowedError"); }; });
    await page.getByRole("button", { name: "Scanner le QR du client" }).click();
    await page.getByText("La caméra n’est pas disponible.", { exact: false }).waitFor();
    await page.getByRole("button", { name: "Revenir au code à six chiffres" }).click();
    await page.evaluate(() => { Storage.prototype.setItem = () => { throw new DOMException("Denied", "QuotaExceededError"); }; });
    await confirm(); await page.getByText("Aucun nouvel envoi n’a été transmis.", { exact: false }).waitFor(); expect(posts).toEqual([]);
  });
  it("décode un vrai QR sur flux vidéo synthétique : mauvais ordre refusé puis confirmation explicite et caméra arrêtée", async () => {
    await open();
    const draw = (raw: string) => page.evaluate(raw => (window as unknown as { __handoffFixtureQr: (value: string) => Promise<void> }).__handoffFixtureQr(raw), raw);
    await draw(`sm-handoff:v1:${"e".repeat(24)}:${proofId}:${qrToken}`);
    await page.getByRole("button", { name: "Scanner le QR du client" }).click();
    try { await page.getByText("Ce QR ne correspond pas", { exact: false }).waitFor({ timeout: 6_000 }); }
    catch { throw new Error(JSON.stringify(await page.evaluate(() => { const video = document.querySelector("video"); return { video: video && { width: video.videoWidth, height: video.videoHeight, ready: video.readyState, paused: video.paused }, tracks: (window as unknown as { __handoffFixtureTracks: () => string[] }).__handoffFixtureTracks() }; }))); }
    expect(posts).toEqual([]);
    await draw(`sm-handoff:v1:${id}:${proofId}:${qrToken}`);
    await page.getByText("QR reconnu.", { exact: false }).waitFor({ timeout: 6_000 }); expect(posts).toEqual([]);
    expect(await page.evaluate(() => (window as unknown as { __handoffFixtureTracks: () => string[] }).__handoffFixtureTracks())).toEqual(["ended"]);
    await page.getByRole("button", { name: "Confirmer la remise au client", exact: true }).click(); await page.getByText("Remise confirmée. La commande est livrée.").waitFor();
    expect(posts[0].body.proof).toMatchObject({ kind: "qr" }); expect(await stored()).toBe("");
  }, 15_000);
  it("client : fragment conservé avant départ, import validé puis reload sans fragment, PIN jamais dans IDB", async () => {
    await page.goto(`${origin}/customer?ready=0#remise=v1.${clientId}.${secret}`);
    await page.getByText("Le code devient disponible", { exact: false }).waitFor(); expect(posts).toEqual([]);
    expect(await page.evaluate(() => Boolean(location.hash))).toBe(true);
    await page.goto(`${origin}/customer#remise=v1.${clientId}.${secret}`);
    await page.getByRole("button", { name: "Afficher mon code de remise" }).click();
    await page.getByAltText("QR privé à présenter au livreur").waitFor();
    expect(await page.evaluate(() => location.hash)).toBe("");
    expect(posts[0].body).toEqual({ clientId, recoveryProof: secret });
    await page.reload(); await page.getByRole("button", { name: "Afficher mon code de remise" }).click(); await page.getByAltText("QR privé à présenter au livreur").waitFor();
    expect(posts).toHaveLength(2); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
  it("import expiré : garde le fragment sur refus durable, aucun ancien reçu n’est prolongé", async () => {
    const url = `${origin}/customer#remise=v1.${clientId}.${secret}`;
    await page.goto(url); await page.getByRole("button", { name: "Afficher mon code de remise" }).click(); await page.getByAltText("QR privé à présenter au livreur").waitFor();
    await page.clock.install({ time: Date.now() + 8 * 86_400_000 });
    await page.goto(url); await page.getByRole("button", { name: "Afficher mon code de remise" }).click();
    await page.getByText("Cet accès privé n’a pas pu être sauvegardé.", { exact: false }).waitFor();
    expect(await page.evaluate(() => Boolean(location.hash))).toBe(true); expect(await page.getByAltText("QR privé à présenter au livreur").count()).toBe(0);
  });
  it.each(["hidden", "offline"])("ne révèle pas un code dont la réponse arrive après %s", async (mode) => {
    await page.goto(`${origin}/customer#remise=v1.${clientId}.${secret}`); holdProof = true;
    await page.getByRole("button", { name: "Afficher mon code de remise" }).click(); await expect.poll(() => Boolean(held)).toBe(true);
    await page.evaluate(mode => {
      if (mode === "hidden") { Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" }); document.dispatchEvent(new Event("visibilitychange")); }
      else { Object.defineProperty(navigator, "onLine", { configurable: true, value: false }); window.dispatchEvent(new Event("offline")); }
    }, mode);
    held!.response.end(JSON.stringify(held!.result)); held = null;
    // Losing visibility/connectivity now also clears the capability in memory.
    // A fresh visible read may restore the button, never the old response/PIN.
    await page.evaluate(mode => {
      if (mode === "hidden") { Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" }); document.dispatchEvent(new Event("visibilitychange")); }
      else { Object.defineProperty(navigator, "onLine", { configurable: true, value: true }); window.dispatchEvent(new Event("online")); }
    }, mode);
    await expect.poll(() => page.getByRole("button", { name: "Afficher mon code de remise" }).isDisabled()).toBe(false);
    expect(await page.getByAltText("QR privé à présenter au livreur").count()).toBe(0); expect(await page.evaluate(() => Boolean(location.hash))).toBe(true);
  });
  it("reprend explicitement C01 avant Stripe, conserve l’accès au retour et ne transmet jamais le fragment au fournisseur", async () => {
    await page.goto(`${origin}/tracking#remise=v1.${clientId}.${secret}`);
    await page.getByRole("button", { name: "Reprendre le paiement" }).waitFor(); expect(posts).toEqual([]);
    await page.getByRole("button", { name: "Reprendre le paiement" }).click(); await page.getByLabel("Retour fournisseur").waitFor();
    expect(posts.map(post => post.path)).toEqual(["/api/public/tenants/recette/orders/recovery", `/api/public/orders/${id}/payment-intent`]);
    expect(posts[0].body).toEqual({ clientId, recoveryProof: secret });
    const url = await page.getByLabel("Retour fournisseur").getAttribute("data-return");
    expect(url).toBe(`${origin}/t/${id}?t=tracking-fixture`); expect(url).not.toContain(secret);
    expect(await page.evaluate(() => location.hash)).toBe("");
    await page.goto(origin + "/customer"); await page.getByRole("button", { name: "Afficher mon code de remise" }).click(); await page.getByAltText("QR privé à présenter au livreur").waitFor();
  });
  it.each(["wrong", "pending", "lost"])("refuse Stripe et conserve le fragment si l’attestation C01 est %s", async fault => {
    recoveryFault = fault; await page.goto(`${origin}/tracking#remise=v1.${clientId}.${secret}`);
    await page.getByRole("button", { name: "Reprendre le paiement" }).click(); await page.getByText("Votre accès privé de livraison doit être sauvegardé", { exact: false }).waitFor();
    expect(posts).toHaveLength(1); expect(posts[0].path).toMatch(/\/recovery$/); expect(await page.evaluate(() => Boolean(location.hash))).toBe(true);
    if (fault === "lost") {
      await page.getByRole("button", { name: "Reprendre le paiement" }).click(); await page.getByLabel("Retour fournisseur").waitFor();
      expect(posts[1].body).toEqual(posts[0].body); expect(posts[1].path).toBe(posts[0].path);
    }
  });
  it("un simple lien de suivi ne donne aucun code client et ne déclenche aucun appel proof", async () => {
    await page.goto(origin + "/customer?t=public-tracking-fixture"); await page.getByText("Ce navigateur ne possède pas l’accès privé", { exact: false }).waitFor();
    expect(posts).toEqual([]); expect(await page.getByAltText("QR privé à présenter au livreur").count()).toBe(0);
  });
  it("révocation efface la vue de remise et interdit le geste", async () => {
    await open(); revoked = true; await page.getByRole("button", { name: "Actualiser la remise" }).click();
    await expect.poll(() => page.title()).toBe("Access revoked"); expect(await page.getByLabel("Code de remise à six chiffres").count()).toBe(0); expect(posts).toEqual([]);
  });
});
