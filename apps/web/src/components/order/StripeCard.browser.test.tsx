import { createServer, type Server } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import postcss from 'postcss';
import tailwind from '@tailwindcss/postcss';
import { beforeAll, beforeEach, afterEach, afterAll, describe, expect, it } from 'vitest';

type Result = { error?: { message?: string }; paymentIntent?: { status?: string } };
type Fixture = {
  config: { guard: boolean; unavailable: boolean; throwWallet: boolean; throwDestroy: boolean; holdSubmit: boolean; holdConfirm: boolean; throwSubmit: boolean; throwConfirm: boolean; submitError: string | null; result: Result };
  factories: { key: string; account: string }[];
  groups: { id: number; secret: string; types: string[] }[];
  confirms: { group: number; secret: string; redirect: string; returnUrl: string }[];
  destroyed: string[]; sequence: string[]; starts: number; ends: string[]; paid: number; submits: number;
  failed: { reason: string; message: string }[];
  emit: (name: string, payload?: unknown, previous?: boolean) => void;
  releaseSubmit: () => void; releaseConfirm: (result: Result) => void;
};
declare global { interface Window { stripeFixture: Fixture } }
let server: Server, browser: Browser, context: BrowserContext, page: Page, origin: string;
let faults: string[];

// The real component and browser event loop run here. The Stripe SDK is a
// deterministic fixture; no external script, bank request or payment is sent.
beforeAll(async () => {
  const directory = fileURLToPath(new URL('.', import.meta.url));
  const cssPath = fileURLToPath(new URL('../../app/globals.css', import.meta.url));
  const [bundle, css] = await Promise.all([
    build({ stdin: { contents: `import React,{useState}from'react';import{createRoot}from'react-dom/client';import{StripeCard}from'./StripeCard';
      const f=window.stripeFixture={config:{guard:true,unavailable:location.search.includes('unavailable'),throwWallet:location.search.includes('throw-wallet'),throwDestroy:false,holdSubmit:false,holdConfirm:false,throwSubmit:false,throwConfirm:false,submitError:null,result:{paymentIntent:{status:'succeeded'}}},factories:[],groups:[],confirms:[],destroyed:[],sequence:[],starts:0,ends:[],paid:0,submits:0,failed:[]};
      const wallets=[],submitWaiters=[],confirmWaiters=[],elementGroups=new Map();
      f.emit=(name,payload,previous=false)=>{const wallet=wallets[wallets.length-(previous?2:1)];wallet?.handlers[name]?.(payload??{paymentFailed:failure=>f.failed.push(failure)})};
      f.releaseSubmit=()=>submitWaiters.shift()?.({});f.releaseConfirm=result=>confirmWaiters.shift()?.(result);
      window.Stripe=(key,options)=>{f.factories.push({key,account:options.stripeAccount});return{elements:options=>{
        const group={id:f.groups.length,secret:options.clientSecret,types:[]};f.groups.push(group);
        const elements={create:type=>{group.types.push(type);if(type==='expressCheckout'&&f.config.throwWallet)throw Error('optional wallet unavailable');let target=null;const item={handlers:{},on:(name,handler)=>{item.handlers[name]=handler},mount:node=>{target=node;if(type==='payment'){const input=document.createElement('input');input.setAttribute('aria-label','Carte de recette');node.append(input)}else{const button=document.createElement('button');button.textContent='Portefeuille de recette';button.onclick=()=>item.handlers.confirm?.({paymentFailed:failure=>f.failed.push(failure)});node.append(button);queueMicrotask(()=>item.handlers.ready?.({availablePaymentMethods:f.config.unavailable?null:{applePay:true,googlePay:false}}))}},unmount:()=>target?.replaceChildren(),destroy:()=>{f.destroyed.push(group.id+':'+type);target?.replaceChildren();if(f.config.throwDestroy&&type==='payment')throw Error('fixture cleanup failure')}};if(type==='expressCheckout')wallets.push(item);return item},
          submit:async()=>{f.submits++;f.sequence.push('submit');if(f.config.throwSubmit)throw Error('fixture submit network');if(f.config.holdSubmit)return new Promise(resolve=>submitWaiters.push(resolve));return f.config.submitError?{error:{message:f.config.submitError}}:{}}
        };elementGroups.set(elements,group);return elements},confirmPayment:async options=>{const group=elementGroups.get(options.elements);if(!group)throw Error('Unknown Elements object');f.confirms.push({group:group.id,secret:group.secret,redirect:options.redirect,returnUrl:options.confirmParams.return_url});f.sequence.push('confirm');if(f.config.throwConfirm)throw Error('fixture response lost');if(f.config.holdConfirm)return new Promise(resolve=>confirmWaiters.push(resolve));return f.config.result}}};
      const appearance={theme:'stripe'};
      function App(){const[visible,setVisible]=useState(true),[secret,setSecret]=useState('pi_fixture_secret_one'),[account,setAccount]=useState('acct_fixture_one'),[disabled,setDisabled]=useState(false);
        return<main className='min-h-dvh bg-bg p-4 text-ink'><nav className='flex flex-wrap gap-2'><button onClick={()=>setVisible(false)}>Démonter le paiement</button><button onClick={()=>setSecret('pi_fixture_secret_two')}>Changer l’intention</button><button onClick={()=>setAccount('acct_fixture_two')}>Changer le restaurant</button><button onClick={()=>setDisabled(true)}>Verrouiller le paiement</button></nav>{visible&&<StripeCard publishableKey='pk_test_fixture' stripeAccount={account} clientSecret={secret} amount={1000} apparence={appearance} prixMono={false} returnUrl={location.origin+'/suivi'} disabled={disabled} onConfirmStart={()=>{f.starts++;return f.config.guard}} onConfirmEnd={outcome=>f.ends.push(outcome)} onPaid={()=>{f.paid++}}/>}</main>}
      createRoot(document.getElementById('root')).render(<App/>);`, resolveDir: directory, sourcefile: 'stripe-fixture.tsx', loader: 'tsx' },
      bundle: true, write: false, outdir: '/virtual-stripe-card', format: 'esm', platform: 'browser', target: 'es2022', jsx: 'automatic',
      alias: { react: fileURLToPath(new URL('../../../node_modules/react', import.meta.url)), 'react-dom': fileURLToPath(new URL('../../../node_modules/react-dom', import.meta.url)) },
      define: { 'process.env': '{}', 'process.env.NODE_ENV': '"production"' } }),
    readFile(cssPath, 'utf8').then(source => postcss([tailwind({ base: fileURLToPath(new URL('../../..', import.meta.url)) })]).process(source, { from: cssPath })),
  ]);
  const script = bundle.outputFiles.find(file => file.path.endsWith('.js'))!.text;
  const styles = css.css + (bundle.outputFiles.find(file => file.path.endsWith('.css'))?.text ?? '');
  server = createServer((req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const path = new URL(req.url ?? '/', origin).pathname;
    if (path === '/bundle.js' || path === '/style.css') { res.setHeader('Content-Type', path.endsWith('js') ? 'text/javascript' : 'text/css'); res.end(path.endsWith('js') ? script : styles); return; }
    if (path === '/') { res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"></head><body><div id="root"></div><script type="module" src="/bundle.js"></script></body></html>'); return; }
    if (path === '/favicon.ico') { res.writeHead(204).end(); return; }
    faults.push(`Unexpected request ${path}`); res.writeHead(404).end();
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('Missing port'); origin = `http://127.0.0.1:${address.port}`;
  browser = await chromium.launch({ headless: true });
}, 30_000);
beforeEach(async () => {
  faults = []; context = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce', serviceWorkers: 'block' });
  await context.route('**/*', route => { if (new URL(route.request().url()).origin === origin) return route.continue(); faults.push('External request refused'); return route.abort(); });
  page = await context.newPage(); page.setDefaultTimeout(5_000); page.on('pageerror', error => faults.push(error.message));
});
afterEach(async () => { await context?.close(); expect(faults).toEqual([]); });
afterAll(async () => { await browser?.close(); if (server) await new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()); }); });
const open = async (query = '') => { await page.goto(origin + '/' + query); await page.getByRole('textbox', { name: 'Carte de recette', exact: true }).waitFor(); await page.waitForFunction(() => !(document.querySelector('button[aria-busy]') as HTMLButtonElement | null)?.disabled); };
const pay = () => page.getByRole('button', { name: /^Payer/ });
const wallet = () => page.getByRole('button', { name: 'Portefeuille de recette', exact: true });
const snapshot = () => page.evaluate(() => { const f = window.stripeFixture; return { factories: f.factories, groups: f.groups, confirms: f.confirms, destroyed: f.destroyed, sequence: f.sequence, starts: f.starts, ends: f.ends, paid: f.paid, submits: f.submits, failed: f.failed }; });

describe('Stripe carte et wallets — composant réel, SDK simulé', () => {
  it.each(['?unavailable', '?throw-wallet'])('garde le paiement carte si le portefeuille est absent (%s)', async query => {
    await open(query); expect(await wallet().count()).toBe(0); await pay().click(); await page.waitForFunction(() => window.stripeFixture.ends.length === 1);
    const f = await snapshot(); expect(f.paid).toBe(1); expect(f.submits).toBe(0); expect(f.ends).toEqual(['paid']);
    expect(f.factories).toEqual([{ key: 'pk_test_fixture', account: 'acct_fixture_one' }]);
    expect(f.confirms).toEqual([{ group: 0, secret: 'pi_fixture_secret_one', redirect: 'if_required', returnUrl: origin + '/suivi' }]);
  });
  it('utilise le même Elements et ignore la double confirmation wallet/carte pendant la réponse', async () => {
    await open(); await page.evaluate(() => { window.stripeFixture.config.holdConfirm = true; window.stripeFixture.emit('confirm'); window.stripeFixture.emit('confirm'); });
    await page.waitForFunction(() => window.stripeFixture.confirms.length === 1); expect(await pay().isDisabled()).toBe(true);
    const f = await snapshot(); expect(f.groups).toEqual([{ id: 0, secret: 'pi_fixture_secret_one', types: ['payment', 'expressCheckout'] }]); expect(f.sequence).toEqual(['submit', 'confirm']); expect(f.starts).toBe(1); expect(f.failed).toEqual([]);
    await page.evaluate(() => window.stripeFixture.releaseConfirm({ paymentIntent: { status: 'succeeded' } }));
    await page.waitForFunction(() => window.stripeFixture.ends.length === 1); expect((await snapshot()).ends).toEqual(['paid']);
  });
  it('masque les moyens indisponibles puis réagit aux changements déclarés par Stripe', async () => {
    await open('?unavailable'); expect(await wallet().count()).toBe(0);
    await page.evaluate(() => window.stripeFixture.emit('availablepaymentmethodschange', { paymentMethods: { applePay: { available: false }, googlePay: { available: true } } })); await wallet().waitFor();
    await page.evaluate(() => window.stripeFixture.emit('availablepaymentmethodschange', { paymentMethods: { googlePay: { available: false } } })); await wallet().waitFor({ state: 'hidden' }); expect(await pay().isEnabled()).toBe(true);
  });
  it('conclut un refus du verrou sans soumettre ni déclencher le callback de fin', async () => {
    await open(); await page.evaluate(() => { window.stripeFixture.config.guard = false; window.stripeFixture.emit('confirm'); });
    await page.waitForFunction(() => window.stripeFixture.failed.length === 1); const f = await snapshot(); expect(f.starts).toBe(1); expect(f.submits).toBe(0); expect(f.confirms).toEqual([]); expect(f.ends).toEqual([]); expect(f.failed[0].reason).toBe('fail');
    await pay().click(); expect((await snapshot()).confirms).toEqual([]);
  });
  it('respecte le verrou courant même si le wallet émet après un changement de props', async () => {
    await open(); await page.getByRole('button', { name: 'Verrouiller le paiement', exact: true }).click(); await page.waitForFunction(() => !!document.querySelector('[aria-label="Paiement express"]')?.closest('[inert]'));
    await page.evaluate(() => window.stripeFixture.emit('confirm')); await page.waitForFunction(() => window.stripeFixture.failed.length === 1); expect((await snapshot()).starts).toBe(0); expect((await snapshot()).confirms).toEqual([]);
  });
  it.each(['validation', 'submit-network', 'confirm-error', 'confirm-network', 'unknown'] as const)('annonce %s sans payé et libère exactement le verrou acquis', async fault => {
    await open(); await page.evaluate(fault => { const c = window.stripeFixture.config; if (fault === 'validation') c.submitError = 'Vérifiez votre portefeuille'; if (fault === 'submit-network') c.throwSubmit = true; if (fault === 'confirm-error') c.result = { error: { message: 'Paiement refusé' } }; if (fault === 'confirm-network') c.throwConfirm = true; if (fault === 'unknown') c.result = {}; }, fault);
    await wallet().click(); await page.getByText('Paiement à vérifier', { exact: true }).waitFor(); await page.waitForFunction(() => window.stripeFixture.ends.length === 1);
    const f = await snapshot(); expect(f.ends).toEqual(['idle']); expect(f.paid).toBe(0); expect(f.failed).toHaveLength(1); expect(f.confirms).toHaveLength(fault === 'validation' || fault === 'submit-network' ? 0 : 1); expect(await pay().isEnabled()).toBe(true);
  });
  it('garde processing verrouillé et dirige vers le suivi sans annoncer un paiement terminé', async () => {
    await open(); await page.evaluate(() => { window.stripeFixture.config.result = { paymentIntent: { status: 'processing' } }; }); await wallet().click(); await page.getByText('Confirmation bancaire en cours', { exact: true }).waitFor();
    expect(await pay().isDisabled()).toBe(true); expect((await snapshot()).ends).toEqual(['processing']); expect((await snapshot()).paid).toBe(0);
    await page.evaluate(() => window.stripeFixture.emit('confirm')); expect((await snapshot()).confirms).toHaveLength(1); expect(await page.getByRole('link', { name: 'Suivre la confirmation de votre commande', exact: true }).getAttribute('href')).toBe(origin + '/suivi');
  });
  it.each(['Démonter le paiement', 'Changer l’intention', 'Changer le restaurant'])('ignore une réponse tardive après « %s » et détruit les deux Elements', async action => {
    await open(); await page.evaluate(() => { window.stripeFixture.config.holdConfirm = true; window.stripeFixture.config.throwDestroy = true; }); await wallet().click(); await page.waitForFunction(() => window.stripeFixture.confirms.length === 1);
    await page.getByRole('button', { name: action, exact: true }).click(); await page.waitForFunction(() => window.stripeFixture.destroyed.length === 2);
    await page.evaluate(() => window.stripeFixture.releaseConfirm({ paymentIntent: { status: 'succeeded' } }));
    if (action !== 'Démonter le paiement') { await page.waitForFunction(() => window.stripeFixture.groups.length === 2); await page.evaluate(() => { window.stripeFixture.config.holdConfirm = false; window.stripeFixture.emit('confirm', undefined, true); }); await pay().click(); await page.waitForFunction(() => window.stripeFixture.ends.length === 1); }
    const f = await snapshot(); expect(f.destroyed).toEqual(['0:payment', '0:expressCheckout']); expect(f.paid).toBe(action === 'Démonter le paiement' ? 0 : 1); expect(f.ends).toEqual(action === 'Démonter le paiement' ? [] : ['paid']);
    if (action === 'Changer l’intention') expect(f.confirms[1].secret).toBe('pi_fixture_secret_two');
    if (action === 'Changer le restaurant') expect(f.factories[1].account).toBe('acct_fixture_two');
  });
  it('ne confirme pas si l’intention change pendant elements.submit', async () => {
    await open(); await page.evaluate(() => { window.stripeFixture.config.holdSubmit = true; }); await wallet().click(); await page.waitForFunction(() => window.stripeFixture.submits === 1);
    await page.getByRole('button', { name: 'Changer l’intention', exact: true }).click(); await page.waitForFunction(() => window.stripeFixture.groups.length === 2);
    await page.evaluate(() => window.stripeFixture.releaseSubmit()); await page.getByRole('textbox', { name: 'Carte de recette', exact: true }).waitFor(); expect((await snapshot()).confirms).toEqual([]); expect((await snapshot()).ends).toEqual([]);
  });
});
