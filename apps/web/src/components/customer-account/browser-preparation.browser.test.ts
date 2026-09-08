import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { chromium, type Browser, type BrowserContext, type Page, type Route } from 'playwright';
import { NextRequest } from 'next/server';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { POST as browserHandler } from '../../app/r/[slug]/compte/navigateur/route';
import { GET as sessionHandler } from '../../app/r/[slug]/compte/session/route';
import type { CustomerBrowserJournal } from './browser-journal';
import type { CustomerBrowserPreparationResult } from './browser-preparation';

declare global {
  interface Window {
    preparationFixture: {
      begin(): Promise<CustomerBrowserPreparationResult>;
      resume(): Promise<CustomerBrowserPreparationResult>;
      journal(): Promise<CustomerBrowserJournal | null>;
      privateRead(): Promise<unknown>;
    };
  }
}
const origin = 'https://staging.snackmanager.fr';
const refA = '10000000-0000-4000-8000-000000000001';
const refB = '20000000-0000-4000-8000-000000000002';
const browserCookie = '__Host-sm_customer_browser_classfood';
const sessionCookie = '__Host-sm_customer_session_classfood';
type Record = { browserRef: string; secret: string | null; confirmed: boolean; admissionExpiresAt: number; expiresAt: number };
let native: Browser, context: BrowserContext, page: Page, bundle: string;
let records: Map<string, Record>, calls: string[], faults: string[];
let dropIssue: 'headers' | 'body' | null;
let holdRef: string | null, heldResponse: { route: Route; response: Response } | null;

// Browser plugin not available. Real Chromium, IndexedDB strict transactions,
// Web Locks, native cookie jar and actual Next BFF handlers. The upstream CAS
// is an isolated test double; separate PostgreSQL tests prove SQL authority.
beforeAll(async () => {
  const output = await build({ stdin: { contents: `import {customerBrowserPreparation} from './browser-preparation';
    import {customerBrowserJournal} from './browser-journal';import {customerAccountRequest} from './client';
    const p=customerBrowserPreparation('classfood');
    window.preparationFixture={...p,journal:()=>customerBrowserJournal('classfood').read(),privateRead:()=>customerAccountRequest('classfood')('session')};
    document.querySelector('button').onclick=async()=>{document.querySelector('output').textContent=JSON.stringify(await p.begin())};`,
    resolveDir: fileURLToPath(new URL('.', import.meta.url)), loader: 'ts' }, bundle: true, write: false,
    format: 'esm', platform: 'browser', target: 'es2022' });
  bundle = output.outputFiles[0]!.text;
  native = await chromium.launch({ headless: true });
});
async function fulfill(route: Route, response: Response, corruptBody = false) {
  await route.fulfill({ status: response.status, headers: Object.fromEntries(response.headers),
    body: corruptBody ? '{' : await response.text() });
}
function publicView(record: Record) {
  return { browserRef: record.browserRef, admissionExpiresAt: record.admissionExpiresAt, expiresAt: record.expiresAt,
    state: record.expiresAt <= Date.now() || (!record.confirmed && record.admissionExpiresAt <= Date.now()) ? 'expired'
      : record.confirmed ? 'confirmed' : record.secret ? 'issued' : 'prepared' };
}
beforeEach(async () => {
  records = new Map(); calls = []; faults = []; dropIssue = null; holdRef = null; heldResponse = null;
  const config = { RAILWAY_ENVIRONMENT_NAME: 'staging', SM_ENV: 'staging', SM_CUSTOMER_ACCOUNT_MODE: 'closed_trial',
    RAILWAY_ENVIRONMENT_ID: refA, SM_CUSTOMER_PILOT_ENVIRONMENT_ID: refA,
    RAILWAY_PROJECT_ID: refB, SM_CUSTOMER_PILOT_PROJECT_ID: refB,
    NEXT_PUBLIC_API_URL: 'https://customer-api.example.test', SM_CUSTOMER_RELAY_SIGNING_KEY: randomBytes(32).toString('base64'),
    SM_CUSTOMER_PILOT_ORIGINS: JSON.stringify([origin]), SM_CUSTOMER_PILOT_SLUGS: '["classfood"]' };
  for (const [key, value] of Object.entries(config)) vi.stubEnv(key, value);
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
    const envelope = JSON.parse(String(init.body));
    if (url.endsWith('/session')) {
      calls.push('session');
      const row = records.get(envelope.browserRef);
      if (!row?.confirmed || row.secret !== envelope.browserSecret || row.expiresAt <= Date.now()) return new Response(null, { status: 401 });
      return Response.json({ expiresAt: row.expiresAt, profile: { name: 'Profile fixture', phoneE164: '+33600000000', phoneVerifiedAt: Date.now() - 1_000, revision: 0 } });
    }
    if (!url.endsWith('/browser')) throw Error('Unexpected upstream');
    const { step, browserRef } = envelope.request; calls.push(step);
    if (step === 'prepare' && !records.has(browserRef)) records.set(browserRef, {
      browserRef, secret: null, confirmed: false, admissionExpiresAt: Date.now() + 600_000, expiresAt: Date.now() + 604_800_000,
    });
    const row = records.get(browserRef); if (!row) return new Response(null, { status: 409 });
    let emitCookie = false;
    if (step === 'issue' && !row.secret && publicView(row).state !== 'expired') {
      row.secret = envelope.candidateSecret; emitCookie = true;
    }
    if (step === 'confirm') {
      if (row.secret !== envelope.browserSecret || publicView(row).state === 'expired') return new Response(null, { status: 401 });
      row.confirmed = true;
    }
    return Response.json({ preparation: publicView(row), emitCookie });
  }));
  context = await native.newContext({ serviceWorkers: 'block' });
  context.on('page', tab => tab.on('pageerror', error => faults.push(error.message)));
  await context.route('**/*', async route => {
    const request = route.request(); const url = new URL(request.url());
    if (url.origin !== origin) { faults.push('External navigation refused'); await route.abort(); return; }
    if (url.pathname === '/') {
      await route.fulfill({ contentType: 'text/html; charset=utf-8', body: '<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Préparation compte — recette locale</title></head><body><h1>Préparation du compte</h1><button>Préparer</button><output></output><script type="module" src="/fixture.js"></script></body></html>' }); return;
    }
    if (url.pathname === '/fixture.js') { await route.fulfill({ contentType: 'text/javascript', body: bundle }); return; }
    if (url.pathname === '/favicon.ico') { await route.fulfill({ status: 204 }); return; }
    const nativeRequest = new NextRequest(request.url(), { method: request.method(),
      headers: { ...await request.allHeaders(), host: new URL(origin).host, 'x-real-ip': '192.0.2.10' },
      ...(request.method() === 'GET' ? {} : { body: request.postData() }) });
    const response = url.pathname.endsWith('/navigateur')
      ? await browserHandler(nativeRequest, { params: Promise.resolve({ slug: 'classfood' }) })
      : url.pathname.endsWith('/session') ? await sessionHandler(nativeRequest, { params: Promise.resolve({ slug: 'classfood' }) })
        : new Response(null, { status: 404 });
    const input = request.postDataJSON() as { step?: string; browserRef?: string } | null;
    if (input?.step === 'issue' && input.browserRef === holdRef) { heldResponse = { route, response }; return; }
    if (input?.step === 'issue' && dropIssue) {
      const mode = dropIssue; dropIssue = null;
      if (mode === 'headers') { await route.abort('failed'); return; }
      await fulfill(route, response, true); return;
    }
    await fulfill(route, response);
  });
  page = await context.newPage(); await page.goto(origin);
  await page.waitForFunction(() => Boolean(window.preparationFixture));
});
afterEach(async () => {
  if (heldResponse) await heldResponse.route.abort().catch(() => undefined);
  await context?.close(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); expect(faults).toEqual([]);
});
afterAll(async () => { await native?.close(); });

describe('Customer preparation — native browser continuity', () => {
  it('persists its selector, receives a protected cookie and confirms after reload without issuing again', async () => {
    expect(await page.title()).toBe('Préparation compte — recette locale');
    expect(await page.getByRole('heading', { name: 'Préparation du compte' }).count()).toBe(1);
    await page.getByRole('button', { name: 'Préparer' }).click();
    await expect.poll(() => page.locator('output').textContent()).toContain('"kind":"ready"');
    const before = await page.evaluate(() => window.preparationFixture.journal());
    const cookies = await context.cookies(); const cookie = cookies.find(item => item.name === browserCookie)!;
    expect(cookie).toMatchObject({ httpOnly: true, secure: true, sameSite: 'Strict', path: '/' });
    expect(await page.evaluate(() => document.cookie)).not.toContain(browserCookie);
    expect(calls).toEqual(['prepare', 'issue', 'confirm']);
    await page.reload(); await page.waitForFunction(() => Boolean(window.preparationFixture));
    expect(await page.evaluate(() => window.preparationFixture.resume())).toMatchObject({ kind: 'ready' });
    expect(await page.evaluate(() => window.preparationFixture.journal())).toEqual(before);
    expect(calls.filter(call => call === 'issue')).toHaveLength(1);
    expect((await context.cookies()).find(item => item.name === browserCookie)).toEqual(cookie);
  });
  it('serializes two tabs using native Web Locks and a single durable issue', async () => {
    const second = await context.newPage(); await second.goto(origin); await second.waitForFunction(() => Boolean(window.preparationFixture));
    const results = await Promise.all([page, second].map(tab => tab.evaluate(() => window.preparationFixture.begin())));
    expect(results.map(value => value.kind)).toEqual(['ready', 'ready']); expect(records.size).toBe(1);
    expect(calls.filter(call => call === 'issue')).toHaveLength(1);
    expect(await second.evaluate(() => window.preparationFixture.journal())).toEqual(await page.evaluate(() => window.preparationFixture.journal()));
  });
  it('never reissues after losing the entire response before the cookie headers', async () => {
    dropIssue = 'headers'; expect(await page.evaluate(() => window.preparationFixture.begin())).toEqual({ kind: 'uncertain' });
    expect((await context.cookies()).find(item => item.name === browserCookie)).toBeUndefined();
    await page.reload(); await page.waitForFunction(() => Boolean(window.preparationFixture));
    expect(await page.evaluate(() => window.preparationFixture.resume())).toEqual({ kind: 'uncertain' });
    expect(calls.filter(call => call === 'issue')).toHaveLength(1);
    expect([...records.values()][0]!.confirmed).toBe(false);
  });
  it('recovers a cookie received with an unreadable body through a separate confirmation', async () => {
    dropIssue = 'body'; expect(await page.evaluate(() => window.preparationFixture.begin())).toEqual({ kind: 'uncertain' });
    const cookie = (await context.cookies()).find(item => item.name === browserCookie)!; expect(cookie).toBeDefined();
    expect(await page.evaluate(() => window.preparationFixture.resume())).toMatchObject({ kind: 'ready' });
    expect(calls.filter(call => call === 'issue')).toHaveLength(1);
    expect((await context.cookies()).find(item => item.name === browserCookie)).toEqual(cookie);
  });
  it.each(['missing', 'corrupt'])('%s journal never adopts existing cookies or reads a private profile', async failure => {
    expect(await page.evaluate(() => window.preparationFixture.begin())).toMatchObject({ kind: 'ready' });
    await page.evaluate(async failure => {
      await new Promise<void>((resolve, reject) => {
        const open = indexedDB.open('sm-customer-preparation-v1', 1);
        open.onsuccess = () => {
          const db = open.result; const tx = db.transaction('preparations', 'readwrite', { durability: 'strict' });
          if (failure === 'missing') tx.objectStore('preparations').delete('classfood');
          else tx.objectStore('preparations').put({ version: 1, browserRef: 'invalid', phone: 'forbidden' }, 'classfood');
          tx.oncomplete = () => { db.close(); resolve(); }; tx.onerror = () => reject(Error('Fixture deletion failed'));
        };
      });
    }, failure);
    const noRead = await page.evaluate(async () => {
      try { await window.preparationFixture.privateRead(); return 'unexpected'; } catch { return 'refused'; }
    });
    expect(noRead).toBe('refused');
    expect(await page.evaluate(() => window.preparationFixture.resume())).toEqual({ kind: failure === 'missing' ? 'absent' : 'uncertain' });
    expect((await context.cookies()).find(item => item.name === browserCookie)).toBeDefined();
  });
  it('does not touch the network if native storage or Web Locks are unavailable', async () => {
    await page.evaluate(() => { Object.defineProperty(window, 'indexedDB', { value: undefined }); });
    expect(await page.evaluate(() => window.preparationFixture.begin())).toEqual({ kind: 'uncertain' }); expect(calls).toEqual([]);
    await page.addInitScript(() => Object.defineProperty(navigator, 'locks', { value: undefined }));
    await page.reload(); await page.waitForFunction(() => Boolean(window.preparationFixture));
    expect(await page.evaluate(() => window.preparationFixture.begin())).toEqual({ kind: 'blocked' }); expect(calls).toEqual([]);
  });
  it('a late actual Set-Cookie A after B is refused with the selected B journal, never adopted as A', async () => {
    // Simulates a stale/uncoordinated caller; the current controller itself uses
    // native exclusion. Both issue HTTP requests genuinely start without cookie.
    holdRef = refA;
    await page.evaluate(async ref => {
      await fetch('/r/classfood/compte/navigateur', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ step: 'prepare', browserRef: ref }) });
      void fetch('/r/classfood/compte/navigateur', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ step: 'issue', browserRef: ref }) }).catch(() => undefined);
    }, refA);
    await expect.poll(() => heldResponse !== null).toBe(true);
    expect(await page.evaluate(() => window.preparationFixture.begin())).toMatchObject({ kind: 'ready' });
    const chosen = (await page.evaluate(() => window.preparationFixture.journal()))!.browserRef;
    const expected = records.get(chosen)!; expect(expected.secret).toBeTruthy();
    // Explicit publication fixture so the new client actually reaches the BFF;
    // otherwise an absent verification journal would already refuse locally.
    await page.evaluate(async () => {
      const open = indexedDB.open('sm-customer-preparation-v1', 1);
      await new Promise<void>((resolve, reject) => {
        open.onsuccess = () => {
          const db = open.result; const tx = db.transaction('preparations', 'readwrite', { durability: 'strict' });
          const store = tx.objectStore('preparations'), read = store.get('classfood');
          read.onsuccess = () => store.put({ ...read.result, verification: { phase: 'completed', operationId: crypto.randomUUID(),
            challengeId: crypto.randomUUID(), checkId: crypto.randomUUID(), expiresAt: Date.now() + 60_000 } }, 'classfood');
          tx.oncomplete = () => { db.close(); resolve(); }; tx.onerror = () => reject(Error('Fixture failed'));
        };
      });
    });
    await context.addCookies([{ name: sessionCookie, value: randomBytes(32).toString('base64url'), url: origin, httpOnly: true, secure: true, sameSite: 'Strict' }]);
    holdRef = null; const held = heldResponse!; heldResponse = null; await fulfill(held.route, held.response);
    await expect.poll(async () => (await context.cookies()).find(item => item.name === browserCookie)?.value).toBe(records.get(refA)!.secret);
    const result = await page.evaluate(async () => {
      try { return await window.preparationFixture.privateRead(); } catch { return 'refused'; }
    });
    expect(result).toBe('refused'); expect(calls.filter(action => action === 'session')).toHaveLength(1);
    expect((await page.evaluate(() => window.preparationFixture.journal()))!.browserRef).toBe(chosen);
  });
});
