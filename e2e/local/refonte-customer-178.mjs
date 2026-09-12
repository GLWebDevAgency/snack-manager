/** Real Next routes and repository controllers, synthetic local HTTP/session fixtures only. */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import { customerFixture, seedCustomerBrowserFixture } from './refonte-customer-fixture.mjs';

const base = new URL(process.env.REFONTE_WEB_URL ?? 'http://127.0.0.1:3092').origin;
assert.ok(['localhost', '127.0.0.1'].includes(new URL(base).hostname));
const phase = process.env.REFONTE_PHASE ?? 'apres';
assert.match(phase, /^[a-z0-9-]+$/);
const artifacts = resolve('docs/refonte-ui/captures', `customer-pr178-${phase}`);
await mkdir(artifacts, { recursive: true });
const browser = await chromium.launch({ headless: true });
const results = [];
const qrToken = Buffer.alloc(32, 21).toString('base64url');
const member = { id: '50000000-0000-4000-8000-000000000005', joinedAt: '2026-09-01T12:00:00.000Z', qrGeneration: 1, balanceUnits: 130, unitLabelSingular: 'point', unitLabelPlural: 'points' };
const pastOrder = { _id: 'a'.repeat(24), number: 42, createdAt: '2026-09-09T12:00:00.000Z', status: 'delivered', type: 'pickup', pickupSlot: null, totalCents: 750, payment: { method: 'counter', status: 'paid', refundedCents: 0, pendingRefundCents: 0 } };
const tabNames = ['Carte', 'Rechercher', 'Commandes', 'Fidélité', 'Compte'];
async function scenario(width, theme, state) {
  const name = `${width}-${theme}-${state}`, slug = `recette-ui-${theme}`, path = `/r/${slug}`;
  const context = await browser.newContext({ viewport: { width, height: width === 1440 ? 1000 : 844 }, serviceWorkers: 'block', reducedMotion: 'reduce' });
  const page = await context.newPage(); page.setDefaultTimeout(12000);
  // Development comparison only: the Next inspector overlaps the first tab at
  // 320px. Production recipes have no dev portal and do not add this rule.
  if (phase === 'avant') await context.addInitScript(() => document.addEventListener('DOMContentLoaded', () => {
    const style = document.createElement('style'); style.textContent = 'nextjs-portal{display:none!important}'; document.head.append(style);
  }));
  const errors = [], blocked = [], calls = [], checks = [], shots = [];
  let savedCard = false;
  let loyaltyOffer = false;
  const expiry = Date.now() + 600_000;
  const { catalog } = customerFixture(slug);
  const authenticated = state === 'connecte';
  page.on('pageerror', error => errors.push(error.message));
  await context.routeWebSocket('**/*', socket => {
    if (new URL(socket.url()).host === new URL(base).host) socket.connectToServer(); else { blocked.push(socket.url()); socket.close(); }
  });
  await context.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url()), method = request.method();
    const json = (body, status = 200) => route.fulfill({ status, json: body });
    if (![base, 'http://localhost:3001'].includes(url.origin)) { blocked.push(url.origin + url.pathname); return route.abort(); }
    if (url.origin === 'http://localhost:3001' && url.pathname.startsWith('/public/funnel')) return json({});
    if (url.origin === base && url.pathname.startsWith(path) && ['fetch', 'xhr'].includes(request.resourceType()) && !request.headers()['rsc']) {
      if (url.pathname.endsWith('/sw.js')) return route.abort();
      const body = request.postData() ? request.postDataJSON() : null;
      if (url.pathname.endsWith('/compte/capacites')) { calls.push({ method, path: url.pathname }); return json({ available: state === 'invite', registrationAvailable: state === 'invite', accessAvailable: state === 'invite' }); }
      if (url.pathname.endsWith('/compte/session') && method === 'GET' && authenticated) {
        calls.push({ method, path: url.pathname }); return json({ expiresAt: expiry, profile: { name: 'Camille Compte', phoneE164: '+33600000000', phoneVerifiedAt: 1_700_000_000_000, revision: 0 } });
      }
      if (url.pathname.endsWith('/compte/fidelite') && method === 'POST' && authenticated && ['view', 'card'].includes(body?.step)) {
        calls.push({ method, path: url.pathname, step: body.step });
        if (loyaltyOffer) return json({ state: 'available', expiresAt: expiry, profileReady: true,
          program: { ...catalog.program, id: '60000000-0000-4000-8000-000000000006', version: 1 } });
        return json({ state: body.step === 'card' ? 'card' : 'member', expiresAt: expiry, member, ...(body.step === 'card' ? { qrToken } : {}) });
      }
      if (url.pathname.endsWith('/compte/commandes/recherche') && method === 'POST' && authenticated) {
        calls.push({ method, path: url.pathname }); return json({ expiresAt: expiry, orders: [pastOrder], nextCursor: null });
      }
      if (url.pathname.endsWith('/compte/commandes/detail') && method === 'POST' && authenticated) {
        calls.push({ method, path: url.pathname }); return json({ expiresAt: expiry, order: { ...pastOrder, totals: { subtotal: 750, total: 750, deliveryFee: 0, discount: null }, lines: [{ name: 'Kebab', qty: 1, unitPrice: 750, lineTotal: 750, variantName: 'Pain', options: [], removed: [], note: null }], note: 'Note privée de recette', statusHistory: [], delivery: null } });
      }
      if (url.pathname.endsWith('/fidelite/card-session') && method === 'GET') {
        const { logoUrl: _logo, ...restaurant } = catalog.restaurant;
        calls.push({ method, path: url.pathname }); return savedCard ? json({ ...catalog, restaurant, member: { alias: 'Camille carte existante', balanceUnits: 12 }, activity: [] }) : route.fulfill({ status: 204 });
      }
      if (url.pathname.includes('/compte/') || url.pathname.includes('/card-session')) { errors.push(`Unexpected private request ${method} ${url.pathname}`); return route.abort(); }
    }
    if (method !== 'GET' && method !== 'OPTIONS') { errors.push(`Unexpected mutation ${method} ${url.pathname}`); return route.abort(); }
    return route.continue();
  });
  const tab = label => page.getByRole('tab', { name: label, exact: true });
  async function shot(label) {
    await page.evaluate(() => document.fonts.ready);
    const file = `${name}-${label}.png`; await page.screenshot({ path: resolve(artifacts, file) }); shots.push(file);
  }
  async function fit() {
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'no horizontal page overflow');
    for (const label of tabNames) {
      const box = await tab(label).boundingBox(); assert.ok(box && box.width >= 44 && box.height >= 44 && box.x >= 0 && box.x + box.width <= width + 1, `${label} touch target`);
      assert.ok(await tab(label).evaluate(node => {
        const label = [...node.querySelectorAll('span')].find(child => child.textContent === node.getAttribute('aria-label'));
        if (!label) return false;
        const range = document.createRange(); range.selectNodeContents(label);
        const text = range.getBoundingClientRect(), box = node.getBoundingClientRect();
        return text.left >= box.left - 1 && text.right <= box.right + 1;
      }), `${label} complete label fits its touch target`);
    }
  }
  try {
    await page.goto(base + path, { waitUntil: 'networkidle' }); await tab('Carte').waitFor();
    if (authenticated) { await seedCustomerBrowserFixture(page, slug); await page.reload({ waitUntil: 'networkidle' }); }
    assert.deepEqual(await page.getByRole('tab').allTextContents(), tabNames);
    await fit(); await shot('carte');
    await page.locator('.sm-order').evaluate(node => node.setAttribute('data-qa-instance', 'same'));
    const product = page.getByRole('region', { name: 'Sandwichs', exact: true }).getByRole('article', { name: 'Kebab', exact: true });
    await product.getByRole('button', { name: /composer$/ }).click();
    const dialog = page.getByRole('dialog', { name: 'Kebab', exact: true });
    await dialog.getByRole('radio', { name: /^Pain/ }).click();
    await dialog.getByRole('button', { name: /^Ajouter/ }).click();
    await page.getByRole('button', { name: /Voir mon panier/ }).waitFor();
    for (const label of tabNames.slice(1)) {
      await tab(label).click(); await tab(label).waitFor();
      await page.waitForFunction(label => [...document.querySelectorAll('[role=tab]')].some(el => el.textContent === label && el.getAttribute('aria-selected') === 'true'), label);
      if (label === 'Rechercher') await page.getByRole('searchbox', { name: 'Rechercher dans la carte' }).fill('Kebab');
      if (label === 'Commandes' && authenticated) {
        await page.getByRole('heading', { name: 'Commande n° 42', exact: true }).waitFor();
        const source = page.getByRole('tablist', { name: 'Source des commandes' });
        await source.getByRole('tab', { name: 'Mon compte', exact: true }).focus(); await page.keyboard.press('End');
        assert.equal(await source.getByRole('tab', { name: 'Cet appareil', exact: true }).getAttribute('aria-selected'), 'true');
        assert.equal(await page.getByRole('heading', { name: 'Commande n° 42', exact: true }).count(), 0);
        await page.keyboard.press('Home'); await page.getByRole('heading', { name: 'Commande n° 42', exact: true }).waitFor();
        checks.push('order source keyboard End/Home switches independent readers and removes hidden private orders');
      }
      if (label === 'Fidélité' && authenticated) {
        await page.getByText('130 points', { exact: true }).waitFor();
        if (phase !== 'avant') {
          const card = page.locator('.sm-account-balance');
          assert.equal(await card.evaluate(node => getComputedStyle(node).backgroundImage), 'none');
          const contrast = await card.evaluate(node => {
            const css = getComputedStyle(node);
            const luminance = value => value.match(/[\d.]+/g).slice(0, 3).map(Number).map(c => { c /= 255; return c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4; }).reduce((sum, c, i) => sum + c * [.2126, .7152, .0722][i], 0);
            const a = luminance(css.color), b = luminance(css.backgroundColor); return (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
          });
          assert.ok(contrast >= 4.5, `balance and note contrast ${contrast}`);
          checks.push(`opaque balance card, measured contrast ${contrast.toFixed(2)}:1`);
        }
      }
      if (label === 'Compte' && authenticated) await page.getByLabel('Votre prénom ou nom', { exact: true }).waitFor();
      if (label === 'Compte' && state === 'ferme') await page.getByText('La création et la connexion au compte ne sont pas encore ouvertes.', { exact: true }).waitFor();
      await fit(); await shot(label.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, ''));
    }
    checks.push('five real destinations; complete labels and >=44px touch targets at current width');
    await page.goBack(); await page.getByRole('heading', { name: 'Ma fidélité', exact: true }).waitFor();
    await tab('Carte').click(); await page.getByRole('button', { name: /Voir mon panier/ }).waitFor();
    assert.equal(await page.locator('.sm-order-cart-count').textContent(), '1');
    assert.equal(await page.locator('.sm-order').getAttribute('data-qa-instance'), 'same');
    await page.getByRole('button', { name: /Voir mon panier/ }).click();
    await page.getByRole('dialog', { name: 'Votre commande', exact: true }).waitFor(); await shot('panier'); await page.keyboard.press('Escape');
    checks.push('configured cart preserved through all tabs and browser Back; checkout opens with original item');
    for (const [suffix, label] of [['compte', 'Mon compte'], ['commandes', 'Mes commandes'], ['fidelite', 'Ma fidélité']]) {
      await page.goto(`${base}${path}/${suffix}`, { waitUntil: 'networkidle' }); await page.getByRole('heading', { name: label, exact: true }).waitFor(); await fit();
    }
    checks.push('direct account/orders/loyalty URLs load actual Next public shells');
    if (authenticated) {
      await page.getByRole('button', { name: 'Afficher ma carte', exact: true }).click();
      await page.getByRole('img', { name: 'QR de votre carte fidélité', exact: true }).waitFor(); await shot('qr-prive');
      await tab('Carte').click(); assert.equal(await page.getByRole('img', { name: 'QR de votre carte fidélité', exact: true }).count(), 0);
      assert.ok(!(await page.locator('body').textContent()).includes('130 points'));
      checks.push('private card read on explicit action and removed with balance when leaving loyalty');
      await tab('Compte').click(); const input = page.getByLabel('Votre prénom ou nom', { exact: true }); await input.fill('Camille brouillon');
      await page.getByRole('button', { name: 'Déconnecter cet appareil', exact: true }).click();
      await page.getByRole('button', { name: 'Annuler', exact: true }).click(); assert.equal(await input.inputValue(), 'Camille brouillon');
      checks.push('profile draft and existing logout confirmation/cancel remain usable; no mutation submitted');
      loyaltyOffer = true;
      await tab('Fidélité').click();
      const join = page.getByRole('button', { name: 'Créer ma carte gratuite', exact: true });
      await join.waitFor(); assert.equal(await join.isDisabled(), true);
      const consent = page.getByRole('checkbox'); assert.equal(await consent.isChecked(), false);
      await consent.check(); assert.equal(await join.isEnabled(), true); await shot('adhesion-explicite');
      await page.getByRole('button', { name: 'J’ai déjà une carte', exact: true }).click();
      const code = page.getByLabel('Code de votre carte', { exact: true }), attach = page.getByRole('button', { name: 'Rattacher cette carte', exact: true });
      await code.fill(qrToken); assert.equal(await page.getByRole('checkbox').isChecked(), false); assert.equal(await attach.isDisabled(), true);
      await page.getByRole('checkbox').check(); assert.equal(await attach.isEnabled(), true); await shot('rattachement-explicite');
      await code.fill('code-invalide'); assert.equal(await page.getByRole('checkbox').isChecked(), false); assert.equal(await attach.isDisabled(), true);
      await page.getByRole('button', { name: 'Annuler le rattachement', exact: true }).click();
      assert.ok(calls.filter(call => call.step).every(call => ['view', 'card'].includes(call.step)));
      checks.push('join and attachment consent start unchecked; submit enabled only after explicit consent, reset on edited code; no join/attachment submitted');
    }
    savedCard = true; await page.reload({ waitUntil: 'networkidle' });
    await page.locator('summary').filter({ hasText: 'Carte remise par le restaurant' }).click();
    await page.getByText('Solde de Camille carte existante', { exact: true }).waitFor(); await shot('carte-historique');
    await tab('Compte').click(); await tab('Fidélité').click();
    const legacy = page.locator('summary').filter({ hasText: 'Carte remise par le restaurant' });
    if (!(await legacy.evaluate(node => node.parentElement.open))) await legacy.click();
    await page.getByText('Solde de Camille carte existante', { exact: true }).waitFor();
    checks.push('legacy QR card restore remains independent across account navigation; no automatic attachment');
    if (!authenticated) assert.equal(calls.filter(call => call.method !== 'GET').length, 0);
    assert.deepEqual(errors, []); assert.deepEqual(blocked, []);
    results.push({ name, status: 'passed', checks, shots, calls, blocked, errors }); console.log(`PASS ${name}`);
  } catch (error) { await shot('echec'); results.push({ name, status: 'failed', error: String(error), checks, shots, calls, blocked, errors }); console.error(`FAIL ${name}: ${error}`); }
  finally { await context.close(); await writeFile(resolve(artifacts, 'resultats.json'), JSON.stringify(results, null, 2)); }
}
try {
  const widths = (process.env.REFONTE_WIDTHS ?? '320,390,1440').split(',').map(Number);
  const states = (process.env.REFONTE_STATES ?? 'invite,connecte,ferme').split(',');
  for (const width of widths) for (const theme of ['clair', 'sombre']) for (const state of states) await scenario(width, theme, state);
} finally { await browser.close(); }
assert.ok(results.every(result => result.status === 'passed'), 'Customer PR178 validation failed');
console.log(`${results.length}/${results.length} scenarios passed; ${results.reduce((sum, result) => sum + result.shots.length, 0)} captures`);
