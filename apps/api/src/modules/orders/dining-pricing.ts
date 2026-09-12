import { ConflictException, ServiceUnavailableException } from '@nestjs/common';
import { isDeepStrictEqual } from 'node:util';
import type { Model } from 'mongoose';
import type { DiningOrderPricingRecord, Promotion } from '@sm/db';
import type { priceOrderLines } from './price-order-lines';
import type { SelectedCartPromotion } from './cart-promotion';

export type DiningPricingSnapshot = ReturnType<typeof priceOrderLines> & { promotion: SelectedCartPromotion | null };
export type DiningPricingIdentity = { operationId: string; sessionId: string; payloadHash: string };
export const DINING_PROMOTION_RECEIPT_LIMIT = 20_000;
const DURABLE = { writeConcern: { w: 'majority' as const, j: true, wtimeout: 10_000 } };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const objectId = /^[a-f0-9]{24}$/i;
const recordId = (tenantId: string, operationId: string) => `${tenantId}:${operationId}`;
const unavailable = (): never => { throw new ServiceUnavailableException({ code: 'DINING_PRICING_UNCERTAIN', message: 'Le prix ou la réservation de promotion reste à vérifier. Reprenez la même opération.' }); };
const released = (): never => { throw new ConflictException('Cette tentative de table a été libérée. Reprenez la décision de cette même opération.'); };
const capacity = { $lt: [{ $size: { $ifNull: ['$diningReservations', []] } }, DINING_PROMOTION_RECEIPT_LIMIT] };

/** Normalize BSON ids while retaining the exact server-resolved amounts and
 * recipe. Corruption never becomes a fresh pricing pass or a full-price sale. */
export function validateDiningPricingSnapshot(value: unknown): DiningPricingSnapshot {
  if (!value || typeof value !== 'object') return unavailable();
  const snapshot = value as DiningPricingSnapshot;
  if (!Array.isArray(snapshot.lines) || snapshot.lines.length < 1 || snapshot.lines.length > 100
    || !Number.isSafeInteger(snapshot.subtotal) || snapshot.subtotal < 0) return unavailable();
  const lines = snapshot.lines.map(line => {
    if (!line || !objectId.test(String(line.productId)) || typeof line.name !== 'string' || !line.name
      || !Number.isSafeInteger(line.qty) || line.qty < 1 || !Number.isSafeInteger(line.unitPrice) || line.unitPrice < 0
      || !Number.isSafeInteger(line.lineTotal) || line.lineTotal !== line.unitPrice * line.qty
      || !(line.variantKey === null || typeof line.variantKey === 'string')
      || !(line.variantName === null || typeof line.variantName === 'string')
      || !(line.note === null || typeof line.note === 'string')
      || !Array.isArray(line.removed) || line.removed.some(item => typeof item !== 'string')
      || !Array.isArray(line.options) || line.options.some(option => !option || typeof option.groupKey !== 'string'
        || typeof option.choiceKey !== 'string' || typeof option.name !== 'string' || !Number.isSafeInteger(option.priceDelta))) return unavailable();
    return { productId: String(line.productId), name: line.name, variantKey: line.variantKey, variantName: line.variantName,
      note: line.note, qty: line.qty, unitPrice: line.unitPrice, lineTotal: line.lineTotal, removed: [...line.removed],
      options: line.options.map(option => ({ groupKey: option.groupKey, choiceKey: option.choiceKey, name: option.name, priceDelta: option.priceDelta })) };
  });
  const sum = lines.reduce((total, line) => total + line.lineTotal, 0);
  if (!Number.isSafeInteger(sum) || sum !== snapshot.subtotal) return unavailable();
  const promotion = snapshot.promotion;
  if (promotion !== null && (!promotion || !objectId.test(String(promotion.id)) || typeof promotion.reason !== 'string' || !promotion.reason
    || !Number.isSafeInteger(promotion.amount) || promotion.amount < 0 || promotion.amount > sum)) return unavailable();
  return { lines, subtotal: sum, promotion: promotion === null ? null : { id: String(promotion.id), amount: promotion.amount, reason: promotion.reason } };
}

/** No side effect in build: choose and freeze the shared snapshot before any
 * quota reservation. Release fences both delayed pricing and reservation. */
export class DiningPricingStore {
  constructor(private readonly pricing: Model<DiningOrderPricingRecord>, private readonly promotions: Model<Promotion>) {}

  private check(tenantId: string, identity: DiningPricingIdentity) {
    if (!objectId.test(tenantId) || !uuid.test(identity.operationId) || !uuid.test(identity.sessionId) || !/^[a-f0-9]{64}$/.test(identity.payloadHash)) unavailable();
  }
  private read(tenantId: string, operationId: string) {
    return this.pricing.findOne({ _id: recordId(tenantId, operationId), tenantId, operationId })
      .read('primary').readConcern('majority').maxTimeMS(10_000).lean();
  }
  private assertIdentity(record: DiningOrderPricingRecord, identity: DiningPricingIdentity) {
    if ((record.sessionId !== null || record.payloadHash !== null)
      && (record.sessionId !== identity.sessionId || record.payloadHash !== identity.payloadHash)) {
      throw new ConflictException({ code: 'DINING_PRICING_IDENTITY_CONFLICT', message: 'Cette référence de prix appartient à une autre intention de table.' });
    }
  }
  private snapshot(record: DiningOrderPricingRecord | null, identity: DiningPricingIdentity) {
    if (!record) return unavailable();
    this.assertIdentity(record, identity);
    if (record.released) return released();
    if (record.sessionId !== identity.sessionId || record.payloadHash !== identity.payloadHash) {
      return unavailable();
    }
    return validateDiningPricingSnapshot(record.snapshot);
  }
  async resolve(tenantId: string, identity: DiningPricingIdentity, build: () => Promise<DiningPricingSnapshot>): Promise<DiningPricingSnapshot> {
    this.check(tenantId, identity);
    const previous = await this.read(tenantId, identity.operationId);
    if (previous) return this.snapshot(previous, identity);
    let snapshot: DiningPricingSnapshot;
    try { snapshot = validateDiningPricingSnapshot(await build()); }
    catch (error) {
      // Another helper may already have frozen the same order while this
      // reader saw a later stock/menu state. That durable choice still wins.
      const observed = await this.read(tenantId, identity.operationId);
      if (observed) return this.snapshot(observed, identity);
      throw error;
    }
    try {
      await this.pricing.updateOne({ _id: recordId(tenantId, identity.operationId), tenantId, operationId: identity.operationId },
        { $setOnInsert: { sessionId: identity.sessionId, payloadHash: identity.payloadHash, snapshot, released: false } },
        { upsert: true, runValidators: true, ...DURABLE });
    } catch { /* An insert without ACK is decided by its immutable identity. */ }
    return this.snapshot(await this.read(tenantId, identity.operationId), identity);
  }

  private promotion(tenantId: string, id: unknown) {
    return this.promotions.findOne({ _id: id, tenantId }).select('+diningReservations')
      .read('primary').readConcern('majority').maxTimeMS(10_000).lean();
  }
  async reserve(tenantId: string, identity: DiningPricingIdentity, proposed: DiningPricingSnapshot) {
    this.check(tenantId, identity);
    const snapshot = this.snapshot(await this.read(tenantId, identity.operationId), identity);
    if (!isDeepStrictEqual(snapshot, validateDiningPricingSnapshot(proposed))) return unavailable();
    if (!snapshot.promotion) return null;
    const choice = snapshot.promotion;
    for (let attempt = 0; attempt < 8; attempt++) {
      const promo = await this.promotion(tenantId, choice.id);
      if (!promo) throw new ConflictException('La promotion choisie n’est plus disponible.');
      const receipts = promo.diningReservations ?? [];
      const receipt = receipts.find(entry => entry.operationId === identity.operationId);
      if (receipt) {
        if (receipt.payloadHash !== identity.payloadHash) return unavailable();
        if (receipt.state === 'released') return released();
        if (receipt.state !== 'reserved') return unavailable();
        return { discount: { amount: choice.amount, reason: choice.reason, promotionId: choice.id } };
      }
      if (receipts.length >= DINING_PROMOTION_RECEIPT_LIMIT) throw new ConflictException('Le journal de cette promotion est complet. Ouvrez une nouvelle campagne.');
      if (!promo.active || promo.maxUsage > 0 && promo.usageCount >= promo.maxUsage) {
        throw new ConflictException('Cette promotion n’est plus disponible ou son quota est atteint. Le prix confirmé n’a pas été remplacé.');
      }
      try {
        await this.promotions.updateOne({ _id: choice.id, tenantId, active: true, 'diningReservations.operationId': { $ne: identity.operationId },
          $expr: { $and: [capacity, { $or: [{ $lte: [{ $ifNull: ['$maxUsage', 0] }, 0] }, { $lt: [{ $ifNull: ['$usageCount', 0] }, '$maxUsage'] }] }] } },
        { $inc: { usageCount: 1 }, $push: { diningReservations: { operationId: identity.operationId, payloadHash: identity.payloadHash, state: 'reserved', at: new Date(), releasedAt: null } } }, DURABLE);
      } catch { /* Only the observed receipt decides, even after a lost ACK. */ }
    }
    return unavailable();
  }

  /** Caller must first prove terminal Session rejection. The pricing tombstone
   * prevents a late quote from reserving after a release which saw no record. */
  async release(tenantId: string, identity: DiningPricingIdentity): Promise<void> {
    this.check(tenantId, identity);
    const { operationId, sessionId, payloadHash } = identity;
    try {
      // The same UUID can be rejected in another session before pricing is
      // reached. Fence identity in the write itself: a racing foreign insert
      // must cause duplicate-key, never release that other session's quota.
      await this.pricing.updateOne({ _id: recordId(tenantId, operationId), tenantId, operationId, sessionId, payloadHash },
        { $set: { released: true } }, { upsert: true, runValidators: true, ...DURABLE });
    } catch { /* No compensation before a durable terminal marker. */ }
    const record = await this.read(tenantId, operationId);
    if (!record) return unavailable();
    this.assertIdentity(record, identity);
    if (!record.released || record.sessionId !== sessionId || record.payloadHash !== payloadHash) return unavailable();
    if (record.snapshot === null) return;
    const snapshot = validateDiningPricingSnapshot(record.snapshot);
    if (!snapshot.promotion) return;
    for (let attempt = 0; attempt < 8; attempt++) {
      const promo = await this.promotion(tenantId, snapshot.promotion.id);
      // No upsert can resurrect a deleted promotion through this protocol.
      if (!promo) return;
      const receipts = promo.diningReservations ?? [];
      const receipt = receipts.find(entry => entry.operationId === operationId);
      if (receipt && receipt.payloadHash !== record.payloadHash) return unavailable();
      if (receipt?.state === 'released') return;
      if (receipt && receipt.state !== 'reserved') return unavailable();
      // Monotonically full receipts also fence any reservation lacking a receipt.
      if (!receipt && receipts.length >= DINING_PROMOTION_RECEIPT_LIMIT) return;
      if (receipt && (!Number.isSafeInteger(promo.usageCount) || promo.usageCount < 0)) return unavailable();
      try {
        if (receipt) {
          await this.promotions.updateOne({ _id: promo._id, tenantId, usageCount: promo.usageCount,
            diningReservations: { $elemMatch: { operationId, payloadHash: record.payloadHash, state: 'reserved' } } },
          { $set: { 'diningReservations.$.state': 'released', 'diningReservations.$.releasedAt': new Date() },
            ...(promo.usageCount > 0 ? { $inc: { usageCount: -1 } } : {}) }, DURABLE);
        } else {
          await this.promotions.updateOne({ _id: promo._id, tenantId, 'diningReservations.operationId': { $ne: operationId }, $expr: capacity },
            { $push: { diningReservations: { operationId, payloadHash: record.payloadHash, state: 'released', at: new Date(), releasedAt: new Date() } } }, DURABLE);
        }
      } catch { /* The next majority read must confirm the compensated receipt. */ }
    }
    return unavailable();
  }
}
