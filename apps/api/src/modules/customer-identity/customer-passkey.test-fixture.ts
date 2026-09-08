/// <reference lib="dom" />
import { build } from 'esbuild';
import { chromium } from 'playwright';
import type { PublicKeyCredentialCreationOptionsJSON, PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON, AuthenticationResponseJSON } from '@simplewebauthn/browser';
import { CustomerPasskeyAssertionSchema, CustomerPasskeyRegistrationSchema } from '@sm/contracts';

type FixtureWindow = Window & { fixtureKeys: {
  startRegistration(input: { optionsJSON: PublicKeyCredentialCreationOptionsJSON }): Promise<RegistrationResponseJSON>;
  startAuthentication(input: { optionsJSON: PublicKeyCredentialRequestOptionsJSON }): Promise<AuthenticationResponseJSON>;
} };

/** Native cryptographic evidence only. The HTTPS document is local and every
 * other browser request is rejected. No hardware, external provider or customer
 * account is impersonated by this virtual CTAP2 authenticator. */
export async function customerPasskeyFixture(origin: string) {
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ serviceWorkers: 'block' });
    await context.route('**/*', route => route.request().url() === `${origin}/` && route.request().method() === 'GET'
      ? route.fulfill({ contentType: 'text/html', body: '<!doctype html><html lang="fr"><title>Isolated key fixture</title></html>' })
      : route.abort());
    const bundle = await build({ stdin: { contents: 'import{startRegistration,startAuthentication}from"@simplewebauthn/browser";window.fixtureKeys={startRegistration,startAuthentication};',
      resolveDir: process.cwd(), sourcefile: 'customer-key-fixture.js' }, bundle: true, write: false, format: 'iife', platform: 'browser', target: 'es2022' });
    const page = await context.newPage(); await page.goto(origin); await page.addScriptTag({ content: bundle.outputFiles[0]!.text });
    const cdp = await context.newCDPSession(page); await cdp.send('WebAuthn.enable');
    await cdp.send('WebAuthn.addVirtualAuthenticator', { options: { protocol: 'ctap2', transport: 'internal',
      hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true } });
    return {
      register: async (optionsJSON: PublicKeyCredentialCreationOptionsJSON) => CustomerPasskeyRegistrationSchema.parse(
        await page.evaluate(options => (window as unknown as FixtureWindow).fixtureKeys.startRegistration({ optionsJSON: options }), optionsJSON)),
      // Selecting one of this virtual device's keys models the user's account
      // chooser. The challenge/RP remain the exact server options.
      authenticate: async (optionsJSON: PublicKeyCredentialRequestOptionsJSON, chosenCredentialId?: string) => CustomerPasskeyAssertionSchema.parse(
        await page.evaluate(options => (window as unknown as FixtureWindow).fixtureKeys.startAuthentication({ optionsJSON: options }),
          chosenCredentialId ? { ...optionsJSON, allowCredentials: [{ type: 'public-key' as const, id: chosenCredentialId }] } : optionsJSON)),
      close: () => browser.close(),
    };
  } catch (error) { await browser.close(); throw error; }
}
