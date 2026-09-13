/** Real Next back-office demo: internal sections and desktop/tablet navigation. */
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const base = new URL(process.env.REFONTE_WEB_URL ?? 'http://127.0.0.1:3092').origin;
assert.ok(['localhost', '127.0.0.1'].includes(new URL(base).hostname), 'Loopback Next only');
const phase = process.env.REFONTE_PHASE ?? 'navigation-hours-billing-shell';
assert.match(phase, /^[a-z0-9-]+$/);
const out = join(root, 'docs/refonte-ui/captures', phase);
await mkdir(out, { recursive: true });
const localBuildId = (await readFile(join(root, 'apps/web/.next/BUILD_ID'), 'utf8')).trim();
const expectedBuild = process.env.REFONTE_BUILD_ID;
if (expectedBuild) assert.equal(localBuildId, expectedBuild, 'Expected local Next build');
const browser = await chromium.launch({ headless: true });
const results = [];

async function scenario(name, width, theme, run, preference) {
  const record = { name, width, theme, checks: [], shots: [], faults: [] };
  const context = await browser.newContext({ viewport: { width, height: 920 }, reducedMotion: 'reduce', serviceWorkers: 'block' });
  await context.addInitScript(({ theme, preference }) => {
    localStorage.setItem('sm.backoffice.theme.v1', theme);
    if (preference !== undefined) localStorage.setItem('sm-bo-nav', preference);
  }, { theme, preference });
  await context.route('**/*', route => {
    const request = route.request(), url = new URL(request.url());
    if (url.origin === base && request.method() === 'GET') return route.continue();
    record.faults.push(`${request.method()} ${url.origin}${url.pathname}`); return route.abort();
  });
  await context.routeWebSocket('**/*', socket => { record.faults.push(`WebSocket ${socket.url()}`); socket.close(); });
  const page = await context.newPage(); page.setDefaultTimeout(15000);
  page.on('pageerror', error => record.faults.push(error.message));
  const shot = async suffix => {
    await page.locator('main').evaluate(node => { node.scrollTop = 0; });
    const file = `${name}-${suffix}.png`; await page.screenshot({ path: join(out, file) }); record.shots.push(file);
  };
  const go = async path => {
    await page.goto(base + path, { waitUntil: 'networkidle', timeout: 90000 });
    await page.locator('.sm-backoffice').waitFor();
    await page.locator('main [role=tablist]').waitFor();
    assert.equal(await page.locator('.sm-backoffice').getAttribute('data-sm-theme'), theme);
  };
  const noOverflow = async () => {
    const size = await page.evaluate(() => ({ width: innerWidth, document: document.documentElement.scrollWidth, body: document.body.scrollWidth, main: document.querySelector('main').clientWidth, mainScroll: document.querySelector('main').scrollWidth }));
    assert.ok(size.document <= size.width + 1 && size.body <= size.width + 1 && size.mainScroll <= size.main + 1, JSON.stringify(size));
  };
  try { await run({ page, record, go, shot, noOverflow }); assert.deepEqual(record.faults, []); record.passed = true; console.log(`PASS ${name}`); }
  catch (error) { record.failure = error.stack ?? String(error); await shot('failure').catch(() => {}); console.error(`FAIL ${name}: ${error}`); }
  finally { results.push(record); await context.close(); await writeFile(join(out, 'results.json'), JSON.stringify({ base, localBuildId, collectedAt: new Date().toISOString(), results }, null, 2) + '\n'); }
}

async function active(page, name) {
  await page.getByRole('tabpanel', { name, exact: true }).waitFor();
  assert.equal(await page.getByRole('tab', { name, exact: true }).getAttribute('aria-selected'), 'true');
  assert.equal(new URL(page.url()).searchParams.get('demo'), '1');
  assert.equal(new URL(page.url()).searchParams.get('source'), 'recette');
}
const tabsFor = { hours: ['Ouverture', 'Fermetures', 'Commande en ligne'], abonnement: ['Vue d’ensemble', 'Factures', 'Informations'] };
async function pageScenario(route, width, theme) {
  await scenario(`${route}-${width}-${theme}`, width, theme, async ({ page, record, go, shot, noOverflow }) => {
    await go(`/admin/${route}?demo=1&source=recette&section=${route === 'hours' ? 'ouverture' : 'informations'}`);
    const tab = name => page.getByRole('tab', { name, exact: true });
    await active(page, route === 'hours' ? 'Ouverture' : 'Informations');
    if (width === 768) assert.equal(await page.getByRole('button', { name: 'Développer le menu', exact: true }).isVisible(), true);
    if (route === 'hours') {
      const opening = page.getByLabel('Mardi midi — ouverture', { exact: true }); await opening.fill('12:15');
      await tab('Fermetures').click(); await active(page, 'Fermetures');
      await page.goBack(); await active(page, 'Ouverture'); assert.equal(await opening.inputValue(), '12:15');
      await page.goForward(); await active(page, 'Fermetures');
      await tab('Commande en ligne').click(); await active(page, 'Commande en ligne');
      // Repository demo intentionally omits capability claims. The production
      // capability-bound slot editor is covered by the isolated page/API test.
      assert.equal(await page.getByLabel('Commandes par créneau', { exact: true }).count(), 0);
      const message = page.getByLabel('Message de pause', { exact: true }); await message.fill('Message local non enregistré');
      await tab('Ouverture').click(); await active(page, 'Ouverture'); assert.equal(await opening.inputValue(), '12:15');
      await tab('Commande en ligne').click(); await active(page, 'Commande en ligne');
      assert.equal(await message.inputValue(), 'Message local non enregistré');
      record.checks.push('Weekly opening and pause-message drafts retained through sections and Back/Forward; slot editor unavailable in capability-free repository demo, separately covered by page/API fixture');
    } else {
      const company = page.getByLabel('Raison sociale', { exact: true }); await company.fill('Restaurant local non enregistré');
      await tab('Factures').click(); await active(page, 'Factures');
      await page.goBack(); await active(page, 'Informations'); assert.equal(await company.inputValue(), 'Restaurant local non enregistré');
      await page.goForward(); await active(page, 'Factures');
      assert.ok(await page.getByRole('button', { name: /Télécharger la facture/ }).count() > 0);
      if (width < 768) assert.ok(await page.getByRole('article', { name: /^Facture / }).count() > 0);
      record.checks.push('Billing identity draft retained through history; original invoice download actions; mobile invoice cards');
    }
    for (const name of tabsFor[route]) {
      await tab(name).click(); await active(page, name); await noOverflow();
      const buttons = await page.getByRole('tab').evaluateAll(nodes => nodes.map(node => ({ height: node.getBoundingClientRect().height, width: node.getBoundingClientRect().width, clipped: node.scrollWidth > node.clientWidth + 1 })));
      assert.ok(buttons.every(button => button.height >= 44 && button.width >= 44 && !button.clipped));
      await shot(new URL(page.url()).searchParams.get('section'));
    }
    await tab(tabsFor[route][2]).focus(); await page.keyboard.press('Home'); await active(page, tabsFor[route][0]);
    assert.equal(await tab(tabsFor[route][0]).evaluate(node => node === document.activeElement), true);
    await page.keyboard.press('End'); await active(page, tabsFor[route][2]);
    assert.equal(await tab(tabsFor[route][2]).evaluate(node => node === document.activeElement), true);
    record.checks.push('All sections, 44px targets, no document/main overflow, theme, direct URL/query preservation and Home/End focus');
  });
}

async function menuState(page, open) {
  const control = page.getByRole('button', { name: open ? 'Réduire le menu' : 'Développer le menu', exact: true });
  await control.waitFor();
  await page.waitForFunction(expected => Math.abs(document.querySelector('aside').getBoundingClientRect().width - expected) < 1, open ? 232 : 66);
}
try {
  for (const width of [320, 768, 1440]) for (const theme of ['light', 'dark']) for (const route of ['hours', 'abonnement']) await pageScenario(route, width, theme);
  await scenario('tablet-default-and-history', 768, 'light', async ({ page, record, go, shot, noOverflow }) => {
    await go('/admin/hours?demo=1&source=recette'); await menuState(page, false);
    assert.equal(await page.evaluate(() => localStorage.getItem('sm-bo-nav')), null);
    await page.getByRole('button', { name: 'Développer le menu', exact: true }).click(); await menuState(page, true); await shot('open');
    await page.getByRole('navigation', { name: 'Navigation principale', exact: true }).getByRole('link', { name: 'Abonnement', exact: true }).click();
    await page.waitForURL(url => url.pathname === '/admin/abonnement'); await menuState(page, false);
    assert.equal(new URL(page.url()).searchParams.get('demo'), '1');
    await page.goBack(); await page.waitForURL(url => url.pathname === '/admin/hours'); await page.getByRole('tab', { name: 'Ouverture', exact: true }).waitFor(); await menuState(page, false);
    assert.equal(await page.evaluate(() => localStorage.getItem('sm-bo-nav')), null); await noOverflow(); await shot('back-stays-closed');
    record.checks.push('Tablet starts closed without saved preference; opens explicitly; route B and browser Back to A both close it; desktop preference untouched');
  });
  for (const preference of ['open', 'closed']) await scenario(`desktop-preference-${preference}`, 1440, 'dark', async ({ page, record, go, shot, noOverflow }) => {
    await go('/admin/hours?demo=1&source=recette'); await menuState(page, preference === 'open');
    await page.setViewportSize({ width: 768, height: 920 }); await menuState(page, false);
    await page.getByRole('button', { name: 'Développer le menu', exact: true }).click(); await menuState(page, true);
    assert.equal(await page.evaluate(() => localStorage.getItem('sm-bo-nav')), preference);
    await page.setViewportSize({ width: 1440, height: 920 }); await menuState(page, preference === 'open');
    assert.equal(await page.evaluate(() => localStorage.getItem('sm-bo-nav')), preference);
    await noOverflow(); await shot('desktop-restored');
    record.checks.push(`Desktop ${preference} preference survives 1440→768 temporary opening→1440; tablet gesture never changes stored preference`);
  }, preference);
} finally { await browser.close(); }
console.log(`${results.filter(record => record.passed).length}/${results.length} passed; ${results.reduce((count, record) => count + record.shots.length, 0)} captures; local build ${localBuildId}`);
if (results.some(record => !record.passed)) process.exitCode = 1;
