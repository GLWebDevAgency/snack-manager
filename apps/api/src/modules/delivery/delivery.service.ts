import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import type Redis from 'ioredis';
import {
  ordersChannel, WS_EVENTS, DeliverySettingsSchema,
  capacitesEffectives, orderAccessScope,
  type DeliveryDispatch, type DeliveryQuoteRequest, type DeliverySettings, type JwtPayload,
} from '@sm/contracts';
import { Money, ordering } from '@sm/domain';
import type { Order, Product, Tenant } from '@sm/db';
import { REDIS_PUB } from '../../redis.module';
import { publishRedisBestEffort } from '../../common/redis-best-effort';
import { AuditService } from '../audit/audit.module';
import { priceOrderLines } from '../orders/price-order-lines';
import { deliverySettingsOf, publicDeliverySettingsOf } from './delivery-order';

@Injectable()
export class DeliveryService {
  constructor(
    @InjectModel('Tenant') private readonly tenants: Model<Tenant>,
    @InjectModel('Product') private readonly products: Model<Product>,
    @InjectModel('Order') private readonly orders: Model<Order>,
    private readonly audit: AuditService,
    @Inject(REDIS_PUB) private readonly redis: Redis,
  ) {}

  private async tenantBySlug(slug: string) {
    const tenant = await this.tenants.findOne({ slug }).lean();
    if (!tenant) throw new NotFoundException('Établissement introuvable');
    return tenant;
  }

  async publicSettings(slug: string) {
    return publicDeliverySettingsOf(await this.tenantBySlug(slug));
  }

  async quote(slug: string, request: DeliveryQuoteRequest) {
    const tenant = await this.tenantBySlug(slug);
    if (!publicDeliverySettingsOf(tenant).available) {
      throw new ConflictException('La livraison est momentanément indisponible. Vous pouvez retirer votre commande au restaurant.');
    }
    const ids = [...new Set(request.lines.map((line) => line.productId))];
    const products = await this.products.find({ tenantId: tenant._id, _id: { $in: ids }, active: true }).lean();
    const { subtotal } = priceOrderLines(products, request.lines);
    const result = ordering.quoteDelivery(deliverySettingsOf(tenant), request.address.postalCode, Money.fromCents(subtotal));
    if (!result.ok) throw new BadRequestException({ code: result.error.code, message: result.error.message });
    return result.value;
  }

  async settings(tenantId: string): Promise<DeliverySettings> {
    const tenant = await this.tenants.findById(tenantId).lean();
    if (!tenant) throw new NotFoundException('Établissement introuvable');
    return deliverySettingsOf(tenant);
  }

  async updateSettings(tenantId: string, input: DeliverySettings, actor: JwtPayload) {
    const settings = DeliverySettingsSchema.parse(input);
    const tenant = await this.tenants.findByIdAndUpdate(tenantId, { $set: { delivery: settings } }, { new: true, runValidators: true }).lean();
    if (!tenant) throw new NotFoundException('Établissement introuvable');
    await this.audit.log({ tenantId, actor, action: 'tenant.settings', meta: { delivery: settings } });
    return deliverySettingsOf(tenant);
  }

  /** Départ idempotent : deux postes ne peuvent ni doubler ni antidater le départ. */
  async dispatch(tenantId: string, id: string, input: DeliveryDispatch, actor: JwtPayload) {
    const tenant = await this.tenants.findById(tenantId).lean();
    if (!tenant) throw new NotFoundException('Établissement introuvable');
    const scope = orderAccessScope(capacitesEffectives(tenant));
    if (scope === 'none') throw new NotFoundException('Commande de livraison introuvable');
    const filter = { _id: id, tenantId, type: 'delivery', ...(scope === 'online' ? { channel: 'online' } : {}) };
    const existing = await this.orders.findOne(filter).select('+paymentFlow');
    if (!existing) throw new NotFoundException('Commande de livraison introuvable');
    if (existing.delivery?.dispatchedAt) return existing;
    if (existing.paymentFlow && ['closing', 'closed', 'review_required'].includes(existing.paymentFlow.phase)) {
      throw new ConflictException('Paiement en cours de fermeture ou à vérifier — le livreur ne peut pas partir.');
    }
    if (existing.status !== 'ready') throw new ConflictException('La commande doit être prête avant le départ du livreur.');
    if (existing.payment.status !== 'paid') throw new ConflictException('Le paiement doit être confirmé avant le départ du livreur.');
    const dispatchedAt = new Date();
    const updated = await this.orders.findOneAndUpdate({
      ...filter, status: 'ready',
      'payment.status': 'paid', 'delivery.dispatchedAt': null,
      'paymentFlow.phase': { $nin: ['closing', 'closed', 'review_required'] },
    }, {
      $set: { 'delivery.dispatchedAt': dispatchedAt, 'delivery.driverName': input.driverName ?? null },
      $inc: { __v: 1 },
    }, { new: true, runValidators: true });
    if (!updated) {
      const raced = await this.orders.findOne(filter).select('+paymentFlow');
      if (raced?.delivery?.dispatchedAt) return raced;
      throw new ConflictException('Commande modifiée en parallèle — actualisez puis recommencez.');
    }
    await this.audit.log({ tenantId, actor, action: 'order.dispatch', targetId: id, meta: { dispatchedAt } });
    void publishRedisBestEffort(this.redis, ordersChannel(tenantId), JSON.stringify({ event: WS_EVENTS.orderUpdated, payload: updated.toJSON() }));
    return updated;
  }
}
