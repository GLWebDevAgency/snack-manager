import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import mongoose, { type Connection, type Model } from 'mongoose';
import Redis from 'ioredis';
import { MODELS, type Tenant } from '@sm/db';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { MongoPaymentDomainsRepository } from './payment-domains.repository';
import { tenantPaymentHosts, type PaymentDomainsConfig } from './payment-domain-hosts';
import { RELEASE_PAYMENT_DOMAINS_LEASE, RENEW_PAYMENT_DOMAINS_LEASE, WRITE_PAYMENT_DOMAINS_STATE } from './payment-domains.worker';

function isolatedMongo(raw: string) {
  const url = new URL(raw);
  if (url.protocol !== 'mongodb:' || !['127.0.0.1', 'localhost'].includes(url.hostname)
    || url.username || url.password || url.search || url.hash
    || !/^\/snackmanager_payment_domains_test_[a-z0-9_]{1,12}$/.test(url.pathname)) throw new Error('Expected an isolated local payment domains test database');
  url.pathname += `_${randomUUID().replaceAll('-', '').slice(0, 10)}`;
  return { uri: url.toString(), name: url.pathname.slice(1) };
}
function isolatedRedis(raw: string) {
  const url = new URL(raw);
  if (url.protocol !== 'redis:' || !['127.0.0.1', 'localhost'].includes(url.hostname)
    || url.username || url.password || url.search || url.hash || !/^\/(?:[0-9]|1[0-5])$/.test(url.pathname)) throw new Error('Expected a local Redis test URL without credentials');
  return url.toString();
}
const mongoTarget = process.env.PAYMENT_DOMAINS_TEST_MONGO_URL;
const redisTarget = process.env.PAYMENT_DOMAINS_TEST_REDIS_URL;
const database = mongoTarget === undefined ? null : isolatedMongo(mongoTarget);
const redisUrl = redisTarget === undefined ? null : isolatedRedis(redisTarget);
const config: PaymentDomainsConfig = { mode: 'test', webHostname: 'web.snackmanager.fr', rootDomain: 'snackmanager.fr' };
const id = (n: number) => n.toString(16).padStart(24, '0');

function authenticatedLocalFixture(target: string) {
  const url = new URL(target);
  // Identifiants synthétiques : cette cible doit être refusée avant connexion.
  url.username = 'fixture'; url.password = 'fixture';
  return url.toString();
}

describe('payment domains integration target guards', () => {
  it.each(['mongodb://remote.example/snackmanager_payment_domains_test_ci', 'mongodb://localhost/admin', 'mongodb://localhost/snackmanager_app',
    'mongodb://localhost/snackmanager_payment_domains_test_ci?replicaSet=prod', 'mongodb+srv://localhost/snackmanager_payment_domains_test_ci',
    authenticatedLocalFixture('mongodb://localhost/snackmanager_payment_domains_test_ci'), 'mongodb://localhost/snackmanager_payment_domains_test_ci#fragment',
    'mongodb://localhost,remote.example/snackmanager_payment_domains_test_ci', ''])('refuses unsafe Mongo target %s', value => {
    expect(() => isolatedMongo(value)).toThrow();
  });
  it('creates unique owned Mongo databases', () => {
    const target = 'mongodb://127.0.0.1/snackmanager_payment_domains_test_ci';
    expect(isolatedMongo(target).name).not.toBe(isolatedMongo(target).name);
  });
  it.each(['redis://remote.example/0', 'redis://localhost/99', 'redis://localhost/0?x=y', authenticatedLocalFixture('redis://localhost/0'), 'redis://localhost/15#fragment', ''])('refuses unsafe Redis target %s', value => {
    expect(() => isolatedRedis(value)).toThrow();
  });
});

(database ? describe : describe.skip)('payment domain desired state — real Mongo', () => {
  let db: Connection;
  let tenants: Model<Tenant>;
  let repository: MongoPaymentDomainsRepository;
  beforeAll(async () => {
    db = await mongoose.createConnection(database!.uri, { serverSelectionTimeoutMS: 5000, directConnection: true, family: 4 }).asPromise();
    tenants = db.model(MODELS.Tenant.name, MODELS.Tenant.schema, MODELS.Tenant.collection);
    repository = new MongoPaymentDomainsRepository(tenants);
    await tenants.init();
  });
  beforeEach(async () => {
    if (db.name !== database!.name) throw new Error('Test database ownership mismatch');
    await tenants.deleteMany({});
  });
  afterAll(async () => {
    try { if (db?.name === database!.name) await db.dropDatabase(); }
    finally { await db?.close(); }
  });
  async function seed(n: number, extra: Record<string, unknown> = {}) {
    // Raw inserts deliberately cover historical tenants with no account defaults.
    await tenants.collection.insertOne({ _id: new mongoose.Types.ObjectId(id(n)), slug: `restaurant-${n}`, name: 'Fixture',
      encaissement: { accountId: `acct_${n}`, chargesEnabled: true, payoutsEnabled: false, detailsSubmitted: false }, ...extra });
  }
  it('selects only eligible accounts without changing charges or legacy access policy', async () => {
    await seed(1);
    await seed(2, { account: { status: 'suspended' } });
    await seed(3, { account: { status: 'churned' } });
    await seed(4, { encaissement: { accountId: 'acct_4', chargesEnabled: false } });
    await seed(5, { encaissement: { accountId: 'platform', chargesEnabled: true } });
    expect((await repository.page(null, 10)).map(row => String(row._id))).toEqual([id(1), id(3)]);
  });
  it('uses stable ID pagination and can resume within a tenant without dropping later domains', async () => {
    for (let n = 1; n <= 13; n++) await seed(n);
    const first = await repository.page(null, 10);
    expect(first.map(row => String(row._id))).toEqual(Array.from({ length: 10 }, (_, i) => id(i + 1)));
    expect((await repository.page({ tenantId: id(10), host: null }, 10)).map(row => String(row._id))).toEqual([id(11), id(12), id(13)]);
    expect((await repository.page({ tenantId: id(10), host: 'a.fr' }, 10)).map(row => String(row._id))).toEqual([id(10), id(11), id(12), id(13)]);
  });
  it('projects only registration data and rechecks account, access and active custom domains', async () => {
    await seed(1, { secret: 'do-not-project', domains: [
      { hostname: 'custom.fr', status: 'active', providerId: 'private-provider' },
      { hostname: 'waiting.fr', status: 'pending_dns' },
    ] });
    const snapshot = await tenants.collection.findOne({ _id: new mongoose.Types.ObjectId(id(1)) });
    const row = (await repository.current(id(1), 'acct_1'))!;
    expect(tenantPaymentHosts(row, config)).toEqual(['custom.fr', 'restaurant-1.snackmanager.fr', 'web.snackmanager.fr']);
    expect(JSON.stringify(row)).not.toContain('private-provider'); expect(JSON.stringify(row)).not.toContain('do-not-project');
    expect(await tenants.collection.findOne({ _id: new mongoose.Types.ObjectId(id(1)) })).toEqual(snapshot);
    expect(await repository.current(id(1), 'acct_other')).toBeNull();
    await tenants.collection.updateOne({ _id: new mongoose.Types.ObjectId(id(1)) }, { $set: { 'encaissement.accountId': 'acct_replaced' } });
    expect(await repository.current(id(1), 'acct_1')).toBeNull();
    await tenants.collection.updateOne({ _id: new mongoose.Types.ObjectId(id(1)) }, { $set: { 'account.status': 'suspended' } });
    expect(await repository.current(id(1), 'acct_replaced')).toBeNull();
  });
  it('sees DNS activation and newly attached tenants on the following scan', async () => {
    await seed(1, { domains: [{ hostname: 'custom.fr', status: 'pending_dns' }] });
    expect(tenantPaymentHosts((await repository.page(null, 10))[0]!, config)).not.toContain('custom.fr');
    await tenants.collection.updateOne({ _id: new mongoose.Types.ObjectId(id(1)) }, { $set: { 'domains.0.status': 'active' } });
    await seed(2);
    const rows = await repository.page(null, 10);
    expect(rows).toHaveLength(2); expect(tenantPaymentHosts(rows[0]!, config)).toContain('custom.fr');
  });
});

(redisUrl ? describe : describe.skip)('payment domain lease scripts — real Redis, owned keys only', () => {
  let redis: Redis;
  const prefix = `sm:payment-domains-test:${randomUUID()}`;
  const lease = `${prefix}:lease`;
  const state = `${prefix}:cursor`;
  beforeAll(async () => { redis = new Redis(redisUrl!, { lazyConnect: true, connectTimeout: 5000, commandTimeout: 5000, maxRetriesPerRequest: 0 }); await redis.connect(); });
  beforeEach(async () => { await redis.del(lease, state); });
  afterAll(async () => { if (redis) { await redis.del(lease, state); await redis.quit(); } });
  it('claims a single owner and atomically renews and writes only while owned', async () => {
    expect(await redis.set(lease, 'one', 'PX', 10000, 'NX')).toBe('OK');
    expect(await redis.set(lease, 'two', 'PX', 10000, 'NX')).toBeNull();
    expect(await redis.eval(RENEW_PAYMENT_DOMAINS_LEASE, 1, lease, 'one', 120000)).toBe(1);
    expect(await redis.pttl(lease)).toBeGreaterThan(110000);
    expect(await redis.eval(WRITE_PAYMENT_DOMAINS_STATE, 2, lease, state, 'one', 'cursor', 300000)).toBe(1);
    expect(await redis.get(state)).toBe('cursor'); expect(await redis.pttl(state)).toBeGreaterThan(290000);
  });
  it('a stale worker cannot renew, publish cursor/cache state or remove a replacement lease', async () => {
    await redis.set(lease, 'new-owner', 'PX', 120000);
    expect(await redis.eval(RENEW_PAYMENT_DOMAINS_LEASE, 1, lease, 'old-owner', 120000)).toBe(0);
    expect(await redis.eval(WRITE_PAYMENT_DOMAINS_STATE, 2, lease, state, 'old-owner', 'stale', 300000)).toBe(0);
    expect(await redis.eval(RELEASE_PAYMENT_DOMAINS_LEASE, 1, lease, 'old-owner')).toBe(0);
    expect(await redis.get(state)).toBeNull(); expect(await redis.get(lease)).toBe('new-owner');
    expect(await redis.eval(RELEASE_PAYMENT_DOMAINS_LEASE, 1, lease, 'new-owner')).toBe(1);
    expect(await redis.get(lease)).toBeNull();
  });
});
