import { createServer, type Server, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import postcss from 'postcss';
import tailwind from '@tailwindcss/postcss';
import { beforeAll, beforeEach, afterEach, afterAll, describe, expect, it, vi } from 'vitest';
import { DIRECTIONS } from '@sm/contracts';

declare global { interface Window { siteFileRead?: { started: boolean; release?: () => void; returned: boolean } } }

const tenantId = { A: 'a'.repeat(24), B: 'b'.repeat(24) };
const productId = { A: 'c'.repeat(24), B: 'd'.repeat(24) };
const jwt = (tenant: 'A' | 'B', role = 'owner') => `fixture.${Buffer.from(JSON.stringify({ tenantId: tenantId[tenant], role, exp: 4102444800 })).toString('base64url')}.fixture`;
const tokens = { A: jwt('A'), B: jwt('B'), reader: jwt('A', 'cuisine') };
type FixtureTenant = ReturnType<typeof makeTenant>;
const makeTenant = (id: 'A' | 'B') => ({ _id: tenantId[id], slug: `restaurant-${id.toLowerCase()}`, name: `Restaurant ${id}`, brand: structuredClone(DIRECTIONS.nuit), logoUrl: null, brandColor: DIRECTIONS.nuit.palette.accent,
  address: '', phones: [], hours: [], capacites: ['online', 'menu'], account: { status: 'active' }, settings: {} });
type Request = { method: string; path: string; authority: 'A' | 'B'; body?: Record<string, unknown> };
type Held = { response: ServerResponse; body: unknown; path: string; authority: 'A' | 'B' };
let browser: Browser, server: Server, context: BrowserContext, page: Page, origin: string;
let tenants: Record<'A' | 'B', FixtureTenant>, requests: Request[], held: Held[], faults: string[];
let holdMe: 'A' | 'B' | null, holdPatch: string | null;

// Real BO components and API client in Chromium. Only the HTTP service and
// Next's build-time font loader are fixtures; all external traffic is refused.
beforeAll(async () => {
  const directory = fileURLToPath(new URL('.', import.meta.url));
  const webRoot = fileURLToPath(new URL('../../../../', import.meta.url));
  const cssPath = fileURLToPath(new URL('../../globals.css', import.meta.url));
  const [bundle, css] = await Promise.all([
    build({ stdin: { contents: `import React from'react';import{createRoot}from'react-dom/client';import{MarqueDuSite}from'./MarqueDuSite';import{AdminAccess}from'../access';
      createRoot(document.getElementById('root')).render(<AdminAccess pathname='/admin/site' context={{role:'owner',suspendu:false,capacites:['online','menu']}} pending={false} failed={false} demo={false}><a href='/admin/other'>Autre page</a><MarqueDuSite/></AdminAccess>);`, resolveDir: directory, sourcefile: 'site-scope-fixture.tsx', loader: 'tsx' },
      bundle: true, write: false, outdir: '/virtual-site-scope', format: 'esm', platform: 'browser', target: 'es2022', jsx: 'automatic',
      alias: { react: `${webRoot}/node_modules/react`, 'react-dom': `${webRoot}/node_modules/react-dom` },
      plugins: [{ name: 'next-font-transform', setup(builder) {
        builder.onResolve({ filter: /^next\/font\/google$/ }, () => ({ path: 'fonts', namespace: 'site-fonts' }));
        builder.onLoad({ filter: /.*/, namespace: 'site-fonts' }, () => ({ contents: `const font=()=>({variable:'',className:'',style:{fontFamily:'Arial'}});export {${['Alegreya_Sans', 'Archivo', 'Archivo_Black', 'Bricolage_Grotesque', 'Cormorant_Garamond', 'Familjen_Grotesk', 'Figtree', 'Fraunces', 'Instrument_Sans', 'JetBrains_Mono', 'Lato', 'Libre_Baskerville', 'Manrope', 'Nunito', 'Nunito_Sans', 'Outfit', 'Playfair_Display', 'Source_Sans_3'].map(name => `font as ${name}`).join(',')}}` }));
      } }], define: { 'process.env': '{}', 'process.env.NODE_ENV': '"production"', 'process.env.NEXT_PUBLIC_API_URL': '"/api"' } }),
    readFile(cssPath, 'utf8').then(source => postcss([tailwind({ base: webRoot })]).process(source, { from: cssPath })),
  ]);
  const script = bundle.outputFiles.find(file => file.path.endsWith('.js'))!.text;
  const styles = css.css + (bundle.outputFiles.find(file => file.path.endsWith('.css'))?.text ?? '');
  server = createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const url = new URL(req.url ?? '/', origin), path = url.pathname;
    if (path === '/bundle.js' || path === '/style.css') { res.setHeader('Content-Type', path.endsWith('js') ? 'text/javascript' : 'text/css'); res.end(path.endsWith('js') ? script : styles); return; }
    if (path === '/fixture/session') { res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><html><body></body></html>'); return; }
    if (path === '/admin/site' || path === '/admin/other') { res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"></head><body><div id="root"></div><script type="module" src="/bundle.js"></script></body></html>'); return; }
    if (path === '/favicon.ico') { res.writeHead(204).end(); return; }
    res.setHeader('Content-Type', 'application/json');
    const json = (body: unknown, status = 200) => res.writeHead(status).end(JSON.stringify(body));
    const authority = req.headers.authorization === `Bearer ${tokens.B}` ? 'B' : 'A';
    const chunks: Buffer[] = []; for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const body = chunks.length && req.headers['content-type']?.includes('application/json') ? JSON.parse(Buffer.concat(chunks).toString()) as Record<string, unknown> : undefined;
    requests.push({ method: req.method ?? '', path, authority, ...(body ? { body } : {}) });
    const reply = (value: unknown) => {
      if ((req.method === 'GET' && path === '/api/tenants/me' && holdMe === authority) || (req.method === 'PATCH' && holdPatch === path)) { held.push({ response: res, body: structuredClone(value), path, authority }); return; }
      json(value);
    };
    if (req.method === 'GET' && path === '/api/tenants/me') { reply(tenants[authority]); return; }
    if (req.method === 'GET' && path === '/api/medias') { json({ medias: [], quota: { medias: 0, octetsUtilises: 0, octetsMax: 10000000 } }); return; }
    if (req.method === 'POST' && path === '/api/medias') { json({ message: 'Upload de recette refusé après réception' }, 503); return; }
    const products = [{ _id: productId[authority], name: `Produit ${authority}`, price: 900, active: true, photoKind: 'cutout', popularOverride: null, variants: [], optionGroups: [], supplements: [], removables: [], medias: [] }];
    if (req.method === 'GET' && path === '/api/menu') { json({ categories: [{ _id: `category-${authority}`, name: 'Carte', active: true, products }], uncategorized: [], medias: [] }); return; }
    if (req.method === 'GET' && /^\/api\/public\/tenants\/restaurant-[ab]\/site$/.test(path)) {
      const tenant = path.includes('restaurant-b') ? tenants.B : tenants.A;
      json({ tenant, menu: { categories: [] }, medias: [], slots: null, ordering: { paused: false, message: null }, openNow: true, timezone: 'Europe/Paris' }); return;
    }
    if (req.method === 'PATCH' && path === '/api/tenants/me/marque') { tenants[authority] = { ...tenants[authority], brand: body as FixtureTenant['brand'] }; reply(tenants[authority]); return; }
    if (req.method === 'PATCH' && path === '/api/tenants/me/identity') { tenants[authority] = { ...tenants[authority], name: String(body?.name) }; reply(tenants[authority]); return; }
    if (req.method === 'PATCH' && path === `/api/products/${productId[authority]}`) { reply({ ...products[0], ...body }); return; }
    faults.push(`Unexpected fixture request ${req.method} ${path}`); json({}, 404);
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('Missing port'); origin = `http://127.0.0.1:${address.port}`;
  browser = await chromium.launch({ headless: true });
}, 30_000);

beforeEach(async () => {
  tenants = { A: makeTenant('A'), B: makeTenant('B') }; requests = []; held = []; faults = []; holdMe = null; holdPatch = null;
  context = await browser.newContext({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce', serviceWorkers: 'block' });
  await context.route('**/*', route => { const url = route.request().url(); if (url.startsWith(origin) || url.startsWith('about:')) return route.continue(); faults.push(`External request refused: ${new URL(url).origin}`); return route.abort(); });
  await context.routeWebSocket('**/*', ws => ws.close());
  page = await context.newPage(); page.setDefaultTimeout(5_000); page.on('pageerror', error => faults.push(error.message));
});
afterEach(async () => { held.forEach(item => item.response.destroy()); await context?.close(); expect(faults).toEqual([]); });
afterAll(async () => { await browser?.close(); if (server) await new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()); }); });

const name = () => page.getByRole('textbox', { name: 'Nom affiché', exact: true });
const tagline = () => page.getByRole('textbox', { name: 'Accroche (facultative)', exact: true });
const brandSave = () => page.getByRole('button', { name: 'Enregistrer l’apparence', exact: true });
const mutations = () => requests.filter(request => request.method === 'PATCH');
async function open(token = tokens.A) {
  await page.goto(`${origin}/fixture/session`);
  await page.evaluate(value => localStorage.setItem('sm.token.resto', value), token);
  await page.goto(`${origin}/admin/site`);
}
async function showA() { await open(); await vi.waitFor(async () => expect(await name().inputValue()).toBe('Restaurant A')); }
async function changeToken(token: string) {
  await page.evaluate(value => { const oldValue = localStorage.getItem('sm.token.resto'); localStorage.setItem('sm.token.resto', value); window.dispatchEvent(new StorageEvent('storage', { key: 'sm.token.resto', oldValue, newValue: value, storageArea: localStorage })); }, token);
}
async function waitB() { await vi.waitFor(async () => expect(await name().inputValue()).toBe('Restaurant B')); }
function release(path: string, authority: 'A' | 'B', status = 200) {
  const response = held.find(item => item.path === path && item.authority === authority); if (!response) throw new Error(`No held ${path} ${authority}`);
  response.response.writeHead(status).end(JSON.stringify(status === 200 ? response.body : { message: 'Confirmation indisponible' })); held = held.filter(item => item !== response);
}
async function heldRequest(path: string, authority: 'A' | 'B') { await vi.waitFor(() => expect(held.some(item => item.path === path && item.authority === authority)).toBe(true)); }

describe('pilotage BO — autorité du tenant et réponses tardives', () => {
  it.each([false, true])('le dépôt de logo vérifie encore sa session après lecture du fichier (changement=%s)', async swap => {
    await showA(); await page.getByRole('button', { name: 'Choisir', exact: true }).first().click();
    const modal = page.getByRole('dialog', { name: 'Votre logo, pour fond sombre', exact: true }); await modal.waitFor();
    await page.evaluate(() => {
      const original = File.prototype.arrayBuffer;
      window.siteFileRead = { started: false, returned: false };
      File.prototype.arrayBuffer = async function () {
        const bytes = await original.call(this);
        if (this.name === 'scope-logo.png') {
          window.siteFileRead!.started = true;
          await new Promise<void>(resolve => { window.siteFileRead!.release = resolve; });
          window.siteFileRead!.returned = true;
        }
        return bytes;
      };
    });
    // Native File bytes and real format validation; only I/O completion is held.
    await modal.locator('input[type=file]').first().setInputFiles({ name: 'scope-logo.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6rx8AAAAASUVORK5CYII=', 'base64') });
    await page.waitForFunction(() => window.siteFileRead?.started);
    if (swap) { await changeToken(tokens.B); await waitB(); }
    await page.evaluate(() => window.siteFileRead?.release?.()); await page.waitForFunction(() => window.siteFileRead?.returned);
    if (!swap) { await modal.getByText('Upload de recette refusé après réception', { exact: true }).waitFor(); expect(requests.filter(request => request.method === 'POST' && request.path === '/api/medias')).toEqual([{ method: 'POST', path: '/api/medias', authority: 'A' }]); }
    else {
      await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => resolve())));
      expect(requests.filter(request => request.method === 'POST' && request.path === '/api/medias')).toEqual([]); expect(await name().inputValue()).toBe('Restaurant B');
    }
  });
  it('réagit à un vrai événement storage provenant d’un autre onglet de même rôle', async () => {
    await showA(); await name().fill('Ancien restaurant A');
    const other = await context.newPage(); await other.goto(`${origin}/fixture/session`);
    await other.evaluate(token => localStorage.setItem('sm.token.resto', token), tokens.B);
    await waitB(); expect(mutations()).toEqual([]); expect(tenants.B.name).toBe('Restaurant B'); await other.close();
  });
  it.each(['brand', 'name', 'card'] as const)('refuse le brouillon A avec un jeton B avant même storage/focus : %s', async field => {
    await showA();
    if (field === 'brand') { await page.getByRole('tab', { name: 'Accueil', exact: true }).click(); await tagline().fill('Brouillon de A'); }
    else if (field === 'name') await name().fill('Nom modifié de A');
    else { await page.getByRole('tab', { name: 'Carte', exact: true }).click(); await page.getByLabel('Présentation photo', { exact: true }).selectOption('cover'); }
    const save = field === 'brand' ? brandSave() : page.getByRole('button', { name: field === 'name' ? 'Enregistrer le nom' : 'Enregistrer ce produit', exact: true });
    // The swap and click share one JS turn: a storage effect cannot be the guard.
    await save.evaluate((button, token) => { localStorage.setItem('sm.token.resto', token); (button as HTMLButtonElement).click(); }, tokens.B);
    await changeToken(tokens.B); await waitB();
    expect(mutations()).toEqual([]); expect(tenants.B.name).toBe('Restaurant B'); expect(tenants.B.brand).toEqual(DIRECTIONS.nuit);
  });
  it('ignore la réponse /me A retenue quand B est devenu l’autorité', async () => {
    holdMe = 'A'; await open(); await heldRequest('/api/tenants/me', 'A');
    await changeToken(tokens.B); await waitB(); release('/api/tenants/me', 'A');
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => resolve())));
    expect(await name().inputValue()).toBe('Restaurant B'); expect(mutations()).toEqual([]);
  });
  it.each(['brand', 'name', 'card'] as const)('un ACK A retardé ne remplace ni ne confirme l’écran B : %s', async field => {
    await showA(); const path = field === 'brand' ? '/api/tenants/me/marque' : field === 'name' ? '/api/tenants/me/identity' : `/api/products/${productId.A}`; holdPatch = path;
    if (field === 'brand') { await page.getByRole('tab', { name: 'Accueil', exact: true }).click(); await tagline().fill('Brouillon de A'); await brandSave().click(); }
    else if (field === 'name') { await name().fill('Nom modifié de A'); await page.getByRole('button', { name: 'Enregistrer le nom', exact: true }).click(); }
    else { await page.getByRole('tab', { name: 'Carte', exact: true }).click(); await page.getByLabel('Présentation photo', { exact: true }).selectOption('cover'); await page.getByRole('button', { name: 'Enregistrer ce produit', exact: true }).click(); }
    await heldRequest(path, 'A'); await changeToken(tokens.B); await waitB();
    const delivered = page.waitForResponse(response => new URL(response.url()).pathname === path && response.request().method() === 'PATCH');
    release(path, 'A'); await (await delivered).finished();
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => resolve())));
    expect(await name().inputValue()).toBe('Restaurant B'); expect(mutations()).toHaveLength(1); expect(mutations()[0]?.authority).toBe('A');
    expect(await page.getByText('Nom enregistré.', { exact: true }).count()).toBe(0);
    expect(await page.getByText(/Modifications enregistrées\./).count()).toBe(0);
    if (field === 'brand') expect(await page.evaluate(id => sessionStorage.getItem(`sm.admin.site.brand-draft.v1:${id}`), tenantId.A)).not.toBeNull();
    if (field === 'card') { await page.getByRole('tab', { name: 'Carte', exact: true }).click(); await page.getByText('Produit B', { exact: true }).waitFor(); expect(await page.getByLabel('Présentation photo', { exact: true }).inputValue()).toBe('cutout'); }
  });
  it('garde le brouillon A dans son restaurant et ne l’applique jamais automatiquement à B', async () => {
    await showA(); await page.getByRole('tab', { name: 'Accueil', exact: true }).click(); await tagline().fill('Accueil de A');
    await vi.waitFor(async () => expect(await page.evaluate(id => sessionStorage.getItem(`sm.admin.site.brand-draft.v1:${id}`), tenantId.A)).toContain('Accueil de A'));
    await changeToken(tokens.B); await waitB(); await page.getByRole('tab', { name: 'Accueil', exact: true }).click(); expect(await tagline().inputValue()).toBe('');
    await changeToken(tokens.A); await vi.waitFor(async () => expect(await name().inputValue()).toBe('Restaurant A'));
    await page.getByRole('tab', { name: 'Accueil', exact: true }).click(); await vi.waitFor(async () => expect(await tagline().inputValue()).toBe('Accueil de A')); expect(mutations()).toEqual([]);
  });
  it('un retour manuel à la valeur initiale ne ressuscite pas le brouillon au reload', async () => {
    tenants.A.brand = { ...tenants.A.brand, tagline: 'Accueil initial' };
    await showA(); await page.getByRole('tab', { name: 'Accueil', exact: true }).click(); await tagline().fill('Texte annulé');
    await vi.waitFor(async () => expect(await page.evaluate(id => sessionStorage.getItem(`sm.admin.site.brand-draft.v1:${id}`), tenantId.A)).toContain('Texte annulé'));
    await tagline().fill('Accueil initial'); await vi.waitFor(async () => expect(await brandSave().isDisabled()).toBe(true));
    await page.reload(); await name().waitFor(); await page.getByRole('tab', { name: 'Accueil', exact: true }).click(); expect(await tagline().inputValue()).toBe('Accueil initial'); expect(mutations()).toEqual([]);
  });
  it('un rôle de lecture consulte l’aperçu sans contrôles ni lectures privées de la carte', async () => {
    await open(tokens.reader); await page.getByText(/Aperçu en lecture seule\./).waitFor();
    expect(await name().count()).toBe(0); expect(await brandSave().count()).toBe(0); expect(await page.getByRole('tab', { name: 'Carte', exact: true }).count()).toBe(0);
    expect(requests.filter(request => request.path === '/api/menu')).toEqual([]); expect(mutations()).toEqual([]);
  });
  it.each(['name', 'card'] as const)('bloque les liens avant ACK et conserve les choix après réponse incertaine : %s', async field => {
    await showA(); const path = field === 'name' ? '/api/tenants/me/identity' : `/api/products/${productId.A}`; holdPatch = path;
    if (field === 'name') { await name().fill('Nom à confirmer'); await page.getByRole('button', { name: 'Enregistrer le nom', exact: true }).click(); }
    else { await page.getByRole('tab', { name: 'Carte', exact: true }).click(); await page.getByLabel('Présentation photo', { exact: true }).selectOption('cover'); await page.getByRole('button', { name: 'Enregistrer ce produit', exact: true }).click(); }
    await heldRequest(path, 'A'); await page.getByRole('link', { name: 'Autre page', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Enregistrement en cours', exact: true }); await dialog.waitFor();
    expect(await dialog.getByRole('button', { name: 'Quitter cette page', exact: true }).count()).toBe(0); expect(new URL(page.url()).pathname).toBe('/admin/site');
    await dialog.getByRole('button', { name: 'Continuer l’édition', exact: true }).click(); await dialog.waitFor({ state: 'hidden' }); release(path, 'A', 503);
    await page.getByRole('alert').waitFor();
    if (field === 'name') { expect(await name().inputValue()).toBe('Nom à confirmer'); expect(await page.getByText('Nom enregistré.', { exact: true }).count()).toBe(0); }
    else { expect(await page.getByLabel('Présentation photo', { exact: true }).inputValue()).toBe('cover'); expect(await page.getByText('Présentation de Produit A enregistrée.', { exact: true }).count()).toBe(0); }
    expect(mutations()).toHaveLength(1);
  });
});
