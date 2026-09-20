#!/usr/bin/env node
/** Publishes the reviewed, versioned SVG registries without loading the design studio. */
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { assets, renderArtwork } from './illustrations/source/assets/index.mjs';
import { iconNames, renderIcon } from './illustrations/source/icons/index.mjs';

const check = process.argv.includes('--check');
if (process.argv.slice(2).some((argument) => argument !== '--check')) {
  throw new Error('Usage: node scripts/generate-illustrations.mjs [--check]');
}
const root = new URL('../', import.meta.url);
const output = new URL('apps/web/public/illustrations/', root);
const sha256 = (content) => createHash('sha256').update(content).digest('hex');
const sourceCommit = '56699753884136daee4b5db1bb532ac2aa69fee4';
const sourceFiles = ['assets/index.mjs', 'assets/original.mjs', 'icons/index.mjs', 'icons/aliases.mjs'];
const sources = await Promise.all(sourceFiles.map(async (file) => ({
  path: `scripts/illustrations/source/${file}`,
  originPath: `design/refonte-swiftui/packages/${file}`,
  sha256: sha256(await readFile(new URL(`scripts/illustrations/source/${file}`, root))),
})));

function verifySvg(svg, id, viewBox) {
  if (!/^[a-z][a-z0-9-]*$/.test(id)) throw new Error(`Invalid asset ID: ${id}`);
  if (!svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg" ') || !svg.endsWith('</svg>') || !svg.includes(`viewBox="${viewBox}"`)) {
    throw new Error(`Invalid SVG root or dimensions: ${id}`);
  }
  // These static sources contain only drawing primitives and local gradients.
  if (/<script|foreignObject|<image|<use|<a\s|<style|<animate|<set\s|<!DOCTYPE|<!ENTITY|\son[a-z]+\s*=|(?:href|src)\s*=|https?:\/\/(?!www\.w3\.org\/2000\/svg)|data:|javascript:|url\(\s*[^#]/i.test(svg)) {
    throw new Error(`Active or external SVG content: ${id}`);
  }
  const identifiers = [...svg.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
  if (new Set(identifiers).size !== identifiers.length) throw new Error(`Duplicate SVG ID: ${id}`);
  for (const [, reference] of svg.matchAll(/url\(#([^)]+)\)/g)) {
    if (!identifiers.includes(reference)) throw new Error(`Missing SVG gradient: ${id}/${reference}`);
  }
}

const files = new Map();
const manifestAssets = [];
for (const asset of assets) {
  const svg = renderArtwork(asset.id, `export-${asset.id}`);
  verifySvg(svg, asset.id, asset.viewBox);
  const file = `food/${asset.id}.svg`;
  files.set(file, svg);
  manifestAssets.push({ id: asset.id, kind: 'food', label: asset.label, path: `/illustrations/${file}`, viewBox: asset.viewBox, bytes: Buffer.byteLength(svg), sha256: sha256(svg) });
}
for (const id of iconNames) {
  const svg = renderIcon(id);
  verifySvg(svg, id, '0 0 24 24');
  const file = `icons/${id}.svg`;
  files.set(file, svg);
  manifestAssets.push({ id, kind: 'icon', path: `/illustrations/${file}`, viewBox: '0 0 24 24', bytes: Buffer.byteLength(svg), sha256: sha256(svg) });
}
const manifest = {
  version: 1,
  sourceCommit,
  sourceRepository: 'GLWebDevAgency/snack-manager',
  provenance: 'Vecteurs de l’aperçu RestoPilot fourni au projet et ajouts internes. Illustrations génériques ; aucune recette ou certification implicite.',
  sources,
  counts: { food: assets.length, icons: iconNames.length },
  landing: { burger: '/illustrations/food/smash-burger.svg', salad: '/illustrations/food/bowl.svg' },
  assets: manifestAssets,
};
files.set('manifest.json', `${JSON.stringify(manifest, null, 2)}\n`);

if (check) {
  for (const [file, content] of files) {
    const actual = await readFile(new URL(file, output), 'utf8').catch(() => null);
    if (actual !== content) throw new Error(`Missing or stale illustration export: ${file}. Run node scripts/generate-illustrations.mjs`);
  }
  for (const directory of ['food', 'icons']) {
    const actual = (await readdir(new URL(`${directory}/`, output))).sort();
    const expected = [...files.keys()].filter((file) => file.startsWith(`${directory}/`)).map((file) => file.slice(directory.length + 1)).sort();
    if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`Unexpected export in ${directory}`);
  }
} else {
  for (const [file, content] of files) {
    const target = new URL(file, output);
    await mkdir(new URL('.', target), { recursive: true });
    await writeFile(target, content);
  }
}
console.log(JSON.stringify({ checked: check, ...manifest.counts, svgBytes: manifestAssets.reduce((sum, asset) => sum + asset.bytes, 0), output: fileURLToPath(output) }));
