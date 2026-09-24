import { createServer, type Server } from 'node:http';
import { mkdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { build } from 'esbuild';
import postcss from 'postcss';
import tailwind from '@tailwindcss/postcss';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { LoyaltySaleSettlementV2 as LoyaltySaleSettlement } from '@sm/contracts';
import { LOYALTY_SALE_RESOLUTION_STORAGE_KEY } from '@sm/client-core';
const id = 'a'.repeat(24), tenant = 'b'.repeat(24), sub = 'c'.repeat(24), caseId = '11111111-1111-4111-8111-111111111111';
const token = (subject = sub) => `fixture.${Buffer.from(JSON.stringify({ tenantId: tenant, sub: subject, kind: 'user', role: 'owner', exp: 2_000_000_000 })).toString('base64url')}.fixture`;
let server: Server, browser: Browser, context: BrowserContext, page: Page, origin: string;
let view: LoyaltySaleSettlement, posts: Record<string, unknown>[], reads: string[], faults: string[];
let mode: 'normal' | 'lost' | 'uncertain' | 'hold', holdRead: boolean, releaseRead: (() => void) | undefined, releasePost: (() => void) | undefined;
const capture = process.env.LOYALTY_SALES_UI_CAPTURES;
beforeAll(async () => {
  if (capture) await mkdir(capture, { recursive: true });
  const root = fileURLToPath(new URL('.', import.meta.url)), cssPath = fileURLToPath(new URL('../../globals.css', import.meta.url));
  const [bundle, css] = await Promise.all([
    build({ stdin: { contents: "import React from'react';import{createRoot}from'react-dom/client';import{LoyaltySales}from'./LoyaltySales';createRoot(document.getElementById('root')).render(<React.StrictMode><LoyaltySales/></React.StrictMode>);", loader: 'tsx', resolveDir: root }, bundle: true, write: false, platform: 'browser', format: 'esm', target: 'es2022', jsx: 'automatic', outdir: '/virtual-sales', alias: { '@': fileURLToPath(new URL('../../../', import.meta.url)) }, define: { 'process.env': '{}', 'process.env.NODE_ENV': '"production"', 'process.env.NEXT_PUBLIC_API_URL': '"/api"' } }),
    readFile(cssPath, 'utf8').then(source => postcss([tailwind({ base: fileURLToPath(new URL('../../../..', import.meta.url)) })]).process(source, { from: cssPath })),
  ]);
  server = createServer(async (request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    const path = request.url ?? '/', json = (value: unknown, status = 200) => { if (!response.destroyed) response.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify(value)); };
    if (path === '/app.js') { response.setHeader('Content-Type', 'text/javascript'); response.end(bundle.outputFiles.find(file => file.path.endsWith('.js'))!.text); return; }
    if (path === '/style.css') { response.setHeader('Content-Type', 'text/css'); response.end(css.css); return; }
    if (path === '/favicon.ico') { response.writeHead(204).end(); return; }
    if (path === '/') { response.setHeader('Content-Type', 'text/html'); response.end('<!doctype html><html lang="fr"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"><div id="root"></div><script type="module" src="/app.js"></script></html>'); return; }
    if (request.headers.authorization !== `Bearer ${token()}`) { json({ message: 'Accès refusé' }, 401); return; }
    if (request.method === 'GET' && path.startsWith('/api/loyalty/sales')) {
      reads.push(path); const snapshot = structuredClone(path.startsWith(`/api/loyalty/sales/${id}`) ? view : { items: [view], nextCursor: null });
      if (holdRead && path.startsWith(`/api/loyalty/sales/${id}`)) { holdRead = false; releaseRead = () => json(snapshot); } else json(snapshot); return;
    }
    if (request.method === 'POST' && path === `/api/loyalty/sales/${id}/resolution`) {
      const chunks: Buffer[] = []; for await (const chunk of request) chunks.push(Buffer.from(chunk)); const body = JSON.parse(Buffer.concat(chunks).toString()); posts.push(body);
      const complete = () => {
        const { password: _secret, ...intent } = body;
        void _secret;
        if (!view.resolutions.some(receipt => receipt.request.operationId === intent.operationId)) {
          if (intent.expectedVersion !== view.version) { json({ message: 'Dossier modifié' }, 409); return; }
          view.waivedUnits += view.dueUnits; view.dueUnits = 0; view.version!++; view.state = 'recorded'; view.reason = null; view.canResolve = false;
          view.resolutions.push({ request: intent, recordedAt: '2026-09-21T12:00:00.000Z', result: { state: 'recorded', reason: null, version: view.version!, initialUnits: view.initialUnits, waivedUnits: view.waivedUnits, reversedUnits: view.reversedUnits, retainedUnits: view.retainedUnits, dueUnits: 0 } });
        }
        if (mode === 'lost') { response.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': '9999' }); response.flushHeaders(); response.write('{'); setTimeout(() => response.destroy(), 10); } else json(view);
      };
      if (mode === 'uncertain') { json({ message: 'Réponse indisponible' }, 503); return; }
      if (mode === 'hold') { releasePost = complete; return; } complete(); return;
    }
    faults.push(`${request.method} ${path}`); json({ message: 'fixture missing' }, 404);
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve)); const address = server.address(); if (!address || typeof address === 'string') throw new Error('port'); origin = `http://127.0.0.1:${address.port}`;
  browser = await chromium.launch({ headless: true });
}, 30_000);
beforeEach(async () => {
  view = { orderId: id, orderNumber: 42, caseId, version: 2, state: 'reconciliation', reason: 'insufficient_balance', initialUnits: 10, reversedUnits: 0, waivedUnits: 0, retainedUnits: 10, dueUnits: 4, canResolve: true, canAllocate: false, resolutions: [] };
  posts = []; reads = []; faults = []; mode = 'normal'; holdRead = false; releaseRead = undefined; releasePost = undefined;
  context = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce', serviceWorkers: 'block' });
  await context.addInitScript(value => { if (!localStorage.getItem('sm.token.resto')) localStorage.setItem('sm.token.resto', value); }, token());
  page = await context.newPage(); page.setDefaultTimeout(5000); page.on('pageerror', error => faults.push(error.message)); await page.goto(origin);
});
afterEach(async () => { releaseRead?.(); releasePost?.(); await context.close(); expect(faults).toEqual([]); });
afterAll(async () => { await browser?.close(); await new Promise<void>(resolve => server?.close(() => resolve())); });
async function open() { await page.getByRole('button', { name: 'Consulter le dossier', exact: true }).click(); await settled(); }
async function settled() { await expect.poll(() => page.getByRole('button', { name: 'Relire le dossier', exact: true }).isEnabled()).toBe(true); }
async function fill() { await page.getByRole('radio', { name: 'Laisser au client les unités actuellement dues', exact: true }).check(); await page.getByLabel('Motif de la décision').fill('Geste commercial'); await page.getByLabel('Votre mot de passe').fill('fixture-password'); }
async function local() { return page.evaluate(key => localStorage.getItem(key), LOYALTY_SALE_RESOLUTION_STORAGE_KEY); }
// Real components, HTTP adapter, shared journal and browser Web Locks. All HTTP stays on loopback.
describe('web loyalty settlement operations', () => {
  it('shows a cancelled offered sale without claiming a gain or offering a financial decision', async () => {
    view = { orderId: id, orderNumber: 42, caseId, version: 2, state: 'not_earned', reason: 'cancelled_before_handoff',
      initialUnits: null, reversedUnits: 0, waivedUnits: 0, retainedUnits: 0, dueUnits: 0, canResolve: false, canAllocate: false, resolutions: [] };
    await page.reload();
    await page.getByText('Sans gain — commande annulée', { exact: true }).waitFor();
    expect(await page.getByText('Aucun gain enregistré', { exact: true }).count()).toBe(1);
    await open();
    const dialog = page.getByRole('dialog');
    await dialog.getByText('Sans gain — commande annulée', { exact: true }).waitFor();
    expect(await dialog.getByText('Aucun gain enregistré', { exact: true }).count()).toBe(1);
    expect(await dialog.getByText('En attente du paiement et de la remise confirmés.', { exact: true }).count()).toBe(0);
    expect(await dialog.getByText('À confirmer', { exact: true }).count()).toBe(0);
    expect(await dialog.getByRole('button', { name: 'Confirmer la décision', exact: true }).count()).toBe(0);
    expect(await page.getByRole('button', { name: 'Répartir le remboursement', exact: true }).count()).toBe(0);
    expect(posts).toEqual([]); expect(await local()).toBeNull();
    expect(reads.length).toBeGreaterThanOrEqual(2);
    expect(reads.every(path => new URL(path, origin).searchParams.get('presentationVersion') === '2')).toBe(true);
  });
  it('makes the current-only commercial decision explicit and clears only after an exact receipt', async () => {
    await open(); await fill(); await page.getByText('Cette décision ne couvre aucun remboursement futur', { exact: false }).waitFor();
    await page.getByRole('button', { name: 'Confirmer la décision', exact: true }).click(); await settled();
    expect(posts).toHaveLength(1); expect(posts[0]).toMatchObject({ expectedVersion: 2, decision: 'waive_current', reason: 'Geste commercial' }); expect(await local()).toBeNull();
    await page.getByRole('region', { name: 'Décisions enregistrées' }).waitFor();
  });
  it('reads an exact receipt after lost ACK without another mutation', async () => {
    mode = 'lost'; await open(); await fill(); await page.getByRole('button', { name: 'Confirmer la décision', exact: true }).click(); await settled();
    expect(await local()).toBeNull(); expect(posts).toHaveLength(1); expect(reads.some(path => path.includes(`resolutionId=${posts[0]!.operationId}`))).toBe(true);
  });
  it('keeps the exact UUID, case, version and decision after reload with a lost response', async () => {
    mode = 'uncertain'; await open(); await fill(); await page.getByRole('button', { name: 'Confirmer la décision', exact: true }).click(); await settled();
    expect(await local()).not.toContain('fixture-password'); const first = posts[0];
    await page.reload(); await open(); expect(await page.getByLabel('Motif de la décision').isDisabled()).toBe(true);
    await page.getByLabel('Votre mot de passe').fill('fixture-password'); mode = 'normal'; await page.getByRole('button', { name: 'Reprendre la décision', exact: true }).click(); await settled();
    expect(posts).toHaveLength(2); expect(posts[1]).toEqual(first); expect(await local()).toBeNull();
  });
  it('blocks mutation when durable storage is refused', async () => {
    await open(); await fill(); await page.evaluate(key => { const original = Storage.prototype.setItem; Storage.prototype.setItem = function(name, value) { if (name === key) throw new Error('quota'); original.call(this, name, value); }; }, LOYALTY_SALE_RESOLUTION_STORAGE_KEY);
    await page.getByRole('button', { name: 'Confirmer la décision', exact: true }).click(); await settled(); expect(posts).toEqual([]);
  });
  it('does not POST after closing during the final observation read', async () => {
    await open(); await fill(); holdRead = true; await page.getByRole('button', { name: 'Confirmer la décision', exact: true }).click(); await expect.poll(() => !!releaseRead).toBe(true);
    await page.getByRole('button', { name: 'Retour', exact: true }).click(); releaseRead!(); releaseRead = undefined; await open(); expect(posts).toEqual([]); expect(await local()).not.toBeNull();
  });
  it('drops private data and blocks POST after a same-role tenant identity swap during preflight', async () => {
    await open(); await fill(); holdRead = true; await page.getByRole('button', { name: 'Confirmer la décision', exact: true }).click(); await expect.poll(() => !!releaseRead).toBe(true);
    await page.evaluate(value => { localStorage.setItem('sm.token.resto', value); window.dispatchEvent(new Event('storage')); }, token('d'.repeat(24))); releaseRead!(); releaseRead = undefined;
    await expect.poll(() => page.getByRole('dialog').count()).toBe(0); expect(posts).toEqual([]); expect(await page.getByText('Commande n°42', { exact: true }).count()).toBe(0);
  });
  it('never reuses an old decision for a newer refund version', async () => {
    mode = 'uncertain'; await open(); await fill(); await page.getByRole('button', { name: 'Confirmer la décision', exact: true }).click(); await settled();
    view.version = 3; view.dueUnits = 7; await page.reload(); await open();
    await page.getByRole('button', { name: 'Fermer cette décision périmée', exact: true }).click(); await settled();
    expect(await local()).toBeNull(); expect(posts).toHaveLength(1); expect(view.waivedUnits).toBe(0);
  });
  it.each([320, 390, 1440])('shows operational states and current-only confirmation without overflow at %ipx', async width => {
    await page.setViewportSize({ width, height: 900 }); await open(); await fill();
    const overflow = await page.getByRole('dialog').evaluate(dialog => [...dialog.querySelectorAll('input,button')].some(control => { const box = control.getBoundingClientRect(); return box.left < 0 || box.right > innerWidth; })); expect(overflow).toBe(false);
    if (capture) await page.screenshot({ path: join(capture, `${width}-resolution.png`) }); expect(posts).toEqual([]);
  });
});
