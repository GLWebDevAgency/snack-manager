import { randomUUID } from 'node:crypto';
import mongoose, { Types, type Connection, type Model, type Query } from 'mongoose';
import { MODELS, type Order, type OrderCapacityDay, type PublicOrderAdmission, type Tenant } from '@sm/db';
import { DEFAULT_DELIVERY_SETTINGS } from '@sm/contracts';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { OrderCapacityCalendarStore, orderCapacityCalendarPlanHash } from '../ordering/order-capacity-calendar.store';
import { DeliveryService } from '../delivery/delivery.service';
import { TenantCapacitySettingsStore } from './tenant-capacity-settings.store';

const TENANT = '507f1f77bcf86cd799439011';
const OTHER_TENANT = '507f1f77bcf86cd799439021';
const DAY = '2030-05-02';
const SLOT = '2030-05-02T09:00:00.000Z';

export function settingsTestDatabase(raw: string): string {
  const url = new URL(raw);
  if (url.protocol !== 'mongodb:' || !['localhost', '127.0.0.1'].includes(url.hostname)
    || url.username || url.password || url.search || url.hash
    || !/^\/snackmanager_settings_test_[a-z0-9_]{1,20}$/i.test(url.pathname)) {
    throw new Error('ORDER_CAPACITY_SETTINGS_TEST_MONGO_URL doit cibler une base isolée locale snackmanager_settings_test_ sans options.');
  }
  url.pathname += `_${randomUUID().replaceAll('-', '').slice(0, 10)}`;
  return url.toString();
}
const uri = process.env.ORDER_CAPACITY_SETTINGS_TEST_MONGO_URL
  ? settingsTestDatabase(process.env.ORDER_CAPACITY_SETTINGS_TEST_MONGO_URL) : null;
const integration = uri ? describe : describe.skip;

describe('cible Mongo des réglages C15', () => {
  const credentials = new URL('mongodb://localhost/snackmanager_settings_test_ci');
  credentials.username = 'synthetic';
  credentials.password = 'synthetic';
  it.each([
    'mongodb://remote.example/snackmanager_settings_test_ci',
    'mongodb+srv://localhost/snackmanager_settings_test_ci',
    'mongodb://localhost/snackmanager', 'mongodb://localhost/admin',
    'mongodb://localhost/snackmanager_settings_test_ci?replicaSet=production',
    'mongodb://localhost/snackmanager_settings_test_ci#fragment', credentials.toString(),
  ])('refuse %s sans I/O', (value) => expect(() => settingsTestDatabase(value)).toThrow());

  it('isole deux exécutions par un suffixe aléatoire obligatoire', () => {
    const base = 'mongodb://127.0.0.1:27036/snackmanager_settings_test_local';
    expect(settingsTestDatabase(base)).not.toBe(settingsTestDatabase(base));
    expect(settingsTestDatabase(base)).toMatch(/\/snackmanager_settings_test_local_[a-f0-9]{10}$/);
  });
});

type Update = { $set?: Record<string, unknown>; $inc?: Record<string, number> };
type WriteEffect = (run: () => Promise<unknown>, filter: Record<string, unknown>, update: Update) => Promise<unknown>;
/** Observe/injecte le transport autour d’une véritable requête Mongo, sans faux résultat métier. */
function interceptWrite<T>(model: Model<T>, match: (update: Update) => boolean, effect: WriteEffect, once = true): Model<T> {
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
        return effect(run, args[0] as Record<string, unknown>, args[1] as Update);
      };
      return query;
    };
  } });
}
const anyWrite = () => true;
const isDayIntent = (update: Update) => typeof update.$set?.['capacityControl.dayIntent'] === 'object'
  && update.$set?.['capacityControl.dayIntent'] !== null;
const unavailable = (promise: Promise<unknown>) => expect(promise).rejects.toMatchObject({ status: 503 });
function barrier() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => { release = resolve; });
  return { promise, release };
}
function plain(document: unknown): Record<string, unknown> {
  const candidate = document as { toObject?: (options: { transform: false }) => Record<string, unknown> };
  return typeof candidate.toObject === 'function' ? candidate.toObject({ transform: false }) : document as Record<string, unknown>;
}

integration('réglages C15 — CAS sur deux connexions Mongo réelles', () => {
  let dbA: Connection; let dbB: Connection;
  let tenantsA: Model<Tenant>; let tenantsB: Model<Tenant>;
  let daysA: Model<OrderCapacityDay>; let admissionsA: Model<PublicOrderAdmission>; let ordersA: Model<Order>;
  let first: TenantCapacitySettingsStore; let second: TenantCapacitySettingsStore;

  beforeAll(async () => {
    dbA = await mongoose.createConnection(uri!).asPromise();
    dbB = await mongoose.createConnection(uri!).asPromise();
    tenantsA = dbA.model(MODELS.Tenant.name, MODELS.Tenant.schema, MODELS.Tenant.collection);
    tenantsB = dbB.model(MODELS.Tenant.name, MODELS.Tenant.schema, MODELS.Tenant.collection);
    daysA = dbA.model(MODELS.OrderCapacityDay.name, MODELS.OrderCapacityDay.schema, MODELS.OrderCapacityDay.collection);
    admissionsA = dbA.model(MODELS.PublicOrderAdmission.name, MODELS.PublicOrderAdmission.schema, MODELS.PublicOrderAdmission.collection);
    ordersA = dbA.model(MODELS.Order.name, MODELS.Order.schema, MODELS.Order.collection);
    await Promise.all([tenantsA.init(), daysA.init(), admissionsA.init(), ordersA.init()]);
  });
  beforeEach(async () => {
    // Seule notre base UUID est nettoyée ; les jours immuables exigent le
    // driver natif dans ce contexte administratif de fixtures isolées.
    await Promise.all([tenantsA.deleteMany({}), daysA.collection.deleteMany({}), admissionsA.deleteMany({}), ordersA.deleteMany({})]);
    first = new TenantCapacitySettingsStore(tenantsA);
    second = new TenantCapacitySettingsStore(tenantsB);
  });
  afterAll(async () => {
    if (dbA) { await dbA.dropDatabase(); await dbA.close(); }
    if (dbB) await dbB.close();
  });

  function activeControl() {
    return { version: 1, state: 'active', configRevision: 7, bootstrapId: randomUUID(),
      cutoverAt: new Date('2030-05-01T00:00:00.000Z'), dayIntent: null };
  }
  async function tenant(id = TENANT, active = true) {
    return tenantsA.create({ _id: id, slug: `settings-test-${id}`, name: 'Restaurant de recette réglages C15',
      hours: [{ day: 4, lunch: { open: '11:00', close: '12:00' }, dinner: null }], closures: [],
      settings: { slotIntervalMin: 30, slotCapacity: 4 }, delivery: { slotCapacity: 2 },
      ...(active ? { capacityControl: activeControl() } : {}),
    });
  }
  const stored = (id = TENANT) => tenantsB.findById(id).select('+capacityControl').lean();
  const calendarStore = (tenants = tenantsA) => new OrderCapacityCalendarStore(tenants, daysA, admissionsA, ordersA);
  function dayIntent() {
    const plan = { day: DAY, sourceRevision: 7, closedReason: null,
      slots: [{ at: new Date(SLOT), kitchenCapacity: 4, deliveryCapacity: 2 }] };
    return { ...plan, operationId: randomUUID(), planHash: orderCapacityCalendarPlanHash(plan) };
  }

  it('met à jour un ancien tenant sans activer C15 ni créer capacityControl', async () => {
    await tenant(TENANT, false);
    const result = await first.update(TENANT, { 'settings.slotCapacity': 7 });
    expect(plain(result)).toMatchObject({ settings: { slotCapacity: 7 } });
    expect(plain(result)).not.toHaveProperty('capacityControl');
    expect(await stored()).toMatchObject({ settings: { slotCapacity: 7 } });
    expect(Object.hasOwn((await stored())!, 'capacityControl')).toBe(false);
  });

  it('renvoie404 pour un tenant absent sans upsert', async () => {
    await expect(first.update(TENANT, { 'settings.slotCapacity': 7 })).rejects.toMatchObject({ status: 404 });
    expect(await tenantsA.countDocuments()).toBe(0);
  });

  it('applique patch et incrément dans un seul CAS sans altérer l’intention figée', async () => {
    await tenant();
    const intent = dayIntent();
    await tenantsA.updateOne({ _id: TENANT }, { $set: { 'capacityControl.dayIntent': intent } });
    const before = (await stored())!.capacityControl!;
    const writes: Update[] = [];
    const observed = interceptWrite(tenantsA, anyWrite, (run, _filter, update) => { writes.push(update); return run(); }, false);
    const result = await new TenantCapacitySettingsStore(observed).update(TENANT, { 'settings.slotCapacity': 7 });
    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({ $set: { 'settings.slotCapacity': 7 }, $inc: { 'capacityControl.configRevision': 1 } });
    expect(plain(result)).not.toHaveProperty('capacityControl');
    expect(await stored()).toMatchObject({ settings: { slotCapacity: 7 }, capacityControl: { ...before, configRevision: 8 } });
  });

  it('respecte une projection positive de réponse sans exposer le contrôle ni les autres données privées', async () => {
    await tenant();
    const result = plain(await first.update(TENANT, { 'settings.slotCapacity': 7 }, { name: 1, settings: 1 }));
    expect(result).toMatchObject({ name: 'Restaurant de recette réglages C15', settings: { slotCapacity: 7 } });
    for (const key of ['capacityControl', 'stripe', 'billing', 'encaissement', 'contact', 'hours']) expect(result).not.toHaveProperty(key);
    expect((await stored())!.capacityControl!.configRevision).toBe(8);
  });

  it.each<Record<string, 0 | 1>>([
    { capacityControl: 1 }, { capacityControl: 0 }, { 'capacityControl.bootstrapId': 1 }, { name: 1, 'capacityControl.configRevision': 1 },
  ])('refuse une projection mentionnant le contrôle privé %j avant écriture', async (projection) => {
    await tenant();
    const before = await stored();
    await expect(first.update(TENANT, { 'settings.slotCapacity': 7 }, projection)).rejects.toMatchObject({ status: 400 });
    expect(await stored()).toEqual(before);
  });

  it.each(['version', 'bootstrapId', 'cutoverAt', 'configRevision'])('refuse un contrôle partiel sans le champ %s, sans inventer sa valeur', async (field) => {
    await tenant();
    await tenantsA.collection.updateOne({ _id: new Types.ObjectId(TENANT) }, { $unset: { [`capacityControl.${field}`]: '' } });
    const before = await stored();
    await unavailable(first.update(TENANT, { 'settings.slotCapacity': 7 }));
    expect(await stored()).toEqual(before);
  });

  it('un patch de réglages ne blanchit pas une intention dont le hash est invalide', async () => {
    await tenant();
    const intent = { ...dayIntent(), planHash: 'f'.repeat(64) };
    await tenantsA.collection.updateOne({ _id: new Types.ObjectId(TENANT) }, { $set: { 'capacityControl.dayIntent': intent } });
    const before = await stored();
    await unavailable(first.update(TENANT, { 'settings.slotCapacity': 7 }));
    expect(await stored()).toEqual(before);
  });

  it('valide les horaires et fermetures ensemble en incrémentant une seule fois', async () => {
    await tenant();
    const hours = [{ day: 4, lunch: { open: '11:30', close: '13:00' }, dinner: null }];
    const closures = [{ from: '2030-05-03T08:00:00.000Z', to: '2030-05-03T19:00:00.000Z', reason: 'Fermeture de recette' }];
    await first.update(TENANT, { hours, closures });
    expect(await stored()).toMatchObject({ hours, closures: [{ ...closures[0], from: new Date(closures[0]!.from), to: new Date(closures[0]!.to) }],
      capacityControl: { configRevision: 8 } });
  });

  it('accepte une configuration livraison complète et fige les capacités suivantes à la nouvelle révision', async () => {
    await tenant();
    const delivery = { ...DEFAULT_DELIVERY_SETTINGS, zones: [], slotCapacity: 5 };
    await first.update(TENANT, { delivery });
    expect(await stored()).toMatchObject({ delivery, capacityControl: { configRevision: 8 } });
    const day = await calendarStore().ensureDay(TENANT, DAY);
    expect(day.sourceRevision).toBe(8);
    expect(day.slots.every((slot) => slot.deliveryCapacity === 5)).toBe(true);
  });

  it.each([false, true])('la réponse livraison reste identique à la relecture Mongo après PATCH (contrôle actif : %s)', async (active) => {
    await tenant(TENANT, active);
    const service = new DeliveryService(tenantsA, {} as never, {} as never,
      { log: async () => undefined } as never, {} as never, {} as never);
    const delivery = { ...DEFAULT_DELIVERY_SETTINGS, enabled: true, slotCapacity: 5,
      zones: [{ id: 'local', name: 'Zone locale', postalCodes: ['75001'], feeCents: 500,
        minimumOrderCents: 1500, freeDeliveryFromCents: 3500 }] };
    const response = await service.updateSettings(TENANT, delivery,
      { sub: 'owner', tenantId: TENANT, role: 'owner' } as never);
    expect(response).toEqual(delivery);
    expect(await service.settings(TENANT)).toEqual(response);
    expect(response).not.toHaveProperty('capacityControl');
    expect(await stored()).toMatchObject({ delivery });
  });

  it('un patch mixte garde les autres réglages autorisés et leurs transformations de contrat', async () => {
    await tenant();
    await first.update(TENANT, { 'settings.slotCapacity': 7, 'settings.onlineOrderingPaused': true,
      'settings.pauseMessage': '  Pause de recette  ', 'settings.printTicketOn': 'ready', 'settings.dailyGoalCents': null });
    expect(await stored()).toMatchObject({ settings: { slotCapacity: 7, onlineOrderingPaused: true,
      pauseMessage: 'Pause de recette', printTicketOn: 'ready', dailyGoalCents: null }, capacityControl: { configRevision: 8 } });
  });

  it.each<{ label: string; patch: Record<string, unknown> }>([
    { label: 'opérateur racine', patch: { $inc: { 'capacityControl.configRevision': 1 } } },
    { label: 'objet contrôle', patch: { capacityControl: {} } },
    { label: 'enfant contrôle', patch: { 'settings.slotCapacity': 7, 'capacityControl.state': 'active' } },
    { label: 'champ inconnu', patch: { 'settings.slotCapacity': 7, name: 'Nom injecté' } },
    { label: 'sous-chemin livraison non pris en charge', patch: { 'delivery.slotCapacity': 5 } },
    { label: 'settings entier', patch: { settings: { slotCapacity: 7 } } },
    { label: 'patch vide', patch: {} },
    { label: 'pause seule non capacitaire', patch: { 'settings.onlineOrderingPaused': true } },
    { label: 'capacité indéfinie explicite', patch: { 'settings.slotCapacity': undefined } },
    { label: 'autre valeur indéfinie explicite', patch: { 'settings.slotCapacity': 7, 'settings.pauseMessage': undefined } },
    { label: 'capacité négative', patch: { 'settings.slotCapacity': -1 } },
    { label: 'intervalle nul', patch: { 'settings.slotIntervalMin': 0 } },
    { label: 'livraison incomplète', patch: { delivery: { slotCapacity: 5 } } },
    { label: 'livraison active sans zone', patch: { delivery: { ...DEFAULT_DELIVERY_SETTINGS, enabled: true } } },
    { label: 'horaires invalides', patch: { hours: [{ day: 4, lunch: { open: '25:00', close: '26:00' } }] } },
    { label: 'fermeture invalide', patch: { closures: [{ from: 'pas-une-date', to: '2030-05-03T19:00:00.000Z' }] } },
  ])('refuse400 $label sans aucun effet métier', async ({ patch }) => {
    await tenant();
    const before = await stored();
    await expect(first.update(TENANT, patch)).rejects.toMatchObject({ status: 400 });
    expect(await stored()).toEqual(before);
  });

  it.each(['seeding', 'blocked'])('refuse un contrôle %s sans modifier les réglages ni sa révision', async (state) => {
    await tenant();
    await tenantsA.collection.updateOne({ _id: new Types.ObjectId(TENANT) }, { $set: { 'capacityControl.state': state } });
    const before = await stored();
    await unavailable(first.update(TENANT, { 'settings.slotCapacity': 7 }));
    expect(await stored()).toEqual(before);
  });

  it('ne confond pas capacityControl:null avec un champ historique absent', async () => {
    await tenant(TENANT, false);
    await tenantsA.collection.updateOne({ _id: new Types.ObjectId(TENANT) }, { $set: { capacityControl: null } });
    const before = await stored();
    await unavailable(first.update(TENANT, { 'settings.slotCapacity': 7 }));
    expect(await stored()).toEqual(before);
  });

  it.each([
    ['version', 2], ['configRevision', -1], ['configRevision', 1.5], ['bootstrapId', 'pas-un-uuid'], ['cutoverAt', null],
  ])('refuse un contrôle natif corrompu %s=%s avant écriture', async (field, value) => {
    await tenant();
    await tenantsA.collection.updateOne({ _id: new Types.ObjectId(TENANT) }, { $set: { [`capacityControl.${field}`]: value } });
    const before = await stored();
    await unavailable(first.update(TENANT, { 'settings.slotCapacity': 7 }));
    expect(await stored()).toEqual(before);
  });

  it('refuse le dépassement MAX_SAFE_INTEGER sans appliquer le patch', async () => {
    await tenant();
    await tenantsA.updateOne({ _id: TENANT }, { $set: { 'capacityControl.configRevision': Number.MAX_SAFE_INTEGER } });
    const before = await stored();
    await unavailable(first.update(TENANT, { 'settings.slotCapacity': 7 }));
    expect(await stored()).toEqual(before);
  });

  it('permet le dernier incrément sûr puis refuse le suivant', async () => {
    await tenant();
    await tenantsA.updateOne({ _id: TENANT }, { $set: { 'capacityControl.configRevision': Number.MAX_SAFE_INTEGER - 1 } });
    await first.update(TENANT, { 'settings.slotCapacity': 7 });
    expect((await stored())!.capacityControl!.configRevision).toBe(Number.MAX_SAFE_INTEGER);
    await unavailable(second.update(TENANT, { 'settings.slotCapacity': 8 }));
    expect((await stored())?.settings?.slotCapacity).toBe(7);
  });

  it('isole strictement les réglages et la révision de chaque restaurant', async () => {
    await tenant(); await tenant(OTHER_TENANT);
    const other = await stored(OTHER_TENANT);
    await first.update(TENANT, { 'settings.slotCapacity': 7 });
    expect(await stored(OTHER_TENANT)).toEqual(other);
  });

  it('deux writers de champs distincts conservent leurs patches et deux révisions', async () => {
    await tenant();
    const ready = barrier(); let writers = 0;
    const collide: WriteEffect = async (run) => { writers += 1; if (writers === 2) ready.release(); await ready.promise; return run(); };
    const a = new TenantCapacitySettingsStore(interceptWrite(tenantsA, anyWrite, collide));
    const b = new TenantCapacitySettingsStore(interceptWrite(tenantsB, anyWrite, collide));
    await Promise.all([a.update(TENANT, { 'settings.slotCapacity': 7 }), b.update(TENANT, { 'settings.slotIntervalMin': 15 })]);
    expect(writers).toBe(2);
    expect(await stored()).toMatchObject({ settings: { slotCapacity: 7, slotIntervalMin: 15 }, capacityControl: { configRevision: 9 } });
  });

  it('un ancien writer ne passe pas silencieusement au-dessus d’une activation C15 concurrente', async () => {
    await tenant(TENANT, false);
    const activation = activeControl();
    let firstFilter: Record<string, unknown> | undefined;
    const racing = interceptWrite(tenantsA, anyWrite, async (run, filter) => {
      firstFilter = filter;
      await tenantsB.updateOne({ _id: TENANT }, { $set: { capacityControl: activation } });
      return run();
    });
    await new TenantCapacitySettingsStore(racing).update(TENANT, { 'settings.slotCapacity': 7 });
    expect(firstFilter).toMatchObject({ capacityControl: { $exists: false } });
    expect(await stored()).toMatchObject({ settings: { slotCapacity: 7 }, capacityControl: { ...activation, configRevision: 8 } });
  });

  it('un contrôle bloqué entre lecture et CAS empêche le patch préparé', async () => {
    await tenant();
    const racing = interceptWrite(tenantsA, anyWrite, async (run) => {
      await tenantsB.updateOne({ _id: TENANT }, { $set: { 'capacityControl.state': 'blocked' } });
      return run();
    });
    await unavailable(new TenantCapacitySettingsStore(racing).update(TENANT, { 'settings.slotCapacity': 7 }));
    expect(await stored()).toMatchObject({ settings: { slotCapacity: 4 }, capacityControl: { state: 'blocked', configRevision: 7 } });
  });

  it('un changement de génération entre lecture et CAS exige une nouvelle lecture avant écriture', async () => {
    await tenant();
    const bootstrapB = randomUUID();
    const filters: Record<string, unknown>[] = [];
    const racing = interceptWrite(tenantsA, anyWrite, async (run, filter) => {
      filters.push(filter);
      if (filters.length === 1) await tenantsB.updateOne({ _id: TENANT }, { $set: { 'capacityControl.bootstrapId': bootstrapB } });
      return run();
    }, false);
    await new TenantCapacitySettingsStore(racing).update(TENANT, { 'settings.slotCapacity': 7 });
    expect(filters).toHaveLength(2);
    expect(filters[0]?.['capacityControl.bootstrapId']).not.toBe(bootstrapB);
    expect(filters[1]).toMatchObject({ 'capacityControl.bootstrapId': bootstrapB });
    expect(await stored()).toMatchObject({ settings: { slotCapacity: 7 }, capacityControl: { bootstrapId: bootstrapB, configRevision: 8 } });
  });

  it('la perte de réponse après vrai commit donne503 et ne rejoue jamais le write automatiquement', async () => {
    await tenant();
    let writes = 0;
    const lossy = interceptWrite(tenantsA, anyWrite, async (run) => { writes += 1; await run(); throw new Error('Réponse write perdue — injection locale'); }, false);
    await unavailable(new TenantCapacitySettingsStore(lossy).update(TENANT, { 'settings.slotCapacity': 7 }));
    expect(writes).toBe(1);
    expect(await stored()).toMatchObject({ settings: { slotCapacity: 7 }, capacityControl: { configRevision: 8 } });
  });

  it('une erreur avant transmission ne lance pas non plus un second write à l’aveugle', async () => {
    await tenant();
    let writes = 0;
    const failing = interceptWrite(tenantsA, anyWrite, async () => { writes += 1; throw new Error('Transport indisponible — injection locale'); }, false);
    await unavailable(new TenantCapacitySettingsStore(failing).update(TENANT, { 'settings.slotCapacity': 7 }));
    expect(writes).toBe(1);
    expect(await stored()).toMatchObject({ settings: { slotCapacity: 4 }, capacityControl: { configRevision: 7 } });
  });

  it.each(['active', 'legacy'] as const)('un CAS réellement retardé du tenant %s ne remplace pas le réglage plus récent de B', async (initial) => {
    await tenant(TENANT, initial === 'active');
    const send = barrier();
    let delayedWrite: Promise<unknown> | undefined;
    let writes = 0;
    const delayed = interceptWrite(tenantsA, anyWrite, async (run) => {
      writes += 1;
      // Le client voit une erreur MAINTENANT, mais sa véritable requête reste
      // susceptible d’arriver plus tard. Aucun résultat Mongo n’est simulé.
      delayedWrite = send.promise.then(run);
      // Évite un rejet détaché si le test échoue avant son finally ; le même
      // résultat est néanmoins attendu/asserté, puis drainé avant le teardown.
      void delayedWrite.catch(() => undefined);
      throw new Error('Délai réseau dépassé avant arrivée du write — injection locale');
    }, false);
    try {
      await unavailable(new TenantCapacitySettingsStore(delayed).update(TENANT, { 'settings.slotCapacity': 7 }));
      expect(writes).toBe(1);
      expect(delayedWrite).toBeDefined();
      if (initial === 'legacy') {
        // Un tenant encore legacy n’a pas de fence de révision ; on ne lui
        // invente pas cette garantie. Ce cas vérifie la vraie barrière exists
        // lorsque son activation intervient avant l’arrivée du vieux write.
        await tenantsB.updateOne({ _id: TENANT }, { $set: { capacityControl: activeControl() } });
      }
      await second.update(TENANT, { 'settings.slotCapacity': 9 });
      const winner = await stored();
      expect(winner).toMatchObject({ settings: { slotCapacity: 9 }, capacityControl: { configRevision: 8 } });
      send.release();
      expect(await delayedWrite).toBeNull();
      expect(await stored()).toEqual(winner);
      expect(writes).toBe(1);
    } finally {
      send.release();
      await delayedWrite;
    }
  });

  it('une contention persistante est bornée et ne prétend jamais avoir appliqué le patch', async () => {
    await tenant();
    let attempts = 0;
    const contended = interceptWrite(tenantsA, anyWrite, async (run) => {
      attempts += 1;
      await tenantsB.updateOne({ _id: TENANT }, { $inc: { 'capacityControl.configRevision': 1 } });
      return run();
    }, false);
    await unavailable(new TenantCapacitySettingsStore(contended).update(TENANT, { 'settings.slotCapacity': 7 }));
    expect(attempts).toBeGreaterThan(1);
    expect(attempts).toBeLessThanOrEqual(20);
    expect((await stored())?.settings?.slotCapacity).toBe(4);
  });

  it('le calendrier recalcule si le writer des réglages gagne avant son CAS', async () => {
    await tenant();
    const racing = interceptWrite(tenantsA, isDayIntent, async (run) => {
      await second.update(TENANT, { 'settings.slotCapacity': 7, 'settings.slotIntervalMin': 60 });
      return run();
    });
    const day = await calendarStore(racing).ensureDay(TENANT, DAY);
    expect(day.sourceRevision).toBe(8);
    expect(day.slots).toHaveLength(2);
    expect(day.slots.every((slot) => slot.kitchenCapacity === 7)).toBe(true);
  });

  it('les réglages changent pour les jours suivants sans modifier le plan déjà gelé par CAS', async () => {
    await tenant();
    const racing = interceptWrite(tenantsA, isDayIntent, async (run) => {
      const result = await run();
      const intent = (await stored())!.capacityControl!.dayIntent;
      await second.update(TENANT, { 'settings.slotCapacity': 7 });
      expect((await stored())!.capacityControl!.dayIntent).toEqual(intent);
      return result;
    });
    const day = await calendarStore(racing).ensureDay(TENANT, DAY);
    expect(day.sourceRevision).toBe(7);
    expect(day.slots.every((slot) => slot.kitchenCapacity === 4)).toBe(true);
    expect((await stored())!.capacityControl!.configRevision).toBe(8);
  });
});
