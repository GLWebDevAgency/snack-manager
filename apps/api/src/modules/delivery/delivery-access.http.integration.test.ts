import 'reflect-metadata';
import { randomBytes, randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { Controller, Get, Module, type INestApplication } from '@nestjs/common';
import { APP_GUARD, NestFactory, Reflector } from '@nestjs/core';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { getModelToken } from '@nestjs/mongoose';
import { ThrottlerModule } from '@nestjs/throttler';
import mongoose, { type Connection } from 'mongoose';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { MODELS } from '@sm/db';
import {
  DeliveryOperatorInvitationSchema, DeliveryOperatorViewSchema,
  DeliveryOperatorsViewSchema, DeliverySessionViewSchema, type JwtPayload,
} from '@sm/contracts';
import { AuthGuard } from '../../common/auth';
import { CapaciteGuard, CapacitesService, Fonction } from '../../common/capacites';
import { SessionAccessService } from '../../common/session-access';
import { SharedPublicQuota } from '../../common/shared-public-quota';
import { DeliveryAccessController } from './delivery-access.controller';
import { DeliveryAccessGuard } from './delivery-access.guard';
import { DeliveryAccessService } from './delivery-access.service';
import { DeliveryOperatorsController } from './delivery-operators.controller';
import { DeliveryOperatorsService } from './delivery-operators.service';

const TENANT = '507f1f77bcf86cd799439011';
const OTHER = '507f1f77bcf86cd799439012';
const OWNER = '507f1f77bcf86cd799439021';
const COGERANT = '507f1f77bcf86cd799439022';
const FOREIGN_OWNER = '507f1f77bcf86cd799439023';
const STAFF = '507f1f77bcf86cd799439031';
const DEVICE = '507f1f77bcf86cd799439041';
const PRIVATE = '+invite +session +history +sessionVersion +staffSessionVersion';

/** Aucun URI fourni ne peut désigner une base métier, même sur localhost. */
export function deliveryHttpTestDatabase(raw: string): string {
  const url = new URL(raw);
  if (url.protocol !== 'mongodb:' || !['localhost', '127.0.0.1'].includes(url.hostname)
    || url.username || url.password || url.search || url.hash
    || !/^\/snackmanager_delivery_http_test_[a-z0-9_]{1,20}$/i.test(url.pathname)) {
    throw new Error('DELIVERY_OPERATOR_HTTP_TEST_MONGO_URL doit cibler une base locale isolée snackmanager_delivery_http_test_, sans options.');
  }
  url.pathname += `_${randomUUID().replaceAll('-', '').slice(0, 10)}`;
  return url.toString();
}
const uri = process.env.DELIVERY_OPERATOR_HTTP_TEST_MONGO_URL
  ? deliveryHttpTestDatabase(process.env.DELIVERY_OPERATOR_HTTP_TEST_MONGO_URL) : null;

/** Ces sondes n'ont aucun service métier : elles prouvent aussi qu'une route
 * JWT SANS @Roles ne devient pas accessible au bearer opaque et que delivery
 * n'ouvre pas la capacité team. Les vraies routes livreur restent inchangées. */
@Controller('delivery-http-fixture')
class GeneralAccessProbe {
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
  };
}
type FixtureModels = ReturnType<typeof fixtureModels>;

describe('cible de la recette HTTP livreur', () => {
  it('refuse toute cible externe, métier, authentifiée ou munie d’options', () => {
    const authenticatedTarget = new URL('mongodb://localhost/snackmanager_delivery_http_test_ci');
    authenticatedTarget.username = 'fixture';
    authenticatedTarget.password = 'fixture';
    for (const raw of [
      'mongodb://remote.example/snackmanager_delivery_http_test_ci', 'mongodb://localhost/snackmanager',
      'mongodb+srv://localhost/snackmanager_delivery_http_test_ci',
      authenticatedTarget.toString(),
      'mongodb://localhost/snackmanager_delivery_http_test_ci?replicaSet=anything',
      'mongodb://localhost/snackmanager_delivery_http_test_ci#fragment',
    ]) expect(() => deliveryHttpTestDatabase(raw)).toThrow();
  });
  it('alloue une base suffixée propre à chaque run', () => {
    const base = 'mongodb://127.0.0.1:27046/snackmanager_delivery_http_test_local';
    expect(deliveryHttpTestDatabase(base)).not.toBe(deliveryHttpTestDatabase(base));
  });
});

(uri ? describe : describe.skip)('accès livreur — HTTP Nest réel et Mongo isolé', () => {
  let db: Connection;
  let models: FixtureModels;
  let app: INestApplication | undefined;
  let origin: string;
  let jwt: JwtService;
  let tokens: { owner: string; cogerant: string; foreign: string; staff: string };
  const quota = { reserve: vi.fn().mockResolvedValue(true), reserveClient: vi.fn().mockResolvedValue(true) };

  beforeAll(async () => {
    db = await mongoose.createConnection(uri!, { serverSelectionTimeoutMS: 5_000 }).asPromise();
    models = fixtureModels(db);
    await Promise.all(Object.values(models).map(model => model.init()));

    // Vitest/esbuild conserve les décorateurs explicites, pas les métadonnées
    // design:paramtypes émises par tsc en production. Le fixture ne réécrit
    // aucune garde : il renseigne seulement leurs constructeurs réels.
    const constructors = [
      [DeliveryOperatorsController, [DeliveryOperatorsService]],
      [DeliveryAccessController, [DeliveryAccessService, SharedPublicQuota]],
      [CapaciteGuard, [Reflector, CapacitesService]],
      [DeliveryAccessGuard, [DeliveryAccessService]],
    ] as const;
    for (const [controller, dependencies] of constructors) {
      if (!Reflect.hasOwnMetadata('design:paramtypes', controller)) {
        Reflect.defineMetadata('design:paramtypes', [...dependencies], controller);
      }
    }

    class DeliveryHttpFixtureModule {}
    Module({
      imports: [
        JwtModule.register({ secret: randomBytes(32).toString('base64url'), signOptions: { expiresIn: '5m' } }),
        ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 60 }]),
      ],
      controllers: [DeliveryOperatorsController, DeliveryAccessController, GeneralAccessProbe],
      providers: [
        ...Object.entries(models).map(([name, model]) => ({ provide: getModelToken(name), useValue: model })),
        SessionAccessService, CapacitesService, DeliveryOperatorsService, DeliveryAccessService,
        { provide: SharedPublicQuota, useValue: quota },
        { provide: CapaciteGuard, inject: [Reflector, CapacitesService],
          useFactory: (reflector: Reflector, capabilities: CapacitesService) => new CapaciteGuard(reflector, capabilities) },
        { provide: DeliveryAccessGuard, inject: [DeliveryAccessService],
          useFactory: (access: DeliveryAccessService) => new DeliveryAccessGuard(access) },
        { provide: APP_GUARD, inject: [JwtService, Reflector, SessionAccessService],
          useFactory: (signer: JwtService, reflector: Reflector, sessions: SessionAccessService) => new AuthGuard(signer, reflector, sessions) },
      ],
    })(DeliveryHttpFixtureModule);
    app = await NestFactory.create(DeliveryHttpFixtureModule, { logger: false, abortOnError: false });
    await app.listen(0, '127.0.0.1');
    const address = app.getHttpServer().address() as AddressInfo;
    origin = `http://127.0.0.1:${address.port}`;
    jwt = app.get(JwtService);
  }, 15_000);

  function assertOwnDatabase() {
    if (!uri || db.name !== new URL(uri).pathname.slice(1)
      || !/^snackmanager_delivery_http_test_[a-z0-9_]+_[a-f0-9]{10}$/i.test(db.name)) {
      throw new Error('Nettoyage refusé : base étrangère à la recette HTTP');
    }
  }

  beforeEach(async () => {
    assertOwnDatabase();
    await Promise.all([
      models.Tenant.deleteMany({}), models.User.deleteMany({}), models.Staff.deleteMany({}),
      models.Device.deleteMany({}), models.DeliveryOperator.deleteMany({}),
    ]);
    quota.reserve.mockClear(); quota.reserveClient.mockClear();
    await models.Tenant.create([
      { _id: TENANT, slug: 'delivery-http-fixture', name: 'Restaurant HTTP de recette', plan: null, onlineDelivery: true, account: { status: 'active' } },
      { _id: OTHER, slug: 'delivery-http-other', name: 'Autre restaurant de recette', plan: null, onlineDelivery: true, account: { status: 'active' } },
    ]);
    await models.User.create([
      { _id: OWNER, email: 'owner@delivery-http.invalid', passwordHash: 'fixture-only', role: 'owner', tenantId: TENANT, sessionVersion: 'user-v1' },
      { _id: COGERANT, email: 'cogerant@delivery-http.invalid', passwordHash: 'fixture-only', role: 'cogerant', tenantId: TENANT, sessionVersion: 'user-v1' },
      { _id: FOREIGN_OWNER, email: 'other@delivery-http.invalid', passwordHash: 'fixture-only', role: 'owner', tenantId: OTHER, sessionVersion: 'user-v1' },
    ]);
    await models.Staff.create({ _id: STAFF, tenantId: TENANT, name: 'Équipier polyvalent HTTP', role: 'caisse',
      pinHash: 'fixture-pin-not-a-password', hourlyCostCents: 2_400, active: true, sessionVersion: 'staff-v1' });
    await models.Device.create({ _id: DEVICE, tenantId: TENANT, name: 'POS de recette HTTP', kind: 'pos', paired: true,
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

  afterAll(async () => {
    try { await app?.close(); }
    finally {
      if (db) {
        try { assertOwnDatabase(); await db.dropDatabase(); }
        finally { await db.close(); }
      }
    }
  });

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

  async function create(bearer = tokens.owner, linked = false) {
    const response = await http('POST', '/delivery/operators', bearer,
      { requestId: randomUUID(), ...(linked ? { staffId: STAFF } : { name: 'Livreur HTTP de recette' }) });
    expect(response.status).toBe(201);
    return DeliveryOperatorViewSchema.parse(response.body);
  }

  async function connect(linked = false) {
    const operator = await create(tokens.owner, linked);
    const invited = await http('POST', `/delivery/operators/${operator.id}/invitation`, tokens.owner, { expectedRevision: operator.revision });
    expect(invited.status).toBe(200);
    const invitation = DeliveryOperatorInvitationSchema.parse(invited.body);
    const input = { token: invitation.token, nonce: randomBytes(32).toString('base64url') };
    const exchanged = await http('POST', '/delivery-access/exchange', undefined, input);
    expect(exchanged.status).toBe(200);
    const body = exchanged.body as { token: string; session: unknown };
    expect(typeof body.token === 'string' && /^[A-Za-z0-9_-]{43}$/.test(body.token)).toBe(true);
    const session = DeliverySessionViewSchema.parse(body.session);
    return { operator, input, token: body.token, session };
  }

  it.each([undefined, '2', '3', '2, 2'])('négocie la vue session HTTP sans changer le bearer : version %s', async version => {
    await models.Tenant.updateOne({ _id: TENANT }, { $set: { address: '2 rue du Restaurant', phones: ['0102030405'] } });
    const connected = await connect();
    const exchange = await http('POST', '/delivery-access/exchange', undefined, connected.input, version);
    const session = await http('GET', '/delivery-access/session', connected.token, undefined, version);
    expect(exchange.status).toBe(200); expect(session.status).toBe(200);
    const exchanged = exchange.body as { token: string; session: unknown };
    expect(exchanged.token).toBe(connected.token);
    expect(exchanged.session).toEqual(session.body);
    const legacy = DeliverySessionViewSchema.omit({ brand: true, restaurantAddress: true, restaurantPhones: true }).strict();
    if (version === '2') {
      expect(DeliverySessionViewSchema.parse(session.body)).toMatchObject({ restaurantAddress: '2 rue du Restaurant', restaurantPhones: ['0102030405'] });
      expect(session.body).toHaveProperty('brand');
      expect(legacy.safeParse(session.body).success).toBe(false);
    } else {
      expect(legacy.parse(session.body)).toEqual(connected.session);
      expect(session.body).not.toHaveProperty('brand');
      expect(session.body).not.toHaveProperty('restaurantAddress');
      expect(session.body).not.toHaveProperty('restaurantPhones');
    }
    expect(exchange.cacheControl).toBe('no-store'); expect(session.cacheControl).toBe('no-store');
  });

  it('authentifie owner et cogérant avec delivery seul, sans accès RH ni fuite des champs Staff', async () => {
    for (const token of [tokens.owner, tokens.cogerant]) {
      const response = await http('GET', '/delivery/operators', token);
      expect(response.status).toBe(200);
      expect(response.cacheControl).toBe('no-store');
      const listing = DeliveryOperatorsViewSchema.parse(response.body);
      expect(listing.candidates).toEqual([{ id: STAFF, name: 'Équipier polyvalent HTTP' }]);
      expect(/pinHash|hourlyCost|sessionVersion|fixture-pin/.test(JSON.stringify(response.body))).toBe(false);
      expect((await http('GET', '/delivery-http-fixture/team', token)).status).toBe(403);
    }
    const created = await create(tokens.cogerant);
    const response = await http('POST', `/delivery/operators/${created.id}/invitation`, tokens.cogerant, { expectedRevision: 0 });
    expect(response.status).toBe(200);
    expect(await models.Staff.countDocuments()).toBe(1);
  });

  it('applique rôle, tenant et version de session DB avant les mutations gérant', async () => {
    expect((await http('GET', '/delivery/operators')).status).toBe(401);
    expect((await http('GET', '/delivery/operators', 'not-a-jwt')).status).toBe(401);
    expect((await http('GET', '/delivery-http-fixture/authenticated', tokens.staff)).status).toBe(200);
    expect((await http('GET', '/delivery/operators', tokens.staff)).status).toBe(403);
    const operator = await create();
    const foreignList = await http('GET', '/delivery/operators', tokens.foreign);
    expect(foreignList.status).toBe(200);
    expect(DeliveryOperatorsViewSchema.parse(foreignList.body).operators).toHaveLength(0);
    expect((await http('PATCH', `/delivery/operators/${operator.id}`, tokens.foreign, { expectedRevision: 0, active: false })).status).toBe(404);
    expect((await http('POST', '/delivery/operators', tokens.owner, { requestId: randomUUID(), name: 'Fixture', tenantId: OTHER })).status).toBe(400);
    await models.User.updateOne({ _id: OWNER }, { $set: { sessionVersion: 'user-v2' } });
    expect((await http('GET', '/delivery/operators', tokens.owner)).status).toBe(401);
    expect(await models.DeliveryOperator.countDocuments()).toBe(1);
  });

  it('réserve le bearer opaque aux routes livreur, rejette le JWT staff et révoque au logout HTTP', async () => {
    const connected = await connect();
    const response = await http('GET', '/delivery-access/session', connected.token);
    expect(response.status).toBe(200);
    expect(response.cacheControl).toBe('no-store');
    expect(DeliverySessionViewSchema.parse(response.body)).toEqual(connected.session);
    const replay = await http('POST', '/delivery-access/exchange', undefined, connected.input);
    expect(replay.status).toBe(200);
    expect((replay.body as { token: string }).token === connected.token).toBe(true);
    for (const path of ['/delivery/operators', '/delivery-http-fixture/authenticated']) {
      expect((await http('GET', path, connected.token)).status).toBe(401);
    }
    expect((await http('POST', '/delivery/operators', connected.token, { requestId: randomUUID(), name: 'Interdit' })).status).toBe(401);
    expect((await http('PATCH', `/delivery/operators/${connected.operator.id}`, connected.token, { expectedRevision: 2, active: false })).status).toBe(401);
    expect((await http('GET', '/delivery-access/session', tokens.staff)).status).toBe(401);
    expect((await http('POST', '/delivery-access/logout', tokens.staff)).status).toBe(401);
    const loggedOut = await http('POST', '/delivery-access/logout', connected.token);
    expect(loggedOut.status).toBe(204);
    expect(loggedOut.body).toBeNull();
    expect((await http('GET', '/delivery-access/session', connected.token)).status).toBe(401);
    expect((await http('POST', '/delivery-access/exchange', undefined, connected.input)).status).toBe(401);
  });

  it('la révocation gérant HTTP est immédiate et sa réactivation ne ressuscite aucun secret ni ne coupe le POS', async () => {
    const connected = await connect(true);
    const revoked = await http('PATCH', `/delivery/operators/${connected.operator.id}`, tokens.cogerant, { expectedRevision: 2, active: false });
    expect(revoked.status).toBe(200);
    expect(DeliveryOperatorViewSchema.parse(revoked.body).effectiveActive).toBe(false);
    expect((await http('GET', '/delivery-access/session', connected.token)).status).toBe(401);
    const enabled = await http('PATCH', `/delivery/operators/${connected.operator.id}`, tokens.owner, { expectedRevision: 3, active: true });
    expect(enabled.status).toBe(200);
    expect((await http('POST', '/delivery-access/exchange', undefined, connected.input)).status).toBe(401);
    expect((await http('GET', '/delivery-access/session', connected.token)).status).toBe(401);
    expect((await http('GET', '/delivery-http-fixture/authenticated', tokens.staff)).status).toBe(200);
    expect((await models.Staff.findById(STAFF).lean())?.sessionVersion).toBe('staff-v1');
  });

  it('valide strictement les corps HTTP avant consommation et ne reflète pas les secrets dans les erreurs', async () => {
    const invalidCreate = await http('POST', '/delivery/operators', tokens.owner,
      { requestId: randomUUID(), name: 'Ambigu', staffId: STAFF });
    expect(invalidCreate.status).toBe(400);
    expect(await models.DeliveryOperator.countDocuments()).toBe(0);
    const operator = await create();
    const invited = await http('POST', `/delivery/operators/${operator.id}/invitation`, tokens.owner, { expectedRevision: 0 });
    expect(invited.status).toBe(200);
    const invitation = DeliveryOperatorInvitationSchema.parse(invited.body);
    for (const body of [
      { token: invitation.token, nonce: 'invalid' },
      { token: invitation.token, nonce: randomBytes(32).toString('base64url'), tenantId: OTHER },
    ]) {
      const response = await http('POST', '/delivery-access/exchange', undefined, body);
      expect(response.status).toBe(400);
      expect(JSON.stringify(response.body).includes(invitation.token)).toBe(false);
    }
    const row = await models.DeliveryOperator.findById(operator.id).select(PRIVATE).lean();
    expect(row?.session).toBeNull();
    expect(row?.history.some(event => event.action === 'connected')).toBe(false);
  });

  it('relit offre et suspension après émission des deux genres de sessions HTTP', async () => {
    const connected = await connect();
    await models.Tenant.updateOne({ _id: TENANT }, { $set: { onlineDelivery: false } });
    expect((await http('GET', '/delivery/operators', tokens.owner)).status).toBe(403);
    expect((await http('GET', '/delivery-access/session', connected.token)).status).toBe(401);
    await models.Tenant.updateOne({ _id: TENANT }, { $set: { onlineDelivery: true, 'account.status': 'suspended' } });
    expect((await http('GET', '/delivery/operators', tokens.owner)).status).toBe(403);
    expect((await http('GET', '/delivery-access/session', connected.token)).status).toBe(401);
  });
});
