import { createServer, type Server, type ServerResponse } from 'node:http';
import { mkdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import postcss from 'postcss';
import tailwind from '@tailwindcss/postcss';
import { beforeAll, beforeEach, afterEach, afterAll, describe, expect, it, vi } from 'vitest';
import type { OrderTicket } from '@sm/contracts';
import type { TrackingState } from './api';
import type * as Journal from './checkout-attempt';

declare global { interface Window { trackingFixture: { journal: typeof Journal } } }
const ID = 'd'.repeat(24), TOKEN = 'tracking-fixture';
const CLIENT = '00000000-0000-4000-8000-000000000002', PROOF = 'a'.repeat(64), PROOF_ID = '00000000-0000-4000-8000-000000000001';
const NOW = '2030-09-10T12:00:00.000Z', SLOT = '2030-09-10T12:30:00.000Z', EXPIRES = '2030-09-10T15:00:00.000Z';
const base: TrackingState = { _id: ID, number: 12, status: 'new', statusHistory: [{ status: 'new', at: NOW }], pickupSlot: SLOT, fulfillment: 'pickup',
  payment: { method: 'counter', status: 'pending', refundedCents: 0, pendingRefundCents: 0 } };
const baseTicket: OrderTicket = { orderId: ID, pickupNumber: 12, header: { tenantName: 'Restaurant de recette', slug: 'recette', address: '24 avenue du Général de Gaulle, 75001 Paris', phones: ['01 23 45 67 89'] },
  createdAt: NOW, printedAt: NOW, channel: 'online', channelLabel: 'En ligne', type: 'pickup', typeLabel: 'Retrait', status: 'new', statusLabel: 'Reçue',
  pickup: { slotIso: SLOT, slotLabel: '14:30', customerName: 'Client de recette', customerPhone: null },
  lines: [{ qty: 2, name: 'Menu végétarien aux légumes grillés', variantName: 'Grande formule', options: [{ name: 'Sauce blanche', priceDelta: 0 }, { name: 'Fromage supplémentaire', priceDelta: 100 }], removed: ['oignons'], note: 'Sauce séparée', unitPrice: 1000, lineTotal: 2000 }],
  totals: { subtotal: 2000, discount: null, total: 2000 }, note: 'Ne pas sonner, merci.',
  // Deliberately stale: the current payment projection must take precedence.
  payment: { method: 'online', methodLabel: 'Payé en ligne', tender: 'card', tenderLabel: 'Carte bancaire', status: 'paid', statusLabel: 'Réglé', paid: true, cashReceived: null, changeGiven: null } };
let server: Server, browser: Browser, context: BrowserContext, page: Page, origin: string;
let current: TrackingState, ticket: OrderTicket | null, faults: string[], requests: { method: string; path: string; token: string | null; body?: unknown }[];
let trackingFailure: boolean, holdCounter: boolean, holdProof: boolean, held: { res: ServerResponse; body: unknown }[];
const evidence = process.env.SM_QA_TRACKING_DIR;

// Real Tracking, private proof, IndexedDB, CSS and polling in Chromium. Only
// HTTP/provider responses are fixtures. No order/payment/push is sent outside.
beforeAll(async () => {
  const directory = fileURLToPath(new URL('.', import.meta.url));
  const cssPath = fileURLToPath(new URL('../../app/globals.css', import.meta.url));
  const [bundle, css] = await Promise.all([
    build({ stdin: { contents: `import React from'react';import{createRoot}from'react-dom/client';import{Tracking}from'./Tracking';import{marqueDeRepli}from'@sm/contracts';import*as journal from'./checkout-attempt';
      window.trackingFixture={journal};const data=await(await fetch('/fixture/initial')).json();createRoot(document.getElementById('root')).render(<Tracking orderId='${ID}' trackingToken='${TOKEN}' ticket={data.ticket} initial={data.state} brand={marqueDeRepli(null,null)}/>);`, resolveDir: directory, sourcefile: 'tracking-fixture.tsx', loader: 'tsx' },
      bundle: true, write: false, outdir: '/virtual-tracking', format: 'esm', platform: 'browser', target: 'es2022', jsx: 'automatic',
      alias: { react: fileURLToPath(new URL('../../../node_modules/react', import.meta.url)), 'react-dom': fileURLToPath(new URL('../../../node_modules/react-dom', import.meta.url)) },
      plugins: [{ name: 'next-font-transform', setup(builder) {
        // Next normally emits these fonts at build time. This isolated renderer
        // uses fallback fonts; actual font fidelity is checked in the Next app.
        builder.onResolve({ filter: /^next\/font\/google$/ }, () => ({ path: 'fonts', namespace: 'tracking-fonts' }));
        builder.onLoad({ filter: /.*/, namespace: 'tracking-fonts' }, () => ({ contents: `const font=()=>({variable:'',className:'',style:{fontFamily:'Arial'}});export {${['Alegreya_Sans', 'Archivo', 'Archivo_Black', 'Bricolage_Grotesque', 'Cormorant_Garamond', 'Familjen_Grotesk', 'Figtree', 'Fraunces', 'Instrument_Sans', 'JetBrains_Mono', 'Lato', 'Libre_Baskerville', 'Manrope', 'Nunito', 'Nunito_Sans', 'Outfit', 'Playfair_Display', 'Source_Sans_3'].map(name => `font as ${name}`).join(',')}}` }));
      } }], define: { 'process.env': '{}', 'process.env.NODE_ENV': '"production"', 'process.env.NEXT_PUBLIC_API_URL': '"/api"' } }),
    readFile(cssPath, 'utf8').then(source => postcss([tailwind({ base: fileURLToPath(new URL('../../..', import.meta.url)) })]).process(source, { from: cssPath })),
  ]);
  const script = bundle.outputFiles.find(file => file.path.endsWith('.js'))!.text;
  const styles = css.css + (bundle.outputFiles.find(file => file.path.endsWith('.css'))?.text ?? '');
  server = createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const url = new URL(req.url ?? '/', origin), path = url.pathname;
    if (path === '/bundle.js' || path === '/style.css') { res.setHeader('Content-Type', path.endsWith('js') ? 'text/javascript' : 'text/css'); res.end(path.endsWith('js') ? script : styles); return; }
    if (path === `/t/${ID}`) { res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><link rel="stylesheet" href="/style.css"></head><body><div id="root"></div><script type="module" src="/bundle.js"></script></body></html>'); return; }
    res.setHeader('Content-Type', 'application/json');
    const json = (body: unknown, status = 200) => res.writeHead(status).end(JSON.stringify(body));
    if (path === '/fixture/initial') { json({ state: current, ticket }); return; }
    if (path === '/favicon.ico') { res.writeHead(204).end(); return; }
    const chunks: Buffer[] = []; for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) as Record<string, unknown> : undefined;
    requests.push({ method: req.method ?? '', path, token: url.searchParams.get('t'), ...(body ? { body } : {}) });
    if (req.method === 'GET' && path === `/api/public/orders/${ID}`) { if (url.searchParams.get('t') !== TOKEN) { json({}, 404); return; } json(current, trackingFailure ? 503 : 200); return; }
    if (req.method === 'GET' && path === '/api/public/tenants/recette/order-notifications/config') { json({ available: false, publicKey: null }); return; }
    if (req.method === 'GET' && path === '/r/recette/compte/capacites') { json({ available: false, registrationAvailable: false, accessAvailable: false }); return; }
    if (path === `/api/public/orders/${ID}/payment-counter` && req.method === 'POST') {
      if (url.searchParams.get('t') !== TOKEN) { json({}, 404); return; }
      const result = { _id: ID, payment: { method: 'counter', status: 'pending' } };
      if (holdCounter) { held.push({ res, body: result }); return; } json(result); return;
    }
    if (path === `/api/public/orders/${ID}/delivery-proof` && req.method === 'POST') {
      if (body?.clientId !== CLIENT || body.recoveryProof !== PROOF) { json({}, 404); return; }
      const result = { missionId: ID, proofId: PROOF_ID, pin: '654321', qr: `sm-handoff:v1:${ID}:${PROOF_ID}:${'b'.repeat(43)}`, expiresAt: EXPIRES };
      if (holdProof) { held.push({ res, body: result }); return; } json(result); return;
    }
    faults.push(`Unexpected fixture request ${req.method} ${path}`); json({}, 404);
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('Missing port'); origin = `http://127.0.0.1:${address.port}`;
  browser = await chromium.launch({ headless: true });
  if (evidence) await mkdir(evidence, { recursive: true });
}, 30_000);
beforeEach(async () => {
  current = structuredClone(base); ticket = structuredClone(baseTicket); faults = []; requests = []; trackingFailure = false; holdCounter = false; holdProof = false; held = [];
  context = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce', serviceWorkers: 'block' });
  await context.route('**/*', route => { if (new URL(route.request().url()).origin === origin) return route.continue(); faults.push('External request refused'); return route.abort(); });
  page = await context.newPage(); page.setDefaultTimeout(5_000); page.on('pageerror', error => faults.push(error.message));
  await page.clock.install({ time: new Date(NOW) });
});
afterEach(async () => { held.forEach(item => item.res.destroy()); await context?.close(); expect(faults).toEqual([]); });
afterAll(async () => { await browser?.close(); if (server) await new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()); }); });
const open = async (fragment = '') => { await page.goto(`${origin}/t/${ID}?t=${TOKEN}${fragment}`); await page.getByRole('heading', { level: 1 }).waitFor(); };
const poll = async () => { const before = requests.filter(item => item.path === `/api/public/orders/${ID}`).length; await page.clock.runFor(10_001); await vi.waitFor(() => expect(requests.filter(item => item.path === `/api/public/orders/${ID}`).length).toBeGreaterThan(before)); };
const capture = async (name: string) => { if (evidence) await page.screenshot({ path: `${evidence}/${name}.png`, fullPage: true }); };
async function noOverflow() {
  expect(await page.evaluate(() => ({ width: window.innerWidth, scroll: document.documentElement.scrollWidth, body: document.body.scrollWidth }))).toEqual(expect.objectContaining({ width: page.viewportSize()!.width, scroll: page.viewportSize()!.width, body: page.viewportSize()!.width }));
  expect(await page.evaluate(() => {
    const walker = document.createTreeWalker(document.querySelector('main')!, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const range = document.createRange(); range.selectNodeContents(walker.currentNode);
      if ([...range.getClientRects()].some(box => box.width > 0 && (box.left < -0.5 || box.right > window.innerWidth + 0.5))) return false;
    }
    return true;
  })).toBe(true);
}
function delivery(payment: 'pending' | 'paid' | 'refunded' = 'paid', dispatched = false) {
  current = { ...current, fulfillment: 'delivery', payment: { ...base.payment!, method: 'online', status: payment }, delivery: { dispatchedAt: dispatched ? NOW : null, deliveredAt: null, estimatedMinutes: 30 } };
  ticket = { ...ticket!, type: 'delivery', typeLabel: 'Livraison', totals: { subtotal: 2000, discount: null, deliveryFee: 250, total: 2250 },
    delivery: { address: { line1: '18 rue du Général de Gaulle', line2: 'Bâtiment B', postalCode: '75001', city: 'Paris', country: 'FR' }, instructions: 'Ne pas sonner', zoneId: 'centre', zoneName: 'Centre', feeCents: 250, estimatedMinutes: 30, dispatchedAt: dispatched ? NOW : null, deliveredAt: null, driverName: null } };
}

describe('suivi V2 — navigateur, paiement et preuve privée', () => {
  it.each([320, 390, 1280])('garde numéro, options, retraits, note et total lisibles en %spx', async width => {
    await page.setViewportSize({ width, height: width === 320 ? 568 : 900 }); await open();
    await page.getByRole('heading', { name: 'Commande en cours', exact: true }).waitFor();
    expect(await page.getByText('Numéro de retrait', { exact: true }).isVisible()).toBe(true);
    expect(await page.getByText('Total', { exact: true }).locator('..').textContent()).toMatch(/20,00\s*€/);
    expect(await page.locator('.sm-order-tracking-number').textContent()).toContain('12');
    expect(await page.getByText(/Sauce blanche · Fromage supplémentaire · sans oignons/).isVisible()).toBe(true);
    expect(await page.getByText('« Sauce séparée »', { exact: true }).isVisible()).toBe(true);
    expect(await page.getByText('À régler au comptoir', { exact: true }).count()).toBe(2);
    expect(await page.getByText('Payé en ligne', { exact: true }).count()).toBe(0);
    expect(await page.getByRole('link', { name: '01 23 45 67 89', exact: true }).getAttribute('href')).toBe('tel:0123456789');
    await noOverflow(); await capture(`tracking-new-${width}`);
  });
  it.each([
    ['ready', 'Votre commande est prête'], ['delivered', 'Commande remise'], ['cancelled', 'Commande annulée'],
  ] as const)('présente %s sans inventer une autre étape ou rouvrir le paiement', async (status, title) => {
    current.status = status; await open(); await page.getByRole('heading', { name: title, exact: true }).waitFor();
    expect(await page.getByRole('button', { name: 'Reprendre le paiement', exact: true }).count()).toBe(0);
    if (status !== 'ready') { expect(await page.locator('[aria-current="step"]').count()).toBe(0); await page.clock.runFor(20_001); expect(requests.filter(item => item.path === `/api/public/orders/${ID}`)).toHaveLength(0); }
    await noOverflow(); await capture(`tracking-${status}-390`);
  });
  it('refuse une promesse de préparation ou de code privé pour une livraison ready encore impayée', async () => {
    delivery('pending', true); current.status = 'ready'; await page.setViewportSize({ width: 320, height: 568 }); await open(`#remise=v1.${CLIENT}.${PROOF}`);
    await page.getByRole('heading', { name: 'En attente de confirmation du paiement', exact: true }).waitFor();
    expect(await page.locator('[aria-current="step"]').textContent()).toContain('Confirmation du paiement');
    expect(await page.getByText('La cuisine a votre commande', { exact: true }).count()).toBe(0);
    expect(await page.getByRole('button', { name: 'Payer au comptoir', exact: true }).count()).toBe(0);
    expect(await page.getByRole('button', { name: 'Afficher mon code de remise', exact: true }).count()).toBe(0);
    expect(requests.filter(item => item.method === 'POST')).toHaveLength(0); expect(await page.evaluate(() => location.hash)).toContain(PROOF);
    await noOverflow(); await capture('tracking-delivery-pending-320');
  });
  it('affiche remboursement sans fausse annulation et poursuit le poll d’un remboursement en attente', async () => {
    delivery('refunded'); current.payment!.refundedCents = 2250; await open();
    await page.getByRole('heading', { name: 'Commande remboursée', exact: true }).waitFor(); expect(await page.getByRole('heading', { name: 'Commande annulée', exact: true }).count()).toBe(0);
    expect(await page.getByRole('button', { name: 'Reprendre le paiement', exact: true }).count()).toBe(0); await noOverflow();
    current.status = 'delivered'; current.payment!.pendingRefundCents = 250; await poll(); await page.getByRole('heading', { name: 'Commande livrée', exact: true }).waitFor();
    await page.getByText(/en cours de remboursement/).waitFor(); current.payment!.pendingRefundCents = 0; await poll();
    await page.getByText(/en cours de remboursement/).waitFor({ state: 'hidden' });
    const count = requests.filter(item => item.path === `/api/public/orders/${ID}`).length; await page.clock.runFor(20_001); expect(requests.filter(item => item.path === `/api/public/orders/${ID}`)).toHaveLength(count);
  });
  it('avance par le poll réel puis arrête les lectures à la remise confirmée', async () => {
    await open(); current.status = 'ready'; await poll(); await page.getByRole('heading', { name: 'Votre commande est prête', exact: true }).waitFor();
    expect(requests.filter(item => item.path === `/api/public/orders/${ID}`).every(item => item.token === TOKEN)).toBe(true);
    current.status = 'delivered'; await poll(); await page.getByRole('heading', { name: 'Commande remise', exact: true }).waitFor();
    const count = requests.filter(item => item.path === `/api/public/orders/${ID}`).length; await page.clock.runFor(30_001); expect(requests.filter(item => item.path === `/api/public/orders/${ID}`)).toHaveLength(count);
  });
  it('garde le dernier état lors d’une panne sans présenter une progression non reçue', async () => {
    await open(); trackingFailure = true; current.status = 'ready'; await poll();
    await page.getByText('Connexion perdue — dernier état connu affiché.', { exact: true }).waitFor(); expect(await page.getByRole('heading', { name: 'Commande en cours', exact: true }).isVisible()).toBe(true);
    trackingFailure = false; await poll(); await page.getByRole('heading', { name: 'Votre commande est prête', exact: true }).waitFor();
    expect(await page.getByText('Connexion perdue — dernier état connu affiché.', { exact: true }).count()).toBe(0);
  });
  it('suspend les lectures en arrière-plan et vérifie immédiatement au retour visible', async () => {
    await open();
    await page.evaluate(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' }); document.dispatchEvent(new Event('visibilitychange')); });
    current.status = 'ready'; await page.clock.runFor(20_001); expect(requests.filter(item => item.path === `/api/public/orders/${ID}`)).toHaveLength(0);
    await page.evaluate(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' }); document.dispatchEvent(new Event('visibilitychange')); });
    await page.getByRole('heading', { name: 'Votre commande est prête', exact: true }).waitFor();
    expect(requests.filter(item => item.path === `/api/public/orders/${ID}`)).toHaveLength(1);
  });
  it.each([320, 390])('laisse le texte des étapes lisible sans collision avec le badge en %spx', async width => {
    await page.setViewportSize({ width, height: 844 }); delivery('pending', true); current.status = 'ready'; await open();
    for (const step of ['payment', 'new', 'preparing', 'ready'] as const) {
      if (step !== 'payment') { current.payment!.status = 'paid'; current.status = step; await poll(); }
      await page.waitForFunction(expected => document.querySelector('[aria-current="step"]')?.textContent?.includes(expected), step === 'payment' ? 'Confirmation du paiement' : step === 'new' ? 'Reçue' : step === 'preparing' ? 'En préparation' : 'En livraison');
      const boxes = await page.locator('[aria-current="step"]').evaluate(node => [...node.children].map(child => { const b = child.getBoundingClientRect(); return { left: b.left, right: b.right, top: b.top, bottom: b.bottom, width: b.width }; }));
      const text = boxes[1], badge = boxes[2];
      expect(badge.right).toBeLessThanOrEqual(width);
      if (width === 320) { expect(text.width).toBeGreaterThan(130); expect(badge.top).toBeGreaterThanOrEqual(text.bottom); }
      else expect(badge.left).toBeGreaterThanOrEqual(text.right);
      await noOverflow(); await capture(`tracking-badge-${step}-${width}`);
    }
  });
  it('ne déduit jamais le code privé du seul jeton de suivi public', async () => {
    delivery('paid', true); current.status = 'ready'; await open(); await page.getByText(/Ce navigateur ne possède pas l’accès privé/).waitFor();
    expect(await page.getByRole('button', { name: 'Afficher mon code de remise', exact: true }).count()).toBe(0); expect(requests.some(item => item.path.endsWith('/delivery-proof'))).toBe(false);
    await noOverflow(); await capture('tracking-delivery-public-390');
  });
  it('révèle la preuve seulement après action, conserve son accès dans IDB puis la masque à la remise', async () => {
    delivery('paid', true); current.status = 'ready'; await open(`#remise=v1.${CLIENT}.${PROOF}`);
    await page.getByRole('button', { name: 'Afficher mon code de remise', exact: true }).waitFor(); expect(requests.some(item => item.path.endsWith('/delivery-proof'))).toBe(false);
    await page.getByRole('button', { name: 'Afficher mon code de remise', exact: true }).click(); await page.getByAltText('QR privé à présenter au livreur', { exact: true }).waitFor();
    expect(requests.find(item => item.path.endsWith('/delivery-proof'))).toMatchObject({ token: null, body: { clientId: CLIENT, recoveryProof: PROOF } });
    const stored = await page.evaluate(id => window.trackingFixture.journal.readDeliveryCheckoutReceipt('recette', id), ID);
    expect(stored?.receipt.recoveryProof).toBe(PROOF); expect(JSON.stringify(stored)).not.toContain('654321'); expect(JSON.stringify(stored)).not.toContain('sm-handoff:');
    expect(await page.evaluate(() => location.hash)).toBe(''); await noOverflow(); await capture('tracking-delivery-private-390');
    current.status = 'delivered'; await poll(); await page.getByRole('heading', { name: 'Commande livrée', exact: true }).waitFor(); expect(await page.getByAltText('QR privé à présenter au livreur', { exact: true }).count()).toBe(0);
  });
  it('ignore une preuve retardée lorsque la livraison est terminée entretemps', async () => {
    delivery('paid', true); current.status = 'ready'; holdProof = true; await open(`#remise=v1.${CLIENT}.${PROOF}`); await page.getByRole('button', { name: 'Afficher mon code de remise', exact: true }).click(); await vi.waitFor(() => expect(held).toHaveLength(1));
    current.status = 'delivered'; await poll(); await page.getByRole('heading', { name: 'Commande livrée', exact: true }).waitFor();
    held[0].res.end(JSON.stringify(held[0].body)); expect(await page.getByAltText('QR privé à présenter au livreur', { exact: true }).count()).toBe(0);
    expect(await page.evaluate(id => window.trackingFixture.journal.readDeliveryCheckoutReceipt('recette', id), ID)).toBeNull();
  });
  it('ne change le paiement au comptoir qu’après confirmation explicite et ACK', async () => {
    current.payment!.method = 'online'; holdCounter = true; await open(); await page.getByRole('button', { name: 'Payer au comptoir', exact: true }).click(); expect(requests.filter(item => item.method === 'POST')).toHaveLength(0);
    await page.getByRole('button', { name: 'Confirmer le choix comptoir', exact: true }).click(); await vi.waitFor(() => expect(held).toHaveLength(1));
    expect(await page.getByText('Paiement en ligne à confirmer', { exact: true }).count()).toBe(2); expect(await page.getByRole('button', { name: 'Reprendre le paiement', exact: true }).isDisabled()).toBe(true);
    held[0].res.end(JSON.stringify(held[0].body)); await page.getByText('À régler au comptoir', { exact: true }).first().waitFor();
    expect(await page.getByText('Payé en ligne', { exact: true }).count()).toBe(0); expect(requests.filter(item => item.method === 'POST')).toEqual([{ method: 'POST', path: `/api/public/orders/${ID}/payment-counter`, token: TOKEN, body: {} }]);
  });
  it('reste utilisable sans ticket détaillé et ignore une réponse corrélée à une autre commande', async () => {
    ticket = null; await open(); current._id = 'e'.repeat(24); current.status = 'ready'; await poll();
    expect(await page.getByRole('heading', { name: 'Commande en cours', exact: true }).isVisible()).toBe(true); expect(await page.getByText('Commande en ligne', { exact: true }).isVisible()).toBe(true); await noOverflow();
  });
});
