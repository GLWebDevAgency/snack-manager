import { createServer, type Server } from 'node:http';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type * as Journal from './checkout-attempt';

declare global { interface Window { privateCheckoutJournal: typeof Journal; privateCheckoutHold?: { started: boolean; release: boolean } } }
const tenant = 'recette';
const payload = { lines: [{ productId: '507f1f77bcf86cd799439011', options: [], removed: [], qty: 1 }],
  payment: { method: 'online' as const }, pickup: { slot: '2030-01-10T12:00:00.000Z', customerName: 'Test', customerPhone: '0600000000' } };
const receipt = { orderId: '507f1f77bcf86cd799439012', trackingToken: 'fixture-private-tracking', type: 'delivery' as const };
const selection = { browserRef: '00000000-0000-4000-8000-000000000001', publication: {
  expectedOperationId: '00000000-0000-4000-8000-000000000002', expectedCheckId: '00000000-0000-4000-8000-000000000003' } };
const account = () => ({ kind: 'account' as const, selection, expiresAt: Date.now() + 60_000, privacyEpoch: 0 });
let browser: Browser, context: BrowserContext, page: Page, server: Server, origin: string;

beforeAll(async () => {
  const bundle = await build({ entryPoints: [fileURLToPath(new URL('./checkout-attempt.ts', import.meta.url))],
    bundle: true, write: false, platform: 'browser', format: 'esm', target: 'es2022' });
  server = createServer((req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Type', req.url === '/journal.js' ? 'text/javascript' : 'text/html');
    res.end(req.url === '/journal.js' ? bundle.outputFiles[0]!.text
      : '<!doctype html><title>Private checkout storage fixture</title><script type="module">import * as j from "/journal.js";window.privateCheckoutJournal=j;</script>');
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('Missing fixture address');
  origin = `http://127.0.0.1:${address.port}`;
  browser = await chromium.launch({ headless: true });
}, 30_000);
beforeEach(async () => {
  context = await browser.newContext({ serviceWorkers: 'block' }); page = await context.newPage();
  await page.goto(origin); await page.waitForFunction(() => !!window.privateCheckoutJournal);
});
afterEach(async () => { await context?.close(); });
afterAll(async () => { await browser?.close(); if (server) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); });

async function acquire(provenance = account(), target = page) {
  return target.evaluate(({ tenant, payload, provenance }) => window.privateCheckoutJournal.acquireCheckoutAttempt(tenant, {
    payload: { ...payload, fulfillment: 'delivery', delivery: { address: { line1: '1 rue Test', postalCode: '27910', city: 'Test', country: 'FR' } } },
    cartFingerprint: 'a'.repeat(64), provenance,
  }), { tenant, payload, provenance });
}
const receive = (clientId: string, target = page) => target.evaluate(({ tenant, clientId, receipt }) =>
  window.privateCheckoutJournal.recordCheckoutReceipt(tenant, clientId, receipt), { tenant, clientId, receipt });
const invalidate = (target = page) => target.evaluate(tenant => window.privateCheckoutJournal.invalidateAccountCheckoutAccess(tenant), tenant);
const view = (target = page) => target.evaluate(tenant => window.privateCheckoutJournal.readCheckoutRecovery(tenant), tenant);

describe('account checkout privacy, native IndexedDB', () => {
  it('pins the immutable public selection and privacy epoch with C01 before admission', async () => {
    const provenance = account(); const result = await acquire(provenance);
    expect(result.attempt).toMatchObject({ v: 2, provenance });
    const replay = await acquire(provenance); expect(replay.acquired).toBe(false);
    expect(replay.attempt.clientId).toBe(result.attempt.clientId);
  });

  it('never retargets a legacy guest attempt to an account', async () => {
    const guest = await page.evaluate(({ tenant, payload }) => window.privateCheckoutJournal.acquireCheckoutAttempt(tenant, { payload, cartFingerprint: 'a'.repeat(64) }), { tenant, payload });
    await expect(acquire()).rejects.toThrow();
    expect((await page.evaluate(tenant => window.privateCheckoutJournal.readCheckoutAttempt(tenant), tenant))?.clientId).toBe(guest.attempt.clientId);
  });

  it('requires the same account provenance before marking uncertain', async () => {
    const first = await acquire();
    await expect(page.evaluate(({ tenant, id }) => window.privateCheckoutJournal.markCheckoutAttemptUncertain(tenant, id), { tenant, id: first.attempt.clientId })).rejects.toThrow();
  });

  it('filters account shortcuts by default, allows only the exact live access', async () => {
    const owner = account(); const access = { selection: owner.selection, expiresAt: owner.expiresAt, privacyEpoch: owner.privacyEpoch };
    const first = await acquire(owner); await receive(first.attempt.clientId);
    expect(await page.evaluate(tenant => window.privateCheckoutJournal.readDeviceCheckoutReceipts(tenant), tenant)).toEqual([]);
    const rows = await page.evaluate(({ tenant, access }) => window.privateCheckoutJournal.readDeviceCheckoutReceipts(tenant, access), { tenant, access });
    expect(rows).toHaveLength(1);
    const other = { ...access, selection: { ...selection, publication: { ...selection.publication, expectedCheckId: '00000000-0000-4000-8000-000000000004' } } };
    expect(await page.evaluate(({ tenant, other }) => window.privateCheckoutJournal.readDeviceCheckoutReceipts(tenant, other), { tenant, other })).toEqual([]);
  });

  it('keeps uncertain C01 internally but exposes only its public reconciliation selector', async () => {
    const provenance = account(); const first = await acquire(provenance);
    await page.evaluate(({ tenant, id, provenance }) => window.privateCheckoutJournal.markCheckoutAttemptUncertain(tenant, id, provenance), { tenant, id: first.attempt.clientId, provenance });
    await invalidate();
    expect(await view()).toEqual({ active: null, last: null, hidden: { clientId: first.attempt.clientId, pending: true } });
    const internal = await page.evaluate(({ tenant, id }) => window.privateCheckoutJournal.readCheckoutAttemptForReconciliation(tenant, id), { tenant, id: first.attempt.clientId });
    expect(internal).toMatchObject({ state: 'uncertain', provenance });
    expect(internal && 'payload' in internal).toBe(true);
    expect(await page.evaluate(tenant => window.privateCheckoutJournal.readCheckoutAttemptForReconciliation(tenant, '00000000-0000-4000-8000-000000000099'), tenant)).toBeNull();
  });

  it('settles a late response without recreating any account capability, even after reload', async () => {
    const first = await acquire(); const second = await context.newPage(); await second.goto(origin);
    await second.waitForFunction(() => !!window.privateCheckoutJournal);
    await invalidate(second);
    expect(await receive(first.attempt.clientId)).toMatchObject({ state: 'private-settled', outcome: 'received' });
    await page.reload(); await page.waitForFunction(() => !!window.privateCheckoutJournal);
    expect(await view()).toEqual({ active: null, last: null, hidden: { clientId: first.attempt.clientId, pending: false } });
    const raw = await page.evaluate(({ tenant, id }) => window.privateCheckoutJournal.readCheckoutAttemptForReconciliation(tenant, id), { tenant, id: first.attempt.clientId });
    expect(raw && !('receipt' in raw) && !('payload' in raw) && !('recoveryProof' in raw)).toBe(true);
    expect(await page.evaluate(({ tenant, id }) => window.privateCheckoutJournal.readDeliveryCheckoutReceipt(tenant, id), { tenant, id: receipt.orderId })).toBeNull();
    await page.evaluate(({ tenant, id }) => window.privateCheckoutJournal.archiveCheckoutAttempt(tenant, id), { tenant, id: first.attempt.clientId });
    expect(await view()).toEqual({ active: null, last: null, hidden: null });
  });

  it('converts an active received account into a terminal fence and preserves guest aliases', async () => {
    const guest = await page.evaluate(({ tenant, payload }) => window.privateCheckoutJournal.acquireCheckoutAttempt(tenant, { payload, cartFingerprint: 'a'.repeat(64) }), { tenant, payload });
    await page.evaluate(({ tenant, id }) => window.privateCheckoutJournal.recordCheckoutReceipt(tenant, id, { orderId: '507f1f77bcf86cd799439013', trackingToken: 'guest-fixture' }), { tenant, id: guest.attempt.clientId });
    await page.evaluate(({ tenant, id }) => window.privateCheckoutJournal.archiveCheckoutAttempt(tenant, id), { tenant, id: guest.attempt.clientId });
    const current = await acquire(); await receive(current.attempt.clientId); await invalidate();
    expect((await view()).hidden).toEqual({ clientId: current.attempt.clientId, pending: false });
    const rows = await page.evaluate(tenant => window.privateCheckoutJournal.readDeviceCheckoutReceipts(tenant), tenant);
    expect(rows.map(row => row.receipt.orderId)).toEqual(['507f1f77bcf86cd799439013']);
    expect((await view()).last?.clientId).toBe(guest.attempt.clientId);
  });

  it('rejects stale epoch acquisition and stale prepared admission without touching C01', async () => {
    const provenance = account(); await invalidate(); await expect(acquire(provenance)).rejects.toThrow();
    const fresh = { ...provenance, privacyEpoch: 1 }; const pending = await acquire(fresh); await invalidate();
    await expect(page.evaluate(({ tenant, id, fresh }) => window.privateCheckoutJournal.markCheckoutAttemptUncertain(tenant, id, fresh), { tenant, id: pending.attempt.clientId, fresh })).rejects.toThrow();
    const raw = await page.evaluate(({ tenant, id }) => window.privateCheckoutJournal.readCheckoutAttemptForReconciliation(tenant, id), { tenant, id: pending.attempt.clientId });
    expect(raw?.state).toBe('prepared');
  });

  it.each(['receipt-first', 'logout-first'] as const)('serializes %s against the other tab at the real IndexedDB write boundary', async order => {
    const pending = await acquire(); const second = await context.newPage(); await second.goto(origin);
    await second.waitForFunction(() => !!window.privateCheckoutJournal);
    const firstPage = order === 'receipt-first' ? page : second;
    await firstPage.evaluate(({ tenant, order }) => {
      window.privateCheckoutHold = { started: false, release: false };
      const put = IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put = function(value: unknown, key?: IDBValidKey) {
        const request = key === undefined ? put.call(this, value) : put.call(this, value, key);
        const row = value as { state?: string };
        if (!window.privateCheckoutHold!.started && ((order === 'receipt-first' && this.name === 'active' && row.state === 'received')
          || (order === 'logout-first' && this.name === 'privacy'))) {
          window.privateCheckoutHold!.started = true;
          const tx = this.transaction;
          const pump = () => { const get = tx.objectStore('privacy').get(tenant);
            get.onsuccess = () => { if (!window.privateCheckoutHold!.release) pump(); }; };
          pump();
        }
        return request;
      };
    }, { tenant, order });
    const first = order === 'receipt-first' ? receive(pending.attempt.clientId) : invalidate(second);
    await firstPage.waitForFunction(() => window.privateCheckoutHold?.started === true);
    const next = order === 'receipt-first' ? invalidate(second) : receive(pending.attempt.clientId);
    await firstPage.evaluate(() => { window.privateCheckoutHold!.release = true; });
    await Promise.all([first, next]);
    expect(await view()).toEqual({ active: null, last: null, hidden: { clientId: pending.attempt.clientId, pending: false } });
    const flags = await page.evaluate(async ({ tenant, id }) => {
      const j = window.privateCheckoutJournal;
      const raw = await j.readCheckoutAttemptForReconciliation(tenant, id);
      return { terminal: raw?.state === 'private-settled', noSecrets: raw !== null && !('receipt' in raw) && !('payload' in raw) && !('recoveryProof' in raw),
        device: (await j.readDeviceCheckoutReceipts(tenant)).length, delivery: await j.readDeliveryCheckoutReceipt(tenant, '507f1f77bcf86cd799439012') === null };
    }, { tenant, id: pending.attempt.clientId });
    expect(flags).toEqual({ terminal: true, noSecrets: true, device: 0, delivery: true });
  });

  it('rolls back the privacy epoch and every alias if invalidation aborts, without a success notification', async () => {
    const owner = account(); const pending = await acquire(owner); await receive(pending.attempt.clientId);
    const result = await page.evaluate(async ({ tenant, id, owner }) => {
      const j = window.privateCheckoutJournal; const access = { selection: owner.selection, expiresAt: owner.expiresAt, privacyEpoch: owner.privacyEpoch };
      const before = await j.readCheckoutAttemptForReconciliation(tenant, id);
      let notifications = 0; const stop = j.subscribeCheckoutAttempts(() => { notifications++; });
      const put = IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put = function(value: unknown, key?: IDBValidKey) {
        const request = key === undefined ? put.call(this, value) : put.call(this, value, key);
        if (this.name === 'privacy') this.transaction.abort();
        return request;
      };
      let refused = false;
      try { await j.invalidateAccountCheckoutAccess(tenant); } catch { refused = true; }
      finally { IDBObjectStore.prototype.put = put; stop(); }
      return { refused, notifications, unchanged: JSON.stringify(before) === JSON.stringify(await j.readCheckoutAttemptForReconciliation(tenant, id)),
        epoch: await j.readCheckoutPrivacyEpoch(tenant), visible: (await j.readDeviceCheckoutReceipts(tenant, access)).length,
        delivery: (await j.readDeliveryCheckoutReceipt(tenant, '507f1f77bcf86cd799439012', false, access)) !== null };
    }, { tenant, id: pending.attempt.clientId, owner });
    expect(result).toEqual({ refused: true, notifications: 0, unchanged: true, epoch: 0, visible: 1, delivery: true });
  });

  it('keeps the original pending proof on receipt transaction abort, and retries only the receipt', async () => {
    const pending = await acquire();
    const result = await page.evaluate(async ({ tenant, id, receipt }) => {
      const j = window.privateCheckoutJournal; const before = await j.readCheckoutAttemptForReconciliation(tenant, id);
      const add = IDBObjectStore.prototype.add;
      IDBObjectStore.prototype.add = function(value: unknown, key?: IDBValidKey) {
        const request = key === undefined ? add.call(this, value) : add.call(this, value, key);
        if (this.name === 'device-receipts') this.transaction.abort();
        return request;
      };
      let refused = false;
      try { await j.recordCheckoutReceipt(tenant, id, receipt); } catch { refused = true; }
      finally { IDBObjectStore.prototype.add = add; }
      return { refused, unchanged: JSON.stringify(before) === JSON.stringify(await j.readCheckoutAttemptForReconciliation(tenant, id)) };
    }, { tenant, id: pending.attempt.clientId, receipt });
    expect(result).toEqual({ refused: true, unchanged: true });
    await invalidate(); expect((await receive(pending.attempt.clientId)).state).toBe('private-settled');
  });

  it('does not extend access on read and cannot recover old shortcuts with a new publication', async () => {
    const owner = account(); const pending = await acquire(owner); await receive(pending.attempt.clientId);
    const result = await page.evaluate(async ({ tenant, owner }) => {
      const j = window.privateCheckoutJournal; const access = { selection: owner.selection, expiresAt: owner.expiresAt, privacyEpoch: owner.privacyEpoch };
      const realNow = Date.now; Date.now = () => owner.expiresAt;
      try { return { rows: (await j.readDeviceCheckoutReceipts(tenant, access)).length,
        active: (await j.readCheckoutRecovery(tenant, access)).active,
        delivery: await j.readDeliveryCheckoutReceipt(tenant, '507f1f77bcf86cd799439012', true, access) }; }
      finally { Date.now = realNow; }
    }, { tenant, owner });
    expect(result).toEqual({ rows: 0, active: null, delivery: null });
    await invalidate();
    const selected = { selection: { ...selection, publication: { ...selection.publication, expectedCheckId: '00000000-0000-4000-8000-000000000004' } },
      expiresAt: owner.expiresAt, privacyEpoch: 1 };
    expect(await page.evaluate(({ tenant, selected }) => window.privateCheckoutJournal.readDeviceCheckoutReceipts(tenant, selected), { tenant, selected })).toEqual([]);
  });

  it('shows a rejected hidden account only as a settled selector, never its private payload', async () => {
    const pending = await acquire(); await invalidate();
    await page.evaluate(({ tenant, id }) => window.privateCheckoutJournal.recordCheckoutRejection(tenant, id, { reason: 'abandoned', message: 'Demande abandonnée.' }), { tenant, id: pending.attempt.clientId });
    expect(await view()).toEqual({ active: null, last: null, hidden: { clientId: pending.attempt.clientId, pending: false } });
    await page.evaluate(({ tenant, id }) => window.privateCheckoutJournal.releaseRejectedCheckoutAttempt(tenant, id), { tenant, id: pending.attempt.clientId });
    expect((await view()).hidden).toBeNull();
  });

  it('allows exact terminal receipt replay, rejects a different receipt, and never recreates aliases', async () => {
    const pending = await acquire(); await invalidate(); const settled = await receive(pending.attempt.clientId);
    expect(await receive(pending.attempt.clientId)).toEqual(settled);
    const refused = await page.evaluate(async ({ tenant, id, receipt }) => {
      try { await window.privateCheckoutJournal.recordCheckoutReceipt(tenant, id, { ...receipt, trackingToken: 'different-fixture' }); return false; }
      catch { return true; }
    }, { tenant, id: pending.attempt.clientId, receipt });
    expect(refused).toBe(true); expect((await view()).hidden?.pending).toBe(false);
  });

  it('never notifies from a delivery lookup but notifies the durable privacy fence once', async () => {
    const owner = account(); const pending = await acquire(owner); await receive(pending.attempt.clientId);
    const result = await page.evaluate(async ({ tenant, owner, id }) => {
      const j = window.privateCheckoutJournal; let count = 0; const stop = j.subscribeCheckoutAttempts(() => { count++; });
      const access = { selection: owner.selection, expiresAt: owner.expiresAt, privacyEpoch: owner.privacyEpoch };
      await j.readDeliveryCheckoutReceipt(tenant, id, false, access); const afterRead = count;
      await j.invalidateAccountCheckoutAccess(tenant); stop(); return { afterRead, afterFence: count };
    }, { tenant, owner, id: receipt.orderId });
    expect(result).toEqual({ afterRead: 0, afterFence: 1 });
  });

  it('upgrades v3 without rewriting legacy guest rows or rebuilding a forgotten shortcut', async () => {
    const result = await page.evaluate(async ({ tenant, payload, receipt }) => {
      const now = Date.now(); const common = { v: 1, tenant, origin: location.origin,
        clientId: '00000000-0000-4000-8000-000000000001', cartFingerprint: 'a'.repeat(64), createdAt: now, updatedAt: now };
      const active = { ...common, state: 'uncertain', payload, recoveryProof: 'b'.repeat(64) };
      const last = { ...common, clientId: '00000000-0000-4000-8000-000000000002', state: 'received', receipt };
      await new Promise<void>((resolve, reject) => {
        const open = indexedDB.open('sm.checkout-attempts', 3);
        open.onupgradeneeded = () => {
          open.result.createObjectStore('active', { keyPath: 'tenant' }).add(active);
          open.result.createObjectStore('last-receipt', { keyPath: 'tenant' }).add(last);
          open.result.createObjectStore('device-receipts', { keyPath: ['tenant', 'receipt.orderId'] });
          open.result.createObjectStore('delivery-receipts', { keyPath: ['tenant', 'receipt.orderId'] });
        };
        open.onerror = () => reject(open.error); open.onsuccess = () => { open.result.close(); resolve(); };
      });
      const j = window.privateCheckoutJournal;
      const epoch = await j.readCheckoutPrivacyEpoch(tenant);
      const current = await j.readCheckoutRecovery(tenant);
      const rows = await j.readDeviceCheckoutReceipts(tenant);
      const version = await new Promise<number>((resolve, reject) => { const open = indexedDB.open('sm.checkout-attempts');
        open.onerror = () => reject(open.error); open.onsuccess = () => { const version = open.result.version; open.result.close(); resolve(version); }; });
      return { epoch, version, unchanged: JSON.stringify(current.active) === JSON.stringify(active)
        && JSON.stringify(current.last) === JSON.stringify(last), rows: rows.length, hidden: current.hidden };
    }, { tenant, payload, receipt });
    expect(result).toEqual({ epoch: 0, version: 4, unchanged: true, rows: 0, hidden: null });
  });

  it('isolates a tenant privacy fence from other tenant and origin receipts', async () => {
    const owner = account(); const pending = await acquire(owner); await receive(pending.attempt.clientId);
    await page.evaluate(() => window.privateCheckoutJournal.invalidateAccountCheckoutAccess('other'));
    const access = { selection: owner.selection, expiresAt: owner.expiresAt, privacyEpoch: owner.privacyEpoch };
    expect(await page.evaluate(({ tenant, access }) => window.privateCheckoutJournal.readDeviceCheckoutReceipts(tenant, access), { tenant, access })).toHaveLength(1);
    expect(await page.evaluate(access => window.privateCheckoutJournal.readDeviceCheckoutReceipts('other', access), access)).toEqual([]);
    const other = await context.newPage(); await other.goto(origin.replace('127.0.0.1', 'localhost'));
    await other.waitForFunction(() => !!window.privateCheckoutJournal);
    expect(await other.evaluate(({ tenant, access }) => window.privateCheckoutJournal.readDeviceCheckoutReceipts(tenant, access), { tenant, access })).toEqual([]);
  });

  it.each(['missing', 'corrupt', 'overflow'] as const)('fails closed on %s privacy metadata', async mode => {
    const pending = await acquire();
    await page.evaluate(({ tenant, mode }) => new Promise<void>((resolve, reject) => {
      const open = indexedDB.open('sm.checkout-attempts'); open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const db = open.result; const tx = db.transaction('privacy', 'readwrite');
        if (mode === 'missing') tx.objectStore('privacy').delete(tenant);
        else tx.objectStore('privacy').put({ tenant, origin: location.origin, epoch: mode === 'overflow' ? Number.MAX_SAFE_INTEGER : -1 });
        tx.oncomplete = () => { db.close(); resolve(); }; tx.onabort = () => { db.close(); reject(tx.error); };
      };
    }), { tenant, mode });
    const refused = await page.evaluate(async tenant => {
      try { await window.privateCheckoutJournal.invalidateAccountCheckoutAccess(tenant); return false; } catch { return true; }
    }, tenant);
    expect(refused).toBe(true);
    if (mode !== 'corrupt') {
      const current = await page.evaluate(({ tenant, id }) => window.privateCheckoutJournal.readCheckoutAttemptForReconciliation(tenant, id), { tenant, id: pending.attempt.clientId });
      expect(current?.state).toBe('prepared');
    }
  });
});
