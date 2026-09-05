#!/usr/bin/env node
/**
 * Real TV player, local fixture API only. Start @sm/web separately, then run:
 * TV_MOTION_WEB_URL=http://localhost:3138 node e2e/local/board-motion.mjs
 *
 * No account, pairing call, remote write, package installation or server startup.
 * The 15 production modules render at both orientations. WAAPI seeks only the
 * intro effects; polling and the three four-second rotation checks use real time.
 * Still/pause attributes exercise the host's CSS contract, not the admin buttons.
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(join(root, 'package.json'));
const { chromium } = require('playwright');
const { DIRECTIONS, SCENOGRAPHIES } = require(join(root, 'packages/contracts/dist/index.js'));
const base = new URL(process.env.TV_MOTION_WEB_URL ?? 'http://localhost:3138');
assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(base.hostname), 'This regression is restricted to a local web server.');
assert.ok(!base.username && !base.password && !base.search && !base.hash, 'Use a local origin without credentials or query parameters.');
const displayUrl = new URL('/board/display', base).href;
const priceSelector = '.ss-price,.ct-badge,.ct-price,.bd-price,.bd-hero-price';
const layerSelector = '.bd-layer[data-phase="in"]';
const fixedPrices = ['9,50 €', '8,50 €', '7,25 €'];
const names = ['Le Smash de recette', 'Le Black de recette', 'Le Kebab sans photo'];
const runtimeErrors = [];
const unexpectedRequests = [];
let fixture;
let version = 0;
let completedViews = 0;

function content(preset, orientation, { rotation = false } = {}) {
  const products = names.map((name, i) => ({
    id: `local-product-${i}`, name, description: 'Préparé à la commande, sauce maison.',
    priceLabel: fixedPrices[i], priceCents: [950, 850, 725][i], priceMaxCents: [950, 850, 725][i],
    photoUrl: i < 2 ? new URL(`/photos/${i === 0 ? 'smash-burger' : 'black-burger'}.webp`, base).href : null,
    photoPoint: null, isNew: i === 0, outOfStock: false,
  }));
  const first = {
    id: 'local-scene-first', kind: 'category', title: 'Les incontournables de recette',
    subtitle: 'Le menu du jour', durationMs: rotation ? 4000 : 12000, products, promos: [], nextOpening: null,
  };
  return {
    screenId: 'local-motion-screen', name: 'Recette sans écriture', orientation, theme: 'brand', scenography: preset,
    masque: DIRECTIONS.nuit, presentation: { version: 1, motion: 'expressive', corners: 'brand', priceScale: 'balanced' },
    brand: { name: 'Restaurant de recette', slug: 'local-motion', logoUrl: null, accent: DIRECTIONS.nuit.palette.accent },
    service: 'dinner', serviceLabel: 'À la carte', open: true,
    scenes: rotation ? [first, { ...first, id: 'local-scene-second', title: 'La deuxième scène de recette' }] : [first],
    contentHash: `local-motion-${++version}`, generatedAt: new Date().toISOString(),
    dailyReloadAt: '2099-01-01T04:00:00.000Z', pollIntervalMs: 1000, timezone: 'Europe/Paris',
  };
}

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1440, height: 810 }, reducedMotion: 'no-preference', serviceWorkers: 'block',
});
const page = await context.newPage();
page.setDefaultTimeout(15_000);
page.setDefaultNavigationTimeout(45_000);
page.on('pageerror', (error) => runtimeErrors.push(error.message));

// A single allowlist route means a fixture cannot accidentally fall through to
// Railway. Local Next assets may load; all unexpected API/mutation calls fail.
await context.route('**/*', async (route) => {
  const request = route.request();
  const url = new URL(request.url());
  if (url.pathname === '/public/screens/content' && request.method() === 'GET') {
    return route.fulfill({ json: fixture });
  }
  if (url.pathname === '/public/screens/heartbeat' && request.method() === 'POST') {
    return route.fulfill({ json: { contentHash: fixture.contentHash } });
  }
  if (url.origin === base.origin && ['GET', 'HEAD'].includes(request.method())) return route.continue();
  unexpectedRequests.push(`${request.method()} ${url.origin}${url.pathname}`);
  return route.abort('blockedbyclient');
});
await page.addInitScript(() => {
  localStorage.removeItem('sm.board.content');
  localStorage.removeItem('sm.board.screen');
  localStorage.setItem('sm.board.token', 'local-fixture-only');
  window.__tvMotion = { intro: [], starts: 0, names: new Set() };
  document.addEventListener('animationstart', (event) => {
    if (window.__tvMotion.names.has(event.animationName)) window.__tvMotion.starts++;
  }, true);
});

async function load(preset, orientation, options) {
  fixture = content(preset, orientation, options);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.setViewportSize(orientation === 'landscape' ? { width: 1440, height: 810 } : { width: 810, height: 1440 });
  await page.goto(displayUrl, { waitUntil: 'domcontentloaded' });
  await page.locator(`.bd-root[data-scenography="${preset}"] .bd-stage[data-ready="1"][data-orientation="${orientation}"]`).waitFor();
  await page.locator(`${layerSelector} :is(.ss-price,.ct-badge,.ct-price,.bd-price,.bd-hero-price)`).first().waitFor({ state: 'attached' });
  assert.equal(new URL(page.url()).pathname, '/board/display', 'The real display route must remain active.');
}

async function captureIntro() {
  return page.evaluate((selector) => {
    const layer = document.querySelector(selector);
    const roleOf = (target) => {
      if (target.dataset.ssPart) return target.dataset.ssPart;
      const classes = `${target.className} ${target.querySelector?.('h1,h2,h3,p')?.className ?? ''}`;
      if (/price|badge/.test(classes)) return 'price';
      if (/photo|visual|thumb/.test(classes)) return 'photo';
      if (/desc/.test(classes)) return 'detail';
      if (/name/.test(classes)) return 'name';
      if (/title|head/.test(classes)) return 'title';
      return classes.trim();
    };
    const intro = document.getAnimations().filter((animation) => {
      const timing = animation.effect?.getTiming();
      const target = animation.effect?.target;
      return target instanceof Element && layer.contains(target) && timing.iterations !== Infinity
        && Number(timing.duration) > 0 && Number(timing.duration) <= 1000
        && /^(ss-|ct-|ar-)/.test(animation.animationName ?? '');
    });
    window.__tvMotion.intro = intro.map((animation) => ({ animation, target: animation.effect.target }));
    window.__tvMotion.names = new Set(intro.map((animation) => animation.animationName));
    return intro.map((animation) => {
      const timing = animation.effect.getTiming();
      animation.pause();
      animation.currentTime = 0;
      return { name: animation.animationName, role: roleOf(animation.effect.target), delay: timing.delay, duration: timing.duration };
    });
  }, layerSelector);
}

async function settleIntro() {
  await page.evaluate(async () => {
    for (const { animation } of window.__tvMotion.intro) {
      const timing = animation.effect.getTiming();
      animation.currentTime = Number(timing.delay) + Number(timing.duration) + 1;
    }
    await document.fonts.ready;
    await new Promise((resolveFrame) => requestAnimationFrame(() => requestAnimationFrame(resolveFrame)));
  });
  // Photo load transitions are separate from the authored scene entrances.
  await page.waitForFunction(() => [...document.querySelectorAll('.bd-layer[data-phase="in"] .ct-photo-frame')]
    .filter((frame) => !frame.closest('[data-photo="0"]'))
    .every((frame) => frame.dataset.state === 'ready'));
  await page.evaluate(() => {
    for (const animation of document.getAnimations()) {
      if (animation.animationName === 'ct-fade') {
        const timing = animation.effect.getTiming();
        animation.pause();
        animation.currentTime = Number(timing.delay) + Number(timing.duration) + 1;
      }
    }
  });
  // The stage's initial ready opacity transition is independent of scene motion.
  await page.waitForFunction(() => Number(getComputedStyle(document.querySelector('.bd-stage')).opacity) > 0.99);
}

async function assertPrices(expected, label) {
  const prices = await page.evaluate(({ priceSelector, layerSelector }) => {
    const root = document.querySelector('.bd-root');
    const layer = document.querySelector(layerSelector);
    const box = root.getBoundingClientRect();
    return [...layer.querySelectorAll(priceSelector)].map((price) => {
      let opacity = 1;
      let visible = true;
      const dimmed = [];
      for (let element = price; element && element !== root; element = element.parentElement) {
        const style = getComputedStyle(element);
        opacity *= Number(style.opacity);
        visible &&= style.visibility !== 'hidden' && style.display !== 'none';
        if (Number(style.opacity) < 0.99) dimmed.push({ element: element.className, opacity: style.opacity, animation: style.animationName });
      }
      const rect = price.getBoundingClientRect();
      return { text: price.textContent.replace(/\s+/g, ' ').trim(), opacity, visible, dimmed,
        contained: rect.width > 0 && rect.height > 0 && rect.left >= box.left - 2 && rect.right <= box.right + 2
          && rect.top >= box.top - 2 && rect.bottom <= box.bottom + 2 };
    });
  }, { priceSelector, layerSelector });
  assert.deepEqual(prices.map((price) => price.text), expected, `${label}: every exact price, in order.`);
  assert.ok(prices.every((price) => price.opacity > 0.9 && price.visible && price.contained), `${label}: prices must be readable and inside the screen: ${JSON.stringify(prices)}`);
}

async function assertLiveUpdate(preset) {
  const baseline = await page.evaluate(() => window.__tvMotion.starts);
  const updated = { ...fixture.scenes[0].products[0], priceLabel: '19,70 €', priceCents: 1970, priceMaxCents: 1970 };
  fixture = { ...fixture, contentHash: `local-motion-update-${++version}`, scenes: [
    { ...fixture.scenes[0], products: [updated, ...fixture.scenes[0].products.slice(1)] },
  ] };
  await page.waitForFunction(({ priceSelector, layerSelector }) => document.querySelector(layerSelector)?.querySelector(priceSelector)?.textContent.includes('19,70 €'), { priceSelector, layerSelector });
  const stable = await page.evaluate(() => ({
    starts: window.__tvMotion.starts,
    retained: window.__tvMotion.intro.every(({ animation, target }) => target.isConnected
      && target.getAnimations().filter((current) => current.animationName === animation.animationName).every((current) => current === animation)),
    layers: document.querySelectorAll('.bd-layer').length,
  }));
  assert.equal(stable.starts, baseline, `${preset}: a live price must not start any entrance again.`);
  assert.equal(stable.retained, true, `${preset}: the scene's DOM and animation identities must be retained.`);
  assert.equal(stable.layers, 1, `${preset}: a price update must not create an outgoing duplicate.`);
  await assertPrices(['19,70 €', ...fixedPrices.slice(1)], `${preset} live update`);
}

async function assertMotionControls(preset) {
  await page.locator('.bd-root').evaluate((root) => { root.dataset.paused = '1'; });
  const ambient = await page.evaluate(async () => {
    await new Promise((resolveFrame) => requestAnimationFrame(resolveFrame));
    return document.getAnimations().filter((animation) => animation.effect.getTiming().iterations === Infinity
      || Number(animation.effect.getTiming().duration) > 1000)
      .map((animation) => ({ name: animation.animationName, state: animation.playState }));
  });
  assert.ok(ambient.length > 0, `${preset}: a real ambient animation must exist.`);
  assert.ok(ambient.every((animation) => animation.state === 'paused'), `${preset}: pause must stop ambient/photo movement: ${JSON.stringify(ambient)}`);
  for (const mode of ['still', 'off', 'reduced']) {
    await page.locator('.bd-root').evaluate((root, mode) => {
      root.dataset.paused = '0';
      root.dataset.still = mode === 'still' ? '1' : '0';
      root.dataset.motion = mode === 'off' ? 'off' : 'expressive';
    }, mode);
    await page.emulateMedia({ reducedMotion: mode === 'reduced' ? 'reduce' : 'no-preference' });
    const remaining = await page.evaluate(async () => {
      await new Promise((resolveFrame) => requestAnimationFrame(() => requestAnimationFrame(resolveFrame)));
      return document.querySelector('.bd-root').getAnimations({ subtree: true }).map((animation) => ({
        name: animation.animationName, property: animation.transitionProperty, target: animation.effect.target.className,
        state: animation.playState, timing: animation.effect.getTiming(),
      }));
    });
    assert.deepEqual(remaining, [], `${preset} ${mode}: motion must be disabled.`);
    await assertPrices(['19,70 €', ...fixedPrices.slice(1)], `${preset} ${mode}`);
  }
}

async function assertRotation(preset) {
  await load(preset, 'landscape', { rotation: true });
  await page.locator(`${layerSelector} img[src*="/photos/"]`).first().waitFor({ state: 'attached' });
  await page.waitForFunction((selector) => {
    const photos = [...document.querySelector(selector).querySelectorAll('img[src*="/photos/"]')];
    return photos.length > 0 && photos.every((photo) => photo.complete && photo.naturalWidth > 0);
  }, layerSelector);
  await page.evaluate(() => {
    const area = document.querySelector('.bd-stagearea');
    const original = area.querySelector('.bd-layer');
    const originalPhoto = original.querySelector('img[src*="/photos/"]');
    const originalAnimations = new Set(original.getAnimations({ subtree: true }));
    const record = { outAt: null, removedAfter: null, retained: false, photoRetained: false, exitDuration: null, maxLayers: 1, liveLayers: 1, replayed: [] };
    window.__tvRotation = record;
    const observer = new MutationObserver(() => {
      const layers = [...area.querySelectorAll('.bd-layer')];
      record.maxLayers = Math.max(record.maxLayers, layers.length);
      record.liveLayers = Math.max(record.liveLayers, layers.filter((layer) => layer.getAttribute('aria-hidden') !== 'true').length);
      const outgoing = area.querySelector('.bd-layer[data-phase="out"]');
      if (outgoing && record.outAt === null) {
        record.outAt = performance.now();
        record.retained = outgoing === original;
        record.photoRetained = Boolean(originalPhoto?.complete && originalPhoto.naturalWidth > 0 && outgoing.contains(originalPhoto));
        const animations = outgoing.getAnimations({ subtree: true });
        record.exitDuration = animations.find((animation) => animation.animationName === 'bd-film-dissolve')?.effect.getTiming().duration;
        record.replayed = animations.filter((animation) => {
          if (animation.animationName === 'bd-film-dissolve') return false;
          // Shared Photo retains its completed load fade (fill: both). This is
          // safe only when it is the same, already-finished Animation object;
          // a replacement or restarted fade must still fail this regression.
          if (animation.animationName === 'ct-fade' && originalAnimations.has(animation)
            && animation.playState === 'finished') return false;
          const timing = animation.effect.getTiming();
          return Number(timing.duration) <= 1000 && timing.iterations !== Infinity;
        }).map((animation) => ({ name: animation.animationName, state: animation.playState, retained: originalAnimations.has(animation) }));
      }
      if (record.outAt !== null && !original.isConnected) {
        record.removedAfter = performance.now() - record.outAt;
        observer.disconnect();
      }
    });
    observer.observe(area, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-phase', 'aria-hidden'] });
  });
  await page.waitForFunction(() => window.__tvRotation.removedAfter !== null, null, { timeout: 8000 });
  const rotation = await page.evaluate(() => ({ ...window.__tvRotation, layersAfter: document.querySelectorAll('.bd-layer').length }));
  assert.equal(rotation.retained, true, `${preset}: outgoing scene must be the original DOM element.`);
  assert.equal(rotation.photoRetained, true, `${preset}: decoded photo DOM must survive the dissolve.`);
  assert.equal(rotation.exitDuration, 380, `${preset}: CSS exit must use the same 380ms clock as the player.`);
  assert.ok(rotation.removedAfter >= 330 && rotation.removedAfter < 1500, `${preset}: outgoing DOM removal must follow the dissolve, got ${rotation.removedAfter}ms.`);
  assert.equal(rotation.maxLayers, 2);
  assert.equal(rotation.liveLayers, 1, `${preset}: exactly one layer must be exposed to assistive technology.`);
  assert.equal(rotation.layersAfter, 1);
  assert.deepEqual(rotation.replayed, [], `${preset}: outgoing content must not replay its entry.`);
  console.log(`PASS ${preset} real rotation: preserved DOM, 380ms dissolve, no duplicate.`);
}

try {
  for (const orientation of ['landscape', 'portrait']) {
    for (const preset of SCENOGRAPHIES) {
      await load(preset, orientation);
      const intro = await captureIntro();
      assert.ok(new Set(intro.map((animation) => animation.role)).size >= 2, `${preset}: at least two independently animated roles are required.`);
      assert.ok(new Set(intro.map((animation) => animation.delay)).size >= 2, `${preset}: authored roles must have distinct delays.`);
      await settleIntro();
      await assertPrices(fixedPrices, `${preset} ${orientation}`);
      assert.ok((await page.locator(layerSelector).innerText()).includes(names[2]), `${preset}: a missing photo must not remove the product.`);
      if (orientation === 'landscape') {
        await assertLiveUpdate(preset);
        await assertMotionControls(preset);
      }
      completedViews++;
      console.log(`PASS ${preset} ${orientation}: ${intro.length} intro effects, exact settled prices, missing-photo fallback${orientation === 'landscape' ? ', live update and motion controls' : ''}.`);
    }
  }
  for (const preset of ['ardoise', 'comptoir', 'affiche']) await assertRotation(preset);
  assert.deepEqual(runtimeErrors, [], 'No application runtime errors are allowed.');
  assert.deepEqual(unexpectedRequests, [], 'No request may escape the local API fixture allowlist.');
  console.log(`PASS ${completedViews} real rendered views, 15 live-update/control checks, 3 real rotations. No remote writes.`);
} finally {
  await browser.close();
}
