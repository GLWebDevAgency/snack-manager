/**
 * Real POS components rendered with ReactNativeWeb + esbuild, NOT an Expo build.
 * All API traffic is intercepted fixtures. Real Web Locks and localStorage.
 * No remote writes, accounts, Stripe, SMS, database, or persistent dev server.
 */
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';
const root = fileURLToPath(new URL('../../', import.meta.url));
const require = createRequire(join(root, 'package.json'));
const build = options => require('esbuild').build({
    ...options,
    absWorkingDir: root,
    define: { ...options.define, global: 'globalThis', 'process.env': '{}' },
    loader: { '.png': 'dataurl' },
    // One React instance, including ReactNativeWeb's imports.
    alias: { ...options.alias, react: join(root, 'node_modules/react'), 'react-dom': join(root, 'node_modules/react-dom') },
});
const { chromium } = require('playwright');
const artifacts = await mkdtemp(join(tmpdir(), 'sm-pos-phone-'));
console.log(`Artifacts: ${artifacts}`);
const bundled = await build({ stdin: { contents: `import React from 'react';import{createRoot}from'react-dom/client';import App from '${root}/apps/pos/App.tsx';createRoot(document.getElementById('root')).render(React.createElement(App));`, resolveDir: root, loader: 'tsx' }, write: false, bundle: true, format: 'iife', platform: 'browser', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"', 'process.env.EXPO_PUBLIC_API_URL': '"http://localhost:3001"', 'process.env.EXPO_PUBLIC_ALLOW_LOCAL_API': '"1"', 'process.env.EXPO_PUBLIC_SITE_URL': '"http://localhost:3000"', '__DEV__': 'false' }, alias: { 'react-native': 'react-native-web' }, plugins: [{ name: 'native-only', setup(b) { b.onResolve({ filter: /^(expo-status-bar|expo-keep-awake|@react-native-async-storage\/async-storage)$/ }, a => ({ path: a.path, namespace: 'native-only' })); b.onLoad({ filter: /.*/, namespace: 'native-only' }, () => ({ contents: 'export const StatusBar=()=>null;export const activateKeepAwakeAsync=async()=>{};export default{};', loader: 'js' })); } }] });
const server = createServer((req, res) => {
    if (req.url === '/app.js') {
        res.setHeader('content-type', 'application/javascript');
        res.end(bundled.outputFiles[0].contents);
    }
    else {
        res.setHeader('content-type', 'text/html');
        res.end('<!doctype html><html><head><title>POS téléphone QA local</title><meta name="viewport" content="width=device-width,initial-scale=1"/><style>html,body,#root{height:100%;margin:0}body{overflow:hidden}#root{display:flex;flex-direction:column}</style></head><body><div id="root"></div><script src="/app.js"></script></body></html>');
    }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const browser = await chromium.launch({ headless: true }).catch(async (error) => { await new Promise(resolve => server.close(resolve)); throw error; });
const origin = `http://127.0.0.1:${server.address().port}`, api = 'http://localhost:3001';
const tenantId = '507f1f77bcf86cd799439011';
const tenant = { slug: 'qa-phone', name: 'Classfood QA', brandColor: '#dec99c', logoUrl: null };
const device = { id: 'qa-pos', kind: 'pos', kindLabel: 'Caisse', name: 'Caisse QA' };
const product = { _id: '507f1f77bcf86cd799439099', name: 'Canette QA', price: 150, variants: [], optionGroups: [], supplements: [], removables: [], active: true, outOfStock: false, medias: [] };
const menu = { categories: [{ _id: 'cat', name: 'Boissons', products: [product] }] };
const results = [];
// 20:00 Paris all year; fixture must not depend on the runner's timezone/DST.
function slotForDay(day) {
    const noon = new Date(`${day}T12:00:00.000Z`);
    const localHour = Number(new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Europe/Paris', hour: '2-digit', hourCycle: 'h23',
    }).format(noon));
    return `${day}T${String(20 - (localHour - 12)).padStart(2, '0')}:00:00.000Z`;
}
async function scenario(name, viewport, fn, options = {}) {
    const context = await browser.newContext({ viewport, serviceWorkers: 'block', reducedMotion: 'reduce' });
    context.setDefaultTimeout(10000);
    context.setDefaultNavigationTimeout(20000);
    const page = await context.newPage();
    const errors = [], requests = [], remote = [];
    let row = null, mode = options.mode ?? 'ok', held = null;
    context.on('page', page => page.on('pageerror', error => errors.push(error.message)));
    page.on('pageerror', error => errors.push(error.message));
    await context.addInitScript(({ tenant, device, deny, noLocks, fixtureOrigin }) => {
        if (location.origin !== fixtureOrigin)
            return;
        if (!localStorage.getItem('qa-seeded')) {
            localStorage.setItem('qa-seeded', '1');
            localStorage.setItem('sm.pos.device.v1', JSON.stringify({ deviceToken: 'local-device', tenant, device }));
            localStorage.setItem('sm.pos.session.v1', JSON.stringify({ token: 'local-staff', staffName: 'Équipier QA', staffRole: 'caisse', tenantName: tenant.name, tenantSlug: tenant.slug, brandColor: tenant.brandColor, at: Date.now() }));
        }
        if (deny) {
            const set = Storage.prototype.setItem;
            Storage.prototype.setItem = function (k, v) {
                if (k === 'sm.pos.phone-order-attempt.v1')
                    throw new Error('Stockage refusé QA');
                return set.call(this, k, v);
            };
        }
        if (noLocks)
            Object.defineProperty(navigator, 'locks', { value: undefined });
    }, { tenant, device, deny: options.deny, noLocks: options.noLocks, fixtureOrigin: origin });
    await context.route('**/*', async (route) => {
        const req = route.request(), url = new URL(req.url());
        if (url.origin === origin)
            return route.continue();
        if (url.origin !== api) {
            remote.push(url.origin);
            return route.abort();
        }
        const path = url.pathname, method = req.method();
        requests.push({ path, method, body: method === 'POST' ? req.postDataJSON() : null });
        const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) });
        if (method === 'OPTIONS')
            return json({});
        if (path.includes('socket.io'))
            return json({}, 400);
        if (path.endsWith('/heartbeat'))
            return json({ tenant, device });
        if (path.endsWith('/menu'))
            return json(menu);
        if (path === '/orders/slots') {
            const date = url.searchParams.get('date');
            return json({ tenantId, date, timezone: 'Europe/Paris', intervalMin: 10, capacity: 1, leadTimeMin: 20, slots: [{ iso: slotForDay(date), label: '20:00', service: 'dinner', remaining: 1, full: false, load: 'calm' }], closedToday: false, nextOpenDate: null, closureReason: null, paused: false });
        }
        if (path === '/orders/count')
            return json({ total: row ? 1 : 0 });
        if (path === '/orders' && method === 'GET') {
            const rows = row && (!url.searchParams.has('status') || url.searchParams.get('status') === row.status) ? [row] : [];
            return json({ rows, total: rows.length, truncated: false });
        }
        if (path === '/orders' && method === 'POST') {
            if (mode === 'reject')
                return json({ code: 'ORDER_ATTEMPT_REJECTED', message: 'Créneau complet' }, 409);
            const body = req.postDataJSON();
            assert.deepEqual(body.payment, { method: 'counter', tender: null });
            row ??= { ...body, _id: '507f1f77bcf86cd799439022', tenantId, number: 42, status: 'new', trackingToken: 'a'.repeat(32), createdAt: new Date().toISOString(), totals: { subtotal: body.lines.reduce((sum, l) => sum + l.qty * 150, 0), total: body.lines.reduce((sum, l) => sum + l.qty * 150, 0) }, payment: { method: 'counter', status: 'pending', tender: null } };
            row.lines = row.lines.map(l => ({ ...l, name: product.name, unitPrice: 150, lineTotal: l.qty * 150 }));
            if (mode === 'drop') {
                mode = 'ok';
                return route.abort('failed');
            }
            if (mode === 'hold') {
                held = () => json(row);
                return;
            }
            return json(row, 201);
        }
        if (path === '/orders/recovery')
            return json({ tenantId, clientId: req.postDataJSON().clientId, channel: 'phone', state: row ? 'created' : 'pending', ...(row ? { order: row } : {}) });
        if (path === '/orders/abandon') {
            mode = 'ok';
            return json(row ? { tenantId, clientId: row.clientId, channel: 'phone', state: 'created', order: row } : { tenantId, clientId: req.postDataJSON().clientId, channel: 'phone', state: 'rejected', code: 'ORDER_ATTEMPT_REJECTED', reason: 'abandoned', message: 'Tentative clôturée' });
        }
        if (row && (path === `/orders/${row._id}` || path === `/orders/by-client/${row.clientId}`))
            return json(row);
        if (row && path === `/orders/${row._id}/collect`) {
            const body = req.postDataJSON();
            row.payment = { method: 'counter', status: 'paid', tender: body.tender, cashReceived: body.cashReceivedCents, changeGiven: body.cashReceivedCents - row.totals.total };
            return json(row);
        }
        return json({ message: `Fixture absente ${path}` }, 404);
    });
    async function open(p = page) {
        await p.goto(origin);
        await p.getByRole('button', { name: /Canette QA,/ }).waitFor();
        await p.getByRole('tab', { name: 'Téléphone', exact: true }).click();
    }
    async function draft(p = page) {
        await p.getByRole('button', { name: /Canette QA,/ }).click();
        await p.getByRole('button', { name: /^Ajouter/ }).click();
        if (viewport.width < 900)
            await p.getByRole('button', { name: /Ouvrir le ticket/ }).click();
        await p.getByRole('textbox', { name: 'Nom du client *', exact: true }).fill('Recette locale');
        await p.getByRole('textbox', { name: 'Téléphone *', exact: true }).fill('0000000000');
        await p.getByRole('radio', { name: '20:00', exact: true }).click();
        await p.getByText('La fidélité n’est pas encore rattachable aux commandes téléphone.', { exact: true }).waitFor();
        assert.equal(await p.getByRole('button', { name: /Rattacher une carte fidélité/ }).count(), 0);
    }
    async function shot(suffix = '') { await page.screenshot({ path: join(artifacts, name + suffix + '.png'), fullPage: true }); }
    const t = { page, context, requests, open, draft, shot, get row() { return row; }, get creates() { return requests.filter(r => r.path === '/orders' && r.method === 'POST'); }, release: async () => {
            assert.ok(held);
            await held();
        } };
    try {
        await fn(t);
        assert.deepEqual(errors, []);
        assert.deepEqual(remote, []);
        results.push({ name, passed: true, creates: t.creates.length });
    }
    catch (e) {
        await shot('-failure');
        console.log(name, await page.locator('body').innerText());
        throw e;
    }
    finally {
        await context.close();
    }
}
try {
    await scenario('desktop-confirmed', { width: 1440, height: 1000 }, async (t) => {
        await t.open();
        await t.draft();
        assert.equal(await t.page.getByRole('button', { name: 'Carte', exact: true }).count(), 0);
        await t.shot('-before');
        await t.page.getByRole('button', { name: 'Confirmer le créneau', exact: true }).click();
        await t.page.getByRole('dialog', { name: 'Réservation téléphone confirmée', exact: true }).waitFor();
        assert.equal(t.creates.length, 1);
        await t.shot();
        await t.page.getByRole('button', { name: 'Encaisser maintenant', exact: true }).click();
        await t.page.getByRole('button', { name: 'Compte juste', exact: true }).click();
        await t.page.getByRole('button', { name: /Confirmer 1,50.*encaissés/ }).click();
        await t.page.getByRole('button', { name: 'Retour à la commande', exact: true }).waitFor();
        assert.equal(t.creates.length, 1);
        assert.equal(t.row.payment.status, 'paid');
    });
    await scenario('mobile-recovery', { width: 390, height: 844 }, async (t) => {
        await t.open();
        await t.draft();
        await t.page.getByRole('button', { name: 'Confirmer le créneau', exact: true }).click();
        await t.page.getByRole('button', { name: 'Reprendre la confirmation', exact: true }).waitFor();
        await t.shot('-uncertain');
        const first = t.creates[0].body;
        await t.page.reload();
        await t.page.getByRole('button', { name: 'Reprendre la confirmation', exact: true }).click();
        await t.page.getByRole('dialog', { name: 'Réservation téléphone confirmée', exact: true }).waitFor();
        assert.equal(t.creates.length, 1);
        const recovery = t.requests.find(r => r.path === '/orders/recovery');
        assert.deepEqual(recovery.body, first);
        await t.shot();
    }, { mode: 'drop' });
    await scenario('tablet-no-storage', { width: 820, height: 1180 }, async (t) => {
        await t.open();
        await t.draft();
        await t.page.getByRole('button', { name: 'Confirmer le créneau', exact: true }).click();
        await t.page.getByText('Stockage refusé QA', { exact: true }).waitFor();
        assert.equal(t.creates.length, 0);
        await t.shot();
    }, { deny: true });
    await scenario('desktop-no-locks', { width: 1280, height: 800 }, async (t) => {
        await t.open();
        await t.page.getByText(/Ce navigateur ne permet pas/).waitFor();
        assert.equal(await t.page.getByRole('button', { name: 'Confirmer le créneau', exact: true }).isDisabled(), true);
        assert.equal(t.creates.length, 0);
        await t.shot();
    }, { noLocks: true });
    await scenario('two-tabs-preserve-draft', { width: 1440, height: 1000 }, async (t) => {
        await t.open();
        await t.draft();
        await t.page.getByRole('button', { name: 'Confirmer le créneau', exact: true }).click();
        await t.page.getByRole('button', { name: 'Reprendre la confirmation', exact: true }).waitFor();
        const b = await t.context.newPage();
        await t.open(b);
        await t.draft(b);
        await b.getByRole('button', { name: 'Plus', exact: true }).click();
        await b.getByRole('textbox', { name: 'Nom du client *', exact: true }).fill('Autre brouillon');
        await b.getByRole('button', { name: 'Reprendre la confirmation', exact: true }).click();
        await b.getByRole('dialog', { name: 'Réservation téléphone confirmée', exact: true }).waitFor();
        await b.getByRole('button', { name: 'À payer au retrait', exact: true }).click();
        assert.equal(await b.getByRole('textbox', { name: 'Nom du client *', exact: true }).inputValue(), 'Autre brouillon');
        await b.getByText('Sous-total · 2 articles', { exact: true }).waitFor();
        await t.page.getByText(/Connexion interrompue/).waitFor({ state: 'hidden' });
        assert.equal(await t.page.getByRole('textbox', { name: 'Nom du client *', exact: true }).inputValue(), '');
        await t.page.getByText('Tapez un produit pour démarrer', { exact: true }).waitFor();
        assert.equal(t.creates.length, 1);
        await b.screenshot({ path: join(artifacts, 'two-tabs-preserved.png') });
    }, { mode: 'drop' });
    await scenario('two-tabs-busy', { width: 1440, height: 1000 }, async (t) => {
        await t.open();
        await t.draft();
        await t.page.getByRole('button', { name: 'Confirmer le créneau', exact: true }).click();
        await t.page.waitForFunction(() => JSON.parse(localStorage.getItem('sm.pos.phone-order-attempt.v1'))?.active?.state === 'uncertain');
        const b = await t.context.newPage();
        await t.open(b);
        await b.getByRole('button', { name: 'Reprendre la confirmation', exact: true }).click();
        await b.getByText(/déjà en cours de vérification sur un autre onglet/).waitFor();
        assert.equal(t.creates.length, 1);
        assert.equal(t.requests.filter(r => r.path === '/orders/recovery').length, 0);
        await t.release();
        await t.page.getByRole('dialog', { name: 'Réservation téléphone confirmée', exact: true }).waitFor();
        await b.getByText('Commande téléphone · confirmation à vérifier', { exact: true }).waitFor({ state: 'hidden' });
        await t.shot();
    }, { mode: 'hold' });
    await scenario('rejection-fenced', { width: 1440, height: 1000 }, async (t) => {
        await t.open();
        await t.draft();
        await t.page.getByRole('button', { name: 'Confirmer le créneau', exact: true }).click();
        await t.page.getByRole('button', { name: 'Abandonner cette tentative', exact: true }).click();
        await t.page.getByRole('button', { name: 'Confirmer l’abandon de cette tentative', exact: true }).click();
        await t.page.getByRole('button', { name: 'Corriger le ticket', exact: true }).waitFor();
        const first = t.creates[0].body;
        await t.shot();
        await t.page.getByRole('button', { name: 'Corriger le ticket', exact: true }).click();
        await t.page.getByRole('button', { name: 'Confirmer le créneau', exact: true }).click();
        await t.page.getByRole('dialog', { name: 'Réservation téléphone confirmée', exact: true }).waitFor();
        assert.equal(t.creates.length, 2);
        assert.notEqual(t.creates[1].body.clientId, first.clientId);
        assert.equal(t.requests.filter(r => r.path === '/orders/abandon').length, 1);
    }, { mode: 'reject' });
    await scenario('changed-owner-draft-preserved', { width: 1440, height: 1000 }, async (t) => {
        await t.open();
        await t.draft();
        await t.page.getByRole('button', { name: 'Confirmer le créneau', exact: true }).click();
        await t.page.getByRole('button', { name: 'Reprendre la confirmation', exact: true }).waitFor();
        await t.page.getByRole('button', { name: 'Plus', exact: true }).click();
        await t.page.getByRole('textbox', { name: 'Nom du client *', exact: true }).fill('Brouillon A modifié');
        const b = await t.context.newPage();
        await t.open(b);
        await b.getByRole('button', { name: 'Reprendre la confirmation', exact: true }).click();
        await b.getByRole('dialog', { name: 'Réservation téléphone confirmée', exact: true }).waitFor();
        await t.page.getByText(/Connexion interrompue/).waitFor({ state: 'hidden' });
        assert.equal(await t.page.getByRole('textbox', { name: 'Nom du client *', exact: true }).inputValue(), 'Brouillon A modifié');
        await t.page.getByText('Sous-total · 2 articles', { exact: true }).waitFor();
        assert.equal(t.creates.length, 1);
        await t.shot();
    }, { mode: 'drop' });
    console.log(JSON.stringify({ results, artifacts, limit: 'Real POS ReactNativeWeb rendered; native-only Expo hooks stubbed; fixture HTTP only; no remote writes.' }, null, 2));
}
finally {
    await browser.close();
    await new Promise(r => server.close(r));
}
