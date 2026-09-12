/** Vrai export POS, HTTP simulé localement. La preuve Mongo/HTTP est distincte. */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const snapshot = require('../../packages/client-core/src/demo/snapshot.ts');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const base = 'http://127.0.0.1:8092';
const artifacts = join(root, 'docs/refonte-ui/captures/pos-salle-v2');
await mkdir(artifacts, { recursive: true });
const tenant = { ...snapshot.SNAPSHOT_TENANT };
const device = { id: 'local-dining-pos', kind: 'pos', kindLabel: 'Caisse', name: 'Caisse QA locale' };
const staffToken = `local.${Buffer.from(JSON.stringify({ sub: '65f000000000000000000002', tenantId: '65f000000000000000000001' })).toString('base64url')}.fixture`;
const products = new Map(snapshot.SNAPSHOT_PRODUCTS.map(p => [p.id, {
  _id: p.id, name: p.name, description: p.description, price: p.price, variants: p.variants ?? [],
  optionGroups: (p.groups ?? []).map(key => snapshot.SNAPSHOT_GROUPS[key]),
  supplements: (snapshot.SNAPSHOT_SUPPLEMENT_SETS[p.supplements] ?? []).map(key => snapshot.SNAPSHOT_SUPPLEMENTS[key]),
  removables: (snapshot.SNAPSHOT_REMOVABLE_SETS[p.removables] ?? []).map(key => ({ key, label: snapshot.SNAPSHOT_REMOVABLES[key] })),
  active: true, photoUrl: p.photo ?? null, medias: [],
}]));
const menu = { categories: snapshot.SNAPSHOT_CATEGORIES.map(c => ({ _id: c.id, name: c.name, products: c.products.map(id => products.get(id)) })) };
const browser = await chromium.launch({ headless: true });
const results = [];

async function scenario(name, viewport, theme, failure = null) {
  const context = await browser.newContext({ viewport, serviceWorkers: 'block', reducedMotion: 'reduce' });
  const page = await context.newPage(); page.setDefaultTimeout(20_000);
  const tables = [{ id: '849aaf0b-d1d4-4656-b733-1aa1bd489173', label: 'Terrasse 1', seats: 4, active: true, revision: 0 },
    { id: 'b0173871-811a-43ee-ae1c-504163424662', label: 'Salle 2', seats: 6, active: true, revision: 0 }];
  let session = null; const orders = new Map(), receipts = new Map(), requests = [], errors = [], shots = [];
  let lost = false, number = 40;
  page.on('pageerror', e => errors.push(e.message));
  await context.routeWebSocket('**/*', socket => socket.close());
  await context.addInitScript(({ tenant, device, theme, token }) => {
    const originalSet = Storage.prototype.setItem;
    Storage.prototype.setItem = function(key, value) {
      if (key === 'sm.pos.daylog.v1' && window.localDiningJournalRefused) throw new DOMException('Quota de recette', 'QuotaExceededError');
      return originalSet.call(this, key, value);
    };
    if (localStorage.getItem('dining-local-seeded')) return;
    localStorage.setItem('dining-local-seeded', '1');
    localStorage.setItem('sm.pos.device.v1', JSON.stringify({ deviceToken: 'local-fake-device', tenant, device }));
    localStorage.setItem('sm.pos.session.v1', JSON.stringify({ token, staffName: 'Équipier QA', staffRole: 'caisse', tenantName: tenant.name, tenantSlug: tenant.slug, brandColor: tenant.brandColor, at: Date.now() }));
    localStorage.setItem('sm.pos.prefs.v1', JSON.stringify({ theme, layout: 'A', splash: false, reduceMotion: true }));
  }, { tenant, device, theme, token: staffToken });
  await context.route('**/*', async route => {
    const req = route.request(), url = new URL(req.url()), method = req.method(), path = url.pathname;
    const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) });
    if (['localhost', '127.0.0.1'].includes(url.hostname) && /^\/photos\/[a-z0-9-]+\.(webp|avif|png|jpe?g)$/.test(path)) return route.fulfill({ path: join(root, 'apps/web/public', path), headers: { 'access-control-allow-origin': '*' } });
    if (url.origin === base && !['xhr', 'fetch'].includes(req.resourceType())) return route.continue();
    if (url.origin !== 'http://localhost:3001') return route.abort();
    const body = method === 'POST' || method === 'PATCH' ? req.postDataJSON() : null;
    requests.push({ method, path, body });
    if (method === 'OPTIONS') return json({});
    if (path.includes('/socket.io')) return json({}, 400);
    if (path.endsWith('/heartbeat')) return json({ tenant, device });
    if (path.endsWith('/menu')) return json(menu);
    if (path === '/orders/count') return json({ total: orders.size });
    if (path.startsWith('/public/orders/') && path.endsWith('/ticket')) {
      assert.equal(url.searchParams.get('t'), 'local-tracking-token');
      const row = orders.get(path.split('/').at(-2));
      return json({ orderId: row._id, pickupNumber: row.number, header: { tenantName: tenant.name, slug: tenant.slug, address: '', phones: [] },
        createdAt: row.createdAt, printedAt: new Date().toISOString(), channelLabel: 'Caisse', typeLabel: 'Sur place', statusLabel: 'Remise',
        dining: { tableLabel: row.dining.tableLabel }, pickup: null, lines: row.lines, totals: { ...row.totals, discount: null },
        payment: { methodLabel: 'Au comptoir', tenderLabel: 'Carte bancaire', statusLabel: 'Payée', paid: true, cashReceived: null, changeGiven: null }, note: row.note ?? null });
    }
    if (path === '/orders' && method === 'GET') {
      const status = url.searchParams.get('status'); const rows = [...orders.values()].filter(o => !status || o.status === status);
      return json({ rows, total: rows.length, truncated: false });
    }
    if (path === '/dining/room') return json({ tables, sessions: session?.state === 'open' ? [session] : [] });
    if (path.startsWith('/dining/sessions/') && method === 'GET') return json({ session, orders: [...orders.values()] });
    if (path.startsWith('/dining/') && method === 'POST') {
      const previous = receipts.get(body.operationId);
      if (previous) return json(previous.order ? { ...previous, order: orders.get(previous.order._id) } : previous);
      let result;
      if (path === '/dining/sessions') {
        session = { id: body.operationId, tableId: body.tableId, tableLabel: tables.find(t => t.id === body.tableId).label,
          guestCount: body.guestCount, revision: 0, state: 'open', openedAt: new Date().toISOString(), closedAt: null, orderIds: [], pendingOperationCount: 0 };
        result = session;
      } else if (path.endsWith('/transfer')) {
        assert.equal(body.expectedRevision, session.revision);
        session = { ...session, tableId: body.tableId, tableLabel: tables.find(t => t.id === body.tableId).label, revision: session.revision + 1 }; result = session;
      } else if (path.endsWith('/orders')) {
        assert.equal(body.expectedRevision, session.revision); assert.equal(body.order.payment.tender, null); assert.equal(body.order.type, 'surplace');
        const order = { ...body.order, _id: (65 + orders.size).toString(16).padStart(24, '0'), number: ++number,
          status: 'new', createdAt: new Date().toISOString(), payment: { method: 'counter', status: 'pending', tender: null },
          totals: { subtotal: 1250, total: 1250 }, trackingToken: 'local-tracking-token',
          dining: { sessionId: session.id, tableId: session.tableId, tableLabel: session.tableLabel },
          lines: body.order.lines.map(line => ({ ...line, name: products.get(line.productId)?.name ?? 'Plat', unitPrice: 1250, lineTotal: 1250,
            options: line.options.map(o => ({ ...o, name: 'Sauce sélectionnée', priceDelta: 0 })) })) };
        orders.set(order._id, order); session = { ...session, revision: session.revision + 1, orderIds: [...session.orderIds, order._id] }; result = { session, order };
      } else if (path.endsWith('/serve')) {
        const id = path.split('/').at(-2), row = orders.get(id); assert.equal(row.status, 'ready');
        row.dining.servedAt = new Date().toISOString(); result = { session, order: row };
      } else if (path.endsWith('/close')) {
        for (const row of orders.values()) { if (row.status === 'delivered' && row.payment.status === 'refunded') continue; assert.equal(row.payment.status, 'paid'); assert.ok(row.dining.servedAt); row.status = 'delivered'; }
        session = { ...session, state: 'closed', closedAt: new Date().toISOString(), revision: session.revision + 1 }; result = session;
      } else return json({ message: `Unknown dining ${path}` }, 404);
      receipts.set(body.operationId, structuredClone(result));
      if (!lost && ['lost-order', 'two-tabs', 'refunded', 'refunded-existing'].includes(failure) && path.endsWith('/orders')) { lost = true; return route.abort('failed'); }
      if (!lost && failure === 'journal' && path.endsWith('/orders')) { lost = true; await page.evaluate(() => { window.localDiningJournalRefused = true; }); }
      return json(result);
    }
    if (path.match(/^\/orders\/[a-f0-9]{24}$/) && method === 'GET') return json(orders.get(path.split('/').at(-1)));
    if (path.endsWith('/collect')) {
      const row = orders.get(path.split('/').at(-2)); assert.equal(body.expectedTotalCents, row.totals.total);
      row.payment = { method: 'counter', status: 'paid', tender: body.tender, cashReceived: body.cashReceivedCents, changeGiven: body.cashReceivedCents ? body.cashReceivedCents - row.totals.total : undefined };
      return json(row);
    }
    if (path.endsWith('/status') && method === 'PATCH') { const row = orders.get(path.split('/').at(-2)); row.status = body.status; return json(row); }
    return json({ message: `Unhandled local fixture ${method} ${path}` }, 404);
  });
  async function shot(suffix) { const file = `${name}-${suffix}.png`; await page.screenshot({ path: join(artifacts, file), fullPage: true }); shots.push(file); }
  async function refresh() { await page.getByRole('button', { name: 'Actualiser la salle', exact: true }).click(); }
  async function addRound() {
    await page.getByRole('button', { name: 'Ajouter des plats', exact: true }).click();
    await page.getByRole('tab', { name: 'Gourmets Burgers', exact: true }).click();
    await page.getByRole('button', { name: /^Le Classic,/ }).click();
    await page.getByRole('button', { name: /^Ajouter ·/ }).click();
    const dock = page.getByRole('button', { name: 'Envoyer les plats de la table en cuisine', exact: true });
    if (await dock.count()) await dock.click(); else await page.getByRole('button', { name: 'Envoyer en cuisine', exact: true }).click();
  }
  try {
    await page.goto(base); await page.getByRole('button', { name: /^Végétarien,/ }).waitFor();
    let companion;
    if (failure === 'two-tabs') {
      companion = await context.newPage(); companion.on('pageerror', e => errors.push(e.message));
      await companion.goto(base); await companion.getByRole('tab', { name: 'Gourmets Burgers', exact: true }).click();
      await companion.getByRole('button', { name: /^Le Classic,/ }).click();
      await companion.getByRole('button', { name: /^Ajouter ·/ }).click();
      await companion.getByRole('button', { name: 'Modifier Le Classic', exact: true }).waitFor();
    }
    await page.getByRole('button', { name: 'La salle', exact: true }).click();
    await page.getByRole('button', { name: 'Terrasse 1, libre, 4 places', exact: true }).click();
    await page.getByRole('textbox', { name: 'Nombre de couverts', exact: true }).fill('3');
    await page.getByRole('button', { name: 'Ouvrir la tablée', exact: true }).click();
    await page.getByRole('button', { name: 'Ajouter des plats', exact: true }).waitFor();
    await shot('table-ouverte');
    await addRound();
    if (companion) {
      await page.getByRole('button', { name: 'Vérifier l’opération de salle', exact: true }).waitFor();
      await companion.getByRole('button', { name: 'Vérifier l’opération de salle', exact: true }).click();
      await companion.getByRole('button', { name: 'Actualiser la salle', exact: true }).waitFor();
      await companion.getByRole('tab', { name: 'Vendre', exact: true }).click();
      await companion.getByRole('button', { name: 'Modifier Le Classic', exact: true }).waitFor();
      await companion.screenshot({ path: join(artifacts, `${name}-brouillon-etranger-conserve.png`), fullPage: true });
      shots.push(`${name}-brouillon-etranger-conserve.png`);
      // L'onglet source n'est pas rendu revendable par l'acquittement du compagnon.
      await page.getByRole('button', { name: 'Vérifier l’opération de salle', exact: true }).click();
      await page.getByRole('button', { name: 'Actualiser la salle', exact: true }).waitFor();
      const sent = requests.filter(r => r.path.endsWith('/orders') && r.path.startsWith('/dining/') && r.method === 'POST');
      assert.equal(sent.length, 3); assert.deepEqual(sent.map(r => r.body), [sent[0].body, sent[0].body, sent[0].body]);
      assert.equal(orders.size, 1);
    }
    if (failure === 'refunded' || failure === 'refunded-existing') {
      await page.getByRole('button', { name: 'Vérifier l’opération de salle', exact: true }).waitFor();
      const row = [...orders.values()][0];
      if (failure === 'refunded-existing') await page.evaluate(row => {
        const key = 'sm.pos.daylog.v1';
        const file = JSON.parse(localStorage.getItem(key) ?? 'null') ?? { version: 2, generation: 0, revision: 0, day: new Date().toLocaleDateString('sv-SE') };
        file.revision += 1;
        file.entries = [{ clientId: row.clientId, localNumber: row.number, serverId: row._id, serverNumber: row.number, trackingToken: row.trackingToken, mode: 'surplace', method: 'retrait', paid: false, total: row.totals.total, items: 1, at: Date.parse(row.createdAt) }];
        localStorage.setItem(key, JSON.stringify(file));
      }, row);
      row.status = 'delivered'; row.payment = { method: 'counter', status: 'refunded', tender: 'card' };
      await page.reload();
      await page.getByRole('button', { name: 'Vérifier l’opération de salle', exact: true }).click();
      await page.getByRole('button', { name: 'Libérer la table', exact: true }).click();
      await page.getByRole('button', { name: 'Confirmer la libération', exact: true }).click();
      await page.getByRole('button', { name: 'Terrasse 1, libre, 4 places', exact: true }).waitFor();
      const journal = await page.evaluate(() => JSON.parse(localStorage.getItem('sm.pos.daylog.v1')));
      assert.equal(journal.entries.length, 1); assert.equal(journal.entries[0].refunded, true); assert.equal(journal.entries[0].paid, true);
      assert.equal(requests.filter(r => r.path.endsWith('/collect')).length, 0);
      const sent = requests.filter(r => r.path.endsWith('/orders') && r.path.startsWith('/dining/') && r.method === 'POST');
      assert.equal(sent.length, 2); assert.deepEqual(sent[0].body, sent[1].body);
      assert.equal(await page.evaluate(() => localStorage.getItem('sm.pos.dining-operation.v1')), null);
      await page.getByRole('button', { name: 'Récapitulatif local du poste', exact: true }).click();
      await page.getByText(/Les remboursements ne sont pas déduits de ce journal historique/).waitFor();
      await page.getByRole('checkbox', { name: 'Commandes · 1', exact: true }).click();
      await page.getByText(/Remboursé · encaissement historique/).waitFor();
      await shot('remboursement-avant-reprise'); assert.deepEqual(errors, []);
      results.push({ name, pass: true, shots, requests, errors }); return;
    }
    if (failure === 'lost-order' || failure === 'journal') {
      await page.getByRole('button', { name: 'Vérifier l’opération de salle', exact: true }).waitFor();
      const first = requests.find(r => r.path.endsWith('/orders') && r.path.startsWith('/dining/') && r.method === 'POST');
      await shot(failure === 'journal' ? 'journal-refuse' : 'reponse-perdue');
      if (failure === 'lost-order') {
        await page.evaluate(() => {
          const session = JSON.parse(localStorage.getItem('sm.pos.session.v1'));
          session.token = `local.${btoa(JSON.stringify({ sub: '65f000000000000000000099', tenantId: '65f000000000000000000001' }))}.fixture`;
          localStorage.setItem('sm.pos.session.v1', JSON.stringify(session));
        });
        await page.reload();
        await page.getByText('Reconnectez l’équipier ayant commencé cette opération pour la reprendre.', { exact: true }).waitFor();
        assert.ok(await page.getByRole('button', { name: 'Vérifier l’opération de salle', exact: true }).isDisabled());
        assert.equal(requests.filter(r => r.path.endsWith('/orders') && r.path.startsWith('/dining/') && r.method === 'POST').length, 1);
        await shot('autre-equipier-bloque');
        await page.evaluate(token => { const session = JSON.parse(localStorage.getItem('sm.pos.session.v1')); session.token = token; localStorage.setItem('sm.pos.session.v1', JSON.stringify(session)); }, staffToken);
      }
      await page.reload();
      await page.getByRole('button', { name: 'Vérifier l’opération de salle', exact: true }).click();
      await page.getByRole('button', { name: 'Actualiser la salle', exact: true }).waitFor();
      const sent = requests.filter(r => r.path.endsWith('/orders') && r.path.startsWith('/dining/') && r.method === 'POST');
      assert.equal(sent.length, 2); assert.deepEqual(sent[1].body, first.body); assert.equal(orders.size, 1);
    }
    await page.getByText('Commande #41', { exact: true }).waitFor();
    const order = [...orders.values()][0]; assert.equal(order.payment.status, 'pending');
    order.status = 'ready'; await refresh();
    await page.getByRole('button', { name: 'Confirmer le service #41', exact: true }).click();
    await page.getByText('Servie à table · À encaisser', { exact: true }).waitFor();
    assert.equal(requests.filter(r => r.path.endsWith('/collect')).length, 0);
    assert.ok(await page.getByRole('button', { name: 'Libérer la table', exact: true }).isDisabled());
    await shot('servie-avant-paiement');
    await page.getByRole('button', { name: 'Changer de table', exact: true }).click();
    await page.getByRole('button', { name: 'Salle 2 · 6 places', exact: true }).click();
    await page.getByRole('button', { name: 'Salle 2, occupée, 3 couverts', exact: true }).waitFor();
    assert.equal(order.dining.tableLabel, 'Terrasse 1');
    await shot('table-transferee');
    await page.getByRole('button', { name: 'Encaisser #41', exact: true }).click();
    await page.getByRole('radio', { name: 'Carte · TPE', exact: true }).click();
    await page.getByRole('checkbox', { name: 'Confirmer le paiement accepté sur le TPE', exact: true }).click();
    await page.getByRole('button', { name: /^Confirmer .* encaissés$/ }).click();
    await page.getByRole('button', { name: 'Retour à la commande', exact: true }).click();
    await refresh();
    await page.getByRole('button', { name: 'Libérer la table', exact: true }).click();
    await page.getByRole('button', { name: 'Confirmer la libération', exact: true }).click();
    await page.getByRole('button', { name: 'Salle 2, libre, 6 places', exact: true }).waitFor();
    await shot('table-liberee');
    assert.equal(session.state, 'closed'); assert.equal(order.status, 'delivered'); assert.equal(orders.size, 1);
    assert.equal(requests.filter(r => r.method === 'POST' && r.path === '/orders').length, 0);
    const journal = await page.evaluate(() => JSON.parse(localStorage.getItem('sm.pos.daylog.v1')));
    assert.equal(journal.entries.length, 1); assert.equal(journal.entries[0].serverNumber, 41); assert.equal(journal.entries[0].paid, true);
    assert.equal(await page.evaluate(() => localStorage.getItem('sm.pos.dining-operation.v1')), null);
    await page.getByRole('button', { name: 'Récapitulatif local du poste', exact: true }).click();
    await page.getByRole('checkbox', { name: 'Commandes · 1', exact: true }).click();
    await page.getByRole('button', { name: 'Ticket', exact: true }).click();
    await page.getByRole('dialog', { name: 'Ticket client', exact: true }).getByText('Table · Terrasse 1', { exact: true }).waitFor();
    await shot('ticket-table-historique');
    const geometry = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth }));
    assert.ok(geometry.scroll <= geometry.width); assert.deepEqual(errors, []);
    results.push({ name, pass: true, shots, requests, errors });
  } catch (error) {
    await shot('failure'); await writeFile(join(artifacts, `${name}-failure.txt`), await page.locator('body').innerText());
    results.push({ name, pass: false, error: String(error), shots, requests, errors }); throw error;
  } finally { await context.close(); await writeFile(join(artifacts, 'resultats.json'), JSON.stringify({ source: 'real POS export; local HTTP fixtures; no real payment', results }, null, 2)); }
}
try {
  await scenario('desktop-clair', { width: 1512, height: 982 }, 'light');
  await scenario('mobile-sombre', { width: 390, height: 844 }, 'dark');
  await scenario('reprise-apres-reload', { width: 1280, height: 800 }, 'light', 'lost-order');
  await scenario('journal-refuse-reload', { width: 1280, height: 800 }, 'dark', 'journal');
  await scenario('deux-onglets', { width: 1280, height: 800 }, 'light', 'two-tabs');
  await scenario('rembourse-avant-reprise', { width: 1280, height: 800 }, 'light', 'refunded');
  await scenario('rembourse-journal-existant', { width: 1280, height: 800 }, 'dark', 'refunded-existing');
  console.log('POS salle : 7/7 parcours navigateur réussis.');
} finally { await browser.close(); }
