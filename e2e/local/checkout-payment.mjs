#!/usr/bin/env node
/** Recette du vrai frontend, API/Turnstile/Stripe simulés. Voir ./README.md. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const [nodeMajor, nodeMinor] = process.versions.node.split('.').map(Number);
assert.ok(nodeMajor > 24 || (nodeMajor === 24 && nodeMinor >= 12), 'Node >=24.12.0 est requis, comme dans le dépôt.');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(join(root, 'package.json'));
const { chromium } = require('playwright');
const { DIRECTIONS } = require(join(root, 'packages/contracts/dist/index.js'));
const scenario = process.env.QA_SCENARIO ?? 'pickup';
assert.ok(['pickup', 'delivery', 'replay'].includes(scenario), 'QA_SCENARIO : pickup, delivery ou replay.');
const webPort = port('QA_WEB_PORT', 3218);
const apiPort = port('QA_API_PORT', 3219);
assert.notEqual(webPort, apiPort, 'Les deux ports doivent être distincts.');
const webOrigin = `http://127.0.0.1:${webPort}`;
const apiOrigin = `http://127.0.0.1:${apiPort}`;
const directory = await mkdtemp(join(tmpdir(), `sm-checkout-${scenario}-`));
const fulfillment = scenario === 'delivery' ? 'delivery' : 'pickup';
const orderId = '507f1f77bcf86cd799439011';
const trackingToken = '11111111111111111111111111111111';
const ordersPath = '/public/tenants/livraison-e2e/orders';
const trackingPath = `/public/orders/${orderId}`;
const intentPath = `${trackingPath}/payment-intent`;
const total = fulfillment === 'delivery' ? 2250 : 2000;
const requests = [];
const orders = new Map();
const errors = [];
const consoleMessages = [];
const failedResponses = [];
const externalRequests = [];
let intents = 0;
let creationPosts = 0;
let nextLog = '';
let next;
let browser;
let page;

// Le POST reste bloqué jusqu'à la preuve UI, pas pendant une durée arbitraire.
const creationArrived = Promise.withResolvers();
const creationRelease = Promise.withResolvers();
const slotIso = new Date(Date.now() + 90 * 60_000).toISOString();
const day = new Intl.DateTimeFormat('fr-CA', { timeZone: 'Europe/Paris' }).format(new Date(slotIso));
const label = new Intl.DateTimeFormat('fr-FR', {
  hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris',
}).format(new Date(slotIso));
const slots = {
  date: day, timezone: 'Europe/Paris', intervalMin: 10, capacity: 2, leadTimeMin: 45,
  slots: [{ iso: slotIso, label, service: 'dinner', remaining: 2, full: false, load: 'calm' }],
  closedToday: false, nextOpenDate: null, closureReason: null, paused: false,
};
const zone = { id: 'centre', name: 'Centre de Lyon', postalCodes: ['69001'], feeCents: 250, minimumOrderCents: 1500 };
const site = {
  tenant: {
    slug: 'livraison-e2e', name: 'Restaurant de test', websiteUrl: 'https://restaurant.example',
    brand: DIRECTIONS.nuit, logoUrl: null, brandColor: '#c9a15a',
    address: '12 rue des Fleurs, 69001 Lyon', phones: ['0199001234'],
    hours: [1, 2, 3, 4, 5, 6, 7].map(day => ({ day, lunch: { open: '00:00', close: '23:59' }, dinner: null })),
  },
  menu: { categories: [{ id: 'burgers', name: 'Burgers', products: [{
    id: '507f1f77bcf86cd799439010', name: 'Burger signature', description: 'Bœuf, cheddar, salade.',
    price: 1000, active: true, variants: [], optionGroups: [], removables: [], supplements: [], tags: [], outOfStock: false,
  }] }] },
  medias: [], slots, reviews: { avg: 0, count: 0, latest: [] }, ordering: { paused: false, message: null },
  delivery: { available: true, zones: [zone], leadTimeMin: 45, paymentRequired: 'online' },
  openNow: true, todayHours: { day: 1, lunch: { open: '00:00', close: '23:59' }, dinner: null }, timezone: 'Europe/Paris',
};

const api = createServer((req, res) => {
  void handleApi(req, res).catch(error => {
    errors.push(`Fixture API : ${error.message}`);
    if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ message: 'Erreur du harnais local' }));
  });
});

async function handleApi(req, res) {
  res.setHeader('Access-Control-Allow-Origin', webOrigin);
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Content-Type', 'application/json');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : undefined;
  requests.push({ method: req.method, url: req.url, body });
  const url = new URL(req.url, apiOrigin);
  const path = url.pathname;
  const send = (status, payload) => { res.writeHead(status); res.end(JSON.stringify(payload)); };
  if (path === '/public/funnel') return send(200, { ok: true });
  if (path === '/public/tenants/livraison-e2e/site') return send(200, site);
  if (path === '/public/tenants/livraison-e2e/slots') return send(200, slots);
  if (path === '/public/tenants/livraison-e2e/delivery/quote') {
    if (body.address.postalCode !== '69001') return send(400, { message: 'Cette adresse est hors de notre zone de livraison.' });
    return send(200, { zoneId: zone.id, zoneName: zone.name, feeCents: 250, minimumOrderCents: 1500, subtotalCents: 2000, totalCents: 2250, estimatedMinutes: 45 });
  }
  if (path === ordersPath && req.method === 'POST') {
    creationPosts++;
    if (!orders.has(body.clientId)) {
      orders.set(body.clientId, {
        _id: orderId, number: 12, status: 'new', type: fulfillment,
        payment: { method: body.payment.method, status: 'pending' },
        totals: { subtotal: 2000, discount: null, deliveryFee: fulfillment === 'delivery' ? 250 : 0, total },
        pickup: body.pickup,
        delivery: fulfillment === 'delivery' ? {
          ...body.delivery, zoneId: zone.id, zoneName: zone.name, feeCents: 250, estimatedMinutes: 45,
          dispatchedAt: null, deliveredAt: null, driverName: null,
        } : null,
        trackingToken,
      });
    }
    if (scenario === 'pickup' && creationPosts === 1) {
      creationArrived.resolve();
      await creationRelease.promise;
    }
    // La commande est déjà stockée : le second POST doit rejouer ce snapshot.
    if (scenario === 'replay' && creationPosts === 1) return send(503, { message: 'Réponse de création perdue : réessayez.' });
    return send(201, orders.get(body.clientId));
  }
  if (path === intentPath && req.method === 'POST') {
    if (url.searchParams.get('t') !== trackingToken || orders.size !== 1) return send(404, { message: 'Commande introuvable' });
    intents++;
    if (intents === 1) return send(503, { message: 'Paiement temporairement indisponible' });
    return send(200, {
      unavailable: false, paymentIntentId: 'pi_test', clientSecret: 'pi_test_secret',
      publishableKey: 'pk_test', stripeAccount: 'acct_test', amount: total, currency: 'eur',
    });
  }
  if (path === trackingPath && url.searchParams.get('t') === trackingToken) return send(200, {
    _id: orderId, number: 12, status: 'new', statusHistory: [{ status: 'new', at: new Date().toISOString() }],
    pickupSlot: slotIso, fulfillment,
    delivery: fulfillment === 'delivery' ? { dispatchedAt: null, deliveredAt: null, estimatedMinutes: 45 } : null,
    payment: { status: 'pending', method: 'online', refundedCents: 0, pendingRefundCents: 0 },
  });
  return send(404, { message: 'Introuvable' });
}

try {
  await new Promise((resolve, reject) => api.listen(apiPort, '127.0.0.1', resolve).once('error', reject));
  next = spawn(process.execPath, [require.resolve('next/dist/bin/next'), 'dev', '--webpack', '--hostname', '127.0.0.1', '-p', String(webPort)], {
    cwd: join(root, 'apps/web'),
    env: {
      ...process.env, NEXT_PUBLIC_API_URL: apiOrigin, NEXT_PUBLIC_SITE_URL: webOrigin,
      NEXT_PUBLIC_TURNSTILE_SITE_KEY: 'e2e_fixture', NEXT_TELEMETRY_DISABLED: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Next non prêt après 60 s ; consulter server.log.')), 60_000);
    const receive = chunk => {
      nextLog += chunk.toString();
      if (/Ready in/.test(nextLog)) { clearTimeout(timer); resolve(); }
    };
    next.stdout.on('data', receive);
    next.stderr.on('data', receive);
    next.once('error', error => { clearTimeout(timer); reject(error); });
    next.once('exit', code => { clearTimeout(timer); reject(new Error(`Next terminé prématurément (${code}).`)); });
  });
  browser = await chromium.launch({ headless: process.env.QA_HEADED !== '1' });
  const context = await browser.newContext({
    viewport: fulfillment === 'delivery' ? { width: 1440, height: 1000 } : { width: 390, height: 844 },
    locale: 'fr-FR', timezoneId: 'Europe/Paris', reducedMotion: 'reduce', serviceWorkers: 'block',
  });
  // Pas de SDK distant : les domaines Stripe/Turnstile reçoivent du JS local.
  // Toute autre sortie HTTP du navigateur échoue, y compris staging/production.
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin === webOrigin || url.origin === apiOrigin) return route.continue();
    if (url.hostname === 'challenges.cloudflare.com') return route.fulfill({ contentType: 'text/javascript', body:
      "window.turnstile={render:(_,o)=>{queueMicrotask(()=>o.callback('e2e-proof'));return 'fixture'},remove(){}}" });
    if (url.hostname === 'js.stripe.com') return route.fulfill({ contentType: 'text/javascript', body:
      "window.Stripe=()=>({elements:()=>({create:()=>({mount(n){n.textContent='Paiement de test sécurisé'},destroy(){}})}),confirmPayment:async()=>({paymentIntent:{status:'processing'}})})" });
    externalRequests.push(url.origin);
    return route.abort('blockedbyclient');
  });
  page = await context.newPage();
  page.setDefaultTimeout(20_000);
  page.on('pageerror', error => errors.push(error.message));
  page.on('response', response => {
    if (response.status() >= 400) failedResponses.push({ status: response.status(), path: new URL(response.url()).pathname });
  });
  page.on('console', message => {
    if (['warning', 'error'].includes(message.type())) consoleMessages.push(message.text());
  });
  await page.goto(`${webOrigin}/r/livraison-e2e`, { waitUntil: 'networkidle', timeout: 90_000 });
  await page.getByRole('heading', { name: 'Restaurant de test', level: 1 }).waitFor();
  assert.equal(new URL(page.url()).origin, webOrigin);
  assert.match(await page.title(), /Restaurant de test/);
  assert.equal(await page.getByRole('link', { name: 'Site du restaurant' }).getAttribute('href'), 'https://restaurant.example');
  const product = page.getByRole('region', { name: 'Burgers', exact: true }).getByRole('button', { name: /Burger signature.*ajouter au panier/ });
  await product.click();
  await product.click();
  await page.getByRole('button', { name: /Voir mon panier/ }).click();
  if (fulfillment === 'delivery') await page.getByRole('radio', { name: /Livraison chez vous/ }).click();
  await page.getByRole('button', { name: /^Continuer/ }).click();
  await page.getByRole('textbox', { name: 'Prénom et nom' }).fill('Camille Durand');
  await page.getByRole('textbox', { name: 'Téléphone', exact: true }).fill('0612345678');
  if (fulfillment === 'delivery') {
    await page.getByRole('textbox', { name: 'Numéro et rue' }).fill('12 rue des Fleurs');
    await page.getByRole('textbox', { name: 'Code postal' }).fill('69003');
    await page.getByRole('textbox', { name: 'Ville', exact: true }).fill('Lyon');
    await page.getByRole('button', { name: 'Vérifier mon adresse' }).click();
    await page.getByText('Cette adresse est hors de notre zone de livraison.').waitFor();
    assert.equal(await page.getByRole('button', { name: 'Coordonnées et adresse vérifiée requises' }).isDisabled(), true);
    await page.getByRole('textbox', { name: 'Code postal' }).fill('69001');
    await page.getByRole('button', { name: 'Vérifier mon adresse' }).click();
  }
  await page.getByRole('button', { name: 'Choisir le créneau' }).click();
  await page.getByRole('button', { name: label, exact: true }).click();
  await page.getByRole('button', { name: /^Continuer/ }).click();
  const payment = page.getByRole('dialog', { name: 'Paiement', exact: true });
  await payment.waitFor();
  assert.match(await payment.textContent(), fulfillment === 'delivery' ? /22,50\s*€/ : /20,00\s*€/);
  if (fulfillment === 'pickup') await payment.getByRole('radio', { name: /Carte bancaire Paiement sécurisé en ligne/ }).click();
  if (fulfillment === 'delivery') assert.equal(await payment.getByRole('radio', { name: /Payer au comptoir/ }).count(), 0);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await screenshot('before');
  await payment.getByRole('button', { name: /^Payer/ }).click();
  if (scenario === 'pickup') {
    await deadline(creationArrived.promise, 20_000, 'POST de création non reçu par la fixture.');
    assert.equal(await payment.getByRole('button', { name: 'Fermer', exact: true }).isDisabled(), true);
    assert.equal(await payment.getByRole('button', { name: 'Étape précédente', exact: true }).isDisabled(), true);
    await page.keyboard.press('Escape');
    assert.equal(await payment.isVisible(), true, 'Échap ne doit pas refermer pendant le POST.');
    await screenshot('creation-locked');
    creationRelease.resolve();
  }
  if (scenario === 'replay') {
    await page.getByText('Réponse de création perdue : réessayez.', { exact: true }).waitFor();
    await payment.getByRole('radio', { name: /comptoir/i }).click();
    await payment.getByRole('button', { name: /^Confirmer la commande/ }).click();
  }
  await page.getByRole('button', { name: 'Réessayer', exact: true }).waitFor();
  await screenshot('uncertain');
  assert.equal(await page.getByText(/vous pourrez régler au comptoir|je paie au comptoir|Je préfère régler au comptoir|À régler au comptoir/).count(), 0);
  assert.match(await page.getByRole('dialog').textContent(), /Ne (payez|réglez)/);
  assert.equal(await page.getByText('Commande confirmée', { exact: true }).count(), 0);
  await page.getByRole('button', { name: 'Réessayer', exact: true }).click();
  await page.getByText('Paiement de test sécurisé', { exact: true }).waitFor();
  await page.getByRole('button', { name: /^Payer/ }).click();
  await page.getByText('Confirmation bancaire en cours', { exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: /^Payer/ }).isDisabled(), true);
  assert.equal(await page.getByRole('button', { name: /comptoir/ }).count(), 0);
  assert.equal(await page.getByText('Commande confirmée', { exact: true }).count(), 0);
  await screenshot('processing');
  const orderPosts = requests.filter(request => request.method === 'POST' && request.url === ordersPath);
  assert.equal(orderPosts.length, scenario === 'replay' ? 2 : 1);
  assert.equal(orders.size, 1, 'Une seule commande, même lors du rejeu de création.');
  if (scenario === 'replay') {
    assert.equal(orderPosts[0].body.clientId, orderPosts[1].body.clientId);
    assert.equal(orderPosts[0].body.payment.method, 'online');
    assert.equal(orderPosts[1].body.payment.method, 'counter');
    assert.equal([...orders.values()][0].payment.method, 'online');
  }
  assert.equal(intents, 2);
  const intentRequests = requests.filter(request => request.method === 'POST' && new URL(request.url, apiOrigin).pathname === intentPath);
  assert.equal(intentRequests.length, 2);
  assert.equal(intentRequests[0].url, intentRequests[1].url, 'La reprise garde la même commande et le même jeton.');
  assert.equal(new URL(intentRequests[0].url, apiOrigin).searchParams.get('t'), trackingToken);
  if (fulfillment === 'delivery') {
    await page.goto(`${webOrigin}/t/${orderId}?t=${trackingToken}`, { waitUntil: 'networkidle', timeout: 90_000 });
    await page.getByRole('heading', { name: 'En attente de confirmation du paiement', exact: true }).waitFor();
    assert.equal(await page.getByText('La cuisine a votre commande', { exact: true }).count(), 0);
    await page.getByRole('button', { name: 'Reprendre le paiement', exact: true }).waitFor();
    await page.getByText(/Créneau souhaité/).waitFor();
    await screenshot('tracking-desktop', true);
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await screenshot('tracking-mobile', true);
  }
  assert.deepEqual(errors, [], 'Erreur JavaScript ou fixture.');
  assert.deepEqual(externalRequests, [], 'Une requête extérieure non simulée a été bloquée.');
  assert.equal(await page.locator('nextjs-portal').filter({ hasText: /error/i }).count(), 0);
  const expectedFailures = failedResponses.filter(response =>
    (response.status === 400 && fulfillment === 'delivery' && response.path === '/public/tenants/livraison-e2e/delivery/quote') ||
    (response.status === 503 && response.path === intentPath) ||
    (response.status === 503 && scenario === 'replay' && response.path === ordersPath) ||
    (response.status === 404 && response.path === '/public/tenants/livraison-e2e/loyalty'));
  assert.deepEqual(failedResponses, expectedFailures, 'Erreur HTTP hors pannes délibérées.');
  assert.deepEqual(consoleMessages.filter(message => !(/status of (400|404|503)/.test(message) || /Download the React DevTools/.test(message))), []);
  const result = {
    result: 'PASS', scenario, fulfillment, url: page.url(), title: await page.title(), viewport: page.viewportSize(),
    createdOrders: orders.size, checkoutOrderPosts: creationPosts, paymentIntentAttempts: intents,
    creationGuard: scenario === 'pickup', replayOnlineChoicePreserved: scenario === 'replay',
    noCounterFallback: true, processingNotPresentedAsPaid: true, unpaidDeliveryTrackingChecked: fulfillment === 'delivery',
    pageErrors: errors, consoleMessages, expectedFailures, evidence: directory,
  };
  await writeFile(join(directory, 'result.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
} catch (error) {
  if (page) {
    await screenshot('failure', true).catch(() => {});
    await writeFile(join(directory, 'failure.txt'), await page.locator('body').ariaSnapshot().catch(() => '(page fermée)'));
  }
  console.error(`Échec ${scenario} ; preuves : ${directory}`);
  throw error;
} finally {
  creationRelease.resolve();
  // Chaque fermeture porte uniquement sur les ressources créées ci-dessus.
  await browser?.close().catch(() => {});
  if (next && next.exitCode === null && next.signalCode === null) {
    const stopped = once(next, 'exit');
    next.kill('SIGTERM');
    try { await deadline(stopped, 10_000, 'Arrêt Next lent.'); }
    catch { next.kill('SIGKILL'); await deadline(stopped, 5_000, 'Le processus enfant Next ne s’arrête pas.'); }
  }
  api.closeAllConnections();
  if (api.listening) await new Promise((resolve, reject) => api.close(error => error ? reject(error) : resolve()));
  await writeFile(join(directory, 'server.log'), nextLog);
  await writeFile(join(directory, 'requests.json'), JSON.stringify(requests, null, 2));
  await writeFile(join(directory, 'console.json'), JSON.stringify({ errors, consoleMessages, failedResponses, externalRequests }, null, 2));
}

function port(name, fallback) {
  const value = Number(process.env[name] ?? fallback);
  assert.ok(Number.isInteger(value) && value >= 1024 && value <= 65535, `${name} doit être un port entre 1024 et 65535.`);
  return value;
}

async function deadline(promise, milliseconds, message) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(message)), milliseconds); })]);
  } finally { clearTimeout(timer); }
}

function screenshot(name, fullPage = false) {
  return page.screenshot({ path: join(directory, `${scenario}-${name}.png`), fullPage });
}
