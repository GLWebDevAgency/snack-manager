// Vrai frontend Next, API et SDK de paiement simulés : aucune transaction réelle.
// Exécution manuelle en série avec les autres recettes Next (voir README.md).
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(`${root}/package.json`);
const { chromium } = require('playwright');
const { DIRECTIONS } = require(`${root}/packages/contracts/dist/index.js`);
const webPort = port('QA_WEB_PORT', 3218);
const apiPort = port('QA_API_PORT', 3219);
assert.notEqual(webPort, apiPort, 'Les ports API et web doivent être distincts.');
const web = `http://127.0.0.1:${webPort}`;
const apiOrigin = `http://127.0.0.1:${apiPort}`;
const directory = await mkdtemp(join(tmpdir(), 'sm-counter-payment-'));
const scenarios = [];
const id = '507f1f77bcf86cd799439011';
const token = '11111111111111111111111111111111';
const orderPath = `/public/orders/${id}`;
const slot = new Date(Date.now() + 90 * 60_000).toISOString();
const day = new Intl.DateTimeFormat('fr-CA', { timeZone: 'Europe/Paris' }).format(new Date(slot));
const label = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris' }).format(new Date(slot));
const slots = { date: day, timezone: 'Europe/Paris', intervalMin: 10, capacity: 2, leadTimeMin: 20,
  slots: [{ iso: slot, label, service: 'dinner', remaining: 2, full: false, load: 'calm' }],
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
let current;
let mode;
let creationPosts;
let counterPosts;
let trackingGets;
let releaseCounter;
let holdTracking = false;
let staleTrackingArrived;
let releaseStaleTracking;
let next;
let browser;
let activePage;
const errors = [];
const consoleMessages = [];
const remote = [];
let nextLog = '';

function reset(nextMode = 'ok', type = 'pickup') {
  mode = nextMode; creationPosts = 0; counterPosts = 0; trackingGets = 0;
  releaseCounter = Promise.withResolvers();
  holdTracking = false;
  staleTrackingArrived = Promise.withResolvers();
  releaseStaleTracking = Promise.withResolvers();
  current = { _id: id, number: 12, status: 'new', type,
    payment: { method: 'online', status: 'pending' }, totals: { subtotal: 1000, discount: null, total: 1000 },
    pickup: { slot, customerName: 'Camille Durand' }, trackingToken: token };
}
function tracking() { return { _id: id, number: 12, status: current.status, statusHistory: [], pickupSlot: slot,
  fulfillment: current.type, payment: { ...current.payment, refundedCents: 0, pendingRefundCents: 0 } }; }
function ticket() { return {
  orderId: id, pickupNumber: 12, header: { tenantName: site.tenant.name, slug: 'qa', address: site.tenant.address, phones: [] },
  createdAt: slot, printedAt: slot, channel: 'online', channelLabel: 'En ligne', type: current.type, typeLabel: 'Retrait',
  status: 'new', statusLabel: 'Reçue', pickup: { slotIso: slot, slotLabel: label, customerName: 'Camille Durand', customerPhone: null },
  lines: [], totals: current.totals, note: null,
  payment: { method: 'online', methodLabel: 'Payé en ligne', tender: null, tenderLabel: null,
    status: 'pending', statusLabel: 'En attente', paid: false, cashReceived: null, changeGiven: null },
}; }
reset();
const api = createServer((req, res) => void handle(req, res).catch(error => {
  errors.push(error.message); if (!res.headersSent) res.writeHead(500); res.end('{}');
}));
async function handle(req, res) {
  res.setHeader('Access-Control-Allow-Origin', web);
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Content-Type', 'application/json');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
  const url = new URL(req.url, apiOrigin);
  const send = (status, body) => { res.writeHead(status); res.end(JSON.stringify(body)); };
  if (url.pathname === '/public/tenants/qa/site') return send(200, site);
  if (url.pathname === '/public/tenants/qa/slots') return send(200, slots);
  if (url.pathname === '/public/funnel') return send(200, { ok: true });
  if (url.pathname === '/public/tenants/qa/orders' && req.method === 'POST') {
    creationPosts++; return send(201, current);
  }
  if (!url.pathname.startsWith(orderPath) || url.searchParams.get('t') !== token) return send(404, { message: 'Introuvable' });
  if (url.pathname === orderPath) {
    trackingGets++;
    const snapshot = tracking();
    if (holdTracking) { holdTracking = false; staleTrackingArrived.resolve(); await releaseStaleTracking.promise; }
    return send(200, snapshot);
  }
  if (url.pathname === `${orderPath}/ticket`) return send(200, ticket());
  if (url.pathname === `${orderPath}/payment-intent` && req.method === 'POST') {
    if (mode === 'unavailable') return send(200, { unavailable: true, permanent: true, reason: 'Le restaurant n’a pas configuré le paiement en ligne.' });
    return send(200, { unavailable: false, paymentIntentId: 'pi_test', clientSecret: 'pi_test_secret',
      publishableKey: 'pk_test', stripeAccount: 'acct_test', amount: 1000, currency: 'eur' });
  }
  if (url.pathname === `${orderPath}/payment-counter` && req.method === 'POST') {
    counterPosts++;
    await releaseCounter.promise;
    if (mode === 'conflict') return send(409, { message: 'Le paiement bancaire est en cours de confirmation.' });
    if (mode === 'paid') { current.payment = { method: 'online', status: 'paid' }; return send(409, { message: 'La commande est déjà payée.' }); }
    current.payment = { method: 'counter', status: 'pending' };
    return send(200, { _id: id, payment: current.payment });
  }
  return send(404, { message: 'Introuvable' });
}

async function newPage({ stripeFailure = false, desktop = false } = {}) {
  const context = await browser.newContext({ viewport: desktop ? { width: 1440, height: 1000 } : { width: 390, height: 844 },
    reducedMotion: 'reduce', locale: 'fr-FR', timezoneId: 'Europe/Paris', serviceWorkers: 'block' });
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin === web || url.origin === apiOrigin) return route.continue();
    if (url.hostname === 'challenges.cloudflare.com') return route.fulfill({ contentType: 'text/javascript', body:
      "window.turnstile={render:(_,o)=>{queueMicrotask(()=>o.callback('proof'));return 'fixture'},remove(){}}" });
    if (url.hostname === 'js.stripe.com') {
      if (stripeFailure) return route.abort('failed');
      return route.fulfill({ contentType: 'text/javascript', body:
        "window.__bankCalls=0;window.Stripe=()=>({elements:()=>({create:()=>({mount(n){n.textContent='Carte de test'},destroy(){}})}),confirmPayment:()=>{window.__bankCalls++;return new Promise(resolve=>window.__resolveBank=resolve)}})" });
    }
    remote.push(`${route.request().method()} ${url.origin}${url.pathname}`); return route.abort('blockedbyclient');
  });
  const page = await context.newPage();
  activePage = page;
  page.setDefaultTimeout(15_000);
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (['warning', 'error'].includes(message.type())) consoleMessages.push(message.text());
  });
  return page;
}

async function checkout(page) {
  await page.goto(`${web}/r/qa`, { waitUntil: 'networkidle', timeout: 90_000 });
  await page.getByRole('heading', { name: site.tenant.name, level: 1 }).waitFor();
  await page.getByRole('region', { name: 'Burgers', exact: true }).getByRole('button', { name: /Burger de recette.*ajouter au panier/ }).click();
  await page.getByRole('button', { name: /Voir mon panier/ }).click();
  await page.getByRole('button', { name: /^Continuer/ }).click();
  await page.getByRole('textbox', { name: 'Prénom et nom' }).fill('Camille Durand');
  await page.getByRole('textbox', { name: 'Téléphone', exact: true }).fill('0612345678');
  await page.getByRole('button', { name: 'Choisir le créneau' }).click();
  await page.getByRole('button', { name: label, exact: true }).click();
  await page.getByRole('button', { name: /^Continuer/ }).click();
  await page.getByRole('radio', { name: /Carte bancaire Paiement sécurisé en ligne/ }).click();
  await page.getByRole('dialog', { name: 'Paiement', exact: true }).getByRole('button', { name: /^Payer/ }).click();
  await page.getByRole('dialog', { name: 'Paiement par carte', exact: true }).waitFor();
}
async function openTracking(page) {
  await page.goto(`${web}/t/${id}?t=${token}`, { waitUntil: 'networkidle', timeout: 90_000 });
  await page.getByRole('heading', { level: 1 }).waitFor();
  assert.equal(new URL(page.url()).pathname, `/t/${id}`);
  await page.getByText('Paiement en ligne à confirmer', { exact: true }).waitFor();
  assert.equal(await page.getByText('Payé en ligne', { exact: true }).count(), 0);
}
async function counterStart(page) {
  await page.getByRole('button', { name: 'Payer au comptoir', exact: true }).click();
  const confirm = page.getByRole('button', { name: 'Confirmer le choix comptoir', exact: true });
  if (mode === 'unavailable') await page.screenshot({ path: join(directory, 'counter-confirmation-mobile.png') });
  await confirm.focus();
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => [...document.querySelectorAll('button')].some(b => b.textContent.includes('Confirmer le choix comptoir') && b.disabled));
  await page.keyboard.press('Enter');
  await confirm.evaluate(button => button.click());
  await page.keyboard.press('Escape');
  assert.equal(counterPosts, 1, 'One explicit server change despite repeat/keyboard clicks.');
}
async function healthy(page, label) {
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'No horizontal clipping');
  assert.equal(await page.locator('nextjs-portal').filter({ hasText: /error/i }).count(), 0);
  await page.screenshot({ path: join(directory, `${label}.png`), fullPage: true });
  scenarios.push(label);
  console.log(`PASS ${label}`);
  await page.context().close();
  activePage = null;
}
function bankPay(page) { return page.locator('button').filter({ hasText: /^Payer/ }).filter({ hasNotText: 'comptoir' }); }

try {
  await new Promise((resolve, reject) => api.listen(apiPort, '127.0.0.1', resolve).once('error', reject));
  next = spawn(process.execPath, [require.resolve('next/dist/bin/next'), 'dev', '--webpack', '--hostname', '127.0.0.1', '-p', String(webPort)], {
    cwd: `${root}/apps/web`, env: { ...process.env, NEXT_PUBLIC_API_URL: apiOrigin, NEXT_PUBLIC_SITE_URL: web,
      NEXT_PUBLIC_TURNSTILE_SITE_KEY: 'fixture', NEXT_TELEMETRY_DISABLED: '1' }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Next startup timeout')), 60_000);
    const output = chunk => { nextLog += chunk; if (/Ready in/.test(nextLog)) { clearTimeout(timeout); resolve(); } };
    next.stdout.on('data', output); next.stderr.on('data', output);
    next.once('error', error => { clearTimeout(timeout); reject(error); });
    next.once('exit', code => { clearTimeout(timeout); reject(new Error(`Next exited ${code}: ${nextLog}`)); });
  });
  browser = await chromium.launch({ headless: process.env.QA_HEADED !== '1' });

  for (const state of ['unavailable', 'stripe-failed', 'ok']) {
    reset(state);
    const page = await newPage({ stripeFailure: state === 'stripe-failed' });
    await checkout(page);
    if (state === 'unavailable') await page.getByText(/Le restaurant n’a pas configuré le paiement en ligne/).waitFor();
    else if (state === 'stripe-failed') await page.getByText('Paiement en ligne indisponible', { exact: true }).waitFor();
    else await page.getByText('Carte de test', { exact: true }).waitFor();
    await counterStart(page);
    if (state === 'ok') {
      const pay = bankPay(page);
      assert.equal(await pay.isDisabled(), true);
      await pay.evaluate(button => button.click());
      assert.equal(await page.evaluate(() => window.__bankCalls), 0);
    }
    releaseCounter.resolve();
    await page.getByText('À régler au comptoir', { exact: true }).waitFor();
    assert.equal(creationPosts, 1); assert.equal(counterPosts, 1); assert.equal(current._id, id);
    await healthy(page, `checkout-${state}-counter`);
  }

  for (const state of ['ok', 'conflict', 'paid', 'late-get']) {
    reset(state);
    const page = await newPage({ desktop: state === 'conflict' });
    await openTracking(page);
    await page.getByRole('button', { name: 'Reprendre le paiement', exact: true }).click();
    await page.getByText('Carte de test', { exact: true }).waitFor();
    if (state === 'late-get') {
      holdTracking = true;
      await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
      await deadline(staleTrackingArrived.promise, 20_000, 'Le GET retardé du suivi ne démarre pas.');
    }
    const beforeGets = trackingGets;
    await counterStart(page);
    const pay = bankPay(page);
    assert.equal(await pay.isDisabled(), true);
    releaseCounter.resolve();
    if (state === 'ok' || state === 'late-get') await page.getByText('À régler au comptoir', { exact: true }).waitFor();
    if (state === 'late-get') {
      const oldResponse = page.waitForResponse(response => new URL(response.url()).pathname === orderPath && response.request().method() === 'GET');
      releaseStaleTracking.resolve();
      await oldResponse;
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      await page.getByText('À régler au comptoir', { exact: true }).waitFor();
      assert.equal(await page.getByRole('button', { name: 'Reprendre le paiement', exact: true }).count(), 0);
    }
    if (state === 'conflict') {
      await page.getByRole('alert').filter({ hasText: 'Le paiement bancaire est en cours de confirmation.' }).waitFor();
      await page.getByText('Paiement en ligne à confirmer', { exact: true }).waitFor();
      assert.equal(await page.getByText('À régler au comptoir', { exact: true }).count(), 0);
      assert.equal(await page.getByRole('button', { name: 'Payer au comptoir', exact: true }).count(), 0);
      assert.equal(await page.getByRole('button', { name: 'Reprendre le paiement', exact: true }).isDisabled(), true);
      assert.ok(trackingGets > beforeGets);
    }
    if (state === 'paid') {
      await page.getByText('Payé en ligne', { exact: false }).waitFor();
      assert.equal(await page.getByRole('button', { name: 'Payer au comptoir', exact: true }).count(), 0);
      assert.ok(trackingGets > beforeGets);
    }
    assert.equal(creationPosts, 0);
    await healthy(page, `tracking-${state}`);
  }

  for (const outcome of ['processing', 'succeeded']) {
    reset();
    const page = await newPage();
    await openTracking(page);
    await page.getByRole('button', { name: 'Reprendre le paiement', exact: true }).click();
    await page.getByText('Carte de test', { exact: true }).waitFor();
    await bankPay(page).click();
    assert.equal(await page.getByRole('button', { name: 'Payer au comptoir', exact: true }).isDisabled(), true);
    await page.getByRole('button', { name: 'Payer au comptoir', exact: true }).evaluate(button => button.click());
    assert.equal(counterPosts, 0);
    await page.evaluate(outcome => window.__resolveBank({ paymentIntent: { status: outcome } }), outcome);
    await page.getByRole('status').filter({ hasText: 'Paiement en cours de vérification.' }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Payer au comptoir', exact: true }).count(), 0);
    assert.equal(await page.getByText('Payé en ligne', { exact: true }).count(), 0);
    assert.equal(await page.evaluate(() => window.__bankCalls), 1);
    await healthy(page, `tracking-bank-${outcome}`);
  }

  reset('ok', 'delivery');
  const deliveryPage = await newPage();
  await openTracking(deliveryPage);
  await deliveryPage.getByRole('heading', { name: 'En attente de confirmation du paiement', exact: true }).waitFor();
  assert.equal(await deliveryPage.getByRole('button', { name: 'Payer au comptoir', exact: true }).count(), 0);
  await healthy(deliveryPage, 'delivery-no-counter');
  assert.deepEqual(errors, []); assert.deepEqual(remote, []);
  const result = { result: 'PASS', scenarios, sameOrder: true, externalRequests: remote,
    pageErrors: errors, evidence: directory, fixtures: ['API', 'Stripe.js', 'Turnstile'] };
  await writeFile(join(directory, 'result.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
} catch (error) {
  if (activePage) {
    await activePage.screenshot({ path: join(directory, 'failure.png'), fullPage: true }).catch(() => {});
    await writeFile(join(directory, 'failure.txt'), await activePage.locator('body').ariaSnapshot().catch(() => '(page fermée)'));
    await writeFile(join(directory, 'dev-overlay.txt'), await activePage.locator('nextjs-portal').innerText().catch(() => '(pas de portail)'));
  }
  console.error(`Échec ; preuves : ${directory}`);
  throw error;
} finally {
  releaseCounter.resolve();
  releaseStaleTracking.resolve();
  await browser?.close().catch(() => {});
  if (next && next.exitCode === null && next.signalCode === null) {
    const exited = once(next, 'exit');
    next.kill('SIGTERM');
    try { await deadline(exited, 10_000, 'Arrêt Next lent.'); }
    catch { next.kill('SIGKILL'); await deadline(exited, 5_000, 'Le processus Next enfant ne s’arrête pas.'); }
  }
  api.closeAllConnections();
  if (api.listening) await new Promise(resolve => api.close(resolve));
  await writeFile(join(directory, 'server.log'), nextLog);
  await writeFile(join(directory, 'console.json'), JSON.stringify({ errors, consoleMessages, remote }, null, 2));
}

function port(name, fallback) {
  const value = Number(process.env[name] ?? fallback);
  assert.ok(Number.isInteger(value) && value >= 1024 && value <= 65535, `${name} doit être un port entre 1024 et 65535.`);
  return value;
}

async function deadline(promise, ms, message) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(message)), ms); })]);
  } finally { clearTimeout(timer); }
}
