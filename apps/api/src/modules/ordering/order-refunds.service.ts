import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import type Redis from 'ioredis';
import type { Order } from '@sm/db';
import { orderAccessScope, ordersChannel, WS_EVENTS, type OrderRefundRequest, type OrderRefundSummary } from '@sm/contracts';
import { REDIS_PUB } from '../../redis.module';
import { publishRedisBestEffort } from '../../common/redis-best-effort';
import { refundSummary, type ProviderRefund } from './order-refunds.policy';
import { CapacitesService } from '../../common/capacites';
import { AuditService } from '../audit/audit.module';

export const STRIPE_REFUND_CLIENT = Symbol('STRIPE_REFUND_CLIENT');
type Options = { stripeAccount?: string; idempotencyKey?: string };
export interface RefundStripeClient {
  refunds: {
    list(params: { payment_intent: string; limit: number; starting_after?: string }, options: Options): Promise<{ data: ProviderRefund[]; has_more: boolean }>;
    create(params: { payment_intent: string; amount: number; metadata: Record<string, string> }, options: Options): Promise<ProviderRefund>;
  };
  charges: { retrieve(id: string, options: Options): Promise<{ payment_intent?: string | { id: string } | null }> };
}
export type RefundClientFactory = () => Promise<RefundStripeClient | null>;

type RefundOrder = {
  _id: unknown; tenantId: unknown;
  totals: { total: number };
  payment: {
    method: string; status: string; stripePaymentIntentId?: string | null; stripeAccountId?: string | null;
    refundSyncVersion?: number; refundedCents?: number; pendingRefundCents?: number;
  };
};

@Injectable()
export class OrderRefundsService {
  constructor(
    @InjectModel('Order') private readonly orders: Model<Order>,
    @Inject(STRIPE_REFUND_CLIENT) private readonly clientFactory: RefundClientFactory,
    @Inject(REDIS_PUB) private readonly redis: Redis,
    private readonly capacites: CapacitesService,
    private readonly audit: AuditService,
  ) {}

  private async client(): Promise<RefundStripeClient> {
    const client = await this.clientFactory();
    if (!client) throw new ServiceUnavailableException('Remboursements en ligne indisponibles.');
    return client;
  }

  private async order(tenantId: string, orderId: string): Promise<RefundOrder> {
    if (!Types.ObjectId.isValid(orderId)) throw new NotFoundException('Commande introuvable.');
    const scope = orderAccessScope(await this.capacites.pourTenant(tenantId));
    if (scope === 'none') throw new NotFoundException('Commande introuvable.');
    const order = await this.orders.findOne({ _id: orderId, tenantId, ...(scope === 'online' ? { channel: 'online' } : {}) }).lean();
    if (!order) throw new NotFoundException('Commande introuvable.');
    return order as RefundOrder;
  }

  private options(order: RefundOrder): Options {
    // Historical platform charges keep their original account, too.
    return order.payment.stripeAccountId ? { stripeAccount: order.payment.stripeAccountId } : {};
  }

  private async allRefunds(client: RefundStripeClient, order: RefundOrder): Promise<ProviderRefund[]> {
    const intent = order.payment.stripePaymentIntentId;
    if (!intent || order.payment.method !== 'online') throw new ConflictException('Cette commande ne porte pas de paiement Stripe.');
    const rows: ProviderRefund[] = [];
    let cursor: string | undefined;
    for (;;) {
      const page = await client.refunds.list({ payment_intent: intent, limit: 100, ...(cursor ? { starting_after: cursor } : {}) }, this.options(order));
      rows.push(...page.data);
      if (!page.has_more) return rows;
      const next = page.data.at(-1)?.id;
      if (!next || next === cursor || rows.length >= 10_000) {
        throw new ServiceUnavailableException('Historique des remboursements incomplet.');
      }
      cursor = next;
    }
  }

  async summary(tenantId: string, orderId: string): Promise<OrderRefundSummary> {
    const order = await this.order(tenantId, orderId);
    // A canceled intent is retained as evidence after switching to counter;
    // it must never be mistaken for money collected by Stripe.
    if (order.payment.method !== 'online') return refundSummary(0, []);
    if (!order.payment.stripePaymentIntentId) return refundSummary(order.totals.total, []);
    return this.reconcile(order, await this.client());
  }

  async request(tenantId: string, orderId: string, actorId: string, body: OrderRefundRequest): Promise<OrderRefundSummary> {
    const order = await this.order(tenantId, orderId);
    if (!Number.isSafeInteger(body.amountCents) || body.amountCents <= 0) {
      throw new BadRequestException('Le remboursement doit être un montant positif en centimes.');
    }
    if (order.payment.method !== 'online' || !order.payment.stripePaymentIntentId || !['paid', 'refunded'].includes(order.payment.status)) {
      throw new ConflictException('Aucun paiement Stripe confirmé à rembourser.');
    }
    const client = await this.client();
    const rows = await this.allRefunds(client, order);
    // Provider metadata survives Stripe's idempotency-key retention. A retry
    // after a lost HTTP response must never create another refund tomorrow.
    const existing = rows.find((row) => row.metadata?.operationId === body.operationId);
    if (existing) {
      if (existing.amount !== body.amountCents || existing.metadata?.reason !== body.reason) {
        throw new ConflictException('Cette opération désigne déjà un autre remboursement.');
      }
      await this.audit.log({
        tenantId, actor: { sub: actorId, kind: 'user', role: 'owner' }, action: 'order.refund', targetId: orderId,
        meta: { amountCents: body.amountCents, reason: body.reason, operationId: body.operationId,
          refundId: existing.id, status: existing.status, replay: true },
      });
      return this.requestResult(order, client, existing.id);
    }
    const summary = refundSummary(order.totals.total, rows);
    if (body.amountCents > summary.remainingCents) {
      throw new ConflictException('Le remboursement dépasse le montant restant disponible.');
    }
    let created: ProviderRefund;
    try {
      created = await client.refunds.create({
        payment_intent: order.payment.stripePaymentIntentId,
        amount: body.amountCents,
        metadata: { operationId: body.operationId, orderId, tenantId, requestedBy: actorId, reason: body.reason },
      }, { ...this.options(order), idempotencyKey: `order-refund:${orderId}:${body.operationId}` });
    } catch (error) {
      const providerError = error as { type?: string; code?: string };
      if (providerError.type === 'StripeInvalidRequestError') {
        throw new ConflictException('Stripe a refusé ce remboursement. Actualisez le paiement avant de réessayer.');
      }
      throw new ServiceUnavailableException('La confirmation Stripe n’a pas été reçue. Réessayez la même opération : aucun double remboursement ne sera créé.');
    }
    await this.audit.log({
      tenantId, actor: { sub: actorId, kind: 'user', role: 'owner' }, action: 'order.refund', targetId: orderId,
      meta: { amountCents: body.amountCents, reason: body.reason, operationId: body.operationId,
        refundId: created.id, status: created.status, stripeAccountId: order.payment.stripeAccountId ?? null },
    });
    return this.requestResult(order, client, created.id);
  }

  private async requestResult(order: RefundOrder, client: RefundStripeClient, refundId: string): Promise<OrderRefundSummary> {
    const summary = await this.reconcile(order, client);
    const requested = summary.refunds.find((refund) => refund.id === refundId);
    if (!requested) throw new ServiceUnavailableException('Confirmation du remboursement en attente. Réessayez la même opération.');
    if (requested.status === 'failed' || requested.status === 'canceled') {
      throw new ConflictException('Ce remboursement a échoué ou a été annulé. Vérifiez le paiement puis ouvrez une nouvelle demande si nécessaire.');
    }
    return summary;
  }

  /** Re-read current Stripe state, never apply an old event's amount/status. */
  async webhook(event: { account?: string; type: string; data: { object: unknown } }): Promise<void> {
    const object = event.data.object as { id?: string; payment_intent?: string | { id: string } | null; charge?: string | null };
    let intent = typeof object.payment_intent === 'string' ? object.payment_intent : object.payment_intent?.id;
    const client = await this.client();
    if (!intent && object.charge) {
      const charge = await client.charges.retrieve(object.charge, event.account ? { stripeAccount: event.account } : {});
      intent = typeof charge.payment_intent === 'string' ? charge.payment_intent : charge.payment_intent?.id;
    }
    if (!intent) return;
    // The account is part of identity; metadata supplied by a merchant cannot
    // select a competitor's order or a platform invoice.
    const order = await this.orders.findOne({
      'payment.method': 'online',
      'payment.stripePaymentIntentId': intent,
      'payment.stripeAccountId': event.account ?? null,
    }).lean();
    if (!order) return;
    await this.reconcile(order as RefundOrder, client);
  }

  private async reconcile(order: RefundOrder, client: RefundStripeClient): Promise<OrderRefundSummary> {
    const reserved = await this.orders.findOneAndUpdate({
      _id: order._id, tenantId: order.tenantId,
      'payment.method': 'online',
      'payment.stripePaymentIntentId': order.payment.stripePaymentIntentId,
      'payment.stripeAccountId': order.payment.stripeAccountId ?? null,
    }, { $inc: { 'payment.refundSyncVersion': 1, __v: 1 } }, { new: true }).lean();
    if (!reserved) throw new ConflictException('Paiement modifié, actualisez la commande.');
    const version = (reserved as RefundOrder).payment.refundSyncVersion;
    const rows = await this.allRefunds(client, order);
    const summary = refundSummary(order.totals.total, rows);
    const set: Record<string, unknown> = {
      'payment.refundedCents': summary.refundedCents,
      'payment.pendingRefundCents': summary.pendingRefundCents,
      'payment.refunds': rows.map((row) => ({
        id: row.id, amountCents: row.amount, status: row.status ?? 'pending',
        operationId: row.metadata?.operationId ?? null, reason: row.metadata?.reason ?? '',
      })),
    };
    if (summary.refundedCents >= order.totals.total && order.totals.total > 0) set['payment.status'] = 'refunded';
    else if (reserved.payment.status === 'refunded') set['payment.status'] = 'paid';
    const updated = await this.orders.findOneAndUpdate({
      _id: order._id, tenantId: order.tenantId, 'payment.refundSyncVersion': version,
      'payment.method': 'online',
      'payment.stripePaymentIntentId': order.payment.stripePaymentIntentId,
      'payment.stripeAccountId': order.payment.stripeAccountId ?? null,
    }, { $set: set, $inc: { __v: 1 } }, { new: true }).lean();
    if (updated) {
      const payload = { ...updated } as Record<string, unknown>;
      delete payload.paymentFlow;
      for (const key of Object.keys(payload)) if (key.startsWith('loyalty')) delete payload[key];
      await publishRedisBestEffort(this.redis, ordersChannel(String(order.tenantId)), JSON.stringify({ event: WS_EVENTS.orderUpdated, payload }));
    }
    return summary;
  }
}
