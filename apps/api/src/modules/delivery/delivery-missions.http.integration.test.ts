import 'reflect-metadata';
import { randomBytes, randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { Controller, Get, Module, type INestApplication } from '@nestjs/common';
import { APP_GUARD, NestFactory, Reflector } from '@nestjs/core';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { getModelToken } from '@nestjs/mongoose';
import { ThrottlerModule } from '@nestjs/throttler';
import mongoose, { type Connection } from 'mongoose';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { MODELS } from '@sm/db';
import {
  DeliveryMissionResultSchema, DeliveryMissionsViewSchema, DeliveryMissionViewSchema,
  DeliveryOperatorInvitationSchema, DeliveryOperatorViewSchema, DeliveryOperatorsViewSchema,
  DeliverySessionViewSchema, type DeliveryOperatorView, type JwtPayload,
} from '@sm/contracts';
import { AuthGuard } from '../../common/auth';
import { CapaciteGuard, CapacitesService, Fonction } from '../../common/capacites';
import { SessionAccessService } from '../../common/session-access';
import { SharedPublicQuota } from '../../common/shared-public-quota';
import { AuditService } from '../audit/audit.module';
import { DeliveryAccessController } from './delivery-access.controller';
import { DeliveryAccessGuard } from './delivery-access.guard';
import { DeliveryAccessService } from './delivery-access.service';
import { DeliveryOperatorsController } from './delivery-operators.controller';
import { DeliveryOperatorsService } from './delivery-operators.service';
import { DeliveryCourierMissionsController, DeliveryMissionsController } from './delivery-missions.controller';
import { DeliveryMissionsService } from './delivery-missions.service';
import { DeliveryMissionsQuotaGuard } from './delivery-missions.quota';
import { DeliveryController } from './delivery.controller';
import { DeliveryService } from './delivery.service';

const TENANT = '507f1f77bcf86cd799439011';
const OTHER = '507f1f77bcf86cd799439012';
const OWNER = '507f1f77bcf86cd799439021';
const COGERANT = '507f1f77bcf86cd799439022';
const FOREIGN_OWNER = '507f1f77bcf86cd799439023';
const STAFF = '507f1f77bcf86cd799439031';
const DEVICE = '507f1f77bcf86cd799439041';

/** Chaque run possède une base jetable ; aucune cible métier ou distante. */
export function deliveryMissionHttpTestDatabase(raw: string): string {
  const url = new URL(raw);
  if (url.protocol !== 'mongodb:' || !['localhost', '127.0.0.1'].includes(url.hostname)
    || url.username || url.password || url.search || url.hash
    || !/^\/snackmanager_delivery_mission_http_test_[a-z0-9_]{1,12}$/.test(url.pathname)) {
    throw new Error('DELIVERY_MISSION_HTTP_TEST_MONGO_URL doit cibler une base locale isolée snackmanager_delivery_mission_http_test_, sans options.');
  }
  url.pathname += `_${randomUUID().replaceAll('-', '').slice(0, 10)}`;
  return url.toString();
}
const uri = process.env.DELIVERY_MISSION_HTTP_TEST_MONGO_URL
  ? deliveryMissionHttpTestDatabase(process.env.DELIVERY_MISSION_HTTP_TEST_MONGO_URL) : null;

@Controller('delivery-mission-http-fixture')
class AccessProbe {
  @Get('authenticated')
  authenticated() { return { authenticated: true }; }

  @Get('team')
  @Fonction('team')
  team() { return { team: true }; }
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
type FixtureModels = ReturnType<typeof fixtureModels>;

describe('cible de recette HTTP des missions', () => {
  it('refuse les cibles externes, métier, authentifiées ou munies d’options', () => {
    const authenticated = new URL('mongodb://localhost/snackmanager_delivery_mission_http_test_ci');
    authenticated.username = 'fixture'; authenticated.password = 'fixture';
    for (const raw of [
      'mongodb://remote.example/snackmanager_delivery_mission_http_test_ci', 'mongodb://localhost/snackmanager',
      'mongodb+srv://localhost/snackmanager_delivery_mission_http_test_ci', authenticated.toString(),
      'mongodb://localhost/snackmanager_delivery_mission_http_test_ci?replicaSet=anything',
      'mongodb://localhost/snackmanager_delivery_mission_http_test_ci#fragment',
    ]) expect(() => deliveryMissionHttpTestDatabase(raw)).toThrow();
  });
  it('alloue une base différente à chaque run', () => {
    const base = 'mongodb://127.0.0.1:27046/snackmanager_delivery_mission_http_test_local';
    expect(deliveryMissionHttpTestDatabase(base)).not.toBe(deliveryMissionHttpTestDatabase(base));
  });
});

(uri ? describe : describe.skip)('missions — vrais HTTP Nest, gardes et Mongo isolé', () => {
  let db: Connection;
  let models: FixtureModels;
  let app: INestApplication | undefined;
  let origin: string;
  let jwt: JwtService;
  let audit: AuditService;
  let tokens: { owner: string; cogerant: string; foreign: string; staff: string };
  const quota = { reserve: vi.fn().mockResolvedValue(true), reserveClient: vi.fn().mockResolvedValue(true) };
  const redis = { publish: vi.fn().mockResolvedValue(1) };

  beforeAll(async () => {
    db = await mongoose.createConnection(uri!, { serverSelectionTimeoutMS: 5_000, directConnection: true }).asPromise();
    models = fixtureModels(db);
    await Promise.all(Object.values(models).map(model => model.init()));
    audit = new AuditService(models.AuditLog, models.Staff, models.User);
    // esbuild n'émet pas design:paramtypes. Aucun guard n'est remplacé :
    // seules les métadonnées de leurs vrais constructeurs sont rétablies.
    const constructors = [
      [DeliveryOperatorsController, [DeliveryOperatorsService]],
      [DeliveryAccessController, [DeliveryAccessService, SharedPublicQuota]],
      [DeliveryMissionsController, [DeliveryMissionsService]],
      [DeliveryCourierMissionsController, [DeliveryMissionsService]],
      [DeliveryController, [DeliveryService]],
      [CapaciteGuard, [Reflector, CapacitesService]],
      [DeliveryAccessGuard, [DeliveryAccessService]],
      [DeliveryMissionsQuotaGuard, [SharedPublicQuota]],
    ] as const;
    for (const [controller, dependencies] of constructors) {
      if (!Reflect.hasOwnMetadata('design:paramtypes', controller)) {
        Reflect.defineMetadata('design:paramtypes', [...dependencies], controller);
      }
    }
    class MissionHttpFixtureModule {}
    Module({
      imports: [
        JwtModule.register({ secret: randomBytes(32).toString('base64url'), signOptions: { expiresIn: '5m' } }),
        ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 120 }]),
      ],
      controllers: [DeliveryOperatorsController, DeliveryAccessController, DeliveryMissionsController,
        DeliveryCourierMissionsController, DeliveryController, AccessProbe],
      providers: [
        ...Object.entries(models).map(([name, model]) => ({ provide: getModelToken(name), useValue: model })),
        SessionAccessService, CapacitesService, DeliveryOperatorsService, DeliveryAccessService,
        { provide: AuditService, useValue: audit },
        { provide: SharedPublicQuota, useValue: quota },
        { provide: DeliveryMissionsService, inject: [DeliveryAccessService],
          useFactory: (access: DeliveryAccessService) => new DeliveryMissionsService(models.Order, models.DeliveryOperator,
            models.Staff, models.Tenant, access, audit, redis as never) },
        // Seul dispatch legacy est exercé ; aucun accès produit/promotion.
        { provide: DeliveryService, useFactory: () => new DeliveryService(models.Tenant, {} as never,
          models.Order, audit, redis as never, {} as never) },
        { provide: CapaciteGuard, inject: [Reflector, CapacitesService],
          useFactory: (reflector: Reflector, capabilities: CapacitesService) => new CapaciteGuard(reflector, capabilities) },
        { provide: DeliveryAccessGuard, inject: [DeliveryAccessService],
          useFactory: (access: DeliveryAccessService) => new DeliveryAccessGuard(access) },
        { provide: DeliveryMissionsQuotaGuard, useFactory: () => new DeliveryMissionsQuotaGuard(quota as never) },
        { provide: APP_GUARD, inject: [JwtService, Reflector, SessionAccessService],
          useFactory: (signer: JwtService, reflector: Reflector, sessions: SessionAccessService) => new AuthGuard(signer, reflector, sessions) },
      ],
    })(MissionHttpFixtureModule);
    app = await NestFactory.create(MissionHttpFixtureModule, { logger: false, abortOnError: false });
    await app.listen(0, '127.0.0.1');
    const address = app.getHttpServer().address() as AddressInfo;
    origin = `http://127.0.0.1:${address.port}`;
    jwt = app.get(JwtService);
  }, 15_000);

  function assertOwnDatabase() {
    if (!uri || db.name !== new URL(uri).pathname.slice(1)
      || !/^snackmanager_delivery_mission_http_test_[a-z0-9_]+_[a-f0-9]{10}$/.test(db.name)) {
      throw new Error('Nettoyage refusé : base étrangère à la recette HTTP missions');
    }
  }
  beforeEach(async () => {
    assertOwnDatabase();
    await Promise.all([models.Tenant.deleteMany({}), models.User.deleteMany({}), models.Staff.deleteMany({}),
      models.Device.deleteMany({}), models.DeliveryOperator.deleteMany({}), models.Order.deleteMany({})]);
    // AuditLog reste append-only entre cas. Chaque assertion est bornée au
    // targetId unique ; seul le drop final de la base jetable le nettoie.
    quota.reserve.mockReset().mockResolvedValue(true); quota.reserveClient.mockReset().mockResolvedValue(true);
    redis.publish.mockClear();
    await models.Tenant.create([
      { _id: TENANT, slug: 'mission-http-fixture', name: 'Restaurant HTTP de recette', plan: null, onlineDelivery: true, account: { status: 'active' } },
      { _id: OTHER, slug: 'mission-http-other', name: 'Autre restaurant de recette', plan: null, onlineDelivery: true, account: { status: 'active' } },
    ]);
    await models.User.create([
      { _id: OWNER, name: 'Propriétaire HTTP', email: 'owner@mission-http.invalid', passwordHash: 'fixture-only', role: 'owner', tenantId: TENANT, sessionVersion: 'user-v1' },
      { _id: COGERANT, name: 'Cogérant HTTP', email: 'cogerant@mission-http.invalid', passwordHash: 'fixture-only', role: 'cogerant', tenantId: TENANT, sessionVersion: 'user-v1' },
      { _id: FOREIGN_OWNER, email: 'other@mission-http.invalid', passwordHash: 'fixture-only', role: 'owner', tenantId: OTHER, sessionVersion: 'user-v1' },
    ]);
    await models.Staff.create({ _id: STAFF, tenantId: TENANT, name: 'Équipier HTTP', role: 'caisse',
      pinHash: 'fixture-pin-only', active: true, sessionVersion: 'staff-v1' });
    await models.Device.create({ _id: DEVICE, tenantId: TENANT, name: 'POS HTTP', kind: 'pos', paired: true,
      active: true, sessionVersion: 'device-v1' });
    const userToken = (sub: string, role: 'owner' | 'cogerant', tenantId = TENANT) => jwt.signAsync({
      sub, tenantId, role, kind: 'user', userSessionVersion: 'user-v1',
    } satisfies JwtPayload);
    tokens = {
      owner: await userToken(OWNER, 'owner'), cogerant: await userToken(COGERANT, 'cogerant'),
      foreign: await userToken(FOREIGN_OWNER, 'owner', OTHER),
      staff: await jwt.signAsync({ sub: STAFF, tenantId: TENANT, kind: 'staff', role: 'caisse',
        staffSessionVersion: 'staff-v1', deviceId: DEVICE, deviceSessionVersion: 'device-v1' } satisfies JwtPayload),
    };
  });
  afterEach(() => { vi.restoreAllMocks(); });
  afterAll(async () => {
    try { await app?.close(); }
    finally {
      if (db) {
        try { assertOwnDatabase(); await db.dropDatabase(); }
        finally { await db.close(); }
      }
    }
  });

  // Aucun bearer ni corps de requête n'est journalisé, même lors d'un échec.
  async function http(method: string, path: string, bearer?: string, body?: unknown, version?: string) {
    const response = await fetch(`${origin}${path}`, {
      method, headers: { ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        ...(version === undefined ? {} : { 'X-SM-Delivery-View': version }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(5_000),
    });
    const text = await response.text();
    return { status: response.status, cacheControl: response.headers.get('cache-control'),
      body: (text ? JSON.parse(text) : null) as unknown };
  }
  async function createOperator(bearer = tokens.owner) {
    const response = await http('POST', '/delivery/operators', bearer,
      { requestId: randomUUID(), name: 'Livreur de recette HTTP' });
    expect(response.status).toBe(201);
    return DeliveryOperatorViewSchema.parse(response.body);
  }
  async function connect() {
    const operator = await createOperator();
    const invited = await http('POST', `/delivery/operators/${operator.id}/invitation`, tokens.owner, { expectedRevision: operator.revision });
    expect(invited.status).toBe(200);
    const invitation = DeliveryOperatorInvitationSchema.parse(invited.body);
    const exchanged = await http('POST', '/delivery-access/exchange', undefined,
      { token: invitation.token, nonce: randomBytes(32).toString('base64url') });
    expect(exchanged.status).toBe(200);
    const body = exchanged.body as { token: string; session: unknown };
    expect(typeof body.token === 'string' && /^[A-Za-z0-9_-]{43}$/.test(body.token)).toBe(true);
    DeliverySessionViewSchema.parse(body.session);
    const list = await http('GET', '/delivery/operators', tokens.owner);
    expect(list.status).toBe(200);
    const current = DeliveryOperatorsViewSchema.parse(list.body).operators.find(row => row.id === operator.id)!;
    return { operator: current, token: body.token };
  }
  async function seed(overrides: Record<string, unknown> = {}) {
    const row = await models.Order.create({ tenantId: TENANT, number: 1, clientId: randomUUID(), channel: 'online', type: 'delivery',
      status: 'ready', lines: [{ productId: '507f1f77bcf86cd799439055', name: 'Article HTTP', qty: 1, unitPrice: 1250, lineTotal: 1250 }],
      totals: { subtotal: 1250, total: 1500, deliveryFee: 250 }, payment: { method: 'online', status: 'paid' },
      paymentFlow: { version: 1, origin: 'created_v1', phase: 'settled', attempt: null, close: null },
      pickup: { slot: new Date('2030-01-01T11:00:00Z'), customerName: 'Destinataire fixture', customerPhone: '0600000000' },
      delivery: { address: { line1: '1 rue de recette', postalCode: '75001', city: 'Paris', country: 'FR' },
        instructions: 'Entrée de recette', zoneId: 'fixture', zoneName: 'Recette', feeCents: 250, estimatedMinutes: 20 },
      trackingToken: 'fixture-tracking-secret', meta: { secret: 'fixture-private-meta' }, ...overrides });
    return String(row._id);
  }
  const stored = (id: string) => models.Order.findById(id).select('+deliveryMission +paymentFlow').lean();
  const assignBody = (operator: DeliveryOperatorView, expectedRevision = 0) => ({
    operationId: randomUUID(), expectedRevision, operatorId: operator.id,
    expectedOperatorRevision: operator.revision, reason: 'Affectation de recette HTTP',
  });
  async function assign(id: string, operator: DeliveryOperatorView, bearer = tokens.owner) {
    const response = await http('POST', `/delivery/missions/${id}/assignment`, bearer, assignBody(operator));
    expect(response.status).toBe(200);
    expect(response.cacheControl).toBe('private, no-store');
    const result = DeliveryMissionResultSchema.parse(response.body);
    expect(result.outcome).toBe('applied');
    return result;
  }
  function expectPrivate(body: unknown) {
    expect(/trackingToken|fixture-tracking|stripe|paymentFlow|totals|fixture-private|operations|fingerprint|assignedBy|tenantId|sessionVersion/.test(JSON.stringify(body))).toBe(false);
  }

  it.each([undefined, '2', '3', '2, 2'])('négocie listes, détails et mutations imbriquées manager/livreur : version %s', async version => {
    const connected = await connect();
    const managerId = await seed(); const courierId = await seed();
    const legacy = DeliveryMissionViewSchema.omit({ deliveredAt: true, paymentSummary: true }).strict();
    const assertView = (body: unknown) => {
      if (version === '2') {
        expect(DeliveryMissionViewSchema.parse(body)).toMatchObject({ deliveredAt: null,
          paymentSummary: { totalCents: 1500, method: 'online', status: 'paid' } });
        expect(legacy.safeParse(body).success).toBe(false);
      } else {
        expect(legacy.safeParse(body).success).toBe(true);
        expect(body).not.toHaveProperty('deliveredAt'); expect(body).not.toHaveProperty('paymentSummary');
      }
      expectPrivate(body);
    };
    for (const id of [managerId, courierId]) {
      const input = assignBody(connected.operator);
      const assigned = await http('POST', `/delivery/missions/${id}/assignment`, tokens.owner, input, version);
      expect(assigned.status).toBe(200);
      const result = DeliveryMissionResultSchema.parse(assigned.body);
      expect(result).toMatchObject({ operationId: input.operationId, outcome: 'applied', appliedRevision: 1 });
      assertView(result.mission);
    }
    for (const [base, token] of [['/delivery/missions', tokens.owner], ['/delivery-access/missions', connected.token]]) {
      const list = await http('GET', base!, token, undefined, version);
      expect(list.status).toBe(200);
      const page = DeliveryMissionsViewSchema.parse(list.body);
      expect(page.missions).toHaveLength(2); page.missions.forEach(assertView);
      expect(page.nextCursor).toBeNull();
      const detail = await http('GET', `${base}/${courierId}`, token, undefined, version);
      expect(detail.status).toBe(200); assertView(detail.body);
    }
    for (const [path, token] of [[`/delivery/missions/${managerId}/dispatch`, tokens.owner],
      [`/delivery-access/missions/${courierId}/dispatch`, connected.token]]) {
      const input = { operationId: randomUUID(), expectedRevision: 1 };
      const dispatched = await http('POST', path!, token, input, version);
      expect(dispatched.status).toBe(200);
      const result = DeliveryMissionResultSchema.parse(dispatched.body);
      expect(result).toMatchObject({ operationId: input.operationId, outcome: 'applied', appliedRevision: 2, replay: false });
      assertView(result.mission);
      const replayed = await http('POST', path!, token, input, version);
      expect(replayed.status).toBe(200);
      const replay = DeliveryMissionResultSchema.parse(replayed.body);
      expect(replay).toMatchObject({ operationId: input.operationId, outcome: 'applied', appliedRevision: 2, replay: true });
      assertView(replay.mission);
      const refusedInput = { operationId: randomUUID(), expectedRevision: 2 };
      const refused = await http('POST', path!, token, refusedInput, version);
      expect(refused.status).toBe(200);
      const refusal = DeliveryMissionResultSchema.parse(refused.body);
      expect(refusal).toMatchObject({ operationId: refusedInput.operationId, outcome: 'rejected',
        refusalCode: 'delivery.mission.departed', appliedRevision: 3, replay: false });
      assertView(refusal.mission);
    }
  });

  it('owner et cogérant affectent avec delivery seul, sans RH ; tenant et sessions restent vérifiés', async () => {
    for (const token of [tokens.owner, tokens.cogerant]) {
      expect((await http('GET', '/delivery-mission-http-fixture/team', token)).status).toBe(403);
      const id = await seed(); const operator = await createOperator(token);
      const result = await assign(id, operator, token);
      expect(result.mission).toMatchObject({ id, revision: 1, orderStatus: 'ready', dispatchedAt: null });
      expectPrivate(result);
      expect((await http('GET', `/delivery/missions/${id}`, tokens.foreign)).status).toBe(404);
      expect((await http('POST', `/delivery/missions/${id}/assignment`, tokens.foreign, assignBody(operator, 1))).status).toBe(404);
    }
    expect((await http('GET', '/delivery/missions')).status).toBe(401);
    const listing = await http('GET', '/delivery/missions', tokens.owner);
    expect(listing.status).toBe(200); expect(listing.cacheControl).toBe('private, no-store');
    expect(DeliveryMissionsViewSchema.parse(listing.body).missions).toHaveLength(2); expectPrivate(listing.body);
    await models.Tenant.updateOne({ _id: TENANT }, { $set: { onlineDelivery: false } });
    expect((await http('GET', '/delivery/missions', tokens.owner)).status).toBe(403);
    await models.Tenant.updateOne({ _id: TENANT }, { $set: { onlineDelivery: true } });
    await models.User.updateOne({ _id: OWNER }, { $set: { sessionVersion: 'user-v2' } });
    expect((await http('GET', '/delivery/missions', tokens.owner)).status).toBe(401);
  });

  it('la caisse lit et confirme un départ, sans affecter ; le chemin legacy est fermé', async () => {
    const id = await seed(); const operator = await createOperator();
    expect((await http('POST', `/delivery/missions/${id}/assignment`, tokens.staff, assignBody(operator))).status).toBe(403);
    expect((await stored(id))?.deliveryMission).toBeNull();
    await assign(id, operator);
    const detail = await http('GET', `/delivery/missions/${id}`, tokens.staff);
    expect(detail.status).toBe(200);
    expect(DeliveryMissionViewSchema.parse(detail.body)).toMatchObject({ canAssign: false, canDispatch: true });
    const legacy = await http('POST', `/orders/${id}/dispatch`, tokens.staff, {});
    expect(legacy.status).toBe(409); expect(legacy.body).toMatchObject({ code: 'DELIVERY_MISSION_REQUIRED' });
    const response = await http('POST', `/delivery/missions/${id}/dispatch`, tokens.staff,
      { operationId: randomUUID(), expectedRevision: 1 });
    expect(response.status).toBe(200); expect(response.cacheControl).toBe('private, no-store');
    expect(DeliveryMissionResultSchema.parse(response.body)).toMatchObject({ outcome: 'applied', refusalCode: null,
      appliedRevision: 2, mission: { orderStatus: 'ready', canDispatch: false } });
    const row = await stored(id);
    expect(row?.delivery?.dispatchedAt).toBeInstanceOf(Date); expect(row?.delivery?.deliveredAt).toBeNull();
    expect((await http('POST', `/orders/${id}/dispatch`, tokens.staff, {})).status).toBe(409);
  });

  it('le bearer opaque ne voit que ses missions et ne devient jamais une session gérant ou caisse', async () => {
    const connected = await connect(); const own = await seed(); const unassigned = await seed();
    const foreign = await seed({ tenantId: OTHER }); const other = await seed();
    await assign(own, connected.operator); await assign(other, await createOperator());
    const listing = await http('GET', '/delivery-access/missions', connected.token);
    expect(listing.status).toBe(200); expect(listing.cacheControl).toBe('private, no-store');
    expect(DeliveryMissionsViewSchema.parse(listing.body).missions.map(row => row.id)).toEqual([own]);
    expectPrivate(listing.body);
    for (const id of [unassigned, foreign, other]) {
      expect((await http('GET', `/delivery-access/missions/${id}`, connected.token)).status).toBe(404);
      expect((await http('POST', `/delivery-access/missions/${id}/dispatch`, connected.token,
        { operationId: randomUUID(), expectedRevision: 0 })).status).toBe(404);
    }
    for (const path of ['/delivery/missions', '/delivery/operators', '/delivery-mission-http-fixture/authenticated']) {
      expect((await http('GET', path, connected.token)).status).toBe(401);
    }
    expect((await http('POST', `/delivery/missions/${own}/assignment`, connected.token, assignBody(connected.operator, 1))).status).toBe(401);
    for (const token of [tokens.owner, tokens.staff]) {
      expect((await http('GET', '/delivery-access/missions', token)).status).toBe(401);
      expect((await http('POST', `/delivery-access/missions/${own}/dispatch`, token,
        { operationId: randomUUID(), expectedRevision: 1 })).status).toBe(401);
    }
    const response = await http('POST', `/delivery-access/missions/${own}/dispatch`, connected.token,
      { operationId: randomUUID(), expectedRevision: 1 });
    expect(response.status).toBe(200);
    expect(DeliveryMissionResultSchema.parse(response.body)).toMatchObject({ outcome: 'applied', mission: { orderStatus: 'ready' } });
    expect((await stored(own))?.delivery?.deliveredAt).toBeNull(); expectPrivate(response.body);
  });

  it('les DTO HTTP stricts refusent corps et requêtes ambigus avant toute opération', async () => {
    const connected = await connect(); const id = await seed(); await assign(id, connected.operator);
    for (const body of [
      { operationId: randomUUID(), expectedRevision: 1, tenantId: OTHER },
      { operationId: 'invalid', expectedRevision: 1 }, { operationId: randomUUID(), expectedRevision: -1 },
      { operationId: randomUUID(), expectedRevision: '1' }, { operationId: randomUUID() },
    ]) {
      for (const [path, token] of [[`/delivery/missions/${id}/dispatch`, tokens.owner],
        [`/delivery-access/missions/${id}/dispatch`, connected.token]]) {
        const response = await http('POST', path!, token, body);
        expect(response.status).toBe(400);
        // Zod peut nommer une clé interdite, jamais réfléchir sa valeur ni
        // la commande chargée en base (aucun service métier n'est appelé).
        expect(/fixture-tracking|fixture-private|fixture-pin/.test(JSON.stringify(response.body))).toBe(false);
        expect(JSON.stringify(response.body).includes(OTHER)).toBe(false);
        expect(JSON.stringify(response.body).includes(connected.token)).toBe(false);
      }
    }
    for (const query of [`?after=${id}&after=${id}`, '?after=invalid', '?tenantId=anything']) {
      expect((await http('GET', `/delivery/missions${query}`, tokens.owner)).status).toBe(400);
      expect((await http('GET', `/delivery-access/missions${query}`, connected.token)).status).toBe(400);
    }
    expect((await http('POST', `/delivery/missions/${id}/assignment`, tokens.owner,
      { ...assignBody(connected.operator, 1), operatorId: null })).status).toBe(400);
    expect((await stored(id))?.deliveryMission?.operations).toHaveLength(1);
    expect((await stored(id))?.delivery?.dispatchedAt).toBeNull();
  });

  it('une révocation HTTP interdit immédiatement les nouvelles lectures et départs', async () => {
    const connected = await connect(); const id = await seed(); await assign(id, connected.operator);
    const revoked = await http('PATCH', `/delivery/operators/${connected.operator.id}`, tokens.cogerant,
      { expectedRevision: connected.operator.revision, active: false });
    expect(revoked.status).toBe(200);
    for (const path of ['/delivery-access/missions', `/delivery-access/missions/${id}`]) {
      expect((await http('GET', path, connected.token)).status).toBe(401);
    }
    expect((await http('POST', `/delivery-access/missions/${id}/dispatch`, connected.token,
      { operationId: randomUUID(), expectedRevision: 1 })).status).toBe(401);
    expect((await stored(id))?.deliveryMission?.operations).toHaveLength(1);
    expect((await stored(id))?.delivery?.dispatchedAt).toBeNull();
    expect((await http('GET', `/delivery/missions/${id}`, tokens.staff)).status).toBe(200);
  });

  it('un refus 200 est durable : même UUID rejeté après préparation, nouvel UUID obsolète en conflit', async () => {
    const connected = await connect(); const id = await seed({ status: 'preparing' }); await assign(id, connected.operator);
    const input = { operationId: randomUUID(), expectedRevision: 1 };
    const endpoint = `/delivery-access/missions/${id}/dispatch`;
    redis.publish.mockClear();
    const response = await http('POST', endpoint, connected.token, input);
    expect(response.status).toBe(200); expect(response.cacheControl).toBe('private, no-store');
    expect(DeliveryMissionResultSchema.parse(response.body)).toMatchObject({ operationId: input.operationId,
      outcome: 'rejected', refusalCode: 'delivery.mission.not_ready', replay: false, appliedRevision: 2 });
    expect(await models.AuditLog.countDocuments({ targetId: id })).toBe(1);
    expect(await models.AuditLog.countDocuments({ targetId: id, action: 'order.dispatch' })).toBe(0);
    expect(redis.publish).not.toHaveBeenCalled();
    await models.Order.updateOne({ _id: id }, { $set: { status: 'ready' }, $inc: { __v: 1 } });
    const replay = await http('POST', endpoint, connected.token, input);
    expect(replay.status).toBe(200);
    expect(DeliveryMissionResultSchema.parse(replay.body)).toMatchObject({ outcome: 'rejected', replay: true,
      refusalCode: 'delivery.mission.not_ready', mission: { canDispatch: true, revision: 2, dispatchedAt: null } });
    const changed = await http('POST', endpoint, connected.token, { ...input, operationId: randomUUID() });
    expect(changed.status).toBe(409); expect(changed.body).toMatchObject({ code: 'DELIVERY_MISSION_CHANGED' });
    const conflict = await http('POST', endpoint, connected.token, { ...input, expectedRevision: 2 });
    expect(conflict.status).toBe(409); expect(conflict.body).toMatchObject({ code: 'DELIVERY_MISSION_OPERATION_CONFLICT' });
    expect((await stored(id))?.deliveryMission?.operations).toHaveLength(2);
    expect((await stored(id))?.delivery?.dispatchedAt).toBeNull();
    expect(await models.AuditLog.countDocuments({ targetId: id })).toBe(1);
    const applied = await http('POST', endpoint, connected.token, { operationId: randomUUID(), expectedRevision: 2 });
    expect(applied.status).toBe(200);
    expect(DeliveryMissionResultSchema.parse(applied.body)).toMatchObject({ outcome: 'applied', refusalCode: null, appliedRevision: 3 });
    expect((await stored(id))?.status).toBe('ready'); expect((await stored(id))?.delivery?.deliveredAt).toBeNull();
  });

  it('le vrai audit persiste les auteurs exacts et aucun rejeu ne réécrit ni ne duplique leurs lignes', async () => {
    const connected = await connect(); const id = await seed();
    const assignment = assignBody(connected.operator);
    const assignmentPath = `/delivery/missions/${id}/assignment`;
    const assigned = await http('POST', assignmentPath, tokens.cogerant, assignment);
    expect(assigned.status).toBe(200);
    expect(DeliveryMissionResultSchema.parse(assigned.body)).toMatchObject({ outcome: 'applied', replay: false, appliedRevision: 1 });
    const assignedLog = await models.AuditLog.findOne({ tenantId: TENANT, targetId: id, action: 'order.assign' }).lean();
    expect(assignedLog?.author).toEqual({ id: COGERANT, name: 'Cogérant HTTP', role: 'cogerant', means: 'password' });
    expect(assignedLog?.meta).toMatchObject({ operationId: assignment.operationId, revision: 1, action: 'assign',
      actorKind: 'user', actorId: COGERANT, reason: assignment.reason, operatorId: connected.operator.id });
    expect(assignedLog?.deduplication?.fingerprint).toMatch(/^[a-f0-9]{64}$/);

    // Le nom historique n'est pas résolu à nouveau lors d'une reprise.
    await models.User.updateOne({ _id: COGERANT }, { $set: { name: 'Nom changé après le geste' } });
    const assignedReplay = await http('POST', assignmentPath, tokens.cogerant, assignment);
    expect(assignedReplay.status).toBe(200);
    expect(DeliveryMissionResultSchema.parse(assignedReplay.body)).toMatchObject({ outcome: 'applied', replay: true, appliedRevision: 1 });
    expect(await models.AuditLog.countDocuments({ tenantId: TENANT, targetId: id })).toBe(1);
    expect(await models.AuditLog.findById(assignedLog!._id).lean()).toEqual(assignedLog);

    const departure = { operationId: randomUUID(), expectedRevision: 1 };
    const departurePath = `/delivery-access/missions/${id}/dispatch`;
    const departed = await http('POST', departurePath, connected.token, departure);
    expect(departed.status).toBe(200);
    expect(DeliveryMissionResultSchema.parse(departed.body)).toMatchObject({ outcome: 'applied', replay: false, appliedRevision: 2 });
    const departedLog = await models.AuditLog.findOne({ tenantId: TENANT, targetId: id, action: 'order.dispatch' }).lean();
    expect(departedLog?.author).toEqual({ id: connected.operator.id, name: connected.operator.name,
      role: 'livreur', means: 'delivery_access' });
    expect(departedLog?.meta).toMatchObject({ operationId: departure.operationId, revision: 2,
      action: 'dispatch', actorKind: 'delivery', actorId: connected.operator.id, operatorId: connected.operator.id });
    const retries = await Promise.all([http('POST', departurePath, connected.token, departure),
      http('POST', departurePath, connected.token, departure)]);
    for (const retry of retries) {
      expect(retry.status).toBe(200);
      expect(DeliveryMissionResultSchema.parse(retry.body)).toMatchObject({ outcome: 'applied', replay: true, appliedRevision: 2 });
    }
    expect(await models.AuditLog.countDocuments({ tenantId: TENANT, targetId: id })).toBe(2);
    expect(await models.AuditLog.findById(departedLog!._id).lean()).toEqual(departedLog);
    expect((await stored(id))?.deliveryMission?.operations).toHaveLength(2);
  });

  it('les quotas partagés passent avant l’authentification DB, avec empreinte et panne fermée', async () => {
    const connected = await connect();
    const authenticate = vi.spyOn(app!.get(DeliveryAccessService), 'authenticate');
    quota.reserve.mockReset().mockResolvedValue(false); quota.reserveClient.mockClear();
    expect((await http('GET', '/delivery-access/missions', connected.token)).status).toBe(429);
    expect(authenticate).not.toHaveBeenCalled(); expect(quota.reserveClient).not.toHaveBeenCalled();
    quota.reserve.mockRejectedValueOnce(new Error('Redis fixture indisponible'));
    expect((await http('GET', '/delivery-access/missions', connected.token)).status).toBe(503);
    expect(authenticate).not.toHaveBeenCalled();
    quota.reserve.mockResolvedValue(true); quota.reserveClient.mockResolvedValue(false);
    expect((await http('GET', '/delivery-access/missions', connected.token)).status).toBe(429);
    expect(authenticate).not.toHaveBeenCalled();
    const reserved = quota.reserveClient.mock.calls[0]?.[0] as { clientKey: string; scope: string };
    expect(reserved.scope).toBe('delivery-missions-read');
    expect(/^[a-f0-9]{64}$/.test(reserved.clientKey)).toBe(true);
    expect(reserved.clientKey.includes(connected.token)).toBe(false);
    quota.reserveClient.mockClear();
    expect((await http('POST', `/delivery-access/missions/${TENANT}/dispatch`, connected.token,
      { operationId: randomUUID(), expectedRevision: 0 })).status).toBe(429);
    expect(authenticate).not.toHaveBeenCalled();
    expect(quota.reserveClient.mock.calls[0]?.[0]).toMatchObject({ scope: 'delivery-missions-write', clientLimit: 30 });
    quota.reserveClient.mockResolvedValue(true);
    const response = await http('GET', '/delivery-access/missions', connected.token);
    expect(response.status).toBe(200); expect(authenticate).toHaveBeenCalledTimes(1);
  });
});
