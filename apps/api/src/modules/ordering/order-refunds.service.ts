import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { isDeepStrictEqual } from 'node:util';
import { Model, Types } from 'mongoose';
import type Redis from 'ioredis';
import type { Order } from '@sm/db';
import { orderAccessScope, ordersChannel, WS_EVENTS, OrderRefundRequestSchema, type OrderRefundRequest, type OrderRefundSummary } from '@sm/contracts';
import { REDIS_PUB } from '../../redis.module';
import { publishRedisBestEffort } from '../../common/redis-best-effort';
import { refundSummary } from './order-refunds.policy';
import { assertRefundProof, MAX_REFUND_OPERATIONS, REFUND_RECOVERY_WINDOW_MS, refundProjection, refundUnavailable,
  type RefundOperation, type RefundProof, type RefundSnapshot } from './order-refund-flow.policy';
import { CapacitesService } from '../../common/capacites';
import { AuditService } from '../audit/audit.module';

export const STRIPE_REFUND_CLIENT = Symbol('STRIPE_REFUND_CLIENT');
type Options = { stripeAccount?: string; idempotencyKey?: string };
export interface RefundStripeClient {
  environment: 'test' | 'live';
  refunds: {
    list(params: { payment_intent: string; limit: number; starting_after?: string }, options: Options): Promise<{ data: RefundProof[]; has_more: boolean }>;
    create(params: { payment_intent: string; amount: number; metadata: Record<string, string> }, options: Options): Promise<RefundProof>;
  };
  charges: { retrieve(id: string, options: Options): Promise<{ payment_intent?: string | { id: string } | null }> };
}
export type RefundClientFactory = () => Promise<RefundStripeClient | null>;
const DURABLE_WRITE = { w: 'majority' as const, j: true, wtimeout: 10_000 };
const MAX_RETRIES = 8;
const valueAt = (object: unknown, path: string): unknown => path.split('.').reduce<unknown>(
  (value, key) => value && typeof value === 'object' ? (value as Record<string, unknown>)[key] : undefined, object,
);

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
    if (!client || !['test', 'live'].includes(client.environment)) throw new ServiceUnavailableException('Remboursements en ligne indisponibles.');
    return client;
  }

  private async read(filter: Record<string, unknown>): Promise<RefundSnapshot | null> {
    return await this.orders.findOne(filter).select('+refundFlow +paymentFlow').read('primary')
      .readConcern('majority').maxTimeMS(10_000).lean() as RefundSnapshot | null;
  }

  private async order(tenantId: string, orderId: string): Promise<RefundSnapshot> {
    if (!Types.ObjectId.isValid(orderId)) throw new NotFoundException('Commande introuvable.');
    const scope = orderAccessScope(await this.capacites.pourTenant(tenantId));
    if (scope === 'none') throw new NotFoundException('Commande introuvable.');
    const order = await this.read({ _id: orderId, tenantId, ...(scope === 'online' ? { channel: 'online' } : {}) });
    if (!order) throw new NotFoundException('Commande introuvable.');
    return order;
  }

  private async fresh(order: RefundSnapshot): Promise<RefundSnapshot> {
    const latest = await this.read({ _id: order._id, tenantId: order.tenantId });
    if (!latest) refundUnavailable();
    return latest;
  }

  private context(order: RefundSnapshot, client: RefundStripeClient): void {
    if (order.payment.method !== 'online' || !order.payment.stripePaymentIntentId) {
      throw new ConflictException('Cette commande ne porte pas de paiement Stripe.');
    }
    if ((order.paymentFlow?.attempt && order.paymentFlow.attempt.environment !== client.environment)
      || order.refundFlow?.operations.some((operation) => operation.environment !== client.environment
        || operation.paymentIntentId !== order.payment.stripePaymentIntentId
        || operation.accountId !== (order.payment.stripeAccountId ?? null))) refundUnavailable();
  }

  /** Every financial mutation fences hydrated saves, dispatch and handoff.
   * After a lost response, only the exact majority-committed CAS proves success. */
  private async change(order: RefundSnapshot, set: Record<string, unknown> = {}): Promise<RefundSnapshot | null> {
    const filter = { _id: order._id, tenantId: order.tenantId, __v: order.__v ?? { $exists: false },
      'payment.method': order.payment.method, 'payment.stripePaymentIntentId': order.payment.stripePaymentIntentId,
      'payment.stripeAccountId': order.payment.stripeAccountId ?? null };
    try {
      return await this.orders.findOneAndUpdate(filter, { $set: set, $inc: { __v: 1, 'payment.refundSyncVersion': 1 } },
        { new: true, writeConcern: DURABLE_WRITE, runValidators: true }).select('+refundFlow +paymentFlow').read('primary').lean() as RefundSnapshot | null;
    } catch {
      const observed = await this.fresh(order).catch(() => null);
      if (observed && observed.__v === (order.__v ?? 0) + 1
        && observed.payment.refundSyncVersion === (order.payment.refundSyncVersion ?? 0) + 1
        && observed.payment.method === order.payment.method
        && observed.payment.stripePaymentIntentId === order.payment.stripePaymentIntentId
        && (observed.payment.stripeAccountId ?? null) === (order.payment.stripeAccountId ?? null)
        && Object.entries(set).every(([path, value]) => isDeepStrictEqual(valueAt(observed, path), value))) return observed;
      return refundUnavailable();
    }
  }

  private options(order: RefundSnapshot): Options {
    return order.payment.stripeAccountId ? { stripeAccount: order.payment.stripeAccountId } : {};
  }

  private async allRefunds(client: RefundStripeClient, order: RefundSnapshot): Promise<RefundProof[]> {
    this.context(order, client);
    const rows: RefundProof[] = [];
    let cursor: string | undefined;
    for (;;) {
      const page = await client.refunds.list({ payment_intent: order.payment.stripePaymentIntentId!, limit: 100,
        ...(cursor ? { starting_after: cursor } : {}) }, this.options(order));
      rows.push(...page.data);
      if (!page.has_more) return rows;
      const next = page.data.at(-1)?.id;
      if (!next || next === cursor || rows.length >= 10_000) throw new ServiceUnavailableException('Historique des remboursements incomplet.');
      cursor = next;
    }
  }

  private projectedSet(order: RefundSnapshot, incoming: readonly RefundProof[] = []): Record<string, unknown> {
    const projection = refundProjection(order, incoming);
    const set: Record<string, unknown> = { 'payment.refundedCents': projection.summary.refundedCents,
      'payment.pendingRefundCents': projection.summary.pendingRefundCents, 'payment.refunds': projection.rows };
    if (projection.flow) set.refundFlow = projection.flow;
    if (projection.summary.refundedCents >= order.totals.total && order.totals.total > 0) set['payment.status'] = 'refunded';
    else if (order.payment.status === 'refunded') set['payment.status'] = 'paid';
    return set;
  }

  private async publish(order: RefundSnapshot): Promise<void> {
    const payload = { ...order } as Record<string, unknown>;
    for (const key of ['paymentFlow', 'refundFlow', 'counterCollection', 'publicRecovery', 'deliveryMission', 'deliveryHandoff', 'customerOwner', 'customerSaleAttribution']) delete payload[key];
    for (const key of Object.keys(payload)) if (key.startsWith('loyalty')) delete payload[key];
    await publishRedisBestEffort(this.redis, ordersChannel(String(order.tenantId)), JSON.stringify({ event: WS_EVENTS.orderUpdated, payload }));
  }

  private async auditReceipt(order: RefundSnapshot, operation: RefundOperation): Promise<void> {
    if (!operation.refund) return;
    // Status can evolve; the immutable request + provider ID are the receipt.
    await this.audit.logOnce({ tenantId: String(order.tenantId),
      actor: { sub: operation.actorId, kind: 'user', role: 'owner' }, action: 'order.refund', targetId: String(order._id),
      meta: { amountCents: operation.amountCents, reason: operation.reason, operationId: operation.operationId,
        refundId: operation.refund.id, stripeAccountId: operation.accountId, environment: operation.environment },
    }, operation.operationId);
  }

  /** Missing provider rows never release a local amount. Both observation and
   * projection are fenced; a stale list cannot erase a concurrent intent. */
  private async reconcile(initial: RefundSnapshot, client: RefundStripeClient): Promise<RefundSnapshot> {
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      const order = await this.fresh(initial);
      this.context(order, client);
      const reserved = await this.change(order);
      if (!reserved) continue;
      const rows = await this.allRefunds(client, reserved);
      const updated = await this.change(reserved, this.projectedSet(reserved, rows));
      if (!updated) continue;
      await this.publish(updated);
      for (const operation of updated.refundFlow?.operations ?? []) await this.auditReceipt(updated, operation);
      return updated;
    }
    return refundUnavailable();
  }

  async summary(tenantId: string, orderId: string): Promise<OrderRefundSummary> {
    const order = await this.order(tenantId, orderId);
    if (order.payment.method !== 'online') return refundSummary(0, []);
    if (!order.payment.stripePaymentIntentId) return refundSummary(order.totals.total, []);
    return refundProjection(await this.reconcile(order, await this.client())).summary;
  }

  private match(operation: RefundOperation, actorId: string, body: OrderRefundRequest): void {
    if (operation.amountCents !== body.amountCents || operation.reason !== body.reason || operation.actorId !== actorId) {
      throw new ConflictException('Cette opération désigne déjà un autre remboursement.');
    }
  }

  private result(order: RefundSnapshot, operation: RefundOperation): OrderRefundSummary {
    if (!operation.refund) refundUnavailable();
    if (['failed', 'canceled'].includes(operation.refund.status!)) {
      throw new ConflictException('Ce remboursement a échoué ou a été annulé. Vérifiez le paiement puis ouvrez une nouvelle demande si nécessaire.');
    }
    return refundProjection(order).summary;
  }

  private async review(initial: RefundSnapshot, operationId: string, reason: string): Promise<void> {
    for (let retry = 0; retry < MAX_RETRIES; retry++) {
      const order = await this.fresh(initial);
      const flow = structuredClone(order.refundFlow);
      const operation = flow?.operations.find((entry) => entry.operationId === operationId);
      if (!operation || operation.refund) return;
      operation.state = 'review_required'; operation.reviewReason = reason;
      if (await this.change(order, { refundFlow: flow })) return;
    }
    refundUnavailable();
  }

  async request(tenantId: string, orderId: string, actorId: string, body: OrderRefundRequest): Promise<OrderRefundSummary> {
    let order = await this.order(tenantId, orderId);
    const parsed = OrderRefundRequestSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException('Demande de remboursement invalide.');
    body = { ...parsed.data, operationId: parsed.data.operationId.toLowerCase() };
    // Mongo accepts hexadecimal IDs in either case; Stripe metadata and the
    // idempotency key must use the canonical stored identity on every retry.
    orderId = String(order._id); tenantId = String(order.tenantId);
    if (!Number.isSafeInteger(body.amountCents) || body.amountCents <= 0 || body.amountCents > 100_000_000) {
      throw new BadRequestException('Le remboursement doit être un montant positif en centimes.');
    }
    if (order.payment.method !== 'online' || !order.payment.stripePaymentIntentId || !['paid', 'refunded'].includes(order.payment.status)) {
      throw new ConflictException('Aucun paiement Stripe confirmé à rembourser.');
    }
    const previous = order.refundFlow?.operations.find((entry) => entry.operationId === body.operationId);
    if (previous) this.match(previous, actorId, body);
    const client = await this.client();
    order = await this.reconcile(order, client);
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      this.context(order, client);
      if (!['paid', 'refunded'].includes(order.payment.status)) refundUnavailable();
      const flow = structuredClone(order.refundFlow ?? { version: 1 as const, operations: [] });
      let operation = flow.operations.find((entry) => entry.operationId === body.operationId);
      if (!operation) {
        // Do not fabricate a pre-dispatch receipt for an older binary's call.
        if (order.payment.refunds?.some((row) => row.operationId?.toLowerCase() === body.operationId)) {
          throw new ConflictException('Cette opération historique existe déjà. Consultez son remboursement sans la recréer.');
        }
        if (flow.operations.some((entry) => !entry.refund) || flow.operations.length >= MAX_REFUND_OPERATIONS) refundUnavailable();
        if (body.amountCents > refundProjection(order).summary.remainingCents) {
          throw new ConflictException('Le remboursement dépasse le montant restant disponible.');
        }
        operation = { operationId: body.operationId, amountCents: body.amountCents, reason: body.reason, actorId,
          environment: client.environment, paymentIntentId: order.payment.stripePaymentIntentId!,
          accountId: order.payment.stripeAccountId ?? null, idempotencyKey: 'order-refund:' + orderId + ':' + body.operationId,
          preparedAt: new Date(), requestStartedAt: null, state: 'prepared' };
        flow.operations.push(operation);
        await this.change(order, this.projectedSet({ ...order, refundFlow: flow }));
        order = await this.fresh(order); continue;
      }
      this.match(operation, actorId, body);
      if (operation.refund) { await this.auditReceipt(order, operation); return this.result(order, operation); }
      if (operation.state === 'review_required') refundUnavailable();
      if (!operation.requestStartedAt) {
        operation.requestStartedAt = new Date(); operation.state = 'creating';
        await this.change(order, { refundFlow: flow });
        order = await this.fresh(order); continue;
      }
      const started = new Date(operation.requestStartedAt).getTime();
      if (!Number.isFinite(started) || started > Date.now() || started + REFUND_RECOVERY_WINDOW_MS <= Date.now()) {
        await this.review(order, operation.operationId, 'provider_creation_recovery_window_elapsed');
        refundUnavailable();
      }
      let created: RefundProof;
      try {
        created = await client.refunds.create({ payment_intent: operation.paymentIntentId, amount: operation.amountCents,
          metadata: { operationId: operation.operationId, orderId, tenantId, requestedBy: operation.actorId, reason: operation.reason },
        }, { ...(operation.accountId ? { stripeAccount: operation.accountId } : {}), idempotencyKey: operation.idempotencyKey });
      } catch (error) {
        if ((error as { type?: string }).type === 'StripeInvalidRequestError') {
          await this.review(order, operation.operationId, 'provider_request_refused');
        }
        return refundUnavailable();
      }
      try { assertRefundProof(order, created, operation); }
      catch { await this.review(order, operation.operationId, 'provider_proof_conflict'); return refundUnavailable(); }
      // The response is evidence before the list catches up. Never replace a
      // later observation with an older cached create response on a retry.
      for (let retry = 0; retry < MAX_RETRIES; retry++) {
        const latest = await this.fresh(order); this.context(latest, client);
        const stored = latest.refundFlow?.operations.find((entry) => entry.operationId === body.operationId);
        if (!stored) refundUnavailable();
        this.match(stored, actorId, body);
        assertRefundProof(latest, created, stored);
        if (stored.refund) { await this.auditReceipt(latest, stored); return this.result(latest, stored); }
        const saved = await this.change(latest, this.projectedSet(latest, [created]));
        if (!saved) continue;
        await this.publish(saved);
        const receipt = saved.refundFlow!.operations.find((entry) => entry.operationId === body.operationId)!;
        await this.auditReceipt(saved, receipt);
        return this.result(saved, receipt);
      }
      return refundUnavailable();
    }
    return refundUnavailable();
  }

  async webhook(event: { account?: string; livemode?: boolean; type: string; data: { object: unknown } }): Promise<void> {
    const client = await this.client();
    if (typeof event.livemode === 'boolean' && event.livemode !== (client.environment === 'live')) return;
    const object = event.data.object as { payment_intent?: string | { id: string } | null; charge?: string | null };
    let intent = typeof object.payment_intent === 'string' ? object.payment_intent : object.payment_intent?.id;
    if (!intent && object.charge) {
      const charge = await client.charges.retrieve(object.charge, event.account ? { stripeAccount: event.account } : {});
      intent = typeof charge.payment_intent === 'string' ? charge.payment_intent : charge.payment_intent?.id;
    }
    if (!intent) return;
    const order = await this.read({ 'payment.method': 'online', 'payment.stripePaymentIntentId': intent,
      'payment.stripeAccountId': event.account ?? null });
    if (order) await this.reconcile(order, client);
  }
}
