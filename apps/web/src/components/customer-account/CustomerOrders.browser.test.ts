import { createServer, type Server } from 'node:http';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import postcss from 'postcss';
import tailwind from '@tailwindcss/postcss';
import { chromium, type Browser, type BrowserContext, type Page, type Request as BrowserRequest } from 'playwright';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { seedCustomerBrowserFixture } from './browser-journal.fixture';

// Real Entry/Sheet/account hook, identity journal, private reader and brand CSS.
// HTTP data is fixture-only. This is not a Next/BFF/Nest/database end-to-end test.
let server: Server, browser: Browser, context: BrowserContext, page: Page, origin: string;
let faults: string[], calls: { path: string; body: Record<string, unknown>; operation: string | undefined }[], expiry: number;
let responseStatus = 200, hold = false, release: (() => void) | null, evidence: string | undefined;
let inflight: Set<BrowserRequest>, failed: { method: string; path: string; error: string | undefined }[];
declare global { interface Window { privateOrderBodyCancellations: { path: string; status: number }[] } }
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
      import{CustomerAccountEntry}from'./CustomerAccountEntry';import{marqueDeRepli}from'@sm/contracts';import{styleDuMasque}from'../masque/styleDuMasque';
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
    const json = (value: unknown, status = 200) => { if (!response.destroyed) { response.writeHead(status, { 'Content-Type': 'application/json' }); response.end(JSON.stringify(value)); } };
    if (request.method === 'GET' && path === '/r/recette/compte/capacites') { json({ available: false, registrationAvailable: false, accessAvailable: false }); return; }
    if (request.method === 'GET' && path === '/r/recette/compte/session') { json({ expiresAt: expiry, profile: { name: 'Camille Recette', phoneE164: '+33600000000', phoneVerifiedAt: 1_700_000_000_000, revision: 0 } }); return; }
    if (request.method !== 'POST' || !['/r/recette/compte/commandes/recherche', '/r/recette/compte/commandes/detail'].includes(path)) {
      faults?.push(`Unexpected fixture request ${request.method} ${path}`); response.writeHead(404).end(); return;
    }
    let body = ''; request.on('data', chunk => { body += String(chunk); if (body.length > 4096) request.destroy(); });
    request.on('end', () => {
      const parsed = JSON.parse(body) as Record<string, unknown>;
      calls.push({ path, body: parsed, operation: request.headers['x-sm-customer-operation-id'] as string | undefined });
      const complete = () => {
        if (responseStatus !== 200) { json({ code: 'FIXTURE_REFUSAL' }, responseStatus); return; }
        if (path.endsWith('/detail')) { const found = rows.find(row => row._id === parsed.orderId); if (!found) { json({}, 404); return; } json({ expiresAt: expiry, order: detail(found) }); return; }
        const filtered = rows.filter(row => parsed.filter === 'all' || (parsed.filter === 'past' ? row.status === 'delivered' : row.status !== 'delivered'));
        const cursor = parsed.cursor as { id: string } | null, after = cursor ? filtered.findIndex(row => row._id === cursor.id) + 1 : 0;
        const orders = filtered.slice(after, after + Number(parsed.limit)), last = orders.at(-1);
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
  inflight = new Set(); failed = [];
  context = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce', serviceWorkers: 'block' });
  page = await context.newPage(); page.setDefaultTimeout(5_000);
  await page.addInitScript(() => {
    window.privateOrderBodyCancellations = [];
    const nativeFetch = window.fetch.bind(window);
    window.fetch = async (...args) => {
      const response = await nativeFetch(...args), path = new URL(response.url).pathname;
      if (response.body && path.startsWith('/r/recette/compte/commandes/') && !response.ok) {
        const cancel = response.body.cancel.bind(response.body);
        Object.defineProperty(response.body, 'cancel', { value: (reason?: unknown) => {
          window.privateOrderBodyCancellations.push({ path, status: response.status }); return cancel(reason);
        } });
      }
      return response;
    };
  });
  page.on('request', request => { inflight.add(request); if (new URL(request.url()).origin !== origin) faults.push('External request refused by fixture CSP'); });
  page.on('pageerror', error => faults.push(error.message));
  page.on('requestfinished', request => { inflight.delete(request); });
  page.on('requestfailed', request => { inflight.delete(request); failed.push({ method: request.method(), path: new URL(request.url()).pathname, error: request.failure()?.errorText }); });
  page.on('console', message => { if (!['error', 'warning'].includes(message.type())) return;
    if (message.location().url.startsWith(`${origin}/r/recette/compte/commandes/`) && /Failed to load resource:.*(?:401|404|503)/.test(message.text())) return; // Explicit refusal cases, asserted below.
    faults.push(`Console ${message.type()}: ${message.text()}`); });
  await page.goto(origin); await page.getByRole('button', { name: 'Mon compte', exact: true }).waitFor(); await seedCustomerBrowserFixture(page, 'recette');
});
afterEach(async () => {
  hold = false; release?.();
  try {
    await expect.poll(() => inflight.size, { timeout: 1_000 }).toBe(0);
    const cancellations = await page.evaluate(() => window.privateOrderBodyCancellations);
    for (const failure of failed) {
      // Exact observed client discard, not a blanket requestfailed exemption.
      // A 200 EOF cancellation or any other failed request still fails QA.
      const expected = cancellations.findIndex(value => value.path === failure.path && value.status === responseStatus
        && [401, 404, 503].includes(value.status) && failure.path === '/r/recette/compte/commandes/detail'
        && failure.method === 'POST' && failure.error === 'net::ERR_ABORTED');
      if (expected < 0) faults.push(`Unexpected request failure ${failure.method} ${failure.path}: ${failure.error}`);
      else cancellations.splice(expected, 1);
    }
    expect(faults).toEqual([]);
  } finally { await context?.close(); }
});
afterAll(async () => { await browser?.close(); if (server) { server.closeAllConnections(); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); } });
async function openOrders() {
  await page.getByRole('button', { name: 'Mon compte', exact: true }).click();
  await page.getByRole('button', { name: 'Commandes de mon compte', exact: true }).click();
  await page.getByRole('heading', { name: 'Mes commandes', exact: true }).waitFor();
}
describe('private orders — actual UI/client, read-only local HTTP fixture', () => {
  it('opens only on demand, works with SMS closed and keeps device shortcuts separate', async () => {
    expect(calls).toEqual([]); await openOrders(); await page.getByRole('button', { name: 'Voir la commande n° 120' }).waitFor();
    expect(calls).toHaveLength(1); expect(calls[0]?.operation).toBe('20000000-0000-4000-8000-000000000002');
    expect(await page.getByText('Paiement à confirmer', { exact: true }).count()).toBe(1);
    expect(await page.getByText('Prête à partir', { exact: true }).count()).toBe(0); // No dispatch field in the list DTO.
    await page.getByRole('button', { name: 'Afficher les commandes précédentes' }).click(); await page.getByRole('button', { name: 'Voir la commande n° 111' }).waitFor();
    await page.getByRole('button', { name: 'Terminées', exact: true }).click(); await page.getByRole('button', { name: 'Voir la commande n° 111' }).waitFor();
    expect(await page.getByRole('button', { name: /^Voir la commande n°/ }).count()).toBe(1);
    await page.getByRole('button', { name: 'Revenir à mon compte' }).click();
    await page.waitForFunction(() => document.activeElement?.textContent?.includes('Commandes de mon compte'));
    await page.getByRole('button', { name: 'Mes commandes sur cet appareil' }).click();
    await page.getByText('Sur cet appareil : aucun suivi enregistré').waitFor(); expect(calls).toHaveLength(3);
  });
  it('loads the selected detail, lines and totals without a tracking URL or secret storage', async () => {
    await openOrders(); await page.getByRole('button', { name: 'Voir la commande n° 120' }).click();
    await page.getByText('1 × Menu burger du Comptoir · Classique', { exact: true }).waitFor();
    expect(calls.at(-1)?.body).toEqual({ orderId: rows[0]!._id }); expect(await page.url()).toBe(`${origin}/`);
    expect(await page.getByText('En route', { exact: true }).count()).toBe(0); // Pending delivery payment, even with a dispatchedAt fixture.
    expect(await page.getByText('Paiement à confirmer', { exact: true }).count()).toBe(1);
    expect(await page.evaluate(() => Object.keys(localStorage).filter(key => key.includes('order')))).toEqual([]);
    expect(await page.evaluate(async () => (await indexedDB.databases()).map(database => database.name))).toEqual(['sm-customer-preparation-v1']);
    await page.getByRole('button', { name: 'Revenir à mes commandes' }).click(); await page.getByRole('heading', { name: 'Mes commandes', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Voir la commande n° 118' }).click(); await page.getByText('En route', { exact: true }).waitFor();
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
    if (evidence && width === 390) await page.screenshot({ path: join(evidence, 'detail-390.png') });
    await page.keyboard.press('Escape'); await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === 'Mon compte');
    expect(await page.getByRole('button', { name: 'Commander en invité' }).isVisible()).toBe(true);
  });
});
