import 'reflect-metadata';
import { randomBytes, randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { Module, type INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD, NestFactory, Reflector } from '@nestjs/core';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { getModelToken } from '@nestjs/mongoose';
import { ThrottlerModule } from '@nestjs/throttler';
import mongoose, { type Connection } from 'mongoose';
import { vi } from 'vitest';
import { MODELS } from '@sm/db';
import type { JwtPayload } from '@sm/contracts';
import { AuthGuard } from '../../common/auth';
import { CapaciteGuard, CapacitesService } from '../../common/capacites';
import { SessionAccessService } from '../../common/session-access';
import { SharedPublicQuota } from '../../common/shared-public-quota';
import { AuditService } from '../audit/audit.module';
import { recoveryProofHash } from '../orders/order-recovery';
import { OrdersController } from '../orders/orders.controller';
import { OrdersService } from '../orders/orders.service';
import { DeliveryAccessGuard } from './delivery-access.guard';
import { DeliveryAccessService } from './delivery-access.service';
import { DeliveryOperatorsService } from './delivery-operators.service';
import { DeliveryMissionsQuotaGuard } from './delivery-missions.quota';
import { DeliveryHandoffService } from './delivery-handoff.service';
import { DeliveryCourierHandoffController, DeliveryCustomerProofController, DeliveryHandoffController,
  DeliveryProofQuotaGuard } from './delivery-handoff.controller';

export const TENANT = '507f1f77bcf86cd799439011';
export const OTHER = '507f1f77bcf86cd799439012';
export const OWNER = '507f1f77bcf86cd799439021';
export const COGERANT = '507f1f77bcf86cd799439022';
export const FOREIGN = '507f1f77bcf86cd799439023';
export const CASHIER = '507f1f77bcf86cd799439031';
export const MANAGER = '507f1f77bcf86cd799439032';
export const KITCHEN = '507f1f77bcf86cd799439033';
export const DEVICE = '507f1f77bcf86cd799439041';

/** No credentials, replica-set discovery, shared database or remote host. */
export function deliveryHandoffHttpTestDatabase(raw: string): string {
  const url = new URL(raw);
  if (url.protocol !== 'mongodb:' || !['localhost', '127.0.0.1'].includes(url.hostname)
    || url.username || url.password || url.search || url.hash
    || !/^\/snackmanager_delivery_handoff_http_test_[a-z0-9_]{1,12}$/.test(url.pathname)) {
    throw new Error('DELIVERY_HANDOFF_HTTP_TEST_MONGO_URL doit cibler une base locale isolée snackmanager_delivery_handoff_http_test_, sans options.');
  }
  url.pathname += `_${randomUUID().replaceAll('-', '').slice(0, 10)}`;
  return url.toString();
}
function fixtureModels(db: Connection) {
  return {
    Tenant: db.model(MODELS.Tenant.name, MODELS.Tenant.schema, MODELS.Tenant.collection),
    User: db.model(MODELS.User.name, MODELS.User.schema, MODELS.User.collection),
    Staff: db.model(MODELS.Staff.name, MODELS.Staff.schema, MODELS.Staff.collection),
    Device: db.model(MODELS.Device.name, MODELS.Device.schema, MODELS.Device.collection),
    DeliveryOperator: db.model(MODELS.DeliveryOperator.name, MODELS.DeliveryOperator.schema, MODELS.DeliveryOperator.collection),
    Order: db.model(MODELS.Order.name, MODELS.Order.schema, MODELS.Order.collection),
    AuditLog: db.model(MODELS.AuditLog.name, MODELS.AuditLog.schema, MODELS.AuditLog.collection),
  };
}
export type HandoffFixtureModels = ReturnType<typeof fixtureModels>;

/** Real Nest guards/services and Mongo; external Redis publication/quota only are isolated. */
export async function createHandoffFixture(rawUri: string) {
  const uri = deliveryHandoffHttpTestDatabase(rawUri);
  let db: Connection | undefined;
  let models: HandoffFixtureModels;
  let app: INestApplication | undefined;
  let origin: string;
  let jwt: JwtService;
  let audit: AuditService;
  let tokens: Record<'owner' | 'cogerant' | 'foreign' | 'gerant' | 'caisse' | 'cuisine', string>;
  const quota = { reserve: vi.fn().mockResolvedValue(true), reserveClient: vi.fn().mockResolvedValue(true) };
  const redis = { publish: vi.fn().mockResolvedValue(1) };

  try {
    db = await mongoose.createConnection(uri, { serverSelectionTimeoutMS: 5_000, directConnection: true }).asPromise();
    models = fixtureModels(db);
    await Promise.all(Object.values(models).map(model => model.init()));
    audit = new AuditService(models.AuditLog, models.Staff, models.User);
    const constructors = [
      [DeliveryHandoffController, [DeliveryHandoffService]], [DeliveryCourierHandoffController, [DeliveryHandoffService]],
      [DeliveryCustomerProofController, [DeliveryHandoffService]], [OrdersController, [OrdersService]],
      [CapaciteGuard, [Reflector, CapacitesService]], [DeliveryAccessGuard, [DeliveryAccessService]],
      [DeliveryMissionsQuotaGuard, [SharedPublicQuota]], [DeliveryProofQuotaGuard, [SharedPublicQuota]],
    ] as const;
    for (const [controller, dependencies] of constructors) {
      if (!Reflect.hasOwnMetadata('design:paramtypes', controller)) Reflect.defineMetadata('design:paramtypes', [...dependencies], controller);
    }
    const config = new ConfigService({ DELIVERY_HANDOFF_KEY: randomBytes(32).toString('base64url') });
    class HandoffHttpFixtureModule {}
    Module({
      imports: [JwtModule.register({ secret: randomBytes(32).toString('base64url'), signOptions: { expiresIn: '5m' } }),
        ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 120 }])],
      controllers: [DeliveryHandoffController, DeliveryCourierHandoffController, DeliveryCustomerProofController, OrdersController],
      providers: [
        ...Object.entries(models).map(([name, model]) => ({ provide: getModelToken(name), useValue: model })),
        SessionAccessService, CapacitesService, DeliveryOperatorsService, DeliveryAccessService,
        { provide: AuditService, useValue: audit }, { provide: ConfigService, useValue: config },
        { provide: SharedPublicQuota, useValue: quota },
        { provide: DeliveryHandoffService, inject: [DeliveryAccessService],
          useFactory: (access: DeliveryAccessService) => new DeliveryHandoffService(models.Order, models.Tenant,
            access, audit, redis as never, config) },
        { provide: OrdersService, inject: [CapacitesService], useFactory: (capabilities: CapacitesService) =>
          new OrdersService(models.Order, {} as never, {} as never, {} as never, redis as never, audit,
            models.Tenant, capabilities, {} as never) },
        { provide: CapaciteGuard, inject: [Reflector, CapacitesService],
          useFactory: (reflector: Reflector, capabilities: CapacitesService) => new CapaciteGuard(reflector, capabilities) },
        { provide: DeliveryAccessGuard, inject: [DeliveryAccessService], useFactory: (access: DeliveryAccessService) => new DeliveryAccessGuard(access) },
        { provide: DeliveryMissionsQuotaGuard, useFactory: () => new DeliveryMissionsQuotaGuard(quota as never) },
        { provide: DeliveryProofQuotaGuard, useFactory: () => new DeliveryProofQuotaGuard(quota as never) },
        { provide: APP_GUARD, inject: [JwtService, Reflector, SessionAccessService],
          useFactory: (signer: JwtService, reflector: Reflector, sessions: SessionAccessService) => new AuthGuard(signer, reflector, sessions) },
      ],
    })(HandoffHttpFixtureModule);
    app = await NestFactory.create(HandoffHttpFixtureModule, { logger: false, abortOnError: false });
    await app.listen(0, '127.0.0.1');
    origin = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
    jwt = app.get(JwtService);
    await reset();
    return { app, origin, models, quota, redis, get tokens() { return tokens; }, http, seed, connect, reset, close };
  } catch (error) {
    await close();
    throw error;
  }

  function assertOwnedDatabase() {
    if (!db || db.name !== new URL(uri).pathname.slice(1)
      || !/^snackmanager_delivery_handoff_http_test_[a-z0-9_]+_[a-f0-9]{10}$/.test(db.name)) {
      throw new Error('Nettoyage refusé : base étrangère à la recette HTTP remise');
    }
  }

  async function reset() {
    assertOwnedDatabase();
    await Promise.all([models.Order.deleteMany({}), models.DeliveryOperator.deleteMany({}), models.Tenant.deleteMany({}),
      models.User.deleteMany({}), models.Staff.deleteMany({}), models.Device.deleteMany({})]);
    // Audit append-only : assertions bornées au targetId ; seul le drop possédé final le nettoie.
    quota.reserve.mockReset().mockResolvedValue(true); quota.reserveClient.mockReset().mockResolvedValue(true);
    redis.publish.mockClear();
    await models.Tenant.create([
      { _id: TENANT, slug: 'handoff-http', name: 'Restaurant HTTP', plan: null, onlineDelivery: true, account: { status: 'active' } },
      { _id: OTHER, slug: 'handoff-other', name: 'Autre restaurant HTTP', plan: null, onlineDelivery: true, account: { status: 'active' } },
    ]);
    await models.User.create([
      { _id: OWNER, name: 'Propriétaire HTTP', email: 'owner@handoff.invalid', passwordHash: 'fixture-only', role: 'owner', tenantId: TENANT, sessionVersion: 'user-v1' },
      { _id: COGERANT, name: 'Cogérant HTTP', email: 'cogerant@handoff.invalid', passwordHash: 'fixture-only', role: 'cogerant', tenantId: TENANT, sessionVersion: 'user-v1' },
      { _id: FOREIGN, email: 'other@handoff.invalid', passwordHash: 'fixture-only', role: 'owner', tenantId: OTHER, sessionVersion: 'user-v1' },
    ]);
    for (const [id, role] of [[CASHIER, 'caisse'], [MANAGER, 'gerant'], [KITCHEN, 'cuisine']] as const) {
      await models.Staff.create({ _id: id, tenantId: TENANT, name: `Équipier ${role} HTTP`, role,
        pinHash: 'fixture-only', active: true, sessionVersion: 'staff-v1' });
    }
    await models.Device.create({ _id: DEVICE, tenantId: TENANT, name: 'POS HTTP', kind: 'pos', paired: true,
      active: true, sessionVersion: 'device-v1' });
    const userToken = (sub: string, role: 'owner' | 'cogerant', tenantId = TENANT) => jwt.signAsync({
      sub, tenantId, role, kind: 'user', userSessionVersion: 'user-v1',
    } satisfies JwtPayload);
    const staffToken = (sub: string, role: 'gerant' | 'caisse' | 'cuisine') => jwt.signAsync({ sub, tenantId: TENANT, kind: 'staff', role,
      staffSessionVersion: 'staff-v1', deviceId: DEVICE, deviceSessionVersion: 'device-v1' } satisfies JwtPayload);
    tokens = { owner: await userToken(OWNER, 'owner'), cogerant: await userToken(COGERANT, 'cogerant'),
      foreign: await userToken(FOREIGN, 'owner', OTHER), gerant: await staffToken(MANAGER, 'gerant'),
      caisse: await staffToken(CASHIER, 'caisse'), cuisine: await staffToken(KITCHEN, 'cuisine') };
  }

  async function close() {
    try { await app?.close(); }
    finally { if (db) { try { assertOwnedDatabase(); await db.dropDatabase(); } finally { await db.close(); } } }
  }

  // Assertions ne journalisent ni bearer ni PIN/QR ni corps de requête.
  async function http(method: string, path: string, bearer?: string, body?: unknown) {
    const response = await fetch(`${origin}${path}`, { method,
      headers: { ...(bearer ? { authorization: `Bearer ${bearer}` } : {}), ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(5_000) });
    const text = await response.text();
    return { status: response.status, cache: response.headers.get('cache-control'), body: (text ? JSON.parse(text) : null) as unknown };
  }
  async function connect() {
    const directory = app!.get(DeliveryOperatorsService);
    const actor: JwtPayload = { sub: OWNER, tenantId: TENANT, kind: 'user', role: 'owner' };
    const operator = await directory.create(TENANT, { requestId: randomUUID(), name: 'Livreur HTTP' }, actor);
    const invitation = await directory.invitation(TENANT, operator.id, operator.revision, actor);
    const exchanged = await app!.get(DeliveryAccessService).exchange({ token: invitation.token, nonce: randomBytes(32).toString('base64url') });
    return { operator, token: exchanged.token };
  }
  async function seed(operatorId?: string, overrides: Record<string, unknown> = {}) {
    const clientId = randomUUID(); const recoveryProof = randomBytes(32).toString('hex');
    const row = await models.Order.create({ tenantId: TENANT, clientId, number: 1, channel: 'online', type: 'delivery', status: 'ready',
      lines: [{ productId: '507f1f77bcf86cd799439055', name: 'Article HTTP', qty: 1, unitPrice: 1250, lineTotal: 1250 }],
      totals: { subtotal: 1250, total: 1500, deliveryFee: 250 }, payment: { method: 'online', status: 'paid' },
      paymentFlow: { version: 1, origin: 'created_v1', phase: 'settled', attempt: null, close: null },
      pickup: { slot: new Date('2030-01-01T11:00:00Z'), customerName: 'Client privé fixture', customerPhone: '0600000000' },
      delivery: { address: { line1: 'Adresse privée fixture', postalCode: '75001', city: 'Paris', country: 'FR' },
        zoneId: 'fixture', zoneName: 'Recette', feeCents: 250, estimatedMinutes: 20, dispatchedAt: new Date() },
      deliveryMission: operatorId ? { version: 1, revision: 2, assignment: { operatorId, operatorName: 'Livreur HTTP', assignmentId: randomUUID(),
        assignedAt: new Date(), assignedBy: OWNER }, operations: [] } : null,
      publicRecovery: { version: 1, proofHash: recoveryProofHash(TENANT, clientId, recoveryProof), payloadHash: 'a'.repeat(64) },
      trackingToken: 'fixture-tracking-secret', ...overrides });
    return { id: String(row._id), clientId, recoveryProof };
  }
}
