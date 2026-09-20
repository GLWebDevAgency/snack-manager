import 'reflect-metadata';
import { randomBytes, randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { Module, type INestApplication } from '@nestjs/common';
import { APP_GUARD, NestFactory, Reflector } from '@nestjs/core';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { getModelToken } from '@nestjs/mongoose';
import { ThrottlerModule } from '@nestjs/throttler';
import * as argon2 from 'argon2';
import mongoose, { Types, type Connection } from 'mongoose';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { MODELS } from '@sm/db';
import { CAPACITE_NON_SOUSCRITE_CODE, OrderRefundJournalSchema, type JwtPayload } from '@sm/contracts';
import { AuthGuard } from '../../common/auth';
import { CapaciteGuard, CapacitesService } from '../../common/capacites';
import { SessionAccessService } from '../../common/session-access';
import { OwnerReauthentication } from '../encaissement/owner-reauthentication.service';
import { OrderFinanceController } from '../orders/order-finance.controller';
import { OrdersService } from '../orders/orders.service';
import { OrderRefundsService, type RefundStripeClient } from './order-refunds.service';

const TENANT = '507f1f77bcf86cd799439011';
const OTHER = '507f1f77bcf86cd799439012';
const OWNER = '507f1f77bcf86cd799439021';
const MANAGER = '507f1f77bcf86cd799439022';
const FOREIGN_OWNER = '507f1f77bcf86cd799439023';
const STAFF = '507f1f77bcf86cd799439031';
const DEVICE = '507f1f77bcf86cd799439041';
const RUN_ID = randomUUID();
const ACCOUNT = 'acct_journal_http_fixture';
const INTENT = 'pi_journal_http_fixture';

/** Refuse toute cible métier et alloue une base appartenant uniquement à ce run. */
function isolatedJournalDatabase(raw: string): string {
  const url = new URL(raw);
  if (url.protocol !== 'mongodb:' || !['127.0.0.1', 'localhost'].includes(url.hostname)
    || url.username || url.password || url.search || url.hash
    || !/^\/snackmanager_payment_test_[a-z0-9_]+$/i.test(url.pathname) || url.pathname.length > 44) {
    throw new Error('ORDER_PAYMENT_TEST_MONGO_URL doit désigner une base locale snackmanager_payment_test_ sans options ni identifiants.');
  }
  url.pathname += `_http_${randomUUID().replaceAll('-', '').slice(0, 10)}`;
  return url.toString();
}
const uri = process.env.ORDER_PAYMENT_TEST_MONGO_URL
  ? isolatedJournalDatabase(process.env.ORDER_PAYMENT_TEST_MONGO_URL) : null;

function fixtureModels(db: Connection) {
  return {
    Tenant: db.model(MODELS.Tenant.name, MODELS.Tenant.schema, MODELS.Tenant.collection),
    User: db.model(MODELS.User.name, MODELS.User.schema, MODELS.User.collection),
    Staff: db.model(MODELS.Staff.name, MODELS.Staff.schema, MODELS.Staff.collection),
    Device: db.model(MODELS.Device.name, MODELS.Device.schema, MODELS.Device.collection),
    Order: db.model(MODELS.Order.name, MODELS.Order.schema, MODELS.Order.collection),
  };
}
type FixtureModels = ReturnType<typeof fixtureModels>;

describe('cible de recette HTTP du journal de remboursement', () => {
  it('refuse les cibles distantes, métier, authentifiées ou dotées d’options', () => {
    const authenticated = new URL('mongodb://localhost/snackmanager_payment_test_ci');
    authenticated.username = 'fixture'; authenticated.password = 'fixture';
    for (const target of [
      'mongodb://remote.example/snackmanager_payment_test_ci', 'mongodb://localhost/snackmanager',
      'mongodb+srv://localhost/snackmanager_payment_test_ci', authenticated.toString(),
      'mongodb://localhost/snackmanager_payment_test_ci?replicaSet=anything',
      'mongodb://localhost/snackmanager_payment_test_ci#fragment',
    ]) expect(() => isolatedJournalDatabase(target)).toThrow();
  });
  it('ne réutilise jamais la base fournie ou celle d’un autre run', () => {
    const target = 'mongodb://127.0.0.1:27065/snackmanager_payment_test_journal';
    expect(isolatedJournalDatabase(target)).not.toBe(target);
    expect(isolatedJournalDatabase(target)).not.toBe(isolatedJournalDatabase(target));
  });
});

(uri ? describe : describe.skip)('journal financier — HTTP Nest et Mongo local réels', () => {
  let db: Connection;
  let models: FixtureModels;
  let ownsDatabase = false;
  let app: INestApplication | undefined;
  let origin: string;
  let jwt: JwtService;
  let passwordHash: string;
  let orderId: string;
  let operationId: string;
  let tokens: { owner: string; manager: string; foreign: string; staff: string };
  let commands: string[] = [];
  let refundsEnabled = true;
  const provider: RefundStripeClient = {
    environment: 'test',
    refunds: {
      list: vi.fn(async () => { throw new Error('Aucune lecture fournisseur attendue'); }),
      create: vi.fn(async () => { throw new Error('Aucun remboursement fournisseur attendu'); }),
    },
    charges: { retrieve: vi.fn(async () => { throw new Error('Aucune lecture de charge attendue'); }) },
  };
  const clientFactory = vi.fn(async () => refundsEnabled ? provider : null);
  const audit = { log: vi.fn(), logOnce: vi.fn() };
  const redis = { publish: vi.fn() };
  const unusedOrders = { cancelAsOwner: vi.fn(async () => { throw new Error('Annulation hors recette'); }) };

  async function assertOwnDatabase() {
    if (!uri || !ownsDatabase || db.name !== new URL(uri).pathname.slice(1)
      || !/^snackmanager_payment_test_[a-z0-9_]+_http_[a-f0-9]{10}$/i.test(db.name)
      || !await db.db!.collection('_test_run').findOne({ runId: RUN_ID })) {
      throw new Error('Nettoyage interdit : base de journal HTTP non possédée par ce run.');
    }
  }

  beforeAll(async () => {
    db = await mongoose.createConnection(uri!, { autoCreate: false, autoIndex: false, directConnection: true,
      family: 4, serverSelectionTimeoutMS: 5_000, monitorCommands: true }).asPromise();
    db.getClient().on('commandStarted', event => { commands.push(event.commandName); });
    const hello = await db.db!.admin().command({ hello: 1 });
    expect(hello.setName).toBeUndefined(); expect(hello.msg).not.toBe('isdbgrid');
    expect(await db.db!.listCollections({}, { nameOnly: true }).toArray()).toEqual([]);
    await db.db!.collection('_test_run').insertOne({ runId: RUN_ID }); ownsDatabase = true;
    models = fixtureModels(db);
    for (const model of Object.values(models)) { await model.createCollection(); await model.createIndexes(); }
    passwordHash = await argon2.hash(randomBytes(24).toString('base64url'));

    // Vitest/esbuild ne produit pas design:paramtypes ; on restaure uniquement
    // l’injection des vrais constructeurs, sans remplacer les gardes.
    for (const [target, dependencies] of [
      [OrderFinanceController, [OrderRefundsService, OrdersService, OwnerReauthentication]],
      [CapaciteGuard, [Reflector, CapacitesService]],
    ] as const) {
      if (!Reflect.hasOwnMetadata('design:paramtypes', target)) {
        Reflect.defineMetadata('design:paramtypes', [...dependencies], target);
      }
    }
    class JournalHttpFixtureModule {}
    Module({
      imports: [JwtModule.register({ secret: randomBytes(32).toString('base64url'), signOptions: { expiresIn: '5m' } }),
        ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 120 }])],
      controllers: [OrderFinanceController],
      providers: [
        ...Object.entries(models).map(([name, model]) => ({ provide: getModelToken(name), useValue: model })),
        SessionAccessService, CapacitesService, OwnerReauthentication,
        { provide: OrdersService, useValue: unusedOrders },
        { provide: OrderRefundsService, inject: [CapacitesService],
          useFactory: (capabilities: CapacitesService) => new OrderRefundsService(models.Order, clientFactory,
            redis as never, capabilities, audit as never) },
        { provide: CapaciteGuard, inject: [Reflector, CapacitesService],
          useFactory: (reflector: Reflector, capabilities: CapacitesService) => new CapaciteGuard(reflector, capabilities) },
        { provide: APP_GUARD, inject: [JwtService, Reflector, SessionAccessService],
          useFactory: (signer: JwtService, reflector: Reflector, sessions: SessionAccessService) => new AuthGuard(signer, reflector, sessions) },
      ],
    })(JournalHttpFixtureModule);
    app = await NestFactory.create(JournalHttpFixtureModule, { logger: false, abortOnError: false });
    await app.listen(0, '127.0.0.1');
    origin = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
    jwt = app.get(JwtService);
  }, 15_000);

  beforeEach(async () => {
    await assertOwnDatabase();
    await models.Tenant.deleteMany({});
    await models.User.deleteMany({});
    await models.Staff.deleteMany({});
    await models.Device.deleteMany({});
    await models.Order.deleteMany({});
    refundsEnabled = true;
    await models.Tenant.create([
      { _id: TENANT, slug: 'journal-http-fixture', name: 'Restaurant recette journal', plan: null,
        onlineOrdering: true, account: { status: 'active' } },
      { _id: OTHER, slug: 'journal-http-other', name: 'Autre restaurant recette', plan: null,
        onlineOrdering: true, account: { status: 'active' } },
    ]);
    await models.User.create([
      { _id: OWNER, email: 'owner@journal-http.invalid', passwordHash, role: 'owner', tenantId: TENANT, sessionVersion: 'user-v1' },
      { _id: FOREIGN_OWNER, email: 'foreign@journal-http.invalid', passwordHash, role: 'owner', tenantId: OTHER, sessionVersion: 'user-v1' },
    ]);
    await models.Staff.create([
      { _id: STAFF, tenantId: TENANT, name: 'Équipier recette', role: 'caisse',
        pinHash: 'fixture-only', active: true, sessionVersion: 'staff-v1' },
      { _id: MANAGER, tenantId: TENANT, name: 'Gérant recette', role: 'gerant',
        pinHash: 'fixture-only', active: true, sessionVersion: 'staff-v1' },
    ]);
    await models.Device.create({ _id: DEVICE, tenantId: TENANT, name: 'POS recette', kind: 'pos', paired: true,
      active: true, sessionVersion: 'device-v1' });
    const userToken = (sub: string, tenantId = TENANT) => jwt.signAsync({
      sub, tenantId, role: 'owner', kind: 'user', userSessionVersion: 'user-v1',
    } satisfies JwtPayload);
    const staffToken = (sub: string, role: 'caisse' | 'gerant') => jwt.signAsync({ sub, tenantId: TENANT, kind: 'staff', role,
      staffSessionVersion: 'staff-v1', deviceId: DEVICE, deviceSessionVersion: 'device-v1' } satisfies JwtPayload);
    tokens = { owner: await userToken(OWNER), manager: await staffToken(MANAGER, 'gerant'),
      foreign: await userToken(FOREIGN_OWNER, OTHER), staff: await staffToken(STAFF, 'caisse') };
    orderId = String(new Types.ObjectId()); operationId = randomUUID();
    const reason = 'Produit indisponible';
    await models.Order.create({ _id: orderId, tenantId: TENANT, number: 1, clientId: randomUUID(),
      channel: 'online', type: 'pickup', lines: [], totals: { subtotal: 1250, total: 1250 }, status: 'ready',
      payment: { method: 'online', status: 'paid', stripePaymentIntentId: INTENT, stripeAccountId: ACCOUNT,
        refundedCents: 250, pendingRefundCents: 0,
        refunds: [{ id: 're_journal_http', amountCents: 250, status: 'succeeded', operationId, reason }] },
      paymentFlow: { version: 1, origin: 'adopted_intent', phase: 'settled' },
      refundFlow: { version: 1, operations: [{ operationId, amountCents: 250, reason, actorId: OWNER,
        environment: 'test', paymentIntentId: INTENT, accountId: ACCOUNT,
        idempotencyKey: `order-refund:${orderId}:${operationId}`, preparedAt: new Date(), requestStartedAt: new Date(),
        state: 'known', refund: { id: 're_journal_http', amount: 250, currency: 'eur', payment_intent: INTENT,
          status: 'succeeded', metadata: { operationId, orderId, tenantId: TENANT, requestedBy: OWNER, reason } } }] } });
    vi.clearAllMocks(); commands = [];
  });

  afterEach(() => {
    expect(provider.refunds.list).not.toHaveBeenCalled(); expect(provider.refunds.create).not.toHaveBeenCalled();
    expect(provider.charges.retrieve).not.toHaveBeenCalled();
    expect(audit.log).not.toHaveBeenCalled(); expect(audit.logOnce).not.toHaveBeenCalled();
    expect(redis.publish).not.toHaveBeenCalled(); expect(unusedOrders.cancelAsOwner).not.toHaveBeenCalled();
  });
  afterAll(async () => {
    try { await app?.close(); }
    finally {
      if (db) {
        try { if (ownsDatabase) { await assertOwnDatabase(); await db.dropDatabase(); } }
        finally { await db.close(); }
      }
    }
  });

  const readOrder = () => models.Order.findById(orderId).select('+paymentFlow +refundFlow').lean();
  async function http(method: string, path: string, bearer?: string, body?: unknown) {
    const response = await fetch(`${origin}${path}`, { method,
      headers: { ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
        ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(5_000) });
    return { status: response.status, cacheControl: response.headers.get('cache-control'), body: await response.json() as unknown };
  }
  const journal = (bearer?: string) => http('GET', `/orders/${orderId}/refunds/journal`, bearer);
  function expectReadOnlyCommands() {
    expect(commands.length).toBeGreaterThan(0);
    expect(commands.every(command => command === 'find')).toBe(true);
  }

  it.each([true, false])('owner reçoit 200/no-store et un reçu réduit, activation %s, sans mutation', async (enabled) => {
    refundsEnabled = enabled;
    const before = await readOrder(); commands = [];
    const response = await journal(tokens.owner);
    expect(response.status).toBe(200); expect(response.cacheControl).toBe('private, no-store');
    const result = OrderRefundJournalSchema.parse(response.body);
    expect(result).toMatchObject({ orderId, enabled, summary: { refundedCents: 250, pendingRefundCents: 0, remainingCents: 1000 },
      operations: [{ operationId, state: 'known', providerStatus: 'succeeded', canResume: false }] });
    for (const secret of [ACCOUNT, INTENT, OWNER, passwordHash, 'idempotencyKey', 'metadata', 'paymentFlow', 'refundFlow']) {
      expect(JSON.stringify(result)).not.toContain(secret);
    }
    expectReadOnlyCommands(); expect(await readOrder()).toEqual(before);
  });

  it('anonyme reçoit 401 avant toute lecture du journal ou chargement du fournisseur', async () => {
    expect((await journal()).status).toBe(401);
    expect(commands).toEqual([]); expect(clientFactory).not.toHaveBeenCalled();
  });

  it.each(['staff', 'manager'] as const)('%s reçoit 403 malgré sa session réelle valide', async (role) => {
    const response = await journal(tokens[role]);
    expect(response.status).toBe(403); expectReadOnlyCommands(); expect(clientFactory).not.toHaveBeenCalled();
    expect(JSON.stringify(response.body)).not.toContain(operationId);
  });

  it('le propriétaire voisin reçoit 404 sans preuve du journal de l’autre tenant', async () => {
    const response = await journal(tokens.foreign);
    expect(response.status).toBe(404); expectReadOnlyCommands(); expect(clientFactory).not.toHaveBeenCalled();
    for (const value of [operationId, orderId, ACCOUNT, INTENT, 'Produit indisponible']) {
      expect(JSON.stringify(response.body)).not.toContain(value);
    }
  });

  it('une offre fidélité seule reçoit 403 commercial avec la même session propriétaire', async () => {
    await models.Tenant.updateOne({ _id: TENANT }, { $set: { onlineOrdering: false, standaloneLoyalty: true } });
    commands = [];
    const response = await journal(tokens.owner);
    expect(response.status).toBe(403);
    expect(response.body).toMatchObject({ code: CAPACITE_NON_SOUSCRITE_CODE });
    expectReadOnlyCommands(); expect(clientFactory).not.toHaveBeenCalled();
  });

  it('la révocation de la session ferme aussi cette nouvelle lecture', async () => {
    await models.User.updateOne({ _id: OWNER }, { $set: { sessionVersion: 'user-v2' } });
    commands = [];
    expect((await journal(tokens.owner)).status).toBe(401);
    expectReadOnlyCommands(); expect(clientFactory).not.toHaveBeenCalled();
  });

  it.each(['refunds', 'refunds/withdraw'])('POST %s refuse le mauvais mot de passe avant intention, fournisseur ou mutation', async (path) => {
    const before = await readOrder(); commands = [];
    const response = await http('POST', `/orders/${orderId}/${path}`, tokens.owner,
      { operationId: randomUUID(), amountCents: 100, reason: 'Seconde demande de recette', password: 'wrong-fixture-password' });
    expect(response.status).toBe(401);
    expect(response.body).toMatchObject({ message: 'Mot de passe incorrect.' });
    expectReadOnlyCommands(); expect(clientFactory).not.toHaveBeenCalled();
    expect(await readOrder()).toEqual(before);
  });
});
