import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import Redis from 'ioredis';
import {
  type CreateOrder,
  ORDER_STATUS_RANK,
  type OrderStatus,
  ordersChannel,
  WS_EVENTS,
} from '@sm/contracts';
import type { Counter, Order, Product } from '@sm/db';
import { REDIS_PUB } from '../../redis.module';
import { AuditService } from '../audit/audit.module';

@Injectable()
export class OrdersService {
  constructor(
    @InjectModel('Order') private readonly orders: Model<Order>,
    @InjectModel('Product') private readonly products: Model<Product>,
    @InjectModel('Counter') private readonly counters: Model<Counter>,
    @Inject(REDIS_PUB) private readonly redis: Redis,
    private readonly audit: AuditService,
  ) {}

  private publish(tenantId: string, event: string, payload: unknown) {
    void this.redis.publish(ordersChannel(tenantId), JSON.stringify({ event, payload }));
  }

  /** Numéro de retrait : séquence journalière par tenant, atomique (fuseau restaurant). */
  private async nextNumber(tenantId: string): Promise<number> {
    const day = new Intl.DateTimeFormat('fr-CA', { timeZone: 'Europe/Paris' })
      .format(new Date())
      .replace(/-/g, '');
    const doc = await this.counters.findOneAndUpdate(
      { _id: `${tenantId}:${day}` },
      { $inc: { seq: 1 } },
      { new: true, upsert: true },
    );
    return doc!.seq;
  }

  /**
   * Création de commande — POS, téléphone ou en ligne.
   * Les prix sont TOUJOURS résolus côté serveur depuis le menu courant.
   * Idempotente sur {tenantId, clientId} : le rejeu offline renvoie l'existante.
   */
  async create(tenantId: string, dto: CreateOrder, actor: string) {
    const existing = await this.orders.findOne({ tenantId, clientId: dto.clientId });
    if (existing) return existing; // rejeu de la file offline

    const ids = [...new Set(dto.lines.map((l) => l.productId))];
    const prods = await this.products.find({ _id: { $in: ids }, tenantId, active: true }).lean();
    const byId = new Map(prods.map((p) => [String(p._id), p]));

    let subtotal = 0;
    const lines = dto.lines.map((line) => {
      const prod = byId.get(line.productId);
      if (!prod) throw new NotFoundException(`Produit ${line.productId} introuvable`);
      if (prod.outOfStock) {
        throw new ConflictException(`« ${prod.name} » est en rupture`);
      }

      let variantName: string | null = null;
      let unitPrice = prod.price;
      if (prod.variants.length > 0) {
        const variant = prod.variants.find((v) => v.key === line.variantKey);
        if (!variant) {
          throw new BadRequestException(`Variante requise pour « ${prod.name} »`);
        }
        variantName = variant.name;
        unitPrice = variant.price;
      }

      const options = line.options.map((sel) => {
        const group = prod.optionGroups.find((g) => g.key === sel.groupKey);
        const choice = group?.choices.find((c) => c.key === sel.choiceKey);
        if (!group || !choice) {
          throw new BadRequestException(`Option inconnue pour « ${prod.name} »`);
        }
        const perVariant =
          line.variantKey && group.perVariant
            ? (group.perVariant as Record<string, { priceDelta?: number }>)[line.variantKey]
            : undefined;
        const priceDelta = perVariant?.priceDelta ?? choice.priceDelta;
        unitPrice += priceDelta;
        return { groupKey: group.key, choiceKey: choice.key, name: choice.name, priceDelta };
      });

      // Groupes obligatoires (min effectif selon la variante)
      for (const group of prod.optionGroups) {
        const rules =
          line.variantKey && group.perVariant
            ? (group.perVariant as Record<string, { min?: number; max?: number }>)[line.variantKey]
            : undefined;
        const min = rules?.min ?? group.min ?? 0;
        const max = rules?.max ?? group.max ?? Infinity;
        const count = options.filter((o) => o.groupKey === group.key).length;
        if (count < min || count > max) {
          throw new BadRequestException(
            `« ${group.name} » : ${min === max ? min : `${min}–${max === Infinity ? '∞' : max}`} choix attendu(s) pour « ${prod.name} »`,
          );
        }
      }

      const lineTotal = unitPrice * line.qty;
      subtotal += lineTotal;
      return {
        productId: prod._id,
        name: prod.name,
        variantKey: line.variantKey ?? null,
        variantName,
        options,
        removed: line.removed,
        note: line.note ?? null,
        qty: line.qty,
        unitPrice,
        lineTotal,
      };
    });

    const number = await this.nextNumber(tenantId);
    try {
      const order = await this.orders.create({
        tenantId,
        number,
        clientId: dto.clientId,
        channel: dto.channel,
        type: dto.type,
        lines,
        totals: { subtotal, discount: null, total: subtotal },
        payment: { method: dto.payment.method, status: 'pending' },
        status: 'new',
        statusHistory: [{ status: 'new', at: new Date(), by: actor }],
        pickup: dto.pickup
          ? {
              slot: new Date(dto.pickup.slot),
              customerName: dto.pickup.customerName,
              customerPhone: dto.pickup.customerPhone ?? null,
            }
          : null,
        note: dto.note ?? null,
      });
      this.publish(tenantId, WS_EVENTS.orderCreated, order.toObject());
      return order;
    } catch (err: unknown) {
      // Course entre deux rejeux simultanés de la même commande offline
      if ((err as { code?: number }).code === 11000) {
        return this.orders.findOne({ tenantId, clientId: dto.clientId });
      }
      throw err;
    }
  }

  async list(tenantId: string, filter: { status?: OrderStatus; since?: string }) {
    const query: Record<string, unknown> = { tenantId };
    if (filter.status) query.status = filter.status;
    if (filter.since) query.createdAt = { $gte: new Date(filter.since) };
    const rows = await this.orders.find(query).sort({ createdAt: -1 }).limit(200).lean();
    return { rows, total: rows.length };
  }

  async byId(tenantId: string, id: string) {
    const order = await this.orders.findOne({ _id: id, tenantId });
    if (!order) throw new NotFoundException('Commande introuvable');
    return order;
  }

  /** Suivi public (page client sans compte) — projection minimale. */
  async publicTracking(id: string) {
    const order = await this.orders.findById(id).lean();
    if (!order) throw new NotFoundException('Commande introuvable');
    return {
      _id: order._id,
      number: order.number,
      status: order.status,
      statusHistory: order.statusHistory,
      pickupSlot: order.pickup?.slot ?? null,
    };
  }

  /**
   * Avancement de statut. Règle offline « le plus avancé gagne » :
   * un rejeu vers un statut déjà dépassé est ignoré (renvoie l'état courant).
   */
  async updateStatus(tenantId: string, id: string, status: OrderStatus, actor: string) {
    const order = await this.byId(tenantId, id);
    const current = order.status as OrderStatus;
    if (status === current) return order;
    if (ORDER_STATUS_RANK[status] < ORDER_STATUS_RANK[current]) return order;
    if (current === 'delivered' || current === 'cancelled') return order;

    order.status = status;
    order.statusHistory.push({ status, at: new Date(), by: actor });
    if (status === 'delivered' && order.payment.method === 'counter') {
      order.payment.status = 'paid';
    }
    await order.save();
    this.publish(tenantId, WS_EVENTS.orderUpdated, order.toObject());
    return order;
  }

  /** Annulation — action sensible : PIN re-validé en amont, journalisée. */
  async cancel(tenantId: string, id: string, staffId: string, reason: string) {
    const order = await this.byId(tenantId, id);
    if (order.status === 'delivered') {
      throw new ConflictException('Commande déjà servie — passer par un remboursement');
    }
    order.status = 'cancelled';
    order.statusHistory.push({ status: 'cancelled', at: new Date(), by: staffId });
    await order.save();
    await this.audit.log({
      tenantId,
      staffId,
      action: 'order.cancel',
      targetId: id,
      meta: { reason, number: order.number, total: order.totals.total },
      pinVerifiedAt: new Date(),
    });
    this.publish(tenantId, WS_EVENTS.orderUpdated, order.toObject());
    return order;
  }

  /** Remise — action sensible : PIN re-validé en amont, journalisée. */
  async discount(tenantId: string, id: string, staffId: string, amount: number, reason: string) {
    const order = await this.byId(tenantId, id);
    if (amount <= 0 || amount > order.totals.subtotal) {
      throw new BadRequestException('Montant de remise invalide');
    }
    order.totals.discount = { amount, reason, staffId: staffId as never };
    order.totals.total = order.totals.subtotal - amount;
    await order.save();
    await this.audit.log({
      tenantId,
      staffId,
      action: 'order.discount',
      targetId: id,
      meta: { amount, reason, number: order.number },
      pinVerifiedAt: new Date(),
    });
    this.publish(tenantId, WS_EVENTS.orderUpdated, order.toObject());
    return order;
  }
}
