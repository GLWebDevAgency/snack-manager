/** Local manual browser fixture. Real components/canvas; API replaced in the bundle. */
import { createRequire } from 'node:module';
import { readFile, writeFile, mkdir, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(join(root, 'package.json'));
const webRequire = createRequire(join(root, 'apps/web/package.json'));
const { build } = require('esbuild');
const postcss = require('postcss');
const tailwind = require('@tailwindcss/postcss');
const temporary = await mkdtemp(join(tmpdir(), 'sm-mediatheque-'));
const artifacts = join(root, 'docs/refonte-ui/captures/mediatheque');
await mkdir(artifacts, { recursive: true });
const mock = join(temporary, 'api.ts');
await writeFile(mock, `
import { detecterImage, dimensionsImage, MEDIA_MAX_OCTETS } from '@sm/contracts';
export class ApiError extends Error {
  constructor(public status: number, message: string, public body: unknown = null) { super(message); }
}
const medias: any[] = [];
export const evidence = { attempts: [] as any[], updates: [] as any[], quotaRefused: false, canAct: true, delay: false, pending: 0, renders: [] as any[], errors: [] as string[] };
const quota = () => ({ octetsUtilises: medias.reduce((sum, m) => sum + m.octets, 0), octetsMax: 268435456, medias: medias.length });
export async function charger() { return { medias: [...medias], quota: quota() }; }
export function reset() { for (const m of medias) URL.revokeObjectURL(m.urls.original); medias.length = 0; evidence.attempts.length = 0; evidence.updates.length = 0; evidence.canAct = true; }
export async function envoiFichier(method: string, path: string, file: File) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const kind = detecterImage(bytes), dimensions = dimensionsImage(bytes);
  const empreinte = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2, '0')).join('');
  const attempt: any = { method, path, name: file.name, type: file.type, bytes: file.size, kind, dimensions, empreinte, result: 'pending' };
  evidence.attempts.push(attempt);
  if (method !== 'POST' || path !== '/medias' || kind !== 'image/png' || file.size > MEDIA_MAX_OCTETS) throw new ApiError(400, 'Fixture: contrat fichier refusé');
  if (evidence.quotaRefused) { attempt.result = 'quota-refused'; throw new ApiError(409, 'Médiathèque pleine — quota de recette atteint.'); }
  let media = medias.find(m => m.empreinte === empreinte);
  const deduplique = !!media;
  if (!media) {
    const url = URL.createObjectURL(file);
    media = { id: 'local-media-' + (medias.length + 1), genre: 'photo', empreinte, type: kind, octets: file.size, largeur: dimensions?.largeur ?? null, hauteur: dimensions?.hauteur ?? null, point: { x: 0.5, y: 0.5 }, alt: file.name, stockage: 'local', origine: 'depot', auteur: null, deposeLe: '2026-09-12T10:00:00Z', utilisePar: 0, urls: { original: url, vignette: url, carte: url, bandeau: url } };
    medias.push(media);
  }
  attempt.result = deduplique ? 'deduplicated' : 'created';
  return { media, quota: quota(), deduplique };
}
const forbidden = () => { throw new Error('Unscripted mutation refused by local fixture'); };
export const api = { get: forbidden, post: forbidden, patch: forbidden, put: forbidden, del: forbidden };
`);
await build({
  entryPoints: [join(root, 'e2e/local/refonte-mediatheque.tsx')], outfile: join(temporary, 'fixture.js'),
  absWorkingDir: root, bundle: true, platform: 'browser', format: 'esm', jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"development"' },
  alias: { '@/lib/api': mock, '@': join(root, 'apps/web/src'), '@sm/contracts': join(root, 'packages/contracts/src/index.ts'), react: dirname(webRequire.resolve('react/package.json')), 'react-dom': dirname(webRequire.resolve('react-dom/package.json')) },
});
const cssPath = join(root, 'apps/web/src/app/globals.css');
const css = await postcss([tailwind({ base: join(root, 'apps/web') })]).process(await readFile(cssPath, 'utf8'), { from: cssPath });
await writeFile(join(temporary, 'fixture.css'), css.css);
const html = '<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Recette médiathèque locale</title><link rel="stylesheet" href="/fixture.css"></head><body><div id="root">Chargement de la recette…</div><script type="module" src="/loader.js"></script></body></html>';
const port = Number(process.env.REFONTE_MEDIA_PORT ?? 4178);
const server = createServer(async (request, response) => {
  response.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src data: blob:; connect-src 'self'; font-src 'none'");
  if (request.url === '/preuves' && request.method === 'POST') {
    let body = '';
    for await (const chunk of request) { body += chunk; if (body.length > 1048576) { response.writeHead(413).end(); return; } }
    const parsed = JSON.parse(body);
    await writeFile(join(artifacts, 'preuves-cua.json'), JSON.stringify({ fixture: 'React components with in-memory API; no backend', capturedAt: new Date().toISOString(), ...parsed }, null, 2));
    response.writeHead(200, { 'content-type': 'application/json' }).end('{"ok":true}');
    return;
  }
  if (request.method !== 'GET') { response.writeHead(405).end(); return; }
  const files = { '/': [html, 'text/html'], '/loader.js': ["const report = error => { const pre = document.createElement('pre'); pre.textContent = String(error.stack || error); document.body.append(pre); }; window.addEventListener('error', e => report(e.error || e.message)); import('/fixture.js').catch(report);", 'text/javascript'], '/fixture.js': [await readFile(join(temporary, 'fixture.js')), 'text/javascript'], '/fixture.css': [css.css, 'text/css'] };
  const found = files[request.url];
  if (!found) { response.writeHead(404).end(); return; }
  response.writeHead(200, { 'content-type': found[1] }).end(found[0]);
});
server.listen(port, '127.0.0.1', () => console.log('Fixture médias : http://127.0.0.1:' + port + ' — CSP sans accès distant, API substituée, preuves ' + artifacts));
