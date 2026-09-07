import { randomUUID } from 'node:crypto';
import mongoose from 'mongoose';
import { ORDER_CAPACITY_DAY_INDEX, ORDER_CAPACITY_INDEXES } from '@sm/db';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { assertOrderCapacityIndexesReady } from './order-capacity-index-readiness';

export function capacityIndexTestDatabase(raw: string): string {
  const url = new URL(raw);
  if (url.protocol !== 'mongodb:' || !['localhost', '127.0.0.1'].includes(url.hostname)
    || url.username || url.password || url.search || url.hash
    || !/^\/snackmanager_index_test_[a-z0-9_]{1,20}$/i.test(url.pathname)) {
    throw new Error('ORDER_CAPACITY_INDEX_TEST_MONGO_URL doit cibler une base isolée locale snackmanager_index_test_ sans options.');
  }
  url.pathname += `_${randomUUID().replaceAll('-', '').slice(0, 10)}`;
  return url.toString();
}

const uri = process.env.ORDER_CAPACITY_INDEX_TEST_MONGO_URL
  ? capacityIndexTestDatabase(process.env.ORDER_CAPACITY_INDEX_TEST_MONGO_URL) : null;
const integration = uri ? describe : describe.skip;
// GLOBAL dans Mongo 8.0 : exécuter seul sur un daemon local enableTestCommands.
// Aucun filtre namespace n'est implémenté par ce failpoint dans Mongo 8.0.12 :
// https://github.com/mongodb/mongo/blob/r8.0.12/src/mongo/db/index_builds_coordinator.cpp#L3293
const suspendIndex = process.env.ORDER_CAPACITY_INDEX_FAILPOINTS === '1' ? it : it.skip;
const FAILPOINT = 'hangAfterIndexBuildFirstDrain';

describe('cible isolée des preuves index Mongo', () => {
  const credentials = new URL('mongodb://localhost/snackmanager_index_test_ci');
  credentials.username = 'synthetic-user';
  credentials.password = 'synthetic-password';
  it.each([
    'mongodb://remote.example/snackmanager_index_test_ci',
    'mongodb://localhost/snackmanager', 'mongodb://localhost/admin',
    'mongodb://localhost/snackmanager_index_test_ci?replicaSet=production',
    'mongodb://localhost/snackmanager_index_test_ci#fragment', credentials.toString(),
  ])('refuse %s sans I/O', (value) => expect(() => capacityIndexTestDatabase(value)).toThrow());
});

integration('disponibilité des index — vrai pilote Mongo sur primaire', () => {
  // Construire le client ne fait aucun I/O ; connect() n'existe que dans beforeAll.
  const client = new mongoose.mongo.MongoClient(uri ?? 'mongodb://127.0.0.1/snackmanager_index_test_disabled', { serverSelectionTimeoutMS: 5_000 });
  const db = client.db();
  const admissions = db.collection('admissions');
  const calendar = db.collection('calendar');
  const indexes = [
    { collection: calendar, name: ORDER_CAPACITY_DAY_INDEX, key: { tenantId: 1, day: 1 }, partial: undefined },
    ...ORDER_CAPACITY_INDEXES.map(({ name, field }) => ({ collection: admissions, name,
      key: { tenantId: 1, 'capacity.slot': 1, [`capacity.${field}`]: 1 },
      partial: { [`capacity.${field}`]: { $type: 'number' } },
    })),
  ];
  const build = (index: typeof indexes[number]) => index.collection.createIndex(index.key, {
    name: index.name, unique: true, maxTimeMS: 20_000,
    ...(index.partial ? { partialFilterExpression: index.partial } : {}),
  });
  const ready = () => assertOrderCapacityIndexesReady(admissions, calendar);

  beforeAll(async () => {
    await client.connect();
    if (process.env.ORDER_CAPACITY_INDEX_FAILPOINTS === '1') {
      const parameters = await client.db('admin').command({ getParameter: 1, enableTestCommands: 1 }, { timeoutMS: 5_000 });
      expect(parameters.enableTestCommands).toBe(true);
    }
    // Une collection non vide force le chemin de construction normal.
    await calendar.insertOne({ tenantId: 'synthetic-tenant', day: '2030-05-02' });
    await admissions.insertOne({ tenantId: 'synthetic-tenant', capacity: {
      slot: '2030-05-02T16:00:00.000Z', kitchenSeat: 0, deliverySeat: 0,
    } });
  });
  beforeEach(async () => { await Promise.all(indexes.map(build)); });
  // Le daemon et sa base UUID restent sous la responsabilité du lanceur.
  afterAll(async () => { await client.close(); });

  it('accepte les trois vraies specs terminées', async () => {
    await expect(ready()).resolves.toBeUndefined();
  });

  it('détecte une suppression après une première preuve positive sans cache', async () => {
    await ready();
    await admissions.dropIndex(ORDER_CAPACITY_INDEXES[0]!.name);
    await expect(ready()).rejects.toMatchObject({ status: 503 });
    await build(indexes[1]!);
    await expect(ready()).resolves.toBeUndefined();
  });

  suspendIndex.each([0, 1, 2])('refuse l’index critique %i pendant sa construction puis accepte son commit', async (target) => {
    const index = indexes[target]!;
    const admin = client.db('admin');
    const initial = await admin.command({ getParameter: 1, [`failpoint.${FAILPOINT}`]: 1 }, { timeoutMS: 5_000 });
    // Ne jamais remplacer/restaurer un failpoint appartenant à un autre test.
    expect(initial[`failpoint.${FAILPOINT}`]?.mode).toBe(0);
    await index.collection.dropIndex(index.name);
    let armed = false;
    let pending: Promise<{ error?: unknown }> | undefined;
    try {
      // L'effet peut réussir puis sa réponse se perdre : l'intention de
      // désarmer précède l'appel, après la preuve initiale mode0 exclusive.
      armed = true;
      const enabled = await admin.command({ configureFailPoint: FAILPOINT, mode: 'alwaysOn' }, { timeoutMS: 5_000 });
      pending = build(index).then(() => ({}), (error: unknown) => ({ error }));
      await admin.command({ waitForFailPoint: FAILPOINT, timesEntered: enabled.count + 1, maxTimeMS: 5_000 }, { timeoutMS: 6_000 });
      const stats = await index.collection.aggregate([{ $indexStats: {} }], { readPreference: 'primary', maxTimeMS: 5_000 }).toArray();
      expect(stats.find((row) => row.name === index.name)).toMatchObject({ building: true, spec: { unique: true } });
      // Reproduction native : listIndexes donne bien la spec unique alors que
      // la construction ne garantit pas encore l'unicité.
      const listed = await index.collection.listIndexes().toArray();
      expect(listed.find((row) => row.name === index.name)).toMatchObject({ unique: true, key: index.key });
      await expect(ready()).rejects.toMatchObject({ status: 503 });
    } finally {
      if (armed) await admin.command({ configureFailPoint: FAILPOINT, mode: 'off' }, { timeoutMS: 5_000 });
      if (pending) expect(await pending).toEqual({});
    }
    await expect(ready()).resolves.toBeUndefined();
  }, 40_000);
});
