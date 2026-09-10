import { ConflictException, Inject, Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import Redis from 'ioredis';
import { ordersChannel, PAYMENT_UNAVAILABLE_REASON, WS_EVENTS, type CounterPaymentResponse, type JwtPayload, type PaymentIntentResponse } from '@sm/contracts';
import type { Order } from '@sm/db';
import { REDIS_PUB } from '../../redis.module';
import { EncaissementService } from '../encaissement/encaissement.service';
import { trackingFilter } from '../orders/tracking';
import { OrderRefundsService } from './order-refunds.service';
import { OrderPaymentLifecycleService, type OrderPaymentProvider, type ProviderIntent } from './order-payment-lifecycle.service';
import { verifierEvenementStripe, type StripeWebhookEvent, type StripeWebhookObject } from '../../common/stripe-signature';

const STRIPE_MODULE = 'stripe';
interface StripeOptions { stripeAccount?: string; idempotencyKey?: string }
interface StripeClient {
  paymentIntents: {
    create(params: Record<string, unknown>, options?: StripeOptions): Promise<ProviderIntent>;
    retrieve(id: string, options?: StripeOptions): Promise<ProviderIntent>;
    cancel(id: string, params: Record<string, unknown>, options?: StripeOptions): Promise<ProviderIntent>;
  };
}
type StripeCtor = new (apiKey: string, config?: Record<string, unknown>) => StripeClient;

export interface WebhookResult {
  received: true;
  outcome: 'payee' | 'deja_payee' | 'echec_paiement' | 'ignoree' | 'remboursement_synchronise';
  message: string;
}
export type { StripeWebhookEvent, StripeWebhookObject };

/** Transport/SDK adapter only. The durable protocol lives in the lifecycle service. */
@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);
  private client: StripeClient | null = null;
  private loadAttempted = false;

  constructor(
    @InjectModel('Order') private readonly orders: Model<Order>,
    private readonly config: ConfigService,
    @Inject(REDIS_PUB) private readonly redis: Redis,
    private readonly encaissement: EncaissementService,
    private readonly lifecycle: OrderPaymentLifecycleService,
    private readonly refunds?: OrderRefundsService,
  ) {}

  async isConfigured(): Promise<boolean> { return (await this.getClient()) !== null; }

  private async getClient(): Promise<StripeClient | null> {
    const key = this.config.get<string>('STRIPE_SECRET_KEY');
    if (!key) return null;
    if (this.client) return this.client;
    if (this.loadAttempted) return null;
    this.loadAttempted = true;
    try {
      const mod = await import(STRIPE_MODULE);
      const ctor = (mod?.default ?? mod) as StripeCtor;
      this.client = new ctor(key);
      return this.client;
    } catch {
      this.logger.warn('SDK Stripe indisponible — nouvelles ouvertures de paiement désactivées.');
      return null;
    }
  }

  private async provider(): Promise<OrderPaymentProvider | null> {
    const stripe = await this.getClient();
    const key = this.config.get<string>('STRIPE_SECRET_KEY') ?? '';
    const environment = /^(sk|rk)_test_/.test(key) ? 'test' : /^(sk|rk)_live_/.test(key) ? 'live' : null;
    if (!stripe || !environment) return null;
    const scope = (accountId: string | null): StripeOptions => accountId ? { stripeAccount: accountId } : {};
    return {
      environment,
      // Direct charges, without platform commission. Everything comes from the durable attempt.
      create: (params, accountId, idempotencyKey) => stripe.paymentIntents.create(
        { ...params }, { stripeAccount: accountId, idempotencyKey },
      ),
      retrieve: (id, accountId) => stripe.paymentIntents.retrieve(id, scope(accountId)),
      cancel: (id, accountId, idempotencyKey) => stripe.paymentIntents.cancel(
        id, { cancellation_reason: 'requested_by_customer' }, { ...scope(accountId), idempotencyKey },
      ),
    };
  }

  private unavailable(reason: string, permanent = false): PaymentIntentResponse {
    return { unavailable: true, reason, permanent };
  }

  async createIntent(orderId: string, token: unknown): Promise<PaymentIntentResponse> {
    const filter = trackingFilter(orderId, token);
    if (!filter) throw new NotFoundException('Commande introuvable');
    const order = await this.orders.findOne(filter);
    if (!order) throw new NotFoundException('Commande introuvable');
    if (order.status === 'cancelled') return this.unavailable('Commande annulée');
    if (order.payment?.status === 'paid') return this.unavailable('Commande déjà réglée');
    if (order.payment?.status === 'refunded') return this.unavailable('Commande déjà remboursée');
    const provider = await this.provider();
    if (!provider) return this.unavailable(PAYMENT_UNAVAILABLE_REASON, true);
    let accountMissing = false;
    try {
      const payment = await this.lifecycle.open(orderId, token, provider, async () => {
        const account = await this.encaissement.compteActifDe(String(order.tenantId));
        accountMissing = !account;
        return account;
      });
      if (!payment?.intent.client_secret) return this.unavailable(
        accountMissing ? 'Paiement en ligne indisponible pour ce restaurant.' : 'Paiement indisponible ou en cours de vérification.',
        accountMissing,
      );
      return {
        unavailable: false, clientSecret: payment.intent.client_secret,
        publishableKey: this.config.get<string>('STRIPE_PUBLISHABLE_KEY') ?? null,
        paymentIntentId: payment.intent.id, stripeAccount: payment.accountId,
        amount: payment.amountCents, currency: 'eur',
      };
    } catch (error) {
      // Never log Stripe response bodies, client secrets or customer information.
      this.logger.warn('Ouverture de paiement non confirmée pour la commande ' + orderId + '.');
      return this.unavailable(error instanceof ConflictException ? error.message : 'Paiement en ligne momentanément indisponible. Ne réglez pas à nouveau avant vérification.');
    }
  }

  async cancelOrder(orderId: string, tenantId: string, actor: JwtPayload, reason: string): Promise<void> {
    await this.lifecycle.cancel(orderId, tenantId, actor.sub, reason, await this.provider());
  }

  /** The lifecycle proves absence/terminal cancellation of any online charge. */
  async switchToCounterPayment(orderId: string, token: unknown): Promise<CounterPaymentResponse> {
    if (!trackingFilter(orderId, token)) throw new NotFoundException('Commande introuvable');
    const order = await this.lifecycle.switchToCounter(orderId, token, await this.provider());
    const payload = { ...order.toObject() } as Record<string, unknown>;
    delete payload.paymentFlow;
    delete payload.customerOwner;
    delete payload.customerSaleAttribution;
    for (const key of Object.keys(payload)) if (key.startsWith('loyalty')) delete payload[key];
    try {
      await this.redis.publish(ordersChannel(String(order.tenantId)), JSON.stringify({
        event: WS_EVENTS.orderUpdated, payload,
      }));
    } catch {
      // A retry resumes the same durable decision and repairs its publication.
      throw new ServiceUnavailableException('Choix comptoir enregistré ; diffusion à reprendre. Actualisez cette commande, sans la recréer.');
    }
    return { _id: String(order._id), payment: { method: 'counter', status: 'pending' } };
  }

  webhookConfigured(): boolean { return this.webhookSecret() !== null; }
  private webhookSecret(): string | null { return this.config.get<string>('STRIPE_WEBHOOK_SECRET')?.trim() || null; }

  constructWebhookEvent(payload: Buffer | string | undefined, signatureHeader: string | undefined): StripeWebhookEvent {
    const secret = this.webhookSecret();
    if (!secret) throw new ServiceUnavailableException('Webhook Stripe non configuré : renseigner STRIPE_WEBHOOK_SECRET côté API.');
    return verifierEvenementStripe(payload, signatureHeader, secret);
  }

  /** Unconfirmed proofs and failed publication return 503 so Stripe retries. */
  async handleWebhookEvent(event: StripeWebhookEvent): Promise<WebhookResult> {
    switch (event.type) {
      case 'charge.refunded': case 'refund.created': case 'refund.updated': case 'refund.failed':
        if (!this.refunds) throw new ServiceUnavailableException('Réconciliation des remboursements indisponible.');
        await this.refunds.webhook(event);
        return { received: true, outcome: 'remboursement_synchronise', message: 'Remboursements réconciliés.' };
      case 'payment_intent.succeeded': {
        const order = await this.lifecycle.reconcileSucceeded(event, await this.provider());
        if (!order) return { received: true, outcome: 'ignoree', message: 'Paiement différent de celui attendu pour cette commande.' };
        // At-least-once is intentional: replay repairs a crash after Mongo commit.
        try {
          await this.redis.publish(ordersChannel(String(order.tenantId)), JSON.stringify({
            event: WS_EVENTS.orderUpdated, payload: order.toObject(),
          }));
        } catch {
          throw new ServiceUnavailableException('Paiement enregistré ; diffusion à reprendre.');
        }
        return { received: true, outcome: 'payee', message: 'Paiement de la commande n° ' + order.number + ' confirmé.' };
      }
      case 'payment_intent.payment_failed':
        return { received: true, outcome: 'echec_paiement', message: 'Paiement refusé — commande laissée en attente.' };
      default:
        return { received: true, outcome: 'ignoree', message: 'Événement non traité.' };
    }
  }
}
