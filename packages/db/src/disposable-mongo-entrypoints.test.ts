import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { MongoClient } from 'mongodb';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { runCopyDatabase } from './copy-database';

const DISPOSABLE = 'mongodb://127.0.0.1:27017/snackmanager_disposable_classfood_local';
const SOURCE = 'mongodb://readonly.invalid/snackmanager';
// These cases boot a real Node/tsx process. Give the test runner longer than
// the child process's own hard limit, including cold starts on a busy CI host.
const SEED_PROCESS_TIMEOUT_MS = 10_000;
const SEED_TEST_TIMEOUT_MS = 15_000;
afterEach(() => vi.restoreAllMocks());

/** Real CLI processes, intercepted driver ports, and a socket-level refusal.
 * Node 24 synchronous hooks cover dynamic import as well as CommonJS require. */
type SeedFixture = 'none' | 'tenants' | 'public_order_admissions' | 'order_capacity_days' | 'read-error' | 'allowed';
type SeedEntry = 'cli' | 'import' | { loader: 'require' | 'import'; completedReads: boolean };
function runSeed(script: string, uri: string, durableFixture: SeedFixture = 'none', entry: SeedEntry = 'cli') {
  const dir = mkdtempSync(join(tmpdir(), 'sm-seed-gate-'));
  const hook = join(dir, 'deny-connect.cjs');
  const bridge = join(dir, 'mongoose-fixture.cjs');
  const mongoosePath = createRequire(__filename).resolve('mongoose');
  const bridgeUrl = pathToFileURL(bridge).href;
  writeFileSync(bridge, `const mongoose = require(${JSON.stringify(mongoosePath)});
mongoose.connect = async function() {
  if (process.env.SM_TEST_DURABLE_FIXTURE === 'none') throw new Error('TEST_DRIVER_CONNECT_CALLED');
  globalThis.__smSeedReads = [];
  Object.defineProperty(mongoose.connection, 'db', { configurable: true, value: {
    collection: (name) => ({ findOne: async () => {
      globalThis.__smSeedReads.push(name);
      process.stderr.write('TEST_DURABLE_READ:' + name + '\\n');
      if (process.env.SM_TEST_DURABLE_FIXTURE === 'read-error') throw new Error('TEST_READ_ERROR');
      return process.env.SM_TEST_DURABLE_FIXTURE === name ? { _id: 'opaque' } : null;
    } })
  }});
  return mongoose;
};
mongoose.model = function() { throw new Error('TEST_WRITER_REACHED'); };
mongoose.disconnect = async function() { process.stderr.write('TEST_DISCONNECTED\\n'); };
module.exports = mongoose;`, { mode: 0o600 });
  writeFileSync(hook, `const { registerHooks } = require('node:module');
require('node:net').Socket.prototype.connect = function() { throw new Error('TEST_SOCKET_CONNECT_CALLED'); };
registerHooks({ resolve(name, context, nextResolve) {
  if (name === 'mongoose' || name === ${JSON.stringify(mongoosePath)} || name === ${JSON.stringify(pathToFileURL(mongoosePath).href)}) {
    if (context.parentURL !== ${JSON.stringify(bridgeUrl)}) {
      if (process.env.SM_TEST_DURABLE_FIXTURE === 'none') throw new Error('TEST_PREMATURE_DEPENDENCY_LOAD');
      return { url: ${JSON.stringify(bridgeUrl)}, shortCircuit: true };
    }
  }
  if (name === 'argon2' || name === './schemas' || name.endsWith('/src/schemas.ts')
    || name === './password-hash' || name.endsWith('/src/password-hash.ts')) {
    if (process.env.SM_TEST_DURABLE_FIXTURE !== 'allowed'
      || JSON.stringify(globalThis.__smSeedReads) !== JSON.stringify(['tenants', 'public_order_admissions', 'order_capacity_days'])) {
      throw new Error('TEST_PREMATURE_DEPENDENCY_LOAD');
    }
  }
  return nextResolve(name, context);
} });`, { mode: 0o600 });
  try {
    const target = resolve(__dirname, script);
    let args: string[];
    if (typeof entry === 'object') {
      const schema = resolve(__dirname, 'schemas.ts');
      const load = entry.loader === 'require'
        ? `require(${JSON.stringify(schema)})` : `import(${JSON.stringify(pathToFileURL(schema).href)})`;
      const reads = entry.completedReads ? ['tenants', 'public_order_admissions', 'order_capacity_days'] : [];
      args = ['-e', `globalThis.__smSeedReads = ${JSON.stringify(reads)};
        Promise.resolve().then(() => ${load})
          .then(() => console.error('TEST_IMPORT_ESCAPED'))
          .catch(error => { console.error(error.message); process.exitCode = 1; });`];
    } else {
      args = entry === 'import' ? ['-e', `require(${JSON.stringify(target)})`] : [target];
    }
    return spawnSync(process.execPath, ['--require', hook, '--import', 'tsx', ...args], {
      cwd: resolve(__dirname, '..'), encoding: 'utf8', timeout: SEED_PROCESS_TIMEOUT_MS,
      env: { PATH: `${dirname(process.execPath)}:/usr/bin:/bin`, NODE_ENV: 'test', MONGO_URL: uri,
        SM_TEST_DURABLE_FIXTURE: durableFixture },
    });
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

describe('seeds réels : les gardes précèdent les dépendances et les writes', () => {
  it.each(['seed.ts', 'seed-orders.ts'])('%s refuse une base servie avant même de charger le driver', (script) => {
    const result = runSeed(script, 'mongodb://127.0.0.1:27017/snackmanager');
    expect(result.error).toBeUndefined();
    expect(result.signal).toBeNull();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('MONGO_DISPOSABLE_TARGET_REQUIRED');
    expect(result.stderr).not.toContain('TEST_PREMATURE_DEPENDENCY_LOAD');
    expect(result.stderr).not.toContain('TEST_DRIVER_CONNECT_CALLED');
  }, SEED_TEST_TIMEOUT_MS);

  it.each(['seed.ts', 'seed-orders.ts'].flatMap(script =>
    (['tenants', 'public_order_admissions', 'order_capacity_days'] as const).map(collection => ({ script, collection }))))(
    '$script refuse les preuves de $collection avant les dépendances du writer', ({ script, collection }) => {
    const result = runSeed(script, DISPOSABLE, collection);
    expect(result.error).toBeUndefined();
    expect(result.signal).toBeNull();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('MONGO_DURABLE_ORDER_DATA_PRESENT');
    expect(result.stderr).not.toContain('TEST_PREMATURE_DEPENDENCY_LOAD');
    expect(result.stderr).not.toContain('TEST_WRITER_REACHED');
    expect(result.stderr).toContain('TEST_DISCONNECTED');
    const collections = ['tenants', 'public_order_admissions', 'order_capacity_days'];
    expect([...result.stderr.matchAll(/TEST_DURABLE_READ:([a-z_]+)/g)].map(match => match[1]))
      .toEqual(collections.slice(0, collections.indexOf(collection) + 1));
  }, SEED_TEST_TIMEOUT_MS);
  it.each(['seed.ts', 'seed-orders.ts'])('%s ferme une lecture durable échouée sans entrer dans le writer', script => {
    const result = runSeed(script, DISPOSABLE, 'read-error');
    expect(result.error).toBeUndefined(); expect(result.signal).toBeNull(); expect(result.status).toBe(1);
    expect(result.stderr).toContain('MONGO_DURABLE_ORDER_CHECK_FAILED');
    expect(result.stderr).toContain('TEST_DISCONNECTED');
    expect(result.stderr).not.toContain('TEST_WRITER_REACHED');
    expect(result.stderr).not.toContain('TEST_PREMATURE_DEPENDENCY_LOAD');
    expect(result.stderr).not.toContain('TEST_SOCKET_CONNECT_CALLED');
  }, SEED_TEST_TIMEOUT_MS);
  it.each(['seed.ts', 'seed-orders.ts'])('%s atteint le writer seulement après trois contrôles vides, sans écrire', script => {
    const result = runSeed(script, DISPOSABLE, 'allowed');
    expect(result.error).toBeUndefined(); expect(result.signal).toBeNull(); expect(result.status).toBe(1);
    expect(result.stderr).toContain('TEST_WRITER_REACHED');
    expect(result.stderr).toContain('TEST_DISCONNECTED');
    expect(result.stderr).not.toContain('TEST_PREMATURE_DEPENDENCY_LOAD');
    expect(result.stderr).not.toContain('TEST_SOCKET_CONNECT_CALLED');
    expect([...result.stderr.matchAll(/TEST_DURABLE_READ:([a-z_]+)/g)].map(match => match[1]))
      .toEqual(['tenants', 'public_order_admissions', 'order_capacity_days']);
  }, SEED_TEST_TIMEOUT_MS);
  it.each(['seed.ts', 'seed-orders.ts'])('%s reste sans driver ni connexion lors d’un simple import', script => {
    const result = runSeed(script, DISPOSABLE, 'none', 'import');
    expect(result.error).toBeUndefined(); expect(result.signal).toBeNull(); expect(result.status).toBe(0);
    expect(result.stderr).not.toContain('TEST_');
  }, SEED_TEST_TIMEOUT_MS);
});

describe('contre-preuves du harnais : imports refusés sans validation complète', () => {
  it.each((['require', 'import'] as const).flatMap(loader => [
    { loader, fixture: 'allowed' as const, completedReads: false },
    { loader, fixture: 'order_capacity_days' as const, completedReads: true },
  ]))('$loader refuse le writer avec $fixture et completedReads=$completedReads', ({ loader, fixture, completedReads }) => {
    const result = runSeed('seed.ts', DISPOSABLE, fixture, { loader, completedReads });
    expect(result.error).toBeUndefined(); expect(result.signal).toBeNull(); expect(result.status).toBe(1);
    expect(result.stderr).toContain('TEST_PREMATURE_DEPENDENCY_LOAD');
    expect(result.stderr).not.toContain('TEST_IMPORT_ESCAPED');
    expect(result.stderr).not.toContain('TEST_SOCKET_CONNECT_CALLED');
    expect(result.stderr).not.toContain('TEST_WRITER_REACHED');
  }, SEED_TEST_TIMEOUT_MS);
});

describe('copy/purge : la garde précède même l’ouverture de la source', () => {
  it.each([
    { args: ['copy', SOURCE, 'mongodb://127.0.0.1/snackmanager', '--go'] },
    { args: ['copy', SOURCE, 'mongodb://remote.invalid/snackmanager_disposable_classfood_local', '--go'] },
    { args: ['purge', 'mongodb://127.0.0.1/snackmanager', '--go'] },
  ])('refuse $args avant toute connexion', async ({ args }) => {
    const connect = vi.spyOn(MongoClient, 'connect').mockRejectedValue(new Error('No DB allowed in this test'));
    await expect(runCopyDatabase(args)).rejects.toMatchObject({ code: 'MONGO_DISPOSABLE_TARGET_REQUIRED' });
    expect(connect).not.toHaveBeenCalled();
  });

  it('un aperçu distant reste lecture seule disponible et ne demande pas une cible jetable', async () => {
    const connect = vi.spyOn(MongoClient, 'connect').mockRejectedValue(new Error('Read port observed'));
    await expect(runCopyDatabase(['purge', SOURCE])).rejects.toThrow('Read port observed');
    expect(connect).toHaveBeenCalledExactlyOnceWith(SOURCE, { serverSelectionTimeoutMS: 20_000 });
  });

  it.each([
    { args: ['copy', SOURCE, DISPOSABLE, '--go', '--force'] },
    { args: ['copy', SOURCE, DISPOSABLE, '--go', '--go'] },
    { args: ['copy', SOURCE, DISPOSABLE, 'unexpected'] },
    { args: ['purge', DISPOSABLE, '--go', 'unexpected'] },
    { args: ['dump', SOURCE, '/unused', '--go'] },
    { args: ['unknown', SOURCE] },
  ])('une commande ambiguë $args ne se connecte pas', async ({ args }) => {
    const connect = vi.spyOn(MongoClient, 'connect').mockRejectedValue(new Error('No DB allowed in this test'));
    await expect(runCopyDatabase(args)).rejects.toMatchObject({ code: 'MONGO_TOOL_INVALID_ARGUMENTS' });
    expect(connect).not.toHaveBeenCalled();
  });
});

function copyPorts(protectedSide?: 'source' | 'target', lateProtectedBatch = false) {
  const targetDelete = vi.fn(async () => ({ deletedCount: 0 }));
  const targetInsert = vi.fn(async () => ({ insertedCount: 1 }));
  const sourceClose = vi.fn(async () => undefined); const targetClose = vi.fn(async () => undefined);
  const makeDb = (side: 'source' | 'target') => ({
    listCollections: () => ({ toArray: async () => [{ name: 'tenants' }] }),
    collection: (name: string) => ({
      countDocuments: async () => 1,
      findOne: async () => protectedSide === side && name === 'tenants' ? { _id: 'opaque' } : null,
      find: () => ({ toArray: async () => name === 'users' ? [] : [{ _id: 'fixture', slug: 'classfood',
        ...(side === 'source' && lateProtectedBatch ? { capacityControl: { state: 'active' } } : {}) }] }),
      deleteMany: side === 'target' ? targetDelete : vi.fn(() => { throw new Error('Source must remain read-only'); }),
      insertMany: side === 'target' ? targetInsert : vi.fn(() => { throw new Error('Source must remain read-only'); }),
    }),
  });
  const source = { db: () => makeDb('source'), close: sourceClose } as unknown as MongoClient;
  const target = { db: () => makeDb('target'), close: targetClose } as unknown as MongoClient;
  const connect = vi.spyOn(MongoClient, 'connect').mockResolvedValueOnce(source).mockResolvedValueOnce(target);
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  return { connect, targetDelete, targetInsert, sourceClose, targetClose };
}

describe('copie locale : preuves durables refusées, même dans le batch effectivement lu', () => {
  it.each(['source', 'target'] as const)('une preuve côté %s empêche la première suppression et ferme les connexions', async (side) => {
    const port = copyPorts(side);
    await expect(runCopyDatabase(['copy', SOURCE, DISPOSABLE, '--go']))
      .rejects.toMatchObject({ code: 'MONGO_DURABLE_ORDER_DATA_PRESENT' });
    expect(port.targetDelete).not.toHaveBeenCalled();
    expect(port.targetInsert).not.toHaveBeenCalled();
    expect(port.sourceClose).toHaveBeenCalledTimes(1);
    expect(port.targetClose).toHaveBeenCalledTimes(1);
  });

  it('un contrôle apparu dans les documents lus après le précontrôle n’est jamais recopié actif', async () => {
    const port = copyPorts(undefined, true);
    await expect(runCopyDatabase(['copy', SOURCE, DISPOSABLE, '--go']))
      .rejects.toMatchObject({ code: 'MONGO_DURABLE_ORDER_DATA_PRESENT' });
    expect(port.targetDelete).not.toHaveBeenCalled();
    expect(port.targetInsert).not.toHaveBeenCalled();
  });

  it('une copie sans preuves ne peut pas découvrir une autre cible via un replica set', async () => {
    const port = copyPorts();
    await runCopyDatabase(['copy', SOURCE, DISPOSABLE, '--go']);
    expect(port.connect).toHaveBeenNthCalledWith(2, DISPOSABLE,
      { serverSelectionTimeoutMS: 20_000, directConnection: true });
    expect(port.targetDelete).toHaveBeenCalledTimes(1);
    expect(port.targetInsert).toHaveBeenCalledTimes(1);
  });
});
