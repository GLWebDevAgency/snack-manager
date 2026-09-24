import { createServer, type Server, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import postcss from 'postcss';
import tailwind from '@tailwindcss/postcss';
import { chromium, type Browser, type BrowserContext, type Page, type Locator } from 'playwright';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { demoSite } from './demo/fixture';
import type { PublicOrderingAvailability } from '@sm/contracts';

declare global { interface Window { availabilityFixture: { mounts: number; unmounts: number; appearances: number; reset(): void } } }
let server: Server, browser: Browser, context: BrowserContext, page: Page, origin: string;
let faults: string[], reads: ServerResponse[], writes: string[];
let answer: PublicOrderingAvailability | null;
const now = '2030-09-09T10:00:00.000Z';
const raw = demoSite(new Date(now), () => 0);
const snapshot: PublicOrderingAvailability = { observedAt: now, openNow: true, ordering: { paused: false, message: null }, todayHours: raw.todayHours!, timezone: raw.timezone!, slots: raw.slots! };
const iso = snapshot.slots.slots[0]!.iso;
const order = { _id: 'b'.repeat(24), number: 4242, status: 'new', type: 'pickup', payment: { method: 'online', status: 'pending' },
 totals: { subtotal: 150, deliveryFee: 0, discount: null, total: 150 }, pickup: { slot: iso, customerName: 'Recette' }, trackingToken: 'fixture-tracking' };
function json(res: ServerResponse, body: unknown, status = 200) { res.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify(body)); }
function closed(): PublicOrderingAvailability { return { ...snapshot, openNow: false, observedAt: '2030-09-09T22:12:00.000Z', slots: { ...snapshot.slots, slots: [], closedToday: true } }; }
// Real Storefront, cart, Checkout, recovery and IndexedDB. Only provider widgets
// and HTTP responses are local fixtures; every external request is refused.
beforeAll(async () => {
 const directory = fileURLToPath(new URL('.', import.meta.url));
 const bundle = await build({ stdin: { loader: 'tsx', resolveDir: directory, contents: `
 import React from 'react';import{createRoot}from'react-dom/client';import{Storefront}from'./Storefront';import{orderingApi}from'./api';import{demoSite}from'./demo/fixture';
 window.availabilityFixture={mounts:0,unmounts:0,appearances:0};
 const raw=demoSite(new Date('${now}'),()=>0);raw.tenant.slug='recette';raw.tenant.phones=[];raw.tenant.logoUrl=null;raw.medias=[];
 raw.menu={categories:[{_id:'${'c'.repeat(24)}',name:'Boissons',products:[{_id:'${'a'.repeat(24)}',name:'Canette recette',price:150,available:true,stockout:false,variants:[],optionGroups:[],ingredients:[],supplements:[],photoUrl:null}]}]};
 const normalizer=orderingApi({send:async()=>({status:200,body:raw})});
 normalizer.loadSite('recette').then(site=>createRoot(document.getElementById('root')).render(<Storefront site={site} demo={location.search.includes('demo')}/>));` },
 bundle: true, write: false, outdir: '/virtual-availability', format: 'esm', platform: 'browser', target: 'es2022', jsx: 'automatic',
 alias: { react: fileURLToPath(new URL('../../../node_modules/react', import.meta.url)), 'react-dom': fileURLToPath(new URL('../../../node_modules/react-dom', import.meta.url)) },
 define: { 'process.env': '{}', 'process.env.NODE_ENV': '"production"', 'process.env.NEXT_PUBLIC_API_URL': '"/api"' },
 plugins: [{ name: 'local-ports', setup(builder) {
 builder.onResolve({ filter: /^next\/navigation$/ }, () => ({ path: 'navigation', namespace: 'availability-fixture' }));
 builder.onLoad({ filter: /^navigation$/, namespace: 'availability-fixture' }, () => ({ contents: `export const usePathname=()=>location.pathname;export const useRouter=()=>({push:()=>{},replace:()=>{}});` }));
 builder.onResolve({ filter: /^next\/font\/google$/ }, () => ({ path: 'fonts', namespace: 'availability-fixture' }));
 builder.onLoad({ filter: /^fonts$/, namespace: 'availability-fixture' }, () => ({ contents: `const font=()=>({variable:'',className:'',style:{fontFamily:'Arial'}});export {${['Alegreya_Sans','Archivo','Archivo_Black','Bricolage_Grotesque','Cormorant_Garamond','Familjen_Grotesk','Figtree','Fraunces','Instrument_Sans','JetBrains_Mono','Lato','Libre_Baskerville','Manrope','Nunito','Nunito_Sans','Outfit','Playfair_Display','Source_Sans_3'].map(name=>`font as ${name}`).join(',')}}` }));
 builder.onResolve({ filter: /\/(StripeCard|TurnstileCheck)$/ }, args => ({ path: args.path.split('/').at(-1)!, namespace: 'availability-provider' }));
 builder.onLoad({ filter: /.*/, namespace: 'availability-provider' }, args => ({ loader: 'tsx', resolveDir: directory, contents: args.path === 'TurnstileCheck'
 ? `import{useEffect}from'react';export function TurnstileCheck({onToken,resetKey}){useEffect(()=>onToken('fixture-proof'),[onToken,resetKey]);return <iframe title="Contrôle de recette" src="/proof-field"/>}`
 : `import{useEffect}from'react';export function apparenceStripeDe(){window.availabilityFixture.appearances++;return{}};export function StripeCard({onPaid,apparence}){useEffect(()=>{window.availabilityFixture.mounts++;return()=>{window.availabilityFixture.unmounts++}},[]);return <div><input aria-label="Carte de recette"/><button onClick={onPaid}>Confirmer paiement de recette</button></div>}` }));
 } }], });
 const cssPath = fileURLToPath(new URL('../../app/globals.css', import.meta.url));
 const css = await postcss([tailwind({ base: fileURLToPath(new URL('../../..', import.meta.url)) })]).process(await readFile(cssPath, 'utf8'), { from: cssPath });
 server = createServer((req,res) => {
 res.setHeader('Cache-Control','no-store'); const url = new URL(req.url!, 'http://local.invalid');
 if(url.pathname==='/app.js'){res.setHeader('Content-Type','text/javascript');res.end(bundle.outputFiles.find(f=>f.path.endsWith('.js'))!.text);return;}
 if(url.pathname==='/style.css'){res.setHeader('Content-Type','text/css');res.end(css.css+(bundle.outputFiles.find(f=>f.path.endsWith('.css'))?.text??''));return;}
 if(url.pathname==='/proof-field'){res.setHeader('Content-Type','text/html');res.end('<!doctype html><html><input aria-label="Preuve de recette"/></html>');return;}
 if(url.pathname==='/favicon.ico'){res.writeHead(204).end();return;}
 if(url.pathname==='/r/recette'){res.setHeader('Content-Type','text/html');res.end('<!doctype html><html lang="fr"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"><div id="root"></div><script type="module" src="/app.js"></script></html>');return;}
 if(url.pathname.endsWith('/availability')){reads.push(res);if(answer)json(res,answer);return;}
 if(url.pathname.endsWith('/slots')){json(res,snapshot.slots);return;}
 if(url.pathname.endsWith('/order-notifications/config')){json(res,{available:false});return;}
 if(url.pathname.endsWith('/capacites')){json(res,{available:false});return;}
 if(url.pathname.endsWith('/session')){json(res,{},401);return;}
 if(url.pathname.endsWith('/orders/quote')){json(res,{fulfillment:'pickup',originalSubtotalCents:150,subtotalCents:150,totalCents:150,discount:null});return;}
 if(url.pathname.endsWith('/orders')){writes.push(url.pathname);json(res,order);return;}
 if(url.pathname.endsWith('/payment-intent')){writes.push(url.pathname);json(res,{unavailable:false,publishableKey:'pk_test_fixture',clientSecret:'fixture-secret',stripeAccount:'acct_fixture',paymentIntentId:'pi_fixture',currency:'eur',amount:150});return;}
 if(url.pathname.startsWith('/api/public/funnel')){res.end('{}');return;}
 faults.push('Unexpected HTTP '+url.pathname);res.writeHead(404).end();
 });
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve)); const address=server.address();if(!address||typeof address==='string')throw Error('No fixture port');
 origin=`http://127.0.0.1:${address.port}`;browser=await chromium.launch({headless:true});
},30_000);
beforeEach(async()=>{faults=[];reads=[];writes=[];answer=structuredClone(snapshot);
 context=await browser.newContext({viewport:{width:390,height:844},reducedMotion:'reduce',serviceWorkers:'block'});
 await context.route('**/*',route=>{if(new URL(route.request().url()).origin===origin)return route.continue();faults.push('External HTTP refused');return route.abort()});
 page=await context.newPage();page.setDefaultTimeout(5000);page.on('pageerror',e=>faults.push(e.message));
 await page.clock.install({time:new Date(now)});
});
afterEach(async()=>{await context?.close();expect(faults).toEqual([])});
afterAll(async()=>{try{if(server){const stopped=new Promise<void>((resolve,reject)=>server.close(e=>e?reject(e):resolve()));server.closeAllConnections();await stopped}}finally{if(browser){const disconnected=new Promise<void>(resolve=>browser.once('disconnected',()=>resolve()));await browser.close();await disconnected}}});
const header=()=>page.locator('.sm-order-status');
async function load(){await page.goto(origin+'/r/recette');await expect.poll(()=>header().textContent()).toContain('Ouvert');}
async function event(name:string){await page.evaluate(name=>window.dispatchEvent(new Event(name)),name)}
async function activate(locator:Locator){await expect.poll(()=>locator.isEnabled()).toBe(true);await locator.focus();await locator.press('Enter')}
async function add(){await activate(page.getByRole('article',{name:'Canette recette',exact:true}).getByRole('button'));}
async function visibility(value:'hidden'|'visible'){await page.evaluate(value=>{Object.defineProperty(document,'visibilityState',{configurable:true,value});document.dispatchEvent(new Event('visibilitychange'))},value)}
describe('Storefront live availability',()=>{
 it('invalidates stale availability on wake, singleflights events, then shows closed, pause and reopen without changing the cart',async()=>{
 await load();await add();expect(await page.getByRole('button',{name:/Voir mon panier/}).textContent()).toContain('1');
 await visibility('hidden');answer=null;const before=reads.length;await visibility('visible');await expect.poll(()=>reads.length).toBe(before+1);await expect.poll(()=>header().textContent()).toBe('Disponibilités à vérifier');
 const count=reads.length;await event('focus');await event('online');expect(reads.length).toBe(count);
 json(reads.at(-1)!,closed());await expect.poll(()=>header().textContent()).toBe('Fermé');expect(await header().textContent()).not.toContain('retrait');
 answer={...snapshot,ordering:{paused:true,message:'Cuisine en pause.'}};await event('focus');await expect.poll(()=>header().textContent()).toBe('Commande en pause');
 answer=snapshot;await event('focus');await expect.poll(()=>header().textContent()).toContain('Ouvert');
 expect(await page.getByRole('button',{name:/Voir mon panier/}).textContent()).toContain('1');expect(writes).toEqual([]);
 });
 it('polls only while visible, removes expired pickup times and never loops on old slots',async()=>{
 await load();answer=closed();const count=reads.length;await page.clock.fastForward(60_001);await expect.poll(()=>header().textContent()).toBe('Fermé');expect(reads.length).toBe(count+1);
 answer={...snapshot,observedAt:'2030-09-10T10:00:00.000Z'};await event('focus');await expect.poll(()=>header().textContent()).toBe('Ouvert');
 const expired=reads.length;await page.clock.fastForward(4_000);expect(reads.length).toBe(expired);
 await visibility('hidden');await page.clock.fastForward(180_000);expect(reads.length).toBe(expired);
 });
 it('refreshes quietly at 45 seconds but expires the old observation at 60 seconds even when the next read stalls',async()=>{
 await load();answer=null;const count=reads.length;await page.clock.fastForward(45_001);await expect.poll(()=>reads.length).toBe(count+1);
 expect(await header().textContent()).toContain('Ouvert');expect(await page.getByRole('article',{name:'Canette recette',exact:true}).getByRole('button').isEnabled()).toBe(true);
 await page.clock.fastForward(15_001);await expect.poll(()=>header().textContent()).toBe('Disponibilités à vérifier');
 expect(await page.getByRole('article',{name:'Canette recette',exact:true}).getByRole('button').isEnabled()).toBe(false);
 await activate(page.getByRole('button',{name:'Vérifier',exact:true}));await expect.poll(()=>reads.length).toBe(count+2);json(reads.at(-1)!,closed());await expect.poll(()=>header().textContent()).toBe('Fermé');
 });
 it('forgets opening claims offline and ignores the response of an aborted read',async()=>{
 await load();answer=null;const before=reads.length;await event('focus');await expect.poll(()=>reads.length).toBe(before+1);const held=reads.at(-1)!;
 await page.evaluate(()=>{Object.defineProperty(navigator,'onLine',{configurable:true,value:false});window.dispatchEvent(new Event('offline'))});
 await expect.poll(()=>header().textContent()).toBe('Disponibilités à vérifier');json(held,snapshot);await page.clock.fastForward(60_001);expect(await header().textContent()).toBe('Disponibilités à vérifier');
 answer=closed();await page.evaluate(()=>{Object.defineProperty(navigator,'onLine',{configurable:true,value:true});window.dispatchEvent(new Event('online'))});await expect.poll(()=>header().textContent()).toBe('Fermé');
 });
 it('keeps an accepted card payment mounted and its typed field when the service pauses and returns from sleep',async()=>{
 await load();await add();await activate(page.getByRole('button',{name:/Voir mon panier/}));
 await activate(page.getByRole('button',{name:/^Choisir le retrait/}));await activate(page.getByRole('button',{name:/^Continuer · retrait/}));
 await page.getByLabel('Prénom et nom',{exact:true}).fill('Recette');await page.getByLabel('Téléphone',{exact:true}).fill('0600000001');
 await page.frameLocator('iframe[title="Contrôle de recette"]').getByLabel('Preuve de recette').fill('preuve');
 answer=null;const before=reads.length;await page.getByRole('button',{name:/^Payer/}).click();
 await page.getByLabel('Carte de recette').fill('Champ conservé');await expect.poll(()=>reads.length).toBe(before+1);
 const held=reads.at(-1)!;expect(await header().textContent()).toContain('Ouvert');
 const initial=await page.evaluate(()=>({...window.availabilityFixture}));
 // Complete the held read with the paused state. A second focus immediately
 // after json() can be coalesced before the browser has consumed that response.
 answer={...snapshot,ordering:{paused:true,message:'Cuisine en pause.'}};json(held,answer);await expect.poll(()=>header().textContent()).toBe('Commande en pause');
 await visibility('hidden');await expect.poll(()=>header().textContent()).toBe('Disponibilités à vérifier');
 await visibility('visible');await expect.poll(()=>header().textContent()).toBe('Commande en pause');
 expect(await page.getByLabel('Carte de recette').inputValue()).toBe('Champ conservé');
 expect(await page.evaluate(()=>({...window.availabilityFixture}))).toEqual(initial);expect(initial.mounts).toBe(1);expect(initial.unmounts).toBe(0);
 expect(await page.getByText('Commande en ligne suspendue',{exact:true}).count()).toBe(0);expect(writes).toHaveLength(2);
 await page.getByRole('button',{name:'Confirmer paiement de recette'}).click();await page.getByRole('heading',{name:'C’est envoyé en cuisine',exact:true}).waitFor();
 });
 it('keeps the explicit demo independent of live availability',async()=>{
 await page.goto(origin+'/r/recette?demo');await expect.poll(()=>header().textContent()).toContain('Ouvert');await page.clock.fastForward(180_000);await event('focus');await event('online');expect(reads).toHaveLength(0);
 });
});
