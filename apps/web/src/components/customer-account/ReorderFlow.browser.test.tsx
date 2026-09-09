import { createServer, type Server, type ServerResponse } from 'node:http';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import postcss from 'postcss';
import tailwind from '@tailwindcss/postcss';
import { chromium, type Browser, type BrowserContext, type Locator, type Page, type Request as BrowserRequest } from 'playwright';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { demoSite } from '../order/demo/fixture';
import { seedCustomerBrowserFixture } from './browser-journal.fixture';
import type { CustomerAccountAccess } from './client';
import type { CartLine } from '../order/cart';
import type * as Journal from '../order/checkout-attempt';

// Real React account/reorder/cart hooks, Sheet, brand CSS, HTTP, IndexedDB and
// inter-tab Web Locks. Read-only loopback fixture responses are explicit: this
// is NOT a Next/BFF/Nest/database or provider/payment end-to-end test.
declare global { interface Window { reorderBrowserFixture: {
  journal: typeof Journal; access(): CustomerAccountAccess | null;
  logout(): Promise<boolean>; refresh(): Promise<void>; lockHeld?: boolean; releaseLock?: () => void;
}; reorderReadObservation(id: string, proof: ReadProof): Promise<void>;
  validateReorderBrowserResponse(raw: unknown, path: string): boolean;
} }
type ReadProof = { bytes: number; eof: boolean; valid: boolean; failed: boolean; empty: boolean; noContent: boolean };
type Call = { method: string; path: string; body: Record<string, unknown>; operation?: string };
let server: Server, browser: Browser, context: BrowserContext, page: Page, lockPage: Page, origin: string, captures: string;
let faults: string[], calls: Call[], expiresAt: number, sourceExpiresAt: number, price: number, authenticated: boolean;
let hold: boolean, held: { response: ServerResponse; body: unknown } | null;
let serial: number, failed: { request: BrowserRequest; error: string | undefined }[];
let wires: WeakMap<BrowserRequest, { id: string; length: number; status: number; mime: string }>;
let proofs: Record<string, ReadProof>, inflight: Set<BrowserRequest>;
let confirmedLogoutIds: Set<string>;
const orderId = 'a'.repeat(24), productId = 'b'.repeat(24), drinkId = 'c'.repeat(24);
const paths = { caps: '/r/recette/compte/capacites', session: '/r/recette/compte/session',
  source: '/r/recette/compte/commandes/recommander', site: '/api/public/tenants/recette/site' };
const existing: CartLine = { lineId: 'existing-drink', productId: drinkId, name: 'Canette recette',
  photoUrl: null, variantKey: null, variantName: null, options: [], removed: [], note: 'Sans glaçons', qty: 1, unitPrice: 150 };
function site() {
  const raw = demoSite(new Date(), () => 0); raw.tenant.slug = 'recette';
  raw.menu = { categories: [{ _id: 'd'.repeat(24), name: 'Notre carte', products: [
    { _id: productId, name: 'Burger du Comptoir', description: '', tags: [], medias: [], isNew: false, price, variants: [], outOfStock: false,
      optionGroups: [{ key: 'sauce', name: 'Sauce', type: 'single', min: 1, max: 1,
        choices: [{ key: 'maison', name: 'Sauce maison', priceDelta: 0 }] }],
      supplements: [{ key: 'cheddar', label: 'Cheddar', priceCents: 100, category: 'fromage' }],
      removables: [{ key: 'oignons', label: 'Oignons' }], photoUrl: null },
    { _id: drinkId, name: existing.name, description: '', tags: [], medias: [], isNew: false, removables: [], price: existing.unitPrice, variants: [],
      outOfStock: false, optionGroups: [], supplements: [], photoUrl: null },
  ] }] };
  return raw;
}
function source() { return { orderId, number: 4242, expiresAt: sourceExpiresAt,
  lines: [{ productId, name: 'Ancien nom burger', variantKey: null, variantName: null, qty: 2, unitPrice: 900,
    options: [{ groupKey: 'sauce', choiceKey: 'maison' }, { groupKey: 'supplements', choiceKey: 'cheddar' }], removed: ['oignons'] }] }; }
function json(response: ServerResponse, body: unknown, status = 200) {
  const value = JSON.stringify(body);
  response.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(value), 'X-Sm-Reorder-Fixture': String(++serial) }).end(value);
}
beforeAll(async () => {
  captures = await mkdtemp(join(tmpdir(), 'sm-reorder-flow-'));
  const cssPath = fileURLToPath(new URL('../../app/globals.css', import.meta.url));
  const [bundle, css] = await Promise.all([
    build({ stdin: { loader: 'tsx', sourcefile: 'reorder-browser-fixture.tsx', resolveDir: fileURLToPath(new URL('.', import.meta.url)), contents: `
      import React from 'react';import{createRoot}from'react-dom/client';import{ReorderFlow}from'./ReorderFlow';
      import{useCustomerAccount}from'./useCustomerAccount';import{sameOrderAccess}from'./orders';
      import{Sheet}from'../order/primitives';import*as journal from'../order/checkout-attempt';
      import{marqueDeRepli,CustomerAccountResponses}from'@sm/contracts';import{styleDuMasque}from'../masque/styleDuMasque';
      import{parseCustomerOrderReorder}from'./orders-response';
      window.validateReorderBrowserResponse=(raw,path)=>{try{
        if(path.endsWith('/capacites'))return CustomerAccountResponses.status.safeParse(raw).success;
        if(path.endsWith('/session'))return CustomerAccountResponses.session.safeParse(raw).success;
        parseCustomerOrderReorder(raw,'${orderId}');return true}catch{return false}};
      const f=window.reorderBrowserFixture={journal};
      function App(){const account=useCustomerAccount('recette',true);const[pinned,setPinned]=React.useState(null);const[open,setOpen]=React.useState(false);
        f.access=account.currentAccess;f.logout=account.logout;f.refresh=account.refresh;
        const reading=!!pinned&&sameOrderAccess(pinned,account.currentAccess());
        return <main style={styleDuMasque(marqueDeRepli(null,null))} className="min-h-dvh bg-bg p-4 text-ink">
          <h1>Le Comptoir · recette navigateur</h1><button disabled={!account.currentAccess()} onClick={()=>{setPinned(account.currentAccess());setOpen(true)}}>Préparer une nouvelle commande</button>
          <Sheet open={open} title="Mon compte" onClose={()=>setOpen(false)}><div className="space-y-4 p-4 pb-5 sm:p-5">
            {reading?<ReorderFlow slug="recette" orderId="${orderId}" access={pinned} currentAccess={account.currentAccess} onBack={()=>setOpen(false)} onClose={()=>setOpen(false)}/>:<p role="status">Votre accès privé est masqué.</p>}
          </div></Sheet></main>}
      createRoot(document.getElementById('root')).render(<React.StrictMode><App/></React.StrictMode>);` },
      bundle: true, write: false, format: 'esm', platform: 'browser', target: 'es2022', jsx: 'automatic', outdir: '/virtual-reorder-browser',
      alias: { react: fileURLToPath(new URL('../../../node_modules/react', import.meta.url)), 'react-dom': fileURLToPath(new URL('../../../node_modules/react-dom', import.meta.url)) },
      define: { 'process.env': '{}', 'process.env.NODE_ENV': '"production"', 'process.env.NEXT_PUBLIC_API_URL': '"/api"' } }),
    readFile(cssPath, 'utf8').then(value => postcss([tailwind({ base: fileURLToPath(new URL('../../..', import.meta.url)) })]).process(value, { from: cssPath })),
  ]);
  server = createServer(async (request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self'; frame-src 'none'; form-action 'none'; base-uri 'none'");
    const path = new URL(request.url ?? '/', origin).pathname;
    if (request.method === 'GET' && path === '/app.js') { response.setHeader('Content-Type', 'text/javascript'); response.end(bundle.outputFiles.find(file => file.path.endsWith('.js'))!.text); return; }
    if (request.method === 'GET' && path === '/style.css') { response.setHeader('Content-Type', 'text/css'); response.end(css.css + (bundle.outputFiles.find(file => file.path.endsWith('.css'))?.text ?? '')); return; }
    if (request.method === 'GET' && path === '/favicon.ico') { response.writeHead(204).end(); return; }
    if (request.method === 'GET' && (path === '/' || path === '/empty')) {
      response.setHeader('Content-Type', 'text/html'); response.end(`<!doctype html><html lang="fr"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Reorder browser fixture</title><link rel="stylesheet" href="/style.css"><div id="root"></div>${path === '/' ? '<script type="module" src="/app.js"></script>' : ''}</html>`); return;
    }
    let text = ''; for await (const chunk of request) { text += chunk.toString(); if (text.length > 4096) { faults.push('Oversize fixture request'); request.destroy(); return; } }
    const body = text ? JSON.parse(text) as Record<string, unknown> : {};
    calls.push({ method: request.method!, path, body, operation: request.headers['x-sm-customer-operation-id'] as string | undefined });
    if (request.method === 'GET' && path === paths.caps) { json(response, { available: false }); return; }
    if (path === paths.session && request.method === 'DELETE') { authenticated = false; response.writeHead(204, { 'X-Sm-Reorder-Fixture': String(++serial) }).end(); return; }
    if (path === paths.session && request.method === 'GET' && authenticated) {
      json(response, { expiresAt, profile: { name: 'Camille recette privée', phoneE164: '+33600000001', phoneVerifiedAt: 1_700_000_000_000, revision: 0 } }); return;
    }
    if (request.method === 'GET' && path === paths.site) { json(response, site()); return; }
    if (request.method === 'POST' && path === paths.source && body.orderId === orderId) {
      if (hold) { held = { response, body: source() }; return; } json(response, source()); return;
    }
    faults.push(`Unexpected fixture request ${request.method} ${path}`); json(response, {}, 404);
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); if (!address || typeof address === 'string') throw Error('Missing fixture address');
  origin = `http://127.0.0.1:${address.port}`; browser = await chromium.launch({ headless: true });
}, 30_000);
beforeEach(async () => {
  faults = []; calls = []; price = 850; expiresAt = Date.now() + 300_000; sourceExpiresAt = expiresAt;
  authenticated = true; hold = false; held = null; serial = 0; failed = []; wires = new WeakMap(); proofs = {}; inflight = new Set(); confirmedLogoutIds = new Set();
  context = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce', serviceWorkers: 'block' });
  lockPage = await context.newPage(); await lockPage.goto(origin + '/empty');
  page = await context.newPage(); page.setDefaultTimeout(5_000);
  await page.exposeFunction('reorderReadObservation', (id: string, proof: ReadProof) => { proofs[id] = proof; });
  await page.addInitScript(() => {
    const fetch = window.fetch.bind(window);
    window.fetch = async (...args) => {
      const response = await fetch(...args), id = response.headers.get('x-sm-reorder-fixture');
      const path = new URL(response.url).pathname;
      if (id && [ '/r/recette/compte/capacites', '/r/recette/compte/session', '/r/recette/compte/commandes/recommander' ].includes(path)) {
        const proof: ReadProof = { bytes: 0, eof: false, valid: false, failed: false, empty: response.body === null, noContent: response.status === 204 };
        const observe = () => { void window.reorderReadObservation(id, { ...proof }); };
        if (response.status === 204) observe();
        if (!response.body) { proof.eof = true; proof.valid = response.status === 204; observe(); return response; }
        const getReader = response.body.getReader.bind(response.body);
        Object.defineProperty(response.body, 'getReader', { value: () => {
          const reader = getReader() as ReadableStreamDefaultReader<Uint8Array>, read = reader.read.bind(reader), cancel = reader.cancel.bind(reader);
          const decoder = new TextDecoder('utf-8', { fatal: true }); let text = '';
          reader.read = () => {
            const pending = read();
            void pending.then(chunk => {
              proof.bytes += chunk.value?.byteLength ?? 0;
              try {
                if (proof.bytes > 1_048_576) throw Error('Oversize fixture response');
                if (chunk.done) { proof.eof = true; proof.valid = window.validateReorderBrowserResponse(JSON.parse(text + decoder.decode()), path); text = ''; }
                else text += decoder.decode(chunk.value, { stream: true });
              } catch { proof.failed = true; text = ''; }
              observe();
            }, () => { proof.failed = true; observe(); });
            return pending; // Preserve the original native reader, promise and errors.
          };
          reader.cancel = reason => { proof.failed = true; observe(); return cancel(reason); };
          return reader;
        } });
        args[1]?.signal?.addEventListener('abort', () => { proof.failed = true; observe(); }, { once: true });
      }
      return response;
    };
  });
  page.on('pageerror', error => faults.push(error.message));
  page.on('request', request => { inflight.add(request); if (new URL(request.url()).origin !== origin) faults.push('External request refused by fixture CSP'); });
  page.on('console', message => { if (['error', 'warning'].includes(message.type())) faults.push(message.text()); });
  page.on('response', response => { const headers = response.headers(), id = headers['x-sm-reorder-fixture'];
    if (id) wires.set(response.request(), { id, length: Number(headers['content-length']), status: response.status(), mime: headers['content-type'] ?? '' }); });
  page.on('requestfinished', request => inflight.delete(request));
  page.on('requestfailed', request => { inflight.delete(request); failed.push({ request, error: request.failure()?.errorText }); });
  await page.goto(origin + '/empty'); await seedCustomerBrowserFixture(page, 'recette');
  await page.evaluate(line => { localStorage.setItem('sm.cart.recette', JSON.stringify({ v: 1, at: Date.now(), lines: [line], note: 'Note du panier actuel' })); }, existing);
  await page.goto(origin); await page.waitForFunction(() => !!window.reorderBrowserFixture?.access());
});
afterEach(async () => {
  const writes = calls.filter(call => call.method !== 'GET' && ![paths.source, paths.session].includes(call.path));
  await expect.poll(() => inflight.size).toBe(0);
  held?.response.destroy(); held = null;
  await context.close();
  // Chromium can report ERR_ABORTED after a verified bounded reader result.
  // Only this exact request's valid complete JSON qualifies, never URL/status
  // alone. No claim is made about Chromium's internal event-order cause.
  for (const failure of failed) {
    const wire = wires.get(failure.request), proof = wire && proofs[wire.id];
    const path = new URL(failure.request.url()).pathname, method = failure.request.method();
    const exactRead = (method === 'POST' && path === paths.source) || (method === 'GET' && [paths.session, paths.caps].includes(path));
    const jsonComplete = exactRead && wire?.status === 200 && wire.mime === 'application/json' && Number.isSafeInteger(wire.length)
      && wire.length > 0 && wire.length <= 1_048_576 && proof?.eof && proof.valid && !proof.empty && proof.bytes === wire.length;
    // 204 is an acknowledgement, not JSON. Its exact response must have been
    // observed by fetch AND accepted by logout(), with the private UI masked.
    const logoutAccepted = method === 'DELETE' && path === paths.session && wire?.status === 204
      && proof?.noContent && confirmedLogoutIds.has(wire.id) && proof.bytes === 0;
    const completed = failure.error === 'net::ERR_ABORTED' && proof && !proof.failed && (jsonComplete || logoutAccepted);
    if (!completed) { process.stdout.write(`Unclassified fixture notification ${JSON.stringify({ method, path, wire, proof })}\n`); faults.push(`Failed ${failure.request.method()} ${new URL(failure.request.url()).pathname}: ${failure.error}`); }
    else process.stdout.write(`Reorder fixture: verified ${logoutAccepted ? 'logout acknowledgement' : 'JSON'} despite Chromium notification (response ${wire!.id})\n`);
  }
  expect(writes).toEqual([]); expect(faults).toEqual([]);
});
afterAll(async () => {
  await browser?.close(); if (server) await new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()); });
  process.stdout.write(`Reorder flow captures: ${captures}\n`);
});
async function activate(locator: Locator) { await expect.poll(() => locator.isEnabled()).toBe(true); await locator.focus(); await locator.press('Enter'); }
async function open() { await activate(page.getByRole('button', { name: 'Préparer une nouvelle commande', exact: true })); }
const adding = () => page.getByRole('button', { name: /^Ajouter 2 articles/ });
const sourceCalls = () => calls.filter(call => call.path === paths.source);
const siteCalls = () => calls.filter(call => call.path === paths.site);
const cart = () => page.evaluate(() => JSON.parse(localStorage.getItem('sm.cart.recette')!) as { lines: CartLine[]; note: string });
async function prepared() { await open(); await expect.poll(() => adding().isEnabled()).toBe(true); }
async function holdCart() {
  const holder = lockPage;
  await holder.evaluate(() => {
    window.reorderBrowserFixture = { lockHeld: false } as Window['reorderBrowserFixture'];
    void navigator.locks.request('sm.cart.write.recette', () => new Promise<void>(resolve => {
      window.reorderBrowserFixture.lockHeld = true; window.reorderBrowserFixture.releaseLock = resolve;
    }));
  });
  await holder.waitForFunction(() => window.reorderBrowserFixture.lockHeld);
  return async () => holder.evaluate(() => window.reorderBrowserFixture.releaseLock!());
}
describe('reprise privée — vraie interface Chromium et stockage natif', () => {
  it.each([320, 390, 1440])('prévisualise puis ajoute sans écraser le panier, au clavier en %d px', async width => {
    await page.setViewportSize({ width, height: 844 }); await prepared();
    expect(await page.title()).toBe('Reorder browser fixture'); expect(page.url()).toBe(origin + '/');
    const dialog = page.getByRole('dialog', { name: 'Mon compte', exact: true });
    expect(await dialog.getByRole('heading', { name: 'On vous refait ça ?', exact: true }).count()).toBe(1);
    expect(await dialog.evaluate(element => element.contains(document.activeElement))).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    expect(await dialog.getByText('19,00 €', { exact: true }).last().evaluate(element => {
      const range = document.createRange(); range.selectNodeContents(element);
      return range.getClientRects().length === 1;
    })).toBe(true);
    expect(await adding().textContent()).toContain('19,00');
    expect(await dialog.getByText('L’article déjà dans votre panier sera conservé.', { exact: true }).count()).toBe(1);
    expect((await cart()).lines).toEqual([existing]); expect(sourceCalls()).toHaveLength(1); expect(siteCalls()).toHaveLength(1);
    await page.screenshot({ path: join(captures, `reorder-ready-${width}.png`) });
    await activate(adding()); await page.getByRole('link', { name: 'Retrouver mon panier', exact: true }).waitFor();
    expect(await page.getByRole('link', { name: 'Retrouver mon panier', exact: true }).getAttribute('href')).toBe('/r/recette');
    const saved = await cart(); expect(saved.note).toBe('Note du panier actuel'); expect(saved.lines).toHaveLength(2);
    expect(saved.lines[0]).toEqual(existing);
    expect(saved.lines[1]).toMatchObject({ productId, name: 'Burger du Comptoir', qty: 2, unitPrice: 950, note: null,
      removed: ['oignons'], options: [{ groupKey: 'sauce', choiceKey: 'maison', name: 'Sauce maison' },
        { groupKey: 'supplements', choiceKey: 'cheddar', name: 'Cheddar', priceDelta: 100 }] });
    expect(saved.lines[1]!.lineId).not.toMatch(/reorder-preview|existing-drink/);
    for (const forbidden of [orderId, '4242', 'Camille recette privée', 'phoneE164', 'trackingToken', 'payment']) expect(JSON.stringify(saved)).not.toContain(forbidden);
    expect(sourceCalls()).toHaveLength(2); expect(siteCalls()).toHaveLength(2);
    expect(sourceCalls().every(call => call.method === 'POST' && call.operation === '20000000-0000-4000-8000-000000000002' && JSON.stringify(call.body) === JSON.stringify({ orderId }))).toBe(true);
    expect(await adding().count()).toBe(0);
    await page.screenshot({ path: join(captures, `reorder-added-${width}.png`) });
    await page.reload(); await page.waitForFunction(() => !!window.reorderBrowserFixture?.access()); expect(await cart()).toEqual(saved);
  });
  it('recalcule le prix avec supplément et exige une nouvelle confirmation quand il change', async () => {
    await prepared(); price = 950; await activate(adding());
    await page.getByRole('alert').filter({ hasText: 'La carte vient de changer' }).waitFor();
    expect((await cart()).lines).toEqual([existing]); expect(await adding().textContent()).toContain('21,00');
    await page.screenshot({ path: join(captures, 'reorder-price-change-390.png') });
    await activate(adding()); await page.getByRole('link', { name: 'Retrouver mon panier', exact: true }).waitFor();
    expect((await cart()).lines[1]!.unitPrice).toBe(1050); expect(sourceCalls()).toHaveLength(3); expect(siteCalls()).toHaveLength(3);
  });
  it('laisse la déconnexion agir pendant une lecture HTTP et jette la réponse privée tardive', async () => {
    hold = true; await open(); await expect.poll(() => !!held).toBe(true);
    expect(await page.evaluate(() => window.reorderBrowserFixture.logout())).toBe(true);
    await page.getByRole('status').filter({ hasText: 'Votre accès privé est masqué.' }).waitFor();
    await expect.poll(() => Object.entries(proofs).filter(([, proof]) => proof.noContent).length).toBe(1);
    confirmedLogoutIds.add(Object.entries(proofs).find(([, proof]) => proof.noContent)![0]);
    json(held!.response, held!.body); held = null; hold = false;
    await page.evaluate(async () => { await navigator.locks.request('sm:customer:recette', () => undefined); });
    expect(await page.getByText('Burger du Comptoir', { exact: false }).count()).toBe(0); expect(await adding().count()).toBe(0);
    expect((await cart()).lines).toEqual([existing]); expect(sourceCalls()).toHaveLength(1);
  });
  it('relit le journal natif après attente du verrou panier et refuse une autre identité', async () => {
    await prepared(); const release = await holdCart(); await activate(adding());
    await expect.poll(() => sourceCalls().length).toBe(2);
    await page.waitForFunction(async () => (await navigator.locks.query()).pending?.some(lock => lock.name === 'sm.cart.write.recette'));
    await page.evaluate(async () => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => { const request = indexedDB.open('sm-customer-preparation-v1', 1); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(Error('Fixture IDB')); });
      await new Promise<void>((resolve, reject) => { const tx = db.transaction('preparations', 'readwrite'), store = tx.objectStore('preparations'), read = store.get('recette');
        read.onsuccess = () => { const value = read.result; value.verification.operationId = '50000000-0000-4000-8000-000000000005'; value.verification.checkId = '60000000-0000-4000-8000-000000000006'; store.put(value, 'recette'); };
        tx.oncomplete = () => resolve(); tx.onabort = () => reject(Error('Fixture IDB')); }); db.close();
    });
    await release();
    const outcome = page.getByRole('alert').filter({ hasText: /Votre accès a changé|L’ajout n’a pas été confirmé/ });
    await outcome.waitFor();
    expect(await outcome.textContent()).toBe('Votre accès a changé. Revenez à votre compte avant de recommencer.');
    expect(await page.getByText('Burger du Comptoir', { exact: false }).count()).toBe(0);
    expect(await adding().count()).toBe(0);
    expect((await cart()).lines).toEqual([existing]); expect(sourceCalls()).toHaveLength(2);
  });
  it('refuse l’ajout lorsqu’une demande C01 native reste à vérifier', async () => {
    await prepared();
    await page.evaluate(async ({ productId }) => {
      const journal = window.reorderBrowserFixture.journal;
      await journal.acquireCheckoutAttempt('recette', { provenance: { kind: 'guest' }, cartFingerprint: await journal.checkoutCartFingerprint({ lines: [], note: '' }),
        payload: { lines: [{ productId, options: [], removed: [], qty: 1 }], payment: { method: 'counter' },
          pickup: { slot: '2030-09-09T18:00:00.000Z', customerName: 'Invité recette', customerPhone: '0600000001' } } });
    }, { productId });
    await activate(adding()); await page.getByRole('alert').filter({ hasText: 'L’ajout n’a pas été confirmé' }).waitFor();
    expect((await cart()).lines).toEqual([existing]);
    expect(await page.evaluate(async () => (await window.reorderBrowserFixture.journal.readCheckoutRecovery('recette')).active?.state)).toBe('prepared');
  });
  it.each(['offline', 'hidden'] as const)('masque la prévisualisation quand le document devient %s', async kind => {
    await prepared();
    await page.evaluate(kind => {
      if (kind === 'offline') { Object.defineProperty(navigator, 'onLine', { value: false, configurable: true }); window.dispatchEvent(new Event('offline')); }
      else { Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true }); document.dispatchEvent(new Event('visibilitychange')); }
    }, kind);
    await page.getByRole('status').filter({ hasText: 'Votre accès privé est masqué.' }).waitFor();
    expect(await page.getByText('Burger du Comptoir', { exact: false }).count()).toBe(0); expect(await adding().count()).toBe(0);
    expect((await cart()).lines).toEqual([existing]);
  });
  it('retire un aperçu dont l’autorisation serveur expire avant la session affichée', async () => {
    await page.clock.install(); sourceExpiresAt = Date.now() + 20_000; await prepared(); await page.clock.fastForward(20_001);
    await page.getByRole('button', { name: 'Réessayer la vérification', exact: true }).waitFor();
    expect(await adding().count()).toBe(0); expect(await page.getByText('Burger du Comptoir', { exact: false }).count()).toBe(0);
    expect((await cart()).lines).toEqual([existing]);
  });
});
