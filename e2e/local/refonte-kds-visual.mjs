/** Real Expo KDS export, anonymized repository snapshot, isolated local HTTP fixtures. */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const snapshot = require('../../packages/client-core/src/demo/snapshot.ts');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const base = new URL(process.env.REFONTE_KDS_URL ?? 'http://127.0.0.1:8093').origin;
assert.ok(['localhost', '127.0.0.1'].includes(new URL(base).hostname), 'Local KDS only');
const phase = process.env.REFONTE_PHASE ?? 'avant';
assert.match(phase, /^[a-z0-9-]+$/);
const artifacts = join(root, 'docs/refonte-ui/captures', `kds-${phase}`);
await mkdir(artifacts, { recursive: true });
const tenant = { ...snapshot.SNAPSHOT_TENANT };
const device = { id: 'local-refonte-kds', name: 'Écran QA local', kind: 'kds', kindLabel: 'Écran cuisine' };
function seedOrders() {
  const rows = snapshot.SNAPSHOT_ORDERS.map((seed, index) => {
    const lines = seed.lines.map(line => {
      const product = snapshot.SNAPSHOT_PRODUCTS.find(p => p.id === line.productId);
      const variant = (product.variants ?? []).find(v => v.key === line.variantKey);
      const groups = (product.groups ?? []).map(key => snapshot.SNAPSHOT_GROUPS[key]);
      const options = line.options.map(option => {
        const group = groups.find(g => g.key === option.groupKey);
        const choice = group?.choices.find(c => c.key === option.choiceKey);
        const supplement = option.groupKey === 'supplements' ? snapshot.SNAPSHOT_SUPPLEMENTS[option.choiceKey] : undefined;
        return { ...option, name: choice?.name ?? supplement?.label ?? option.choiceKey,
          priceDelta: group?.perVariant?.[line.variantKey]?.priceDelta ?? choice?.priceDelta ?? supplement?.priceCents ?? 0 };
      });
      const unitPrice = (variant?.price ?? product.price ?? 0) + options.reduce((sum, o) => sum + o.priceDelta, 0);
      return { ...line, name: product.name, variantName: variant?.name ?? null, options, unitPrice, lineTotal: unitPrice * line.qty };
    });
    const createdAt = new Date(Date.now() - seed.ageMin * 60_000).toISOString();
    const subtotal = lines.reduce((sum, l) => sum + l.lineTotal, 0);
    return { ...seed, _id: `demo-order-${index + 1}`, clientId: `demo-client-${index + 1}`, number: index + 1,
      payment: index === 4 ? { status: 'pending', method: 'counter' } : seed.payment,
      dining: index === 4 ? { sessionId: 'local-dining-session-terrasse', tableId: 'local-table-08', tableLabel: 'Terrasse 08' } : null,
      createdAt, statusHistory: [{ status: seed.status, at: createdAt }], lines,
      totals: { subtotal, discount: null, total: subtotal },
      pickup: seed.customerName ? { slot: new Date().toISOString(), customerName: seed.customerName, customerPhone: seed.customerPhone ?? null } : null };
  });
  rows.push({ ...rows[0], _id: 'demo-order-88', clientId: 'demo-client-88', number: 88,
    payment: { status: 'pending', method: 'counter' },
    dining: { sessionId: 'local-served-session', tableId: 'local-served-table', tableLabel: 'Déjà servie', servedAt: new Date().toISOString() } });
  return rows;
}
const browser = await chromium.launch({ headless: true });
const results = [];
async function scenario(name, viewport, theme, stale = false) {
  const context = await browser.newContext({ viewport, serviceWorkers: 'block', reducedMotion: 'reduce' });
  const page = await context.newPage();
  page.setDefaultTimeout(20000);
  let rows = seedOrders();
  const requests = [], blocked = [], errors = [], consoleMessages = [], checks = [], shots = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (['warning', 'error'].includes(message.type())) consoleMessages.push({ type: message.type(), text: message.text() }); });
  await context.routeWebSocket('**/*', socket => { blocked.push({ websocket: socket.url() }); socket.close(); });
  await context.addInitScript(({ tenant, device, theme, stale, rows }) => {
    if (localStorage.getItem('refonte-local-seeded')) return;
    localStorage.setItem('refonte-local-seeded', '1');
    localStorage.setItem('sm.kds.device.v1', JSON.stringify({ deviceToken: 'local-fake-device', tenant, device }));
    localStorage.setItem('sm.kds.session.v1', JSON.stringify({ token: 'local-fake-staff', staff: { name: 'Équipe QA', role: 'cuisine' }, tenant }));
    localStorage.setItem('sm.kds.prefs.v1', JSON.stringify({ sound: false, allDay: true, theme, density: 'comfort', splash: false }));
    if (stale) localStorage.setItem('sm.kds.board.v1', JSON.stringify(rows));
  }, { tenant, device, theme, stale, rows });
  await context.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url()), method = request.method();
    const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) });
    if (url.origin === base && !['xhr', 'fetch'].includes(request.resourceType())) return route.continue();
    if (url.origin !== 'http://localhost:3001') { blocked.push([method, url.origin, url.pathname]); return route.abort(); }
    requests.push({ method, path: url.pathname, body: method === 'PATCH' ? request.postDataJSON() : null });
    if (method === 'OPTIONS') return json({});
    if (url.pathname.endsWith('/heartbeat')) return json({ tenant, device });
    if (url.pathname === '/orders' && method === 'GET') {
      if (stale) return json({ message: 'Serveur local indisponible · fixture QA' }, 503);
      const filtered = rows.filter(order => order.status === url.searchParams.get('status'));
      return json({ rows: filtered, total: filtered.length });
    }
    if (/^\/orders\/demo-order-\d+\/status$/.test(url.pathname) && method === 'PATCH') {
      const row = rows.find(order => url.pathname === `/orders/${order._id}/status`);
      const { status } = request.postDataJSON();
      assert.ok(['preparing', 'ready'].includes(status), 'KDS must never hand over a ready order');
      row.status = status;
      return json(row);
    }
    return json({ message: `Unhandled local fixture ${method} ${url.pathname}` }, 404);
  });
  async function shot(suffix) {
    const file = `${name}-${suffix}.png`;
    await page.screenshot({ path: join(artifacts, file), fullPage: true });
    shots.push(file);
  }
  try {
    await page.goto(base);
    await page.getByRole('button', { name: 'Accepter — commande numéro 5', exact: true }).waitFor({ timeout: 60000 });
    await page.evaluate(() => document.fonts.ready);
    assert.equal(new URL(page.url()).origin, base);
    assert.ok(await page.title());
    await page.getByText('Table : Terrasse 08', { exact: true }).waitFor();
    assert.equal(await page.getByText('Table : Terrasse 08', { exact: true }).count(), 1);
    assert.equal(await page.getByText('#88', { exact: true }).count(), 0);
    checks.push('table label from Order.dining is visible only on its linked ticket; already served table excluded without collecting payment');
    if (stale) {
      await page.getByText(/Serveur injoignable — le service continue hors ligne/).waitFor();
      assert.ok(await page.getByRole('button', { name: 'Accepter — commande numéro 5', exact: true }).isVisible());
      await shot('donnees-anciennes-erreur');
      checks.push('stale cached tickets preserved with error banner; distinct from empty');
    } else {
      await shot('tableau');
      if (viewport.width < 900) {
        await page.getByRole('tab', { name: /^Prêt, / }).click();
        await page.getByLabel('Remise à confirmer par la caisse — commande numéro 1', { exact: true }).waitFor();
        await shot('pretes');
        assert.equal(await page.getByRole('button', { name: /Remise à confirmer|Servir|Remettre la commande/ }).count(), 0);
        await page.getByRole('tab', { name: /^À lancer, / }).click();
        await page.getByText('Cumul Nouveau + En préparation', { exact: true }).waitFor();
        await shot('a-lancer');
        await page.getByRole('tab', { name: /^Nouveau, / }).click();
        checks.push('compact ready state stays informational', 'compact all-day production list');
      } else {
        assert.equal(await page.getByRole('button', { name: /Remise à confirmer|Servir|Remettre la commande/ }).count(), 0);
        checks.push('ready state stays informational');
      }
      await page.getByRole('button', { name: 'Téléphone', exact: true }).click();
      await page.getByText('Aucune nouvelle commande', { exact: true }).waitFor();
      await shot('filtre-vide');
      await page.getByRole('button', { name: 'Tous', exact: true }).click();
      await page.getByRole('button', { name: 'Accepter — commande numéro 5', exact: true }).waitFor();
      checks.push('channel filter empty state then restore');
      const trigger = page.getByRole('button', { name: "Paramètres de l'écran", exact: true });
      await trigger.click();
      const settings = page.getByRole('dialog', { name: "Paramètres de l'écran", exact: true });
      await settings.waitFor();
      await shot('parametres');
      await page.keyboard.press('Escape');
      await settings.waitFor({ state: 'hidden' });
      assert.equal(await trigger.evaluate(element => element === document.activeElement), true);
      checks.push('settings Escape and focus return');
      if (viewport.width === 1440) {
        await trigger.click();
        await page.getByRole('radio', { name: /^Dense\./ }).click();
        const motion = settings.getByRole('switch', { name: 'Réduire les mouvements', exact: true });
        const transparency = settings.getByRole('switch', { name: 'Réduire la transparence', exact: true });
        await motion.click();
        await transparency.click();
        assert.equal(await motion.getAttribute('aria-checked'), 'true');
        assert.equal(await transparency.getAttribute('aria-checked'), 'true');
        const backdrop = await settings.locator(':scope > div').first().evaluate(element => getComputedStyle(element).backgroundColor);
        assert.match(backdrop, /^rgb\(/, `reduced transparency uses an opaque backdrop: ${backdrop}`);
        await shot('accessibilite');
        await settings.getByRole('button', { name: 'Fermer', exact: true }).last().click();
        await page.waitForFunction(() => JSON.parse(localStorage.getItem('sm.kds.prefs.v1')).density === 'dense');
        await page.waitForFunction(() => {
          const prefs = JSON.parse(localStorage.getItem('sm.kds.prefs.v1'));
          return prefs.reduceMotion === true && prefs.reduceTransparency === true;
        });
        await page.reload();
        await page.getByRole('button', { name: 'Accepter — commande numéro 5', exact: true }).waitFor();
        await trigger.click();
        assert.equal(await settings.getByRole('switch', { name: 'Réduire les mouvements', exact: true }).getAttribute('aria-checked'), 'true');
        assert.equal(await settings.getByRole('switch', { name: 'Réduire la transparence', exact: true }).getAttribute('aria-checked'), 'true');
        await page.keyboard.press('Escape');
        await settings.waitFor({ state: 'hidden' });
        checks.push('reduce motion and transparency settings persist through reload; backdrop becomes opaque');
        await shot('dense');
        await page.getByRole('button', { name: 'Accepter — commande numéro 5', exact: true }).click();
        await page.getByRole('button', { name: 'Marquer prête — commande numéro 5', exact: true }).waitFor();
        await page.getByRole('button', { name: 'Marquer prête — commande numéro 5', exact: true }).click();
        await page.getByLabel('Remise à confirmer par la caisse — commande numéro 5', { exact: true }).waitFor();
        await page.getByText('Table : Terrasse 08', { exact: true }).waitFor();
        assert.equal(rows.find(row => row.number === 5).dining.tableLabel, 'Terrasse 08');
        await shot('avancement-pret');
        const served = rows.find(row => row.number === 5);
        served.dining.servedAt = new Date().toISOString();
        await page.getByText('Table : Terrasse 08', { exact: true }).waitFor({ state: 'hidden' });
        assert.equal(served.status, 'ready');
        assert.equal(served.payment.status, 'pending');
        await shot('table-servie');
        checks.push('server marks table served while payment stays pending: next poll removes it from pass, leaving status ready');
        checks.push('density preference persisted', 'new to preparing to ready through existing handlers');
      }
    }
    const geometry = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, width: innerWidth }));
    assert.ok(geometry.scrollWidth <= geometry.width, `horizontal overflow ${JSON.stringify(geometry)}`);
    assert.deepEqual(errors, []);
    assert.equal(requests.filter(request => request.method === 'POST' && request.path === '/orders').length, 0);
    results.push({ name, viewport, theme, stale, pass: true, checks, shots, errors, consoleMessages, blocked, requests });
  } catch (error) {
    await shot('failure');
    await writeFile(join(artifacts, `${name}-failure.txt`), await page.locator('body').innerText());
    results.push({ name, viewport, theme, stale, pass: false, error: String(error), checks, shots, errors, consoleMessages, blocked, requests });
    throw error;
  } finally {
    await writeFile(join(artifacts, 'resultats.json'), JSON.stringify({ phase, base, fixture: 'packages/client-core/src/demo/snapshot.ts', browser: 'Playwright Chromium; Browser plugin not available', results }, null, 2));
    await context.close();
  }
}
try {
  for (const theme of ['light', 'dark']) {
    for (const viewport of [{ width: 1440, height: 1000 }, { width: 1024, height: 768 }, { width: 768, height: 1024 }, { width: 390, height: 844 }]) {
      await scenario(`${viewport.width}-${theme}`, viewport, theme);
    }
    await scenario(`donnees-anciennes-${theme}`, { width: 1440, height: 1000 }, theme, true);
  }
  console.log(JSON.stringify({ phase, pass: true, scenarios: results.length, artifacts }));
} finally { await browser.close(); }
