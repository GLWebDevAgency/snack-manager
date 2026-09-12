import { randomUUID } from 'node:crypto';
import { ConflictException, ServiceUnavailableException } from '@nestjs/common';
import mongoose, { Types, type Connection, type Model, type Query } from 'mongoose';
import { PromotionSchema, DiningOrderPricingSchema, type Promotion, type DiningOrderPricingRecord } from '@sm/db';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { DINING_PROMOTION_RECEIPT_LIMIT, DiningPricingStore, validateDiningPricingSnapshot, type DiningPricingIdentity, type DiningPricingSnapshot } from './dining-pricing';

const tenant = '507f1f77bcf86cd799439011';
const otherTenant = '507f1f77bcf86cd799439021';
const product = '507f1f77bcf86cd799439012';
const promoId = '507f1f77bcf86cd799439013';
const identity = (): DiningPricingIdentity => ({ operationId: randomUUID(), sessionId: randomUUID(), payloadHash: 'a'.repeat(64) });
const snapshot = (withPromotion = true): DiningPricingSnapshot => ({ subtotal: 1400,
  lines: [{ productId: product, name: 'Plat', variantKey: null, variantName: null, qty: 2, unitPrice: 700, lineTotal: 1400, options: [], removed: [], note: 'Sans sel' }],
  promotion: withPromotion ? { id: promoId, amount: 140, reason: 'Offre locale' } : null });

describe('pricing snapshot boundary', () => {
  it('normalizes BSON identities and copies only resolved recipe fields', () => {
    const value = snapshot(); value.lines[0]!.productId = new Types.ObjectId(product); value.promotion!.id = new Types.ObjectId(promoId);
    expect(validateDiningPricingSnapshot(value)).toEqual(snapshot());
  });
  it.each([null, {}, { ...snapshot(), subtotal: 1500 }, { ...snapshot(), promotion: { id: promoId, reason: 'X', amount: 1401 } },
    { ...snapshot(), lines: [{ ...snapshot().lines[0], qty: 0 }] }])('never reprices malformed durable data', value => {
    expect(() => validateDiningPricingSnapshot(value)).toThrow(ServiceUnavailableException);
  });
});

export function pricingTestDatabase(raw: string) {
  const url = new URL(raw);
  if (url.protocol !== 'mongodb:' || !['127.0.0.1', 'localhost'].includes(url.hostname) || url.username || url.password || url.search || url.hash
    || !/^\/snackmanager_dining_pricing_test_[a-z0-9_]{1,20}$/i.test(url.pathname)) throw Error('Dedicated local pricing test database required');
  url.pathname += '_' + randomUUID().replaceAll('-', '').slice(0, 10);
  return url.toString();
}
describe('pricing fixture database boundary', () => {
  it.each(['mongodb://remote.example/snackmanager_dining_pricing_test_ci', 'mongodb://localhost/snackmanager',
    'mongodb://a:b@localhost/snackmanager_dining_pricing_test_ci', 'mongodb://localhost/snackmanager_dining_pricing_test_ci?replicaSet=production'])('refuses %s before I/O', value => {
    expect(() => pricingTestDatabase(value)).toThrow();
  });
});
const uri = process.env.DINING_PRICING_TEST_MONGO_URL ? pricingTestDatabase(process.env.DINING_PRICING_TEST_MONGO_URL) : null;
const integration = uri ? describe : describe.skip;
function intercept<T>(model: Model<T>, match: (update: Record<string, unknown>) => boolean, effect: (run: () => Promise<unknown>) => Promise<unknown>): Model<T> {
  let armed = true;
  return new Proxy(model, { get(target, property) {
    const value = Reflect.get(target, property, target);
    if (property !== 'updateOne') return typeof value === 'function' ? value.bind(target) : value;
    return (...args: unknown[]) => {
      const query = Reflect.apply(value, target, args) as Query<unknown, T>;
      const run = query.exec.bind(query);
      query.exec = async () => { if (!armed || !match(args[1] as Record<string, unknown>)) return run(); armed = false; return effect(run); };
      return query;
    };
  } });
}
function barrier() { let release!: () => void; const promise = new Promise<void>(resolve => { release = resolve; }); return { promise, release }; }

integration('durable dining pricing and promotion receipts — isolated Mongo', () => {
  let db: Connection, pricing: Model<DiningOrderPricingRecord>, promotions: Model<Promotion>, store: DiningPricingStore;
  beforeAll(async () => {
    db = await mongoose.createConnection(uri!).asPromise();
    pricing = db.model<DiningOrderPricingRecord>('DiningPricingTest', DiningOrderPricingSchema, 'dining_order_pricing');
    promotions = db.model<Promotion>('PricingPromotionTest', PromotionSchema, 'promotions');
    await Promise.all([pricing.init(), promotions.init()]);
    store = new DiningPricingStore(pricing, promotions);
  });
  beforeEach(async () => {
    await Promise.all([pricing.collection.deleteMany({}), promotions.collection.deleteMany({})]);
    await promotions.collection.insertOne({ _id: new Types.ObjectId(promoId), tenantId: new Types.ObjectId(tenant), name: 'Offre', kind: 'percent', value: 10,
      active: true, maxUsage: 1, usageCount: 0, diningReservations: [] } as never);
  });
  afterAll(async () => { if (db) { if (!/^snackmanager_dining_pricing_test_[a-z0-9_]+$/i.test(db.name)) throw Error('Unsafe cleanup refused'); await db.dropDatabase(); await db.close(); } });
  const count = async () => (await promotions.findById(promoId))!.usageCount;
  const receipts = async () => (await promotions.findById(promoId).select('+diningReservations'))!.diningReservations;
  const resolve = (id: DiningPricingIdentity, value = snapshot()) => store.resolve(tenant, id, async () => value);

  it('freezes one winning snapshot across concurrent calculations and subsequent menu changes', async () => {
    const id = identity(); const next = snapshot(false); next.lines[0]!.name = 'Renommé';
    const values = await Promise.all([resolve(id), resolve(id, next)]);
    expect(values[0]).toEqual(values[1]);
    const build = vi.fn(async () => next);
    expect(await store.resolve(tenant, id, build)).toEqual(values[0]); expect(build).not.toHaveBeenCalled();
    expect(await pricing.countDocuments({})).toBe(1);
  });
  it('retains the chosen null promotion instead of adopting a later offer', async () => {
    const id = identity(); await resolve(id, snapshot(false));
    const value = await resolve(id); expect(value.promotion).toBeNull();
    expect(await store.reserve(tenant, id, value)).toBeNull(); expect(await count()).toBe(0);
  });
  it('adopts a concurrent committed snapshot when its slower menu read fails', async () => {
    const id = identity(), entered = barrier(), resume = barrier();
    const slow = store.resolve(tenant, id, async () => { entered.release(); await resume.promise; throw new ConflictException('Stock changed'); });
    await entered.promise; const value = await resolve(id); resume.release();
    expect(await slow).toEqual(value);
  });
  it('reserves once across concurrent helpers and repeated recovery at the last usage', async () => {
    const id = identity(), value = await resolve(id);
    const results = await Promise.all(Array.from({ length: 6 }, () => store.reserve(tenant, id, value)));
    expect(results.every(result => result?.discount.amount === 140)).toBe(true);
    expect(await count()).toBe(1); expect(await receipts()).toHaveLength(1);
    expect((await store.reserve(tenant, id, value))?.discount.amount).toBe(140);
  });
  it('recovers lost pricing and quota acknowledgements without reselecting or reincrementing', async () => {
    const id = identity();
    const lostPricing = new DiningPricingStore(intercept(pricing, update => Boolean(update.$setOnInsert), async run => { await run(); throw Error('Lost ACK'); }), promotions);
    const value = await lostPricing.resolve(tenant, id, async () => snapshot());
    const lostQuota = new DiningPricingStore(pricing, intercept(promotions, update => Boolean(update.$inc), async run => { await run(); throw Error('Lost ACK'); }));
    expect((await lostQuota.reserve(tenant, id, value))?.discount.amount).toBe(140);
    expect(await count()).toBe(1);
  });
  it('does not reserve when pricing insertion never reached the database', async () => {
    const blocked = new Proxy(pricing, { get(target, property) { const value = Reflect.get(target, property, target); return property === 'updateOne' ? () => Promise.reject(Error('Disconnected')) : typeof value === 'function' ? value.bind(target) : value; } });
    await expect(new DiningPricingStore(blocked, promotions).resolve(tenant, identity(), async () => snapshot())).rejects.toThrow(ServiceUnavailableException);
    expect(await count()).toBe(0);
  });
  it('never changes the frozen price into a full-price ticket when a distinct operation takes the last usage', async () => {
    const one = identity(), two = identity(); const first = await resolve(one), second = await resolve(two);
    await store.reserve(tenant, one, first);
    await expect(store.reserve(tenant, two, second)).rejects.toThrow(ConflictException);
    await store.release(tenant, two);
    expect(await count()).toBe(1); expect((await receipts()).find(entry => entry.operationId === two.operationId)?.state).toBe('released');
  });
  it('releases exactly once even when acknowledgement is lost and multiple helpers retry', async () => {
    const id = identity(), value = await resolve(id); await store.reserve(tenant, id, value);
    const lost = new DiningPricingStore(pricing, intercept(promotions, update => Boolean(update.$inc), async run => { await run(); throw Error('Lost release ACK'); }));
    await Promise.all([lost.release(tenant, id), store.release(tenant, id), store.release(tenant, id)]);
    expect(await count()).toBe(0); expect(await receipts()).toHaveLength(1); expect((await receipts())[0]!.state).toBe('released');
    await expect(store.reserve(tenant, id, value)).rejects.toThrow(ConflictException);
  });
  it('fences a delayed pricing insert when release arrives before any snapshot', async () => {
    const entered = barrier(), resume = barrier(), id = identity();
    const slow = new DiningPricingStore(intercept(pricing, update => Boolean(update.$setOnInsert), async run => { entered.release(); await resume.promise; return run(); }), promotions);
    const work = slow.resolve(tenant, id, async () => snapshot()); const refused = expect(work).rejects.toThrow(ConflictException);
    await entered.promise; await store.release(tenant, id); resume.release(); await refused;
    expect(await count()).toBe(0); expect((await pricing.findOne({ operationId: id.operationId }))?.released).toBe(true);
  });
  it('fences a delayed quota reservation with a released receipt even when no reservation was visible', async () => {
    const entered = barrier(), resume = barrier(), id = identity(), value = await resolve(id);
    const slow = new DiningPricingStore(pricing, intercept(promotions, update => Boolean(update.$inc), async run => { entered.release(); await resume.promise; return run(); }));
    const work = slow.reserve(tenant, id, value); const refused = expect(work).rejects.toThrow(ConflictException);
    await entered.promise; await store.release(tenant, id); resume.release(); await refused;
    expect(await count()).toBe(0); expect(await receipts()).toHaveLength(1); expect((await receipts())[0]!.state).toBe('released');
  });
  it('refuses another session/body and isolates tenants before any quota change', async () => {
    const id = identity(); const value = await resolve(id);
    await expect(resolve({ ...id, sessionId: randomUUID() })).rejects.toThrow(ConflictException);
    await expect(resolve({ ...id, payloadHash: 'b'.repeat(64) })).rejects.toThrow(ConflictException);
    await expect(store.reserve(otherTenant, id, value)).rejects.toThrow(ServiceUnavailableException);
    expect(await count()).toBe(0);
    await store.release(tenant, id);
    await expect(resolve({ ...id, sessionId: randomUUID() })).rejects.toMatchObject({ response: { code: 'DINING_PRICING_IDENTITY_CONFLICT' } });
  });
  it('never releases a different session or body sharing the operation UUID', async () => {
    const id = identity(), value = await resolve(id); await store.reserve(tenant, id, value);
    for (const foreign of [{ ...id, sessionId: randomUUID() }, { ...id, payloadHash: 'b'.repeat(64) }]) {
      await expect(store.release(tenant, foreign)).rejects.toMatchObject({ response: { code: 'DINING_PRICING_IDENTITY_CONFLICT' } });
    }
    expect((await pricing.findOne({ operationId: id.operationId }))?.released).toBe(false);
    expect(await count()).toBe(1); expect((await receipts())[0]!.state).toBe('reserved');
    await store.release(tenant, id);
    await expect(store.release(tenant, { ...id, sessionId: randomUUID() })).rejects.toMatchObject({ response: { code: 'DINING_PRICING_IDENTITY_CONFLICT' } });
    expect(await count()).toBe(0);
  });
  it('fences a foreign pricing insert racing an earlier release request before its write', async () => {
    const id = identity(), foreign = { ...id, sessionId: randomUUID() }, entered = barrier(), resume = barrier();
    const slow = new DiningPricingStore(intercept(pricing, update => Boolean(update.$set), async run => { entered.release(); await resume.promise; return run(); }), promotions);
    const work = slow.release(tenant, foreign);
    const refused = expect(work).rejects.toMatchObject({ response: { code: 'DINING_PRICING_IDENTITY_CONFLICT' } });
    await entered.promise;
    const value = await resolve(id); await store.reserve(tenant, id, value);
    resume.release(); await refused;
    expect((await pricing.findOne({ operationId: id.operationId }))?.released).toBe(false);
    expect(await count()).toBe(1); expect((await receipts())[0]!.state).toBe('reserved');
  });
  it('retains the identity of a release tombstone when another session later prices that UUID', async () => {
    const id = identity(); await store.release(tenant, id);
    const record = await pricing.findOne({ operationId: id.operationId });
    expect(record).toMatchObject({ sessionId: id.sessionId, payloadHash: id.payloadHash, released: true, snapshot: null });
    await expect(resolve({ ...id, sessionId: randomUUID() })).rejects.toMatchObject({ response: { code: 'DINING_PRICING_IDENTITY_CONFLICT' } });
    expect(await count()).toBe(0);
  });
  it('preserves a corrupt snapshot instead of overwriting it and silently repricing', async () => {
    const id = identity(); await resolve(id); await pricing.updateOne({ operationId: id.operationId }, { $set: { 'snapshot.subtotal': 999 } });
    const build = vi.fn(async () => snapshot());
    await expect(store.resolve(tenant, id, build)).rejects.toThrow(ServiceUnavailableException);
    expect(build).not.toHaveBeenCalled(); expect(await count()).toBe(0);
  });
  it('bounds the campaign receipt journal without altering its quota', async () => {
    await promotions.collection.updateOne({ _id: new Types.ObjectId(promoId) }, { $set: { diningReservations: Array.from({ length: DINING_PROMOTION_RECEIPT_LIMIT }, () => ({ operationId: randomUUID(), payloadHash: 'a'.repeat(64), state: 'released', at: new Date(), releasedAt: new Date() })) } });
    const id = identity(), value = await resolve(id);
    await expect(store.reserve(tenant, id, value)).rejects.toThrow(/journal.*complet/);
    await store.release(tenant, id);
    expect(await count()).toBe(0); expect(await receipts()).toHaveLength(DINING_PROMOTION_RECEIPT_LIMIT);
  });
});
