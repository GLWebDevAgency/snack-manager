/** Actual Next pages, repository demo only; no account, API or external traffic. */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const base = new URL(process.env.REFONTE_WEB_URL ?? 'http://127.0.0.1:3092').origin;
assert.ok(['localhost', '127.0.0.1'].includes(new URL(base).hostname), 'Loopback Next only');
const phase = process.env.REFONTE_PHASE ?? 'navigation-site-screens';
assert.match(phase, /^[a-z0-9-]+$/);
const surfaces = process.env.REFONTE_SURFACES?.split(',') ?? ['site', 'screens'];
assert.ok(surfaces.length && surfaces.every(surface => ['site', 'screens'].includes(surface)));
const output = join(root, 'docs/refonte-ui/captures', phase);
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const results = [];

async function run(surface, width, theme) {
  const name = `${surface}-${width}-${theme}`, shots = [], faults = [], checks = [];
  const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: 'reduce', serviceWorkers: 'block' });
  await context.addInitScript(value => localStorage.setItem('sm.backoffice.theme.v1', value), theme);
  await context.route('**/*', route => {
    const request = route.request(), url = new URL(request.url());
    if (url.origin === base && request.method() === 'GET') return route.continue();
    faults.push(`${request.method()} ${url.origin}${url.pathname}`); return route.abort();
  });
  await context.routeWebSocket('**/*', socket => { faults.push(`WebSocket ${socket.url()}`); socket.close(); });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  page.on('pageerror', error => faults.push(error.message));
  const shot = async suffix => {
    if (suffix === 'adresses' || suffix === 'commande-brouillon') await page.locator('.sm-backoffice main').evaluate(node => { node.scrollTop = 0; });
    const file = `${name}-${suffix}.png`; await page.screenshot({ path: join(output, file), fullPage: false }); shots.push(file);
  };
  const noOverflow = async () => {
    const dimensions = await page.evaluate(() => ({ width: innerWidth, html: document.documentElement.scrollWidth, body: document.body.scrollWidth }));
    assert.ok(dimensions.html <= dimensions.width + 1 && dimensions.body <= dimensions.width + 1, JSON.stringify(dimensions));
  };
  const selected = async (tab, id) => {
    await tab.waitFor(); await page.waitForFunction(value => new URL(location.href).searchParams.get('section') === value, id);
    assert.equal(await tab.getAttribute('aria-selected'), 'true');
    assert.equal(new URL(page.url()).searchParams.get('demo'), '1');
    assert.equal(new URL(page.url()).searchParams.get('source'), 'recette');
  };
  try {
    const first = surface === 'site' ? 'adresses' : 'installation';
    await page.goto(`${base}/admin/${surface}?demo=1&source=recette&section=${first}`, { waitUntil: 'networkidle', timeout: 90000 });
    const shell = page.locator('.sm-backoffice'); await shell.waitFor(); assert.equal(await shell.getAttribute('data-sm-theme'), theme);
    // If the tablet rail is expanded, close it through its real control.
    if (width >= 768 && width < 1280) {
      const collapse = page.getByRole('button', { name: 'Réduire le menu', exact: true });
      if (await collapse.isVisible()) await collapse.click();
    }
    const tabs = page.getByRole('tablist', { name: surface === 'site' ? 'Rubriques du site web' : 'Rubriques des écrans de salle', exact: true });
    await tabs.waitFor();
    for (const tab of await tabs.getByRole('tab').all()) {
      const box = await tab.boundingBox(); assert.ok(box && box.height >= 44 && box.width >= 44, '44px section target');
    }
    checks.push('direct URL, preserved demo/source query, selected tab, 44px controls, theme');
    if (surface === 'site') {
      const addresses = tabs.getByRole('tab', { name: 'Adresses', exact: true });
      const ordering = tabs.getByRole('tab', { name: 'Commande en ligne', exact: true });
      await selected(addresses, 'adresses'); await page.getByRole('textbox', { name: 'Adresse du site vitrine (facultative)' }).waitFor();
      const domain = page.getByRole('textbox', { name: 'Ajouter un nom de domaine', exact: true });
      await domain.fill('restaurant-avec-un-nom-tres-long.example');
      const website = page.getByRole('textbox', { name: 'Adresse du site vitrine (facultative)' });
      await website.fill('https://restaurant-recette.example');
      await noOverflow(); await page.evaluate(() => scrollTo(0, 0)); await shot('adresses');
      await ordering.click(); await selected(ordering, 'commande');
      const restaurantName = page.getByRole('textbox', { name: 'Nom affiché', exact: true });
      await restaurantName.fill('Nom de recette conservé');
      await page.getByRole('tab', { name: 'Accueil', exact: true }).click();
      const tagline = page.getByRole('textbox', { name: 'Accroche (facultative)', exact: true });
      await tagline.fill('Accueil de recette conservé');
      await page.evaluate(() => scrollTo(0, 0)); await noOverflow(); await shot('commande-brouillon');
      await addresses.click(); await selected(addresses, 'adresses');
      assert.equal(await website.inputValue(), 'https://restaurant-recette.example');
      assert.equal(await domain.inputValue(), 'restaurant-avec-un-nom-tres-long.example');
      assert.equal(await page.getByRole('dialog').count(), 0, 'Internal tab retains drafts without exit prompt');
      await page.goBack(); await selected(ordering, 'commande');
      assert.equal(await tagline.inputValue(), 'Accueil de recette conservé');
      await page.getByRole('tab', { name: 'Identité', exact: true }).click();
      assert.equal(await restaurantName.inputValue(), 'Nom de recette conservé');
      await page.goForward(); await selected(addresses, 'adresses');
      assert.equal(await website.inputValue(), 'https://restaurant-recette.example');
      checks.push('name, brand, website and DNS drafts survive outer tabs and browser Back/Forward');
      await addresses.focus(); await page.keyboard.press('Home'); await selected(ordering, 'commande');
      assert.equal(await ordering.evaluate(node => node === document.activeElement), true);
      await page.keyboard.press('End'); await selected(addresses, 'adresses');
      assert.equal(await addresses.evaluate(node => node === document.activeElement), true);
      checks.push('Home/End updates URL and focus; inner editor selection retained');
      await ordering.click();
      await page.getByRole('button', { name: 'Agrandir', exact: true }).click();
      const preview = page.getByRole('dialog', { name: 'Aperçu de votre commande', exact: true }); await preview.waitFor();
      await page.goBack();
      assert.ok(await preview.isVisible(), 'Browser Back must not hide an open dialog or trap the page behind inert');
      await shot('apercu-retour');
      await preview.getByRole('button', { name: 'Fermer', exact: true }).last().click();
      await preview.waitFor({ state: 'hidden' }); await selected(addresses, 'adresses');
      assert.equal(await addresses.evaluate(node => node === document.activeElement), true, 'Closing the outgoing panel dialog restores focus to the active section tab');
      assert.equal(await website.inputValue(), 'https://restaurant-recette.example');
      checks.push('expanded site preview remains operable across browser Back; close reveals requested section and retained fields');
    } else {
      const installation = tabs.getByRole('tab', { name: 'Installation et services', exact: true });
      const screens = tabs.getByRole('tab', { name: 'Vos écrans', exact: true });
      await selected(installation, 'installation'); await page.getByRole('heading', { name: 'Installer un écran', exact: true }).waitFor();
      await noOverflow(); await shot('installation');
      await screens.click(); await selected(screens, 'ecrans');
      const compose = page.getByRole('button', { name: 'Composer la boucle', exact: true }).first(); await compose.waitFor();
      const count = await page.getByRole('button', { name: 'Composer la boucle', exact: true }).count();
      await noOverflow(); await shot('ecrans');
      await page.goBack(); await selected(installation, 'installation');
      await page.goForward(); await selected(screens, 'ecrans');
      assert.equal(await page.getByRole('button', { name: 'Composer la boucle', exact: true }).count(), count);
      await compose.click();
      const playlist = page.getByRole('dialog').first(); await playlist.waitFor();
      const duration = playlist.getByRole('combobox', { name: /^Durée d'affichage/ }).first();
      const originalDuration = await duration.inputValue();
      const alternative = await duration.locator('option').evaluateAll((options, current) => options.find(option => option.value !== current)?.value, originalDuration);
      assert.ok(alternative); await duration.selectOption(alternative);
      const move = playlist.getByRole('button', { name: /^Descendre/ }).first(); await move.click();
      for (const button of await playlist.getByRole('button', { name: /^(Monter|Descendre|Retirer)/ }).all()) {
        const box = await button.boundingBox(); assert.ok(box && box.width >= 44 && box.height >= 44, '44px scene controls');
      }
      await noOverflow(); await shot('playlist-brouillon');
      await playlist.getByRole('button', { name: 'Fermer', exact: true }).last().click();
      const confirm = page.getByRole('dialog', { name: 'Abandonner les modifications ?', exact: true }); await confirm.waitFor();
      await confirm.getByRole('button', { name: 'Reprendre', exact: true }).click();
      assert.equal(await playlist.getByRole('combobox', { name: /^Durée d'affichage/ }).nth(1).inputValue(), alternative);
      await playlist.getByRole('button', { name: 'Fermer', exact: true }).last().click();
      await confirm.getByRole('button', { name: 'Abandonner', exact: true }).click(); await playlist.waitFor({ state: 'hidden' });
      assert.equal(await compose.evaluate(node => node === document.activeElement), true);
      await compose.click(); await playlist.waitFor();
      assert.equal(await playlist.getByRole('combobox', { name: /^Durée d'affichage/ }).first().inputValue(), originalDuration);
      await playlist.getByRole('button', { name: 'Fermer', exact: true }).last().click(); await playlist.waitFor({ state: 'hidden' });
      checks.push('TV list retained through history; scene duration/reorder retained through cancel guard; focus restored');
      const appearanceTrigger = page.getByRole('button', { name: 'Apparence', exact: true }).first(); await appearanceTrigger.click();
      const appearance = page.getByRole('dialog', { name: /^Apparence —/ }); await appearance.waitFor();
      await appearance.getByRole('button', { name: 'Midi', exact: true }).click();
      const pause = appearance.getByRole('button', { name: 'Mettre en pause', exact: true }); await pause.click();
      assert.ok(await appearance.getByRole('button', { name: 'Reprendre la boucle', exact: true }).isVisible());
      await noOverflow(); await shot('apercu');
      await appearance.getByRole('button', { name: 'Fermer', exact: true }).last().click(); await appearance.waitFor({ state: 'hidden' });
      assert.equal(await appearanceTrigger.evaluate(node => node === document.activeElement), true);
      checks.push('real demo preview, simulated lunch service, pause, close and restored focus');
    }
    assert.deepEqual(faults, []);
    results.push({ name, status: 'passed', checks, shots, faults }); console.log(`PASS ${name}`);
  } catch (error) {
    await shot('failure'); results.push({ name, status: 'failed', message: String(error), stack: error instanceof Error ? error.stack : undefined, checks, shots, faults }); console.error(`FAIL ${name}: ${error}`);
  } finally { await context.close(); }
}
try { for (const width of [320, 768, 1440]) for (const theme of ['light', 'dark']) for (const surface of surfaces) await run(surface, width, theme); }
finally { await browser.close(); await writeFile(join(output, 'results.json'), JSON.stringify({ base, collectedAt: new Date().toISOString(), results }, null, 2) + '\n'); }
console.log(`${results.filter(result => result.status === 'passed').length}/${results.length} passed; ${results.reduce((count, result) => count + result.shots.length, 0)} captures`);
if (results.some(result => result.status !== 'passed')) process.exitCode = 1;
