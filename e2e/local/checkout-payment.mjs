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
const { DIRECTIONS, DeliverySettingsSchema } = require(join(root, 'packages/contracts/dist/index.js'));
const scenario = process.env.QA_SCENARIO ?? 'pickup';
assert.ok(['pickup', 'delivery', 'replay', 'delivery-pricing', 'delivery-settings'].includes(scenario), 'QA_SCENARIO : pickup, delivery, replay, delivery-pricing ou delivery-settings.');
const pricingScenario = scenario === 'delivery-pricing';
const settingsScenario = scenario === 'delivery-settings';
const webPort = port('QA_WEB_PORT', 3218);
const apiPort = port('QA_API_PORT', 3219);
assert.notEqual(webPort, apiPort, 'Les deux ports doivent être distincts.');
const webOrigin = `http://127.0.0.1:${webPort}`;
const apiOrigin = `http://127.0.0.1:${apiPort}`;
const directory = await mkdtemp(join(tmpdir(), `sm-checkout-${scenario}-`));
const fulfillment = scenario.startsWith('delivery') ? 'delivery' : 'pickup';
const orderId = '507f1f77bcf86cd799439011';
const trackingToken = '11111111111111111111111111111111';
const ordersPath = '/public/tenants/livraison-e2e/orders';
const trackingPath = `/public/orders/${orderId}`;
const intentPath = `${trackingPath}/payment-intent`;
const total = settingsScenario ? 3000 : pricingScenario ? 2050 : fulfillment === 'delivery' ? 2250 : 2000;
const settingsPatches = [];
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
let deliverySettings = { enabled: true, zones: [zone], leadTimeMin: 45, slotCapacity: 2 };
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
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, OPTIONS');
  res.setHeader('Content-Type', 'application/json');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const body = chunks.length ? (req.url.startsWith('/socket.io/') ? Buffer.concat(chunks).toString() : JSON.parse(Buffer.concat(chunks).toString())) : undefined;
  requests.push({ method: req.method, url: req.url, body });
  const url = new URL(req.url, apiOrigin);
  const path = url.pathname;
  const send = (status, payload) => { res.writeHead(status); res.end(JSON.stringify(payload)); };
  if (settingsScenario && path === '/socket.io/') {
    res.setHeader('Content-Type', 'text/plain');
    res.end(req.method === 'POST' ? 'ok' : url.searchParams.has('sid') ? '40{"sid":"fixture"}' : '0{"sid":"fixture","upgrades":[],"pingInterval":60000,"pingTimeout":60000,"maxPayload":1000000}');
    return;
  }
  if (settingsScenario && path === '/auth/me') return send(200, { nom: 'Recette locale', role: 'owner', kind: 'user' });
  if (settingsScenario && path === '/tenants/me') return send(200, {
    _id: '507f1f77bcf86cd799439020', name: site.tenant.name, slug: site.tenant.slug,
    capacites: ['online', 'delivery', 'menu'], account: { status: 'active' }, orderingPaused: false,
  });
  if (settingsScenario && path === '/orders/count') return send(200, { total: 0 });
  if (settingsScenario && path === '/delivery/settings') {
    if (req.method === 'GET') return send(200, deliverySettings);
    if (req.method !== 'PATCH') return send(405, { message: 'Méthode refusée' });
    const parsed = DeliverySettingsSchema.safeParse(body);
    assert.equal(parsed.success, true, JSON.stringify(parsed.error?.issues));
    settingsPatches.push(parsed.data);
    deliverySettings = parsed.data;
    site.delivery.zones = deliverySettings.zones;
    return send(200, deliverySettings);
  }
  if (path === '/public/funnel') return send(200, { ok: true });
  if (path === '/public/tenants/livraison-e2e/site') return send(200, site);
  if (path === '/public/tenants/livraison-e2e/slots') return send(200, slots);
  if (path === '/public/tenants/livraison-e2e/delivery/quote') {
    if (body.address.postalCode !== '69001') return send(400, { message: 'Cette adresse est hors de notre zone de livraison.' });
    const discount = pricingScenario && body.promoCode === 'PROMO10'
      ? { amount: 200, reason: 'Offre de recette 10 %' } : null;
    const originalSubtotalCents = settingsScenario ? body.lines.reduce((sum, line) => sum + line.qty * 1000, 0) : 2000;
    const subtotalCents = originalSubtotalCents - (discount?.amount ?? 0);
    const currentZone = deliverySettings.zones[0];
    const threshold = currentZone.freeDeliveryFromCents ?? null;
    const feeCents = settingsScenario ? (threshold !== null && subtotalCents >= threshold ? 0 : currentZone.feeCents) : 250;
    return send(200, { zoneId: zone.id, zoneName: zone.name, feeCents, minimumOrderCents: 1500,
      originalSubtotalCents, discount, subtotalCents, totalCents: subtotalCents + feeCents, estimatedMinutes: 45,
      standardFeeCents: currentZone.feeCents, freeDeliveryFromCents: threshold,
      remainingForFreeDeliveryCents: threshold === null ? null : Math.max(0, threshold - subtotalCents) });
  }
  if (path === ordersPath && req.method === 'POST') {
    creationPosts++;
    if (pricingScenario) assert.equal(body.promoCode, 'PROMO10', 'La remise affichée doit partir avec la commande.');
    if (settingsScenario) assert.equal(body.lines.reduce((sum, line) => sum + line.qty, 0), 3);
    if (!orders.has(body.clientId)) {
      orders.set(body.clientId, {
        _id: orderId, number: 12, status: 'new', type: fulfillment,
        payment: { method: body.payment.method, status: 'pending' },
        totals: { subtotal: settingsScenario ? 3000 : 2000, discount: pricingScenario ? { amount: 200, reason: 'Offre de recette 10 %' } : null,
          deliveryFee: settingsScenario ? 0 : fulfillment === 'delivery' ? 250 : 0, total },
        pickup: body.pickup,
        delivery: fulfillment === 'delivery' ? {
          ...body.delivery, zoneId: zone.id, zoneName: zone.name, feeCents: settingsScenario ? 0 : 250, estimatedMinutes: 45,
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
  // Deliberately unknown for this regression: only the exact original POST
  // may be retried. Full successful recovery is covered by checkout-recovery.
  if (path === `${ordersPath}/recovery`) return send(404, { code: 'ORDER_RECOVERY_NOT_FOUND', message: 'Commande introuvable' });
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
  if (settingsScenario) await verifyDeliverySettings(context);
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
  assert.match(await payment.textContent(), settingsScenario ? /25,00\s*€/ : fulfillment === 'delivery' ? /22,50\s*€/ : /20,00\s*€/);
  if (fulfillment === 'pickup') await payment.getByRole('radio', { name: /Carte bancaire Paiement sécurisé en ligne/ }).click();
  if (fulfillment === 'delivery') assert.equal(await payment.getByRole('radio', { name: /Payer au comptoir/ }).count(), 0);
  if (settingsScenario) {
    await screenshot('below-free-delivery-threshold');
    for (let step = 0; step < 3; step++) await page.getByRole('button', { name: 'Étape précédente', exact: true }).click();
    await page.getByRole('button', { name: 'Plus de Burger signature', exact: true }).click();
    await page.getByRole('button', { name: /^Continuer/ }).click();
    assert.equal(await page.getByRole('button', { name: 'Coordonnées et adresse vérifiée requises' }).isDisabled(), true);
    await page.getByRole('button', { name: 'Vérifier mon adresse' }).click();
    await page.getByRole('status').filter({ hasText: /offerte/i }).waitFor();
    await screenshot('free-delivery-quote');
    await page.getByRole('button', { name: 'Choisir le créneau' }).click();
    await page.getByRole('button', { name: label, exact: true }).click();
    await page.getByRole('button', { name: /^Continuer/ }).click();
    await payment.getByRole('button', { name: /^Payer.*30,00/ }).waitFor();
    assert.equal(orders.size, 0);
    assert.equal(intents, 0);
  }
  if (pricingScenario) {
    // Le devis de livraison ne doit plus tarifer un retrait après navigation.
    for (let step = 0; step < 3; step++) await page.getByRole('button', { name: 'Étape précédente', exact: true }).click();
    await page.getByRole('radio', { name: /Retrait au restaurant/ }).click();
    await page.getByRole('button', { name: /^Continuer/ }).click();
    await page.getByRole('button', { name: 'Choisir le créneau' }).click();
    await page.getByRole('button', { name: label, exact: true }).click();
    await page.getByRole('button', { name: /^Continuer/ }).click();
    await payment.getByRole('radio', { name: /Carte bancaire Paiement sécurisé en ligne/ }).click();
    await payment.getByRole('button', { name: /^Payer.*20,00/ }).waitFor();
    assert.doesNotMatch(await payment.textContent(), /22,50\s*€/);
    await screenshot('pickup-without-delivery-fee');

    // Le même panier avec un code doit obtenir un NOUVEAU devis net, sans
    // appliquer deux fois la remise ou conserver les frais de l'ancien mode.
    for (let step = 0; step < 3; step++) await page.getByRole('button', { name: 'Étape précédente', exact: true }).click();
    await page.getByRole('radio', { name: /Livraison chez vous/ }).click();
    await page.getByText("J'ai un code promo", { exact: true }).click();
    await page.getByRole('textbox', { name: 'Code promo', exact: true }).fill('promo10');
    await page.getByRole('button', { name: /^Continuer/ }).click();
    assert.equal(await page.getByRole('button', { name: 'Coordonnées et adresse vérifiée requises' }).isDisabled(), true);
    await page.getByRole('button', { name: 'Vérifier mon adresse' }).click();
    await page.getByRole('status').filter({ hasText: 'Offre de recette 10 %' }).waitFor();
    await screenshot('delivery-net-quote');
    await page.getByRole('button', { name: 'Choisir le créneau' }).click();
    await page.getByRole('button', { name: label, exact: true }).click();
    await page.getByRole('button', { name: /^Continuer/ }).click();
    await payment.getByRole('button', { name: /^Payer.*20,50/ }).waitFor();
    assert.equal(orders.size, 0, 'Aucune commande ne doit être créée par la navigation ou le devis.');
    assert.equal(intents, 0, 'Le devis ne déclenche aucun paiement.');
  }
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await screenshot('before');
  // The card CTA includes an amount; the separate "Payer au comptoir"
  // recovery action is intentionally present for an eligible pickup.
  await payment.getByRole('button', { name: /^Payer\s+\d/ }).click();
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
    const recovery = page.getByRole('dialog', { name: 'Reprendre votre commande', exact: true });
    await recovery.waitFor();
    assert.equal(await recovery.getByRole('radio', { name: /comptoir/i }).count(), 0);
    await recovery.getByRole('button', { name: 'Réessayer cet envoi', exact: true }).click();
  }
  await page.getByRole('button', { name: 'Réessayer', exact: true }).waitFor();
  await screenshot('uncertain');
  assert.equal(await page.getByText(/vous pourrez régler au comptoir|je paie au comptoir|Je préfère régler au comptoir|À régler au comptoir/).count(), 0);
  assert.match(await page.getByRole('dialog').textContent(), /Ne (payez|réglez)/);
  assert.equal(await page.getByText('Commande confirmée', { exact: true }).count(), 0);
  await page.getByRole('button', { name: 'Réessayer', exact: true }).click();
  await page.getByText('Paiement de test sécurisé', { exact: true }).waitFor();
  const cardPayment = page.getByRole('dialog', { name: 'Paiement par carte', exact: true });
  await cardPayment.getByRole('button', { name: /^Payer\s+\d/ }).click();
  await page.getByText('Confirmation bancaire en cours', { exact: true }).waitFor();
  assert.equal(await cardPayment.getByRole('button', { name: /^Payer\s+\d/ }).isDisabled(), true);
  assert.equal(await page.getByRole('button', { name: /comptoir/ }).count(), 0);
  assert.equal(await page.getByText('Commande confirmée', { exact: true }).count(), 0);
  await screenshot('processing');
  const orderPosts = requests.filter(request => request.method === 'POST' && request.url === ordersPath);
  assert.equal(orderPosts.length, scenario === 'replay' ? 2 : 1);
  assert.equal(orders.size, 1, 'Une seule commande, même lors du rejeu de création.');
  if (scenario === 'replay') {
    assert.equal(orderPosts[0].body.clientId, orderPosts[1].body.clientId);
    assert.equal(orderPosts[0].body.payment.method, 'online');
    assert.equal(orderPosts[1].body.payment.method, 'online');
    assert.equal(orderPosts[0].body.recoveryProof, orderPosts[1].body.recoveryProof);
    const { turnstileToken: _firstChallenge, ...firstBody } = orderPosts[0].body;
    const { turnstileToken: _secondChallenge, ...secondBody } = orderPosts[1].body;
    assert.deepEqual(firstBody, secondBody, 'Le corps métier ne change pas après une réponse perdue.');
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
    (response.status === 404 && scenario === 'replay' && response.path === `${ordersPath}/recovery`) ||
    (response.status === 404 && response.path === '/public/tenants/livraison-e2e/loyalty'));
  assert.deepEqual(failedResponses, expectedFailures, 'Erreur HTTP hors pannes délibérées.');
  assert.deepEqual(consoleMessages.filter(message => !(/status of (400|404|503)/.test(message) || /Download the React DevTools/.test(message))), []);
  const result = {
    result: 'PASS', scenario, fulfillment, url: page.url(), title: await page.title(), viewport: page.viewportSize(),
    createdOrders: orders.size, checkoutOrderPosts: creationPosts, paymentIntentAttempts: intents,
    creationGuard: scenario === 'pickup', replayOnlineChoicePreserved: scenario === 'replay',
    deliveryPricingRechecked: pricingScenario,
    deliverySettingsConfigured: settingsScenario, freeDeliveryThresholdApplied: settingsScenario,
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

async function verifyDeliverySettings(context) {
  await context.addInitScript(() => {
    localStorage.setItem('sm.token.resto', `fixture.${btoa(JSON.stringify({ role: 'owner', kind: 'user', exp: 4102444800 }))}.fixture`);
    localStorage.setItem('sm-bo-nav', 'closed');
  });
  await page.goto(`${webOrigin}/admin/livraison`, { timeout: 90_000 });
  const save = page.getByRole('button', { name: 'Enregistrer et publier', exact: true });
  await page.getByRole('heading', { name: 'Votre livraison, à vos conditions.' }).waitFor();
  assert.equal(await save.isDisabled(), true, 'Un ancien réglage sans seuil ne doit pas être faussement modifié au chargement.');
  await page.getByRole('textbox', { name: 'Frais de livraison (€)', exact: true }).fill('5,00');
  await save.click();
  await page.getByText('Vos réglages sont à jour', { exact: true }).waitFor();
  assert.equal(settingsPatches.at(-1).zones[0].feeCents, 500);
  await page.getByRole('radio', { name: 'Toujours offerte', exact: true }).click();
  await save.click();
  await page.getByText('Vos réglages sont à jour', { exact: true }).waitFor();
  assert.equal(settingsPatches.at(-1).zones[0].feeCents, 0);
  assert.equal(settingsPatches.at(-1).zones[0].freeDeliveryFromCents, null);
  // Configure ensuite un seuil distinct du minimum de commande.
  await page.getByRole('radio', { name: 'Offerte dès un seuil', exact: true }).click();
  await page.getByRole('textbox', { name: 'Frais de livraison (€)', exact: true }).fill('5,00');
  await page.getByRole('textbox', { name: 'Livraison offerte dès (€)', exact: true }).fill('abc');
  await save.click();
  await page.getByRole('alert').filter({ hasText: /seuil de gratuité/ }).waitFor();
  assert.equal(settingsPatches.length, 2, 'Un seuil invalide reste bloqué avant le PATCH.');
  await page.getByRole('textbox', { name: 'Livraison offerte dès (€)', exact: true }).fill('25,00');
  await save.click();
  await page.getByText('Vos réglages sont à jour', { exact: true }).waitFor();
  assert.equal(settingsPatches.length, 3);
  assert.deepEqual(settingsPatches.at(-1).zones[0], { ...zone, feeCents: 500, freeDeliveryFromCents: 2500 });
  await page.reload();
  await page.getByRole('radio', { name: 'Offerte dès un seuil', exact: true }).waitFor();
  assert.equal(await page.getByRole('radio', { name: 'Offerte dès un seuil', exact: true }).isChecked(), true);
  assert.equal(await page.getByRole('textbox', { name: 'Frais de livraison (€)', exact: true }).inputValue(), '5,00');
  assert.equal(await page.getByRole('textbox', { name: 'Livraison offerte dès (€)', exact: true }).inputValue(), '25,00');
  assert.equal(await save.isDisabled(), true);
  await screenshot('settings-desktop');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('textbox', { name: 'Livraison offerte dès (€)', exact: true }).scrollIntoViewIfNeeded();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await screenshot('settings-mobile');
  await page.setViewportSize({ width: 1440, height: 1000 });
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
