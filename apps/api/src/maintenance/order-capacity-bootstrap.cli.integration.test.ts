import { randomUUID } from 'node:crypto';
import mongoose, { Types } from 'mongoose';
import { MODELS } from '@sm/db';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { orderAdmissionId } from '../modules/orders/order-admission-identity';
import { runCapacityBootstrapCli } from './order-capacity-bootstrap.cli';

/** Mongo réel uniquement ; la diffusion Redis est explicitement simulée. */
const redisFixture = vi.hoisted(() => ({ events: [] as string[], mode: 'ok',
  onPublish: (): void => undefined, release: (): void => undefined }));
vi.mock('ioredis', () => ({ default: class RedisTransportFixture {
  status = 'wait';
  on() { return this; }
  async connect() {
    redisFixture.events.push('connect');
    if (redisFixture.mode === 'connect_failure') throw new Error('synthetic-private-redis-failure');
    this.status = 'ready';
  }
  async publish() {
    redisFixture.events.push('publish');
    if (redisFixture.mode === 'blocked') await new Promise<void>((resolve) => { redisFixture.release = resolve; redisFixture.onPublish(); });
    if (redisFixture.mode === 'failure') { redisFixture.events.push('publish_failed'); throw new Error('synthetic-private-publish-failure'); }
    redisFixture.events.push('publish_settled'); return 1;
  }
  async quit() { redisFixture.events.push('quit'); this.status = 'end'; return 'OK'; }
  disconnect() { redisFixture.events.push('disconnect'); this.status = 'end'; }
} }));

const TENANT = '507f1f77bcf86cd799439011';
const OTHER = '507f1f77bcf86cd799439021';
const UUID = '11111111-1111-4111-8111-111111111111';
const RUN_ID = randomUUID();
const DAY = '2030-05-02'; const SLOT = new Date('2030-05-02T09:00:00.000Z');
const SECRET = 'synthetic-private-order-customer-and-token';
const READ = ['--tenant', TENANT, '--from-day', DAY];
const APPLY = [...READ, '--apply', '--bootstrap-id', UUID, '--writer-revision', 'a'.repeat(40), '--writers-stopped'];
export function capacityOperatorTestDatabase(raw: string): string {
  const target = new URL(raw);
  if (target.protocol !== 'mongodb:' || !['localhost', '127.0.0.1'].includes(target.hostname)
    || target.username || target.password || target.search || target.hash
    || !/^\/snackmanager_capacity_cli_test_[a-z0-9_]{1,20}$/i.test(target.pathname)) throw new Error('Base locale isolée opérateur requise.');
  target.pathname += `_${randomUUID().replaceAll('-', '').slice(0, 10)}`;
  return target.toString();
}
const uri = process.env.ORDER_CAPACITY_CLI_TEST_MONGO_URL ? capacityOperatorTestDatabase(process.env.ORDER_CAPACITY_CLI_TEST_MONGO_URL) : null;
const integration = uri ? describe : describe.skip;
describe('garde base isolée CLI', () => {
  it.each(['mongodb://remote.invalid/snackmanager_capacity_cli_test_ci', 'mongodb+srv://localhost/snackmanager_capacity_cli_test_ci',
    'mongodb://localhost/snackmanager', 'mongodb://localhost/admin', 'mongodb://localhost/snackmanager_capacity_cli_test_ci?replicaSet=live',
    'mongodb://localhost/snackmanager_capacity_cli_test_ci#fragment'])('refuse cible %s', (value) => {
    expect(() => capacityOperatorTestDatabase(value)).toThrow();
  });
  it('isole chaque exécution sous UUID', () => {
    const target = 'mongodb://127.0.0.1:27037/snackmanager_capacity_cli_test_ci';
    expect(capacityOperatorTestDatabase(target)).not.toBe(capacityOperatorTestDatabase(target));
  });
  it('refuse une URI avec authentification même sur loopback', () => {
    const target = new URL('mongodb://127.0.0.1:27037/snackmanager_capacity_cli_test_ci');
    target.username = 'synthetic'; target.password = 'synthetic';
    expect(() => capacityOperatorTestDatabase(target.toString())).toThrow();
  });
});

integration('CLI bootstrap — vrai Mongo local, aucun compte ni environnement métier', () => {
  let client: mongoose.mongo.MongoClient; let db: mongoose.mongo.Db; let owned = false;
  const commands: { name: string; command: mongoose.mongo.Document }[] = [];
  const ownCollections = [MODELS.Tenant.collection, MODELS.Order.collection, MODELS.PublicOrderAdmission.collection, MODELS.OrderCapacityDay.collection];
  async function assertOwned() {
    if (!owned || !uri || db.databaseName !== new URL(uri).pathname.slice(1)
      || !/^snackmanager_capacity_cli_test_[a-z0-9_]+_[a-f0-9]{10}$/i.test(db.databaseName)
      || !await db.collection('_test_run').findOne({ runId: RUN_ID })) throw new Error('Base opérateur de recette non possédée.');
  }
  async function tenant(id = TENANT) {
    await db.collection(MODELS.Tenant.collection).insertOne({ _id: new Types.ObjectId(id), name: 'Fixture opérateur', slug: `test-${id}`,
      hours: Array.from({ length: 7 }, (_, i) => ({ day: i + 1, lunch: { open: '11:00', close: '12:00' }, dinner: null })),
      settings: { slotIntervalMin: 30, slotCapacity: 3 }, delivery: { slotCapacity: 2 }, closures: [], contact: { email: SECRET } });
  }
  function snapshot(patch: Record<string, unknown> = {}) {
    const offline = new mongoose.Mongoose().createConnection();
    const Order = offline.model(MODELS.Order.name, MODELS.Order.schema, MODELS.Order.collection);
    return new Order({ _id: new Types.ObjectId('507f1f77bcf86cd799439099'), tenantId: TENANT, clientId: 'operator-fixture-order',
      number: 7, channel: 'phone', type: 'pickup', status: 'new', trackingToken: SECRET,
      lines: [], totals: { subtotal: 1250, total: 1250 }, payment: { method: 'counter', status: 'pending' },
      pickup: { slot: SLOT, customerName: SECRET, customerPhone: '0600000000' },
      createdAt: new Date('2030-05-02T08:00:00.000Z'), updatedAt: new Date('2030-05-02T08:00:00.000Z'), ...patch }).toObject({ transform: false });
  }
  async function committing() {
    const proof = { version: 1, proofHash: 'a'.repeat(64), payloadHash: 'b'.repeat(64) };
    const row = snapshot({ channel: 'online', publicRecovery: proof });
    await db.collection<mongoose.mongo.Document & { _id: string }>(MODELS.PublicOrderAdmission.collection).insertOne({ _id: orderAdmissionId(TENANT, row.clientId), tenantId: new Types.ObjectId(TENANT),
      clientId: row.clientId, version: 1, kind: 'public', channel: 'online', state: 'committing', slot: SLOT,
      proofHash: proof.proofHash, payloadHash: proof.payloadHash, orderId: row._id, snapshot: row });
    return row;
  }
  async function state() { return db.collection(MODELS.Tenant.collection).findOne({ _id: new Types.ObjectId(TENANT) }); }
  async function stored() {
    const names = (await db.listCollections({}, { nameOnly: true }).toArray()).map((c) => c.name).sort();
    return Promise.all(names.map(async (name) => ({ name, documents: await db.collection(name).find().sort({ _id: 1 }).toArray(),
      indexes: await db.collection(name).listIndexes().toArray() })));
  }
  function run(argv = READ, environment = 'staging') {
    const stdout = vi.fn(); const stderr = vi.fn();
    const result = runCapacityBootstrapCli({ argv, env: { MONGO_URL: uri!, REDIS_URL: 'redis://127.0.0.1:6379',
      RAILWAY_ENVIRONMENT_NAME: environment }, nodeVersion: '24.20.0', stdout, stderr });
    return { result, stdout, stderr };
  }
  beforeAll(async () => {
    client = new mongoose.mongo.MongoClient(uri!, { serverSelectionTimeoutMS: 5000 }); await client.connect(); db = client.db();
    expect(await db.listCollections({}, { nameOnly: true }).toArray()).toEqual([]);
    await db.collection('_test_run').insertOne({ runId: RUN_ID }); owned = true;
  });
  beforeEach(async () => {
    vi.restoreAllMocks(); await assertOwned();
    const present = new Set((await db.listCollections({}, { nameOnly: true }).toArray()).map((c) => c.name));
    for (const name of ownCollections) if (present.has(name)) await db.collection(name).drop();
    await tenant(); commands.length = 0; redisFixture.events.length = 0; redisFixture.mode = 'ok';
    const connect = mongoose.mongo.MongoClient.prototype.connect;
    vi.spyOn(mongoose.mongo.MongoClient.prototype, 'connect').mockImplementation(function (this: mongoose.mongo.MongoClient) {
      // Installed driver exposes this setter at runtime but omits it in d.ts.
      Reflect.set(this, 'monitorCommands', true);
      this.on('commandStarted', (event) => commands.push({ name: event.commandName, command: event.command }));
      return connect.call(this);
    });
  });
  afterEach(() => { vi.restoreAllMocks(); });
  afterAll(async () => {
    vi.restoreAllMocks(); try { if (owned) { await assertOwned(); await db.dropDatabase(); } } finally { await client?.close(); }
  });

  it('analyse seule ne crée ni collection, ni index, ni preuve pour un nouveau tenant', async () => {
    const before = await stored(); const f = run(); expect(await f.result).toBe(0);
    expect(await stored()).toEqual(before); expect(redisFixture.events).toEqual([]);
    const allowed = new Set(['hello', 'isMaster', 'aggregate', 'getMore', 'killCursors', 'endSessions']);
    expect(commands.some((x) => x.name === 'aggregate')).toBe(true);
    expect(commands.filter((x) => !allowed.has(x.name))).toEqual([]);
    expect(JSON.stringify(f.stdout.mock.calls)).not.toContain(SECRET);
    expect(JSON.parse(f.stdout.mock.calls[0]![0])).toMatchObject({ canActivate: false, requiresExclusiveRescan: true });
  });
  it('initialise un nouveau tenant uniquement via apply explicite, sans en créer un autre', async () => {
    const f = run(APPLY); expect(await f.result).toBe(0);
    expect((await state())?.capacityControl.state).toBe('active'); expect(await db.collection(MODELS.Tenant.collection).countDocuments()).toBe(1);
    expect(await db.collection(MODELS.PublicOrderAdmission.collection).countDocuments()).toBe(0);
    expect(redisFixture.events).toEqual(['connect', 'quit', 'disconnect']);
    expect(JSON.parse(f.stdout.mock.calls[0]![0])).toMatchObject({ state: 'active', orders: 0, rolloutVerifiedByCli: false });
  });
  it('importe puis rejoue la même opération sans modifier prix, jeton, autre tenant ou commande', async () => {
    const row = snapshot(); await db.collection(MODELS.Order.collection).insertOne(row); await tenant(OTHER);
    const otherBefore = await db.collection(MODELS.Tenant.collection).findOne({ _id: new Types.ObjectId(OTHER) });
    const first = run(APPLY); expect(await first.result).toBe(0);
    const second = run(APPLY); expect(await second.result).toBe(0);
    expect(JSON.parse(second.stdout.mock.calls[0]![0]).state).toBe('already_active');
    expect(await db.collection(MODELS.Order.collection).findOne({ _id: row._id })).toEqual(row);
    expect(await db.collection(MODELS.PublicOrderAdmission.collection).countDocuments()).toBe(1);
    expect(await db.collection(MODELS.Tenant.collection).findOne({ _id: new Types.ObjectId(OTHER) })).toEqual(otherBefore);
    expect(JSON.stringify([first.stdout.mock.calls, second.stdout.mock.calls])).not.toContain(SECRET);
  });
  it('refuse environnement production sans même connecter Mongo ou Redis', async () => {
    const before = await stored(); const f = run(APPLY, 'production'); expect(await f.result).toBe(2);
    expect(commands).toEqual([]); expect(redisFixture.events).toEqual([]); expect(await stored()).toEqual(before);
  });
  it('échec connexion Redis avant toute écriture laisse tenant/collections inchangés', async () => {
    redisFixture.mode = 'connect_failure'; const before = await stored(); const f = run(APPLY);
    expect(await f.result).toBe(1); expect(await stored()).toEqual(before);
    expect(JSON.stringify(f.stderr.mock.calls)).not.toContain('synthetic-private');
    expect(JSON.parse(f.stderr.mock.calls[0]![0])).toMatchObject({ operationMayHaveApplied: false });
  });
  it('attend le publish réellement engagé avant de fermer Redis, puis retourne reçu durable', async () => {
    const row = await committing(); redisFixture.mode = 'blocked';
    const published = new Promise<void>((resolve) => { redisFixture.onPublish = resolve; });
    const f = run(APPLY); await published;
    expect(redisFixture.events).not.toContain('quit'); redisFixture.release();
    expect(await f.result).toBe(0);
    expect(redisFixture.events.indexOf('quit')).toBeGreaterThan(redisFixture.events.indexOf('publish_settled'));
    expect(await db.collection(MODELS.Order.collection).findOne({ _id: row._id })).toMatchObject({ number: row.number, totals: row.totals, trackingToken: SECRET });
    expect(JSON.parse(f.stdout.mock.calls[0]![0])).toMatchObject({ state: 'active', notificationsBestEffort: { attempted: 1, failed: 0 } });
  });
  it('échec publication ne défait pas activation, affiche avertissement de diffusion et pas erreur brute', async () => {
    await committing(); redisFixture.mode = 'failure'; const f = run(APPLY); expect(await f.result).toBe(0);
    expect(JSON.parse(f.stdout.mock.calls[0]![0])).toMatchObject({ state: 'active', notificationsBestEffort: { attempted: 1, failed: 1 }, reloadOperationalScreens: true });
    expect(JSON.stringify([f.stdout.mock.calls, f.stderr.mock.calls])).not.toContain('synthetic-private');
  });
  it('tenant absent reste absent après apply refusé, sans init globale', async () => {
    await db.collection(MODELS.Tenant.collection).deleteOne({ _id: new Types.ObjectId(TENANT) });
    const before = await stored(); const f = run(APPLY); expect(await f.result).toBe(3);
    expect(await stored()).toEqual(before); expect((await state())).toBeNull();
  });
});
