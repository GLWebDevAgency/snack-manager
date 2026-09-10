import { createServer, type Server } from 'node:http';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import postcss from 'postcss';
import tailwind from '@tailwindcss/postcss';
import { chromium, type Browser, type BrowserContext, type Page, type CDPSession, type Request as BrowserRequest } from 'playwright';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { seedCustomerBrowserFixture } from './browser-journal.fixture';

// Real Entry, hook, private transport, IndexedDB selector and Web Locks.
// Only server data is simulated; this does not claim Next/BFF/Nest/SQL coverage.
let server: Server, browser: Browser, context: BrowserContext, page: Page, origin: string;
let faults: string[], calls: Record<string, unknown>[], expiry: number, registered: boolean, name: string | null;
let outcome: 'normal' | 'terms' | 'collision' | 'unavailable' | 'refused' | 'lost' | 'held', release: (() => void) | null;
let version: number, captures: string;
let failures: { request: BrowserRequest; error: string | undefined; closing: boolean }[], discardedErrors: Set<BrowserRequest>;
let inflight: Set<BrowserRequest>, closing: boolean, sequence: number, session: CDPSession;
type ReadMark = { id: string; event: string; bytes?: number };
type Failure = { request: BrowserRequest; error: string | undefined; closing: boolean };
type Wire = { request: BrowserRequest; id: string; status: number; bytes: number; mime: string };
type Selection = { browserRef: string; operationId: string; checkId: string };
type IdentityRefusal = { before: Selection; after: Selection; current: Selection; profileAfterEof: boolean;
  profileRequest: BrowserRequest; privateSections: number; balances: number; qrImages: number };
type DisposedResponse = { heldRequest: BrowserRequest; phases: string[]; sectionRemovedBeforeRelease: boolean;
  sectionStillRemovedAfterEof: boolean; profileAfterEof: boolean; privateSections: number; balances: number; qrImages: number };
const paths = { caps: '/r/recette/compte/capacites', session: '/r/recette/compte/session', loyalty: '/r/recette/compte/fidelite' };
let marks: ReadMark[], wires: Map<BrowserRequest, Wire>, rendered: Set<string>;
let expectedFailures: Set<BrowserRequest>, transportFault: 'none' | 'truncated' | 'invalid-json' | 'invalid-contract';
let identityRefusals: Map<BrowserRequest, IdentityRefusal>;
let disposedResponses: Map<BrowserRequest, DisposedResponse>;
/** A verified application result, not a claim about Chromium's internal cause
 * or CDP/Runtime event order. Missing proof always remains a test failure. */
function completeResponseRead(failure: Failure, wire: Wire | undefined, observed: ReadMark[]): boolean {
  if (!wire || wire.request !== failure.request || failure.error !== 'net::ERR_ABORTED'
    || wire.status !== 200 || !/^application\/json(?:;\s*charset=utf-8)?$/i.test(wire.mime)
    || !Number.isSafeInteger(wire.bytes) || wire.bytes <= 0 || wire.bytes > 49_152) return false;
  const path = new URL(failure.request.url()).pathname, method = failure.request.method();
  if (new URL(failure.request.url()).origin !== origin || !((path === paths.loyalty && method === 'POST')
    || ([paths.caps, paths.session].includes(path) && method === 'GET'))) return false;
  const own = observed.filter(mark => mark.id === wire.id), eof = own.filter(mark => mark.event === 'eof');
  return eof.length === 1 && eof[0]!.bytes === wire.bytes && own.some(mark => mark.event === 'json-valid')
    && own.some(mark => mark.event === 'contract-valid')
    && !own.some(mark => ['abort', 'cancel', 'read-rejected', 'json-invalid', 'contract-invalid'].includes(mark.event));
}
function completedApplicationRead(failure: Failure, wire: Wire | undefined, observed: ReadMark[], ui: ReadonlySet<string>): boolean {
  return !!wire && ui.has(wire.id) && completeResponseRead(failure, wire, observed);
}
/** Only the explicitly held view response in the leave-screen scenario. A
 * missing lifecycle/EOF/UI observation is not inferred from teardown timing. */
function rejectedAfterDisposal(failure: Failure, wire: Wire | undefined, observed: ReadMark[], proof: DisposedResponse | undefined): boolean {
  return !!wire && !!proof && proof.heldRequest === failure.request
    && failure.request.url() === `${origin}${paths.loyalty}` && failure.request.method() === 'POST'
    && failure.request.postData() === JSON.stringify({ step: 'view' })
    && proof.phases.join(',') === 'held,screen-left,released,eof,profile-visible'
    && proof.sectionRemovedBeforeRelease && proof.sectionStillRemovedAfterEof && proof.profileAfterEof
    && proof.privateSections === 0 && proof.balances === 0 && proof.qrImages === 0
    && completeResponseRead(failure, wire, observed)
    && observed.some(mark => mark.id === wire.id && mark.event === 'state-member');
}
function requestSelection(request: BrowserRequest): Selection {
  const headers = request.headers();
  return { browserRef: headers['x-sm-customer-browser-ref'] ?? '', operationId: headers['x-sm-customer-operation-id'] ?? '', checkId: headers['x-sm-customer-check-id'] ?? '' };
}
function rejectedForIdentity(failure: Failure, wire: Wire | undefined, observed: ReadMark[], proof: IdentityRefusal | undefined, allWires: ReadonlyMap<BrowserRequest, Wire>, ui: ReadonlySet<string>): boolean {
  if (!wire || !proof || new URL(failure.request.url()).pathname !== paths.loyalty || failure.request.method() !== 'POST'
    || !completeResponseRead(failure, wire, observed) || !proof.profileAfterEof
    || proof.privateSections !== 0 || proof.balances !== 0 || proof.qrImages !== 0) return false;
  const same = (a: Selection, b: Selection) => a.browserRef === b.browserRef && a.operationId === b.operationId && a.checkId === b.checkId;
  const valid = (value: Selection) => [value.browserRef, value.operationId, value.checkId].every(part => /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(part));
  const profileWire = allWires.get(proof.profileRequest);
  return [proof.before, proof.after, proof.current].every(valid)
    && same(requestSelection(failure.request), proof.before) && !same(proof.before, proof.after)
    && same(proof.after, proof.current) && same(requestSelection(proof.profileRequest), proof.current)
    && new URL(proof.profileRequest.url()).pathname === paths.session
    && !!profileWire && completedApplicationRead({ request: proof.profileRequest, error: 'net::ERR_ABORTED', closing: false }, profileWire, observed, ui);
}
declare global { interface Window { loyaltyFixtureRead: (metadata: string) => void; validateLoyaltyFixture: (value: unknown, path: string, body: unknown) => boolean;
  prepareLoyaltyCamera: (value: string, held: boolean) => Promise<void>; releaseLoyaltyCamera: () => void;
  loyaltyCameraRequested: boolean; loyaltyCameraTracks: () => string[] } }
const program = () => ({ id: '50000000-0000-4000-8000-000000000005', version, name: 'Les habitués du Comptoir', mechanism: 'points',
  termsSummary: 'Cumulez vos points au comptoir. Récompenses selon les conditions du restaurant.', unitLabelSingular: 'point', unitLabelPlural: 'points' });
const member = { id: '60000000-0000-4000-8000-000000000006', joinedAt: '2026-09-09T12:00:00.000Z', qrGeneration: 1, balanceUnits: 25, unitLabelSingular: 'point', unitLabelPlural: 'points' };
beforeAll(async () => {
  const root = fileURLToPath(new URL('.', import.meta.url)), cssPath = fileURLToPath(new URL('../../app/globals.css', import.meta.url));
  const bundle = await build({ stdin: { contents: `import React from 'react';import{createRoot}from'react-dom/client';import{CustomerAccountEntry}from'./CustomerAccountEntry';import{marqueDeRepli}from'@sm/contracts';import{styleDuMasque}from'../masque/styleDuMasque';
    import{CustomerLoyaltyResponseSchema,CustomerLoyaltyRequestSchema,CustomerAccountResponses,CustomerAccountViewSchema}from'@sm/contracts';import QRCode from'qrcode';
    let cameraStream;window.loyaltyCameraRequested=false;window.loyaltyCameraTracks=()=>cameraStream?.getTracks().map(track=>track.readyState)??[];
    window.prepareLoyaltyCamera=async(value,held)=>{const canvas=document.createElement('canvas');await QRCode.toCanvas(canvas,value,{width:400,margin:4});
      navigator.mediaDevices.getUserMedia=()=>new Promise(resolve=>{window.loyaltyCameraRequested=true;
        const start=()=>{cameraStream=canvas.captureStream(0);const timer=setInterval(()=>{if(cameraStream.getTracks().every(track=>track.readyState==='ended'))clearInterval(timer);
          else{const ctx=canvas.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,1,1);cameraStream.getVideoTracks().forEach(track=>track.requestFrame?.());}},50);resolve(cameraStream);};
        if(held)window.releaseLoyaltyCamera=start;else start();});};
    window.validateLoyaltyFixture=(value,path,body)=>{if(path==='/r/recette/compte/capacites')return CustomerAccountResponses.status.safeParse(value).success;
      if(path==='/r/recette/compte/session')return CustomerAccountViewSchema.safeParse(value).success;
      if(path!=='/r/recette/compte/fidelite')return false;
      const input=CustomerLoyaltyRequestSchema.safeParse(body),output=CustomerLoyaltyResponseSchema.safeParse(value);
      return input.success&&output.success&&(output.data.state!=='card'||input.data.step==='card');};
    createRoot(document.getElementById('root')).render(<React.StrictMode><main style={styleDuMasque(marqueDeRepli(null,null))} className="min-h-dvh bg-bg p-4 text-ink"><h1>Le Comptoir</h1><CustomerAccountEntry slug="recette" restaurantName="Le Comptoir"/><button>Commander en invité</button></main></React.StrictMode>);`,
    resolveDir: root, sourcefile: 'customer-loyalty-ui.tsx', loader: 'tsx' }, bundle: true, write: false, format: 'esm', platform: 'browser', jsx: 'automatic', target: 'es2022', outdir: '/virtual-loyalty', define: { 'process.env': '{}', 'process.env.NODE_ENV': '"production"' } });
  const css = await postcss([tailwind({ base: fileURLToPath(new URL('../../..', import.meta.url)) })]).process(await readFile(cssPath, 'utf8'), { from: cssPath });
  server = createServer((req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self'; frame-src 'none'; form-action 'none'; base-uri 'none'");
    const json = (value: unknown, status = 200) => { const body = JSON.stringify(value); res.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body), 'x-sm-fixture-request-id': String(++sequence) }); res.end(body); };
    if (req.url === '/app.js' && req.method === 'GET') { res.setHeader('content-type', 'text/javascript'); res.end(bundle.outputFiles.find(file => file.path.endsWith('.js'))!.text); return; }
    if (req.url === '/style.css' && req.method === 'GET') { res.setHeader('content-type', 'text/css'); res.end(css.css); return; }
    if (req.url === '/favicon.ico') { res.writeHead(204).end(); return; }
    if (req.url === '/' && req.method === 'GET') { res.setHeader('content-type', 'text/html'); res.end('<!doctype html><html lang="fr"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Account loyalty fixture</title><link rel="stylesheet" href="/style.css"><div id="root"></div><script type="module" src="/app.js"></script></html>'); return; }
    if (req.url === '/r/recette/compte/capacites' && req.method === 'GET') { json({ available: false }); return; }
    if (req.url === '/r/recette/compte/session' && req.method === 'GET') { json({ expiresAt: expiry, profile: { name, phoneE164: '+33600000000', phoneVerifiedAt: 1_700_000_000_000, revision: 0 } }); return; }
    if (req.url !== '/r/recette/compte/fidelite' || req.method !== 'POST') { faults.push(`Unexpected fixture request ${req.method} ${req.url}`); res.writeHead(404).end(); return; }
    let body = ''; req.on('data', chunk => { body += String(chunk); if (body.length > 4096) req.destroy(); });
    req.on('end', () => {
      const input = JSON.parse(body) as Record<string, unknown>; calls.push(input);
      if (!req.headers['x-sm-customer-operation-id'] || !req.headers['x-sm-customer-check-id'] || !req.headers['x-sm-customer-browser-ref']) { json({}, 401); return; }
      const finish = () => {
        if (input.step === 'card' && transportFault !== 'none') {
          const body = transportFault === 'invalid-json' ? '{invalid' : JSON.stringify({ state: 'card', member, expiresAt: expiry, qrToken: 'invalid' });
          res.writeHead(200, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body), 'x-sm-fixture-request-id': String(++sequence) });
          if (transportFault === 'truncated') { res.write(body.slice(0, 12)); setTimeout(() => res.destroy(), 20); } else res.end(body);
          return;
        }
        // Simulated relay failure AFTER the isolated writer committed. Empty
        // error body: the production transport intentionally discards errors.
        if ((input.step === 'join' || input.step === 'attach') && outcome === 'lost') { registered = true; outcome = 'normal'; res.writeHead(503, { 'x-sm-fixture-fault': `${input.step}-committed-relay-failure` }).end(); return; }
        if ((input.step === 'join' || input.step === 'attach') && outcome === 'terms') { outcome = 'normal'; version++; json({ state: 'terms_changed', expiresAt: expiry, program: program(), profileReady: !!name }); return; }
        if (outcome === 'refused') { json({ state: 'attachment_refused', expiresAt: expiry }); return; }
        if (outcome === 'collision' || outcome === 'unavailable') { json({ state: outcome === 'collision' ? 'existing_card' : 'unavailable', expiresAt: expiry }); return; }
        if (input.step === 'join' || input.step === 'attach') registered = true;
        if (registered) { json({ state: input.step === 'card' ? 'card' : 'member', member, expiresAt: expiry, ...(input.step === 'card' ? { qrToken: 'A'.repeat(43) } : {}) }); return; }
        json({ state: 'available', expiresAt: expiry, program: program(), profileReady: !!name });
      };
      if (outcome === 'held') release = finish; else finish();
    });
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('Fixture port absent'); origin = `http://127.0.0.1:${address.port}`;
  browser = await chromium.launch({ headless: true }); captures = await mkdtemp(join(tmpdir(), 'sm-account-loyalty-ui-'));
  process.stdout.write(`Loyalty UI captures: ${captures}\n`);
}, 30_000);
beforeEach(async () => {
  faults = []; calls = []; expiry = Date.now() + 60_000; registered = false; name = 'Camille Recette'; outcome = 'normal'; release = null; version = 1;
  failures = []; discardedErrors = new Set();
  expectedFailures = new Set(); transportFault = 'none';
  identityRefusals = new Map();
  disposedResponses = new Map();
  inflight = new Set(); closing = false; sequence = 0; marks = []; wires = new Map(); rendered = new Set();
  context = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce', serviceWorkers: 'block' });
  page = await context.newPage(); page.setDefaultTimeout(5_000);
  session = await context.newCDPSession(page);
  session.on('Runtime.bindingCalled', event => { if (event.name === 'loyaltyFixtureRead') marks.push(JSON.parse(event.payload) as ReadMark); });
  await session.send('Runtime.enable'); await session.send('Runtime.addBinding', { name: 'loyaltyFixtureRead' });
  await page.addInitScript(() => {
    const fetch = window.fetch.bind(window);
    window.fetch = async (...args) => {
      const response = await fetch(...args), id = response.headers.get('x-sm-fixture-request-id');
      if (id && response.body) {
        const mark = (event: string, bytes?: number) => window.loyaltyFixtureRead(JSON.stringify({ id, event, ...(bytes === undefined ? {} : { bytes }) }));
        if (args[1]?.signal?.aborted) mark('abort');
        args[1]?.signal?.addEventListener('abort', () => mark('abort'), { once: true });
        const bodyCancel = response.body.cancel.bind(response.body);
        Object.defineProperty(response.body, 'cancel', { value: (reason?: unknown) => { mark('cancel'); return bodyCancel(reason); } });
        const getReader = response.body.getReader.bind(response.body);
        Object.defineProperty(response.body, 'getReader', { value: () => {
          const reader = getReader() as ReadableStreamDefaultReader<Uint8Array>, read = reader.read.bind(reader), cancel = reader.cancel.bind(reader);
          const decoder = new TextDecoder('utf-8', { fatal: true }); let text = '', bytes = 0, invalid = false;
          reader.read = () => {
            const pending = read();
            void pending.then(chunk => {
              bytes += chunk.value?.byteLength ?? 0;
              if (chunk.done) {
                mark('eof', bytes);
                try { if (invalid) throw new Error('Invalid fixture body'); const parsed = JSON.parse(text + decoder.decode());
                  mark('json-valid');
                  const valid = window.validateLoyaltyFixture(parsed, new URL(response.url).pathname,
                    typeof args[1]?.body === 'string' ? JSON.parse(args[1].body) : undefined);
                  mark(valid ? 'contract-valid' : 'contract-invalid');
                  if (valid && typeof parsed.state === 'string') mark(`state-${parsed.state}`); }
                catch { mark('json-invalid'); } text = '';
              } else if (!invalid) {
                try { if (bytes > 49_152) throw new Error('Oversize fixture body'); text += decoder.decode(chunk.value, { stream: true }); }
                catch { invalid = true; text = ''; }
              }
            }, () => mark('read-rejected'));
            return pending;
          };
          reader.cancel = reason => { mark('cancel'); return cancel(reason); }; return reader;
        } });
      }
      return response;
    };
  });
  page.on('request', request => { inflight.add(request); if (new URL(request.url()).origin !== origin) faults.push('External fixture request'); });
  page.on('requestfinished', request => inflight.delete(request));
  page.on('pageerror', error => faults.push(error.message));
  page.on('console', message => { if (!['warning', 'error'].includes(message.type())) return;
    if (message.location().url === `${origin}/r/recette/compte/fidelite` && /Failed to load resource.*503/.test(message.text())) return;
    if (transportFault === 'truncated' && message.location().url === `${origin}${paths.loyalty}` && message.text().startsWith('Failed to load resource: net::')) return;
    faults.push(`Unexpected ${message.type()}: ${message.text()}`); });
  page.on('response', response => {
    const request = response.request();
    const id = response.headers()['x-sm-fixture-request-id'];
    if (id) {
      if (!/^[1-9]\d{0,4}$/.test(id) || [...wires.values()].some(wire => wire.id === id)) faults.push('Ambiguous fixture response identity');
      wires.set(request, { request, id, status: response.status(), bytes: Number(response.headers()['content-length']), mime: response.headers()['content-type'] ?? '' });
    }
    // Exact controlled response, not a URL/status-only exemption. The shared
    // transport intentionally cancels every non-OK body before throwing.
    if (response.status() === 503 && response.headers()['x-sm-fixture-fault'] === `${calls[1]?.step}-committed-relay-failure`
      && request.method() === 'POST' && request.url() === `${origin}/r/recette/compte/fidelite`
      && request.postData() === JSON.stringify(calls[1]) && (calls[1]?.step === 'join' || calls[1]?.step === 'attach')) discardedErrors.add(request);
  });
  page.on('requestfailed', request => { inflight.delete(request); failures.push({ request, error: request.failure()?.errorText, closing }); });
  await page.goto(origin); await seedCustomerBrowserFixture(page, 'recette');
});
afterEach(async () => {
  release?.();
  try {
    await expect.poll(() => inflight.size, { timeout: 1000 }).toBe(0);
    await session.send('Runtime.evaluate', { expression: 'void 0' });
  } finally { closing = true; await context.close(); }
  const completed: { id: string; bytes: number }[] = [];
  const rejected: { id: string; bytes: number }[] = [];
  const disposed: { id: string; bytes: number }[] = [];
  for (const failure of failures) if (!(expectedFailures.has(failure.request) || (discardedErrors.has(failure.request) && failure.error === 'net::ERR_ABORTED'))) {
    const wire = wires.get(failure.request);
    if (completedApplicationRead(failure, wire, marks, rendered)) { completed.push({ id: wire!.id, bytes: wire!.bytes }); continue; }
    if (rejectedForIdentity(failure, wire, marks, identityRefusals.get(failure.request), wires, rendered)) { rejected.push({ id: wire!.id, bytes: wire!.bytes }); continue; }
    if (rejectedAfterDisposal(failure, wire, marks, disposedResponses.get(failure.request))) { disposed.push({ id: wire!.id, bytes: wire!.bytes }); continue; }
    faults.push(`Unexpected request failure ${failure.request.method()} ${new URL(failure.request.url()).pathname}: ${failure.error}`);
    console.info('Loyalty exact transport failure', { id: wire?.id, status: wire?.status, expectedBytes: wire?.bytes,
      closing: failure.closing, rendered: wire ? rendered.has(wire.id) : false, marks: marks.filter(mark => mark.id === wire?.id) });
  }
  if (completed.length) console.info('Chromium notifications despite exact complete JSON/contract/UI', completed);
  if (rejected.length) console.info('Chromium notifications with complete JSON/contract and exact identity rejection', rejected);
  if (disposed.length) console.info('Chromium notifications with complete JSON/contract and exact disposed-screen proof', disposed);
  expect(faults).toEqual([]);
});
afterAll(async () => { await browser?.close(); await new Promise<void>((resolve, reject) => server?.close(error => error ? reject(error) : resolve())); });
async function openLoyalty() {
  await page.getByRole('button', { name: 'Mon compte', exact: true }).click();
  await page.getByRole('textbox', { name: 'Votre prénom ou nom' }).waitFor();
  expect(await page.getByRole('textbox', { name: 'Votre prénom ou nom' }).inputValue()).toBe(name ?? '');
  expect(await page.getByRole('button', { name: 'Fidélité de mon compte', exact: true }).count()).toBe(1);
  expect(await page.getByRole('button', { name: 'Créer mon compte', exact: true }).count()).toBe(0);
  await markUI(paths.caps); await markUI(paths.session);
  await page.getByRole('button', { name: 'Fidélité de mon compte', exact: true }).click();
  await page.getByRole('heading', { name: 'Ma fidélité', exact: true }).waitFor();
  if (outcome !== 'held') await verifyLoyalty(outcome === 'collision' ? 'existing_card' : outcome === 'unavailable' ? 'unavailable' : registered ? 'member' : 'available');
}
/** Mark only the latest exact response after its expected DOM was asserted.
 * The step and response-state mark prevent an older same-URL render counting. */
async function markUI(path: string, state?: string) {
  await session.send('Runtime.evaluate', { expression: 'void 0' });
  const matches = [...wires.values()].filter(wire => new URL(wire.request.url()).pathname === path);
  const wire = matches.at(-1); expect(wire).toBeDefined(); expect(wire?.status).toBe(200);
  const own = marks.filter(mark => mark.id === wire!.id);
  expect(own.filter(mark => mark.event === 'eof')).toEqual([{ id: wire!.id, event: 'eof', bytes: wire!.bytes }]);
  expect(own.some(mark => mark.event === 'json-valid')).toBe(true);
  expect(own.some(mark => mark.event === 'contract-valid')).toBe(true);
  if (state) expect(own.some(mark => mark.event === `state-${state}`)).toBe(true);
  rendered.add(wire!.id);
}
async function verifyLoyalty(state: 'available' | 'terms_changed' | 'member' | 'card' | 'existing_card' | 'attachment_refused' | 'unavailable') {
  if (state === 'available' || state === 'terms_changed') {
    await page.getByText('Les habitués du Comptoir', { exact: true }).waitFor();
    if (name) await page.getByRole('checkbox').waitFor(); else await page.getByRole('button', { name: 'Compléter mon profil', exact: true }).waitFor();
    if (state === 'terms_changed') await page.getByText(/conditions ont changé/).waitFor();
  } else if (state === 'member' || state === 'card') {
    await page.getByText('25 points', { exact: true }).waitFor();
    if (state === 'card') await page.getByRole('img', { name: 'QR de votre carte fidélité' }).waitFor();
    else await page.getByRole('button', { name: 'Afficher ma carte', exact: true }).waitFor();
  } else await page.getByText(state === 'existing_card' ? /présentez votre carte existante/i : state === 'attachment_refused' ? /Cette carte ne peut pas être rattachée/ : /fidélité n’est pas disponible/).waitFor();
  await markUI(paths.loyalty, state);
}
async function accept() { await page.getByRole('checkbox').check(); await page.getByRole('button', { name: 'Créer ma carte gratuite', exact: true }).click(); }
async function openAttachment() {
  await openLoyalty(); await page.getByRole('button', { name: 'J’ai déjà une carte', exact: true }).click();
  await page.getByRole('heading', { name: 'Rattacher ma carte', exact: true }).waitFor();
}
async function attach() {
  await page.getByLabel('Code de votre carte', { exact: true }).fill('A'.repeat(43));
  await page.getByRole('checkbox').check(); await page.getByRole('button', { name: 'Rattacher cette carte', exact: true }).click();
}
async function privateQrPersisted() {
  return page.evaluate(async () => {
    const values: unknown[] = [Object.entries(localStorage), Object.entries(sessionStorage)];
    for (const { name } of await indexedDB.databases()) {
      if (!name) continue;
      const db = await new Promise<IDBDatabase>((resolve, reject) => { const open = indexedDB.open(name); open.onsuccess = () => resolve(open.result); open.onerror = () => reject(new Error('Fixture storage read failed')); });
      try { for (const name of db.objectStoreNames) values.push(await new Promise<unknown>((resolve, reject) => {
        const tx = db.transaction(name, 'readonly'), read = tx.objectStore(name).getAll();
        tx.oncomplete = () => resolve(read.result); tx.onerror = () => reject(new Error('Fixture storage read failed'));
      })); } finally { db.close(); }
    }
    return JSON.stringify(values).includes('A'.repeat(43));
  });
}
async function journalSelection(): Promise<Selection> {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => { const open = indexedDB.open('sm-customer-preparation-v1', 1);
      open.onsuccess = () => resolve(open.result); open.onerror = () => reject(new Error('Fixture journal unavailable')); });
    try { return await new Promise<Selection>((resolve, reject) => {
      const tx = db.transaction('preparations', 'readonly'), read = tx.objectStore('preparations').get('recette');
      tx.oncomplete = () => { const value = read.result;
        if (value?.phase !== 'ready' || value.verification?.phase !== 'completed') { reject(new Error('Fixture publication unavailable')); return; }
        resolve({ browserRef: value.browserRef, operationId: value.verification.operationId, checkId: value.verification.checkId }); };
      tx.onabort = tx.onerror = () => reject(new Error('Fixture journal unavailable'));
    }); } finally { db.close(); }
  });
}
describe('account loyalty — native UI with isolated HTTP', () => {
  it('pastes an existing card without a name and requires a separate explicit attachment consent', async () => {
    name = null; await openLoyalty();
    expect(await page.getByRole('button', { name: 'J’ai déjà une carte', exact: true }).count()).toBe(1);
    await page.getByRole('button', { name: 'J’ai déjà une carte', exact: true }).click();
    await page.getByRole('heading', { name: 'Rattacher ma carte', exact: true }).waitFor();
    const code = page.getByLabel('Code de votre carte', { exact: true });
    await code.fill('A'.repeat(43));
    const submit = page.getByRole('button', { name: 'Rattacher cette carte', exact: true });
    expect(await submit.isDisabled()).toBe(true); expect(calls.map(call => call.step)).toEqual(['view']);
    expect(await page.getByRole('checkbox').isChecked()).toBe(false);
    await page.getByRole('checkbox').check(); await submit.click(); await verifyLoyalty('member');
    expect(calls[1]).toMatchObject({ step: 'attach', qrToken: 'A'.repeat(43), termsAccepted: true,
      termsNoticeVersion: 'customer-loyalty-attach-2026-09' });
    expect(calls.map(call => call.step)).toEqual(['view', 'attach']);
    expect(await page.getByRole('img', { name: 'QR de votre carte fidélité' }).count()).toBe(0);
    expect(await page.getByLabel('Code de votre carte', { exact: true }).count()).toBe(0);
    expect(await page.evaluate(() => [localStorage.length, sessionStorage.length])).toEqual([0, 0]);
    expect(await privateQrPersisted()).toBe(false);
  });
  it('never navigates pasted links and refuses foreign-restaurant or noncanonical codes', async () => {
    await openAttachment();
    const input = page.getByLabel('Code de votre carte', { exact: true }), submit = page.getByRole('button', { name: 'Rattacher cette carte', exact: true });
    for (const value of ['invalid', 'A'.repeat(42) + 'B', `https://outside.invalid/r/other/fidelite#card=${'A'.repeat(43)}`, `javascript:${'A'.repeat(43)}`]) {
      await input.fill(value); await page.getByRole('checkbox').check(); expect(await submit.isDisabled()).toBe(true);
    }
    expect(page.url()).toBe(`${origin}/`); expect(calls).toEqual([{ step: 'view' }]);
    await input.fill(`https://outside.invalid/r/recette/fidelite#card=${'A'.repeat(43)}`);
    expect(await page.getByRole('checkbox').isChecked()).toBe(false); await page.getByRole('checkbox').check(); await submit.click();
    await verifyLoyalty('member'); expect(calls[1]?.qrToken).toBe('A'.repeat(43)); expect(page.url()).toBe(`${origin}/`);
  });
  it('retries the identical attachment after a lost reply and reloads by view without the old QR', async () => {
    await openAttachment(); outcome = 'lost'; await attach();
    await page.getByText(/rattachement n’est pas confirmée/).waitFor(); const first = structuredClone(calls[1]);
    expect(await page.getByLabel('Code de votre carte', { exact: true }).count()).toBe(0);
    expect(await privateQrPersisted()).toBe(false); expect(calls).toHaveLength(2);
    await page.getByRole('button', { name: 'Reprendre mon rattachement', exact: true }).click(); await verifyLoyalty('member');
    expect(calls[2]).toEqual(first); expect(discardedErrors.size).toBe(1);
    await page.reload(); await openLoyalty(); expect(calls[3]).toEqual({ step: 'view' });
    expect(await page.getByRole('img').count()).toBe(0); expect(await privateQrPersisted()).toBe(false);
  });
  it('requires a fresh code and consent after attachment terms changed', async () => {
    await openAttachment(); outcome = 'terms'; await attach(); await verifyLoyalty('terms_changed');
    expect(await page.getByLabel('Code de votre carte', { exact: true }).inputValue()).toBe('');
    expect(await page.getByRole('checkbox').isChecked()).toBe(false);
    expect(await page.getByRole('button', { name: 'Rattacher cette carte', exact: true }).isDisabled()).toBe(true);
    await attach(); await verifyLoyalty('member'); expect(calls[2]?.rulesVersion).toBe(2);
    expect(calls[2]?.operationId).not.toBe(calls[1]?.operationId);
  });
  it('rereads real terms explicitly after a uniform attachment refusal', async () => {
    await openAttachment(); outcome = 'refused'; await attach(); await verifyLoyalty('attachment_refused');
    expect(await page.getByLabel('Code de votre carte', { exact: true }).count()).toBe(0);
    expect(await page.getByRole('checkbox').count()).toBe(0); expect(await page.getByText('25 points', { exact: true }).count()).toBe(0);
    expect(calls).toHaveLength(2); outcome = 'normal'; version++;
    await page.getByRole('button', { name: 'Relire les conditions pour rattacher ma carte', exact: true }).click();
    await verifyLoyalty('available'); expect(calls[2]).toEqual({ step: 'view' });
    expect(await page.getByLabel('Code de votre carte', { exact: true }).inputValue()).toBe('');
    expect(await page.getByRole('checkbox').isChecked()).toBe(false); expect(await privateQrPersisted()).toBe(false);
  });
  it('decodes a real QR from synthetic video without sending it and stops camera before consent', async () => {
    await openAttachment(); await page.evaluate(() => window.prepareLoyaltyCamera('A'.repeat(43), false));
    await page.getByRole('button', { name: 'Scanner ma carte', exact: true }).click();
    await expect.poll(() => page.getByLabel('Code de votre carte', { exact: true }).inputValue()).toBe('A'.repeat(43));
    await expect.poll(() => page.evaluate(() => window.loyaltyCameraTracks())).toEqual(['ended']);
    expect(await page.getByRole('checkbox').isChecked()).toBe(false); expect(calls).toEqual([{ step: 'view' }]);
    expect(await privateQrPersisted()).toBe(false);
    await page.getByRole('checkbox').check(); await page.getByRole('button', { name: 'Rattacher cette carte', exact: true }).click();
    await verifyLoyalty('member'); expect(calls[1]?.step).toBe('attach'); expect(await page.getByRole('img').count()).toBe(0);
  });
  it('cancels an awaiting camera permission and stops its late synthetic stream without restoring the QR', async () => {
    await openAttachment(); await page.evaluate(() => window.prepareLoyaltyCamera('A'.repeat(43), true));
    await page.getByRole('button', { name: 'Scanner ma carte', exact: true }).click();
    await expect.poll(() => page.evaluate(() => window.loyaltyCameraRequested)).toBe(true);
    await page.getByRole('button', { name: 'Annuler le scan', exact: true }).click();
    expect(await page.locator('video').count()).toBe(0);
    await page.evaluate(() => window.releaseLoyaltyCamera());
    await expect.poll(() => page.evaluate(() => window.loyaltyCameraTracks())).toEqual(['ended']);
    expect(await page.getByLabel('Code de votre carte', { exact: true }).inputValue()).toBe('');
    expect(await page.getByRole('checkbox').isChecked()).toBe(false); expect(calls).toEqual([{ step: 'view' }]);
  });
  it.each(['offline', 'hidden'] as const)('clears code and a live camera on %s, then rereads without any automatic attachment', async reason => {
    await openAttachment(); await page.getByLabel('Code de votre carte', { exact: true }).fill('A'.repeat(43));
    await page.getByRole('checkbox').check();
    await page.evaluate(() => window.prepareLoyaltyCamera('not-a-loyalty-code', false));
    await page.getByRole('button', { name: 'Scanner ma carte', exact: true }).click();
    await expect.poll(() => page.evaluate(() => window.loyaltyCameraTracks())).toEqual(['live']);
    if (reason === 'offline') await context.setOffline(true);
    else await page.evaluate(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' }); document.dispatchEvent(new Event('visibilitychange')); });
    await expect.poll(() => page.getByLabel('Code de votre carte', { exact: true }).count()).toBe(0);
    await expect.poll(() => page.evaluate(() => window.loyaltyCameraTracks())).toEqual(['ended']);
    expect(await page.locator('video').count()).toBe(0); expect(calls).toEqual([{ step: 'view' }]);
    if (reason === 'offline') await context.setOffline(false);
    else await page.evaluate(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' }); document.dispatchEvent(new Event('visibilitychange')); });
    await verifyLoyalty('available'); await markUI(paths.caps); await markUI(paths.session);
    await page.getByRole('button', { name: 'J’ai déjà une carte', exact: true }).click();
    expect(await page.getByLabel('Code de votre carte', { exact: true }).inputValue()).toBe('');
    expect(await page.getByRole('checkbox').isChecked()).toBe(false); expect(calls).toEqual([{ step: 'view' }, { step: 'view' }]);
    expect(await privateQrPersisted()).toBe(false);
  });
  it('keeps paste available after camera denial and cancel erases the entered code and consent', async () => {
    await openAttachment(); await page.evaluate(() => { navigator.mediaDevices.getUserMedia = async () => { throw new DOMException('Denied', 'NotAllowedError'); }; });
    await page.getByRole('button', { name: 'Scanner ma carte', exact: true }).click(); await page.getByText(/caméra n’est pas disponible/).waitFor();
    await page.getByRole('button', { name: 'Annuler le scan', exact: true }).click();
    expect(await page.getByRole('button', { name: 'Scanner ma carte', exact: true }).evaluate(node => node === document.activeElement)).toBe(true);
    await page.getByLabel('Code de votre carte', { exact: true }).fill('A'.repeat(43)); await page.getByRole('checkbox').check();
    await page.getByRole('button', { name: 'Annuler le rattachement', exact: true }).click();
    expect(await page.getByRole('heading', { name: 'Ma fidélité', exact: true }).evaluate(node => node === document.activeElement)).toBe(true);
    await page.getByRole('button', { name: 'J’ai déjà une carte', exact: true }).click();
    expect(await page.getByLabel('Code de votre carte', { exact: true }).inputValue()).toBe('');
    expect(await page.getByRole('checkbox').isChecked()).toBe(false); expect(calls).toEqual([{ step: 'view' }]);
  });
  it.each([320, 390, 1440])('keeps attachment consent and controls reachable at %ipx', async width => {
    await page.setViewportSize({ width, height: width === 320 ? 568 : 900 }); await openAttachment();
    expect(await page.getByRole('heading', { name: 'Rattacher ma carte', exact: true }).evaluate(node => node === document.activeElement)).toBe(true);
    await page.getByLabel('Code de votre carte', { exact: true }).fill('A'.repeat(43));
    await page.getByRole('checkbox').check(); await page.evaluate(() => document.fonts.ready);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const dialog = page.getByRole('dialog', { name: 'Mon compte', exact: true });
    const controls = [...await dialog.getByRole('button').all(), page.getByLabel('Code de votre carte', { exact: true }), page.getByRole('checkbox').locator('..')];
    for (const control of controls) {
      await control.scrollIntoViewIfNeeded(); const bounds = await control.boundingBox(); expect(bounds?.height).toBeGreaterThanOrEqual(44);
      expect(await control.evaluate(node => { const box = node.getBoundingClientRect(); const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2); return hit !== null && node.contains(hit); })).toBe(true);
    }
    await page.getByRole('heading', { name: 'Rattacher ma carte', exact: true }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: join(captures, `loyalty-attachment-${width}.png`) });
    await page.getByRole('button', { name: 'Rattacher cette carte', exact: true }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: join(captures, `loyalty-attachment-consent-${width}.png`) });
    expect(calls).toEqual([{ step: 'view' }]); expect(await privateQrPersisted()).toBe(false);
  });
  it('requires the exact held request and post-EOF disposal proof, never merely a closed screen', () => {
    const request = { method: () => 'POST', url: () => `${origin}${paths.loyalty}`, postData: () => JSON.stringify({ step: 'view' }) } as BrowserRequest;
    const other = { method: () => 'POST', url: () => `${origin}${paths.loyalty}`, postData: () => JSON.stringify({ step: 'view' }) } as BrowserRequest;
    const failure: Failure = { request, error: 'net::ERR_ABORTED', closing: false };
    const wire: Wire = { request, id: '1', status: 200, bytes: 227, mime: 'application/json' };
    const complete: ReadMark[] = [{ id: '1', event: 'eof', bytes: 227 }, { id: '1', event: 'json-valid' }, { id: '1', event: 'contract-valid' }, { id: '1', event: 'state-member' }];
    const proof: DisposedResponse = { heldRequest: request, phases: ['held', 'screen-left', 'released', 'eof', 'profile-visible'],
      sectionRemovedBeforeRelease: true, sectionStillRemovedAfterEof: true, profileAfterEof: true, privateSections: 0, balances: 0, qrImages: 0 };
    expect(rejectedAfterDisposal(failure, wire, complete, proof)).toBe(true);
    for (const changed of [undefined, { ...proof, heldRequest: other }, { ...proof, phases: [] },
      { ...proof, phases: ['held', 'released', 'screen-left', 'eof', 'profile-visible'] },
      { ...proof, phases: ['held', 'screen-left', 'released', 'profile-visible', 'eof'] },
      { ...proof, sectionRemovedBeforeRelease: false }, { ...proof, sectionStillRemovedAfterEof: false }, { ...proof, profileAfterEof: false },
      { ...proof, privateSections: 1 }, { ...proof, balances: 1 }, { ...proof, qrImages: 1 }]) {
      expect(rejectedAfterDisposal(failure, wire, complete, changed)).toBe(false);
    }
    for (const observed of [[], complete.filter(mark => mark.event !== 'eof'), complete.filter(mark => mark.event !== 'json-valid'),
      complete.filter(mark => mark.event !== 'contract-valid'), complete.filter(mark => mark.event !== 'state-member'),
      complete.map(mark => mark.event === 'eof' ? { ...mark, bytes: 1 } : mark),
      ...['abort', 'cancel', 'read-rejected', 'json-invalid', 'contract-invalid'].map(event => [...complete, { id: '1', event }])]) {
      expect(rejectedAfterDisposal(failure, wire, observed, proof)).toBe(false);
    }
    expect(rejectedAfterDisposal(failure, { ...wire, request: other }, complete, proof)).toBe(false);
    expect(rejectedAfterDisposal({ ...failure, request: other }, wire, complete, proof)).toBe(false);
    expect(rejectedAfterDisposal(failure, { ...wire, id: '2' }, complete, proof)).toBe(false);
  });
  it('requires exact request, complete JSON, valid contract and matching UI before classifying a Chromium notification', () => {
    const request = { method: () => 'POST', url: () => `${origin}${paths.loyalty}` } as BrowserRequest;
    const failure: Failure = { request, error: 'net::ERR_ABORTED', closing: false };
    const wire: Wire = { request, id: '1', status: 200, bytes: 281, mime: 'application/json' };
    const complete: ReadMark[] = [{ id: '1', event: 'eof', bytes: 281 }, { id: '1', event: 'json-valid' }, { id: '1', event: 'contract-valid' }];
    const ui = new Set(['1']);
    expect(completedApplicationRead(failure, wire, complete, ui)).toBe(true);
    const other = { method: () => 'POST', url: () => `${origin}${paths.loyalty}` } as BrowserRequest;
    for (const changed of [undefined, { ...wire, request: other }, { ...wire, id: '2' }, { ...wire, status: 503 },
      { ...wire, bytes: 280 }, { ...wire, bytes: 0 }, { ...wire, bytes: 49_153 }, { ...wire, mime: 'text/html' }]) {
      expect(completedApplicationRead(failure, changed, complete, ui)).toBe(false);
    }
    for (const changed of [[], complete.slice(1), complete.filter(mark => mark.event !== 'json-valid'),
      complete.filter(mark => mark.event !== 'contract-valid'), [...complete, complete[0]!], complete.map(mark => ({ ...mark, id: '2' })),
      ...['abort', 'cancel', 'read-rejected', 'json-invalid', 'contract-invalid'].map(event => [...complete, { id: '1', event }])]) {
      expect(completedApplicationRead(failure, wire, changed, ui)).toBe(false);
    }
    expect(completedApplicationRead(failure, wire, complete, new Set(['2']))).toBe(false);
    expect(completedApplicationRead({ ...failure, error: 'net::ERR_FAILED' }, wire, complete, ui)).toBe(false);
  });
  it('requires opt-in and a separate card gesture, renders the restaurant identity', async () => {
    await openLoyalty(); await page.getByText('Les habitués du Comptoir', { exact: true }).waitFor();
    expect(await page.title()).toBe('Account loyalty fixture'); expect(await page.getByRole('checkbox').isChecked()).toBe(false);
    expect(await page.getByRole('button', { name: 'Créer ma carte gratuite', exact: true }).isDisabled()).toBe(true);
    expect(calls.map(call => call.step)).toEqual(['view']); expect(await page.getByText('Camille Recette', { exact: false }).count()).toBeGreaterThan(0);
    await accept(); await verifyLoyalty('member');
    expect(calls.map(call => call.step)).toEqual(['view', 'join']); expect(await page.getByRole('img', { name: 'QR de votre carte fidélité' }).count()).toBe(0);
    await page.getByRole('button', { name: 'Afficher ma carte', exact: true }).click(); await verifyLoyalty('card');
    expect(calls.map(call => call.step)).toEqual(['view', 'join', 'card']);
    expect(await page.evaluate(() => [localStorage.length, sessionStorage.length])).toEqual([0, 0]);
    await page.getByRole('button', { name: 'Masquer ma carte', exact: true }).click(); expect(await page.getByRole('img').count()).toBe(0);
  });
  it('replays a lost join with the identical operation and body', async () => {
    await openLoyalty(); outcome = 'lost'; await accept(); await page.getByText(/demande de carte n’est pas confirmée/).waitFor();
    const first = structuredClone(calls[1]); await page.getByRole('button', { name: 'Reprendre ma demande', exact: true }).click();
    await verifyLoyalty('member'); expect(calls[2]).toEqual(first); expect(discardedErrors.size).toBe(1);
  });
  it('changed terms reset the checkbox and require a new explicit consent', async () => {
    await openLoyalty(); outcome = 'terms'; await accept(); await verifyLoyalty('terms_changed');
    expect(await page.getByRole('checkbox').isChecked()).toBe(false); expect(calls).toHaveLength(2);
    await accept(); await verifyLoyalty('member'); expect(calls[2]?.rulesVersion).toBe(2);
    expect(calls[2]?.operationId).not.toBe(calls[1]?.operationId);
  });
  it('uses the existing profile editor when a name is required', async () => {
    name = null; await openLoyalty(); await page.getByRole('button', { name: 'Compléter mon profil', exact: true }).click();
    await page.getByRole('textbox', { name: 'Votre prénom ou nom' }).waitFor();
    await expect.poll(() => page.getByRole('textbox', { name: 'Votre prénom ou nom' }).evaluate(node => node === document.activeElement)).toBe(true);
    expect(calls.map(call => call.step)).toEqual(['view']);
  });
  it('does not disclose any other member after a phone collision', async () => {
    outcome = 'collision'; await openLoyalty(); await page.getByText(/présentez votre carte existante/i).waitFor();
    expect(await page.getByRole('checkbox').count()).toBe(0); expect(await page.getByRole('button', { name: 'Afficher ma carte' }).count()).toBe(0);
    expect(await page.getByText('25 points', { exact: true }).count()).toBe(0); expect(calls).toHaveLength(1);
    await session.send('Runtime.evaluate', { expression: 'void 0' });
    const own = [...wires.entries()].filter(([request]) => request.url() === `${origin}/r/recette/compte/fidelite`);
    expect(own).toHaveLength(1); const wire = own[0]![1];
    expect(marks.filter(mark => mark.id === wire.id && mark.event === 'eof')).toEqual([{ id: wire.id, event: 'eof', bytes: wire.bytes }]);
    expect(marks.some(mark => mark.id === wire.id && mark.event === 'contract-valid')).toBe(true); rendered.add(wire.id);
  });
  it('keeps the account accessible when loyalty is unavailable', async () => {
    outcome = 'unavailable'; await openLoyalty(); await page.getByText(/fidélité n’est pas disponible/).waitFor();
    await page.getByRole('button', { name: 'Revenir à mon compte', exact: true }).click(); await page.getByText('Camille Recette', { exact: true }).count();
    await page.getByRole('textbox', { name: 'Votre prénom ou nom' }).waitFor();
  });
  it('masks private content offline and never restores the QR on reconnect', async () => {
    registered = true; await openLoyalty(); await page.getByRole('button', { name: 'Afficher ma carte', exact: true }).click();
    await verifyLoyalty('card'); await context.setOffline(true);
    await expect.poll(() => page.getByRole('img').count()).toBe(0); expect(await page.getByText('25 points', { exact: true }).count()).toBe(0);
    const count = calls.length;
    await context.setOffline(false); await verifyLoyalty('member'); await markUI(paths.caps); await markUI(paths.session);
    expect(calls.slice(count).map(call => call.step)).toEqual(['view']);
    expect(await page.getByRole('img').count()).toBe(0);
  });
  it('a late response after leaving the screen cannot republish private data', async () => {
    const held = page.waitForRequest(request => request.url() === `${origin}${paths.loyalty}` && request.method() === 'POST');
    outcome = 'held'; await openLoyalty(); await expect.poll(() => release !== null).toBe(true);
    const heldRequest = await held;
    expect(heldRequest.postData()).toBe(JSON.stringify({ step: 'view' }));
    expect(calls).toEqual([{ step: 'view' }]); expect(inflight.has(heldRequest)).toBe(true);
    expect(wires.has(heldRequest)).toBe(false); // No response headers before leaving.
    const section = await page.getByRole('region', { name: 'Fidélité de votre compte' }).elementHandle();
    expect(section).not.toBeNull();
    const phases = ['held'];
    await page.getByRole('button', { name: 'Revenir à mon compte', exact: true }).click();
    await page.getByRole('textbox', { name: 'Votre prénom ou nom' }).waitFor();
    const sectionRemovedBeforeRelease = await section!.evaluate(node => !node.isConnected);
    expect(sectionRemovedBeforeRelease).toBe(true);
    expect(await page.getByRole('region', { name: 'Fidélité de votre compte' }).count()).toBe(0);
    expect(wires.has(heldRequest)).toBe(false); phases.push('screen-left');
    registered = true; release?.(); release = null; phases.push('released');
    await expect.poll(() => {
      const wire = wires.get(heldRequest);
      return wire !== undefined && completeResponseRead({ request: heldRequest, error: 'net::ERR_ABORTED', closing: false }, wire, marks);
    }).toBe(true);
    await session.send('Runtime.evaluate', { expression: 'void 0' }); phases.push('eof');
    const wire = wires.get(heldRequest)!;
    expect(marks.some(mark => mark.id === wire.id && mark.event === 'state-member')).toBe(true);
    const profileAfterEof = await page.getByRole('textbox', { name: 'Votre prénom ou nom' }).inputValue() === 'Camille Recette';
    expect(profileAfterEof).toBe(true); phases.push('profile-visible');
    const sectionStillRemovedAfterEof = await section!.evaluate(node => !node.isConnected);
    expect(sectionStillRemovedAfterEof).toBe(true);
    const privateSections = await page.getByRole('region', { name: 'Fidélité de votre compte' }).count();
    const balances = await page.getByText('25 points', { exact: true }).count(), qrImages = await page.getByRole('img').count();
    expect([privateSections, balances, qrImages]).toEqual([0, 0, 0]);
    expect(calls).toEqual([{ step: 'view' }]);
    const proof = { heldRequest, phases, sectionRemovedBeforeRelease, sectionStillRemovedAfterEof, profileAfterEof, privateSections, balances, qrImages };
    disposedResponses.set(heldRequest, proof);
    expect(rejectedAfterDisposal({ request: heldRequest, error: 'net::ERR_ABORTED', closing: false }, wire, marks, proof)).toBe(true);
    await section!.dispose();
  });
  it.each(['view', 'attach'] as const)('an inter-tab publication change masks the old card and drops its held %s result', async step => {
    const before = await journalSelection();
    if (step === 'attach') { await openAttachment(); outcome = 'held'; await attach(); }
    else { outcome = 'held'; await openLoyalty(); }
    await expect.poll(() => release !== null).toBe(true);
    const other = await context.newPage(); await other.goto(origin); name = 'Morgan Recette';
    await other.evaluate(async () => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => { const open = indexedDB.open('sm-customer-preparation-v1', 1); open.onsuccess = () => resolve(open.result); open.onerror = () => reject(new Error('Fixture unavailable')); });
      await new Promise<void>((resolve, reject) => { const tx = db.transaction('preparations', 'readwrite'); const store = tx.objectStore('preparations'); const read = store.get('recette');
        read.onsuccess = () => { const value = read.result; value.verification.operationId = '70000000-0000-4000-8000-000000000007'; value.verification.checkId = '80000000-0000-4000-8000-000000000008'; store.put(value, 'recette'); };
        tx.oncomplete = () => resolve(); tx.onerror = () => reject(new Error('Fixture write failed')); }); db.close();
      const channel = new BroadcastChannel('sm:customer:invalidate:recette'); channel.postMessage('public-fixture-invalidation'); channel.close();
    });
    await page.getByRole('textbox', { name: 'Votre prénom ou nom' }).waitFor();
    await expect.poll(() => page.getByRole('textbox', { name: 'Votre prénom ou nom' }).inputValue()).toBe('Morgan Recette');
    const after = await journalSelection();
    registered = true; release?.(); release = null;
    await expect.poll(() => inflight.size, { timeout: 1000 }).toBe(0);
    await session.send('Runtime.evaluate', { expression: 'void 0' });
    const wire = [...wires.values()].filter(value => new URL(value.request.url()).pathname === paths.loyalty).at(-1)!;
    expect(wire).toBeDefined(); expect(requestSelection(wire.request)).toEqual(before);
    expect(JSON.parse(wire.request.postData()!).step).toBe(step);
    expect(marks.filter(mark => mark.id === wire.id && mark.event === 'eof')).toEqual([{ id: wire.id, event: 'eof', bytes: wire.bytes }]);
    expect(marks.some(mark => mark.id === wire.id && mark.event === 'contract-valid')).toBe(true);
    const current = await journalSelection(); expect(current).toEqual(after); expect(after).not.toEqual(before);
    const profileAfterEof = await page.getByRole('textbox', { name: 'Votre prénom ou nom' }).inputValue() === 'Morgan Recette';
    expect(profileAfterEof).toBe(true); await markUI(paths.caps); await markUI(paths.session);
    const profileWire = [...wires.values()].filter(value => new URL(value.request.url()).pathname === paths.session).at(-1)!;
    const privateSections = await page.getByRole('region', { name: 'Fidélité de votre compte' }).count();
    const balances = await page.getByText('25 points', { exact: true }).count(), qrImages = await page.getByRole('img').count();
    expect([privateSections, balances, qrImages]).toEqual([0, 0, 0]);
    const proof = { before, after, current, profileAfterEof, profileRequest: profileWire.request, privateSections, balances, qrImages };
    identityRefusals.set(wire.request, proof);
    const notification = { request: wire.request, error: 'net::ERR_ABORTED', closing: false };
    expect(rejectedForIdentity(notification, wire, marks, proof, wires, rendered)).toBe(true);
    for (const changed of [undefined, { ...proof, before: after }, { ...proof, after: before }, { ...proof, current: before },
      { ...proof, current: { ...current, browserRef: 'invalid' } }, { ...proof, profileAfterEof: false },
      { ...proof, profileRequest: wire.request }, { ...proof, privateSections: 1 }, { ...proof, balances: 1 }, { ...proof, qrImages: 1 }]) {
      expect(rejectedForIdentity(notification, wire, marks, changed, wires, rendered)).toBe(false);
    }
    for (const observed of [marks.filter(mark => !(mark.id === wire.id && mark.event === 'eof')),
      marks.filter(mark => !(mark.id === wire.id && mark.event === 'contract-valid')),
      marks.map(mark => mark.id === wire.id && mark.event === 'eof' ? { ...mark, bytes: 1 } : mark),
      ...['abort', 'cancel', 'read-rejected', 'json-invalid', 'contract-invalid'].map(event => [...marks, { id: wire.id, event }])]) {
      expect(rejectedForIdentity(notification, wire, observed, proof, wires, rendered)).toBe(false);
    }
    expect(rejectedForIdentity(notification, wire, marks, proof, wires, new Set())).toBe(false);
    expect(await page.getByText('25 points', { exact: true }).count()).toBe(0); expect(await page.getByRole('img').count()).toBe(0);
    await other.close();
  });
  it('expiry removes an already rendered QR and balance', async () => {
    expiry = Date.now() + 2000; registered = true; await openLoyalty();
    await page.getByRole('button', { name: 'Afficher ma carte', exact: true }).click(); await verifyLoyalty('card');
    await expect.poll(() => page.getByRole('img').count(), { timeout: 3000 }).toBe(0); expect(await page.getByText('25 points', { exact: true }).count()).toBe(0);
  });
  it.each([320, 390, 1440])('keeps visible, reachable controls at %ipx including short height', async width => {
    await page.setViewportSize({ width, height: width === 320 ? 568 : 900 }); await openLoyalty(); await page.getByRole('checkbox').waitFor();
    await page.evaluate(() => document.fonts.ready); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const dialog = page.getByRole('dialog', { name: 'Mon compte', exact: true });
    for (const control of await dialog.getByRole('button').all()) {
      await control.scrollIntoViewIfNeeded(); const bounds = await control.boundingBox(); expect(bounds?.height).toBeGreaterThanOrEqual(44);
      expect(await control.evaluate(node => { const box = node.getBoundingClientRect(); const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2); return hit !== null && node.contains(hit); })).toBe(true);
    }
    await page.getByRole('heading', { name: 'Ma fidélité', exact: true }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: join(captures, `loyalty-offer-${width}.png`) });
  });
  it.each(['truncated', 'invalid-json', 'invalid-contract'] as const)('never classifies an actual %s card response using the previous valid same-URL card', async fault => {
    registered = true; await openLoyalty();
    await page.getByRole('button', { name: 'Afficher ma carte', exact: true }).click(); await verifyLoyalty('card');
    const previous = [...wires.values()].at(-1)!;
    await page.getByRole('button', { name: 'Masquer ma carte', exact: true }).click();
    transportFault = fault; await page.getByRole('button', { name: 'Afficher ma carte', exact: true }).click();
    await page.getByRole('alert').waitFor();
    expect(await page.getByRole('img', { name: 'QR de votre carte fidélité' }).count()).toBe(0);
    expect(await page.getByText('25 points', { exact: true }).count()).toBe(0);
    await expect.poll(() => inflight.size, { timeout: 1000 }).toBe(0);
    await session.send('Runtime.evaluate', { expression: 'void 0' });
    const wire = [...wires.values()].at(-1)!;
    expect(wire.id).not.toBe(previous.id); expect(wire.request).not.toBe(previous.request);
    expect(wire.request.postData()).toBe(JSON.stringify({ step: 'card' }));
    const own = marks.filter(mark => mark.id === wire.id);
    if (fault === 'truncated') expect(own.some(mark => mark.event === 'eof')).toBe(false);
    else expect(own.some(mark => mark.event === (fault === 'invalid-json' ? 'json-invalid' : 'contract-invalid'))).toBe(true);
    const notification: Failure = { request: wire.request, error: 'net::ERR_ABORTED', closing: false };
    expect(completedApplicationRead(notification, wire, marks, rendered)).toBe(false);
    expect(completedApplicationRead(notification, wire, marks, new Set([wire.id]))).toBe(false); // Even a forged UI mark cannot hide bad bytes/schema.
    const ownFailures = failures.filter(failure => failure.request === wire.request);
    if (fault === 'truncated') expect(ownFailures.length).toBeGreaterThan(0);
    for (const failure of ownFailures) {
      expect(completedApplicationRead(failure, wire, marks, rendered)).toBe(false);
      expectedFailures.add(failure.request); // Only the deliberately broken response, whose rejection was asserted above.
    }
  });
});
