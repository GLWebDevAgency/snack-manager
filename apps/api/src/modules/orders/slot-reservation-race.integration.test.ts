import { randomUUID } from 'node:crypto';
import mongoose, { type Connection, type Model, type Query } from 'mongoose';
import { MODELS, type Order, type PublicOrderAdmission } from '@sm/db';
import { CreatePublicOrderSchema } from '@sm/contracts';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';
import { PublicOrderAdmissionService } from './public-order-admission.service';
import { PublicOrderGate } from './public-order-gate';
import { SlotsService, type TenantWithId } from '../ordering/slots.service';
import { addDays, parisWallToUtc, parisYmd } from '../ordering/paris-time';
import { capacityModels, seedCapacityFixture } from './order-capacity-test-fixtures';
import { OrderCapacityAvailabilityService } from '../ordering/order-capacity-availability.service';

const TENANT = '507f1f77bcf86cd799439011';
const PRODUCT = '507f1f77bcf86cd799439012';

/** Refuse toute base métier, distante ou fournie avec des options/identifiants. */
export function slotReservationTestDatabase(raw: string): string {
  const url = new URL(raw);
  if (url.protocol !== 'mongodb:' || !['localhost', '127.0.0.1'].includes(url.hostname)
    || url.username || url.password || url.search || url.hash
    || !/^\/snackmanager_slot_test_[a-z0-9_]{1,20}$/i.test(url.pathname)) {
    throw new Error('ORDER_SLOT_TEST_MONGO_URL doit cibler une base isolée locale snackmanager_slot_test_ sans options.');
  }
  url.pathname += `_${randomUUID().replaceAll('-', '').slice(0, 10)}`;
  return url.toString();
}

const uri = process.env.ORDER_SLOT_TEST_MONGO_URL
  ? slotReservationTestDatabase(process.env.ORDER_SLOT_TEST_MONGO_URL) : null;
const integration = uri ? describe : describe.skip;

describe('cible Mongo de la réservation de créneau', () => {
  const credentials = new URL('mongodb://localhost/snackmanager_slot_test_ci');
  credentials.username = 'synthetic-user';
  credentials.password = 'synthetic-password';
  it.each([
    'mongodb://example.com/snackmanager_slot_test_ci',
    'mongodb://localhost/snackmanager',
    'mongodb://localhost/admin',
    'mongodb://localhost/snackmanager_slot_test_ci?replicaSet=production',
    'mongodb://localhost/snackmanager_slot_test_ci#fragment',
    credentials.toString(),
  ])('refuse %s sans I/O', (value) => expect(() => slotReservationTestDatabase(value)).toThrow());
});

function barrier() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => { release = resolve; });
  return { promise, release };
}

/**
 * Seule l'horloge Redis est virtuelle : NX/PX et libération par propriétaire
 * restent effectifs. Ni Date globale ni timers du driver Mongo ne sont simulés.
 */
class ExpiringRedis {
  private now = 0;
  private readonly locks = new Map<string, { owner: string; expiresAt: number }>();
  readonly acquisitions: { key: string; owner: string; ttl: number }[] = [];
  readonly publish = vi.fn().mockResolvedValue(1);

  advance(ms: number) { this.now += ms; }

  get(key: string): string | null {
    const lock = this.locks.get(key);
    if (lock && lock.expiresAt <= this.now) this.locks.delete(key);
    return this.locks.get(key)?.owner ?? null;
  }

  async set(key: string, owner: string, expiry: string, ttl: number, condition: string): Promise<'OK' | null> {
    if (expiry !== 'PX' || condition !== 'NX') throw new Error('Opération Redis non prévue par cette recette');
    if (this.get(key)) return null;
    this.locks.set(key, { owner, expiresAt: this.now + ttl });
    this.acquisitions.push({ key, owner, ttl });
    return 'OK';
  }

  async eval(script: string, keyCount: number, ...args: string[]): Promise<number> {
    if (script.includes('ZREM')) return 1; // Restitution du quota anti-abus, hors invariant testé.
    if (keyCount !== 1 || !script.includes("redis.call('GET'")) throw new Error('Script Redis inattendu');
    const [key, owner] = args;
    if (key && this.get(key) === owner) { this.locks.delete(key); return 1; }
    return 0;
  }
}

/** Suspend une écriture réelle juste AVANT l'envoi du CAS committing au serveur. */
function holdFirstCommit(model: Model<PublicOrderAdmission>, reached: ReturnType<typeof barrier>, resume: ReturnType<typeof barrier>) {
  let armed = true;
  return new Proxy(model, { get(target, property) {
    const value = Reflect.get(target, property, target);
    if (property !== 'updateOne') return typeof value === 'function' ? value.bind(target) : value;
    return (...args: unknown[]) => {
      const query = Reflect.apply(value, target, args) as Query<unknown, PublicOrderAdmission>;
      const run = query.exec.bind(query);
      query.exec = async () => {
        const update = args[1] as { $set?: { state?: string } };
        if (armed && update.$set?.state === 'committing') {
          armed = false;
          reached.release();
          await resume.promise;
        }
        return run();
      };
      return query;
    };
  } });
}

integration('capacité durable après expiration du propriétaire Redis — vrai Mongo', () => {
  let dbA: Connection;
  let dbB: Connection;
  let ordersA: Model<Order>;
  let ordersB: Model<Order>;
  let admissionsA: Model<PublicOrderAdmission>;
  let admissionsB: Model<PublicOrderAdmission>;

  beforeAll(async () => {
    dbA = await mongoose.createConnection(uri!).asPromise();
    dbB = await mongoose.createConnection(uri!).asPromise();
    ordersA = dbA.model(MODELS.Order.name, MODELS.Order.schema, MODELS.Order.collection);
    ordersB = dbB.model(MODELS.Order.name, MODELS.Order.schema, MODELS.Order.collection);
    admissionsA = dbA.model(MODELS.PublicOrderAdmission.name, MODELS.PublicOrderAdmission.schema, MODELS.PublicOrderAdmission.collection);
    admissionsB = dbB.model(MODELS.PublicOrderAdmission.name, MODELS.PublicOrderAdmission.schema, MODELS.PublicOrderAdmission.collection);
    await Promise.all([ordersA.init(), admissionsA.init()]);
  });

  afterAll(async () => {
    if (dbA) { await dbA.dropDatabase(); await dbA.close(); }
    if (dbB) await dbB.close();
    vi.restoreAllMocks();
  });

  it('ne vend pas deux fois la dernière place quand A validating reprend après le commit de B et le TTL 15s', async () => {
    // Arrange : deux connexions indépendantes, un restaurant, une seule place.
    const slot = parisWallToUtc(addDays(parisYmd(new Date()), 1), 18).toISOString();
    // The real application now requires a bootstrapped calendar. Only test
    // fixtures initialize it here; the original one-seat invariant is unchanged.
    await seedCapacityFixture(dbA, TENANT, slot, 1);
    const tenant = {
      _id: TENANT, account: { status: 'active' }, onlineOrdering: true, closures: [],
      hours: Array.from({ length: 7 }, (_, index) => ({ day: index + 1, dinner: { open: '18:00', close: '22:00' } })),
      settings: { onlineOrderingPaused: false, slotIntervalMin: 30, slotCapacity: 1 },
    } as unknown as TenantWithId;
    const bodyA = CreatePublicOrderSchema.parse({
      clientId: randomUUID(), recoveryProof: 'ab'.repeat(32),
      lines: [{ productId: PRODUCT, qty: 1 }], payment: { method: 'counter' },
      pickup: { slot, customerName: 'Camille A', customerPhone: '0612345678' },
      turnstileToken: 'local-proof-only',
    });
    const bodyB = { ...bodyA, clientId: randomUUID(), recoveryProof: 'cd'.repeat(32) };
    const redis = new ExpiringRedis();
    const reached = barrier();
    const resume = barrier();
    let sequence = 0;

    function replica(orders: Model<Order>, admissions: Model<PublicOrderAdmission>) {
      const { days, tenants: tenantModel } = capacityModels(orders.db);
      const admission = new PublicOrderAdmissionService(admissions, orders, redis as never, days, tenantModel);
      const slots = new SlotsService(new OrderCapacityAvailabilityService(tenantModel, days, admissions, orders));
      const gate = new PublicOrderGate({} as never, redis as never);
      // La preuve humaine n'est pas testée : aucun appel Cloudflare, Stripe ou API distante.
      vi.spyOn(gate, 'authorize').mockImplementation(async () => ({
        provider: 'turnstile', hostname: 'localhost', verifiedAt: new Date(),
        quotaReservation: { tenantId: TENANT, id: randomUUID() },
      }));
      const products = { find: () => ({ lean: async () => [{ _id: PRODUCT, name: 'Burger', price: 1250, variants: [], optionGroups: [] }] }) };
      const counters = { findOneAndUpdate: async () => ({ seq: ++sequence }) };
      const promotions = { find: () => ({ lean: async () => [] }) };
      const service = new OrdersService(orders, products as never, counters as never, promotions as never, redis as never,
        {} as never, {} as never, { pourTenant: async () => ['online'] } as never, {} as never, admission);
      const tenants = { bySlug: async () => tenant };
      const quota = { reserve: async () => true, reserveClient: async () => true };
      return new OrdersController(service, {} as never, tenants as never, slots, gate, admission, quota as never);
    }

    const controllerA = replica(ordersA, holdFirstCommit(admissionsA, reached, resume));
    const controllerB = replica(ordersB, admissionsB);
    const requestA = controllerA.createOnline('slot-race', bodyA).then(
      (order) => ({ ok: true as const, order }),
      (error: unknown) => ({ ok: false as const, error }),
    );

    try {
      await Promise.race([reached.promise, requestA.then((outcome) => {
        if (!outcome.ok) throw outcome.error;
        throw new Error('A a terminé avant la barrière committing : la recette ne reproduit plus la fenêtre attendue');
      })]);
      expect(await admissionsB.findOne({ clientId: bodyA.clientId }).select('+snapshot').lean())
        .toMatchObject({ state: 'validating', snapshot: null });
      expect(await ordersB.countDocuments()).toBe(0);
      expect(redis.acquisitions).toHaveLength(1);
      const leaseA = redis.acquisitions[0]!;
      expect(leaseA.ttl).toBe(15_000);
      expect(redis.get(leaseA.key)).toBe(leaseA.owner);

      // Act : expiration effective du verrou, sans timer réel ni reprise de A.
      redis.advance(15_001);
      expect(redis.get(leaseA.key)).toBeNull();
      const winnerB = await controllerB.createOnline('slot-race', bodyB);
      expect(winnerB).toMatchObject({ clientId: bodyB.clientId, pickup: { slot: new Date(slot) } });
      expect(await admissionsB.findOne({ clientId: bodyB.clientId }).lean()).toMatchObject({ state: 'created' });
      expect(await admissionsB.findOne({ clientId: bodyA.clientId }).lean()).toMatchObject({ state: 'validating' });
      expect(await ordersB.countDocuments()).toBe(1);
      expect(redis.acquisitions).toHaveLength(2);
      expect(redis.acquisitions[1]).toMatchObject({ key: leaseA.key, ttl: 15_000 });
      expect(redis.acquisitions[1]?.owner).not.toBe(leaseA.owner);

      resume.release();
      const outcomeA = await requestA;
      expect(outcomeA).toMatchObject({ ok: false, error: { status: 409, response: { code: 'ORDER_ATTEMPT_REJECTED', reason: 'slot_unavailable' } } });

      // Assert : invariant métier, volontairement RED avant C15 (reçu : 2).
      // Ne pas remplacer par une assertion « 2 » ou un it.fails : ce test doit
      // devenir vert grâce à une vraie réservation durable, pas à la fixture.
      const accepted = await ordersB.find({ tenantId: TENANT, 'pickup.slot': new Date(slot), status: { $ne: 'cancelled' } })
        .select('clientId pickup.slot').lean();
      expect(accepted, 'Une seule commande doit occuper la dernière place après reprise du propriétaire expiré').toHaveLength(1);
      expect(await admissionsB.countDocuments({ 'capacity.kitchenSeat': { $type: 'number' } })).toBe(1);
    } finally {
      resume.release();
      await requestA;
    }
  }, 20_000);
});
