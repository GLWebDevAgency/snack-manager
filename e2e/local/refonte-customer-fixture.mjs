/** Local SSR provider for the actual Next build. Repository demo data only. */
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
import { build } from 'esbuild';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const bundle = await build({ stdin: { contents: "export {demoSite} from './apps/web/src/components/order/demo/fixture';export {DIRECTIONS} from './packages/contracts/dist/index.js';export {seedCustomerBrowserFixture} from './apps/web/src/components/customer-account/browser-journal.fixture';", resolveDir: root, loader: 'ts' }, bundle: true, write: false, format: 'esm', platform: 'node' });
const { demoSite, DIRECTIONS, seedCustomerBrowserFixture } = await import('data:text/javascript;base64,' + Buffer.from(bundle.outputFiles[0].text).toString('base64'));
export { seedCustomerBrowserFixture };
export function customerFixture(slug) {
  const site = demoSite(new Date(), () => 0);
  site.tenant.slug = slug;
  site.tenant.brand = DIRECTIONS[slug.endsWith('-clair') ? 'brasserie' : 'nuit'];
  const catalog = { restaurant: { slug, name: site.tenant.name, brand: site.tenant.brand, brandColor: site.tenant.brandColor, logoUrl: null },
    program: { name: 'Le Club du Comptoir', mechanism: 'points', unitLabelSingular: 'point', unitLabelPlural: 'points', termsSummary: 'Récompenses à demander au comptoir.' }, rewards: [] };
  return { site, catalog };
}
export function startCustomerFixture(port = 3001) {
  const server = createServer((request, response) => {
    const path = new URL(request.url, 'http://localhost').pathname;
    response.setHeader('Content-Type', 'application/json');
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Access-Control-Allow-Origin', '*');
    if (request.method === 'OPTIONS') { response.writeHead(204).end(); return; }
    if (request.method !== 'GET') { response.writeHead(405).end('{"message":"Local visual provider is read only"}'); return; }
    const match = /^\/public\/tenants\/(recette-ui-(?:clair|sombre))\/(site|loyalty|slots)$/.exec(path);
    if (!match) { response.writeHead(404).end('{"message":"Unknown local fixture"}'); return; }
    const fixture = customerFixture(match[1]);
    response.end(JSON.stringify(match[2] === 'site' ? fixture.site : match[2] === 'loyalty' ? fixture.catalog : fixture.site.slots));
  });
  return new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, 'localhost', () => resolve(server)); });
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const server = await startCustomerFixture();
  console.log('Read-only repository fixtures on http://localhost:3001');
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => server.close(() => process.exit(0)));
}
