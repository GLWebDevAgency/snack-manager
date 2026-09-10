import { createServer, type Server } from 'node:http';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { beforeAll, beforeEach, afterEach, afterAll, describe, expect, it } from 'vitest';

type Fixture = {
  permission: string; existing: boolean; failConfig: boolean; failRevoke: boolean; conflict: boolean;
  hold: string; waiters: Record<string, (() => void)[]>; calls: { url: string; method: string; body: Record<string, unknown> | null }[];
  subscriptions: number; permissions: number; registrations: { script: string; scope: string }[]; promptCalls: number;
  release: (stage: string) => void; installEvent: () => void; serverState: string;
};
declare global { interface Window { orderPushFixture: Fixture } }
let server: Server, browser: Browser, context: BrowserContext, page: Page, origin: string, faults: string[];
beforeAll(async () => {
  const directory = fileURLToPath(new URL('.', import.meta.url));
  const bundle = await build({ stdin: { contents: `import React,{useState}from'react';import{createRoot}from'react-dom/client';import{OrderReadyNotification}from'./OrderReadyNotification';import{OrderInstall}from'./OrderInstall';
    const f=window.orderPushFixture={permission:'granted',existing:true,failConfig:location.search.includes('config-error'),failRevoke:false,conflict:false,hold:new URLSearchParams(location.search).get('hold')??'',waiters:{},calls:[],subscriptions:0,permissions:0,registrations:[],promptCalls:0,serverState:location.search.includes('sent')?'sent':'off'};
    const pause=stage=>f.hold===stage?new Promise(resolve=>(f.waiters[stage]??=[]).push(resolve)):Promise.resolve();
    f.release=stage=>{f.hold='';(f.waiters[stage]??[]).splice(0).forEach(resolve=>resolve())};
    const sub={endpoint:'https://fcm.googleapis.com/fcm/send/opaque-fixture',expirationTime:null,keys:{p256dh:'B'+'a'.repeat(86),auth:'a'.repeat(22)}};
    const subscription={...sub,toJSON:()=>sub};
    Object.defineProperty(window,'Notification',{configurable:true,value:{requestPermission:async()=>{f.permissions++;await pause('permission');return f.permission}}});
    Object.defineProperty(window,'PushManager',{configurable:true,value:function(){}});
    Object.defineProperty(navigator,'serviceWorker',{configurable:true,value:{get ready(){throw Error('ready global interdit')},register:async(script,options)=>{
      f.registrations.push({script,scope:options.scope});await pause('register');return{active:{},pushManager:{getSubscription:async()=>{await pause('getSubscription');return f.existing?subscription:null},subscribe:async()=>{f.subscriptions++;f.existing=true;await pause('subscribe');return subscription}}}}}});
    window.fetch=async(url,options={})=>{const action=String(url);const body=options.body?JSON.parse(options.body):null;f.calls.push({url:action,method:options.method??'GET',body});
      if(action.endsWith('/config'))return Response.json({available:true,publicKey:'B'+'a'.repeat(86)},{status:f.failConfig?503:200});
      if(action.endsWith('/status'))return Response.json({state:f.serverState,expiresAt:null,revision:2});
      if(options.method==='DELETE'){await pause('revoke');if(f.failRevoke)return new Response(null,{status:503});f.serverState='off';return Response.json({state:'off',expiresAt:null,revision:3})}
      await pause('ack');if(f.conflict)return Response.json({code:'ORDER_NOTIFICATION_CHANGED',current:{state:'off',expiresAt:null,revision:9}},{status:409});
      f.serverState='active';return Response.json({state:'active',expiresAt:null,revision:3});};
    f.installEvent=()=>{const event=new Event('beforeinstallprompt',{cancelable:true});event.prompt=async()=>{f.promptCalls++};event.userChoice=Promise.resolve({outcome:'accepted'});window.dispatchEvent(event)};
    function App(){const[slug,setSlug]=useState('restaurant'),[token,setToken]=useState('tracking-one'),[disabled,setDisabled]=useState(false),[eligible,setEligible]=useState(false),[visible,setVisible]=useState(true);return<main><button onClick={()=>setSlug('other')}>Changer tenant</button><button onClick={()=>setToken('tracking-two')}>Changer preuve</button><button onClick={()=>setDisabled(true)}>Désactiver portée</button><button onClick={()=>setVisible(false)}>Démonter</button><button onClick={()=>setEligible(true)}>Commande créée</button>{visible&&<OrderReadyNotification slug={slug} orderId='order-fixture' trackingToken={token} disabled={disabled}/>}<OrderInstall slug={slug} name='Restaurant' eligible={eligible}/></main>};createRoot(document.getElementById('root')).render(<App/>);`, resolveDir: directory, sourcefile: 'order-push-fixture.tsx', loader: 'tsx' }, bundle: true, write: false, outdir: '/virtual-order-push', format: 'esm', platform: 'browser', target: 'es2022', jsx: 'automatic', define: { 'process.env': '{}', 'process.env.NODE_ENV': '"production"' } });
  const script = bundle.outputFiles.find(file => file.path.endsWith('.js'))!.text, css = bundle.outputFiles.find(file => file.path.endsWith('.css'))?.text ?? '';
  server = createServer((req, res) => {
    const path = new URL(req.url ?? '/', origin).pathname;
    if (path === '/bundle.js' || path === '/style.css') { res.setHeader('Content-Type', path.endsWith('.js') ? 'text/javascript' : 'text/css'); res.end(path.endsWith('.js') ? script : css); return; }
    if (path === '/favicon.ico') { res.writeHead(204).end(); return; }
    res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><html lang="fr"><head><meta charset="utf-8"><link rel="stylesheet" href="/style.css"></head><body><div id="root"></div><script type="module" src="/bundle.js"></script></body></html>');
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve)); const address = server.address(); if (!address || typeof address === 'string') throw Error('Missing port'); origin = `http://127.0.0.1:${address.port}`;
  browser = await chromium.launch({ headless: true });
}, 30_000);
beforeEach(async () => { faults = []; context = await browser.newContext({ serviceWorkers: 'block' }); await context.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort()); page = await context.newPage(); page.setDefaultTimeout(5_000); page.on('pageerror', error => faults.push(error.message)); });
afterEach(async () => { await context?.close(); expect(faults).toEqual([]); });
afterAll(async () => { await browser?.close(); if (server) await new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()); }); });
const activate = () => page.getByRole('button', { name: 'Activer la notification', exact: true });
const open = async (path = '/r/restaurant/carte') => { await page.goto(origin + path); await page.waitForFunction(() => window.orderPushFixture?.calls.some(call => call.url.endsWith('/status'))); await activate().waitFor(); };
const writes = () => page.evaluate(() => window.orderPushFixture.calls.filter(call => call.method === 'DELETE' || (call.method === 'POST' && !call.url.endsWith('/status'))));

describe('consentement transactionnel — composants réels, navigateur et transport simulés', () => {
  it('refus de permission : aucune inscription navigateur ni POST d’activation', async () => {
    await open(); await page.evaluate(() => { window.orderPushFixture.permission = 'denied'; }); await activate().click(); await page.getByRole('alert').waitFor();
    expect(await writes()).toEqual([]); expect(await page.evaluate(() => window.orderPushFixture.subscriptions)).toBe(0);
  });
  it.each(['Changer tenant', 'Changer preuve', 'Désactiver portée', 'Démonter'])('ne continue pas la demande après %s pendant la permission', async button => {
    await open(); await page.evaluate(() => { window.orderPushFixture.hold = 'permission'; }); await activate().click();
    await page.waitForFunction(() => !!window.orderPushFixture.waiters.permission?.length); await page.getByRole('button', { name: button, exact: true }).click();
    await page.evaluate(() => window.orderPushFixture.release('permission')); await page.waitForTimeout(30);
    expect(await writes()).toEqual([]); expect(await page.evaluate(() => window.orderPushFixture.subscriptions)).toBe(0);
  });
  it('ne crée pas d’abonnement après démontage pendant getSubscription', async () => {
    await open(); await page.evaluate(() => { window.orderPushFixture.existing = false; window.orderPushFixture.hold = 'getSubscription'; }); await activate().click();
    await page.waitForFunction(() => !!window.orderPushFixture.waiters.getSubscription?.length); await page.getByRole('button', { name: 'Démonter', exact: true }).click();
    await page.evaluate(() => window.orderPushFixture.release('getSubscription')); await page.waitForTimeout(30);
    expect(await writes()).toEqual([]); expect(await page.evaluate(() => window.orderPushFixture.subscriptions)).toBe(0);
  });
  it.each(['register', 'getSubscription'])('aucun status ou abonnement après perte de portée pendant %s initial', async stage => {
    await page.goto(origin + '/r/restaurant/carte?hold=' + stage);
    await page.waitForFunction(stage => !!window.orderPushFixture.waiters[stage]?.length, stage);
    await page.getByRole('button', { name: 'Désactiver portée', exact: true }).click();
    await page.evaluate(stage => window.orderPushFixture.release(stage), stage); await page.waitForTimeout(30);
    expect(await page.evaluate(() => window.orderPushFixture.calls.filter(call => call.method !== 'GET'))).toEqual([]);
    expect(await page.evaluate(() => window.orderPushFixture.subscriptions)).toBe(0);
  });
  it('une configuration indisponible peut être vérifiée de nouveau sans faux état activé', async () => {
    await page.goto(origin + '/r/restaurant/carte?config-error'); await page.getByRole('alert').waitFor();
    await page.evaluate(() => { window.orderPushFixture.failConfig = false; }); await page.getByRole('button', { name: 'Réessayer', exact: true }).click();
    await activate().waitFor(); expect(await writes()).toEqual([]);
  });
  it('une notification déjà envoyée ne propose pas de réactivation sans effet', async () => {
    await page.goto(origin + '/r/restaurant/carte?sent'); await page.getByText('Notification envoyée.', { exact: true }).waitFor();
    expect(await activate().count()).toBe(0); expect(await writes()).toEqual([]);
  });
  it('affiche activé uniquement après ACK et utilise la révision observée, sans preuve dans URL', async () => {
    await open('/t/order-fixture?t=secret-page'); await page.evaluate(() => { window.orderPushFixture.hold = 'ack'; }); await activate().click();
    await page.waitForFunction(() => !!window.orderPushFixture.waiters.ack?.length); expect(await page.getByText('Notification activée sur cet appareil.', { exact: true }).count()).toBe(0);
    const calls = await writes(); expect(calls).toHaveLength(1); expect(calls[0].body).toMatchObject({ trackingToken: 'tracking-one', expectedRevision: 2 }); expect(calls[0].url).not.toMatch(/tracking-one|secret-page/);
    await page.evaluate(() => window.orderPushFixture.release('ack')); await page.getByText('Notification activée sur cet appareil.', { exact: true }).waitFor();
    expect(await page.evaluate(() => window.orderPushFixture.registrations)).toEqual([{ script: '/r/restaurant/sw.js', scope: '/r/restaurant/' }]);
  });
  it('révocation non acquittée : conserve activé et exprime l’incertitude', async () => {
    await open(); await activate().click(); const revoke = page.getByRole('button', { name: 'Désactiver l’alerte', exact: true }); await revoke.waitFor();
    await page.evaluate(() => { window.orderPushFixture.failRevoke = true; }); await revoke.click(); await page.getByText(/Désactivation non confirmée/).waitFor();
    expect(await page.getByText('Notification activée sur cet appareil.', { exact: true }).count()).toBe(1); expect(await revoke.isEnabled()).toBe(true);
  });
  it('un conflit impose un nouveau consentement explicite avec sa nouvelle révision', async () => {
    await open(); await page.evaluate(() => { window.orderPushFixture.conflict = true; }); await activate().click(); await page.getByRole('alert').waitFor();
    expect(await writes()).toHaveLength(1); await page.evaluate(() => { window.orderPushFixture.conflict = false; }); await page.getByRole('button', { name: 'Réessayer', exact: true }).click();
    await page.getByText('Notification activée sur cet appareil.', { exact: true }).waitFor(); expect((await writes())[1].body).toMatchObject({ expectedRevision: 9 });
  });
  it('retient l’invite native émise avant la première commande', async () => {
    await open(); await page.evaluate(() => window.orderPushFixture.installEvent()); expect(await page.getByRole('button', { name: 'Installer', exact: true }).count()).toBe(0);
    await page.getByRole('button', { name: 'Commande créée', exact: true }).click(); await page.getByRole('button', { name: 'Installer', exact: true }).click();
    expect(await page.evaluate(() => window.orderPushFixture.promptCalls)).toBe(1);
  });
  it('depuis le suivi secret, propose seulement une entrée publique d’installation', async () => {
    await open('/t/order-fixture?t=secret-page'); await page.evaluate(() => window.orderPushFixture.installEvent()); await page.getByRole('button', { name: 'Commande créée', exact: true }).click();
    const link = page.getByRole('link', { name: 'Ouvrir la carte pour installer', exact: true }); expect(await link.getAttribute('href')).toBe('/r/restaurant/carte?installer=1');
    expect(await page.getByRole('button', { name: 'Installer', exact: true }).count()).toBe(0); expect(await page.evaluate(() => window.orderPushFixture.promptCalls)).toBe(0);
  });
});
