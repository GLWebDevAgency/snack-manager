import { createServer, type Server } from 'node:http';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build, type BuildOptions } from 'esbuild';
import postcss from 'postcss';
import tailwind from '@tailwindcss/postcss';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { marqueDeRepli } from '@sm/contracts';

declare global { interface Window { customerAccountUiFixture: {
  patch(patch: Record<string, unknown>): void; calls: unknown[][]; failure: boolean; hold: boolean;
  release(): void; view(): Record<string, unknown>;
} } }
let server: Server, browser: Browser, context: BrowserContext, page: Page, origin: string;
let faults: string[], evidence: string | undefined;

// Native React, real account components, Sheet/focus/brand CSS. Only the account
// hook is a controlled test port in the first group. The second group uses the
// real hook/client against isolated HTTP fixtures, not a live BFF/provider.
beforeAll(async () => {
  const root = fileURLToPath(new URL('.', import.meta.url));
  const cssPath = fileURLToPath(new URL('../../app/globals.css', import.meta.url));
  const options: BuildOptions & { write: false } = { stdin: { contents: `import React from 'react';import{createRoot}from'react-dom/client';
      import{CustomerAccountEntry}from'./CustomerAccountEntry';import{marqueDeRepli}from'@sm/contracts';import{styleDuMasque}from'../masque/styleDuMasque';
      function Fixture(){return <main style={styleDuMasque(marqueDeRepli(null,null))} className="min-h-dvh bg-bg p-4 text-ink"><h1>Restaurant de recette</h1><CustomerAccountEntry slug="recette" restaurantName="Le Comptoir" loyaltyHref="/r/recette/fidelite" onDeviceOrders={()=>window.customerAccountUiFixture.calls.push(['orders'])}/><button>Commander en invité</button></main>}
      createRoot(document.getElementById('root')).render(<React.StrictMode><Fixture/></React.StrictMode>);`,
      resolveDir: root, sourcefile: 'customer-account-ui.tsx', loader: 'tsx' }, bundle: true, write: false,
      format: 'esm', outdir: '/virtual-customer-account', platform: 'browser', jsx: 'automatic', target: 'es2022',
      alias: { react: fileURLToPath(new URL('../../../node_modules/react', import.meta.url)), 'react-dom': fileURLToPath(new URL('../../../node_modules/react-dom', import.meta.url)) },
      define: { 'process.env': '{}', 'process.env.NODE_ENV': '"production"' }, plugins: [{ name: 'account-hook-test-port', setup(builder) {
        builder.onResolve({ filter: /^\.\/useCustomerAccount$/ }, () => ({ path: 'hook', namespace: 'account-ui' }));
        builder.onLoad({ filter: /^hook$/, namespace: 'account-ui' }, () => ({ resolveDir: root, contents: `import{useEffect,useSyncExternalStore}from'react';
          let state={status:'guest',view:null,available:false,busy:false,message:null};const listeners=new Set();
          const view=()=>({expiresAt:Date.now()+60000,profile:{name:'Camille Test',phoneE164:'+33600000000',phoneVerifiedAt:1700000000000,revision:0}});
          const patch=p=>{state={...state,...p};listeners.forEach(f=>f())};let release=()=>{};
          const fixture=window.customerAccountUiFixture={patch,view,calls:[],failure:false,hold:false,release:()=>release()};
          async function wait(){if(fixture.hold)await new Promise(r=>release=r)}
          export function useCustomerAccount(slug,enabled){const current=useSyncExternalStore(f=>{listeners.add(f);return()=>listeners.delete(f)},()=>state);
            useEffect(()=>{fixture.calls.push(['enabled',enabled])},[enabled]);return{state:current,
            refresh:async()=>{fixture.calls.push(['refresh']);patch({status:state.view?'authenticated':'guest',message:null})},
            saveName:async name=>{const before=state.view;fixture.calls.push(['save',name]);patch({status:'loading',view:null,busy:true});await wait();if(fixture.failure){patch({status:'error',busy:false,message:'Le profil a changé. Actualisez avant de réessayer.'});return false}patch({status:'authenticated',busy:false,view:{...before,profile:{...before.profile,name,revision:before.profile.revision+1}},message:'Profil mis à jour.'});return true},
            logout:async(all=false)=>{fixture.calls.push(['logout',all]);patch({status:'loading',view:null,busy:true});await wait();if(fixture.failure){patch({status:'error',busy:false,message:'La déconnexion ne peut pas être confirmée. Réessayez.'});return false}patch({status:'guest',busy:false,view:null,message:'Vous êtes déconnecté.'});return true}}}` }));
      } }] };
  const navigationOptions: typeof options = { ...options, stdin: { ...options.stdin!, contents: `
    import React from 'react';import{createRoot}from'react-dom/client';
    import{Storefront}from'../order/Storefront';import{orderingApi}from'../order/api';import{demoSite}from'../order/demo/fixture';
    import{LoyaltyCardApp}from'../loyalty/LoyaltyCardApp';import{marqueDeRepli,LoyaltyPublicProgramSchema}from'@sm/contracts';
    const brand=marqueDeRepli(null,null);const catalog=LoyaltyPublicProgramSchema.parse({restaurant:{slug:'recette',name:'Le Comptoir',brand,brandColor:'#c9a15a',logoUrl:null},program:{name:'La carte du Comptoir',mechanism:'points',unitLabelSingular:'point',unitLabelPlural:'points',termsSummary:'Récompenses à demander au comptoir.'},rewards:[]});
    async function start(){let node;if(location.pathname==='/loyalty'){node=<LoyaltyCardApp catalog={catalog}/>;}else{const raw=demoSite(new Date(),()=>0);raw.tenant.slug='recette';raw.tenant.brand=brand;raw.menu={categories:[{_id:'${'c'.repeat(24)}',name:'Boissons',products:[{_id:'${'d'.repeat(24)}',name:'Canette recette',price:150,available:true,stockout:false,variants:[],optionGroups:[],ingredients:[],supplements:[],photoUrl:null}]}]};const site=await orderingApi({send:async()=>({status:200,body:raw})}).loadSite('recette');node=<Storefront site={site} loyalty={{chemin:'/r/recette/fidelite',programme:catalog.program.name,uniteSingulier:'point',unitePluriel:'points',premiere:null}}/>;}createRoot(document.getElementById('root')).render(<React.StrictMode>{node}</React.StrictMode>)}start();` },
    define: { ...options.define, 'process.env.NEXT_PUBLIC_API_URL': '"/api"' },
    plugins: [{ name: 'local-navigation-provider-boundaries', setup(builder) {
      // Navigation only: no checkout/payment or Next font download is exercised.
      builder.onResolve({ filter: /\/StripeCard$/ }, () => ({ path: 'stripe', namespace: 'account-navigation' }));
      builder.onLoad({ filter: /^stripe$/, namespace: 'account-navigation' }, () => ({ contents: 'export const apparenceStripeDe=()=>({});export function StripeCard(){return null}' }));
      builder.onResolve({ filter: /^next\/font\/google$/ }, () => ({ path: 'font', namespace: 'account-navigation' }));
      builder.onLoad({ filter: /^font$/, namespace: 'account-navigation' }, () => ({ contents: `const font=()=>({variable:'',className:'',style:{fontFamily:'Arial'}});export {${['Alegreya_Sans', 'Archivo', 'Archivo_Black', 'Bricolage_Grotesque', 'Cormorant_Garamond', 'Familjen_Grotesk', 'Figtree', 'Fraunces', 'Instrument_Sans', 'JetBrains_Mono', 'Lato', 'Libre_Baskerville', 'Manrope', 'Nunito', 'Nunito_Sans', 'Outfit', 'Playfair_Display', 'Source_Sans_3'].map(name => `font as ${name}`).join(',')}}` }));
    } }],
  };
  const [bundle, realBundle, navigationBundle, css] = await Promise.all([
    build(options), build({ ...options, plugins: [] }),
    build(navigationOptions),
    readFile(cssPath, 'utf8').then(source => postcss([tailwind({ base: fileURLToPath(new URL('../../..', import.meta.url)) })]).process(source, { from: cssPath })),
  ]);
  server = createServer((request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    if (request.url === '/app.js') { response.setHeader('Content-Type', 'text/javascript'); response.end(bundle.outputFiles.find(file => file.path.endsWith('.js'))!.text); return; }
    if (request.url === '/real.js') { response.setHeader('Content-Type', 'text/javascript'); response.end(realBundle.outputFiles.find(file => file.path.endsWith('.js'))!.text); return; }
    if (request.url === '/navigation.js') { response.setHeader('Content-Type', 'text/javascript'); response.end(navigationBundle.outputFiles.find(file => file.path.endsWith('.js'))!.text); return; }
    if (request.url === '/style.css') { response.setHeader('Content-Type', 'text/css'); response.end(css.css + (bundle.outputFiles.find(file => file.path.endsWith('.css'))?.text ?? '')); return; }
    if (request.url === '/favicon.ico') { response.writeHead(204).end(); return; }
    if (['/', '/real', '/storefront', '/loyalty'].includes(request.url ?? '')) { response.setHeader('Content-Type', 'text/html'); response.end(`<!doctype html><html lang="fr"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Customer account UI fixture</title><link rel="stylesheet" href="/style.css"><div id="root"></div><script type="module" src="/${request.url === '/real' ? 'real' : request.url === '/' ? 'app' : 'navigation'}.js"></script></html>`); return; }
    if (request.url === '/api/public/funnel') { response.writeHead(204).end(); return; }
    response.writeHead(404).end();
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('No local port');
  origin = `http://127.0.0.1:${address.port}`; browser = await chromium.launch({ headless: true });
  if (process.env.QA_CUSTOMER_ACCOUNT_CAPTURE === '1') { evidence = await mkdtemp(join(tmpdir(), 'sm-customer-account-ui-')); process.stdout.write(`Customer account UI captures: ${evidence}\n`); }
}, 30_000);
beforeEach(async () => {
  faults = []; context = await browser.newContext({ viewport: { width: 320, height: 780 }, reducedMotion: 'reduce', serviceWorkers: 'block' });
  await context.route('**/*', route => {
    if (new URL(route.request().url()).origin === origin) return route.continue();
    faults.push('External request refused'); return route.abort();
  });
  page = await context.newPage(); page.setDefaultTimeout(5_000); page.on('pageerror', error => faults.push(error.message));
  page.on('console', message => {
    if (!['warning', 'error'].includes(message.type())) return;
    if (/Service Worker registration blocked by Playwright/.test(message.text())) return; // Deliberate isolated-context boundary.
    if (message.location().url.startsWith(`${origin}/r/recette/compte/`)
      && /Failed to load resource:.*(?:401|409|429|503)/.test(message.text())) return; // Explicit HTTP refusal fixtures below.
    faults.push(`Unexpected browser ${message.type()}: ${message.text()}`);
  });
  await page.goto(origin); await page.waitForFunction(() => Boolean(window.customerAccountUiFixture));
  await page.getByRole('button', { name: 'Mon compte', exact: true }).waitFor();
});

describe('customer entry placement — real Storefront and loyalty components', () => {
  const catalog = { restaurant: { slug: 'recette', name: 'Le Comptoir', brand: marqueDeRepli(null, null), brandColor: '#c9a15a' },
    program: { name: 'La carte du Comptoir', mechanism: 'points', unitLabelSingular: 'point', unitLabelPlural: 'points', termsSummary: 'Récompenses à demander au comptoir.' } };
  async function navigationFixture(card: boolean) {
    let personalReads = 0; const mutations: string[] = [];
    await context.route(`${origin}/r/recette/**`, async route => {
      const request = route.request(); const path = new URL(request.url()).pathname;
      if (request.method() !== 'GET') { mutations.push(request.method()); return route.abort(); }
      if (path.endsWith('/fidelite/card-session')) return card
        ? route.fulfill({ json: { ...catalog, member: { alias: 'Camille recette', balanceUnits: 12 }, rewards: [], activity: [] } })
        : route.fulfill({ status: 204 });
      if (path.endsWith('/compte/capacites')) { personalReads++; return route.fulfill({ json: { available: false } }); }
      if (path.endsWith('/compte/session')) { personalReads++; return route.fulfill({ status: 401 }); }
      faults.push('Unexpected navigation request'); return route.abort();
    });
    return { reads: () => personalReads, mutations };
  }
  it('keeps ordering primary and opens local orders from the account panel without competing dialogs', async () => {
    const requests = await navigationFixture(false); await page.goto(`${origin}/storefront`);
    await page.getByRole('button', { name: 'Commander maintenant', exact: true }).waitFor();
    expect(requests.reads()).toBe(0);
    for (const width of [320, 390, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      const primary = page.getByRole('button', { name: 'Commander maintenant', exact: true });
      const entry = page.getByRole('button', { name: 'Mon compte', exact: true });
      expect(await entry.count()).toBe(1); expect(await page.getByRole('button', { name: 'Mes commandes sur cet appareil', exact: true }).count()).toBe(1);
      const geometry = await accountNavigationGeometry();
      try { assertAccountNavigationAligned(geometry, width); }
      catch (error) {
        const failure = await mkdtemp(join(tmpdir(), 'sm-account-layout-failure-'));
        await page.screenshot({ path: join(failure, `storefront-${width}.png`) });
        process.stdout.write(`Customer navigation failure capture: ${failure}\n`);
        throw error;
      }
      expect(await primary.evaluate(node => getComputedStyle(node).backgroundColor)).not.toBe(await entry.evaluate(node => getComputedStyle(node).backgroundColor));
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      if (evidence) await page.screenshot({ path: join(evidence, `storefront-${width}.png`) });
    }
    await open(); await page.getByText('La création et la connexion au compte ne sont pas encore ouvertes.').waitFor();
    await page.getByRole('dialog', { name: 'Mon compte' }).getByRole('button', { name: 'Mes commandes sur cet appareil', exact: true }).click();
    await page.getByRole('dialog', { name: 'Mes commandes', exact: true }).waitFor();
    await expect.poll(() => page.getByRole('dialog').count()).toBe(1);
    await page.keyboard.press('Escape'); await expect.poll(() => page.getByRole('dialog').count()).toBe(0);
    expect(requests.mutations).toEqual([]);
  });
  it('isolates the reflow counterexample in one browser turn and rejects a displaced sibling', async () => {
    await navigationFixture(false); await page.goto(`${origin}/storefront`);
    await page.getByRole('navigation', { name: 'Vos accès personnels', exact: true }).waitFor();
    const nav = page.getByRole('navigation', { name: 'Vos accès personnels', exact: true });
    const { current: initial, scenario } = await nav.evaluate(sampleAccountNavigation, true);
    expect(scenario).not.toBeNull();
    expect(Math.abs(initial.account.y - scenario!.moved.orders.y)).toBe(44.78125);
    assertAccountNavigationAligned(scenario!.moved, 320);
    expect(Math.abs(scenario!.broken.account.y - scenario!.broken.orders.y)).toBe(44);
    expect(() => assertAccountNavigationAligned(scenario!.broken, 320)).toThrow();
  });
  it('keeps the loyalty card and ordering readable, with no duplicate link back to the same card', async () => {
    const requests = await navigationFixture(true); await page.goto(`${origin}/loyalty`);
    await page.getByText('Solde de Camille recette', { exact: true }).waitFor();
    expect(requests.reads()).toBe(0);
    for (const width of [320, 390, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      expect(await page.getByRole('button', { name: 'Mon compte', exact: true }).count()).toBe(1);
      expect(await page.getByRole('link', { name: /Commander/ }).count()).toBe(1);
      expect(await page.getByRole('link', { name: /Commander/ }).getAttribute('href')).toBe('/r/recette');
      expect(await page.getByRole('button', { name: 'Scanner mon QR', exact: true }).count()).toBe(0);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      if (evidence) await page.screenshot({ path: join(evidence, `loyalty-${width}.png`) });
    }
    await open(); await page.getByText('La création et la connexion au compte ne sont pas encore ouvertes.').waitFor();
    expect(await page.getByRole('dialog').getByRole('link', { name: 'Fidélité du restaurant', exact: true }).count()).toBe(0);
    expect(await page.getByRole('dialog').getByText('+33600000000', { exact: true }).count()).toBe(0);
    expect(requests.mutations).toEqual([]);
  });
  it.each([['storefront', 'Revenir au menu'], ['loyalty', 'Revenir à la fidélité']])('names the actual return destination on %s', async (path, label) => {
    const requests = await navigationFixture(false); await page.goto(`${origin}/${path}`); await open();
    const back = page.getByRole('button', { name: label, exact: true });
    await back.waitFor(); await back.click();
    await expect.poll(() => page.getByRole('dialog').count()).toBe(0);
    expect(page.url()).toBe(`${origin}/${path}`);
    expect(await page.getByRole('button', { name: 'Mon compte', exact: true }).evaluate(node => document.activeElement === node)).toBe(true);
    expect(requests.mutations).toEqual([]);
  });
  it('describes the scanner before opening it, without inventing a saved card or an account', async () => {
    const requests = await navigationFixture(false); await page.goto(`${origin}/loyalty`);
    const scan = page.getByRole('button', { name: 'Scanner mon QR', exact: true }); await scan.waitFor();
    expect(await page.getByRole('button', { name: 'Afficher ma carte', exact: true }).count()).toBe(0);
    expect(await page.getByRole('link', { name: 'Voir le menu du restaurant', exact: true }).getAttribute('href')).toBe('/r/recette');
    await page.evaluate(() => { navigator.mediaDevices.getUserMedia = async () => { throw new DOMException('Fixture camera disabled', 'NotAllowedError'); }; });
    await scan.click(); await page.getByRole('dialog', { name: 'Scanner ma carte fidélité', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Fermer le scanner', exact: true }).click();
    await expect.poll(() => page.getByRole('dialog').count()).toBe(0);
    expect(requests.reads()).toBe(0); expect(requests.mutations).toEqual([]);
  });
});

describe('customer account entry — real hook and client, isolated HTTP boundary', () => {
  const fixtureView = () => ({ expiresAt: Date.now() + 600_000,
    profile: { name: 'Camille Test', phoneE164: '+33600000000', phoneVerifiedAt: 1_700_000_000_000, revision: 0 } });
  it('shows real offline state without a no-op retry and reads authority only after reconnecting', async () => {
    const requests: string[] = []; let sessionReads = 0; let release!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    await context.route(`${origin}/r/recette/compte/**`, async route => {
      const request = route.request(); const path = new URL(request.url()).pathname;
      requests.push(`${request.method()} ${path.split('/').at(-1)}`);
      if (request.method() !== 'GET') { faults.push('Unexpected mutation'); return route.abort(); }
      if (path.endsWith('/capacites')) return route.fulfill({ json: { available: false } });
      if (++sessionReads === 1) return route.fulfill({ json: fixtureView() });
      await held;
      return route.fulfill({ status: 401 });
    });
    await page.goto(`${origin}/real`); await page.getByRole('button', { name: 'Mon compte', exact: true }).waitFor();
    try {
      await context.setOffline(true); expect(await page.evaluate(() => navigator.onLine)).toBe(false);
      await open(); await page.getByRole('heading', { name: 'Vous êtes hors connexion', exact: true }).waitFor();
      expect(await page.getByRole('button', { name: 'Réessayer', exact: true }).count()).toBe(0);
      expect(await page.getByRole('status').count()).toBe(1); expect(requests).toEqual([]);
      expect(await page.getByLabel('Votre prénom ou nom').count()).toBe(0);
      if (evidence) await page.screenshot({ path: join(evidence, 'offline-real-320.png') });
      await context.setOffline(false);
      await page.getByLabel('Votre prénom ou nom').waitFor();
      expect(requests.slice().sort()).toEqual(['GET capacites', 'GET session']);
      await page.getByLabel('Votre prénom ou nom').fill('Brouillon à effacer');
      await context.setOffline(true);
      await page.getByRole('heading', { name: 'Vous êtes hors connexion', exact: true }).waitFor();
      expect(await page.getByLabel('Votre prénom ou nom').count()).toBe(0);
      expect(await page.getByText('+33600000000', { exact: true }).count()).toBe(0);
      expect(await page.getByRole('button', { name: 'Réessayer', exact: true }).count()).toBe(0);
      expect(requests).toHaveLength(2);
      await context.setOffline(false);
      await page.getByText('Vérification de votre session…', { exact: true }).waitFor();
      await expect.poll(() => requests.length).toBe(4);
      expect(await page.getByLabel('Votre prénom ou nom').count()).toBe(0);
      release(); await page.getByRole('heading', { name: 'Vous naviguez en invité', exact: true }).waitFor();
      expect(requests.slice().sort()).toEqual(['GET capacites', 'GET capacites', 'GET session', 'GET session']);
      expect(await page.getByRole('button', { name: /inscrire|connecter|envoyer.*code/i }).count()).toBe(0);
    } finally { release(); await context.setOffline(false); }
  });
  it('loads only on opening, saves through fresh session checks and confirms server logout', async () => {
    let view = fixtureView(); const requests: { method: string; path: string; body: unknown }[] = [];
    await context.route(`${origin}/r/recette/compte/**`, async route => {
      const request = route.request(); const path = new URL(request.url()).pathname;
      const method = request.method(); const body: unknown = request.postData() ? request.postDataJSON() : null;
      requests.push({ method, path, body });
      if (path.endsWith('/capacites')) return route.fulfill({ json: { available: false } });
      if (method === 'GET' && path.endsWith('/session')) return route.fulfill({ json: view });
      if (method === 'PATCH' && path.endsWith('/profil')) {
        expect(body).toEqual({ name: 'Alex Test', expectedRevision: 0 });
        view = { ...view, profile: { ...view.profile, name: 'Alex Test', revision: 1 } };
        return route.fulfill({ json: view });
      }
      if (method === 'DELETE' && path.endsWith('/session')) {
        expect(body).toEqual({ all: false }); return route.fulfill({ status: 204 });
      }
      faults.push('Unexpected customer endpoint'); return route.abort();
    });
    await page.goto(`${origin}/real`); await page.getByRole('button', { name: 'Mon compte', exact: true }).waitFor();
    expect(requests).toEqual([]); await open(); await page.getByLabel('Votre prénom ou nom').waitFor();
    expect(await page.getByLabel('Votre prénom ou nom').inputValue()).toBe('Camille Test');
    await page.getByLabel('Votre prénom ou nom').fill('Alex Test');
    await page.getByRole('button', { name: 'Enregistrer mon profil', exact: true }).click();
    await page.getByText('Votre nom a été mis à jour.', { exact: true }).waitFor();
    expect(await page.getByLabel('Votre prénom ou nom').inputValue()).toBe('Alex Test');
    await page.getByRole('button', { name: 'Déconnecter cet appareil', exact: true }).click();
    expect(requests.filter(request => request.method === 'DELETE')).toHaveLength(0);
    await page.getByRole('button', { name: 'Confirmer la déconnexion', exact: true }).click();
    await page.getByText('Déconnexion confirmée.', { exact: true }).waitFor();
    expect(await page.getByLabel('Votre prénom ou nom').count()).toBe(0);
    const sequence = requests.map(request => `${request.method} ${request.path.split('/').at(-1)}`);
    // The opening capability and session reads are independent HTTP requests.
    expect(sequence.slice(0, 2).sort()).toEqual(['GET capacites', 'GET session']);
    expect(sequence.slice(2)).toEqual(['GET session', 'PATCH profil', 'GET session', 'DELETE session']);
  });
  it('removes the private view while saving and after a lost response, then rereads only on request', async () => {
    const view = fixtureView(); let reads = 0; let writes = 0;
    let release!: () => void; const held = new Promise<void>(resolve => { release = resolve; });
    await context.route(`${origin}/r/recette/compte/**`, async route => {
      const request = route.request(); const path = new URL(request.url()).pathname;
      if (path.endsWith('/capacites')) return route.fulfill({ json: { available: false } });
      if (request.method() === 'GET' && path.endsWith('/session')) { reads++; return route.fulfill({ json: view }); }
      if (request.method() === 'PATCH' && path.endsWith('/profil')) { writes++; await held; return route.fulfill({ status: 503 }); }
      faults.push('Unexpected customer endpoint'); return route.abort();
    });
    try {
      await page.goto(`${origin}/real`); await open(); await page.getByLabel('Votre prénom ou nom').waitFor();
      await page.getByLabel('Votre prénom ou nom').fill('Saisie incertaine');
      await page.getByRole('button', { name: 'Enregistrer mon profil', exact: true }).click();
      await expect.poll(() => writes).toBe(1);
      expect(await page.getByLabel('Votre prénom ou nom').count()).toBe(0);
      expect(await page.getByText('+33600000000', { exact: true }).count()).toBe(0);
      expect(await page.getByRole('button', { name: 'Fermer', exact: true }).isDisabled()).toBe(true);
      release();
      await page.getByText('L’action n’est pas confirmée. Actualisez votre compte avant de recommencer.', { exact: true }).waitFor();
      expect(reads).toBe(2); expect(writes).toBe(1);
      expect(await page.getByLabel('Votre prénom ou nom').count()).toBe(0);
      await page.getByRole('button', { name: 'Réessayer', exact: true }).click();
      await page.getByLabel('Votre prénom ou nom').waitFor();
      expect(await page.getByLabel('Votre prénom ou nom').inputValue()).toBe('Camille Test');
      expect(reads).toBe(3); expect(writes).toBe(1);
    } finally { release(); }
  });
  it('refuses a stale profile at preflight and exposes an explicit refresh without rewriting it', async () => {
    let view = fixtureView(); let writes = 0;
    await context.route(`${origin}/r/recette/compte/**`, async route => {
      const request = route.request(); const path = new URL(request.url()).pathname;
      if (path.endsWith('/capacites')) return route.fulfill({ json: { available: false } });
      if (request.method() === 'GET' && path.endsWith('/session')) return route.fulfill({ json: view });
      writes++; return route.fulfill({ status: 409 });
    });
    await page.goto(`${origin}/real`); await open(); await page.getByLabel('Votre prénom ou nom').waitFor();
    await page.getByLabel('Votre prénom ou nom').fill('Saisie ancienne');
    view = { ...view, profile: { ...view.profile, name: 'Nom actualisé', revision: 1 } };
    await page.getByRole('button', { name: 'Enregistrer mon profil', exact: true }).click();
    await page.getByText('Votre accès ou votre profil a changé. Actualisez votre compte avant de continuer.', { exact: true }).waitFor();
    expect(writes).toBe(0); expect(await page.getByLabel('Votre prénom ou nom').count()).toBe(0);
    await page.getByRole('button', { name: 'Réessayer', exact: true }).click();
    await page.getByLabel('Votre prénom ou nom').waitFor();
    expect(await page.getByLabel('Votre prénom ou nom').inputValue()).toBe('Nom actualisé'); expect(writes).toBe(0);
  });
});
afterEach(async () => { await context?.close(); expect(faults).toEqual([]); });
afterAll(async () => { await browser?.close(); if (server) await new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()); }); });
const open = async () => { await page.getByRole('button', { name: 'Mon compte', exact: true }).click(); await page.getByRole('dialog', { name: 'Mon compte', exact: true }).waitFor(); };
const authenticate = () => page.evaluate(() => window.customerAccountUiFixture.patch({ status: 'authenticated', view: window.customerAccountUiFixture.view() }));
const calls = () => page.evaluate(() => window.customerAccountUiFixture.calls);

function sampleAccountNavigation(nav: Element, simulateReflow: boolean) {
  const account = nav.querySelector('[aria-label="Mon compte"]');
  const orders = nav.querySelector('[aria-label="Mes commandes sur cet appareil"]');
  if (!(nav instanceof HTMLElement) || !account || !(orders instanceof HTMLElement)) throw new Error('Customer navigation controls missing');
  const read = () => ({ width: innerWidth, scrollY, fonts: document.fonts.status, display: getComputedStyle(nav).display,
    account: account.getBoundingClientRect().toJSON(), orders: orders.getBoundingClientRect().toJSON() });
  const current = read();
  if (!simulateReflow) return { current, scenario: null };
  const original = [nav.style.position, nav.style.top, orders.style.position, orders.style.top];
  try {
    // The counterexample also stays in ONE synchronous browser turn. No
    // font/banner update or scroll anchoring task can intervene between states.
    // Relative offsets do not exercise cf-press's animated transform property.
    nav.style.position = 'relative'; nav.style.top = '44.78125px';
    const moved = read();
    orders.style.position = 'relative'; orders.style.top = '44px';
    return { current, scenario: { moved, broken: read() } };
  } finally {
    [nav.style.position, nav.style.top, orders.style.position, orders.style.top] = original as [string, string, string, string];
  }
}
async function accountNavigationGeometry() {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  });
  // Read both siblings in the SAME browser turn. Separate boundingBox RPCs
  // could compare opposite sides of a resize/reflow that moves their parent.
  return (await page.getByRole('navigation', { name: 'Vos accès personnels', exact: true }).evaluate(sampleAccountNavigation, false)).current;
}
function assertAccountNavigationAligned(geometry: Awaited<ReturnType<typeof accountNavigationGeometry>>, width: number) {
  const diagnostic = JSON.stringify({ expectedWidth: width, ...geometry });
  expect(geometry.width, diagnostic).toBe(width);
  expect(Math.abs(geometry.account.y - geometry.orders.y), diagnostic).toBeLessThanOrEqual(1);
  expect(geometry.account.height, diagnostic).toBeGreaterThanOrEqual(44);
  expect(geometry.orders.height, diagnostic).toBeGreaterThanOrEqual(44);
}

describe('customer account panel — rendered boundaries', () => {
  it.each([
    ['guest', 'Vous naviguez en invité'],
    ['unavailable', 'Compte indisponible pour le moment'],
    ['offline', 'Vous êtes hors connexion'],
    ['error', 'Vérification interrompue'],
  ])('presents one factual %s state without duplicate advice', async (status, title) => {
    const message = 'Votre compte ne peut pas être vérifié pour le moment. La commande en invité reste disponible.';
    await page.evaluate(({ status, message }) => window.customerAccountUiFixture.patch({ status, message, view: null }), { status, message });
    await open(); await page.getByRole('heading', { name: title, exact: true }).waitFor();
    const statusBox = page.getByRole('status'); expect(await statusBox.count()).toBe(1);
    expect(await statusBox.getByText(message, { exact: true }).count()).toBe(1);
    expect(await page.getByText('Nous ne pouvons pas confirmer votre session pour le moment. Votre commande reste accessible en invité.', { exact: true }).count()).toBe(0);
    expect(await page.getByRole('heading', { name: 'Autres accès', exact: true }).count()).toBe(1);
    expect(await page.getByRole('link', { name: 'Fidélité du restaurant', exact: true }).getAttribute('href')).toBe('/r/recette/fidelite');
  });
  it.each([
    'L’action n’est pas confirmée. Actualisez votre compte avant de recommencer.',
    'Votre accès ou votre profil a changé. Actualisez votre compte avant de continuer.',
    'Trop de demandes. Patientez avant de réessayer.',
  ])('preserves the exact action or quota message: %s', async message => {
    await page.evaluate(message => window.customerAccountUiFixture.patch({ status: 'error', message, view: null }), message);
    await open(); const status = page.getByRole('status');
    expect(await status.getByRole('heading', { name: 'Vérification interrompue', exact: true }).count()).toBe(1);
    expect(await status.getByText(message, { exact: true }).count()).toBe(1);
    expect(await page.getByText(message, { exact: true }).count()).toBe(1);
    expect(await page.getByLabel('Votre prénom ou nom').count()).toBe(0);
  });
  it.each([320, 390, 1440])('keeps the concise closed panel operable at %ipx including short mobile height', async width => {
    const height = width === 320 ? 568 : width === 390 ? 700 : 900;
    await page.setViewportSize({ width, height });
    await page.evaluate(() => window.customerAccountUiFixture.patch({ status: 'unavailable', view: null,
      message: 'Votre compte ne peut pas être vérifié pour le moment. La commande en invité reste disponible.' }));
    await open(); await page.getByRole('heading', { name: 'Compte indisponible pour le moment', exact: true }).waitFor();
    const dialog = page.getByRole('dialog', { name: 'Mon compte', exact: true });
    await page.evaluate(async () => { await document.fonts.ready; await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))); });
    expect(await dialog.evaluate(node => {
      const box = node.getBoundingClientRect(); const footer = node.querySelector('[data-dialog-footer]')!.getBoundingClientRect();
      const content = node.querySelector('[data-dialog-content]')!.getBoundingClientRect();
      return box.left >= 0 && box.right <= innerWidth && box.top >= 0 && box.bottom <= innerHeight + 1
        && footer.top >= box.top && footer.bottom <= innerHeight + 1 && content.bottom <= footer.top + 1
        && document.documentElement.scrollWidth <= innerWidth;
    })).toBe(true);
    expect(await page.title()).toBe('Customer account UI fixture'); expect(page.url()).toBe(`${origin}/`);
    expect(await page.locator('nextjs-portal, vite-error-overlay').count()).toBe(0);
    if (evidence) await page.screenshot({ path: join(evidence, `closed-${width}.png`) });
    for (const control of [...await dialog.getByRole('button').all(), ...await dialog.getByRole('link').all()]) {
      await control.scrollIntoViewIfNeeded(); expect((await control.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      expect(await control.evaluate(node => {
        const rect = node.getBoundingClientRect(); const x = rect.left + rect.width / 2; const y = rect.top + rect.height / 2;
        return x >= 0 && x <= innerWidth && y >= 0 && y <= innerHeight && node.contains(document.elementFromPoint(x, y));
      })).toBe(true);
    }
    if (evidence && width === 320) await page.screenshot({ path: join(evidence, 'closed-320-scrolled.png') });
    for (let n = 0; n < 8; n++) { await page.keyboard.press('Tab'); expect(await page.evaluate(() => Boolean(document.activeElement?.closest('[role="dialog"]')))).toBe(true); }
    await page.getByRole('button', { name: 'Revenir au menu', exact: true }).click();
    await expect.poll(() => dialog.count()).toBe(0);
    expect(await page.getByRole('button', { name: 'Mon compte', exact: true }).evaluate(node => document.activeElement === node)).toBe(true);
  });
  it('opens only on demand and preserves the honest guest journey without an OTP CTA', async () => {
    expect((await calls()).filter(call => call[0] === 'enabled').every(call => call[1] === false)).toBe(true);
    expect(await page.getByRole('dialog').count()).toBe(0); await open();
    expect((await calls()).some(call => call[0] === 'enabled' && call[1] === true)).toBe(true);
    expect(await page.getByText('La création et la connexion au compte ne sont pas encore ouvertes.').count()).toBe(1);
    expect(await page.getByRole('button', { name: /inscrire|connecter|envoyer.*code/i }).count()).toBe(0);
    if (evidence) await page.screenshot({ path: join(evidence, 'guest-320.png') });
    await page.getByRole('button', { name: 'Revenir au menu', exact: true }).click();
    await expect.poll(() => page.getByRole('dialog').count()).toBe(0);
    if (evidence) await page.screenshot({ path: join(evidence, 'entry-320.png') });
  });
  it('returns keyboard focus to the trigger and traps tab inside the real Sheet', async () => {
    await page.getByRole('button', { name: 'Mon compte', exact: true }).focus(); await page.keyboard.press('Enter');
    await page.getByRole('dialog', { name: 'Mon compte' }).waitFor();
    for (let n = 0; n < 12; n++) { await page.keyboard.press('Tab'); expect(await page.evaluate(() => Boolean(document.activeElement?.closest('[role="dialog"]')))).toBe(true); }
    await page.keyboard.press('Escape'); await expect.poll(() => page.getByRole('dialog').count()).toBe(0);
    expect(await page.getByRole('button', { name: 'Mon compte', exact: true }).evaluate(node => node === document.activeElement)).toBe(true);
  });
  it('keeps device orders explicitly local and the loyalty link free of identity secrets', async () => {
    await open();
    expect(await page.getByRole('link', { name: 'Fidélité du restaurant', exact: true }).getAttribute('href')).toBe('/r/recette/fidelite');
    await page.getByRole('button', { name: /Mes commandes.*cet appareil/ }).click();
    expect(await calls()).toContainEqual(['orders']); await expect.poll(() => page.getByRole('dialog').count()).toBe(0);
  });
  it('edits the name explicitly, does not edit the verified phone and reports confirmed save', async () => {
    await authenticate(); await open();
    expect(await page.getByText('+33600000000', { exact: true }).count()).toBe(1);
    await page.getByLabel('Votre prénom ou nom').fill('Alex Test');
    expect((await calls()).some(call => call[0] === 'save')).toBe(false);
    await page.getByRole('button', { name: 'Enregistrer mon profil', exact: true }).click();
    await page.getByText('Profil mis à jour.', { exact: true }).waitFor(); expect(await calls()).toContainEqual(['save', 'Alex Test']);
  });
  it('does not silently send a draft against a newer authoritative revision', async () => {
    await authenticate(); await open(); await page.getByLabel('Votre prénom ou nom').fill('Saisie à conserver');
    await page.evaluate(() => { const value = window.customerAccountUiFixture.view(); const profile = value.profile as Record<string, unknown>;
      window.customerAccountUiFixture.patch({ view: { ...value, profile: { ...profile, name: 'Version serveur', revision: 2 } } }); });
    expect(await page.getByRole('button', { name: 'Enregistrer mon profil', exact: true }).isDisabled()).toBe(true);
    expect((await calls()).some(call => call[0] === 'save')).toBe(false);
    await page.getByRole('button', { name: 'Utiliser le profil actualisé', exact: true }).click();
    expect(await page.getByLabel('Votre prénom ou nom').inputValue()).toBe('Version serveur');
  });
  it('clears the draft on a failed mutation and requires an explicit reread, not a silent rewrite', async () => {
    await authenticate(); await open(); await page.getByLabel('Votre prénom ou nom').fill('Ancienne saisie');
    await page.evaluate(() => { window.customerAccountUiFixture.failure = true; });
    await page.getByRole('button', { name: 'Enregistrer mon profil', exact: true }).click();
    await page.getByText('Le profil a changé. Actualisez avant de réessayer.').waitFor();
    expect(await page.getByLabel('Votre prénom ou nom').count()).toBe(0);
    expect((await calls()).filter(call => call[0] === 'save')).toHaveLength(1);
    await page.getByRole('button', { name: 'Réessayer', exact: true }).click();
    expect(await calls()).toContainEqual(['refresh']);
  });
  it('clears personal drafts immediately when the verified view disappears', async () => {
    await authenticate(); await open(); await page.getByLabel('Votre prénom ou nom').fill('Brouillon privé');
    await page.evaluate(() => window.customerAccountUiFixture.patch({ status: 'guest', view: null }));
    expect(await page.getByLabel('Votre prénom ou nom').count()).toBe(0);
    expect(await page.getByText('+33600000000', { exact: true }).count()).toBe(0);
    await authenticate(); expect(await page.getByLabel('Votre prénom ou nom').inputValue()).toBe('Camille Test');
  });
  it('requests explicit logout confirmation and never claims success on an uncertain response', async () => {
    await authenticate(); await open(); await page.getByRole('button', { name: 'Déconnecter cet appareil', exact: true }).click();
    expect((await calls()).some(call => call[0] === 'logout')).toBe(false);
    await page.evaluate(() => { window.customerAccountUiFixture.failure = true; });
    await page.getByRole('button', { name: 'Confirmer la déconnexion', exact: true }).click();
    await page.getByText('La déconnexion ne peut pas être confirmée. Réessayez.').waitFor();
    expect(await page.getByText('+33600000000', { exact: true }).count()).toBe(0);
    expect(await calls()).toContainEqual(['logout', false]);
  });
  it('revokes all sessions only after its dedicated confirmation and removes the displayed profile', async () => {
    await authenticate(); await open(); await page.getByRole('button', { name: 'Déconnecter tous les appareils', exact: true }).click();
    await page.getByText('Déconnecter tous vos appareils ?', { exact: true }).waitFor();
    expect((await calls()).some(call => call[0] === 'logout')).toBe(false);
    await page.getByRole('button', { name: 'Confirmer la déconnexion', exact: true }).click();
    await page.getByText('Vous êtes déconnecté.', { exact: true }).waitFor();
    expect(await calls()).toContainEqual(['logout', true]); expect(await page.getByLabel('Votre prénom ou nom').count()).toBe(0);
  });
  it('does not turn a technical available capability into an invented sign-in form', async () => {
    await page.evaluate(() => window.customerAccountUiFixture.patch({ status: 'guest', available: true }));
    await open();
    expect(await page.getByText('La création et la connexion au compte ne sont pas encore ouvertes.').count()).toBe(1);
    expect(await page.getByRole('textbox').count()).toBe(0);
    expect(await page.getByRole('button', { name: /inscrire|connecter|envoyer.*code/i }).count()).toBe(0);
  });
  it('drops an unsubmitted draft when closing and reopening the personal panel', async () => {
    await authenticate(); await open(); await page.getByLabel('Votre prénom ou nom').fill('Brouillon privé');
    await page.getByRole('button', { name: 'Fermer', exact: true }).click();
    await expect.poll(() => page.getByRole('dialog').count()).toBe(0); await open();
    expect(await page.getByLabel('Votre prénom ou nom').inputValue()).toBe('Camille Test');
    expect((await calls()).some(call => call[0] === 'save')).toBe(false);
  });
  it('blocks repeated actions and closing while a mutation is in progress', async () => {
    await authenticate(); await open(); await page.getByLabel('Votre prénom ou nom').fill('Alex Test');
    await page.evaluate(() => { window.customerAccountUiFixture.hold = true; });
    await page.getByRole('button', { name: 'Enregistrer mon profil', exact: true }).click();
    expect(await page.getByRole('button', { name: 'Fermer', exact: true }).isDisabled()).toBe(true);
    await page.keyboard.press('Escape'); expect(await page.getByRole('dialog').count()).toBe(1);
    expect(await page.getByLabel('Votre prénom ou nom').count()).toBe(0);
    await page.evaluate(() => window.customerAccountUiFixture.release());
    await page.getByText('Profil mis à jour.', { exact: true }).waitFor();
    expect((await calls()).filter(call => call[0] === 'save')).toHaveLength(1);
  });
  it.each(['unavailable', 'offline', 'error'])('shows an honest %s state with appropriate recovery, not an invented profile', async status => {
    await page.evaluate(status => window.customerAccountUiFixture.patch({ status, view: null, message: 'Accès à vérifier.' }), status);
    await open(); expect(await page.getByLabel('Votre prénom ou nom').count()).toBe(0);
    if (status === 'offline') {
      expect(await page.getByRole('button', { name: 'Réessayer', exact: true }).count()).toBe(0);
      expect(await calls()).not.toContainEqual(['refresh']);
    } else {
      await page.getByRole('button', { name: 'Réessayer', exact: true }).click(); expect(await calls()).toContainEqual(['refresh']);
    }
  });
  it('allows explicit refresh from an invalidated idle state without claiming an ongoing read', async () => {
    await page.evaluate(() => window.customerAccountUiFixture.patch({ status: 'idle', view: null, busy: false }));
    await open();
    expect(await page.getByText('Vérification de votre session…', { exact: true }).count()).toBe(0);
    await page.getByRole('button', { name: 'Réessayer', exact: true }).click();
    expect(await calls()).toContainEqual(['refresh']);
  });
  it('respects brand geometry at 320px and desktop with reduced motion', async () => {
    await authenticate(); await open();
    for (const width of [320, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      const dialog = page.getByRole('dialog', { name: 'Mon compte' });
      const box = await dialog.boundingBox(); expect(box!.width).toBeLessThanOrEqual(Math.min(width, 560));
      const save = page.getByRole('button', { name: 'Enregistrer mon profil', exact: true });
      const contrast = await save.evaluate(node => {
        const style = getComputedStyle(node);
        const luminance = (color: string) => {
          const values = color.match(/[\d.]+/g)!.slice(0, 3).map(value => Number(value) / 255)
            .map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
          return values[0]! * 0.2126 + values[1]! * 0.7152 + values[2]! * 0.0722;
        };
        const fg = luminance(style.color); const bg = luminance(style.backgroundColor);
        return (Math.max(fg, bg) + 0.05) / (Math.min(fg, bg) + 0.05);
      });
      expect(contrast).toBeGreaterThanOrEqual(4.5);
      expect(await dialog.evaluate(node => Math.max(...getComputedStyle(node).transitionDuration.split(',').map(value => parseFloat(value))))).toBeLessThanOrEqual(0.001);
      await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
      expect(await dialog.evaluate(node => node.getAnimations({ subtree: true }).filter(animation => animation.playState === 'running').map(animation => animation.effect?.getTiming().iterations))).not.toContain(Infinity);
      if (evidence) await page.screenshot({ path: join(evidence, `profile-${width}.png`) });
    }
  });
});
