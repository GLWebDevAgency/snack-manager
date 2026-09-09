/// <reference lib="dom" />
import 'reflect-metadata';
import { readFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { build } from 'esbuild';
import postcss from 'postcss';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DeliveryHandoffResultSchema, type DeliveryHandoffResult } from '@sm/contracts';
import { createHandoffFixture } from './delivery-handoff.test-fixtures';

/** Last-mile integration, not full-application E2E.
 * Real React components/DS, IndexedDB, sessionStorage, HTTP Nest guards,
 * handoff crypto/domain, Mongo and AuditLog. The same-origin test bridge only
 * forwards allowlisted requests and supplies a real fixture courier bearer.
 * Guest account availability is an exact closed-capability fixture; no other
 * account request is admitted or forwarded by this handoff-only harness.
 * It does NOT implement or validate Next/BFF cookies, checkout creation,
 * Stripe, KDS, Redis quotas/pubsub, camera hardware or production font loading.
 * The fixture owns a UUID-suffixed loopback database; no external I/O is allowed.
 * CI: DELIVERY_HANDOFF_HTTP_TEST_MONGO_URL + the existing Chromium install.
 */
const rawUri = process.env.DELIVERY_HANDOFF_HTTP_TEST_MONGO_URL;
// The API compiles as CommonJS; Tailwind exposes its typings through exports
// unavailable to that legacy resolver. This is a build-time test plugin only.
const tailwind = createRequire(__filename)('@tailwindcss/postcss') as (options: { base: string }) => postcss.AcceptedPlugin;
type Fixture = Awaited<ReturnType<typeof createHandoffFixture>>;
type Observation = { endpoint: 'confirm' | 'resolve'; operationId: string; keys: string[]; proofKind?: string };

(rawUri ? describe : describe.skip)('remise — interfaces réelles vers Nest/Mongo isolés', () => {
  let fixture: Fixture;
  let browser: Browser | undefined;
  let server: Server | undefined;
  let origin: string;
  let order: Awaited<ReturnType<Fixture['seed']>>;
  let connected: Awaited<ReturnType<Fixture['connect']>>;
  let lostResult: DeliveryHandoffResult | undefined;
  let resolvedResult: DeliveryHandoffResult | undefined;
  let deliveredAtBeforeResolve: number | undefined;
  const observations: Observation[] = [];
  const faults: string[] = [];
  let proofRequests = 0;
  let closedAccountCapabilityReads = 0;
  let proofIdentityValid = true;
  let lostResponses = 0;
  const handoffReads: number[] = [];

  beforeAll(async () => {
    fixture = await createHandoffFixture(rawUri!);
    await fixture.reset();
    connected = await fixture.connect();
    order = await fixture.seed(connected.operator.id);

    const webRoot = resolve(__dirname, '../../../../web');
    const cssPath = resolve(webRoot, 'src/app/globals.css');
    const [bundle, css] = await Promise.all([
      build({ stdin: { contents: `
        import React from 'react';import {createRoot} from 'react-dom/client';
        import {DeliveryHandoffPanel} from './src/components/delivery-handoff/Panel';
        import {CustomerDeliveryProof} from './src/components/order/CustomerDeliveryProof';
        import {marqueDeRepli} from '@sm/contracts';
        import {styleDuMasque} from './src/components/masque/styleDuMasque';
        const customer=location.pathname==='/customer';
        createRoot(document.getElementById('root')).render(<React.StrictMode>
          <main style={customer?styleDuMasque(marqueDeRepli(null,null)):undefined} className="min-h-dvh bg-bg text-ink p-4">
            <div className="mx-auto max-w-[460px]">
              <h1 className="text-2xl font-semibold">{customer?'Suivi de commande':'Mission du livreur'}</h1>
              {customer?<CustomerDeliveryProof orderId='${order.id}' tenant='handoff-http' ready finished={false}/>
                :<DeliveryHandoffPanel missionId='${order.id}' scope='driver:handoff-http:${connected.operator.id}' path='/handoff' available/>}
            </div>
          </main>
        </React.StrictMode>);`, resolveDir: webRoot, sourcefile: 'handoff-http-fixture.tsx', loader: 'tsx' },
      tsconfig: resolve(webRoot, 'tsconfig.json'), outdir: '/virtual-handoff-http-fixture', write: false,
      bundle: true, format: 'esm', platform: 'browser', target: 'es2022', jsx: 'automatic',
      // Next transforms these imports at build time; this renderer deliberately
      // exercises the actual DS with system fonts, not the Next build pipeline.
      plugins: [{ name: 'next-font-boundary', setup(builder) {
        builder.onResolve({ filter: /^next\/font\/google$/ }, () => ({ path: 'font', namespace: 'font-fixture' }));
        builder.onLoad({ filter: /.*/, namespace: 'font-fixture' }, () => ({ contents: `const font=()=>({variable:'',className:'',style:{fontFamily:'Arial'}});export {${['Alegreya_Sans', 'Archivo', 'Archivo_Black', 'Bricolage_Grotesque', 'Cormorant_Garamond', 'Familjen_Grotesk', 'Figtree', 'Fraunces', 'Instrument_Sans', 'JetBrains_Mono', 'Lato', 'Libre_Baskerville', 'Manrope', 'Nunito', 'Nunito_Sans', 'Outfit', 'Playfair_Display', 'Source_Sans_3'].map(name => `font as ${name}`).join(',')}}` }));
      } }],
      define: { 'process.env.NODE_ENV': '"production"', 'process.env.NEXT_PUBLIC_API_URL': '"/api"' } }),
      readFile(cssPath, 'utf8').then(source => postcss([tailwind({ base: webRoot })]).process(source, { from: cssPath })),
    ]);
    const js = bundle.outputFiles.find(file => file.path.endsWith('.js'))!.text;
    const styles = css.css + (bundle.outputFiles.find(file => file.path.endsWith('.css'))?.text ?? '');
    server = createServer((req, res) => { void (async () => {
      res.setHeader('Cache-Control', 'no-store');
      const path = new URL(req.url ?? '/', 'http://127.0.0.1').pathname;
      if (req.method === 'GET' && ['/bundle.js', '/style.css'].includes(path)) {
        res.setHeader('Content-Type', path.endsWith('.js') ? 'text/javascript' : 'text/css');
        res.end(path.endsWith('.js') ? js : styles); return;
      }
      if (req.method === 'GET' && ['/customer', '/driver'].includes(path)) {
        res.setHeader('Content-Type', 'text/html');
        res.end('<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><title>Recette locale remise HTTP</title><link rel="stylesheet" href="/style.css"></head><body><div id="root"></div><script type="module" src="/bundle.js"></script></body></html>'); return;
      }
      if (path === '/favicon.ico') { res.writeHead(204).end(); return; }
      // CustomerDeliveryProof checks account availability even for an imported
      // guest receipt. Keep the account closed without weakening the HTTPS BFF
      // or allowing a session, mutation, another tenant, or a query variant.
      if (req.method === 'GET' && req.url === '/r/handoff-http/compte/capacites') {
        closedAccountCapabilityReads++;
        res.writeHead(200, { 'Content-Type': 'application/json' }).end('{"available":false}'); return;
      }
      const publicProof = path === `/api/public/orders/${order.id}/delivery-proof` && req.method === 'POST';
      const handoff = (path === '/handoff' && req.method === 'GET')
        || (['/handoff/confirm', '/handoff/resolve'].includes(path) && req.method === 'POST');
      if (!publicProof && !handoff) { faults.push('unallowlisted local request'); res.writeHead(404).end(); return; }
      const chunks: Buffer[] = []; let bytes = 0;
      for await (const chunk of req) {
        bytes += Buffer.byteLength(chunk);
        if (bytes > 4096) throw new Error('Oversized fixture request');
        chunks.push(Buffer.from(chunk));
      }
      const bodyText = Buffer.concat(chunks).toString();
      const body = bodyText ? JSON.parse(bodyText) as Record<string, unknown> : undefined;
      if (publicProof) {
        proofRequests++;
        proofIdentityValid &&= body?.clientId === order.clientId && body?.recoveryProof === order.recoveryProof;
      } else if (body) {
        const proof = body.proof && typeof body.proof === 'object' ? body.proof as Record<string, unknown> : undefined;
        observations.push({ endpoint: path.endsWith('/confirm') ? 'confirm' : 'resolve',
          operationId: String(body.operationId), keys: Object.keys(body).sort(), proofKind: typeof proof?.kind === 'string' ? proof.kind : undefined });
      }
      const upstreamPath = publicProof ? path.slice('/api'.length)
        : `/delivery-access/missions/${order.id}/handoff${path.slice('/handoff'.length)}`;
      const upstream = await fetch(`${fixture.origin}${upstreamPath}`, { method: req.method,
        headers: { ...(bodyText ? { 'content-type': 'application/json' } : {}),
          ...(!publicProof ? { authorization: `Bearer ${connected.token}` } : {}) },
        ...(bodyText ? { body: bodyText } : {}), redirect: 'error', signal: AbortSignal.timeout(10_000) });
      const responseText = await upstream.text();
      if (path === '/handoff') handoffReads.push(upstream.status);
      if (path === '/handoff/confirm' && upstream.ok) {
        lostResult = DeliveryHandoffResultSchema.parse(JSON.parse(responseText));
        const stored = await fixture.models.Order.findById(order.id).lean();
        deliveredAtBeforeResolve = stored?.delivery?.deliveredAt?.getTime();
        // This is a real committed HTTP response, deliberately lost only on its
        // way back to the browser. No fabricated 200/result or API implementation.
        if (lostResponses++ === 0) {
          // Sending the real headers and a first body byte prevents Chromium
          // from transparently retrying a connection lost before any response.
          res.writeHead(upstream.status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(responseText) });
          res.write(responseText.slice(0, 1), () => res.destroy()); return;
        }
      }
      if (path === '/handoff/resolve' && upstream.ok) resolvedResult = DeliveryHandoffResultSchema.parse(JSON.parse(responseText));
      res.writeHead(upstream.status, { 'Content-Type': 'application/json', 'Cache-Control': upstream.headers.get('cache-control') ?? 'no-store' }).end(responseText);
    })().catch(() => { faults.push('local bridge failed'); if (!res.destroyed) res.writeHead(500).end(); }); });
    await new Promise<void>((done, reject) => { server!.once('error', reject); server!.listen(0, '127.0.0.1', done); });
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    browser = await chromium.launch({ headless: true });
  }, 30_000);

  afterAll(async () => {
    try { await browser?.close(); }
    finally {
      try { if (server) { server.closeAllConnections(); await new Promise<void>((done, reject) => server!.close(error => error ? reject(error) : done())); } }
      finally { await fixture?.close(); }
    }
  });

  async function isolatedPage(): Promise<{ context: BrowserContext; page: Page }> {
    const context = await browser!.newContext({ viewport: { width: 320, height: 800 }, reducedMotion: 'reduce', serviceWorkers: 'block' });
    await context.route('**/*', route => {
      if (new URL(route.request().url()).origin !== origin) { faults.push('external request blocked'); return route.abort(); }
      return route.continue();
    });
    const page = await context.newPage();
    page.setDefaultTimeout(5_000);
    page.on('pageerror', () => faults.push('browser runtime error'));
    page.on('console', message => {
      // Exactly the deliberately destroyed HTTP response may emit this browser
      // network diagnostic. No application error or other network error is ignored.
      const expectedLoss = lostResponses === 1 && message.location().url === `${origin}/handoff/confirm`
        && /net::ERR_(?:EMPTY_RESPONSE|CONTENT_LENGTH_MISMATCH)/.test(message.text());
      const expectedClosedMission = lostResponses === 1 && message.location().url === `${origin}/handoff`
        && message.text().includes('the server responded with a status of 404');
      if (message.type() === 'error' && !expectedLoss && !expectedClosedMission) faults.push('browser console error');
    });
    return { context, page };
  }

  it('preuve privée, PIN, réponse perdue après commit, reload puis resolve : une seule remise et un seul audit', async () => {
    const customer = await isolatedPage();
    const driver = await isolatedPage();
    try {
      // The private capability never enters the bundle, an HTTP URL, the courier
      // context or a snapshot/log. Only the customer fragment and POST receive it.
      await customer.page.goto(`${origin}/customer#remise=v1.${order.clientId}.${order.recoveryProof}`);
      expect(await customer.page.title()).toBe('Recette locale remise HTTP');
      await customer.page.getByRole('heading', { name: 'Suivi de commande' }).waitFor();
      await customer.page.getByRole('button', { name: 'Afficher mon code de remise' }).click();
      await customer.page.getByAltText('QR privé à présenter au livreur').waitFor();
      const pin = await customer.page.locator('[aria-label^="Code de remise :"]').textContent();
      expect(/^\d{6}$/.test(pin ?? '')).toBe(true);
      expect(new URL(customer.page.url()).hash).toBe('');
      expect(proofRequests).toBe(1); expect(proofIdentityValid).toBe(true);
      // Native IndexedDB import must survive a reload without the transferred hash.
      await customer.page.reload();
      await customer.page.getByRole('button', { name: 'Afficher mon code de remise' }).click();
      await customer.page.getByAltText('QR privé à présenter au livreur').waitFor();
      expect((await customer.page.locator('[aria-label^="Code de remise :"]').textContent()) === pin).toBe(true);
      expect(proofRequests).toBe(2); expect(proofIdentityValid).toBe(true);
      expect(closedAccountCapabilityReads).toBe(2);

      await driver.page.goto(`${origin}/driver`);
      await driver.page.getByRole('heading', { name: 'Mission du livreur' }).waitFor();
      expect(await driver.page.getByRole('button', { name: 'Remise exceptionnelle', exact: true }).count()).toBe(0);
      await driver.page.getByLabel('Code de remise à six chiffres').fill(pin!);
      await driver.page.getByRole('button', { name: 'Confirmer la remise au client' }).click();
      await expect.poll(() => ({ sent: observations.length, committed: lostResult?.outcome, dropped: lostResponses, faults, reads: handoffReads }), { timeout: 5_000 }).toMatchObject({ sent: 1, committed: 'applied', dropped: 1, faults: [] });
      await driver.page.getByRole('alert').filter({ hasText: 'La réponse n’est pas confirmée' }).waitFor();
      expect(observations).toHaveLength(1); expect(observations[0]?.proofKind).toBe('pin');
      expect(lostResponses).toBe(1);
      expect(lostResult).toMatchObject({ outcome: 'applied', replay: false, action: 'handoff', state: { orderStatus: 'delivered' } });
      expect(Number.isFinite(deliveredAtBeforeResolve)).toBe(true);
      expect(await fixture.models.AuditLog.countDocuments({ targetId: order.id })).toBe(1);
      const journal = await driver.page.evaluate(() => Object.entries(sessionStorage).filter(([key]) => key.startsWith('sm.delivery-handoff.v1.')).map(([, value]) => value));
      expect(journal).toHaveLength(1);
      expect(journal.some(raw => raw.includes(pin!) || raw.includes(order.recoveryProof) || /"proof"|"pin"|"qr"|"reason"/.test(raw))).toBe(false);

      // The real courier GET is no longer an active mission after delivery.
      // An unknown local operation must still be resolvable after reload/404.
      await driver.page.reload();
      await expect.poll(() => handoffReads.includes(404), { timeout: 5_000 }).toBe(true);
      await driver.page.getByRole('button', { name: 'Vérifier cette action' }).click();
      await driver.page.getByText('Remise confirmée. La commande est livrée.').waitFor();
      expect(observations.map(row => row.endpoint)).toEqual(['confirm', 'resolve']);
      expect(observations[1]?.operationId).toBe(observations[0]?.operationId);
      expect(observations[1]?.keys).toEqual(['action', 'expectedMissionRevision', 'expectedRevision', 'operationId']);
      expect(resolvedResult).toMatchObject({ outcome: 'applied', replay: true, action: 'handoff', state: { orderStatus: 'delivered' } });
      expect(resolvedResult?.appliedRevision).toBe(lostResult?.appliedRevision);
      expect(await driver.page.evaluate(() => Object.keys(sessionStorage).filter(key => key.startsWith('sm.delivery-handoff.v1.')).length)).toBe(0);
      expect(await driver.page.getByRole('button', { name: 'Confirmer la remise au client' }).count()).toBe(0);

      const rows = await fixture.models.Order.find({ clientId: order.clientId }).select('+deliveryHandoff').lean();
      expect(rows).toHaveLength(1);
      expect(rows[0]?.status).toBe('delivered');
      expect(rows[0]?.delivery?.deliveredAt?.getTime()).toBe(deliveredAtBeforeResolve);
      expect(rows[0]?.deliveryHandoff?.operations).toHaveLength(1);
      expect(rows[0]?.deliveryHandoff?.completed).toMatchObject({ method: 'pin', actorKind: 'delivery', actorId: connected.operator.id, operationId: observations[0]?.operationId });
      const audit = await fixture.models.AuditLog.find({ targetId: order.id }).lean();
      expect(audit).toHaveLength(1);
      expect(audit[0]?.meta?.operationId).toBe(observations[0]?.operationId);
      expect(audit[0]?.author).toMatchObject({ id: connected.operator.id, role: 'livreur', means: 'delivery_access' });
      expect(JSON.stringify(audit).includes(pin!)).toBe(false);
      expect(JSON.stringify(audit).includes(order.recoveryProof)).toBe(false);
      expect(await driver.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      expect(closedAccountCapabilityReads).toBe(2);
      expect(faults).toEqual([]);
    } finally { await customer.context.close(); await driver.context.close(); }
  }, 25_000);
});
