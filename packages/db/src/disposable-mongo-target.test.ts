import { describe, expect, it, vi } from 'vitest';
import type { Db } from 'mongodb';
import { assertDisposableMongoTarget, assertNoDurableOrderData, assertNoDurableOrderDocuments } from './disposable-mongo-target';

const NAME = 'snackmanager_disposable_classfood_local';

describe('cible Mongo jetable — aucun forçage vers les bases servies', () => {
  it.each(['localhost', '127.0.0.1', '[::1]'])('accepte une cible %s explicitement jetable', (host) => {
    const uri = `mongodb://${host}:27017/${NAME}`;
    expect(assertDisposableMongoTarget(uri)).toEqual({ uri, databaseName: NAME });
  });

  it.each([
    undefined, '', 'not-an-uri', 'mongodb://localhost', 'mongodb://localhost/',
    'mongodb://localhost/test', 'mongodb://localhost/snackmanager', 'mongodb://localhost/staging',
    'mongodb://localhost/production', 'mongodb://localhost/snackmanager_disposable_',
    'mongodb://localhost/snackmanager_disposable_short',
    `mongodb://database.example/${NAME}`, `mongodb://localhost.example/${NAME}`,
    `mongodb+srv://localhost/${NAME}`, `mongodb://127.1/${NAME}`, `mongodb://2130706433/${NAME}`,
    `mongodb://localhost,remote.example/${NAME}`, `mongodb://localhost:0/${NAME}`,
    `mongodb://localhost:65536/${NAME}`, `mongodb://localhost:027017/${NAME}`,
    `mongodb://localhost/${NAME}?replicaSet=remote`, `mongodb://localhost/${NAME}?directConnection=true`,
    `mongodb://localhost/${NAME}#fragment`, `mongodb://localhost/${NAME}/`,
    `mongodb://localhost/%73nackmanager_disposable_classfood_local`,
    ` mongodb://localhost/${NAME}`, `mongodb://localhost/${NAME}\n`,
  ])('refuse %j sans exposer la cible', (value) => {
    expect(() => assertDisposableMongoTarget(value)).toThrow(/base locale jetable/);
  });

  it('refuse même des credentials locaux et ne les imprime pas dans l’erreur', () => {
    const uri = new URL(`mongodb://localhost/${NAME}`);
    uri.username = 'fixture'; uri.password = 'never-print-this';
    try { assertDisposableMongoTarget(uri.toString()); throw new Error('expected refusal'); }
    catch (error) {
      expect(error).toMatchObject({ code: 'MONGO_DISPOSABLE_TARGET_REQUIRED' });
      expect(String(error)).not.toContain('never-print-this');
      expect(String(error)).not.toContain(uri.toString());
    }
  });
});

describe('preuve durable existante — exclusion de la copie et des seeds, pas une fence', () => {
  const fixtureDb = (found: string | null, failure = false) => {
    const reads: { name: string; filter: unknown; options: unknown }[] = [];
    const collection = vi.fn((name: string) => ({ findOne: vi.fn(async (filter: unknown, options: unknown) => {
      reads.push({ name, filter, options });
      if (failure) throw new Error('private driver detail');
      return name === found ? { _id: 'opaque' } : null;
    }) }));
    return { db: { collection } as unknown as Db, reads };
  };

  it('vérifie les champs bruts et les collections de preuves, sans hydrate ni lecture de clients', async () => {
    const port = fixtureDb(null);
    await expect(assertNoDurableOrderData(port.db)).resolves.toBeUndefined();
    expect(port.reads.map((read) => [read.name, read.filter])).toEqual([
      ['tenants', { capacityControl: { $exists: true } }],
      ['public_order_admissions', {}], ['order_capacity_days', {}],
    ]);
    for (const read of port.reads) expect(read.options).toMatchObject({ projection: { _id: 1 } });
  });

  it.each(['tenants', 'public_order_admissions', 'order_capacity_days'])('refuse toute preuve dans %s', async (collection) => {
    const port = fixtureDb(collection);
    await expect(assertNoDurableOrderData(port.db)).rejects.toMatchObject({ code: 'MONGO_DURABLE_ORDER_DATA_PRESENT' });
  });

  it('une panne de lecture ferme la porte sans fuite du message driver', async () => {
    const port = fixtureDb(null, true);
    await expect(assertNoDurableOrderData(port.db)).rejects.toMatchObject({ code: 'MONGO_DURABLE_ORDER_CHECK_FAILED' });
    await expect(assertNoDurableOrderData(port.db)).rejects.not.toThrow('private driver detail');
  });

  it.each([null, {}, { state: 'seeding' }, { state: 'active' }, { state: 'blocked' }])(
    'refuse un batch Tenant avec capacityControl %j, sans transporter active ou réparer null', (capacityControl) => {
      expect(() => assertNoDurableOrderDocuments('tenants', [{ capacityControl }]))
        .toThrow(/preuves de commandes durables/);
    },
  );

  it.each(['public_order_admissions', 'order_capacity_days'])('refuse un batch %s même apparu après le précontrôle', (name) => {
    expect(() => assertNoDurableOrderDocuments(name, [{}])).toThrow(/preuves de commandes durables/);
  });

  it('accepte un batch sans preuves et une collection protégée réellement vide', () => {
    expect(() => assertNoDurableOrderDocuments('tenants', [{}])).not.toThrow();
    expect(() => assertNoDurableOrderDocuments('public_order_admissions', [])).not.toThrow();
  });
});
