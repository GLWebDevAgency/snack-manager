import { randomBytes, randomUUID } from 'node:crypto';
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

// Real Entry/Sheet/controllers/IndexedDB/Web Locks/browser WebAuthn with an
// isolated HTTP protocol fixture. No Next server, BFF, SQL, SMS or real human
// verification is claimed. The server library verifies native signatures.
const origin = 'https://account-fixture.example.test', hostname = new URL(origin).hostname;
const opaque = () => randomBytes(32).toString('base64url');
type Credential = NonNullable<Awaited<ReturnType<typeof verifyRegistrationResponse>>['registrationInfo']>['credential'];
let browser: Browser, context: BrowserContext, page: Page, js: string, css: string, capture: string | undefined;
let faults: string[], steps: string[], operationId: string, checkId: string, activationId: string | null, browserRef: string,
  challengeId: string, expiresAt: number, browserExpires: number, stage: string, recoveryVersion: number, recoveryCode: string,
  challenge: string, userId: string, credential: Credential | null, sms: number, activated: number, loseActivation: boolean, registrationAvailable: boolean;
let smsAvailable: boolean, heldCode: Promise<void> | null, releaseCode: (() => void) | null;
const profile = () => ({ expiresAt: browserExpires, profile: { name: null, phoneE164: '+33600000000', phoneVerifiedAt: Date.now() - 1_000, revision: 0 } });
const enrollment = () => ({ operationId, checkId, expiresAt, stage, recoveryVersion });
beforeAll(async () => {
  const root = fileURLToPath(new URL('.', import.meta.url));
  const cssPath = fileURLToPath(new URL('../../app/globals.css', import.meta.url));
  const [bundle, styles] = await Promise.all([build({ stdin: { resolveDir: root, loader: 'tsx', contents: `
    import React from'react';import{createRoot}from'react-dom/client';import{CustomerAccountEntry}from'./CustomerAccountEntry';
    import{marqueDeRepli}from'@sm/contracts';import{styleDuMasque}from'../masque/styleDuMasque';
    createRoot(document.getElementById('root')).render(<main style={styleDuMasque(marqueDeRepli(null,null))} className="min-h-dvh bg-bg p-4 text-ink"><h1>Restaurant de recette</h1><CustomerAccountEntry slug="recette" restaurantName="Le Comptoir"/><button>Commander en invité</button></main>);` },
    bundle: true, write: false, outdir: '/virtual-customer-enrollment', format: 'iife', platform: 'browser', jsx: 'automatic', target: 'es2022',
    define: { 'process.env': '{}', 'process.env.NODE_ENV': '"production"', 'process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY': '"fixture-only"' },
    plugins: [{ name: 'isolated-human-widget', setup(builder) {
      builder.onResolve({ filter: /^next\/script$/ }, () => ({ path: 'script', namespace: 'fixture' }));
      builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ resolveDir: root, contents: `import{useEffect}from'react';
        window.turnstile={render:(_node,options)=>{window.humanBinding={action:options.action,cData:options.cData};queueMicrotask(()=>options.callback('fixture-human-proof'));return'fixture'},remove:()=>{}};
        export default function Script({onReady}){useEffect(()=>{onReady?.()},[]);return null}` }));
    } }] }), readFile(cssPath, 'utf8').then(source => postcss([tailwind({ base: fileURLToPath(new URL('../../..', import.meta.url)) })]).process(source, { from: cssPath }))]);
  js = bundle.outputFiles.find(file => file.path.endsWith('.js'))!.text;
  css = styles.css + (bundle.outputFiles.find(file => file.path.endsWith('.css'))?.text ?? '');
  browser = await chromium.launch({ headless: true });
  if (process.env.QA_CUSTOMER_ACCOUNT_CAPTURE === '1') { capture = await mkdtemp(join(tmpdir(), 'sm-customer-enrollment-')); process.stdout.write(`Protected enrollment UI captures: ${capture}\n`); }
}, 30_000);
beforeEach(async () => {
  faults = []; steps = []; operationId = ''; checkId = ''; activationId = null; browserRef = ''; challengeId = randomUUID();
  expiresAt = Date.now() + 300_000; browserExpires = Date.now() + 3_600_000; stage = 'registration_required'; recoveryVersion = 0;
  recoveryCode = `SM1-${randomBytes(16).toString('hex').toUpperCase().match(/.{4}/g)!.join('-')}`;
  challenge = opaque(); userId = opaque(); credential = null; sms = 0; activated = 0; loseActivation = false; registrationAvailable = true;
  smsAvailable = true; heldCode = null; releaseCode = null;
  context = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce', serviceWorkers: 'block' });
  await context.route('**/*', async route => {
    const req = route.request(), url = new URL(req.url());
    if (url.origin !== origin) { faults.push('External request refused'); return route.abort(); }
    if (url.pathname === '/') return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html lang="fr"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Recette locale compte protégé</title><style>${css}</style><div id="root"></div><script src="/app.js"></script></html>` });
    if (url.pathname === '/app.js') return route.fulfill({ contentType: 'text/javascript', body: js });
    if (url.pathname === '/favicon.ico') return route.fulfill({ status: 204 });
    const action = url.pathname.split('/').at(-1);
    if (!url.pathname.startsWith('/r/recette/compte/')) { faults.push('Unexpected local request'); return route.abort(); }
    const body = req.method() === 'GET' ? {} : req.postDataJSON();
    const reply = (json: unknown) => route.fulfill({ json, headers: { 'cache-control': 'private, no-store' } });
    if (action === 'capacites') return reply({ available: smsAvailable, registrationAvailable, accessAvailable: false });
    if (action === 'session') return activationId && req.headers()['x-sm-customer-check-id'] === activationId
      ? reply(profile()) : route.fulfill({ status: 401, json: { code: 'CUSTOMER_UNAUTHORIZED' } });
    steps.push(`${action}:${body.step ?? ''}`);
    if (action === 'navigateur') {
      if (body.step === 'restore') return route.fulfill({ status: 401, json: { code: 'CUSTOMER_UNAUTHORIZED' } });
      browserRef ||= body.browserRef;
      return reply({ browserRef, state: body.step === 'prepare' ? 'prepared' : body.step === 'issue' ? 'issued' : 'confirmed', admissionExpiresAt: expiresAt, expiresAt: browserExpires }); }
    if (action === 'intention') { operationId ||= body.operationId; return reply({ operationId, state: body.step === 'close' ? 'closed' : 'open', expiresAt }); }
    if (action === 'verification') { sms++; expect(body.turnstileToken).toBe('fixture-human-proof'); return reply({ challengeId, expiresAt }); }
    if (action === 'confirmation') { checkId = body.checkId; return reply({ state: 'enrollment', enrollment: enrollment() }); }
    if (action === 'resultat') return reply({ state: 'enrollment', operationId, checkId, challengeId, expiresAt, enrollment: enrollment() });
    if (action === 'protection') {
      expect(body.operationId).toBe(operationId); expect(body.checkId).toBe(checkId);
      if (body.step === 'registration-options') return reply({ state: 'registration-options', enrollment: enrollment(), registrationId: body.registrationId,
        options: { challenge, rp: { id: hostname, name: 'Restaurant de recette' }, user: { id: userId, name: opaque(), displayName: 'Clé personnelle' },
          pubKeyCredParams: [{ type: 'public-key', alg: -7 }], timeout: 60_000, attestation: 'none', excludeCredentials: [],
          authenticatorSelection: { residentKey: 'required', requireResidentKey: true, userVerification: 'required' }, extensions: { credProps: true } } });
      if (body.step === 'register') {
        const verified = await verifyRegistrationResponse({ response: body.response, expectedChallenge: challenge, expectedOrigin: origin,
          expectedRPID: hostname, requireUserVerification: true, supportedAlgorithmIDs: [-7] });
        expect(verified.verified).toBe(true); credential = verified.registrationInfo!.credential; stage = 'assertion_required'; challenge = opaque();
      }
      if (body.step === 'assertion-options') return reply({ state: 'assertion-options', enrollment: enrollment(), assertionId: body.assertionId,
        options: { challenge, rpId: hostname, timeout: 60_000, userVerification: 'required', allowCredentials: [{ id: credential!.id, type: 'public-key' }] } });
      if (body.step === 'assert') {
        expect((await verifyAuthenticationResponse({ response: body.response, expectedChallenge: challenge, expectedOrigin: origin,
          expectedRPID: hostname, requireUserVerification: true, credential: credential! })).verified).toBe(true); stage = 'recovery_required';
      }
      if (body.step === 'recovery-code') { recoveryVersion++; if (heldCode) await heldCode; return reply({ state: 'recovery-code', enrollment: enrollment(), code: recoveryCode }); }
      if (body.step === 'activate') { expect(body.code).toBe(recoveryCode); activationId ??= body.activationId; activated++;
        if (loseActivation) { loseActivation = false; return route.abort('failed'); } }
      if (body.step === 'activate' || body.step === 'activation-result') return reply({ state: 'authenticated', operationId, activationId, view: profile() });
      return reply({ state: 'enrollment', enrollment: enrollment() });
    }
    faults.push('Unexpected account action'); return route.abort();
  });
  page = await context.newPage(); page.setDefaultTimeout(7_000); page.on('pageerror', error => faults.push(error.name));
  const cdp = await context.newCDPSession(page); await cdp.send('WebAuthn.enable');
  await cdp.send('WebAuthn.addVirtualAuthenticator', { options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true,
    hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true } });
  await page.goto(origin); await page.getByRole('button', { name: 'Mon compte', exact: true }).click();
});
afterEach(async () => { try { await context?.close(); } finally { expect(faults).toEqual([]); } });
afterAll(async () => { await browser?.close(); });
async function toRecovery() {
  await page.getByRole('button', { name: 'Commencer mon inscription', exact: true }).click();
  await page.getByLabel('Numéro de mobile', { exact: true }).fill('0600000000');
  await page.getByRole('button', { name: 'Envoyer mon code SMS', exact: true }).click();
  await page.getByLabel('Code SMS à six chiffres', { exact: true }).waitFor();
  if (capture) await page.screenshot({ path: join(capture, 'otp-empty-390.png') });
  await page.getByLabel('Code SMS à six chiffres', { exact: true }).fill('123456');
  await page.getByRole('button', { name: 'Vérifier mon téléphone', exact: true }).click();
  if (capture) { await page.getByRole('button', { name: 'Créer ma clé d’accès', exact: true }).waitFor(); await page.screenshot({ path: join(capture, 'key-required-390.png') }); }
  await page.getByRole('button', { name: 'Créer ma clé d’accès', exact: true }).click();
  await page.getByRole('button', { name: 'Utiliser ma clé d’accès', exact: true }).click();
  await page.getByRole('button', { name: 'Afficher mon code de secours', exact: true }).waitFor();
}
describe('protected customer enrollment — rendered native browser', () => {
  it('uses actual native keys and activates only after the recovery code is re-entered', async () => {
    expect(sms).toBe(0); await toRecovery(); expect(sms).toBe(1); expect(activated).toBe(0);
    await page.getByRole('button', { name: 'Afficher mon code de secours', exact: true }).click();
    await expect.poll(() => page.getByLabel('Code de secours personnel', { exact: true }).textContent()).toBe(recoveryCode);
    await page.getByRole('button', { name: 'Je l’ai conservé, masquer le code', exact: true }).click();
    await page.getByLabel('Ressaisissez votre code de secours', { exact: true }).fill(recoveryCode);
    await page.getByRole('button', { name: 'Activer mon compte protégé', exact: true }).click();
    await page.getByRole('heading', { name: 'Votre profil', exact: true }).waitFor(); expect(activated).toBe(1);
    const journal = await page.evaluate(async () => new Promise<unknown>((resolve, reject) => {
      const req = indexedDB.open('sm-customer-preparation-v1'); req.onerror = () => reject(new Error('Journal unavailable'));
      req.onsuccess = () => { const db = req.result, tx = db.transaction('preparations'); const read = tx.objectStore('preparations').get('recette');
        read.onsuccess = () => resolve(read.result); tx.oncomplete = () => db.close(); };
    }));
    const serialized = JSON.stringify(journal); for (const value of [recoveryCode, '+33600000000', '123456', 'attestationObject', 'signature', 'fixture-human-proof']) expect(serialized.includes(value)).toBe(false);
    expect(journal).toMatchObject({ verification: { phase: 'completed', checkId, protection: { activationId } } });
  }, 25_000);
  it('lost activation response resumes the exact publication without sending the secret again', async () => {
    await toRecovery(); await page.getByRole('button', { name: 'Afficher mon code de secours', exact: true }).click();
    await page.getByRole('button', { name: 'Je l’ai conservé, masquer le code', exact: true }).click();
    await page.getByLabel('Ressaisissez votre code de secours', { exact: true }).fill(recoveryCode); loseActivation = true;
    await page.getByRole('button', { name: 'Activer mon compte protégé', exact: true }).click();
    await page.getByText(/Cette étape n’est pas confirmée/).waitFor();
    await page.getByRole('button', { name: 'Vérifier l’étape en cours', exact: true }).click();
    await page.getByRole('heading', { name: 'Votre profil', exact: true }).waitFor();
    expect(activated).toBe(1); expect(steps.filter(step => step === 'protection:activation-result')).toHaveLength(1);
  }, 25_000);
  it('pauses on panel close, clears a displayed recovery code, and never closes or rotates automatically', async () => {
    await toRecovery(); await page.getByRole('button', { name: 'Afficher mon code de secours', exact: true }).click();
    await page.getByLabel('Code de secours personnel', { exact: true }).waitFor(); const before = steps.length;
    await page.getByRole('button', { name: 'Revenir au menu', exact: true }).click();
    await page.getByRole('button', { name: 'Mon compte', exact: true }).click();
    await page.getByRole('heading', { name: 'Votre code de secours', exact: true }).waitFor();
    expect(await page.getByLabel('Code de secours personnel', { exact: true }).count()).toBe(0);
    expect(steps.slice(before)).toEqual([]); expect(activated).toBe(0);
  }, 25_000);
  it('does not expose signup or mutate any journal while the server capability is closed', async () => {
    registrationAvailable = false; smsAvailable = false; await page.reload();
    await page.getByRole('button', { name: 'Mon compte', exact: true }).click();
    await page.getByText('La création et la connexion au compte ne sont pas encore ouvertes.', { exact: true }).waitFor();
    expect(await page.getByRole('button', { name: 'Commencer mon inscription', exact: true }).count()).toBe(0);
    expect(await page.evaluate(async () => (await indexedDB.databases()).length)).toBe(0); expect(sms).toBe(0); expect(steps).toEqual([]);
  });
  it('keeps a prepared enrollment usable but does not send when SMS admission is closed', async () => {
    smsAvailable = false; await page.reload(); await page.getByRole('button', { name: 'Mon compte', exact: true }).click();
    await page.getByRole('button', { name: 'Commencer mon inscription', exact: true }).click();
    await page.getByLabel('Numéro de mobile', { exact: true }).fill('0600000000');
    expect(await page.getByRole('button', { name: 'Envoyer mon code SMS', exact: true }).isDisabled()).toBe(true);
    await page.getByText('L’envoi de SMS n’est pas disponible.', { exact: false }).waitFor(); expect(sms).toBe(0);
  });
  it('explicit device resumption without a cookie keeps signup possible and never fabricates a journal or session', async () => {
    await page.getByRole('button', { name: 'Reprendre sur cet appareil', exact: true }).click();
    await page.getByText(/Cet appareil n’a pas pu être repris/).waitFor();
    expect(await page.evaluate(async () => (await indexedDB.databases()).length)).toBe(0);
    expect(await page.getByRole('button', { name: 'Commencer mon inscription', exact: true }).isEnabled()).toBe(true);
    await page.getByRole('button', { name: 'Commencer mon inscription', exact: true }).click();
    await page.getByLabel('Numéro de mobile', { exact: true }).waitFor(); expect(sms).toBe(0); expect(activated).toBe(0);
  });
  it('discards a recovery-code response received after going offline, including after returning online', async () => {
    await toRecovery(); heldCode = new Promise(resolve => { releaseCode = resolve; });
    await page.getByRole('button', { name: 'Afficher mon code de secours', exact: true }).click();
    await expect.poll(() => steps.includes('protection:recovery-code')).toBe(true);
    await context.setOffline(true); releaseCode!();
    await page.getByText(/La démarche est en pause/).waitFor();
    expect(await page.getByLabel('Code de secours personnel', { exact: true }).count()).toBe(0);
    await context.setOffline(false); await page.getByRole('button', { name: 'Vérifier l’étape en cours', exact: true }).waitFor();
    expect(await page.getByLabel('Code de secours personnel', { exact: true }).count()).toBe(0);
    expect(steps.filter(step => step === 'protection:recovery-code')).toHaveLength(1);
  }, 25_000);
  it('another tab’s explicit resumption clears the displayed secret without sharing it', async () => {
    await toRecovery(); await page.getByRole('button', { name: 'Afficher mon code de secours', exact: true }).click();
    await page.getByLabel('Code de secours personnel', { exact: true }).waitFor();
    const second = await context.newPage(); await second.goto(origin);
    await second.getByRole('button', { name: 'Mon compte', exact: true }).click();
    await second.getByRole('button', { name: 'Vérifier l’étape en cours', exact: true }).click();
    await expect.poll(() => page.getByLabel('Code de secours personnel', { exact: true }).count()).toBe(0);
    expect(await second.getByLabel('Code de secours personnel', { exact: true }).count()).toBe(0);
    const storage = await page.evaluate(() => JSON.stringify({ ...localStorage })); expect(storage.includes(recoveryCode)).toBe(false);
    expect(steps.filter(step => step === 'protection:recovery-code')).toHaveLength(1);
  }, 25_000);
  it.each([320, 390, 1440])('keeps a sober, keyboard-accessible %ipx entry without automatic sends', async width => {
    await page.setViewportSize({ width, height: 900 });
    await page.getByRole('button', { name: 'Commencer mon inscription', exact: true }).waitFor();
    const geometry = await page.getByRole('dialog').evaluate(node => ({ width: node.getBoundingClientRect().width, overflow: document.documentElement.scrollWidth > innerWidth }));
    expect(geometry.width).toBeLessThanOrEqual(width); expect(geometry.overflow).toBe(false); expect(sms).toBe(0); expect(steps).toEqual([]);
    const target = await page.getByRole('button', { name: 'Commencer mon inscription', exact: true }).boundingBox();
    expect(target!.height).toBeGreaterThanOrEqual(44);
    // A tiny CSS transition may wait for its next frame. Persistent, repeated
    // or slowed motion must fail immediately, not merely settle eventually.
    expect(await page.evaluate(() => document.getAnimations().filter(animation => {
      const timing = animation.effect?.getTiming();
      return timing && (Number(timing.duration) > 1 || (timing.iterations ?? 1) > 1 || animation.playbackRate !== 1);
    }).length)).toBe(0);
    await expect.poll(() => page.evaluate(() => document.getAnimations().filter(animation => animation.playState === 'running').length), { timeout: 500 }).toBe(0);
    if (capture) await page.screenshot({ path: join(capture, `enrollment-${width}.png`) });
    await page.keyboard.press('Escape'); await expect.poll(() => page.getByRole('dialog').count()).toBe(0);
    expect(await page.getByRole('button', { name: 'Mon compte', exact: true }).evaluate(node => document.activeElement === node)).toBe(true);
  });
});
