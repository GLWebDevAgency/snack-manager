import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  PAYMENT_UNAVAILABLE_REASON,
  STRIPE_MIN_AMOUNT_CENTS,
  type PaymentIntentResponse,
} from '@sm/contracts';
import type { Order } from '@sm/db';

/**
 * Spécificateur passé par variable, et non en littéral, VOLONTAIREMENT :
 * `stripe` n'est pas une dépendance du projet. Un `import('stripe')` littéral
 * ferait échouer `tsc` (module introuvable) et, une fois compilé, un `require`
 * en tête de fichier ferait planter le démarrage de l'API. Avec un
 * spécificateur dynamique, TypeScript n'essaie pas de résoudre le module et
 * l'échec de chargement est simplement rattrapé ici, à froid.
 *
 * Pour activer le paiement en ligne : `pnpm --filter @sm/api add stripe` puis
 * renseigner `STRIPE_SECRET_KEY` (et `STRIPE_PUBLISHABLE_KEY` pour le front).
 * Sans cela, l'API répond `{ unavailable: true }` et le paiement au comptoir
 * reste possible — aucun parcours client n'est bloqué.
 */
const STRIPE_MODULE = 'stripe';

// ─── Surface minimale de l'API Stripe réellement utilisée ───

interface StripePaymentIntent {
  id: string;
  client_secret: string | null;
  status: string;
  amount: number;
}

interface StripeClient {
  paymentIntents: {
    create(params: Record<string, unknown>): Promise<StripePaymentIntent>;
    retrieve(id: string): Promise<StripePaymentIntent>;
    update(id: string, params: Record<string, unknown>): Promise<StripePaymentIntent>;
  };
}

type StripeCtor = new (apiKey: string, config?: Record<string, unknown>) => StripeClient;

/** États d'un PaymentIntent encore réutilisable pour le même panier. */
const REUSABLE_STATUSES = new Set([
  'requires_payment_method',
  'requires_confirmation',
  'requires_action',
  'processing',
]);

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);
  private client: StripeClient | null = null;
  /** Une seule tentative de chargement : inutile de retenter à chaque requête. */
  private loadAttempted = false;

  constructor(
    @InjectModel('Order') private readonly orders: Model<Order>,
    private readonly config: ConfigService,
  ) {}

  /** `true` si le paiement en ligne est configuré (clé présente + paquet installé). */
  async isConfigured(): Promise<boolean> {
    return (await this.getClient()) !== null;
  }

  private async getClient(): Promise<StripeClient | null> {
    const key = this.config.get<string>('STRIPE_SECRET_KEY');
    if (!key) return null;
    if (this.client) return this.client;
    if (this.loadAttempted) return null;
    this.loadAttempted = true;
    try {
      // Import dynamique : voir le commentaire sur STRIPE_MODULE.
      const mod = await import(STRIPE_MODULE);
      const ctor = (mod?.default ?? mod) as StripeCtor;
      this.client = new ctor(key);
      return this.client;
    } catch (err) {
      this.logger.warn(
        `Paquet « stripe » indisponible — paiement en ligne désactivé (${errorMessage(err)})`,
      );
      return null;
    }
  }

  private unavailable(reason: string): PaymentIntentResponse {
    return { unavailable: true, reason };
  }

  /**
   * PaymentIntent pour une commande existante.
   * Ne lève jamais pour un problème Stripe : le front doit toujours pouvoir
   * retomber sur « payer au comptoir ».
   */
  async createIntent(orderId: string): Promise<PaymentIntentResponse> {
    if (!Types.ObjectId.isValid(orderId)) throw new NotFoundException('Commande introuvable');
    const order = await this.orders.findById(orderId);
    if (!order) throw new NotFoundException('Commande introuvable');

    if (order.status === 'cancelled') {
      return this.unavailable('Commande annulée');
    }
    if (order.payment?.status === 'paid') {
      return this.unavailable('Commande déjà réglée');
    }

    const amount = Number(order.totals?.total ?? 0); // centimes, jamais un float
    if (!Number.isFinite(amount) || amount < STRIPE_MIN_AMOUNT_CENTS) {
      return this.unavailable('Montant trop faible pour un paiement en ligne');
    }

    const stripe = await this.getClient();
    if (!stripe) return this.unavailable(PAYMENT_UNAVAILABLE_REASON);

    const publishableKey = this.config.get<string>('STRIPE_PUBLISHABLE_KEY') ?? null;

    try {
      const intent = await this.resolveIntent(stripe, order, amount);
      if (!intent.client_secret) {
        this.logger.warn(`PaymentIntent ${intent.id} sans client_secret`);
        return this.unavailable(PAYMENT_UNAVAILABLE_REASON);
      }
      if (order.payment && order.payment.stripePaymentIntentId !== intent.id) {
        order.payment.stripePaymentIntentId = intent.id;
        await order.save();
      }
      return {
        clientSecret: intent.client_secret,
        publishableKey,
        paymentIntentId: intent.id,
        amount,
        currency: 'eur',
        unavailable: false,
      };
    } catch (err) {
      // Panne Stripe, clé invalide, réseau… : on dégrade, on ne casse pas.
      this.logger.error(`Échec PaymentIntent commande ${orderId} : ${errorMessage(err)}`);
      return this.unavailable('Paiement en ligne momentanément indisponible');
    }
  }

  /** Réutilise le PaymentIntent déjà attaché à la commande quand c'est possible. */
  private async resolveIntent(
    stripe: StripeClient,
    order: Order & { _id: unknown },
    amount: number,
  ): Promise<StripePaymentIntent> {
    const existingId = order.payment?.stripePaymentIntentId;
    if (existingId) {
      try {
        const existing = await stripe.paymentIntents.retrieve(existingId);
        if (REUSABLE_STATUSES.has(existing.status)) {
          // Le total a pu bouger (remise appliquée au comptoir) : on resynchronise.
          return existing.amount === amount
            ? existing
            : await stripe.paymentIntents.update(existingId, { amount });
        }
      } catch (err) {
        this.logger.warn(
          `PaymentIntent ${existingId} irrécupérable, création d'un nouveau (${errorMessage(err)})`,
        );
      }
    }

    return stripe.paymentIntents.create({
      amount, // centimes — l'unité Stripe pour l'EUR est déjà le centime
      currency: 'eur',
      automatic_payment_methods: { enabled: true },
      metadata: {
        orderId: String(order._id),
        tenantId: String(order.tenantId),
        orderNumber: String(order.number ?? ''),
      },
    });
  }
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
