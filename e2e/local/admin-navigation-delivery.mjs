/** Actual production Next pages; API, identity and Stripe handoff are loopback fixtures.
 * Usage: node e2e/local/admin-navigation-delivery.mjs
 * Start the built Next application separately (default http://127.0.0.1:3092),
 * built with NEXT_PUBLIC_API_URL=http://127.0.0.1:3094. No API server is needed.
 */
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { build } from 'esbuild';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const base = new URL(process.env.ADMIN_NAV_WEB_URL ?? 'http://127.0.0.1:3092').origin;
const api = new URL(process.env.ADMIN_NAV_API_URL ?? 'http://127.0.0.1:3094').origin;
for (const value of [base, api]) assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(new URL(value).hostname), 'Loopback origins only');
assert.notEqual(base, api, 'The API fixture must have its own explicit origin');
const phase = process.env.ADMIN_NAV_PHASE ?? 'admin-navigation-delivery';
assert.match(phase, /^[a-z0-9-]+$/);
const only = process.env.ADMIN_NAV_ONLY ?? 'all';
assert.ok(['all', 'livraison', 'encaissement'].includes(only));
const captures = join(root, 'docs/refonte-ui/captures', phase);
const proof = join(root, 'docs/refonte-ui/preuves', `${phase}.json`);
await mkdir(captures, { recursive: true });
await mkdir(dirname(proof), { recursive: true });
const buildId = (await readFile(join(root, 'apps/web/.next/BUILD_ID'), 'utf8')).trim();
// The tenant shape comes from the repository fixture; no .env or account data is read.
const bundle = await build({ stdin: { contents: "export {createWorld} from './apps/web/src/lib/demo/state'; export {DeliverySettingsSchema, ENCAISSEMENT_ETAT_LABELS, raisonIndisponibilite} from './packages/contracts/dist/index.js';", resolveDir: root, loader: 'ts' }, bundle: true, write: false, format: 'esm', platform: 'node' });
const { createWorld, DeliverySettingsSchema, ENCAISSEMENT_ETAT_LABELS, raisonIndisponibilite } = await import('data:text/javascript;base64,' + Buffer.from(bundle.outputFiles[0].text).toString('base64'));
const world = createWorld(Date.now());
const tenantId = '507f1f77bcf86cd799439011';
const ownerId = '507f1f77bcf86cd799439012';
const tenant = { ...world.tenant, _id: tenantId, slug: 'recette-navigation', name: 'Le Comptoir · recette locale', logoUrl: null, capacites: ['delivery', 'online'], onlineDelivery: true };
const identity = { ...world.moi, id: ownerId, tenantId, nom: 'Responsable de recette locale', email: 'recette@example.test', role: 'owner' };
const initialDelivery = { enabled: true, leadTimeMin: 45, slotCapacity: 2, zones: [{ id: 'centre', name: 'Centre-ville', postalCodes: ['69001', '69002'], feeCents: 500, minimumOrderCents: 1500, freeDeliveryFromCents: null }] };
const browser = await chromium.launch({ headless: true });
const results = [];
const startedAt = new Date().toISOString();
const persist = status => writeFile(proof, JSON.stringify({ status, scope: only, startedAt, updatedAt: new Date().toISOString(), buildId, base, api, browser: browser.version(),
  evidence: 'Actual built Next UI with in-memory API fixtures and local onboarding pages; no database, Stripe or external server contacted.',
  results }, null, 2));

function fiche(etat, disponible = true) {
  return { etat, etatLabel: ENCAISSEMENT_ETAT_LABELS[etat], peutEncaisser: etat === 'actif', raison: raisonIndisponibilite(etat), disponible,
    compte: etat === 'absent' ? null : { accountId: 'acct_LocalRecipeOnly', chargesEnabled: etat === 'actif', payoutsEnabled: etat === 'actif', detailsSubmitted: etat !== 'en_cours', raccordeLe: startedAt, synchroniseLe: startedAt } };
}

async function scenario(name, viewport, theme, run, options = {}) {
  const context = await browser.newContext({ viewport, serviceWorkers: 'block', reducedMotion: 'reduce' });
  const page = await context.newPage();
  page.setDefaultTimeout(12_000);
  const state = { delivery: structuredClone(initialDelivery), etat: options.etat ?? 'absent', disponible: options.disponible ?? true,
    requests: [], writes: [], errors: [], external: [], unknown: [], transport: [], console: [], checks: [], shots: [], syncs: 0, links: 0,
    failSync: options.failSync ?? false, failSave: false, saveGate: null, connectGate: null };
  page.on('pageerror', error => state.errors.push(error.message));
  page.on('console', message => { if (['warning', 'error'].includes(message.type())) state.console.push({ type: message.type(), text: message.text() }); });
  await context.addInitScript(({ theme, tenantId, ownerId }) => {
    localStorage.setItem('sm.backoffice.theme.v1', theme);
    localStorage.setItem('sm.token.resto', `fixture.${btoa(JSON.stringify({ sub: ownerId, tenantId, kind: 'user', role: 'owner', exp: 2200000000 }))}.fixture`);
  }, { theme, tenantId, ownerId });
  await context.routeWebSocket('**/*', socket => {
    state.transport.push({ url: socket.url(), outcome: 'closed local fixture; no live events' });
    const url = new URL(socket.url());
    if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) state.external.push({ websocket: socket.url() });
    socket.close();
  });
  await context.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url()), method = request.method();
    const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': base, 'Access-Control-Allow-Headers': 'authorization,content-type', 'Access-Control-Allow-Methods': 'GET,POST,PATCH,OPTIONS', 'Cache-Control': 'no-store' }, body: JSON.stringify(body) });
    if (url.origin === base && url.pathname.startsWith('/__local-stripe/')) {
      assert.match(url.pathname, /^\/__local-stripe\/onboarding\/\d+$/);
      return route.fulfill({ contentType: 'text/html; charset=utf-8', body: '<!doctype html><html lang="fr"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Raccordement simulé localement</title><h1>Raccordement simulé localement</h1><p>Aucun compte ni paiement Stripe réel.</p><a href="/admin/encaissement">Retour à mon restaurant</a></html>' });
    }
    if (url.origin === base) return route.continue();
    if (url.origin !== api) { state.external.push({ method, origin: url.origin, path: url.pathname }); return route.abort(); }
    if (method === 'OPTIONS') return json({});
    // The UI must remain usable without a live socket. These requests never reach a server.
    if (url.pathname === '/socket.io/') {
      state.transport.push({ method, path: url.pathname, outcome: '503 local realtime fixture' });
      return json({ message: 'No realtime server in this local navigation recipe' }, 503);
    }
    state.requests.push({ method, path: url.pathname, query: url.search });
    if (method === 'GET' && url.pathname === '/auth/me') return json(identity);
    if (method === 'GET' && url.pathname === '/tenants/me') return json(tenant);
    if (method === 'GET' && url.pathname === '/orders/count') return json({ total: 0 });
    if (method === 'GET' && url.pathname === '/delivery/operators') return json({ operators: [], candidates: [], truncated: false, nextCursor: null });
    if (method === 'GET' && url.pathname === '/delivery/settings') return json(state.delivery);
    if (method === 'PATCH' && url.pathname === '/delivery/settings') {
      const body = DeliverySettingsSchema.parse(request.postDataJSON());
      state.writes.push(body);
      if (state.saveGate) await state.saveGate;
      if (state.failSave) return json({ message: 'Échec simulé de publication locale' }, 503);
      state.delivery = body;
      return json(body);
    }
    if (method === 'POST' && url.pathname === '/encaissement/me/synchroniser') {
      state.syncs++;
      return state.failSync ? json({ message: 'Échec simulé de synchronisation locale' }, 503) : json(fiche(state.etat, state.disponible));
    }
    if (method === 'POST' && url.pathname === '/encaissement/me/raccordement') {
      state.links++;
      if (state.connectGate) await state.connectGate;
      return json({ url: `${base}/__local-stripe/onboarding/${state.links}`, expireLe: new Date(Date.now() + 600_000).toISOString() });
    }
    state.unknown.push({ method, path: url.pathname });
    return json({ message: 'Unexpected route in the explicit local recipe' }, 501);
  });
  const main = page.getByRole('main');
  async function geometry() {
    const measured = await main.evaluate(element => {
      const bounds = element.getBoundingClientRect();
      const bad = [...element.querySelectorAll('button,input,textarea,[role="tab"]')].flatMap(control => {
        const rect = control.getBoundingClientRect();
        if (!rect.width || !rect.height || getComputedStyle(control).visibility === 'hidden') return [];
        return rect.left < bounds.left - 1 || rect.right > bounds.right + 1 ? [{ text: control.getAttribute('aria-label') ?? control.textContent?.trim().slice(0, 70), left: rect.left, right: rect.right }] : [];
      });
      return { viewport: innerWidth, documentWidth: document.documentElement.scrollWidth, mainWidth: element.clientWidth, mainScroll: element.scrollWidth, bad };
    });
    assert.ok(measured.documentWidth <= measured.viewport, JSON.stringify(measured));
    assert.ok(measured.mainScroll <= measured.mainWidth + 1, JSON.stringify(measured));
    assert.deepEqual(measured.bad, [], 'Interactive controls must stay within the main scroll area');
  }
  async function shot(suffix) {
    const file = `${name}-${suffix}.png`;
    await page.screenshot({ path: join(captures, file), fullPage: false });
    state.shots.push(file);
  }
  async function open(path) {
    await page.goto(base + path, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await page.locator(`.sm-backoffice[data-sm-theme="${theme}"]`).waitFor();
  }
  async function select(label) {
    const tab = page.getByRole('tab', { name: label, exact: true });
    await tab.click();
    await page.waitForFunction(label => [...document.querySelectorAll('[role="tab"]')].some(el => el.textContent.trim() === label && el.getAttribute('aria-selected') === 'true'), label);
    const size = await tab.boundingBox();
    assert.ok(size && size.height >= 44, `${label}: accessible touch target`);
  }
  try {
    await run({ page, main, state, open, select, shot, geometry });
    assert.deepEqual(state.errors, [], 'No browser application exception');
    assert.deepEqual(state.external, [], 'No external resource should be attempted');
    assert.deepEqual(state.unknown, [], 'Every API request must be explicitly covered');
    results.push({ name, viewport, theme, pass: true, url: page.url(), ...state, saveGate: undefined, connectGate: undefined });
    console.log(`PASS ${name}`);
  } catch (error) {
    await shot('failure').catch(() => {});
    results.push({ name, viewport, theme, pass: false, error: String(error), url: page.url(), ...state, saveGate: undefined, connectGate: undefined });
    throw error;
  } finally {
    await context.close();
    await persist(results.some(result => !result.pass) ? 'FAIL' : 'RUNNING');
  }
}

async function delivery({ page, main, state, open, select, shot, geometry }) {
  await open('/admin/livraison?source=recette-navigation');
  const name = page.getByLabel('Nom de la zone', { exact: true });
  const save = page.getByRole('button', { name: 'Enregistrer et publier', exact: true });
  await name.waitFor();
  if ((await page.viewportSize()).width === 768) {
    await page.getByRole('button', { name: 'Développer le menu', exact: true }).waitFor();
    state.checks.push('tablet navigation initially collapsed, leaving section controls unobstructed');
  }
  assert.equal(await save.isDisabled(), true);
  assert.equal(await save.evaluate(element => getComputedStyle(element.parentElement.parentElement).position), (await page.viewportSize()).width < 640 ? 'static' : 'sticky', 'Publication area stays in flow on mobile and sticky on larger screens');
  await geometry(); await shot('zones');
  const initialReads = state.requests.filter(row => row.path === '/delivery/settings').length;
  await name.click();
  await name.fill('Zone de recette conservée');
  await page.getByLabel('Frais de livraison (€)', { exact: true }).fill('6,50');
  await select('Capacité et ouverture');
  await page.getByLabel('Délai minimum avant livraison (min)', { exact: true }).click();
  await page.getByLabel('Délai minimum avant livraison (min)', { exact: true }).fill('60');
  await page.getByLabel('Livraisons maximum par créneau', { exact: true }).fill('4');
  await geometry(); await shot('capacite-brouillon');
  await select('Livreurs');
  await page.getByRole('button', { name: 'Ajouter un livreur', exact: true }).waitFor();
  await page.getByText('Les accès livreurs sont enregistrés séparément.', { exact: false }).waitFor();
  assert.equal(state.writes.length, 0);
  // Opening and cancelling a driver form is independent of the publication draft.
  await page.getByRole('button', { name: 'Ajouter un livreur', exact: true }).click();
  const driver = page.getByRole('dialog', { name: 'Ajouter un livreur', exact: true });
  await driver.getByLabel('Nom du livreur', { exact: true }).fill('Livreur local non enregistré');
  await page.keyboard.press('Escape');
  await driver.waitFor({ state: 'hidden' });
  assert.equal(state.requests.filter(row => row.method !== 'GET').length, 0);
  await geometry(); await shot('livreurs-brouillon');
  await page.goBack();
  await page.getByRole('tab', { name: 'Capacité et ouverture', exact: true }).waitFor();
  assert.equal(await page.getByRole('tab', { name: 'Capacité et ouverture', exact: true }).getAttribute('aria-selected'), 'true');
  assert.equal(await page.getByLabel('Délai minimum avant livraison (min)', { exact: true }).inputValue(), '60');
  await page.goForward();
  assert.equal(await page.getByRole('tab', { name: 'Livreurs', exact: true }).getAttribute('aria-selected'), 'true');
  await select('Zones et tarifs');
  assert.equal(await name.inputValue(), 'Zone de recette conservée');
  assert.equal(new URL(page.url()).searchParams.get('source'), 'recette-navigation');
  assert.equal(state.requests.filter(row => row.path === '/delivery/settings').length, initialReads, 'Changing sections must not reload settings');
  await select('Livreurs');
  await page.getByRole('button', { name: 'Annuler', exact: true }).click();
  assert.equal(await save.isDisabled(), true);
  await select('Zones et tarifs');
  assert.equal(await name.inputValue(), initialDelivery.zones[0].name);
  await select('Capacité et ouverture');
  assert.equal(await page.getByLabel('Délai minimum avant livraison (min)', { exact: true }).inputValue(), '45');
  assert.equal(state.writes.length, 0, 'Annuler has no network mutation');
  state.checks.push('draft survives all three sections, browser Back/Forward, and driver modal; URL preserves other parameters; cancel restores zones and capacity without a write');

  await select('Zones et tarifs');
  await name.fill('Zone publiée localement');
  await page.getByLabel('Frais de livraison (€)', { exact: true }).fill('6,50');
  await select('Capacité et ouverture');
  await page.getByLabel('Délai minimum avant livraison (min)', { exact: true }).fill('60');
  await page.getByLabel('Livraisons maximum par créneau', { exact: true }).fill('4');
  await select('Livreurs');
  let release;
  state.saveGate = new Promise(resolve => { release = resolve; });
  await save.click();
  await page.getByRole('button', { name: 'Enregistrement…', exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Enregistrement…', exact: true }).isDisabled(), true);
  await select('Capacité et ouverture');
  assert.equal(await page.getByLabel('Délai minimum avant livraison (min)', { exact: true }).isDisabled(), true);
  release(); state.saveGate = null;
  await page.getByText('Vos réglages sont à jour', { exact: true }).waitFor();
  assert.deepEqual(state.writes, [{ ...initialDelivery, leadTimeMin: 60, slotCapacity: 4, zones: [{ ...initialDelivery.zones[0], name: 'Zone publiée localement', feeCents: 650 }] }]);
  assert.equal(await save.isDisabled(), true);
  state.checks.push('one schema-validated PATCH publishes hidden zones and capacity together; inputs and save disabled in flight, navigation remains available');
  // Let the preceding success notification finish before capturing the later
  // validation error; the screenshot should describe that current operation.
  await page.getByText('Livraison enregistrée', { exact: true }).waitFor({ state: 'hidden' });

  // A validation error in an inactive section remains visible in the global publication area.
  await select('Zones et tarifs');
  await page.getByLabel('Frais de livraison (€)', { exact: true }).fill('abc');
  await select('Capacité et ouverture');
  await save.click();
  await main.getByRole('alert').filter({ hasText: 'Zone « Zone publiée localement » : les frais doivent être compris' }).waitFor();
  assert.equal(state.writes.length, 1);
  await shot('erreur-champ-masque');
  await select('Zones et tarifs');
  assert.equal(await page.getByLabel('Frais de livraison (€)', { exact: true }).inputValue(), 'abc');
  await page.getByRole('button', { name: 'Annuler', exact: true }).click();
  await geometry();
  state.checks.push('invalid hidden zone produces visible global alert and no PATCH; draft remains editable');

  await page.reload({ waitUntil: 'domcontentloaded' });
  await name.waitFor();
  assert.equal(await name.inputValue(), 'Zone publiée localement');
  assert.equal(new URL(page.url()).searchParams.get('section'), 'zones');
  assert.equal(await save.isDisabled(), true);
  state.checks.push('reload restores the saved fixture configuration and selected URL section; no unsaved reload durability claimed');
  await page.goto(base + '/admin/livraison?section=capacite&source=recette-navigation', { waitUntil: 'domcontentloaded' });
  await page.getByLabel('Délai minimum avant livraison (min)', { exact: true }).waitFor();
  assert.equal(await page.getByRole('tab', { name: 'Capacité et ouverture', exact: true }).getAttribute('aria-selected'), 'true');
  assert.equal(await page.getByLabel('Délai minimum avant livraison (min)', { exact: true }).inputValue(), '60');
  state.checks.push('direct capacity URL activates the intended section after a full page entry');
}

async function encaissement({ page, main, state, open, shot, geometry }) {
  await open('/admin/encaissement');
  await main.getByRole('heading', { name: ENCAISSEMENT_ETAT_LABELS[state.etat], exact: true }).waitFor();
  assert.equal(state.syncs, 1);
  assert.equal(state.links, 0);
  assert.equal(await main.getByRole('tablist').count(), 0, 'A short explanatory card does not create unnecessary navigation');
  assert.equal(await main.locator('li').count(), 4, 'All four payment explanations remain available');
  await geometry(); await shot(state.etat);
  // Same-document query/history changes cannot trigger a second Stripe sync.
  await page.evaluate(() => { const url = new URL(location.href); url.searchParams.set('section', 'fonctionnement'); history.pushState(null, '', url); });
  await page.goBack();
  await page.getByRole('button', { name: 'Activer le thème ' + (await page.locator('.sm-backoffice').getAttribute('data-sm-theme') === 'light' ? 'sombre' : 'clair'), exact: true }).click();
  assert.equal(state.syncs, 1);
  assert.equal(state.links, 0);
  assert.equal(state.requests.filter(row => row.path.startsWith('/encaissement/')).length, 1);
  state.checks.push('initial POST synchroniser exactly once; explanatory content, history and appearance change cause no payment API request');
  if (state.etat === 'actif') {
    assert.equal(await main.getByRole('button', { name: /Raccorder mon compte|Reprendre l'inscription/ }).count(), 0);
    return;
  }
  const cta = main.getByRole('button', { name: state.etat === 'absent' ? 'Raccorder mon compte' : "Reprendre l'inscription", exact: true });
  assert.ok((await cta.boundingBox()).height >= 44);
  if (state.etat !== 'absent') return;

  // Two successful handoffs receive distinct URLs, with a full real page return between them.
  for (let index = 1; index <= 2; index++) {
    let release;
    state.connectGate = new Promise(resolve => { release = resolve; });
    await main.getByRole('button', { name: index === 1 ? 'Raccorder mon compte' : "Reprendre l'inscription", exact: true }).click();
    const opening = main.getByRole('button', { name: 'Ouverture…', exact: true });
    await opening.waitFor();
    assert.equal(await opening.isDisabled(), true);
    assert.equal(await opening.getAttribute('aria-busy'), 'true');
    release(); state.connectGate = null;
    await page.waitForURL(`${base}/__local-stripe/onboarding/${index}`);
    await page.getByRole('heading', { name: 'Raccordement simulé localement', exact: true }).waitFor();
    state.etat = index === 1 ? 'en_cours' : 'actif';
    await page.getByRole('link', { name: 'Retour à mon restaurant', exact: true }).click();
    await main.getByRole('heading', { name: ENCAISSEMENT_ETAT_LABELS[state.etat], exact: true }).waitFor();
    assert.equal(new URL(page.url()).search, '');
    assert.equal(state.syncs, index + 1);
    assert.equal(state.links, index);
  }
  await shot('retour-actif');
  state.checks.push('two explicit fresh-link POSTs, busy action blocked, two distinct local onboarding URLs, one resync per real return without query parameter; final active state');
}

try {
  for (const theme of ['light', 'dark']) {
    if (only !== 'encaissement') for (const width of [320, 390, 768, 1440]) await scenario(`livraison-${width}-${theme}`, { width, height: width < 768 ? 844 : 1000 }, theme, delivery);
    if (only !== 'livraison') for (const [index, etat] of ['absent', 'en_cours', 'restreint', 'actif'].entries()) {
      const width = [320, 390, 768, 1440][index];
      await scenario(`encaissement-${etat}-${width}-${theme}`, { width, height: width < 768 ? 844 : 1000 }, theme, encaissement, { etat });
    }
  }
  if (only !== 'encaissement') await scenario('livraison-publication-refusee-390-dark', { width: 390, height: 844 }, 'dark', async ({ page, main, state, open, select, shot, geometry }) => {
    await open('/admin/livraison');
    await page.getByLabel('Nom de la zone', { exact: true }).fill('Brouillon à republier');
    await select('Livreurs');
    state.failSave = true;
    const save = page.getByRole('button', { name: 'Enregistrer et publier', exact: true });
    await save.click();
    await main.getByRole('alert').filter({ hasText: 'Échec simulé de publication locale' }).waitFor();
    assert.equal(state.writes.length, 1);
    assert.equal(await save.isEnabled(), true);
    await select('Zones et tarifs');
    assert.equal(await page.getByLabel('Nom de la zone', { exact: true }).inputValue(), 'Brouillon à republier');
    await geometry(); await shot('brouillon-conserve');
    state.failSave = false;
    await save.click();
    await page.getByText('Vos réglages sont à jour', { exact: true }).waitFor();
    assert.equal(state.writes.length, 2);
    assert.deepEqual(state.writes[1], state.writes[0]);
    state.checks.push('failed publication retains hidden zone draft and allows explicit retry of the same complete configuration');
  });
  if (only !== 'livraison') await scenario('encaissement-indisponible-320-light', { width: 320, height: 844 }, 'light', async ({ main, state, open, shot, geometry }) => {
    await open('/admin/encaissement'); await main.getByText('Bientôt disponible', { exact: true }).waitFor();
    assert.equal(state.syncs, 1); assert.equal(state.links, 0);
    assert.equal(await main.getByRole('button', { name: 'Raccorder mon compte', exact: true }).count(), 0);
    await geometry(); await shot('indisponible'); state.checks.push('unconfigured platform cannot expose a connection action');
  }, { disponible: false });
  if (only !== 'livraison') await scenario('encaissement-erreur-390-dark', { width: 390, height: 844 }, 'dark', async ({ main, state, open, shot, geometry }) => {
    await open('/admin/encaissement'); await main.getByText('Encaissement indisponible', { exact: true }).waitFor();
    assert.equal(state.syncs, 1); assert.equal(state.links, 0);
    await geometry(); await shot('erreur'); state.checks.push('failed initial synchronization renders existing error state without a connection action');
  }, { failSync: true });
  await persist('PASS');
  console.log(JSON.stringify({ pass: true, scenarios: results.length, buildId, proof, captures }));
} finally { await browser.close(); }
