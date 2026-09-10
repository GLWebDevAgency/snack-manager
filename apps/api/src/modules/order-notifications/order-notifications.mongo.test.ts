import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import mongoose, { Types, type Connection, type Model } from 'mongoose';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { MODELS, type Order, type OrderReadyNotification, type Tenant } from '@sm/db';
import { ORDER_PUSH_TTL_MS } from '@sm/contracts';
import { OrderNotificationsService } from './order-notifications.service';
import { OrderNotificationsWorker } from './order-notifications.worker';
import { pushFixture } from './order-push.test-fixture';

function isolatedMongo(raw: string) {
  const url = new URL(raw);
  if (url.protocol !== 'mongodb:' || !['127.0.0.1', 'localhost'].includes(url.hostname)
    || url.username || url.password || url.search || url.hash
    || !/^\/snackmanager_order_notifications_test_[a-z0-9_]{1,12}$/.test(url.pathname)) {
    throw new Error('ORDER_NOTIFICATIONS_TEST_MONGO_URL doit cibler une base locale isolée snackmanager_order_notifications_test_, sans options.');
  }
  url.pathname += `_${randomUUID().replaceAll('-', '').slice(0, 10)}`;
  return { uri: url.toString(), name: url.pathname.slice(1) };
}

// Aucun MONGO_URL applicatif lu. Une cible explicitement fournie mais invalide
// échoue avant toute connexion ; elle ne bascule jamais vers le fallback local.
const mongoUrl = process.env.ORDER_NOTIFICATIONS_TEST_MONGO_URL;
const database = mongoUrl === undefined ? null : isolatedMongo(mongoUrl);
const binary = process.env.SM_TEST_MONGOD ?? '/opt/homebrew/bin/mongod';

function authenticatedLocalFixture() {
  const url = new URL('mongodb://localhost/snackmanager_order_notifications_test_ci');
  // Identifiants synthétiques : cette cible doit être refusée avant connexion.
  url.username = 'fixture'; url.password = 'fixture';
  return url.toString();
}

describe('cible Mongo des notifications de commande', () => {
  it.each([
    'mongodb://remote.example/snackmanager_order_notifications_test_ci',
    'mongodb://localhost/admin', 'mongodb://localhost/snackmanager_app',
    'mongodb://localhost/snackmanager_order_notifications_test_ci?replicaSet=prod',
    'mongodb://localhost/snackmanager_order_notifications_test_ci#fragment',
    authenticatedLocalFixture(),
    'mongodb://localhost,remote.example/snackmanager_order_notifications_test_ci',
    'mongodb+srv://localhost/snackmanager_order_notifications_test_ci', '',
  ])('refuse la cible non isolée %s', value => expect(() => isolatedMongo(value)).toThrow());
  it('dérive une base possédée différente pour chaque run, sans réutiliser la base fournie', () => {
    const first = isolatedMongo('mongodb://127.0.0.1:27017/snackmanager_order_notifications_test_ci');
    const second = isolatedMongo('mongodb://127.0.0.1:27017/snackmanager_order_notifications_test_ci');
    expect(first.name).toMatch(/^snackmanager_order_notifications_test_ci_[a-f0-9]{10}$/);
    expect(first.name).not.toBe(second.name);
    expect(new URL(first.uri).pathname).toBe(`/${first.name}`);
    expect(first.name.length).toBeLessThan(64);
  });
});

describe.skipIf(!database && !existsSync(binary))('notifications durables — Mongo isolé, fournisseur push simulé', () => {
  let mongod: ChildProcess | undefined, directory: string | undefined, connection: Connection;
  let target = database;
  let tenants: Model<Tenant>, orders: Model<Order>, notices: Model<OrderReadyNotification>;
  const tenantId = new Types.ObjectId(), orderId = new Types.ObjectId();
  const token = 'a'.repeat(32), slug = 'restaurant';
  const { config, subscription } = pushFixture();
  const reserve = vi.fn(async () => true);
  let service: OrderNotificationsService;

  beforeAll(async () => {
    if (!target) {
      const socket = createServer();
      await new Promise<void>((resolve) => socket.listen(0, '127.0.0.1', resolve));
      const port = (socket.address() as { port: number }).port;
      await new Promise<void>((resolve) => socket.close(() => resolve()));
      directory = await mkdtemp(join(tmpdir(), 'sm-order-push-test-'));
      mongod = spawn(binary, ['--dbpath', directory, '--bind_ip', '127.0.0.1', '--port', String(port), '--logpath', join(directory, 'mongo.log'), '--quiet'], { stdio: 'ignore' });
      target = isolatedMongo(`mongodb://127.0.0.1:${port}/snackmanager_order_notifications_test_local`);
    }
    connection = mongoose.createConnection(target.uri, { serverSelectionTimeoutMS: database ? 5_000 : 15_000, directConnection: true, family: 4 });
    await connection.asPromise();
    if (connection.name !== target.name) throw new Error('Base de recette non possédée');
    tenants = connection.model(MODELS.Tenant.name, MODELS.Tenant.schema, MODELS.Tenant.collection);
    orders = connection.model(MODELS.Order.name, MODELS.Order.schema, MODELS.Order.collection);
    notices = connection.model(MODELS.OrderReadyNotification.name, MODELS.OrderReadyNotification.schema, MODELS.OrderReadyNotification.collection);
    await notices.init();
  }, 25_000);
  afterAll(async () => {
    try {
      if (connection?.readyState === 1) {
        if (connection.name !== target?.name) throw new Error('Base de recette non possédée');
        await connection.dropDatabase();
      }
    } finally {
      try { await connection?.close(); }
      finally {
        if (mongod && mongod.exitCode === null && mongod.signalCode === null) {
          const child = mongod;
          const ended = new Promise<void>((resolve) => child.once('exit', () => resolve()));
          child.kill('SIGTERM'); await ended;
        }
        if (directory) await rm(directory, { recursive: true, force: true });
      }
    }
  }, 20_000);
  beforeEach(async () => {
    if (connection.name !== target?.name) throw new Error('Base de recette non possédée');
    await Promise.all([tenants.deleteMany({}), orders.deleteMany({}), notices.deleteMany({})]);
    await tenants.collection.insertOne({ _id: tenantId, slug, name: 'Restaurant' } as never);
    await orders.collection.insertOne({ _id: orderId, tenantId, trackingToken: token, status: 'preparing',
      type: 'pickup', payment: { method: 'online', status: 'paid' }, createdAt: new Date(), statusHistory: [{ status: 'preparing', at: new Date() }] } as never);
    reserve.mockClear(); reserve.mockResolvedValue(true);
    service = new OrderNotificationsService(tenants, orders, notices, { reserve } as never, config);
  });
  const request = (endpoint = subscription.endpoint) => ({ trackingToken: token, expectedRevision: 0, subscription: { ...subscription, endpoint } });
  const preference = () => ({ trackingToken: token, endpoint: subscription.endpoint });
  async function ready() { await orders.updateOne({ _id: orderId }, { $set: { status: 'ready' }, $push: { statusHistory: { status: 'ready', at: new Date() } } }); }
  async function due() { await notices.updateOne({ orderId }, { $set: { nextAttemptAt: new Date(0), 'subscriptions.0.nextAttemptAt': new Date(0) } }); }

  it('garde la capacité de suivi et le tenant avant tout quota et toute écriture', async () => {
    await expect(service.subscribe(slug, String(orderId), { ...request(), trackingToken: 'wrong' })).rejects.toThrow('Commande introuvable');
    await tenants.collection.insertOne({ _id: new Types.ObjectId(), slug: 'other', name: 'Other' } as never);
    await expect(service.subscribe('other', String(orderId), request())).rejects.toThrow('Commande introuvable');
    expect(reserve).not.toHaveBeenCalled(); expect(await notices.countDocuments()).toBe(0);
  });

  it('ACK seulement après stockage chiffré ; rejouer ne duplique pas un abonnement', async () => {
    const results = await Promise.all(Array.from({ length: 6 }, () => service.subscribe(slug, String(orderId), request())));
    expect(results.every((result) => result.state === 'active')).toBe(true);
    const raw = await notices.collection.findOne({ orderId });
    expect(raw?.subscriptions).toHaveLength(1);
    expect(JSON.stringify(raw)).not.toContain(subscription.endpoint);
    expect(JSON.stringify(raw)).not.toContain(token);
    expect(JSON.stringify(raw)).not.toContain(subscription.keys.auth);
    expect((raw!.expiresAt as Date).getTime()).toBeGreaterThan(Date.now() + ORDER_PUSH_TTL_MS - 10_000);
  });

  it('arbitre atomiquement cinq appareils malgré huit inscriptions concurrentes', async () => {
    const results = await Promise.allSettled(Array.from({ length: 8 }, (_, index) => service.subscribe(slug, String(orderId), request(`${subscription.endpoint}-${index}`))));
    expect(results.filter((result) => result.status === 'fulfilled').length).toBeGreaterThan(0);
    for (let index = 0; index < 8; index++) {
      const endpoint = `${subscription.endpoint}-${index}`;
      const state = await service.status(slug, String(orderId), { trackingToken: token, endpoint });
      await service.subscribe(slug, String(orderId), { ...request(endpoint), expectedRevision: state.revision }).catch(() => undefined);
    }
    expect((await notices.findOne({ orderId }).lean())?.subscriptions).toHaveLength(5);
  });

  it('deux workers ne prennent pas le même bail ; ACK et suppression des clés persistent', async () => {
    await service.subscribe(slug, String(orderId), request()); await ready();
    let finish!: (result: 'sent') => void;
    const send = vi.fn(() => new Promise<'sent'>((resolve) => { finish = resolve; }));
    const first = new OrderNotificationsWorker(orders, notices, { send } as never, config);
    const second = new OrderNotificationsWorker(orders, notices, { send } as never, config);
    const work = first.drainOnce();
    await expect.poll(() => send.mock.calls.length).toBe(1);
    await second.drainOnce(); expect(send).toHaveBeenCalledTimes(1);
    finish('sent'); await work;
    expect(await service.status(slug, String(orderId), preference())).toMatchObject({ state: 'sent' });
    const raw = await notices.collection.findOne({ orderId });
    expect(raw?.subscriptions[0]?.encrypted).toBeNull(); expect(raw?.nextAttemptAt).toBeNull();
  });

  it('reprend un retry après remplacement du worker', async () => {
    await service.subscribe(slug, String(orderId), request()); await ready();
    const send = vi.fn().mockResolvedValueOnce('retry').mockResolvedValue('sent');
    await new OrderNotificationsWorker(orders, notices, { send } as never, config).drainOnce();
    const waiting = await notices.findOne({ orderId }).lean();
    expect(waiting?.subscriptions[0]).toMatchObject({ state: 'active', attempts: 1 });
    expect(waiting!.nextAttemptAt!.getTime()).toBeGreaterThan(Date.now());
    await due();
    await new OrderNotificationsWorker(orders, notices, { send } as never, config).drainOnce();
    expect(send).toHaveBeenCalledTimes(2);
    expect(await service.status(slug, String(orderId), preference())).toMatchObject({ state: 'sent' });
  });

  it('une révocation tardive gagne sur un ACK en vol et sur une ancienne génération', async () => {
    await service.subscribe(slug, String(orderId), request()); await ready();
    let finish!: (result: 'sent') => void;
    const send = vi.fn(() => new Promise<'sent'>((resolve) => { finish = resolve; }));
    const work = new OrderNotificationsWorker(orders, notices, { send } as never, config).drainOnce();
    await expect.poll(() => send.mock.calls.length).toBe(1);
    await service.revoke(slug, String(orderId), preference());
    expect(await service.status(slug, String(orderId), preference())).toMatchObject({ state: 'off' });
    const state = await service.status(slug, String(orderId), preference());
    await service.subscribe(slug, String(orderId), { ...request(), expectedRevision: state.revision });
    finish('sent'); await work;
    expect(await service.status(slug, String(orderId), preference())).toMatchObject({ state: 'active' });
    expect((await notices.collection.findOne({ orderId }))?.subscriptions[0]?.encrypted).toMatch(/^v1\./);
  });

  it.each(['cancelled', 'delivered'])('ne notifie ni ne réinscrit une commande %s', async (status) => {
    await service.subscribe(slug, String(orderId), request()); await ready();
    await orders.updateOne({ _id: orderId }, { $set: { status } });
    const send = vi.fn();
    await new OrderNotificationsWorker(orders, notices, { send } as never, config).drainOnce();
    expect(send).not.toHaveBeenCalled();
    await expect(service.subscribe(slug, String(orderId), request())).rejects.toThrow('ne peut plus');
  });

  it('une désactivation acquittée invalide un POST commencé avant elle, même sans ligne préalable', async () => {
    let resume!: () => void;
    reserve.mockImplementationOnce(() => new Promise<boolean>((resolve) => { resume = () => resolve(true); }));
    const pending = service.subscribe(slug, String(orderId), request());
    await expect.poll(() => !!resume).toBe(true);
    const off = await service.revoke(slug, String(orderId), preference());
    expect(off).toMatchObject({ state: 'off', revision: 1 });
    resume();
    await expect(pending).rejects.toThrow('La préférence a changé');
    expect(await service.status(slug, String(orderId), preference())).toMatchObject({ state: 'off' });
    expect((await notices.findOne({ orderId }).lean())?.subscriptions).toHaveLength(0);
  });

  it.each([
    ['pickup', 'online', 'pending', 0, false], ['delivery', 'counter', 'pending', 0, false],
    ['pickup', 'counter', 'pending', 0, true], ['delivery', 'online', 'paid', 0, true],
    ['pickup', 'online', 'paid', 100, false], ['pickup', 'online', 'refunded', 0, false],
  ])('promesse prête %s/%s/%s remboursement %s : envoi=%s', async (type, method, status, pendingRefundCents, allowed) => {
    await service.subscribe(slug, String(orderId), request()); await ready();
    await orders.updateOne({ _id: orderId }, { $set: { type, payment: { method, status, pendingRefundCents } } });
    const send = vi.fn().mockResolvedValue('sent');
    await new OrderNotificationsWorker(orders, notices, { send } as never, config).drainOnce();
    expect(send.mock.calls.length).toBe(allowed ? 1 : 0);
  });

  it.each(['revoke', 'lease'])('aucun envoi si %s survient pendant la dernière lecture de commande', async (interruption) => {
    await service.subscribe(slug, String(orderId), request()); await ready();
    let resume!: () => void, reads = 0;
    const orderReader = { findOne: (...args: Parameters<typeof orders.findOne>) => ({ lean: async () => {
      const row = await orders.findOne(...args).lean();
      if (++reads === 2) await new Promise<void>((resolve) => { resume = resolve; });
      return row;
    } }) };
    const send = vi.fn().mockResolvedValue('sent');
    const work = new OrderNotificationsWorker(orderReader as never, notices, { send } as never, config).drainOnce();
    await expect.poll(() => !!resume).toBe(true);
    if (interruption === 'revoke') await service.revoke(slug, String(orderId), preference());
    else await notices.updateOne({ orderId }, { $set: { leaseUntil: new Date(0) } });
    resume(); await work;
    expect(send).not.toHaveBeenCalled();
  });

  it('reprend un bail expiré et retrouve prête dans le journal durable', async () => {
    await service.subscribe(slug, String(orderId), request()); await ready();
    await orders.updateOne({ _id: orderId }, { $set: { status: 'preparing' } });
    await notices.updateOne({ orderId }, { $set: { leaseOwner: 'replica-stopped', leaseUntil: new Date(0) } });
    const send = vi.fn().mockResolvedValue('sent');
    await new OrderNotificationsWorker(orders, notices, { send } as never, config).drainOnce();
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('échoue fermé sans configuration ou quota, et refuse une ancienne commande', async () => {
    const unavailable = new OrderNotificationsService(tenants, orders, notices, { reserve } as never, null);
    expect(await unavailable.configView(slug)).toEqual({ available: false, publicKey: null });
    await expect(unavailable.subscribe(slug, String(orderId), request())).rejects.toThrow('pas disponibles');
    reserve.mockRejectedValueOnce(new Error('redis down'));
    await expect(service.subscribe(slug, String(orderId), request())).rejects.toThrow('momentanément indisponibles');
    expect(await notices.countDocuments()).toBe(0);
    await orders.collection.updateOne({ _id: orderId }, { $set: { createdAt: new Date(Date.now() - ORDER_PUSH_TTL_MS - 1) } });
    await expect(service.subscribe(slug, String(orderId), request())).rejects.toThrow('ne peut plus');
  });
});
