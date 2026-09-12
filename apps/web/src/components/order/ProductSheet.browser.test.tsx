import { createServer, type Server } from 'node:http';
import { mkdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { chromium, type Browser, type BrowserContext, type Locator, type Page } from 'playwright';
import postcss from 'postcss';
import tailwind from '@tailwindcss/postcss';
import { beforeAll, beforeEach, afterEach, afterAll, describe, expect, it } from 'vitest';
import type { MenuProduct, OrderLinePayload } from './api';
import type { CartLine, Draft } from './cart';

declare global { interface Window { productSheetFixture: { draft: Draft | null; submitted: CartLine | null; payload: OrderLinePayload[] } } }
// Native ingredient IDs and the separate aggregate `crudites` match the public
// menu shape. Required choices and priced supplements exercise the real model.
const base: MenuProduct = {
  id: 'kebab-fromage', name: 'Kebab Fromage', description: '', price: 850, fromPrice: 850,
  variants: [], groups: [
    { key: 'fromage', name: 'Fromage', type: 'single', min: 1, max: 1, perVariant: null,
      choices: [{ key: 'cheddar', name: 'Cheddar', priceDelta: 0 }, { key: 'raclette', name: 'Raclette', priceDelta: 0 }] },
    { key: 'pain', name: 'Pain', type: 'single', min: 1, max: 1, perVariant: null,
      choices: [{ key: 'pain', name: 'Pain', priceDelta: 0 }, { key: 'galette', name: 'Galette', priceDelta: 50 }] },
    { key: 'sauces', name: 'Sauces', type: 'multi', min: 1, max: 2, perVariant: null,
      choices: ['blanche', 'ketchup', 'barbecue'].map(key => ({ key, name: key, priceDelta: 0 })) },
  ],
  removables: [{ key: 'salade', label: 'Salade' }, { key: 'tomate', label: 'Tomate' },
    { key: 'oignons', label: 'Oignons' }, { key: 'crudites', label: 'Crudités' }],
  supplements: [{ key: 'bacon', label: 'Bacon', priceCents: 100 }],
  tags: [], isNew: false, outOfStock: false, photoUrl: null, configurable: true,
};
let server: Server, browser: Browser, context: BrowserContext, page: Page, origin: string;
let product: MenuProduct, initialLine: CartLine | null, faults: string[];
const evidence = process.env.SM_QA_PRODUCT_SHEET_DIR;

// Real ProductSheet, Sheet/dialog, controls, cart conversion and CSS in Chromium.
// The host supplies a menu snapshot and stores submitted lines locally only.
beforeAll(async () => {
  const directory = fileURLToPath(new URL('.', import.meta.url));
  const cssPath = fileURLToPath(new URL('../../app/globals.css', import.meta.url));
  const [bundle, css] = await Promise.all([
    build({ stdin: { contents: `import React,{useState,useEffect}from'react';import{createRoot}from'react-dom/client';import{ProductSheet}from'./ProductSheet';import{newDraft,draftFromLine,toOrderLines}from'./cart';
      const data=await(await fetch('/fixture/initial')).json();function Host(){const[draft,setDraft]=useState(()=>data.line?draftFromLine(data.line,data.product):newDraft(data.product));const[saved,setSaved]=useState(null);
        useEffect(()=>{window.productSheetFixture={draft,submitted:saved,payload:saved?toOrderLines([saved]):[]}},[draft,saved]);
        return <><button onClick={()=>setDraft(draftFromLine(saved,data.product))} disabled={!saved}>Modifier la ligne enregistrée</button><ProductSheet draft={draft} onChange={setDraft} onClose={()=>setDraft(null)} onSubmit={line=>{setSaved(line);setDraft(null)}} prixMono={false}/></>};createRoot(document.getElementById('root')).render(<Host/>);`,
      resolveDir: directory, sourcefile: 'product-sheet-fixture.tsx', loader: 'tsx' },
      bundle: true, write: false, outdir: '/virtual-product-sheet', format: 'esm', platform: 'browser', target: 'es2022', jsx: 'automatic',
      alias: { react: fileURLToPath(new URL('../../../node_modules/react', import.meta.url)), 'react-dom': fileURLToPath(new URL('../../../node_modules/react-dom', import.meta.url)) },
      define: { 'process.env': '{}', 'process.env.NODE_ENV': '"production"' } }),
    readFile(cssPath, 'utf8').then(source => postcss([tailwind({ base: fileURLToPath(new URL('../../..', import.meta.url)) })]).process(source, { from: cssPath })),
  ]);
  const script = bundle.outputFiles.find(file => file.path.endsWith('.js'))!.text;
  const styles = css.css + (bundle.outputFiles.find(file => file.path.endsWith('.css'))?.text ?? '');
  server = createServer((req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const path = new URL(req.url ?? '/', origin).pathname;
    if (req.method !== 'GET') { faults.push(`Unexpected mutation ${req.method} ${path}`); res.writeHead(405).end(); return; }
    if (path === '/bundle.js' || path === '/style.css') { res.setHeader('Content-Type', path.endsWith('js') ? 'text/javascript' : 'text/css'); res.end(path.endsWith('js') ? script : styles); return; }
    if (path === '/') { res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"></head><body><div id="root"></div><script type="module" src="/bundle.js"></script></body></html>'); return; }
    if (path === '/fixture/initial') { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ product, line: initialLine })); return; }
    if (path === '/favicon.ico') { res.writeHead(204).end(); return; }
    faults.push(`Unexpected request ${path}`); res.writeHead(404).end();
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('Missing port'); origin = `http://127.0.0.1:${address.port}`;
  browser = await chromium.launch({ headless: true });
  if (evidence) await mkdir(evidence, { recursive: true });
}, 30_000);
beforeEach(async () => {
  product = structuredClone(base); initialLine = null; faults = [];
  context = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce', serviceWorkers: 'block' });
  await context.route('**/*', route => { if (new URL(route.request().url()).origin === origin) return route.continue(); faults.push('External request refused'); return route.abort(); });
  page = await context.newPage(); page.setDefaultTimeout(5_000); page.on('pageerror', error => faults.push(error.message));
});
afterEach(async () => { await context?.close(); expect(faults).toEqual([]); });
afterAll(async () => { await browser?.close(); if (server) await new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()); }); });
const open = async () => { await page.goto(origin); await page.getByRole('dialog', { name: 'Kebab Fromage', exact: true }).waitFor(); };
const state = () => page.evaluate(() => window.productSheetFixture);
const removal = (name: string) => page.getByRole('group', { name: 'Ce que je retire', exact: true }).getByRole(name === 'Complet' ? 'button' : 'checkbox', { name, exact: true });

async function textIsUnclipped(locator: Locator) {
  await locator.waitFor();
  await expect.poll(() => locator.evaluate(element => {
    const range = document.createRange(); range.selectNodeContents(element);
    const boxes = [...range.getClientRects()].filter(box => box.width > 0 && box.height > 0);
    const failures: string[] = [];
    if (boxes.length === 0) failures.push('No text geometry');
    for (const box of boxes) {
      if (box.left < -0.5 || box.right > innerWidth + 0.5 || box.top < -0.5 || box.bottom > innerHeight + 0.5) failures.push(`Outside viewport: ${JSON.stringify(box)}`);
      for (let parent: Element | null = element; parent; parent = parent.parentElement) {
        const style = getComputedStyle(parent), bounds = parent.getBoundingClientRect();
        if (style.visibility === 'hidden' || style.display === 'none' || Number(style.opacity) === 0) failures.push(`Hidden by ${parent.tagName}`);
        // Root overflow is propagated to the viewport; a fixed dialog is not
        // clipped to the short body flow box when scroll is locked.
        if (parent === document.body || parent === document.documentElement) continue;
        if (style.overflowX !== 'visible' && (box.left < bounds.left - 0.5 || box.right > bounds.right + 0.5)) failures.push(`Clipped horizontally by ${parent.tagName}.${parent.className}: ${box.left}..${box.right} vs ${bounds.left}..${bounds.right}`);
        if (style.overflowY !== 'visible' && (box.top < bounds.top - 0.5 || box.bottom > bounds.bottom + 0.5)) failures.push(`Clipped vertically by ${parent.tagName}.${parent.className}: ${box.top}..${box.bottom} vs ${bounds.top}..${bounds.bottom}`);
      }
      const hit = document.elementFromPoint((box.left + box.right) / 2, (box.top + box.bottom) / 2);
      if (!hit || (!element.contains(hit) && !hit.contains(element))) failures.push(`Covered by ${hit?.tagName}.${hit?.className}`);
    }
    return failures;
  })).toEqual([]);
}

async function footerIsReadable(label: 'Ajouter' | 'Enregistrer') {
  const action = page.getByRole('button', { name: new RegExp(`^${label}`) });
  await textIsUnclipped(action.getByText(label, { exact: true }));
  await textIsUnclipped(action.getByText(/20,00\s*€/));
  const quantity = page.getByRole('button', { name: 'Plus de Kebab Fromage', exact: true }).locator('..');
  await textIsUnclipped(quantity.getByText('2', { exact: true }));
  for (const button of [action, quantity.getByRole('button').nth(0), quantity.getByRole('button').nth(1)]) {
    const bounds = await button.boundingBox();
    expect(bounds?.height).toBeGreaterThanOrEqual(44); expect(bounds?.width).toBeGreaterThanOrEqual(44);
  }
}

describe('fiche produit — retraits natifs et sélections en navigateur', () => {
  it.each([320, 390])('présente un contrôle par retrait et conserve prix, règles et édition en %spx', async width => {
    await page.setViewportSize({ width, height: width === 320 ? 568 : 844 }); await open();
    expect(await page.getByRole('button', { name: 'Choisissez : Fromage', exact: true }).isDisabled()).toBe(true);
    for (const label of ['oignons', 'tomate', 'crudités', 'salade']) {
      expect(await page.getByRole('checkbox', { name: new RegExp(`^sans ${label}s?$`, 'i') }).count()).toBe(1);
    }
    await removal('sans oignons').click(); expect((await state()).draft?.removed).toEqual(['oignons']);
    await removal('sans crudités').click(); expect((await state()).draft?.removed).toEqual(['oignons', 'crudites']);
    expect(await removal('sans salade').getAttribute('aria-checked')).toBe('false');
    expect(await removal('sans tomate').getAttribute('aria-checked')).toBe('false');
    await removal('sans oignons').click(); expect((await state()).draft?.removed).toEqual(['crudites']);
    await page.getByRole('radiogroup', { name: 'Fromage', exact: true }).getByRole('radio', { name: 'Cheddar Inclus', exact: true }).click();
    await page.getByRole('radiogroup', { name: 'Pain', exact: true }).getByRole('radio', { name: /Galette/ }).click();
    expect(await page.getByRole('button', { name: 'Choisissez : Sauces', exact: true }).isDisabled()).toBe(true);
    const sauces = page.getByRole('group', { name: 'Sauces', exact: true });
    await sauces.getByRole('checkbox', { name: 'blanche Inclus', exact: true }).click();
    await sauces.getByRole('checkbox', { name: 'ketchup Inclus', exact: true }).click();
    expect(await sauces.getByRole('checkbox', { name: 'barbecue Inclus', exact: true }).isDisabled()).toBe(true);
    await page.getByRole('group', { name: 'Suppléments', exact: true }).getByRole('checkbox', { name: /Bacon/ }).click();
    await page.getByRole('textbox', { name: 'Un mot pour la cuisine', exact: true }).fill('Sauce à part');
    await page.getByRole('button', { name: 'Plus de Kebab Fromage', exact: true }).click();
    const add = page.getByRole('button', { name: /^Ajouter/ });
    expect(await add.textContent()).toMatch(/20,00\s*€/);
    if (evidence) await page.screenshot({ path: `${evidence}/footer-${width}.png` });
    await footerIsReadable('Ajouter');
    if (evidence) { await removal('sans crudités').scrollIntoViewIfNeeded(); await page.screenshot({ path: `${evidence}/retraits-${width}.png` }); }
    await add.click(); await page.getByRole('dialog').waitFor({ state: 'hidden' });
    const saved = (await state()).submitted!;
    expect(saved).toEqual(expect.objectContaining({ removed: ['crudites'], qty: 2, note: 'Sauce à part', unitPrice: 1000 }));
    expect((await state()).payload).toEqual([{ productId: base.id, removed: ['crudites'], qty: 2, note: 'Sauce à part', options: [
      { groupKey: 'fromage', choiceKey: 'cheddar' }, { groupKey: 'pain', choiceKey: 'galette' },
      { groupKey: 'sauces', choiceKey: 'blanche' }, { groupKey: 'sauces', choiceKey: 'ketchup' }, { groupKey: 'supplements', choiceKey: 'bacon' },
    ] }]);
    await page.getByRole('button', { name: 'Modifier la ligne enregistrée', exact: true }).click();
    expect(await removal('sans crudités').getAttribute('aria-checked')).toBe('true');
    expect(await removal('sans oignons').getAttribute('aria-checked')).toBe('false');
    const before = (await state()).draft!;
    await removal('Complet').click(); expect((await state()).draft).toEqual({ ...before, removed: [] });
    await footerIsReadable('Enregistrer');
    if (evidence) await page.screenshot({ path: `${evidence}/edition-${width}.png` });
    await page.getByRole('button', { name: /^Enregistrer/ }).click(); await page.getByRole('dialog').waitFor({ state: 'hidden' });
    expect((await state()).submitted).toEqual({ ...saved, removed: [] });
  }, 20_000);

  it('préserve les identités distinctes de même libellé et les sélections récupérées sans les fusionner', async () => {
    product.groups = ['plat', 'accompagnement'].map(key => ({ key, name: key, type: 'single', min: 1, max: 1, perVariant: null,
      choices: [{ key: `${key}-nature`, name: 'Nature', priceDelta: 0 }] }));
    product.removables = [{ key: 'oignons-plat', label: 'Oignons' }, { key: 'oignons-accompagnement', label: 'Oignons' }];
    initialLine = { lineId: 'saved-line', productId: base.id, name: base.name, photoUrl: null, variantKey: null, variantName: null,
      options: product.groups.map(group => ({ groupKey: group.key, groupName: group.name, choiceKey: group.choices[0].key, name: 'Nature', priceDelta: 0 })),
      removed: ['oignons-accompagnement'], note: null, qty: 1, unitPrice: 850 };
    await open();
    const onions = page.getByRole('group', { name: 'Ce que je retire', exact: true }).getByRole('checkbox', { name: 'sans oignons', exact: true });
    expect(await onions.count()).toBe(2); expect(await onions.nth(0).getAttribute('aria-checked')).toBe('false'); expect(await onions.nth(1).getAttribute('aria-checked')).toBe('true');
    expect(await page.getByRole('radio', { name: 'Nature Inclus', exact: true }).count()).toBe(2);
    await onions.nth(0).click(); expect((await state()).draft?.removed).toEqual(['oignons-accompagnement', 'oignons-plat']);
    await onions.nth(1).click(); expect((await state()).draft?.removed).toEqual(['oignons-plat']);
    await page.getByRole('button', { name: /^Enregistrer/ }).click(); await page.getByRole('dialog').waitFor({ state: 'hidden' });
    expect((await state()).submitted).toEqual({ ...initialLine, removed: ['oignons-plat'] });
  });

  it('permet le choix au clavier sans désélectionner une option obligatoire ni dépasser le plafond', async () => {
    await open();
    const cheeses = page.getByRole('radiogroup', { name: 'Fromage', exact: true });
    const cheddar = cheeses.getByRole('radio', { name: 'Cheddar Inclus', exact: true });
    await cheddar.focus(); await page.keyboard.press('Space');
    await page.keyboard.press('Space'); expect((await state()).draft?.picked.fromage).toEqual(['cheddar']);
    await page.keyboard.press('ArrowRight'); expect((await state()).draft?.picked.fromage).toEqual(['raclette']);
    expect(await cheeses.getByRole('radio', { name: 'Raclette Inclus', exact: true }).evaluate(element => element === document.activeElement)).toBe(true);
    await page.keyboard.press('Tab');
    const breads = page.getByRole('radiogroup', { name: 'Pain', exact: true });
    expect(await breads.getByRole('radio', { name: 'Pain Inclus', exact: true }).evaluate(element => element === document.activeElement)).toBe(true);
    await page.keyboard.press('ArrowRight'); expect((await state()).draft?.picked.pain).toEqual(['galette']);
    await page.keyboard.press('Tab'); await page.keyboard.press('Space');
    expect((await state()).draft?.picked.sauces).toEqual(['blanche']);
    await page.keyboard.press('Tab'); await page.keyboard.press('Space');
    expect((await state()).draft?.picked.sauces).toEqual(['blanche', 'ketchup']);
    expect(await page.getByRole('group', { name: 'Sauces', exact: true }).getByRole('checkbox', { name: 'barbecue Inclus', exact: true }).isDisabled()).toBe(true);
    await removal('sans oignons').focus(); await page.keyboard.press('Enter');
    expect((await state()).draft?.removed).toEqual(['oignons']);
    await page.keyboard.press('Space'); expect((await state()).draft?.removed).toEqual([]);
    expect(await page.getByRole('button', { name: /^Ajouter/ }).textContent()).toMatch(/9,00\s*€/);
    await page.keyboard.press('Escape'); await page.getByRole('dialog').waitFor({ state: 'hidden' });
    expect((await state()).submitted).toBeNull(); expect((await state()).draft).toBeNull();
  });

  it('ne retire pas le supplément facultatif unique quand le client utilise une flèche', async () => {
    // Structure du groupe Gratiné réellement proposé sur Compose ton Tacos.
    product.groups = [{ key: 'gratine', name: 'Gratiné', type: 'single', min: 0, max: 1, perVariant: null,
      choices: [{ key: 'gratine', name: 'Tacos gratiné', priceDelta: 150 }] }];
    const add = page.getByRole('button', { name: /^Ajouter/ });
    await open();
    const option = page.getByRole('group', { name: 'Gratiné', exact: true }).getByRole('checkbox', { name: /^Tacos gratiné(?:\s|$)/ });
    expect(await option.getAttribute('aria-checked')).toBe('false');
    await option.focus(); await page.keyboard.press('Space');
    expect((await state()).draft?.picked.gratine).toEqual(['gratine']);
    for (const key of ['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp']) {
      await page.keyboard.press(key);
      expect(await option.getAttribute('aria-checked')).toBe('true');
      expect((await state()).draft?.picked.gratine).toEqual(['gratine']);
      expect(await option.evaluate(element => element === document.activeElement)).toBe(true);
    }
    expect(await add.textContent()).toMatch(/10,00\s*€/);
    await page.keyboard.press('Space'); expect((await state()).draft?.picked.gratine).toEqual([]);
    expect(await add.textContent()).toMatch(/8,50\s*€/);
    await page.keyboard.press('Enter'); await add.click(); await page.getByRole('dialog').waitFor({ state: 'hidden' });
    expect((await state()).payload[0].options).toEqual([{ groupKey: 'gratine', choiceKey: 'gratine' }]);
    expect((await state()).submitted?.unitPrice).toBe(1000);
  });

  it('garde les choix restaurés visibles dans un groupe long et préserve la sélection après repli', async () => {
    product.groups = [{ ...base.groups[2], choices: Array.from({ length: 10 }, (_, index) => ({ key: `sauce-${index + 1}`, name: `Sauce ${index + 1}`, priceDelta: 0 })) }];
    initialLine = { lineId: 'saved-long', productId: base.id, name: base.name, photoUrl: null, variantKey: null, variantName: null,
      options: [{ groupKey: 'sauces', groupName: 'Sauces', choiceKey: 'sauce-10', name: 'Sauce 10', priceDelta: 0 }],
      removed: [], note: null, qty: 1, unitPrice: 850 };
    await open();
    const sauces = page.getByRole('group', { name: 'Sauces', exact: true });
    expect(await sauces.getByRole('checkbox').count()).toBe(7);
    expect(await sauces.getByRole('checkbox', { name: /^Sauce 10\b/ }).getAttribute('aria-checked')).toBe('true');
    const disclosure = page.locator('button[aria-expanded]');
    expect(await disclosure.textContent()).toMatch(/Voir les 3 autres/); expect(await disclosure.getAttribute('aria-expanded')).toBe('false');
    await disclosure.click(); expect(await disclosure.getAttribute('aria-expanded')).toBe('true');
    expect(await sauces.getByRole('checkbox').count()).toBe(10);
    await sauces.getByRole('checkbox', { name: /^Sauce 9\b/ }).click();
    expect(await sauces.getByRole('checkbox', { name: /^Sauce 8\b/ }).isDisabled()).toBe(true);
    await disclosure.click(); expect(await disclosure.getAttribute('aria-expanded')).toBe('false');
    expect(await sauces.getByRole('checkbox').count()).toBe(8);
    expect(await sauces.getByRole('checkbox', { name: /^Sauce 9\b/ }).getAttribute('aria-checked')).toBe('true');
    expect(await sauces.getByRole('checkbox', { name: /^Sauce 10\b/ }).getAttribute('aria-checked')).toBe('true');
    await page.getByRole('button', { name: /^Enregistrer/ }).click(); await page.getByRole('dialog').waitFor({ state: 'hidden' });
    expect((await state()).payload[0].options).toEqual([{ groupKey: 'sauces', choiceKey: 'sauce-10' }, { groupKey: 'sauces', choiceKey: 'sauce-9' }]);
    expect((await state()).submitted?.unitPrice).toBe(850);
  });

  it('maintient les bornes et prix par variante sans perdre retraits ni supplément dédié', async () => {
    product.variants = [{ key: 'petit', name: 'Petit', price: 850 }, { key: 'grand', name: 'Grand', price: 1100 }];
    product.groups = [{ ...base.groups[2], max: 1, perVariant: { grand: { min: 2, max: 2, priceDelta: 50 } } }];
    await open();
    await removal('sans oignons').click();
    await page.getByRole('group', { name: 'Suppléments', exact: true }).getByRole('checkbox', { name: /^Bacon\b/ }).click();
    await page.getByRole('radiogroup', { name: 'Sauces', exact: true }).getByRole('radio', { name: /^blanche\b/ }).click();
    expect(await page.getByRole('button', { name: /^Ajouter/ }).textContent()).toMatch(/9,50\s*€/);
    const format = page.getByRole('radiogroup', { name: 'Format', exact: true });
    await format.getByRole('radio', { name: /^Grand\b/ }).click();
    expect(await page.getByRole('button', { name: 'Choisissez 2 sauces', exact: true }).isDisabled()).toBe(true);
    const sauces = page.getByRole('group', { name: 'Sauces', exact: true });
    await sauces.getByRole('checkbox', { name: /^ketchup\b/ }).click();
    expect(await page.getByRole('button', { name: /^Ajouter/ }).textContent()).toMatch(/13,00\s*€/);
    expect((await state()).draft).toEqual(expect.objectContaining({ variantKey: 'grand', removed: ['oignons'], picked: { sauces: ['blanche', 'ketchup'], supplements: ['bacon'] } }));
    await format.getByRole('radio', { name: /^Petit\b/ }).click();
    expect((await state()).draft).toEqual(expect.objectContaining({ variantKey: 'petit', removed: ['oignons'], picked: { sauces: ['blanche'], supplements: ['bacon'] } }));
    await page.getByRole('button', { name: /^Ajouter/ }).click(); await page.getByRole('dialog').waitFor({ state: 'hidden' });
    expect((await state()).submitted?.unitPrice).toBe(950);
    expect((await state()).payload[0]).toEqual({ productId: base.id, variantKey: 'petit', removed: ['oignons'], qty: 1, options: [
      { groupKey: 'sauces', choiceKey: 'blanche' }, { groupKey: 'supplements', choiceKey: 'bacon' },
    ] });
  });

  it('classe les suppléments par catégorie native sans fusionner deux libellés identiques', async () => {
    product.groups = [];
    product.supplements = [
      { key: 'cheese-option', label: 'Maison', priceCents: 100, category: 'fromage' },
      { key: 'meat-option', label: 'Maison', priceCents: 200, category: 'viande' },
      { key: 'legacy-option', label: 'Oignons frits', priceCents: 50 },
    ];
    await open();
    const supplements = page.getByRole('group', { name: 'Suppléments', exact: true });
    const cheese = supplements.getByRole('group', { name: 'Fromages', exact: true }).getByRole('checkbox', { name: /^Maison\b/ });
    const meat = supplements.getByRole('group', { name: 'Viandes', exact: true }).getByRole('checkbox', { name: /^Maison\b/ });
    expect(await supplements.getByRole('checkbox', { name: /^Maison\b/ }).count()).toBe(2);
    await cheese.click(); expect(await meat.getAttribute('aria-checked')).toBe('false');
    await meat.click(); await supplements.getByRole('checkbox', { name: /^Oignons frits\b/ }).click();
    const add = page.getByRole('button', { name: /^Ajouter/ }); expect(await add.textContent()).toMatch(/12,00\s*€/);
    await add.click(); await page.getByRole('dialog').waitFor({ state: 'hidden' });
    expect((await state()).payload[0].options).toEqual([
      { groupKey: 'supplements', choiceKey: 'cheese-option' }, { groupKey: 'supplements', choiceKey: 'meat-option' }, { groupKey: 'supplements', choiceKey: 'legacy-option' },
    ]);
    expect((await state()).submitted?.unitPrice).toBe(1200);
  });
});
