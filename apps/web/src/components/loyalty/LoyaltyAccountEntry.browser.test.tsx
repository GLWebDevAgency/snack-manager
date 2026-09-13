import { createServer, type Server } from 'node:http';
import { mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import postcss from 'postcss';
import tailwind from '@tailwindcss/postcss';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { marqueDeRepli } from '@sm/contracts';
import { demoSite } from '../order/demo/fixture';
import { seedCustomerBrowserFixture } from '../customer-account/browser-journal.fixture';

// Real loyalty page, account entry, account/loyalty controllers and IndexedDB
// selector. Only the HTTP provider and Next navigation/font adapters are local.
let server: Server, browser: Browser, context: BrowserContext, page: Page, origin: string;
let faults: string[], calls: { path: string; method: string; body: unknown }[];
let authenticated: boolean, savedCard: boolean, expiry: number;
let cardNetworkFailure: boolean, publishedReward: boolean;
let cardFailures: string[];
let capabilities: { available: boolean; registrationAvailable?: boolean; accessAvailable?: boolean };
let restoreGate: Promise<void> | null, releaseRestore: (() => void) | null;
let deleteGate: Promise<void> | null, releaseDelete: (() => void) | null;
let reorderGate: Promise<void> | null, releaseReorder: (() => void) | null;
const brand = marqueDeRepli(null, null);
const catalog = {
  restaurant: { slug: 'recette', name: 'Le Comptoir', brand, brandColor: '#c9a15a', logoUrl: null },
  program: { name: 'Les habitués du Comptoir', mechanism: 'points', unitLabelSingular: 'point', unitLabelPlural: 'points', termsSummary: 'Récompenses à demander au comptoir.' },
  rewards: [],
};
const reward = { id: '60000000-0000-4000-8000-000000000006', name: 'Boisson au choix', description: 'Une boisson du restaurant', costUnits: 20, kind: 'custom', valueCents: null, productRef: null, affordable: false };
const pastOrder = { _id: 'a'.repeat(24), number: 42, createdAt: '2026-09-09T12:00:00.000Z', status: 'delivered', type: 'pickup', pickupSlot: null, totalCents: 150, payment: { method: 'counter', status: 'paid', refundedCents: 0, pendingRefundCents: 0 } };
const member = { id: '50000000-0000-4000-8000-000000000005', joinedAt: '2026-09-01T12:00:00.000Z', qrGeneration: 1,
  balanceUnits: 25, unitLabelSingular: 'point', unitLabelPlural: 'points' };

beforeAll(async () => {
  const directory = fileURLToPath(new URL('.', import.meta.url));
  const cssPath = fileURLToPath(new URL('../../app/globals.css', import.meta.url));
  const bundle = await build({
    stdin: { sourcefile: 'loyalty-account-entry.tsx', resolveDir: directory, loader: 'tsx', contents: `
      import React from 'react';import{createRoot}from'react-dom/client';import{LoyaltyCardApp}from'./LoyaltyCardApp';import{Storefront}from'../order/Storefront';import{orderingApi}from'../order/api';import{demoSite}from'../order/demo/fixture';import{resumeFidelite}from'../order/fidelite';import{DemoStorefront}from'../order/demo/DemoStorefront';
      const catalog=${JSON.stringify(catalog)};const params=new URLSearchParams(location.search);if(params.has('demo'))catalog.restaurant.slug='demo';if(params.has('shape'))catalog.restaurant.brand.shape=params.get('shape');
      async function start(){let node=<LoyaltyCardApp catalog={catalog} orderingAvailable={false}/>;
      if(params.has('order')){const raw=demoSite(new Date(),()=>0);raw.tenant.slug=params.has('demo')?'demo':'recette';raw.tenant.brand=catalog.restaurant.brand;
      raw.menu={categories:[{_id:'${'c'.repeat(24)}',name:'Boissons',products:[{_id:'${'d'.repeat(24)}',name:'Canette recette',price:150,available:true,stockout:false,variants:[],optionGroups:[],ingredients:[],supplements:[],photoUrl:null}]}]};
      if(params.has('paused'))raw.ordering={paused:true,message:'Commande momentanément indisponible.'};
      const api=orderingApi({send:async()=>({status:200,body:raw})});const site=await api.loadSite('recette');node=<Storefront site={site} api={api} loyalty={params.has('withoutLoyalty')?null:resumeFidelite(catalog)} loyaltyCatalog={params.has('withoutLoyalty')?undefined:catalog} mode={params.has('embed')?'embed':'site'} demo={params.has('demo')}/>;if(params.has('demo'))node=<DemoStorefront site={site}/>}
      createRoot(document.getElementById('root')).render(<React.StrictMode>{node}</React.StrictMode>)}start();` },
    bundle: true, write: false, outdir: '/virtual-loyalty-account-entry', format: 'esm', platform: 'browser', jsx: 'automatic', target: 'es2022',
    alias: { react: fileURLToPath(new URL('../../../node_modules/react', import.meta.url)), 'react-dom': fileURLToPath(new URL('../../../node_modules/react-dom', import.meta.url)) },
    define: { 'process.env': '{}', 'process.env.NODE_ENV': '"production"', 'process.env.NEXT_PUBLIC_API_URL': '"/api"' },
    plugins: [{ name: 'local-next-adapters', setup(builder) {
      builder.onResolve({ filter: /^next\/navigation$/ }, () => ({ path: 'navigation', namespace: 'loyalty-fixture' }));
      builder.onLoad({ filter: /^navigation$/, namespace: 'loyalty-fixture' }, () => ({ contents: `import{useSyncExternalStore}from'react';const subscribe=cb=>{window.addEventListener('sm:order-navigation',cb);window.addEventListener('popstate',cb);return()=>{window.removeEventListener('sm:order-navigation',cb);window.removeEventListener('popstate',cb)}};export const usePathname=()=>useSyncExternalStore(subscribe,()=>location.pathname,()=>'/');const navigate=url=>{history.pushState({},'',url);window.dispatchEvent(new Event('sm:order-navigation'))};export const useRouter=()=>({push:navigate,replace:navigate});`, resolveDir: directory }));
      builder.onResolve({ filter: /\/StripeCard$/ }, () => ({path:'stripe',namespace:'loyalty-fixture'}));
      builder.onLoad({filter:/^stripe$/,namespace:'loyalty-fixture'},()=>({contents:'export const apparenceStripeDe=()=>({});export function StripeCard(){return null}'}));
      builder.onResolve({ filter: /^next\/font\/google$/ }, () => ({ path: 'fonts', namespace: 'loyalty-fixture' }));
      builder.onLoad({ filter: /^fonts$/, namespace: 'loyalty-fixture' }, () => ({ contents: `const font=()=>({variable:'',className:'',style:{fontFamily:'Arial'}});export {${['Alegreya_Sans', 'Archivo', 'Archivo_Black', 'Bricolage_Grotesque', 'Cormorant_Garamond', 'Familjen_Grotesk', 'Figtree', 'Fraunces', 'Instrument_Sans', 'JetBrains_Mono', 'Lato', 'Libre_Baskerville', 'Manrope', 'Nunito', 'Nunito_Sans', 'Outfit', 'Playfair_Display', 'Source_Sans_3'].map(name => `font as ${name}`).join(',')}}` }));
    } }],
  });
  const css = await postcss([tailwind({ base: fileURLToPath(new URL('../../..', import.meta.url)) })])
    .process(await readFile(cssPath, 'utf8'), { from: cssPath });
  server = createServer((request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    if (request.url === '/app.js') { response.setHeader('Content-Type', 'text/javascript'); response.end(bundle.outputFiles.find(file => file.path.endsWith('.js'))!.text); return; }
    if (request.url === '/style.css') { response.setHeader('Content-Type', 'text/css'); response.end(css.css + (bundle.outputFiles.find(file => file.path.endsWith('.css'))?.text ?? '')); return; }
    if (request.url === '/favicon.ico') { response.writeHead(204).end(); return; }
    if (request.url?.startsWith('/') && !request.url.startsWith('/api/') && !request.url.endsWith('/sw.js')) {
      response.setHeader('Content-Type', 'text/html');
      response.end('<!doctype html><html lang="fr"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Accès fidélité unifié</title><link rel="stylesheet" href="/style.css"><div id="root"></div><script type="module" src="/app.js"></script></html>'); return;
    }
    if(request.url?.startsWith('/api/public/funnel')){response.end('{}');return;}
    faults.push('Unexpected local HTTP request '+request.url); response.writeHead(404).end();
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('No fixture port');
  origin = `http://127.0.0.1:${address.port}`;
  browser = await chromium.launch({ headless: true });
}, 30_000);

beforeEach(async () => {
  faults = []; calls = []; authenticated = false; savedCard = false; expiry = Date.now() + 600_000; capabilities = { available: false }; cardNetworkFailure = false; publishedReward = false; cardFailures = [];
  restoreGate = null; releaseRestore = null;
  deleteGate = null; releaseDelete = null; reorderGate = null; releaseReorder = null;
  context = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce', serviceWorkers: 'block' });
  await context.route('**/*', route => {
    if (new URL(route.request().url()).origin === origin) return route.continue();
    faults.push('External request refused'); return route.abort();
  });
  await context.route(`${origin}/r/**`, async route => {
    const request = route.request(), path = new URL(request.url()).pathname, method = request.method();
    const body: unknown = request.postData() ? request.postDataJSON() : null;
    if (!/\/(card-session|capacites|session|fidelite|orders|profil|recherche|detail|recommander)$/.test(path) || (path.endsWith('/fidelite') && method==='GET')) return route.continue();
    calls.push({ path, method, body });
    if (path.includes('/compte/commandes/') && method === 'POST' && authenticated) {
      if (path.endsWith('/recherche')) return route.fulfill({json:{expiresAt:expiry,orders:[pastOrder],nextCursor:null}});
      if (path.endsWith('/detail')) return route.fulfill({json:{expiresAt:expiry,order:{...pastOrder,totals:{subtotal:150,total:150,deliveryFee:0,discount:null},lines:[{name:'Canette recette privée',qty:1,unitPrice:150,lineTotal:150,variantName:null,options:[],removed:[],note:null}],note:'Note privée de recette',statusHistory:[],delivery:null}}});
      if (reorderGate) await reorderGate;
      return route.fulfill({json:{expiresAt:expiry,orderId:pastOrder._id,number:42,lines:[{productId:'d'.repeat(24),name:'Canette recette',qty:1,unitPrice:150,variantKey:null,variantName:null,options:[],removed:[]}]}});
    }
    if (path.endsWith('/fidelite/card-session') && method === 'DELETE') {
      if (deleteGate) await deleteGate;
      savedCard = false; return route.fulfill({ status: 204 });
    }
    if (path.endsWith('/fidelite/card-session') && method === 'GET') {
      if (cardNetworkFailure) return route.abort('internetdisconnected');
      if (restoreGate) await restoreGate;
      return savedCard ? route.fulfill({ json: { ...catalog, restaurant: {slug:'recette',name:'Le Comptoir',brand,brandColor:'#c9a15a'}, member: { alias: 'Camille carte existante', balanceUnits: 12 }, rewards: publishedReward ? [reward] : [], activity: [] } }) : route.fulfill({ status: 204 });
    }
    if (path.endsWith('/compte/capacites') && method === 'GET') return route.fulfill({ json: capabilities });
    if (path.endsWith('/compte/session') && method === 'GET' && authenticated) return route.fulfill({ json: {
      expiresAt: expiry, profile: { name: 'Camille Compte', phoneE164: '+33600000000', phoneVerifiedAt: 1_700_000_000_000, revision: 0 },
    } });
    if (path.endsWith('/compte/fidelite') && method === 'POST' && authenticated && body && typeof body === 'object' && 'step' in body && body.step === 'view') {
      return route.fulfill({ json: { state: 'member', expiresAt: expiry, member } });
    }
    faults.push('Unexpected account request or mutation'); return route.abort();
  });
  await context.route(`${origin}/api/public/tenants/recette/site`, route => {
    const raw=demoSite(new Date(),()=>0);raw.tenant.slug='recette';raw.tenant.brand=brand;
    raw.menu={categories:[{_id:'c'.repeat(24),name:'Boissons',products:[{_id:'d'.repeat(24),name:'Canette recette',price:150,outOfStock:false,variants:[],optionGroups:[],removables:[],supplements:[],photoUrl:null,description:'',tags:[],isNew:false,medias:[]}]}]};
    return route.fulfill({json:raw});
  });
  page = await context.newPage(); page.setDefaultTimeout(3_000);
  page.on('requestfailed', request => { if (new URL(request.url()).pathname.endsWith('/fidelite/card-session')) cardFailures.push(request.failure()?.errorText ?? ''); });
  page.on('pageerror', error => faults.push(error.message));
  page.on('console', message => {
    if (!['warning', 'error'].includes(message.type())) return;
    if (/Service Worker registration blocked by Playwright/.test(message.text())) return;
    if (cardNetworkFailure && message.location().url.endsWith('/fidelite/card-session') && /net::ERR_INTERNET_DISCONNECTED/.test(message.text())) return;
    faults.push(`Unexpected browser ${message.type()}: ${message.text()}`);
  });
});
afterEach(async () => { releaseRestore?.(); releaseDelete?.(); releaseReorder?.(); await context?.close(); expect(faults).toEqual([]); });
afterAll(async () => { await browser?.close(); if (server) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); });

const accountCalls = () => calls.filter(call => call.path.includes('/compte/'));
const loyaltyCalls = () => accountCalls().filter(call => call.path.endsWith('/fidelite'));
const qrAccess = () => page.locator('summary').filter({ hasText: 'Afficher une carte avec son QR' });
const tab = (name: string) => page.getByRole('tab', { name, exact: true });
async function authenticate() {
  authenticated = true; await seedCustomerBrowserFixture(page, 'recette'); await page.reload(); await tab('Carte').waitFor();
}

describe('application client — navigation commune et cartes existantes', () => {
  it('vitrine absente : deux destinations réelles, compte en page et carte QR conservée', async () => {
    await page.goto(origin);
    await page.getByRole('heading', { name: 'Ma fidélité', exact: true }).waitFor();
    expect(await page.getByRole('tab').allTextContents()).toEqual(['Fidélité', 'Compte']);
    expect(await page.getByRole('dialog').count()).toBe(0);
    await page.getByRole('button', { name: 'Scanner mon QR', exact: true }).waitFor();
    expect(await page.getByRole('link', { name: 'Voir le menu du restaurant' }).count()).toBe(0);
    for (const width of [320, 390, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    }
    await tab('Compte').click(); await page.getByRole('heading', { name: 'Mon compte', exact: true }).waitFor();
    expect(new URL(page.url()).pathname).toBe('/r/recette/compte');
    await page.goBack(); await page.getByRole('heading', { name: 'Ma fidélité', exact: true }).waitFor();
    expect(calls.some(call => call.method !== 'GET')).toBe(false);
  });

  it.each([320, 390, 1440])('donne priorité à la carte à %ipx lorsque le compte est fermé, sans action de relance', async width => {
    await page.setViewportSize({ width, height: 1000 }); await page.goto(origin + '/?order=1');
    await tab('Fidélité').click();
    const scanner = page.getByRole('button', { name: 'Scanner mon QR', exact: true }); await scanner.waitFor();
    const notice = page.getByText('La connexion au compte est indisponible pour le moment.', { exact: true });
    await notice.waitFor();
    expect(await qrAccess().isVisible()).toBe(false);
    expect(await page.getByRole('button', { name: /Actualiser mon compte|Réessayer|Commencer mon inscription/ }).count()).toBe(0);
    expect(await page.locator('main').textContent()).not.toMatch(/ancienne carte|naviguez en invité|création.*fermée/i);
    expect((await scanner.boundingBox())!.y).toBeLessThan((await notice.boundingBox())!.y);
    expect((await scanner.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(accountCalls().every(call => call.method === 'GET')).toBe(true);
    if (process.env.SM_QA_CUSTOMER_NAV_DIR) { await mkdir(process.env.SM_QA_CUSTOMER_NAV_DIR, { recursive: true }); await page.screenshot({ path: join(process.env.SM_QA_CUSTOMER_NAV_DIR, `${width}-fidélité-carte.png`) }); }
  });

  it.each([['net', 320], ['doux', 390], ['rond', 1440]] as const)('conserve le masque %s sur la carte courante et la connexion complémentaire à %ipx', async (shape, width) => {
    savedCard = true; await page.setViewportSize({ width, height: 1000 }); await page.goto(origin + '/?shape=' + shape);
    const present = page.getByRole('button', { name: 'Présenter ma carte', exact: true }); await present.waitFor();
    const notice = page.getByRole('heading', { name: 'Votre carte sur vos appareils', exact: true }); await notice.waitFor();
    expect((await present.boundingBox())!.y).toBeLessThan((await notice.boundingBox())!.y);
    const radii = await page.evaluate(() => {
      const card = document.querySelector('.sm-account-card-access section')!;
      const account = document.querySelector('.sm-account-intro')!;
      return { card: getComputedStyle(card).borderTopLeftRadius, account: getComputedStyle(account).borderTopLeftRadius, expected: getComputedStyle(account).getPropertyValue('--cf-r-lg').trim() };
    });
    expect(radii.card).toBe(radii.expected); expect(radii.account).toBe(radii.expected);
    expect(await page.getByRole('progressbar').count()).toBe(0);
    expect(await page.getByRole('heading', { name: 'Vos récompenses', exact: true }).count()).toBe(0);
    expect(await page.getByText('Votre solde atteint tous les paliers publiés.', { exact: true }).count()).toBe(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(loyaltyCalls()).toEqual([]);
    if (process.env.SM_QA_CUSTOMER_NAV_DIR) { await mkdir(process.env.SM_QA_CUSTOMER_NAV_DIR, { recursive: true }); await page.screenshot({ path: join(process.env.SM_QA_CUSTOMER_NAV_DIR, `${width}-fidélité-solde-${shape}.png`) }); }
  });

  it('affiche le vrai seuil publié et conserve Présenter ma carte avant Commander', async () => {
    savedCard = true; publishedReward = true; await page.goto(origin + '/?order=1'); await tab('Fidélité').click();
    const present = page.getByRole('button', { name: 'Présenter ma carte', exact: true }); await present.waitFor();
    const order = page.getByRole('link', { name: 'Commander chez Le Comptoir', exact: true }); await order.waitFor();
    const progress = page.getByRole('progressbar', { name: 'Progression vers « Boisson au choix »', exact: true });
    expect(await progress.getAttribute('aria-valuenow')).toBe('12'); expect(await progress.getAttribute('aria-valuemax')).toBe('20');
    expect(await page.getByRole('heading', { name: 'Vos récompenses', exact: true }).count()).toBe(1);
    expect((await present.boundingBox())!.y).toBeLessThan((await order.boundingBox())!.y);
    expect(await present.evaluate(node => getComputedStyle(node).backgroundColor)).not.toBe(await order.evaluate(node => getComputedStyle(node).backgroundColor));
    expect(calls.every(call => call.method === 'GET')).toBe(true);
  });

  it('conserve le dernier solde daté quand la lecture réseau échoue, sans reconstruire identité ou QR', async () => {
    cardNetworkFailure = true;
    await context.addInitScript(() => localStorage.setItem('sm_fidelite_recette', JSON.stringify({ version: 2, solde: 12, vuA: new Date(Date.now() - 60_000).toISOString() })));
    await page.goto(origin);
    await page.getByRole('heading', { name: /Dernier solde connu : 12 points/ }).waitFor();
    await page.getByText('Connectez-vous au réseau pour afficher votre carte et actualiser vos points.', { exact: true }).waitFor();
    expect(await page.getByText('Dernière consultation il y a 1 min.', { exact: true }).count()).toBe(1);
    expect(await page.getByText('Seul ce solde est enregistré sur cet appareil. Votre identité et votre historique ne sont pas conservés hors connexion.', { exact: true }).count()).toBe(1);
    expect(await page.getByText(/Vous pouvez utiliser votre carte avec son QR|Source : copie locale|échec du rafraîchissement/).count()).toBe(0);
    expect(cardFailures).toEqual(['net::ERR_INTERNET_DISCONNECTED']);
    expect(await page.getByRole('button', { name: /Présenter ma carte|Afficher ma carte|Scanner mon QR/ }).count()).toBe(0);
    expect(await page.getByRole('img', { name: /QR/ }).count()).toBe(0);
    expect(await page.locator('body').textContent()).not.toMatch(/Camille|25 points/);
    expect(loyaltyCalls()).toEqual([]);
    if (process.env.SM_QA_CUSTOMER_NAV_DIR) { await mkdir(process.env.SM_QA_CUSTOMER_NAV_DIR, { recursive: true }); await page.screenshot({ path: join(process.env.SM_QA_CUSTOMER_NAV_DIR, '390-fidélité-solde-non-vérifié.png') }); }
  });

  it('propose la connexion autorisée après la carte, sans demander de téléphone ni envoyer un SMS à l’ouverture', async () => {
    capabilities = { available: false, accessAvailable: true, registrationAvailable: true };
    await page.goto(origin);
    const scanner = page.getByRole('button', { name: 'Scanner mon QR', exact: true }); await scanner.waitFor();
    const connect = page.getByRole('button', { name: 'Se connecter avec une clé d’accès', exact: true }); await connect.waitFor();
    expect((await scanner.boundingBox())!.y).toBeLessThan((await connect.boundingBox())!.y);
    expect(await page.getByLabel('Numéro de mobile', { exact: true }).count()).toBe(0);
    expect(await page.getByRole('button', { name: 'Créer un compte protégé', exact: true }).count()).toBe(1);
    expect(calls.every(call => call.method === 'GET')).toBe(true);
    await page.getByRole('button', { name: 'Créer un compte protégé', exact: true }).click();
    await page.getByRole('button', { name: 'Commencer mon inscription', exact: true }).waitFor();
    expect(calls.every(call => call.method === 'GET')).toBe(true);
  });

  it('affiche la carte déjà liée sans nouveau téléphone, adhésion ni scan et efface le DOM privé au retour', async () => {
    await page.goto(origin + '/?order=1'); await tab('Carte').waitFor(); await authenticate();
    await tab('Fidélité').click(); await page.getByText('25 points', { exact: true }).waitFor();
    expect(loyaltyCalls().map(call => call.body)).toEqual([{ step: 'view' }]);
    expect(await page.getByLabel(/Téléphone|Numéro de mobile/).count()).toBe(0);
    expect(await page.getByRole('button', { name: 'Afficher ma carte', exact: true }).count()).toBe(1);
    expect(await qrAccess().isVisible()).toBe(true);
    expect(await page.getByRole('button', { name: 'Scanner mon QR', exact: true }).isVisible()).toBe(false);
    expect(await page.getByRole('img', { name: 'QR de votre carte fidélité', exact: true }).count()).toBe(0);
    expect(await page.getByRole('dialog').count()).toBe(0);
    await tab('Carte').click();
    await expect.poll(() => page.getByText('25 points', { exact: true }).count()).toBe(0);
    expect(await page.locator('body').textContent()).not.toContain('Camille Compte');
  });

  it('conserve un panier réel pendant Carte → Recherche → Fidélité → Compte → retour navigateur', async () => {
    await page.goto(origin + '/?order=1'); await tab('Carte').waitFor();
    expect(await page.getByRole('tab').allTextContents()).toEqual(['Carte', 'Rechercher', 'Commandes', 'Fidélité', 'Compte']);
    await page.getByRole('article', { name: 'Canette recette', exact: true }).getByRole('button').first().click();
    await page.getByRole('button', { name: /Voir mon panier/ }).waitFor();
    const instance = await page.locator('.sm-order').evaluate(node => { node.setAttribute('data-fixture-instance','same'); return true; });
    expect(instance).toBe(true);
    for (const name of ['Rechercher', 'Fidélité', 'Compte']) await tab(name).click();
    await page.goBack(); await expect.poll(() => tab('Fidélité').getAttribute('aria-selected')).toBe('true');
    await tab('Carte').click(); await page.getByRole('button', { name: /Voir mon panier/ }).waitFor();
    expect(await page.locator('.sm-order').getAttribute('data-fixture-instance')).toBe('same');
    expect(await page.locator('.sm-order-cart-count').textContent()).toBe('1');
  });

  it('garde la carte QR existante après une visite dans le compte sans la transformer en carte privée', async () => {
    savedCard = true; await page.goto(origin);
    await page.getByText('Solde de Camille carte existante', { exact: true }).waitFor();
    await tab('Compte').click(); await page.getByRole('heading', { name: 'Mon compte', exact: true }).waitFor();
    expect(await page.getByText('Solde de Camille carte existante', { exact: true }).isVisible()).toBe(false);
    await tab('Fidélité').click(); await page.getByText('Solde de Camille carte existante', { exact: true }).waitFor();
    expect(calls.filter(call => call.path.endsWith('/fidelite/card-session')).every(call => call.method === 'GET')).toBe(true);
    expect(loyaltyCalls()).toEqual([]);
  });

  it('ne remonte pas le compte lors d’une réponse tardive de la carte QR', async () => {
    restoreGate = new Promise(resolve => { releaseRestore = resolve; });
    await page.goto(origin + '/?order=1'); await tab('Carte').waitFor(); await authenticate();
    await tab('Fidélité').click(); await page.getByText('25 points', { exact: true }).waitFor();
    savedCard = true; releaseRestore?.(); await qrAccess().click();
    await page.getByText('Solde de Camille carte existante', { exact: true }).waitFor();
    expect(await page.getByText('25 points', { exact: true }).count()).toBe(1);
    expect(loyaltyCalls().map(call => call.body)).toEqual([{ step: 'view' }]);
  });

  it.each(['demo', 'embed'])('garde %s invité et sans lectures compte', async mode => {
    await page.goto(`${origin}/?order=1&${mode}=1`); await tab('Carte').waitFor();
    expect(await tab('Compte').count()).toBe(0);
    expect(await page.getByRole('button', { name: 'Mon compte', exact: true }).count()).toBe(0);
    expect(accountCalls()).toEqual([]);
  });

  it('la démo réelle garde son lien fidélité explicite et ne propose aucun compte', async () => {
    await page.goto(origin + '/r/demo?order=1&demo=1'); await tab('Fidélité').waitFor();
    await tab('Fidélité').click();
    await expect.poll(() => new URL(page.url()).pathname).toBe('/r/demo/fidelite');
    expect(new URL(page.url()).search).toBe('?demo=1');
    expect(await tab('Compte').count()).toBe(0);expect(accountCalls()).toEqual([]);
  });

  it('omet la fidélité si aucun catalogue public n’est fourni', async () => {
    await page.goto(origin + '/?order=1&withoutLoyalty=1'); await tab('Carte').waitFor();
    expect(await tab('Fidélité').count()).toBe(0); expect(await tab('Compte').count()).toBe(1);
    await tab('Compte').click(); await page.getByRole('heading', { name: 'Mon compte', exact: true }).waitFor();
    expect(await page.getByRole('button', { name: 'Ma carte fidélité' }).count()).toBe(0);
  });

  it('le lien fidélité de la vitrine rejoint la même app sans perdre le panier', async () => {
    await page.goto(origin + '/?order=1'); await tab('Carte').waitFor();
    await page.getByRole('article', { name: 'Canette recette', exact: true }).getByRole('button').first().click();
    await page.locator('.sm-order').evaluate(node => node.setAttribute('data-fixture-instance', 'same'));
    const link = page.getByRole('link', { name: 'Découvrir la fidélité', exact: true });
    expect(await link.getAttribute('href')).toBe('/r/recette/fidelite');
    await link.click(); await page.getByRole('heading', { name: 'Ma fidélité', exact: true }).waitFor();
    expect(await page.locator('.sm-order').getAttribute('data-fixture-instance')).toBe('same');
    await tab('Carte').click(); expect(await page.locator('.sm-order-cart-count').textContent()).toBe('1');
  });

  it('conserve les destinations de consultation quand la commande publique est en pause', async () => {
    await page.goto(origin + '/?order=1&paused=1'); await tab('Carte').waitFor();
    expect(await page.getByRole('tab').allTextContents()).toEqual(['Carte', 'Rechercher', 'Commandes', 'Fidélité', 'Compte']);
    expect(await page.getByRole('article', { name: 'Canette recette', exact: true }).getByRole('button').first().isDisabled()).toBe(true);
    await tab('Rechercher').click(); await page.getByRole('searchbox', { name: 'Rechercher dans la carte' }).waitFor();
  });

  it('désactive aussi le panier flottant pendant la reprise privée et le rouvre sans quitter la coque', async () => {
    await page.goto(origin + '/?order=1'); await tab('Carte').waitFor(); await authenticate();
    await page.getByRole('article', { name: 'Canette recette', exact: true }).getByRole('button').first().click();
    await tab('Commandes').click(); await page.getByRole('button', { name: 'Voir la commande n° 42' }).click();
    await page.getByRole('button', { name: 'Préparer à nouveau ce panier', exact: true }).click();
    await page.getByRole('button', { name: /^Ajouter 1 article/ }).waitFor();
    reorderGate = new Promise(resolve => { releaseReorder = resolve; });
    await page.getByRole('button', { name: /^Ajouter 1 article/ }).click();
    await expect.poll(() => page.getByRole('button', { name: /Voir mon panier/ }).isDisabled()).toBe(true);
    expect(await tab('Carte').isDisabled()).toBe(true);
    releaseReorder?.(); await page.getByRole('button', { name: 'Retrouver mon panier', exact: true }).click();
    await page.getByRole('dialog').waitFor();
    expect(new URL(page.url()).pathname).toBe('/r/recette/commandes');
    expect(calls.filter(call=>call.method==='POST' && call.path.endsWith('/recommander'))).toHaveLength(2);
  });

  it.each([320,390,820,1440])('montre les quatre destinations dans la coque réelle à %ipx', async width => {
    await page.setViewportSize({width,height:1000});await page.goto(origin+'/?order=1');await tab('Carte').waitFor();await authenticate();
    for(const name of ['Carte','Compte','Fidélité','Commandes']){
      await tab(name).click();
      if(name==='Compte')await page.getByRole('heading',{name:'Mon compte',exact:true}).waitFor();
      if(name==='Fidélité')await page.getByText('25 points',{exact:true}).waitFor();
      if(name==='Commandes')await page.getByRole('button',{name:'Voir la commande n° 42'}).waitFor();
      await expect.poll(()=>tab(name).getAttribute('aria-selected')).toBe('true');
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
      const navigation = page.locator('[data-sm-tabbar]');
      for (const button of await navigation.getByRole('tab').all()) {
        const box = await button.boundingBox(); expect(box?.height).toBeGreaterThanOrEqual(44); expect(box?.width).toBeGreaterThanOrEqual(44);
        const label = await button.locator(':scope > span').nth(1).evaluate(node => ({ width: node.clientWidth, text: node.scrollWidth, font: Number.parseFloat(getComputedStyle(node).fontSize), family: getComputedStyle(node).fontFamily, weight: getComputedStyle(node).fontWeight, spacing: getComputedStyle(node).letterSpacing, name: node.textContent }));
        expect(label.font).toBeGreaterThanOrEqual(10); expect(label.text, JSON.stringify(label)).toBeLessThanOrEqual(label.width + 1);
      }
      if(process.env.SM_QA_CUSTOMER_NAV_DIR){await mkdir(process.env.SM_QA_CUSTOMER_NAV_DIR,{recursive:true});await page.screenshot({path:join(process.env.SM_QA_CUSTOMER_NAV_DIR,`${width}-${name}.png`)});}
    }
    await page.getByRole('tab',{name:'Cet appareil',exact:true}).click();
    await page.getByRole('heading',{name:'Sur cet appareil',exact:true}).waitFor();
    expect(await page.getByRole('heading',{name:'Mes commandes',exact:true}).count()).toBe(1);
    expect(await page.getByRole('region',{name:'Commandes de votre compte',exact:true}).count()).toBe(0);
  });

  it('garde la page pendant un retrait QR en cours, y compris le retour du navigateur', async () => {
    savedCard = true; await page.goto(origin + '/r/recette/fidelite');
    await tab('Compte').click(); await tab('Fidélité').click();
    await page.getByText('Solde de Camille carte existante', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Retirer', exact: true }).click();
    deleteGate = new Promise(resolve => { releaseDelete = resolve; });
    await page.getByRole('button', { name: 'Retirer la carte', exact: true }).click();
    await expect.poll(() => calls.filter(call => call.method === 'DELETE').length).toBe(1);
    await page.goBack();
    await expect.poll(() => new URL(page.url()).pathname).toBe('/r/recette/fidelite');
    expect(await page.getByRole('button', { name: 'Retrait…', exact: true }).isDisabled()).toBe(true);
    releaseDelete?.(); await page.getByRole('button', { name: 'Scanner mon QR', exact: true }).waitFor();
    await tab('Compte').click(); await page.getByRole('heading', { name: 'Mon compte', exact: true }).waitFor();
  });
});
