import { randomBytes, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { chromium, type Browser, type BrowserContext, type Page, type Route } from 'playwright';
import { NextRequest } from 'next/server';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { CustomerAccountActionSchema, CustomerAccountEnvelopes, type CustomerAccountView } from '@sm/contracts';
import { customerAccount } from '../../app/r/[slug]/compte/customer-bff';
import type { CustomerBrowserJournal } from './browser-journal';
import type { CustomerBrowserPreparationResult } from './browser-preparation';
import type { CustomerVerificationOutcome } from './verification';

declare global {
  interface Window {
    verificationFixture: {
      prepare(): Promise<CustomerBrowserPreparationResult>;
      begin(): Promise<CustomerVerificationOutcome>;
      start(): Promise<CustomerVerificationOutcome>;
      check(code?: string): Promise<CustomerVerificationOutcome>;
      resume(): Promise<CustomerVerificationOutcome>;
      close(): Promise<CustomerVerificationOutcome>;
      journal(): Promise<CustomerBrowserJournal | null>;
      privateRead(): Promise<unknown>;
    };
  }
}

const origin = 'https://staging.snackmanager.fr';
const apiOrigin = 'https://customer-api.example.test';
const refA = '10000000-0000-4000-8000-000000000001';
const refB = '20000000-0000-4000-8000-000000000002';
const browserCookie = '__Host-sm_customer_browser_classfood';
const sessionCookie = '__Host-sm_customer_session_classfood';
const intentCookie = (id: string) => `__Host-sm_customer_intent_classfood_${id}`;
type BrowserRow = { browserRef: string; secret: string | null; confirmed: boolean; admissionExpiresAt: number; expiresAt: number };
type IntentRow = { operationId: string; browserRef: string; proof: string; expiresAt: number; closed: boolean;
  challengeId: string | null; checkId: string | null; result: 'unresolved' | 'code_required' | 'incorrect' | 'approved';
  token: string | null; view: CustomerAccountView | null };
type Loss = { action: string; mode: 'headers' | 'body' };
let browser: Browser, context: BrowserContext, page: Page, bundle: string;
let browsers: Map<string, BrowserRow>, intents: Map<string, IntentRow>;
let calls: string[], wire: { action: string; operationId?: string; checkId?: string }[], faults: string[];
let losses: Loss[], held: { route: Route; response: Response } | null, holdAction: string | null, holdOperation: string | null;

// Browser plugin not available. Native Chromium storage, Web Locks and cookie
// jar, real verification controller/transport and real Next BFF. Only the
// upstream authority is simulated; this suite does NOT prove SQL or send SMS.
beforeAll(async () => {
  const output = await build({ stdin: { contents: `
    import {customerBrowserPreparation} from './browser-preparation';
    import {customerBrowserJournal} from './browser-journal';
    import {customerVerification} from './verification';
    import {customerAccountRequest} from './client';
    const p=customerBrowserPreparation('classfood'), v=customerVerification('classfood');
    window.verificationFixture={...v,prepare:()=>p.begin(),start:()=>v.start('+33600000000','fixture-human-proof'),
      check:(code='123456')=>v.check(code),journal:()=>customerBrowserJournal('classfood').read(),
      privateRead:()=>customerAccountRequest('classfood')('session')};
    document.querySelector('button').onclick=async()=>{
      document.querySelector('output').textContent=JSON.stringify(await p.begin());
    };`, resolveDir: fileURLToPath(new URL('.', import.meta.url)), loader: 'ts' },
    bundle: true, write: false, format: 'esm', platform: 'browser', target: 'es2022' });
  bundle = output.outputFiles[0]!.text;
  browser = await chromium.launch({ headless: true });
});

function fail(status: number) { return new Response(null, { status }); }
function browserView(row: BrowserRow) {
  return { browserRef: row.browserRef, admissionExpiresAt: row.admissionExpiresAt, expiresAt: row.expiresAt,
    state: row.confirmed ? 'confirmed' : row.secret ? 'issued' : 'prepared' };
}
async function upstream(url: string, init: RequestInit) {
  if (!url.startsWith(`${apiOrigin}/public/customer/classfood/`) || init.method !== 'POST') {
    faults.push('Unexpected upstream rejected'); throw new Error('Isolated upstream only');
  }
  const action = CustomerAccountActionSchema.parse(url.split('/').at(-1));
  const envelope = CustomerAccountEnvelopes[action].parse(JSON.parse(String(init.body)));
  const headers = new Headers(init.headers);
  expect(headers.get('x-sm-customer-proof')).toMatch(/^[A-Za-z0-9_-]{43}$/);
  expect(init).toMatchObject({ cache: 'no-store', redirect: 'error' });
  if (action === 'browser') {
    const input = CustomerAccountEnvelopes.browser.parse(envelope);
    calls.push(`browser:${input.request.step}`);
    // This fixture covers OTP/intention selection, not restoration. The
    // dedicated preparation browser suite exercises that read-only boundary.
    if (input.request.step === 'restore') return fail(400);
    const { browserRef, step } = input.request;
    if (step === 'prepare' && !browsers.has(browserRef)) browsers.set(browserRef, { browserRef,
      secret: null, confirmed: false, admissionExpiresAt: Date.now() + 600_000, expiresAt: Date.now() + 604_800_000 });
    const row = browsers.get(browserRef); if (!row) return fail(409);
    let emitCookie = false;
    if (step === 'issue' && !row.secret) { row.secret = input.candidateSecret; emitCookie = true; }
    if (step === 'confirm') {
      if (row.secret !== input.browserSecret) return fail(401);
      row.confirmed = true;
    }
    return Response.json({ preparation: browserView(row), emitCookie });
  }
  if (!('browserRef' in envelope)) return fail(400);
  const row = browsers.get(envelope.browserRef);
  if (!row?.confirmed || row.secret !== envelope.browserSecret) return fail(401);
  if (action === 'intent') {
    const input = CustomerAccountEnvelopes.intent.parse(envelope);
    calls.push(`intent:${input.request.step}`);
    const { operationId, step } = input.request;
    let emitCookie = false;
    if (step === 'prepare' && !intents.has(operationId)) {
      intents.set(operationId, { operationId, browserRef: input.browserRef, proof: input.candidateProof!,
        expiresAt: Date.now() + 600_000, closed: false, challengeId: null, checkId: null,
        result: 'unresolved', token: null, view: null }); emitCookie = true;
    }
    const intent = intents.get(operationId); if (!intent || intent.browserRef !== input.browserRef) return fail(409);
    if (step === 'close') intent.closed = true;
    return Response.json({ intent: { operationId, state: intent.closed ? 'closed' : 'open', expiresAt: intent.expiresAt }, emitCookie });
  }
  if (action === 'session') {
    const input = CustomerAccountEnvelopes.session.parse(envelope); calls.push('session');
    const intent = intents.get(input.expectedOperationId);
    if (!intent || intent.browserRef !== input.browserRef || intent.token !== input.sessionToken
      || intent.checkId !== input.expectedCheckId || intent.result !== 'approved') return fail(401);
    return Response.json(intent.view);
  }
  if (action !== 'start' && action !== 'check' && action !== 'recover') return fail(400);
  const input = CustomerAccountEnvelopes[action].parse(envelope);
  const intent = intents.get(input.request.operationId);
  calls.push(action);
  if (!intent || intent.browserRef !== input.browserRef || intent.proof !== input.intentProof) return fail(401);
  if (action === 'start') {
    if (intent.closed || intent.challengeId) return fail(409);
    intent.challengeId = randomUUID(); intent.result = 'code_required';
    return Response.json({ challengeId: intent.challengeId, expiresAt: intent.expiresAt });
  }
  if (action === 'check') {
    const check = CustomerAccountEnvelopes.check.parse(input).request;
    if (intent.closed || check.challengeId !== intent.challengeId || intent.checkId === check.checkId) return fail(409);
    intent.checkId = check.checkId;
    if (check.code !== '123456') { intent.result = 'incorrect'; return fail(401); }
    intent.result = 'approved'; intent.token = randomBytes(32).toString('base64url');
    intent.view = { expiresAt: Date.now() + 604_800_000,
      profile: { name: 'Fixture profile', phoneE164: '+33600000000', phoneVerifiedAt: Date.now() - 1_000, revision: 0 } };
    // Wire fixture for permitted legacy continuity, not proof of its account
    // authorization. New enrollment is covered separately and emits no token.
    return Response.json({ state: 'authenticated', token: intent.token, view: intent.view });
  }
  const recover = CustomerAccountEnvelopes.recover.parse(input).request;
  const result = { operationId: intent.operationId, checkId: recover.checkId, challengeId: intent.challengeId, expiresAt: intent.expiresAt };
  if (intent.closed) return Response.json({ ...result, state: 'closed' });
  if (recover.checkId !== intent.checkId) return Response.json({ ...result, state: 'unresolved' });
  return Response.json({ ...result, state: intent.result,
    ...(intent.result === 'approved' ? { token: intent.token, view: intent.view } : {}) });
}

async function fulfill(route: Route, response: Response, corrupt = false) {
  await route.fulfill({ status: response.status, headers: Object.fromEntries(response.headers), body: corrupt ? '{' : await response.text() });
}
async function open(tab: Page) {
  await tab.goto(origin); await tab.waitForFunction(() => Boolean(window.verificationFixture));
}
beforeEach(async () => {
  browsers = new Map(); intents = new Map(); calls = []; wire = []; faults = []; losses = [];
  held = null; holdAction = null; holdOperation = null;
  const config = { RAILWAY_ENVIRONMENT_NAME: 'staging', SM_ENV: 'staging', SM_CUSTOMER_ACCOUNT_MODE: 'closed_trial',
    RAILWAY_ENVIRONMENT_ID: refA, SM_CUSTOMER_PILOT_ENVIRONMENT_ID: refA, RAILWAY_PROJECT_ID: refB, SM_CUSTOMER_PILOT_PROJECT_ID: refB,
    NEXT_PUBLIC_API_URL: apiOrigin, SM_CUSTOMER_RELAY_SIGNING_KEY: randomBytes(32).toString('base64'),
    SM_CUSTOMER_PILOT_ORIGINS: JSON.stringify([origin]), SM_CUSTOMER_PILOT_SLUGS: '["classfood"]' };
  for (const [key, value] of Object.entries(config)) vi.stubEnv(key, value);
  vi.stubGlobal('fetch', vi.fn(upstream));
  context = await browser.newContext({ serviceWorkers: 'block' });
  context.on('page', tab => tab.on('pageerror', error => faults.push(error.message)));
  await context.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url());
    if (url.origin !== origin) { faults.push('External browser request refused'); await route.abort(); return; }
    if (url.pathname === '/' && request.method() === 'GET') {
      await route.fulfill({ contentType: 'text/html; charset=utf-8', body: '<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Vérification — recette locale isolée</title></head><body><h1>Vérification du compte</h1><button>Préparer le navigateur</button><output></output><script type="module" src="/fixture.js"></script></body></html>' }); return;
    }
    if (url.pathname === '/fixture.js') { await route.fulfill({ contentType: 'text/javascript', body: bundle }); return; }
    if (url.pathname === '/favicon.ico') { await route.fulfill({ status: 204 }); return; }
    const actions = { navigateur: 'browser', intention: 'intent', verification: 'start', confirmation: 'check', resultat: 'recover', session: 'session' } as const;
    const path = url.pathname.split('/').at(-1) as keyof typeof actions;
    const action = actions[path];
    if (!action || url.pathname !== `/r/classfood/compte/${path}`) { faults.push('Unknown browser route refused'); await route.abort(); return; }
    const input = request.postDataJSON() as { step?: string; operationId?: string; checkId?: string } | null;
    const phase = action === 'intent' ? `intent:${input?.step}` : action;
    wire.push({ action: phase, ...(input?.operationId ? { operationId: input.operationId } : {}), ...(input?.checkId ? { checkId: input.checkId } : {}) });
    const nativeRequest = new NextRequest(request.url(), { method: request.method(),
      headers: { ...await request.allHeaders(), host: new URL(origin).host, 'x-real-ip': '192.0.2.10' },
      ...(request.method() === 'GET' ? {} : { body: request.postData() }) });
    const response = await customerAccount(nativeRequest, { params: Promise.resolve({ slug: 'classfood' }) }, action);
    expect(response.headers.get('cache-control')).toContain('no-store');
    if (holdAction === phase && (holdOperation === null || input?.operationId === holdOperation)) { held = { route, response }; return; }
    const fault = losses.findIndex(loss => loss.action === phase);
    if (fault !== -1) {
      const [loss] = losses.splice(fault, 1);
      if (loss!.mode === 'headers') { await route.abort('failed'); return; }
      await fulfill(route, response, true); return;
    }
    await fulfill(route, response);
  });
  page = await context.newPage(); await open(page);
});
afterEach(async () => {
  if (held) await held.route.abort().catch(() => undefined);
  await context?.close(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); expect(faults).toEqual([]);
});
afterAll(async () => { await browser?.close(); });

async function prepare() { expect(await page.evaluate(() => window.verificationFixture.prepare())).toMatchObject({ kind: 'ready', preparation: { state: 'confirmed' } }); }
async function begin() { await prepare(); expect(await page.evaluate(() => window.verificationFixture.begin())).toEqual({ kind: 'prepared' }); }
async function start() { await begin(); expect(await page.evaluate(() => window.verificationFixture.start())).toEqual({ kind: 'code_required' }); }
async function privateRead() {
  return page.evaluate(async () => { try { return await window.verificationFixture.privateRead(); } catch { return 'refused'; } });
}
async function reload() { await page.reload(); await page.waitForFunction(() => Boolean(window.verificationFixture)); }
async function release() { const response = held!; held = null; holdAction = null; holdOperation = null; await fulfill(response.route, response.response); }

describe('Customer verification — native browser continuity through the real BFF', () => {
  it('prepares, starts, checks, reads its durable result then exposes only the selected private profile', async () => {
    expect(await page.title()).toBe('Vérification — recette locale isolée');
    expect(await page.getByRole('heading', { name: 'Vérification du compte' }).count()).toBe(1);
    await page.getByRole('button').click();
    await expect.poll(() => page.locator('output').textContent()).toContain('"kind":"ready"');
    expect(await page.evaluate(() => window.verificationFixture.begin())).toEqual({ kind: 'prepared' });
    expect(await page.evaluate(() => window.verificationFixture.start())).toEqual({ kind: 'code_required' });
    expect(await page.evaluate(() => window.verificationFixture.check())).toEqual({ kind: 'approved' });
    expect(await privateRead()).toMatchObject({ profile: { name: 'Fixture profile' } });
    expect(calls).toEqual(['browser:prepare', 'browser:issue', 'browser:confirm', 'intent:prepare', 'start', 'check', 'recover', 'session']);
    const journal = (await page.evaluate(() => window.verificationFixture.journal()))!;
    expect(journal.verification?.phase).toBe('completed');
    const serialized = JSON.stringify(journal);
    for (const value of ['+33600000000', '123456', 'fixture-human-proof', 'Fixture profile', 'token', 'proof', 'phone']) expect(serialized).not.toContain(value);
    const cookies = await context.cookies();
    for (const name of [browserCookie, sessionCookie, intentCookie(journal.verification!.operationId)]) {
      expect(cookies.find(cookie => cookie.name === name)).toMatchObject({ httpOnly: true, secure: true, sameSite: 'Strict', path: '/' });
    }
    expect(await page.evaluate(() => document.cookie)).toBe('');
    const intent = cookies.find(cookie => cookie.name === intentCookie(journal.verification!.operationId))!;
    const session = cookies.find(cookie => cookie.name === sessionCookie)!;
    expect(intent.expires - Date.now() / 1_000).toBeLessThanOrEqual(600);
    expect(session.expires - intent.expires).toBeGreaterThan(603_000);
    await reload(); expect(await privateRead()).toMatchObject({ profile: { name: 'Fixture profile' } });
    expect(calls.filter(call => call === 'check')).toHaveLength(1);
  });

  it('two native tabs serialize intention and start, so only one send is admitted', async () => {
    await prepare(); const other = await context.newPage(); await open(other);
    await Promise.all([page, other].map(tab => tab.evaluate(() => window.verificationFixture.begin())));
    const results = await Promise.all([page, other].map(tab => tab.evaluate(() => window.verificationFixture.start())));
    expect(results.map(result => result.kind).sort()).toEqual(['blocked', 'code_required']);
    expect(calls.filter(call => call === 'intent:prepare')).toHaveLength(1);
    expect(calls.filter(call => call === 'start')).toHaveLength(1);
    expect(await other.evaluate(() => window.verificationFixture.journal())).toEqual(await page.evaluate(() => window.verificationFixture.journal()));
  });

  it.each(['headers', 'body'] as const)('lost intention %s never issues a second proof; recovery or explicit close is required', async mode => {
    await prepare(); losses.push({ action: 'intent:prepare', mode });
    expect(await page.evaluate(() => window.verificationFixture.begin())).toEqual({ kind: 'uncertain' });
    const before = (await page.evaluate(() => window.verificationFixture.journal()))!;
    await reload(); expect(await page.evaluate(() => window.verificationFixture.resume())).toEqual({ kind: mode === 'headers' ? 'uncertain' : 'prepared' });
    expect(calls.filter(call => call === 'intent:prepare')).toHaveLength(1);
    expect((await page.evaluate(() => window.verificationFixture.journal()))!.verification!.operationId).toBe(before.verification!.operationId);
    if (mode === 'headers') {
      expect(await page.evaluate(() => window.verificationFixture.start())).toEqual({ kind: 'blocked' });
      expect(await page.evaluate(() => window.verificationFixture.close())).toEqual({ kind: 'closed' });
    }
    expect(calls.filter(call => call === 'start')).toHaveLength(0);
  });

  it.each(['headers', 'body'] as const)('lost start %s resumes by result only after reload, never another send', async mode => {
    await begin(); losses.push({ action: 'start', mode });
    expect(await page.evaluate(() => window.verificationFixture.start())).toEqual({ kind: 'uncertain' });
    const selected = await page.evaluate(() => window.verificationFixture.journal());
    await reload(); expect(await page.evaluate(() => window.verificationFixture.resume())).toEqual({ kind: 'code_required' });
    expect(calls.filter(call => call === 'start')).toHaveLength(1);
    expect((await page.evaluate(() => window.verificationFixture.journal()))!.verification!.operationId).toBe(selected!.verification!.operationId);
  });

  it('a real native fetch deadline keeps the admitted start uncertain until a result read, never a second send', async () => {
    await begin(); holdAction = 'start';
    const sending = page.evaluate(() => window.verificationFixture.start());
    await expect.poll(() => held !== null).toBe(true);
    // Real AbortSignal.timeout(12_000), no fake clock or replaced fetch. The
    // simulated upstream has admitted the send; its BFF response stays held.
    expect(await sending).toEqual({ kind: 'uncertain' });
    expect((await page.evaluate(() => window.verificationFixture.journal()))!.verification!.phase).toBe('starting');
    expect(await page.evaluate(() => window.verificationFixture.start())).toEqual({ kind: 'blocked' });
    expect(await page.evaluate(() => window.verificationFixture.resume())).toEqual({ kind: 'code_required' });
    expect(calls.filter(call => call === 'start')).toHaveLength(1);
  }, 20_000);

  it.each(['headers', 'body'] as const)('lost check %s and lost result remain checking, then recover without another OTP check', async mode => {
    await start(); losses.push({ action: 'check', mode }, { action: 'recover', mode });
    expect(await page.evaluate(() => window.verificationFixture.check())).toEqual({ kind: 'uncertain' });
    const selected = (await page.evaluate(() => window.verificationFixture.journal()))!.verification!;
    expect(selected.phase).toBe('checking'); expect(await privateRead()).toBe('refused');
    await reload(); expect(await page.evaluate(() => window.verificationFixture.resume())).toEqual({ kind: 'approved' });
    expect(calls.filter(call => call === 'check')).toHaveLength(1);
    expect(wire.filter(call => call.action === 'recover').map(call => call.checkId)).toEqual([selected.checkId, selected.checkId]);
    expect(await privateRead()).toMatchObject({ profile: { name: 'Fixture profile' } });
  });

  it('a wrong code with a lost response is recovered as incorrect; only a new explicit code creates another check', async () => {
    await start(); losses.push({ action: 'check', mode: 'headers' });
    expect(await page.evaluate(() => window.verificationFixture.check('000000'))).toEqual({ kind: 'incorrect' });
    const previous = (await page.evaluate(() => window.verificationFixture.journal()))!.verification!.checkId;
    await reload(); expect(await page.evaluate(() => window.verificationFixture.resume())).toEqual({ kind: 'incorrect' });
    expect(calls.filter(call => call === 'check')).toHaveLength(1); expect(await privateRead()).toBe('refused');
    expect(await page.evaluate(() => window.verificationFixture.check())).toEqual({ kind: 'approved' });
    expect(calls.filter(call => call === 'check')).toHaveLength(2);
    expect((await page.evaluate(() => window.verificationFixture.journal()))!.verification!.checkId).not.toBe(previous);
  });

  it.each(['headers', 'body'] as const)('lost close %s resumes only the same close even when its cookie was erased', async mode => {
    await start(); losses.push({ action: 'intent:close', mode });
    expect(await page.evaluate(() => window.verificationFixture.close())).toEqual({ kind: 'uncertain' });
    expect((await page.evaluate(() => window.verificationFixture.journal()))!.verification!.phase).toBe('closing');
    const before = wire.length; await reload();
    expect(await page.evaluate(() => window.verificationFixture.resume())).toEqual({ kind: 'closed' });
    expect(wire.slice(before).map(call => call.action)).toEqual(['intent:close']);
    expect(calls.filter(call => call === 'start')).toHaveLength(1);
  });

  it('a session cookie received by check cannot publish a profile before result and the completed journal', async () => {
    await start(); holdAction = 'recover';
    const checking = page.evaluate(() => window.verificationFixture.check());
    await expect.poll(() => held !== null).toBe(true);
    expect((await context.cookies()).find(cookie => cookie.name === sessionCookie)).toBeDefined();
    expect(await privateRead()).toBe('refused'); expect(calls).not.toContain('session');
    await release(); expect(await checking).toEqual({ kind: 'approved' });
    expect(await privateRead()).toMatchObject({ profile: { name: 'Fixture profile' } });
  });

  it('late intention A Set-Cookie cannot replace B because their protected cookie names are distinct', async () => {
    await prepare(); holdAction = 'intent:prepare'; holdOperation = refA;
    await page.evaluate(async operationId => {
      const record = await window.verificationFixture.journal();
      void fetch('/r/classfood/compte/intention', { method: 'POST', headers: { 'Content-Type': 'application/json',
        'x-sm-customer-browser-ref': record!.browserRef }, body: JSON.stringify({ step: 'prepare', operationId }) }).catch(() => undefined);
    }, refA);
    await expect.poll(() => held !== null).toBe(true);
    expect(await page.evaluate(() => window.verificationFixture.begin())).toEqual({ kind: 'prepared' });
    const selected = (await page.evaluate(() => window.verificationFixture.journal()))!.verification!.operationId;
    const cookieB = (await context.cookies()).find(cookie => cookie.name === intentCookie(selected)); expect(cookieB).toBeDefined();
    await release();
    await expect.poll(async () => (await context.cookies()).some(cookie => cookie.name === intentCookie(refA))).toBe(true);
    expect((await context.cookies()).find(cookie => cookie.name === intentCookie(selected))).toEqual(cookieB);
    expect(await page.evaluate(() => window.verificationFixture.start())).toEqual({ kind: 'code_required' });
    expect(intents.get(refA)!.challengeId).toBeNull(); expect(intents.get(selected)!.challengeId).not.toBeNull();
  });

  it.each(['missing', 'corrupt'] as const)('%s journal refuses cookie adoption, recovery and private profile without HTTP', async corruption => {
    await start(); expect(await page.evaluate(() => window.verificationFixture.check())).toEqual({ kind: 'approved' });
    await page.evaluate(async corruption => {
      await new Promise<void>((resolve, reject) => {
        const request = indexedDB.open('sm-customer-preparation-v1', 1);
        request.onerror = () => reject(Error('Fixture open failed'));
        request.onsuccess = () => {
          const db = request.result, tx = db.transaction('preparations', 'readwrite', { durability: 'strict' });
          if (corruption === 'missing') tx.objectStore('preparations').delete('classfood');
          else tx.objectStore('preparations').put({ version: 1, browserRef: 'invalid', verification: { phase: 'completed' } }, 'classfood');
          tx.oncomplete = () => { db.close(); resolve(); }; tx.onerror = () => { db.close(); reject(Error('Fixture edit failed')); };
        };
      });
    }, corruption);
    const count = wire.length; await reload();
    expect(await privateRead()).toBe('refused');
    expect(await page.evaluate(() => window.verificationFixture.resume())).toEqual({ kind: 'uncertain' });
    expect(wire).toHaveLength(count); expect((await context.cookies()).find(cookie => cookie.name === sessionCookie)).toBeDefined();
  });

  it.each(['indexedDB', 'locks'] as const)('unavailable native %s prevents an intention without network fallback', async missing => {
    await prepare(); const count = wire.length;
    await page.addInitScript(missing => {
      if (missing === 'indexedDB') Object.defineProperty(window, 'indexedDB', { value: undefined });
      else Object.defineProperty(navigator, 'locks', { value: undefined });
    }, missing);
    await reload();
    expect(await page.evaluate(() => window.verificationFixture.begin())).toEqual({ kind: missing === 'locks' ? 'blocked' : 'uncertain' });
    expect(wire).toHaveLength(count); expect(intents.size).toBe(0);
  });
});
