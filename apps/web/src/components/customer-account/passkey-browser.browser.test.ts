import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { chromium, type Browser, type BrowserContext, type Page, type CDPSession } from 'playwright';
import { verifyAuthenticationResponse, verifyRegistrationResponse } from '@simplewebauthn/server';
import type { PublicKeyCredentialCreationOptionsJSON, PublicKeyCredentialRequestOptionsJSON } from '@simplewebauthn/browser';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { CustomerPasskeyOutcome, customerPasskeyBrowser } from './passkey-browser';

type FixtureWindow = Window & { customerKey: ReturnType<typeof customerPasskeyBrowser>; result?: CustomerPasskeyOutcome };
const origin = 'https://customer-key.example.test';
const rpId = new URL(origin).hostname;
const opaque = () => randomBytes(32).toString('base64url');
function registration(): PublicKeyCredentialCreationOptionsJSON {
  return { challenge: opaque(), rp: { id: rpId, name: 'Restaurant de recette' },
    user: { id: opaque(), name: opaque(), displayName: 'Clé personnelle' },
    pubKeyCredParams: [{ type: 'public-key', alg: -7 }], timeout: 60_000, attestation: 'none',
    authenticatorSelection: { residentKey: 'required', requireResidentKey: true, userVerification: 'required' } };
}
let browser: Browser, context: BrowserContext, page: Page, cdp: CDPSession, authenticatorId: string, bundle: string;
let faults: string[];
beforeAll(async () => {
  const output = await build({ stdin: { contents: `import{customerPasskeyBrowser}from'./passkey-browser';
    window.customerKey=customerPasskeyBrowser(()=>document.visibilityState!=='hidden'&&navigator.onLine);
    document.querySelector('button').onclick=()=>window.customerKey.cancel();`,
    resolveDir: fileURLToPath(new URL('.', import.meta.url)), loader: 'ts' },
    bundle: true, write: false, format: 'iife', platform: 'browser', target: 'es2022' });
  bundle = output.outputFiles[0]!.text; browser = await chromium.launch({ headless: true });
});
beforeEach(async () => {
  faults = []; context = await browser.newContext({ serviceWorkers: 'block' });
  await context.route('**/*', route => route.request().url() === `${origin}/` && route.request().method() === 'GET'
    ? route.fulfill({ contentType: 'text/html', body: '<!doctype html><html lang="fr"><title>Clé — recette isolée</title><button>Annuler la cérémonie</button></html>' })
    : (faults.push('Unexpected request blocked'), route.abort()));
  page = await context.newPage(); page.on('pageerror', error => faults.push(error.name));
  await page.goto(origin); await page.addScriptTag({ content: bundle });
  cdp = await context.newCDPSession(page); await cdp.send('WebAuthn.enable');
  ({ authenticatorId } = await cdp.send('WebAuthn.addVirtualAuthenticator', { options: {
    protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true,
    isUserVerified: true, automaticPresenceSimulation: true,
  } }));
});
afterEach(async () => { try { await context?.close(); } finally { expect(faults).toEqual([]); } });
afterAll(async () => { await browser?.close(); });

/** Native Chromium + actual browser/server library signatures. No BFF, account,
 * provider, hardware assertion or persistent credential is claimed here. */
describe('customer key — actual browser ceremony', () => {
  it('creates a resident key then verifies a distinct UV assertion without storage', async () => {
    const input = registration();
    const created = await page.evaluate(input => (window as unknown as FixtureWindow).customerKey.register(input), input);
    expect(created.kind).toBe('completed'); if (created.kind !== 'completed') throw new Error('Fixture registration unavailable');
    const verified = await verifyRegistrationResponse({ response: created.response as Parameters<typeof verifyRegistrationResponse>[0]['response'],
      expectedChallenge: input.challenge, expectedOrigin: origin, expectedRPID: rpId, requireUserVerification: true });
    expect(verified.verified).toBe(true); if (!verified.registrationInfo) throw new Error('No verified fixture credential');
    const options: PublicKeyCredentialRequestOptionsJSON = { rpId, challenge: opaque(), timeout: 60_000,
      userVerification: 'required', allowCredentials: [{ type: 'public-key', id: verified.registrationInfo.credential.id }] };
    const asserted = await page.evaluate(input => (window as unknown as FixtureWindow).customerKey.authenticate(input), options);
    expect(asserted.kind).toBe('completed'); if (asserted.kind !== 'completed') throw new Error('Fixture assertion unavailable');
    expect((await verifyAuthenticationResponse({ response: asserted.response as Parameters<typeof verifyAuthenticationResponse>[0]['response'],
      expectedChallenge: options.challenge, expectedOrigin: origin, expectedRPID: rpId, requireUserVerification: true,
      credential: verified.registrationInfo.credential })).verified).toBe(true);
    expect(await page.evaluate(async () => ({ local: localStorage.length, session: sessionStorage.length, databases: (await indexedDB.databases()).length })))
      .toEqual({ local: 0, session: 0, databases: 0 });
    expect(await context.cookies()).toEqual([]);
  });
  it('refuses a parent RP before creating any authenticator credential', async () => {
    const input = registration(); input.rp.id = 'example.test';
    expect(await page.evaluate(input => (window as unknown as FixtureWindow).customerKey.register(input), input)).toEqual({ kind: 'unavailable' });
    expect((await cdp.send('WebAuthn.getCredentials', { authenticatorId })).credentials).toHaveLength(0);
  });
  it('cancels an outstanding native ceremony when the application pauses', async () => {
    await cdp.send('WebAuthn.setAutomaticPresenceSimulation', { authenticatorId, enabled: false });
    await page.evaluate(input => { void (window as unknown as FixtureWindow).customerKey.register(input).then(result => { (window as unknown as FixtureWindow).result = result; }); }, registration());
    // The SDK can still be importing: both pre- and post-import cancellation
    // must discard the result without creating/persisting another intent.
    await page.evaluate(() => (window as unknown as FixtureWindow).customerKey.cancel());
    await expect.poll(() => page.evaluate(() => (window as unknown as FixtureWindow).result)).toEqual({ kind: 'cancelled' });
    expect((await cdp.send('WebAuthn.getCredentials', { authenticatorId })).credentials).toHaveLength(0);
  });
});
