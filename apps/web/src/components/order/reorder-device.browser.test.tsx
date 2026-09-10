import { createServer, type Server, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import postcss from 'postcss';
import tailwind from '@tailwindcss/postcss';
import { beforeAll, beforeEach, afterEach, afterAll, describe, expect, it, vi } from 'vitest';
import { demoSite } from './demo/fixture';
import type * as Journal from './checkout-attempt';
import type * as Preferences from './device-preferences';
import type { CartApi } from './cart';
import type { MenuProduct } from './api';

declare global { interface Window { deviceV2Fixture: { journal: typeof Journal; preferences: typeof Preferences; cart: CartApi; apply: () => unknown } } }
const PRODUCT = 'd'.repeat(24), ORDER = 'a'.repeat(24);
const product: MenuProduct = { id: PRODUCT, name: 'Menu recette', description: '', price: 900, fromPrice: 900, variants: [],
  groups: [{ key: 'sauces', name: 'Sauces', type: 'multi', min: 1, max: 2, perVariant: null, choices: [{ key: 'samourai', name: 'Samouraï', priceDelta: 0 }, { key: 'blanche', name: 'Blanche', priceDelta: 0 }] }],
  supplements: [{ key: 'samourai', label: 'Extra sauce', priceCents: 50 }], removables: [{ key: 'oignons', label: 'Oignons' }], tags: [], isNew: false, outOfStock: false, photoUrl: null, configurable: true };
let server: Server, browser: Browser, context: BrowserContext, page: Page, origin: string;
let faults: string[], requests: string[], sourcePrice: number, holdSource: boolean, waiting: ServerResponse[];

// Real React, Sheet, IndexedDB, Web Locks and cart run in Chromium. Only HTTP
// responses are fixtures; this does not place or pay any external order.
beforeAll(async () => {
  const directory = fileURLToPath(new URL('.', import.meta.url));
  const cssPath = fileURLToPath(new URL('../../app/globals.css', import.meta.url));
  const [bundle, css] = await Promise.all([
    build({ stdin: { contents: `import React,{useMemo,useState} from 'react';import{createRoot}from'react-dom/client';
      import{DeviceOrdersSheet}from'./DeviceOrdersSheet';import{DevicePreferencesSheet}from'../customer-account/DevicePreferencesSheet';
      import*as journal from'./checkout-attempt';import*as preferences from'./device-preferences';import{useDevicePreferences}from'./device-preferences-store';
      import{indexMenu,useCart,newDraft}from'./cart';
      const product=${JSON.stringify(product)};const categories=[{id:'cat',name:'Menus',products:[product]}];
      function App(){const[slug,setSlug]=useState('recette'),[pane,setPane]=useState('cart'),[locked,setLocked]=useState(false);
        const[catalog,setCatalog]=useState(categories);const index=useMemo(()=>indexMenu(catalog),[catalog]);const cart=useCart(slug,index);const prefs=useDevicePreferences(slug);
        React.useLayoutEffect(()=>{window.deviceV2Fixture={journal,preferences,cart,apply:()=>preferences.applyDevicePreferences(newDraft(product),prefs.preferences)}});
        return <main className="min-h-dvh bg-bg p-4 text-ink"><nav className="flex flex-wrap gap-2"><button disabled={locked} onClick={()=>setPane('orders')}>Afficher les commandes</button><button disabled={locked} onClick={()=>setPane('cart')}>Afficher le panier</button><button disabled={locked} onClick={()=>setPane('preferences')}>Préférences de cet appareil</button><button disabled={locked} onClick={()=>setSlug('autre')}>Autre restaurant</button></nav>
          <p data-testid="cart-count">{cart.count}</p><p data-testid="cart-total">{cart.subtotal}</p><p data-testid="prefs-ready">{String(prefs.hydrated)}</p>
          <DeviceOrdersSheet presentation={location.pathname==='/sheet'?'sheet':'page'} open={pane==='orders'} slug={slug} tenantName={slug} onClose={()=>setPane('cart')} onNavigationLockedChange={setLocked} onReordered={()=>setPane('cart')} onCatalogVerified={setCatalog}/>
          <DevicePreferencesSheet open={pane==='preferences'} slug={slug} tenantName={slug} categories={catalog} onClose={()=>setPane('cart')}/>
        </main>}
      createRoot(document.getElementById('root')).render(<React.StrictMode><App/></React.StrictMode>);`, resolveDir: directory, sourcefile: 'device-v2-fixture.tsx', loader: 'tsx' },
      bundle: true, write: false, outdir: '/virtual-device-v2', format: 'esm', platform: 'browser', target: 'es2022', jsx: 'automatic',
      alias: { react: fileURLToPath(new URL('../../../node_modules/react', import.meta.url)), 'react-dom': fileURLToPath(new URL('../../../node_modules/react-dom', import.meta.url)) },
      define: { 'process.env': '{}', 'process.env.NODE_ENV': '"production"', 'process.env.NEXT_PUBLIC_API_URL': '"/api"' } }),
    readFile(cssPath, 'utf8').then(source => postcss([tailwind({ base: fileURLToPath(new URL('../../..', import.meta.url)) })]).process(source, { from: cssPath })),
  ]);
  const script = bundle.outputFiles.find(file => file.path.endsWith('.js'))!.text;
  const styles = css.css + (bundle.outputFiles.find(file => file.path.endsWith('.css'))?.text ?? '');
  server = createServer((req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const path = new URL(req.url ?? '/', origin).pathname;
    if (path === '/bundle.js' || path === '/style.css') { res.setHeader('Content-Type', path.endsWith('js') ? 'text/javascript' : 'text/css'); res.end(path.endsWith('js') ? script : styles); return; }
    if (['/page', '/sheet'].includes(path)) { res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"></head><body><div id="root"></div><script type="module" src="/bundle.js"></script></body></html>'); return; }
    requests.push(path); res.setHeader('Content-Type', 'application/json');
    if (path.endsWith('/reorder')) {
      if (holdSource) { waiting.push(res); return; }
      res.end(JSON.stringify({ tenantSlug: 'recette', orderId: ORDER, number: 12,
        lines: [{ productId: PRODUCT, name: 'Menu recette', variantKey: null, variantName: null, qty: 2, unitPrice: 800,
          options: [{ groupKey: 'sauces', choiceKey: 'samourai' }], removed: ['oignons'] }] })); return;
    }
    if (path === '/api/public/tenants/recette/site') {
      const raw = demoSite(new Date(), () => 0); raw.tenant.slug = 'recette';
      raw.menu = { categories: [{ _id: 'c'.repeat(24), name: 'Menus', products: [{ _id: PRODUCT, name: 'Menu recette', price: sourcePrice, description: '', tags: [], isNew: false, outOfStock: false, photoUrl: null, medias: [], variants: [],
        optionGroups: [{ key: 'sauces', name: 'Sauces', type: 'multi', min: 1, max: 2, choices: [{ key: 'samourai', name: 'Samouraï', priceDelta: 0 }, { key: 'blanche', name: 'Blanche', priceDelta: 0 }] }],
        removables: [{ key: 'oignons', label: 'Oignons' }], supplements: [{ key: 'samourai', label: 'Extra sauce', category: 'sauce', priceCents: 50 }] }] }] };
      res.end(JSON.stringify(raw)); return;
    }
    if (path.startsWith('/api/public/orders/')) { res.end(JSON.stringify({ _id: path.split('/').pop(), number: 12, status: 'ready', fulfillment: 'pickup', pickupSlot: null, payment: { method: 'online', status: 'pending' } })); return; }
    if (path.endsWith('/compte/capacites')) { faults.push('Unexpected private account capability read'); res.writeHead(503).end('{}'); return; }
    if (path === '/favicon.ico') { res.writeHead(204).end(); return; }
    faults.push(`Unexpected fixture request ${req.method} ${path}`); res.writeHead(404).end('{}');
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('Missing port'); origin = `http://127.0.0.1:${address.port}`;
  browser = await chromium.launch({ headless: true });
}, 30_000);
beforeEach(async () => {
  faults = []; requests = []; sourcePrice = 900; holdSource = false; waiting = [];
  context = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce', serviceWorkers: 'block' });
  await context.route('**/*', route => { if (new URL(route.request().url()).origin === origin) return route.continue(); faults.push('External request refused'); return route.abort(); });
  page = await context.newPage(); page.setDefaultTimeout(5_000); page.on('pageerror', error => faults.push(error.message));
  await page.goto(origin + '/page'); await ready(page);
});
afterEach(async () => { waiting.forEach(response => response.destroy()); await context?.close(); expect(faults).toEqual([]); });
afterAll(async () => { await browser?.close(); if (server) await new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()); }); });
const ready = (target: Page) => target.waitForFunction(() => !!window.deviceV2Fixture?.cart.hydrated && document.querySelector('[data-testid="prefs-ready"]')?.textContent === 'true');
const seed = async (target = page, active = false, orderId = ORDER) => target.evaluate(async ({ active, orderId, product }) => {
  const journal = window.deviceV2Fixture.journal;
  const payload: Journal.CheckoutBusinessPayload = { lines: [{ productId: product, options: [{ groupKey: 'sauces', choiceKey: 'samourai' }], removed: ['oignons'], qty: 2 }],
    pickup: { slot: '2030-09-07T12:00:00.000Z', customerName: 'Recette locale', customerPhone: '0600000000' }, payment: { method: 'online' } };
  const next = await journal.acquireCheckoutAttempt('recette', { payload, cartFingerprint: 'a'.repeat(64) });
  await journal.recordCheckoutReceipt('recette', next.attempt.clientId, { orderId, trackingToken: 'guest-capability', number: 12, type: 'pickup', status: 'delivered', payment: { method: 'online', status: 'paid' } });
  if (!active) await journal.archiveCheckoutAttempt('recette', next.attempt.clientId);
}, { active, orderId, product: PRODUCT });
const commands = async (target = page) => { await target.getByRole('button', { name: 'Afficher les commandes', exact: true }).click(); await target.getByRole('button', { name: 'Actualiser les états', exact: true }).waitFor(); };
const preferences = async () => { await page.getByRole('button', { name: 'Préférences de cet appareil', exact: true }).click(); await page.getByRole('dialog', { name: 'Cet appareil', exact: true }).waitFor(); };

describe('préférences et recommander — navigateur et stockage natifs', () => {
  it('utilise le même historique en page/sheet, sans lecture avant ouverture ni faux paiement depuis le reçu', async () => {
    await seed(); expect(requests).toEqual([]); await commands();
    await page.getByText('Paiement à confirmer', { exact: true }).waitFor(); expect(await page.getByRole('dialog').count()).toBe(0);
    expect(requests.filter(path => path.startsWith('/api/public/orders/'))).toHaveLength(1);
    await page.setViewportSize({ width: 820, height: 1180 }); await page.setViewportSize({ width: 320, height: 568 });
    expect(await page.getByRole('button', { name: 'Recommander', exact: true }).isVisible()).toBe(true);
    await page.getByRole('button', { name: 'Afficher le panier', exact: true }).click();
    await page.evaluate(() => window.dispatchEvent(new Event('online'))); expect(requests.filter(path => path.startsWith('/api/public/orders/'))).toHaveLength(1);
    await page.goto(origin + '/sheet'); await ready(page); await commands(); await page.getByRole('dialog', { name: 'Mes commandes', exact: true }).waitFor();
    await page.keyboard.press('Escape'); await page.getByRole('dialog', { name: 'Mes commandes', exact: true }).waitFor({ state: 'hidden' });
  });
  it('ajoute une reprise revue au panier existant et garde choix, prix actuel et identifiants uniques au rechargement', async () => {
    await seed();
    await page.evaluate(productId => window.deviceV2Fixture.cart.upsert({ lineId: 'existing', productId, name: 'Menu recette', photoUrl: null, variantKey: null, variantName: null,
      options: [{ groupKey: 'sauces', choiceKey: 'blanche', groupName: 'Sauces', name: 'Blanche', priceDelta: 0 }], removed: [], note: 'Conserver', qty: 1, unitPrice: 900 }), PRODUCT);
    await page.waitForFunction(() => window.deviceV2Fixture.cart.count === 1); await commands();
    await page.getByRole('button', { name: 'Recommander', exact: true }).click(); await page.getByRole('button', { name: /Ajouter ces articles/ }).waitFor();
    await page.getByText(/Prix actualisé/).waitFor(); expect(await page.getByTestId('cart-count').textContent()).toBe('1');
    await page.getByRole('button', { name: /Ajouter ces articles/ }).click(); await page.getByRole('button', { name: 'Retrouver mon panier', exact: true }).waitFor();
    expect(await page.getByTestId('cart-count').textContent()).toBe('3'); expect(await page.getByTestId('cart-total').textContent()).toBe('2700');
    const lines = await page.evaluate(() => window.deviceV2Fixture.cart.lines);
    expect(lines[0].note).toBe('Conserver'); expect(lines[1]).toMatchObject({ qty: 2, note: null, removed: ['oignons'], unitPrice: 900 });
    expect(lines[1].options).toContainEqual(expect.objectContaining({ groupKey: 'sauces', choiceKey: 'samourai' }));
    expect(new Set(lines.map(line => line.lineId)).size).toBe(2);
    await page.reload(); await ready(page); expect(await page.getByTestId('cart-count').textContent()).toBe('3');
  });
  it('partage la carte vérifiée avec le panier parent quand le prix passe de 900 à 1000', async () => {
    await seed();
    await page.evaluate(productId => window.deviceV2Fixture.cart.upsert({ lineId: 'existing', productId, name: 'Menu recette', photoUrl: null, variantKey: null, variantName: null,
      options: [{ groupKey: 'sauces', choiceKey: 'blanche', groupName: 'Sauces', name: 'Blanche', priceDelta: 0 }], removed: [], note: 'Conserver', qty: 1, unitPrice: 900 }), PRODUCT);
    await page.waitForFunction(() => window.deviceV2Fixture.cart.subtotal === 900);
    sourcePrice = 1000; await commands(); await page.getByRole('button', { name: 'Recommander', exact: true }).click();
    await page.getByRole('button', { name: /Ajouter ces articles/ }).waitFor();
    await page.waitForFunction(() => window.deviceV2Fixture.cart.subtotal === 1000);
    await page.getByRole('button', { name: /Ajouter ces articles/ }).click();
    await page.getByRole('button', { name: 'Retrouver mon panier', exact: true }).click();
    await page.waitForFunction(() => window.deviceV2Fixture.cart.count === 3 && window.deviceV2Fixture.cart.subtotal === 3000);
    expect(await page.evaluate(() => window.deviceV2Fixture.cart.lines.map(line => line.unitPrice))).toEqual([1000, 1000]);
    await commands(); await page.getByRole('button', { name: 'Afficher le panier', exact: true }).click();
    expect(await page.getByTestId('cart-total').textContent()).toBe('3000');
  });
  it('refuse un reçu oublié dans un autre onglet pendant une lecture retardée', async () => {
    await seed(); await commands(); holdSource = true; await page.getByRole('button', { name: 'Recommander', exact: true }).click();
    await vi.waitFor(() => expect(waiting).toHaveLength(1));
    const other = await context.newPage(); await other.goto(origin + '/page'); await ready(other);
    await other.evaluate(id => window.deviceV2Fixture.journal.forgetDeviceCheckoutReceipt('recette', id), ORDER);
    await page.getByRole('button', { name: 'Réessayer la vérification', exact: true }).waitFor();
    waiting.forEach(response => response.end(JSON.stringify({ tenantSlug: 'recette', orderId: ORDER, number: 12, lines: [] })));
    expect(await page.getByTestId('cart-count').textContent()).toBe('0'); expect(await page.getByRole('button', { name: /Ajouter ces articles/ }).count()).toBe(0);
  });
  it('mémorise des choix exacts après consentement, les synchronise et ne les applique pas à un autre restaurant', async () => {
    await preferences();
    await page.getByRole('checkbox', { name: 'Sans oignons', exact: true }).check(); await page.getByRole('checkbox', { name: 'Samouraï', exact: true }).check();
    await page.setViewportSize({ width: 820, height: 1180 }); await page.setViewportSize({ width: 320, height: 568 });
    expect(await page.getByRole('checkbox', { name: 'Sans oignons', exact: true }).isChecked()).toBe(true);
    await page.getByRole('button', { name: 'Enregistrer mes préférences', exact: true }).click(); await page.getByText('Préférences enregistrées pour vos prochaines fiches produit.', { exact: true }).waitFor();
    await page.waitForFunction(() => (window.deviceV2Fixture.apply() as { removed: string[] }).removed.includes('oignons'));
    expect(await page.evaluate(() => window.deviceV2Fixture.apply())).toMatchObject({ removed: ['oignons'], picked: { sauces: ['samourai'] }, note: '', qty: 1 });
    await page.reload(); await ready(page); expect(await page.evaluate(() => window.deviceV2Fixture.apply())).toMatchObject({ removed: ['oignons'] });
    await page.getByRole('button', { name: 'Autre restaurant', exact: true }).click();
    await page.waitForFunction(() => (window.deviceV2Fixture.apply() as { removed: string[] }).removed.length === 0);
    expect(await page.evaluate(() => window.deviceV2Fixture.preferences.readDevicePreferences('recette'))).toEqual({ removed: ['oignons'], sauces: ['samourai'] });
  });
  it('un effacement ciblé garde le reçu actif, le panier et les demandes à vérifier', async () => {
    await seed(page, false, 'b'.repeat(24)); await seed(page, true);
    await page.evaluate(productId => window.deviceV2Fixture.cart.upsert({ lineId: 'preserve', productId, name: 'Menu recette', photoUrl: null, variantKey: null, variantName: null,
      options: [{ groupKey: 'sauces', choiceKey: 'blanche', groupName: 'Sauces', name: 'Blanche', priceDelta: 0 }], removed: [], note: 'À conserver', qty: 1, unitPrice: 900 }), PRODUCT);
    await page.waitForFunction(() => window.deviceV2Fixture.cart.count === 1);
    await page.evaluate(async () => { await window.deviceV2Fixture.preferences.saveDevicePreferences('recette', { removed: ['oignons'], sauces: ['blanche'] });
      await window.deviceV2Fixture.preferences.saveDevicePreferences('autre', { removed: ['oignons'], sauces: [] }); });
    await preferences(); await page.getByRole('button', { name: 'Effacer ces données', exact: true }).click(); await page.getByRole('button', { name: 'Confirmer l’effacement', exact: true }).click();
    await page.getByText(/Le raccourci de la commande encore active est conservé/).waitFor();
    const state = await page.evaluate(async () => ({ receipts: await window.deviceV2Fixture.journal.readDeviceCheckoutReceipts('recette'),
      active: await window.deviceV2Fixture.journal.readCheckoutAttempt('recette'), prefs: await window.deviceV2Fixture.preferences.readDevicePreferences('recette'), other: await window.deviceV2Fixture.preferences.readDevicePreferences('autre') }));
    expect(state.receipts.map(row => row.receipt.orderId)).toEqual([ORDER]); expect(state.active?.state).toBe('received');
    expect(await page.evaluate(() => window.deviceV2Fixture.cart.lines[0])).toMatchObject({ qty: 1, unitPrice: 900, note: 'À conserver' });
    expect(state.prefs).toEqual({ removed: [], sauces: [] }); expect(state.other.removed).toEqual(['oignons']);
    await page.keyboard.press('Escape');
    await page.evaluate(async () => { const j = window.deviceV2Fixture.journal; const active = await j.readCheckoutAttempt('recette'); if (!active) throw new Error('missing'); await j.archiveCheckoutAttempt('recette', active.clientId);
      await j.acquireCheckoutAttempt('recette', { cartFingerprint: 'a'.repeat(64), payload: { lines: [{ productId: 'd'.repeat(24), options: [], removed: [], qty: 1 }], payment: { method: 'counter' }, pickup: { slot: '2030-09-07T12:00:00.000Z', customerName: 'Pending name', customerPhone: '0600000000' } } }); });
    const before = await page.evaluate(() => window.deviceV2Fixture.journal.readCheckoutAttempt('recette'));
    await preferences(); await page.getByRole('button', { name: 'Effacer ces données', exact: true }).click(); await page.getByRole('button', { name: 'Confirmer l’effacement', exact: true }).click(); await page.getByText(/Effacement terminé/).waitFor();
    expect(await page.evaluate(() => window.deviceV2Fixture.journal.readCheckoutAttempt('recette'))).toEqual(before);
  });
  it('annonce un refus de stockage sans faire croire à un enregistrement', async () => {
    await preferences(); await page.getByRole('checkbox', { name: 'Sans oignons', exact: true }).check();
    await page.evaluate(() => { const original = Storage.prototype.setItem; Storage.prototype.setItem = function(key, value) { if (key.startsWith('sm.order-preferences.')) throw new DOMException('Blocked', 'QuotaExceededError'); original.call(this, key, value); }; });
    await page.getByRole('button', { name: 'Enregistrer mes préférences', exact: true }).click(); await page.getByRole('alert').filter({ hasText: 'n’ont pas pu être enregistrées' }).waitFor();
    expect(await page.evaluate(() => window.deviceV2Fixture.preferences.readDevicePreferences('recette'))).toEqual({ removed: [], sauces: [] });
  });
});
