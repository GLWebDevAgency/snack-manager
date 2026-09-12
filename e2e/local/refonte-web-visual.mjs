/** Actual Next routes with repository demos/local fixtures; all non-local traffic blocked. */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const base = new URL(process.env.REFONTE_WEB_URL ?? 'http://127.0.0.1:3092').origin;
assert.ok(['localhost', '127.0.0.1'].includes(new URL(base).hostname), 'Local Next server only');
const phase = process.env.REFONTE_PHASE ?? 'avant-surfaces';
assert.match(phase, /^[a-z0-9-]+$/);
const artifacts = join(root, 'docs/refonte-ui/captures', `web-${phase}`);
await mkdir(artifacts, { recursive: true });
// Same non-private mission/session as delivery-missions.browser.test.ts.
const operatorId = 'b'.repeat(24), id = 'd'.repeat(24);
const deliverySession = { operatorId, name: 'Camille · recette', restaurantName: 'Restaurant de recette', restaurantSlug: 'recette', expiresAt: '2030-09-14T10:00:00.000Z' };
const mission = { id, number: 12, createdAt: '2026-09-07T10:00:00.000Z', scheduledAt: '2026-09-07T18:30:00.000Z', orderStatus: 'ready', revision: 2,
  operator: { id: operatorId, name: deliverySession.name }, assignmentId: '02faab2b-f0b1-47c4-b591-8e88908a91b5', assignedAt: '2026-09-07T10:00:00.000Z', dispatchedAt: null,
  paymentReady: true, canAssign: true, canDispatch: true, customer: { name: 'Client de recette', phone: null },
  address: { line1: '10 rue de la Recette', postalCode: '75001', city: 'Paris', country: 'FR' }, instructions: 'Recette locale · aucune livraison réelle', items: [{ name: 'Menu kebab', variantName: 'Fromage', qty: 2 }] };
const overview = { stages: { nouveau: 0, contacte: 0, demo: 0, proposition: 0, signe: 0, perdu: 0 }, leadsTotal: 0, leadsOpen: 0,
  founderSeats: { total: 10, taken: 0, remaining: 10, clients: 0, reserved: 0 }, mrrCents: 0, clients: 0, activeClients: 0, atRiskClients: 0, orders30d: 0, recentTouches: [] };
const browser = await chromium.launch({ headless: true });
const results = [];
async function scenario(surface, viewport, theme = 'default') {
  const name = `${surface}-${viewport.width}-${theme}`;
  const context = await browser.newContext({ viewport, serviceWorkers: 'block', reducedMotion: 'reduce' });
  const page = await context.newPage();
  page.setDefaultTimeout(30000);
  const requests = [], blocked = [], errors = [], consoleMessages = [], checks = [], shots = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (['warning', 'error'].includes(message.type())) consoleMessages.push({ type: message.type(), text: message.text() }); });
  await context.routeWebSocket('**/*', socket => {
    const url = new URL(socket.url());
    if (url.host === new URL(base).host) socket.connectToServer(); else { blocked.push({ websocket: socket.url() }); socket.close(); }
  });
  await context.addInitScript(({ theme }) => {
    if (localStorage.getItem('sm.backoffice.theme.v1') === null) localStorage.setItem('sm.backoffice.theme.v1', theme === 'dark' ? 'dark' : 'light');
    if (localStorage.getItem('sm.delivery.preferences.v2') === null) localStorage.setItem('sm.delivery.preferences.v2', JSON.stringify({ theme: theme === 'light' ? 'light' : 'dark', navigation: 'google', alerts: false, wake: false }));
    localStorage.setItem('sm.token.hq', `fixture.${btoa(JSON.stringify({ sub: 'local-qa', tenantId: null, kind: 'user', role: 'sm_admin', exp: 2200000000 }))}.fixture`);
  }, { theme });
  await context.route('**/*', async route => {
    const req = route.request(), url = new URL(req.url()), method = req.method();
    const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) });
    if (url.origin === base && url.pathname.startsWith('/livreur/') && ['xhr', 'fetch'].includes(req.resourceType())) {
      requests.push([method, url.pathname]);
      if (method !== 'GET') return json({ message: 'Mutations disabled in visual fixture' }, 405);
      if (url.pathname === '/livreur/acces') return json(deliverySession);
      if (url.pathname === '/livreur/missions') return json({ missions: [mission], nextCursor: null });
      if (url.pathname === `/livreur/missions/${id}`) return json(mission);
      if (url.pathname === `/livreur/missions/${id}/handoff`) return json({ missionId: id, revision: 0, missionRevision: 2, orderStatus: 'ready', proof: null, incident: null, canHandoff: false, canOverride: false, canRotate: false });
      if (url.pathname === '/livreur/history') return json({ missions: [], nextCursor: null });
      return json({ message: 'Unknown local delivery fixture' }, 404);
    }
    if (url.origin === base) return route.continue();
    if (url.origin === 'http://localhost:3001') {
      requests.push([method, url.pathname]);
      if (method === 'OPTIONS') return json({});
      if (method !== 'GET') return json({ message: 'Mutations disabled in visual fixture' }, 405);
      if (url.pathname === '/auth/me') return json({ id: 'local-qa', nom: 'Équipe QA locale', role: 'sm_admin', kind: 'user' });
      if (url.pathname === '/crm/overview') return json(overview);
      if (url.pathname === '/crm/ops/funnel') return json({ rows: [] });
      if (['/crm/tenants', '/crm/leads', '/crm/signals'].includes(url.pathname)) return json([]);
      return json({ message: 'Unknown local API fixture' }, 404);
    }
    blocked.push([method, url.origin, url.pathname]);
    return route.abort();
  });
  async function shot(suffix) { const file = `${name}-${suffix}.png`; await page.screenshot({ path: join(artifacts, file), fullPage: false }); shots.push(file); }
  const mask = theme === 'light' ? '&masque=brasserie' : '';
  const routes = { commande: '/r/demo?demo=1' + mask, fidelite: '/r/demo/fidelite?demo=1' + mask, livreur: '/livreur', restaurant: '/admin/dashboard?demo=1', snackmanager: '/sm' };
  try {
    await page.goto(base + routes[surface], { waitUntil: 'networkidle', timeout: 90000 });
    if (['restaurant', 'snackmanager'].includes(surface)) {
      const currentTheme = theme === 'dark' ? 'dark' : 'light';
      const shell = page.locator('.sm-backoffice');
      await shell.waitFor();
      assert.equal(await shell.getAttribute('data-sm-theme'), currentTheme);
      const path = new URL(page.url()).pathname;
      await page.getByRole('button', { name: currentTheme === 'light' ? 'Activer le thème sombre' : 'Activer le thème clair', exact: true }).click();
      assert.equal(await shell.getAttribute('data-sm-theme'), currentTheme === 'light' ? 'dark' : 'light');
      assert.equal(new URL(page.url()).pathname, path);
      await page.getByRole('button', { name: currentTheme === 'light' ? 'Activer le thème clair' : 'Activer le thème sombre', exact: true }).click();
      await page.reload({ waitUntil: 'networkidle' });
      await shell.waitFor();
      assert.equal(await shell.getAttribute('data-sm-theme'), currentTheme);
      const scheme = await shell.evaluate(el => getComputedStyle(el).colorScheme);
      assert.equal(scheme, currentTheme);
      checks.push('appearance toggle preserves route, persists after reload and changes native control color-scheme');
    }
    if (surface === 'commande') {
      await page.getByRole('heading', { name: 'Le Comptoir', level: 1, exact: true }).waitFor();
      await shot('carte');
      const item = page.getByRole('region', { name: 'Sandwichs', exact: true }).getByRole('article', { name: 'Kebab', exact: true });
      await item.scrollIntoViewIfNeeded();
      await shot('catalogue');
      await item.getByRole('button', { name: /composer$/ }).click();
      const dialog = page.getByRole('dialog', { name: 'Kebab', exact: true });
      await dialog.waitFor();
      await dialog.getByRole('radio', { name: /^Galette/ }).click();
      await shot('configuration');
      await dialog.getByRole('button', { name: /^Ajouter.*8,00/ }).click();
      await page.getByRole('button', { name: /Voir mon panier/ }).click();
      await page.getByRole('dialog', { name: 'Votre commande', exact: true }).waitFor();
      await shot('panier');
      checks.push('actual demo Storefront', 'configured paid bread option', '8 euro cart');
    } else if (surface === 'fidelite') {
      await page.getByText('Le Club Démo', { exact: true }).waitFor();
      await page.getByText('Menu signature offert', { exact: true }).waitFor();
      await shot('carte');
      const command = page.getByRole('link', { name: /Commander/ }).first();
      assert.match(await command.getAttribute('href'), /^\/r\/demo\?demo=1/);
      checks.push('shared loyalty visual components in demo', 'demo ordering link retained; no real card or QR session');
    } else if (surface === 'livreur') {
      await page.getByRole('button', { name: 'Voir la mission n°12', exact: true }).waitFor();
      await shot('missions');
      await page.getByRole('button', { name: 'Voir la mission n°12', exact: true }).click();
      await page.getByRole('dialog').waitFor();
      await shot('mission');
      await page.keyboard.press('Escape');
      await page.getByRole('dialog').waitFor({ state: 'hidden' });
      await page.getByRole('button', { name: 'Mon accès et paramètres', exact: true }).click();
      await page.getByRole('heading', { name: 'Mon compte', exact: true }).waitFor();
      await shot('compte');
      const appearance = page.getByRole('region', { name: 'Apparence', exact: true });
      await page.emulateMedia({ reducedMotion: 'no-preference' });
      await appearance.getByRole('switch', { name: /^Réduire les mouvements/ }).check();
      await appearance.getByRole('switch', { name: /^Réduire la transparence/ }).check();
      await appearance.evaluate(el => window.scrollBy({ top: el.getBoundingClientRect().top - 90, behavior: 'instant' }));
      for (const choice of await appearance.getByRole('button').all()) assert.ok(await choice.evaluate(el => el.scrollWidth <= el.clientWidth), 'theme label remains whole');
      await shot('apparence');
      await page.reload({ waitUntil: 'networkidle' });
      await page.getByRole('button', { name: 'Mon accès et paramètres', exact: true }).click();
      assert.ok(await appearance.getByRole('switch', { name: /^Réduire les mouvements/ }).isChecked());
      assert.ok(await appearance.getByRole('switch', { name: /^Réduire la transparence/ }).isChecked());
      const nav = page.getByRole('navigation', { name: 'Navigation livreur', exact: true });
      assert.equal(await nav.getAttribute('data-sm-reduce-motion'), 'true');
      assert.equal(await nav.evaluate(el => getComputedStyle(el).transitionDuration), '0s');
      const opaque = await page.getByRole('tablist', { name: 'Navigation livreur', exact: true }).evaluate(el => getComputedStyle(el).backgroundColor);
      const surface = await page.locator('.lv-preference-group').evaluate(el => getComputedStyle(el).backgroundColor);
      assert.equal(opaque, surface, 'opaque navigation uses the selected light/dark surface');
      checks.push('fixture access associated', 'mission detail and Escape', 'account preferences visible; no dispatch/handoff', 'local motion/transparency switches persist; JS navigation reduction and opaque theme surface applied');
    } else if (surface === 'restaurant') {
      await page.getByRole('heading', { name: 'Aujourd’hui', level: 1, exact: true }).waitFor();
      await shot('dashboard');
      if (viewport.width < 768) {
        const more = page.getByRole('button', { name: 'Plus', exact: true });
        await more.click();
        const nav = page.getByRole('dialog', { name: 'Navigation principale', exact: true });
        await nav.waitFor(); await shot('navigation');
        await nav.getByRole('link', { name: 'Équipe', exact: true }).click();
        await nav.waitFor({ state: 'hidden' });
      } else {
        await page.getByRole('navigation', { name: 'Navigation principale', exact: true }).getByRole('link', { name: 'Équipe', exact: true }).click();
      }
      const add = page.getByRole('button', { name: viewport.width < 640 ? 'Ajouter' : 'Ajouter un membre', exact: true });
      await add.waitFor(); await add.click();
      const form = page.getByRole('dialog', { name: 'Ajouter un membre', exact: true });
      await form.waitFor();
      const input = form.getByRole('textbox', { name: 'Nom', exact: true });
      await input.fill('Recette visuelle locale');
      await page.keyboard.press('Tab'); await page.keyboard.press('Shift+Tab');
      assert.ok(await input.evaluate(el => el === document.activeElement), 'member name focus retained');
      const retained = await input.inputValue();
      await page.evaluate(() => {
        const key = 'sm.backoffice.theme.v1';
        const next = localStorage.getItem(key) === 'dark' ? 'light' : 'dark';
        localStorage.setItem(key, next); window.dispatchEvent(new StorageEvent('storage', { key, newValue: next }));
      });
      assert.ok(await form.isVisible());
      assert.equal(await input.inputValue(), retained);
      await page.evaluate(() => {
        const key = 'sm.backoffice.theme.v1';
        const next = localStorage.getItem(key) === 'dark' ? 'light' : 'dark';
        localStorage.setItem(key, next); window.dispatchEvent(new StorageEvent('storage', { key, newValue: next }));
      });
      checks.push('open form and typed value survive appearance change from another tab');
      await shot('formulaire');
      await page.keyboard.press('Escape'); await form.waitFor({ state: 'hidden' });
      assert.ok(await add.evaluate(el => el === document.activeElement), 'member dialog returns focus');
      checks.push('real admin dashboard and team navigation with repository demo transport', 'member form fields and keyboard focus, Escape returns focus; no save');
      if (viewport.width === 1440) {
        await page.goto(base + '/admin/settings?demo=1', { waitUntil: 'networkidle' });
        const previews = page.locator('[style*="--cf-font-body"]');
        await previews.first().waitFor();
        const readPreviews = () => previews.evaluateAll(elements => elements.map(element => {
          const style = getComputedStyle(element);
          return { text: style.color, background: style.backgroundColor, font: style.fontFamily,
            ground: style.getPropertyValue('--cf-bg'), accent: style.getPropertyValue('--cf-accent'), radius: style.getPropertyValue('--cf-r') };
        }));
        const before = await readPreviews();
        await page.getByRole('button', { name: theme === 'dark' ? 'Activer le thème clair' : 'Activer le thème sombre', exact: true }).click();
        assert.deepEqual(await readPreviews(), before, 'staff appearance must not change the client masks');
        await page.getByRole('button', { name: theme === 'dark' ? 'Activer le thème sombre' : 'Activer le thème clair', exact: true }).click();
        await previews.first().scrollIntoViewIfNeeded();
        await shot('masques-preserves');
        checks.push('all customer identity previews preserve their computed colors, typography and radii across staff theme changes');
      }

    } else {
      await page.getByText('Les gestes du jour', { exact: true }).waitFor();
      await shot('dashboard-vide');
      if (viewport.width < 768) {
        const more = page.getByRole('button', { name: 'Plus', exact: true });
        await more.click(); await page.getByRole('dialog', { name: 'Plus', exact: true }).waitFor();
        await shot('navigation'); await page.keyboard.press('Escape');
        await page.getByRole('dialog', { name: 'Plus', exact: true }).waitFor({ state: 'hidden' });
        assert.ok(await more.evaluate(el => el === document.activeElement), 'HQ navigation returns focus');
      }
      await page.getByRole('navigation', { name: viewport.width < 768 ? 'Navigation interne (mobile)' : 'Navigation interne', exact: true }).getByRole('link', { name: /Prospection/ }).click();
      const add = page.getByRole('button', { name: 'Nouveau prospect', exact: true });
      await add.waitFor(); await add.click();
      const form = page.getByRole('dialog', { name: 'Nouveau prospect', exact: true });
      await form.waitFor();
      const input = form.getByRole('textbox', { name: 'Restaurant', exact: true });
      await input.fill('Restaurant de recette locale');
      await page.keyboard.press('Tab'); await page.keyboard.press('Shift+Tab');
      assert.ok(await input.evaluate(el => el === document.activeElement), 'prospect field focus retained');
      const retained = await input.inputValue();
      await page.evaluate(() => {
        const key = 'sm.backoffice.theme.v1';
        const next = localStorage.getItem(key) === 'dark' ? 'light' : 'dark';
        localStorage.setItem(key, next); window.dispatchEvent(new StorageEvent('storage', { key, newValue: next }));
      });
      assert.ok(await form.isVisible());
      assert.equal(await input.inputValue(), retained);
      await page.evaluate(() => {
        const key = 'sm.backoffice.theme.v1';
        const next = localStorage.getItem(key) === 'dark' ? 'light' : 'dark';
        localStorage.setItem(key, next); window.dispatchEvent(new StorageEvent('storage', { key, newValue: next }));
      });
      checks.push('open form and typed value survive appearance change from another tab');
      await shot('formulaire');
      await page.keyboard.press('Escape');
      assert.ok(await form.isVisible(), 'started prospect form keeps its unsaved-entry guard on Escape');
      assert.equal(await input.inputValue(), 'Restaurant de recette locale');
      if (viewport.width >= 768) {
        await form.locator(':scope > [aria-hidden="true"]').click({ position: { x: 12, y: 12 } });
        assert.ok(await form.isVisible(), 'started prospect form survives backdrop');
      }
      await page.evaluate(() => new Promise(resolve => {
        window.addEventListener('popstate', () => requestAnimationFrame(() => resolve()), { once: true });
        window.history.back();
      }));
      assert.ok(await form.isVisible(), 'started prospect form survives browser Back');
      assert.equal(await input.inputValue(), 'Restaurant de recette locale');
      for (let index = 0; index < 16; index++) {
        await page.keyboard.press('Tab');
        assert.ok(await form.evaluate(el => el.contains(document.activeElement)), 'Tab stays in prospect drawer');
      }
      await form.getByRole('button', { name: 'Annuler', exact: true }).click();
      await form.waitFor({ state: 'hidden' });
      assert.ok(await add.evaluate(el => el === document.activeElement), 'prospect drawer returns focus');
      checks.push('real HQ shell with local fake sm_admin and explicit empty dataset', 'pipeline navigation and new lead drawer fields/focus; unsaved entry survives Escape/browser Back and desktop backdrop; 16 Tabs remain inside; explicit Cancel returns focus; no save');
    }
    assert.equal(new URL(page.url()).origin, base);
    const geometry = await page.evaluate(() => ({ viewport: innerWidth, scroll: document.documentElement.scrollWidth }));
    assert.ok(geometry.scroll <= geometry.viewport, `horizontal overflow ${JSON.stringify(geometry)}`);
    assert.deepEqual(errors, []);
    results.push({ name, surface, viewport, theme, pass: true, url: page.url(), title: await page.title(), checks, shots, errors, consoleMessages, blocked, requests });
  } catch (error) {
    await shot('failure');
    await writeFile(join(artifacts, `${name}-failure.txt`), await page.locator('body').innerText());
    results.push({ name, surface, viewport, theme, pass: false, error: String(error), checks, shots, errors, consoleMessages, blocked, requests });
    throw error;
  } finally {
    await writeFile(join(artifacts, 'resultats.json'), JSON.stringify({ phase, base, note: phase.startsWith('avant') ? 'Before surface changes; shared icons already integrated. Actual Next routes with local fixtures.' : 'After surface changes; actual Next routes, repository demos and local-only delivery/HQ fixtures. Light tenant cases use the existing Brasserie demo mask.', results }, null, 2));
    await context.close();
  }
}
try {
  const surfaces = process.env.REFONTE_SURFACES?.split(',') ?? ['commande', 'fidelite', 'livreur', 'restaurant', 'snackmanager'];
  assert.ok(surfaces.every(surface => ['commande', 'fidelite', 'livreur', 'restaurant', 'snackmanager'].includes(surface)));
  for (const surface of surfaces) {
    const viewports = [{ width: 1440, height: 1000 }, { width: 390, height: 844 }];
    if (process.env.REFONTE_NARROW === '1' && ['commande', 'fidelite', 'livreur'].includes(surface)) viewports.push({ width: 320, height: 720 });
    for (const viewport of viewports) {
      await scenario(surface, viewport, ['restaurant', 'snackmanager'].includes(surface) ? 'light' : 'default');
      if (['restaurant', 'snackmanager'].includes(surface)) await scenario(surface, viewport, 'dark');
      if (['commande', 'fidelite', 'livreur'].includes(surface)) await scenario(surface, viewport, 'light');
    }
  }
  console.log(JSON.stringify({ phase, pass: true, scenarios: results.length, artifacts }));
} finally { await browser.close(); }
