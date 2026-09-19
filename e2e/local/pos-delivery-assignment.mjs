/** Vrai POS, API entièrement interceptée sur loopback. Aucun backend ni écriture distante.
 * POS_DELIVERY_WEB_URL=http://localhost:8084 node e2e/local/pos-delivery-assignment.mjs
 * Expo doit viser http://localhost:3001 (EXPO_PUBLIC_ALLOW_LOCAL_API=1).
 */
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
const base = new URL(process.env.POS_DELIVERY_WEB_URL ?? 'http://localhost:8084').origin;
assert.ok(['localhost', '127.0.0.1'].includes(new URL(base).hostname), 'Recette POS locale uniquement');
const artifacts = await mkdtemp(join(tmpdir(), 'sm-pos-delivery-'));
console.log(`Artifacts: ${artifacts}`);
const tenant = { slug: 'qa-delivery', name: 'Classfood QA', brandColor: '#dec99c', logoUrl: null };
const device = { id: 'qa-pos', kind: 'pos', kindLabel: 'Caisse', name: 'Caisse QA' };
const product = { _id: 'be821c69-b71e-4c31-9389-6d360da15097', name: 'Boisson QA', price: 250, variants: [], optionGroups: [], supplements: [], removables: [], active: true, outOfStock: false, medias: [] };
const menu = { categories: [{ _id: 'cat', name: 'Boissons', products: [product] }] };
const id = '507f1f77bcf86cd799439011';
// JWT-shaped local identity only; no signature or real account, all API calls intercepted.
const staffToken = `local.${Buffer.from(JSON.stringify({ tenantId: '507f1f77bcf86cd799439001', sub: '507f1f77bcf86cd799439002', kind: 'staff', role: 'caisse' })).toString('base64url')}.local`;
const drivers = [
  { id: '507f1f77bcf86cd799439021', name: 'Samir QA', revision: 3, assignedCount: 2, departedCount: 0 },
  { id: '507f1f77bcf86cd799439022', name: 'Lina QA', revision: 1, assignedCount: 0, departedCount: 0 },
];
const address = { line1: '12 rue de la Recette', postalCode: '75001', city: 'Paris', country: 'FR' };
function fixture() {
  const createdAt = new Date(Date.now() - 600_000).toISOString();
  const row = { _id: id, clientId: 'b150c711-4328-48a7-871b-65e9df4a8b63', number: 42,
    type: 'delivery', channel: 'online', status: 'ready', createdAt,
    payment: { method: 'online', status: 'paid', tender: 'online' },
    pickup: { slot: new Date(Date.now() + 900_000).toISOString(), customerName: 'Client QA', customerPhone: null },
    delivery: { address, zoneId: 'paris', zoneName: 'Paris', feeCents: 250, estimatedMinutes: 30, dispatchedAt: null, deliveredAt: null, driverName: null },
    totals: { subtotal: 1000, deliveryFee: 250, total: 1250 },
    lines: [{ productId: product._id, name: 'Menu QA', qty: 1, unitPrice: 1000, lineTotal: 1000, options: [], removed: [] }],
    statusHistory: [{ status: 'ready', at: createdAt }] };
  const mission = { id, number: 42, createdAt, scheduledAt: row.pickup.slot, orderStatus: 'ready', revision: 0,
    operator: null, assignmentId: null, assignedAt: null, dispatchedAt: null, deliveredAt: null,
    paymentSummary: { totalCents: 1250, method: 'online', status: 'paid', tender: 'online' },
    paymentReady: true, canAssign: true, canDispatch: false,
    customer: { name: 'Client QA', phone: null }, address, instructions: null,
    items: [{ name: 'Menu QA', variantName: null, qty: 1 }] };
  return { row, mission };
}
const browser = await chromium.launch({ headless: process.env.SM_E2E_TETE !== '1' });
const results = [];
async function scenario(name, viewport, flow, options = {}) {
  if (process.env.POS_DELIVERY_SCENARIO && !process.env.POS_DELIVERY_SCENARIO.split(',').includes(name)) return;
  const context = await browser.newContext({ viewport, locale: 'fr-FR', timezoneId: 'Europe/Paris', reducedMotion: 'reduce', serviceWorkers: 'block' });
  const page = await context.newPage();
  page.setDefaultTimeout(15_000);
  const { row, mission } = fixture();
  const requests = [], posts = [], forbidden = [], errors = [];
  let mode = options.mode ?? 'ok', omitFromLists = false, availabilityRootReads = 0;
  const operations = new Map();
  let assignmentArrivedResolve;
  const assignmentArrived = new Promise(resolve => { assignmentArrivedResolve = resolve; });
  let missionReadResolve;
  const missionRead = new Promise(resolve => { missionReadResolve = resolve; });
  let resolveHold;
  const hold = new Promise(resolve => { resolveHold = resolve; });
  if (options.pickup) { row.type = 'pickup'; delete row.delivery; }
  if (options.preparing) { row.status = mission.orderStatus = 'preparing'; mission.canAssign = false; }
  await context.addInitScript(({ tenant, device, staffToken }) => {
    if (localStorage.getItem('qa-delivery-seeded')) return;
    localStorage.setItem('qa-delivery-seeded', '1');
    localStorage.setItem('sm.pos.device.v1', JSON.stringify({ deviceToken: 'local-fake-device', tenant, device }));
    localStorage.setItem('sm.pos.session.v1', JSON.stringify({ token: staffToken, staffName: 'Équipier QA', staffRole: 'caisse', tenantName: tenant.name, tenantSlug: tenant.slug, brandColor: tenant.brandColor, at: Date.now() }));
  }, { tenant, device, staffToken });
  page.on('pageerror', error => errors.push(error.message));
  await context.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url()), method = request.method();
    if (url.origin === base && ['GET', 'HEAD'].includes(method)) return route.continue();
    if (url.origin !== 'http://localhost:3001') { forbidden.push([method, url.origin, url.pathname]); return route.abort(); }
    const path = url.pathname;
    requests.push([method, path, url.search]);
    const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) });
    if (method === 'OPTIONS') return json({});
    if (path.includes('/socket.io')) return json({ message: 'Socket désactivée dans la fixture' }, 400);
    if (path.endsWith('/heartbeat') && method === 'POST') return json({ tenant, device });
    if (path.endsWith('/menu') && method === 'GET') return json(menu);
    if (path === '/orders/count' && method === 'GET') return json({ total: omitFromLists ? 0 : 1 });
    if (path === '/orders' && method === 'GET') {
      const present = !omitFromLists && (!url.searchParams.has('status') || row.status === url.searchParams.get('status'));
      return json({ rows: present ? [row] : [], total: present ? 1 : 0, truncated: false });
    }
    if (path === `/orders/${id}` && method === 'GET') return json(row);
    if (path === '/delivery/operators/available' && method === 'GET') {
      if (mode === 'list-silent') await hold;
      if (mode === 'list-error') return json({ message: 'Liste indisponible pour la recette' }, 503);
      if (mode === 'page-empty' && !url.searchParams.has('after')) {
        availabilityRootReads += 1;
        return json(availabilityRootReads === 1
          ? { operators: [], nextCursor: '507f1f77bcf86cd799439020' }
          : { operators: [{ id: '507f1f77bcf86cd799439018', name: 'Nora QA', revision: 0, assignedCount: 0, departedCount: 0 }], nextCursor: '507f1f77bcf86cd799439019' });
      }
      if (mode === 'page-empty' && url.searchParams.get('after') === '507f1f77bcf86cd799439019') return json({
        operators: [{ id: '507f1f77bcf86cd79943901a', name: 'Ali QA', revision: 0, assignedCount: 0, departedCount: 0 }, ...drivers], nextCursor: null,
      });
      return json({ operators: mode === 'empty' ? [] : drivers.map((driver, index) => mode === 'busy-driver' && index === 0 ? { ...driver, departedCount: 1 } : driver), nextCursor: null });
    }
    if (path === `/delivery/missions/${id}` && method === 'GET') {
      if (mode === 'read-hold') { missionReadResolve(); await hold; }
      return json(mission);
    }
    if (path === `/delivery/missions/${id}/assignment` && method === 'POST') {
      const body = request.postDataJSON(); posts.push(body); assignmentArrivedResolve();
      assert.deepEqual(Object.keys(body).sort(), ['operationId', 'expectedRevision', 'operatorId', 'expectedOperatorRevision', 'reason'].sort());
      assert.match(body.operationId, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
      assert.ok(typeof body.reason === 'string' && body.reason.trim().length >= 3);
      const dropAfterApply = mode === 'drop-after-apply' || mode === 'hold-drop';
      if (mode === 'hold' || mode === 'hold-drop') await hold;
      const previous = operations.get(body.operationId);
      if (previous) { assert.deepEqual(body, previous.body); return json({ ...previous.result, replay: true, mission }); }
      if (mode === 'conflict') { mission.revision += 1; mode = 'ok'; return json({ code: 'DELIVERY_MISSION_CHANGED', message: 'La mission a changé. Actualisez avant de confirmer.' }, 409); }
      assert.equal(body.expectedRevision, mission.revision);
      const chosen = drivers.find(driver => driver.id === body.operatorId);
      assert.ok(chosen); assert.equal(body.expectedOperatorRevision, chosen.revision);
      mission.revision += 1;
      mission.operator = { id: chosen.id, name: chosen.name };
      mission.assignmentId = '703f8de2-98fb-4f2a-aaf4-32a0808664c4';
      mission.assignedAt = new Date().toISOString(); mission.canAssign = false; mission.canDispatch = true;
      const result = { operationId: body.operationId, appliedRevision: mission.revision, replay: false, outcome: 'applied', refusalCode: null, mission };
      operations.set(body.operationId, { body, result });
      if (dropAfterApply) { mode = 'ok'; return route.abort('failed'); }
      return json(result);
    }
    forbidden.push([method, url.origin, path]);
    return json({ message: 'Route non prévue dans cette recette' }, 404);
  });
  const dialog = () => page.getByRole('dialog', { name: 'Commande 42', exact: true });
  const confirm = () => dialog().getByRole('button', { name: 'Confirmer l’affectation', exact: true });
  const t = { page, context, row, mission, posts, requests, dialog, confirm, assignmentArrived, missionRead,
    async open() { await page.goto(base, { waitUntil: 'domcontentloaded' }); await page.getByRole('button', { name: /Boisson QA,/ }).waitFor({ timeout: 90_000 }); },
    async service() { await page.getByRole('tab', { name: /^Le service/ }).first().click(); await page.getByRole('button', { name: /^Commande 42,/ }).click(); await dialog().waitFor(); },
    async select(name = 'Samir QA') { await dialog().getByRole('radio', { name: `Choisir le livreur ${name}`, exact: true }).click(); },
    async assigned() { await dialog().getByText(/Affectation confirmée\.|Action vérifiée\./).waitFor(); await dialog().getByText('Samir QA', { exact: true }).waitFor(); assert.equal(await dialog().getByRole('radio').count(), 0); },
    release() { mode = 'ok'; resolveHold(); },
    setMode(value) { mode = value; },
    hideFromLists() { omitFromLists = true; },
    completeElsewhere() {
      omitFromLists = true; const at = new Date().toISOString();
      row.status = mission.orderStatus = 'delivered';
      row.delivery.dispatchedAt = mission.dispatchedAt = at;
      row.delivery.deliveredAt = mission.deliveredAt = at;
      mission.canAssign = mission.canDispatch = false;
    },
    async shot(suffix = '') { await page.screenshot({ path: join(artifacts, `${name}${suffix}.png`), fullPage: true }); },
    async offline() { await page.evaluate(() => { Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false }); window.dispatchEvent(new Event('offline')); }); },
  };
  let scenarioTimer;
  try {
    await Promise.race([flow(t), new Promise((_, reject) => { scenarioTimer = setTimeout(() => reject(new Error('Délai maximal du scénario local dépassé')), 120_000); })]);
    assert.deepEqual(errors, []); assert.deepEqual(forbidden, []);
    assert.equal(row.status, options.completedElsewhere ? 'delivered' : options.preparing ? 'preparing' : 'ready');
    assert.equal(row.payment.status, 'paid');
    if (row.delivery && !options.completedElsewhere) { assert.equal(row.delivery.dispatchedAt, null); assert.equal(row.delivery.deliveredAt, null); }
    await t.shot(); results.push({ name, pass: true, assignmentPosts: posts.length, mutationPaths: [...new Set(requests.filter(([method]) => method === 'POST').map(([,path]) => path))] });
  } catch (error) {
    await t.shot().catch(() => {});
    await writeFile(join(artifacts, `${name}-failure.json`), JSON.stringify({ errors, forbidden, requests, posts, message: String(error), tree: await page.locator('body').ariaSnapshot().catch(() => '') }, null, 2));
    throw error;
  } finally { clearTimeout(scenarioTimer); resolveHold(); await context.close(); }
}
try {
  for (const width of [390, 820, 1440]) await scenario(`affectation-${width}`, { width, height: 1000 }, async t => {
    await t.open();
    await t.page.getByRole('button', { name: /Boisson QA,/ }).click();
    await t.page.getByRole('button', { name: /^Ajouter/ }).click();
    await t.service();
    assert.equal(await t.confirm().isDisabled(), true);
    await t.select(); await t.shot('-choice'); await t.confirm().focus();
    await t.page.keyboard.press('Enter'); await t.assignmentArrived;
    assert.equal(t.posts.length, 1); assert.equal(t.mission.operator, null, 'aucune confirmation optimiste avant ACK');
    await t.page.keyboard.press('Enter'); assert.equal(t.posts.length, 1);
    t.release(); await t.assigned(); await t.shot('-assignment');
    await t.page.keyboard.press('Escape'); await t.dialog().waitFor({ state: 'hidden' });
    await t.page.getByRole('tab', { name: 'Vendre', exact: true }).click();
    const ticket = t.page.getByRole('button', { name: /^Ouvrir le ticket, 1 article, total 2,50/ });
    if (await ticket.count()) await ticket.click();
    await t.page.getByRole('button', { name: 'Modifier Boisson QA', exact: true }).waitFor();
    assert.equal(t.posts[0].expectedRevision, 0); assert.equal(t.posts[0].expectedOperatorRevision, 3);
  }, { mode: 'hold' });
  await scenario('empty-page-with-next', { width: 390, height: 1000 }, async t => {
    await t.open(); await t.service();
    const more = t.dialog().getByRole('button', { name: 'Charger plus de livreurs', exact: true });
    await more.waitFor();
    assert.equal(await t.dialog().getByText('Aucun livreur disponible pour le moment.', { exact: true }).count(), 0, 'une page vide non terminale ne signifie pas zéro livreur');
    await more.click(); await t.select();
    await t.page.waitForResponse(response => { const url = new URL(response.url()); return url.pathname === '/delivery/operators/available' && url.searchParams.has('after'); }, { timeout: 22_000 });
    await t.dialog().getByRole('button', { name: 'Actualiser les livreurs', exact: true }).waitFor();
    await t.dialog().getByRole('radio', { name: 'Choisir le livreur Samir QA', exact: true, checked: true }).waitFor();
    await t.dialog().getByRole('radio', { name: 'Choisir le livreur Ali QA', exact: true }).waitFor();
    assert.ok(t.requests.some(([,path,query]) => path === '/delivery/operators/available' && query === '?after=507f1f77bcf86cd799439019'), 'le sondage suit le nouveau curseur, sans trou de pagination');
    await t.confirm().click(); await t.assigned();
    assert.equal(t.posts.length, 1);
  }, { mode: 'page-empty' });
  await scenario('poll-preserves-valid-selection', { width: 1440, height: 1000 }, async t => {
    await t.open(); await t.service(); await t.select();
    await t.page.waitForResponse(response => new URL(response.url()).pathname === '/delivery/operators/available', { timeout: 22_000 });
    await t.dialog().getByRole('radio', { name: 'Choisir le livreur Samir QA', exact: true, checked: true }).waitFor();
    assert.equal(await t.confirm().isDisabled(), false, 'le sondage ne doit pas effacer un choix encore valide');
    assert.equal(t.posts.length, 0);
  });
  await scenario('busy-driver', { width: 820, height: 1000 }, async t => {
    await t.open(); await t.service();
    const busy = t.dialog().getByRole('radio', { name: 'Choisir le livreur Samir QA', exact: true });
    await busy.waitFor(); assert.equal(await busy.isDisabled(), true);
    assert.equal(await t.confirm().isDisabled(), true); assert.equal(t.posts.length, 0);
  }, { mode: 'busy-driver' });
  await scenario('offline', { width: 390, height: 844 }, async t => {
    await t.open(); await t.service(); await t.select(); await t.offline();
    assert.equal(await t.confirm().isDisabled(), true);
    await t.page.keyboard.press('Enter'); assert.equal(t.posts.length, 0);
  });
  for (const mode of ['empty', 'list-error']) await scenario(mode, { width: 820, height: 1000 }, async t => {
    await t.open(); await t.service();
    await t.dialog().getByText(mode === 'empty' ? /Aucun livreur/ : /indisponible|Impossible|Réessayer/i).first().waitFor();
    assert.equal(await t.dialog().getByRole('radio').count(), 0);
    assert.equal(t.posts.length, 0);
  }, { mode });
  await scenario('lost-ack-replay', { width: 1440, height: 1000 }, async t => {
    await t.open(); await t.service(); await t.select(); await t.confirm().click();
    const retry = t.dialog().getByRole('button', { name: 'Vérifier l’affectation', exact: true });
    await retry.waitFor(); assert.equal(t.posts.length, 1);
    await retry.click(); await t.assigned();
    assert.equal(t.posts.length, 2); assert.deepEqual(t.posts[1], t.posts[0]);
  }, { mode: 'drop-after-apply' });
  await scenario('lost-ack-reload-outside-service', { width: 820, height: 1000 }, async t => {
    await t.open(); await t.service(); await t.select(); await t.confirm().click();
    await t.dialog().getByRole('button', { name: 'Vérifier l’affectation', exact: true }).waitFor();
    assert.equal(t.posts.length, 1); const original = structuredClone(t.posts[0]);
    t.completeElsewhere(); await t.page.reload({ waitUntil: 'domcontentloaded' });
    await t.page.getByRole('button', { name: /Boisson QA,/ }).waitFor();
    assert.equal(t.posts.length, 1, 'aucun POST implicite au redémarrage');
    await t.page.getByRole('tab', { name: /^Le service/ }).first().click();
    await t.page.getByRole('button', { name: 'Vérifier l’affectation 1', exact: true }).click();
    const recovery = t.page.getByRole('dialog', { name: 'Affectation à vérifier', exact: true });
    await recovery.getByRole('button', { name: 'Vérifier l’affectation', exact: true }).click();
    await recovery.getByText('Action vérifiée. Le livreur actuel est affiché.', { exact: true }).waitFor();
    await recovery.getByText('Samir QA', { exact: true }).waitFor();
    assert.equal(t.posts.length, 2); assert.deepEqual(t.posts[1], original);
    await recovery.getByText(/Commande livrée|Livraison terminée/i).waitFor();
    assert.doesNotMatch(await recovery.innerText(), /Le départ reste à confirmer|Livraison en route/);
  }, { mode: 'drop-after-apply', completedElsewhere: true });
  await scenario('read-timeout-releases-loading', { width: 820, height: 1000 }, async t => {
    await t.open(); await t.service();
    await t.dialog().getByRole('alert').waitFor({ timeout: 22_000 });
    const refresh = t.dialog().getByRole('button', { name: 'Actualiser les livreurs', exact: true });
    await refresh.waitFor(); assert.equal(await refresh.isDisabled(), false);
    assert.equal(t.requests.filter(([,path]) => path === '/delivery/operators/available').length, 1, 'aucune lecture superposée au délai15s');
    assert.equal(await t.dialog().getByRole('radio').count(), 0); assert.equal(t.posts.length, 0);
    const lateResponse = t.page.waitForResponse(response => new URL(response.url()).pathname === '/delivery/operators/available');
    t.release(); await lateResponse;
    await t.page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.equal(await t.dialog().getByRole('radio').count(), 0, 'la réponse tardive ne remplace pas le refus de fraîcheur');
    await refresh.click(); await t.select(); assert.equal(t.posts.length, 0);
  }, { mode: 'list-silent' });
  await scenario('close-during-pre-read', { width: 820, height: 1000 }, async t => {
    await t.open(); await t.service(); await t.select(); t.setMode('read-hold');
    await t.confirm().click(); await t.missionRead;
    await t.dialog().getByRole('button', { name: 'Fermer', exact: true }).click();
    await t.dialog().waitFor({ state: 'hidden' });
    const lateResponse = t.page.waitForResponse(response => new URL(response.url()).pathname === `/delivery/missions/${id}`);
    t.release(); await lateResponse;
    await t.page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.equal(t.posts.length, 0, 'fermer avant préparation empêche le POST tardif');
    assert.equal(await t.page.evaluate(() => Object.keys(localStorage).some(key => key.endsWith('sm.delivery-assignment.v1'))), false);
  });
  await scenario('close-during-post-lost-ack', { width: 820, height: 1000 }, async t => {
    await t.open(); await t.service(); await t.select(); await t.confirm().click(); await t.assignmentArrived;
    const original = structuredClone(t.posts[0]);
    await t.dialog().getByRole('button', { name: 'Fermer', exact: true }).click();
    await t.dialog().waitFor({ state: 'hidden' });
    const failed = t.page.waitForEvent('requestfailed', { predicate: request => new URL(request.url()).pathname === `/delivery/missions/${id}/assignment` });
    t.release(); await failed;
    await t.page.getByRole('button', { name: 'Vérifier l’affectation 1', exact: true }).click();
    const recovery = t.page.getByRole('dialog', { name: 'Affectation à vérifier', exact: true });
    await recovery.getByRole('button', { name: 'Vérifier l’affectation', exact: true }).click();
    await recovery.getByText('Action vérifiée. Le livreur actuel est affiché.', { exact: true }).waitFor();
    assert.equal(t.posts.length, 2); assert.deepEqual(t.posts[1], original);
  }, { mode: 'hold-drop' });
  await scenario('revision-conflict', { width: 820, height: 1000 }, async t => {
    await t.open(); await t.service(); await t.select(); await t.confirm().click();
    await t.dialog().getByText(/commande a changé|Actualisez/i).first().waitFor();
    assert.equal(t.mission.operator, null); assert.equal(t.posts.length, 1);
    assert.equal(t.posts[0].expectedRevision, 0);
  }, { mode: 'conflict' });
  for (const kind of ['pickup', 'preparing']) await scenario(`no-assignment-${kind}`, { width: 1440, height: 1000 }, async t => {
    await t.open(); await t.service();
    assert.equal(await t.confirm().count(), 0); assert.equal(t.posts.length, 0);
    if (kind === 'pickup') assert.equal(t.requests.filter(([,path]) => path.startsWith('/delivery/')).length, 0);
  }, { [kind]: true });
  assert.ok(results.length > 0, 'La recette doit exécuter au moins un scénario');
  if (process.env.POS_DELIVERY_SCENARIO) assert.deepEqual([...new Set(results.map(result => result.name))].sort(), [...new Set(process.env.POS_DELIVERY_SCENARIO.split(','))].sort(), 'Tout scénario demandé doit exister et avoir réussi');
  await writeFile(join(artifacts, 'result.json'), JSON.stringify({ mode: 'local-http-fixtures', remoteWrites: 0, results }, null, 2));
  console.log(JSON.stringify({ pass: true, artifacts, results }, null, 2));
} finally { await browser.close(); }
