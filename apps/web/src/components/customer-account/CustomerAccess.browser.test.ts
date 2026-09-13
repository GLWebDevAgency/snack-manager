import { randomBytes } from 'node:crypto';
import { readFile, mkdtemp } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { build } from 'esbuild';
import postcss from 'postcss';
import tailwind from '@tailwindcss/postcss';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { verifyRegistrationResponse, verifyAuthenticationResponse } from '@simplewebauthn/server';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

// Real rendered Entry/Sheet/hooks/controllers/IDB/Web Locks and native WebAuthn.
// HTTP is an isolated protocol fixture, not Next/BFF/Nest/SQL or a provider.
// Registration/assertion signatures are checked by the real server library.
const origin = 'https://access-fixture.example.test', hostname = new URL(origin).hostname;
const opaque = () => randomBytes(32).toString('base64url');
type Credential = NonNullable<Awaited<ReturnType<typeof verifyRegistrationResponse>>['registrationInfo']>['credential'];
let browser: Browser, context: BrowserContext, page: Page, js: string, css: string, capture: string | undefined;
let faults: string[], steps: string[], operationId: string, attemptId: string, publicationId: string | null, browserRef: string;
let expiresAt: number, browserExpires: number, verifiedAt: number, stage: string, version: number, code: string, oldCode: string, challenge: string, userId: string;
let credential: Credential, mutations: number, assertions: number, closed: number, loseLogin: boolean, loseActivation: boolean, available: boolean, failed: boolean;
let heldCode: Promise<void> | null, releaseCode: (() => void) | null;
let heldLogin: Promise<void> | null, releaseLogin: (() => void) | null, logouts: number;
let heldLogout: Promise<void> | null, releaseLogout: (() => void) | null;
const profile = () => ({ expiresAt: browserExpires, profile: { name: null, phoneE164: '+33600000000', phoneVerifiedAt: verifiedAt, revision: 0 } });
const recovery = () => ({ operationId, attemptId, expiresAt, stage, recoveryVersion: version });
const auth = () => ({ state: 'authenticated', operationId, publicationId, view: profile() });
beforeAll(async () => {
  const root = fileURLToPath(new URL('.', import.meta.url)), cssPath = fileURLToPath(new URL('../../app/globals.css', import.meta.url));
  const [bundle, styles] = await Promise.all([build({ stdin: { resolveDir: root, loader: 'tsx', contents: `
    import React from'react';import{createRoot}from'react-dom/client';import{CustomerAccountEntry}from'./CustomerAccountEntry';
    import{marqueDeRepli}from'@sm/contracts';import{styleDuMasque}from'../masque/styleDuMasque';
    createRoot(document.getElementById('root')).render(<main style={styleDuMasque(marqueDeRepli(null,null))} className="min-h-dvh bg-bg p-4 text-ink"><h1>Restaurant de recette</h1><CustomerAccountEntry slug="recette" restaurantName="Le Comptoir"/><button>Commander en invité</button></main>);` },
    bundle: true, write: false, outdir: '/virtual-customer-access', format: 'iife', platform: 'browser', jsx: 'automatic', target: 'es2022',
    define: { 'process.env': '{}', 'process.env.NODE_ENV': '"production"' } }),
  readFile(cssPath, 'utf8').then(source => postcss([tailwind({ base: fileURLToPath(new URL('../../..', import.meta.url)) })]).process(source, { from: cssPath }))]);
  js = bundle.outputFiles.find(file => file.path.endsWith('.js'))!.text;
  css = styles.css + (bundle.outputFiles.find(file => file.path.endsWith('.css'))?.text ?? '');
  browser = await chromium.launch({ headless: true });
  if (process.env.QA_CUSTOMER_ACCOUNT_CAPTURE === '1') { capture = await mkdtemp(join(tmpdir(), 'sm-customer-access-')); process.stdout.write(`Customer access captures: ${capture}\n`); }
}, 30_000);
beforeEach(async () => {
  faults = []; steps = []; operationId = ''; attemptId = ''; publicationId = null; browserRef = ''; stage = 'registration_required'; version = 0;
  expiresAt = Date.now() + 300_000; browserExpires = Date.now() + 3_600_000; verifiedAt = Date.now() - 1_000; challenge = opaque(); userId = opaque();
  code = `SM1-${randomBytes(16).toString('hex').toUpperCase().match(/.{4}/g)!.join('-')}`; oldCode = `SM1-${randomBytes(16).toString('hex').toUpperCase().match(/.{4}/g)!.join('-')}`;
  mutations = 0; assertions = 0; closed = 0; loseLogin = false; loseActivation = false; available = true; failed = false;
  heldCode = null; releaseCode = null;
  heldLogin = null; releaseLogin = null; logouts = 0;
  heldLogout = null; releaseLogout = null;
  context = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce', serviceWorkers: 'block' });
  await context.route('**/*', async route => {
    const req = route.request(), url = new URL(req.url());
    if (url.origin !== origin) { faults.push('External request refused'); return route.abort(); }
    if (url.pathname === '/') return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html lang="fr"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Recette locale connexion protégée</title><style>${css}</style><div id="root"></div><script src="/app.js"></script></html>` });
    if (url.pathname === '/app.js') return route.fulfill({ contentType: 'text/javascript', body: js });
    if (url.pathname === '/favicon.ico') return route.fulfill({ status: 204 });
    if (!url.pathname.startsWith('/r/recette/compte/')) { faults.push('Unexpected route'); return route.abort(); }
    const action = url.pathname.split('/').at(-1), body = req.method() === 'GET' ? {} : req.postDataJSON();
    const reply = (json: unknown) => route.fulfill({ json, headers: { 'cache-control': 'private, no-store' } });
    if (action === 'capacites') return reply({ available: false, registrationAvailable: false, accessAvailable: available });
    if (action === 'session') {
      if (req.method() === 'DELETE') { publicationId = null; logouts++; if (heldLogout) await heldLogout; return route.fulfill({ status: 204 }); }
      return publicationId && req.headers()['x-sm-customer-check-id'] === publicationId && req.headers()['x-sm-customer-operation-id'] === operationId
        ? reply(profile()) : route.fulfill({ status: 401, json: { code: 'CUSTOMER_UNAUTHORIZED' } });
    }
    steps.push(`${action}:${body.step ?? ''}`);
    if (action === 'navigateur') { browserRef ||= body.browserRef;
      return reply({ browserRef, state: body.step === 'prepare' ? 'prepared' : body.step === 'issue' ? 'issued' : 'confirmed', admissionExpiresAt: expiresAt, expiresAt: browserExpires }); }
    if (action === 'intention') { operationId = body.operationId; if (body.step === 'close') closed++;
      return reply({ operationId, state: body.step === 'close' ? 'closed' : 'open', expiresAt }); }
    expect(body.operationId).toBe(operationId); attemptId = body.attemptId;
    const options = { challenge, rpId: hostname, timeout: 60_000, userVerification: 'required', allowCredentials: [] };
    if (action === 'cle-acces') {
      if (failed) return reply({ state: 'failed', operationId, attemptId, expiresAt });
      if (body.step === 'options') return reply({ state: 'options', operationId, attemptId, expiresAt, options });
      if (body.step === 'assert') {
        const result = await verifyAuthenticationResponse({ response: body.response, expectedChallenge: challenge, expectedOrigin: origin,
          expectedRPID: hostname, requireUserVerification: true, credential });
        expect(result.verified).toBe(true); expect(body.response.response.userHandle).toBe(userId); assertions++; publicationId = attemptId;
        if (heldLogin) await heldLogin;
        if (loseLogin) { loseLogin = false; return route.abort('failed'); }
      }
      return publicationId ? reply(auth()) : reply({ state: 'unresolved', operationId, attemptId, expiresAt });
    }
    if (action === 'secours') {
      if (body.step === 'begin') expect(body.code).toBe(oldCode);
      if (body.step === 'registration-options') return reply({ state: 'registration-options', recovery: recovery(), registrationId: body.registrationId,
        options: { challenge, rp: { id: hostname, name: 'Restaurant de recette' }, user: { id: userId, name: opaque(), displayName: 'Clé personnelle' },
          pubKeyCredParams: [{ type: 'public-key', alg: -7 }], timeout: 60_000, attestation: 'none', excludeCredentials: [],
          authenticatorSelection: { residentKey: 'required', requireResidentKey: true, userVerification: 'required' }, extensions: { credProps: true } } });
      if (body.step === 'register') {
        const result = await verifyRegistrationResponse({ response: body.response, expectedChallenge: challenge, expectedOrigin: origin,
          expectedRPID: hostname, requireUserVerification: true, supportedAlgorithmIDs: [-7] });
        expect(result.verified).toBe(true); credential = result.registrationInfo!.credential; stage = 'assertion_required'; challenge = opaque();
      }
      if (body.step === 'assertion-options') return reply({ state: 'assertion-options', recovery: recovery(), assertionId: body.assertionId,
        options: { ...options, allowCredentials: [{ id: credential.id, type: 'public-key' }] } });
      if (body.step === 'assert') {
        expect((await verifyAuthenticationResponse({ response: body.response, expectedChallenge: challenge, expectedOrigin: origin,
          expectedRPID: hostname, requireUserVerification: true, credential })).verified).toBe(true); stage = 'recovery_required'; assertions++;
      }
      if (body.step === 'recovery-code') { version++; if (heldCode) await heldCode; return reply({ state: 'recovery-code', recovery: recovery(), code }); }
      if (body.step === 'activate') { expect(body.code).toBe(code); publicationId ??= body.activationId; mutations++;
        if (loseActivation) { loseActivation = false; return route.abort('failed'); } }
      if (body.step === 'activate' || body.step === 'activation-result') return reply(auth());
      return reply({ state: 'recovery', recovery: recovery() });
    }
    faults.push('Unexpected account action'); return route.abort();
  });
  page = await context.newPage(); page.setDefaultTimeout(7_000); page.on('pageerror', error => faults.push(error.name));
  const cdp = await context.newCDPSession(page); await cdp.send('WebAuthn.enable');
  await cdp.send('WebAuthn.addVirtualAuthenticator', { options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true,
    hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true } });
  await page.goto(origin);
  // Fixture provision: an existing account's resident key, not an enrollment UI
  // shortcut. The actual login below uses discovery and verifies its signature.
  const registration = await page.evaluate(async ({ challenge, userId, hostname }) => {
    const bytes = (v: string) => Uint8Array.from(atob(v.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
    const encode = (v: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(v))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const key = await navigator.credentials.create({ publicKey: { challenge: bytes(challenge), rp: { id: hostname, name: 'Local fixture' },
      user: { id: bytes(userId), name: 'opaque', displayName: 'opaque' }, pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
      authenticatorSelection: { residentKey: 'required', userVerification: 'required' }, attestation: 'none' } }) as PublicKeyCredential;
    const response = key.response as AuthenticatorAttestationResponse;
    return { id: key.id, rawId: encode(key.rawId), type: 'public-key' as const, clientExtensionResults: key.getClientExtensionResults(),
      response: { clientDataJSON: encode(response.clientDataJSON), attestationObject: encode(response.attestationObject) } };
  }, { challenge, userId, hostname });
  const checked = await verifyRegistrationResponse({ response: registration, expectedChallenge: challenge, expectedOrigin: origin,
    expectedRPID: hostname, requireUserVerification: true, supportedAlgorithmIDs: [-7] });
  credential = checked.registrationInfo!.credential; challenge = opaque();
  await page.getByRole('button', { name: 'Mon compte', exact: true }).click();
});
afterEach(async () => { try { await context?.close(); } finally { expect(faults).toEqual([]); } });
afterAll(async () => { await browser?.close(); });
async function journal() { return page.evaluate(async () => new Promise<unknown>((resolve, reject) => {
  const request = indexedDB.open('sm-customer-preparation-v1'); request.onerror = () => reject(new Error('Journal unavailable'));
  request.onsuccess = () => { const db = request.result, tx = db.transaction('preparations');
    const read = tx.objectStore('preparations').get('recette'); read.onsuccess = () => resolve(read.result); tx.oncomplete = () => db.close(); };
})); }
async function toNewCode() {
  await page.getByRole('button', { name: 'Utiliser mon code de secours', exact: true }).click();
  await page.getByLabel('Votre code de secours', { exact: true }).fill(oldCode);
  await page.getByRole('button', { name: 'Vérifier mon code de secours', exact: true }).click();
  await page.getByRole('heading', { name: 'Créer une nouvelle clé d’accès', exact: true }).waitFor();
  expect(await page.getByRole('heading', { name: 'Votre profil', exact: true }).count()).toBe(0);
  if (capture) await page.screenshot({ path: join(capture, 'recovery-key-390.png') });
  await page.getByRole('button', { name: 'Créer ma nouvelle clé', exact: true }).click();
  await page.getByRole('button', { name: 'Vérifier ma nouvelle clé', exact: true }).click();
  await page.getByRole('button', { name: 'Afficher mon nouveau secours', exact: true }).waitFor();
}
describe('customer credential access — native rendered browser', () => {
  it('signs in using a real discoverable key while all SMS capabilities are closed', async () => {
    await page.getByRole('button', { name: 'Se connecter avec une clé d’accès', exact: true }).click();
    await page.getByRole('heading', { name: 'Votre profil', exact: true }).waitFor(); expect(assertions).toBe(1);
    expect(steps.some(step => /verification|confirmation|resultat|protection/.test(step))).toBe(false);
    expect(await journal()).toMatchObject({ access: { method: 'passkey', phase: 'completed', attemptId: publicationId } });
  });
  it('reloads after a lost login response and recovers its receipt without another assertion', async () => {
    loseLogin = true; await page.getByRole('button', { name: 'Se connecter avec une clé d’accès', exact: true }).click();
    await page.getByText('Cette connexion n’est pas confirmée.', { exact: false }).waitFor(); const selected = attemptId;
    await page.reload(); await page.getByRole('button', { name: 'Mon compte', exact: true }).click();
    await page.getByRole('button', { name: 'Vérifier la démarche en cours', exact: true }).click();
    await page.getByRole('heading', { name: 'Votre profil', exact: true }).waitFor(); expect(attemptId).toBe(selected); expect(assertions).toBe(1);
  });
  it('requires a new native key, possession and saved new code before recovery publication', async () => {
    await toNewCode(); expect(mutations).toBe(0); expect(publicationId).toBeNull();
    await page.getByRole('button', { name: 'Afficher mon nouveau secours', exact: true }).click();
    await expect.poll(() => page.getByLabel('Nouveau code de secours personnel', { exact: true }).textContent()).toBe(code);
    await page.getByRole('button', { name: 'Je l’ai conservé, masquer le code', exact: true }).click();
    await page.getByLabel('Ressaisissez le nouveau code de secours', { exact: true }).fill(code);
    await page.getByRole('button', { name: 'Confirmer et retrouver mon compte', exact: true }).click();
    await page.getByRole('heading', { name: 'Votre profil', exact: true }).waitFor(); expect(mutations).toBe(1);
    expect(await journal()).toMatchObject({ access: { method: 'recovery', phase: 'completed', protection: { activationId: publicationId } } });
    const serialized = JSON.stringify(await journal());
    for (const value of [oldCode, code, '+33600000000', 'clientDataJSON', 'attestationObject', 'signature', 'options', 'token']) expect(serialized.includes(value)).toBe(false);
  }, 25_000);
  it('recovers a lost final response without resending or burning another code', async () => {
    await toNewCode(); await page.getByRole('button', { name: 'Afficher mon nouveau secours', exact: true }).click();
    await page.getByRole('button', { name: 'Je l’ai conservé, masquer le code', exact: true }).click();
    await page.getByLabel('Ressaisissez le nouveau code de secours', { exact: true }).fill(code); loseActivation = true;
    await page.getByRole('button', { name: 'Confirmer et retrouver mon compte', exact: true }).click();
    await page.getByText('Cette connexion n’est pas confirmée.', { exact: false }).waitFor(); const selected = publicationId;
    await page.getByRole('button', { name: 'Vérifier la confirmation', exact: true }).click();
    await page.getByRole('heading', { name: 'Votre profil', exact: true }).waitFor(); expect(publicationId).toBe(selected); expect(mutations).toBe(1);
  }, 25_000);
  it('pauses on dismissal, wipes the code and does not close or rotate automatically', async () => {
    await toNewCode(); await page.getByRole('button', { name: 'Afficher mon nouveau secours', exact: true }).click();
    await page.getByLabel('Nouveau code de secours personnel', { exact: true }).waitFor(); const before = steps.length;
    await page.keyboard.press('Escape'); await page.getByRole('button', { name: 'Mon compte', exact: true }).click();
    await page.getByRole('heading', { name: 'Conserver mon nouveau secours', exact: true }).waitFor();
    expect(await page.getByLabel('Nouveau code de secours personnel', { exact: true }).count()).toBe(0);
    expect(await page.getByLabel('Ressaisissez le nouveau code de secours', { exact: true }).inputValue()).toBe('');
    expect(steps.slice(before)).toEqual([]); expect(mutations).toBe(0); expect(closed).toBe(0);
  }, 25_000);
  it('a failed receipt offers an explicit new attempt, never an automatic loop', async () => {
    failed = true; await page.getByRole('button', { name: 'Se connecter avec une clé d’accès', exact: true }).click();
    await page.getByRole('heading', { name: 'Connexion refusée', exact: true }).waitFor(); const old = attemptId, count = steps.length;
    expect(assertions).toBe(0); failed = false;
    await page.getByRole('button', { name: 'Préparer une nouvelle tentative', exact: true }).click(); expect(steps).toHaveLength(count);
    await page.getByRole('button', { name: 'Utiliser ma clé d’accès', exact: true }).click();
    await page.getByRole('heading', { name: 'Votre profil', exact: true }).waitFor(); expect(attemptId).not.toBe(old);
  });
  it('remains a storage-free guest without access capability', async () => {
    available = false; await page.reload(); await page.getByRole('button', { name: 'Mon compte', exact: true }).click();
    await page.getByText('La connexion et la création de compte sont indisponibles pour le moment.', { exact: true }).waitFor();
    expect(await page.getByRole('button', { name: 'Se connecter avec une clé d’accès', exact: true }).count()).toBe(0);
    expect(await page.evaluate(async () => (await indexedDB.databases()).length)).toBe(0); expect(steps).toEqual([]);
  });
  it('blocks before any POST when the public journal cannot be stored', async () => {
    await page.addInitScript(() => { IDBFactory.prototype.open = () => { throw new DOMException('Unavailable', 'SecurityError'); }; });
    await page.reload(); await page.getByRole('button', { name: 'Mon compte', exact: true }).click();
    await page.getByText('Le journal de cet accès est indisponible.', { exact: false }).waitFor();
    expect(await page.getByRole('button', { name: 'Se connecter avec une clé d’accès', exact: true }).isDisabled()).toBe(true);
    expect(steps).toEqual([]);
  });
  it('never displays a late secret after going offline during the response', async () => {
    await toNewCode(); heldCode = new Promise(resolve => { releaseCode = resolve; });
    await page.getByRole('button', { name: 'Afficher mon nouveau secours', exact: true }).click();
    await expect.poll(() => version).toBe(1);
    await page.evaluate(() => { Object.defineProperty(navigator, 'onLine', { configurable: true, value: false }); window.dispatchEvent(new Event('offline')); });
    releaseCode!(); await page.getByText('La démarche est en pause.', { exact: false }).waitFor();
    expect(await page.getByLabel('Nouveau code de secours personnel', { exact: true }).count()).toBe(0);
    expect(await page.locator('body').textContent()).not.toContain(code);
    expect(mutations).toBe(0);
  }, 25_000);
  it('offers a genuine new login after logout without erasing or adopting the old receipt', async ({ onTestFailed }) => {
    const startedAt = performance.now();
    let phase = 'first login';
    onTestFailed(() => {
      // Only fixed stage names and counters: no credential, code, ID or profile.
      console.error('Customer login round trip did not complete', {
        phase, elapsedMs: Math.round(performance.now() - startedAt), assertions, logouts,
      });
    });
    await page.getByRole('button', { name: 'Se connecter avec une clé d’accès', exact: true }).click();
    await page.getByRole('heading', { name: 'Votre profil', exact: true }).waitFor(); const prior = publicationId;
    phase = 'logout confirmation';
    await page.getByRole('button', { name: 'Déconnecter cet appareil', exact: true }).click();
    await page.getByRole('button', { name: 'Confirmer la déconnexion', exact: true }).click();
    phase = 'login control available within 1500ms';
    await expect.poll(() => page.getByRole('button', { name: 'Se connecter avec une clé d’accès', exact: true }).isEnabled(), { timeout: 1_500 }).toBe(true);
    phase = 'second login';
    await page.getByRole('button', { name: 'Se connecter avec une clé d’accès', exact: true }).click();
    await page.getByRole('heading', { name: 'Votre profil', exact: true }).waitFor();
    phase = 'new publication and exact operation counts';
    expect(publicationId).not.toBe(prior); expect(assertions).toBe(2); expect(logouts).toBe(1);
  });
  it('keeps credential entry closed until the pending logout has finished', async () => {
    await page.getByRole('button', { name: 'Se connecter avec une clé d’accès', exact: true }).click();
    await page.getByRole('heading', { name: 'Votre profil', exact: true }).waitFor();
    const prior = publicationId, savedJournal = await journal(), sent = [...steps];
    heldLogout = new Promise(resolve => { releaseLogout = resolve; });
    await page.getByRole('button', { name: 'Déconnecter cet appareil', exact: true }).click();
    await page.getByRole('button', { name: 'Confirmer la déconnexion', exact: true }).click();
    try {
      // The real client still owns its Web Lock: DELETE reached the fixture,
      // but its response and final cross-tab invalidation have not completed.
      await expect.poll(() => logouts).toBe(1);
      await page.getByText('Vérification de votre session…', { exact: true }).waitFor();
      expect(await page.getByRole('heading', { name: 'Votre profil', exact: true }).count()).toBe(0);
      expect(await page.getByRole('button', { name: 'Se connecter avec une clé d’accès', exact: true }).count()).toBe(0);
      expect(await page.getByRole('button', { name: 'Utiliser mon code de secours', exact: true }).count()).toBe(0);
      expect(await page.getByRole('button', { name: 'Revenir au menu', exact: true }).isDisabled()).toBe(true);
      expect(await journal()).toEqual(savedJournal); expect(steps).toEqual(sent); expect(assertions).toBe(1);
      if (capture) await page.screenshot({ path: join(capture, 'logout-pending-390.png') });
    } finally { releaseLogout!(); }
    await expect.poll(() => page.getByRole('button', { name: 'Se connecter avec une clé d’accès', exact: true }).isEnabled(), { timeout: 1_500 }).toBe(true);
    await page.getByRole('button', { name: 'Se connecter avec une clé d’accès', exact: true }).click();
    await page.getByRole('heading', { name: 'Votre profil', exact: true }).waitFor();
    expect(publicationId).not.toBe(prior); expect(assertions).toBe(2); expect(logouts).toBe(1);
    if (capture) await page.screenshot({ path: join(capture, 'login-after-logout-390.png') });
  }, 25_000);
  it('shares the real Web Lock between tabs; a pending assertion cannot be bypassed by another result action', async () => {
    heldLogin = new Promise(resolve => { releaseLogin = resolve; });
    await page.getByRole('button', { name: 'Se connecter avec une clé d’accès', exact: true }).click();
    await expect.poll(() => assertions).toBe(1);
    const other = await context.newPage(); other.on('pageerror', error => faults.push(error.name));
    await other.goto(origin); await other.getByRole('button', { name: 'Mon compte', exact: true }).click();
    await other.getByRole('heading', { name: 'Vérifier ma connexion', exact: true }).waitFor();
    expect(await other.getByRole('button', { name: 'Se connecter avec une clé d’accès', exact: true }).count()).toBe(0);
    await other.getByRole('button', { name: 'Vérifier la démarche en cours', exact: true }).click();
    await expect.poll(() => other.evaluate(async () => (await navigator.locks.query()).pending?.some(lock => lock.name === 'sm:customer:recette'))).toBe(true);
    expect(steps.filter(step => step === 'cle-acces:result')).toHaveLength(0);
    releaseLogin!(); await expect.poll(async () => (await journal() as { access: { phase: string } }).access.phase).toBe('completed');
    expect(assertions).toBe(1); await other.close();
  });
  it.each([320, 390, 1440])('keeps branded controls readable, keyboard reachable and reduced motion at %ipx', async width => {
    await page.setViewportSize({ width, height: 900 });
    const button = page.getByRole('button', { name: 'Se connecter avec une clé d’accès', exact: true }); await button.waitFor();
    await button.focus(); expect(await button.evaluate(node => node === document.activeElement)).toBe(true);
    const rect = await button.boundingBox(); expect(rect!.height).toBeGreaterThanOrEqual(44); expect(rect!.x).toBeGreaterThanOrEqual(0); expect(rect!.x + rect!.width).toBeLessThanOrEqual(width);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    let unsafe = false;
    await expect.poll(async () => {
      const animations = await page.evaluate(() => document.getAnimations().filter(a => a.playState === 'running').map(a => ({ timing: a.effect!.getTiming(), rate: a.playbackRate })));
      unsafe ||= animations.some(a => a.rate !== 1 || Number(a.timing.duration) > 1 || (a.timing.iterations ?? 1) > 1);
      return animations.length;
    }, { timeout: 500 }).toBe(0); expect(unsafe).toBe(false);
    expect(await page.title()).toBe('Recette locale connexion protégée');
    expect(await page.locator('nextjs-portal').count()).toBe(0);
    if (capture) await page.screenshot({ path: join(capture, `access-${width}.png`) });
    await page.keyboard.press('Escape'); await expect.poll(() => page.getByRole('button', { name: 'Mon compte', exact: true }).evaluate(node => node === document.activeElement)).toBe(true);
  });
});
