#!/usr/bin/env node
// Vrai frontend Next et IndexedDB Chromium ; API/Stripe/Turnstile de fixtures.
// Exécuter EN SÉRIE avec les autres recettes Next (.next/dev partagé).
// Aucun identifiant, paiement, fournisseur, staging ou production n'est appelé.
// Node >=24.12, packages/contracts déjà compilé, Playwright déjà installé.
// QA_SCENARIO=all (défaut) ou l'un des noms imprimés par ce harnais.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const [major, minor] = process.versions.node.split('.').map(Number);
assert.ok(major > 24 || (major === 24 && minor >= 12), 'Node >=24.12 est requis.');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(join(root, 'package.json'));
const { chromium } = require('playwright');
const { DIRECTIONS, PublicOrderRecoveryResultSchema, CreatePublicOrderSchema } = require(join(root, 'packages/contracts/dist/index.js'));
assert.ok(PublicOrderRecoveryResultSchema, 'Compiler packages/contracts avant cette recette.');
const webPort = port('QA_WEB_PORT', 3218);
const apiPort = port('QA_API_PORT', 3219);
assert.notEqual(webPort, apiPort, 'Les ports web et API doivent être distincts.');
const web = `http://127.0.0.1:${webPort}`;
const apiOrigin = `http://127.0.0.1:${apiPort}`;
const directory = await mkdtemp(join(tmpdir(), 'sm-checkout-recovery-'));
const slot = new Date(Date.now() + 90 * 60_000).toISOString();
const day = new Intl.DateTimeFormat('fr-CA', { timeZone: 'Europe/Paris' }).format(new Date(slot));
const label = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris' }).format(new Date(slot));
const slots = { date: day, timezone: 'Europe/Paris', intervalMin: 10, capacity: 10, leadTimeMin: 20,
  slots: [{ iso: slot, label, service: 'dinner', remaining: 10, full: false, load: 'calm' }],
  closedToday: false, nextOpenDate: null, closureReason: null, paused: false };
const site = {
  tenant: { slug: 'qa', name: 'Restaurant de recette', brand: DIRECTIONS.nuit, logoUrl: null,
    brandColor: '#c9a15a', address: '12 rue des Fleurs, Lyon', phones: [],
    hours: [1, 2, 3, 4, 5, 6, 7].map(day => ({ day, lunch: { open: '00:00', close: '23:59' }, dinner: null })) },
  menu: { categories: [{ id: 'burgers', name: 'Burgers', products: [{
    id: '507f1f77bcf86cd799439010', name: 'Burger de recette', description: 'Bœuf, cheddar.', price: 1000,
    active: true, variants: [], optionGroups: [], removables: [], supplements: [], tags: [], outOfStock: false,
  }] }] }, medias: [], slots, reviews: { avg: 0, count: 0, latest: [] }, ordering: { paused: false, message: null },
  openNow: true, todayHours: { day: 1, lunch: { open: '00:00', close: '23:59' }, dinner: null }, timezone: 'Europe/Paris',
};
const createPath = '/public/tenants/qa/orders';
const journalName = 'sm.checkout-attempts';
const scenarios = [];
const errors = [];
const consoleMessages = [];
const remote = [];
const unexpectedHttp = [];
const requests = [];
const expectedFailures = new Set();
let fixture;
let next;
let browser;
let activePage;
let nextLog = '';

function reset(mode) {
  fixture = { mode, orders: new Map(), admissions: new Map(), creates: [], recoveries: 0, abandons: 0,
    paymentRequests: 0, recoveryAvailable: mode !== 'lost-response', createFailureStatus: 503, recoveryFailureStatus: 503, releaseCreate: Promise.withResolvers(),
    releasePayment: Promise.withResolvers(), delayedDone: Promise.withResolvers(), nextNumber: 12 };
}
function business(body) {
  const { clientId: _id, recoveryProof: _proof, turnstileToken: _challenge, ...payload } = body;
  return payload;
}
function rejection(reason) {
  return { state: 'rejected', code: 'ORDER_ATTEMPT_REJECTED', reason,
    message: reason === 'slot_unavailable' ? 'Ce créneau est complet. Choisissez un autre créneau.' : 'Cette tentative a été fermée. Aucune commande ne sera créée.' };
}
function materialize(state, body) {
  const previous = state.admissions.get(body.clientId);
  if (previous?.state === 'rejected') return previous;
  if (previous?.state === 'created') return previous;
  const number = state.nextNumber++;
  const total = body.lines.reduce((sum, line) => sum + line.qty * 1000, 0);
  const order = { _id: number.toString(16).padStart(24, '0'), number, status: 'new', type: 'pickup',
    trackingToken: number.toString(16).padStart(32, '0'), payment: { method: body.payment.method, status: 'pending' },
    totals: { total }, pickup: { slot: body.pickup.slot } };
  state.orders.set(body.clientId, order);
  const result = { state: 'created', order };
  state.admissions.set(body.clientId, result);
  return result;
}
function proofMatches(state, body) {
  const first = state.creates.find(candidate => candidate.clientId === body.clientId);
  return first && first.recoveryProof === body.recoveryProof;
}
const api = createServer((req, res) => void handle(req, res).catch(error => {
  errors.push(`fixture: ${error.name}: ${error.message}`);
  if (!res.headersSent) res.writeHead(500);
  if (!res.writableEnded) res.end('{}');
}));
async function handle(req, res) {
  res.setHeader('Access-Control-Allow-Origin', web);
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
  const state = fixture;
  const url = new URL(req.url, apiOrigin);
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : null;
  // Never record URL search/proof/payload/customer information, even for fixtures.
  requests.push({ method: req.method, path: url.pathname });
  const send = (status, value) => {
    if (status >= 400) expectedFailures.add(`${req.method} ${url.pathname} ${status}`);
    if (!res.destroyed && !res.writableEnded) { res.writeHead(status); res.end(JSON.stringify(value)); }
  };
  const recovery = result => send(200, PublicOrderRecoveryResultSchema.parse(result));
  if (url.pathname === '/public/tenants/qa/site') return send(200, site);
  if (url.pathname === '/public/tenants/qa') return send(200, site.tenant);
  if (url.pathname === '/public/tenants/qa/slots') return send(200, slots);
  if (url.pathname === '/public/funnel') return send(200, { ok: true });
  if (url.pathname === `${createPath}/recovery` && req.method === 'POST') {
    state.recoveries++;
    if (!proofMatches(state, body)) return send(404, { code: 'ORDER_RECOVERY_NOT_FOUND', message: 'Introuvable' });
    if (!state.recoveryAvailable) {
      // Deliberately malformed 200: TypeScript alone cannot authorize a reset.
      if (state.recoveryFailureStatus === 200) return send(200, { state: 'rejected', reason: 'abandoned', message: 'Rejet sans code de clôture valide.' });
      return send(state.recoveryFailureStatus, { code: 'ORDER_ATTEMPT_UNCERTAIN', message: 'Réponse temporairement indisponible.' });
    }
    return recovery(state.admissions.get(body.clientId) ?? { state: 'pending' });
  }
  if (url.pathname === `${createPath}/abandon` && req.method === 'POST') {
    state.abandons++;
    assert.ok(proofMatches(state, body), 'La clôture doit conserver la preuve de la tentative.');
    assert.deepEqual(business(body), business(state.creates.find(candidate => candidate.clientId === body.clientId)), 'La clôture doit porter le payload figé.');
    const existing = state.admissions.get(body.clientId);
    if (existing?.state === 'created') return recovery(existing);
    const result = rejection('abandoned');
    state.admissions.set(body.clientId, result);
    return recovery(result);
  }
  if (url.pathname === createPath && req.method === 'POST') {
    CreatePublicOrderSchema.parse(body);
    assert.match(body.recoveryProof, /^[a-f0-9]{64}$/, 'Preuve de 256 bits obligatoire sur chaque nouvel envoi UI.');
    state.creates.push(structuredClone(body));
    const ordinal = state.creates.length;
    const first = state.creates.find(candidate => candidate.clientId === body.clientId);
    assert.equal(body.recoveryProof, first.recoveryProof, 'Une reprise garde sa preuve.');
    assert.deepEqual(business(body), business(first), 'Une reprise garde exactement le payload métier initial.');
    if (state.mode === 'reject-first' && ordinal === 1) {
      state.admissions.set(body.clientId, rejection('slot_unavailable'));
      return send(409, { code: 'ORDER_ATTEMPT_REJECTED', message: 'Ce créneau est complet.' });
    }
    if (state.mode === 'committing-wins' && ordinal === 1) materialize(state, body);
    if (['two-tabs', 'abandon-wins', 'committing-wins'].includes(state.mode) && ordinal === 1) await state.releaseCreate.promise;
    const result = materialize(state, body);
    if (ordinal === 1) state.delayedDone.resolve();
    if (result.state === 'rejected') return send(409, result);
    if (state.mode === 'lost-response' && ordinal === 1) return send(state.createFailureStatus, { code: 'ORDER_ATTEMPT_UNCERTAIN', message: 'Réponse de création perdue après écriture.' });
    return send(201, result.order);
  }
  const order = [...state.orders.values()].find(candidate => url.pathname.startsWith(`/public/orders/${candidate._id}`));
  if (order && url.searchParams.get('t') === order.trackingToken) {
    const path = `/public/orders/${order._id}`;
    if (url.pathname === path) return send(200, { _id: order._id, number: order.number, status: order.status,
      statusHistory: [], pickupSlot: order.pickup.slot, fulfillment: order.type,
      payment: { ...order.payment, refundedCents: 0, pendingRefundCents: 0 } });
    if (url.pathname === `${path}/payment-intent` && req.method === 'POST') {
      state.paymentRequests++;
      if (state.mode === 'before-payment') await state.releasePayment.promise;
      return send(200, { unavailable: false, paymentIntentId: 'pi_fixture', clientSecret: 'pi_fixture_secret',
        publishableKey: 'pk_test_fixture', stripeAccount: 'acct_fixture', amount: order.totals.total, currency: 'eur' });
    }
    if (url.pathname === `${path}/ticket`) return send(200, {
      orderId: order._id, pickupNumber: order.number, header: { tenantName: site.tenant.name, slug: 'qa', address: site.tenant.address, phones: [] },
      createdAt: slot, printedAt: slot, channel: 'online', channelLabel: 'En ligne', type: 'pickup', typeLabel: 'Retrait',
      status: order.status, statusLabel: 'Reçue', pickup: { slotIso: slot, slotLabel: label, customerName: 'Client de recette', customerPhone: null },
      lines: [], totals: { subtotal: order.totals.total, discount: null, total: order.totals.total }, note: null,
      payment: { ...order.payment, methodLabel: 'Paiement en ligne', tender: null, tenderLabel: null,
        statusLabel: 'En attente', paid: false, cashReceived: null, changeGiven: null },
    });
  }
  if (url.pathname.includes('/loyalty')) return send(404, { message: 'Programme absent de cette fixture.' });
  unexpectedHttp.push(`${req.method} ${url.pathname}`);
  return send(404, { message: 'Route non prévue par la fixture.' });
}

async function context(options = {}) {
  const context = await browser.newContext({ viewport: options.desktop ? { width: 1440, height: 1000 } : { width: 390, height: 844 },
    reducedMotion: 'reduce', locale: 'fr-FR', timezoneId: 'Europe/Paris', serviceWorkers: 'block' });
  if (options.denied) await context.addInitScript(() => {
    Object.defineProperty(window, 'indexedDB', { configurable: true, get() { throw new DOMException('Stockage refusé par la recette', 'SecurityError'); } });
  });
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin === web || url.origin === apiOrigin) return route.continue();
    if (url.hostname === 'challenges.cloudflare.com') return route.fulfill({ contentType: 'text/javascript', body:
      "window.__challengeCount=0;window.turnstile={render:(_,o)=>{queueMicrotask(()=>o.callback('fixture-'+crypto.randomUUID()+'-'+(++window.__challengeCount)));return 'fixture'},remove(){}}" });
    if (url.hostname === 'js.stripe.com') return route.fulfill({ contentType: 'text/javascript', body:
      "window.__bankCalls=0;window.Stripe=()=>({elements:()=>({create:()=>({mount(n){n.textContent='Carte de test sécurisée'},destroy(){}})}),confirmPayment:async()=>{window.__bankCalls++;return {paymentIntent:{status:'processing'}}}})" });
    remote.push(`${route.request().method()} ${url.origin}${url.pathname}`);
    return route.abort('blockedbyclient');
  });
  context.on('page', page => {
    page.setDefaultTimeout(20_000);
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => {
      if (['warning', 'error'].includes(message.type())) consoleMessages.push(message.text());
    });
    page.on('response', response => {
      if (response.status() < 400) return;
      const url = new URL(response.url());
      const key = `${response.request().method()} ${url.pathname} ${response.status()}`;
      if (!expectedFailures.has(key)) unexpectedHttp.push(key);
    });
  });
  return context;
}
async function pageIn(context) {
  const page = await context.newPage();
  activePage = page;
  return page;
}
async function storefront(page) {
  // Next development keeps HMR connections open; wait for the UI, not network silence.
  const hydrated = page.waitForResponse(response => new URL(response.url()).pathname === '/public/funnel', { timeout: 30_000 });
  await page.goto(`${web}/r/qa`, { waitUntil: 'domcontentloaded', timeout: 90_000 });
  await page.getByRole('heading', { name: site.tenant.name, level: 1 }).waitFor();
  // This request starts in the mounted storefront effect. Then join the same
  // browser lock queue so cart hydration has completed before the first click.
  await hydrated;
  await page.evaluate(() => navigator.locks.request('sm.cart.write.qa', () => true));
  assert.equal(new URL(page.url()).pathname, '/r/qa');
  assert.ok((await page.title()).length > 0, 'Titre significatif.');
}
async function fillToPayment(page, { add = true, quantity = 1, name = 'Camille Recette' } = {}) {
  if (add) await page.getByRole('region', { name: 'Burgers', exact: true }).getByRole('button', { name: /Burger de recette.*ajouter au panier/ }).click();
  await page.getByRole('button', { name: /Voir mon panier/ }).click();
  if (quantity > 1) await page.getByRole('button', { name: 'Plus de Burger de recette', exact: true }).click();
  await continueToPayment(page, name);
}
async function continueToPayment(page, name = 'Camille Recette') {
  await page.getByRole('dialog', { name: 'Votre commande', exact: true }).getByRole('button', { name: /^Continuer/ }).click();
  await page.getByRole('textbox', { name: 'Prénom et nom' }).fill(name);
  await page.getByRole('textbox', { name: 'Téléphone', exact: true }).fill('0612345678');
  await page.getByRole('button', { name: 'Choisir le créneau' }).click();
  await page.getByRole('button', { name: label, exact: true }).click();
  await page.getByRole('button', { name: /^Continuer/ }).click();
  await page.getByRole('radio', { name: /Carte bancaire Paiement sécurisé en ligne/ }).click();
}
function pay(page) { return page.getByRole('dialog', { name: 'Paiement', exact: true }).getByRole('button', { name: /^Payer\s+\d/ }); }
function recoveryDialog(page) { return page.getByRole('dialog', { name: 'Reprendre votre commande', exact: true }); }
async function openRecovery(page) {
  await page.getByRole('button', { name: 'Ma commande en cours', exact: true }).click();
  await recoveryDialog(page).waitFor();
}
async function received(page) {
  const dialog = recoveryDialog(page);
  await dialog.getByRole('link', { name: 'Suivre ma commande', exact: true }).waitFor();
  assert.equal(await dialog.getByText('Payé en ligne', { exact: true }).count(), 0, 'Le reçu de création ne prouve pas un paiement.');
  assert.equal(await page.evaluate(() => window.__bankCalls ?? 0), 0);
}
async function journal(page, store = 'active') {
  return page.evaluate(({ database, store }) => new Promise((resolve, reject) => {
    const opened = indexedDB.open(database);
    opened.onerror = () => reject(new Error('Lecture du journal impossible.'));
    opened.onsuccess = () => {
      const db = opened.result;
      const transaction = db.transaction(store, 'readonly');
      let value;
      const request = transaction.objectStore(store).get('qa');
      request.onsuccess = () => { value = request.result ?? null; };
      transaction.oncomplete = () => { db.close(); resolve(value); };
      transaction.onerror = transaction.onabort = () => { db.close(); reject(new Error('Lecture du journal annulée.')); };
    };
  }), { database: journalName, store });
}
async function assertPrepared(page, expected) {
  const value = await journal(page);
  assert.equal(value.state, 'uncertain');
  assert.equal(value.clientId, expected.clientId);
  assert.equal(value.recoveryProof, expected.recoveryProof);
  assert.deepEqual(value.payload, business(expected));
  assert.equal(Object.hasOwn(value.payload, 'turnstileToken'), false);
  assert.equal(JSON.stringify(value).includes('pi_fixture_secret'), false);
}
async function assertReceived(page) {
  const value = await journal(page);
  assert.equal(value.state, 'received');
  assert.equal(Object.hasOwn(value, 'payload'), false, 'Les coordonnées sont retirées du journal dès réception.');
  assert.equal(Object.hasOwn(value, 'recoveryProof'), false, 'La preuve de tentative est retirée après réception.');
  return value;
}
async function closeRecovery(page) {
  await recoveryDialog(page).getByRole('button', { name: 'Fermer', exact: true }).click();
  await recoveryDialog(page).waitFor({ state: 'hidden' });
}
async function abandon(page) {
  await recoveryDialog(page).getByRole('button', { name: 'Modifier ma demande', exact: true }).click();
  await page.getByRole('button', { name: 'Fermer cette tentative', exact: true }).click();
}
async function healthy(page, name) {
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'Aucun débordement horizontal.');
  assert.equal(await page.locator('nextjs-portal').filter({ hasText: /error/i }).count(), 0, 'Aucun overlay de compilation.');
  await page.screenshot({ path: join(directory, `${name}.png`), fullPage: true });
  scenarios.push({ name, orders: fixture.orders.size, createPosts: fixture.creates.length,
    recoveryPosts: fixture.recoveries, abandonPosts: fixture.abandons, paymentRequests: fixture.paymentRequests });
  console.log(`PASS ${name}`);
  fixture.releaseCreate.resolve(); fixture.releasePayment.resolve();
  await page.context().close();
  activePage = null;
}

async function lostResponseScenario(name, createStatus = 503, recoveryStatus = 503) {
  reset('lost-response');
  fixture.createFailureStatus = createStatus;
  fixture.recoveryFailureStatus = recoveryStatus;
  const page = await pageIn(await context());
  await storefront(page); await fillToPayment(page); await pay(page).click();
  await recoveryDialog(page).waitFor();
  await assertPrepared(page, fixture.creates[0]);
  assert.equal(fixture.orders.size, 1); assert.equal(fixture.creates.length, 1);
  await closeRecovery(page);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await openRecovery(page);
  await assertPrepared(page, fixture.creates[0]);
  fixture.recoveryAvailable = true;
  await recoveryDialog(page).getByRole('button', { name: 'Retrouver ma commande', exact: true }).click();
  await received(page); const receipt = await assertReceived(page);
  assert.equal(receipt.receipt.orderId, [...fixture.orders.values()][0]._id);
  assert.equal(fixture.creates.length, 1, 'Récupérer ne recrée aucune commande.');
  assert.equal(fixture.paymentRequests, 0, 'Récupérer ne démarre aucun paiement.');
  await healthy(page, name);
}

const cases = {
  async 'lost-response-close-reload'() {
    await lostResponseScenario('lost-response-close-reload');
  },
  async 'http-409-and-recovery-404-preserve-attempt'() {
    await lostResponseScenario('http-409-and-recovery-404-preserve-attempt', 409, 404);
  },
  async 'malformed-recovery-cannot-release'() {
    await lostResponseScenario('malformed-recovery-cannot-release', 503, 200);
  },
  async 'receipt-before-payment-reload'() {
    reset('before-payment');
    const page = await pageIn(await context());
    await storefront(page); await fillToPayment(page); await pay(page).click();
    await until(() => fixture.paymentRequests === 1, 'La demande bancaire ne démarre pas.');
    await assertReceived(page);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await openRecovery(page); await received(page);
    assert.equal(fixture.creates.length, 1); assert.equal(fixture.paymentRequests, 1);
    fixture.releasePayment.resolve();
    await recoveryDialog(page).getByRole('link', { name: 'Suivre ma commande', exact: true }).click();
    await page.getByText('Paiement en ligne à confirmer', { exact: true }).waitFor();
    assert.equal(new URL(page.url()).pathname, `/t/${[...fixture.orders.values()][0]._id}`);
    await page.getByRole('button', { name: 'Reprendre le paiement', exact: true }).click();
    await page.getByText('Carte de test sécurisée', { exact: true }).waitFor();
    assert.equal(fixture.creates.length, 1); assert.equal(fixture.paymentRequests, 2);
    assert.equal(await page.evaluate(() => window.__bankCalls ?? 0), 0);
    await healthy(page, 'receipt-before-payment-reload');
  },
  async 'two-tabs-frozen-payload-and-new-cart'() {
    reset('two-tabs');
    const shared = await context({ desktop: true });
    const first = await pageIn(shared);
    await storefront(first); await fillToPayment(first);
    const second = await pageIn(shared);
    await storefront(second); await fillToPayment(second, { add: false, name: 'Alex Recette' });
    await pay(first).click();
    await until(() => fixture.creates.length === 1, 'Premier envoi absent.');
    await assertPrepared(first, fixture.creates[0]);
    await recoveryDialog(second).waitFor();
    // The second tab prepares a DIFFERENT cart after the first POST is frozen.
    // The shared cart may synchronize, but must never mutate the admitted body.
    await closeRecovery(second);
    await second.getByRole('region', { name: 'Burgers', exact: true }).getByRole('button', { name: /Burger de recette.*ajouter au panier/ }).click();
    await until(async () => (await second.evaluate(() => JSON.parse(localStorage.getItem('sm.cart.qa') ?? 'null')))?.lines[0]?.qty === 2, 'Le nouveau panier de B n’est pas sauvegardé.');
    await openRecovery(second);
    await recoveryDialog(second).getByRole('button', { name: 'Réessayer cet envoi', exact: true }).click();
    await second.getByText('Carte de test sécurisée', { exact: true }).waitFor();
    await assertReceived(second);
    assert.equal(fixture.creates.length, 2);
    const [one, two] = fixture.creates;
    assert.equal(one.clientId, two.clientId); assert.equal(one.recoveryProof, two.recoveryProof);
    assert.deepEqual(business(one), business(two));
    assert.equal(one.lines[0].qty, 1); assert.equal(one.pickup.customerName, 'Camille Recette');
    assert.notEqual(one.turnstileToken, two.turnstileToken, 'Un retry reçoit un nouveau challenge, sans changer la demande.');
    fixture.releaseCreate.resolve();
    await deadline(fixture.delayedDone.promise, 15_000, 'Le premier envoi retardé reste bloqué.');
    await until(async () => (await journal(first))?.state === 'received', 'Reçu absent du journal partagé.');
    await second.reload({ waitUntil: 'domcontentloaded' });
    await openRecovery(second); await received(second);
    await recoveryDialog(second).getByRole('button', { name: 'Préparer une nouvelle commande', exact: true }).click();
    await second.getByRole('dialog', { name: 'Votre commande', exact: true }).waitFor();
    const cart = await second.evaluate(() => JSON.parse(localStorage.getItem('sm.cart.qa') ?? 'null'));
    assert.equal(cart?.lines[0]?.qty, 2, 'Le reçu de A ne doit pas effacer le nouveau panier de B, y compris après rechargement.');
    assert.equal(fixture.orders.size, 1); assert.equal(fixture.creates.length, 2);
    await healthy(second, 'two-tabs-frozen-payload-and-new-cart');
  },
  async 'indexeddb-denied-zero-post'() {
    reset('ok');
    const page = await pageIn(await context({ denied: true }));
    await storefront(page);
    await page.getByRole('region', { name: 'Burgers', exact: true }).getByRole('button', { name: /Burger de recette.*ajouter au panier/ }).click();
    await page.getByRole('button', { name: /Voir mon panier/ }).click();
    await page.getByText('Sauvegarde indisponible', { exact: true }).waitFor();
    assert.equal(fixture.creates.length, 0); assert.equal(fixture.orders.size, 0);
    assert.equal(fixture.paymentRequests, 0);
    await healthy(page, 'indexeddb-denied-zero-post');
  },
  async 'terminal-rejection-can-correct'() {
    reset('reject-first');
    const page = await pageIn(await context());
    await storefront(page); await fillToPayment(page); await pay(page).click();
    await recoveryDialog(page).waitFor();
    await until(async () => (await journal(page))?.state === 'rejected', 'Le rejet terminal n’est pas sauvegardé.');
    assert.equal(fixture.orders.size, 0);
    await recoveryDialog(page).getByRole('button', { name: 'Revenir à mon panier', exact: true }).click();
    await continueToPayment(page, 'Camille Corrigee'); await pay(page).click();
    await page.getByText('Carte de test sécurisée', { exact: true }).waitFor();
    assert.equal(fixture.creates.length, 2); assert.equal(fixture.orders.size, 1);
    assert.notEqual(fixture.creates[0].clientId, fixture.creates[1].clientId);
    assert.notEqual(fixture.creates[0].recoveryProof, fixture.creates[1].recoveryProof);
    assert.equal(fixture.creates[1].pickup.customerName, 'Camille Corrigee');
    await assertReceived(page);
    await healthy(page, 'terminal-rejection-can-correct');
  },
  async 'abandon-fences-delayed-create'() {
    reset('abandon-wins');
    const shared = await context();
    const first = await pageIn(shared);
    await storefront(first); await fillToPayment(first); await pay(first).click();
    await until(() => fixture.creates.length === 1, 'Envoi retardé absent.');
    await assertPrepared(first, fixture.creates[0]);
    await first.close();
    const page = await pageIn(shared);
    await storefront(page); await openRecovery(page); await abandon(page);
    await until(async () => (await journal(page))?.state === 'rejected', 'Clôture non persistée.');
    fixture.releaseCreate.resolve();
    await deadline(fixture.delayedDone.promise, 15_000, 'La requête retardée ne se termine pas.');
    assert.equal(fixture.orders.size, 0, 'La clôture serveur gagnante interdit la création tardive.');
    assert.equal(fixture.abandons, 1);
    const firstId = fixture.creates[0].clientId;
    await recoveryDialog(page).getByRole('button', { name: 'Revenir à mon panier', exact: true }).click();
    await continueToPayment(page, 'Camille Nouvelle'); await pay(page).click();
    await page.getByText('Carte de test sécurisée', { exact: true }).waitFor();
    assert.equal(fixture.orders.has(firstId), false); assert.equal(fixture.orders.size, 1);
    assert.notEqual(fixture.creates[1].clientId, firstId);
    await healthy(page, 'abandon-fences-delayed-create');
  },
  async 'accepted-order-cannot-be-abandoned'() {
    reset('committing-wins');
    const shared = await context({ desktop: true });
    const first = await pageIn(shared);
    await storefront(first); await fillToPayment(first); await pay(first).click();
    await until(() => fixture.orders.size === 1, 'Commande acceptée absente.');
    await first.close();
    const page = await pageIn(shared);
    await storefront(page); await openRecovery(page); await abandon(page);
    await received(page); await assertReceived(page);
    fixture.releaseCreate.resolve();
    await deadline(fixture.delayedDone.promise, 15_000, 'La réponse retardée ne se termine pas.');
    assert.equal(fixture.orders.size, 1); assert.equal(fixture.creates.length, 1);
    assert.equal([...fixture.orders.values()][0].status, 'new', 'Fermer une tentative ne doit pas annuler une commande acceptée.');
    assert.equal(fixture.paymentRequests, 0);
    await healthy(page, 'accepted-order-cannot-be-abandoned');
  },
};

const selection = process.env.QA_SCENARIO ?? 'all';
assert.ok(selection === 'all' || Object.hasOwn(cases, selection), `QA_SCENARIO inconnu : ${selection}`);
reset('ok');
try {
  await new Promise((resolve, reject) => api.listen(apiPort, '127.0.0.1', resolve).once('error', reject));
  next = spawn(process.execPath, [require.resolve('next/dist/bin/next'), 'dev', '--webpack', '--hostname', '127.0.0.1', '-p', String(webPort)], {
    cwd: join(root, 'apps/web'), env: { ...process.env, NEXT_PUBLIC_API_URL: apiOrigin, NEXT_PUBLIC_SITE_URL: web,
      NEXT_PUBLIC_TURNSTILE_SITE_KEY: 'fixture', NEXT_TELEMETRY_DISABLED: '1' }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  await deadline(new Promise((resolve, reject) => {
    const output = chunk => { nextLog += chunk; if (/Ready in/.test(nextLog)) resolve(); };
    next.stdout.on('data', output); next.stderr.on('data', output);
    next.once('error', reject);
    next.once('exit', code => reject(new Error(`Next s’est arrêté au démarrage (${code}). Voir le journal local.`)));
  }), 60_000, 'Démarrage Next trop long. Ne pas arrêter un autre serveur pour libérer .next/dev.');
  browser = await chromium.launch({ headless: process.env.QA_HEADED !== '1' });
  for (const [name, run] of Object.entries(cases)) if (selection === 'all' || selection === name) {
    console.log(`RUN ${name}`);
    await run();
  }
  assert.deepEqual(errors, []); assert.deepEqual(remote, []); assert.deepEqual(unexpectedHttp, []);
  const expectedConsole = message => /Failed to load resource: the server responded with a status of (404|409|503)/.test(message)
    || /^The resource http:\/\/127\.0\.0\.1:\d+\/_next\/static\/.* was preloaded using link preload but not used/.test(message);
  const unexpectedConsole = consoleMessages.filter(message => !expectedConsole(message));
  assert.deepEqual(unexpectedConsole, [], 'Toute erreur console hors panne HTTP simulée doit être expliquée.');
  const result = { result: 'PASS', scenarios, browser: 'Chromium / Playwright (Browser plugin not available)',
    fixtures: ['API admission/recovery', 'Stripe.js', 'Turnstile'], real: ['Next UI', 'IndexedDB', 'cross-tab browser context'],
    expectedConsoleWarnings: ['Échecs HTTP injectés vérifiés par route/statut', 'Preloads Next dev inutilisés'],
    limits: ['Pas de concurrence Mongo réelle', 'Pas de paiement réel', 'Pas de recette staging', 'Pas de garantie cross-origin'], evidence: directory };
  await writeFile(join(directory, 'result.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
} catch (error) {
  if (activePage && !activePage.isClosed()) {
    await activePage.screenshot({ path: join(directory, 'failure.png'), fullPage: true }).catch(() => {});
    await writeFile(join(directory, 'failure.txt'), await activePage.locator('body').ariaSnapshot().catch(() => '(page indisponible)'));
    await writeFile(join(directory, 'dev-overlay.txt'), await activePage.locator('nextjs-portal').innerText().catch(() => '(pas de portail)'));
  }
  console.error(`Échec de la recette ; preuves locales : ${directory}`);
  throw error;
} finally {
  fixture.releaseCreate.resolve(); fixture.releasePayment.resolve();
  await browser?.close().catch(() => {});
  if (next && next.exitCode === null && next.signalCode === null) {
    const exited = once(next, 'exit');
    next.kill('SIGTERM');
    try { await deadline(exited, 10_000, 'Arrêt Next lent.'); }
    catch { next.kill('SIGKILL'); await deadline(exited, 5_000, 'Le processus enfant ne s’arrête pas.'); }
  }
  api.closeAllConnections();
  if (api.listening) await new Promise(resolve => api.close(resolve));
  // Only non-sensitive fixture routes are recorded. Logs stay outside the repo.
  await writeFile(join(directory, 'server.log'), nextLog.replace(/\?t=[^\s)]+/g, '?t=[redacted]'));
  await writeFile(join(directory, 'requests.json'), JSON.stringify(requests, null, 2));
  await writeFile(join(directory, 'console.json'), JSON.stringify({ errors, consoleMessages, remote, unexpectedHttp }, null, 2));
}

function port(name, fallback) {
  const value = Number(process.env[name] ?? fallback);
  assert.ok(Number.isInteger(value) && value >= 1024 && value <= 65535, `${name} doit être un port entre 1024 et 65535.`);
  return value;
}
async function deadline(promise, ms, message) {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(message)), ms); })]); }
  finally { clearTimeout(timer); }
}
async function until(predicate, message) {
  const end = Date.now() + 20_000;
  while (Date.now() < end) {
    if (await predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error(message);
}
