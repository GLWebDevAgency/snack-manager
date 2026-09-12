import { createServer, type Server } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { chromium, type Browser, type BrowserContext, type Locator, type Page } from 'playwright';
import postcss from 'postcss';
import tailwind from '@tailwindcss/postcss';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DIRECTIONS, ratioContraste, type Brand, type BrandShape, type DeliveryMissionView } from '@sm/contracts';

// Real access/session parser, mission views, handoff sheet and theme preferences.
// Only HTTP is a local fixture; no mutation or external request is permitted.
const operatorId = 'b'.repeat(24), id = 'd'.repeat(24);
const session = { operatorId, name: 'Camille', restaurantName: 'Restaurant de recette', restaurantSlug: 'recette', expiresAt: '2099-09-14T10:00:00.000Z' };
const mission: DeliveryMissionView = {
  id, number: 12, createdAt: '2026-09-07T10:00:00.000Z', scheduledAt: null, orderStatus: 'ready', revision: 2,
  operator: { id: operatorId, name: session.name }, assignmentId: '02faab2b-f0b1-47c4-b591-8e88908a91b5',
  assignedAt: '2026-09-07T10:00:00.000Z', dispatchedAt: '2026-09-07T10:10:00.000Z',
  paymentReady: true, canAssign: false, canDispatch: false, customer: { name: 'Client de recette', phone: '+33612345678' },
  address: { line1: '10 rue de la Recette', postalCode: '75001', city: 'Paris', country: 'FR' },
  instructions: 'Aucune livraison réelle', items: [{ name: 'Menu kebab', variantName: 'Fromage', qty: 2 }],
};
const radii = {
  net: { xs: '2px', control: '3px', card: '4px', wide: '8px' },
  doux: { xs: '6px', control: '8px', card: '10px', wide: '18px' },
  rond: { xs: '12px', control: '15px', card: '18px', wide: '28px' },
};
let server: Server, browser: Browser, context: BrowserContext, page: Page, origin: string;
let brand: Brand | undefined, errors: string[], requests: string[], sessionReads: number;

beforeAll(async () => {
  const directory = fileURLToPath(new URL('.', import.meta.url));
  const cssPath = fileURLToPath(new URL('../globals.css', import.meta.url));
  const [bundle, css, deliveryCss] = await Promise.all([
    build({ stdin: { contents: `import React from 'react';import {createRoot} from 'react-dom/client';import {DeliveryAccess} from './delivery-access';createRoot(document.getElementById('root')).render(<DeliveryAccess/>);`, resolveDir: directory, sourcefile: 'delivery-shape-fixture.tsx', loader: 'tsx' },
      outdir: '/virtual-delivery-shape', bundle: true, write: false, format: 'esm', platform: 'browser', target: 'es2022', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"' } }),
    readFile(cssPath, 'utf8').then(source => postcss([tailwind({ base: fileURLToPath(new URL('../..', import.meta.url)) })]).process(source, { from: cssPath })),
    readFile(fileURLToPath(new URL('./livreur.css', import.meta.url)), 'utf8'),
  ]);
  const script = bundle.outputFiles.find(file => file.path.endsWith('.js'))!.text;
  const styles = css.css + deliveryCss + (bundle.outputFiles.find(file => file.path.endsWith('.css'))?.text ?? '');
  server = createServer((req, res) => {
    const path = new URL(req.url ?? '/', origin).pathname;
    res.setHeader('Cache-Control', 'no-store');
    if (path === '/bundle.js' || path === '/style.css') { res.setHeader('Content-Type', path.endsWith('.js') ? 'text/javascript' : 'text/css'); res.end(path.endsWith('.js') ? script : styles); return; }
    if (path === '/livreur') { res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"></head><body><div id="root"></div><script type="module" src="/bundle.js"></script></body></html>'); return; }
    if (path === '/favicon.ico') { res.writeHead(204).end(); return; }
    requests.push(`${req.method} ${path}`); res.setHeader('Content-Type', 'application/json');
    const json = (value: unknown) => res.end(JSON.stringify(value));
    if (req.method === 'GET' && path === '/livreur/acces') { sessionReads++; json({ ...session, ...(brand ? { brand } : {}) }); return; }
    if (req.method === 'GET' && path === '/livreur/missions') { json({ missions: [mission], nextCursor: null }); return; }
    if (req.method === 'GET' && path === `/livreur/missions/${id}`) { json(mission); return; }
    if (req.method === 'GET' && path === `/livreur/missions/${id}/handoff`) {
      json({ missionId: id, revision: 0, missionRevision: 2, orderStatus: 'ready', proof: { id: 'ef456803-9d2b-4184-8ed5-b134c5412a1c', expiresAt: session.expiresAt, locked: false }, incident: null, canHandoff: true, canOverride: false, canRotate: false }); return;
    }
    errors.push(`Unexpected request ${req.method} ${path}`); res.writeHead(404).end('{}');
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('Missing port'); origin = `http://127.0.0.1:${address.port}`;
  browser = await chromium.launch({ headless: true });
}, 30_000);
beforeEach(async () => {
  brand = { ...DIRECTIONS.soleil, shape: 'net' }; errors = []; requests = []; sessionReads = 0;
  context = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce', serviceWorkers: 'block' });
  await context.route('**/*', route => {
    if (new URL(route.request().url()).origin === origin) return route.continue();
    errors.push('External request refused'); return route.abort();
  });
  page = await context.newPage(); page.setDefaultTimeout(5_000); page.on('pageerror', error => errors.push(error.message));
});
afterEach(async () => { await context?.close(); expect(errors).toEqual([]); expect(requests.filter(request => !request.startsWith('GET '))).toEqual([]); });
afterAll(async () => { await browser?.close(); if (server) await new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()); }); });
const radius = (locator: Locator) => locator.evaluate(element => getComputedStyle(element).borderTopLeftRadius);
async function openRoute() {
  await page.goto(`${origin}/livreur`); await page.getByRole('button', { name: /^En route/ }).click();
  await page.getByRole('button', { name: 'Voir la mission n°12', exact: true }).waitFor();
}
async function openSheet() {
  await page.getByRole('button', { name: 'Voir la mission n°12', exact: true }).click();
  await page.getByRole('button', { name: 'Remettre au client', exact: true }).click();
  await page.getByRole('textbox', { name: 'Code de remise à six chiffres', exact: true }).waitFor();
}

describe('identité des formes — Livreur réel', () => {
  it.each((['net', 'doux', 'rond'] as const).flatMap(shape => (['dark', 'light'] as const).map(theme => ({ shape, theme }))))(
    '$shape garde les cartes, contrôles et la feuille cohérents en $theme', async ({ shape, theme }) => {
      brand = { ...DIRECTIONS.soleil, shape };
      await context.addInitScript(value => localStorage.setItem('sm.delivery.preferences.v2', JSON.stringify({ theme: value })), theme);
      await openRoute(); const expected = radii[shape];
      expect(await radius(page.locator('.lv-brand-tile').first())).toBe(expected.control);
      expect(await radius(page.locator('.lv-stat').first())).toBe(expected.card);
      expect(await radius(page.locator('.lv-mcard').first())).toBe(expected.card);
      expect(await page.locator('.lv-app').evaluate(element => ({ background: getComputedStyle(element).backgroundColor, scheme: getComputedStyle(element).colorScheme })))
        .toEqual({ background: theme === 'light' ? 'rgb(245, 245, 243)' : 'rgb(22, 25, 22)', scheme: theme });
      const colors = await page.locator('.lv-app').evaluate(element => {
        const css = getComputedStyle(element);
        return Object.fromEntries(['bg', 'surface', 'surface2', 'text', 'dim', 'accent-text', 'green-t', 'red-t', 'amber-t'].map(key => [key, css.getPropertyValue(`--lv-${key}`).trim()]));
      });
      for (const foreground of ['text', 'dim', 'accent-text', 'green-t', 'red-t', 'amber-t']) {
        for (const background of ['bg', 'surface', 'surface2']) {
          expect(ratioContraste(colors[foreground], colors[background]), `${foreground}/${background}`).toBeGreaterThanOrEqual(4.5);
        }
      }
      // Brand mode is light; the driver's explicit dark choice remains dark.
      expect(await radius(page.locator('.lv-avatar').first())).toBe('50%');
      await page.getByRole('button', { name: 'Voir la mission n°12', exact: true }).click();
      const detail = page.getByRole('dialog', { name: 'Mission n°12', exact: true });
      expect(await radius(detail.locator('.lv-block').first())).toBe(expected.card);
      expect(await radius(detail.locator('.lv-variant').first())).toBe(expected.xs);
      expect(await radius(detail.locator('.lv-cta'))).toBe(expected.control);
      await page.getByRole('button', { name: 'Remettre au client', exact: true }).click();
      await page.getByRole('textbox', { name: 'Code de remise à six chiffres', exact: true }).waitFor();
      const sheet = page.getByRole('dialog', { name: 'Remise au client · n°12', exact: true });
      expect(await radius(sheet.locator('.lv-dialog-panel'))).toBe(expected.wide);
      expect(await sheet.locator('.lv-dialog-panel').evaluate(element => getComputedStyle(element).borderBottomLeftRadius)).toBe('0px');
      expect(await radius(sheet.locator('.lv-code-cells>span').first())).toBe(expected.control);
      expect(await radius(sheet.locator('.lv-numpad button').first())).toBe(expected.control);
      await page.getByRole('button', { name: 'Fermer la remise', exact: true }).click();
      expect(await page.getByRole('button', { name: 'Remettre au client', exact: true }).evaluate(element => element === document.activeElement)).toBe(true);
    },
  );
  it('répercute une marque relue dans la même session sans écrire une préférence de forme', async () => {
    await openRoute(); expect(await radius(page.locator('.lv-mcard').first())).toBe(radii.net.card);
    for (const shape of ['rond', 'doux'] as BrandShape[]) {
      brand = { ...DIRECTIONS.soleil, shape }; const before = sessionReads;
      await page.evaluate(() => window.dispatchEvent(new Event('focus')));
      await expect.poll(() => sessionReads).toBeGreaterThan(before);
      await expect.poll(() => radius(page.locator('.lv-mcard').first())).toBe(radii[shape].card);
    }
    await page.reload(); await page.getByRole('button', { name: /^En route/ }).click();
    expect(await radius(page.locator('.lv-mcard').first())).toBe(radii.doux.card);
    expect(await page.evaluate(() => localStorage.getItem('sm.delivery.preferences.v2'))).toBeNull();
    await openSheet(); expect(await radius(page.locator('.lv-sheet .lv-dialog-panel'))).toBe(radii.doux.wide);
  });
  it('applique le repli de marque lorsque la session legacy ne porte pas encore brand', async () => {
    brand = undefined; await openRoute(); expect(await radius(page.locator('.lv-mcard').first())).toBe(radii.net.card);
    await openSheet(); expect(await radius(page.locator('.lv-sheet .lv-dialog-panel'))).toBe(radii.net.wide);
  });
});

it('conserve les réglages locaux d’accessibilité et la forme du restaurant après rechargement', async () => {
  await page.setViewportSize({ width: 320, height: 720 });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await openRoute();
  await page.getByRole('button', { name: 'Mon accès et paramètres', exact: true }).click();
  const appearance = page.getByRole('region', { name: 'Apparence', exact: true });
  for (const choice of await appearance.getByRole('button').all()) {
    expect(await choice.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    expect((await choice.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  }
  await appearance.getByRole('switch', { name: /^Réduire les mouvements/ }).check();
  await appearance.getByRole('switch', { name: /^Réduire la transparence/ }).check();
  await expect.poll(() => page.locator('.lv-app').getAttribute('data-reduce-motion')).toBe('true');
  await expect.poll(() => page.locator('[data-sm-tabbar]').getAttribute('data-sm-reduce-transparency')).toBe('true');
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('sm.delivery.preferences.v2')!));
  expect(stored).toEqual({ theme: 'dark', navigation: 'google', alerts: false, wake: false, reduceMotion: true, reduceTransparency: true });
  await page.reload(); await page.getByRole('button', { name: 'Mon accès et paramètres', exact: true }).click();
  expect(await appearance.getByRole('switch', { name: /^Réduire les mouvements/ }).isChecked()).toBe(true);
  expect(await appearance.getByRole('switch', { name: /^Réduire la transparence/ }).isChecked()).toBe(true);
  expect(await page.locator('.lv-app').evaluate(element => getComputedStyle(element).getPropertyValue('--lv-scrim').trim())).toBe(await page.locator('.lv-app').evaluate(element => getComputedStyle(element).getPropertyValue('--lv-bg').trim()));
  await page.getByRole('tab', { name: 'Tournée', exact: true }).click();
  await page.getByRole('button', { name: /^En route/ }).click();
  expect(await radius(page.locator('.lv-mcard').first())).toBe(radii.net.card);
  expect(await page.locator('.lv-mcard').first().evaluate(element => getComputedStyle(element).transitionDuration)).toBe('0s');
});
