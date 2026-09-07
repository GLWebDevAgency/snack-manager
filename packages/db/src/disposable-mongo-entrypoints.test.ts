import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { MongoClient } from 'mongodb';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { runCopyDatabase } from './copy-database';

const DISPOSABLE = 'mongodb://127.0.0.1:27017/snackmanager_disposable_classfood_local';
const SOURCE = 'mongodb://readonly.invalid/snackmanager';
afterEach(() => vi.restoreAllMocks());

/** A real script process with both drivers intercepted: NO socket can open. */
function runSeed(script: string, uri: string, durableFixture = false) {
  const dir = mkdtempSync(join(tmpdir(), 'sm-seed-gate-'));
  const hook = join(dir, 'deny-connect.cjs');
  writeFileSync(hook, `const Module = require('node:module');
const original = Module._load;
Module._load = function(name, ...rest) {
  const loaded = original.call(this, name, ...rest);
  if (name === 'mongoose') {
    loaded.connect = async function() {
      if (process.env.SM_TEST_DURABLE_FIXTURE !== '1') throw new Error('TEST_DRIVER_CONNECT_CALLED');
      Object.defineProperty(loaded.connection, 'db', { configurable: true, value: {
        collection: () => ({ findOne: async () => ({ _id: 'opaque' }) })
      }});
      return loaded;
    };
    loaded.model = function() { throw new Error('TEST_MODEL_CALLED'); };
    loaded.disconnect = async function() {};
  }
  if (name === 'mongodb') loaded.MongoClient.connect = async function() { throw new Error('TEST_DRIVER_CONNECT_CALLED'); };
  return loaded;
};`, { mode: 0o600 });
  try {
    return spawnSync(process.execPath, ['--require', hook, '--import', 'tsx', resolve(__dirname, script)], {
      cwd: resolve(__dirname, '..'), encoding: 'utf8', timeout: 10_000,
      env: { PATH: `${dirname(process.execPath)}:/usr/bin:/bin`, NODE_ENV: 'test', MONGO_URL: uri,
        SM_TEST_DURABLE_FIXTURE: durableFixture ? '1' : '0' },
    });
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

describe('seeds réels : la garde précède mongoose.connect et les writes', () => {
  it.each(['seed.ts', 'seed-orders.ts'])('%s refuse une base servie avant tout appel au driver', (script) => {
    const result = runSeed(script, 'mongodb://127.0.0.1:27017/snackmanager');
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('MONGO_DISPOSABLE_TARGET_REQUIRED');
    expect(result.stderr).not.toContain('TEST_DRIVER_CONNECT_CALLED');
  });

  it.each(['seed.ts', 'seed-orders.ts'])('%s refuse les preuves présentes avant le premier modèle ou effacement', (script) => {
    const result = runSeed(script, DISPOSABLE, true);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('MONGO_DURABLE_ORDER_DATA_PRESENT');
    expect(result.stderr).not.toContain('TEST_MODEL_CALLED');
  });
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
