import { randomUUID } from 'node:crypto';
import mongoose, { Mongoose, Types, type Connection, type HydratedDocument, type Model } from 'mongoose';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { OrderCapacityDaySchema, type OrderCapacityDay } from './order-capacity.schema';

const immutable = /calendrier de capacité.*immuable/i;
const tenantId = new Types.ObjectId('507f1f77bcf86cd799439011');
const slot = (minutes: number) => ({ at: new Date(Date.UTC(2030, 4, 2, 16, minutes)), kitchenCapacity: 2, deliveryCapacity: 1 });
const fixture = () => ({ _id: new Types.ObjectId(), tenantId, day: '2030-05-02', state: 'seeding' as const,
  slots: [slot(0), slot(30)], createdAt: new Date('2030-05-01T12:00:00Z'), updatedAt: new Date('2030-05-01T12:00:00Z'), __v: 0 });
const native = new Mongoose();
const Day = native.model<OrderCapacityDay>('ImmutableDayNoConnection', OrderCapacityDaySchema.clone().set('bufferCommands', false));
type DayDocument = HydratedDocument<OrderCapacityDay>;

const documentMutations: [string, (document: DayDocument) => void][] = [
  ['capacité imbriquée', (document) => { document.slots[0]!.kitchenCapacity = 99; }],
  ['livraison imbriquée', (document) => { document.slots[0]!.deliveryCapacity = 49; }],
  ['push', (document) => { document.slots.push(slot(45)); }],
  ['splice', (document) => { document.slots.splice(0, 1); }],
  ['date marquée modifiée', (document) => { document.slots[0]!.at.setUTCMinutes(10); document.markModified('slots.0.at'); }],
];

const unsafeUpdates: [string, Record<string, unknown> | Record<string, unknown>[]][] = [
  ['tenant', { $set: { tenantId: new Types.ObjectId() } }],
  ['jour', { $set: { day: '2030-05-03' } }],
  ['grille', { $set: { slots: [slot(0)] } }],
  ['capacité imbriquée', { $set: { 'slots.0.kitchenCapacity': 99 } }],
  ['incrément imbriqué', { $inc: { 'slots.0.kitchenCapacity': 1 } }],
  ['suppression de champ', { $unset: { slots: '' } }],
  ['ajout de créneau', { $push: { slots: slot(45) } }],
  ['renommage vers une grille', { $rename: { state: 'slots' } }],
  ['chemin positionnel', { $set: { 'slots.$[].deliveryCapacity': 49 } }],
  ['pipeline', [{ $set: { 'slots.0.kitchenCapacity': 99 } }]],
  ['pipeline remplacement', [{ $replaceWith: fixture() }]],
  ['état calculé non littéral', { $set: { state: { $literal: 'ready' } } }],
  ['état invalide', { $set: { state: 'unknown' } }],
];

describe('calendrier immuable — vrai ODM sans connexion', () => {
  it('autorise la préparation d’un nouveau document', async () => {
    const document = new Day(fixture());
    document.slots[0]!.kitchenCapacity = 4;
    document.slots.push(slot(45));
    await expect(document.validate()).resolves.toBeUndefined();
  });

  it.each(documentMutations)('refuse %s sur un document hydraté persistant', async (_name, mutate) => {
    const document = Day.hydrate(fixture());
    mutate(document);
    await expect(document.validate()).rejects.toThrow(immutable);
  });

  it('save(validateBeforeSave:false) ne contourne pas l’immuabilité', async () => {
    const document = Day.hydrate(fixture());
    document.slots[0]!.kitchenCapacity = 99;
    await expect(document.save({ validateBeforeSave: false })).rejects.toThrow(immutable);
  });

  it('bulkSave ne contourne pas la garde des documents persistés', async () => {
    const document = Day.hydrate(fixture());
    document.slots.push(slot(45));
    await expect(Day.bulkSave([document], { validateBeforeSave: false })).rejects.toThrow(immutable);
  });

  it.each(unsafeUpdates)('refuse la requête %s avant le transport', async (_name, update) => {
    await expect(Day.updateOne({ tenantId }, update, { overwriteImmutable: true, strict: false })).rejects.toThrow(immutable);
  });

  it.each(['updateMany', 'findOneAndUpdate'] as const)('protège aussi %s', async (method) => {
    await expect(Day[method]({ tenantId }, { $set: { 'slots.0.kitchenCapacity': 99 } })).rejects.toThrow(immutable);
  });

  it('refuse l’upsert même limité à l’état', async () => {
    await expect(Day.updateOne({ tenantId }, { $set: { state: 'ready' } }, { upsert: true })).rejects.toThrow(immutable);
  });

  it.each(['replaceOne', 'findOneAndReplace'] as const)('refuse %s', async (method) => {
    await expect(Day[method]({ tenantId }, fixture())).rejects.toThrow(immutable);
  });

  it.each(Object.entries({
    deleteOne: () => Day.deleteOne({ tenantId }),
    deleteMany: () => Day.deleteMany({ tenantId }),
    findOneAndDelete: () => Day.findOneAndDelete({ tenantId }),
    findByIdAndDelete: () => Day.findByIdAndDelete(fixture()._id),
  }))('refuse %s pour empêcher la recréation du jour', async (_name, operation) => {
    await expect(operation()).rejects.toThrow(immutable);
  });

  it('refuse aussi la suppression depuis un document', async () => {
    await expect(Day.hydrate(fixture()).deleteOne()).rejects.toThrow(immutable);
  });

  it.each([
    { updateOne: { filter: { tenantId }, update: { $set: { 'slots.0.kitchenCapacity': 99 } } } },
    { updateMany: { filter: { tenantId }, update: [{ $set: { day: '2030-05-03' } }] } },
    { replaceOne: { filter: { tenantId }, replacement: fixture() } },
    { deleteOne: { filter: { tenantId } } },
    { deleteMany: { filter: { tenantId } } },
    { insertOne: { document: fixture() } },
  ])('contrôle tout bulkWrite avant le premier envoi : %j', async (operation) => {
    await expect(Day.bulkWrite([
      { updateOne: { filter: { tenantId }, update: { $set: { state: 'ready' } } } },
      operation,
    ] as never, { ordered: false, skipValidation: true })).rejects.toThrow(immutable);
  });

  it('réserve la création au document validé, pas insertMany(lean:true)', async () => {
    await expect(Day.insertMany([fixture()], { lean: true })).rejects.toThrow(immutable);
  });

  it.each([{ $out: 'immutable_days' }, { $merge: { into: 'immutable_days' } }])('refuse une agrégation qui réécrit une collection', async (stage) => {
    await expect(Day.aggregate([stage])).rejects.toThrow(immutable);
  });
});

function isolatedDatabase(raw: string): string {
  const url = new URL(raw);
  if (url.protocol !== 'mongodb:' || !['localhost', '127.0.0.1'].includes(url.hostname)
    || url.username || url.password || url.search || url.hash
    || !/^\/snackmanager_capacity_test_[a-z0-9_]{1,20}$/i.test(url.pathname)) {
    throw new Error('ORDER_CAPACITY_TEST_MONGO_URL doit cibler une base locale isolée snackmanager_capacity_test_ sans options.');
  }
  url.pathname += `_${randomUUID().replaceAll('-', '').slice(0, 10)}`;
  return url.toString();
}
const uri = process.env.ORDER_CAPACITY_TEST_MONGO_URL ? isolatedDatabase(process.env.ORDER_CAPACITY_TEST_MONGO_URL) : null;
const integration = uri ? describe : describe.skip;

describe('cible Mongo du test d’immuabilité', () => {
  it.each(['mongodb://remote.example/snackmanager_capacity_test_ci', 'mongodb://localhost/admin',
    'mongodb://localhost/snackmanager_capacity_test_ci?replicaSet=production', 'mongodb://localhost/snackmanager_capacity_test_ci#fragment'])('refuse %s sans I/O', (raw) => {
    expect(() => isolatedDatabase(raw)).toThrow('ORDER_CAPACITY_TEST_MONGO_URL');
  });
});

integration('calendrier immuable — Mongo réel isolé', () => {
  let db: Connection;
  let days: Model<OrderCapacityDay>;
  beforeAll(async () => {
    db = await mongoose.createConnection(uri!).asPromise();
    days = db.model('ImmutableCapacityDay', OrderCapacityDaySchema, 'immutable_capacity_days');
    await days.init();
  });
  beforeEach(async () => {
    // Frontière d’administration native : uniquement cette base éphémère.
    await days.collection.deleteMany({});
  });
  afterAll(async () => {
    if (db) { try { await db.dropDatabase(); } finally { await db.close(); } }
  });
  const stored = () => days.collection.findOne({ tenantId });

  it('crée via new Model puis modifie seulement state par save et requête', async () => {
    const document = new days(fixture());
    await document.save();
    const before = await stored();
    document.state = 'ready';
    await document.save();
    await days.updateOne({ tenantId }, { $set: { state: 'blocked' } });
    expect(await stored()).toMatchObject({ tenantId, day: before!.day, slots: before!.slots, state: 'blocked' });
  });

  it.each(documentMutations)('ne sauvegarde jamais %s, même sans validation de schéma', async (_name, mutate) => {
    const document = await days.create(fixture());
    const before = await stored();
    mutate(document);
    await expect(document.save({ validateBeforeSave: false })).rejects.toThrow(immutable);
    expect(await stored()).toEqual(before);
  });

  it('un bulk invalide ne change aucune ligne, même ordered:false', async () => {
    await days.create(fixture());
    const before = await stored();
    await expect(days.bulkWrite([
      { updateOne: { filter: { tenantId }, update: { $set: { state: 'ready' } } } },
      { deleteMany: { filter: { tenantId } } },
    ], { ordered: false })).rejects.toThrow(immutable);
    expect(await stored()).toEqual(before);
  });

  it('autorise les mises à jour d’état bulk sans réécrire l’instantané', async () => {
    await days.create(fixture());
    const before = await stored();
    await days.bulkWrite([{ updateOne: { filter: { tenantId }, update: { $set: { state: 'ready' } } } }]);
    expect(await stored()).toMatchObject({ day: before!.day, slots: before!.slots, state: 'ready' });
  });

  it('autorise bulkSave pour un simple changement d’état', async () => {
    const document = await days.create(fixture());
    const before = await stored();
    document.state = 'ready';
    await days.bulkSave([document]);
    expect(await stored()).toMatchObject({ day: before!.day, slots: before!.slots, state: 'ready' });
  });

  it('une suppression refusée laisse la clé unique occupée', async () => {
    await days.create(fixture());
    await expect(days.deleteOne({ tenantId })).rejects.toThrow(immutable);
    await expect(days.create(fixture())).rejects.toMatchObject({ code: 11000 });
    expect(await days.countDocuments()).toBe(1);
  });
});
