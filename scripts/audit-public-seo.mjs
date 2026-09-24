#!/usr/bin/env node
/**
 * Audit HTTP public en lecture seule, sans dépendance ni exécution JavaScript.
 *
 * Usage :
 *   node scripts/audit-public-seo.mjs https://snackmanager.fr https://snackmanager.fr
 *   node scripts/audit-public-seo.mjs http://localhost:3196 https://snackmanager.fr --noindex
 *   node scripts/audit-public-seo.mjs https://staging.snackmanager.fr https://staging.snackmanager.fr --noindex
 *
 * Les deux arguments sont des origines HTTP(S), sans identifiants, chemin,
 * recherche ni fragment. --noindex exige X-Robots-Tag sur les pages publiques
 * (staging, preview ou serveur de développement). Sans lui, noindex est refusé.
 * Les articles sont découverts depuis /blog, hors /blog/la-redaction ; au moins
 * cinq sont attendus. Les URL d'images sont toujours rebassées sur l'origine
 * auditée. Aucun lien de source, formulaire, callback ou outil de suivi n'est
 * appelé. Les redirections ne sont pas suivies. Aucun fichier n'est écrit.
 *
 * Ce contrôle vérifie le HTML reçu et les marqueurs statiques de masquage,
 * pas les styles calculés, l'hydratation, l'indexation Google ou le classement.
 * Sortie : 0 si tous les contrats passent, 1 si échec, 2 si arguments invalides.
 */

const USAGE = 'Usage : node scripts/audit-public-seo.mjs <baseURL> <expectedCanonicalOrigin> [--noindex]';
const argv = process.argv.slice(2);
if (argv.length === 1 && ['--help', '-h'].includes(argv[0])) {
  console.log(`${USAGE}\nGET anonymes uniquement ; --noindex pour staging/local. Aucun fichier écrit.`);
  process.exit(0);
}
function originArgument(raw) {
  const url = new URL(raw);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password
    || url.pathname !== '/' || url.search || url.hash) throw new Error('Origine HTTP(S) attendue, sans identifiants ni chemin.');
  return url.origin;
}
let baseOrigin;
let canonicalOrigin;
try {
  if (argv.length < 2 || argv.length > 3 || (argv[2] && argv[2] !== '--noindex')) throw new Error(USAGE);
  baseOrigin = originArgument(argv[0]);
  canonicalOrigin = originArgument(argv[1]);
} catch (error) {
  console.error(`${error.message}\n${USAGE}`);
  process.exit(2);
}
const expectNoindex = argv[2] === '--noindex';
const TIMEOUT_MS = 25_000;
const MAX_BYTES = 8 * 1024 * 1024;
const responses = new Map();
const groups = [];
const articleDates = new Map();

function group(label) {
  const result = { label, count: 0, failures: [] };
  groups.push(result);
  result.check = (condition, message) => {
    result.count++;
    if (!condition) result.failures.push(message);
    return Boolean(condition);
  };
  return result;
}
async function runGroup(label, work) {
  const result = group(label);
  try { await work(result); } catch (error) { result.check(false, error.message); }
}
async function get(path) {
  const url = new URL(path, baseOrigin);
  if (url.origin !== baseOrigin) throw new Error('Requête hors de l’origine auditée refusée.');
  if (!responses.has(url.href)) responses.set(url.href, (async () => {
    const response = await fetch(url, {
      method: 'GET', redirect: 'manual', signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { 'User-Agent': 'SnackManager-Public-SEO-Audit/1.0', Accept: '*/*' },
    });
    const chunks = [];
    let size = 0;
    for await (const chunk of response.body ?? []) {
      size += chunk.byteLength;
      if (size > MAX_BYTES) throw new Error(`Réponse trop volumineuse : ${url.pathname}`);
      chunks.push(chunk);
    }
    const bytes = Buffer.concat(chunks);
    return { status: response.status, headers: response.headers, bytes, text: () => bytes.toString('utf8') };
  })());
  return responses.get(url.href);
}
function decode(value = '') {
  return value.replace(/&#(x[\da-f]+|\d+);/gi, (_, code) => {
    const point = code[0].toLowerCase() === 'x' ? parseInt(code.slice(1), 16) : Number(code);
    return point <= 0x10ffff ? String.fromCodePoint(point) : '\ufffd';
  }).replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');
}
const textOf = (value = '') => decode(value.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
function attributes(tag) {
  const pairs = [...tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)];
  return Object.fromEntries(pairs.map((m) => [m[1].toLowerCase(), decode(m[2] ?? m[3] ?? m[4])]));
}
const tags = (html, name) => [...html.matchAll(new RegExp(`<${name}\\b[^>]*>`, 'gi'))].map((match) => attributes(match[0]));
const isType = (node, type) => [node?.['@type']].flat().includes(type);
function schemaNodes(value) {
  if (Array.isArray(value)) return value.flatMap(schemaNodes);
  if (value && typeof value === 'object') return [value, ...schemaNodes(value['@graph'] ?? [])];
  return [];
}
function schemas(html, result) {
  const blocks = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)]
    .filter((match) => attributes(match[1]).type === 'application/ld+json');
  result.check(blocks.length > 0, 'JSON-LD absent.');
  return blocks.flatMap((match) => {
    try { const parsed = JSON.parse(match[2]); result.check(true, ''); return schemaNodes(parsed); }
    catch { result.check(false, 'Bloc JSON-LD invalide.'); return []; }
  });
}
function absoluteHttp(value) {
  try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password; }
  catch { return false; }
}
const absoluteCanonical = (path) => new URL(path, canonicalOrigin).href;
function sameUrl(actual, expected) {
  try { return new URL(actual).href === new URL(expected).href; } catch { return false; }
}
function pageContract(response, path, result) {
  if (!result.check(response.status === 200, `HTTP ${response.status}, attendu 200.`)) return null;
  result.check(response.headers.get('content-type')?.includes('text/html'), 'Content-Type HTML absent.');
  const html = response.text();
  const metadata = tags(html, 'meta');
  const values = (name) => metadata.filter((meta) => (meta.property ?? meta.name)?.toLowerCase() === name).map((meta) => meta.content ?? '');
  const canonicals = tags(html, 'link').filter((link) => link.rel === 'canonical').map((link) => link.href);
  result.check(canonicals.length === 1 && sameUrl(canonicals[0], absoluteCanonical(path)), `Canonical unique attendue : ${absoluteCanonical(path)}.`);
  const headings = [...html.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/gi)].map((match) => textOf(match[1]));
  result.check(headings.length === 1 && Boolean(headings[0]), `Un H1 non vide attendu ; reçu ${headings.length}.`);
  result.check(Boolean(textOf(html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1])), 'Titre HTML absent.');
  const headerNoindex = /\bnoindex\b/i.test(response.headers.get('x-robots-tag') ?? '');
  const metaNoindex = [...values('robots'), ...values('googlebot')].some((value) => /\b(noindex|none)\b/i.test(value));
  result.check(expectNoindex ? headerNoindex : !headerNoindex && !metaNoindex,
    expectNoindex ? 'X-Robots-Tag noindex attendu.' : 'Page publique exclue de l’index par meta ou en-tête.');
  return { html, values, headings, nodes: schemas(html, result) };
}
function imageUrl(value) {
  if (Array.isArray(value)) return value.flatMap(imageUrl);
  if (typeof value === 'string') return [value];
  return value && typeof value === 'object' ? imageUrl(value.url ?? value.contentUrl) : [];
}
async function verifyImages(page, result, sourceImages = []) {
  const og = page.values('og:image');
  const twitter = page.values('twitter:image');
  result.check(og.length > 0, 'Image Open Graph absente.');
  result.check(twitter.length > 0, 'Image Twitter absente.');
  for (const source of sourceImages) {
    result.check(absoluteHttp(source), 'L’image JSON-LD doit avoir une URL HTTP(S) absolue.');
    result.check(og.some((url) => sameUrl(url, source)) && twitter.some((url) => sameUrl(url, source)), 'Image JSON-LD différente des images OG/Twitter.');
  }
  const unique = [...new Set([...og, ...twitter, ...sourceImages])];
  for (const raw of unique) {
    let image;
    try { image = new URL(raw, canonicalOrigin); } catch { result.check(false, 'URL d’image invalide.'); continue; }
    if (!result.check(absoluteHttp(image.href), 'URL d’image HTTP(S) sans identifiants attendue.')) continue;
    // Only declared image routes are fetched, always on the audited origin.
    const imagePath = image.pathname;
    if (!result.check(/^(?:\/blog\/(?:[a-z0-9-]+\/)?partage\/?$|\/(?:opengraph-image|twitter-image)(?:[./-]|$)|\/(?:photos|images|assets)\/)/i.test(imagePath),
      `Route d’image non autorisée par l’audit : ${imagePath}.`)) continue;
    try {
      const response = await get(`${imagePath}${image.search}`);
      result.check(response.status === 200, `Image ${imagePath} : HTTP ${response.status}.`);
      const png = response.bytes.length >= 24 && response.bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
        && response.bytes.toString('ascii', 12, 16) === 'IHDR';
      result.check(response.headers.get('content-type')?.split(';')[0] === 'image/png' && png, `Image ${imagePath} : PNG valide attendu.`);
      if (png) result.check(response.bytes.readUInt32BE(16) === 1200 && response.bytes.readUInt32BE(20) === 630,
        `Image ${imagePath} : 1200 × 630 attendu.`);
    } catch (error) { result.check(false, `Image ${imagePath} : ${error.message}`); }
  }
}
function articleMarkup(html, result) {
  const articles = [...html.matchAll(/<article\b[^>]*>([\s\S]*?)<\/article>/gi)];
  result.check(articles.length === 1, 'Un élément article attendu.');
  if (!articles[0]) return;
  const markup = articles[0][0];
  const elements = [...markup.matchAll(/<[a-z][^>]*>/gi)];
  const hidden = elements.some(([tag]) => {
    const attrs = attributes(tag);
    const classes = (attrs.class ?? '').split(/\s+/);
    return classes.some((value) => ['rv', 'hidden', 'invisible', 'opacity-0'].includes(value))
      || /(?:^|\s)hidden(?:\s|=|>|\/)/i.test(tag)
      || /(?:^|;)\s*(?:display\s*:\s*none|visibility\s*:\s*hidden|opacity\s*:\s*0(?:\s*!important)?\s*(?:;|$))/i.test(attrs.style ?? '');
  });
  result.check(!hidden, 'Article masqué dans le HTML statique (.rv, hidden ou style).');
  const ids = new Set(elements.map(([tag]) => attributes(tag).id).filter(Boolean));
  const toc = [...markup.matchAll(/<nav\b([^>]*)>([\s\S]*?)<\/nav>/gi)]
    .find((match) => /sommaire/i.test(attributes(match[1])['aria-label'] ?? ''));
  result.check(Boolean(toc), 'Sommaire identifiable absent.');
  const links = toc ? tags(toc[2], 'a').map((link) => link.href) : [];
  result.check(links.length > 0 && links.every((href) => href?.startsWith('#') && ids.has(decodeURIComponent(href.slice(1)))),
    'Les liens du sommaire doivent viser des identifiants présents dans l’article.');
}

console.log(`Audit HTTP SEO : ${baseOrigin} · canonical ${canonicalOrigin} · ${expectNoindex ? 'noindex attendu' : 'public'}\n`);
let articlePaths = [];
await runGroup('/blog', async (result) => {
  const page = pageContract(await get('/blog'), '/blog', result);
  if (!page) return;
  result.check(page.nodes.some((node) => isType(node, 'Blog') && sameUrl(node.url ?? node['@id'], absoluteCanonical('/blog'))), 'JSON-LD Blog correspondant absent.');
  articlePaths = [...new Set(tags(page.html, 'a').flatMap(({ href }) => {
    try {
      const url = new URL(href, baseOrigin);
      return [baseOrigin, canonicalOrigin].includes(url.origin) && /^\/blog\/[a-z0-9-]+\/?$/.test(url.pathname)
        && url.pathname.replace(/\/$/, '') !== '/blog/la-redaction' ? [url.pathname.replace(/\/$/, '')] : [];
    } catch { return []; }
  }))];
  result.check(articlePaths.length >= 5, `Au moins cinq articles attendus, découverts : ${articlePaths.length}.`);
  await verifyImages(page, result);
});

for (const path of articlePaths) await runGroup(path, async (result) => {
  const page = pageContract(await get(path), path, result);
  if (!page) return;
  const url = absoluteCanonical(path);
  const postings = page.nodes.filter((node) => isType(node, 'BlogPosting'));
  result.check(postings.length === 1, 'Un BlogPosting attendu.');
  const posting = postings[0];
  if (posting) {
    result.check(sameUrl(posting.url, url) && sameUrl(posting.mainEntityOfPage?.['@id'] ?? posting.mainEntityOfPage, url), 'URL BlogPosting/mainEntityOfPage différente de la canonical.');
    result.check(textOf(posting.headline) === page.headings[0], 'Le headline JSON-LD diffère du H1.');
    const authors = [posting.author].flat().filter(Boolean);
    result.check(authors.length > 0 && authors.every((author) => absoluteHttp(author.url)), 'URL absolue d’auteur absente.');
    result.check(typeof posting.dateModified === 'string' && !Number.isNaN(Date.parse(posting.dateModified)), 'dateModified invalide ou absente.');
    if (posting.dateModified) articleDates.set(url, posting.dateModified);
  }
  const breadcrumb = page.nodes.find((node) => isType(node, 'BreadcrumbList'));
  const items = breadcrumb?.itemListElement ?? [];
  const itemUrl = (item) => typeof item?.item === 'string' ? item.item : item?.item?.['@id'];
  result.check(Array.isArray(items) && items.length >= 3 && sameUrl(itemUrl(items.at(-1)), url)
    && items.some((item) => sameUrl(itemUrl(item), absoluteCanonical('/blog')))
    && items.every((item, index) => item.position === index + 1), 'Fil d’Ariane JSON-LD incomplet ou différent de l’article.');
  articleMarkup(page.html, result);
  const sourceImages = imageUrl(posting?.image);
  result.check(sourceImages.length > 0, 'Image source JSON-LD absente.');
  await verifyImages(page, result, sourceImages);
});

await runGroup('/robots.txt', async (result) => {
  const response = await get('/robots.txt');
  result.check(response.status === 200, `HTTP ${response.status}, attendu 200.`);
  const body = response.text();
  const rules = [];
  let agents = [];
  let hasRules = false;
  for (const line of body.split(/\r?\n/)) {
    const match = line.replace(/#.*$/, '').trim().match(/^(user-agent|allow|disallow)\s*:\s*(.*)$/i);
    if (!match) continue;
    if (match[1].toLowerCase() === 'user-agent') {
      if (hasRules) { agents = []; hasRules = false; }
      agents.push(match[2].toLowerCase());
    } else {
      hasRules = true;
      if (agents.includes('*') && match[2]) rules.push({ allow: match[1].toLowerCase() === 'allow', path: match[2] });
    }
  }
  result.check(rules.some((rule) => rule.allow && rule.path === '/'), 'Allow: / pour User-agent: * absent.');
  for (const path of ['/blog', ...articlePaths, '/admin', '/sm']) {
    const matches = rules.filter((rule) => {
      const end = rule.path.endsWith('$');
      const source = (end ? rule.path.slice(0, -1) : rule.path).split('*').map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*');
      return new RegExp(`^${source}${end ? '$' : ''}`).test(path);
    }).sort((a, b) => b.path.replace(/\*/g, '').length - a.path.replace(/\*/g, '').length || Number(b.allow) - Number(a.allow));
    result.check(!matches[0] || matches[0].allow, `Exploration bloquée : ${path}.`);
  }
  const advertised = [...body.matchAll(/^sitemap:\s*(.+)$/gim)].map((match) => match[1].trim());
  result.check(expectNoindex ? advertised.length === 0 : advertised.some((url) => sameUrl(url, absoluteCanonical('/sitemap.xml'))),
    expectNoindex ? 'Un environnement noindex annonce encore un sitemap.' : 'Sitemap public non annoncé.');
});

await runGroup('/sitemap.xml', async (result) => {
  const response = await get('/sitemap.xml');
  result.check(response.status === 200, `HTTP ${response.status}, attendu 200.`);
  const entries = [...response.text().matchAll(/<url\b[^>]*>([\s\S]*?)<\/url>/gi)].map((match) => ({
    loc: decode(match[1].match(/<loc>(.*?)<\/loc>/)?.[1] ?? ''),
    modified: decode(match[1].match(/<lastmod>(.*?)<\/lastmod>/)?.[1] ?? ''),
  }));
  result.check(entries.length > 0 && new Set(entries.map(({ loc }) => loc)).size === entries.length, 'Sitemap vide ou URL dupliquées.');
  result.check(entries.every(({ loc }) => absoluteHttp(loc) && new URL(loc).origin === canonicalOrigin), 'Origine inattendue dans le sitemap.');
  result.check(entries.every(({ loc }) => !/^\/(admin|sm)(\/|$)/.test(new URL(loc).pathname)), 'Route admin/sm présente dans le sitemap.');
  for (const path of articlePaths) {
    const url = absoluteCanonical(path);
    const entry = entries.find(({ loc }) => sameUrl(loc, url));
    result.check(Boolean(entry) && Boolean(articleDates.get(url)) && entry.modified === articleDates.get(url), `lastmod incohérent avec dateModified : ${path}.`);
  }
  const maximum = [...articleDates.values()].sort().at(-1);
  result.check(Boolean(maximum) && entries.find(({ loc }) => sameUrl(loc, absoluteCanonical('/blog')))?.modified === maximum,
    'lastmod du blog différent de la dernière révision des articles.');
});

for (const path of ['/admin', '/sm']) await runGroup(path, async (result) => {
  const response = await get(path);
  result.check(response.status < 500, `Erreur serveur HTTP ${response.status}.`);
  result.check(/\bnoindex\b/i.test(response.headers.get('x-robots-tag') ?? ''), 'X-Robots-Tag noindex absent.');
});
await runGroup('/blog/article-audit-seo-inexistant-00000000', async (result) => {
  const response = await get('/blog/article-audit-seo-inexistant-00000000');
  result.check(response.status === 404, `HTTP ${response.status}, attendu 404 pour un slug inconnu.`);
});

for (const result of groups) {
  console.log(`${result.failures.length ? 'FAIL' : 'PASS'} ${result.label} (${result.count - result.failures.length}/${result.count})`);
  for (const failure of result.failures) console.log(`  - ${failure.replace(/[\r\n\u0000-\u001f\u007f]/g, ' ')}`);
}
const total = groups.reduce((sum, result) => sum + result.count, 0);
const failed = groups.reduce((sum, result) => sum + result.failures.length, 0);
console.log(`\n${total - failed}/${total} contrôles réussis · ${articlePaths.length} articles · ${responses.size} GET uniques · ${new Date().toISOString()}`);
process.exitCode = failed ? 1 : 0;
