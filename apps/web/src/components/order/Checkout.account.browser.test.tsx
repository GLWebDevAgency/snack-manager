import { createServer, type Server, type ServerResponse } from 'node:http';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import postcss from 'postcss';
import tailwind from '@tailwindcss/postcss';
import { chromium, type Browser, type BrowserContext, type Page, type Locator } from 'playwright';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { seedCustomerBrowserFixture } from '../customer-account/browser-journal.fixture';
import type * as Journal from './checkout-attempt';

declare global { interface Window { checkoutAccountFixture: {
  journal: typeof Journal; clears: number; accountStatus: string; logout(): Promise<boolean>; refresh(): Promise<void>;
  access(): Journal.CheckoutAccountAccess | null; latePaid?: () => void;
  cartSnapshot: unknown; clearEntered: number; lockHeld?: boolean; releaseLock?: () => void; logoutResult?: boolean;
  changeCart(): void; lateStart?: () => boolean;
} } }
let server: Server, browser: Browser, context: BrowserContext, page: Page, origin: string, captures: string;
let faults: string[], calls: { path: string; body: Record<string, unknown>; headers: Record<string, string | string[] | undefined> }[];
let authenticated: boolean, expiresAt: number, verifiedAt: number, holdCreate: boolean, holdPayment: boolean;
let heldCreate: { res: ServerResponse; body: unknown } | null, heldPayment: ServerResponse | null;
let holdRecovery: boolean, heldRecovery: ServerResponse | null, accountReads: number;
let heldAbandon: ServerResponse | null;
const orderId = 'b'.repeat(24), iso = '2030-09-09T16:00:00.000Z';
const slots = { date: '2030-09-09', timezone: 'Europe/Paris', intervalMin: 10, capacity: 4, leadTimeMin: 30,
  slots: [{ iso, label: '18:00', service: 'dinner', remaining: 4, full: false, load: 'calm' }], closedToday: false, nextOpenDate: null, closureReason: null, paused: false };
const order = (method = 'counter') => ({ _id: orderId, number: 4242, status: 'new', type: 'pickup',
  payment: { method, status: 'pending' }, totals: { subtotal: 500, deliveryFee: 0, discount: null, total: 500 },
  pickup: { slot: iso, customerName: 'Compte Recette' }, delivery: null, trackingToken: 'fixture-tracking' });
const recovered = () => ({ _id: orderId, number: 4242, status: 'new', type: 'pickup', trackingToken: 'fixture-tracking',
  payment: { method: 'online', status: 'pending' }, totals: { total: 500 }, pickup: { slot: iso } });
const payment = { unavailable: false, publishableKey: 'pk_test_fixture', clientSecret: 'fixture-secret', stripeAccount: 'acct_fixture', paymentIntentId: 'pi_fixture', currency: 'eur', amount: 500 };
function json(res: ServerResponse, value: unknown, status = 200) {
  const body = JSON.stringify(value); res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }).end(body);
}

// Real Checkout, account/recovery hooks, native IDB + Web Locks, actual HTTP.
// Provider widgets are explicit fixtures: no Stripe, Turnstile, SMS or real order.
beforeAll(async () => {
  captures = await mkdtemp(join(tmpdir(), 'sm-checkout-account-'));
  const cssPath = fileURLToPath(new URL('../../app/globals.css', import.meta.url));
  const bundle = await build({ stdin: { loader: 'tsx', resolveDir: fileURLToPath(new URL('.', import.meta.url)), contents: `
    import React from 'react';import{createRoot}from'react-dom/client';import{Checkout}from'./Checkout';
    import{useCheckoutRecovery}from'./useCheckoutRecovery';import{useCustomerAccount}from'../customer-account/useCustomerAccount';
    import{Storefront}from'./Storefront';import{orderingApi}from'./api';import{demoSite}from'./demo/fixture';
    import*as journal from'./checkout-attempt';import{marqueDeRepli}from'@sm/contracts';import{styleDuMasque}from'../masque/styleDuMasque';
    const line={lineId:'line',productId:'${'a'.repeat(24)}',name:'Article de recette',photoUrl:null,variantKey:null,variantName:null,options:[],removed:[],note:null,qty:1,unitPrice:500};
    const f=window.checkoutAccountFixture={journal,clears:0,clearEntered:0,cartSnapshot:{lines:[line],note:''}};
    function App(){const[lines,setLines]=React.useState([line]);const[open,setOpen]=React.useState(true);
      const account=useCustomerAccount('recette',true);const recovery=useCheckoutRecovery('recette',false);
      f.logout=account.logout;f.refresh=account.refresh;f.access=account.currentCheckoutAccess;f.accountStatus=account.state.status;
      f.changeCart=()=>setLines([{...line,qty:2}]);
      const cart=React.useMemo(()=>({lines,note:'',count:lines.length,subtotal:lines.length*500,hydrated:true,dropped:[],persistenceError:null,
        clearDropped:()=>{},upsert:()=>{},setQty:()=>{},remove:()=>{},setNote:()=>{},clear:()=>{f.clears++;setLines([])},
        clearIfUnchanged:async(canClear)=>{f.clearEntered++;return navigator.locks.request('sm.cart.write.recette',()=>{
          if(canClear&&!canClear())return false;f.clears++;setLines([]);return true})}}),[lines]);
      return <main style={styleDuMasque(marqueDeRepli(null,null))} className="min-h-dvh bg-bg text-ink"><h1>Checkout compte fixture</h1>
        <button onClick={()=>setOpen(true)}>Rouvrir</button><Checkout open={open} recovery={recovery} slug="recette" tenantName="Restaurant de recette" tenantAddress="Adresse de recette"
          stripeApparence={{}} mode="dark" prixMono={false} cart={cart} paused={false} pauseMessage={null} initialSlots={${JSON.stringify(slots)}}
          onClose={()=>setOpen(false)} onBrowse={()=>{}} onEditLine={()=>{}}/></main>}
    async function start(){let node=<App/>;if(location.pathname==='/embed-storefront'){
      const raw=demoSite(new Date(),()=>0);raw.tenant.slug='recette';raw.tenant.brand=marqueDeRepli(null,null);
      raw.menu={categories:[{_id:'${'c'.repeat(24)}',name:'Boissons',products:[{_id:'${'d'.repeat(24)}',name:'Canette recette',price:150,available:true,stockout:false,variants:[],optionGroups:[],ingredients:[],supplements:[],photoUrl:null}]}]};
      const api=orderingApi({send:async request=>({status:200,body:request.path.includes('/slots')?raw.slots:raw})});
      node=<Storefront site={await api.loadSite('recette')} api={api} mode="embed" demo={false}/>;
    }createRoot(document.getElementById('root')).render(<React.StrictMode>{node}</React.StrictMode>)}start();` },
    bundle: true, write: false, outdir: '/virtual-account-checkout', platform: 'browser', format: 'esm', target: 'es2022', jsx: 'automatic',
    alias: { react: fileURLToPath(new URL('../../../node_modules/react', import.meta.url)), 'react-dom': fileURLToPath(new URL('../../../node_modules/react-dom', import.meta.url)) },
    define: { 'process.env': '{}', 'process.env.NODE_ENV': '"development"', 'process.env.NEXT_PUBLIC_API_URL': '"/api"' },
    plugins: [{ name: 'provider-fixtures', setup(builder) {
      builder.onResolve({ filter: /^next\/navigation$/ }, () => ({ path: 'navigation', namespace: 'fixture-navigation' }));
      builder.onLoad({ filter: /.*/, namespace: 'fixture-navigation' }, () => ({ contents: `export const usePathname=()=>window.location.pathname;export const useRouter=()=>({push:href=>window.location.assign(href)});` }));
      builder.onResolve({ filter: /^next\/font\/google$/ }, () => ({ path: 'fonts', namespace: 'fixture-fonts' }));
      builder.onLoad({ filter: /.*/, namespace: 'fixture-fonts' }, () => ({ contents: `const font=()=>({variable:'',className:'',style:{fontFamily:'Arial'}});export {${['Alegreya_Sans','Archivo','Archivo_Black','Bricolage_Grotesque','Cormorant_Garamond','Familjen_Grotesk','Figtree','Fraunces','Instrument_Sans','JetBrains_Mono','Lato','Libre_Baskerville','Manrope','Nunito','Nunito_Sans','Outfit','Playfair_Display','Source_Sans_3'].map(name => `font as ${name}`).join(',')}}` }));
      builder.onResolve({ filter: /\/(StripeCard|TurnstileCheck)$/ }, args => ({ path: args.path.split('/').at(-1)!, namespace: 'fixture-provider' }));
      builder.onLoad({ filter: /.*/, namespace: 'fixture-provider' }, args => ({ loader: 'tsx', resolveDir: fileURLToPath(new URL('.', import.meta.url)), contents: args.path === 'TurnstileCheck'
        ? `import{useEffect}from'react';export function TurnstileCheck({onToken,resetKey}){useEffect(()=>{onToken('fixture-human-proof')},[onToken,resetKey]);return null}`
        : `export const apparenceStripeDe=()=>({});export function StripeCard({onPaid,onConfirmStart,onConfirmEnd}){window.checkoutAccountFixture.latePaid=onPaid;window.checkoutAccountFixture.lateStart=onConfirmStart;return <button onClick={()=>{if(onConfirmStart()){onPaid();onConfirmEnd('paid')}}}>Confirmer Stripe fixture</button>}` }));
    } }],
  });
  const css = await postcss([tailwind({ base: fileURLToPath(new URL('../../..', import.meta.url)) })]).process(await readFile(cssPath, 'utf8'), { from: cssPath });
  server = createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store'); const path = new URL(req.url ?? '/', origin).pathname;
    if (path === '/app.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(bundle.outputFiles.find(file => file.path.endsWith('.js'))!.text); return; }
    if (path === '/style.css') { res.setHeader('Content-Type', 'text/css'); res.end(css.css); return; }
    if (path === '/' || path === '/empty' || path === '/embed-storefront') { res.setHeader('Content-Type', 'text/html'); res.end(`<!doctype html><html lang="fr"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Checkout compte fixture</title><link rel="stylesheet" href="/style.css"><div id="root"></div>${path !== '/empty' ? '<script type="module" src="/app.js"></script>' : ''}</html>`); return; }
    if (path === '/favicon.ico') { res.writeHead(204).end(); return; }
    if (path.startsWith('/r/recette/compte/')) accountReads++;
    if (path === '/r/recette/compte/capacites') { json(res, { available: false }); return; }
    if (path === '/r/recette/compte/session') {
      if (req.method === 'DELETE') { authenticated = false; res.writeHead(204).end(); return; }
      json(res, authenticated ? { expiresAt, profile: { name: 'Compte Recette', phoneE164: '+33600000001', phoneVerifiedAt: verifiedAt, revision: 0 } } : {}, authenticated ? 200 : 401); return;
    }
    if (path === '/api/public/tenants/recette/slots') { json(res, slots); return; }
    if (path === '/api/public/tenants/recette/order-notifications/config') { json(res, { available: false, publicKey: null }); return; }
    if (path === '/api/public/funnel' && req.method === 'POST') { res.writeHead(204).end(); return; }
    let raw = ''; for await (const chunk of req) raw += chunk.toString(); const body = raw ? JSON.parse(raw) as Record<string, unknown> : {};
    calls.push({ path, body, headers: req.headers });
    if (path === '/r/recette/compte/commandes' || path === '/api/public/tenants/recette/orders') {
      const value = order((body.payment as { method: string }).method);
      const response = path.startsWith('/r/') ? { state: 'created', expiresAt, order: value } : value;
      if (holdCreate) { heldCreate = { res, body: response }; return; } json(res, response); return;
    }
    if (path === '/api/public/tenants/recette/orders/recovery') { if (holdRecovery) { heldRecovery = res; return; } json(res, { state: 'created', order: recovered() }); return; }
    if (path === '/api/public/tenants/recette/orders/abandon') { heldAbandon = res; return; }
    if (path === `/api/public/orders/${orderId}/payment-intent`) { if (holdPayment) { heldPayment = res; return; } json(res, payment); return; }
    faults.push(`Unexpected ${req.method} ${path}`); json(res, {}, 404);
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); if (!address || typeof address === 'string') throw Error('No fixture address');
  origin = `http://127.0.0.1:${address.port}`; browser = await chromium.launch({ headless: true });
}, 30_000);
beforeEach(async () => {
  faults = []; calls = []; authenticated = true; expiresAt = Date.now() + 300_000; verifiedAt = Date.now() - 1_000; holdCreate = false; holdPayment = false; heldCreate = null; heldPayment = null;
  holdRecovery = false; heldRecovery = null; heldAbandon = null; accountReads = 0;
  context = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce', serviceWorkers: 'block' });
  await context.route('**/*', route => { if (new URL(route.request().url()).origin === origin) return route.continue(); faults.push('External request refused'); return route.abort(); });
  page = await context.newPage(); page.setDefaultTimeout(5_000); page.on('pageerror', error => faults.push(error.message));
  await page.goto(origin + '/empty'); await seedCustomerBrowserFixture(page, 'recette'); await page.goto(origin);
  await page.waitForFunction(() => !!window.checkoutAccountFixture?.access());
});
afterEach(async () => { heldCreate?.res.destroy(); heldPayment?.destroy(); heldRecovery?.destroy(); heldAbandon?.destroy(); await context.close(); expect(faults).toEqual([]); });
afterAll(async () => { await browser?.close(); if (server) await new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()); }); process.stdout.write(`Checkout fixture captures: ${captures}\n`); });
async function activate(target: Locator) { await expect.poll(() => target.isEnabled()).toBe(true); await target.focus(); await target.press('Enter'); }
async function checkout(method: 'counter' | 'online' = 'counter', submit = true) {
  await activate(page.getByRole('button', { name: /^Choisir le retrait/ }));
  await activate(page.getByRole('button', { name: /^Continuer · retrait/ }));
  await page.getByLabel('Prénom et nom', { exact: true }).fill('Compte Recette'); await page.getByLabel('Téléphone', { exact: true }).fill('0600000001');
  if (method === 'counter') await activate(page.getByRole('radio', { name: /Payer au comptoir/ }));
  if (submit) await activate(page.getByRole('button', { name: method === 'counter' ? /^Confirmer la commande/ : /^Payer/ }));
}
const posts = () => calls.filter(call => call.path.endsWith('/commandes') || call.path.endsWith('/orders'));
const payments = () => calls.filter(call => call.path.endsWith('/payment-intent'));
async function seedAttempt(kind: 'legacy' | 'guest' | 'account', received = false) {
  return page.evaluate(async ({ kind, received, iso }) => {
    const f = window.checkoutAccountFixture, j = f.journal;
    const active = await j.acquireCheckoutAttempt('recette', {
      payload: { lines: [{ productId: 'a'.repeat(24), options: [], removed: [], qty: 1 }], payment: { method: 'counter' },
        pickup: { slot: iso, customerName: 'Compte Recette', customerPhone: '0600000001' } },
      cartFingerprint: await j.checkoutCartFingerprint(f.cartSnapshot),
      provenance: kind === 'account' ? { kind: 'account', ...f.access()! } : { kind: 'guest' },
    });
    if (kind === 'legacy') {
      const db = await new Promise<IDBDatabase>((resolve, reject) => { const request = indexedDB.open('sm.checkout-attempts', 4); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(Error('fixture IDB')); });
      await new Promise<void>((resolve, reject) => { const tx = db.transaction('active', 'readwrite');
        const { provenance, ...previous } = active.attempt;
        if (provenance?.kind !== 'guest') throw Error('Legacy fixture must start as guest');
        tx.objectStore('active').put({ ...structuredClone(previous), v: 1 });
        tx.oncomplete = () => resolve(); tx.onabort = () => reject(Error('fixture IDB')); }); db.close();
    }
    if (received) {
      await j.recordCheckoutReceipt('recette', active.attempt.clientId, { orderId: kind === 'account' ? 'b'.repeat(24) : 'c'.repeat(24), trackingToken: 'fixture-tracking', number: kind === 'account' ? 4242 : 77 });
      await j.archiveCheckoutAttempt('recette', active.attempt.clientId);
    }
    return active.attempt.clientId;
  }, { kind, received, iso });
}
async function selectB() {
  await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => { const request = indexedDB.open('sm-customer-preparation-v1', 1); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(Error('fixture IDB')); });
    await new Promise<void>((resolve, reject) => { const tx = db.transaction('preparations', 'readwrite'), store = tx.objectStore('preparations'), read = store.get('recette');
      read.onsuccess = () => { const row = read.result; row.verification.operationId = '50000000-0000-4000-8000-000000000005'; row.verification.checkId = '60000000-0000-4000-8000-000000000006'; store.put(row, 'recette'); };
      tx.oncomplete = () => resolve(); tx.onabort = () => reject(Error('fixture IDB')); }); db.close();
    await window.checkoutAccountFixture.refresh();
  });
  await page.waitForFunction(() => window.checkoutAccountFixture.access()?.selection.publication.expectedOperationId.startsWith('5000'));
}
async function hidePrivate(kind: 'offline' | 'hidden') {
  await page.evaluate(kind => {
    if (kind === 'offline') { Object.defineProperty(navigator, 'onLine', { configurable: true, value: false }); window.dispatchEvent(new Event('offline')); }
    else { Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' }); document.dispatchEvent(new Event('visibilitychange')); }
  }, kind);
}
async function assertMasked() {
  await page.getByRole('heading', { name: 'Demande privée masquée', exact: true }).waitFor();
  expect(await page.getByRole('link', { name: 'Suivre ma commande', exact: true }).count()).toBe(0);
  expect(await page.getByText('4242', { exact: false }).count()).toBe(0);
  expect(await page.getByRole('button', { name: 'Confirmer Stripe fixture' }).count()).toBe(0);
  expect(await page.getByText('Compte Recette', { exact: true }).count()).toBe(0);
  expect(await page.getByText('Article de recette', { exact: true }).count()).toBe(0);
}
async function holdLock(name: string) {
  const holder = await context.newPage(); await holder.goto(origin + '/empty');
  await holder.evaluate(name => { let release!: () => void; const wait = new Promise<void>(resolve => { release = resolve; });
    window.checkoutAccountFixture = { lockHeld: false, releaseLock: release } as typeof window.checkoutAccountFixture;
    void navigator.locks.request(name, async () => { window.checkoutAccountFixture.lockHeld = true; await wait; }); }, name);
  await holder.waitForFunction(() => window.checkoutAccountFixture.lockHeld);
  return async () => { await holder.evaluate(() => window.checkoutAccountFixture.releaseLock!()); };
}

describe('Checkout compte — vraie admission navigateur, sans fournisseur', () => {
  it('pins account C01 and sends only the private route for counter checkout', async () => {
    await checkout();
    await expect.poll(() => posts().length).toBe(1);
    expect(posts()[0]!.path).toBe('/r/recette/compte/commandes');
    expect(posts()[0]!.headers['x-sm-customer-operation-id']).toBe('20000000-0000-4000-8000-000000000002');
    await page.getByRole('dialog', { name: 'Commande confirmée', exact: true }).waitFor();
    expect(await page.getByText('Ouvrez « Suivre ma commande » pour consulter l’avancement.', { exact: true }).count()).toBe(1);
    expect(await page.getByText('Suivez la préparation ici même — la page se met à jour toute seule.', { exact: true }).count()).toBe(0);
    await page.clock.install(); await page.clock.fastForward(8_001);
    expect(calls.filter(call => call.path === `/api/public/orders/${orderId}`)).toHaveLength(0);
    expect(posts()).toHaveLength(1);
    expect(payments()).toHaveLength(0); expect(await page.evaluate(() => window.checkoutAccountFixture.clears)).toBe(1);
    await page.screenshot({ path: join(captures, 'account-counter-390.png') });
  });
  it('keeps a held account response private after logout and does not request Stripe or clear the cart', async () => {
    holdCreate = true; await checkout('online'); await expect.poll(() => !!heldCreate).toBe(true);
    expect(await page.evaluate(() => window.checkoutAccountFixture.logout())).toBe(true);
    holdCreate = false; json(heldCreate!.res, heldCreate!.body); heldCreate = null;
    await expect.poll(() => calls.some(call => call.path.endsWith('/recovery'))).toBe(true);
    await assertMasked();
    expect(await page.getByRole('link', { name: 'Suivre ma commande', exact: true }).count()).toBe(0);
    expect(await page.getByText('4242', { exact: false }).count()).toBe(0);
    expect(payments()).toHaveLength(0); expect(posts()).toHaveLength(1);
    expect(await page.evaluate(() => window.checkoutAccountFixture.clears)).toBe(0);
    await expect.poll(() => page.evaluate(async id => (await window.checkoutAccountFixture.journal.readCheckoutAttemptForReconciliation('recette', id))?.state,
      posts()[0]!.body.clientId as string)).toBe('private-settled');
    for (const width of [320, 1440]) {
      await page.setViewportSize({ width, height: 844 });
      const dialog = page.getByRole('dialog', { name: 'Votre demande', exact: true });
      expect(await dialog.count()).toBe(1);
      expect(await dialog.evaluate(element => {
        const title = document.getElementById(element.getAttribute('aria-labelledby') ?? '');
        return !!title && title.scrollWidth <= title.clientWidth;
      })).toBe(true);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await page.screenshot({ path: join(captures, `account-hidden-${width}.png`) });
    }
  });
  it('keeps a pre-existing legacy guest attempt guest when the account is authenticated', async () => {
    const id = await seedAttempt('legacy'); await page.reload();
    await page.waitForFunction(() => !!window.checkoutAccountFixture.access());
    await activate(page.getByRole('button', { name: 'Réessayer cet envoi', exact: true }));
    await expect.poll(() => posts().length).toBe(1);
    expect(posts()[0]!.path).toBe('/api/public/tenants/recette/orders'); expect(posts()[0]!.body.clientId).toBe(id);
    await page.getByRole('dialog', { name: 'Commande confirmée', exact: true }).waitFor();
  });
  it('rejects late A after journal B without retargeting or exposing its recovered ticket', async () => {
    holdCreate = true; await checkout('online'); await expect.poll(() => !!heldCreate).toBe(true);
    await selectB(); json(heldCreate!.res, heldCreate!.body); heldCreate = null;
    await expect.poll(() => calls.some(call => call.path.endsWith('/recovery'))).toBe(true);
    await assertMasked(); expect(posts()).toHaveLength(1); expect(payments()).toHaveLength(0);
    expect(posts()[0]!.headers['x-sm-customer-operation-id']).toBe('20000000-0000-4000-8000-000000000002');
    expect(await page.evaluate(() => window.checkoutAccountFixture.clears)).toBe(0);
  });
  it('settles a hidden uncertain C01 only by explicit read after reload, never resend', async () => {
    const id = await seedAttempt('account');
    expect(await page.evaluate(() => window.checkoutAccountFixture.logout())).toBe(true);
    await page.reload(); await assertMasked();
    expect(await page.getByRole('button', { name: 'Réessayer cet envoi' }).count()).toBe(0);
    holdRecovery = true; await activate(page.getByRole('button', { name: 'Vérifier la demande' }));
    await expect.poll(() => !!heldRecovery).toBe(true);
    expect(calls.at(-1)!.body.clientId).toBe(id); expect(posts()).toHaveLength(0);
    json(heldRecovery!, { state: 'created', order: recovered() }); heldRecovery = null;
    await expect.poll(() => page.getByRole('button', { name: 'Revenir à mon panier', exact: true }).count()).toBe(1);
    await activate(page.getByRole('button', { name: 'Revenir à mon panier', exact: true }));
    await page.getByRole('dialog', { name: 'Votre commande', exact: true }).waitFor();
    expect(await page.evaluate(() => window.checkoutAccountFixture.clears)).toBe(0);
    expect(await page.evaluate(() => window.checkoutAccountFixture.journal.readCheckoutAttemptForReconciliation('recette', '00000000-0000-4000-8000-000000000099'))).toBeNull();
    expect(payments()).toHaveLength(0);
  });
  it.each(['rejected', 'created', 'lost'] as const)('explicitly closes only a masked pending attempt after confirmation (%s)', async outcome => {
    const id = await seedAttempt('account');
    const original = await page.evaluate(id => window.checkoutAccountFixture.journal.readCheckoutAttemptForReconciliation('recette', id), id);
    if (!original || original.state !== 'prepared') throw Error('Fixture pending attempt required');
    expect(await page.evaluate(() => window.checkoutAccountFixture.logout())).toBe(true);
    await page.reload(); await assertMasked();
    holdRecovery = true; await activate(page.getByRole('button', { name: 'Vérifier la demande', exact: true }));
    await expect.poll(() => !!heldRecovery).toBe(true);
    json(heldRecovery!, { message: 'Demande non trouvée' }, 404); heldRecovery = null;
    expect(await page.getByRole('button', { name: 'Fermer cette tentative', exact: true }).count()).toBe(1);
    await activate(page.getByRole('button', { name: 'Fermer cette tentative', exact: true }));
    expect(calls.filter(call => call.path.endsWith('/abandon'))).toHaveLength(0);
    await activate(page.getByRole('button', { name: 'Conserver la demande', exact: true }));
    expect(calls.filter(call => call.path.endsWith('/abandon'))).toHaveLength(0);
    await activate(page.getByRole('button', { name: 'Fermer cette tentative', exact: true }));
    await activate(page.getByRole('button', { name: 'Confirmer la fermeture', exact: true }));
    await expect.poll(() => !!heldAbandon).toBe(true);
    await assertMasked();
    const abandon = calls.filter(call => call.path.endsWith('/abandon'));
    expect(abandon).toHaveLength(1);
    expect(abandon[0]!.body).toEqual({ ...original.payload, clientId: id, recoveryProof: original.recoveryProof });
    expect(await page.getByRole('button', { name: 'Confirmer la fermeture', exact: true }).isEnabled()).toBe(false);
    json(heldAbandon!, outcome === 'created' ? { state: 'created', order: recovered() }
      : outcome === 'rejected' ? { state: 'rejected', code: 'ORDER_ATTEMPT_REJECTED', reason: 'abandoned', message: 'Tentative fermée' }
      : { message: 'Réponse perdue' }, outcome === 'lost' ? 503 : 200); heldAbandon = null;
    if (outcome === 'lost') {
      await page.getByText('La réponse reste à vérifier. Votre demande est conservée ; aucune nouvelle commande n’a été envoyée.', { exact: true }).waitFor();
      expect(await page.getByRole('button', { name: 'Revenir à mon panier', exact: true }).count()).toBe(0);
      expect(calls.filter(call => call.path.endsWith('/abandon'))).toHaveLength(1);
      await activate(page.getByRole('button', { name: 'Vérifier la demande', exact: true }));
      await expect.poll(() => !!heldRecovery).toBe(true);
      json(heldRecovery!, { state: 'rejected', code: 'ORDER_ATTEMPT_REJECTED', reason: 'abandoned', message: 'Tentative fermée' }); heldRecovery = null;
    }
    await page.getByRole('button', { name: 'Revenir à mon panier', exact: true }).waitFor();
    await assertMasked();
    await activate(page.getByRole('button', { name: 'Revenir à mon panier', exact: true }));
    await page.getByRole('dialog', { name: 'Votre commande', exact: true }).waitFor();
    expect(await page.evaluate(id => window.checkoutAccountFixture.journal.readCheckoutAttemptForReconciliation('recette', id), id)).toBeNull();
    expect(posts()).toHaveLength(0); expect(payments()).toHaveLength(0);
    expect(await page.evaluate(() => window.checkoutAccountFixture.clears)).toBe(0);
  });

  it('does not mount a held payment response or resurrect its cached callback after logout', async () => {
    holdPayment = true; await checkout('online'); await expect.poll(() => !!heldPayment).toBe(true);
    expect(await page.evaluate(() => window.checkoutAccountFixture.logout())).toBe(true);
    json(heldPayment!, payment); heldPayment = null; await assertMasked(); expect(payments()).toHaveLength(1);
  });
  it('expires the account while creation is held and settles without payment or cart clear', async () => {
    await page.clock.install(); holdCreate = true; await checkout('online'); await expect.poll(() => !!heldCreate).toBe(true);
    await page.clock.fastForward(300_001); await assertMasked();
    json(heldCreate!.res, heldCreate!.body); heldCreate = null;
    await expect.poll(() => calls.some(call => call.path.endsWith('/recovery'))).toBe(true);
    await expect.poll(() => page.evaluate(async id => (await window.checkoutAccountFixture.journal.readCheckoutAttemptForReconciliation('recette', id))?.state,
      posts()[0]!.body.clientId as string)).toBe('private-settled');
    expect(payments()).toHaveLength(0); expect(await page.evaluate(() => window.checkoutAccountFixture.clears)).toBe(0);
  });
  it('offers read-only reconciliation after offline then revalidation of the same A, not an inert return button', async () => {
    holdCreate = true; holdRecovery = true; await checkout('online'); await expect.poll(() => !!heldCreate).toBe(true);
    await hidePrivate('offline'); json(heldCreate!.res, heldCreate!.body); heldCreate = null;
    await expect.poll(() => !!heldRecovery).toBe(true); json(heldRecovery!, { state: 'pending' }); heldRecovery = null;
    await page.waitForFunction(async () => !(await navigator.locks.query()).held?.some(lock => lock.name === 'sm:customer:recette'));
    await page.evaluate(() => { Object.defineProperty(navigator, 'onLine', { configurable: true, value: true }); window.dispatchEvent(new Event('online')); });
    await page.waitForFunction(() => !!window.checkoutAccountFixture.access());
    await expect.poll(() => page.getByRole('button', { name: 'Vérifier la demande' }).count()).toBe(1);
    await activate(page.getByRole('button', { name: 'Vérifier la demande' }));
    await expect.poll(() => !!heldRecovery).toBe(true); await assertMasked();
    json(heldRecovery!, { state: 'created', order: recovered() }); heldRecovery = null;
    await expect.poll(() => page.getByRole('button', { name: 'Revenir à mon panier' }).isEnabled()).toBe(true);
    await assertMasked(); expect(posts()).toHaveLength(1); expect(payments()).toHaveLength(0);
    expect(await page.evaluate(() => window.checkoutAccountFixture.clears)).toBe(0);
  });
  it.each(['offline', 'hidden', 'logout'] as const)('removes the live Stripe widget on %s and ignores its old onPaid callback', async kind => {
    await checkout('online'); await page.getByRole('button', { name: 'Confirmer Stripe fixture' }).waitFor();
    if (kind === 'logout') expect(await page.evaluate(() => window.checkoutAccountFixture.logout())).toBe(true);
    else await hidePrivate(kind);
    await assertMasked();
    expect(await page.evaluate(() => window.checkoutAccountFixture.lateStart!())).toBe(false);
    await page.evaluate(() => window.checkoutAccountFixture.latePaid!()); await assertMasked();
    expect(payments()).toHaveLength(1); expect(posts()).toHaveLength(1);
  });
  it('revalidates inside a held cart lock before clearing when the account goes offline', async () => {
    const release = await holdLock('sm.cart.write.recette');
    await checkout(); await page.waitForFunction(() => window.checkoutAccountFixture.clearEntered === 1);
    await hidePrivate('offline'); await release();
    await assertMasked();
    await page.waitForFunction(async () => (await navigator.locks.query()).held?.every(lock => lock.name !== 'sm:customer:recette'));
    expect(await page.evaluate(() => window.checkoutAccountFixture.clears)).toBe(0);
  });
  it('serializes logout against a receipt awaiting the cart lock without clearing after access loss', async () => {
    const release = await holdLock('sm.cart.write.recette');
    await checkout(); await page.waitForFunction(() => window.checkoutAccountFixture.clearEntered === 1);
    await page.evaluate(() => { void window.checkoutAccountFixture.logout().then(value => { window.checkoutAccountFixture.logoutResult = value; }); });
    await page.waitForFunction(() => window.checkoutAccountFixture.access() === null);
    await release(); await page.waitForFunction(() => window.checkoutAccountFixture.logoutResult !== undefined);
    expect(await page.evaluate(() => window.checkoutAccountFixture.logoutResult)).toBe(true);
    await assertMasked(); expect(await page.evaluate(() => window.checkoutAccountFixture.clears)).toBe(0);
  });
  it('captures the cart at the submit gesture before the account admission lock waits', async () => {
    await checkout('counter', false); const release = await holdLock('sm:customer:recette');
    await activate(page.getByRole('button', { name: /^Confirmer la commande/ }));
    await page.waitForFunction(async () => (await navigator.locks.query()).pending?.some(lock => lock.name === 'sm:customer:recette'));
    await page.evaluate(() => window.checkoutAccountFixture.changeCart()); await release();
    await expect.poll(() => posts().length).toBe(1);
    expect(posts()[0]!.body.lines).toEqual([{ productId: 'a'.repeat(24), options: [], removed: [], qty: 1 }]);
    await page.getByRole('dialog', { name: 'Commande confirmée', exact: true }).waitFor();
    expect(await page.evaluate(() => window.checkoutAccountFixture.clears)).toBe(0);
  });
  it('does not admit or downgrade an account gesture that loses access while waiting for its lock', async () => {
    await checkout('counter', false); const release = await holdLock('sm:customer:recette');
    await activate(page.getByRole('button', { name: /^Confirmer la commande/ }));
    await page.waitForFunction(async () => (await navigator.locks.query()).pending?.some(lock => lock.name === 'sm:customer:recette'));
    await hidePrivate('offline'); await release(); await assertMasked();
    await page.waitForFunction(async () => !(await navigator.locks.query()).held?.some(lock => lock.name === 'sm:customer:recette'));
    expect(posts()).toHaveLength(0); expect(payments()).toHaveLength(0);
    expect(await page.evaluate(() => window.checkoutAccountFixture.journal.readCheckoutRecovery('recette'))).toEqual({ active: null, last: null, hidden: null });
  });
  it('renders the actual embedded Storefront without account endpoints or private aliases while preserving guest receipts', async () => {
    await seedAttempt('guest', true); await seedAttempt('account', true);
    const baseline = accountReads;
    await page.goto(origin + '/embed-storefront');
    await activate(page.getByRole('region', { name: 'Boissons', exact: true }).getByRole('button', { name: /Canette recette/ }));
    await activate(page.getByRole('button', { name: /Voir mon panier/ }));
    await page.getByRole('dialog', { name: 'Votre commande', exact: true }).waitFor();
    expect(accountReads).toBe(baseline);
    expect(await page.getByText('4242', { exact: false }).count()).toBe(0);
    expect(await page.getByRole('button', { name: 'Mon compte', exact: true }).count()).toBe(0);
    expect(await page.evaluate(async () => (await window.checkoutAccountFixture.journal.readDeviceCheckoutReceipts('recette')).map(row => row.receipt.number))).toEqual([77]);
    await activate(page.getByRole('button', { name: /^Choisir le retrait/ }));
    await activate(page.getByRole('button', { name: /^Continuer · retrait/ }));
    expect(await page.getByLabel('Prénom et nom', { exact: true }).inputValue()).toBe('');
    expect(accountReads).toBe(baseline);
  });
});
