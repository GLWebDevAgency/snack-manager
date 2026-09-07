import { randomUUID } from 'node:crypto';
import mongoose, { Types, type Connection, type Model, type Query } from 'mongoose';
import { MODELS, ORDER_CAPACITY_DAY_INDEX, ORDER_CAPACITY_INDEXES, type Order, type OrderCapacityDay, type PublicOrderAdmission, type Tenant } from '@sm/db';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { OrderCapacityCalendarStore, orderCapacityCalendarPlanHash } from './order-capacity-calendar.store';

const TENANT = '507f1f77bcf86cd799439011';
const OTHER_TENANT = '507f1f77bcf86cd799439021';
const DAY = '2030-05-02'; // Jeudi, Europe/Paris en UTC+2.
const NEXT_DAY = '2030-05-03';
const FIRST_SLOT = '2030-05-02T09:00:00.000Z';
const LAST_SLOT = '2030-05-02T17:00:00.000Z';
const EXPECTED_SLOTS = [FIRST_SLOT, '2030-05-02T09:30:00.000Z', '2030-05-02T10:00:00.000Z',
  '2030-05-02T16:00:00.000Z', '2030-05-02T16:30:00.000Z', LAST_SLOT];

/** Aucune base partagée, aucun fournisseur ni donnée réelle dans cette recette. */
export function calendarTestDatabase(raw: string): string {
  const url = new URL(raw);
  if (url.protocol !== 'mongodb:' || !['localhost', '127.0.0.1'].includes(url.hostname)
    || url.username || url.password || url.search || url.hash
    || !/^\/snackmanager_calendar_test_[a-z0-9_]{1,20}$/i.test(url.pathname)) {
    throw new Error('ORDER_CAPACITY_CALENDAR_TEST_MONGO_URL doit cibler une base isolée locale snackmanager_calendar_test_ sans options.');
  }
  url.pathname += `_${randomUUID().replaceAll('-', '').slice(0, 10)}`;
  return url.toString();
}
const uri = process.env.ORDER_CAPACITY_CALENDAR_TEST_MONGO_URL
  ? calendarTestDatabase(process.env.ORDER_CAPACITY_CALENDAR_TEST_MONGO_URL) : null;
const integration = uri ? describe : describe.skip;

describe('cible Mongo du calendrier C15', () => {
  const credentials = new URL('mongodb://localhost/snackmanager_calendar_test_ci');
  credentials.username = 'synthetic';
  credentials.password = 'synthetic';
  it.each([
    'mongodb://remote.example/snackmanager_calendar_test_ci',
    'mongodb+srv://localhost/snackmanager_calendar_test_ci',
    'mongodb://localhost/snackmanager', 'mongodb://localhost/admin',
    'mongodb://localhost/snackmanager_calendar_test_ci?replicaSet=production',
    'mongodb://localhost/snackmanager_calendar_test_ci#fragment',
    credentials.toString(),
  ])('refuse %s sans I/O', (value) => expect(() => calendarTestDatabase(value)).toThrow());

  it('alloue un suffixe propre à chaque exécution, même avec le même préfixe', () => {
    const first = calendarTestDatabase('mongodb://127.0.0.1:27036/snackmanager_calendar_test_ci');
    const second = calendarTestDatabase('mongodb://127.0.0.1:27036/snackmanager_calendar_test_ci');
    expect(first).not.toBe(second);
    expect(first).toMatch(/^mongodb:\/\/127\.0\.0\.1:27036\/snackmanager_calendar_test_ci_[a-f0-9]{10}$/);
  });
});

type Effect = (run: () => Promise<unknown>) => Promise<unknown>;
type Update = { $set?: Record<string, unknown> };

/** Injection de transport seulement : run() exécute la véritable requête Mongo. */
function interceptUpdate<T>(model: Model<T>, match: (update: Update) => boolean, effect: Effect, once = true): Model<T> {
  let armed = true;
  return new Proxy(model, { get(target, property) {
    const value = Reflect.get(target, property, target);
    if (!['updateOne', 'findOneAndUpdate'].includes(String(property))) return typeof value === 'function' ? value.bind(target) : value;
    return (...args: unknown[]) => {
      const query = Reflect.apply(value, target, args) as Query<unknown, T>;
      const run = query.exec.bind(query);
      query.exec = async () => {
        if (!armed || !match(args[1] as Update)) return run();
        if (once) armed = false;
        return effect(run);
      };
      return query;
    };
  } });
}

function interceptCreate<T>(model: Model<T>, effect: (run: () => Promise<unknown>, args: readonly unknown[]) => Promise<unknown>): Model<T> {
  let armed = true;
  return new Proxy(model, { get(target, property) {
    const value = Reflect.get(target, property, target);
    if (property !== 'create') return typeof value === 'function' ? value.bind(target) : value;
    return (...args: unknown[]) => {
      const run = () => Reflect.apply(value, target, args) as Promise<unknown>;
      if (!armed) return run();
      armed = false;
      return effect(run, args);
    };
  } });
}

const isIntent = (update: Update) => typeof update.$set?.['capacityControl.dayIntent'] === 'object'
  && update.$set?.['capacityControl.dayIntent'] !== null;
const isReady = (update: Update) => update.$set?.state === 'ready';
const unavailable = (promise: Promise<unknown>) => expect(promise).rejects.toMatchObject({ status: 503 });
function barrier() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => { release = resolve; });
  return { promise, release };
}
function grid(value: { slots: readonly { at: Date; kitchenCapacity: number; deliveryCapacity: number }[] }) {
  return value.slots.map((slot) => ({ at: slot.at.toISOString(), kitchenCapacity: slot.kitchenCapacity, deliveryCapacity: slot.deliveryCapacity }));
}

integration('calendrier C15 — deux connexions Mongo réelles, sans branchement runtime', () => {
  let dbA: Connection; let dbB: Connection;
  let tenantsA: Model<Tenant>; let tenantsB: Model<Tenant>;
  let daysA: Model<OrderCapacityDay>; let daysB: Model<OrderCapacityDay>;
  let admissionsA: Model<PublicOrderAdmission>; let admissionsB: Model<PublicOrderAdmission>;
  let ordersA: Model<Order>; let ordersB: Model<Order>;
  let first: OrderCapacityCalendarStore; let second: OrderCapacityCalendarStore;

  beforeAll(async () => {
    dbA = await mongoose.createConnection(uri!).asPromise();
    dbB = await mongoose.createConnection(uri!).asPromise();
    tenantsA = dbA.model(MODELS.Tenant.name, MODELS.Tenant.schema, MODELS.Tenant.collection);
    tenantsB = dbB.model(MODELS.Tenant.name, MODELS.Tenant.schema, MODELS.Tenant.collection);
    daysA = dbA.model(MODELS.OrderCapacityDay.name, MODELS.OrderCapacityDay.schema, MODELS.OrderCapacityDay.collection);
    daysB = dbB.model(MODELS.OrderCapacityDay.name, MODELS.OrderCapacityDay.schema, MODELS.OrderCapacityDay.collection);
    admissionsA = dbA.model(MODELS.PublicOrderAdmission.name, MODELS.PublicOrderAdmission.schema, MODELS.PublicOrderAdmission.collection);
    admissionsB = dbB.model(MODELS.PublicOrderAdmission.name, MODELS.PublicOrderAdmission.schema, MODELS.PublicOrderAdmission.collection);
    ordersA = dbA.model(MODELS.Order.name, MODELS.Order.schema, MODELS.Order.collection);
    ordersB = dbB.model(MODELS.Order.name, MODELS.Order.schema, MODELS.Order.collection);
    await Promise.all([tenantsA.init(), daysA.init(), admissionsA.init(), ordersA.init()]);
  });
  beforeEach(async () => {
    vi.restoreAllMocks();
    // Le nettoyage administratif est limité à cette base UUID ; les jours
    // métier ne sont volontairement pas supprimables via le modèle Mongoose.
    await Promise.all([tenantsA.deleteMany({}), daysA.collection.deleteMany({}), admissionsA.deleteMany({}), ordersA.deleteMany({})]);
    first = new OrderCapacityCalendarStore(tenantsA, daysA, admissionsA, ordersA);
    second = new OrderCapacityCalendarStore(tenantsB, daysB, admissionsB, ordersB);
  });
  afterAll(async () => {
    vi.restoreAllMocks();
    if (dbA) { await dbA.dropDatabase(); await dbA.close(); }
    if (dbB) await dbB.close();
  });

  async function tenant(id = TENANT, state: 'active' | 'seeding' | 'blocked' | null = 'active') {
    return tenantsA.create({ _id: id, slug: `test-calendar-${id}`, name: 'Restaurant de recette C15',
      hours: [{ day: 4, lunch: { open: '11:00', close: '12:00' }, dinner: { open: '18:00', close: '19:00' } }],
      closures: [], settings: { slotIntervalMin: 30, slotCapacity: 4 }, delivery: { slotCapacity: 2 },
      ...(state ? { capacityControl: { version: 1, state, configRevision: 7, bootstrapId: randomUUID(),
        cutoverAt: new Date('2030-05-01T00:00:00.000Z'), dayIntent: null } } : {}),
    });
  }
  const control = (id = TENANT) => tenantsB.findById(id).select('+capacityControl').lean();
  const calendar = (day = DAY, id = TENANT) => daysB.findOne({ tenantId: id, day }).lean();
  async function settings() {
    await tenantsB.updateOne({ _id: TENANT }, { $set: { 'settings.slotIntervalMin': 60, 'settings.slotCapacity': 9, 'delivery.slotCapacity': 5 },
      $inc: { 'capacityControl.configRevision': 1 } });
  }
  async function historicalOrder(status: 'new' | 'preparing' | 'ready' | 'delivered' | 'cancelled',
    slot = FIRST_SLOT, tenantId = TENANT) {
    return ordersA.create({ tenantId, clientId: randomUUID(), channel: 'online', type: 'pickup', number: 12,
      lines: [], totals: { subtotal: 150, deliveryFee: 0, total: 150 }, payment: { method: 'counter', status: 'pending' },
      trackingToken: randomUUID(), pickup: { slot: new Date(slot), customerName: 'Recette calendrier', customerPhone: '0000000000' },
      status, statusHistory: [{ status, at: new Date(), by: 'local-test' }],
    });
  }
  async function historicalAdmission(state: 'validating' | 'committing' | 'created' | 'rejected',
    slot = FIRST_SLOT, tenantId = TENANT) {
    const clientId = randomUUID();
    return admissionsA.create({ _id: randomUUID(), tenantId, clientId, version: 1, kind: 'staff', channel: 'phone',
      proofHash: 'a'.repeat(64), payloadHash: 'b'.repeat(64), state, slot: new Date(slot),
      ...(state === 'committing' || state === 'created' ? { orderId: new Types.ObjectId() } : {}),
    });
  }

  it('preview calcule sans écrire même pour un ancien tenant sans contrôle C15', async () => {
    await tenant(TENANT, null);
    const before = await control();
    const preview = await first.preview(TENANT, DAY);
    expect(preview).toMatchObject({ day: DAY, frozen: false, closedReason: null });
    expect(preview.slots.map((slot) => slot.at.toISOString())).toEqual(EXPECTED_SLOTS);
    expect(await control()).toEqual(before);
    expect(await daysA.countDocuments()).toBe(0);
    expect(await admissionsA.countDocuments()).toBe(0);
    expect(await ordersA.countDocuments()).toBe(0);
  });

  it('preview refuse un contrôle natif null au lieu de le confondre avec une absence historique', async () => {
    await tenant(TENANT, null);
    await tenantsA.collection.updateOne({ _id: new Types.ObjectId(TENANT) }, { $set: { capacityControl: null } });
    const before = await control();
    await unavailable(first.ensureDay(TENANT, DAY));
    await unavailable(second.preview(TENANT, DAY));
    expect(await control()).toEqual(before);
    expect(await daysA.countDocuments()).toBe(0);
  });

  it.each([null, 'seeding', 'blocked'] as const)('refuse ensureDay sans contrôle actif (%s), sans inventer de bootstrap', async (state) => {
    await tenant(TENANT, state);
    await unavailable(first.ensureDay(TENANT, DAY));
    expect(await daysA.countDocuments()).toBe(0);
    expect((await control())?.capacityControl?.dayIntent ?? null).toBeNull();
  });

  it('refuse un restaurant absent et une journée antérieure au cutover sans écriture', async () => {
    await unavailable(first.ensureDay(TENANT, DAY));
    await tenant();
    await unavailable(first.ensureDay(TENANT, '2030-04-25'));
    expect(await daysA.countDocuments()).toBe(0);
  });

  it.each([
    ['version', 2], ['configRevision', -1], ['bootstrapId', 'pas-un-uuid'], ['cutoverAt', null],
  ])('refuse un contrôle corrompu %s avant toute écriture', async (field, value) => {
    await tenant();
    await tenantsA.collection.updateOne({ _id: new Types.ObjectId(TENANT) }, { $set: { [`capacityControl.${field}`]: value } });
    await unavailable(first.ensureDay(TENANT, DAY));
    expect(await daysA.countDocuments()).toBe(0);
    expect((await control())?.capacityControl?.dayIntent).toBeNull();
  });

  it.each([ORDER_CAPACITY_DAY_INDEX, ...ORDER_CAPACITY_INDEXES.map(({ name }) => name)])('refuse l’ouverture sans l’index terminé %s', async (name) => {
    await tenant();
    const model = name === ORDER_CAPACITY_DAY_INDEX ? daysA : admissionsA;
    // Suppression du seul index nommé dans notre base UUID, restauration même
    // si l’assertion échoue ; aucun index d’une base partagée n’est approché.
    await model.collection.dropIndex(name);
    try {
      await unavailable(first.ensureDay(TENANT, DAY));
      expect(await daysA.countDocuments()).toBe(0);
      expect((await control())?.capacityControl?.dayIntent).toBeNull();
    } finally {
      await model.createIndexes();
    }
  });

  it('fige une seule grille prête et nettoie son intention exacte', async () => {
    await tenant();
    const preview = await first.preview(TENANT, DAY);
    expect(preview).toMatchObject({ sourceRevision: 7, frozen: false });
    expect(await daysA.countDocuments()).toBe(0);
    const ready = await first.ensureDay(TENANT, DAY);
    expect(ready).toMatchObject({ day: DAY, state: 'ready', sourceRevision: 7, closedReason: null });
    expect(grid(ready)).toEqual(EXPECTED_SLOTS.map((at) => ({ at, kitchenCapacity: 4, deliveryCapacity: 2 })));
    expect((await control())?.capacityControl?.dayIntent).toBeNull();
    expect(await second.preview(TENANT, DAY)).toMatchObject({ frozen: true, sourceRevision: 7 });
    expect(await daysA.countDocuments()).toBe(1);
  });

  it('passe réellement les options d’écriture durable au create Mongoose du jour', async () => {
    await tenant();
    let observedOptions: unknown;
    const observedDays = interceptCreate(daysA, (run, args) => { observedOptions = args[1]; return run(); });
    const ready = await new OrderCapacityCalendarStore(tenantsA, observedDays, admissionsA, ordersA).ensureDay(TENANT, DAY);
    expect(ready.state).toBe('ready');
    expect(observedOptions).toEqual({ writeConcern: { w: 'majority', j: true, wtimeout: 10_000 }, ordered: true });
  });

  it('un jour prêt reste identique après changement des réglages et interdit les mutations imbriquées', async () => {
    await tenant();
    const ready = await first.ensureDay(TENANT, DAY);
    await settings();
    expect(grid(await second.ensureDay(TENANT, DAY))).toEqual(grid(ready));
    expect(grid(await second.preview(TENANT, DAY))).toEqual(grid(ready));
    const hydrated = await daysB.findOne({ tenantId: TENANT, day: DAY });
    hydrated!.slots[0]!.kitchenCapacity = 99;
    await expect(hydrated!.save({ validateBeforeSave: false })).rejects.toThrow(/immuable/);
    expect(grid((await calendar())!)).toEqual(grid(ready));
  });

  it.each(['seeding', 'blocked'] as const)('un jour %s sans intention prouvée ne devient jamais prêt implicitement', async (state) => {
    await tenant();
    await daysA.create({ tenantId: TENANT, day: DAY, state, sourceRevision: 7, closedReason: null,
      slots: [{ at: new Date(FIRST_SLOT), kitchenCapacity: 4, deliveryCapacity: 2 }] });
    await unavailable(first.ensureDay(TENANT, DAY));
    expect((await calendar())?.state).toBe(state);
  });

  it('ne valide pas un calendrier historique prêt mais sans sourceRevision', async () => {
    await tenant();
    await daysA.create({ tenantId: TENANT, day: DAY, state: 'ready', closedReason: null,
      slots: [{ at: new Date(FIRST_SLOT), kitchenCapacity: 4, deliveryCapacity: 2 }] });
    await unavailable(first.ensureDay(TENANT, DAY));
  });

  it.each([{ label: 'null', slots: null }, { label: '[null]', slots: [null] }])('répond503 et non TypeError pour un jour prêt avec slots=$label corrompu', async ({ slots }) => {
    await tenant();
    await first.ensureDay(TENANT, DAY);
    await daysA.collection.updateOne({ tenantId: new Types.ObjectId(TENANT), day: DAY }, { $set: { slots } });
    await unavailable(first.preview(TENANT, DAY));
    await unavailable(second.ensureDay(TENANT, DAY));
    expect((await calendar())?.slots).toEqual(slots);
    expect((await control())?.capacityControl?.dayIntent).toBeNull();
  });

  it('refuse un jour prêt dont la révision dépasse celle du contrôle, sans la ramener artificiellement', async () => {
    await tenant();
    await first.ensureDay(TENANT, DAY);
    await daysA.collection.updateOne({ tenantId: new Types.ObjectId(TENANT), day: DAY }, { $set: { sourceRevision: 8 } });
    await unavailable(first.preview(TENANT, DAY));
    await unavailable(second.ensureDay(TENANT, DAY));
    expect((await calendar())?.sourceRevision).toBe(8);
    expect((await control())?.capacityControl?.configRevision).toBe(7);
  });

  it('deux helpers concurrents convergent vers le même jour et la même grille', async () => {
    await tenant();
    const bothReady = barrier(); let waiting = 0;
    const collide: Effect = async (run) => {
      waiting += 1;
      if (waiting === 2) bothReady.release();
      await bothReady.promise;
      return run();
    };
    const a = new OrderCapacityCalendarStore(interceptUpdate(tenantsA, isIntent, collide), daysA, admissionsA, ordersA);
    const b = new OrderCapacityCalendarStore(interceptUpdate(tenantsB, isIntent, collide), daysB, admissionsB, ordersB);
    const [one, two] = await Promise.all([a.ensureDay(TENANT, DAY), b.ensureDay(TENANT, DAY)]);
    expect(waiting).toBe(2);
    expect(String(one._id)).toBe(String(two._id));
    expect(grid(one)).toEqual(grid(two));
    expect(await daysA.countDocuments()).toBe(1);
    expect((await control())?.capacityControl?.dayIntent).toBeNull();
  });

  it('une réponse CAS perdue après écriture reprend la preuve durable et non un nouveau planning', async () => {
    await tenant();
    let calls = 0;
    const lossy = interceptUpdate(tenantsA, isIntent, async (run) => {
      calls += 1;
      await run();
      await settings();
      throw new Error('Réponse CAS perdue après acquittement Mongo — injection locale');
    });
    const ready = await new OrderCapacityCalendarStore(lossy, daysA, admissionsA, ordersA).ensureDay(TENANT, DAY);
    expect(calls).toBe(1);
    expect(ready).toMatchObject({ state: 'ready', sourceRevision: 7 });
    expect(grid(ready)).toEqual(EXPECTED_SLOTS.map((at) => ({ at, kitchenCapacity: 4, deliveryCapacity: 2 })));
    expect((await control())?.capacityControl?.configRevision).toBe(8);
    expect((await control())?.capacityControl?.dayIntent).toBeNull();
  });

  it('une réponse CAS perdue après finalisation complète par B reste reprenable sur le même jour', async () => {
    await tenant();
    let finishedId: string | undefined;
    const lossy = interceptUpdate(tenantsA, isIntent, async (run) => {
      await run();
      finishedId = String((await second.ensureDay(TENANT, DAY))._id);
      expect((await control())?.capacityControl?.dayIntent).toBeNull();
      throw new Error('Réponse CAS perdue après reprise complète par B — injection locale');
    });
    // L’absence d’intention ne suffit pas à ce premier appel pour conclure ;
    // son503 est conservateur, puis la reprise lit le jour déjà prêt exact.
    await unavailable(new OrderCapacityCalendarStore(lossy, daysA, admissionsA, ordersA).ensureDay(TENANT, DAY));
    expect(String((await first.ensureDay(TENANT, DAY))._id)).toBe(finishedId);
    expect(await daysA.countDocuments()).toBe(1);
    expect((await control())?.capacityControl?.dayIntent).toBeNull();
  });

  it('recalcule si les réglages changent avant le CAS de révision', async () => {
    await tenant();
    let intercepted = 0;
    const racing = interceptUpdate(tenantsA, isIntent, async (run) => {
      intercepted += 1;
      await settings();
      return run();
    });
    const ready = await new OrderCapacityCalendarStore(racing, daysA, admissionsA, ordersA).ensureDay(TENANT, DAY);
    expect(intercepted).toBe(1);
    expect(ready).toMatchObject({ sourceRevision: 8, state: 'ready' });
    expect(ready.slots).toHaveLength(4);
    expect(ready.slots.every((slot) => slot.kitchenCapacity === 9 && slot.deliveryCapacity === 5)).toBe(true);
  });

  it('conserve la grille de l’intention si les réglages changent après le CAS', async () => {
    await tenant();
    const racing = interceptUpdate(tenantsA, isIntent, async (run) => {
      const result = await run();
      await settings();
      return result;
    });
    const ready = await new OrderCapacityCalendarStore(racing, daysA, admissionsA, ordersA).ensureDay(TENANT, DAY);
    expect(ready).toMatchObject({ sourceRevision: 7, state: 'ready' });
    expect(grid(ready)).toEqual(EXPECTED_SLOTS.map((at) => ({ at, kitchenCapacity: 4, deliveryCapacity: 2 })));
  });

  it('reprend un crash après insertion seeding, même après modification du planning courant', async () => {
    await tenant();
    const failingDays = interceptUpdate(daysA, isReady, async () => { throw new Error('Processus arrêté avant ready — injection locale'); }, false);
    await unavailable(new OrderCapacityCalendarStore(tenantsA, failingDays, admissionsA, ordersA).ensureDay(TENANT, DAY));
    const seeded = await calendar();
    expect(seeded).toMatchObject({ state: 'seeding', sourceRevision: 7 });
    const intent = (await control())?.capacityControl?.dayIntent;
    expect(intent).toMatchObject({ day: DAY, sourceRevision: 7 });
    await settings();
    const ready = await second.ensureDay(TENANT, DAY);
    expect(String(ready._id)).toBe(String(seeded!._id));
    expect(grid(ready)).toEqual(grid(seeded!));
    expect(ready.state).toBe('ready');
    expect((await control())?.capacityControl?.dayIntent).toBeNull();
    expect(await daysA.countDocuments()).toBe(1);
  });

  it('reprend l’intention durable après arrêt avant insertion, et preview ne la remplace pas', async () => {
    await tenant();
    const failingDays = interceptCreate(daysA, async () => { throw new Error('Arrêt avant insertion Day — injection locale'); });
    await unavailable(new OrderCapacityCalendarStore(tenantsA, failingDays, admissionsA, ordersA).ensureDay(TENANT, DAY));
    expect(await daysA.countDocuments()).toBe(0);
    const intent = (await control())?.capacityControl?.dayIntent;
    expect(intent).toMatchObject({ day: DAY, sourceRevision: 7 });
    await settings();
    expect(await second.preview(TENANT, DAY)).toMatchObject({ frozen: true, sourceRevision: 7 });
    expect((await control())?.capacityControl?.dayIntent).toEqual(intent);
    expect(await daysA.countDocuments()).toBe(0);
    const ready = await second.ensureDay(TENANT, DAY);
    expect(grid(ready)).toEqual(EXPECTED_SLOTS.map((at) => ({ at, kitchenCapacity: 4, deliveryCapacity: 2 })));
    expect(ready.sourceRevision).toBe(7);
  });

  it('une réponse d’insertion perdue n’insère jamais un deuxième jour', async () => {
    await tenant();
    let insertions = 0;
    const lossy = interceptCreate(daysA, async (run) => {
      insertions += 1;
      await run();
      throw new Error('Réponse insertion Day perdue — injection locale');
    });
    const ready = await new OrderCapacityCalendarStore(tenantsA, lossy, admissionsA, ordersA).ensureDay(TENANT, DAY);
    expect(insertions).toBe(1);
    expect(ready.state).toBe('ready');
    expect(await daysA.countDocuments()).toBe(1);
  });

  it('termine l’intention du premier jour avant de préparer un autre jour demandé', async () => {
    await tenant();
    const failingDays = interceptCreate(daysA, async () => { throw new Error('Arrêt après intention — injection locale'); });
    await unavailable(new OrderCapacityCalendarStore(tenantsA, failingDays, admissionsA, ordersA).ensureDay(TENANT, DAY));
    await settings();
    expect((await second.ensureDay(TENANT, NEXT_DAY)).state).toBe('ready');
    expect(await calendar()).toMatchObject({ state: 'ready', sourceRevision: 7 });
    expect(await calendar(NEXT_DAY)).toMatchObject({ state: 'ready', sourceRevision: 8 });
    expect((await control())?.capacityControl?.dayIntent).toBeNull();
    expect(await daysA.countDocuments()).toBe(2);
  });

  it('un ancien helper ne nettoie jamais l’intention plus récente d’un autre jour', async () => {
    await tenant();
    let newerOperationId: string | undefined;
    const delayedCleanup = interceptUpdate(tenantsA, (update) => update.$set?.['capacityControl.dayIntent'] === null, async (run) => {
      // Le helper B acquitte le premier plan, puis prépare le jour suivant et
      // s’arrête avant insertion ; A reprend ensuite son ancien CAS de clear.
      await second.ensureDay(TENANT, DAY);
      const failingDays = interceptCreate(daysB, async () => { throw new Error('Arrêt du second jour — injection locale'); });
      await unavailable(new OrderCapacityCalendarStore(tenantsB, failingDays, admissionsB, ordersB).ensureDay(TENANT, NEXT_DAY));
      newerOperationId = (await control())?.capacityControl?.dayIntent?.operationId;
      expect(newerOperationId).toEqual(expect.any(String));
      return run();
    });
    expect((await new OrderCapacityCalendarStore(delayedCleanup, daysA, admissionsA, ordersA).ensureDay(TENANT, DAY)).state).toBe('ready');
    expect((await control())?.capacityControl?.dayIntent).toMatchObject({ day: NEXT_DAY, operationId: newerOperationId });
    expect(await calendar(NEXT_DAY)).toBeNull();
    expect((await second.ensureDay(TENANT, NEXT_DAY)).state).toBe('ready');
    expect(await daysA.countDocuments()).toBe(2);
  });

  it('un ancien helper du bootstrap A refuse le résultat et ne nettoie pas la nouvelle intention B', async () => {
    await tenant();
    const bootstrapB = randomUUID();
    const plan = { day: NEXT_DAY, sourceRevision: 7, closedReason: 'no_service' as const, slots: [] };
    const nextIntent = { ...plan, operationId: randomUUID(), planHash: orderCapacityCalendarPlanHash(plan) };
    const delayedCleanup = interceptUpdate(tenantsA, (update) => update.$set?.['capacityControl.dayIntent'] === null, async (run) => {
      await tenantsB.updateOne({ _id: TENANT }, { $set: {
        'capacityControl.bootstrapId': bootstrapB, 'capacityControl.dayIntent': nextIntent,
      } }, { runValidators: true });
      return run();
    });
    await unavailable(new OrderCapacityCalendarStore(delayedCleanup, daysA, admissionsA, ordersA).ensureDay(TENANT, DAY));
    expect((await control())?.capacityControl).toMatchObject({ bootstrapId: bootstrapB, dayIntent: nextIntent });
    expect(await calendar(NEXT_DAY)).toBeNull();
    expect(await daysA.countDocuments()).toBe(1);
  });

  it('un timeout de publication ready conserve le résultat réellement commis', async () => {
    await tenant();
    const lossy = interceptUpdate(daysA, isReady, async (run) => { await run(); throw new Error('Réponse ready perdue — injection locale'); });
    const ready = await new OrderCapacityCalendarStore(tenantsA, lossy, admissionsA, ordersA).ensureDay(TENANT, DAY);
    expect(ready.state).toBe('ready');
    expect(await daysA.countDocuments()).toBe(1);
    expect((await control())?.capacityControl?.dayIntent).toBeNull();
  });

  it('l’absence de service est figée explicitement avec une grille vide', async () => {
    await tenant();
    const ready = await first.ensureDay(TENANT, NEXT_DAY);
    expect(ready).toMatchObject({ day: NEXT_DAY, state: 'ready', slots: [], closedReason: 'no_service', sourceRevision: 7 });
    expect(await second.preview(TENANT, NEXT_DAY)).toMatchObject({ frozen: true, slots: [], closedReason: 'no_service' });
  });

  it('une fermeture exceptionnelle reste fermée après suppression de la fermeture dans les réglages', async () => {
    await tenant();
    await tenantsA.updateOne({ _id: TENANT }, { $set: { closures: [{ from: new Date('2030-05-01T22:00:00.000Z'),
      to: new Date('2030-05-02T21:59:59.999Z'), reason: 'Fermeture de recette locale' }] } });
    expect(await first.preview(TENANT, DAY)).toMatchObject({ frozen: false, slots: [], closedReason: 'exceptional_closure' });
    await first.ensureDay(TENANT, DAY);
    await tenantsA.updateOne({ _id: TENANT }, { $set: { closures: [] }, $inc: { 'capacityControl.configRevision': 1 } });
    expect(await second.ensureDay(TENANT, DAY)).toMatchObject({ state: 'ready', slots: [], closedReason: 'exceptional_closure', sourceRevision: 7 });
  });

  it('isole les intentions, calendriers et historiques de deux restaurants', async () => {
    await tenant(); await tenant(OTHER_TENANT);
    await historicalOrder('ready', FIRST_SLOT, OTHER_TENANT);
    await historicalAdmission('committing', FIRST_SLOT, OTHER_TENANT);
    expect((await first.ensureDay(TENANT, DAY)).state).toBe('ready');
    await unavailable(second.ensureDay(OTHER_TENANT, DAY));
    expect(await calendar(DAY, OTHER_TENANT)).toMatchObject({ state: 'seeding' });
    expect((await control(OTHER_TENANT))?.capacityControl?.dayIntent).toMatchObject({ day: DAY, sourceRevision: 7 });
    expect((await control())?.capacityControl?.dayIntent).toBeNull();
  });

  it('refuse une intention corrompue sans la remplacer ni créer un jour', async () => {
    await tenant();
    // Corruption simulée par le driver administratif, uniquement dans la base
    // UUID de test : le modèle strict interdit cette grille à l’écriture normale.
    await tenantsA.collection.updateOne({ _id: new Types.ObjectId(TENANT) }, { $set: { 'capacityControl.dayIntent': {
      operationId: randomUUID(), day: DAY, sourceRevision: 7, planHash: 'f'.repeat(64), closedReason: null,
      slots: [{ at: new Date(FIRST_SLOT), kitchenCapacity: 4, deliveryCapacity: 2 }],
    } } });
    const before = (await control())?.capacityControl?.dayIntent;
    await unavailable(first.ensureDay(TENANT, DAY));
    expect((await control())?.capacityControl?.dayIntent).toEqual(before);
    expect(await daysA.countDocuments()).toBe(0);
  });

  it('refuse une intention bien hashée mais antérieure au cutover, même si le jour demandé est futur', async () => {
    await tenant();
    const plan = { day: '2030-04-25', sourceRevision: 7, closedReason: null,
      slots: [{ at: new Date('2030-04-25T09:00:00.000Z'), kitchenCapacity: 4, deliveryCapacity: 2 }] };
    const intent = { ...plan, operationId: randomUUID(), planHash: orderCapacityCalendarPlanHash(plan) };
    await tenantsA.collection.updateOne({ _id: new Types.ObjectId(TENANT) }, { $set: { 'capacityControl.dayIntent': intent } });
    await unavailable(first.ensureDay(TENANT, DAY));
    await unavailable(second.preview(TENANT, DAY));
    expect((await control())?.capacityControl?.dayIntent).toEqual(intent);
    expect(await daysA.countDocuments()).toBe(0);
  });

  it('preview ne projette que les champs de calendrier autorisés même si l’intention native contient un intrus', async () => {
    await tenant();
    const slot = { at: new Date(FIRST_SLOT), kitchenCapacity: 4, deliveryCapacity: 2 };
    const plan = { day: DAY, sourceRevision: 7, closedReason: null, slots: [slot] };
    const intent = { ...plan, operationId: randomUUID(), planHash: orderCapacityCalendarPlanHash(plan),
      internalMetadata: 'note-synthetique-privee', slots: [{ ...slot, internalMetadata: 'note-synthetique-privee' }] };
    await tenantsA.collection.updateOne({ _id: new Types.ObjectId(TENANT) }, { $set: { 'capacityControl.dayIntent': intent } });
    const before = (await control())?.capacityControl?.dayIntent;
    expect(await second.preview(TENANT, DAY)).toEqual({ ...plan, frozen: true });
    expect((await control())?.capacityControl?.dayIntent).toEqual(before);
    expect(await daysA.countDocuments()).toBe(0);
  });

  it.each(['new', 'preparing', 'ready', 'delivered'] as const)('refuse un bootstrap incomplet avec commande historique %s', async (status) => {
    await tenant(); await historicalOrder(status);
    await unavailable(first.ensureDay(TENANT, DAY));
    expect(await daysA.countDocuments({ state: 'ready' })).toBe(0);
    expect(await calendar()).toMatchObject({ state: 'seeding', sourceRevision: 7 });
    const intent = (await control())?.capacityControl?.dayIntent;
    expect(intent).toMatchObject({ day: DAY, sourceRevision: 7 });
    // Ni un second helper ni un autre jour ne contournent l’historique non
    // importé : le plan reste bloqué jusqu’à une réconciliation explicite.
    await unavailable(second.ensureDay(TENANT, NEXT_DAY));
    expect(await daysA.countDocuments()).toBe(1);
    expect((await control())?.capacityControl?.dayIntent).toEqual(intent);
  });

  it.each(['committing', 'created'] as const)('refuse une admission historique %s, y compris sans snapshot exposé', async (state) => {
    await tenant(); await historicalAdmission(state);
    await unavailable(first.ensureDay(TENANT, DAY));
    expect(await daysA.countDocuments({ state: 'ready' })).toBe(0);
    expect(await calendar()).toMatchObject({ state: 'seeding', sourceRevision: 7 });
    expect((await control())?.capacityControl?.dayIntent).toMatchObject({ day: DAY, sourceRevision: 7 });
  });

  it('ne traite ni une commande annulée ni une admission non engagée comme un siège historique', async () => {
    await tenant(); await historicalOrder('cancelled');
    await historicalAdmission('validating'); await historicalAdmission('rejected');
    expect((await first.ensureDay(TENANT, DAY)).state).toBe('ready');
    expect(await ordersA.countDocuments()).toBe(1);
    expect(await admissionsA.countDocuments()).toBe(2);
  });

  it('borne l’historique au jour Paris, sans confondre les jours UTC voisins', async () => {
    await tenant();
    await historicalOrder('ready', '2030-05-01T21:59:59.999Z');
    await historicalAdmission('committing', '2030-05-02T22:00:00.000Z');
    expect((await first.ensureDay(TENANT, DAY)).state).toBe('ready');
  });

  it.each(['2030-05-01T22:00:00.000Z', '2030-05-02T21:59:59.999Z'])('inclut l’historique aux bornes Paris %s même hors des heures de service', async (slot) => {
    await tenant(); await historicalOrder('ready', slot);
    await unavailable(first.ensureDay(TENANT, DAY));
    expect(await daysA.countDocuments({ state: 'ready' })).toBe(0);
    expect(await calendar()).toMatchObject({ state: 'seeding', sourceRevision: 7 });
  });
});
