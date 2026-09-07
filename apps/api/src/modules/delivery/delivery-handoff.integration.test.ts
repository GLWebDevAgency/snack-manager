import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import mongoose, { type Connection, type Model, type Query } from 'mongoose';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { MODELS, type DeliveryOperator, type Order, type Staff, type Tenant } from '@sm/db';
import type { DeliveryHandoffResolve, DeliveryHandoffSubmit, JwtPayload } from '@sm/contracts';
import { DeliveryHandoffService } from './delivery-handoff.service';
import { DeliveryAccessService, hashDeliveryAccessSecret } from './delivery-access.service';
import { recoveryProofHash } from '../orders/order-recovery';

const TENANT = '507f1f77bcf86cd799439011';
const OTHER = '507f1f77bcf86cd799439022';
const OPERATOR = '507f1f77bcf86cd799439033';
const OWNER = '507f1f77bcf86cd799439044';
const actor = { kind: 'user', role: 'owner', sub: OWNER, tenantId: TENANT } as JwtPayload;
const purchaser = 'ab'.repeat(32);
const config = new ConfigService({ DELIVERY_HANDOFF_KEY: Buffer.alloc(32, 7).toString('base64url') });

export function handoffTestDatabase(raw: string) {
  const url = new URL(raw);
  if (url.protocol !== 'mongodb:' || !['localhost', '127.0.0.1'].includes(url.hostname)
    || url.username || url.password || url.search || url.hash || !/^\/snackmanager_delivery_handoff_test_[a-z0-9_]{1,12}$/.test(url.pathname)) {
    throw new Error('DELIVERY_HANDOFF_TEST_MONGO_URL doit cibler une base locale isolée snackmanager_delivery_handoff_test_, sans options.');
  }
  url.pathname += `_${randomUUID().replaceAll('-', '').slice(0, 10)}`;
  return { uri: url.toString(), name: url.pathname.slice(1) };
}
const database = process.env.DELIVERY_HANDOFF_TEST_MONGO_URL ? handoffTestDatabase(process.env.DELIVERY_HANDOFF_TEST_MONGO_URL) : null;
describe('cible Mongo des remises', () => {
  it.each(['mongodb://remote.example/snackmanager_delivery_handoff_test_ci', 'mongodb://127.0.0.1/admin',
    'mongodb://localhost/snackmanager_delivery_handoff_test_ci?replicaSet=other',
    'mongodb://fixture:fixture@localhost/snackmanager_delivery_handoff_test_ci',
    'mongodb+srv://localhost/snackmanager_delivery_handoff_test_ci'])('refuse une cible non possédée %s', uri => {
    expect(() => handoffTestDatabase(uri)).toThrow();
  });
  it('suffixe chaque run avec une propriété distincte', () => {
    const uri = 'mongodb://localhost/snackmanager_delivery_handoff_test_local';
    expect(handoffTestDatabase(uri).name).not.toBe(handoffTestDatabase(uri).name);
  });
});

function barrier() { let release!: () => void; const promise = new Promise<void>(resolve => { release = resolve; }); return { promise, release }; }
function interceptWrite(model: Model<Order>, before?: () => Promise<void>, after?: () => Promise<void>) {
  let armed = true;
  return new Proxy(model, { get(target, property) {
    const value = Reflect.get(target, property, target);
    if (property !== 'updateOne') return typeof value === 'function' ? value.bind(target) : value;
    return (...args: unknown[]) => {
      const query = Reflect.apply(value, target, args) as Query<unknown, Order>;
      const exec = query.exec.bind(query);
      query.exec = async () => {
        const active = armed; armed = false;
        if (active && before) await before();
        const result = await exec();
        if (active && after) await after();
        return result;
      };
      return query;
    };
  } });
}

(database ? describe : describe.skip)('remise — preuves et courses Mongo standalone', () => {
  let db: Connection; let secondDb: Connection;
  let orders: Model<Order>; let secondOrders: Model<Order>; let tenants: Model<Tenant>;
  let operators: Model<DeliveryOperator>; let staff: Model<Staff>; let access: DeliveryAccessService;
  const audit = { logOnce: vi.fn().mockResolvedValue(undefined) };
  const redis = { publish: vi.fn().mockResolvedValue(1) };
  const service = (model = orders, cfg = config) => new DeliveryHandoffService(model, tenants, access, audit as never, redis as never, cfg);
  const stored = (id: string) => orders.findById(id).select('+deliveryHandoff +deliveryMission +publicRecovery +paymentFlow').lean();
  const token = Buffer.alloc(32, 9).toString('base64url');

  beforeAll(async () => {
    const options = { serverSelectionTimeoutMS: 5_000, family: 4, directConnection: true };
    db = await mongoose.createConnection(database!.uri, options).asPromise();
    secondDb = await mongoose.createConnection(database!.uri, options).asPromise();
    orders = db.model(MODELS.Order.name, MODELS.Order.schema, MODELS.Order.collection);
    secondOrders = secondDb.model(MODELS.Order.name, MODELS.Order.schema, MODELS.Order.collection);
    tenants = db.model(MODELS.Tenant.name, MODELS.Tenant.schema, MODELS.Tenant.collection);
    operators = db.model(MODELS.DeliveryOperator.name, MODELS.DeliveryOperator.schema, MODELS.DeliveryOperator.collection);
    staff = db.model(MODELS.Staff.name, MODELS.Staff.schema, MODELS.Staff.collection);
    await Promise.all([orders.init(), tenants.init(), operators.init(), staff.init()]);
    access = new DeliveryAccessService(operators, tenants, staff);
  }, 20_000);
  beforeEach(async () => {
    if (db.name !== database!.name) throw new Error('Base de recette non possédée');
    await Promise.all([orders.deleteMany({}), tenants.deleteMany({}), operators.deleteMany({}), staff.deleteMany({})]);
    vi.clearAllMocks();
    audit.logOnce.mockResolvedValue(undefined); redis.publish.mockResolvedValue(1);
    await tenants.create({ _id: TENANT, slug: 'handoff-fixture', name: 'Restaurant de recette', plan: 'essentiel', onlineDelivery: true });
    await tenants.create({ _id: OTHER, slug: 'handoff-other', name: 'Autre restaurant', plan: 'boost' });
    await operators.create({ _id: OPERATOR, tenantId: TENANT, name: 'Livreur fixture', creationHash: 'f'.repeat(64), active: true, revision: 0, sessionVersion: 'fixture',
      session: { hash: hashDeliveryAccessSecret(token), version: 'fixture', expiresAt: new Date(Date.now() + 3_600_000),
        inviteHash: 'a'.repeat(64), nonceHash: 'b'.repeat(64), retryUntil: new Date(Date.now() + 60_000) } });
  });
  afterAll(async () => {
    try { if (db && db.name === database!.name) await db.dropDatabase(); }
    finally { await Promise.all([db?.close(), secondDb?.close()]); }
  });
  async function seed(overrides: Record<string, unknown> = {}) {
    const clientId = randomUUID();
    const row = await orders.create({ tenantId: TENANT, clientId, number: 1, channel: 'online', type: 'delivery', status: 'ready',
      lines: [{ productId: '507f1f77bcf86cd799439055', name: 'Article fixture', qty: 1, unitPrice: 1250, lineTotal: 1250 }],
      totals: { subtotal: 1250, total: 1500, deliveryFee: 250 }, payment: { method: 'online', status: 'paid' },
      paymentFlow: { version: 1, origin: 'created_v1', phase: 'settled', attempt: null, close: null },
      delivery: { address: { line1: 'Adresse privée fixture', postalCode: '75001', city: 'Paris', country: 'FR' },
        instructions: 'Instruction privée', zoneId: 'fixture', zoneName: 'Fixture', feeCents: 250, estimatedMinutes: 20, dispatchedAt: new Date() },
      pickup: { slot: new Date(), customerName: 'Nom privé fixture', customerPhone: '0600000000' },
      deliveryMission: { version: 1, revision: 1, assignment: { operatorId: OPERATOR, assignmentId: randomUUID(), operatorName: 'Livreur fixture', assignedAt: new Date(), assignedBy: OWNER }, operations: [] },
      publicRecovery: { version: 1, proofHash: recoveryProofHash(TENANT, clientId, purchaser), payloadHash: 'c'.repeat(64) },
      trackingToken: 'tracking-is-not-handoff-authority', ...overrides });
    return { id: String(row._id), clientId };
  }
  async function prepared(overrides: Record<string, unknown> = {}) {
    const order = await seed(overrides);
    const proof = await service().customerProof(order.id, { clientId: order.clientId, recoveryProof: purchaser });
    const state = await service().getManager(TENANT, order.id, actor);
    const input: DeliveryHandoffSubmit = { operationId: randomUUID(), expectedRevision: state.revision,
      expectedMissionRevision: state.missionRevision, proof: { kind: 'pin', value: proof.pin } };
    return { ...order, proof, state, input };
  }
  const resolve = (input: DeliveryHandoffSubmit): DeliveryHandoffResolve => ({ operationId: input.operationId,
    expectedRevision: input.expectedRevision, expectedMissionRevision: input.expectedMissionRevision, action: 'handoff' });

  it('initialise une seule époque sous concurrence et réaffiche la même preuve chiffrée', async () => {
    const order = await seed();
    const request = { clientId: order.clientId, recoveryProof: purchaser };
    const [a, b] = await Promise.all([service().customerProof(order.id, request), service(secondOrders).customerProof(order.id, request)]);
    expect(a).toEqual(b);
    const row = await stored(order.id);
    expect(row!.deliveryHandoff!.revision).toBe(1);
    expect(row!.deliveryHandoff!.operations).toHaveLength(0);
    expect(row!.__v).toBe(1);
    expect(JSON.stringify(row!.deliveryHandoff)).not.toContain(a.pin);
    expect(JSON.stringify(row!.deliveryHandoff)).not.toContain(a.qr);
    expect(await orders.findById(order.id).lean()).not.toHaveProperty('deliveryHandoff');
    expect(audit.logOnce).not.toHaveBeenCalled();
  });
  it('ne confond ni jeton de suivi, mauvais reçu, autre commande ou commande historique avec la capacité C01', async () => {
    const one = await seed(); const two = await seed(); const legacy = await seed({ publicRecovery: null });
    await expect(service().customerProof(one.id, { clientId: one.clientId, recoveryProof: 'cd'.repeat(32) })).rejects.toMatchObject({ status: 404 });
    await expect(service().customerProof(two.id, { clientId: one.clientId, recoveryProof: purchaser })).rejects.toMatchObject({ status: 404 });
    await expect(service().customerProof(legacy.id, { clientId: legacy.clientId, recoveryProof: purchaser })).rejects.toMatchObject({ status: 404 });
    await expect(service().customerProof(one.id, { clientId: one.clientId, recoveryProof: 'tracking-is-not-handoff-authority' })).rejects.toMatchObject({ status: 400 });
    expect((await stored(one.id))!.deliveryHandoff).toBeNull();
  });
  it('livre par PIN, sans paiement modifié, et récupère le reçu privé après clôture', async () => {
    const p = await prepared(); const session = await access.authenticate(token); const before = await stored(p.id);
    const result = await service().confirmCourier(session, p.id, p.input);
    expect(result).toMatchObject({ outcome: 'applied', replay: false, state: { orderStatus: 'delivered' } });
    const after = await stored(p.id);
    expect(after!.payment).toEqual(before!.payment);
    expect(after!.paymentFlow).toEqual(before!.paymentFlow);
    expect(after!.deliveryMission).toEqual(before!.deliveryMission);
    expect(after!.delivery!.deliveredAt).toBeInstanceOf(Date);
    expect(after!.deliveryHandoff!.operations).toHaveLength(1);
    expect(after!.statusHistory.filter(item => item.status === 'delivered')).toHaveLength(1);
    await expect(service().getCourier(session, p.id)).rejects.toMatchObject({ status: 404 });
    expect(await service().resolveCourier(session, p.id, resolve(p.input))).toMatchObject({ outcome: 'applied', replay: true });
    expect(JSON.stringify(result)).not.toMatch(/Nom privé|Adresse privée|tracking-is|sealed|fingerprint|0600000000/);
    expect(JSON.stringify(audit.logOnce.mock.calls)).not.toContain(p.proof.pin);
    expect(JSON.stringify(redis.publish.mock.calls)).not.toContain('deliveryHandoff');
  });
  it('accepte uniquement un QR de cette commande et cette époque', async () => {
    const a = await prepared(); const b = await prepared();
    const bad = { ...a.input, proof: { kind: 'qr' as const, value: b.proof.qr } };
    expect(await service().confirmManager(TENANT, a.id, bad, actor)).toMatchObject({ outcome: 'rejected', refusalCode: 'proof_incorrect' });
    const good = { ...a.input, operationId: randomUUID(), expectedRevision: 2, proof: { kind: 'qr' as const, value: a.proof.qr } };
    expect(await service().confirmManager(TENANT, a.id, good, actor)).toMatchObject({ outcome: 'applied' });
  });
  it('une preuve consommée reste terminale malgré un statut générique incohérent', async () => {
    const p = await prepared();
    await service().confirmManager(TENANT, p.id, p.input, actor);
    await orders.updateOne({ _id: p.id }, { $set: { status: 'ready', 'delivery.deliveredAt': null }, $inc: { __v: 1 } });
    expect(await service().confirmManager(TENANT, p.id, { ...p.input, operationId: randomUUID(), expectedRevision: 2 }, actor))
      .toMatchObject({ outcome: 'rejected', refusalCode: 'closed', state: { canHandoff: false, canOverride: false, canRotate: false } });
    expect((await stored(p.id))!.statusHistory.filter(item => item.status === 'delivered')).toHaveLength(1);
  });
  it('compte chaque mauvais essai une seule fois, verrouille au cinquième et ne tente plus de secret', async () => {
    const p = await prepared();
    const wrong = p.proof.pin === '000000' ? '000001' : '000000';
    for (let n = 0; n < 5; n++) {
      const input = { ...p.input, operationId: randomUUID(), expectedRevision: n + 1, proof: { kind: 'pin' as const, value: wrong } };
      expect(await service().confirmManager(TENANT, p.id, input, actor)).toMatchObject({ outcome: 'rejected', refusalCode: 'proof_incorrect' });
      expect(await service().confirmManager(TENANT, p.id, input, actor)).toMatchObject({ replay: true, refusalCode: 'proof_incorrect' });
      expect((await stored(p.id))!.deliveryHandoff!.proof!.failedAttempts).toBe(n + 1);
    }
    expect(await service().confirmManager(TENANT, p.id, { ...p.input, operationId: randomUUID(), expectedRevision: 6 }, actor))
      .toMatchObject({ outcome: 'rejected', refusalCode: 'proof_locked', state: { proof: { locked: true } } });
    expect((await stored(p.id))!.status).toBe('ready');
    expect(audit.logOnce).not.toHaveBeenCalled();
  });
  it('refuse le même UUID avec un autre secret, une autre action ou un autre auteur', async () => {
    const p = await prepared(); const wrong = p.proof.pin === '000000' ? '000001' : '000000';
    await service().confirmManager(TENANT, p.id, { ...p.input, proof: { kind: 'pin', value: wrong } }, actor);
    await expect(service().confirmManager(TENANT, p.id, p.input, actor)).rejects.toMatchObject({ status: 409, response: { code: 'DELIVERY_HANDOFF_OPERATION_CONFLICT' } });
    await expect(service().resolveManager(TENANT, p.id, { ...resolve(p.input), action: 'incident' }, actor)).rejects.toMatchObject({ status: 409 });
    await expect(service().resolveManager(TENANT, p.id, resolve(p.input), { ...actor, sub: 'another-owner' })).rejects.toMatchObject({ status: 409 });
    expect((await stored(p.id))!.deliveryHandoff!.proof!.failedAttempts).toBe(1);
  });
  it('un ACK perdu se prouve par relecture majoritaire, sans deuxième remise', async () => {
    const p = await prepared();
    const proxy = interceptWrite(orders, undefined, async () => { throw new Error('simulated acknowledgement timeout'); });
    expect(await service(proxy).confirmManager(TENANT, p.id, p.input, actor)).toMatchObject({ outcome: 'applied', replay: true });
    expect((await stored(p.id))!.statusHistory.filter(item => item.status === 'delivered')).toHaveLength(1);
  });
  it('une erreur avant écriture reste503, jamais une fausse preuve d’échec définitif', async () => {
    const p = await prepared();
    const proxy = interceptWrite(orders, async () => { throw new Error('simulated transport timeout'); });
    await expect(service(proxy).confirmManager(TENANT, p.id, p.input, actor)).rejects.toMatchObject({ status: 503 });
    expect((await stored(p.id))!.deliveryHandoff!.operations).toHaveLength(0);
  });
  it('fence une opération inconnue avant une soumission retardée sans conserver le PIN', async () => {
    const p = await prepared(); const held = barrier(); const entered = barrier();
    const proxy = interceptWrite(orders, async () => { entered.release(); await held.promise; });
    const pending = service(proxy).confirmManager(TENANT, p.id, p.input, actor);
    await entered.promise;
    const recovered = await service(secondOrders).resolveManager(TENANT, p.id, resolve(p.input), actor);
    held.release();
    expect(recovered).toMatchObject({ outcome: 'abandoned', refusalCode: 'abandoned' });
    expect(await pending).toMatchObject({ outcome: 'abandoned', replay: true });
    const row = await stored(p.id);
    expect(row!.status).toBe('ready'); expect(row!.deliveryHandoff!.operations).toHaveLength(1);
    expect(row!.deliveryHandoff!.operations[0]!.fingerprint).toBeNull();
  });
  it('deux remises simultanées ne peuvent produire qu’une transition et un reçu appliqué', async () => {
    const p = await prepared();
    const results = await Promise.allSettled([service().confirmManager(TENANT, p.id, p.input, actor),
      service(secondOrders).confirmManager(TENANT, p.id, { ...p.input, operationId: randomUUID() }, actor)]);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect((await stored(p.id))!.deliveryHandoff!.operations).toHaveLength(1);
  });
  it('résout une ancienne intention après initialisation client concurrente, sans réappliquer un POST retardé', async () => {
    const p = await seed();
    const input: DeliveryHandoffSubmit = { operationId: randomUUID(), expectedRevision: 0, expectedMissionRevision: 1,
      proof: { kind: 'pin', value: '000000' } };
    await service().customerProof(p.id, { clientId: p.clientId, recoveryProof: purchaser });
    expect(await service().resolveManager(TENANT, p.id, resolve(input), actor)).toMatchObject({ outcome: 'abandoned', appliedRevision: 2 });
    expect(await service().confirmManager(TENANT, p.id, input, actor)).toMatchObject({ outcome: 'abandoned', replay: true });
    expect((await stored(p.id))!.status).toBe('ready');
    await expect(service().resolveManager(TENANT, p.id, { ...resolve(input), operationId: randomUUID(), expectedRevision: 10 }, actor))
      .rejects.toMatchObject({ status: 409 });
  });
  it('un changement financier __v sans changement de mission est relu puis refusé durablement', async () => {
    const p = await prepared(); const held = barrier(); const entered = barrier();
    const proxy = interceptWrite(orders, async () => { entered.release(); await held.promise; });
    const pending = service(proxy).confirmManager(TENANT, p.id, p.input, actor);
    await entered.promise;
    await secondOrders.updateOne({ _id: p.id }, { $set: { 'payment.pendingRefundCents': 100 }, $inc: { __v: 1 } });
    held.release();
    expect(await pending).toMatchObject({ outcome: 'rejected', refusalCode: 'payment_blocked' });
    expect((await stored(p.id))!.status).toBe('ready');
  });
  it('contrôle l’expiration au CAS serveur, même si elle arrive après vérification du PIN', async () => {
    const p = await prepared(); const held = barrier(); const entered = barrier();
    const proxy = interceptWrite(orders, async () => { entered.release(); await held.promise; });
    const pending = service(proxy).confirmManager(TENANT, p.id, p.input, actor);
    await entered.promise;
    // Sans __v dans cette écriture de fixture : on éprouve bien le fence $$NOW.
    await secondOrders.updateOne({ _id: p.id }, { $set: { 'deliveryHandoff.proof.expiresAt': new Date(0) } });
    held.release();
    expect(await pending).toMatchObject({ outcome: 'rejected', refusalCode: 'proof_expired' });
    expect((await stored(p.id))!.status).toBe('ready');
  });
  it('incident bloque la preuve, rotation explicite le lève et invalide le QR précédent', async () => {
    const p = await prepared();
    await service().incidentManager(TENANT, p.id, { operationId: randomUUID(), expectedRevision: 1, expectedMissionRevision: 1, code: 'customer_absent' }, actor);
    expect(await service().getManager(TENANT, p.id, actor)).toMatchObject({ canHandoff: false, canOverride: true });
    await expect(service().customerProof(p.id, { clientId: p.clientId, recoveryProof: purchaser })).rejects.toMatchObject({ status: 409 });
    expect(await service().confirmManager(TENANT, p.id, { ...p.input, expectedRevision: 2 }, actor)).toMatchObject({ refusalCode: 'incident_required' });
    const rotated = await service().rotate(TENANT, p.id, { operationId: randomUUID(), expectedRevision: 3, expectedMissionRevision: 1, reason: 'Client revenu, livraison reprise' }, actor);
    expect(rotated).toMatchObject({ outcome: 'applied', state: { incident: null, canHandoff: true } });
    const nextProof = await service().customerProof(p.id, { clientId: p.clientId, recoveryProof: purchaser });
    expect(nextProof.proofId).not.toBe(p.proof.proofId);
    expect(await service().confirmManager(TENANT, p.id, { ...p.input, operationId: randomUUID(), expectedRevision: 4,
      proof: { kind: 'qr', value: p.proof.qr } }, actor)).toMatchObject({ refusalCode: 'proof_incorrect' });
  });
  it('une livraison historique passe uniquement par incident puis dérogation manager, sans paiement implicite', async () => {
    const p = await seed({ publicRecovery: null, deliveryMission: null });
    const reason = { operationId: randomUUID(), expectedRevision: 0, expectedMissionRevision: 0, reason: 'Client a confirmé la réception au responsable' };
    expect(await service().override(TENANT, p.id, reason, actor)).toMatchObject({ refusalCode: 'incident_required' });
    await service().incidentManager(TENANT, p.id, { operationId: randomUUID(), expectedRevision: 1, expectedMissionRevision: 0, code: 'proof_unavailable' }, actor);
    expect(await service().override(TENANT, p.id, { ...reason, operationId: randomUUID(), expectedRevision: 2 }, actor)).toMatchObject({ outcome: 'applied', state: { orderStatus: 'delivered' } });
    expect((await stored(p.id))!.deliveryHandoff!.completed!.method).toBe('override');
  });
  it.each([{ 'payment.refundedCents': 1 }, { 'payment.pendingRefundCents': 1 }, { 'payment.status': 'pending' }, { 'paymentFlow.phase': 'open' }])('aucune dérogation ne bypass le paiement %s', async fields => {
    const p = await seed();
    await service().incidentManager(TENANT, p.id, { operationId: randomUUID(), expectedRevision: 0, expectedMissionRevision: 1, code: 'proof_unavailable' }, actor);
    await orders.updateOne({ _id: p.id }, { $set: fields, $inc: { __v: 1 } });
    expect(await service().override(TENANT, p.id, { operationId: randomUUID(), expectedRevision: 1, expectedMissionRevision: 1,
      reason: 'Client présent, vérification du responsable' }, actor)).toMatchObject({ outcome: 'rejected', refusalCode: 'payment_blocked' });
    expect((await stored(p.id))!.status).toBe('ready');
  });
  it('isole le restaurant, le livreur, les rôles et la session révoquée', async () => {
    const p = await prepared(); const session = await access.authenticate(token);
    await expect(service().getManager(OTHER, p.id, { ...actor, tenantId: OTHER })).rejects.toMatchObject({ status: 404 });
    await expect(service().getManager(TENANT, p.id, { ...actor, kind: 'staff', role: 'cuisine' })).rejects.toMatchObject({ status: 403 });
    await expect(service().override(TENANT, p.id, { operationId: randomUUID(), expectedRevision: 1, expectedMissionRevision: 1, reason: 'Une raison suffisamment précise' }, { ...actor, kind: 'staff', role: 'caisse' })).rejects.toMatchObject({ status: 403 });
    await orders.updateOne({ _id: p.id }, { $set: { 'deliveryMission.assignment.operatorId': OWNER }, $inc: { __v: 1 } });
    await expect(service().getCourier(session, p.id)).rejects.toMatchObject({ status: 404 });
    await operators.updateOne({ _id: OPERATOR }, { $set: { active: false }, $inc: { revision: 1 } });
    await expect(service().confirmCourier(session, p.id, p.input)).rejects.toMatchObject({ status: 401 });
  });
  it('une révocation croisant l’écriture interdit la restitution mais ne prétend pas annuler le CAS déjà autorisé', async () => {
    const p = await prepared(); const session = await access.authenticate(token);
    const proxy = interceptWrite(orders, undefined, async () => { await operators.updateOne({ _id: OPERATOR }, { $set: { active: false }, $inc: { revision: 1 } }); });
    await expect(service(proxy).confirmCourier(session, p.id, p.input)).rejects.toMatchObject({ status: 401 });
    expect((await stored(p.id))!.status).toBe('delivered');
  });
  it('une panne d’audit après écriture est réparable par le reçu sans secret', async () => {
    const p = await prepared(); audit.logOnce.mockRejectedValueOnce(new Error('audit unavailable'));
    await expect(service().confirmManager(TENANT, p.id, p.input, actor)).rejects.toMatchObject({ status: 503 });
    expect((await stored(p.id))!.status).toBe('delivered');
    expect(await service().resolveManager(TENANT, p.id, resolve(p.input), actor)).toMatchObject({ outcome: 'applied', replay: true });
  });
  it('sans clé dédiée aucun code n’est créé et aucun PIN n’est évalué', async () => {
    const p = await seed(); const disabled = service(orders, new ConfigService({}));
    await expect(disabled.customerProof(p.id, { clientId: p.clientId, recoveryProof: purchaser })).rejects.toMatchObject({ status: 503 });
    expect((await stored(p.id))!.deliveryHandoff).toBeNull();
  });
  it('borne64 sans effacer de reçu, et conserve la reprise connue au plafond', async () => {
    const p = await prepared();
    await service().resolveManager(TENANT, p.id, resolve(p.input), actor);
    const row = await stored(p.id); const op = row!.deliveryHandoff!.operations[0]!;
    const operations = [op, ...Array.from({ length: 63 }, (_, index) => ({ ...op, operationId: randomUUID(), revision: index + 3 }))];
    await orders.updateOne({ _id: p.id }, { $set: { 'deliveryHandoff.operations': operations, 'deliveryHandoff.revision': 65 }, $inc: { __v: 1 } });
    expect(await service().resolveManager(TENANT, p.id, resolve(p.input), actor)).toMatchObject({ outcome: 'abandoned', replay: true });
    await expect(service().resolveManager(TENANT, p.id, { ...resolve(p.input), operationId: randomUUID(), expectedRevision: 65 }, actor)).rejects.toMatchObject({ status: 409, response: { code: 'DELIVERY_HANDOFF_LIMIT' } });
    expect((await stored(p.id))!.deliveryHandoff!.operations).toHaveLength(64);
  });
});
