import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const { createStaticServer } = require('./server.js');

let root;
let server;
let port;

function request(rawPath) {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port, path: rawPath }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        body += chunk;
      });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
    });
    req.on('error', reject);
  });
}

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'sm-kds-static-'));
  await writeFile(path.join(root, 'index.html'), '<main>KDS</main>');
  await writeFile(path.join(root, 'menu.json'), '{"ok":true}');
  await writeFile(path.join(root, 'app-0123456789abcdef.js'), 'export default 1');
  await writeFile(path.join(root, '%'), 'percent');
  server = createStaticServer({ root });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = server.address().port;
});

afterEach(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  if (root) await rm(root, { recursive: true, force: true });
});

describe('serveur web KDS', () => {
  it.each(['/%', '/%0', '/%ZZ', '/%E0%A4%A', '/%80', '/%C3%28', '/%C0%AF', '/%ED%A0%80', '/%F4%90%80%80'])(
    'refuse %s sans arrêter le serveur',
    async (malformed) => {
      expect(await request(malformed)).toMatchObject({ status: 400, body: 'Bad Request' });
      expect(await request('/')).toMatchObject({ status: 200, body: '<main>KDS</main>' });
    },
  );

  it('ignore une query mal encodée et ne décode une URL valide qu’une fois', async () => {
    expect(await request('/?bad=%')).toMatchObject({ status: 200, body: '<main>KDS</main>' });
    expect(await request('/%25')).toMatchObject({ status: 200, body: 'percent' });
  });

  it('préserve le repli SPA, les types et les politiques de cache', async () => {
    expect(await request('/route-inconnue')).toMatchObject({ status: 200, body: '<main>KDS</main>' });
    expect(await request('/menu.json')).toMatchObject({
      status: 200,
      headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-cache' },
    });
    expect(await request('/app-0123456789abcdef.js')).toMatchObject({
      status: 200,
      headers: { 'cache-control': 'public, max-age=31536000, immutable' },
    });
  });

  it('ne confond pas un dossier voisin dist-* avec un enfant de la racine', async () => {
    const sibling = `${root}-escape`;
    await mkdir(sibling);
    await writeFile(path.join(sibling, 'secret.txt'), 'secret');
    try {
      const siblingName = path.basename(sibling);
      expect(await request(`/%2e%2e/${siblingName}/secret.txt`)).toMatchObject({
        status: 200,
        body: '<main>KDS</main>',
      });
    } finally {
      await rm(sibling, { recursive: true, force: true });
    }
  });

  it('rend une erreur bornée si le fichier SPA est absent, puis reste disponible', async () => {
    await rm(path.join(root, 'index.html'));
    expect(await request('/inconnue')).toMatchObject({ status: 500, body: 'Internal Server Error' });
    expect(await request('/menu.json')).toMatchObject({ status: 200, body: '{"ok":true}' });
  });
});
