import { createServer, type Server } from 'node:http';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import postcss from 'postcss';
import tailwind from '@tailwindcss/postcss';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { LoyaltyRewardCreateSchema } from '@sm/contracts';

// Real drawer and HTTP adapter; menu/auth/persistence are bounded fixtures.
const productId = '507f1f77bcf86cd799439011';
let server: Server, browser: Browser, context: BrowserContext, page: Page, origin: string;
let posts: unknown[], menuUnavailable: boolean, errors: string[];
beforeAll(async () => {
  const web = createRequire(new URL('../../../../../package.json', import.meta.url));
  const cssPath = fileURLToPath(new URL('../../../globals.css', import.meta.url));
  const [bundle, css] = await Promise.all([
    build({ stdin: { loader: 'tsx', sourcefile: 'reward-drawer-fixture.tsx', resolveDir: fileURLToPath(new URL('.', import.meta.url)), contents: `
      import React from 'react'; import {createRoot} from 'react-dom/client'; import {RewardDrawer} from './RewardDrawer';
      const old = new URL(location.href).searchParams.has('legacy');
      const reward = old ? {id:'11111111-1111-4111-8111-111111111111', programId:'22222222-2222-4222-8222-222222222222', name:'Boisson offerte',description:'',costUnits:50,kind:'product',valueCents:null,productRef:'Ancien nom de boisson',active:true,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()} : null;
      createRoot(document.getElementById('root')).render(<React.StrictMode><RewardDrawer reward={reward} unitPlural="points" onClose={()=>{}} onSaved={()=>{document.getElementById('saved').textContent='Enregistré';}}/></React.StrictMode>);` },
      bundle: true, write: false, format: 'esm', platform: 'browser', target: 'es2022', jsx: 'automatic', outdir: '/virtual-reward-drawer',
      alias: { '@': fileURLToPath(new URL('../../../../', import.meta.url)), react: fileURLToPath(new URL('.', `file://${web.resolve('react/package.json')}`)), 'react-dom': fileURLToPath(new URL('.', `file://${web.resolve('react-dom/package.json')}`)) },
      define: { 'process.env': '{}', 'process.env.NODE_ENV': '"production"', 'process.env.NEXT_PUBLIC_API_URL': '"/api"' } }),
    readFile(cssPath, 'utf8').then(value => postcss([tailwind({ base: fileURLToPath(new URL('../../../../..', import.meta.url)) })]).process(value, { from: cssPath })),
  ]);
  server = createServer(async (request, response) => {
    const path = new URL(request.url!, 'http://127.0.0.1').pathname;
    const json = (value: unknown, status = 200) => response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }).end(JSON.stringify(value));
    if (path === '/app.js') { response.writeHead(200, { 'Content-Type': 'text/javascript' }).end(bundle.outputFiles.find(file => file.path.endsWith('.js'))!.text); return; }
    if (path === '/style.css') { response.writeHead(200, { 'Content-Type': 'text/css' }).end(css.css); return; }
    if (path === '/favicon.ico') { response.writeHead(204).end(); return; }
    if (path === '/api/menu') { json(menuUnavailable ? { message: 'Carte indisponible' } : { categories: [{ _id: 'category', name: 'Sandwichs', products: [{ _id: productId, name: 'Sandwich maison', active: true }] }], uncategorized: [] }, menuUnavailable ? 503 : 200); return; }
    if (path.startsWith('/api/loyalty/rewards') && ['POST','PATCH'].includes(request.method!)) {
      const chunks: Buffer[] = []; for await (const part of request) chunks.push(Buffer.from(part));
      const input = LoyaltyRewardCreateSchema.parse(JSON.parse(Buffer.concat(chunks).toString())); posts.push(input); json({ ...input, id: '11111111-1111-4111-8111-111111111111' }); return;
    }
    if (path.startsWith('/api/')) { errors.push(`Unexpected request ${path}`); json({}, 404); return; }
    response.writeHead(200, { 'Content-Type': 'text/html' }).end('<!doctype html><html lang="fr"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"><div id="saved" role="status"></div><div id="root"></div><script type="module" src="/app.js"></script></html>');
  });
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done)); const address = server.address();
  if (!address || typeof address === 'string') throw Error('No test port'); origin = `http://127.0.0.1:${address.port}`;
  browser = await chromium.launch({ headless: true });
}, 30_000);
beforeEach(async () => {
  posts = []; menuUnavailable = false; errors = [];
  context = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
  await context.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  page = await context.newPage(); page.setDefaultTimeout(5_000); page.on('pageerror', error => errors.push(error.message));
});
afterEach(async () => { await context.close(); expect(errors).toEqual([]); });
afterAll(async () => { await browser?.close(); await new Promise<void>(done => server?.close(() => done())); });
describe('reward menu binding — actual back-office drawer', () => {
  it('saves the stable product ID, displays its name and the paid-extra rule on mobile', async () => {
    await page.goto(origin + '/admin/fidelite/recompenses');
    await page.getByLabel('Nom', { exact: true }).fill('Sandwich offert');
    await page.getByLabel('Coût en points').fill('50');
    await page.getByLabel('Nature').selectOption('product');
    await expect.poll(() => page.getByLabel('Produit offert', { exact: true }).isEnabled()).toBe(true);
    await page.getByLabel('Produit offert', { exact: true }).selectOption(productId);
    await page.getByRole('button', { name: 'Créer la récompense' }).click();
    await expect.poll(() => posts.length).toBe(1);
    expect(posts[0]).toMatchObject({ kind: 'product', productRef: productId, costUnits: 50, name: 'Sandwich offert' });
    expect(await page.getByText(/Une unité offerte, hors suppléments/).isVisible()).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
  it('retains the historical free-text reference until an explicit replacement', async () => {
    await page.goto(origin + '/admin/fidelite/recompenses?legacy=1');
    await page.getByText(/Rattachez cette récompense/).waitFor();
    await page.getByRole('button', { name: 'Enregistrer', exact: true }).click();
    await expect.poll(() => posts.length).toBe(1);
    expect(posts[0]).toMatchObject({ productRef: 'Ancien nom de boisson' });
    await page.getByLabel('Produit offert', { exact: true }).selectOption(productId);
    await page.getByRole('button', { name: 'Enregistrer', exact: true }).click();
    await expect.poll(() => posts.length).toBe(2); expect(posts[1]).toMatchObject({ productRef: productId });
  });
  it('offers a real menu retry and never saves a new product reward without a selected product', async () => {
    menuUnavailable = true; await page.goto(origin + '/admin/fidelite/recompenses');
    await page.getByLabel('Nom', { exact: true }).fill('Mon sandwich'); await page.getByLabel('Coût en points').fill('50');
    await page.getByLabel('Nature').selectOption('product'); await page.getByRole('button', { name: 'Réessayer' }).waitFor();
    await page.getByRole('button', { name: 'Créer la récompense' }).click();
    await page.getByText('Indiquez le produit offert.', { exact: true }).waitFor(); expect(posts).toEqual([]);
    menuUnavailable = false; await page.getByRole('button', { name: 'Réessayer' }).click();
    await expect.poll(() => page.getByLabel('Produit offert', { exact: true }).isEnabled()).toBe(true);
  });
});
