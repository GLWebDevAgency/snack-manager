import 'reflect-metadata';
import { randomBytes, randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { DeliveryCustomerProofSchema, DeliveryHandoffResultSchema, DeliveryHandoffStateSchema,
  type DeliveryHandoffState } from '@sm/contracts';
import { OrdersService } from '../orders/orders.service';
import { DeliveryAccessService } from './delivery-access.service';
import { DeliveryHandoffService } from './delivery-handoff.service';
import { createHandoffFixture, deliveryHandoffHttpTestDatabase, TENANT, OTHER, OWNER, COGERANT, CASHIER } from './delivery-handoff.test-fixtures';

const uri = process.env.DELIVERY_HANDOFF_HTTP_TEST_MONGO_URL ?? null;
type Fixture = Awaited<ReturnType<typeof createHandoffFixture>>;

describe('cible HTTP remise isolée', () => {
  it('refuse les cibles métier, externes, authentifiées ou avec options', () => {
    const authenticated = new URL('mongodb://localhost/snackmanager_delivery_handoff_http_test_ci');
    authenticated.username = 'fixture'; authenticated.password = 'fixture';
    for (const raw of ['mongodb://remote.invalid/snackmanager_delivery_handoff_http_test_ci', 'mongodb://localhost/snackmanager',
      'mongodb+srv://localhost/snackmanager_delivery_handoff_http_test_ci', authenticated.toString(),
      'mongodb://localhost/snackmanager_delivery_handoff_http_test_ci?replicaSet=external',
      'mongodb://localhost/snackmanager_delivery_handoff_http_test_ci#fragment']) {
      expect(() => deliveryHandoffHttpTestDatabase(raw)).toThrow();
    }
  });
  it('alloue une base distincte pour chaque run', () => {
    const raw = 'mongodb://127.0.0.1:27046/snackmanager_delivery_handoff_http_test_local';
    expect(deliveryHandoffHttpTestDatabase(raw)).not.toBe(deliveryHandoffHttpTestDatabase(raw));
  });
});

(uri ? describe : describe.skip)('remise — vrais HTTP, guards, audit et Mongo local', () => {
  let fixture: Fixture;
  let models: Fixture['models']; let app: Fixture['app'];
  let tokens: Fixture['tokens']; let quota: Fixture['quota']; let redis: Fixture['redis'];
  beforeAll(async () => {
    fixture = await createHandoffFixture(uri!);
    ({ models, app, quota, redis } = fixture);
  }, 20_000);
  beforeEach(async () => { await fixture.reset(); tokens = fixture.tokens; });
  afterEach(() => { vi.restoreAllMocks(); });
  afterAll(async () => { await fixture?.close(); });

  const http = (...args: Parameters<Fixture['http']>) => fixture.http(...args);
  const connect = () => fixture.connect();
  const seed = (...args: Parameters<Fixture['seed']>) => fixture.seed(...args);
  const path = (id: string, courier = false) => `/${courier ? 'delivery-access' : 'delivery'}/missions/${id}/handoff`;
  const stored = (id: string) => models.Order.findById(id).select('+deliveryMission +deliveryHandoff +paymentFlow').lean();
  async function state(id: string, token = tokens.owner, courier = false) {
    const response = await http('GET', path(id, courier), token);
    expect(response.status).toBe(200); expect(response.cache).toBe('private, no-store');
    return DeliveryHandoffStateSchema.parse(response.body);
  }
  const operation = (view: DeliveryHandoffState) => ({ operationId: randomUUID(), expectedRevision: view.revision, expectedMissionRevision: view.missionRevision });
  async function proof(fixture: Awaited<ReturnType<typeof seed>>) {
    const response = await http('POST', `/public/orders/${fixture.id}/delivery-proof`, undefined,
      { clientId: fixture.clientId, recoveryProof: fixture.recoveryProof });
    expect(response.status).toBe(200); expect(response.cache).toBe('private, no-store');
    return DeliveryCustomerProofSchema.parse(response.body);
  }
  function privateResponse(body: unknown) {
    expect(/trackingToken|fixture-tracking|stripe|customerPhone|customerName|line1|publicRecovery|sealed|fingerprint|operations|"pin"|"qr"|reason/.test(JSON.stringify(body))).toBe(false);
  }

  it('vrais rôles, capacité delivery et isolation tenant/session sur les deux surfaces', async () => {
    const connected = await connect(); const own = await seed(connected.operator.id); const other = await seed();
    for (const token of [tokens.owner, tokens.cogerant, tokens.gerant, tokens.caisse]) privateResponse(await state(own.id, token));
    expect((await http('GET', path(own.id))).status).toBe(401);
    expect((await http('GET', path(own.id), tokens.cuisine)).status).toBe(403);
    expect((await http('GET', path(own.id), tokens.foreign)).status).toBe(404);
    expect((await http('GET', path(own.id), connected.token)).status).toBe(401);
    expect((await http('GET', path(own.id, true), tokens.caisse)).status).toBe(401);
    privateResponse(await state(own.id, connected.token, true));
    expect((await http('GET', path(other.id, true), connected.token)).status).toBe(404);
    await models.Tenant.updateOne({ _id: TENANT }, { $set: { onlineDelivery: false } });
    expect((await http('GET', path(own.id), tokens.owner)).status).toBe(403);
    await models.Tenant.updateOne({ _id: TENANT }, { $set: { onlineDelivery: true } });
    await models.User.updateOne({ _id: OWNER }, { $set: { sessionVersion: 'revoked' } });
    expect((await http('GET', path(own.id), tokens.owner)).status).toBe(401);
  });

  it('ferme le PATCH legacy de toute livraison, même historique ou déjà terminée', async () => {
    for (const status of ['ready', 'delivered', 'cancelled']) {
      const fixture = await seed(undefined, { status });
      for (const token of [tokens.owner, tokens.cogerant, tokens.gerant, tokens.caisse]) {
        const response = await http('PATCH', `/orders/${fixture.id}/status`, token, { status: 'delivered' });
        expect(response.status).toBe(409); expect(response.body).toMatchObject({ code: 'DELIVERY_HANDOFF_REQUIRED' });
      }
      expect((await stored(fixture.id))?.status).toBe(status);
      expect((await stored(fixture.id))?.delivery?.deliveredAt).toBeNull();
    }
    expect(redis.publish).not.toHaveBeenCalled();
  });

  it('seule la capacité recovery client affiche le PIN/QR ; aucun secret dans les autres vues', async () => {
    const connected = await connect(); const fixture = await seed(connected.operator.id);
    const endpoint = `/public/orders/${fixture.id}/delivery-proof`;
    expect((await http('GET', endpoint)).status).toBe(404);
    expect((await http('POST', endpoint, undefined, { trackingToken: 'fixture-tracking-secret' })).status).toBe(400);
    expect((await http('POST', endpoint, undefined, { clientId: randomUUID(), recoveryProof: fixture.recoveryProof })).status).toBe(404);
    expect((await http('POST', endpoint, undefined, { clientId: fixture.clientId, recoveryProof: randomBytes(32).toString('hex') })).status).toBe(404);
    const current = await proof(fixture); expect(current.missionId).toBe(fixture.id);
    privateResponse(await state(fixture.id)); privateResponse(await state(fixture.id, connected.token, true));
    const professional = await http('GET', `/orders/${fixture.id}`, tokens.caisse);
    expect(professional.status).toBe(200);
    expect(/deliveryHandoff|sealed|"pin"|"qr"/.test(JSON.stringify(professional.body))).toBe(false);
    expect(JSON.stringify(redis.publish.mock.calls).includes(current.pin)).toBe(false);
    expect(JSON.stringify(redis.publish.mock.calls).includes(current.qr)).toBe(false);
  });

  it('confirmation livreur et recovery terminal conservent reçu, auteur exact et audit unique', async () => {
    const connected = await connect(); const fixture = await seed(connected.operator.id); const current = await proof(fixture);
    const input = { ...operation(await state(fixture.id)), proof: { kind: 'pin', value: current.pin } };
    const endpoint = `${path(fixture.id, true)}/confirm`;
    const first = await http('POST', endpoint, connected.token, input);
    expect(first.status).toBe(200);
    const result = DeliveryHandoffResultSchema.parse(first.body);
    expect(result).toMatchObject({ outcome: 'applied', replay: false, action: 'handoff', state: { orderStatus: 'delivered' } });
    privateResponse(result);
    const replay = await http('POST', endpoint, connected.token, input);
    expect(replay.status).toBe(200); expect(DeliveryHandoffResultSchema.parse(replay.body)).toMatchObject({ outcome: 'applied', replay: true });
    const recovered = await http('POST', `${path(fixture.id, true)}/resolve`, connected.token,
      { operationId: input.operationId, expectedRevision: input.expectedRevision, expectedMissionRevision: input.expectedMissionRevision, action: 'handoff' });
    expect(recovered.status).toBe(200); expect(DeliveryHandoffResultSchema.parse(recovered.body)).toMatchObject({ outcome: 'applied', replay: true });
    const logs = await models.AuditLog.find({ tenantId: TENANT, targetId: fixture.id }).lean();
    const handoffLogs = logs.filter(log => log.meta?.operationId === input.operationId);
    expect(handoffLogs).toHaveLength(1);
    expect(handoffLogs[0]?.author).toEqual({ id: connected.operator.id, name: connected.operator.name, role: 'livreur', means: 'delivery_access' });
    expect(JSON.stringify(logs).includes(current.pin)).toBe(false); expect(JSON.stringify(logs).includes(current.qr)).toBe(false);
    expect((await stored(fixture.id))?.delivery?.deliveredAt).toBeInstanceOf(Date);
  });

  it('un mauvais code produit un refus 200 durable ; la caisse confirme ensuite le code correct', async () => {
    const connected = await connect(); const fixture = await seed(connected.operator.id); const current = await proof(fixture);
    const wrong = `${(Number(current.pin[0]) + 1) % 10}${current.pin.slice(1)}`;
    const input = { ...operation(await state(fixture.id)), proof: { kind: 'pin', value: wrong } };
    const endpoint = `${path(fixture.id)}/confirm`;
    const first = await http('POST', endpoint, tokens.caisse, input);
    expect(first.status).toBe(200);
    expect(DeliveryHandoffResultSchema.parse(first.body)).toMatchObject({ outcome: 'rejected', refusalCode: 'proof_incorrect', replay: false });
    privateResponse(first.body);
    const replay = await http('POST', endpoint, tokens.caisse, input);
    expect(replay.status).toBe(200);
    expect(DeliveryHandoffResultSchema.parse(replay.body)).toMatchObject({ outcome: 'rejected', refusalCode: 'proof_incorrect', replay: true });
    expect((await stored(fixture.id))?.deliveryHandoff?.proof?.failedAttempts).toBe(1);
    expect(await models.AuditLog.countDocuments({ targetId: fixture.id })).toBe(0);
    const mismatch = await http('POST', endpoint, tokens.caisse, { ...input, proof: { kind: 'pin', value: current.pin } });
    expect(mismatch.status).toBe(409); expect(mismatch.body).toMatchObject({ code: 'DELIVERY_HANDOFF_OPERATION_CONFLICT' });
    const corrected = await http('POST', endpoint, tokens.caisse,
      { ...operation(await state(fixture.id)), proof: { kind: 'pin', value: current.pin } });
    expect(corrected.status).toBe(200);
    expect(DeliveryHandoffResultSchema.parse(corrected.body)).toMatchObject({ outcome: 'applied', state: { orderStatus: 'delivered' } });
    const logs = await models.AuditLog.find({ targetId: fixture.id }).lean();
    expect(logs).toHaveLength(1);
    expect(logs[0]?.author).toEqual({ id: CASHIER, name: 'Équipier caisse HTTP', role: 'caisse', means: 'pin' });
  });

  it('rotation responsable invalide l’ancien QR, sans exposer le nouveau au professionnel', async () => {
    const connected = await connect(); const fixture = await seed(connected.operator.id); const first = await proof(fixture);
    const rotated = await http('POST', `${path(fixture.id)}/rotate`, tokens.gerant,
      { ...operation(await state(fixture.id)), reason: 'Nouveau code demandé par le client' });
    expect(rotated.status).toBe(200); expect(DeliveryHandoffResultSchema.parse(rotated.body).outcome).toBe('applied');
    privateResponse(rotated.body);
    const current = await proof(fixture);
    expect(current.proofId === first.proofId).toBe(false);
    const obsolete = await http('POST', `${path(fixture.id)}/confirm`, tokens.gerant,
      { ...operation(await state(fixture.id)), proof: { kind: 'qr', value: first.qr } });
    expect(obsolete.status).toBe(200);
    expect(DeliveryHandoffResultSchema.parse(obsolete.body)).toMatchObject({ outcome: 'rejected', refusalCode: 'proof_incorrect' });
    const response = await http('POST', `${path(fixture.id)}/confirm`, tokens.gerant,
      { ...operation(await state(fixture.id)), proof: { kind: 'qr', value: current.qr } });
    expect(response.status).toBe(200); expect(DeliveryHandoffResultSchema.parse(response.body).outcome).toBe('applied');
    privateResponse(response.body);
  });

  it('le vrai CAS __v reste actif pour la remise comptoir autorisée', async () => {
    const fixture = await seed(undefined, { type: 'pickup' });
    const orders = app!.get(OrdersService);
    const stale = await orders.byId(TENANT, fixture.id);
    await models.Order.updateOne({ _id: fixture.id }, { $set: { 'payment.pendingRefundCents': 100 }, $inc: { __v: 1 } });
    vi.spyOn(orders, 'byId').mockResolvedValueOnce(stale);
    const response = await http('PATCH', `/orders/${fixture.id}/status`, tokens.caisse, { status: 'delivered' });
    expect(response.status).toBe(409);
    const row = await stored(fixture.id);
    expect(row?.status).toBe('ready'); expect(row?.payment.pendingRefundCents).toBe(100);
    expect(redis.publish).not.toHaveBeenCalled();
  });

  it('incident caisse ne remet rien ; seule une dérogation responsable motivée clôture', async () => {
    const fixture = await seed();
    const incident = await http('POST', `${path(fixture.id)}/incident`, tokens.caisse,
      { ...operation(await state(fixture.id)), code: 'proof_unavailable' });
    expect(incident.status).toBe(200); expect(DeliveryHandoffResultSchema.parse(incident.body)).toMatchObject({ outcome: 'applied', state: { orderStatus: 'ready' } });
    expect((await stored(fixture.id))?.delivery?.deliveredAt).toBeNull();
    const input = { ...operation(await state(fixture.id)), reason: 'Remise constatée par le responsable' };
    for (const token of [tokens.caisse, tokens.cuisine]) {
      for (const action of ['override', 'rotate']) {
        expect((await http('POST', `${path(fixture.id)}/${action}`, token, input)).status).toBe(403);
        expect((await http('POST', `${path(fixture.id)}/resolve`, token, { ...operation(await state(fixture.id)), action })).status).toBe(403);
      }
    }
    const response = await http('POST', `${path(fixture.id)}/override`, tokens.cogerant, input);
    expect(response.status).toBe(200); expect(DeliveryHandoffResultSchema.parse(response.body)).toMatchObject({ outcome: 'applied', state: { orderStatus: 'delivered' } });
    privateResponse(response.body);
    const replay = await http('POST', `${path(fixture.id)}/override`, tokens.cogerant, input);
    expect(replay.status).toBe(200); expect(DeliveryHandoffResultSchema.parse(replay.body).replay).toBe(true);
    const logs = await models.AuditLog.find({ targetId: fixture.id, 'meta.operationId': input.operationId }).lean();
    expect(logs).toHaveLength(1);
    expect(logs[0]?.author).toEqual({ id: COGERANT, name: 'Cogérant HTTP', role: 'cogerant', means: 'password' });
  });

  it('un resolve absent fence la requête tardive, sans PIN ni dérogation cachée', async () => {
    const connected = await connect(); const fixture = await seed(connected.operator.id); const current = await proof(fixture);
    const input = operation(await state(fixture.id));
    const abandoned = await http('POST', `${path(fixture.id, true)}/resolve`, connected.token, { ...input, action: 'handoff' });
    expect(abandoned.status).toBe(200); expect(DeliveryHandoffResultSchema.parse(abandoned.body)).toMatchObject({ outcome: 'abandoned', refusalCode: 'abandoned' });
    const late = await http('POST', `${path(fixture.id, true)}/confirm`, connected.token, { ...input, proof: { kind: 'pin', value: current.pin } });
    expect(late.status).toBe(200); expect(DeliveryHandoffResultSchema.parse(late.body)).toMatchObject({ outcome: 'abandoned' });
    expect((await stored(fixture.id))?.status).toBe('ready');
    for (const action of ['override', 'rotate']) {
      expect((await http('POST', `${path(fixture.id, true)}/${action}`, connected.token, {})).status).toBe(404);
      expect((await http('POST', `${path(fixture.id, true)}/resolve`, connected.token, { ...input, action })).status).toBe(403);
    }
  });

  it('refuse strictement les corps injectés et les IDs invalides avant mutation', async () => {
    const connected = await connect(); const fixture = await seed(connected.operator.id);
    const input = operation(await state(fixture.id));
    for (const endpoint of [path(fixture.id), path(fixture.id, true)]) {
      const token = endpoint.startsWith('/delivery-access') ? connected.token : tokens.owner;
      for (const body of [{ ...input, proof: { kind: 'pin', value: '12345' } },
        { ...input, proof: { kind: 'pin', value: '123456' }, tenantId: OTHER },
        { ...input, proof: { kind: 'pin', value: '123456' }, status: 'delivered' },
        { ...input, expectedRevision: -1, proof: { kind: 'pin', value: '123456' } }]) {
        const response = await http('POST', `${endpoint}/confirm`, token, body);
        expect(response.status).toBe(400); expect(JSON.stringify(response.body).includes(OTHER)).toBe(false);
      }
      expect((await http('POST', `${endpoint}/incident`, token, { ...input, code: 'customer_absent', reason: 'Private fixture' })).status).toBe(400);
    }
    expect((await http('GET', path('invalid'), tokens.owner)).status).toBe(400);
    expect((await http('POST', `${path(fixture.id)}/override`, tokens.owner, { ...input, reason: 'court' })).status).toBe(400);
    expect((await stored(fixture.id))?.status).toBe('ready');
  });

  it('quotas source/global et bearer précèdent auth/DB ; panne Redis fermée', async () => {
    const connected = await connect(); const fixture = await seed(connected.operator.id);
    const authenticate = vi.spyOn(app!.get(DeliveryAccessService), 'authenticate');
    const customerProof = vi.spyOn(app!.get(DeliveryHandoffService), 'customerProof');
    const request = { clientId: fixture.clientId, recoveryProof: fixture.recoveryProof };
    quota.reserve.mockResolvedValue(false); quota.reserveClient.mockClear();
    expect((await http('GET', path(fixture.id, true), connected.token)).status).toBe(429);
    expect((await http('POST', `/public/orders/${fixture.id}/delivery-proof`, undefined, request)).status).toBe(429);
    expect(authenticate).not.toHaveBeenCalled(); expect(customerProof).not.toHaveBeenCalled(); expect(quota.reserveClient).not.toHaveBeenCalled();
    quota.reserve.mockRejectedValue(new Error('private-redis-fixture'));
    for (const response of [await http('GET', path(fixture.id, true), connected.token),
      await http('POST', `/public/orders/${fixture.id}/delivery-proof`, undefined, request)]) {
      expect(response.status).toBe(503); expect(JSON.stringify(response.body).includes('private-redis-fixture')).toBe(false);
    }
    expect(authenticate).not.toHaveBeenCalled(); expect(customerProof).not.toHaveBeenCalled();
    quota.reserve.mockResolvedValue(true); quota.reserveClient.mockResolvedValue(false);
    expect((await http('GET', path(fixture.id, true), connected.token)).status).toBe(429);
    expect(authenticate).not.toHaveBeenCalled();
    expect(JSON.stringify(quota.reserveClient.mock.calls).includes(connected.token)).toBe(false);
  });

  it('révocation et suspension ferment aussi confirmation et recovery', async () => {
    const connected = await connect(); const fixture = await seed(connected.operator.id);
    const input = operation(await state(fixture.id));
    await models.DeliveryOperator.updateOne({ _id: connected.operator.id }, { $set: { active: false }, $inc: { revision: 1 } });
    expect((await http('GET', path(fixture.id, true), connected.token)).status).toBe(401);
    expect((await http('POST', `${path(fixture.id, true)}/confirm`, connected.token, { ...input, proof: { kind: 'pin', value: '123456' } })).status).toBe(401);
    expect((await http('POST', `${path(fixture.id, true)}/resolve`, connected.token, { ...input, action: 'handoff' })).status).toBe(401);
    await models.Tenant.updateOne({ _id: TENANT }, { $set: { 'account.status': 'suspended' } });
    expect((await http('GET', path(fixture.id), tokens.owner)).status).toBe(403);
    expect((await stored(fixture.id))?.status).toBe('ready');
  });
});
