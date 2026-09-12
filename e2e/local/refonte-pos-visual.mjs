/**
 * Visual regression recipe for the real Expo POS web export.
 * Uses the repository's anonymized demo snapshot and photos; all HTTP/API
 * requests are intercepted locally. No API server/account/payment is used.
 * Browser plugin not available; regular installed Playwright is used.
 * Run: REFONTE_PHASE=avant node e2e/local/refonte-pos-visual.mjs
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const snapshot = require('../../packages/client-core/src/demo/snapshot.ts');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const base = new URL(process.env.REFONTE_POS_URL ?? 'http://127.0.0.1:8092').origin;
assert.ok(['localhost', '127.0.0.1'].includes(new URL(base).hostname), 'Local POS only');
const phase = process.env.REFONTE_PHASE ?? 'avant';
assert.match(phase, /^[a-z0-9-]+$/);
const artifacts = join(root, 'docs/refonte-ui/captures', `pos-${phase}`);
await mkdir(artifacts, { recursive: true });
const tenant = { ...snapshot.SNAPSHOT_TENANT };
const device = { id: 'local-refonte-pos', kind: 'pos', kindLabel: 'Caisse', name: 'Caisse QA locale' };
const products = new Map(snapshot.SNAPSHOT_PRODUCTS.map(p => [p.id, {
  _id: p.id, name: p.name, description: p.description, price: p.price,
  variants: p.variants ?? [], optionGroups: (p.groups ?? []).map(key => snapshot.SNAPSHOT_GROUPS[key]),
  supplements: (snapshot.SNAPSHOT_SUPPLEMENT_SETS[p.supplements] ?? []).map(key => snapshot.SNAPSHOT_SUPPLEMENTS[key]),
  removables: (snapshot.SNAPSHOT_REMOVABLE_SETS[p.removables] ?? []).map(key => ({ key, label: snapshot.SNAPSHOT_REMOVABLES[key] })),
  tags: p.tags ?? [], isNew: p.isNew ?? false, outOfStock: p.outOfStock ?? false,
  active: true, photoUrl: p.photo ?? null, medias: [],
}]));
const menu = { categories: snapshot.SNAPSHOT_CATEGORIES.map(c => ({ _id: c.id, name: c.name, products: c.products.map(id => products.get(id)) })) };
const results = [];
const browser = await chromium.launch({ headless: true });

async function scenario(name, viewport, theme, layout = 'B', interactions = false) {
  const context = await browser.newContext({ viewport, serviceWorkers: 'block', reducedMotion: 'reduce' });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  const requests = [], blocked = [], consoleMessages = [], errors = [], shots = [], checks = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (['warning', 'error'].includes(message.type())) consoleMessages.push({ type: message.type(), text: message.text() }); });
  await context.routeWebSocket('**/*', socket => { blocked.push({ websocket: socket.url() }); socket.close(); });
  await context.addInitScript(({ tenant, device, theme, layout }) => {
    if (localStorage.getItem('refonte-local-seeded')) return;
    localStorage.setItem('refonte-local-seeded', '1');
    localStorage.setItem('sm.pos.device.v1', JSON.stringify({ deviceToken: 'local-fake-device', tenant, device }));
    localStorage.setItem('sm.pos.session.v1', JSON.stringify({ token: 'local-fake-staff', staffName: 'Équipier QA', staffRole: 'caisse', tenantName: tenant.name, tenantSlug: tenant.slug, brandColor: tenant.brandColor, at: Date.now() }));
    localStorage.setItem('sm.pos.prefs.v1', JSON.stringify({ theme, layout, splash: false }));
  }, { tenant, device, theme, layout });
  await context.route('**/*', async route => {
    const req = route.request(), url = new URL(req.url()), method = req.method();
    const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) });
    if (['localhost', '127.0.0.1'].includes(url.hostname) && /^\/photos\/[a-z0-9-]+\.(webp|avif|png|jpe?g)$/.test(url.pathname)) {
      requests.push([method, 'local-photo', url.pathname]);
      return route.fulfill({ path: join(root, 'apps/web/public', url.pathname), headers: { 'access-control-allow-origin': '*' } });
    }
    if (url.origin === base && !['xhr', 'fetch'].includes(req.resourceType())) return route.continue();
    if (url.origin !== 'http://localhost:3001') { blocked.push([method, url.origin, url.pathname]); return route.abort(); }
    requests.push([method, 'fixture', url.pathname]);
    if (method === 'OPTIONS') return json({});
    if (url.pathname.includes('/socket.io')) return json({ message: 'Local fixture: socket disabled' }, 400);
    if (url.pathname.endsWith('/heartbeat')) return json({ tenant, device });
    if (url.pathname.endsWith('/menu')) return json(menu);
    if (url.pathname === '/orders/count') return json({ total: 0 });
    if (url.pathname === '/orders' && method === 'GET') return json({ rows: [], total: 0, truncated: false });
    return json({ message: `Unhandled local fixture ${method} ${url.pathname}` }, 404);
  });
  async function shot(suffix) {
    const file = `${name}-${suffix}.png`;
    await page.screenshot({ path: join(artifacts, file), fullPage: true });
    shots.push(file);
  }
  async function openTicket() {
    const open = page.getByRole('button', { name: /^Ouvrir le ticket,/ });
    if (await open.count()) await open.click();
  }
  async function closeTicket() {
    const close = page.getByRole('button', { name: 'Replier le ticket', exact: true });
    if (await close.count()) await close.click();
  }
  try {
    await page.goto(base);
    await page.getByRole('button', { name: /^Végétarien,/ }).waitFor({ timeout: 60000 });
    assert.equal(new URL(page.url()).origin, base);
    assert.ok(await page.title());
    await page.getByRole('tab', { name: 'Gourmets Burgers', exact: true }).click();
    await page.getByRole('button', { name: /^Le Classic,/ }).waitFor();
    await page.evaluate(() => document.fonts.ready);
    await shot('catalogue');
    if (interactions) {
      await page.keyboard.press('Tab');
      await page.getByRole('button', { name: /^Le Classic,/ }).focus();
      await page.waitForFunction(() => {
        const element = document.activeElement;
        return element?.matches(':focus-visible') && getComputedStyle(element).outlineWidth === '3px';
      });
      await shot('focus-clavier');
      checks.push('keyboard product focus visibly outlined');
    }
    await page.getByRole('button', { name: /^Le Classic,/ }).click();
    await page.getByRole('button', { name: /^Ajouter ·/ }).waitFor();
    await shot('configuration');
    await page.getByRole('button', { name: /^Ajouter ·/ }).click();
    await openTicket();
    await page.getByRole('button', { name: 'Modifier Le Classic', exact: true }).waitFor();
    assert.match(await page.locator('body').innerText(), /Sous-total · 1 article/);
    await shot('ticket');
    checks.push('category selection', 'real product configuration', 'add configured line', 'ticket item and total');
    if (interactions) {
      await page.getByRole('button', { name: 'Modifier Le Classic', exact: true }).click();
      await page.getByPlaceholder('Bien cuit, sauce à part…').fill('Sauce à part · QA locale');
      await page.getByRole('button', { name: /^Mettre à jour ·/ }).click();
      await openTicket();
      assert.match(await page.locator('body').innerText(), /Sauce à part · QA locale/);
      await closeTicket();
      await page.getByRole('button', { name: 'Paramètres du poste', exact: true }).click();
      const settings = page.getByRole('dialog', { name: 'Paramètres du poste', exact: true });
      await settings.waitFor();
      await shot('parametres');
      await page.keyboard.press('Escape');
      await settings.waitFor({ state: 'hidden' });
      await page.getByRole('button', { name: 'Paramètres du poste', exact: true }).click();
      await page.getByRole('radio', { name: /^C · Liste dense/ }).click();
      await settings.getByRole('button', { name: 'Fermer', exact: true }).last().click();
      await shot('liste-dense');
      const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('sm.pos.prefs.v1')));
      assert.equal(saved.layout, 'C');
      checks.push('edit note preserved', 'settings Escape dismissal', 'layout preference C persisted');
      await page.setViewportSize({ width: viewport.height, height: viewport.width });
      await shot('rotation-web');
      checks.push('web viewport rotation rendered');
    }
    const geometry = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, viewportWidth: innerWidth }));
    assert.ok(geometry.scrollWidth <= geometry.viewportWidth, `horizontal page overflow: ${JSON.stringify(geometry)}`);
    assert.deepEqual(errors, []);
    assert.equal(requests.filter(([method, source, path]) => source === 'fixture' && method === 'POST' && path === '/orders').length, 0);
    results.push({ name, viewport, theme, layout, pass: true, checks, shots, errors, consoleMessages, blocked, requests });
  } catch (error) {
    await shot('failure');
    await writeFile(join(artifacts, `${name}-failure.txt`), await page.locator('body').innerText());
    results.push({ name, viewport, theme, layout, pass: false, error: String(error), checks, shots, errors, consoleMessages, blocked, requests });
    throw error;
  } finally {
    await writeFile(join(artifacts, 'resultats.json'), JSON.stringify({ phase, base, fixture: 'packages/client-core/src/demo/snapshot.ts', browser: 'Playwright Chromium; Browser plugin not available', results }, null, 2));
    await context.close();
  }
}
try {
  for (const theme of ['light', 'dark']) {
    await scenario(`desktop-${theme}`, { width: 1512, height: 982 }, theme, 'B', true);
    await scenario(`tablette-${theme}`, { width: 820, height: 1180 }, theme);
    await scenario(`mobile-${theme}`, { width: 390, height: 844 }, theme);
  }
  await scenario('desktop-rail-light', { width: 1512, height: 982 }, 'light', 'A');
  console.log(JSON.stringify({ phase, pass: true, scenarios: results.length, artifacts }));
} finally { await browser.close(); }
