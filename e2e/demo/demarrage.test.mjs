/**
 * Démarrage des vraies interfaces avec API interceptée et webStore persistant.
 * Pas de ?demo=1 : son magasin volatil ne permettrait pas de vérifier un reload.
 * Appairage/PIN fictifs ; aucune requête métier ne rejoint un backend réel.
 */
import assert from 'node:assert/strict';
import { cibles } from '../socle/cibles.mjs';
import { scenario } from '../socle/navigateur.mjs';

const c = cibles();
const PASSER = 'Passer l’animation de démarrage';
const ANIMATION = 'Animation du logo au démarrage';
const applications = [
  { kind: 'pos', label: 'Caisse', url: c.pos, settings: 'Paramètres du poste', pin: 'Code équipier', role: 'caisse' },
  { kind: 'kds', label: 'Cuisine', url: c.kds, settings: "Paramètres de l'écran", pin: 'Code équipe', role: 'cuisine' },
];

async function isolerApi(contexte, application) {
  const origine = new URL(application.url).origin;
  const origineApi = new URL(c.api).origin;
  const tenant = { slug: `demarrage-${application.kind}`, name: 'Restaurant fixture', brandColor: '#c9a15a', logoUrl: null };
  const device = { id: `fixture-${application.kind}`, kind: application.kind, kindLabel: application.label, name: 'Poste fixture' };
  const product = { _id: 'fixture-product', name: 'Boisson fixture', price: 250, variants: [], optionGroups: [], supplements: [], removables: [], active: true, outOfStock: false, medias: [] };
  const menu = { categories: [{ _id: 'fixture-category', name: 'Boissons', products: [product] }] };
  const order = {
    _id: 'fixture-order', clientId: 'fixture-client', number: 901, type: 'surplace', channel: 'pos', status: 'new',
    createdAt: new Date().toISOString(), payment: { method: 'cash', status: 'paid' },
    totals: { subtotal: 250, total: 250 }, statusHistory: [], trackingToken: 'fixture-tracking',
    lines: [{ productId: product._id, name: product.name, qty: 1, unitPrice: 250, lineTotal: 250, options: [], removed: [] }],
  };
  const inattendues = [];
  const appairages = [];
  const pins = [];
  await contexte.routeWebSocket('**/*', (socket) => socket.close());
  await contexte.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    if (url.origin === origine && method === 'GET') return route.continue();
    const json = (body, status = 200) => route.fulfill({
      status, contentType: 'application/json', body: JSON.stringify(body),
      headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,POST,OPTIONS' },
    });
    if (url.origin !== origineApi) {
      inattendues.push(`${method} ${url.origin}${url.pathname}`);
      return route.abort();
    }
    if (method === 'OPTIONS') return json({});
    if (url.pathname === '/public/devices/pair' && method === 'POST') {
      appairages.push(request.postDataJSON().pairingCode);
      assert.deepEqual(request.postDataJSON(), { pairingCode: 'ABCDEF', expectedKind: application.kind });
      return json({ deviceToken: 'fixture-device-token', tenant, device });
    }
    if (url.pathname === '/public/devices/heartbeat' && method === 'POST') return json({ tenant, device, suspended: false });
    if (url.pathname === '/public/devices/pin' && method === 'POST') {
      pins.push(request.postDataJSON().pin);
      assert.equal(request.postDataJSON().pin, '2468');
      return json({ token: 'fixture-staff-token', staff: { name: 'Équipier fixture', role: application.role }, tenant, device });
    }
    if (url.pathname === `/public/tenants/${tenant.slug}/menu` && method === 'GET') return json(menu);
    if (url.pathname === '/orders' && method === 'GET') {
      const rows = application.kind === 'kds' && url.searchParams.get('status') === 'new' ? [order] : [];
      return json({ rows, total: rows.length, truncated: false });
    }
    inattendues.push(`${method} ${url.pathname}`);
    return json({ message: 'Requête non prévue dans la fixture de démarrage' }, 500);
  });
  return { inattendues, appairages, pins };
}

/** Observe aussi un splash fugitif, avant que Playwright puisse le sélectionner. */
async function observerDemarrage(contexte) {
  await contexte.addInitScript(() => {
    const journal = [];
    window.__demarrageObserve = journal;
    let current = null;
    let entry = null;
    const sample = () => {
      if (!current?.isConnected || !entry) return;
      const barre = current.querySelector('[data-testid="brand-splash-progress"]');
      const contour = current.querySelector('svg path[stroke-dasharray]');
      const transform = barre ? getComputedStyle(barre).transform : 'none';
      entry.frames.push({
        at: performance.now() - entry.start,
        opacity: Number(getComputedStyle(current).opacity),
        progress: transform === 'none' ? 1 : Number(transform.match(/^matrix\(([^,]+)/)?.[1]),
        outline: contour ? Number(contour.getAttribute('stroke-dashoffset')) : null,
      });
      requestAnimationFrame(sample);
    };
    new MutationObserver(() => {
      const next = document.querySelector('[data-testid="brand-splash"]');
      if (next === current) return;
      if (entry && entry.end === null) entry.end = performance.now();
      current = next;
      if (next) {
        entry = { start: performance.now(), end: null, frames: [] };
        journal.push(entry);
        requestAnimationFrame(sample);
      }
    }).observe(document, { childList: true, subtree: true });
  });
}

const splash = (page) => page.getByTestId('brand-splash');
const journal = (page) => page.evaluate(() => window.__demarrageObserve);
const reglages = (page, app) => page.getByRole('button', { name: app.settings, exact: true });
const panneau = (page, app) => page.getByRole('dialog', { name: app.settings, exact: true });

const actionService = (page, app, includeHidden = false) => page.getByRole('button', {
  name: app.kind === 'pos' ? /^Boisson fixture,/ : 'Accepter — commande numéro 901', includeHidden,
});

async function verifierIsolation(page, controle) {
  assert.equal(await controle.evaluate((el) => !!el.closest('[inert]')), true);
  await controle.evaluate((el) => el.focus());
  assert.equal(await controle.evaluate((el) => el === document.activeElement), false,
    'le contrôle masqué ne doit pas pouvoir recevoir le focus');
  // Le moteur getByRole de Playwright ne filtre pas toujours inert. Vérifier
  // l'arbre d'accessibilité effectivement publié par notre navigateur Chromium.
  const nom = await controle.evaluate((el) => el.getAttribute('aria-label') ?? el.textContent);
  const cdp = await page.context().newCDPSession(page);
  try {
    const { nodes } = await cdp.send('Accessibility.getFullAXTree');
    assert.equal(nodes.some((node) => !node.ignored && node.role?.value === 'button' && node.name?.value === nom), false,
      'le contrôle métier ne doit pas être exposé aux aides techniques sous le démarrage');
  } finally { await cdp.detach(); }
}

async function attendreService(page, app) {
  await reglages(page, app).waitFor({ state: 'visible' });
  await actionService(page, app).waitFor({ state: 'visible' });
}

async function appairer(page, app) {
  await page.getByText('Appairer cet appareil', { exact: true }).waitFor({ state: 'visible' });
  await splash(page).waitFor({ state: 'hidden' });
  for (const char of 'ABCDEF') await page.getByRole('button', { name: char, exact: true }).click();
  await page.getByText(app.pin, { exact: true }).waitFor({ state: 'visible' });
}

async function appairerEtOuvrir(page, app) {
  await appairer(page, app);
  for (const digit of '2468') await page.getByRole('button', { name: digit, exact: true }).click();
  if (app.kind === 'kds') await page.getByRole('button', { name: 'Valider le code', exact: true }).click();
  await attendreService(page, app);
}

async function reglerAnimation(page, app, active) {
  await reglages(page, app).click();
  const dialogue = panneau(page, app);
  const bascule = dialogue.getByRole('switch', { name: ANIMATION, exact: true });
  assert.equal(await bascule.getAttribute('aria-checked'), String(!active));
  await bascule.click();
  await dialogue.getByRole('switch', { name: ANIMATION, exact: true, checked: active }).waitFor({ state: 'visible' });
  await page.waitForFunction(({ key, active }) => JSON.parse(localStorage.getItem(key) ?? 'null')?.splash === active,
    { key: `sm.${app.kind}.prefs.v1`, active });
  await dialogue.getByRole('button', { name: 'Fermer', exact: true }).last().click();
  await dialogue.waitFor({ state: 'hidden' });
}

async function passer(page) {
  await page.getByRole('button', { name: PASSER, exact: true }).click();
  await splash(page).waitFor({ state: 'hidden' });
  const phases = await journal(page);
  assert.equal(phases.length, 1);
  assert.ok(phases[0].end - phases[0].start < 2500, 'le passage explicite doit interrompre la séquence avant sa fin');
}

for (const app of applications) {
  scenario(`${app.label} — démarrage complet, passage explicite et préférence persistante au rechargement`,
    { format: { width: 1280, height: 800 } }, async (page, { contexte, t }) => {
      await page.emulateMedia({ reducedMotion: 'no-preference' });
      const { inattendues, appairages } = await isolerApi(contexte, app);
      await observerDemarrage(contexte);
      await page.goto(app.url, { waitUntil: 'domcontentloaded' });
      await splash(page).waitFor({ state: 'visible' });
      await page.getByRole('button', { name: 'A', exact: true, includeHidden: true }).waitFor({ state: 'visible' });
      await verifierIsolation(page, page.getByRole('button', { name: 'A', exact: true, includeHidden: true }));
      await page.keyboard.type('ABCDEF');
      await passer(page);
      assert.deepEqual(appairages, [], 'les raccourcis globaux ne doivent pas appairer le poste sous le splash');
      await appairerEtOuvrir(page, app);

      await page.reload({ waitUntil: 'domcontentloaded' });
      await splash(page).waitFor({ state: 'visible' });
      await actionService(page, app, true).waitFor({ state: 'visible' });
      await verifierIsolation(page, actionService(page, app, true));
      await splash(page).waitFor({ state: 'hidden' });
      await attendreService(page, app);
      const phases = await journal(page);
      assert.equal(phases.length, 1, 'un démarrage doit jouer une seule séquence');
      const phase = phases[0];
      const duree = phase.end - phase.start;
      // 2500 ms de dessin + 150 ms de maintien + 400 ms de fondu.
      // La marge basse absorbe la première frame ; la haute tolère une CI chargée.
      assert.ok(duree >= 2950 && duree < 6000, `séquence complète attendue (~3050 ms), durée observée ${Math.round(duree)} ms`);
      assert.ok(phase.frames.some((frame) => frame.outline > 0 && frame.outline < 101), 'le contour doit réellement se dessiner');
      assert.ok(phase.frames.some((frame) => frame.progress > 0 && frame.progress < 1), 'la barre doit progresser');
      assert.ok(phase.frames.some((frame) => frame.at >= 2450 && frame.progress >= 0.99 && frame.opacity >= 0.99),
        'la composition achevée doit rester visible avant le fondu');
      assert.ok(phase.frames.some((frame) => frame.at >= 2600 && frame.opacity > 0.01 && frame.opacity < 0.95),
        'la sortie doit comporter le fondu final');
      t.diagnostic(`Séquence complète ${app.kind} : ${Math.round(duree)} ms, API simulée`);

      await reglerAnimation(page, app, false);
      await page.reload({ waitUntil: 'domcontentloaded' });
      await attendreService(page, app);
      assert.deepEqual(await journal(page), [], 'désactivée, l’animation ne doit jamais se monter, même brièvement');

      // Garder une vraie ligne de caisse ou la vraie carte cuisine en cours.
      let courant;
      if (app.kind === 'pos') {
        await page.getByRole('button', { name: /^Boisson fixture,/ }).click();
        await page.getByRole('button', { name: 'Ajouter · 2,50 €', exact: true }).click();
        courant = page.getByRole('button', { name: 'Modifier Boisson fixture', exact: true });
      } else courant = page.getByLabel('Commande 901', { exact: true });
      const instance = await courant.elementHandle();
      await reglerAnimation(page, app, true);
      assert.equal(await courant.evaluate((el, avant) => el === avant, instance), true,
        'réactiver le démarrage ne doit pas remonter la ligne ou la commande courante');
      assert.deepEqual(await journal(page), [], 'réactiver prépare le prochain démarrage sans interrompre le service courant');

      await page.reload({ waitUntil: 'domcontentloaded' });
      await passer(page);
      await attendreService(page, app);
      assert.equal(await page.evaluate((key) => JSON.parse(localStorage.getItem(key)).splash, `sm.${app.kind}.prefs.v1`), true);
      assert.deepEqual(inattendues, [], 'aucune requête non simulée ou mutation métier ne doit être émise');
    });

  scenario(`${app.label} — mouvement réduit, démarrage statique sans délai imposé`,
    { format: { width: 1280, height: 800 } }, async (page, { contexte, t }) => {
      await page.emulateMedia({ reducedMotion: 'reduce' });
      const { inattendues } = await isolerApi(contexte, app);
      await observerDemarrage(contexte);
      await page.goto(app.url, { waitUntil: 'domcontentloaded' });
      await appairerEtOuvrir(page, app);
      await page.reload({ waitUntil: 'domcontentloaded' });
      await attendreService(page, app);
      await splash(page).waitFor({ state: 'hidden' });
      const phases = await journal(page);
      for (const phase of phases) {
        const duree = phase.end - phase.start;
        assert.ok(duree < 600, `le mouvement réduit ne doit pas attendre le cycle de 3050 ms (${Math.round(duree)} ms observées)`);
        assert.ok(phase.frames.every((frame) => !(frame.progress > 0.01 && frame.progress < 0.99)), 'aucune progression animée en mouvement réduit');
      }
      t.diagnostic(`Mouvement réduit ${app.kind} : ${phases.length} montage(s), durée(s) ${phases.map((phase) => Math.round(phase.end - phase.start)).join(', ')} ms`);
      assert.deepEqual(inattendues, []);
    });

  scenario(`${app.label} — clavier physique inactif sous le démarrage puis PIN et passage accessibles`,
    { format: { width: 1280, height: 800 } }, async (page, { contexte }) => {
      await page.emulateMedia({ reducedMotion: 'no-preference' });
      const { inattendues, pins } = await isolerApi(contexte, app);
      await observerDemarrage(contexte);
      await page.goto(app.url, { waitUntil: 'domcontentloaded' });
      await passer(page);
      await appairer(page, app);
      await page.reload({ waitUntil: 'domcontentloaded' });
      await splash(page).waitFor({ state: 'visible' });
      await page.getByText(app.pin, { exact: true }).waitFor({ state: 'visible' });
      await verifierIsolation(page, page.getByRole('button', { name: '2', exact: true, includeHidden: true }));
      await page.keyboard.type('2468');
      await page.keyboard.press('Enter');
      if (app.kind === 'kds') await page.getByLabel('0 chiffre(s) saisi(s)', { exact: true }).waitFor({ state: 'visible' });
      assert.deepEqual(pins, [], 'aucun PIN ne doit être envoyé par un listener global sous le splash');

      const passerBouton = page.getByRole('button', { name: PASSER, exact: true });
      await page.keyboard.press('Tab');
      await passerBouton.and(page.locator(':focus')).waitFor({ state: 'visible' });
      await page.keyboard.press('Enter');
      await splash(page).waitFor({ state: 'hidden' });
      assert.deepEqual(pins, [], 'valider le bouton Passer ne doit pas ouvrir le service');
      await page.getByText(app.pin, { exact: true }).waitFor({ state: 'visible' });
      await page.keyboard.type('2468');
      if (app.kind === 'kds') await page.keyboard.press('Enter');
      await attendreService(page, app);
      assert.deepEqual(pins, ['2468'], 'après la sortie, le clavier physique doit retrouver le parcours PIN normal');
      assert.deepEqual(inattendues, []);
    });
}
