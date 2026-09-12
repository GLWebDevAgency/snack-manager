import { randomUUID } from 'node:crypto';
import { ConflictException } from '@nestjs/common';
import { MODELS, type AuditLog, type Order, type Staff, type User } from '@sm/db';
import type { OrderRefundRequest } from '@sm/contracts';
import mongoose, { Types, type Connection, type Model, type Query } from 'mongoose';
import type Redis from 'ioredis';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { OrderRefundsService, type RefundStripeClient } from './order-refunds.service';
import type { ProviderRefund } from './order-refunds.policy';
import { paymentBarrier, paymentOutcome } from './order-payment-test-provider';
import { AuditService } from '../audit/audit.module';

const DATABASE_PREFIX = 'snackmanager_payment_test_';
const RUN_ID = randomUUID().replaceAll('-', '');
const TENANT = new Types.ObjectId('507f1f77bcf86cd799439011');
const ACTOR = '507f1f77bcf86cd799439022';
const ACCOUNT = 'acct_refund_test';
const INTENT = 'pi_refund_test';

function isolatedDatabase(raw: string): { uri: string; name: string } {
  let url: URL;
  try { url = new URL(raw); } catch { throw new Error('ORDER_PAYMENT_TEST_MONGO_URL invalide.'); }
  const name = url.pathname.slice(1);
  if (url.protocol !== 'mongodb:' || !['127.0.0.1', 'localhost'].includes(url.hostname)
    || url.username || url.password || url.search || url.hash
    || !/^snackmanager_payment_test_[a-z0-9_]+$/i.test(name) || name.length > 48) {
    throw new Error('ORDER_PAYMENT_TEST_MONGO_URL doit cibler une base snackmanager_payment_test_ locale sans options ni identifiants.');
  }
  const isolatedName = `${name}_${RUN_ID.slice(0, 12)}`;
  url.pathname = `/${isolatedName}`;
  return { uri: url.toString(), name: isolatedName };
}

const requestedUrl = process.env.ORDER_PAYMENT_TEST_MONGO_URL;
const database = requestedUrl ? isolatedDatabase(requestedUrl) : null;
const integration = database ? describe : describe.skip;

describe('garde-fous Mongo des remboursements durables', () => {
  it.each([
    'mongodb://example.com/snackmanager_payment_test_ci', 'mongodb://127.0.0.1/snackmanager',
    'mongodb://localhost/admin', 'mongodb://localhost/snackmanager_payment_test_',
    'mongodb://localhost/snackmanager_payment_test_ci?replicaSet=production',
    'mongodb://user:password@localhost/snackmanager_payment_test_ci',
    'mongodb+srv://localhost/snackmanager_payment_test_ci',
    'mongodb://localhost,example.com/snackmanager_payment_test_ci',
  ])('refuse la cible non possédée avant tout I/O : %s', (uri) => {
    expect(() => isolatedDatabase(uri)).toThrow('ORDER_PAYMENT_TEST_MONGO_URL');
  });
  it.each(['localhost', '127.0.0.1'])('isole le run sur %s sans utiliser la base fournie', (host) => {
    const target = isolatedDatabase(`mongodb://${host}:27048/snackmanager_payment_test_refunds`);
    expect(target.name).toMatch(/^snackmanager_payment_test_refunds_[a-f0-9]{12}$/);
    expect(new URL(target.uri).hostname).toBe(host);
  });
});

type CreateParameters = Parameters<RefundStripeClient['refunds']['create']>[0];
type ProviderOptions = Parameters<RefundStripeClient['refunds']['create']>[1];
type Refund = ProviderRefund & { currency: string; payment_intent: string };
type StoredOperation = {
  operationId: string; amountCents: number; reason: string; actorId: string;
  environment: 'test' | 'live'; paymentIntentId: string; accountId: string | null;
  idempotencyKey: string; preparedAt: Date; requestStartedAt?: Date | null;
  refund?: Refund | null; state: string;
};
type StoredOrder = {
  __v: number; payment: { status: string; pendingRefundCents: number; refundedCents: number };
  refundFlow?: { version: number; operations: StoredOperation[] } | null;
};

/** The simulated remote registry survives service instances and lost responses. No SDK/network. */
class RefundProvider implements RefundStripeClient {
  environment: 'test' | 'live' = 'test';
  hideList = false;
  readonly rows: { refund: Refund; accountId: string | null; environment: string }[] = [];
  private readonly keys = new Map<string, { fingerprint: string; refund: Refund }>();
  readonly hooks: {
    beforeCreate?: () => Promise<void>;
    afterCreate?: (refund: Refund) => Promise<void>;
    afterList?: (rows: Refund[]) => Promise<void>;
  } = {};
  get createdCount() { return this.rows.length; }
  pruneIdempotencyKeys() { this.keys.clear(); }
  readonly refunds = {
    list: vi.fn(async (params: { payment_intent: string; limit: number; starting_after?: string }, options: ProviderOptions) => {
      const rows = this.hideList ? [] : this.rows.filter(row => row.accountId === (options.stripeAccount ?? null)
        && row.environment === this.environment && row.refund.payment_intent === params.payment_intent).map(row => structuredClone(row.refund));
      await this.hooks.afterList?.(rows);
      return { data: rows, has_more: false };
    }),
    create: vi.fn(async (params: CreateParameters, options: ProviderOptions): Promise<Refund> => {
      await this.hooks.beforeCreate?.();
      const key = JSON.stringify([this.environment, options.stripeAccount ?? null, options.idempotencyKey]);
      const fingerprint = JSON.stringify([params.payment_intent, params.amount, Object.entries(params.metadata).sort(([a], [b]) => a.localeCompare(b))]);
      const previous = this.keys.get(key);
      if (previous && previous.fingerprint !== fingerprint) throw new Error('Clé provider réutilisée avec paramètres divergents.');
      if (!previous) {
        const refund = { id: `re_test_${randomUUID().replaceAll('-', '')}`, amount: params.amount,
          currency: 'eur', payment_intent: params.payment_intent, status: 'succeeded', metadata: structuredClone(params.metadata) };
        this.keys.set(key, { fingerprint, refund });
        this.rows.push({ refund, accountId: options.stripeAccount ?? null, environment: this.environment });
      }
      const refund = structuredClone(this.keys.get(key)!.refund);
      await this.hooks.afterCreate?.(refund);
      return refund;
    }),
  };
  readonly charges = { retrieve: vi.fn(async () => ({ payment_intent: INTENT })) };
}

/** Intercepts a real Query, preserving the driver write before an injected ACK loss. */
function interceptWrites(model: Model<Order>, mode: 'reject' | 'lose_ack' | 'lose_ack_and_read') {
  let injected = 0;
  const proxy = new Proxy(model, { get(target, property) {
    const value = Reflect.get(target, property, target);
    if (mode === 'lose_ack_and_read' && ['findOne', 'findById'].includes(String(property))) {
      return (...args: unknown[]) => {
        const query = Reflect.apply(value, target, args) as Query<unknown, Order>;
        const execute = query.exec.bind(query);
        query.exec = () => injected ? Promise.reject(new Error('Relecture Mongo indisponible après ACK perdu.')) : execute();
        return query;
      };
    }
    if (!['findOneAndUpdate', 'updateOne'].includes(String(property))) return typeof value === 'function' ? value.bind(target) : value;
    return (...args: unknown[]) => {
      const query = Reflect.apply(value, target, args) as Query<unknown, Order>;
      const execute = query.exec.bind(query);
      query.exec = async () => {
        if (mode === 'reject') { injected += 1; throw new Error('Écriture Mongo indisponible avant engagement.'); }
        const result = await execute();
        const changed = result && typeof result === 'object'
          && ('_id' in result || ('modifiedCount' in result && result.modifiedCount === 1));
        if (!injected && changed && JSON.stringify(args[1]).includes('refundFlow')) {
          injected += 1;
          throw new Error('ACK Mongo perdu après engagement du remboursement.');
        }
        return result;
      };
      return query;
    };
  } });
  return { proxy, injections: () => injected };
}

integration('remboursements durables sur deux connexions Mongo standalone', () => {
  let firstConnection: Connection;
  let secondConnection: Connection;
  let first: Model<Order>;
  let second: Model<Order>;
  let firstAudit: Model<AuditLog>;
  let secondAudit: Model<AuditLog>;
  let ownsDatabase = false;
  let provider: RefundProvider;
  let capabilities: string[];
  let audit: { log: ReturnType<typeof vi.fn>; logOnce: ReturnType<typeof vi.fn> };
  let publish: ReturnType<typeof vi.fn>;
  let commands: { commandName: string; command: Record<string, unknown> }[] = [];

  async function assertOwnedDatabase() {
    if (!database || !ownsDatabase || firstConnection.name !== database.name
      || !database.name.startsWith(DATABASE_PREFIX) || !database.name.endsWith(RUN_ID.slice(0, 12))) {
      throw new Error('Nettoyage interdit : base de remboursement non possédée par ce run.');
    }
    if (!await firstConnection.db!.collection('_test_run').findOne({ runId: RUN_ID })) {
      throw new Error('Nettoyage interdit : preuve de propriété absente.');
    }
  }
  beforeAll(async () => {
    if (!database) throw new Error('Base de recette absente.');
    const options = { autoCreate: false, autoIndex: false, directConnection: true, family: 4, serverSelectionTimeoutMS: 5000, monitorCommands: true };
    firstConnection = await mongoose.createConnection(database.uri, options).asPromise();
    firstConnection.getClient().on('commandStarted', event => commands.push({ commandName: event.commandName, command: event.command }));
    const hello = await firstConnection.db!.admin().command({ hello: 1 });
    expect(hello.setName).toBeUndefined(); expect(hello.msg).not.toBe('isdbgrid');
    expect(await firstConnection.db!.listCollections({}, { nameOnly: true }).toArray()).toEqual([]);
    await firstConnection.db!.collection('_test_run').insertOne({ runId: RUN_ID });
    ownsDatabase = true;
    first = firstConnection.model<Order>(MODELS.Order.name, MODELS.Order.schema, MODELS.Order.collection);
    await first.createCollection(); await first.createIndexes();
    firstAudit = firstConnection.model<AuditLog>(MODELS.AuditLog.name, MODELS.AuditLog.schema, MODELS.AuditLog.collection);
    await firstAudit.createCollection();
    secondConnection = await mongoose.createConnection(database.uri, options).asPromise();
    second = secondConnection.model<Order>(MODELS.Order.name, MODELS.Order.schema, MODELS.Order.collection);
    secondAudit = secondConnection.model<AuditLog>(MODELS.AuditLog.name, MODELS.AuditLog.schema, MODELS.AuditLog.collection);
  }, 20_000);
  beforeEach(async () => {
    await assertOwnedDatabase(); await first.deleteMany({});
    // This disposable run owns the collection; ordinary AuditLog writes remain append-only.
    await firstAudit.collection.deleteMany({});
    provider = new RefundProvider(); capabilities = ['bo'];
    commands = [];
    audit = { log: vi.fn(async () => undefined), logOnce: vi.fn(async () => undefined) };
    publish = vi.fn(async () => 1);
  });
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });
  afterAll(async () => {
    try { if (ownsDatabase) { await assertOwnedDatabase(); await firstConnection.dropDatabase(); } }
    finally { await Promise.all([firstConnection?.close(), secondConnection?.close()]); }
  });

  const service = (orders = first) => new OrderRefundsService(orders, async () => provider,
    { publish } as unknown as Redis, { pourTenant: async () => capabilities } as never, audit as never);
  const nativeAuditService = (logs = firstAudit) => new AuditService(logs,
    logs.db.model<Staff>(MODELS.Staff.name, MODELS.Staff.schema, MODELS.Staff.collection),
    logs.db.model<User>(MODELS.User.name, MODELS.User.schema, MODELS.User.collection));
  const serviceWithNativeAudit = (orders = first, logs = firstAudit) => new OrderRefundsService(orders, async () => provider,
    { publish } as unknown as Redis, { pourTenant: async () => capabilities } as never, nativeAuditService(logs));
  const read = (id: string) => second.findById(id).select('+refundFlow').read('primary').readConcern('majority').lean<StoredOrder>();
  const body = (overrides: Partial<OrderRefundRequest> = {}): OrderRefundRequest => ({
    operationId: randomUUID(), amountCents: 250, reason: 'Produit indisponible', password: 'never-journal-this-password', ...overrides,
  });
  const request = (id: string, input: OrderRefundRequest, orders = first, actorId = ACTOR) => service(orders).request(String(TENANT), id, actorId, input);
  async function seed(overrides: Record<string, unknown> = {}) {
    const row = await first.create({ tenantId: TENANT, number: 1, clientId: randomUUID(), channel: 'online', type: 'pickup',
      lines: [], totals: { subtotal: 1250, total: 1250 }, status: 'ready',
      payment: { method: 'online', status: 'paid', stripePaymentIntentId: INTENT, stripeAccountId: ACCOUNT },
      paymentFlow: { version: 1, origin: 'adopted_intent', phase: 'settled' }, ...overrides });
    return String(row._id);
  }

  it('rend intention privée, réserve et __v visibles avant le premier create fournisseur', async () => {
    const id = await seed(); const input = body(); const before = await read(id); let observed: StoredOrder | null = null;
    provider.hooks.beforeCreate = async () => { observed = await read(id); throw new Error('Départ fournisseur interrompu.'); };
    await expect(request(id, input)).rejects.toThrow();
    expect(provider.refunds.create).toHaveBeenCalledOnce();
    expect(observed).toMatchObject({ payment: { status: 'paid', pendingRefundCents: 250, refundedCents: 0 },
      refundFlow: { version: 1, operations: [expect.objectContaining({ operationId: input.operationId, amountCents: 250,
        reason: input.reason, actorId: ACTOR, environment: 'test', paymentIntentId: INTENT, accountId: ACCOUNT,
        idempotencyKey: `order-refund:${id}:${input.operationId}`, preparedAt: expect.any(Date), requestStartedAt: expect.any(Date) })] } });
    expect((observed as StoredOrder | null)?.__v).toBeGreaterThan(before!.__v);
    expect(JSON.stringify(observed)).not.toContain(input.password);
  });

  it('ne contacte jamais create quand Mongo refuse les écritures de réservation', async () => {
    const id = await seed(); const interrupted = interceptWrites(first, 'reject');
    await expect(request(id, body(), interrupted.proxy)).rejects.toThrow();
    expect(interrupted.injections()).toBeGreaterThan(0);
    expect(provider.refunds.create).not.toHaveBeenCalled(); expect(provider.createdCount).toBe(0);
  });

  it('reprend un ACK perdu après une vraie réservation depuis une seconde instance', async () => {
    const id = await seed(); const input = body(); const interrupted = interceptWrites(first, 'lose_ack');
    await paymentOutcome(request(id, input, interrupted.proxy));
    expect(interrupted.injections()).toBe(1);
    const proof = await read(id);
    expect(proof?.refundFlow?.operations).toHaveLength(1);
    await request(id, input, second);
    expect(provider.createdCount).toBe(1);
    expect((await read(id))?.refundFlow?.operations[0]?.idempotencyKey).toBe(proof?.refundFlow?.operations[0]?.idempotencyKey);
  });

  it('un ACK perdu sans relecture disponible conserve la preuve mais interdit le départ fournisseur', async () => {
    const id = await seed(); const input = body(); const interrupted = interceptWrites(first, 'lose_ack_and_read');
    await expect(request(id, input, interrupted.proxy)).rejects.toThrow();
    expect(interrupted.injections()).toBe(1);
    expect(provider.refunds.create).not.toHaveBeenCalled();
    expect((await read(id))?.refundFlow?.operations).toHaveLength(1);
    expect((await read(id))?.payment.pendingRefundCents).toBe(250);
    await request(id, input, second);
    expect(provider.createdCount).toBe(1);
  });

  it('transmet effectivement les garanties majority et journal avant create au driver Mongo', async () => {
    const id = await seed(); commands = [];
    provider.hooks.beforeCreate = async () => { throw new Error('Départ interrompu.'); };
    await expect(request(id, body())).rejects.toThrow();
    const writes = commands.filter(event => ['findAndModify', 'update'].includes(event.commandName));
    expect(writes.length).toBeGreaterThan(0);
    for (const event of writes) {
      expect(event.command.writeConcern).toMatchObject({ w: 'majority', j: true });
      expect(event.command).not.toHaveProperty('readConcern');
    }
    const reads = commands.filter(event => event.commandName === 'find');
    expect(reads.length).toBeGreaterThan(0);
    for (const event of reads) {
      expect(event.command.readConcern).toEqual({ level: 'majority' });
      expect(event.command.maxTimeMS).toBeGreaterThan(0); expect(event.command.maxTimeMS).toBeLessThanOrEqual(10_000);
    }
  });

  it('retrouve le remboursement dont le fournisseur a perdu la réponse sans perdre sa réserve', async () => {
    const id = await seed(); const input = body(); let loseFirst = true;
    provider.hooks.afterCreate = async () => { if (loseFirst) { loseFirst = false; throw new Error('Réponse fournisseur perdue après effet.'); } };
    await expect(request(id, input)).rejects.toThrow();
    expect(provider.createdCount).toBe(1);
    expect(await read(id)).toMatchObject({ payment: { status: 'paid', pendingRefundCents: 250, refundedCents: 0 } });
    const result = await request(id, input, second);
    expect(result).toMatchObject({ refundedCents: 250, pendingRefundCents: 0, remainingCents: 1000 });
    expect(provider.createdCount).toBe(1); expect((await read(id))?.refundFlow?.operations).toHaveLength(1);
  });

  it('deux instances sur le même UUID réservent une fois et produisent un seul effet', async () => {
    const id = await seed(); const input = body();
    await Promise.all([paymentOutcome(request(id, input)), paymentOutcome(request(id, input, second))]);
    await request(id, input, second);
    expect(provider.createdCount).toBe(1);
    expect(await read(id)).toMatchObject({ payment: { refundedCents: 250, pendingRefundCents: 0 } });
    expect((await read(id))?.refundFlow?.operations).toHaveLength(1);
  });

  it.each(['actor', 'amount', 'reason'] as const)('refuse le même UUID avec %s changé même sans réponse fournisseur visible', async (changed) => {
    const id = await seed(); const input = body();
    provider.hooks.beforeCreate = async () => { throw new Error('Création incertaine.'); };
    await expect(request(id, input)).rejects.toThrow();
    const different = { ...input, ...(changed === 'amount' ? { amountCents: 300 } : {}), ...(changed === 'reason' ? { reason: 'Autre motif commercial' } : {}) };
    await expect(request(id, different, second, changed === 'actor' ? '507f1f77bcf86cd799439033' : ACTOR)).rejects.toBeInstanceOf(ConflictException);
    expect(provider.refunds.create).toHaveBeenCalledOnce();
    expect((await read(id))?.refundFlow?.operations).toHaveLength(1);
  });

  it('bloque une autre opération tant que le premier create reste incertain', async () => {
    const id = await seed(); provider.hooks.beforeCreate = async () => { throw new Error('Création incertaine.'); };
    await expect(request(id, body())).rejects.toThrow();
    await expect(request(id, body(), second)).rejects.toThrow();
    expect(provider.refunds.create).toHaveBeenCalledOnce();
    expect((await read(id))?.payment.pendingRefundCents).toBe(250);
  });

  it('une opération concurrente ne dépasse pas la réservation pendant que create est en vol', async () => {
    const id = await seed(); const reached = paymentBarrier(); const resume = paymentBarrier(); let holdFirst = true;
    provider.hooks.beforeCreate = async () => { if (holdFirst) { holdFirst = false; reached.release(); await resume.promise; } };
    const creating = paymentOutcome(request(id, body({ amountCents: 1000 })));
    await Promise.race([reached.promise, creating.then(() => { throw new Error('Création terminée avant sa barrière.'); })]);
    try { await expect(request(id, body({ amountCents: 500 }), second)).rejects.toThrow(); }
    finally { resume.release(); await creating; }
    expect(provider.refunds.create).toHaveBeenCalledOnce(); expect(provider.createdCount).toBe(1);
    expect((await read(id))?.payment.refundedCents).toBe(1000);
  });

  it('une liste Stripe vide ne libère pas une réservation incertaine', async () => {
    const id = await seed(); provider.hooks.beforeCreate = async () => { throw new Error('Création incertaine.'); };
    await expect(request(id, body())).rejects.toThrow();
    expect(await service(second).summary(String(TENANT), id)).toMatchObject({ pendingRefundCents: 250, refundedCents: 0, remainingCents: 1000 });
    expect((await read(id))?.payment.pendingRefundCents).toBe(250);
  });

  it('une réconciliation déjà en vol ne peut effacer la réservation faite depuis sa lecture', async () => {
    const id = await seed(); const reached = paymentBarrier(); const resume = paymentBarrier(); let holdFirst = true;
    provider.hooks.afterList = async () => { if (holdFirst) { holdFirst = false; reached.release(); await resume.promise; } };
    const stale = paymentOutcome(service().summary(String(TENANT), id));
    await Promise.race([reached.promise, stale.then(() => { throw new Error('Réconciliation terminée avant sa barrière.'); })]);
    try {
      provider.hooks.beforeCreate = async () => { throw new Error('Création incertaine.'); };
      await expect(request(id, body(), second)).rejects.toThrow();
    } finally { resume.release(); }
    await stale;
    expect((await read(id))?.payment.pendingRefundCents).toBe(250);
  });

  it('un ancien document hydraté ne peut écraser une intention avant sa réponse fournisseur', async () => {
    const id = await seed(); const stale = await second.findById(id);
    provider.hooks.beforeCreate = async () => { throw new Error('Création incertaine.'); };
    await expect(request(id, body())).rejects.toThrow();
    stale!.status = 'cancelled';
    await expect(stale!.save()).rejects.toMatchObject({ name: 'VersionError' });
    expect((await read(id))?.payment.pendingRefundCents).toBe(250);
  });

  it('une incertitude expirée ne recrée rien même si le fournisseur a purgé la clé et sa liste est vide', async () => {
    const id = await seed(); const input = body();
    provider.hooks.afterCreate = async () => { throw new Error('Effet fournisseur acquis, réponse perdue.'); };
    await expect(request(id, input)).rejects.toThrow();
    provider.hideList = true; provider.pruneIdempotencyKeys();
    const calls = provider.refunds.create.mock.calls.length;
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(Date.now() + 48 * 3_600_000);
    await expect(request(id, input, second)).rejects.toThrow();
    expect(provider.refunds.create).toHaveBeenCalledTimes(calls); expect(provider.createdCount).toBe(1);
    expect(await read(id)).toMatchObject({ payment: { pendingRefundCents: 250 },
      refundFlow: { operations: [expect.objectContaining({ operationId: input.operationId, state: 'review_required' })] } });
  });

  it('conserve la preuve fournisseur avant un échec du journal audit', async () => {
    const id = await seed(); const input = body();
    audit.log.mockRejectedValueOnce(new Error('Audit indisponible.')); audit.logOnce.mockRejectedValueOnce(new Error('Audit indisponible.'));
    await expect(request(id, input)).rejects.toThrow();
    expect((await read(id))?.refundFlow?.operations[0]).toMatchObject({ operationId: input.operationId,
      refund: { id: provider.rows[0]!.refund.id, amount: 250, status: 'succeeded' } });
    audit.log.mockResolvedValue(undefined); audit.logOnce.mockResolvedValue(undefined);
    await request(id, input, second);
    expect(provider.createdCount).toBe(1);
  });

  it('audit réel : la réponse fournisseur perdue puis les reprises concurrentes engagent une seule ligne stable', async () => {
    const id = await seed(); const input = body(); let loseFirst = true;
    const initial = serviceWithNativeAudit(); const resumed = serviceWithNativeAudit(second, secondAudit);
    provider.hooks.afterCreate = async () => { if (loseFirst) { loseFirst = false; throw new Error('Réponse fournisseur perdue après effet.'); } };
    await expect(initial.request(String(TENANT), id, ACTOR, input)).rejects.toThrow();
    expect(await secondAudit.countDocuments({ targetId: id })).toBe(0);
    expect((await read(id))?.payment.pendingRefundCents).toBe(250);
    await Promise.all([initial.request(String(TENANT), id, ACTOR, input), resumed.request(String(TENANT), id, ACTOR, input)]);
    const entries = await secondAudit.find({ targetId: id }).read('primary').readConcern('majority').lean();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ action: 'order.refund', author: { id: ACTOR, name: '', role: 'owner', means: 'password' },
      meta: { operationId: input.operationId, amountCents: 250, reason: input.reason, refundId: provider.rows[0]?.refund.id,
        stripeAccountId: ACCOUNT, environment: 'test' } });
    expect(entries[0]?.deduplication?.fingerprint).toHaveLength(64);
    await resumed.request(String(TENANT), id, ACTOR, input);
    expect(await secondAudit.find({ targetId: id }).lean()).toEqual(entries);
    expect(provider.createdCount).toBe(1);
  });

  it('audit réel : ACK perdu après insert puis pending vers succeeded gardent exactement le même reçu', async () => {
    const id = await seed(); const input = body(); let injected = 0;
    const create = firstAudit.create.bind(firstAudit);
    vi.spyOn(firstAudit, 'create').mockImplementationOnce((async (...args: unknown[]) => {
      await Reflect.apply(create, firstAudit, args); injected += 1;
      throw new Error('ACK audit perdu après insertion réelle.');
    }) as never);
    provider.hooks.afterCreate = async refund => {
      refund.status = 'pending'; provider.rows.find(row => row.refund.id === refund.id)!.refund.status = 'pending';
    };
    expect(await serviceWithNativeAudit().request(String(TENANT), id, ACTOR, input)).toMatchObject({ pendingRefundCents: 250, refundedCents: 0 });
    expect(injected).toBe(1);
    const entries = await secondAudit.find({ targetId: id }).read('primary').readConcern('majority').lean();
    expect(entries).toHaveLength(1); expect(entries[0]?.deduplication?.fingerprint).toHaveLength(64);
    provider.rows[0]!.refund.status = 'succeeded';
    const resumed = serviceWithNativeAudit(second, secondAudit);
    expect(await resumed.summary(String(TENANT), id)).toMatchObject({ refundedCents: 250, pendingRefundCents: 0 });
    await Promise.all([resumed.request(String(TENANT), id, ACTOR, input),
      serviceWithNativeAudit().request(String(TENANT), id, ACTOR, input)]);
    expect(await secondAudit.find({ targetId: id }).lean()).toEqual(entries);
    expect(provider.createdCount).toBe(1);
  });

  it('audit réel : une insertion refusée se répare depuis la preuve sans nouveau remboursement', async () => {
    const id = await seed(); const input = body();
    const create = vi.spyOn(firstAudit, 'create').mockRejectedValueOnce(new Error('Insertion audit indisponible.'));
    await expect(serviceWithNativeAudit().request(String(TENANT), id, ACTOR, input)).rejects.toThrow();
    expect(create).toHaveBeenCalledOnce(); expect(await secondAudit.countDocuments({ targetId: id })).toBe(0);
    expect((await read(id))?.refundFlow?.operations[0]?.refund?.id).toBe(provider.rows[0]?.refund.id);
    expect((await read(id))?.payment.refundedCents).toBe(250);
    const resumed = serviceWithNativeAudit(second, secondAudit);
    await resumed.request(String(TENANT), id, ACTOR, input);
    const entries = await secondAudit.find({ targetId: id }).lean(); expect(entries).toHaveLength(1);
    await expect(resumed.request(String(TENANT), id, ACTOR, { ...input, amountCents: 251 })).rejects.toBeInstanceOf(ConflictException);
    expect(await secondAudit.find({ targetId: id }).lean()).toEqual(entries); expect(provider.createdCount).toBe(1);
  });

  it('un changement test/live ne réinterprète pas une intention incertaine', async () => {
    const id = await seed(); const input = body();
    provider.hooks.beforeCreate = async () => { throw new Error('Création incertaine.'); };
    await expect(request(id, input)).rejects.toThrow();
    provider.environment = 'live';
    await expect(request(id, input, second)).rejects.toThrow();
    expect(provider.refunds.create).toHaveBeenCalledOnce();
    expect((await read(id))?.payment.pendingRefundCents).toBe(250);
  });

  it('une réponse fournisseur valide reste une preuve même si list ne la voit pas encore', async () => {
    const id = await seed(); provider.hideList = true;
    const result = await request(id, body());
    expect(result).toMatchObject({ refundedCents: 250, pendingRefundCents: 0, remainingCents: 1000 });
    expect((await read(id))?.refundFlow?.operations[0]?.refund?.id).toBe(provider.rows[0]?.refund.id);
    expect(provider.createdCount).toBe(1);
  });

  it.each(['create', 'list'] as const)('une réponse Stripe complète via %s conserve seulement la preuve financière admise', async (boundary) => {
    const id = await seed(); const input = body();
    const fullStripeObject = (refund: Refund) => {
      Object.assign(refund, { object: 'refund', charge: 'ch_provider_detail', created: 1789071600,
        balance_transaction: 'txn_provider_detail', destination_details: { card: { reference: 'private_provider_reference' } } });
      refund.metadata = { ...refund.metadata, merchant_note: 'private_merchant_metadata' };
    };
    if (boundary === 'create') provider.hooks.afterCreate = async refund => { fullStripeObject(refund); };
    await request(id, input);
    if (boundary === 'list') provider.hooks.afterList = async rows => { rows.forEach(fullStripeObject); };
    expect(await service(second).summary(String(TENANT), id)).toMatchObject({ refundedCents: 250, pendingRefundCents: 0, remainingCents: 1000 });
    const proof = (await read(id))?.refundFlow?.operations[0]?.refund;
    expect(proof).toMatchObject({ id: provider.rows[0]?.refund.id, amount: 250, currency: 'eur', payment_intent: INTENT,
      status: 'succeeded', metadata: { operationId: input.operationId, reason: input.reason, requestedBy: ACTOR } });
    expect(Object.keys(proof!).sort()).toEqual(['amount', 'currency', 'id', 'metadata', 'payment_intent', 'status']);
    for (const [, event] of publish.mock.calls) {
      expect(String(event)).not.toContain('private_provider_reference');
      expect(String(event)).not.toContain('private_merchant_metadata');
    }
    expect(provider.createdCount).toBe(1);
  });

  it('conserve un remboursement historique connu dont list ne renvoie plus l’identifiant', async () => {
    const historicalOperation = randomUUID();
    const id = await seed({ payment: { method: 'online', status: 'paid', stripePaymentIntentId: INTENT, stripeAccountId: ACCOUNT,
      refundedCents: 250, pendingRefundCents: 0, refunds: [{ id: 're_historical_known', amountCents: 250,
        status: 'succeeded', operationId: historicalOperation, reason: 'Remboursement historique' }] } });
    const result = await service().summary(String(TENANT), id);
    expect(result).toMatchObject({ refundedCents: 250, pendingRefundCents: 0, remainingCents: 1000,
      refunds: [{ id: 're_historical_known', amountCents: 250, status: 'succeeded' }] });
    expect((await read(id))?.refundFlow ?? null).toBeNull();
    await expect(request(id, body({ operationId: historicalOperation }), second)).rejects.toThrow();
    expect(provider.refunds.create).not.toHaveBeenCalled();
    expect((await read(id))?.payment.refundedCents).toBe(250);
  });

  it.each(['refundedCents', 'pendingRefundCents'] as const)('un compteur historique %s sans IDs ne devient pas zéro sur une liste vide', async (field) => {
    const id = await seed({ payment: { method: 'online', status: 'paid', stripePaymentIntentId: INTENT, stripeAccountId: ACCOUNT,
      refundedCents: field === 'refundedCents' ? 250 : 0, pendingRefundCents: field === 'pendingRefundCents' ? 250 : 0, refunds: [] } });
    const result = await paymentOutcome(service().summary(String(TENANT), id));
    expect((await read(id))?.payment[field]).toBe(250);
    if (result.ok) {
      expect(result.value[field]).toBeGreaterThanOrEqual(250);
      expect(result.value.remainingCents).toBeLessThanOrEqual(1000);
    }
    await expect(request(id, body({ amountCents: 1250 }), second)).rejects.toThrow();
    expect(provider.refunds.create).not.toHaveBeenCalled();
    expect((await read(id))?.payment[field]).toBe(250);
  });

  it('un statut fournisseur inconnu conserve la réserve et ferme toute nouvelle création', async () => {
    const id = await seed(); const input = body();
    provider.hooks.afterCreate = async refund => {
      refund.status = 'new_unrecognized_provider_status';
      provider.rows.find(row => row.refund.id === refund.id)!.refund.status = refund.status;
    };
    await expect(request(id, input)).rejects.toThrow();
    expect(await read(id)).toMatchObject({ payment: { status: 'paid', pendingRefundCents: 250, refundedCents: 0 },
      refundFlow: { operations: [expect.objectContaining({ operationId: input.operationId, state: 'review_required' })] } });
    await expect(service(second).summary(String(TENANT), id)).rejects.toThrow();
    await expect(request(id, body(), second)).rejects.toThrow();
    expect(provider.refunds.create).toHaveBeenCalledOnce(); expect(provider.createdCount).toBe(1);
    expect((await read(id))?.payment.pendingRefundCents).toBe(250);
  });

  it.each(['lowercase_first', 'uppercase_first'] as const)('la casse du même UUID ne crée jamais une seconde opération : %s', async (direction) => {
    const id = await seed(); const canonical = 'a404fe33-f766-471e-a6c0-36541d0b1e53';
    const firstId = direction === 'lowercase_first' ? canonical : canonical.toUpperCase();
    const secondId = direction === 'lowercase_first' ? canonical.toUpperCase() : canonical;
    const input = body({ operationId: firstId });
    await request(id, input);
    // Canonical replay or a closed conflict are both safe; another effect is never allowed.
    const replay = await paymentOutcome(request(id, { ...input, operationId: secondId }, second));
    expect(provider.createdCount).toBe(1); expect(provider.refunds.create).toHaveBeenCalledOnce();
    expect((await read(id))?.refundFlow?.operations).toHaveLength(1);
    expect((await read(id))?.payment.refundedCents).toBe(250);
    if (replay.ok) expect(replay.value).toMatchObject({ refundedCents: 250, pendingRefundCents: 0, remainingCents: 1000 });
  });

  it('reprend exactement la même requête après un chemin ObjectId majuscule et une réponse perdue', async () => {
    const id = await seed(); const input = body(); let loseFirst = true; provider.hideList = true;
    provider.hooks.afterCreate = async () => { if (loseFirst) { loseFirst = false; throw new Error('Réponse perdue après effet.'); } };
    await expect(request(id.toUpperCase(), input)).rejects.toThrow();
    const firstCall = structuredClone(provider.refunds.create.mock.calls[0]);
    expect(await request(id, input, second)).toMatchObject({ refundedCents: 250, pendingRefundCents: 0, remainingCents: 1000 });
    expect(provider.refunds.create).toHaveBeenCalledTimes(2);
    expect(provider.refunds.create.mock.calls[1]).toEqual(firstCall);
    expect(provider.createdCount).toBe(1); expect((await read(id))?.refundFlow?.operations).toHaveLength(1);
  });

  it.each(['amount', 'currency', 'payment_intent'] as const)('garde la réserve si la réponse create contredit %s', async (field) => {
    const id = await seed();
    provider.hooks.afterCreate = async (refund) => {
      if (field === 'amount') refund.amount = 251;
      if (field === 'currency') refund.currency = 'usd';
      if (field === 'payment_intent') refund.payment_intent = 'pi_other_order';
    };
    await expect(request(id, body())).rejects.toThrow();
    expect(await read(id)).toMatchObject({ payment: { status: 'paid', refundedCents: 0, pendingRefundCents: 250 } });
    expect(provider.createdCount).toBe(1);
  });

  it('ne rembourse pas au comptoir via un ancien PaymentIntent conservé', async () => {
    const id = await seed({ payment: { method: 'counter', status: 'paid', stripePaymentIntentId: INTENT, stripeAccountId: ACCOUNT } });
    await expect(request(id, body())).rejects.toBeInstanceOf(ConflictException);
    expect(provider.refunds.create).not.toHaveBeenCalled(); expect(provider.refunds.list).not.toHaveBeenCalled();
    expect(await service().summary(String(TENANT), id)).toMatchObject({ refundedCents: 0, pendingRefundCents: 0, remainingCents: 0 });
  });

  it('une commande du tenant voisin ne produit aucune réservation ni lecture fournisseur', async () => {
    const id = await seed();
    await expect(service().request('507f1f77bcf86cd799439044', id, ACTOR, body())).rejects.toThrow();
    expect(provider.refunds.create).not.toHaveBeenCalled(); expect(provider.refunds.list).not.toHaveBeenCalled();
    expect((await read(id))?.payment.pendingRefundCents).toBe(0);
  });

  it('le standalone online ne peut lire ou rembourser une commande POS', async () => {
    const id = await seed({ channel: 'pos' }); capabilities = ['online'];
    await expect(request(id, body())).rejects.toThrow();
    await expect(service().summary(String(TENANT), id)).rejects.toThrow();
    expect(provider.refunds.create).not.toHaveBeenCalled(); expect(provider.refunds.list).not.toHaveBeenCalled();
  });

  it('garde le compte plateforme null pour un encaissement historique', async () => {
    const id = await seed({ payment: { method: 'online', status: 'paid', stripePaymentIntentId: INTENT, stripeAccountId: null } });
    const input = body(); await request(id, input);
    expect(provider.refunds.create.mock.calls[0]?.[1]).not.toHaveProperty('stripeAccount');
    expect((await read(id))?.refundFlow?.operations[0]).toMatchObject({ accountId: null, paymentIntentId: INTENT });
    expect(provider.createdCount).toBe(1);
  });

  it('un webhook du mauvais compte ne rapproche pas la commande', async () => {
    const id = await seed();
    await service().webhook({ type: 'refund.updated', account: 'acct_other', data: { object: { payment_intent: INTENT } } });
    expect(provider.refunds.list).not.toHaveBeenCalled(); expect((await read(id))?.payment.pendingRefundCents).toBe(0);
  });

  it('réserve le pending connu une seule fois et refuse tout dépassement', async () => {
    const id = await seed(); const input = body({ amountCents: 1100 });
    provider.hooks.afterCreate = async (refund) => {
      refund.status = 'pending'; provider.rows.find(row => row.refund.id === refund.id)!.refund.status = 'pending';
    };
    expect(await request(id, input)).toMatchObject({ pendingRefundCents: 1100, refundedCents: 0, remainingCents: 150 });
    await expect(request(id, body(), second)).rejects.toBeInstanceOf(ConflictException);
    expect(provider.createdCount).toBe(1); expect((await read(id))?.payment.pendingRefundCents).toBe(1100);
  });

  it('le journal privé reste absent des lectures ordinaires, de la sérialisation et des événements', async () => {
    const id = await seed(); const input = body(); const result = await request(id, input);
    expect((await read(id))?.refundFlow?.operations).toHaveLength(1);
    expect(await second.findById(id).lean()).not.toHaveProperty('refundFlow');
    const selected = await second.findById(id).select('+refundFlow');
    expect(selected!.toObject()).not.toHaveProperty('refundFlow'); expect(selected!.toJSON()).not.toHaveProperty('refundFlow');
    expect(JSON.stringify(result)).not.toContain('refundFlow');
    expect(publish).toHaveBeenCalled();
    for (const [, event] of publish.mock.calls) {
      expect(String(event)).not.toContain('refundFlow'); expect(String(event)).not.toContain(input.password);
    }
  });
});
