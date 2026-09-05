import { ConflictException, Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { invoiceTotals } from '@sm/contracts';
import type { Invoice } from '@sm/db';
import type Stripe from 'stripe';
import { InvoiceCheckoutGateway, type InvoiceCheckoutSession } from './invoice-checkout.gateway';

const DUE = ['envoyee', 'en_retard'];
type Stored = Invoice & { _id: unknown };

/** La facture SM reste la seule pièce comptable ; Stripe fournit une preuve de paiement. */
@Injectable()
export class InvoiceCheckoutService {
  private readonly logger = new Logger(InvoiceCheckoutService.name);
  constructor(@InjectModel('Invoice') private readonly invoices: Model<Invoice>, private readonly gateway: InvoiceCheckoutGateway) {}

  available() { return { enabled: this.gateway.enabled() }; }

  private async invoice(tenantId: string, invoiceId: string): Promise<Stored> {
    if (!Types.ObjectId.isValid(tenantId) || !Types.ObjectId.isValid(invoiceId)) throw new NotFoundException('Facture introuvable.');
    const invoice = await this.invoices.findOne({ _id: new Types.ObjectId(invoiceId), tenantId: new Types.ObjectId(tenantId) }).lean();
    if (!invoice) throw new NotFoundException('Facture introuvable.');
    return invoice;
  }

  private total(invoice: Stored): number {
    return invoiceTotals(invoice.amountCents, invoice.vat ?? null).ttcCents;
  }

  private matches(session: InvoiceCheckoutSession, invoice: Stored): boolean {
    return session.mode === 'payment' && session.currency === 'eur'
      && session.livemode === this.gateway.live()
      && session.amount_total === this.total(invoice)
      && session.client_reference_id === String(invoice._id)
      && session.metadata?.purpose === 'sm_invoice'
      && session.metadata.invoiceId === String(invoice._id)
      && session.metadata.tenantId === String(invoice.tenantId);
  }

  private url(session: InvoiceCheckoutSession): string {
    try {
      const url = new URL(session.url ?? '');
      if (url.protocol === 'https:' && url.hostname === 'checkout.stripe.com' && !url.username && !url.password) return url.toString();
    } catch { /* refus sûr ci-dessous */ }
    throw new ServiceUnavailableException('Lien de paiement indisponible.');
  }

  async checkout(tenantId: string, invoiceId: string): Promise<{ url: string }> {
    if (!this.gateway.enabled()) throw new ServiceUnavailableException('Paiement des factures indisponible.');
    const invoice = await this.invoice(tenantId, invoiceId);
    const totalCents = this.total(invoice);
    if (!DUE.includes(invoice.status) || invoice.kind === 'avoir' || !invoice.issuedAt || !Number.isSafeInteger(totalCents) || totalCents < 50) {
      throw new ConflictException('Seule une facture émise, positive et non réglée peut être payée.');
    }
    const previous = invoice.stripeCheckoutSessionId ?? null;
    if (previous) {
      const session = await this.gateway.retrieve(previous);
      if (!this.matches(session, invoice)) throw new ConflictException('La session ne correspond pas à cette facture. Contactez le support.');
      if (session.status === 'open') return { url: this.url(session) };
      if (session.status !== 'expired') throw new ConflictException('Confirmation du paiement en cours. Actualisez les factures dans quelques instants.');
    }
    // Le précédent ID constitue une génération persistée. Deux appels simultanés
    // réutilisent la même clé Stripe, y compris si l'écriture locale a échoué.
    const session = await this.gateway.create({ invoiceId, tenantId, number: invoice.number, totalCents, idempotencyKey: `sm-invoice:${invoiceId}:${previous ?? 'initial'}` });
    if (!this.matches(session, invoice) || session.status !== 'open') throw new ServiceUnavailableException('Session de paiement incohérente.');
    const url = this.url(session);
    const stored = await this.invoices.findOneAndUpdate({
      _id: invoice._id, tenantId: invoice.tenantId, status: { $in: DUE },
      stripeCheckoutSessionId: previous,
      amountCents: invoice.amountCents,
    }, { $set: { stripeCheckoutSessionId: session.id, stripeCheckoutExpiresAt: new Date(session.expires_at * 1000) } }, { new: true }).lean();
    if (!stored) {
      const current = await this.invoice(tenantId, invoiceId);
      if (DUE.includes(current.status) && current.stripeCheckoutSessionId === session.id) return { url };
      // Ne laisser aucun nouveau lien payable si le paiement/annulation manuel a gagné.
      await this.gateway.expire(session.id);
      throw new ConflictException('La facture a changé. Actualisez avant de payer.');
    }
    return { url };
  }

  async webhook(event: Stripe.Event): Promise<{ received: true; result: string }> {
    if (event.account || !['checkout.session.completed', 'checkout.session.async_payment_succeeded'].includes(event.type)) return { received: true, result: 'ignored' };
    const incoming = event.data.object as Stripe.Checkout.Session;
    if (incoming.metadata?.purpose !== 'sm_invoice') return { received: true, result: 'ignored' };
    const { tenantId, invoiceId } = incoming.metadata;
    if (!tenantId || !invoiceId || !incoming.id) throw new ConflictException('Référence de facture Stripe absente.');
    const invoice = await this.invoice(tenantId, invoiceId);
    const session = await this.gateway.retrieve(incoming.id);
    if (session.id !== invoice.stripeCheckoutSessionId || !this.matches(session, invoice)) {
      throw new ConflictException('Paiement Stripe non concordant avec la facture.');
    }
    if (session.status !== 'complete' || session.payment_status !== 'paid') return { received: true, result: 'not_paid' };
    const intentId = typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id;
    if (!intentId) throw new ConflictException('Preuve de règlement Stripe absente.');
    if (invoice.status === 'payee' && invoice.stripePaymentIntentId === intentId) return { received: true, result: 'replay' };
    if (!DUE.includes(invoice.status) || invoice.kind === 'avoir') throw new ConflictException('Facture non payable : rapprochement requis.');
    const paid = await this.invoices.findOneAndUpdate({
      _id: invoice._id, tenantId: invoice.tenantId, status: { $in: DUE },
      stripeCheckoutSessionId: session.id, stripePaymentIntentId: null,
      amountCents: invoice.amountCents,
    }, { $set: { status: 'payee', paidAt: new Date(), method: 'carte', stripePaymentIntentId: intentId, stripePaymentEventId: event.id } }, { new: true }).lean();
    if (!paid) {
      const current = await this.invoice(tenantId, invoiceId);
      if (current.status === 'payee' && current.stripePaymentIntentId === intentId) return { received: true, result: 'replay' };
      throw new ConflictException('Facture modifiée pendant le paiement : rapprochement requis.');
    }
    // La preuve event/session/intent est atomiquement persistée sur la pièce.
    this.logger.log(`Facture ${invoice.number} réglée via Stripe (${event.id}).`);
    return { received: true, result: 'paid' };
  }
}
