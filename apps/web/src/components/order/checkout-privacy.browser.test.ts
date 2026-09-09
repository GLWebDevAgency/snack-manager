import { createServer, type Server, type ServerResponse } from 'node:http';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { seedCustomerBrowserFixture } from '../customer-account/browser-journal.fixture';
import type * as Journal from './checkout-attempt';

declare global { interface Window { checkoutPrivacyFixture: {
  journal: typeof Journal; access(): Journal.CheckoutAccountAccess | null; refresh(): Promise<void>;
} } }
const slug = 'recette', guestId = '1'.repeat(24), accountId = '2'.repeat(24);
let server: Server, browser: Browser, context: BrowserContext, page: Page, origin: string;
let session: { expiresAt: number; profile: { name: string; phoneE164: string; phoneVerifiedAt: number; revision: number } } | null;
let faults: string[], methods: string[], holdDelete: boolean, holdProof: boolean, holdSession: boolean;
let heldDelete: ServerResponse | null, heldProof: { response: ServerResponse; value: unknown } | null;
let heldSession: { response: ServerResponse; value: unknown } | null;

// Browser plugin absent. Real React hooks, journal IDB, Web Locks and channel
// invalidation run in isolated Chromium. HTTP authority is a local fixture,
// not a claim about BFF/PG/provider integration. No remote order or SMS.
beforeAll(async () => {
  const root = fileURLToPath(new URL('.', import.meta.url));
  const bundle = await build({ stdin: { resolveDir: root, loader: 'tsx', contents: `
    import React,{useState} from 'react';import {createRoot} from 'react-dom/client';
    import {useCheckoutRecovery} from './useCheckoutRecovery';import {useCustomerAccount} from '../customer-account/useCustomerAccount';
    import {DeviceOrdersSheet} from './DeviceOrdersSheet';import {CustomerDeliveryProof} from './CustomerDeliveryProof';import * as journal from './checkout-attempt';
    function App(){const [open,setOpen]=useState(false);const account=useCustomerAccount('recette',true);const recovery=useCheckoutRecovery('recette',false);
      window.checkoutPrivacyFixture={journal,access:account.currentCheckoutAccess,refresh:recovery.refresh};
      return <main><h1>Confidentialité locale</h1><output data-testid="account">{JSON.stringify(account.state)}</output>
      <output data-testid="recovery">{JSON.stringify({active:recovery.active&&{state:recovery.active.state,hasPayload:'payload' in recovery.active,trackingToken:recovery.active.receipt?.trackingToken},last:recovery.last&&{trackingToken:recovery.last.receipt.trackingToken},hidden:recovery.hidden,error:recovery.error})}</output>
      <button onClick={()=>account.logout()}>Déconnecter</button><button onClick={()=>account.refresh()}>Actualiser le compte</button><button onClick={()=>account.saveName('Nom modifié')}>Modifier le nom</button>
      <button onClick={()=>setOpen(true)}>Raccourcis invités</button><DeviceOrdersSheet open={open} slug="recette" tenantName="Restaurant de recette" onClose={()=>setOpen(false)}/>
      {location.pathname==='/proof'&&<CustomerDeliveryProof orderId="${accountId}" tenant="recette" ready finished={false}/>}</main>}
    createRoot(document.getElementById('root')).render(<React.StrictMode><App/></React.StrictMode>);` },
    bundle: true, write: false, outdir: '/virtual-checkout-privacy', platform: 'browser', format: 'esm', target: 'es2022', jsx: 'automatic',
    alias: { react: fileURLToPath(new URL('../../../node_modules/react', import.meta.url)), 'react-dom': fileURLToPath(new URL('../../../node_modules/react-dom', import.meta.url)) },
    define: { 'process.env': '{}', 'process.env.NODE_ENV': '"production"', 'process.env.NEXT_PUBLIC_API_URL': '"/api"' } });
  server = createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'private, no-store');
    const path = new URL(req.url ?? '/', origin).pathname;
    if (path === '/bundle.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(bundle.outputFiles.find(file => file.path.endsWith('.js'))!.text); return; }
    if (['/', '/proof', '/empty'].includes(path)) {
      res.setHeader('Content-Type', 'text/html');
      res.end(`<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Confidentialité locale</title></head><body><div id="root"></div>${path === '/empty' ? '' : '<script type="module" src="/bundle.js"></script>'}</body></html>`); return;
    }
    const json = (value: unknown, status = 200) => {
      const body = JSON.stringify(value); res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }).end(body);
    };
    if (path === '/favicon.ico') { json({}); return; }
    methods.push(`${req.method} ${path}`);
    if (path === '/r/recette/compte/capacites') { json({ available: false }); return; }
    if (path === '/r/recette/compte/session') {
      if (req.method === 'DELETE') {
        if (holdDelete) { heldDelete = res; return; }
        session = null; res.writeHead(204).end(); return;
      }
      if (holdSession) { heldSession = { response: res, value: structuredClone(session) }; return; }
      json(session ?? {}, session ? 200 : 401); return;
    }
    if (path === '/r/recette/compte/profil' && req.method === 'PATCH' && session) {
      session = { ...session, profile: { ...session.profile, name: 'Nom modifié', revision: session.profile.revision + 1 } }; json(session); return;
    }
    if (path === `/api/public/orders/${guestId}`) { json({ _id: guestId, number: 11, status: 'preparing' }); return; }
    if (path === `/api/public/orders/${accountId}/delivery-proof` && req.method === 'POST') {
      const value = { missionId: accountId, proofId: '00000000-0000-4000-8000-000000000001', pin: '654321',
        qr: `sm-handoff:v1:${accountId}:00000000-0000-4000-8000-000000000001:${'b'.repeat(43)}`, expiresAt: new Date(Date.now() + 60_000).toISOString() };
      if (holdProof) { heldProof = { response: res, value }; return; } json(value); return;
    }
    faults.push(`Unexpected ${req.method} ${path}`); json({}, 404);
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); if (!address || typeof address === 'string') throw Error('No local address');
  origin = `http://127.0.0.1:${address.port}`; browser = await chromium.launch({ headless: true });
}, 30_000);
beforeEach(async () => {
  session = { expiresAt: Date.now() + 60_000, profile: { name: 'Compte de recette', phoneE164: '+33600000001', phoneVerifiedAt: Date.now() - 1_000, revision: 0 } };
  faults = []; methods = []; holdDelete = false; holdProof = false; holdSession = false; heldDelete = null; heldProof = null; heldSession = null;
  context = await browser.newContext({ serviceWorkers: 'block', reducedMotion: 'reduce' });
  context.on('page', item => item.on('pageerror', error => faults.push(error.message)));
  page = await context.newPage(); page.setDefaultTimeout(5_000); await page.goto(origin + '/empty');
  await seedCustomerBrowserFixture(page, slug); await page.goto(origin);
  await expect.poll(() => page.evaluate(() => Boolean(window.checkoutPrivacyFixture?.access()))).toBe(true);
});
afterEach(async () => { heldDelete?.destroy(); heldProof?.response.destroy(); heldSession?.response.destroy(); await context.close(); expect(faults).toEqual([]); });
afterAll(async () => { await browser?.close(); if (server) await new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()); }); });
const recovery = () => page.getByTestId('recovery').textContent();
const account = (target = page) => target.getByTestId('account').textContent();
async function seed(kind: 'guest' | 'account', pending = false) {
  return page.evaluate(async ({ kind, pending, guestId, accountId }) => {
    const { journal, access } = window.checkoutPrivacyFixture, selected = access();
    if (!selected) throw Error('Fixture requires an authenticated access');
    const payload: Journal.CheckoutBusinessPayload = { lines: [{ productId: 'd'.repeat(24), options: [], removed: [], qty: 1 }], payment: { method: 'online' },
      pickup: { slot: '2030-01-10T12:00:00.000Z', customerName: 'Client de recette', customerPhone: '0600000000' },
      fulfillment: 'delivery', delivery: { address: { line1: '1 rue de Recette', city: 'Recette', postalCode: '27910', country: 'FR' } } };
    const result = await journal.acquireCheckoutAttempt('recette', { payload, cartFingerprint: 'a'.repeat(64),
      provenance: kind === 'guest' ? { kind: 'guest' } : { kind: 'account', ...selected } });
    if (!pending) await journal.recordCheckoutReceipt('recette', result.attempt.clientId, {
      orderId: kind === 'guest' ? guestId : accountId, trackingToken: kind === 'guest' ? 'guest-tracking' : 'account-tracking', number: kind === 'guest' ? 11 : 22, type: 'delivery',
    });
    if (kind === 'guest' && !pending) await journal.archiveCheckoutAttempt('recette', result.attempt.clientId);
    await window.checkoutPrivacyFixture.refresh(); return result.attempt.clientId;
  }, { kind, pending, guestId, accountId });
}
const epoch = () => page.evaluate(() => window.checkoutPrivacyFixture.journal.readCheckoutPrivacyEpoch('recette'));
async function switchPublication(target: Page) {
  await target.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => { const open = indexedDB.open('sm-customer-preparation-v1', 1); open.onsuccess = () => resolve(open.result); open.onerror = () => reject(Error('Fixture IDB')); });
    try { await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('preparations', 'readwrite', { durability: 'strict' }), store = tx.objectStore('preparations'), get = store.get('recette');
      get.onsuccess = () => store.put({ ...get.result, verification: { ...get.result.verification, operationId: crypto.randomUUID(), checkId: crypto.randomUUID() } }, 'recette');
      tx.oncomplete = () => resolve(); tx.onabort = () => reject(Error('Fixture write'));
    }); } finally { db.close(); }
    const key = 'sm:customer:invalidate:recette', channel = new BroadcastChannel(key);
    channel.postMessage(crypto.randomUUID()); channel.close(); window.dispatchEvent(new Event(key));
  });
}

describe('checkout privé — projections UI et barrières natives', () => {
  it('conserve le fragment explicitement copié si le reçu durable reste lié au compte, y compris après logout', async () => {
    await seed('account'); await page.goto(origin + '/proof');
    await expect.poll(() => page.evaluate(() => Boolean(window.checkoutPrivacyFixture.access()))).toBe(true);
    await page.evaluate(async accountId => {
      const { journal, access } = window.checkoutPrivacyFixture;
      const receipt = await journal.readDeliveryCheckoutReceipt('recette', accountId, false, access());
      if (!receipt?.receipt.recoveryProof) throw Error('Fixture requires a private delivery receipt');
      // A deliberate copy is modeled only inside the isolated page. Never
      // return the capability to test logs or send it in a request URL.
      history.replaceState(history.state, '', location.pathname + `#remise=v1.${receipt.clientId}.${receipt.receipt.recoveryProof}`);
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    }, accountId);
    await page.getByRole('button', { name: 'Afficher mon code de remise', exact: true }).click();
    await page.getByAltText('QR privé à présenter au livreur').waitFor();
    expect(await page.evaluate(() => location.hash.startsWith('#remise='))).toBe(true);
    expect(await page.evaluate(accountId => window.checkoutPrivacyFixture.journal.readDeliveryCheckoutReceipt('recette', accountId), accountId)).toBeNull();
    const calls = methods.filter(method => method.endsWith('/delivery-proof')).length;
    await page.getByRole('button', { name: 'Déconnecter', exact: true }).click();
    await expect.poll(() => account()).toContain('"status":"guest"');
    await page.reload();
    await page.getByRole('button', { name: 'Afficher mon code de remise', exact: true }).waitFor();
    expect(await page.getByAltText('QR privé à présenter au livreur').count()).toBe(0);
    expect(methods.filter(method => method.endsWith('/delivery-proof'))).toHaveLength(calls);
    expect(await page.evaluate(() => location.hash.startsWith('#remise='))).toBe(true);
    await page.getByRole('button', { name: 'Afficher mon code de remise', exact: true }).click();
    await page.getByAltText('QR privé à présenter au livreur').waitFor();
    // The explicit link may now be imported independently after the account
    // alias was purged, and only that durable access permits removing its hash.
    expect(await page.evaluate(() => location.hash)).toBe('');
  });
  it('retrouve un reçu privé arrivé après l’ouverture du suivi, sans vérification de PIN automatique', async () => {
    await page.goto(origin + '/proof');
    await expect.poll(() => page.evaluate(() => Boolean(window.checkoutPrivacyFixture.access()))).toBe(true);
    await page.getByText('Ce navigateur ne possède pas l’accès privé', { exact: false }).waitFor();
    await seed('account');
    await expect.poll(() => page.getByRole('button', { name: 'Afficher mon code de remise', exact: true }).count()).toBe(1);
    expect(methods.filter(method => method.endsWith('/delivery-proof'))).toEqual([]);
  });
  it('ne recapture pas une nouvelle barrière après une réponse de session retardée', async () => {
    await seed('account'); holdSession = true;
    await page.getByRole('button', { name: 'Actualiser le compte', exact: true }).click(); await expect.poll(() => Boolean(heldSession)).toBe(true);
    await page.evaluate(() => window.checkoutPrivacyFixture.journal.invalidateAccountCheckoutAccess('recette'));
    holdSession = false; heldSession!.response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(heldSession!.value)); heldSession = null;
    await expect.poll(() => account()).toContain('"status":"authenticated"');
    expect(await page.evaluate(() => window.checkoutPrivacyFixture.access())).toBeNull();
    expect(await recovery()).not.toContain('account-tracking');
  });
  it('focus, relecture et modification de nom ne réinitialisent pas les alias du compte', async () => {
    await seed('account'); await expect.poll(recovery).toContain('account-tracking'); const before = await epoch();
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect.poll(() => account()).toContain('"status":"authenticated"');
    await page.getByRole('button', { name: 'Modifier le nom', exact: true }).click();
    await expect.poll(() => account()).toContain('Nom modifié');
    await expect.poll(recovery).toContain('account-tracking'); expect(await epoch()).toBe(before);
    expect(methods.filter(method => method.startsWith('DELETE'))).toEqual([]);
  });
  it('sépare les raccourcis invités du reçu compte même pendant une session active', async () => {
    await seed('guest'); await seed('account'); await expect.poll(recovery).toContain('account-tracking');
    await page.getByRole('button', { name: 'Raccourcis invités', exact: true }).click();
    await page.getByRole('heading', { name: 'Commande n° 11', exact: true }).waitFor();
    expect(await page.getByRole('heading', { name: 'Commande n° 22', exact: true }).count()).toBe(0);
    expect(await page.getByRole('link').evaluateAll(links => links.map(link => link.getAttribute('href')))).toEqual([`/t/${guestId}?t=guest-tracking`]);
  });
  it('persiste la barrière avant DELETE et masque le compte dans les deux onglets, sans supprimer l’invité', async () => {
    await seed('guest'); await seed('account'); const previous = await epoch();
    const second = await context.newPage(); await second.goto(origin); await expect.poll(() => account(second)).toContain('"status":"authenticated"');
    holdDelete = true; await second.getByRole('button', { name: 'Déconnecter', exact: true }).click();
    await expect.poll(() => Boolean(heldDelete)).toBe(true); expect(await epoch()).toBe(previous + 1);
    await expect.poll(recovery).not.toContain('account-tracking');
    expect(await page.evaluate(() => window.checkoutPrivacyFixture.journal.readDeviceCheckoutReceipts('recette'))).toHaveLength(1);
    session = null; heldDelete!.writeHead(204).end(); heldDelete = null;
    await expect.poll(() => account()).toContain('"status":"guest"');
    await page.reload(); await expect.poll(recovery).not.toContain('account-tracking');
    expect(await page.evaluate(() => window.checkoutPrivacyFixture.journal.readDeviceCheckoutReceipts('recette'))).toHaveLength(1);
  });
  it('conserve seulement les métadonnées de réconciliation et ne réexpose pas un reçu arrivé après logout', async () => {
    const clientId = await seed('account', true);
    await page.getByRole('button', { name: 'Déconnecter', exact: true }).click(); await expect.poll(() => account()).toContain('"status":"guest"');
    await expect.poll(recovery).toContain(`"hidden":{"clientId":"${clientId}","pending":true}`);
    expect(JSON.parse((await recovery())!).active).toBeNull();
    const terminal = await page.evaluate(async ({ clientId, accountId }) => {
      const value = await window.checkoutPrivacyFixture.journal.recordCheckoutReceipt('recette', clientId, { orderId: accountId, trackingToken: 'late-account-secret', type: 'delivery' });
      await window.checkoutPrivacyFixture.refresh(); return { state: value.state, keys: Object.keys(value) };
    }, { clientId, accountId });
    expect(terminal.state).toBe('private-settled'); expect(terminal.keys).not.toContain('receipt');
    await expect.poll(recovery).toContain('"pending":false'); expect(await recovery()).not.toContain('late-account-secret');
  });
  it.each(['offline', 'hidden', 'expiry'] as const)('%s efface seulement la projection compte, sans incrémenter la barrière', async mode => {
    await seed('guest'); await seed('account'); await expect.poll(recovery).toContain('account-tracking'); const before = await epoch();
    if (mode === 'expiry') {
      // Install the clock before re-arming the real session expiry timer.
      await page.clock.install(); await page.getByRole('button', { name: 'Actualiser le compte', exact: true }).click();
      await expect.poll(() => page.evaluate(() => Boolean(window.checkoutPrivacyFixture.access()))).toBe(true);
      await page.clock.runFor(61_000);
    }
    else await page.evaluate(mode => {
      if (mode === 'offline') { Object.defineProperty(navigator, 'onLine', { configurable: true, value: false }); window.dispatchEvent(new Event('offline')); }
      else { Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' }); document.dispatchEvent(new Event('visibilitychange')); }
    }, mode);
    await expect.poll(recovery).not.toContain('account-tracking'); expect(await epoch()).toBe(before);
    expect(await page.evaluate(() => window.checkoutPrivacyFixture.journal.readDeviceCheckoutReceipts('recette'))).toHaveLength(1);
  });
  it('n’adopte pas un reçu A sous la publication B dont le profil est strictement identique', async () => {
    await seed('account'); await expect.poll(recovery).toContain('account-tracking'); const before = await account(); const oldEpoch = await epoch();
    const second = await context.newPage(); await second.goto(origin + '/empty'); await switchPublication(second);
    await expect.poll(recovery).not.toContain('account-tracking'); await expect.poll(() => account()).toContain('"status":"authenticated"');
    expect(JSON.parse((await account())!).view).toEqual(JSON.parse(before!).view); expect(await epoch()).toBe(oldEpoch);
  });
  it('efface le PIN affiché et refuse une réponse de preuve A retardée après sélection de B', async () => {
    await seed('account'); await page.goto(origin + '/proof'); await page.getByRole('button', { name: 'Afficher mon code de remise', exact: true }).click();
    await page.getByAltText('QR privé à présenter au livreur').waitFor();
    holdProof = true; await page.getByRole('button', { name: 'Actualiser mon code', exact: true }).click(); await expect.poll(() => Boolean(heldProof)).toBe(true);
    const second = await context.newPage(); await second.goto(origin + '/empty'); await switchPublication(second);
    await expect.poll(() => page.getByAltText('QR privé à présenter au livreur').count()).toBe(0);
    heldProof!.response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(heldProof!.value)); heldProof = null;
    await expect.poll(() => account()).toContain('"status":"authenticated"');
    expect(await page.getByAltText('QR privé à présenter au livreur').count()).toBe(0);
    expect(await page.getByRole('button', { name: 'Afficher mon code de remise', exact: true }).count()).toBe(0);
  });
});
