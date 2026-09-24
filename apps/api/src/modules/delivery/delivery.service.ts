import type { Pool } from 'pg';
import { POSTGRES_POOL } from '../../postgres.module';
import { orderRewardBenefit } from '../loyalty/order-reward-benefit';
import { orderRewardsEnabled } from '../orders/order-reward.policy';
import { aLaCapacite, type PickupQuoteRequest, type PickupQuote } from '@sm/contracts';
import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import type Redis from 'ioredis';
import {
  ordersChannel, WS_EVENTS, DeliverySettingsSchema,
  capacitesEffectives, orderAccessScope,
  type DeliveryDispatch, type DeliveryQuote, type DeliveryQuoteRequest, type DeliverySettings, type JwtPayload,
} from '@sm/contracts';
import { Money, ordering } from '@sm/domain';
import type { Order, Product, Promotion, Tenant } from '@sm/db';
import { REDIS_PUB } from '../../redis.module';
import { publishRedisBestEffort } from '../../common/redis-best-effort';
import { AuditService } from '../audit/audit.module';
import { priceOrderLines } from '../orders/price-order-lines';
import { promotionCandidatesFilter, selectCartPromotion } from '../orders/cart-promotion';
import { deliverySettingsOf, publicDeliverySettingsOf } from './delivery-order';
import { TenantCapacitySettingsStore } from '../tenants/tenant-capacity-settings.store';

@Injectable()
export class DeliveryService {
  constructor(
    @InjectModel('Tenant') private readonly tenants: Model<Tenant>,
    @InjectModel('Product') private readonly products: Model<Product>,
    @InjectModel('Order') private readonly orders: Model<Order>,
    private readonly audit: AuditService,
    @Inject(REDIS_PUB) private readonly redis: Redis,
    @InjectModel('Promotion') private readonly promotions: Model<Promotion>,
    @Optional() @Inject(POSTGRES_POOL) private readonly pool?: Pool,
  ) {}

  private async tenantBySlug(slug: string) {
    const tenant = await this.tenants.findOne({ slug }).lean();
    if (!tenant) throw new NotFoundException('Établissement introuvable');
    return tenant;
  }

  async publicSettings(slug: string) {
    return publicDeliverySettingsOf(await this.tenantBySlug(slug));
  }

  async quote(slug: string, request: DeliveryQuoteRequest): Promise<DeliveryQuote> {
    const tenant = await this.tenantBySlug(slug);
    if (!publicDeliverySettingsOf(tenant).available) {
      throw new ConflictException('La livraison est momentanément indisponible. Vous pouvez retirer votre commande au restaurant.');
    }
    const { subtotal, discount, subtotalNet } = await this.priceQuote(tenant, request);
    const result = ordering.quoteDelivery(deliverySettingsOf(tenant), request.address.postalCode, Money.fromCents(subtotalNet));
    if (!result.ok) throw new BadRequestException({ code: result.error.code, message: result.error.message });
    // Informatif : le quota n'est jamais réservé ici et sera revérifié à la création.
    return { ...result.value, originalSubtotalCents: subtotal, discount };
  }

  async quotePickup(slug: string, request: PickupQuoteRequest): Promise<PickupQuote> {
    const tenant = await this.tenantBySlug(slug);
    const { subtotal, discount, subtotalNet } = await this.priceQuote(tenant, request);
    return { fulfillment: 'pickup', originalSubtotalCents: subtotal, subtotalCents: subtotalNet, totalCents: subtotalNet, discount };
  }

  private async priceQuote(tenant: Tenant & { _id: unknown }, request: PickupQuoteRequest) {
    const ids = [...new Set(request.lines.map(line => line.productId))];
    const products = await this.products.find({ tenantId: tenant._id, _id: { $in: ids }, active: true }).lean();
    const { subtotal, lines } = priceOrderLines(products, request.lines);
    let discount: { amount: number; reason: string } | null = null;
    if (request.reward) {
      if (request.promoCode || !this.pool || !orderRewardsEnabled() || !aLaCapacite(tenant, 'loyalty')
        || !['trial','active'].includes(tenant.account?.status ?? '')) throw new ConflictException('Cette récompense ne peut pas être appliquée.');
      const client = await this.pool.connect();
      try {
        await client.query('BEGIN'); await client.query("SELECT set_config('app.tenant_ref',$1,true)", [String(tenant._id)]);
        const row = (await client.query(`SELECT r.* FROM loyalty.rewards r JOIN loyalty.programs p ON p.id=r.program_id AND p.tenant_ref=r.tenant_ref
          WHERE r.tenant_ref=$1 AND r.id=$2 AND r.active=true AND p.status='active'`, [String(tenant._id), request.reward.rewardId])).rows[0];
        if (!row || Number(row.cost_units) !== request.reward.expectedCostUnits) throw new ConflictException('Cette récompense a changé. Actualisez votre fidélité.');
        const benefit = orderRewardBenefit({ id: row.id, name: row.name, costUnits: Number(row.cost_units), kind: row.kind,
          valueCents: row.value_cents, productRef: row.product_ref }, lines, subtotal);
        discount = { amount: benefit.amountCents, reason: `Fidélité · ${benefit.name}` };
        await client.query('COMMIT');
      } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
    } else {
      const candidates = await this.promotions.find(promotionCandidatesFilter(String(tenant._id), request.promoCode)).lean();
      const promotion = selectCartPromotion(candidates, { subtotal, lines, channel: 'online', promoCode: request.promoCode, now: new Date() });
      discount = promotion ? { amount: promotion.amount, reason: promotion.reason } : null;
    }
    return { subtotal, discount, subtotalNet: subtotal - (discount?.amount ?? 0) };
  }

  async settings(tenantId: string): Promise<DeliverySettings> {
    const tenant = await this.tenants.findById(tenantId).lean();
    if (!tenant) throw new NotFoundException('Établissement introuvable');
    return deliverySettingsOf(tenant);
  }

  async updateSettings(tenantId: string, input: DeliverySettings, actor: JwtPayload) {
    const settings = DeliverySettingsSchema.parse(input);
    const tenant = await new TenantCapacitySettingsStore(this.tenants).update(tenantId, { delivery: settings });
    await this.audit.log({ tenantId, actor, action: 'tenant.settings', meta: { delivery: settings } });
    // Le store conserve un document hydraté pour la vue BO ; le contrat Zod
    // strict de livraison doit recevoir ses données, pas les champs Mongoose.
    return deliverySettingsOf(tenant.toObject());
  }

  /** Départ idempotent : deux postes ne peuvent ni doubler ni antidater le départ. */
  async dispatch(tenantId: string, id: string, input: DeliveryDispatch, actor: JwtPayload) {
    const tenant = await this.tenants.findById(tenantId).lean();
    if (!tenant) throw new NotFoundException('Établissement introuvable');
    const scope = orderAccessScope(capacitesEffectives(tenant));
    if (scope === 'none') throw new NotFoundException('Commande de livraison introuvable');
    const filter = { _id: id, tenantId, type: 'delivery', ...(scope === 'online' ? { channel: 'online' } : {}) };
    const existing = await this.orders.findOne(filter).select('+paymentFlow +deliveryMission');
    if (!existing) throw new NotFoundException('Commande de livraison introuvable');
    if (existing.deliveryMission) throw new ConflictException({ code: 'DELIVERY_MISSION_REQUIRED', message: 'Utilisez la mission affectée pour confirmer ce départ.' });
    if (existing.delivery?.dispatchedAt) return existing;
    if (existing.paymentFlow && ['closing', 'closed', 'review_required'].includes(existing.paymentFlow.phase)) {
      throw new ConflictException('Paiement en cours de fermeture ou à vérifier — le livreur ne peut pas partir.');
    }
    if (existing.status !== 'ready') throw new ConflictException('La commande doit être prête avant le départ du livreur.');
    if (existing.payment.status !== 'paid') throw new ConflictException('Le paiement doit être confirmé avant le départ du livreur.');
    const dispatchedAt = new Date();
    const updated = await this.orders.findOneAndUpdate({
      ...filter, status: 'ready', deliveryMission: null,
      'payment.status': 'paid', 'delivery.dispatchedAt': null,
      'paymentFlow.phase': { $nin: ['closing', 'closed', 'review_required'] },
    }, {
      $set: { 'delivery.dispatchedAt': dispatchedAt, 'delivery.driverName': input.driverName ?? null },
      $inc: { __v: 1 },
    }, { new: true, runValidators: true });
    if (!updated) {
      const raced = await this.orders.findOne(filter).select('+paymentFlow +deliveryMission');
      if (raced?.deliveryMission) throw new ConflictException({ code: 'DELIVERY_MISSION_REQUIRED', message: 'Utilisez la mission affectée pour confirmer ce départ.' });
      if (raced?.delivery?.dispatchedAt) return raced;
      throw new ConflictException('Commande modifiée en parallèle — actualisez puis recommencez.');
    }
    await this.audit.log({ tenantId, actor, action: 'order.dispatch', targetId: id, meta: { dispatchedAt } });
    void publishRedisBestEffort(this.redis, ordersChannel(tenantId), JSON.stringify({ event: WS_EVENTS.orderUpdated, payload: updated.toJSON() }));
    return updated;
  }
}
