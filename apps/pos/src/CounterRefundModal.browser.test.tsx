import { createServer, type Server, type ServerResponse } from 'node:http';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { CounterRefundJournal, CounterRefundOperationView } from '@sm/contracts';

const orderId = 'd'.repeat(24), ownerId = `${'a'.repeat(24)}:user:${'b'.repeat(24)}`;
const ELAPSED_PERMISSION_TEST = 'expires permission using elapsed time and never extends it using the device wall clock';
let server: Server, browser: Browser, context: BrowserContext, page: Page, origin: string, js: string, captures: string;
let operations: CounterRefundOperationView[], writes: { step: string; body: Record<string, unknown> }[], faults: string[];
let lostStart: boolean, lostConfirm: boolean, holdStart: boolean, heldStart: { res: ServerResponse; value: unknown } | null;
let historyReads: number, historyTruncated: boolean, enabled: boolean;
const json = (res: ServerResponse, body: unknown, status = 200) => { res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' }).end(JSON.stringify(body)); };
function journal(): CounterRefundJournal {
  const refunded = operations.filter(op => op.state === 'confirmed').reduce((sum, op) => sum + op.amountCents, 0);
  const pending = operations.filter(op => ['prepared', 'started'].includes(op.state)).reduce((sum, op) => sum + op.amountCents, 0);
  const reserved = operations.filter(op => ['prepared', 'started', 'confirmed'].includes(op.state));
  return { orderId, enabled, available: true, unavailableReason: null, observedAt: new Date().toISOString(), tender: 'cash',
    originalPaidCents: 500, refundedCents: refunded, pendingRefundCents: pending, remainingCents: 500 - refunded - pending,
    basis: { merchandiseCents: 400, deliveryCents: 100 }, remaining: {
      merchandiseCents: 400 - reserved.reduce((sum, op) => sum + op.allocation.merchandiseCents, 0),
      deliveryCents: 100 - reserved.reduce((sum, op) => sum + op.allocation.deliveryCents, 0) }, canResolveNoEffect: true, operations: structuredClone(operations) };
}
beforeAll(async () => {
  captures = await mkdtemp(join(tmpdir(), 'sm-counter-refund-'));
  const root = fileURLToPath(new URL('.', import.meta.url).href);
  const bundle = await build({ stdin: { loader: 'tsx', resolveDir: root, contents: `
    import React from 'react';import {createRoot} from 'react-dom/client';
    import {webStore} from '@sm/client-core';import{CounterRefundModal,CounterRefundRecoveries}from'./CounterRefundModal';import{counterRefundHttp}from'./counter-refund';
    import{CounterRefundHistory}from'./CounterRefundHistory';import{reconcileCounterRefundSummary}from'./journal-refunds';import{zFromJournal}from'./pos-state';import{ThemeProvider,makeBrand}from'./theme';
    const store=webStore();const api={tenantStore:store};const request=counterRefundHttp(location.origin,'fixture');
    const initialEntry={clientId:'fixture',localNumber:1,serverId:'${orderId}',serverNumber:51,mode:'emporter',method:'especes',paid:true,total:500,items:1,at:1};
    function App(){const[entries,setEntries]=React.useState(()=>JSON.parse(localStorage.getItem('fixture-day')||JSON.stringify([initialEntry])));
      const observed=React.useCallback(view=>setEntries(current=>{const next=reconcileCounterRefundSummary(current,view);localStorage.setItem('fixture-day',JSON.stringify(next));return next}),[]);const[id,setId]=React.useState(location.search.includes('closed')?null:'${orderId}');const[revision,bump]=React.useState(0);const[cycle,setCycle]=React.useState(0);
      const access=React.useMemo(()=>({client:api,request,ownerId:'${ownerId}',role:'owner',sessionKey:String(cycle),onSessionExpired:()=>setCycle(x=>x+1)}),[cycle]);
      window.refundFixture={swap:()=>{setCycle(x=>x+1);setId(null)},store};
      return <ThemeProvider><output aria-label="Journal local" style={{display:"none"}}>{JSON.stringify(zFromJournal(entries))}</output><button onClick={()=>setId('${orderId}')}>Ouvrir le remboursement</button>
        <CounterRefundRecoveries access={access} revision={revision} onSelect={setId}/><CounterRefundHistory access={access} offline={false} onSelect={setId}/>
        {id&&<CounterRefundModal key={cycle+':'+id} orderId={id} access={access} offline={false} brand={makeBrand('Recette','#a46d20',null)} onClose={()=>setId(null)} onJournal={observed} onChanged={()=>bump(x=>x+1)}/>}</ThemeProvider>}
    createRoot(document.getElementById('root')).render(<App/>);` }, bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic', target: 'es2022',
    alias: { 'react-native': 'react-native-web' }, define: { 'process.env.NODE_ENV': '"production"', '__DEV__': 'false' },
    plugins: [{ name: 'decorative-native-fixtures', setup(builder) {
      // Financial hooks, transport, store, modal, focus and native controls are
      // real. Only station preferences and decorative glyphs are isolated.
      builder.onResolve({ filter: /^\.\/usePrefs$/ }, () => ({ path: 'prefs', namespace: 'fixture' }));
      builder.onResolve({ filter: /^\.\/Icon$/ }, () => ({ path: 'icons', namespace: 'fixture' }));
      builder.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ loader: 'tsx', resolveDir: root, contents: args.path === 'prefs'
        ? `import{DEFAULT_PREFS}from'./prefs';export const usePrefs=()=>({prefs:{...DEFAULT_PREFS,reduceMotion:true},ready:true});`
        : `export function Icon(){return null}` }));
    } }],
  }); js = bundle.outputFiles[0]!.text;
  server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', origin), path = url.pathname;
    if (path === '/') { res.setHeader('content-type', 'text/html'); res.end('<!doctype html><html lang="fr"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><body style="margin:0"><div id="root"></div><script src="/app.js"></script></body></html>'); return; }
    if (path === '/app.js') { res.setHeader('content-type', 'text/javascript'); res.end(js); return; }
    if (path === '/favicon.ico') { res.writeHead(204).end(); return; }
    if (path === '/orders' && req.method === 'GET' && url.search === '?status=delivered') {
      historyReads++; json(res, { rows: [{ _id: orderId, number: 51, status: 'delivered', payment: { method: 'counter', status: 'paid', tender: 'cash' }, totals: { total: 500 } }], total: historyTruncated ? 201 : 1, truncated: historyTruncated }); return;
    }
    if (path === `/orders/${orderId}/counter-refunds/journal` && req.method === 'GET') { json(res, journal()); return; }
    if (!path.startsWith(`/orders/${orderId}/counter-refunds/`) || req.method !== 'POST') { faults.push(`Unexpected ${req.method} ${path}`); json(res, {}, 404); return; }
    let raw = ''; for await (const part of req) raw += part.toString(); const body = JSON.parse(raw) as Record<string, unknown>;
    const step = path.split('/').at(-1)!; writes.push({ step, body });
    if (body.clientProtocolVersion !== 1 || JSON.stringify(body.authorization) !== JSON.stringify({ kind: 'owner_password', password: 'fixture-password' })) { json(res, {}, 403); return; }
    if (!enabled && ['prepare', 'start'].includes(step)) { json(res, {}, 409); return; }
    let operation = operations.find(op => op.operationId === body.operationId), mayDisburse = false;
    if (step === 'prepare' && !operation) {
      const { clientProtocolVersion: _version, authorization: _auth, ...intent } = body;
      operation = { ...intent, state: 'prepared', preparedAt: new Date().toISOString(), startedAt: null, confirmedAt: null, resolvedAt: null,
        disburseExpiresAt: null, resolutionReason: null, canResume: true } as CounterRefundOperationView; operations.push(operation);
    }
    if (!operation) { json(res, {}, 409); return; }
    if (step === 'start' && operation.state === 'prepared') { operation.state = 'started'; operation.startedAt = new Date().toISOString(); operation.disburseExpiresAt = new Date(Date.now() + 300_000).toISOString(); mayDisburse = true; }
    if (step === 'confirm' && operation.state === 'started') { if (body.attestation !== 'cash_returned') { json(res, {}, 400); return; } operation.state = 'confirmed'; operation.confirmedAt = new Date().toISOString(); operation.canResume = false; }
    if (step === 'withdraw' && operation.state === 'prepared') { operation.state = 'withdrawn'; operation.resolvedAt = new Date().toISOString(); operation.canResume = false; }
    if (step === 'no-effect' && operation.state === 'started') { operation.state = 'not_executed'; operation.resolvedAt = new Date().toISOString(); operation.resolutionReason = String(body.resolutionReason); operation.canResume = false; }
    const value = { journal: journal(), mayDisburse };
    if (step === 'start' && holdStart) { heldStart = { res, value }; return; }
    if (step === 'start' && lostStart || step === 'confirm' && lostConfirm) { json(res, { message: 'Réponse non confirmée.' }, 503); return; }
    json(res, value);
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve)); const address = server.address();
  if (!address || typeof address === 'string') throw Error('Fixture address missing'); origin = `http://127.0.0.1:${address.port}`;
  browser = await chromium.launch({ headless: true });
}, 30_000);
beforeEach(async ({ task }) => {
  operations = []; writes = []; faults = []; lostStart = false; lostConfirm = false; holdStart = false; heldStart = null; historyReads = 0; historyTruncated = false; enabled = true;
  context = await browser.newContext({ viewport: { width: 390, height: 900 }, reducedMotion: 'reduce', serviceWorkers: 'block' });
  await context.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : (faults.push('External request refused'), route.abort()));
  page = await context.newPage(); page.setDefaultTimeout(5_000); page.on('pageerror', error => faults.push(error.message));
  // Clock must own the timer APIs before React/RN mounts, not after native
  // timers have already been scheduled (https://playwright.dev/docs/clock).
  if (task.name === ELAPSED_PERMISSION_TEST) await page.clock.install();
  await page.goto(origin); await page.getByText('Disponible : 5,00 €', { exact: true }).waitFor();
});
afterEach(async () => { heldStart?.res.destroy(); await context.close(); expect(faults).toEqual([]); });
afterAll(async () => {
  const started = performance.now();
  const mark = (phase: string) => process.stdout.write(`Counter refund cleanup: ${phase} (${Math.round(performance.now() - started)}ms)\n`);
  try {
    if (server) {
      mark('http closing');
      // Stop accepting first, then close sockets: a new keep-alive connection
      // must not enter between closeAllConnections and close.
      await new Promise<void>((resolve, reject) => {
        server.close(error => error ? reject(error) : resolve()); server.closeAllConnections();
      });
      mark('http closed');
      expect(server.listening).toBe(false);
    }
  } finally {
    if (browser) {
      mark(`browser closing; contexts=${browser.contexts().length}`);
      const disconnected = new Promise<void>(resolve => { if (!browser.isConnected()) resolve(); else browser.once('disconnected', () => resolve()); });
      await browser.close(); await disconnected;
      expect(browser.isConnected()).toBe(false);
      mark('browser disconnected');
    }
  }
  process.stdout.write(`Counter refund captures: ${captures}\n`);
});
const password = () => page.getByLabel('Mot de passe du propriétaire', { exact: true }).fill('fixture-password');
async function prepare() {
  await page.getByLabel('Part produits (€)', { exact: true }).fill('1'); await page.getByLabel('Part livraison (€)', { exact: true }).fill('0,50');
  await page.getByLabel('Motif du remboursement', { exact: true }).fill('Article manquant'); await password();
  await page.getByRole('button', { name: 'Préparer le remboursement', exact: true }).click();
  await page.getByRole('button', { name: 'Autoriser le geste de remboursement', exact: true }).waitFor();
}
async function start() { await password(); await page.getByRole('button', { name: 'Autoriser le geste de remboursement', exact: true }).click(); }
async function stored() { return page.evaluate(() => localStorage.getItem('sm.counter-refunds.v1')); }
describe('counter refund POS — native controls, real HTTP and durable browser store', () => {
  it('prepares without a physical right, authorizes once, then recovers a lost confirmation after reload without repeating cash', async () => {
    await prepare(); expect(writes.map(w => w.step)).toEqual(['prepare']); const id = writes[0]!.body.operationId;
    const summary = async () => JSON.parse(await page.getByLabel('Journal local', { exact: true }).textContent() ?? '{}');
    expect(await summary()).toMatchObject({ collected: 500, refunded: 0, netCollected: 500 });
    expect(await page.getByText('Rendez une seule fois', { exact: false }).count()).toBe(0);
    await start(); await page.getByText('Rendez une seule fois 1,50 €', { exact: false }).waitFor();
    expect(await stored()).not.toMatch(/fixture-password|authorization|mayDisburse|password/);
    lostConfirm = true; await password(); await page.getByRole('checkbox', { name: 'Le remboursement a bien été effectué', exact: true }).click();
    await page.getByRole('button', { name: 'Enregistrer le remboursement effectué', exact: true }).click();
    await page.getByText('Réponse non confirmée.', { exact: true }).waitFor();
    expect(await summary()).toMatchObject({ refunded: 0, netCollected: 500 });
    await page.goto(origin + '/?closed'); await page.getByRole('button', { name: 'Reprendre le remboursement de 1,50 €', exact: true }).click();
    await page.getByText('1,50 € · Remboursement attesté · Article manquant', { exact: true }).waitFor();
    await expect.poll(stored).toBeNull(); await expect.poll(summary).toMatchObject({ collected: 500, refunded: 150, netCollected: 350 });
    expect(writes.map(w => w.step)).toEqual(['prepare', 'start', 'confirm']);
    expect(writes.every(w => w.body.operationId === id)).toBe(true);
    expect(await page.getByText('Rendez une seule fois', { exact: false }).count()).toBe(0);
  });
  it('never restores a permission from GET or a lost start, and confirms only the already performed gesture', async () => {
    await prepare(); lostStart = true; await start(); await page.getByText('Réponse non confirmée.', { exact: true }).waitFor();
    await page.reload(); await page.getByText('Un remboursement a été autorisé.', { exact: false }).waitFor();
    expect(await page.getByText('Rendez une seule fois', { exact: false }).count()).toBe(0);
    expect(writes.filter(w => w.step === 'start')).toHaveLength(1);
    await password(); expect(await page.getByRole('button', { name: 'Enregistrer le remboursement effectué' }).isEnabled()).toBe(false);
    await page.getByRole('checkbox', { name: 'Le remboursement a bien été effectué', exact: true }).click();
    await page.getByRole('button', { name: 'Enregistrer le remboursement effectué', exact: true }).click();
    await page.getByText('Le remboursement attesté est enregistré.', { exact: true }).waitFor();
    expect(writes.filter(w => w.step === 'start')).toHaveLength(1); await expect.poll(stored).toBeNull();
  });
  it('ignores a delayed start response after session replacement and keeps its durable uncertainty', async () => {
    await prepare(); holdStart = true; await start(); await expect.poll(() => !!heldStart).toBe(true);
    await page.evaluate(() => (window as unknown as { refundFixture: { swap(): void } }).refundFixture.swap());
    json(heldStart!.res, heldStart!.value); heldStart = null;
    expect(await page.getByText('Rendez une seule fois', { exact: false }).count()).toBe(0);
    expect(await stored()).toContain('start_requested');
    await page.getByRole('button', { name: 'Ouvrir le remboursement', exact: true }).click();
    await page.getByText('Un remboursement a été autorisé.', { exact: false }).waitFor(); expect(writes.filter(w => w.step === 'start')).toHaveLength(1);
  });
  it('removes permission on offline without renewing it on reconnect', async () => {
    await prepare(); await start(); await page.getByText('Rendez une seule fois', { exact: false }).waitFor();
    await page.evaluate(() => { Object.defineProperty(navigator, 'onLine', { value: false, configurable: true }); window.dispatchEvent(new Event('offline')); });
    await page.getByText('Hors connexion', { exact: false }).waitFor(); expect(await page.getByText('Rendez une seule fois', { exact: false }).count()).toBe(0);
    await page.evaluate(() => { Object.defineProperty(navigator, 'onLine', { value: true, configurable: true }); window.dispatchEvent(new Event('online')); });
    expect(await page.getByText('Rendez une seule fois', { exact: false }).count()).toBe(0); expect(writes.filter(w => w.step === 'start')).toHaveLength(1);
  });
  it(ELAPSED_PERMISSION_TEST, async () => {
    const started = performance.now();
    const mark = (phase: string) => process.stdout.write(`Counter refund elapsed clock: ${phase} (${Math.round(performance.now() - started)}ms)\n`);
    const permission = page.getByText('Rendez une seule fois', { exact: false });
    try {
      mark('prepare begin'); await prepare(); mark('prepared');
      await start(); mark('start sent'); await permission.waitFor(); mark('permission rendered');
      const before = await page.evaluate(() => ({ wall: Date.now(), elapsed: performance.now() }));
      await page.clock.setSystemTime(new Date(before.wall - 86_400_000));
      const shifted = await page.evaluate(() => ({ wall: Date.now(), elapsed: performance.now() }));
      expect(shifted.wall).toBeLessThan(before.wall - 86_000_000);
      expect(shifted.elapsed).toBeGreaterThanOrEqual(before.elapsed);
      expect(shifted.elapsed - before.elapsed).toBeLessThan(300_000);
      expect(await permission.count()).toBe(1); mark('wall clock moved back; permission retained');
      await page.clock.fastForward(300_001); mark('elapsed time advanced');
      expect(await page.evaluate(() => performance.now())).toBeGreaterThanOrEqual(shifted.elapsed + 300_001);
      await expect.poll(() => permission.count()).toBe(0); mark('permission expired');
      expect(writes.map(write => write.step)).toEqual(['prepare', 'start']);
      expect(writes[1]!.body.operationId).toBe(writes[0]!.body.operationId);
    } finally { mark('scenario finished'); }
    // Several real HTTP/UI handshakes run before advancing virtual time. Keep
    // the per-action 5s bounds, with a separate 10s budget for the whole flow.
  }, 10_000);
  it('refuses preparation when durable storage cannot commit, before any financial POST', async () => {
    await page.getByLabel('Part produits (€)', { exact: true }).fill('1'); await page.getByLabel('Motif du remboursement', { exact: true }).fill('Article manquant'); await password();
    await page.evaluate(() => { const save = Storage.prototype.setItem; Storage.prototype.setItem = function(key, value) {
      if (key === 'sm.counter-refunds.v1') throw new DOMException('Stockage refusé', 'QuotaExceededError'); save.call(this, key, value);
    }; });
    await page.getByRole('button', { name: 'Préparer le remboursement', exact: true }).click();
    await page.getByText('Stockage refusé', { exact: true }).waitFor(); expect(writes).toEqual([]); expect(await stored()).toBeNull();
  });
  it('records an owner no-effect decision separately with no new physical right', async () => {
    await prepare(); lostStart = true; await start(); await page.getByText('Réponse non confirmée.', { exact: true }).waitFor();
    operations[0]!.preparedAt = new Date(Date.now() - 700_000).toISOString(); operations[0]!.startedAt = new Date(Date.now() - 600_000).toISOString();
    operations[0]!.disburseExpiresAt = new Date(Date.parse(operations[0]!.startedAt!) + 300_000).toISOString();
    await page.reload(); await page.getByRole('button', { name: 'Examiner l’absence de remboursement de 1,50 €', exact: true }).click();
    await page.getByLabel('Motif de la décision', { exact: true }).fill('Aucun geste effectué'); await password();
    await page.getByRole('checkbox', { name: 'Aucune somme rendue et aucun remboursement TPE en cours', exact: true }).click();
    await page.getByRole('button', { name: 'Confirmer qu’aucun remboursement n’a eu lieu', exact: true }).click();
    await page.getByText('L’absence de remboursement est enregistrée par le propriétaire.', { exact: true }).waitFor();
    expect(writes.map(w => w.step)).toEqual(['prepare', 'start', 'no-effect']);
    expect(writes[2]!.body).toMatchObject({ operationId: writes[0]!.body.operationId, attestation: 'no_money_returned', resolutionReason: 'Aucun geste effectué' });
    await expect.poll(stored).toBeNull();
  });
  it.each(['prepared', 'started'] as const)('explicitly adopts the same author’s server %s into an empty device journal before recovery', async state => {
    await prepare(); if (state === 'started') { await start(); await page.getByText('Rendez une seule fois', { exact: false }).waitFor(); }
    const id = writes[0]!.body.operationId; enabled = false;
    // A new origin-local journal has no stored intent; the scoped server
    // operation remains the only source of identity and current phase.
    await page.evaluate(() => localStorage.removeItem('sm.counter-refunds.v1')); await page.reload();
    await page.getByRole('button', { name: 'Reprendre la demande enregistrée de 1,50 €', exact: true }).click();
    await expect.poll(stored).toContain(state === 'started' ? 'start_requested' : 'prepared');
    expect(await stored()).toContain(String(id)); expect(await stored()).not.toMatch(/mayDisburse|password|authorization/);
    expect(await page.getByText('Rendez une seule fois', { exact: false }).count()).toBe(0);
    expect(writes).toHaveLength(state === 'started' ? 2 : 1);
    await password();
    if (state === 'started') await page.getByRole('checkbox', { name: 'Le remboursement a bien été effectué', exact: true }).click();
    await page.getByRole('button', { name: state === 'started' ? 'Enregistrer le remboursement effectué' : 'Fermer la demande sans rembourser', exact: true }).click();
    await expect.poll(stored).toBeNull(); expect(writes.at(-1)!.body.operationId).toBe(id);
    expect(writes.filter(write => write.step === 'start')).toHaveLength(state === 'started' ? 1 : 0);
  });
  it.each(['confirm', 'withdraw', 'no-effect'] as const)('keeps %s recovery available when new refunds are closed', async step => {
    await prepare(); if (step !== 'withdraw') { await start(); await page.getByText('Rendez une seule fois', { exact: false }).waitFor(); } enabled = false;
    if (step === 'no-effect') {
      operations[0]!.preparedAt = new Date(Date.now() - 700_000).toISOString(); operations[0]!.startedAt = new Date(Date.now() - 600_000).toISOString();
      operations[0]!.disburseExpiresAt = new Date(Date.parse(operations[0]!.startedAt!) + 300_000).toISOString();
    }
    await page.reload(); await page.getByText('Les nouveaux remboursements comptoir ne sont pas ouverts.', { exact: false }).waitFor();
    if (step === 'withdraw') expect(await page.getByRole('button', { name: 'Autoriser le geste de remboursement', exact: true }).isDisabled()).toBe(true);
    if (step === 'no-effect') {
      await page.getByRole('button', { name: 'Examiner l’absence de remboursement de 1,50 €', exact: true }).click();
      await page.getByLabel('Motif de la décision', { exact: true }).fill('Aucun geste effectué');
      await page.getByRole('checkbox', { name: 'Aucune somme rendue et aucun remboursement TPE en cours', exact: true }).click();
    } else if (step === 'confirm') await page.getByRole('checkbox', { name: 'Le remboursement a bien été effectué', exact: true }).click();
    await password(); await page.getByRole('button', { name: step === 'confirm' ? 'Enregistrer le remboursement effectué' : step === 'withdraw'
      ? 'Fermer la demande sans rembourser' : 'Confirmer qu’aucun remboursement n’a eu lieu', exact: true }).click();
    await expect.poll(stored).toBeNull(); expect(writes.at(-1)!.step).toBe(step);
    expect(writes.filter(write => write.step === 'start')).toHaveLength(step === 'withdraw' ? 0 : 1);
    expect(await page.getByText('Rendez une seule fois', { exact: false }).count()).toBe(0);
  });
  it.each([320, 390, 1440])('keeps prepared request and authorization readable at %spx', async width => {
    await page.setViewportSize({ width, height: 1000 });
    // Mount at the target size; crossing the native Modal breakpoint while
    // filling fields tests an unrelated surface replacement, not this layout.
    await page.reload(); await page.getByText('Disponible : 5,00 €', { exact: true }).waitFor(); await prepare();
    const dialog = page.getByRole('dialog', { name: 'Remboursement comptoir', exact: true });
    expect(await dialog.count()).toBe(1); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: join(captures, `counter-prepared-${width}.png`), animations: 'disabled' });
  });
  it('loads the bounded server history explicitly and reports truncation before selecting a handed-over order', async () => {
    await page.goto(origin + '/?closed'); historyTruncated = true; expect(historyReads).toBe(0);
    await page.getByRole('button', { name: 'Commandes remises', exact: true }).click();
    await page.getByText('Historique incomplet', { exact: false }).waitFor(); expect(historyReads).toBe(1);
    await page.getByRole('button', { name: 'Remboursement comptoir de la commande 51', exact: true }).click();
    await page.getByText('Disponible : 5,00 €', { exact: true }).waitFor(); expect(writes).toEqual([]);
  });
});
