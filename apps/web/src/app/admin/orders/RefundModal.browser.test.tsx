import { createServer, type Server } from 'node:http';
import { mkdir, mkdtemp, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build } from 'esbuild';
import postcss from 'postcss';
import tailwind from '@tailwindcss/postcss';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ORDER_REFUND_STORAGE_KEY } from '@sm/client-core';
import type { OrderRefundJournal, OrderRefundOperationView } from '@sm/contracts';

const id = 'a'.repeat(24), tenantId = 'b'.repeat(24), sub = 'c'.repeat(24);
const token = (subject = sub) => `fixture.${Buffer.from(JSON.stringify({ tenantId, sub: subject, kind: 'user', role: 'owner', exp: 2_000_000_000 })).toString('base64url')}.fixture`;
const ownerId = `${tenantId}:user:${sub}`;
const order = { _id: id, number: 42, payment: { method: 'online', status: 'paid', stripePaymentIntentId: 'pi_fixture' } };
const detailOrder = { ...order, clientId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', channel: 'online', type: 'pickup',
  lines: [], totals: { subtotal: 150, discount: null, total: 150 }, status: 'ready', statusHistory: [],
  pickup: { slot: '2030-09-24T12:00:00.000Z', customerName: 'Recette locale', customerPhone: null }, note: null,
  createdAt: '2030-09-24T11:30:00.000Z', updatedAt: '2030-09-24T11:30:00.000Z' };
const base = `/api/orders/${id}/refunds`;
let server: Server, browser: Browser, context: BrowserContext, page: Page, origin: string, captures: string;
let journal: OrderRefundJournal, posts: { path: string; body: Record<string, unknown> }[], reads: string[], faults: string[];
let mode: 'normal' | 'ack-lost' | 'uncertain' | 'hold-post', orderFailure: boolean, bankFailure: boolean;
let journalUnavailable: boolean, loseJournalAfterPost: boolean, auditFailure: boolean;
let held: (() => void) | undefined, holdRead: boolean, heldRead: (() => void) | undefined;
const operation = (overrides: Partial<OrderRefundOperationView> = {}): OrderRefundOperationView => ({ orderId: id,
  operationId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', amountCents: 500, reason: 'Produit indisponible',
  state: 'prepared', providerStatus: null, canResume: true, preparedAt: '2026-09-20T10:00:00.000Z', ...overrides });
function accountFor(request: { headers: { authorization?: string } }) { return request.headers.authorization === `Bearer ${token()}`; }

beforeAll(async () => {
  captures = process.env.REFUND_UI_CAPTURES ?? await mkdtemp(join(tmpdir(), 'sm-refund-ui-'));
  await mkdir(captures, { recursive: true });
  const root = fileURLToPath(new URL('.', import.meta.url));
  const cssPath = fileURLToPath(new URL('../../globals.css', import.meta.url));
  const [bundle, css] = await Promise.all([
    build({ stdin: { contents: `import React,{useState}from'react';import{createRoot}from'react-dom/client';import{ToastProvider}from'@/components/ui';import{RefundModal}from'./RefundModal';import{OrderDrawer}from'./OrderDrawer';import{CancelModal}from'./CancelModal';
      const query=new URLSearchParams(location.search),kind=query.get('detail');const detail=${JSON.stringify(detailOrder)};
      if(kind==='free'||kind==='pending'){detail.totals={subtotal:150,discount:{amount:150,reason:'Récompense recette'},total:0};detail.payment={method:'online',status:kind==='free'?'paid':'pending',stripePaymentIntentId:null};}
      function Fixture(){const[open,setOpen]=useState(false);const[cancelling,setCancelling]=useState(false);
        if(kind)return <main><h1>Commandes</h1><OrderDrawer order={detail} onClose={()=>{}} onPrint={()=>{}} onCancel={()=>setCancelling(true)} onRefund={()=>{}}/><CancelModal order={cancelling?detail:null} owner={query.get('owner')==='1'} onClose={()=>setCancelling(false)} onCancelled={()=>setCancelling(false)}/></main>;
        return <main><h1>Commandes</h1><button onClick={()=>setOpen(true)}>Ouvrir remboursements</button>{open&&<RefundModal order={${JSON.stringify(order)}} onClose={()=>setOpen(false)} onRefunded={()=>setOpen(false)}/>}</main>}
      createRoot(document.getElementById('root')).render(<React.StrictMode><ToastProvider><Fixture/></ToastProvider></React.StrictMode>);`, loader: 'tsx', resolveDir: root, sourcefile: 'refund-ui-fixture.tsx' },
      bundle: true, write: false, platform: 'browser', format: 'esm', target: 'es2022', jsx: 'automatic', outdir: '/virtual-refund-ui',
      alias: { '@': fileURLToPath(new URL('../../../', import.meta.url)) },
      define: { 'process.env': '{}', 'process.env.NODE_ENV': '"production"', 'process.env.NEXT_PUBLIC_API_URL': '"/api"' } }),
    readFile(cssPath, 'utf8').then(source => postcss([tailwind({ base: fileURLToPath(new URL('../../../..', import.meta.url)) })]).process(source, { from: cssPath })),
  ]);
  server = createServer(async (request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    const path = request.url ?? '/';
    const json = (value: unknown, status = 200) => { if (!response.destroyed) response.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify(value)); };
    if (path === '/app.js') { response.setHeader('Content-Type', 'text/javascript'); response.end(bundle.outputFiles.find(file => file.path.endsWith('.js'))!.text); return; }
    if (path === '/style.css') { response.setHeader('Content-Type', 'text/css'); response.end(css.css); return; }
    if (path === '/favicon.ico') { response.writeHead(204).end(); return; }
    if (new URL(path, origin).pathname === '/admin/orders') { response.setHeader('Content-Type', 'text/html'); response.end('<!doctype html><html lang="fr"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"><div id="root"></div><script type="module" src="/app.js"></script></html>'); return; }
    if (!accountFor(request)) { json({ message: 'Accès refusé' }, 401); return; }
    if (request.method === 'GET') {
      reads.push(path);
      if (path === base + '/journal') {
        if (journalUnavailable) { json({ message: 'Journal indisponible' }, 503); return; }
        const snapshot = structuredClone(journal);
        if (holdRead) { holdRead = false; heldRead = () => json(snapshot); } else json(snapshot);
        return;
      }
      if (path === base) { json(bankFailure ? { message: 'Banque indisponible' } : journal.summary, bankFailure ? 503 : 200); return; }
      if (path === `/api/orders/${id}`) { json(orderFailure ? { message: 'Commande indisponible' } : order, orderFailure ? 503 : 200); return; }
    }
    if (request.method === 'POST' && /\/allocation(?:\/withdraw)?$/.test(path)) {
      const chunks: Buffer[] = []; for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const body = JSON.parse(Buffer.concat(chunks).toString()); posts.push({ path, body });
      const withdrawing = path.endsWith('/withdraw');
      const refundId = decodeURIComponent(path.replace(/\/withdraw$/, '').slice((base + '/').length, -'/allocation'.length));
      const complete = () => {
        if (journal.allocations.some(entry => entry.operationId === body.operationId)) { json(journal); return; }
        if (!withdrawing && journal.allocations.some(entry => entry.refundId === refundId && entry.operationId !== body.operationId)) { json({ message: 'Répartition déjà enregistrée' }, 409); return; }
        journal.allocations.push({ operationId: body.operationId, refundId, allocation: body.allocation, reason: body.reason, state: withdrawing ? 'withdrawn' : 'recorded', recordedAt: '2026-09-21T10:00:00.000Z' });
        if (!withdrawing) journal.allocation.unallocated = journal.allocation.unallocated.filter(entry => entry.refundId !== refundId);
        if (loseJournalAfterPost) journalUnavailable = true;
        if (mode === 'ack-lost' || mode === 'uncertain') {
          response.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': '10000' }); response.flushHeaders(); response.write('{'); setTimeout(() => response.destroy(), 10);
        } else json({ recorded: true });
      };
      if (mode === 'hold-post') { held = complete; return; }
      if (mode === 'uncertain') { response.writeHead(503).end(); return; }
      complete(); return;
    }
    if (request.method === 'POST' && [base, base + '/withdraw'].includes(path)) {
      const chunks: Buffer[] = []; for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const body = JSON.parse(Buffer.concat(chunks).toString()); posts.push({ path, body });
      if (body.clientProtocolVersion !== 2) { json({ code: 'REFUND_CLIENT_UPDATE_REQUIRED', message: 'Actualisez cette page avant de demander un remboursement.' }, 409); return; }
      const found = journal.operations.find(entry => entry.operationId === body.operationId);
      const row = found ?? operation({ operationId: body.operationId, amountCents: body.amountCents, reason: body.reason, allocation: body.allocation ?? null });
      if (!found) journal.operations.push(row);
      row.state = 'creating'; row.canResume = true; journal.summary.remainingCents = 0;
      const loseResponse = () => { response.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': '10000' }); response.flushHeaders(); response.write('{'); setTimeout(() => response.destroy(), 10); };
      if (path.endsWith('/withdraw')) { row.state = 'withdrawn'; row.providerStatus = null; row.canResume = false; journal.summary.remainingCents = 1000; json(auditFailure ? { message: 'Finalisation administrative indisponible' } : journal.summary, auditFailure ? 500 : 200); return; }
      const complete = () => {
        row.state = 'known'; row.providerStatus = 'pending'; row.canResume = false;
        journal.summary.pendingRefundCents = row.amountCents; journal.summary.status = 'pending';
        journal.summary.remainingCents = 1000 - row.amountCents;
        if (loseJournalAfterPost) journalUnavailable = true;
        if (mode === 'ack-lost') loseResponse(); else json(auditFailure ? { message: 'Finalisation administrative indisponible' } : journal.summary, auditFailure ? 500 : 200);
      };
      if (mode === 'uncertain') { loseResponse(); return; }
      if (mode === 'hold-post') { held = complete; return; }
      complete(); return;
    }
    faults.push(`${request.method} ${path}`); json({ message: 'Fixture route missing' }, 404);
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('Missing port');
  origin = `http://127.0.0.1:${address.port}`;
  browser = await chromium.launch({ headless: true });
}, 30_000);

beforeEach(async () => {
  journal = { orderId: id, enabled: true, summary: { refundedCents: 0, pendingRefundCents: 0, remainingCents: 1000, status: 'none', refunds: [] }, operations: [], allocation: { basis: { version: 1, merchandiseCents: 1000, deliveryCents: 0 }, remaining: { version: 1, merchandiseCents: 1000, deliveryCents: 0 }, capacity: { version: 1, merchandiseCents: 1000, deliveryCents: 0 }, unallocated: [] }, allocations: [] };
  posts = []; reads = []; faults = []; journalUnavailable = false; loseJournalAfterPost = false; auditFailure = false; mode = 'normal'; orderFailure = false; bankFailure = false; held = undefined; heldRead = undefined; holdRead = false;
  context = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce', serviceWorkers: 'block' });
  await context.addInitScript(value => { if (!localStorage.getItem('sm.token.resto')) localStorage.setItem('sm.token.resto', value); }, token());
  page = await context.newPage(); page.setDefaultTimeout(5_000); page.on('pageerror', error => faults.push(error.message));
  await page.goto(origin + '/admin/orders');
});
afterEach(async () => { held?.(); heldRead?.(); await context.close(); expect(faults).toEqual([]); for (const post of posts) expect(post.body.clientProtocolVersion).toBe(2); });
afterAll(async () => { await browser?.close(); await new Promise<void>(resolve => server?.close(() => resolve())); });
async function open(target = page) { await target.getByRole('button', { name: 'Ouvrir remboursements', exact: true }).click(); await target.getByRole('button', { name: 'Relire le journal', exact: true }).waitFor(); await expect.poll(() => target.getByRole('button', { name: 'Relire le journal', exact: true }).isEnabled()).toBe(true); }
async function fill(target = page) { await target.getByLabel('Montant à rembourser (€)').fill('5,00'); await target.getByLabel('Motif', { exact: true }).fill('Produit indisponible'); await target.getByLabel('Votre mot de passe', { exact: true }).fill('local-password-fixture'); }
async function send(target = page) { await target.getByRole('button', { name: 'Confirmer le remboursement', exact: true }).click(); }
async function local(target = page) { return target.evaluate(key => localStorage.getItem(key), ORDER_REFUND_STORAGE_KEY); }
async function settled(target = page) { await expect.poll(() => target.getByRole('button', { name: 'Relire le journal', exact: true }).isEnabled()).toBe(true); }

// True Modal, api, shared CAS/Web Locks and browser persistence; only provider HTTP is a loopback fixture.
describe('durable refund modal', () => {
  it.each([false, true])('does not invent a bank payment for a free order and preserves cancellation authentication (owner=%s)', async owner => {
    await page.goto(origin + `/admin/orders?detail=free&owner=${owner ? '1' : '0'}`);
    await page.getByText('Rien à régler', { exact: true }).waitFor();
    expect(await page.getByText('Payée en ligne', { exact: true }).count()).toBe(0);
    expect(await page.getByRole('button', { name: 'Rembourser', exact: true }).count()).toBe(0);
    await page.getByRole('button', { name: 'Annuler la commande', exact: true }).click();
    await page.getByRole('note').filter({ hasText: 'Cette commande est offerte. Aucun paiement n’est à rembourser.' }).waitFor();
    expect(await page.getByText('Le paiement a déjà été encaissé.', { exact: false }).count()).toBe(0);
    const confirm = page.getByRole('button', { name: "Confirmer l'annulation", exact: true });
    expect(await confirm.isDisabled()).toBe(true);
    await page.getByLabel("Raison de l'annulation", { exact: true }).fill('Client absent');
    expect(await confirm.isDisabled()).toBe(true);
    await page.getByLabel(owner ? 'Votre mot de passe' : 'PIN staff', { exact: true }).fill(owner ? 'local-password-fixture' : '1234');
    expect(await confirm.isEnabled()).toBe(true);
    expect(posts).toEqual([]); expect(reads).toEqual([]);
  });
  it('keeps the collected-payment warning and refund action for a positive paid order', async () => {
    await page.goto(origin + '/admin/orders?detail=paid');
    await page.getByText('Payée en ligne', { exact: true }).waitFor();
    expect(await page.getByRole('button', { name: 'Rembourser', exact: true }).isVisible()).toBe(true);
    expect(await page.getByText('Rien à régler', { exact: true }).count()).toBe(0);
    await page.getByRole('button', { name: 'Annuler la commande', exact: true }).click();
    await page.getByRole('note').filter({ hasText: 'Le paiement a déjà été encaissé.' }).waitFor();
    expect(await page.getByText('Cette commande est offerte.', { exact: false }).count()).toBe(0);
    expect(posts).toEqual([]); expect(reads).toEqual([]);
  });
  it('does not present a zero total awaiting settlement as a confirmed free order', async () => {
    await page.goto(origin + '/admin/orders?detail=pending');
    await page.getByText('À encaisser', { exact: true }).waitFor();
    expect(await page.getByText('Rien à régler', { exact: true }).count()).toBe(0);
    await page.getByRole('button', { name: 'Annuler la commande', exact: true }).click();
    expect(await page.getByRole('note').count()).toBe(0);
    expect(posts).toEqual([]); expect(reads).toEqual([]);
  });
  it('contains all actions at 320px and keeps the footer reachable', async () => {
    await page.setViewportSize({ width: 320, height: 568 });
    journal.operations = [operation({ state: 'known', providerStatus: 'pending', canResume: false })];
    journal.summary.remainingCents = 500; journal.summary.pendingRefundCents = 500; journal.summary.status = 'pending';
    await open();
    const measurements = await page.getByRole('dialog').evaluate(dialog => {
      const box = dialog.getBoundingClientRect();
      return [...dialog.querySelectorAll('button')].map(button => {
        const bounds = button.getBoundingClientRect();
        return { label: button.textContent, left: bounds.left, right: bounds.right, width: bounds.width,
          inside: bounds.left >= box.left && bounds.right <= box.right, contentFits: button.scrollWidth <= button.clientWidth + 1 };
      });
    });
    expect(measurements.every(button => button.inside && button.contentFits), JSON.stringify(measurements)).toBe(true);
    const footer = await page.locator('[data-dialog-footer]').boundingBox();
    expect(footer).not.toBeNull(); expect(footer!.y + footer!.height).toBeLessThanOrEqual(568);
    await page.screenshot({ path: join(captures, '320-known-pending.png') });
    await page.getByRole('button', { name: 'Préparer un nouveau remboursement', exact: true }).scrollIntoViewIfNeeded();
    expect(await page.getByRole('button', { name: 'Préparer un nouveau remboursement', exact: true }).isVisible()).toBe(true);
    await page.screenshot({ path: join(captures, '320-known-pending-scrolled.png') });
  });
  it.each([390, 820, 1440])('renders the four durable operation states at %ipx', async width => {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    for (const state of ['prepared', 'review_required', 'known', 'withdrawn'] as const) {
      journal.operations = [operation({ state, providerStatus: state === 'known' ? 'pending' : null, canResume: state === 'prepared' })];
      journal.summary.remainingCents = state === 'withdrawn' ? 1000 : 500;
      journal.summary.pendingRefundCents = state === 'withdrawn' ? 0 : 500;
      journal.summary.status = state === 'withdrawn' ? 'none' : 'pending';
      await open();
      const expected = state === 'prepared' ? 'Demande à reprendre' : state === 'review_required' ? 'À vérifier' : state === 'known' ? 'En attente banque' : 'Abandonné avant envoi';
      await page.getByText(expected, { exact: true }).waitFor();
      expect(await page.getByRole('button', { name: 'Reprendre cette demande', exact: true }).count()).toBe(state === 'prepared' ? 1 : 0);
      const overflow = await page.getByRole('dialog').evaluate(dialog => [...dialog.querySelectorAll('button')].some(button => {
        const bounds = button.getBoundingClientRect(); return bounds.left < 0 || bounds.right > innerWidth || button.scrollWidth > button.clientWidth + 1;
      }));
      expect(overflow).toBe(false);
      await page.screenshot({ path: join(captures, `${width}-${state}.png`) });
      await page.getByRole('button', { name: 'Retour', exact: true }).click();
    }
    expect(posts).toEqual([]);
  });
  it('keeps a known request settled when GET order fails, without sending another refund', async () => {
    orderFailure = true; await open(); await fill(); await send();
    await page.getByText('En attente banque', { exact: true }).waitFor(); await settled();
    expect(posts).toHaveLength(1); expect(await local()).toBeNull();
    await page.getByRole('button', { name: 'Actualiser la commande', exact: true }).click();
    await page.getByText('Commande indisponible', { exact: true }).waitFor();
    expect(posts).toHaveLength(1); expect(await page.getByRole('button', { name: 'Reprendre le remboursement', exact: true }).count()).toBe(0);
    expect(reads.filter(path => path === base)).toEqual([]);
  });
  it.each(['known', 'withdrawn'] as const)('keeps %s financially settled but reports a secondary POST failure until a complete verification', async state => {
    auditFailure = true;
    if (state === 'withdrawn') {
      journal.operations = [operation()];
      await page.evaluate(({ key, intent }) => localStorage.setItem(key, JSON.stringify({ version: 1, intents: [intent] })), {
        key: ORDER_REFUND_STORAGE_KEY, intent: { ownerId, orderId: id, operationId: operation().operationId, amountCents: 500, reason: operation().reason },
      });
    }
    await open();
    if (state === 'known') { await fill(); await send(); }
    else {
      await page.getByLabel('Votre mot de passe').fill('local-password-fixture');
      await page.getByRole('button', { name: 'Abandonner cette demande', exact: true }).click();
    }
    const warning = page.getByRole('status').filter({ hasText: 'La demande est enregistrée, mais la vérification complète n’a pas abouti.' });
    await warning.waitFor(); await settled();
    expect(await local()).toBeNull(); expect(posts).toHaveLength(1);
    expect(posts[0]!.path).toBe(state === 'known' ? base : base + '/withdraw');
    expect(await page.getByText(state === 'known' ? 'En attente banque' : 'Abandonné avant envoi', { exact: true }).count()).toBe(1);
    expect(await page.getByRole('alert').count()).toBe(0);
    expect(await page.getByRole('button', { name: 'Reprendre le remboursement', exact: true }).count()).toBe(0);
    bankFailure = true;
    await page.getByRole('button', { name: 'Vérifier auprès de la banque', exact: true }).click();
    await page.getByRole('alert').filter({ hasText: 'La vérification complète n’a pas abouti.' }).waitFor();
    expect(await warning.isVisible()).toBe(true); expect(posts).toHaveLength(1);
    bankFailure = false; auditFailure = false;
    await page.getByRole('button', { name: 'Vérifier auprès de la banque', exact: true }).click();
    await page.getByText('La vérification est terminée. Consultez l’état actuel de la demande dans le journal.', { exact: true }).waitFor();
    expect(await warning.count()).toBe(0); expect(posts).toHaveLength(1);
  });
  it('retains the UUID after POST success until the exact journal can be read', async () => {
    loseJournalAfterPost = true; await open(); await fill(); await send();
    await page.getByText('Journal indisponible', { exact: true }).waitFor(); await settled();
    expect(posts).toHaveLength(1); expect(await local()).toContain(String(posts[0]!.body.operationId));
    journalUnavailable = false;
    await page.getByRole('button', { name: 'Relire le journal', exact: true }).click();
    await page.getByText('En attente banque', { exact: true }).waitFor(); await settled();
    expect(posts).toHaveLength(1); expect(await local()).toBeNull();
  });
  it('offers a read-only retry when the initial journal request fails', async () => {
    journalUnavailable = true; await page.getByRole('button', { name: 'Ouvrir remboursements', exact: true }).click();
    await page.getByText('Journal indisponible', { exact: true }).waitFor();
    journalUnavailable = false; await page.getByRole('button', { name: 'Réessayer la lecture du journal', exact: true }).click();
    await page.getByLabel('Montant à rembourser (€)').waitFor(); expect(posts).toEqual([]);
  });
  it('never reveals or replaces an intent belonging to another owner', async () => {
    await page.evaluate(({ key, intent }) => localStorage.setItem(key, JSON.stringify({ version: 1, intents: [intent] })), {
      key: ORDER_REFUND_STORAGE_KEY, intent: { ownerId: `${tenantId}:user:${'d'.repeat(24)}`, orderId: id, operationId: operation().operationId, amountCents: 500, reason: 'Motif privé ancien auteur' },
    });
    await open(); await page.getByRole('alert').waitFor();
    expect(await page.getByText('Motif privé ancien auteur', { exact: true }).count()).toBe(0);
    expect(await page.getByLabel('Votre mot de passe').count()).toBe(0); expect(posts).toEqual([]);
  });
  it('does not clear the intent for a mismatching known server receipt', async () => {
    await page.evaluate(({ key, intent }) => localStorage.setItem(key, JSON.stringify({ version: 1, intents: [intent] })), {
      key: ORDER_REFUND_STORAGE_KEY, intent: { ownerId, orderId: id, operationId: operation().operationId, amountCents: 500, reason: operation().reason },
    });
    journal.operations = [operation({ state: 'known', providerStatus: 'succeeded', canResume: false, amountCents: 600 })];
    await open(); await page.getByRole('alert').waitFor(); expect(await local()).not.toBeNull();
    expect(await page.getByRole('button', { name: 'Préparer un nouveau remboursement', exact: true }).count()).toBe(0); expect(posts).toEqual([]);
  });
  it('refuses to send without the cross-tab lock', async () => {
    await open(); await fill(); await page.evaluate(() => Object.defineProperty(navigator, 'locks', { value: undefined }));
    await send(); await page.getByRole('alert').waitFor(); expect(posts).toEqual([]); expect(await local()).toBeNull();
  });
  it('settles a lost POST acknowledgement from the exact saved server operation', async () => {
    mode = 'ack-lost'; await open(); await fill(); await send();
    await page.getByText('En attente banque', { exact: true }).waitFor(); await settled();
    expect(posts).toHaveLength(1); expect(await local()).toBeNull();
    expect(await page.getByRole('alert').count()).toBe(0);
  });
  it('reloads an uncertain reserved operation and replays its exact UUID even when remaining is zero', async () => {
    mode = 'uncertain'; await open(); await fill(); await send(); await settled();
    await expect.poll(() => posts.length).toBe(1); const original = posts[0]!.body;
    expect(await local()).not.toContain('local-password-fixture');
    expect(await local()).not.toContain(token());
    await page.reload(); await open();
    expect(await page.getByLabel('Montant à rembourser (€)').inputValue()).toBe('5,00');
    expect(await page.getByLabel('Motif', { exact: true }).isDisabled()).toBe(true);
    expect(await page.getByLabel('Votre mot de passe').inputValue()).toBe('');
    mode = 'normal'; await page.getByLabel('Votre mot de passe').fill('local-password-fixture');
    await page.getByRole('button', { name: 'Reprendre le remboursement', exact: true }).click();
    await page.getByText('En attente banque', { exact: true }).waitFor(); await settled();
    expect(posts).toHaveLength(2); expect(posts[1]!.body).toEqual(original); expect(await local()).toBeNull();
  });
  it('allows close during POST and recovers the acknowledgement on reopening', async () => {
    mode = 'hold-post'; await open(); await fill(); await send(); await expect.poll(() => posts.length).toBe(1);
    expect(await local()).not.toBeNull();
    await page.getByRole('button', { name: 'Retour', exact: true }).click();
    held!(); held = undefined; await open();
    await page.getByText('En attente banque', { exact: true }).waitFor(); await settled();
    expect(posts).toHaveLength(1); expect(await local()).toBeNull();
  });
  it('prevents two tabs from preparing different UUIDs for the same order', async () => {
    const second = await context.newPage(); await second.goto(origin + '/admin/orders');
    await open(); await open(second); await fill(); await fill(second); mode = 'hold-post';
    await send(); await expect.poll(() => posts.length).toBe(1); await send(second);
    await second.getByRole('alert').waitFor(); expect(posts).toHaveLength(1);
    expect(JSON.parse((await local())!)).toEqual(JSON.parse((await local(second))!));
  });
  it('does not POST if persistent writes fail', async () => {
    await open(); await fill();
    await page.evaluate(() => { const original = Storage.prototype.setItem; Storage.prototype.setItem = function(key, value) { if (key.includes('refund')) throw new Error('Storage blocked'); return original.call(this, key, value); }; });
    await send(); await page.getByRole('alert').waitFor(); expect(posts).toEqual([]);
  });
  it('keeps a corrupt journal closed instead of treating it as empty', async () => {
    await page.evaluate(key => localStorage.setItem(key, '{broken'), ORDER_REFUND_STORAGE_KEY);
    await open(); await page.getByRole('alert').waitFor(); expect(posts).toEqual([]);
    expect(await local()).toBe('{broken');
  });
  it('drops the private view and refuses POST after identity changes during the final GET', async () => {
    await open(); await fill(); holdRead = true; await send(); await expect.poll(() => !!heldRead).toBe(true);
    await page.evaluate(value => { localStorage.setItem('sm.token.resto', value); window.dispatchEvent(new Event('storage')); }, token('d'.repeat(24)));
    heldRead!(); heldRead = undefined;
    await page.getByText('Votre session a changé. Fermez cette fenêtre et reconnectez-vous avant de reprendre.', { exact: true }).waitFor();
    expect(posts).toEqual([]); expect(await page.getByLabel('Votre mot de passe').count()).toBe(0);
    expect(await local()).not.toBeNull();
  });
  it('persists a pending server operation from another device before requesting the password', async () => {
    journal.operations = [operation()]; journal.summary.remainingCents = 0;
    await open(); await page.getByRole('button', { name: 'Reprendre cette demande', exact: true }).click();
    await page.getByLabel('Votre mot de passe').waitFor(); expect(await local()).toContain(operation().operationId); expect(posts).toEqual([]);
    await page.getByLabel('Votre mot de passe').fill('local-password-fixture'); await page.getByRole('button', { name: 'Reprendre le remboursement', exact: true }).click();
    await page.getByText('En attente banque', { exact: true }).waitFor();
    expect(posts[0]!.body).toMatchObject({ operationId: operation().operationId, amountCents: 500, reason: operation().reason });
  });
  it('shows another author’s unresolved server operation without a resume button', async () => {
    journal.operations = [operation({ canResume: false })]; await open();
    await page.getByText('Reprise indisponible ici : vérification nécessaire ou auteur différent.', { exact: true }).waitFor();
    expect(await page.getByRole('button', { name: 'Reprendre cette demande', exact: true }).count()).toBe(0);
    expect(await page.getByLabel('Votre mot de passe').count()).toBe(0); expect(posts).toEqual([]);
  });
  it('keeps the server journal and distinct bank statuses readable when writes are disabled', async () => {
    journal.enabled = false; journal.operations = [operation({ state: 'known', providerStatus: 'pending', canResume: false }), operation({ operationId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', state: 'known', providerStatus: 'failed', canResume: false })];
    await open(); await page.getByText('En attente banque', { exact: true }).waitFor(); await page.getByText('Échoué', { exact: true }).waitFor();
    expect(await page.getByRole('button', { name: 'Vérifier auprès de la banque', exact: true }).count()).toBe(0);
    expect(await page.getByLabel('Votre mot de passe').count()).toBe(0); expect(posts).toEqual([]);
    expect(reads.filter(path => path === base)).toEqual([]);
  });
  it('refreshes the durable journal after the optional bank read fails', async () => {
    await open(); bankFailure = true; journal.operations = [operation({ state: 'known', providerStatus: 'requires_action', canResume: false })];
    await page.getByRole('button', { name: 'Vérifier auprès de la banque', exact: true }).click();
    await page.getByText('À vérifier', { exact: true }).waitFor(); await page.getByRole('alert').waitFor();
    expect(posts).toEqual([]); expect(reads.at(-1)).toBe(base + '/journal');
  });
  it('withdraws an unsent durable intent through a server tombstone before allowing a new UUID', async () => {
    await open(); await fill(); holdRead = true; await send(); await expect.poll(() => !!heldRead).toBe(true);
    const saved = JSON.parse((await local())!);
    await page.getByRole('button', { name: 'Retour', exact: true }).click(); heldRead!(); heldRead = undefined;
    await open(); await page.getByLabel('Votre mot de passe').fill('local-password-fixture');
    await page.getByRole('button', { name: 'Abandonner cette demande', exact: true }).click();
    await page.getByText('Abandonné avant envoi', { exact: true }).waitFor(); await settled();
    expect(posts).toHaveLength(1); expect(posts[0]!.path).toBe(base + '/withdraw');
    expect(JSON.stringify(saved)).toContain(String(posts[0]!.body.operationId)); expect(await local()).toBeNull();
    expect(await page.getByRole('button', { name: 'Préparer un nouveau remboursement', exact: true }).isEnabled()).toBe(true);
  });
  it('does not start POST when the window closed during preflight, and retains the exact intent', async () => {
    await open(); await fill(); holdRead = true; await send(); await expect.poll(() => !!heldRead).toBe(true);
    const saved = await local(); await page.getByRole('button', { name: 'Retour', exact: true }).click(); heldRead!(); heldRead = undefined;
    await open(); await page.getByRole('button', { name: 'Reprendre le remboursement', exact: true }).waitFor();
    expect(posts).toEqual([]); expect(await local()).toBe(saved);
  });
});


describe('allocation durable des remboursements', () => {
  const split = { version: 1 as const, merchandiseCents: 800, deliveryCents: 200 };
  function delivery() { journal.allocation.basis = split; journal.allocation.remaining = split; journal.allocation.capacity = split; }
  function historical() {
    delivery(); journal.enabled = false; journal.allocation.remaining = null; journal.summary.refundedCents = 500; journal.summary.remainingCents = 500;
    journal.allocation.unallocated = [{ refundId: 're_history', amountCents: 500, providerStatus: 'succeeded', canAllocate: true }];
  }
  async function splitInputs(merchandise = '4,00', deliveryAmount = '1,00') {
    await page.getByRole('radio', { name: 'Répartir', exact: true }).check();
    await page.getByLabel('Part produits (€)', { exact: true }).fill(merchandise);
    await page.getByLabel('Part livraison (€)', { exact: true }).fill(deliveryAmount);
  }
  it('requires an explicit split for a mixed partial and enforces sum and per-item limits', async () => {
    delivery(); await open(); await fill();
    expect(await page.getByRole('button', { name: 'Confirmer le remboursement', exact: true }).isEnabled()).toBe(false);
    await splitInputs('2,00', '3,00');
    expect(await page.getByRole('button', { name: 'Confirmer le remboursement', exact: true }).isEnabled()).toBe(false);
    await page.getByLabel('Part livraison (€)', { exact: true }).fill('1,00');
    expect(await page.getByRole('button', { name: 'Confirmer le remboursement', exact: true }).isEnabled()).toBe(false);
    await page.getByLabel('Part produits (€)', { exact: true }).fill('4,00'); await send(); await settled();
    expect(posts[0]!.body.allocation).toEqual({ version: 1, merchandiseCents: 400, deliveryCents: 100 });
  });
  it('preserves split and UUID across lost ACK, close, reload and retry', async () => {
    delivery(); mode = 'uncertain'; await open(); await fill(); await splitInputs(); await send(); await settled();
    const first = posts[0]!.body;
    const stored = await local(); expect(stored).toContain('"merchandiseCents":400'); expect(stored).not.toContain('local-password-fixture');
    await page.reload(); await open();
    expect(await page.getByRole('radio').count()).toBe(0);
    await page.getByLabel('Votre mot de passe').fill('local-password-fixture'); mode = 'normal';
    await page.getByRole('button', { name: 'Reprendre le remboursement', exact: true }).click(); await settled();
    expect(posts).toHaveLength(2); expect(posts[1]!.body).toEqual(first); expect(await local()).toBeNull();
  });
  it('replays a legacy intent under protocol2 without manufacturing an allocation', async () => {
    const saved = { ownerId, orderId: id, operationId: operation().operationId, amountCents: 500, reason: operation().reason };
    await page.evaluate(({ key, saved }) => localStorage.setItem(key, JSON.stringify({ version: 1, intents: [saved] })), { key: ORDER_REFUND_STORAGE_KEY, saved });
    await open(); await page.getByLabel('Votre mot de passe').fill('local-password-fixture');
    await page.getByRole('button', { name: 'Reprendre le remboursement', exact: true }).click(); await settled();
    expect(posts[0]!.body).toMatchObject({ clientProtocolVersion: 2, operationId: saved.operationId, allocation: null });
    expect(await local()).toBeNull();
  });
  it('can allocate a known provider receipt while Stripe mutations are closed, without refund POST', async () => {
    historical(); await open(); await page.getByRole('button', { name: 'Préciser la répartition', exact: true }).click();
    await splitInputs(); await page.getByLabel('Motif de la répartition').fill('Produits et livraison');
    await page.getByLabel('Votre mot de passe').fill('local-password-fixture');
    await page.getByRole('button', { name: 'Confirmer la répartition', exact: true }).click(); await settled();
    expect(posts).toHaveLength(1); expect(posts[0]!.path).toBe(base + '/re_history/allocation');
    expect(posts[0]!.body.allocation).toEqual({ version: 1, merchandiseCents: 400, deliveryCents: 100 });
    expect(await local()).toBeNull(); expect(reads.filter(path => path === base)).toEqual([]);
    await page.getByRole('region', { name: 'Répartitions enregistrées' }).waitFor();
  });
  it('keeps historical allocation body across unavailable journal and reload, then acknowledges without duplicate POST', async () => {
    historical(); mode = 'ack-lost'; loseJournalAfterPost = true;
    await open(); await page.getByRole('button', { name: 'Préciser la répartition', exact: true }).click(); await splitInputs();
    await page.getByLabel('Motif de la répartition').fill('Produits et livraison'); await page.getByLabel('Votre mot de passe').fill('local-password-fixture');
    await page.getByRole('button', { name: 'Confirmer la répartition', exact: true }).click(); await settled();
    expect(await local()).toContain('"kind":"allocation"'); expect(posts).toHaveLength(1);
    journalUnavailable = false; await page.reload(); await open();
    expect(await local()).toBeNull(); expect(posts).toHaveLength(1);
    await page.getByRole('region', { name: 'Répartitions enregistrées' }).waitFor();
  });
  it('retries an unobserved historical allocation with the exact same UUID and split after reload', async () => {
    historical(); mode = 'uncertain'; await open(); await page.getByRole('button', { name: 'Préciser la répartition', exact: true }).click(); await splitInputs();
    await page.getByLabel('Motif de la répartition').fill('Produits et livraison'); await page.getByLabel('Votre mot de passe').fill('local-password-fixture');
    await page.getByRole('button', { name: 'Confirmer la répartition', exact: true }).click(); await settled();
    const first = posts[0]!.body; expect(await local()).toContain(first.operationId as string);
    await page.reload(); await open(); expect(await page.getByRole('radio').count()).toBe(0);
    await page.getByLabel('Votre mot de passe').fill('local-password-fixture'); mode = 'normal';
    await page.getByRole('button', { name: 'Reprendre la répartition', exact: true }).click(); await settled();
    expect(posts).toHaveLength(2); expect(posts[1]!.body).toEqual(first); expect(await local()).toBeNull();
  });
  it('does not accept another historical allocation as the acknowledgement of its pending intent', async () => {
    historical(); mode = 'uncertain'; await open(); await page.getByRole('button', { name: 'Préciser la répartition', exact: true }).click(); await splitInputs();
    await page.getByLabel('Motif de la répartition').fill('Produits et livraison'); await page.getByLabel('Votre mot de passe').fill('local-password-fixture');
    await page.getByRole('button', { name: 'Confirmer la répartition', exact: true }).click(); await settled();
    const saved = await local();
    journal.allocations.push({ operationId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', refundId: 're_history', allocation: { version: 1, merchandiseCents: 500, deliveryCents: 0 }, reason: 'Autre opérateur', state: 'recorded' as const, recordedAt: '2026-09-21T11:00:00.000Z' }); journal.allocation.unallocated = [];
    await page.reload(); await open();
    expect(await local()).toBe(saved); expect(await page.getByRole('button', { name: 'Reprendre la répartition', exact: true }).isEnabled()).toBe(false);
    expect(posts).toHaveLength(1);
    await page.getByRole('button', { name: 'Fermer cette demande', exact: true }).click(); await settled();
    expect(await local()).toBeNull(); expect(posts).toHaveLength(1); expect(journal.allocations[0]!.reason).toBe('Autre opérateur');
  });
  it('keeps a late losing POST rejected after explicit closure from another immutable receipt', async () => {
    historical(); mode = 'hold-post'; await open(); await page.getByRole('button', { name: 'Préciser la répartition', exact: true }).click(); await splitInputs();
    await page.getByLabel('Motif de la répartition').fill('Produits et livraison'); await page.getByLabel('Votre mot de passe').fill('local-password-fixture');
    await page.getByRole('button', { name: 'Confirmer la répartition', exact: true }).click(); await expect.poll(() => !!held).toBe(true);
    await page.getByRole('button', { name: 'Retour', exact: true }).click();
    const winner = { operationId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', refundId: 're_history', allocation: { version: 1 as const, merchandiseCents: 500, deliveryCents: 0 }, reason: 'Autre opérateur', state: 'recorded' as const, recordedAt: '2026-09-21T11:00:00.000Z' };
    journal.allocations = [winner]; journal.allocation.unallocated = []; await open();
    await page.getByRole('button', { name: 'Fermer cette demande', exact: true }).click(); await settled(); expect(await local()).toBeNull();
    const rejection = page.waitForResponse(response => response.url().endsWith('/allocation') && response.status() === 409);
    held!(); held = undefined; await rejection;
    expect(journal.allocations).toEqual([winner]); expect(posts).toHaveLength(1); expect(await local()).toBeNull();
  });
  it('does not send a historical allocation when closed during the final read', async () => {
    historical(); await open(); await page.getByRole('button', { name: 'Préciser la répartition', exact: true }).click(); await splitInputs();
    await page.getByLabel('Motif de la répartition').fill('Produits et livraison'); await page.getByLabel('Votre mot de passe').fill('local-password-fixture');
    holdRead = true; await page.getByRole('button', { name: 'Confirmer la répartition', exact: true }).click(); await expect.poll(() => !!heldRead).toBe(true);
    await page.getByRole('button', { name: 'Retour', exact: true }).click(); heldRead!(); heldRead = undefined;
    await open(); expect(posts).toEqual([]); expect(await local()).toContain('"kind":"allocation"');
  });
  it.each([320, 390, 1440])('keeps the explicit allocation usable at %ipx', async width => {
    await page.setViewportSize({ width, height: width === 320 ? 568 : 900 });
    delivery(); await open(); await fill(); await splitInputs();
    const controls = await page.getByRole('dialog').evaluate(dialog => [...dialog.querySelectorAll('button,input')].map(element => {
      const bounds = element.getBoundingClientRect(); return { tag: element.tagName, left: bounds.left, right: bounds.right };
    }));
    expect(controls.every(control => control.left >= 0 && control.right <= width), JSON.stringify(controls)).toBe(true);
    await page.getByRole('radio', { name: 'Répartir', exact: true }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: join(captures, `${width}-allocation-partial.png`) });
    await page.getByRole('button', { name: 'Retour', exact: true }).click(); historical(); await open();
    await page.getByRole('button', { name: 'Préciser la répartition', exact: true }).click(); await splitInputs();
    await page.getByRole('radio', { name: 'Répartir', exact: true }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: join(captures, `${width}-allocation-historical.png`) });
    expect(posts).toEqual([]);
  });
  it('abandons an impossible saved allocation with exact body and a durable withdrawn receipt', async () => {
    historical(); mode = 'uncertain'; await open(); await page.getByRole('button', { name: 'Préciser la répartition', exact: true }).click(); await splitInputs();
    await page.getByLabel('Motif de la répartition').fill('Produits et livraison'); await page.getByLabel('Votre mot de passe').fill('local-password-fixture');
    await page.getByRole('button', { name: 'Confirmer la répartition', exact: true }).click(); await settled(); const first = posts[0]!.body;
    journal.allocation.unallocated[0]!.canAllocate = false; journal.allocation.capacity = { version: 1, merchandiseCents: 500, deliveryCents: 0 };
    await page.reload(); await open(); await page.getByLabel('Votre mot de passe').fill('local-password-fixture'); mode = 'normal';
    await page.getByRole('button', { name: 'Abandonner cette répartition', exact: true }).click(); await settled();
    expect(posts[1]!.path).toBe(base + '/re_history/allocation/withdraw'); expect(posts[1]!.body).toEqual(first);
    expect(journal.allocations[0]!.state).toBe('withdrawn'); expect(await local()).toBeNull();
    await page.getByText('La répartition a été abandonnée.', { exact: false }).waitFor();
  });
  it('does not apply an allocation POST arriving after its withdrawal', async () => {
    historical(); mode = 'hold-post'; await open(); await page.getByRole('button', { name: 'Préciser la répartition', exact: true }).click(); await splitInputs();
    await page.getByLabel('Motif de la répartition').fill('Produits et livraison'); await page.getByLabel('Votre mot de passe').fill('local-password-fixture');
    await page.getByRole('button', { name: 'Confirmer la répartition', exact: true }).click(); await expect.poll(() => !!held).toBe(true);
    await page.getByRole('button', { name: 'Retour', exact: true }).click(); await open(); mode = 'normal';
    await page.getByLabel('Votre mot de passe').fill('local-password-fixture'); await page.getByRole('button', { name: 'Abandonner cette répartition', exact: true }).click(); await settled();
    const late = page.waitForResponse(response => response.url().endsWith('/allocation') && response.status() === 200); held!(); held = undefined; await late;
    expect(posts).toHaveLength(2); expect(journal.allocations).toHaveLength(1); expect(journal.allocations[0]!.state).toBe('withdrawn'); expect(await local()).toBeNull();
  });
  it('blocks a historical mutation after identity changes during preflight', async () => {
    historical(); await open(); await page.getByRole('button', { name: 'Préciser la répartition', exact: true }).click(); await splitInputs();
    await page.getByLabel('Motif de la répartition').fill('Produits et livraison'); await page.getByLabel('Votre mot de passe').fill('local-password-fixture');
    holdRead = true; await page.getByRole('button', { name: 'Confirmer la répartition', exact: true }).click();
    await expect.poll(() => !!heldRead).toBe(true);
    await page.evaluate(value => localStorage.setItem('sm.token.resto', value), token('d'.repeat(24))); heldRead!(); heldRead = undefined;
    await settled(); expect(posts).toEqual([]); expect(await local()).toContain('"kind":"allocation"');
  });
});
