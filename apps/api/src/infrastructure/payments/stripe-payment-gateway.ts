import { Logger } from '@nestjs/common';
import type { Money } from '@sm/domain';
import type {
  PaymentAttempt,
  PaymentGateway,
  PaymentIntent,
  PaymentIntentStatus,
  PaymentMetadata,
  PaymentReference,
  RefundAttempt,
} from '@sm/domain/src/ports';

import { errorMessage } from '../http';

/**
 * ADAPTATEUR — `PaymentGateway` sur Stripe.
 *
 * Spécificateur passé par VARIABLE, et non en littéral : `stripe` n'est pas une
 * dépendance du projet. Un `import('stripe')` littéral ferait échouer `tsc`
 * (module introuvable) et, compilé, un `require` en tête de fichier ferait
 * planter le démarrage de l'API sur une installation qui n'encaisse qu'au
 * comptoir. Avec un spécificateur dynamique, TypeScript ne cherche pas à
 * résoudre le module et l'échec de chargement se rattrape ici, à froid.
 *
 * Pour activer : `pnpm --filter @sm/api add stripe` puis `STRIPE_SECRET_KEY`.
 * Sans cela, la fabrique fournit `NullPaymentGateway` et le paiement au
 * comptoir continue de fonctionner — aucun parcours client n'est bloqué.
 */
const STRIPE_MODULE = 'stripe';

/**
 * Plancher Stripe pour l'euro. Une canette à 1,00 € passe, un supplément sauce
 * à 0,30 € non : sous ce seuil on renvoie « indisponible » plutôt que de
 * laisser Stripe refuser la commande à l'écran du client.
 */
const MIN_CHARGEABLE_CENTS = 50;

// ─── Surface minimale de l'API Stripe réellement utilisée ───

interface StripeIntent {
  id: string;
  client_secret: string | null;
  status: string;
  amount: number;
}

interface StripeRefund {
  id: string;
  status: string | null;
}

interface StripeClient {
  paymentIntents: {
    create(params: Record<string, unknown>): Promise<StripeIntent>;
  };
  refunds: {
    create(params: Record<string, unknown>): Promise<StripeRefund>;
  };
}

type StripeCtor = new (apiKey: string, config?: Record<string, unknown>) => StripeClient;

/**
 * Traduction des états Stripe vers les quatre états du domaine.
 * `requires_*` désigne toujours la même chose côté comptoir : le client n'a pas
 * fini de payer.
 */
function toDomainStatus(status: string): PaymentIntentStatus {
  if (status === 'succeeded') return 'succeeded';
  if (status === 'processing') return 'processing';
  if (status === 'canceled') return 'cancelled';
  return 'requires_payment';
}

export class StripePaymentGateway implements PaymentGateway {
  readonly providerName = 'Stripe';

  private readonly logger = new Logger(StripePaymentGateway.name);
  private client: StripeClient | null = null;
  /** Une seule tentative de chargement : inutile de retenter à chaque requête. */
  private loadAttempted = false;

  constructor(private readonly secretKey: string | null) {}

  isConfigured(): boolean {
    return this.secretKey !== null && this.secretKey.trim() !== '';
  }

  async createIntent(
    reference: PaymentReference,
    amount: Money,
    metadata: PaymentMetadata,
  ): Promise<PaymentAttempt> {
    if (amount.cents < MIN_CHARGEABLE_CENTS) {
      return {
        available: false,
        reason: `Montant trop faible pour un paiement en ligne (minimum ${MIN_CHARGEABLE_CENTS} centimes).`,
      };
    }

    const stripe = await this.getClient();
    if (!stripe) {
      return { available: false, reason: 'Paiement en ligne non configuré' };
    }

    try {
      const intent = await stripe.paymentIntents.create({
        // Centimes — l'unité Stripe pour l'EUR est déjà le centime, aucune
        // conversion : c'est précisément pour éviter cette conversion que le
        // domaine ne manipule jamais d'euros flottants.
        amount: amount.cents,
        currency: 'eur',
        automatic_payment_methods: { enabled: true },
        metadata: {
          ...metadata,
          tenant: reference.tenant.toString(),
          orderId: reference.orderId,
          orderNumber: reference.orderNumber.format(),
        },
      });

      if (!intent.client_secret) {
        this.logger.warn(`PaymentIntent ${intent.id} sans client_secret`);
        return { available: false, reason: 'Paiement en ligne momentanément indisponible' };
      }

      const ready: PaymentIntent = {
        providerId: intent.id,
        clientSecret: intent.client_secret,
        // On renvoie le montant DEMANDÉ, pas celui relu chez Stripe : la
        // commande fait foi, et un écart signalerait une intention créée pour
        // un autre panier.
        amount,
        status: toDomainStatus(intent.status),
      };
      return { available: true, intent: ready };
    } catch (error) {
      // Panne Stripe, clé révoquée, réseau… : on dégrade, on ne casse pas.
      this.logger.error(
        `Échec PaymentIntent commande ${reference.orderNumber.format()} : ${errorMessage(error)}`,
      );
      return { available: false, reason: 'Paiement en ligne momentanément indisponible' };
    }
  }

  async refund(providerId: string, amount: Money, reason: string): Promise<RefundAttempt> {
    const stripe = await this.getClient();
    if (!stripe) {
      return { available: false, reason: 'Paiement en ligne non configuré' };
    }

    try {
      const refund = await stripe.refunds.create({
        payment_intent: providerId,
        amount: amount.cents,
        // Le motif métier (« tacos tombé ») n'entre pas dans l'énumération
        // Stripe : il part en métadonnée, là où il reste lisible au litige.
        metadata: { motif: reason },
      });

      this.logger.log(`Remboursement ${refund.id} de ${amount.format()} — ${reason}`);
      return { available: true, providerId: refund.id, amount };
    } catch (error) {
      this.logger.error(`Échec remboursement ${providerId} : ${errorMessage(error)}`);
      return { available: false, reason: 'Remboursement impossible pour le moment' };
    }
  }

  private async getClient(): Promise<StripeClient | null> {
    const key = this.secretKey?.trim();
    if (!key) return null;
    if (this.client) return this.client;
    if (this.loadAttempted) return null;

    this.loadAttempted = true;
    try {
      // Import dynamique : voir le commentaire sur STRIPE_MODULE.
      const mod = (await import(STRIPE_MODULE)) as { default?: StripeCtor } & StripeCtor;
      const ctor = (mod.default ?? mod) as StripeCtor;
      this.client = new ctor(key);
      return this.client;
    } catch (error) {
      this.logger.warn(
        `Paquet « stripe » indisponible — paiement en ligne désactivé (${errorMessage(error)})`,
      );
      return null;
    }
  }
}
