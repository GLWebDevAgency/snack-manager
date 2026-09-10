/** Vraie interface POS, API strictement interceptée et reprise webStore persistante. */
import assert from 'node:assert/strict';
import { cibles } from '../socle/cibles.mjs';
import { scenario } from '../socle/navigateur.mjs';

const c = cibles();
const recovery = { operationId: 'bf5faec4-2836-4f78-920b-52329adb028f', tender: 'cash', expectedTotalCents: 250, cashReceivedCents: 250 };

for (const width of [820, 1280]) {
  for (const exit of ['naturelle', 'passer', 'désactivée', 'mouvement réduit']) {
    scenario(`Caisse — reprise d’encaissement après démarrage ${exit}, ${width}px`,
      { format: { width, height: 900 } }, async (page, { contexte: context, incidents, t }) => {
      const origin = new URL(c.pos).origin;
      await page.emulateMedia({ reducedMotion: 'no-preference' });
      const unexpected = [];
      const businessPosts = [];
      const reads = [];
      const tenant = { slug: 'startup-collection-fixture', name: 'Restaurant fixture', brandColor: '#c9a15a', logoUrl: null };
      const device = { id: 'fixture-pos', kind: 'pos', kindLabel: 'Caisse', name: 'Poste fixture' };
      const product = { _id: 'fixture-product', name: 'Boisson fixture', price: 250, variants: [], optionGroups: [], supplements: [], removables: [], active: true, outOfStock: false, medias: [] };
      const order = {
        _id: 'fixture-order', clientId: 'd59828c4-d67c-4574-843b-41c64ff474dc', number: 901, type: 'pickup', channel: 'online', status: 'ready',
        createdAt: new Date().toISOString(), payment: { method: 'counter', status: 'pending' },
        totals: { subtotal: 250, total: 250 }, statusHistory: [], trackingToken: 'fixture-tracking',
        lines: [{ productId: product._id, name: product.name, qty: 1, unitPrice: 250, lineTotal: 250, options: [], removed: [] }],
      };
      await context.routeWebSocket('**/*', (socket) => socket.close());
      await context.route('**/*', async (route) => {
        const request = route.request();
        const url = new URL(request.url());
        const method = request.method();
        if (url.origin === origin && method === 'GET') return route.continue();
        const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body), headers: {
          'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,POST,OPTIONS',
        } });
        if (url.origin !== new URL(c.api).origin) { unexpected.push(`${method} ${url.origin}${url.pathname}`); return route.abort(); }
        if (method === 'OPTIONS') return json({});
        if (url.pathname === '/public/devices/pair' && method === 'POST') {
          assert.deepEqual(request.postDataJSON(), { pairingCode: 'ABCDEF', expectedKind: 'pos' });
          return json({ deviceToken: 'fixture-device-token', tenant, device });
        }
        if (url.pathname === '/public/devices/pin' && method === 'POST') {
          assert.equal(request.postDataJSON().pin, '2468');
          return json({ token: 'fixture-staff-token', staff: { name: 'Équipier fixture', role: 'caisse' }, tenant, device });
        }
        if (url.pathname === '/public/devices/heartbeat' && method === 'POST') return json({ tenant, device, suspended: false });
        if (url.pathname === `/public/tenants/${tenant.slug}/menu` && method === 'GET') return json({ categories: [{ _id: 'fixture-category', name: 'Boissons', products: [product] }] });
        if (url.pathname === '/orders' && method === 'GET') return json({ rows: [], total: 0, truncated: false });
        if (url.pathname === `/orders/${order._id}` && method === 'GET') { reads.push(url.pathname); return json(order); }
        if (method === 'POST') businessPosts.push(url.pathname);
        unexpected.push(`${method} ${url.pathname}`);
        return json({ message: 'Forbidden fixture mutation or unexpected route' }, 500);
      });
      await context.addInitScript(() => {
        const proof = { splashSeen: false, overlap: false, skipInert: false };
        window.__startupCollection = proof;
        new MutationObserver(() => {
          const splash = document.querySelector('[data-testid="brand-splash"]');
          if (!splash) return;
          proof.splashSeen = true;
          proof.overlap ||= !!document.querySelector('[role="dialog"][aria-label="Encaisser la commande 901"]');
          proof.skipInert ||= !!document.getElementById('sm-startup-skip')?.closest('[inert]');
        }).observe(document, { childList: true, subtree: true, attributes: true, attributeFilter: ['inert'] });
      });
      await page.goto(c.pos, { waitUntil: 'domcontentloaded' });
      await page.getByRole('button', { name: 'Passer l’animation de démarrage', exact: true }).click();
      await page.getByTestId('brand-splash').waitFor({ state: 'hidden' });
      for (const char of 'ABCDEF') await page.getByRole('button', { name: char, exact: true }).click();
      await page.getByText('Code équipier', { exact: true }).waitFor({ state: 'visible' });
      for (const digit of '2468') await page.getByRole('button', { name: digit, exact: true }).click();
      await page.getByRole('button', { name: 'Paramètres du poste', exact: true }).waitFor({ state: 'visible' });
      await page.getByRole('button', { name: /^Boisson fixture,/ }).waitFor({ state: 'visible' });
      // Le véritable adaptateur web POS utilise localStorage. Ajouter uniquement
      // l'opération interrompue, après l'appairage et la session de la fixture.
      await page.evaluate(({ operation, disabled }) => {
        localStorage.setItem('sm.pos.collection-recovery.v1', JSON.stringify({ version: 1, orders: { 'fixture-order': operation } }));
        if (disabled) {
          const prefs = JSON.parse(localStorage.getItem('sm.pos.prefs.v1') ?? '{}');
          localStorage.setItem('sm.pos.prefs.v1', JSON.stringify({ ...prefs, splash: false }));
        }
      }, { operation: recovery, disabled: exit === 'désactivée' });
      if (exit === 'mouvement réduit') await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.reload({ waitUntil: 'domcontentloaded' });
      const dialog = page.getByRole('dialog', { name: 'Encaisser la commande 901', exact: true, includeHidden: true });
      if (exit === 'naturelle' || exit === 'passer') {
        await page.getByTestId('brand-splash').waitFor({ state: 'visible' });
        await page.getByRole('button', { name: /^Boisson fixture,/, includeHidden: true }).waitFor({ state: 'visible' });
        // Le menu chargé reste monté sous le démarrage, mais sa modale de reprise
        // ne doit pas encore prendre le focus ni intervenir dans l'isolation.
        await page.keyboard.press('Tab');
        const focus = await page.evaluate(() => {
          const skip = document.getElementById('sm-startup-skip');
          return { present: !!skip, inert: !!skip?.closest('[inert]'), focused: skip === document.activeElement };
        });
        t.diagnostic(JSON.stringify({ width, exit, focus }));
        assert.equal(focus.present, true);
        assert.equal(focus.inert, false, 'startup Skip must remain interactive');
        assert.equal(focus.focused, true, 'Tab must retain the startup Skip control');
        assert.equal(await dialog.count(), 0, 'automatic recovery must wait for startup to finish');
        if (exit === 'passer') await page.keyboard.press('Enter');
        await page.getByTestId('brand-splash').waitFor({ state: 'hidden' });
      }
      await dialog.waitFor({ state: 'visible' });
      const resume = dialog.getByRole('button', { name: 'Reprendre la confirmation du règlement', exact: true });
      await resume.waitFor({ state: 'visible' });
      assert.equal(await resume.isEnabled(), true);
      await resume.focus();
      assert.equal(await resume.evaluate((el) => document.activeElement === el && !el.closest('[inert]')), true);
      const proof = await page.evaluate(() => window.__startupCollection);
      t.diagnostic(JSON.stringify({ width, exit, proof, reads: reads.length, unexpected, businessPosts, incidents }));
      // En mouvement réduit le splash peut disparaître avant la première frame ;
      // l'observateur doit néanmoins interdire tout chevauchement fugitif.
      if (exit !== 'mouvement réduit') assert.equal(proof.splashSeen, exit !== 'désactivée');
      assert.equal(proof.overlap, false, 'collection and startup must never overlap, including a transient mount');
      assert.equal(proof.skipInert, false, 'recovery must never hide the startup Skip from assistive technology');
      assert.ok(reads.length >= 2, 'real automatic restore and modal inspection must read the existing order');
      assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('sm.pos.collection-recovery.v1'))),
        { version: 1, orders: { 'fixture-order': recovery } }, 'the same order, operation UUID, tender and amount must remain recoverable');
      assert.deepEqual(businessPosts, [], 'no order or payment POST is permitted');
      assert.deepEqual(unexpected, []);
      assert.deepEqual(incidents, []);
    });
  }
}
