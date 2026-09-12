import { createServer, type Server } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import postcss from 'postcss';
import tailwind from '@tailwindcss/postcss';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { demoSite } from '../order/demo/fixture';
import { seedCustomerBrowserFixture } from './browser-journal.fixture';

// Real session, private reader, reorder guards and IndexedDB cart. Only the
// HTTP provider and the opaque device-receipt slot are local test fixtures.
declare global { interface Window { customerOrdersPageFixture: {
  mount(value: boolean): void; deviceLock(value: boolean): void; calls: string[]; locks: boolean[];
} } }
let server: Server, browser: Browser, context: BrowserContext, page: Page, origin: string;
let calls: string[], faults: string[], expiresAt: number, held: string | null, release: (() => void) | undefined, accessAvailable: boolean;
const base = '/r/recette/compte/';
const order = { _id: 'a'.repeat(24), number: 42, createdAt: '2026-09-09T12:00:00.000Z', status: 'delivered',
  type: 'pickup', pickupSlot: null, totalCents: 150,
  payment: { method: 'counter', status: 'paid', refundedCents: 0, pendingRefundCents: 0 } };
const productId = 'b'.repeat(24);

beforeAll(async () => {
  const root = fileURLToPath(new URL('.', import.meta.url));
  const cssPath = fileURLToPath(new URL('../../app/globals.css', import.meta.url));
  const [bundle, css] = await Promise.all([
    build({ stdin: { contents: `import React,{useState}from'react';import{createRoot}from'react-dom/client';
      import{CustomerOrdersPage}from'./CustomerOrdersPage';import{marqueDeRepli}from'@sm/contracts';import{styleDuMasque}from'../masque/styleDuMasque';
      const fixture=window.customerOrdersPageFixture={calls:[],locks:[]};
      const account=()=>fixture.calls.push('account'),back=()=>fixture.calls.push('back'),reordered=()=>fixture.calls.push('reordered'),locked=value=>fixture.locks.push(value);
      function Fixture(){const[open,mount]=useState(false),[deviceLocked,deviceLock]=useState(false);Object.assign(fixture,{mount,deviceLock});return <main style={styleDuMasque(marqueDeRepli(null,null))} className="min-h-dvh bg-bg p-4 text-ink"><h1>Restaurant de recette</h1>{open?<CustomerOrdersPage slug="recette" restaurantName="Le Comptoir" onAccount={account} onBack={back} onReordered={reordered} onNavigationLockedChange={locked} navigationLocked={deviceLocked} deviceOrders={<section aria-label="Reçus invités de cet appareil"><h3>Sur cet appareil</h3><p>Reçu invité n° 7</p><button onClick={()=>fixture.calls.push('guest')}>Ouvrir mon reçu invité</button></section>}/>:<button onClick={()=>mount(true)}>Ouvrir mes commandes</button>}</main>}
      createRoot(document.getElementById('root')).render(<React.StrictMode><Fixture/></React.StrictMode>);`,
      loader: 'tsx', resolveDir: root, sourcefile: 'customer-orders-page-ui.tsx' }, bundle: true, write: false,
      format: 'esm', platform: 'browser', target: 'es2022', jsx: 'automatic', outdir: '/virtual-customer-orders-page',
      define: { 'process.env': '{}', 'process.env.NODE_ENV': '"production"', 'process.env.NEXT_PUBLIC_API_URL': '"/api"' } }),
    readFile(cssPath, 'utf8').then(source => postcss([tailwind({ base: fileURLToPath(new URL('../../..', import.meta.url)) })]).process(source, { from: cssPath })),
  ]);
  server = createServer((request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self'; frame-src 'none'; form-action 'none'; base-uri 'none'");
    const path = request.url ?? '/';
    if (path === '/app.js') { response.setHeader('Content-Type', 'text/javascript'); response.end(bundle.outputFiles.find(file => file.path.endsWith('.js'))!.text); return; }
    if (path === '/style.css') { response.setHeader('Content-Type', 'text/css'); response.end(css.css + (bundle.outputFiles.find(file => file.path.endsWith('.css'))?.text ?? '')); return; }
    if (path === '/favicon.ico') { response.writeHead(204).end(); return; }
    if (path === '/') { response.setHeader('Content-Type', 'text/html'); response.end('<!doctype html><html lang="fr"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Orders page fixture</title><link rel="stylesheet" href="/style.css"><div id="root"></div><script type="module" src="/app.js"></script></html>'); return; }
    calls.push(`${request.method} ${path}`);
    const json = (value: unknown) => { if (!response.destroyed) { const body = JSON.stringify(value); response.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }); response.end(body); } };
    if (request.method === 'GET' && path === base + 'capacites') { json({ available: false, registrationAvailable: false, accessAvailable }); return; }
    if (request.method === 'GET' && path === base + 'session') { json({ expiresAt, profile: { name: 'Camille Recette', phoneE164: '+33600000000', phoneVerifiedAt: 1_700_000_000_000, revision: 0 } }); return; }
    if (request.method === 'GET' && path === '/api/public/tenants/recette/site') {
      const site = demoSite(new Date(), () => 0); site.tenant.slug = 'recette';
      site.menu = { categories: [{ _id: 'c'.repeat(24), name: 'Boissons', products: [{ _id: productId, name: 'Canette recette', price: 150,
        description: '', outOfStock: false, variants: [], optionGroups: [], removables: [], supplements: [], photoUrl: null, tags: [], isNew: false, medias: [] }] }] };
      json(site); return;
    }
    if (request.method !== 'POST' || !['commandes/recherche', 'commandes/detail', 'commandes/recommander'].some(action => path === base + action)) {
      faults.push(`Unexpected fixture request ${request.method} ${path}`); response.writeHead(404).end(); return;
    }
    let body = ''; request.on('data', chunk => { body += String(chunk); if (body.length > 4096) request.destroy(); });
    request.on('end', () => {
      JSON.parse(body); // The real client must send valid structured requests.
      const finish = () => {
        if (path.endsWith('/recherche')) json({ expiresAt, orders: [order], nextCursor: null });
        else if (path.endsWith('/detail')) json({ expiresAt, order: { ...order,
          totals: { subtotal: 150, total: 150, deliveryFee: 0, discount: null },
          lines: [{ name: 'Canette recette privée', qty: 1, unitPrice: 150, lineTotal: 150, variantName: null, options: [], removed: [], note: null }],
          note: 'Note privée de la commande', statusHistory: [], delivery: null } });
        else json({ expiresAt, orderId: order._id, number: order.number, lines: [{ productId, name: 'Canette recette', qty: 1, unitPrice: 150, variantKey: null, variantName: null, options: [], removed: [] }] });
      };
      if (held && path.endsWith(held)) release = finish; else finish();
    });
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('Missing fixture port');
  origin = `http://127.0.0.1:${address.port}`; browser = await chromium.launch({ headless: true });
}, 30_000);

beforeEach(async () => {
  calls = []; faults = []; held = null; release = undefined; accessAvailable = true; expiresAt = Date.now() + 60_000;
  context = await browser.newContext({ viewport: { width: 320, height: 780 }, reducedMotion: 'reduce', serviceWorkers: 'block' });
  page = await context.newPage(); page.setDefaultTimeout(5_000); page.on('pageerror', error => faults.push(error.message));
  await page.goto(origin); await page.getByRole('button', { name: 'Ouvrir mes commandes', exact: true }).waitFor();
});
afterEach(async () => { release?.(); await context.close(); expect(faults).toEqual([]); });
afterAll(async () => { await browser?.close(); await new Promise<void>(resolve => server?.close(() => resolve())); });

async function openVerified() {
  await seedCustomerBrowserFixture(page, 'recette');
  await page.getByRole('button', { name: 'Ouvrir mes commandes', exact: true }).click();
  await page.getByRole('button', { name: 'Voir la commande n° 42' }).waitFor();
}
async function detail() {
  await page.getByRole('button', { name: 'Voir la commande n° 42' }).click();
  await page.getByText('Note privée de la commande', { exact: true }).waitFor();
}
async function expectPrivateAbsent() {
  await expect.poll(() => page.getByRole('region', { name: 'Commandes de votre compte' }).count()).toBe(0);
  expect(await page.getByText('Note privée de la commande', { exact: true }).count()).toBe(0);
  expect(await page.getByText('Canette recette privée', { exact: false }).count()).toBe(0);
}

describe('unified orders destination', () => {
  it('propose Mon compte sans annoncer une connexion lorsque le pilote est fermé', async () => {
    accessAvailable = false;
    await page.getByRole('button', { name: 'Ouvrir mes commandes', exact: true }).click();
    await expect.poll(() => calls).toEqual([`GET ${base}capacites`]);
    await expect.poll(() => page.getByText('Vérification de votre session…', { exact: true }).count()).toBe(0);
    expect(await page.getByRole('button', { name: 'Se connecter à mon compte', exact: true }).count()).toBe(0);
    await page.getByRole('button', { name: 'Mon compte', exact: true }).click();
    expect(await page.evaluate(() => window.customerOrdersPageFixture.calls)).toEqual(['account']);
    expect(await page.getByRole('button', { name: 'Ouvrir mon reçu invité' }).isVisible()).toBe(true);
    await expectPrivateAbsent();
  });

  it('ne lit rien hors onglet et laisse les reçus invités ouverts sans compte', async () => {
    expect(calls).toEqual([]);
    await page.getByRole('button', { name: 'Ouvrir mes commandes', exact: true }).click();
    await page.getByRole('button', { name: 'Ouvrir mon reçu invité' }).click();
    await page.getByRole('button', { name: 'Se connecter à mon compte' }).click();
    expect(await page.evaluate(() => window.customerOrdersPageFixture.calls)).toEqual(['guest', 'account']);
    expect(await page.getByRole('tablist', { name: 'Source des commandes' }).count()).toBe(0);
    expect(calls.every(call => call === `GET ${base}capacites`)).toBe(true);
    await expectPrivateAbsent();
  });

  it.each([320, 390, 820])('sépare les sources, les relie au clavier et contient ses actions à %ipx', async width => {
    await page.setViewportSize({ width, height: 780 }); await openVerified();
    expect(await page.getByRole('heading', { name: 'Mes commandes', exact: true }).count()).toBe(1);
    expect(await page.getByRole('button', { name: 'Revenir à mon compte', exact: true }).count()).toBe(0);
    const accountTab = page.getByRole('tab', { name: 'Mon compte', exact: true });
    const deviceTab = page.getByRole('tab', { name: 'Cet appareil', exact: true });
    expect(await accountTab.getAttribute('aria-selected')).toBe('true');
    expect(await page.getByRole('tabpanel', { name: 'Mon compte', exact: true }).getAttribute('id')).toBe(await accountTab.getAttribute('aria-controls'));
    await accountTab.focus(); await page.keyboard.press('ArrowRight');
    await page.getByRole('tabpanel', { name: 'Cet appareil', exact: true }).waitFor(); await expectPrivateAbsent();
    expect(await deviceTab.evaluate(node => document.activeElement === node)).toBe(true);
    await page.keyboard.press('Home'); await page.getByRole('button', { name: 'Voir la commande n° 42' }).waitFor();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(await page.getByRole('tablist', { name: 'Source des commandes' }).getByRole('tab').evaluateAll(nodes => nodes.every(node => {
      const rect = node.getBoundingClientRect(); return rect.width >= 44 && rect.height >= 44 && rect.left >= 0 && rect.right <= innerWidth;
    }))).toBe(true);
  });

  it('détruit le détail privé quand on choisit les reçus de cet appareil', async () => {
    await openVerified(); await detail();
    await page.getByRole('tab', { name: 'Cet appareil', exact: true }).click(); await expectPrivateAbsent();
    await page.getByRole('tab', { name: 'Mon compte', exact: true }).click();
    await page.getByRole('button', { name: 'Voir la commande n° 42' }).waitFor();
    expect(await page.getByText('Note privée de la commande', { exact: true }).count()).toBe(0);
  });

  it('ramène le focus sur la liste au retour du détail sans titre redondant', async () => {
    await openVerified(); await detail();
    await page.getByRole('button', { name: 'Revenir à mes commandes', exact: true }).click();
    await page.getByRole('button', { name: 'Voir la commande n° 42' }).waitFor();
    await expect.poll(() => page.evaluate(() => document.activeElement?.getAttribute('aria-label'))).toBe('Commandes de votre compte');
    expect(await page.getByRole('heading', { name: 'Mes commandes', exact: true }).count()).toBe(1);
  });

  it.each(['offline', 'expiry'] as const)('retire immédiatement le privé après %s sans effacer les reçus invités', async reason => {
    if (reason === 'expiry') await page.clock.install();
    await openVerified(); await detail();
    if (reason === 'offline') { await context.setOffline(true); }
    else { await page.clock.fastForward(65_000); }
    await expectPrivateAbsent(); await page.getByRole('button', { name: 'Ouvrir mon reçu invité' }).waitFor();
  });

  it('refuse une réponse A tardive après changement de publication au profil identique', async () => {
    await openVerified(); held = '/detail';
    await page.getByRole('button', { name: 'Voir la commande n° 42' }).click(); await expect.poll(() => Boolean(release)).toBe(true);
    await page.evaluate(async () => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => { const request = indexedDB.open('sm-customer-preparation-v1', 1); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
      try { await new Promise<void>((resolve, reject) => {
        const tx = db.transaction('preparations', 'readwrite'); const store = tx.objectStore('preparations'); const request = store.get('recette');
        request.onsuccess = () => { const value = request.result; value.verification.operationId = '50000000-0000-4000-8000-000000000005'; store.put(value, 'recette'); };
        tx.oncomplete = () => resolve(); tx.onerror = tx.onabort = () => reject(new Error('Fixture journal update failed'));
      }); } finally { db.close(); }
      window.dispatchEvent(new Event('focus'));
    });
    await expectPrivateAbsent(); held = null; release?.();
    await page.getByRole('button', { name: 'Voir la commande n° 42' }).waitFor();
    expect(await page.getByText('Note privée de la commande', { exact: true }).count()).toBe(0);
  });

  it('verrouille les deux sources et les retours pendant la reprise, puis purge sur perte de session', async () => {
    await openVerified(); await detail();
    await page.getByRole('button', { name: 'Préparer à nouveau ce panier' }).click();
    await page.getByRole('button', { name: /^Ajouter 1 article/ }).waitFor();
    held = '/recommander'; await page.getByRole('button', { name: /^Ajouter 1 article/ }).click();
    await expect.poll(() => Boolean(release)).toBe(true);
    expect(await page.getByRole('tab', { name: 'Cet appareil', exact: true }).isDisabled()).toBe(true);
    expect(await page.getByRole('button', { name: 'Revenir à la carte', exact: true }).isDisabled()).toBe(true);
    expect(await page.getByRole('button', { name: 'Revenir à ma commande', exact: true }).isDisabled()).toBe(true);
    await page.getByRole('tab', { name: 'Cet appareil', exact: true }).evaluate(node => (node as HTMLButtonElement).click());
    expect(await page.getByRole('tab', { name: 'Mon compte', exact: true }).getAttribute('aria-selected')).toBe('true');
    expect(await page.evaluate(() => window.customerOrdersPageFixture.locks.at(-1))).toBe(true);
    await context.setOffline(true); await expectPrivateAbsent();
    expect(await page.getByRole('region', { name: 'Préparer à nouveau ce panier' }).count()).toBe(0);
    await expect.poll(() => page.evaluate(() => window.customerOrdersPageFixture.locks.at(-1))).toBe(false);
  });

  it('ne déverrouille pas le contrôleur des reçus quand sa source est en cours de mutation', async () => {
    await openVerified(); await page.getByRole('tab', { name: 'Cet appareil', exact: true }).click();
    await page.evaluate(() => window.customerOrdersPageFixture.deviceLock(true));
    await expect.poll(() => page.getByRole('tab', { name: 'Mon compte', exact: true }).isDisabled()).toBe(true);
    expect(await page.getByRole('button', { name: 'Revenir à la carte', exact: true }).isDisabled()).toBe(true);
    expect(await page.evaluate(() => window.customerOrdersPageFixture.locks)).toEqual([]);
  });

  it('déverrouille après ajout confirmé et ouvre le panier sans navigation concurrente', async () => {
    await openVerified(); await detail();
    await page.getByRole('button', { name: 'Préparer à nouveau ce panier' }).click();
    await page.getByRole('button', { name: /^Ajouter 1 article/ }).click();
    await page.getByRole('button', { name: 'Retrouver mon panier', exact: true }).waitFor();
    expect(await page.evaluate(() => window.customerOrdersPageFixture.locks)).toContain(true);
    expect(await page.evaluate(() => window.customerOrdersPageFixture.locks.at(-1))).toBe(false);
    expect(await page.getByRole('tab', { name: 'Cet appareil', exact: true }).isDisabled()).toBe(false);
    await page.getByRole('button', { name: 'Retrouver mon panier', exact: true }).click();
    expect(await page.evaluate(() => window.customerOrdersPageFixture.calls)).toEqual(['reordered']);
    expect(page.url()).toBe(origin + '/');
  });

  it('démonte le lecteur et refuse le détail en vol quand on quitte l’onglet', async () => {
    await openVerified(); held = '/detail';
    await page.getByRole('button', { name: 'Voir la commande n° 42' }).click(); await expect.poll(() => Boolean(release)).toBe(true);
    await page.evaluate(() => window.customerOrdersPageFixture.mount(false)); await expectPrivateAbsent();
    const before = calls.length; held = null; release?.();
    await page.getByRole('button', { name: 'Ouvrir mes commandes', exact: true }).waitFor();
    expect(calls).toHaveLength(before);
  });
});
