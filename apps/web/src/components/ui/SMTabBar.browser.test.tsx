import { createServer, type Server } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import postcss from 'postcss';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { minimizeFromScroll, tabIndexAt } from './SMTabBar.model';

declare global { interface Window { tabFixture: {
  selections: string[]; ticks: number; active: string;
  configure: (options: { hidden?: boolean; disabled?: boolean; refScroll?: boolean; minimizable?: boolean; count?: number; theme?: 'dark' | 'light'; reduceMotion?: boolean; reduceTransparency?: boolean }) => void;
  unmount: () => void;
} } }
let server: Server, browser: Browser, context: BrowserContext, page: Page, origin: string;
let faults: string[];

beforeAll(async () => {
  const directory = fileURLToPath(new URL('.', import.meta.url));
  const globals = postcss.parse(await readFile(fileURLToPath(new URL('../../app/globals.css', import.meta.url)), 'utf8'));
  const declarations: string[] = [];
  globals.walkRules(rule => { if (rule.selector === ':root') rule.walkDecls(declaration => { declarations.push(declaration.toString()); }); });
  const bundle = await build({ stdin: { sourcefile: 'tabbar-fixture.tsx', resolveDir: directory, loader: 'tsx', contents: `
    import React,{useEffect,useRef,useState}from'react';import{createRoot}from'react-dom/client';
    import{SMTabBar,SMTabBarSpacer,useSMTabTransition}from'./SMTabBar';
    const root=createRoot(document.getElementById('root'));
    window.tabFixture={selections:[],ticks:0,active:'one',configure:()=>{},unmount:()=>root.unmount()};
    const keys=['one','two','three','four','five'], labels=['Carte','Recherche','Commandes','Fidélité','Compte'];
    function App(){const[active,setActive]=useState('one');const[config,setConfig]=useState({hidden:false,disabled:false,refScroll:false,minimizable:true,count:5,theme:'dark',reduceMotion:false,reduceTransparency:false});
      useEffect(()=>{const pop=()=>setActive(new URLSearchParams(location.search).get('tab')||'one');window.addEventListener('popstate',pop);return()=>window.removeEventListener('popstate',pop)},[]);
      const scroll=useRef(null);window.tabFixture.configure=patch=>setConfig(c=>({...c,...patch}));window.tabFixture.active=active;
      const {selectTab,contentProps}=useSMTabTransition({activeKey:active,reduceMotion:config.reduceMotion,onSelect:key=>{window.tabFixture.selections.push(key);history.pushState(null,'','?tab='+key);setActive(key)},scrollRef:config.refScroll?scroll:undefined});
      const items=keys.slice(0,config.count).map((key,index)=>({key,label:labels[index],badge:index===2?3:null,icon:color=><svg viewBox="0 0 24 24" fill="none" stroke={color}><circle cx="12" cy="12" r="8"/></svg>}));
      return <><button id="outside">Hors navigation</button><div ref={scroll} id="scroller" style={config.refScroll?{height:420,overflow:'auto'}:{}}>
        <section {...contentProps} id="content" style={{height:2200}}><h1>Écran {active}</h1><button id="content-action">Action du contenu</button><SMTabBarSpacer/></section></div>
        <SMTabBar items={items} activeKey={active} onSelect={selectTab} scrollRef={config.refScroll?scroll:undefined} theme={config.theme} reduceMotion={config.reduceMotion} reduceTransparency={config.reduceTransparency} hidden={config.hidden} disabled={config.disabled} minimizable={config.minimizable} onTick={()=>window.tabFixture.ticks++}/></>;
    }root.render(<React.StrictMode><App/></React.StrictMode>);` }, bundle: true, write: false, outfile: 'tabbar.js', format: 'esm', platform: 'browser', target: 'es2022', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"development"' } });
  const js = bundle.outputFiles.find(file => file.path.endsWith('.js'))!.text;
  const css = `:root{${declarations.join(';')}}body{margin:0;background:var(--cf-bg);color:var(--cf-text);font-family:Arial,sans-serif}` + bundle.outputFiles.find(file => file.path.endsWith('.css'))!.text;
  server = createServer((request, response) => {
    if (request.url === '/tabbar.js') { response.setHeader('Content-Type', 'text/javascript'); response.end(js); }
    else if (request.url === '/tabbar.css') { response.setHeader('Content-Type', 'text/css'); response.end(css); }
    else if (request.url === '/favicon.ico') response.writeHead(204).end();
    else { response.setHeader('Content-Type', 'text/html'); response.end('<!doctype html><html lang="fr"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/tabbar.css"><div id="root"></div><script type="module" src="/tabbar.js"></script></html>'); }
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('Fixture port missing');
  origin = `http://127.0.0.1:${address.port}`;
  browser = await chromium.launch({ headless: true });
}, 30000);
beforeEach(async () => {
  faults = [];
  context = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce', serviceWorkers: 'block' });
  await context.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  page = await context.newPage(); page.setDefaultTimeout(3000);
  page.on('pageerror', error => faults.push(error.message));
  page.on('console', message => { if (['warning', 'error'].includes(message.type())) faults.push(message.text()); });
  await page.goto(origin); await page.getByRole('tab', { name: 'Carte', exact: true }).waitFor();
});
afterEach(async () => { await context.close(); expect(faults).toEqual([]); });
afterAll(async () => { await browser?.close(); if (server) await new Promise<void>(resolve => server.close(() => resolve())); });
const bar = () => page.locator('[data-sm-tabbar]');
const pill = () => page.getByRole('tablist');
const selected = () => page.getByRole('tab', { selected: true });
const config = (options: Parameters<Window['tabFixture']['configure']>[0]) => page.evaluate(options => window.tabFixture.configure(options), options);

describe('SMTabBar — navigation partagée sans état métier', () => {
  it('garde le clavier natif, les flèches et les descriptions de badges', async () => {
    await selected().focus(); await page.keyboard.press('ArrowRight');
    await expect.poll(() => selected().getAttribute('aria-label')).toBe('Recherche');
    expect(await selected().evaluate(element => element === document.activeElement)).toBe(true);
    await page.keyboard.press('End'); await expect.poll(() => selected().getAttribute('aria-label')).toBe('Compte');
    await page.keyboard.press('Home'); await expect.poll(() => selected().getAttribute('aria-label')).toBe('Carte');
    await page.getByRole('tab', { name: 'Commandes', exact: true }).focus(); await page.keyboard.press('Space');
    await expect.poll(() => selected().getAttribute('aria-label')).toBe('Commandes');
    expect(await page.getByRole('tab', { name: 'Commandes', exact: true }).evaluate(element => document.getElementById(element.getAttribute('aria-describedby')!)?.textContent)).toBe('3 notifications');
    expect(await page.evaluate(() => window.tabFixture.selections)).toEqual(['two', 'five', 'one', 'three']);
  });

  it('se replie sur document et sur une ref, remonte au retap et respecte le rebond', async () => {
    await page.evaluate(() => window.scrollTo(0, 320)); await expect.poll(() => bar().getAttribute('data-sm-tabbar-minimized')).toBe('true');
    await selected().click(); await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
    await config({ refScroll: true });
    await page.locator('#scroller').evaluate(element => { element.scrollTop = 300; });
    await expect.poll(() => bar().getAttribute('data-sm-tabbar-minimized')).toBe('true');
    await page.locator('#scroller').evaluate(element => { element.scrollTop = 280; });
    await expect.poll(() => bar().getAttribute('data-sm-tabbar-minimized')).toBe('false');
    await config({ minimizable: false });
    await page.locator('#scroller').evaluate(element => { element.scrollTop = 500; });
    expect(await bar().getAttribute('data-sm-tabbar-minimized')).toBe('false');
    expect(minimizeFromScroll(1100, 1000, 1000, 0)).toEqual({ position: 1000, target: 0 });
    expect(minimizeFromScroll(-40, 0, 1000, 1)).toEqual({ position: 0, target: 0 });
  });

  it.each([false, true])('remonte la nouvelle vue sans mouvement, y compris retour navigateur (ref=%s)', async refScroll => {
    await config({ refScroll });
    await page.emulateMedia({ reducedMotion: refScroll ? 'reduce' : 'no-preference' });
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const setScroll = () => page.evaluate(useRef => {
      if (useRef) document.getElementById('scroller')!.scrollTop = 640;
      else window.scrollTo({ top: 640, behavior: 'instant' });
    }, refScroll);
    const scrollPosition = () => page.evaluate(useRef => useRef ? document.getElementById('scroller')!.scrollTop : window.scrollY, refScroll);
    await setScroll(); expect(await scrollPosition()).toBe(640);
    await page.evaluate(useRef => {
      const target = useRef ? document.getElementById('scroller')! : window;
      const original = target.scrollTo.bind(target);
      Object.assign(window.tabFixture, { scrollCalls: [] as ScrollToOptions[] });
      Object.defineProperty(target, 'scrollTo', { configurable: true, value: (options: ScrollToOptions) => {
        (window.tabFixture as typeof window.tabFixture & { scrollCalls: ScrollToOptions[] }).scrollCalls.push(options); original(options);
      } });
    }, refScroll);
    await page.getByRole('tab', { name: 'Recherche', exact: true }).click();
    await expect.poll(() => selected().getAttribute('aria-label')).toBe('Recherche');
    await expect.poll(scrollPosition, { timeout: 500, interval: 16 }).toBe(0);
    expect(await page.evaluate(() => (window.tabFixture as typeof window.tabFixture & { scrollCalls: ScrollToOptions[] }).scrollCalls)).toEqual([{ top: 0, behavior: 'instant' }]);
    await setScroll(); await page.goBack();
    await expect.poll(() => selected().getAttribute('aria-label')).toBe('Carte');
    await expect.poll(scrollPosition, { timeout: 500, interval: 16 }).toBe(0);
    expect(await page.evaluate(() => window.tabFixture.selections)).toEqual(['two']);
    await setScroll(); await page.goForward();
    await expect.poll(() => selected().getAttribute('aria-label')).toBe('Recherche');
    await expect.poll(scrollPosition, { timeout: 500, interval: 16 }).toBe(0);
  });

  it('conserve les dimensions du kit et les cibles44px à320px avec5onglets', async () => {
    await page.setViewportSize({ width: 320, height: 740 });
    await expect.poll(async () => (await pill().boundingBox())!.height).toBe(60);
    await page.evaluate(() => window.scrollTo(0, 400));
    await expect.poll(async () => (await pill().boundingBox())!.height).toBe(54);
    const dimensions = await page.getByRole('tab').evaluateAll(elements => elements.map(element => ({ width: element.getBoundingClientRect().width, height: element.getBoundingClientRect().height })));
    expect(dimensions.every(size => size.width >= 44 && size.height >= 44)).toBe(true);
    await bar().evaluate(element => (element as HTMLElement).style.setProperty('--safe-b', '34px'));
    await expect.poll(async () => { const box = (await pill().boundingBox())!; return Math.round(740 - box.y - box.height); }).toBe(30);
    expect(await pill().evaluate(element => getComputedStyle(element).backgroundColor)).toBe('rgb(28, 28, 28)');
    await config({ theme: 'light', count: 2 });
    expect(await page.getByRole('tab').count()).toBe(2);
    expect(await pill().evaluate(element => getComputedStyle(element).backgroundColor)).toBe('rgba(255, 255, 255, 0.96)');
  });

  it('suit le doigt sans navigation intermédiaire puis sélectionne une fois au relâchement', async () => {
    const bounds = (await pill().boundingBox())!;
    const step = (bounds.width - 10) / 5, y = bounds.y + bounds.height / 2;
    await page.mouse.move(bounds.x + 5 + step / 2, y); await page.mouse.down();
    await page.mouse.move(bounds.x + 5 + step * 2, y, { steps: 8 });
    await expect.poll(() => bar().getAttribute('data-sm-tabbar-dragging')).toBe('true');
    expect(await page.evaluate(() => window.tabFixture.selections)).toEqual([]);
    expect(await bar().evaluate(element => Number((element as HTMLElement).style.getPropertyValue('--sm-slide')))).toBeCloseTo(1.5, 1);
    expect(await page.getByRole('tab', { name: 'Recherche', exact: true }).evaluate(element => Number((element as HTMLElement).style.getPropertyValue('--sm-intensity')))).toBeCloseTo(0.5, 1);
    await page.mouse.move(bounds.x + 5 + step * 3.5, y, { steps: 4 }); await page.mouse.up();
    await expect.poll(() => selected().getAttribute('aria-label')).toBe('Fidélité');
    expect(await page.evaluate(() => window.tabFixture.selections)).toEqual(['four']);
    expect(await page.evaluate(() => window.tabFixture.ticks)).toBeGreaterThan(0);
    expect(tabIndexAt(-100, 0, 300, 5)).toBe(0);
    expect(tabIndexAt(900, 0, 300, 5)).toBe(4);
  });

  it('annule un déplacement vertical sans sélectionner ni retenir le pointeur', async () => {
    const bounds = (await pill().boundingBox())!, x = bounds.x + bounds.width / 2, y = bounds.y + 15;
    await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x + 7, y + 20); await page.mouse.up();
    expect(await page.evaluate(() => window.tabFixture.selections)).toEqual([]);
    expect(await bar().getAttribute('data-sm-tabbar-dragging')).toBe('false');
  });

  it('retire les onglets du clavier lorsque hidden et les restitue au retour', async () => {
    await selected().focus(); await config({ hidden: true });
    await expect.poll(() => bar().getAttribute('inert')).toBe('');
    expect(await page.getByRole('tab').count()).toBe(0);
    await page.locator('#outside').focus(); await page.keyboard.press('Tab');
    expect(await page.locator('#content-action').evaluate(element => element === document.activeElement)).toBe(true);
    await config({ hidden: false }); await selected().waitFor();
  });

  it('reste visible mais bloque clic, retap, clavier et scrub pendant une mutation', async () => {
    await page.evaluate(() => window.scrollTo(0, 320));
    await config({ disabled: true });
    expect(await pill().getAttribute('aria-disabled')).toBe('true');
    expect(await page.getByRole('tab').count()).toBe(5);
    await selected().focus();
    for (const key of ['ArrowRight', 'End', 'Home', 'Enter', 'Space']) await page.keyboard.press(key);
    await selected().evaluate(element => (element as HTMLButtonElement).click());
    await page.getByRole('tab', { name: 'Compte', exact: true }).evaluate(element => (element as HTMLButtonElement).click());
    const bounds = (await pill().boundingBox())!, y = bounds.y + bounds.height / 2;
    await page.mouse.move(bounds.x + 25, y); await page.mouse.down();
    await page.mouse.move(bounds.x + bounds.width - 25, y, { steps: 8 }); await page.mouse.up();
    expect(await page.evaluate(() => window.tabFixture.selections)).toEqual([]);
    expect(await page.evaluate(() => window.tabFixture.ticks)).toBe(0);
    expect(await page.evaluate(() => window.scrollY)).toBe(320);
    expect(await bar().getAttribute('data-sm-tabbar-dragging')).toBe('false');
    await config({ disabled: false });
    await page.getByRole('tab', { name: 'Compte', exact: true }).click();
    await expect.poll(() => selected().getAttribute('aria-label')).toBe('Compte');
  });

  it('un retour navigateur remplace une sélection encore en transition', async () => {
    await page.getByRole('tab', { name: 'Recherche', exact: true }).click();
    await expect.poll(() => selected().getAttribute('aria-label')).toBe('Recherche');
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await page.clock.install(); await page.clock.pauseAt(new Date(Date.now() + 500));
    await page.getByRole('tab', { name: 'Compte', exact: true }).evaluate(element => (element as HTMLButtonElement).click());
    expect(await page.locator('#content').getAttribute('data-sm-tab-leaving')).toBe('true');
    await page.goBack(); await expect.poll(() => selected().getAttribute('aria-label')).toBe('Carte');
    await page.clock.runFor(200);
    expect(await selected().getAttribute('aria-label')).toBe('Carte');
    expect(await page.locator('#content').getAttribute('data-sm-tab-leaving')).toBe('false');
    expect(await page.evaluate(() => window.tabFixture.selections)).toEqual(['two']);
  });

  it('termine uniquement la dernière transition et annule le travail au démontage', async () => {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await page.clock.install();
    await page.clock.pauseAt(new Date(Date.now() + 500));
    await page.evaluate(() => {
      document.querySelector<HTMLButtonElement>('[role="tab"][aria-label="Recherche"]')!.click();
      document.querySelector<HTMLButtonElement>('[role="tab"][aria-label="Compte"]')!.click();
    });
    expect(await page.locator('#content').getAttribute('data-sm-tab-leaving')).toBe('true');
    expect(await page.evaluate(() => window.tabFixture.selections)).toEqual([]);
    await page.clock.runFor(100);
    await expect.poll(() => selected().getAttribute('aria-label')).toBe('Compte');
    expect(await page.evaluate(() => window.tabFixture.selections)).toEqual(['five']);
    await page.evaluate(() => {
      document.querySelector<HTMLButtonElement>('[role="tab"][aria-label="Carte"]')!.click();
      window.tabFixture.unmount();
    });
    await page.clock.runFor(150);
    expect(await page.evaluate(() => window.tabFixture.selections)).toEqual(['five']);
  });
});

it('applique la réduction locale à la navigation JS et aux fonds sans affaiblir le réglage système', async () => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await config({ reduceMotion: true, reduceTransparency: true });
  await expect.poll(() => bar().getAttribute('data-sm-reduce-motion')).toBe('true');
  await expect.poll(() => bar().getAttribute('data-sm-reduce-transparency')).toBe('true');
  expect(await bar().evaluate(element => getComputedStyle(element).transitionDuration)).toBe('0s');
  expect(await pill().evaluate(element => getComputedStyle(element).backgroundColor)).toBe(await page.locator('body').evaluate(element => { const probe = document.createElement('i'); probe.style.color = 'var(--cf-surface)'; element.append(probe); const color = getComputedStyle(probe).color; probe.remove(); return color; }));
  await page.clock.install();
  await page.getByRole('tab', { name: 'Recherche', exact: true }).click();
  // No clock advance: an animated transition would still wait for its timer.
  await expect.poll(() => selected().getAttribute('aria-label')).toBe('Recherche');
  expect(await page.locator('#content').getAttribute('data-sm-tab-leaving')).toBe('false');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await config({ reduceMotion: false });
  expect(await bar().getAttribute('data-sm-reduce-motion')).toBe('true');
  await page.emulateMedia({ forcedColors: 'active' });
  const canvas = await page.locator('body').evaluate(element => { const probe = document.createElement('i'); probe.style.backgroundColor = 'Canvas'; element.append(probe); const color = getComputedStyle(probe).backgroundColor; probe.remove(); return color; });
  expect(await pill().evaluate(element => getComputedStyle(element).backgroundColor)).toBe(canvas);
});
