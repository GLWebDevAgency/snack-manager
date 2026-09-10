import { ConflictException, HttpException, Inject, Injectable, NotFoundException, ServiceUnavailableException, type OnModuleInit } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  ORDER_PUSH_MAX_SUBSCRIPTIONS, ORDER_PUSH_TTL_MS, OrderReadyPreferenceSchema, OrderReadySubscribeSchema,
  type OrderPushConfigView, type OrderReadyPreference, type OrderReadyPreferenceView, type OrderReadySubscribe,
} from '@sm/contracts';
import type { Order, OrderReadyNotification, Tenant } from '@sm/db';
import { SharedPublicQuota } from '../../common/shared-public-quota';
import { trackingFilter } from '../orders/tracking';
import { endpointHash, ORDER_PUSH_CONFIG, sealSubscription, type OrderPushConfig } from './order-push.crypto';

export type ReadySubscriptionRow = {
  endpointHash: string; generation: string; encrypted?: string | null; state: 'active' | 'sent' | 'revoked' | 'expired' | 'failed';
  expiresAt: Date; attempts: number; nextAttemptAt: Date; sentAt?: Date | null;
};
export type ReadyNotificationRow = {
  _id: Types.ObjectId; tenantId: Types.ObjectId; orderId: Types.ObjectId; slug: string; subscriptions: ReadySubscriptionRow[];
  expiresAt: Date; nextAttemptAt: Date | null; leaseOwner: string | null; leaseUntil: Date | null; revision: number;
};
export function readyPreference(row?: ReadySubscriptionRow, revision = 0): OrderReadyPreferenceView {
  if (!row || row.expiresAt.getTime() <= Date.now()) return { state: 'off', expiresAt: null, revision };
  return { state: row.state === 'active' || row.state === 'sent' ? row.state : 'off', expiresAt: row.expiresAt.toISOString(), revision };
}
export const terminalOrder = (order: { status?: unknown; payment?: { status?: unknown } }) =>
  order.status === 'cancelled' || order.status === 'delivered' || order.payment?.status === 'refunded';
/** Même promesse que le suivi : comptoir à emporter permis, sinon paiement confirmé. */
export const canNotifyReady = (order: { type?: unknown; payment?: { method?: unknown; status?: unknown; pendingRefundCents?: number | null } }) =>
  !(Number(order.payment?.pendingRefundCents) > 0) && (order.payment?.status === 'paid'
    || (order.type === 'pickup' && order.payment?.method === 'counter' && order.payment.status === 'pending'));

@Injectable()
export class OrderNotificationsService implements OnModuleInit {
  constructor(
    @InjectModel('Tenant') private readonly tenants: Model<Tenant>,
    @InjectModel('Order') private readonly orders: Model<Order>,
    @InjectModel('OrderReadyNotification') private readonly notices: Model<OrderReadyNotification>,
    private readonly quota: SharedPublicQuota,
    @Inject(ORDER_PUSH_CONFIG) private readonly config: OrderPushConfig | null,
  ) {}

  async onModuleInit() {
    // L'unicité est une garantie d'écriture : attendre son index avant de servir.
    if (this.config) await this.notices.init();
  }

  private async tenant(slug: string) {
    if (!/^[a-z0-9](?:[a-z0-9-]{0,48}[a-z0-9])?$/.test(slug)) throw new NotFoundException('Commande introuvable');
    const tenant = await this.tenants.findOne({ slug }, { _id: 1, slug: 1 }).lean();
    if (!tenant) throw new NotFoundException('Commande introuvable');
    return tenant;
  }

  async configView(slug: string): Promise<OrderPushConfigView> {
    await this.tenant(slug);
    return { available: this.config !== null, publicKey: this.config?.publicKey ?? null };
  }

  private async authorize(slug: string, id: string, token: string) {
    const filter = trackingFilter(id, token);
    if (!filter) throw new NotFoundException('Commande introuvable');
    const tenant = await this.tenant(slug);
    const order = await this.orders.findOne({ ...filter, tenantId: tenant._id }, {
      _id: 1, tenantId: 1, status: 1, 'payment.status': 1, createdAt: 1,
    }).lean();
    if (!order) throw new NotFoundException('Commande introuvable');
    return { tenant, order };
  }

  private async reserve(tenantId: string, orderId: string) {
    let accepted: boolean;
    try {
      accepted = await this.quota.reserve({ scope: 'order-ready', clientKey: `${tenantId}:${orderId}`, windowMs: 60_000, clientLimit: 30, globalLimit: 3_000 });
    } catch { throw new ServiceUnavailableException('Les notifications sont momentanément indisponibles.'); }
    if (!accepted) throw new HttpException('Patientez avant de modifier cette notification.', 429);
  }

  async subscribe(slug: string, id: string, input: OrderReadySubscribe): Promise<OrderReadyPreferenceView> {
    const body = OrderReadySubscribeSchema.parse(input);
    const { tenant, order } = await this.authorize(slug, id, body.trackingToken);
    if (!this.config) throw new ServiceUnavailableException('Les notifications ne sont pas disponibles pour le moment.');
    const expiresAt = new Date(Math.min(new Date(order.createdAt).getTime() + ORDER_PUSH_TTL_MS, body.subscription.expirationTime ?? Infinity));
    if (terminalOrder(order) || !Number.isFinite(expiresAt.getTime()) || expiresAt.getTime() <= Date.now()) {
      throw new ConflictException('Cette commande ne peut plus recevoir de notification.');
    }
    await this.reserve(String(tenant._id), String(order._id));
    const scope = { tenantId: tenant._id, orderId: order._id };
    const hash = endpointHash(body.subscription.endpoint);
    const now = new Date();
    const subscription: ReadySubscriptionRow = { endpointHash: hash, generation: randomUUID(), encrypted: sealSubscription(this.config, String(tenant._id), String(order._id), hash, body.subscription),
      state: 'active', expiresAt, attempts: 0, nextAttemptAt: now, sentAt: null };
    try {
      await this.notices.updateOne(scope, { $setOnInsert: { ...scope, slug: tenant.slug,
        expiresAt: new Date(new Date(order.createdAt).getTime() + ORDER_PUSH_TTL_MS), subscriptions: [], revision: 0 } }, { upsert: true });
    } catch (error) {
      if (!(typeof error === 'object' && error !== null && 'code' in error && error.code === 11000)) throw error;
    }
    const current = await this.notices.findOne(scope).select('+subscriptions.encrypted').lean<ReadyNotificationRow | null>();
    const existing = current?.subscriptions.find((entry) => entry.endpointHash === hash);
    if (existing && readyPreference(existing).state !== 'off') return readyPreference(existing, current!.revision);
    const changed = (row: ReadyNotificationRow | null) => new ConflictException({ code: 'ORDER_NOTIFICATION_CHANGED',
      message: 'La préférence a changé. Vérifiez-la avant de réessayer.',
      current: readyPreference(row?.subscriptions.find((entry) => entry.endpointHash === hash), row?.revision ?? 0) });
    if (!current || current.revision !== body.expectedRevision) throw changed(current);
    const retained = current.subscriptions.filter((entry) => readyPreference(entry).state !== 'off');
    if (retained.length >= ORDER_PUSH_MAX_SUBSCRIPTIONS) throw new ConflictException('Cette commande est déjà suivie sur cinq appareils.');
    // CAS : une désactivation acquittée invalide tout consentement commencé auparavant.
    const saved = await this.notices.findOneAndUpdate({ ...scope, revision: body.expectedRevision }, {
      $set: { subscriptions: [...retained, subscription], nextAttemptAt: now }, $inc: { revision: 1 },
    }, { new: true }).lean<ReadyNotificationRow | null>();
    if (saved) return readyPreference(saved.subscriptions.find((entry) => entry.endpointHash === hash), saved.revision);
    const latest = await this.notices.findOne(scope).lean<ReadyNotificationRow | null>();
    const duplicate = latest?.subscriptions.find((entry) => entry.endpointHash === hash);
    if (duplicate && readyPreference(duplicate).state !== 'off') return readyPreference(duplicate, latest!.revision);
    throw changed(latest);
  }

  async status(slug: string, id: string, input: OrderReadyPreference): Promise<OrderReadyPreferenceView> {
    const body = OrderReadyPreferenceSchema.parse(input);
    const { tenant, order } = await this.authorize(slug, id, body.trackingToken);
    await this.reserve(String(tenant._id), String(order._id));
    const row = await this.notices.findOne({ tenantId: tenant._id, orderId: order._id }).lean<ReadyNotificationRow | null>();
    return readyPreference(row?.subscriptions.find((entry) => entry.endpointHash === endpointHash(body.endpoint)), row?.revision ?? 0);
  }

  async revoke(slug: string, id: string, input: OrderReadyPreference): Promise<OrderReadyPreferenceView> {
    const body = OrderReadyPreferenceSchema.parse(input);
    const { tenant, order } = await this.authorize(slug, id, body.trackingToken);
    await this.reserve(String(tenant._id), String(order._id));
    const scope = { tenantId: tenant._id, orderId: order._id };
    // Même sans inscription préalable, conserver une révision bloque un POST retardé.
    try {
      await this.notices.updateOne(scope, { $setOnInsert: { ...scope, slug: tenant.slug,
        expiresAt: new Date(new Date(order.createdAt).getTime() + ORDER_PUSH_TTL_MS), subscriptions: [], revision: 0 } }, { upsert: true });
    } catch (error) {
      if (!(typeof error === 'object' && error !== null && 'code' in error && error.code === 11000)) throw error;
    }
    const row = await this.notices.findOneAndUpdate(scope, {
      $set: { 'subscriptions.$[entry].state': 'revoked', 'subscriptions.$[entry].encrypted': null }, $inc: { revision: 1 },
    }, { new: true, arrayFilters: [{ 'entry.endpointHash': endpointHash(body.endpoint) }] }).lean<ReadyNotificationRow | null>();
    return { state: 'off', expiresAt: null, revision: row?.revision ?? 0 };
  }
}
