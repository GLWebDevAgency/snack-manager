import { createServer, type Server } from 'node:http';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import postcss from 'postcss';
import tailwind from '@tailwindcss/postcss';
import { chromium, type Browser, type BrowserContext, type CDPSession, type Page, type Request as BrowserRequest } from 'playwright';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { seedCustomerBrowserFixture } from './browser-journal.fixture';

// Real Entry/Sheet/account hook, identity journal, private reader and brand CSS.
// HTTP data is fixture-only. This is not a Next/BFF/Nest/database end-to-end test.
let server: Server, browser: Browser, context: BrowserContext, page: Page, origin: string;
let faults: string[], calls: { path: string; body: Record<string, unknown>; operation: string | undefined; responseId?: string }[], expiry: number;
let responseStatus = 200, hold = false, release: (() => void) | null, evidence: string | undefined;
type Failure = { id: string | null; method: string; path: string; error: string | undefined };
type Mark = { id: string; event: string; bytes?: number; sequence: number };
type Wire = { id: string; method: string; path: string; status: number; mime: string; length: number; failure?: { sequence: number; error: string } };
let inflight: Set<BrowserRequest>, failed: Failure[], session: CDPSession, fixtureSerial: number;
let marks: Mark[], wires: Map<string, Wire>, uiVerified: Set<string>, expectedFailures: Set<Failure>;
let transportFault: 'none' | 'before-headers' | 'truncated' | 'invalid-json' | 'invalid-contract';
let distinctRefreshes: boolean, invalidCapabilities: boolean;
declare global { interface Window { accountReadObservation: (metadata: string) => void; validateAccountFixtureCapabilities: (raw: unknown) => boolean } }
const paths = { caps: '/r/recette/compte/capacites', session: '/r/recette/compte/session', list: '/r/recette/compte/commandes/recherche', detail: '/r/recette/compte/commandes/detail' };

/** Chromium151 emitted loadingFailed despite exhaustive reads in both HTTP
 * framing modes, both headless engines and with retained/collected readers.
 * CDP/Runtime delivery order and Chromium's internal cause are NOT established.
 * We classify the application's verified result for this exact response, not
 * a claimed post-EOF event. No URL/status-only ERR_ABORTED exception is allowed. */
function completedApplicationRead(failure: Failure, wire: Wire | undefined, observed: Mark[], rendered: ReadonlySet<string>) {
  if (!failure.id || !wire || wire.id !== failure.id || wire.path !== failure.path || wire.method !== failure.method
    || failure.error !== 'net::ERR_ABORTED' || wire.failure?.error !== failure.error || wire.status !== 200
    || !Object.values(paths).includes(wire.path) || !/^application\/json(?:;\s*charset=utf-8)?$/i.test(wire.mime)
    || !Number.isSafeInteger(wire.length) || wire.length <= 0 || wire.length > 1_048_576 || !rendered.has(wire.id)) return false;
  const own = observed.filter(mark => mark.id === wire.id), eof = own.filter(mark => mark.event === 'eof');
  return eof.length === 1 && eof[0]!.bytes === wire.length
    && own.some(mark => mark.event === 'json-valid')
    && (wire.path !== paths.caps || own.some(mark => mark.event === 'contract-valid'))
    && !own.some(mark => ['abort', 'cancel', 'read-rejected', 'json-invalid', 'contract-invalid'].includes(mark.event));
}
const rows = Array.from({ length: 10 }, (_, index) => ({ _id: (1000 - index).toString(16).padStart(24, '0'), number: 120 - index,
  createdAt: '2026-09-09T12:00:00.000Z', status: index === 9 ? 'delivered' : 'ready', type: index % 2 ? 'pickup' : 'delivery',
  pickupSlot: '2026-09-09T18:00:00.000Z', totalCents: 1490,
  payment: { method: 'counter', status: index === 0 ? 'pending' : 'paid', refundedCents: 0, pendingRefundCents: 0 } }));
function detail(order: typeof rows[number]) {
  return { ...order, totals: { subtotal: 1290, deliveryFee: 200, discount: null, total: 1490 },
    lines: [{ name: 'Menu burger du Comptoir', variantName: 'Classique', qty: 1, unitPrice: 1290, lineTotal: 1290,
      options: [{ name: 'Sauce maison', priceDelta: 0 }], removed: ['Oignons'], note: null }], note: 'Serviettes, merci.',
    statusHistory: [{ status: 'new', at: order.createdAt }, { status: 'ready', at: '2026-09-09T12:10:00.000Z' }],
    delivery: order.type === 'delivery' ? { dispatchedAt: '2026-09-09T12:15:00.000Z', deliveredAt: null, estimatedMinutes: 35 } : null };
}
beforeAll(async () => {
  const root = fileURLToPath(new URL('.', import.meta.url)), cssPath = fileURLToPath(new URL('../../app/globals.css', import.meta.url));
  const [bundle, css] = await Promise.all([build({ stdin: { contents: `import React from 'react';import{createRoot}from'react-dom/client';
      import{CustomerAccountEntry}from'./CustomerAccountEntry';import{marqueDeRepli,CustomerAccountResponses}from'@sm/contracts';import{styleDuMasque}from'../masque/styleDuMasque';
      window.validateAccountFixtureCapabilities=raw=>CustomerAccountResponses.status.safeParse(raw).success;
      createRoot(document.getElementById('root')).render(<React.StrictMode><main style={styleDuMasque(marqueDeRepli(null,null))} className="min-h-dvh bg-bg p-4 text-ink"><h1>Le Comptoir</h1><CustomerAccountEntry slug="recette" restaurantName="Le Comptoir" onDeviceOrders={()=>document.getElementById('device').textContent='Sur cet appareil : aucun suivi enregistré'}/><p id="device"/><button>Commander en invité</button></main></React.StrictMode>);`,
      resolveDir: root, sourcefile: 'customer-orders-ui.tsx', loader: 'tsx' }, bundle: true, write: false, format: 'esm', platform: 'browser', jsx: 'automatic', target: 'es2022', outdir: '/virtual-customer-orders',
      define: { 'process.env': '{}', 'process.env.NODE_ENV': '"production"' } }),
    readFile(cssPath, 'utf8').then(source => postcss([tailwind({ base: fileURLToPath(new URL('../../..', import.meta.url)) })]).process(source, { from: cssPath })),
  ]);
  server = createServer((request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    // Browser-enforced isolation without intercepting local response streams.
    // All application APIs/assets in this fixture are served on this origin.
    response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self'; frame-src 'none'; form-action 'none'; base-uri 'none'");
    if (request.url === '/app.js') { response.setHeader('Content-Type', 'text/javascript'); response.end(bundle.outputFiles.find(file => file.path.endsWith('.js'))!.text); return; }
    if (request.url === '/style.css') { response.setHeader('Content-Type', 'text/css'); response.end(css.css + (bundle.outputFiles.find(file => file.path.endsWith('.css'))?.text ?? '')); return; }
    if (request.url === '/favicon.ico') { response.writeHead(204).end(); return; }
    if (request.url === '/') { response.setHeader('Content-Type', 'text/html'); response.end('<!doctype html><html lang="fr"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Customer orders fixture</title><link rel="stylesheet" href="/style.css"><div id="root"></div><script type="module" src="/app.js"></script></html>'); return; }
    const path = request.url ?? '';
    const json = (value: unknown, status = 200) => { if (!response.destroyed) {
      const body = transportFault === 'invalid-json' && path === paths.detail ? '{invalid'
        : JSON.stringify(transportFault === 'invalid-contract' && path === paths.detail ? { expiresAt: expiry, order: null } : value);
      // Exact length supplies an independent byte-count witness, NOT a fix for
      // the Chromium signal (the controlled chunked/length probes both failed).
      response.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body), 'X-Sm-Fixture-Request-Id': String(++fixtureSerial) });
      if (transportFault === 'truncated' && path === paths.detail) {
        response.flushHeaders(); response.write(body.slice(0, 8)); setTimeout(() => response.destroy(), 10); return;
      }
      response.end(body);
    } };
    if (request.method === 'GET' && path === '/r/recette/compte/capacites') { json({ available: invalidCapabilities ? 'invalid' : false, registrationAvailable: false, accessAvailable: false }); return; }
    if (request.method === 'GET' && path === '/r/recette/compte/session') { json({ expiresAt: expiry, profile: { name: 'Camille Recette', phoneE164: '+33600000000', phoneVerifiedAt: 1_700_000_000_000, revision: 0 } }); return; }
    if (request.method !== 'POST' || !['/r/recette/compte/commandes/recherche', '/r/recette/compte/commandes/detail'].includes(path)) {
      faults?.push(`Unexpected fixture request ${request.method} ${path}`); response.writeHead(404).end(); return;
    }
    let body = ''; request.on('data', chunk => { body += String(chunk); if (body.length > 4096) request.destroy(); });
    request.on('end', () => {
      const parsed = JSON.parse(body) as Record<string, unknown>;
      const call: (typeof calls)[number] = { path, body: parsed, operation: request.headers['x-sm-customer-operation-id'] as string | undefined }; calls.push(call);
      const complete = () => {
        if (transportFault === 'before-headers' && path === paths.detail) { response.destroy(); return; }
        call.responseId = String(fixtureSerial + 1);
        if (responseStatus !== 200) { json({ code: 'FIXTURE_REFUSAL' }, responseStatus); return; }
        if (path.endsWith('/detail')) { const found = rows.find(row => row._id === parsed.orderId); if (!found) { json({}, 404); return; } json({ expiresAt: expiry, order: detail(found) }); return; }
        const filtered = rows.filter(row => parsed.filter === 'all' || (parsed.filter === 'past' ? row.status === 'delivered' : row.status !== 'delivered'));
        const cursor = parsed.cursor as { id: string } | null, after = cursor ? filtered.findIndex(row => row._id === cursor.id) + 1 : 0;
        const orders = filtered.slice(after, after + Number(parsed.limit)).map((order, index) => distinctRefreshes && index === 0 ? { ...order, number: 10_000 + Number(call.responseId) } : order), last = orders.at(-1);
        json({ expiresAt: expiry, orders, nextCursor: after + orders.length < filtered.length && last ? { id: last._id, createdAt: last.createdAt } : null });
      };
      if (hold) release = complete; else complete();
    });
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('No fixture port'); origin = `http://127.0.0.1:${address.port}`;
  browser = await chromium.launch({ headless: true });
  if (process.env.QA_CUSTOMER_ORDERS_CAPTURE === '1') { evidence = await mkdtemp(join(tmpdir(), 'sm-customer-orders-')); process.stdout.write(`Customer orders captures: ${evidence}\n`); }
}, 30_000);
beforeEach(async () => {
  faults = []; calls = []; expiry = Date.now() + 60_000; hold = false; release = null; responseStatus = 200;
  inflight = new Set(); failed = []; fixtureSerial = 0; marks = []; wires = new Map(); uiVerified = new Set(); expectedFailures = new Set(); transportFault = 'none'; distinctRefreshes = false; invalidCapabilities = false;
  context = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce', serviceWorkers: 'block' });
  page = await context.newPage(); page.setDefaultTimeout(5_000);
  session = await context.newCDPSession(page);
  let sequence = 0;
  const requestIds = new WeakMap<BrowserRequest, string>();
  const cdpRequests = new Map<string, { path: string; method: string; fixtureId?: string }>();
  session.on('Network.requestWillBeSent', event => {
    cdpRequests.set(event.requestId, { path: new URL(event.request.url).pathname, method: event.request.method });
  });
  session.on('Network.responseReceived', event => {
    const headers = Object.fromEntries(Object.entries(event.response.headers).map(([key, value]) => [key.toLowerCase(), String(value)]));
    const id = headers['x-sm-fixture-request-id']; if (!id) return;
    const request = cdpRequests.get(event.requestId);
    if (!request || !/^[1-9]\d{0,4}$/.test(id) || wires.has(id)) { faults.push('Ambiguous fixture response identity'); return; }
    request.fixtureId = id;
    wires.set(id, { id, path: request.path, method: request.method, status: event.response.status, mime: headers['content-type'] ?? '', length: Number(headers['content-length']) });
  });
  session.on('Network.loadingFailed', event => {
    const id = cdpRequests.get(event.requestId)?.fixtureId, wire = id ? wires.get(id) : undefined;
    if (wire) wire.failure = { sequence: ++sequence, error: event.errorText };
  });
  session.on('Runtime.bindingCalled', event => {
    if (event.name !== 'accountReadObservation') return;
    const mark = JSON.parse(event.payload) as Omit<Mark, 'sequence'>;
    marks.push({ ...mark, sequence: ++sequence });
  });
  await session.send('Runtime.enable'); await session.send('Network.enable');
  await session.send('Runtime.addBinding', { name: 'accountReadObservation' });
  await page.addInitScript(() => {
    const nativeFetch = window.fetch.bind(window);
    window.fetch = async (...args) => {
      const response = await nativeFetch(...args), id = response.headers.get('x-sm-fixture-request-id');
      if (id && response.body) {
        const observe = (event: string, bytes?: number) => window.accountReadObservation(JSON.stringify({ id, event, ...(bytes === undefined ? {} : { bytes }) }));
        if (args[1]?.signal?.aborted) observe('abort');
        args[1]?.signal?.addEventListener('abort', () => observe('abort'), { once: true });
        const bodyCancel = response.body.cancel.bind(response.body);
        Object.defineProperty(response.body, 'cancel', { value: (reason?: unknown) => { observe('cancel'); return bodyCancel(reason); } });
        const getReader = response.body.getReader.bind(response.body);
        Object.defineProperty(response.body, 'getReader', { value: () => {
          const reader = getReader() as ReadableStreamDefaultReader<Uint8Array>, read = reader.read.bind(reader), cancel = reader.cancel.bind(reader);
          const decoder = new TextDecoder('utf-8', { fatal: true }); let bytes = 0, text = '', invalid = false;
          reader.read = () => {
            const pending = read();
            void pending.then(chunk => {
              bytes += chunk.value?.byteLength ?? 0;
              if (chunk.done) {
                observe('eof', bytes);
                try {
                  if (invalid) throw new Error('Invalid fixture body'); const parsed = JSON.parse(text + decoder.decode()); observe('json-valid');
                  if (new URL(response.url).pathname === '/r/recette/compte/capacites') observe(window.validateAccountFixtureCapabilities(parsed) ? 'contract-valid' : 'contract-invalid');
                }
                catch { observe('json-invalid'); }
                text = ''; // Only metadata leaves this bounded in-memory observer.
              } else if (!invalid) {
                try { if (bytes > 1_048_576) throw new Error('Oversize fixture body'); text += decoder.decode(chunk.value, { stream: true }); }
                catch { invalid = true; text = ''; }
              }
            }, () => observe('read-rejected'));
            return pending; // The real reader, original promise and errors are preserved.
          };
          reader.cancel = reason => { observe('cancel'); return cancel(reason); };
          return reader;
        } });
      }
      return response;
    };
  });
  page.on('request', request => { inflight.add(request); if (new URL(request.url()).origin !== origin) faults.push('External request refused by fixture CSP'); });
  page.on('response', response => { const id = response.headers()['x-sm-fixture-request-id']; if (id) requestIds.set(response.request(), id); });
  page.on('pageerror', error => faults.push(error.message));
  page.on('requestfinished', request => { inflight.delete(request); });
  page.on('requestfailed', request => { inflight.delete(request); failed.push({ id: requestIds.get(request) ?? null, method: request.method(), path: new URL(request.url()).pathname, error: request.failure()?.errorText }); });
  page.on('console', message => { if (!['error', 'warning'].includes(message.type())) return;
    if (message.location().url.startsWith(`${origin}/r/recette/compte/commandes/`) && /Failed to load resource:.*(?:401|404|503)/.test(message.text())) return; // Explicit refusal cases, asserted below.
    if (transportFault !== 'none' && message.location().url === `${origin}${paths.detail}` && message.text().startsWith('Failed to load resource: net::')) return; // Exact injected transport failure, asserted below.
    faults.push(`Console ${message.type()}: ${message.text()}`); });
  await page.goto(origin); await page.getByRole('button', { name: 'Mon compte', exact: true }).waitFor(); await seedCustomerBrowserFixture(page, 'recette');
});
afterEach(async () => {
  hold = false; release?.();
  try {
    await expect.poll(() => inflight.size, { timeout: 1_000 }).toBe(0);
    await session.send('Runtime.evaluate', { expression: 'void 0' }); // Flush the same observation session.
    const completedWithNotification: { fixtureId: string; bytes: number }[] = [];
    for (const failure of failed) {
      const wire = failure.id ? wires.get(failure.id) : undefined;
      if (expectedFailures.has(failure)) continue; // The counter-test already asserted rejection of this exact request.
      if (wire && wire.status === responseStatus && [401, 404, 503].includes(wire.status) && wire.path === paths.detail
        && failure.method === 'POST' && failure.error === 'net::ERR_ABORTED' && marks.some(mark => mark.id === wire.id && mark.event === 'cancel')) continue;
      if (completedApplicationRead(failure, wire, marks, uiVerified)) completedWithNotification.push({ fixtureId: wire!.id, bytes: wire!.length });
      else faults.push(`Unexpected request failure ${failure.method} ${failure.path}: ${failure.error}`);
    }
    if (completedWithNotification.length) console.info('Chromium notifications despite verified JSON/UI completion', completedWithNotification);
    if (faults.length) console.error('Account read failures', { failed, wires: [...wires.values()], marks });
    expect(faults).toEqual([]);
  } finally { await context?.close(); }
});
afterAll(async () => { await browser?.close(); if (server) { server.closeAllConnections(); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); } });
/** Called only after the corresponding visible state has been asserted. No
 * request is accepted merely because another response used the same URL. */
async function markUI(path: string, responseId?: string) {
  await session.send('Runtime.evaluate', { expression: 'void 0' });
  const matches = [...wires.values()].filter(item => item.path === path && (responseId === undefined || item.id === responseId));
  expect(matches).toHaveLength(1); const wire = matches[0];
  expect(wire?.status).toBe(200);
  expect(marks.some(mark => mark.id === wire!.id && mark.event === 'json-valid')).toBe(true);
  if (path === paths.caps) expect(marks.some(mark => mark.id === wire!.id && mark.event === 'contract-valid')).toBe(true);
  expect(marks.find(mark => mark.id === wire!.id && mark.event === 'eof')?.bytes).toBe(wire!.length);
  uiVerified.add(wire!.id);
}
async function verifyList(number = 120, responseId?: string) {
  await page.getByRole('button', { name: `Voir la commande n° ${number}`, exact: true }).waitFor();
  await expect.poll(() => page.getByRole('button', { name: 'Actualiser les états', exact: true }).isEnabled()).toBe(true);
  const exactId = responseId ?? calls.at(-1)?.responseId;
  expect(exactId).toBeDefined(); await markUI(paths.list, exactId);
}
async function openOrders() {
  await page.getByRole('button', { name: 'Mon compte', exact: true }).click();
  await page.getByRole('button', { name: 'Commandes de mon compte', exact: true }).waitFor();
  await markUI(paths.caps); await markUI(paths.session);
  await page.getByRole('button', { name: 'Commandes de mon compte', exact: true }).click();
  await page.getByRole('heading', { name: 'Mes commandes', exact: true }).waitFor();
  if (!hold) await verifyList();
}
describe('private orders — actual UI/client, read-only local HTTP fixture', () => {
  it('does not treat the authenticated fallback UI as proof of a valid capabilities contract', async () => {
    invalidCapabilities = true;
    await page.getByRole('button', { name: 'Mon compte', exact: true }).click();
    await page.getByRole('button', { name: 'Commandes de mon compte', exact: true }).waitFor();
    await markUI(paths.session);
    const caps = [...wires.values()].find(wire => wire.path === paths.caps)!;
    expect(marks.some(mark => mark.id === caps.id && mark.event === 'json-valid')).toBe(true);
    expect(marks.some(mark => mark.id === caps.id && mark.event === 'contract-invalid')).toBe(true);
    const notification: Failure = { id: caps.id, path: paths.caps, method: 'GET', error: 'net::ERR_ABORTED' };
    expect(completedApplicationRead(notification, { ...caps, failure: { sequence: 0, error: notification.error! } }, marks, new Set([caps.id]))).toBe(false);
    for (const failure of failed.filter(item => item.id === caps.id)) {
      expect(completedApplicationRead(failure, caps, marks, uiVerified)).toBe(false); expectedFailures.add(failure);
    }
  });
  it('never classifies incomplete, unvalidated, ambiguous or abandoned reads as application completion', () => {
    const failure: Failure = { id: '1', method: 'POST', path: paths.list, error: 'net::ERR_ABORTED' };
    const wire: Wire = { id: '1', method: 'POST', path: paths.list, status: 200, mime: 'application/json', length: 42, failure: { sequence: 3, error: 'net::ERR_ABORTED' } };
    const complete: Mark[] = [{ id: '1', event: 'eof', bytes: 42, sequence: 1 }, { id: '1', event: 'json-valid', sequence: 2 }];
    const rendered = new Set(['1']);
    expect(completedApplicationRead(failure, wire, complete, rendered)).toBe(true);
    expect(completedApplicationRead(failure, { ...wire, failure: { sequence: 1, error: 'net::ERR_ABORTED' } }, complete, rendered)).toBe(true); // No assertion about cross-domain CDP/Runtime delivery order.
    expect(completedApplicationRead(failure, wire, complete, new Set())).toBe(false);
    const noFailure = { ...wire }; delete noFailure.failure;
    for (const changed of [undefined, { ...wire, id: '2' }, { ...wire, path: paths.detail }, { ...wire, method: 'GET' },
      { ...wire, status: 503 }, { ...wire, mime: 'text/html' }, { ...wire, length: 43 }, { ...wire, length: 0 },
      noFailure, { ...wire, failure: { sequence: 3, error: 'net::ERR_FAILED' } }]) {
      expect(completedApplicationRead(failure, changed, complete, rendered)).toBe(false);
    }
    for (const changed of [[], complete.slice(0, 1), complete.map(mark => ({ ...mark, id: '2' })), [...complete, complete[0]!],
      ...['abort', 'cancel', 'read-rejected', 'json-invalid'].map(event => [...complete, { id: '1', event, sequence: 2 }])]) {
      expect(completedApplicationRead(failure, wire, changed, rendered)).toBe(false);
    }
    expect(completedApplicationRead({ ...failure, id: null }, wire, complete, rendered)).toBe(false);
    expect(completedApplicationRead({ ...failure, error: 'net::ERR_FAILED' }, wire, complete, rendered)).toBe(false);
  });
  it.each(['before-headers', 'truncated', 'invalid-json', 'invalid-contract'] as const)('keeps an actual %s response failure distinct from completed JSON/UI', async fault => {
    await openOrders();
    await page.getByRole('button', { name: 'Voir la commande n° 120' }).click();
    await page.getByText('1 × Menu burger du Comptoir · Classique', { exact: true }).waitFor();
    await markUI(paths.detail, calls.at(-1)?.responseId); // A was valid on this SAME URL.
    const previousResponse = calls.at(-1)?.responseId;
    await page.getByRole('button', { name: 'Revenir à mes commandes', exact: true }).click();
    transportFault = fault;
    await page.getByRole('button', { name: 'Voir la commande n° 120' }).click();
    await page.getByRole('alert').waitFor();
    expect(await page.getByText('1 × Menu burger du Comptoir · Classique', { exact: true }).count()).toBe(0);
    expect(await page.getByText('Aucune commande liée à ce compte', { exact: true }).count()).toBe(0);
    await expect.poll(() => inflight.size, { timeout: 1_000 }).toBe(0);
    await session.send('Runtime.evaluate', { expression: 'void 0' });
    const detailWire = [...wires.values()].find(wire => wire.path === paths.detail && wire.id !== previousResponse);
    if (fault === 'before-headers') expect(detailWire).toBeUndefined();
    else if (fault === 'truncated') expect(marks.some(mark => mark.id === detailWire!.id && mark.event === 'eof')).toBe(false);
    else expect(marks.some(mark => mark.id === detailWire!.id && mark.event === (fault === 'invalid-json' ? 'json-invalid' : 'json-valid'))).toBe(true);
    const ownFailures = failed.filter(failure => failure.path === paths.detail && failure.id !== previousResponse);
    if (fault === 'before-headers' || fault === 'truncated') expect(ownFailures.length).toBeGreaterThan(0);
    for (const failure of ownFailures) {
      expect(failure.method).toBe('POST');
      expect(completedApplicationRead(failure, detailWire, marks, uiVerified)).toBe(false);
      expectedFailures.add(failure); // Only this explicitly injected and rejected failure.
    }
  });
  it('verifies each of twenty refreshes independently of Chromium network notifications', async () => {
    await openOrders(); distinctRefreshes = true;
    for (let index = 0; index < 20; index++) {
      await page.getByRole('button', { name: 'Actualiser les états', exact: true }).click();
      await expect.poll(() => calls.length).toBe(index + 2);
      const responseId = calls[index + 1]?.responseId;
      expect(responseId).toBeDefined();
      await verifyList(10_000 + Number(responseId), responseId); // A previous rendered list cannot satisfy B.
    }
    expect(uiVerified.size).toBe(23); // Two account reads plus21 distinct list responses.
  }, 30_000);
  it('opens only on demand, works with SMS closed and keeps device shortcuts separate', async () => {
    expect(calls).toEqual([]); await openOrders(); await page.getByRole('button', { name: 'Voir la commande n° 120' }).waitFor();
    expect(calls).toHaveLength(1); expect(calls[0]?.operation).toBe('20000000-0000-4000-8000-000000000002');
    expect(await page.getByText('Paiement à confirmer', { exact: true }).count()).toBe(1);
    expect(await page.getByText('Prête à partir', { exact: true }).count()).toBe(0); // No dispatch field in the list DTO.
    await page.getByRole('button', { name: 'Afficher les commandes précédentes' }).click(); await page.getByRole('button', { name: 'Voir la commande n° 111' }).waitFor();
    await markUI(paths.list, calls.at(-1)?.responseId);
    await page.getByRole('button', { name: 'Terminées', exact: true }).click(); await page.getByRole('button', { name: 'Voir la commande n° 111' }).waitFor();
    expect(await page.getByRole('button', { name: /^Voir la commande n°/ }).count()).toBe(1);
    await markUI(paths.list, calls.at(-1)?.responseId);
    await page.getByRole('button', { name: 'Revenir à mon compte' }).click();
    await page.waitForFunction(() => document.activeElement?.textContent?.includes('Commandes de mon compte'));
    await page.getByRole('button', { name: 'Mes commandes sur cet appareil' }).click();
    await page.getByText('Sur cet appareil : aucun suivi enregistré').waitFor(); expect(calls).toHaveLength(3);
  });
  it('loads the selected detail, lines and totals without a tracking URL or secret storage', async () => {
    await openOrders(); await page.getByRole('button', { name: 'Voir la commande n° 120' }).click();
    await page.getByText('1 × Menu burger du Comptoir · Classique', { exact: true }).waitFor();
    await markUI(paths.detail, calls.at(-1)?.responseId);
    expect(calls.at(-1)?.body).toEqual({ orderId: rows[0]!._id }); expect(await page.url()).toBe(`${origin}/`);
    expect(await page.getByText('En route', { exact: true }).count()).toBe(0); // Pending delivery payment, even with a dispatchedAt fixture.
    expect(await page.getByText('Paiement à confirmer', { exact: true }).count()).toBe(1);
    expect(await page.evaluate(() => Object.keys(localStorage).filter(key => key.includes('order')))).toEqual([]);
    expect(await page.evaluate(async () => (await indexedDB.databases()).map(database => database.name))).toEqual(['sm-customer-preparation-v1']);
    await page.getByRole('button', { name: 'Revenir à mes commandes' }).click(); await page.getByRole('heading', { name: 'Mes commandes', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Voir la commande n° 118' }).click(); await page.getByText('En route', { exact: true }).waitFor();
    await markUI(paths.detail, calls.at(-1)?.responseId);
  });
  it.each([401, 404, 503])('explains HTTP %s without displaying an empty list or stale detail', async status => {
    await openOrders(); await page.getByRole('button', { name: 'Voir la commande n° 120' }).waitFor(); responseStatus = status;
    await page.getByRole('button', { name: 'Voir la commande n° 120' }).click(); await page.getByRole('alert').waitFor();
    expect(await page.getByText('Menu burger du Comptoir', { exact: false }).count()).toBe(0);
    expect(await page.getByText('Aucune commande liée à ce compte', { exact: true }).count()).toBe(0);
  });
  it('drops a held A response when the public journal selects B with an identical session projection', async () => {
    hold = true; await openOrders(); await page.getByText('Lecture de vos commandes…', { exact: true }).waitFor();
    await expect.poll(() => calls.length).toBe(1);
    await page.evaluate(async () => {
      const db = await new Promise<IDBDatabase>(resolve => { const open = indexedDB.open('sm-customer-preparation-v1', 1); open.onsuccess = () => resolve(open.result); });
      await new Promise<void>((resolve, reject) => { const tx = db.transaction('preparations', 'readwrite'); const store = tx.objectStore('preparations'), read = store.get('recette');
        read.onsuccess = () => { const journal = read.result; journal.verification.operationId = crypto.randomUUID(); journal.verification.checkId = crypto.randomUUID(); store.put(journal, 'recette'); };
        tx.oncomplete = () => resolve(); tx.onabort = () => reject(new Error('Fixture CAS failed')); }); db.close();
    });
    hold = false; release?.(); await page.getByRole('alert').waitFor();
    expect(await page.getByRole('button', { name: /^Voir la commande n°/ }).count()).toBe(0);
  });
  it('clears rendered data immediately offline and does not restore it from a local order cache', async () => {
    await openOrders(); await page.getByRole('button', { name: 'Voir la commande n° 120' }).waitFor();
    await page.evaluate(() => { Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false }); window.dispatchEvent(new Event('offline')); });
    await page.getByText('Vous êtes hors connexion', { exact: true }).waitFor();
    expect(await page.getByRole('button', { name: /^Voir la commande n°/ }).count()).toBe(0);
  });
  it.each([320, 390, 1440])('preserves layout, focus, keyboard and reduced motion at %ipx', async width => {
    await page.setViewportSize({ width, height: 860 }); await openOrders(); await page.getByRole('button', { name: 'Voir la commande n° 120' }).waitFor();
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    expect(await page.title()).toBe('Customer orders fixture'); expect(await page.locator('nextjs-portal').count()).toBe(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(await page.evaluate(() => document.querySelector('[role="dialog"]')!.scrollWidth <= document.querySelector('[role="dialog"]')!.clientWidth)).toBe(true);
    expect(await page.evaluate(() => document.getAnimations().some(animation => { const timing = animation.effect?.getTiming(); return timing && (timing.iterations === Infinity || (typeof timing.duration === 'number' && timing.duration > 1)); }))).toBe(false);
    if (evidence) await page.screenshot({ path: join(evidence, `orders-${width}.png`) });
    await page.getByRole('button', { name: 'Voir la commande n° 120' }).click(); await page.getByText('1 × Menu burger du Comptoir · Classique', { exact: true }).waitFor();
    await markUI(paths.detail, calls.at(-1)?.responseId);
    if (evidence && width === 390) await page.screenshot({ path: join(evidence, 'detail-390.png') });
    await page.keyboard.press('Escape'); await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === 'Mon compte');
    expect(await page.getByRole('button', { name: 'Commander en invité' }).isVisible()).toBe(true);
  });
});
