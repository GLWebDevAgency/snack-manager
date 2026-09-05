import { randomUUID } from 'node:crypto';
import { ConflictException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { STRIPE_MIN_AMOUNT_CENTS } from '@sm/contracts';
import type { Order } from '@sm/db';
import { Model, Types, type HydratedDocument, type UpdateQuery } from 'mongoose';
import type { StripeWebhookEvent, StripeWebhookObject } from '../../common/stripe-signature';
import { trackingFilter } from '../orders/tracking';

export interface ProviderIntent {
  id: string;
  client_secret: string | null;
  status: string;
  amount: number;
  currency?: string;
  metadata?: Record<string, string> | null;
}

export interface PaymentCreationParameters {
  amount: number;
  currency: 'eur';
  automatic_payment_methods: { enabled: true };
  metadata: { orderId: string; tenantId: string; orderNumber: string };
}

/** The port never receives a client-supplied amount or a new account during recovery. */
export interface OrderPaymentProvider {
  readonly environment: 'test' | 'live';
  create(params: PaymentCreationParameters, accountId: string, idempotencyKey: string): Promise<ProviderIntent>;
  retrieve(id: string, accountId: string | null): Promise<ProviderIntent>;
  cancel(id: string, accountId: string | null, idempotencyKey: string): Promise<ProviderIntent>;
}

type OrderDocument = HydratedDocument<Order>;
type Flow = NonNullable<Order['paymentFlow']>;
type Attempt = NonNullable<Flow['attempt']>;
const DURABLE_WRITE = { w: 'majority' as const, j: true, wtimeout: 10_000 };
const MAX_CAS_RETRIES = 8;
// Stripe retains keys >=24h. Our recovery budget is deliberately much smaller;
// a delayed request MUST NOT recreate a payment after the provider prunes its key.
const RECOVERY_WINDOW_MS = 60 * 60 * 1000;
const PAYABLE = new Set(['requires_payment_method', 'requires_confirmation', 'requires_action']);
const CANCELLABLE = new Set(['requires_payment_method', 'requires_confirmation', 'requires_action']);

/**
 * One durable payment attempt per order, shared by checkout, cancellation and
 * webhook reconciliation. Mongo's document CAS is the lock; no in-memory mutex,
 * transaction or lease expiry can reopen a closing order. Every write increments
 * __v, fencing older OrdersService.save() snapshots as well.
 */
@Injectable()
export class OrderPaymentLifecycleService {
  constructor(@InjectModel('Order') private readonly orders: Model<Order>) {}

  private read(id: string) {
    // A concurrent process must not act on a marker another writer has not yet
    // majority-committed (in particular requestStartedAt and the closed phase).
    return this.orders.findById(id).select('+paymentFlow').read('primary').readConcern('majority').maxTimeMS(10_000);
  }

  private change(order: OrderDocument, update: UpdateQuery<Order>) {
    return this.orders.findOneAndUpdate(
      { _id: order._id, tenantId: order.tenantId, __v: order.__v ?? { $exists: false } },
      { ...update, $inc: { ...update.$inc, __v: 1 } },
      { new: true, writeConcern: DURABLE_WRITE },
    ).select('+paymentFlow').read('primary');
  }

  private conflict(): never {
    throw new ConflictException('Paiement en cours de vérification. Réessayez sans créer une nouvelle commande ni encaisser à nouveau.');
  }

  private async review(id: string, reason: string): Promise<void> {
    for (let retry = 0; retry < MAX_CAS_RETRIES; retry++) {
      const order = await this.read(id);
      if (!order?.paymentFlow || order.paymentFlow.phase === 'closed' || order.payment?.status !== 'pending') return;
      if (await this.change(order, { $set: { 'paymentFlow.phase': 'review_required', 'paymentFlow.reviewReason': reason } })) return;
    }
    this.conflict();
  }

  private async adopt(order: OrderDocument, provider: OrderPaymentProvider | null): Promise<OrderDocument | null> {
    if (order.paymentFlow) return order;
    const now = new Date();
    const known = order.payment?.stripePaymentIntentId;
    // Do not persist an unresumable adopted attempt if the SDK is temporarily unavailable.
    if (known && !provider) this.conflict();
    // No PI in an old document is NOT proof that a former process never called Stripe.
    const attempt = known && provider ? {
      id: randomUUID(), accountId: order.payment.stripeAccountId ?? null,
      environment: provider.environment, amountCents: order.totals.total, currency: 'eur',
      idempotencyKey: `order-payment:${order.id}:adopted:${known}`,
      metadata: { orderId: order.id, tenantId: String(order.tenantId), orderNumber: String(order.number) },
      preparedAt: now, requestStartedAt: now, recoveryUntil: now,
    } : null;
    return this.change(order, { $set: { paymentFlow: {
      version: 1, origin: known ? 'adopted_intent' : 'legacy_unknown',
      phase: known ? 'open' : 'review_required', attempt, close: null,
      providerStatus: null, providerCheckedAt: null,
      reviewReason: known ? null : 'legacy_payment_history_unknown',
    } } });
  }

  async open(
    orderId: string, token: unknown, provider: OrderPaymentProvider,
    resolveAccount: () => Promise<string | null>,
  ): Promise<{ intent: ProviderIntent; accountId: string; amountCents: number } | null> {
    const filter = trackingFilter(orderId, token);
    if (!filter || !await this.orders.exists(filter).read('primary')) throw new NotFoundException('Commande introuvable');
    for (let retry = 0; retry < MAX_CAS_RETRIES; retry++) {
      let order = await this.read(orderId);
      if (!order) throw new NotFoundException('Commande introuvable');
      if (order.status === 'cancelled' || order.status === 'delivered' || order.payment?.status !== 'pending') return null;
      if (!order.paymentFlow) { await this.adopt(order, provider); continue; }
      const flow = order.paymentFlow;
      if (flow.phase !== 'open') this.conflict();
      if (!flow.attempt) {
        if (flow.origin !== 'created_v1' || order.payment.stripePaymentIntentId) this.conflict();
        const amount = order.totals.total;
        if (!Number.isSafeInteger(amount) || amount < STRIPE_MIN_AMOUNT_CENTS) return null;
        const accountId = await resolveAccount();
        if (!accountId) return null;
        const now = new Date();
        const attempt = {
          id: randomUUID(), accountId, environment: provider.environment, amountCents: amount,
          currency: 'eur', idempotencyKey: `order-payment:${order.id}:initial`,
          metadata: { orderId: order.id, tenantId: String(order.tenantId), orderNumber: String(order.number) },
          preparedAt: now, requestStartedAt: null, recoveryUntil: new Date(now.getTime() + RECOVERY_WINDOW_MS),
        };
        if (!await this.change(order, { $set: {
          'paymentFlow.attempt': attempt,
          // Desired collection channel, not a claim that funds were received.
          // Tracking must offer recovery even when the provider response is lost.
          'payment.method': 'online', 'payment.tender': 'online',
        } })) continue;
        continue;
      }
      if (!flow.attempt.requestStartedAt && !order.payment.stripePaymentIntentId) {
        const now = new Date();
        if (!await this.change(order, { $set: {
          'paymentFlow.attempt.requestStartedAt': now,
          'paymentFlow.attempt.recoveryUntil': new Date(now.getTime() + RECOVERY_WINDOW_MS),
        } })) continue;
        continue;
      }
      const intent = await this.resolve(order, provider);
      order = await this.read(orderId);
      if (!order) this.conflict();
      if (intent.status === 'succeeded') {
        await this.applyPaid(orderId, intent.id, flow.attempt.accountId ?? null, intent.amount);
        return null;
      }
      if (intent.status === 'canceled') { await this.review(orderId, 'provider_intent_canceled'); return null; }
      if (!PAYABLE.has(intent.status)) return null;
      if (order.paymentFlow?.phase !== 'open' || order.paymentFlow.close || order.status === 'cancelled'
        || order.status === 'delivered' || order.payment.status !== 'pending'
        || order.payment.stripePaymentIntentId !== intent.id) this.conflict();
      const accountId = order.paymentFlow.attempt?.accountId;
      // Historical platform intents can be reconciled/closed, never exposed as a new direct charge.
      if (!accountId) return null;
      return { intent, accountId, amountCents: order.paymentFlow.attempt!.amountCents };
    }
    return this.conflict();
  }

  private assertIntent(order: OrderDocument, attempt: Attempt, intent: ProviderIntent): void {
    if (!intent.id || intent.amount !== attempt.amountCents || intent.currency !== 'eur'
      || (order.payment.stripePaymentIntentId && order.payment.stripePaymentIntentId !== intent.id)
      || (order.paymentFlow?.origin === 'created_v1' && (
        intent.metadata?.orderId !== attempt.metadata.orderId
        || intent.metadata?.tenantId !== attempt.metadata.tenantId
        || intent.metadata?.orderNumber !== attempt.metadata.orderNumber
      ))) this.conflict();
  }

  private async resolve(order: OrderDocument, provider: OrderPaymentProvider): Promise<ProviderIntent> {
    const attempt = order.paymentFlow?.attempt;
    if (!attempt || attempt.environment !== provider.environment) this.conflict();
    if (order.payment.stripePaymentIntentId) {
      const intent = await provider.retrieve(order.payment.stripePaymentIntentId, attempt.accountId ?? null);
      this.assertIntent(order, attempt, intent);
      return intent;
    }
    if (order.paymentFlow?.origin !== 'created_v1' || !attempt.requestStartedAt || !attempt.accountId) this.conflict();
    if (new Date(attempt.recoveryUntil).getTime() <= Date.now()) {
      await this.review(order.id, 'provider_creation_recovery_window_elapsed');
      this.conflict();
    }
    // The same immutable request recovers a committed creation whose response was lost.
    // Never confirm here, and never generate a replacement key, even after cancellation.
    const intent = await provider.create({
      amount: attempt.amountCents, currency: 'eur', automatic_payment_methods: { enabled: true },
      metadata: {
        orderId: attempt.metadata.orderId, tenantId: attempt.metadata.tenantId,
        orderNumber: attempt.metadata.orderNumber,
      },
    }, attempt.accountId, attempt.idempotencyKey);
    this.assertIntent(order, attempt, intent);
    for (let retry = 0; retry < MAX_CAS_RETRIES; retry++) {
      const latest = await this.read(order.id);
      if (!latest || latest.paymentFlow?.attempt?.id !== attempt.id) this.conflict();
      if (latest.payment.stripePaymentIntentId) {
        if (latest.payment.stripePaymentIntentId !== intent.id) this.conflict();
        return intent;
      }
      if (latest.paymentFlow.phase === 'closed') this.conflict();
      if (await this.change(latest, { $set: {
        'payment.stripePaymentIntentId': intent.id, 'payment.stripeAccountId': attempt.accountId,
        'paymentFlow.providerStatus': intent.status, 'paymentFlow.providerCheckedAt': new Date(),
      } })) return intent;
    }
    return this.conflict();
  }

  async cancel(orderId: string, tenantId: string, requestedBy: string, reason: string, provider: OrderPaymentProvider | null): Promise<void> {
    for (let retry = 0; retry < MAX_CAS_RETRIES; retry++) {
      let order = await this.read(orderId);
      if (!order || String(order.tenantId) !== tenantId) throw new NotFoundException('Commande introuvable');
      if (order.status === 'delivered') throw new ConflictException('Commande remise : utilisez le parcours de remboursement.');
      if (order.payment?.status !== 'pending') throw new ConflictException('Commande déjà réglée : utilisez le parcours de remboursement.');
      if (!order.paymentFlow) { await this.adopt(order, provider); continue; }
      if (order.paymentFlow.phase === 'closed' && order.status === 'cancelled') return;
      if (!order.paymentFlow.close) {
        if (!await this.change(order, { $set: {
          'paymentFlow.phase': 'closing', 'paymentFlow.close': {
            operationId: randomUUID(), reason, requestedBy, requestedAt: new Date(),
          },
        } })) continue;
        continue;
      }
      const flow = order.paymentFlow;
      if (flow.origin === 'legacy_unknown') { await this.review(orderId, 'legacy_payment_history_unknown'); this.conflict(); }
      const neverStarted = flow.origin === 'created_v1' && !flow.attempt?.requestStartedAt && !order.payment.stripePaymentIntentId;
      if (!neverStarted) {
        if (!provider) { await this.review(orderId, 'provider_unavailable'); this.conflict(); }
        let intent: ProviderIntent;
        try {
          intent = await this.resolve(order, provider);
          if (CANCELLABLE.has(intent.status)) {
            // A lost cancel response is resolved by reading the SAME PI on retry.
            await provider.cancel(intent.id, flow.attempt?.accountId ?? null, `order-close:${flow.close!.operationId}`);
            intent = await provider.retrieve(intent.id, flow.attempt?.accountId ?? null);
            this.assertIntent(order, flow.attempt!, intent);
          }
        } catch (error) {
          await this.review(orderId, 'provider_closure_unconfirmed');
          if (error instanceof ConflictException) throw error;
          return this.conflict();
        }
        if (intent.status === 'succeeded') {
          await this.applyPaid(orderId, intent.id, flow.attempt?.accountId ?? null, intent.amount);
          throw new ConflictException('Le paiement a abouti : aucun remboursement ni annulation implicite.');
        }
        if (intent.status !== 'canceled') { await this.review(orderId, `provider_${intent.status}`); this.conflict(); }
        order = await this.read(orderId);
        if (!order?.paymentFlow?.close || order.payment.status !== 'pending') this.conflict();
      }
      const close = order.paymentFlow!.close!;
      const update: UpdateQuery<Order> = { $set: {
        status: 'cancelled', 'paymentFlow.phase': 'closed',
        'paymentFlow.providerStatus': neverStarted ? 'not_started' : 'canceled',
        'paymentFlow.providerCheckedAt': new Date(), 'paymentFlow.reviewReason': null,
      } };
      if (order.status !== 'cancelled') update.$push = { statusHistory: { status: 'cancelled', at: new Date(), by: close.requestedBy } };
      if (await this.change(order, update)) return;
    }
    this.conflict();
  }

  /** Signed metadata locate a candidate, but ONLY the durable account+PI+amount prove ownership. */
  async reconcileSucceeded(event: StripeWebhookEvent, provider: OrderPaymentProvider | null): Promise<OrderDocument | null> {
    const intent = event.data?.object as StripeWebhookObject & { amount_received?: number; currency?: string };
    const id = intent?.metadata?.orderId;
    const amount = intent?.amount_received ?? intent?.amount;
    if (!id || !Types.ObjectId.isValid(id) || !intent.id || intent.currency !== 'eur'
      || !Number.isSafeInteger(amount) || !amount || amount < 0) return null;
    let order = await this.read(id);
    if (!order || order.totals.total !== amount || order.payment?.status === 'refunded') return null;
    const expectedEnvironment = order.paymentFlow?.attempt?.environment ?? provider?.environment;
    if (typeof event.livemode === 'boolean' && expectedEnvironment
      && event.livemode !== (expectedEnvironment === 'live')) return null;
    if (!order.payment.stripePaymentIntentId) {
      const attempt = order.paymentFlow?.attempt;
      if (!attempt) throw new ServiceUnavailableException('Historique du paiement à rapprocher avant acquittement.');
      if ((attempt.accountId ?? null) !== (event.account ?? null)) return null;
      if (!provider) throw new ServiceUnavailableException('Récupération du paiement indisponible.');
      try { await this.resolve(order, provider); }
      catch { throw new ServiceUnavailableException('Récupération du paiement à reprendre.'); }
      order = await this.read(id);
    }
    if (!order || order.payment.stripePaymentIntentId !== intent.id
      || (order.payment.stripeAccountId ?? null) !== (event.account ?? null)) return null;
    return this.applyPaid(id, intent.id, event.account ?? null, amount);
  }

  private async applyPaid(id: string, intentId: string, accountId: string | null, amount: number): Promise<OrderDocument | null> {
    for (let retry = 0; retry < MAX_CAS_RETRIES; retry++) {
      const order = await this.read(id);
      if (!order || order.payment.stripePaymentIntentId !== intentId
        || (order.payment.stripeAccountId ?? null) !== accountId || order.totals.total !== amount
        || order.payment.status === 'refunded') return null;
      // Return the unchanged document too: webhook replay repairs DB-commit / Redis-publish crashes.
      if (order.payment.status === 'paid') return order;
      const interrupted = Boolean(order.paymentFlow?.close) || order.status === 'cancelled';
      const flowUpdate = order.paymentFlow ? {
        'paymentFlow.phase': interrupted ? 'review_required' : 'settled',
        'paymentFlow.reviewReason': interrupted ? 'payment_succeeded_during_closure' : null,
      } : { paymentFlow: {
        version: 1, origin: 'adopted_intent', phase: interrupted ? 'review_required' : 'settled',
        attempt: null, close: null, providerStatus: 'succeeded', providerCheckedAt: new Date(),
        reviewReason: interrupted ? 'payment_succeeded_during_closure' : null,
      } };
      const updated = await this.change(order, { $set: {
        ...flowUpdate, 'payment.status': 'paid', 'payment.method': 'online', 'payment.tender': 'online',
        ...(order.paymentFlow ? { 'paymentFlow.providerStatus': 'succeeded', 'paymentFlow.providerCheckedAt': new Date() } : {}),
      } });
      if (updated) return updated;
    }
    throw new ServiceUnavailableException('Confirmation concurrente du paiement : rejeu nécessaire.');
  }
}
