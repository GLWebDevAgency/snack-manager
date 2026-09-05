import { randomUUID } from 'node:crypto';
import { ConflictException } from '@nestjs/common';
import { MODELS, type Order, type AuditLog } from '@sm/db';
import mongoose, { Types, type Connection, type Model, type Query } from 'mongoose';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StripeWebhookEvent } from '../../common/stripe-signature';
import { OrderPaymentLifecycleService, type ProviderIntent } from './order-payment-lifecycle.service';
import { paymentBarrier, paymentOutcome, TestOrderPaymentProvider } from './order-payment-test-provider';
import { OrderCounterCollectionService } from '../orders/order-counter-collection.service';
import { OrdersService } from '../orders/orders.service';
import { AuditService } from '../audit/audit.module';

const DATABASE_PREFIX = 'snackmanager_payment_test_';
const RUN_ID = randomUUID().replaceAll('-', '');
const TENANT_ID = new Types.ObjectId('507f1f77bcf86cd799439011');
const ACCOUNT_ID = 'acct_restaurant_test';
const TOKEN = 'public-tracking-test-only';

/** L'URL fournie ne peut désigner ni un hôte distant ni une base métier. */
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

describe('garde-fous Mongo de la recette paiements', () => {
  it.each([
    'mongodb://example.com/snackmanager_payment_test_ci',
    'mongodb://127.0.0.1/snackmanager',
    'mongodb://localhost/admin',
    'mongodb://localhost/snackmanager_payment_test_',
    'mongodb://localhost/snackmanager_payment_test_ci?replicaSet=production',
    'mongodb://user:password@localhost/snackmanager_payment_test_ci',
    'mongodb+srv://localhost/snackmanager_payment_test_ci',
    'mongodb://localhost,example.com/snackmanager_payment_test_ci',
  ])('refuse la cible non isolée %s avant tout I/O', (url) => {
    expect(() => isolatedDatabase(url)).toThrow('ORDER_PAYMENT_TEST_MONGO_URL');
  });

  it.each(['127.0.0.1', 'localhost'])('isole chaque run sur %s sans toucher à la base fournie', (host) => {
    const isolated = isolatedDatabase(`mongodb://${host}:27029/snackmanager_payment_test_local`);
    expect(isolated.name).toMatch(/^snackmanager_payment_test_local_[a-f0-9]{12}$/);
    expect(new URL(isolated.uri).hostname).toBe(host);
  });
});

function model(connection: Connection): Model<Order> {
  return connection.model<Order>(MODELS.Order.name, MODELS.Order.schema, MODELS.Order.collection);
}

/** La réponse est perdue APRÈS exécution de la vraie écriture, jamais à sa place. */
function loseMongoResponseAfter(model: Model<Order>, field: string): Model<Order> {
  let armed = true;
  return new Proxy(model, {
    get(target, property) {
      const value = Reflect.get(target, property, target);
      if (property !== 'findOneAndUpdate') return typeof value === 'function' ? value.bind(target) : value;
      return (...args: unknown[]) => {
        const query = Reflect.apply(value, target, args) as Query<unknown, Order>;
        const execute = query.exec.bind(query);
        query.exec = async () => {
          const result = await execute();
          const set = (args[1] as { $set?: Record<string, unknown> }).$set;
          if (armed && result && set && Object.hasOwn(set, field)) {
            armed = false;
            throw new Error(`Réponse Mongo perdue après ${field}.`);
          }
          return result;
        };
        return query;
      };
    },
  });
}

/** Holds a real CAS BEFORE execution, so the other connection may win. */
function holdCollection(model: Model<Order>) {
  const reached = paymentBarrier(); const resume = paymentBarrier(); let armed = true;
  const proxy = new Proxy(model, { get(target, property) {
    const value = Reflect.get(target, property, target);
    if (property !== 'findOneAndUpdate') return typeof value === 'function' ? value.bind(target) : value;
    return (...args: unknown[]) => {
      const query = Reflect.apply(value, target, args) as Query<unknown, Order>;
      const execute = query.exec.bind(query);
      query.exec = async () => {
        if (armed && (args[1] as { $set?: { counterCollection?: unknown } }).$set?.counterCollection) {
          armed = false; reached.release(); await resume.promise;
        }
        return execute();
      };
      return query;
    };
  } });
  return { proxy, reached, resume };
}

function succeeded(intent: ProviderIntent, account = ACCOUNT_ID): StripeWebhookEvent {
  return {
    id: `evt_test_${randomUUID()}`, type: 'payment_intent.succeeded', account, livemode: false,
    data: { object: { ...intent, status: 'succeeded', amount_received: intent.amount, currency: 'eur' } },
  } as StripeWebhookEvent;
}

integration('paiement et annulation sur un vrai Mongo standalone', () => {
  let firstConnection: Connection;
  let secondConnection: Connection;
  let first: Model<Order>;
  let second: Model<Order>;
  let auditLogs: Model<AuditLog>;
  let ownsDatabase = false;
  let provider: TestOrderPaymentProvider;

  async function assertOwnedDatabase(): Promise<void> {
    if (!database || !ownsDatabase || firstConnection.name !== database.name
      || !database.name.startsWith(DATABASE_PREFIX) || !database.name.endsWith(RUN_ID.slice(0, 12))) {
      throw new Error('Nettoyage interdit : base de recette non possédée par ce run.');
    }
    if (!await firstConnection.db!.collection('_test_run').findOne({ runId: RUN_ID })) {
      throw new Error('Nettoyage interdit : preuve de propriété absente.');
    }
  }

  beforeAll(async () => {
    if (!database) throw new Error('Base de recette absente.');
    firstConnection = await mongoose.createConnection(database.uri, {
      autoCreate: false, autoIndex: false, family: 4, serverSelectionTimeoutMS: 5000,
    }).asPromise();
    const hello = await firstConnection.db!.admin().command({ hello: 1 });
    expect(hello.setName).toBeUndefined();
    expect(hello.msg).not.toBe('isdbgrid');
    expect(await firstConnection.db!.listCollections({}, { nameOnly: true }).toArray()).toEqual([]);
    await firstConnection.db!.collection('_test_run').insertOne({ runId: RUN_ID });
    ownsDatabase = true;
    first = model(firstConnection);
    await first.createCollection();
    await first.createIndexes();
    auditLogs = firstConnection.model<AuditLog>(MODELS.AuditLog.name, MODELS.AuditLog.schema, MODELS.AuditLog.collection);
    await auditLogs.createCollection();
    secondConnection = await mongoose.createConnection(database.uri, {
      autoCreate: false, autoIndex: false, family: 4, serverSelectionTimeoutMS: 5000,
    }).asPromise();
    second = model(secondConnection);
  }, 20_000);

  beforeEach(async () => {
    await assertOwnedDatabase();
    await first.deleteMany({});
    provider = new TestOrderPaymentProvider();
  });

  afterAll(async () => {
    try {
      if (ownsDatabase) { await assertOwnedDatabase(); await firstConnection.dropDatabase(); }
    } finally {
      await Promise.all([firstConnection?.close(), secondConnection?.close()]);
    }
  });

  const lifecycle = (orders = first) => new OrderPaymentLifecycleService(orders);
  const resolveAccount = () => Promise.resolve(ACCOUNT_ID);
  const read = (id: string) => first.findById(id).select('+paymentFlow +counterCollection').read('primary').lean();
  const cancel = (service: OrderPaymentLifecycleService, id: string) => service.cancel(
    id, String(TENANT_ID), 'cashier-test', 'Annulation de recette', provider,
  );
  const counter = (service: OrderPaymentLifecycleService, id: string, bank = provider) => service.switchToCounter(id, TOKEN, bank);

  async function seed(overrides: Record<string, unknown> = {}): Promise<string> {
    const order = await first.create({
      tenantId: TENANT_ID, number: 1, clientId: randomUUID(), channel: 'online', type: 'pickup', lines: [],
      totals: { subtotal: 1250, total: 1250 }, payment: { method: 'online', status: 'pending' },
      status: 'new', trackingToken: TOKEN, pickup: { slot: new Date(Date.now() + 3_600_000), customerName: 'Recette' },
      paymentFlow: { version: 1, origin: 'created_v1', phase: 'open', attempt: null, close: null },
      ...overrides,
    });
    return String(order._id);
  }

  it('persiste le choix de paiement en ligne avant Stripe pour permettre la reprise du retrait', async () => {
    const id = await seed({ payment: { method: 'counter', status: 'pending' } });
    provider.hooks.beforeCreate = async () => {
      expect((await read(id))?.payment).toMatchObject({ method: 'online', tender: 'online', status: 'pending' });
      throw new Error('Réseau de recette interrompu avant la réponse.');
    };
    await expect(lifecycle().open(id, TOKEN, provider, resolveAccount)).rejects.toThrow('Réseau de recette');
    expect((await read(id))?.payment).toMatchObject({ method: 'online', status: 'pending' });
  });

  it('deux instances concurrentes ouvrent une seule intention sur le compte figé', async () => {
    const id = await seed();
    const results = await Promise.all([
      lifecycle().open(id, TOKEN, provider, resolveAccount),
      lifecycle(second).open(id, TOKEN, provider, resolveAccount),
    ]);
    expect(results.every(Boolean)).toBe(true);
    expect(new Set(results.map((result) => result?.intent.id)).size).toBe(1);
    expect(provider.createdCount).toBe(1);
    const stored = await read(id);
    expect(stored?.payment.stripeAccountId).toBe(ACCOUNT_ID);
    expect(stored?.payment.stripePaymentIntentId).toBe(results[0]?.intent.id);
    expect(stored?.paymentFlow?.attempt?.idempotencyKey).toBeTruthy();
  });

  it('annulation gagnante avant claim : aucune création, aucune réouverture', async () => {
    const id = await seed();
    await cancel(lifecycle(), id);
    const reopening = await paymentOutcome(lifecycle(second).open(id, TOKEN, provider, resolveAccount));
    expect(reopening.ok && reopening.value).toBeFalsy();
    expect(provider.create).not.toHaveBeenCalled();
    expect(await read(id)).toMatchObject({ status: 'cancelled', paymentFlow: { phase: 'closed' } });
  });

  it.each(['beforeCreate', 'afterCreate'] as const)('annulation pendant %s : closing durable précède le provider, aucun secret tardif', async (boundary) => {
    const id = await seed();
    const committed = paymentBarrier();
    const resume = paymentBarrier();
    let holdFirst = true;
    provider.hooks[boundary] = async () => {
      if (holdFirst) { holdFirst = false; committed.release(); await resume.promise; }
    };
    provider.hooks.beforeCancel = async () => {
      expect(await read(id)).toMatchObject({ status: 'new', paymentFlow: { phase: 'closing' } });
    };
    const opening = paymentOutcome(lifecycle().open(id, TOKEN, provider, resolveAccount));
    await Promise.race([committed.promise, opening.then(() => { throw new Error('Création terminée avant sa barrière.'); })]);
    try { await cancel(lifecycle(second), id); } finally { resume.release(); }
    const late = await opening;
    expect(late.ok && late.value).toBeFalsy();
    expect(provider.createdCount).toBe(1);
    expect(await read(id)).toMatchObject({ status: 'cancelled', paymentFlow: { phase: 'closed' } });
    const reopening = await paymentOutcome(lifecycle(second).open(id, TOKEN, provider, resolveAccount));
    expect(reopening.ok && reopening.value).toBeFalsy();
  });

  it('réponse de création perdue : une nouvelle instance reprend exactement le même PI et compte', async () => {
    const id = await seed();
    let loseFirst = true;
    provider.hooks.afterCreate = async () => { if (loseFirst) { loseFirst = false; throw new Error('Réponse Stripe perdue après création.'); } };
    const lost = await paymentOutcome(lifecycle().open(id, TOKEN, provider, resolveAccount));
    expect(lost.ok && lost.value).toBeFalsy();
    const prepared = await read(id);
    expect(prepared?.paymentFlow?.attempt?.idempotencyKey).toBeTruthy();
    expect(provider.createdCount).toBe(1);
    const changedAccount = vi.fn().mockResolvedValue('acct_changed');
    const recovered = await lifecycle(second).open(id, TOKEN, provider, changedAccount);
    expect(recovered?.accountId).toBe(ACCOUNT_ID);
    expect(provider.createdCount).toBe(1);
    expect(changedAccount).not.toHaveBeenCalled();
    expect((await read(id))?.paymentFlow?.attempt?.idempotencyKey).toBe(prepared?.paymentFlow?.attempt?.idempotencyKey);
  });

  it.each(['paymentFlow.attempt', 'paymentFlow.attempt.requestStartedAt', 'payment.stripePaymentIntentId'])('réponse Mongo perdue après %s : reprise sans seconde intention', async (field) => {
    const id = await seed();
    const interrupted = lifecycle(loseMongoResponseAfter(first, field));
    await expect(interrupted.open(id, TOKEN, provider, resolveAccount)).rejects.toThrow('Réponse Mongo perdue');
    const prepared = await read(id);
    const recovered = await lifecycle(second).open(id, TOKEN, provider, resolveAccount);
    expect(recovered).not.toBeNull();
    expect(provider.createdCount).toBe(1);
    expect((await read(id))?.paymentFlow?.attempt?.id).toBe(prepared?.paymentFlow?.attempt?.id);
    expect((await read(id))?.payment.stripePaymentIntentId).toBe(recovered?.intent.id);
  });

  it('une ancienne commande chargée ne peut écraser le claim durable avec save()', async () => {
    const id = await seed();
    const stale = await second.findById(id);
    expect(stale).not.toBeNull();
    await lifecycle().open(id, TOKEN, provider, resolveAccount);
    stale!.status = 'cancelled';
    await expect(stale!.save()).rejects.toMatchObject({ name: 'VersionError' });
    expect((await read(id))?.status).toBe('new');
    expect((await read(id))?.payment.stripePaymentIntentId).toBeTruthy();
  });

  it('la fenêtre de récupération expirée interdit toute recréation même avec la même clé', async () => {
    const id = await seed();
    provider.hooks.afterCreate = async () => { throw new Error('Réponse provider perdue.'); };
    await expect(lifecycle().open(id, TOKEN, provider, resolveAccount)).rejects.toThrow();
    const before = await read(id);
    await first.updateOne({ _id: id }, { $set: { 'paymentFlow.attempt.recoveryUntil': new Date(Date.now() - 1) } });
    await expect(lifecycle(second).open(id, TOKEN, provider, resolveAccount)).rejects.toBeInstanceOf(ConflictException);
    expect(provider.create).toHaveBeenCalledTimes(1);
    expect(provider.createdCount).toBe(1);
    expect((await read(id))?.paymentFlow?.attempt?.idempotencyKey).toBe(before?.paymentFlow?.attempt?.idempotencyKey);
    expect((await read(id))?.paymentFlow?.phase).toBe('review_required');
  });

  it('webhook avant attachement : récupère la même création avant de confirmer le paiement', async () => {
    const id = await seed();
    const committed = paymentBarrier();
    const resume = paymentBarrier();
    let created!: ProviderIntent;
    let holdFirst = true;
    provider.hooks.afterCreate = async (_call, intent) => {
      if (holdFirst) { holdFirst = false; created = intent; committed.release(); await resume.promise; }
    };
    const opening = paymentOutcome(lifecycle().open(id, TOKEN, provider, resolveAccount));
    await Promise.race([committed.promise, opening.then(() => { throw new Error('Création terminée avant sa barrière.'); })]);
    try {
      expect((await read(id))?.payment.stripePaymentIntentId).toBeNull();
      provider.setStatus(created.id, ACCOUNT_ID, 'succeeded');
      await lifecycle(second).reconcileSucceeded(succeeded(created), provider);
      expect(await read(id)).toMatchObject({ status: 'new', payment: { status: 'paid', stripePaymentIntentId: created.id }, paymentFlow: { phase: 'settled' } });
    } finally { resume.release(); }
    const late = await opening;
    expect(late.ok && late.value).toBeFalsy();
    expect(provider.createdCount).toBe(1);
  });

  it('réponse d’annulation perdue : reste bloqué puis prouve canceled par relecture', async () => {
    const id = await seed();
    const opened = await lifecycle().open(id, TOKEN, provider, resolveAccount);
    expect(opened).not.toBeNull();
    let loseFirst = true;
    provider.hooks.afterCancel = async () => { if (loseFirst) { loseFirst = false; throw new Error('Réponse Stripe perdue après annulation.'); } };
    await expect(cancel(lifecycle(), id)).rejects.toThrow();
    const uncertain = await read(id);
    expect(uncertain?.status).not.toBe('cancelled');
    expect(['closing', 'review_required']).toContain(uncertain?.paymentFlow?.phase);
    expect(provider.snapshot(opened!.intent.id, ACCOUNT_ID).status).toBe('canceled');
    await cancel(lifecycle(second), id);
    expect(await read(id)).toMatchObject({ status: 'cancelled', paymentFlow: { phase: 'closed' } });
    expect(provider.createdCount).toBe(1);
  });

  it.each(['processing', 'requires_capture', 'succeeded'])('un paiement %s interdit l’annulation implicite et la libération du créneau', async (status) => {
    const id = await seed();
    const opened = await lifecycle().open(id, TOKEN, provider, resolveAccount);
    provider.setStatus(opened!.intent.id, ACCOUNT_ID, status);
    await expect(cancel(lifecycle(second), id)).rejects.toBeInstanceOf(ConflictException);
    const stored = await read(id);
    expect(stored?.status).toBe('new');
    expect(stored?.pickup?.slot).toBeTruthy();
    expect(stored?.paymentFlow?.phase).toBe('review_required');
    if (status === 'succeeded') expect(stored?.payment.status).toBe('paid');
    expect(provider.cancel).not.toHaveBeenCalled();
  });

  it('webhook réussi pendant l’annulation provider : argent conservé, aucune fausse fermeture', async () => {
    const id = await seed();
    const opened = await lifecycle().open(id, TOKEN, provider, resolveAccount);
    const reached = paymentBarrier();
    const resume = paymentBarrier();
    provider.hooks.beforeCancel = async () => { reached.release(); await resume.promise; };
    const cancelling = paymentOutcome(cancel(lifecycle(), id));
    await Promise.race([reached.promise, cancelling.then(() => { throw new Error('Annulation terminée avant sa barrière.'); })]);
    try {
      expect((await read(id))?.paymentFlow?.phase).toBe('closing');
      provider.setStatus(opened!.intent.id, ACCOUNT_ID, 'succeeded');
      await lifecycle(second).reconcileSucceeded(succeeded(opened!.intent), provider);
    } finally { resume.release(); }
    const result = await cancelling;
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toBeInstanceOf(ConflictException);
    expect(await read(id)).toMatchObject({ status: 'new', payment: { status: 'paid' }, paymentFlow: { phase: 'review_required' } });
    expect(provider.snapshot(opened!.intent.id, ACCOUNT_ID).status).toBe('succeeded');
  });

  it('historique sans preuve locale : aucun nouveau PI ni annulation prétendument sûre', async () => {
    const id = await seed({ paymentFlow: null });
    await expect(lifecycle().open(id, TOKEN, provider, resolveAccount)).rejects.toBeInstanceOf(ConflictException);
    await expect(cancel(lifecycle(second), id)).rejects.toBeInstanceOf(ConflictException);
    expect(provider.create).not.toHaveBeenCalled();
    expect(provider.cancel).not.toHaveBeenCalled();
    expect((await read(id))?.status).toBe('new');
  });

  it('PI historique canceled : ne crée jamais une seconde intention', async () => {
    const intent: ProviderIntent = { id: 'pi_legacy_canceled', client_secret: null, status: 'canceled', amount: 1250, currency: 'eur' };
    provider.seed(intent, ACCOUNT_ID);
    const id = await seed({ paymentFlow: null, payment: { method: 'online', status: 'pending', stripeAccountId: ACCOUNT_ID, stripePaymentIntentId: intent.id } });
    const outcome = await paymentOutcome(lifecycle().open(id, TOKEN, provider, resolveAccount));
    expect(outcome.ok && outcome.value).toBeFalsy();
    expect(provider.create).not.toHaveBeenCalled();
    expect((await read(id))?.payment.stripePaymentIntentId).toBe(intent.id);
  });

  it('un autre tenant ne peut fermer la commande', async () => {
    const id = await seed();
    await expect(lifecycle().cancel(id, String(new Types.ObjectId()), 'other-actor', 'Autre tenant', provider)).rejects.toThrow();
    expect((await read(id))?.paymentFlow?.phase).toBe('open');
    expect(provider.cancel).not.toHaveBeenCalled();
  });

  it.each(['account', 'intent', 'amount', 'currency', 'environment'])('webhook : une preuve avec %s différent ne paie aucune commande', async (different) => {
    const id = await seed();
    const opened = await lifecycle().open(id, TOKEN, provider, resolveAccount);
    const event = succeeded(opened!.intent);
    if (different === 'account') event.account = 'acct_attacker';
    if (different === 'intent') event.data.object.id = 'pi_other';
    if (different === 'amount') Object.assign(event.data.object, { amount: 50, amount_received: 50 });
    if (different === 'currency') Object.assign(event.data.object, { currency: 'usd' });
    if (different === 'environment') Object.assign(event, { livemode: true });
    expect(await lifecycle(second).reconcileSucceeded(event, provider)).toBeNull();
    expect((await read(id))?.payment.status).toBe('pending');
  });

  it('webhook payé rejoué : renvoie la projection récupérable sans réécrire la commande', async () => {
    const id = await seed();
    const opened = await lifecycle().open(id, TOKEN, provider, resolveAccount);
    provider.setStatus(opened!.intent.id, ACCOUNT_ID, 'succeeded');
    const event = succeeded(opened!.intent);
    expect(await lifecycle().reconcileSucceeded(event, provider)).not.toBeNull();
    const before = await read(id);
    expect(await lifecycle(second).reconcileSucceeded(event, provider)).not.toBeNull();
    expect(await read(id)).toEqual(before);
  });

  it('webhook tardif après remboursement intégral : ne ramène jamais le paiement à paid', async () => {
    const id = await seed();
    const opened = await lifecycle().open(id, TOKEN, provider, resolveAccount);
    await first.updateOne({ _id: id }, { $set: { 'payment.status': 'refunded' } });
    const before = await read(id);
    expect(await lifecycle(second).reconcileSucceeded(succeeded(opened!.intent), provider)).toBeNull();
    expect(await read(id)).toEqual(before);
  });

  it('bascule sans tentative : même commande, créneau, montant et historique, aucun appel bancaire', async () => {
    const id = await seed();
    const before = await read(id);
    const result = await lifecycle().switchToCounter(id, TOKEN, null);
    expect(String(result._id)).toBe(id);
    expect(await read(id)).toMatchObject({ status: 'new', payment: { method: 'counter', tender: null, status: 'pending' },
      paymentFlow: { phase: 'counter_ready', close: { destination: 'counter' }, providerStatus: 'not_started' } });
    expect((await read(id))?.pickup).toEqual(before?.pickup);
    expect((await read(id))?.totals).toEqual(before?.totals);
    expect((await read(id))?.statusHistory).toEqual(before?.statusHistory);
    expect(provider.create).not.toHaveBeenCalled();
    const stable = await read(id);
    await counter(lifecycle(second), id);
    expect(await read(id)).toEqual(stable);
    await expect(lifecycle().open(id, TOKEN, provider, resolveAccount)).rejects.toBeInstanceOf(ConflictException);
    expect(provider.create).not.toHaveBeenCalled();
  });

  it.each(['requires_payment_method', 'requires_confirmation', 'requires_action', 'canceled'])('bascule après preuve %s sur le même PI et le même compte', async (status) => {
    const id = await seed();
    const opened = await lifecycle().open(id, TOKEN, provider, resolveAccount);
    provider.setStatus(opened!.intent.id, ACCOUNT_ID, status);
    await counter(lifecycle(second), id);
    const row = await read(id);
    expect(row).toMatchObject({ status: 'new', payment: { method: 'counter', status: 'pending', stripePaymentIntentId: opened!.intent.id },
      paymentFlow: { phase: 'counter_ready', providerStatus: 'canceled', close: { destination: 'counter' } } });
    expect(row?.paymentFlow?.attempt?.accountId).toBe(ACCOUNT_ID);
    expect(provider.snapshot(opened!.intent.id, ACCOUNT_ID).status).toBe('canceled');
    if (status === 'canceled') expect(provider.cancel).not.toHaveBeenCalled();
    expect(provider.createdCount).toBe(1);
  });

  it.each(['beforeCreate', 'afterCreate'] as const)('bascule concurrente à %s : fermeture durable et aucun secret tardif', async (boundary) => {
    const id = await seed();
    const reached = paymentBarrier();
    const resume = paymentBarrier();
    let firstCall = true;
    provider.hooks[boundary] = async () => {
      if (firstCall) { firstCall = false; reached.release(); await resume.promise; }
    };
    provider.hooks.beforeCancel = async () => {
      expect(await read(id)).toMatchObject({ payment: { method: 'online' }, paymentFlow: { phase: 'closing', close: { destination: 'counter' } } });
    };
    const opening = paymentOutcome(lifecycle().open(id, TOKEN, provider, resolveAccount));
    await Promise.race([reached.promise, opening.then(() => { throw new Error('Ouverture terminée avant la barrière.'); })]);
    try { await counter(lifecycle(second), id); } finally { resume.release(); }
    const late = await opening;
    expect(late.ok && late.value).toBeFalsy();
    expect(provider.createdCount).toBe(1);
    expect(await read(id)).toMatchObject({ status: 'new', payment: { method: 'counter' }, paymentFlow: { phase: 'counter_ready' } });
  });

  it.each(['counter', 'cancel_order'] as const)('la destination %s gagnante reste immuable face à la demande opposée', async (destination) => {
    const id = await seed();
    await lifecycle().open(id, TOKEN, provider, resolveAccount);
    const reached = paymentBarrier();
    const resume = paymentBarrier();
    provider.hooks.beforeCancel = async () => { reached.release(); await resume.promise; };
    const firstAction = paymentOutcome<unknown>(destination === 'counter' ? counter(lifecycle(), id) : cancel(lifecycle(), id));
    await Promise.race([reached.promise, firstAction.then(() => { throw new Error('Fermeture terminée avant la barrière.'); })]);
    try {
      await expect(destination === 'counter' ? cancel(lifecycle(second), id) : counter(lifecycle(second), id))
        .rejects.toBeInstanceOf(ConflictException);
      expect((await read(id))?.paymentFlow?.close?.destination).toBe(destination);
    } finally { resume.release(); }
    expect((await firstAction).ok).toBe(true);
    expect((await read(id))?.status).toBe(destination === 'counter' ? 'new' : 'cancelled');
  });

  it('deux bascules concurrentes partagent la même opération et ne changent pas le statut métier', async () => {
    const id = await seed({ status: 'ready' });
    await lifecycle().open(id, TOKEN, provider, resolveAccount);
    const results = await Promise.all([counter(lifecycle(), id), counter(lifecycle(second), id)]);
    expect(new Set(results.map((row) => row.paymentFlow?.close?.operationId)).size).toBe(1);
    expect((await read(id))?.status).toBe('ready');
    expect(provider.createdCount).toBe(1);
  });

  it('une tentative seulement préparée peut basculer sans provider, sans être effacée', async () => {
    const id = await seed();
    await expect(lifecycle(loseMongoResponseAfter(first, 'paymentFlow.attempt')).open(id, TOKEN, provider, resolveAccount)).rejects.toThrow();
    const attempt = (await read(id))?.paymentFlow?.attempt;
    expect(attempt?.requestStartedAt).toBeNull();
    await lifecycle(second).switchToCounter(id, TOKEN, null);
    expect((await read(id))?.paymentFlow?.attempt).toEqual(attempt);
    expect(provider.create).not.toHaveBeenCalled();
    expect((await read(id))?.paymentFlow?.phase).toBe('counter_ready');
  });

  it('une ancienne lecture ne peut solder la commande lorsque le claim de bascule a gagné', async () => {
    const id = await seed();
    const stale = await second.findById(id);
    await counter(lifecycle(), id);
    stale!.payment.method = 'counter'; stale!.payment.status = 'paid'; stale!.status = 'delivered';
    await expect(stale!.save()).rejects.toMatchObject({ name: 'VersionError' });
    expect(await read(id)).toMatchObject({ status: 'new', payment: { status: 'pending', method: 'counter' } });
  });

  it('un SDK indisponible ne prouve jamais la fermeture d’un PI connu', async () => {
    const id = await seed();
    await lifecycle().open(id, TOKEN, provider, resolveAccount);
    await expect(lifecycle(second).switchToCounter(id, TOKEN, null)).rejects.toBeInstanceOf(ConflictException);
    expect(await read(id)).toMatchObject({ payment: { status: 'pending', method: 'online' }, paymentFlow: { phase: 'review_required' } });
    expect(provider.cancel).not.toHaveBeenCalled();
    await counter(lifecycle(), id);
    expect((await read(id))?.paymentFlow?.phase).toBe('counter_ready');
  });

  it.each(['processing', 'requires_capture', 'succeeded', 'unknown'])('la bascule ne transforme jamais %s en règlement comptoir', async (status) => {
    const id = await seed();
    const opened = await lifecycle().open(id, TOKEN, provider, resolveAccount);
    provider.setStatus(opened!.intent.id, ACCOUNT_ID, status);
    await expect(counter(lifecycle(), id)).rejects.toBeInstanceOf(ConflictException);
    expect((await read(id))?.payment.method).toBe('online');
    expect((await read(id))?.paymentFlow?.phase).toBe('review_required');
    expect((await read(id))?.status).toBe('new');
    expect(provider.cancel).not.toHaveBeenCalled();
    if (status === 'succeeded') expect((await read(id))?.payment.status).toBe('paid');
  });

  it('confirmation carte concurrente : la preuve de paiement gagne sans autoriser le comptoir', async () => {
    const id = await seed();
    const opened = await lifecycle().open(id, TOKEN, provider, resolveAccount);
    const reached = paymentBarrier();
    const resume = paymentBarrier();
    provider.hooks.beforeCancel = async () => { reached.release(); await resume.promise; };
    const switching = paymentOutcome(counter(lifecycle(), id));
    await Promise.race([reached.promise, switching.then(() => { throw new Error('Bascule terminée avant la barrière.'); })]);
    try {
      provider.setStatus(opened!.intent.id, ACCOUNT_ID, 'succeeded');
      await lifecycle(second).reconcileSucceeded(succeeded(opened!.intent), provider);
    } finally { resume.release(); }
    expect((await switching).ok).toBe(false);
    expect(await read(id)).toMatchObject({ status: 'new', payment: { method: 'online', status: 'paid' }, paymentFlow: { phase: 'review_required' } });
  });

  it.each(['afterCreate', 'afterCancel'] as const)('réponse provider perdue à %s : reprise de la même tentative sans faux succès', async (boundary) => {
    const id = await seed();
    if (boundary === 'afterCancel') await lifecycle().open(id, TOKEN, provider, resolveAccount);
    let firstCall = true;
    provider.hooks[boundary] = async () => { if (firstCall) { firstCall = false; throw new Error('Réponse provider perdue.'); } };
    if (boundary === 'afterCreate') {
      await expect(lifecycle().open(id, TOKEN, provider, resolveAccount)).rejects.toThrow('Réponse provider');
    } else {
      await expect(counter(lifecycle(), id)).rejects.toBeInstanceOf(ConflictException);
      expect((await read(id))?.payment.method).toBe('online');
    }
    await counter(lifecycle(second), id);
    expect(provider.createdCount).toBe(1);
    expect(await read(id)).toMatchObject({ payment: { method: 'counter', status: 'pending' }, paymentFlow: { phase: 'counter_ready' } });
  });

  it.each(['paymentFlow.close', 'payment.method'] as const)('réponse Mongo perdue après %s : le rejeu retrouve la bascule sans créer de commande', async (field) => {
    const id = await seed();
    await expect(counter(lifecycle(loseMongoResponseAfter(first, field)), id)).rejects.toThrow('Réponse Mongo perdue');
    await counter(lifecycle(second), id);
    expect(await first.countDocuments({})).toBe(1);
    expect(await read(id)).toMatchObject({ payment: { method: 'counter', status: 'pending' }, paymentFlow: { phase: 'counter_ready' } });
    expect(provider.create).not.toHaveBeenCalled();
  });

  it('refuse l’historique inconnu et la récupération expirée sans nouveau PI', async () => {
    const unknown = await seed({ paymentFlow: null });
    await expect(counter(lifecycle(), unknown)).rejects.toBeInstanceOf(ConflictException);
    expect(provider.create).not.toHaveBeenCalled();
    const id = await seed();
    provider.hooks.afterCreate = async () => { throw new Error('Réponse perdue.'); };
    await expect(lifecycle().open(id, TOKEN, provider, resolveAccount)).rejects.toThrow();
    await first.updateOne({ _id: id }, { $set: { 'paymentFlow.attempt.recoveryUntil': new Date(Date.now() - 1) } });
    await expect(counter(lifecycle(second), id)).rejects.toBeInstanceOf(ConflictException);
    expect(provider.create).toHaveBeenCalledOnce();
    expect((await read(id))?.payment.method).toBe('online');
  });

  it.each([ACCOUNT_ID, null])('adopte et ferme le PI historique connu sur son compte %s', async (accountId) => {
    const intent: ProviderIntent = { id: 'pi_historic_counter', client_secret: null, status: 'requires_payment_method', amount: 1250, currency: 'eur' };
    provider.seed(intent, accountId);
    const id = await seed({ paymentFlow: null, payment: { method: 'online', status: 'pending', stripeAccountId: accountId, stripePaymentIntentId: intent.id } });
    await counter(lifecycle(), id);
    expect(await read(id)).toMatchObject({ payment: { method: 'counter', stripePaymentIntentId: intent.id },
      paymentFlow: { origin: 'adopted_intent', phase: 'counter_ready' } });
    expect(provider.cancel.mock.calls[0]?.[1]).toBe(accountId);
    expect(provider.create).not.toHaveBeenCalled();
  });

  it.each([undefined, '', 'other-token', { $ne: null }])('refuse le jeton %j avant toute écriture ou banque', async (token) => {
    const id = await seed();
    const before = await read(id);
    await expect(lifecycle().switchToCounter(id, token, provider)).rejects.toMatchObject({ status: 404 });
    expect(await read(id)).toEqual(before);
    expect(provider.create).not.toHaveBeenCalled();
    expect(provider.cancel).not.toHaveBeenCalled();
  });

  it.each([
    { type: 'delivery' }, { type: 'surplace' }, { channel: 'pos' },
    { status: 'cancelled' }, { status: 'delivered' },
    { payment: { method: 'online', status: 'paid' } }, { payment: { method: 'online', status: 'refunded' } },
  ])('refuse la bascule hors retrait en attente : %j', async (patch) => {
    const id = await seed(patch);
    const before = await read(id);
    await expect(counter(lifecycle(), id)).rejects.toBeInstanceOf(ConflictException);
    expect(await read(id)).toEqual(before);
    expect(provider.create).not.toHaveBeenCalled();
  });

  it('une commande basculée peut ensuite être annulée par la caisse, sans rouvrir Stripe', async () => {
    const id = await seed();
    await lifecycle().open(id, TOKEN, provider, resolveAccount);
    await counter(lifecycle(), id);
    const proof = (await read(id))?.paymentFlow?.close;
    provider.retrieve.mockClear(); provider.cancel.mockClear();
    await cancel(lifecycle(second), id);
    const row = await read(id);
    expect(row?.status).toBe('cancelled');
    expect(row?.paymentFlow?.phase).toBe('closed');
    expect(row?.paymentFlow?.close).toEqual(proof);
    expect(row?.statusHistory.at(-1)?.by).toBe('cashier-test');
    expect(provider.retrieve).not.toHaveBeenCalled();
    expect(provider.cancel).not.toHaveBeenCalled();
    await cancel(lifecycle(), id);
    expect(await read(id)).toEqual(row);
    await expect(counter(lifecycle(), id)).rejects.toBeInstanceOf(ConflictException);
  });

  it('une ancienne bascule suspendue ne rouvre pas une commande annulée après la réussite d’un autre worker', async () => {
    const id = await seed();
    await lifecycle().open(id, TOKEN, provider, resolveAccount);
    const reached = paymentBarrier();
    const resume = paymentBarrier();
    let holdFirst = true;
    provider.hooks.beforeRetrieve = async () => {
      if (holdFirst) { holdFirst = false; reached.release(); await resume.promise; }
    };
    const oldSwitch = paymentOutcome(counter(lifecycle(), id));
    await Promise.race([reached.promise, oldSwitch.then(() => { throw new Error('Bascule terminée avant sa barrière.'); })]);
    let cancelled!: Awaited<ReturnType<typeof read>>;
    try {
      await counter(lifecycle(second), id);
      await cancel(lifecycle(second), id);
      cancelled = await read(id);
      expect(cancelled).toMatchObject({ status: 'cancelled', paymentFlow: { phase: 'closed' } });
    } finally { resume.release(); }
    const oldResult = await oldSwitch;
    expect(oldResult.ok).toBe(false);
    expect(!oldResult.ok && oldResult.error).toBeInstanceOf(ConflictException);
    expect(await read(id)).toEqual(cancelled);
    expect(provider.createdCount).toBe(1);
  });

  it.each(['pending', 'paid'] as const)('un événement succeeded contradictoire ne reclassifie pas le comptoir %s si Stripe confirme canceled', async (status) => {
    const id = await seed();
    const opened = await lifecycle().open(id, TOKEN, provider, resolveAccount);
    await counter(lifecycle(), id);
    if (status === 'paid') await first.updateOne({ _id: id }, { $set: { 'payment.status': 'paid' } });
    const before = await read(id);
    expect(await lifecycle(second).reconcileSucceeded(succeeded(opened!.intent), provider)).toBeNull();
    expect(await read(id)).toEqual(before);
  });

  it.each(['canceled', 'succeeded'])('une ancienne ouverture revenue avec %s après la bascule ne réécrit jamais le mode comptoir', async (status) => {
    const id = await seed();
    const opened = await lifecycle().open(id, TOKEN, provider, resolveAccount);
    const reached = paymentBarrier();
    const resume = paymentBarrier();
    provider.retrieve.mockImplementationOnce(async () => {
      reached.release(); await resume.promise;
      return { ...opened!.intent, status };
    });
    const reopening = paymentOutcome(lifecycle().open(id, TOKEN, provider, resolveAccount));
    await Promise.race([reached.promise, reopening.then(() => { throw new Error('Reprise terminée avant la barrière.'); })]);
    try { await counter(lifecycle(second), id); } finally { resume.release(); }
    const late = await reopening;
    expect(late.ok && late.value).toBeFalsy();
    expect(await read(id)).toMatchObject({ payment: { method: 'counter', status: 'pending' },
      paymentFlow: { phase: status === 'canceled' ? 'counter_ready' : 'review_required' } });
  });

  it.each(['pending', 'paid'] as const)('une vraie contradiction provider après comptoir %s impose le rapprochement sans inventer un encaissement ni remboursement', async (status) => {
    const id = await seed();
    const opened = await lifecycle().open(id, TOKEN, provider, resolveAccount);
    await counter(lifecycle(), id);
    // Impossible dans le cycle Stripe normal : injecte une incohérence pour
    // prouver que le serveur ne détruit pas la classification comptoir.
    provider.setStatus(opened!.intent.id, ACCOUNT_ID, 'succeeded');
    if (status === 'paid') await first.updateOne({ _id: id }, { $set: { 'payment.status': 'paid' } });
    await expect(lifecycle(second).reconcileSucceeded(succeeded(opened!.intent), provider)).rejects.toMatchObject({ status: 503 });
    expect(await read(id)).toMatchObject({ status: 'new', payment: { method: 'counter', status },
      paymentFlow: { phase: 'review_required', reviewReason: 'counter_payment_provider_conflict' } });
    const stable = await read(id);
    await expect(lifecycle().reconcileSucceeded(succeeded(opened!.intent), provider)).rejects.toMatchObject({ status: 503 });
    expect(await read(id)).toEqual(stable);
  });

  describe('encaissement explicite — une seule commande et une seule preuve', () => {
    const actor = { sub: 'cashier-test', tenantId: String(TENANT_ID), role: 'caisse' as const, kind: 'staff' as const, deviceId: 'register-test' };
    const body = () => ({ operationId: randomUUID(), expectedTotalCents: 1250, tender: 'cash' as const, cashReceivedCents: 2000 });
    function collection(orders = first, capabilities = ['bo']) {
      const audit = { logOnce: vi.fn(async () => undefined) };
      const redis = { publish: vi.fn(async () => 1) };
      return { service: new OrderCounterCollectionService(orders, { pourTenant: async () => capabilities } as never,
        audit as never, redis as never), audit, redis };
    }
    const seedCounter = (patch: Record<string, unknown> = {}) => seed({ payment: { method: 'counter', status: 'pending' }, ...patch });
    const orderService = (orders = first) => new OrdersService(orders, {} as never, {} as never, {} as never,
      { publish: async () => 1 } as never, { log: async () => undefined } as never, {} as never,
      { pourTenant: async () => ['bo'] } as never, {} as never);

    it.each(['cash', 'card', 'meal_voucher'] as const)('encaisse %s sans changer commande, créneau, canal, lignes ou statut cuisine', async (tender) => {
      const id = await seedCounter({ status: 'preparing' });
      const before = await read(id);
      const input = { operationId: randomUUID(), expectedTotalCents: 1250, tender, ...(tender === 'cash' ? { cashReceivedCents: 2000 } : {}) };
      const { service, audit, redis } = collection();
      await service.collect(String(TENANT_ID), id, actor, input);
      const after = await read(id);
      expect(after).toMatchObject({ _id: before!._id, status: 'preparing', channel: 'online', clientId: before!.clientId,
        payment: { method: 'counter', status: 'paid', tender, cashReceived: tender === 'cash' ? 2000 : null, changeGiven: tender === 'cash' ? 750 : null },
        counterCollection: { operationId: input.operationId, amountCents: 1250, tender, actor: { sub: actor.sub, role: 'caisse' }, deviceId: 'register-test' } });
      expect(after?.pickup).toEqual(before?.pickup); expect(after?.lines).toEqual(before?.lines);
      expect(after?.statusHistory).toEqual(before?.statusHistory);
      expect(audit.logOnce).toHaveBeenCalledOnce();
      expect(redis.publish).toHaveBeenCalledOnce();
      expect(JSON.stringify(redis.publish.mock.calls)).not.toMatch(/counterCollection|paymentFlow/);
      expect(await first.countDocuments()).toBe(1);
      expect(provider.create).not.toHaveBeenCalled();
    });

    it('la bascule bancaire prouvée permet ensuite l’encaissement de la même commande', async () => {
      const id = await seed();
      await lifecycle().open(id, TOKEN, provider, resolveAccount);
      await counter(lifecycle(), id);
      await collection().service.collect(String(TENANT_ID), id, actor, body());
      expect(await read(id)).toMatchObject({ payment: { status: 'paid', method: 'counter' }, paymentFlow: { phase: 'counter_ready' } });
      expect(provider.createdCount).toBe(1);
    });

    it('deux opérateurs rejouant la même opération n’inscrivent qu’un seul encaissement', async () => {
      const id = await seedCounter(); const input = body();
      await Promise.all([collection().service.collect(String(TENANT_ID), id, actor, input),
        collection(second).service.collect(String(TENANT_ID), id, actor, input)]);
      const stable = await read(id);
      await collection().service.collect(String(TENANT_ID), id, actor, input);
      expect(await read(id)).toEqual(stable);
      expect(stable?.counterCollection?.operationId).toBe(input.operationId);
      expect(stable?.__v).toBe(1);
    });

    it('deux opérations différentes concurrentes : un gagnant, aucun second paiement', async () => {
      const id = await seedCounter();
      const results = await Promise.allSettled([collection().service.collect(String(TENANT_ID), id, actor, body()),
        collection(second).service.collect(String(TENANT_ID), id, actor, body())]);
      expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
      expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
      expect((await read(id))?.__v).toBe(1);
    });

    it('réponse Mongo perdue après le paiement : le même ID reprend sans encaisser deux fois', async () => {
      const id = await seedCounter(); const input = body();
      await expect(collection(loseMongoResponseAfter(first, 'counterCollection')).service.collect(String(TENANT_ID), id, actor, input)).rejects.toThrow('Réponse Mongo perdue');
      const stable = await read(id);
      await collection(second).service.collect(String(TENANT_ID), id, actor, input);
      expect(await read(id)).toEqual(stable);
      expect(stable?.payment.status).toBe('paid');
    });

    it.each([{ cashReceivedCents: 2500 }, { expectedTotalCents: 1200 }, { operationId: randomUUID() }])('refuse une répétition avec d’autres paramètres %j', async (patch) => {
      const id = await seedCounter(); const input = body();
      await collection().service.collect(String(TENANT_ID), id, actor, input);
      const stable = await read(id);
      await expect(collection().service.collect(String(TENANT_ID), id, actor, { ...input, ...patch })).rejects.toBeInstanceOf(ConflictException);
      expect(await read(id)).toEqual(stable);
    });

    it('un rejeu après remise renvoie l’état final, sans ressusciter un remboursement', async () => {
      const id = await seedCounter(); const input = body();
      await collection().service.collect(String(TENANT_ID), id, actor, input);
      await first.updateOne({ _id: id }, { $set: { status: 'delivered', 'payment.status': 'refunded' } });
      const stable = await read(id);
      const response = await collection().service.collect(String(TENANT_ID), id, actor, input);
      expect(response.payment.status).toBe('refunded'); expect(response.status).toBe('delivered');
      expect(await read(id)).toEqual(stable);
    });

    it.each([
      { type: 'delivery' }, { status: 'cancelled' }, { status: 'delivered' }, { paymentFlow: null },
      { payment: { method: 'online', status: 'pending' } }, { payment: { method: 'counter', status: 'paid' } },
      { payment: { method: 'counter', status: 'refunded' } },
      { payment: { method: 'counter', status: 'pending', stripePaymentIntentId: 'pi_unknown' } },
      { paymentFlow: { version: 1, origin: 'legacy_unknown', phase: 'open' } },
      { paymentFlow: { version: 1, origin: 'created_v1', phase: 'closed' } },
      { paymentFlow: { version: 1, origin: 'created_v1', phase: 'closing' } },
      { paymentFlow: { version: 1, origin: 'created_v1', phase: 'review_required' } },
    ])('refuse une commande non encaissable %j', async (patch) => {
      const id = await seedCounter(patch); const before = await read(id);
      await expect(collection().service.collect(String(TENANT_ID), id, actor, body())).rejects.toBeInstanceOf(ConflictException);
      expect(await read(id)).toEqual(before);
    });

    it.each([{ expectedTotalCents: 1200 }, { cashReceivedCents: 1000 }])('refuse un prix périmé ou un montant reçu insuffisant %j', async (patch) => {
      const id = await seedCounter(); const before = await read(id);
      await expect(collection().service.collect(String(TENANT_ID), id, actor, { ...body(), ...patch })).rejects.toThrow();
      expect(await read(id)).toEqual(before);
    });

    it('distingue le rejet certain, le conflit de paramètres et l’encaissement déjà confirmé ailleurs', async () => {
      const id = await seedCounter(); const input = body(); const service = collection().service;
      await expect(service.collect(String(TENANT_ID), id, actor, { ...input, expectedTotalCents: 1 })).rejects.toMatchObject({
        status: 409, response: { code: 'ORDER_COLLECTION_REJECTED' },
      });
      await service.collect(String(TENANT_ID), id, actor, input);
      await expect(service.collect(String(TENANT_ID), id, actor, { ...input, cashReceivedCents: 2500 })).rejects.toMatchObject({
        status: 409, response: { code: 'ORDER_COLLECTION_OPERATION_CONFLICT' },
      });
      await expect(service.collect(String(TENANT_ID), id, actor, body())).rejects.toMatchObject({
        status: 409, response: { code: 'ORDER_COLLECTION_ALREADY_COLLECTED' },
      });
    });

    it('refuse la cuisine et un autre tenant même sur le rejeu d’une opération réussie', async () => {
      const id = await seedCounter(); const input = body();
      await collection().service.collect(String(TENANT_ID), id, actor, input);
      const stable = await read(id);
      for (const invalid of [{ ...actor, role: 'cuisine' as const }, { ...actor, tenantId: String(new Types.ObjectId()) }]) {
        await expect(collection().service.collect(String(TENANT_ID), id, invalid, input)).rejects.toMatchObject({ status: 403 });
      }
      expect(await read(id)).toEqual(stable);
    });

    it('applique le périmètre de l’offre avant toute mutation', async () => {
      const id = await seedCounter({ channel: 'pos' }); const before = await read(id);
      await expect(collection(first, ['online']).service.collect(String(TENANT_ID), id, actor, body())).rejects.toMatchObject({ status: 404 });
      await expect(collection(first, ['loyalty']).service.collect(String(TENANT_ID), id, actor, body())).rejects.toMatchObject({ status: 404 });
      expect(await read(id)).toEqual(before);
    });

    it('paiement confirmé d’abord : aucune annulation, bascule ou ouverture bancaire ne le remplace', async () => {
      const id = await seedCounter();
      await collection().service.collect(String(TENANT_ID), id, actor, body());
      await expect(counter(lifecycle(), id)).rejects.toBeInstanceOf(ConflictException);
      await expect(cancel(lifecycle(), id)).rejects.toBeInstanceOf(ConflictException);
      expect(await lifecycle().open(id, TOKEN, provider, resolveAccount)).toBeNull();
      expect(provider.create).not.toHaveBeenCalled();
    });

    it('une remise après encaissement ne peut modifier le montant confirmé', async () => {
      const id = await seedCounter();
      await collection().service.collect(String(TENANT_ID), id, actor, body());
      const stable = await read(id);
      await expect(orderService().discount(String(TENANT_ID), id, { staffId: actor.sub, role: 'gerant' }, 100, 'Geste commercial')).rejects.toBeInstanceOf(ConflictException);
      expect(await read(id)).toEqual(stable);
    });

    it.each(['discount', 'open', 'cancel', 'switch'] as const)('%s gagne contre une ancienne lecture d’encaissement : aucun écrasement', async (winner) => {
      const id = await seedCounter(); const input = body(); const hold = holdCollection(first);
      const late = paymentOutcome(collection(hold.proxy).service.collect(String(TENANT_ID), id, actor, input));
      await Promise.race([hold.reached.promise, late.then(() => { throw new Error('Collecte terminée avant sa barrière.'); })]);
      let stable!: Awaited<ReturnType<typeof read>>;
      try {
        if (winner === 'discount') await orderService(second).discount(String(TENANT_ID), id,
          { staffId: String(new Types.ObjectId()), role: 'gerant' }, 100, 'Geste commercial');
        if (winner === 'open') await lifecycle(second).open(id, TOKEN, provider, resolveAccount);
        if (winner === 'cancel') await cancel(lifecycle(second), id);
        if (winner === 'switch') await counter(lifecycle(second), id);
        stable = await read(id);
      } finally { hold.resume.release(); }
      const result = await late;
      if (winner === 'switch') {
        // Never-started counter switch is compatible: fresh proof + same price.
        expect(result.ok).toBe(true);
        expect(await read(id)).toMatchObject({ status: 'new', payment: { method: 'counter', status: 'paid' }, paymentFlow: { phase: 'counter_ready' } });
      } else {
        expect(result.ok).toBe(false);
        expect(!result.ok && result.error).toBeInstanceOf(ConflictException);
        expect(await read(id)).toEqual(stable);
      }
      expect(provider.createdCount).toBe(winner === 'open' ? 1 : 0);
    });

    it('une ancienne remise déjà chargée ne peut minorer le paiement encaissé entre-temps', async () => {
      const id = await seedCounter();
      const stale = await second.findById(id).select('+paymentFlow');
      const orders = orderService(second);
      vi.spyOn(orders, 'byId').mockResolvedValue(stale!);
      await collection().service.collect(String(TENANT_ID), id, actor, body());
      const stable = await read(id);
      await expect(orders.discount(String(TENANT_ID), id, { staffId: String(new Types.ObjectId()), role: 'gerant' }, 100, 'Geste commercial'))
        .rejects.toBeInstanceOf(ConflictException);
      expect(await read(id)).toEqual(stable);
    });

    it('encaisser puis remettre conserve deux gestes et un seul paiement', async () => {
      const id = await seedCounter({ status: 'ready' });
      await expect(orderService().updateStatus(String(TENANT_ID), id, 'delivered', actor)).rejects.toBeInstanceOf(ConflictException);
      await collection().service.collect(String(TENANT_ID), id, actor, body());
      const receipt = (await read(id))?.counterCollection;
      await orderService().updateStatus(String(TENANT_ID), id, 'delivered', actor);
      expect(await read(id)).toMatchObject({ status: 'delivered', payment: { status: 'paid' }, counterCollection: receipt });
    });

    it.each(['audit', 'redis'] as const)('une panne %s après paiement garde la preuve et se répare par le même POST', async (dependency) => {
      const id = await seedCounter(); const input = body(); const ctx = collection();
      if (dependency === 'audit') ctx.audit.logOnce.mockRejectedValueOnce(new Error('Audit indisponible'));
      else ctx.redis.publish.mockRejectedValueOnce(new Error('Redis indisponible'));
      await expect(ctx.service.collect(String(TENANT_ID), id, actor, input)).rejects.toMatchObject({ status: 503,
        response: { code: 'ORDER_COLLECTION_RECONCILIATION_REQUIRED' } });
      const stable = await read(id);
      expect(stable?.payment.status).toBe('paid');
      await ctx.service.collect(String(TENANT_ID), id, actor, input);
      expect(await read(id)).toEqual(stable);
      expect(ctx.audit.logOnce).toHaveBeenCalledTimes(2);
    });

    it('journal append-only réel : replays concurrents et réponse perdue ne créent aucune seconde ligne', async () => {
      const id = await seedCounter(); const input = body();
      const audit = new AuditService(auditLogs, {} as never, {} as never);
      const service = new OrderCounterCollectionService(first, { pourTenant: async () => ['bo'] } as never, audit,
        { publish: async () => 1 } as never);
      const create = auditLogs.create.bind(auditLogs);
      vi.spyOn(auditLogs, 'create').mockImplementationOnce((async (...args: unknown[]) => {
        await Reflect.apply(create, auditLogs, args);
        throw new Error('Réponse audit perdue après insert réel');
      }) as never);
      try {
        await Promise.all([service.collect(String(TENANT_ID), id, actor, input), service.collect(String(TENANT_ID), id, actor, input)]);
        await service.collect(String(TENANT_ID), id, actor, input);
        const entries = await auditLogs.find({ targetId: id }).lean();
        expect(entries).toHaveLength(1);
        expect(entries[0]).toMatchObject({ action: 'order.collect', author: { id: actor.sub },
          meta: { amountCents: 1250, tender: 'cash', operationId: input.operationId } });
        expect(entries[0]?.deduplication?.fingerprint).toHaveLength(64);
        await expect(audit.logOnce({ tenantId: String(TENANT_ID), action: 'order.collect', targetId: id,
          actor, meta: { ...(entries[0]?.meta as object), amountCents: 1 } }, input.operationId)).rejects.toMatchObject({ status: 503 });
        expect(await auditLogs.find({ targetId: id }).lean()).toEqual(entries);
      } finally { vi.restoreAllMocks(); }
    });

    it('journal réellement indisponible après paiement : le rejeu répare l’unique entrée sans toucher au paiement', async () => {
      const id = await seedCounter(); const input = body();
      const service = new OrderCounterCollectionService(first, { pourTenant: async () => ['bo'] } as never,
        new AuditService(auditLogs, {} as never, {} as never), { publish: async () => 1 } as never);
      const create = vi.spyOn(auditLogs, 'create').mockRejectedValueOnce(new Error('Insertion audit indisponible'));
      try {
        await expect(service.collect(String(TENANT_ID), id, actor, input)).rejects.toMatchObject({ status: 503 });
        const stable = await read(id);
        expect(stable?.payment.status).toBe('paid');
        expect(await auditLogs.countDocuments({ targetId: id })).toBe(0);
        await service.collect(String(TENANT_ID), id, actor, input);
        expect(await read(id)).toEqual(stable);
        expect(await auditLogs.countDocuments({ targetId: id })).toBe(1);
        expect(create).toHaveBeenCalledTimes(2);
      } finally { create.mockRestore(); }
    });
  });
});
