import { randomUUID } from 'node:crypto';
import { ConflictException } from '@nestjs/common';
import { MODELS, type Order } from '@sm/db';
import mongoose, { Types, type Connection, type Model, type Query } from 'mongoose';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StripeWebhookEvent } from '../../common/stripe-signature';
import { OrderPaymentLifecycleService, type ProviderIntent } from './order-payment-lifecycle.service';
import { paymentBarrier, paymentOutcome, TestOrderPaymentProvider } from './order-payment-test-provider';

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
  const read = (id: string) => first.findById(id).select('+paymentFlow').read('primary').lean();
  const cancel = (service: OrderPaymentLifecycleService, id: string) => service.cancel(
    id, String(TENANT_ID), 'cashier-test', 'Annulation de recette', provider,
  );

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
});
