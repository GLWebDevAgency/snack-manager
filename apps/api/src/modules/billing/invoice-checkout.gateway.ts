import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';

export type InvoiceCheckoutSession = Pick<Stripe.Checkout.Session,
  'id' | 'url' | 'status' | 'mode' | 'payment_status' | 'amount_total' | 'currency' |
  'metadata' | 'client_reference_id' | 'payment_intent' | 'expires_at' | 'livemode'>;

/** Encaisse uniquement les factures SM existantes : ni Connect, ni Stripe Invoicing. */
@Injectable()
export class InvoiceCheckoutGateway {
  private client: Stripe | null = null;
  constructor(private readonly config: ConfigService) {}

  enabled(): boolean {
    return this.config.get<string>('STRIPE_BILLING_CHECKOUT_ENABLED') === 'true'
      && Boolean(this.config.get<string>('STRIPE_SECRET_KEY'))
      && Boolean(this.config.get<string>('STRIPE_BILLING_WEBHOOK_SECRET'))
      && this.returnUrl() !== null;
  }

  live(): boolean {
    return /^(sk|rk)_live_/.test(this.config.get<string>('STRIPE_SECRET_KEY') ?? '');
  }

  private returnUrl(): string | null {
    try {
      const url = new URL(this.config.get<string>('STRIPE_BILLING_RETURN_URL') ?? '');
      if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) return null;
      if (url.pathname !== '/admin/abonnement') return null;
      return url.toString();
    } catch { return null; }
  }

  private stripe(): Stripe {
    const key = this.config.get<string>('STRIPE_SECRET_KEY');
    if (!key) throw new ServiceUnavailableException('Paiement des factures indisponible.');
    // Version de l'API alignée sur le SDK installé ; pas de version ancienne épinglée.
    this.client ??= new Stripe(key, { maxNetworkRetries: 2, timeout: 15_000 });
    return this.client;
  }

  async create(input: { invoiceId: string; tenantId: string; number: string; totalCents: number; idempotencyKey: string }): Promise<InvoiceCheckoutSession> {
    const returnUrl = this.returnUrl();
    if (!this.enabled() || !returnUrl) throw new ServiceUnavailableException('Paiement des factures indisponible.');
    const metadata = { purpose: 'sm_invoice', invoiceId: input.invoiceId, tenantId: input.tenantId };
    return this.stripe().checkout.sessions.create({
      mode: 'payment',
      locale: 'fr',
      // Ce pont de paiement ne gère pas encore les règlements différés (SEPA…).
      payment_method_types: ['card'],
      client_reference_id: input.invoiceId,
      metadata,
      payment_intent_data: { metadata, description: `Facture Snack Manager ${input.number}` },
      line_items: [{ quantity: 1, price_data: { currency: 'eur', unit_amount: input.totalCents, product_data: { name: `Facture Snack Manager ${input.number} — TTC` } } }],
      automatic_tax: { enabled: false },
      adaptive_pricing: { enabled: false },
      invoice_creation: { enabled: false },
      allow_promotion_codes: false,
      success_url: `${returnUrl}?payment=return`,
      cancel_url: `${returnUrl}?payment=cancelled`,
    }, { idempotencyKey: input.idempotencyKey });
  }

  retrieve(id: string): Promise<InvoiceCheckoutSession> {
    return this.stripe().checkout.sessions.retrieve(id);
  }

  async expire(id: string): Promise<void> {
    await this.stripe().checkout.sessions.expire(id);
  }

  constructEvent(raw: Buffer | undefined, signature: string | undefined): Stripe.Event {
    const secret = this.config.get<string>('STRIPE_BILLING_WEBHOOK_SECRET');
    if (!secret) throw new ServiceUnavailableException('Webhook de facturation indisponible.');
    if (!raw || !signature) throw new Error('Signature ou corps brut absent.');
    return this.stripe().webhooks.constructEvent(raw, signature, secret);
  }
}
