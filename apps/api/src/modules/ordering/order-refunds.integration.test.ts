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
import { loyaltyWebFixture } from '../loyalty/loyalty-web.test-fixture';

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

  describe('ventilation durable et corrélée au remboursement', () => {
    const allocation = (merchandiseCents: number, deliveryCents: number) => ({ version: 1 as const, merchandiseCents, deliveryCents });
    const allocationBody = (merchandiseCents: number, deliveryCents: number) => ({ operationId: randomUUID(),
      clientProtocolVersion: 2 as const, allocation: allocation(merchandiseCents, deliveryCents),
      reason: 'Ventilation contrôlée depuis le reçu', password: 'never-journal-this-password' });
    const deliveryOrder = () => seed({ totals: { subtotal: 1000, deliveryFee: 250, total: 1250 } });

    it('fige la ventilation avant fournisseur et refuse une nouvelle ventilation sous le même UUID', async () => {
      const id = await deliveryOrder(); const input = body({ allocation: allocation(100, 150) });
      provider.hooks.beforeCreate = async () => {
        expect((await read(id))?.refundFlow?.operations[0]).toMatchObject({ allocation: input.allocation, state: 'creating' });
      };
      await request(id, input); await request(id, input);
      await expect(request(id, { ...input, allocation: allocation(150, 100) })).rejects.toThrow('autre remboursement');
      expect(provider.createdCount).toBe(1);
      expect(await service().journal(String(TENANT), id, ACTOR)).toMatchObject({
        allocation: { remaining: allocation(900, 100), unallocated: [] },
        operations: [{ operationId: input.operationId, allocation: input.allocation }] });
    });

    it('refuse une ventilation au-delà des frais réels avant tout effet fournisseur', async () => {
      const id = await deliveryOrder();
      await expect(request(id, body({ amountCents: 300, allocation: allocation(0, 300) }))).rejects.toThrow('montants disponibles');
      expect(provider.createdCount).toBe(0);
      expect((await read(id))?.payment).toMatchObject({ refundedCents: 0, pendingRefundCents: 0 });
    });

    it('ventile une preuve historique sans réécrire sa demande ni appeler Stripe, activation fermée comprise', async () => {
      const id = await deliveryOrder(); const legacy = body(); await request(id, legacy);
      const before = await read(id); const refundId = provider.rows[0]!.refund.id; const input = allocationBody(200, 50);
      const closed = new OrderRefundsService(first, async () => null,
        { publish } as unknown as Redis, { pourTenant: async () => capabilities } as never, audit as never);
      provider.refunds.create.mockClear(); provider.refunds.list.mockClear();
      const result = await closed.allocate(String(TENANT), id, refundId, ACTOR, input);
      expect(result).toMatchObject({ enabled: false, allocation: { remaining: allocation(800, 200), unallocated: [] },
        allocations: [{ operationId: input.operationId, refundId, allocation: input.allocation }] });
      const after = await read(id);
      expect(after?.refundFlow?.operations).toEqual(before?.refundFlow?.operations);
      expect(after?.payment.refundedCents).toBe(250); expect(after?.payment.pendingRefundCents).toBe(0);
      expect(provider.refunds.create).not.toHaveBeenCalled(); expect(provider.refunds.list).not.toHaveBeenCalled();
      expect(JSON.stringify(after)).not.toContain(input.password);
      expect(JSON.stringify(result)).not.toContain(ACTOR);
      await expect(closed.allocate(String(TENANT), id, refundId, ACTOR, input)).resolves.toEqual(result);
      await expect(closed.allocate(String(TENANT), id, refundId, '507f1f77bcf86cd799439033', input)).rejects.toThrow('autre ventilation');
    });

    it('deux opérateurs concurrents ne peuvent pas attribuer deux fois le même remboursement', async () => {
      const id = await deliveryOrder(); await request(id, body()); const refundId = provider.rows[0]!.refund.id;
      const results = await Promise.allSettled([
        service(first).allocate(String(TENANT), id, refundId, ACTOR, allocationBody(200, 50)),
        service(second).allocate(String(TENANT), id, refundId, ACTOR, allocationBody(150, 100)),
      ]);
      expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
      expect(results.filter(r => r.status === 'rejected')).toHaveLength(1);
      const journal = await service().journal(String(TENANT), id, ACTOR);
      expect(journal.allocations).toHaveLength(1); expect(journal.allocation.unallocated).toHaveLength(0);
      expect(journal.summary.refundedCents).toBe(250); expect(provider.createdCount).toBe(1);
    });

    it('récupère le reçu exact après perte ACK Mongo et ne change jamais son UUID', async () => {
      const id = await deliveryOrder(); await request(id, body()); const refundId = provider.rows[0]!.refund.id;
      const intercepted = interceptWrites(first, 'lose_ack'); const input = allocationBody(250, 0);
      const result = await service(intercepted.proxy).allocate(String(TENANT), id, refundId, ACTOR, input);
      expect(intercepted.injections()).toBeGreaterThan(0);
      expect(result.allocations).toMatchObject([{ operationId: input.operationId, refundId, allocation: input.allocation }]);
      expect(await service(second).allocate(String(TENANT), id, refundId, ACTOR, input)).toEqual(result);
      expect(provider.createdCount).toBe(1);
    });

    it('refuse une ventilation de mauvais montant ou un UUID déjà utilisé par un remboursement', async () => {
      const id = await deliveryOrder(); const initial = body(); await request(id, initial); const refundId = provider.rows[0]!.refund.id;
      await expect(service().allocate(String(TENANT), id, refundId, ACTOR, allocationBody(200, 0))).rejects.toThrow('Ventilation');
      await expect(service().allocate(String(TENANT), id, refundId, ACTOR,
        { ...allocationBody(250, 0), operationId: initial.operationId })).rejects.toThrow('opération');
      expect((await service().journal(String(TENANT), id, ACTOR)).allocations).toEqual([]);
    });

    it('abandonne une répartition devenue impossible sans libérer son UUID retardé', async () => {
      const id = await deliveryOrder(); await request(id, body()); await request(id, body());
      const [firstRefund, secondRefund] = provider.rows.map(row => row.refund.id);
      const stale = allocationBody(0, 250);
      await service().allocate(String(TENANT), id, secondRefund!, ACTOR, allocationBody(0, 250));
      await expect(service(second).allocate(String(TENANT), id, firstRefund!, ACTOR, stale)).rejects.toThrow('dépasse');
      provider.refunds.create.mockClear(); provider.refunds.list.mockClear();
      const withdrawn = await serviceWithNativeAudit().withdrawAllocation(String(TENANT), id, firstRefund!, ACTOR, stale);
      expect(withdrawn.allocations).toHaveLength(2);
      expect(withdrawn.allocations[1]).toMatchObject({ operationId: stale.operationId, state: 'withdrawn', allocation: stale.allocation });
      expect(withdrawn.allocation.unallocated).toMatchObject([{ refundId: firstRefund }]);
      expect(await service(second).allocate(String(TENANT), id, firstRefund!, ACTOR, stale)).toEqual(withdrawn);
      const corrected = await service().allocate(String(TENANT), id, firstRefund!, ACTOR, allocationBody(250, 0));
      expect(corrected.allocations).toHaveLength(3); expect(corrected.allocation.unallocated).toHaveLength(0);
      expect(corrected.allocation.remaining).toEqual(allocation(750, 0));
      expect(await firstAudit.countDocuments({ action: 'order.refund.allocation_withdraw' })).toBe(1);
      expect(provider.refunds.create).not.toHaveBeenCalled(); expect(provider.refunds.list).not.toHaveBeenCalled();
    });

    it('récupère un abandon réellement commité malgré ACK Mongo perdu, fournisseur fermé et refund annulé', async () => {
      const id = await deliveryOrder(); const input = allocationBody(200, 50);
      const intercepted = interceptWrites(first, 'lose_ack');
      const closed = new OrderRefundsService(intercepted.proxy, async () => null,
        { publish } as unknown as Redis, { pourTenant: async () => capabilities } as never, audit as never);
      const result = await closed.withdrawAllocation(String(TENANT), id, 're_cancelled', ACTOR, input);
      expect(intercepted.injections()).toBe(1);
      expect(result.allocations).toMatchObject([{ operationId: input.operationId, state: 'withdrawn' }]);
      expect(result.allocation.remaining).toEqual(allocation(1000, 250));
      expect(await closed.allocate(String(TENANT), id, 're_cancelled', ACTOR, input)).toEqual(result);
      await expect(closed.withdrawAllocation(String(TENANT), id, 're_cancelled', 'another-owner', input)).rejects.toThrow('autre ventilation');
      await expect(closed.withdrawAllocation(String(TENANT), id, 're_cancelled', ACTOR, { ...input, allocation: allocation(250, 0) })).rejects.toThrow('autre ventilation');
      expect(provider.refunds.create).not.toHaveBeenCalled(); expect(provider.refunds.list).not.toHaveBeenCalled();
    });

    it('ne transforme pas en abandon une répartition déjà enregistrée', async () => {
      const id = await deliveryOrder(); await request(id, body()); const refundId = provider.rows[0]!.refund.id;
      const input = allocationBody(200, 50);
      const result = await service().allocate(String(TENANT), id, refundId, ACTOR, input);
      expect(result.allocations[0]).toMatchObject({ state: 'recorded' });
      expect(await service(second).withdrawAllocation(String(TENANT), id, refundId, ACTOR, input)).toEqual(result);
    });

    it('un abandon concurrent précède le CAS de la répartition retardée', async () => {
      const id = await deliveryOrder(); await request(id, body()); const refundId = provider.rows[0]!.refund.id;
      const input = allocationBody(200, 50), reached = paymentBarrier(), resume = paymentBarrier(); let held = false;
      const proxy = new Proxy(first, { get(target, property) {
        const value = Reflect.get(target, property, target);
        if (property !== 'findOneAndUpdate') return typeof value === 'function' ? value.bind(target) : value;
        return (...args: unknown[]) => {
          const query = Reflect.apply(value, target, args) as Query<unknown, Order>, execute = query.exec.bind(query);
          query.exec = async () => {
            const update = args[1] as { $set?: { refundFlow?: { allocations?: { operationId: string; state: string }[] } } };
            if (!held && update.$set?.refundFlow?.allocations?.some(row => row.operationId === input.operationId && row.state === 'recorded')) {
              held = true; reached.release(); await resume.promise;
            }
            return execute();
          };
          return query;
        };
      } });
      const running = paymentOutcome(service(proxy).allocate(String(TENANT), id, refundId, ACTOR, input));
      let deadline: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([reached.promise, new Promise<never>((_resolve, reject) => {
          deadline = setTimeout(() => reject(new Error('Allocation CAS checkpoint not reached')), 3000);
        })]);
        await service(second).withdrawAllocation(String(TENANT), id, refundId, ACTOR, input);
      } finally { clearTimeout(deadline); resume.release(); }
      expect((await running).ok).toBe(true);
      const journal = await service().journal(String(TENANT), id, ACTOR);
      expect(journal.allocations).toMatchObject([{ operationId: input.operationId, state: 'withdrawn' }]);
      expect(journal.allocation.unallocated).toMatchObject([{ refundId }]);
      expect(provider.createdCount).toBe(1);
    });

    it('réveille durablement le gain web déjà traité sans écraser son état et exige une allocation nouvelle', async () => {
      const fixture = loyaltyWebFixture(); const attribution = fixture.customerSaleAttribution!;
      const owner = { ...attribution.owner, tenantRef: String(TENANT) };
      const id = await seed({ clientId: fixture.clientId, customerOwner: owner,
        customerSaleAttribution: { ...attribution, owner, tenantRef: String(TENANT),
          basis: { policyVersion: 'merchandise-net-v1', eligiblePurchaseCents: 1250, excludedChargeCents: 0, chargedTotalCents: 1250 } },
        loyaltyWebIntent: fixture.loyaltyWebIntent,
        loyaltyWebProcessing: { state: 'completed', dirty: false, attempts: 1, nextAttemptAt: new Date(Date.now() + 60_000) } });
      await expect(request(id, body())).rejects.toThrow('part produits');
      expect(provider.createdCount).toBe(0);
      const before = Date.now(); await request(id, body({ allocation: allocation(250, 0) }));
      const saved = await second.findById(id).select('+loyaltyWebProcessing').lean();
      expect(saved?.loyaltyWebProcessing).toMatchObject({ state: 'completed', dirty: true, attempts: 1 });
      expect(saved?.loyaltyWebProcessing?.nextAttemptAt?.getTime()).toBeGreaterThanOrEqual(before);
      expect(provider.createdCount).toBe(1);
    });
  });

  describe('journal local : lecture seule du document financier réel', () => {
    function observeOnly() {
      commands = [];
      provider.refunds.list.mockClear(); provider.refunds.create.mockClear(); provider.charges.retrieve.mockClear();
      audit.log.mockClear(); audit.logOnce.mockClear(); publish.mockClear();
    }
    function expectNoEffects() {
      expect(commands.map(command => command.commandName)).toEqual(expect.arrayContaining(['find']));
      expect(commands.every(command => command.commandName === 'find')).toBe(true);
      for (const { command } of commands) {
        expect(command.readConcern).toEqual({ level: 'majority' });
        expect(command.maxTimeMS).toBe(10_000);
      }
      expect(provider.refunds.list).not.toHaveBeenCalled();
      expect(provider.refunds.create).not.toHaveBeenCalled();
      expect(provider.charges.retrieve).not.toHaveBeenCalled();
      expect(audit.log).not.toHaveBeenCalled(); expect(audit.logOnce).not.toHaveBeenCalled();
      expect(publish).not.toHaveBeenCalled();
    }

    it('relit les partiels cumulés acquis avec activation fermée sans changer version, réserve ou reçu', async () => {
      const id = await seed(); const initial = body(); const subsequent = body({ amountCents: 150 });
      await request(id, initial); await request(id, subsequent);
      const before = await read(id);
      const closed = new OrderRefundsService(first, async () => null,
        { publish } as unknown as Redis, { pourTenant: async () => capabilities } as never, audit as never);
      observeOnly();
      const journal = await closed.journal(String(TENANT), id, ACTOR);
      expect(journal).toMatchObject({ orderId: id, enabled: false,
        summary: { refundedCents: 400, pendingRefundCents: 0, remainingCents: 850, status: 'partial' },
        operations: [
          { operationId: initial.operationId, state: 'known', providerStatus: 'succeeded', canResume: false },
          { operationId: subsequent.operationId, state: 'known', providerStatus: 'succeeded', canResume: false },
        ] });
      expect(Object.keys(journal).sort()).toEqual(['allocation', 'allocations', 'enabled', 'operations', 'orderId', 'summary']);
      for (const operation of journal.operations) {
        expect(Object.keys(operation).sort()).toEqual([
          'allocation', 'amountCents', 'canResume', 'operationId', 'orderId', 'preparedAt', 'providerStatus', 'reason', 'state',
        ]);
      }
      for (const secret of [ACTOR, ACCOUNT, INTENT, initial.password, 'idempotencyKey', 'metadata', 'paymentFlow', 'refundFlow']) {
        expect(JSON.stringify(journal)).not.toContain(secret);
      }
      expectNoEffects();
      expect(await read(id)).toEqual(before);
      expect(provider.createdCount).toBe(2);
    });

    it('montre une réponse fournisseur perdue sans la résoudre ni relancer et limite la reprise à son auteur', async () => {
      const id = await seed(); const input = body();
      provider.hideList = true;
      provider.hooks.afterCreate = async () => { throw new Error('ACK fournisseur perdu après effet'); };
      await expect(request(id, input)).rejects.toThrow();
      expect(provider.createdCount).toBe(1);
      const before = await read(id);
      observeOnly();
      const own = await service().journal(String(TENANT), id, ACTOR);
      expect(own).toMatchObject({ enabled: true, summary: { refundedCents: 0, pendingRefundCents: 250, remainingCents: 1000 },
        operations: [{ operationId: input.operationId, state: 'creating', providerStatus: null, canResume: true }] });
      const other = await service().journal(String(TENANT), id, '507f1f77bcf86cd799439033');
      expect(other.operations[0]).toMatchObject({ operationId: input.operationId, canResume: false });
      expectNoEffects();
      expect(await read(id)).toEqual(before);
      expect(provider.createdCount).toBe(1);
    });

    it.each(['prepared', 'expired', 'review_required'] as const)(
      'projette %s sans écrire une transition ni libérer les centimes réservés', async (phase) => {
        const input = body(); const old = new Date(Date.now() - 2 * 60 * 60 * 1000);
        const id = await seed();
        await first.updateOne({ _id: id }, { $set: { 'payment.pendingRefundCents': input.amountCents,
          refundFlow: { version: 1, operations: [{ operationId: input.operationId, amountCents: input.amountCents,
            reason: input.reason, actorId: ACTOR, environment: 'test', paymentIntentId: INTENT, accountId: ACCOUNT,
            idempotencyKey: `order-refund:${id}:${input.operationId}`, preparedAt: old,
            requestStartedAt: phase === 'prepared' ? null : phase === 'expired' ? old : new Date(),
            state: phase === 'expired' ? 'creating' : phase }] } } }, { runValidators: true });
        const before = await read(id);
        observeOnly();
        const journal = await service().journal(String(TENANT), id, ACTOR);
        expect(journal).toMatchObject({ enabled: true,
          summary: { pendingRefundCents: 250, refundedCents: 0, remainingCents: 1000 },
          operations: [{ operationId: input.operationId, preparedAt: old.toISOString(), providerStatus: null,
            state: phase === 'prepared' ? 'prepared' : 'review_required', canResume: phase === 'prepared' }] });
        expectNoEffects();
        expect(await read(id)).toEqual(before);
      },
    );

    it('garde le reçu lisible mais ferme la reprise après changement de mode fournisseur', async () => {
      const id = await seed(); const input = body(); await request(id, input);
      const before = await read(id);
      provider.environment = 'live'; observeOnly();
      expect(await service().journal(String(TENANT), id, ACTOR)).toMatchObject({ enabled: false,
        summary: { refundedCents: 250, remainingCents: 1000 },
        operations: [{ operationId: input.operationId, state: 'known', providerStatus: 'succeeded', canResume: false }] });
      expectNoEffects();
      expect(await read(id)).toEqual(before);
    });

    it('ne lit aucun journal voisin ou POS hors offre online, et ne charge pas le client fournisseur', async () => {
      const onlineId = await seed(); const posId = await seed({ channel: 'pos', number: 2 });
      const factory = vi.fn(async () => provider);
      const journalService = new OrderRefundsService(first, factory,
        { publish } as unknown as Redis, { pourTenant: async () => capabilities } as never, audit as never);
      const beforeOnline = await read(onlineId); const beforePos = await read(posId);
      observeOnly();
      await expect(journalService.journal('507f1f77bcf86cd799439044', onlineId, ACTOR)).rejects.toThrow('Commande introuvable');
      capabilities = ['online'];
      await expect(journalService.journal(String(TENANT), posId, ACTOR)).rejects.toThrow('Commande introuvable');
      capabilities = ['loyalty'];
      await expect(journalService.journal(String(TENANT), onlineId, ACTOR)).rejects.toThrow('Commande introuvable');
      expect(factory).not.toHaveBeenCalled(); expectNoEffects();
      expect(await read(onlineId)).toEqual(beforeOnline); expect(await read(posId)).toEqual(beforePos);
    });
  });

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

  it('journalise un abandon avant départ sans fournisseur et interdit pour toujours son ancien UUID', async () => {
    const id = await seed(); const input = body();
    const result = await serviceWithNativeAudit().withdraw(String(TENANT), id, ACTOR, input);
    expect(result).toMatchObject({ summary: { remainingCents: 1250, pendingRefundCents: 0 },
      operations: [{ operationId: input.operationId, state: 'withdrawn', providerStatus: null, canResume: false }] });
    expect(provider.refunds.list).not.toHaveBeenCalled(); expect(provider.refunds.create).not.toHaveBeenCalled();
    expect((await read(id))!.refundFlow!.operations[0]).toMatchObject({ state: 'withdrawn', requestStartedAt: null });
    expect((await firstAudit.find({ action: 'order.refund.withdraw' }).lean())).toHaveLength(1);
    expect(await serviceWithNativeAudit(second, secondAudit).withdraw(String(TENANT), id, ACTOR, input)).toEqual(result);
    await expect(request(id, input)).rejects.toThrow('abandonnée avant envoi');
    expect(provider.refunds.list).not.toHaveBeenCalled(); expect(provider.refunds.create).not.toHaveBeenCalled();
    expect((await firstAudit.find({ action: 'order.refund.withdraw' }).lean())).toHaveLength(1);
    // The immutable tombstone does not block a deliberate, distinct request.
    expect(await request(id, body({ operationId: randomUUID() }))).toMatchObject({ refundedCents: 250, remainingCents: 1000 });
    expect(provider.createdCount).toBe(1);
  });

  it.each(['actor', 'amount', 'reason'] as const)('ne permet pas de remplacer un abandon par une autre intention : %s', async change => {
    const id = await seed(); const input = body();
    await service().withdraw(String(TENANT), id, ACTOR, input);
    const modified = { ...input, ...(change === 'amount' ? { amountCents: 300 } : {}), ...(change === 'reason' ? { reason: 'Autre intention' } : {}) };
    await expect(service().withdraw(String(TENANT), id, change === 'actor' ? 'another-owner' : ACTOR, modified)).rejects.toThrow('autre remboursement');
    expect(provider.createdCount).toBe(0);
  });

  it('interdit l’abandon après départ même si aucune preuve Stripe n’est encore visible', async () => {
    const id = await seed(); const input = body();
    provider.hooks.beforeCreate = async () => { throw new Error('Network unavailable after durable dispatch'); };
    await expect(request(id, input)).rejects.toThrow();
    const before = await read(id);
    await expect(service(second).withdraw(String(TENANT), id, ACTOR, input)).rejects.toThrow('déjà pu être envoyée');
    expect(await read(id)).toEqual(before); expect(before!.payment.pendingRefundCents).toBe(250);
  });

  it('refuse de fabriquer une absence fournisseur après un reçu connu ou un doute historique', async () => {
    const id = await seed(); const input = body();
    await request(id, input);
    await expect(service(second).withdraw(String(TENANT), id, ACTOR, input)).rejects.toThrow('déjà pu être envoyée');
    const historical = await seed({ number: 2, payment: { method: 'online', status: 'paid', stripePaymentIntentId: INTENT,
      stripeAccountId: ACCOUNT, refundedCents: 250, refunds: [{ id: 're_historical', amountCents: 250, status: 'succeeded', operationId: input.operationId }] } });
    await expect(service().withdraw(String(TENANT), historical, ACTOR, input)).rejects.toThrow();
    expect((await read(historical))?.refundFlow).toBeNull();
  });

  it('un retrait concurrent gagne le CAS avant départ et empêche la continuation retardée d’envoyer', async () => {
    const id = await seed(); const input = body();
    const reached = paymentBarrier(), resume = paymentBarrier();
    let held = false;
    const proxy = new Proxy(first, { get(target, property) {
      const value = Reflect.get(target, property, target);
      if (property !== 'findOneAndUpdate') return typeof value === 'function' ? value.bind(target) : value;
      return (...args: unknown[]) => {
        const query = Reflect.apply(value, target, args) as Query<unknown, Order>;
        const execute = query.exec.bind(query);
        query.exec = async () => {
          const update = args[1] as { $set?: { refundFlow?: { operations: StoredOperation[] } } };
          if (!held && update.$set?.refundFlow?.operations.some(op => op.operationId === input.operationId && op.state === 'creating')) {
            held = true; reached.release(); await resume.promise;
          }
          return execute();
        };
        return query;
      };
    } });
    const running = paymentOutcome(request(id, input, proxy));
    let deadline: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([reached.promise, new Promise<never>((_resolve, reject) => {
        deadline = setTimeout(() => reject(new Error('Provider dispatch checkpoint not reached')), 3000);
      })]);
      expect((await read(id))!.refundFlow!.operations[0]!.state).toBe('prepared');
      const withdrawn = await service(second).withdraw(String(TENANT), id, ACTOR, input);
      expect(withdrawn.summary).toMatchObject({ pendingRefundCents: 0, remainingCents: 1250 });
      expect(withdrawn.operations[0]!.state).toBe('withdrawn');
    } finally { clearTimeout(deadline); resume.release(); }
    expect((await running).ok).toBe(false);
    expect(provider.refunds.create).not.toHaveBeenCalled();
    expect((await read(id))!.refundFlow!.operations[0]!.state).toBe('withdrawn');
  });

  it('relit un retrait réellement commité après perte de l’accusé Mongo sans seconde opération', async () => {
    const id = await seed(); const input = body();
    const intercepted = interceptWrites(first, 'lose_ack');
    const result = await service(intercepted.proxy).withdraw(String(TENANT), id, ACTOR, input);
    expect(intercepted.injections()).toBe(1);
    expect(result.operations).toHaveLength(1); expect(result.operations[0]!.state).toBe('withdrawn');
    expect(await service(second).withdraw(String(TENANT), id, ACTOR, input)).toEqual(result);
    expect(provider.refunds.create).not.toHaveBeenCalled(); expect(provider.refunds.list).not.toHaveBeenCalled();
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
