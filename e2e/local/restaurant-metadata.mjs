#!/usr/bin/env node
// Vrai Next local + API de fixtures publiques, sans staging ni fournisseur.
// À lancer EN SÉRIE avec checkout-recovery.mjs : .next/dev est partagé.
// Node >=24.12, packages/contracts déjà compilé, Playwright déjà installé.
// QA_NEXT_START_CONFIRMED=yes node e2e/local/restaurant-metadata.mjs
// QA_SCENARIO=all (défaut), restaurant, loyalty, neutral, isolation, platform ou unavailable.
// Le Host HTTP simule le domaine ; cette recette ne valide ni DNS/TLS, ni
// hydratation/navigation cliente, ni installation PWA. Les polices sont locales.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { createServer, request } from 'node:http';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const [major, minor] = process.versions.node.split('.').map(Number);
assert.ok(major > 24 || (major === 24 && minor >= 12), 'Node >=24.12 est requis.');
assert.equal(process.env.QA_NEXT_START_CONFIRMED, 'yes', 'Confirmer le créneau Next avec QA_NEXT_START_CONFIRMED=yes (.next/dev partagé).');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(join(root, 'package.json'));
const { chromium } = require('playwright');
const { DIRECTIONS, LoyaltyPublicProgramSchema } = require(join(root, 'packages/contracts/dist/index.js'));
const webPort = port('QA_WEB_PORT', 3220);
const apiPort = port('QA_API_PORT', 3221);
assert.notEqual(webPort, apiPort, 'Les ports web et API doivent être distincts.');
const apiOrigin = `http://127.0.0.1:${apiPort}`;
const platformHost = `localhost:${webPort}`;
const customHost = `classfood.example:${webPort}`;
const otherHost = `atelier.example:${webPort}`;
const unknownHost = `unknown.example:${webPort}`;
const allowedHosts = new Set([platformHost, customHost, otherHost, unknownHost]);
const directory = await mkdtemp(join(tmpdir(), 'sm-restaurant-metadata-'));
const requests = [];
const responses = [];
const documents = [];
const scenarios = [];
const unexpected = [];
const browserErrors = [];
let next;
let browser;
let parser;
let nextLog = '';
let failure;

const slot = new Date(Date.now() + 90 * 60_000).toISOString();
const slots = { date: new Intl.DateTimeFormat('fr-CA', { timeZone: 'Europe/Paris' }).format(new Date(slot)),
  timezone: 'Europe/Paris', intervalMin: 10, capacity: 10, leadTimeMin: 20,
  slots: [{ iso: slot, label: '20:00', service: 'dinner', remaining: 10, full: false, load: 'calm' }],
  closedToday: false, nextOpenDate: null, closureReason: null, paused: false };
function restaurant(slug, name, brand) {
  const tenant = { slug, name, brand, brandColor: brand.palette.accent, logoUrl: null,
    address: '12 rue de la Recette', phones: [],
    hours: [1, 2, 3, 4, 5, 6, 7].map(day => ({ day, lunch: { open: '00:00', close: '23:59' }, dinner: null })) };
  const site = { tenant, menu: { categories: [{ id: 'desserts', name: 'Desserts', products: [{
    id: '507f1f77bcf86cd799439010', name: 'Tarte de recette', description: 'Dessert local de fixture.', price: 300,
    active: true, variants: [], optionGroups: [], removables: [], supplements: [], tags: [], outOfStock: false,
  }] }] }, medias: [], slots, reviews: { avg: 0, count: 0, latest: [] }, ordering: { paused: false, message: null },
  openNow: true, todayHours: tenant.hours[0], timezone: 'Europe/Paris' };
  const loyalty = LoyaltyPublicProgramSchema.parse({
    restaurant: { slug, name, brand, brandColor: tenant.brandColor, logoUrl: null },
    program: { name: 'La carte de recette', mechanism: 'points', unitLabelSingular: 'point', unitLabelPlural: 'points', termsSummary: 'Programme fictif local.' },
    rewards: [],
  });
  return { tenant, site, loyalty };
}
const fixtures = new Map([
  ['classfood', restaurant('classfood', 'Classfood Recette', DIRECTIONS.nuit)],
  ['atelier', restaurant('atelier', 'Atelier Recette', DIRECTIONS.soleil)],
]);
const api = createServer((req, res) => {
  const url = new URL(req.url, apiOrigin);
  requests.push({ method: req.method, path: url.pathname });
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  const send = (status, body) => { res.writeHead(status); res.end(JSON.stringify(body)); };
  if (req.method !== 'GET') {
    unexpected.push(`Méthode API interdite : ${req.method} ${url.pathname}`);
    req.resume();
    return send(405, { message: 'Fixture en lecture seule.' });
  }
  if (url.pathname === '/public/resolve') {
    const slug = ({ 'classfood.example': 'classfood', 'atelier.example': 'atelier' })[url.searchParams.get('host')];
    return slug ? send(200, { slug }) : send(404, { message: 'Domaine inconnu.' });
  }
  if (url.pathname === '/public/platform/social') return send(200, {});
  // Pannes attendues et bornées : jamais un 404 générique accepté pour une
  // route oubliée par le harnais. Le deuxième restaurant existe, sans fidélité.
  if (/^\/public\/tenants\/inconnu(?:\/(?:site|loyalty|menu|slots))?$/.test(url.pathname)) {
    return send(404, { message: 'Restaurant inconnu dans la fixture.' });
  }
  if (url.pathname === '/public/tenants/atelier/loyalty') return send(404, { message: 'Programme inactif dans la fixture.' });
  const match = /^\/public\/tenants\/([^/]+)(?:\/(site|loyalty|slots))?$/.exec(url.pathname);
  const fixture = match && fixtures.get(match[1]);
  if (fixture) return send(200, match[2] === 'slots' ? slots : fixture[match[2] ?? 'tenant']);
  unexpected.push(`Route API non prévue : ${req.method} ${url.pathname}`);
  return send(404, { message: 'Route absente de la fixture.' });
});

// Le socket reste TOUJOURS en loopback, même lorsqu'un href est absolu.
// Aucun redirect n'est suivi et aucun href d'un autre hôte n'est accepté.
async function get(host, path, headers = {}) {
  assert.ok(allowedHosts.has(host), 'Hôte hors fixture.');
  const url = new URL(path, `http://${host}`);
  assert.equal(url.protocol, 'http:');
  assert.equal(url.host, host, 'Une métadonnée pointe vers un hôte étranger.');
  assert.equal(url.username + url.password + url.hash, '', 'Pas de credentials ni fragment dans les ressources.');
  const result = await new Promise((resolve, reject) => {
    const req = request({ hostname: '127.0.0.1', port: webPort, method: 'GET', path: url.pathname + url.search,
      // Hard-refresh documenté par Next dev : réutiliser les bundles disque,
      // mais jamais le catalogue API d'une précédente exécution de fixture.
      headers: { Host: host, Accept: '*/*', 'Cache-Control': 'no-cache', 'User-Agent': 'Mozilla/5.0 RestaurantMetadataFixture', ...headers } }, res => {
      const chunks = [];
      let bytes = 0;
      res.on('data', chunk => {
        bytes += chunk.length;
        if (bytes > 12 * 1024 * 1024) { res.destroy(new Error('Réponse fixture trop volumineuse.')); return; }
        chunks.push(chunk);
      });
      res.once('error', reject);
      res.once('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.setTimeout(90_000, () => req.destroy(new Error(`Délai HTTP dépassé : ${url.pathname}`)));
    req.once('error', reject);
    req.end();
  });
  responses.push({ host, path: url.pathname + url.search, status: result.status,
    contentType: result.headers['content-type'] ?? null, location: result.headers.location ?? null, bytes: result.body.length,
    sha256: createHash('sha256').update(result.body).digest('hex') });
  return result;
}
const mime = response => String(response.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
async function html(host, path, expectedStatus = 200, notFoundHeading) {
  const response = await get(host, path);
  if (expectedStatus === 404 && response.status === 200) {
    assert.ok(notFoundHeading, 'Une 404 streamée doit avoir un écran et un noindex vérifiés.');
  } else assert.equal(response.status, expectedStatus, `HTML attendu : ${host}${path}`);
  assert.equal(mime(response), 'text/html');
  const document = await parser.evaluate(source => {
    // Document INERTE, jamais inséré : seule la sortie HTML du vrai Next est
    // analysée. Inclure le body pour les metadata streamées par Next.
    const doc = new DOMParser().parseFromString(source, 'text/html');
    return { title: doc.title, text: doc.body.textContent?.replace(/\s+/g, ' ').slice(0, 20_000) ?? '',
      links: [...doc.querySelectorAll('link[rel]')].filter(link => /(?:^|\s)(?:icon|apple-touch-icon|apple-touch-icon-precomposed|manifest)(?:\s|$)/i.test(link.rel))
        .map(link => ({ rel: link.rel.toLowerCase(), href: link.getAttribute('href'), type: link.getAttribute('type') })),
      themes: [...doc.querySelectorAll('meta[name="theme-color"]')].map(meta => meta.content),
      robots: [...doc.querySelectorAll('meta[name="robots"]')].map(meta => meta.content),
      descriptions: [...doc.querySelectorAll('meta[name="description"]')].map(meta => meta.content),
      headings: [...doc.querySelectorAll('h1')].map(heading => heading.textContent?.replace(/\s+/g, ' ').trim()),
      notFoundFallback: doc.querySelector('meta[name="next-error"]')?.getAttribute('content') === 'not-found'
        && doc.querySelector('template[data-next-error-digest]')?.getAttribute('data-next-error-digest') === 'NEXT_HTTP_ERROR_FALLBACK;404',
      error: !!doc.querySelector('html#__next_error__') };
  }, response.body.toString());
  documents.push({ host, path, status: response.status, ...document, text: undefined });
  if (expectedStatus === 404) await writeFile(join(directory, `${path.slice(1).replaceAll('/', '-')}.html`), response.body);
  if (expectedStatus === 200) assert.equal(document.error, false, 'Next a rendu son écran d’erreur.');
  if (notFoundHeading) {
    // Next dev peut rendre sa coquille HTTP404 avant la frontière cliente.
    // Elle reste prouvée par le statut ET deux marqueurs propres notFound.
    // Un HTTP200 streamé n'obtient JAMAIS cette exception : son h1 doit exister.
    assert.ok(document.headings.includes(notFoundHeading) || (response.status === 404 && document.notFoundFallback), 'Écran introuvable absent : ni h1 rendu ni fallback HTTP404 explicite.');
    assert.ok(document.robots.some(value => /(?:^|[\s,])noindex(?:$|[\s,])/.test(value)), 'Une page introuvable doit être noindex, y compris après streaming HTTP200.');
  }
  assert.ok(document.text.trim().length > 30, 'La page rendue est vide.');
  return document;
}
const icons = document => document.links.filter(link => /icon/.test(link.rel));
const manifests = document => document.links.filter(link => link.rel === 'manifest');
function noPlatform(document) {
  for (const link of document.links) {
    assert.ok(link.href, 'Lien de métadonnée vide.');
    const pathname = new URL(link.href, `http://${platformHost}`).pathname;
    assert.ok(!['/favicon.ico', '/icon.svg', '/apple-icon.png', '/manifest.webmanifest'].includes(pathname), `Héritage Snack Manager : ${pathname}`);
  }
  assert.equal(/Snack\s*Manager/i.test(document.title), false, 'Titre plateforme hérité.');
  assert.equal(document.descriptions.some(value => /(?:Snack\s*Manager|La suite qui fait tourner votre snack)/i.test(value)), false, 'Description plateforme héritée.');
}
async function imageResource(host, href, declaredType) {
  if (href.startsWith('data:')) {
    assert.ok(href.startsWith('data:image/svg+xml,'), 'Seul le SVG neutre embarqué est attendu.');
    assert.equal(declaredType, 'image/svg+xml');
    const source = decodeURIComponent(href.slice('data:image/svg+xml,'.length));
    assert.match(source, /^<svg[\s>]/);
    assert.doesNotMatch(source, /<script|<image|(?:href|src)=|snack\s*manager/i);
    return Buffer.from(source);
  }
  const response = await get(host, href);
  assert.equal(response.status, 200, `Icône inaccessible : ${host}${href}`);
  const type = mime(response);
  assert.ok(['image/svg+xml', 'image/png', 'image/x-icon', 'image/vnd.microsoft.icon'].includes(type), `MIME icône inattendu : ${type}`);
  // Les deux MIME ICO sont équivalents ; les autres déclarations doivent être exactes.
  if (declaredType) assert.ok(declaredType === type || ([declaredType, type].every(value => ['image/x-icon', 'image/vnd.microsoft.icon'].includes(value))), 'Type déclaré différent du contenu servi.');
  if (type === 'image/svg+xml') {
    assert.match(response.body.toString(), /<svg[\s>]/);
    assert.doesNotMatch(response.body.toString(), /<html[\s>]/i);
  } else if (type === 'image/png') assert.equal(response.body.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  else assert.equal(response.body.subarray(0, 4).toString('hex'), '00000100');
  return response.body;
}
async function linkedResources(host, document) {
  const output = { icons: [], manifests: [] };
  for (const link of icons(document)) output.icons.push(await imageResource(host, link.href, link.type));
  for (const link of manifests(document)) {
    const response = await get(host, link.href);
    assert.equal(response.status, 200, 'Manifeste inaccessible.');
    assert.equal(mime(response), 'application/manifest+json');
    if (link.type) assert.equal(link.type, mime(response));
    const manifest = JSON.parse(response.body.toString());
    assert.ok(Array.isArray(manifest.icons) && manifest.icons.length > 0, 'Manifeste sans icône.');
    for (const icon of manifest.icons) await imageResource(host, icon.src, icon.type);
    output.manifests.push(manifest);
  }
  return output;
}
function brandedIcon(body, brand) {
  const source = body.toString().toLowerCase();
  assert.ok(source.includes(brand.palette.ground.toLowerCase()), 'Le fond de marque est absent de l’icône.');
  assert.equal(/snack\s*manager/i.test(source), false, 'L’icône porte la marque plateforme.');
}

const cases = {
  async restaurant() {
    const seen = [];
    for (const [host, path, slug] of [[customHost, '/', 'classfood'], [platformHost, '/r/classfood', 'classfood'], [otherHost, '/', 'atelier']]) {
      const fixture = fixtures.get(slug);
      const document = await html(host, path);
      noPlatform(document);
      assert.ok(document.title.includes(fixture.tenant.name), 'Le titre ne suit pas le restaurant.');
      assert.ok(document.themes.includes(fixture.tenant.brand.palette.ground), 'La couleur navigateur ne suit pas la marque.');
      assert.equal(manifests(document).length, 0, 'La commande ne déclare pas de manifeste PWA.');
      assert.equal(icons(document).length, 1, 'Une seule icône restaurant, sans Apple/SM hérité.');
      assert.equal(icons(document)[0].href, `/r/${slug}/icon.svg`);
      const resource = await linkedResources(host, document);
      brandedIcon(resource.icons[0], fixture.tenant.brand);
      seen.push(resource.icons[0]);
    }
    assert.equal(seen[0].equals(seen[1]), true, 'Même restaurant, mêmes octets sur plateforme et domaine.');
    assert.equal(seen[0].equals(seen[2]), false, 'Deux marques différentes ne doivent pas partager leur icône.');
  },
  async loyalty() {
    for (const host of [customHost, platformHost]) {
      const path = '/r/classfood/fidelite';
      const document = await html(host, path);
      noPlatform(document);
      assert.equal(manifests(document).length, 1);
      assert.equal(manifests(document)[0].href, `${path}/manifest.webmanifest`);
      assert.equal(icons(document).length, 1);
      assert.equal(icons(document)[0].href, `${path}/icon.svg`);
      const resource = await linkedResources(host, document);
      const manifest = resource.manifests[0];
      assert.ok(manifest.name.includes(fixtures.get('classfood').tenant.name));
      assert.equal(/snack\s*manager/i.test(JSON.stringify(manifest)), false);
      assert.equal(manifest.start_url, path);
      assert.equal(manifest.scope, path);
      assert.equal(manifest.display, 'standalone');
      assert.equal(manifest.theme_color, DIRECTIONS.nuit.palette.ground);
    }
  },
  async neutral() {
    for (const host of [customHost, platformHost]) for (const path of ['/embed/classfood', '/t/507f1f77bcf86cd799439011']) {
      const document = await html(host, path);
      noPlatform(document);
      assert.equal(manifests(document).length, 0, 'Pas de manifeste plateforme/commande sur embed ou suivi.');
      await linkedResources(host, document);
      if (path.startsWith('/t/')) {
        assert.equal(icons(document).length, 1, 'Sans jeton, seule l’icône neutre embarquée est attendue.');
        assert.ok(icons(document)[0].href.startsWith('data:image/svg+xml,'), 'Sans jeton, pas de marque restaurant devinée.');
        assert.match(document.text, /Suivi indisponible/);
        assert.match(document.text, /Ce lien a perdu sa partie sécurisée/);
      }
    }
    assert.equal(requests.some(entry => entry.path.startsWith('/public/orders/')), false, 'Un suivi sans jeton ne doit pas interroger une commande.');
  },
  async isolation() {
    for (const path of ['/', '/r/classfood/icon.svg', '/icon.svg', '/favicon.ico', '/manifest.webmanifest']) {
      assert.equal((await get(unknownHost, path)).status, 404, `Hôte inconnu accepté : ${path}`);
    }
    // Atelier existe réellement dans la fixture : un 404 prouve le fence du
    // domaine, pas simplement l'absence de ce deuxième restaurant en API.
    for (const path of ['/r/atelier', '/r/atelier/icon.svg', '/r/atelier/fidelite', '/r/atelier/fidelite/icon.svg', '/r/atelier/fidelite/manifest.webmanifest', '/embed/atelier', '/icon.svg', '/favicon.ico', '/apple-icon.png', '/manifest.webmanifest']) {
      assert.equal((await get(customHost, path, { 'Sec-Fetch-Mode': 'cors' })).status, 404, `Hors restaurant autorisé : ${path}`);
    }
    const navigation = await get(customHost, '/r/atelier?obsolete=1', { 'Sec-Fetch-Mode': 'navigate' });
    assert.equal(navigation.status, 308, 'Une navigation hors restaurant est renvoyée à sa racine, pas servie.');
    const location = new URL(navigation.headers.location, `http://${customHost}`);
    assert.equal(location.origin, `http://${customHost}`, 'La navigation doit rester sur le domaine du restaurant.');
    assert.equal(location.pathname, '/');
    assert.equal(location.search, '');
  },
  async platform() {
    const document = await html(platformHost, '/');
    assert.match(document.title, /Snack Manager/);
    for (const href of ['/favicon.ico', '/icon.svg', '/apple-icon.png', '/manifest.webmanifest']) {
      assert.ok(document.links.some(link => link.href === href), `Ancien endpoint plateforme absent : ${href}`);
    }
    const resource = await linkedResources(platformHost, document);
    assert.equal(resource.manifests.length, 1);
    assert.equal(resource.manifests[0].name, 'Snack Manager');
    assert.equal(resource.manifests[0].start_url, '/');
  },
  async unavailable() {
    const failures = [];
    for (const [path, heading] of [
      ['/r/inconnu', 'Ce restaurant n’existe pas'],
      ['/embed/inconnu', 'Commande en ligne indisponible'],
      ['/r/atelier/fidelite', 'Programme fidélité indisponible'],
    ]) {
      try {
        const document = await html(platformHost, path, 404, heading);
        noPlatform(document);
        assert.equal(manifests(document).length, 0, 'Une indisponibilité ne propose pas d’installation PWA.');
        assert.equal(icons(document).length, 1, 'Une indisponibilité conserve seulement l’icône neutre.');
        assert.ok(icons(document)[0].href.startsWith('data:image/svg+xml,'));
        await linkedResources(platformHost, document);
      } catch (error) { failures.push(`${path}: ${error.message}`); }
    }
    assert.deepEqual(failures, [], 'Chaque indisponibilité doit garder une identité publique neutre.');
  },
};
const selection = process.env.QA_SCENARIO ?? 'all';
assert.ok(selection === 'all' || Object.hasOwn(cases, selection), `QA_SCENARIO inconnu : ${selection}`);
try {
  // Hook officiel du next/font installé : aucune requête Google, pas de police
  // téléchargée. Le CSS reste une vraie @font-face valide, sans URL distante.
  const fontMock = join(directory, 'fonts.cjs');
  await writeFile(fontMock, `module.exports = new Proxy({}, { get(_target, key) { return typeof key === 'string' && key.startsWith('https://fonts.googleapis.com/') ? '@font-face { font-family: "Fixture"; src: local("Arial"); }' : undefined; } });\n`);
  await new Promise((resolve, reject) => api.listen(apiPort, '127.0.0.1', resolve).once('error', reject));
  next = spawn(process.execPath, [require.resolve('next/dist/bin/next'), 'dev', '--webpack', '--hostname', '127.0.0.1', '-p', String(webPort)], {
    cwd: join(root, 'apps/web'), env: { ...process.env, NEXT_PUBLIC_API_URL: apiOrigin,
      NEXT_PUBLIC_SITE_URL: `http://${platformHost}`, NEXT_PUBLIC_PRIMARY_DOMAIN: 'platform.example',
      NEXT_PUBLIC_TURNSTILE_SITE_KEY: '', NEXT_TELEMETRY_DISABLED: '1', NEXT_FONT_GOOGLE_MOCKED_RESPONSES: fontMock },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await deadline(new Promise((resolve, reject) => {
    const output = chunk => { nextLog = (nextLog + chunk).slice(-1_000_000); if (/Ready in/.test(nextLog)) resolve(); };
    next.stdout.on('data', output); next.stderr.on('data', output);
    next.once('error', reject);
    next.once('exit', code => reject(new Error(`Next arrêté au démarrage (${code}). Voir le journal local.`)));
  }), 60_000, 'Démarrage Next trop long ; ne pas arrêter un autre serveur pour libérer .next/dev.');
  browser = await chromium.launch({ headless: process.env.QA_HEADED !== '1' });
  const context = await browser.newContext({ serviceWorkers: 'block' });
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    unexpected.push(`Navigation navigateur inattendue : ${route.request().method()} ${url.origin}${url.pathname}`);
    return route.abort('blockedbyclient');
  });
  parser = await context.newPage();
  parser.on('pageerror', error => browserErrors.push(error.message));
  for (const [name, run] of Object.entries(cases)) if (selection === 'all' || selection === name) {
    console.log(`RUN ${name}`);
    await run();
    scenarios.push(name);
  }
  assert.deepEqual(unexpected, [], 'Aucune route, écriture ou navigation hors recette.');
  assert.deepEqual(browserErrors, []);
} catch (error) {
  failure = error;
} finally {
  await browser?.close().catch(() => {});
  if (next && next.exitCode === null && next.signalCode === null) {
    const exited = once(next, 'exit');
    next.kill('SIGTERM');
    try { await deadline(exited, 10_000, 'Arrêt Next lent.'); }
    catch { next.kill('SIGKILL'); await deadline(exited, 5_000, 'Le processus enfant ne s’arrête pas.'); }
  }
  api.closeAllConnections();
  if (api.listening) await new Promise(resolve => api.close(resolve));
  await writeFile(join(directory, 'server.log'), nextLog);
  await writeFile(join(directory, 'http.json'), JSON.stringify({ requests, responses, unexpected, browserErrors }, null, 2));
  await writeFile(join(directory, 'metadata.json'), JSON.stringify(documents, null, 2));
  const result = { result: failure ? 'FAIL' : 'PASS', scenarios, error: failure?.message ?? null,
    real: ['Next dev webpack', 'HTTP loopback avec Host explicite', 'HTML SSR et metadata streamées', 'Routes icônes/manifeste réelles'],
    fixtures: ['Deux restaurants publics et résolution de domaines', 'Polices locales via hook next/font'],
    browser: 'Chromium / Playwright, DOMParser inerte (Browser plugin absent)',
    limits: ['Pas de DNS/TLS réel', 'Pas de rendu hydraté ni installation PWA', 'Pas de staging/provider', 'Aucun compte/commande/token'],
    evidence: directory };
  await writeFile(join(directory, 'result.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
}
if (failure) throw failure;

function port(name, fallback) {
  const value = Number(process.env[name] ?? fallback);
  assert.ok(Number.isInteger(value) && value >= 1024 && value <= 65535, `${name} doit être un port entre 1024 et 65535.`);
  return value;
}
async function deadline(promise, ms, message) {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(message)), ms); })]); }
  finally { clearTimeout(timer); }
}
