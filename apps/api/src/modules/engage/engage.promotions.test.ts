import { randomUUID } from 'node:crypto';
import { NotFoundException } from '@nestjs/common';
import mongoose, { Types, type Connection, type Model, type Query } from 'mongoose';
import { MODELS, type Promotion, type Review } from '@sm/db';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { EngageService } from './engage.service';

const tenantId = '507f1f77bcf86cd799439011';
const promotionId = '507f1f77bcf86cd799439012';
const otherTenantId = '507f1f77bcf86cd799439013';
const service = (promotions: Model<Promotion>) => new EngageService(promotions, {} as Model<Review>);

/** Base neuve exclusivement locale ; jamais la base passée telle quelle. */
function isolatedTestDatabase(raw: string): string {
  const url = new URL(raw);
  if (url.protocol !== 'mongodb:' || !['localhost', '127.0.0.1'].includes(url.hostname)
    || url.username || url.password || url.search || url.hash
    || !/^\/snackmanager_engage_test_[a-z0-9_]{1,20}$/i.test(url.pathname)) {
    throw new Error('ENGAGE_TEST_MONGO_URL doit viser une base locale isolée snackmanager_engage_test_ sans options ni identifiants.');
  }
  url.pathname += `_${randomUUID().replaceAll('-', '').slice(0, 10)}`;
  return url.toString();
}

describe('toggle promotion — garde et échecs', () => {
  it.each([
    'mongodb://example.com/snackmanager_engage_test_ci',
    'mongodb://localhost/snackmanager',
    'mongodb://localhost/admin',
    'mongodb://localhost/snackmanager_engage_test_ci?replicaSet=prod',
  ])('refuse la cible non isolée %s sans connexion', (raw) => {
    expect(() => isolatedTestDatabase(raw)).toThrow('ENGAGE_TEST_MONGO_URL');
  });

  it('rend404 sans lecture ni sauvegarde pour une promotion absente', async () => {
    const findOneAndUpdate = vi.fn().mockResolvedValue(null);
    const findOne = vi.fn();
    await expect(service({ findOneAndUpdate, findOne } as unknown as Model<Promotion>)
      .togglePromotion(tenantId, promotionId)).rejects.toBeInstanceOf(NotFoundException);
    expect(findOne).not.toHaveBeenCalled();
    expect(findOneAndUpdate).toHaveBeenCalledOnce();
    expect(findOneAndUpdate.mock.calls[0]?.[0]).toEqual({ _id: promotionId, tenantId });
  });

  it('ne rejoue jamais automatiquement une bascule dont la réponse est perdue', async () => {
    const error = new Error('Résultat de bascule inconnu');
    const findOneAndUpdate = vi.fn().mockRejectedValue(error);
    const findOne = vi.fn();
    await expect(service({ findOneAndUpdate, findOne } as unknown as Model<Promotion>)
      .togglePromotion(tenantId, promotionId)).rejects.toBe(error);
    expect(findOne).not.toHaveBeenCalled();
    expect(findOneAndUpdate).toHaveBeenCalledOnce();
  });
});

const uri = process.env.ENGAGE_TEST_MONGO_URL ? isolatedTestDatabase(process.env.ENGAGE_TEST_MONGO_URL) : null;
const integration = uri ? describe : describe.skip;

/** Intercale un vrai $inc après l'ancienne hydratation, ou avant le nouveau write. */
function reserveBeforeToggle(model: Model<Promotion>): Model<Promotion> {
  return new Proxy(model, {
    get(target, property) {
      const method = Reflect.get(target, property, target);
      if (property !== 'findOne' && property !== 'findOneAndUpdate') {
        return typeof method === 'function' ? method.bind(target) : method;
      }
      return (...args: unknown[]) => {
        const query = Reflect.apply(method, target, args) as Query<unknown, Promotion>;
        const execute = query.exec.bind(query);
        const reserve = () => target.collection.updateOne({ _id: new Types.ObjectId(promotionId) }, { $inc: { usageCount: 1 } });
        query.exec = async () => {
          if (property === 'findOne') {
            const hydrated = await execute();
            await reserve();
            return hydrated;
          }
          await reserve();
          return execute();
        };
        return query;
      };
    },
  });
}

integration('toggle promotion — vrai Mongo et hydratation historique', () => {
  let db: Connection;
  let promotions: Model<Promotion>;
  beforeAll(async () => {
    db = await mongoose.createConnection(uri!).asPromise();
    promotions = db.model(MODELS.Promotion.name, MODELS.Promotion.schema, MODELS.Promotion.collection);
    await promotions.init();
  });
  beforeEach(async () => { await promotions.deleteMany({}); });
  afterAll(async () => {
    if (db) {
      try { await db.dropDatabase(); } finally { await db.close(); }
    }
  });

  const raw = () => promotions.collection.findOne({ _id: new Types.ObjectId(promotionId) });
  async function insert(over: Record<string, unknown> = {}) {
    // Collection native : les champs absents doivent RESTER absents en base.
    await promotions.collection.insertOne({ _id: new Types.ObjectId(promotionId), tenantId: new Types.ObjectId(tenantId),
      name: 'Promotion de recette', kind: 'amount', active: true, ...over } as never);
  }

  it.each([undefined, 40])('conserve le +1 concurrent même si usageCount initial vaut %s', async (initial) => {
    await insert(initial === undefined ? {} : { usageCount: initial });
    const result = await service(reserveBeforeToggle(promotions)).togglePromotion(tenantId, promotionId);
    const stored = await raw();
    expect(result.active).toBe(false);
    expect(stored?.active).toBe(false);
    expect(stored?.usageCount).toBe((initial ?? 0) + 1);
  });

  it('n’ajoute pas de compteur à un document historique en basculant son activité', async () => {
    await insert();
    expect(Object.hasOwn((await raw())!, 'usageCount')).toBe(false);
    await service(promotions).togglePromotion(tenantId, promotionId);
    const stored = await raw();
    expect(stored?.active).toBe(false);
    expect(Object.hasOwn(stored!, 'usageCount')).toBe(false);
  });

  it.each([true, false, null, undefined])('conserve la sémantique de l’activité historique %s', async (active) => {
    await insert({ active, usageCount: 42 });
    if (active === undefined) await promotions.collection.updateOne({ _id: new Types.ObjectId(promotionId) }, { $unset: { active: '' } });
    const before = await promotions.findOne({ _id: promotionId, tenantId });
    const result = await service(promotions).togglePromotion(tenantId, promotionId);
    expect(result.active).toBe(!before!.active);
    expect((await raw())?.usageCount).toBe(42);
  });

  it('sérialise24 bascules avec30 réservations sans perdre un compteur ni une bascule', async () => {
    await insert({ usageCount: 40 });
    const actions = service(promotions);
    await Promise.all([
      ...Array.from({ length: 24 }, () => actions.togglePromotion(tenantId, promotionId)),
      ...Array.from({ length: 30 }, () => promotions.collection.updateOne({ _id: new Types.ObjectId(promotionId) }, { $inc: { usageCount: 1 } })),
    ]);
    expect(await raw()).toMatchObject({ active: true, usageCount: 70 });
  });

  it('garde le compteur intact à la bascule inverse et retourne le document actualisé', async () => {
    await insert({ active: false, usageCount: 42 });
    const result = await service(promotions).togglePromotion(tenantId, promotionId);
    expect(result).toMatchObject({ active: true, usageCount: 42 });
    expect(await raw()).toMatchObject({ active: true, usageCount: 42 });
  });

  it('ne touche pas la promotion d’un autre tenant', async () => {
    await insert({ usageCount: 42 });
    await expect(service(promotions).togglePromotion(otherTenantId, promotionId)).rejects.toBeInstanceOf(NotFoundException);
    expect(await raw()).toMatchObject({ active: true, usageCount: 42 });
  });
});
