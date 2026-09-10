import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types, type PipelineStage } from 'mongoose';
import type { Order } from '@sm/db';

export const POPULAR_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
export const POPULAR_CACHE_MS = 60_000;
const CACHE_LIMIT = 128;
const FAILURE_RETRY_MS = 5_000;
export const POPULAR_LIMIT = 8;

/** La sélection est calculée sur des ventes payées, jamais sur des paniers. */
export function popularityPipeline(tenantId: string, productIds: readonly string[], now: Date): PipelineStage[] {
  const ids = productIds.map((id) => new Types.ObjectId(id));
  return [
    { $match: {
      tenantId: new Types.ObjectId(tenantId),
      createdAt: { $gte: new Date(now.getTime() - POPULAR_WINDOW_MS), $lte: now },
      status: { $ne: 'cancelled' },
      'payment.status': 'paid',
      'lines.productId': { $in: ids },
    } },
    { $unwind: '$lines' },
    { $match: { 'lines.productId': { $in: ids }, 'lines.qty': { $gt: 0 } } },
    { $group: { _id: '$lines.productId', quantity: { $sum: '$lines.qty' } } },
    { $sort: { quantity: -1, _id: 1 } },
    { $limit: POPULAR_LIMIT },
  ];
}

type CacheEntry = { expires: number; value: ReadonlySet<string> };

@Injectable()
export class MenuPopularityService {
  private readonly logger = new Logger(MenuPopularityService.name);
  private readonly cache = new Map<string, CacheEntry>();
  private readonly pending = new Map<string, Promise<ReadonlySet<string>>>();

  constructor(@InjectModel('Order') private readonly orders: Model<Order>) {}

  /**
   * L'éligibilité fait partie de la clé : retirer une photo, masquer un plat
   * ou changer le choix manuel s'applique dès la prochaine carte. Les ventes
   * nouvelles sont reflétées en au plus une minute. Cache et requêtes sont
   * bornés ; deux surfaces simultanées partagent la même agrégation.
   */
  async top(tenantId: string, candidates: readonly string[]): Promise<ReadonlySet<string>> {
    const ids = [...new Set(candidates.filter((id) => Types.ObjectId.isValid(id)).map((id) => id.toLowerCase()))].sort();
    if (!ids.length || !Types.ObjectId.isValid(tenantId)) return new Set();
    const key = `${tenantId.toLowerCase()}:${ids.join(',')}`;
    const cached = this.cache.get(key);
    if (cached && cached.expires > Date.now()) {
      this.cache.delete(key);
      this.cache.set(key, cached);
      return cached.value;
    }
    const existing = this.pending.get(key);
    if (existing) return existing;
    // Le menu reste disponible en cas de surcharge ; aucun faux succès de vente.
    if (this.pending.size >= CACHE_LIMIT) return new Set();
    const read = this.read(tenantId, ids).then(({ value, ttl }) => {
      this.cache.delete(key);
      this.cache.set(key, { expires: Date.now() + ttl, value });
      while (this.cache.size > CACHE_LIMIT) this.cache.delete(this.cache.keys().next().value!);
      return value;
    }).finally(() => { this.pending.delete(key); });
    this.pending.set(key, read);
    return read;
  }

  private async read(tenantId: string, ids: string[]) {
    try {
      const rows = await this.orders.aggregate<{ _id: Types.ObjectId; quantity: number }>(
        popularityPipeline(tenantId, ids, new Date()),
      ).option({ maxTimeMS: 2_000 });
      return { value: new Set(rows.filter((row) => row.quantity > 0).map((row) => String(row._id))), ttl: POPULAR_CACHE_MS };
    } catch {
      this.logger.warn('Classement des ventes temporairement indisponible ; les choix manuels restent servis.');
      return { value: new Set<string>(), ttl: FAILURE_RETRY_MS };
    }
  }
}
