import { randomUUID } from 'node:crypto';
import mongoose, { Types, type Connection, type Model, type Query } from 'mongoose';
import { MODELS, type Order, type PublicOrderAdmission } from '@sm/db';
import { CreateOrderSchema, CreatePublicOrderSchema } from '@sm/contracts';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PublicOrderAdmissionService } from './public-order-admission.service';
import { publicRecoveryBinding } from './order-recovery';
import { OrdersService } from './orders.service';
import { OrdersController } from './orders.controller';
import { ConflictException } from '@nestjs/common';

const tenantId = '507f1f77bcf86cd799439011';
const productId = '507f1f77bcf86cd799439012';
const body = CreatePublicOrderSchema.parse({ clientId: '11111111-1111-4111-8111-111111111111', recoveryProof: 'ab'.repeat(32), lines: [{ productId, qty: 1 }], payment: { method: 'counter' }, pickup: { slot: '2026-09-07T18:00:00.000Z', customerName: 'Camille', customerPhone: '0612345678' }, turnstileToken: 'transient' });
const binding = publicRecoveryBinding(tenantId, body)!;

export function recoveryTestDatabase(raw: string): string {
  const url = new URL(raw);
  if (url.protocol !== 'mongodb:' || !['localhost', '127.0.0.1'].includes(url.hostname) || url.username || url.password || url.search || url.hash
    || !/^\/snackmanager_recovery_test_[a-z0-9_]{1,20}$/i.test(url.pathname)) throw new Error('ORDER_RECOVERY_TEST_MONGO_URL doit cibler une base isolée locale snackmanager_recovery_test_ sans options.');
  url.pathname += `_${randomUUID().replaceAll('-', '').slice(0, 10)}`;
  return url.toString();
}
const uri = process.env.ORDER_RECOVERY_TEST_MONGO_URL ? recoveryTestDatabase(process.env.ORDER_RECOVERY_TEST_MONGO_URL) : null;
const integration = uri ? describe : describe.skip;

describe('cible Mongo de la reprise', () => {
  it.each(['mongodb://example.com/snackmanager_recovery_test_ci', 'mongodb://localhost/snackmanager', 'mongodb://localhost/admin', 'mongodb://user:pass@localhost/snackmanager_recovery_test_ci', 'mongodb://localhost/snackmanager_recovery_test_ci?replicaSet=prod'])('refuse %s sans I/O', (value) => expect(() => recoveryTestDatabase(value)).toThrow());
});

function barrier() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => { release = resolve; });
  return { promise, release };
}

function interceptUpdate<T>(model: Model<T>, match: (update: Record<string, unknown>) => boolean, effect: (run: () => Promise<unknown>) => Promise<unknown>): Model<T> {
  let armed = true;
  return new Proxy(model, { get(target, property) {
    const value = Reflect.get(target, property, target);
    if (property !== 'updateOne') return typeof value === 'function' ? value.bind(target) : value;
    return (...args: unknown[]) => {
      const query = Reflect.apply(value, target, args) as Query<unknown, T>;
      const run = query.exec.bind(query);
      query.exec = async () => {
        if (!armed || !match(args[1] as Record<string, unknown>)) return run();
        armed = false;
        return effect(run);
      };
      return query;
    };
  } });
}
const committing = (update: Record<string, unknown>) => (update.$set as { state?: string } | undefined)?.state === 'committing';

integration('admission publique durable — vrai Mongo indépendant du paiement', () => {
  let db1: Connection; let db2: Connection;
  let orders: Model<Order>; let orders2: Model<Order>;
  let admissions: Model<PublicOrderAdmission>; let admissions2: Model<PublicOrderAdmission>;
  const redis = { publish: vi.fn().mockResolvedValue(1) };
  let first: PublicOrderAdmissionService; let second: PublicOrderAdmissionService;
  beforeAll(async () => {
    db1 = await mongoose.createConnection(uri!).asPromise();
    db2 = await mongoose.createConnection(uri!).asPromise();
    orders = db1.model(MODELS.Order.name, MODELS.Order.schema, MODELS.Order.collection);
    orders2 = db2.model(MODELS.Order.name, MODELS.Order.schema, MODELS.Order.collection);
    admissions = db1.model(MODELS.PublicOrderAdmission.name, MODELS.PublicOrderAdmission.schema, MODELS.PublicOrderAdmission.collection);
    admissions2 = db2.model(MODELS.PublicOrderAdmission.name, MODELS.PublicOrderAdmission.schema, MODELS.PublicOrderAdmission.collection);
    await Promise.all([orders.init(), admissions.init()]);
  });
  beforeEach(async () => {
    await Promise.all([orders.deleteMany({}), admissions.deleteMany({})]);
    redis.publish.mockClear();
    first = new PublicOrderAdmissionService(admissions, orders, redis as never);
    second = new PublicOrderAdmissionService(admissions2, orders2, redis as never);
  });
  afterAll(async () => {
    if (db1) { await db1.dropDatabase(); await db1.close(); }
    if (db2) await db2.close();
  });

  const candidate = () => ({ _id: new Types.ObjectId(), tenantId, clientId: body.clientId, channel: 'online', type: 'pickup', number: 12, lines: [], totals: { subtotal: 1250, total: 1250 }, payment: { method: 'counter', status: 'pending' }, trackingToken: 'original-tracking-token', pickup: { ...body.pickup, slot: new Date(body.pickup.slot) }, status: 'new', statusHistory: [{ status: 'new', at: new Date(), by: 'online:turnstile' }] });
  async function owned() {
    await first.begin(tenantId, body);
    return (await first.claimValidation(tenantId, body.clientId, binding))!;
  }
  function writer(service = first, model = orders, discount = 0) {
    const products = { find: vi.fn(() => ({ lean: async () => [{ _id: productId, name: 'Burger', price: 1250, variants: [], optionGroups: [] }] })) };
    const counters = { findOneAndUpdate: vi.fn().mockResolvedValue({ seq: 12 }) };
    const promotions = { find: vi.fn(() => ({ lean: async () => discount ? [{ _id: new Types.ObjectId('507f1f77bcf86cd799439099'), name: 'Bienvenue', kind: 'amount', value: discount, active: true, channels: ['online'], code: null }] : [] })), findOneAndUpdate: vi.fn().mockResolvedValue({ usageCount: 1 }), updateOne: vi.fn().mockResolvedValue({ modifiedCount: 1 }) };
    const instance = new OrdersService(model, products as never, counters as never, promotions as never, redis as never, {} as never, {} as never, { pourTenant: async () => ['online'] } as never, {} as never, service);
    const dto = CreateOrderSchema.parse({ ...body, type: 'pickup', channel: 'online' });
    return { instance, products, counters, promotions, dto };
  }

  it('un seul validateur malgré deux répliques et une seule admission', async () => {
    await Promise.all([first.begin(tenantId, body), second.begin(tenantId, body)]);
    const owners = await Promise.all([first.claimValidation(tenantId, body.clientId, binding), second.claimValidation(tenantId, body.clientId, binding)]);
    expect(owners.filter(Boolean)).toHaveLength(1);
    expect(await admissions.countDocuments()).toBe(1);
  });
  it('échec avant création libère uniquement son validateur, sans lease ni nouvelle clé', async () => {
    const owner = await owned();
    await first.releaseValidation(tenantId, body.clientId, owner);
    const replacement = await second.claimValidation(tenantId, body.clientId, binding);
    expect(replacement?.validationOwner).toBeTruthy();
    expect(replacement?.validationOwner).not.toBe(owner.validationOwner);
    await first.releaseValidation(tenantId, body.clientId, owner);
    expect(await first.claimValidation(tenantId, body.clientId, binding)).toBeNull();
    expect(await orders.countDocuments()).toBe(0);
  });
  it('snapshot et commande contiennent la preuve atomiquement, jamais dans HTTP/WS', async () => {
    const owner = await owned(); const row = candidate();
    await first.commit(tenantId, body.clientId, owner, row);
    const receipt = await second.recover(tenantId, body.clientId, body.recoveryProof!);
    expect(receipt).toMatchObject({ state: 'created', order: { _id: String(row._id), trackingToken: row.trackingToken, totals: { total: 1250 }, payment: { status: 'pending' } } });
    const stored = await orders.findById(row._id).select('+publicRecovery');
    expect(stored?.publicRecovery?.proofHash).toBe(binding.proofHash);
    expect(stored?.toObject()).not.toHaveProperty('publicRecovery');
    expect(stored?.toJSON()).not.toHaveProperty('publicRecovery');
    expect(await admissions.findOne().select('+snapshot').lean()).toMatchObject({ state: 'created', snapshot: null, orderId: row._id });
    expect(JSON.stringify(redis.publish.mock.calls)).not.toMatch(/proofHash|payloadHash|publicRecovery|customerRecovery/);
  });
  it('inconnu, mauvais tenant, mauvaise preuve et legacy donnent tous404', async () => {
    await owned();
    for (const [tenant, clientId, proof] of [[tenantId, body.clientId, 'cd'.repeat(32)], ['507f1f77bcf86cd799439022', body.clientId, body.recoveryProof!], [tenantId, randomUUID(), body.recoveryProof!]]) {
      await expect(second.recover(tenant!, clientId!, proof!)).rejects.toMatchObject({ status: 404 });
    }
    await admissions.deleteMany({});
    await orders.create(candidate());
    await expect(first.begin(tenantId, body)).rejects.toMatchObject({ status: 404 });
    await expect(first.recover(tenantId, body.clientId, body.recoveryProof!)).rejects.toMatchObject({ status: 404 });
    expect(await admissions.countDocuments()).toBe(0);
  });
  it('même preuve et corps modifié409 ; preuve modifiée404 sans modification', async () => {
    await owned();
    await expect(second.begin(tenantId, { ...body, note: 'différent' })).rejects.toMatchObject({ status: 409 });
    await expect(second.begin(tenantId, { ...body, recoveryProof: 'cd'.repeat(32) })).rejects.toMatchObject({ status: 404 });
    expect(await admissions.countDocuments()).toBe(1);
    expect(await orders.countDocuments()).toBe(0);
  });
  it('rejet durable puis requête tardive ne peut jamais créer', async () => {
    const owner = await owned();
    expect(await second.reject(tenantId, body.clientId, binding, 'abandoned')).toMatchObject({ state: 'rejected', reason: 'abandoned' });
    await expect(first.commit(tenantId, body.clientId, owner, candidate())).rejects.toMatchObject({ status: 409 });
    expect(await first.begin(tenantId, body)).toMatchObject({ state: 'rejected' });
    expect(await orders.countDocuments()).toBe(0);
  });
  it('abandon gagne devant un CAScommit suspendu : aucune insertion tardive', async () => {
    const owner = await owned(); const reached = barrier(); const release = barrier();
    const held = interceptUpdate(admissions, committing, async (run) => { reached.release(); await release.promise; return run(); });
    const delayed = new PublicOrderAdmissionService(held, orders, redis as never).commit(tenantId, body.clientId, owner, candidate());
    const outcome = delayed.then(() => null, (error: unknown) => error);
    await reached.promise;
    await second.reject(tenantId, body.clientId, binding, 'abandoned');
    release.release();
    expect(await outcome).toMatchObject({ status: 409 });
    expect(await orders.countDocuments()).toBe(0);
  });
  it('commit engagé puis interruption avant insert : seconde instance reprend sans recalcul', async () => {
    const owner = await owned(); const row = candidate();
    const brokenOrders = interceptUpdate(orders, () => true, async () => { throw new Error('crash avant insert'); });
    await expect(new PublicOrderAdmissionService(admissions, brokenOrders, redis as never).commit(tenantId, body.clientId, owner, row)).rejects.toThrow('crash');
    expect(await orders.countDocuments()).toBe(0);
    expect(await admissions.findOne().lean()).toMatchObject({ state: 'committing' });
    const recovered = await second.reject(tenantId, body.clientId, binding, 'abandoned');
    expect(recovered).toMatchObject({ state: 'created', order: { _id: String(row._id), trackingToken: row.trackingToken, totals: { total: 1250 } } });
    expect(await orders.countDocuments()).toBe(1);
  });
  it('réponse CAScommit perdue après effet réel : même snapshot, jamais rejected', async () => {
    const owner = await owned(); const row = candidate();
    const lost = interceptUpdate(admissions, committing, async (run) => { await run(); throw new Error('réponse perdue'); });
    await expect(new PublicOrderAdmissionService(lost, orders, redis as never).commit(tenantId, body.clientId, owner, row)).resolves.toMatchObject({ created: true });
    expect(await orders.countDocuments()).toBe(1);
    expect(await second.recover(tenantId, body.clientId, body.recoveryProof!)).toMatchObject({ state: 'created' });
  });
  it('réponse insertion perdue après effet réel : conserve id/prix/token', async () => {
    const owner = await owned(); const row = candidate();
    const lost = interceptUpdate(orders, () => true, async (run) => { await run(); throw new Error('réponse perdue'); });
    await expect(new PublicOrderAdmissionService(admissions, lost, redis as never).commit(tenantId, body.clientId, owner, row)).resolves.toMatchObject({ created: true });
    expect((await orders.findOne().lean())?._id).toEqual(row._id);
    expect(await orders.countDocuments()).toBe(1);
  });
  it('deux helpers matérialisent une seule commande et le rejeu ne ressuscite pas paid/delivered', async () => {
    const owner = await owned(); const row = candidate();
    const broken = interceptUpdate(orders, () => true, async () => { throw new Error('before insert'); });
    await expect(new PublicOrderAdmissionService(admissions, broken, redis as never).commit(tenantId, body.clientId, owner, row)).rejects.toThrow();
    await Promise.all([first.recover(tenantId, body.clientId, body.recoveryProof!), second.recover(tenantId, body.clientId, body.recoveryProof!)]);
    await orders.updateOne({ _id: row._id }, { $set: { status: 'delivered', 'payment.status': 'paid' } });
    expect(await first.recover(tenantId, body.clientId, body.recoveryProof!)).toMatchObject({ state: 'created', order: { status: 'delivered', payment: { status: 'paid' } } });
    expect(await orders.countDocuments()).toBe(1);
  });
  it('un helper suspendu avant insert reprend APRÈS encaissement/remise sans réinitialiser le ticket', async () => {
    const owner = await owned(); const row = candidate(); const reached = barrier(); const resume = barrier();
    const held = interceptUpdate(orders, () => true, async (run) => { reached.release(); await resume.promise; return run(); });
    const pending = new PublicOrderAdmissionService(admissions, held, redis as never).commit(tenantId, body.clientId, owner, row);
    await reached.promise;
    await second.recover(tenantId, body.clientId, body.recoveryProof!);
    await orders2.updateOne({ _id: row._id }, { $set: { status: 'delivered', 'payment.status': 'paid' }, $push: { statusHistory: { status: 'delivered', at: new Date(), by: 'staff' } } });
    resume.release();
    expect((await pending).order).toMatchObject({ status: 'delivered', payment: { status: 'paid' } });
    expect((await orders.findById(row._id).lean())?.statusHistory).toHaveLength(2);
    expect(await orders.countDocuments()).toBe(1);
  });
  it('matérialise les réservations engagées avant le prochain comptage du créneau', async () => {
    const owner = await owned();
    const broken = interceptUpdate(orders, () => true, async () => { throw new Error('before insert'); });
    await expect(new PublicOrderAdmissionService(admissions, broken, redis as never).commit(tenantId, body.clientId, owner, candidate())).rejects.toThrow();
    expect(await orders.countDocuments()).toBe(0);
    await second.materializeSlot(tenantId, body.pickup.slot);
    expect(await orders.countDocuments({ 'pickup.slot': new Date(body.pickup.slot) })).toBe(1);
  });
  it('le vrai createWithOutcome réserve une fois et garde la promotion du snapshot engagé', async () => {
    const owner = await owned();
    const broken = interceptUpdate(orders, () => true, async () => { throw new Error('before insert'); });
    const admissionService = new PublicOrderAdmissionService(admissions, broken, redis as never);
    const ctx = writer(admissionService, orders, 100);
    await expect(ctx.instance.createWithOutcome(tenantId, ctx.dto, 'online:turnstile', null, owner)).rejects.toThrow();
    expect(ctx.promotions.findOneAndUpdate).toHaveBeenCalledOnce();
    expect(ctx.promotions.updateOne).not.toHaveBeenCalled();
    expect(await second.recover(tenantId, body.clientId, body.recoveryProof!)).toMatchObject({ state: 'created', order: { totals: { total: 1150 } } });
    expect(ctx.counters.findOneAndUpdate).toHaveBeenCalledOnce();
    expect(ctx.promotions.findOneAndUpdate).toHaveBeenCalledOnce();
  });
  it('la création directe historique ne contourne jamais une admission protégée', async () => {
    await owned(); const ctx = writer();
    await expect(ctx.instance.createWithOutcome(tenantId, ctx.dto, 'client')).rejects.toMatchObject({ status: 404 });
    expect(ctx.products.find).not.toHaveBeenCalled();
    expect(await orders.countDocuments()).toBe(0);
  });
  it('abandon pendant réservation promo gagne : aucune vente et seule réservation perdante rendue', async () => {
    const owner = await owned(); const ctx = writer(first, orders, 100); const reached = barrier(); const resume = barrier();
    ctx.counters.findOneAndUpdate.mockImplementationOnce(async () => { reached.release(); await resume.promise; return { seq: 12 }; });
    const pending = ctx.instance.createWithOutcome(tenantId, ctx.dto, 'online:turnstile', null, owner).then(() => null, (error: unknown) => error);
    await reached.promise;
    await second.reject(tenantId, body.clientId, binding, 'abandoned');
    resume.release();
    expect(await pending).toMatchObject({ status: 409 });
    expect(ctx.promotions.updateOne).toHaveBeenCalledOnce();
    expect(await orders.countDocuments()).toBe(0);
  });
  it('vrai contrôleur→admission : créneau refusé terminal, requête tardive bloquée, nouvelle clé volontaire autorisée', async () => {
    const ctx = writer();
    const tenant = { _id: tenantId, account: { status: 'active' }, onlineOrdering: true, settings: { onlineOrderingPaused: false } };
    const tenants = { bySlug: vi.fn().mockResolvedValue(tenant) };
    const slots = { exigerDisponible: vi.fn().mockRejectedValueOnce(new ConflictException('plein')).mockResolvedValue(undefined) };
    const gate = { authorize: vi.fn().mockResolvedValue({ quotaReservation: {} }), release: vi.fn(), serializeSlot: vi.fn(async (_input: unknown, run: () => unknown) => run()) };
    const quota = { reserve: vi.fn().mockResolvedValue(true), reserveClient: vi.fn().mockResolvedValue(true) };
    const controller = new OrdersController(ctx.instance, {} as never, tenants as never, slots as never, gate as never, first, quota as never);
    await expect(controller.createOnline('classfood', body)).rejects.toMatchObject({ status: 409, response: { code: 'ORDER_ATTEMPT_REJECTED', reason: 'slot_unavailable' } });
    expect(await second.recover(tenantId, body.clientId, body.recoveryProof!)).toMatchObject({ state: 'rejected', reason: 'slot_unavailable' });
    await expect(controller.createOnline('classfood', body)).rejects.toMatchObject({ status: 409 });
    expect(await orders.countDocuments()).toBe(0);
    const next = { ...body, clientId: randomUUID(), recoveryProof: 'cd'.repeat(32) };
    const created = await controller.createOnline('classfood', next);
    expect(created).toMatchObject({ totals: { subtotal: 1250, total: 1250 }, pickup: { customerName: 'Camille' }, lines: [{ name: 'Burger' }] });
    tenants.bySlug.mockResolvedValue({ ...tenant, onlineOrdering: false, settings: { onlineOrderingPaused: true } });
    expect(await controller.createOnline('classfood', next)).toMatchObject({ _id: (created as { _id: unknown })._id, totals: { subtotal: 1250, total: 1250 }, lines: [{ name: 'Burger' }] });
    expect(await orders.countDocuments()).toBe(1);
    expect(ctx.counters.findOneAndUpdate).toHaveBeenCalledOnce();
  });
  it('les lectures publiques legacy refusent une commande protégée, la lecture staff reste inchangée', async () => {
    const owner = await owned(); await first.commit(tenantId, body.clientId, owner, candidate());
    const ctx = writer();
    await expect(ctx.instance.findPublicReplay(tenantId, body.clientId)).rejects.toMatchObject({ status: 404 });
    expect((await ctx.instance.findByClientId(tenantId, body.clientId))?.trackingToken).toBe('original-tracking-token');
  });
});
