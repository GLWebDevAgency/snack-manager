import { createHmac, timingSafeEqual } from 'node:crypto';
import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import Redis from 'ioredis';
import {
  ordersChannel,
  PAYMENT_UNAVAILABLE_REASON,
  STRIPE_MIN_AMOUNT_CENTS,
  WS_EVENTS,
  type PaymentIntentResponse,
} from '@sm/contracts';
import type { Order } from '@sm/db';
import { REDIS_PUB } from '../../redis.module';

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

// ─── Webhook Stripe ───

/**
 * Tolérance d'horodatage de la signature, en secondes — la valeur par défaut de
 * Stripe. Elle borne la fenêtre pendant laquelle une requête interceptée peut
 * être rejouée telle quelle par un tiers ; au-delà, la signature reste
 * mathématiquement correcte mais l'événement est trop vieux pour être honnête.
 * Chaque nouvelle tentative de livraison de Stripe est resignée avec l'heure
 * courante : un vrai rejeu Stripe (jusqu'à 3 jours) passe donc toujours.
 */
const SIGNATURE_TOLERANCE_SECONDS = 300;

/**
 * Sous-ensemble d'un événement Stripe réellement exploité ici — même parti pris
 * que `StripePaymentIntent` plus haut : on décrit ce qu'on lit, pas l'API
 * entière, et on ne dépend d'aucun type du paquet `stripe` (absent du projet).
 */
export interface StripeWebhookEvent {
  id: string;
  type: string;
  data: { object: StripeWebhookObject };
}

export interface StripeWebhookObject {
  id?: string;
  amount?: number;
  metadata?: Record<string, string> | null;
  last_payment_error?: { message?: string } | null;
}

/**
 * Ce qui a été fait de l'événement. Renvoyé à Stripe en 200 : le tableau de bord
 * Stripe affiche ce corps, et c'est là qu'on veut lire « rejeu ignoré » plutôt
 * que de deviner.
 */
export interface WebhookResult {
  received: true;
  /** `payee` · `deja_payee` (rejeu) · `echec_paiement` · `ignoree`. */
  outcome: 'payee' | 'deja_payee' | 'echec_paiement' | 'ignoree';
  message: string;
}

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);
  private client: StripeClient | null = null;
  /** Une seule tentative de chargement : inutile de retenter à chaque requête. */
  private loadAttempted = false;

  constructor(
    @InjectModel('Order') private readonly orders: Model<Order>,
    private readonly config: ConfigService,
    // `RedisModule` est @Global : la connexion de publication est disponible
    // sans passer par `OrdersService`, dont ce module ne dépend pas.
    @Inject(REDIS_PUB) private readonly redis: Redis,
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

  // ─────────────────────────────────────────────────────────────
  // Webhook Stripe — voir `stripe-webhook.controller.ts`
  // ─────────────────────────────────────────────────────────────

  /** `true` si `STRIPE_WEBHOOK_SECRET` est renseignée. */
  webhookConfigured(): boolean {
    return this.webhookSecret() !== null;
  }

  private webhookSecret(): string | null {
    const secret = this.config.get<string>('STRIPE_WEBHOOK_SECRET')?.trim();
    return secret ? secret : null;
  }

  /**
   * Vérifie la signature Stripe et rend l'événement décodé.
   *
   * La vérification est faite ici à la main, avec `node:crypto`, et NON via
   * `stripe.webhooks.constructEvent` : le paquet `stripe` n'est pas une
   * dépendance du projet (cf. `STRIPE_MODULE` plus haut), et un webhook qui ne
   * fonctionnerait qu'après `pnpm add stripe` laisserait les commandes payées
   * en ligne bloquées « en attente » sans que personne ne comprenne pourquoi.
   * L'algorithme est celui, public et stable, du schéma `v1` de Stripe :
   * HMAC-SHA256 de `<timestamp>.<corps brut>` avec le secret `whsec_…`.
   *
   * `payload` DOIT être le corps brut (octets reçus). Un JSON re-sérialisé —
   * même sémantiquement identique — change l'ordre des clés, les espaces et les
   * échappements unicode, donc l'empreinte : la signature échouerait à tous les
   * coups. D'où `rawBody: true` dans `main.ts`.
   *
   * Lève `ServiceUnavailableException` (503) si le secret manque, et
   * `BadRequestException` (400) si la signature ne colle pas — 400 est la
   * réponse que Stripe attend pour arrêter de rejouer un événement illisible.
   */
  constructWebhookEvent(
    payload: Buffer | string | undefined,
    signatureHeader: string | undefined,
  ): StripeWebhookEvent {
    const secret = this.webhookSecret();
    if (!secret) {
      throw new ServiceUnavailableException(
        'Webhook Stripe non configuré : renseigner STRIPE_WEBHOOK_SECRET côté API.',
      );
    }
    if (payload === undefined || payload.length === 0) {
      // Symptôme classique d'un `NestFactory.create` sans `{ rawBody: true }`.
      throw new BadRequestException(
        'Corps brut absent : le webhook Stripe exige « rawBody » (voir main.ts).',
      );
    }
    if (!signatureHeader) {
      throw new BadRequestException('En-tête « stripe-signature » absent.');
    }

    const body = typeof payload === 'string' ? payload : payload.toString('utf8');
    const { timestamp, signatures } = parseSignatureHeader(signatureHeader);

    const expected = createHmac('sha256', secret)
      .update(`${timestamp}.${body}`, 'utf8')
      .digest('hex');
    // Plusieurs `v1` cohabitent pendant une rotation de secret : il suffit
    // qu'UNE corresponde.
    if (!signatures.some((candidate) => safeEqualHex(candidate, expected))) {
      throw new BadRequestException('Signature Stripe invalide.');
    }

    const ageSeconds = Math.abs(Math.floor(Date.now() / 1000) - timestamp);
    if (ageSeconds > SIGNATURE_TOLERANCE_SECONDS) {
      throw new BadRequestException(
        `Horodatage Stripe hors tolérance (${ageSeconds} s) — rejeu suspect ou horloge serveur décalée.`,
      );
    }

    try {
      return JSON.parse(body) as StripeWebhookEvent;
    } catch {
      // Signature valide mais corps illisible : anomalie, pas une attaque.
      throw new BadRequestException('Corps du webhook Stripe illisible.');
    }
  }

  /** Aiguillage des événements. Ne lève pas : tout ce qui n'est pas traité repart en 200. */
  async handleWebhookEvent(event: StripeWebhookEvent): Promise<WebhookResult> {
    switch (event.type) {
      case 'payment_intent.succeeded':
        return this.markPaidFromWebhook(event);
      case 'payment_intent.payment_failed':
        return this.logFailedPayment(event);
      default:
        // Un 4xx ferait rejouer Stripe pour rien : on accuse réception.
        this.logger.debug(`Webhook ${event.id} : type « ${event.type} » non traité.`);
        return {
          received: true,
          outcome: 'ignoree',
          message: `Événement « ${event.type} » non traité.`,
        };
    }
  }

  /**
   * Passe la commande à « payée en ligne », UNE SEULE FOIS.
   *
   * Stripe rejoue un événement jusqu'à trois jours tant qu'il n'a pas eu de 2xx,
   * et rien n'empêche deux instances de l'API de recevoir la même livraison.
   * L'idempotence ne repose donc pas sur une lecture puis une écriture (course
   * classique : les deux lisent « pending », les deux publient) mais sur une
   * transition atomique — le filtre porte sur `payment.status: 'pending'`, si
   * bien qu'un seul appel modifie le document et publie l'événement. Le filtre
   * est volontairement `'pending'` et non `{ $ne: 'paid' }` : une commande
   * remboursée ne doit pas être ramenée à « payée » par un vieux rejeu.
   */
  private async markPaidFromWebhook(event: StripeWebhookEvent): Promise<WebhookResult> {
    const intent = event.data?.object ?? {};
    const orderId = typeof intent.metadata?.orderId === 'string' ? intent.metadata.orderId : null;

    if (!orderId || !Types.ObjectId.isValid(orderId)) {
      this.logger.warn(
        `Webhook ${event.id} : metadata.orderId absent ou invalide (${orderId ?? '—'}) ` +
          `— événement ignoré.`,
      );
      return { received: true, outcome: 'ignoree', message: 'Commande introuvable.' };
    }

    const intentId = typeof intent.id === 'string' ? intent.id : null;
    const paid: Record<string, unknown> = {
      'payment.status': 'paid',
      // `method` dit OÙ l'argent est encaissé, `tender` AVEC QUOI : Stripe
      // répond aux deux à la fois. On renseigne les deux même si le client
      // avait d'abord choisi « au comptoir » — c'est en ligne qu'il a payé, et
      // c'est cette ligne-là que la clôture de caisse doit lire.
      'payment.method': 'online',
      'payment.tender': 'online',
    };
    if (intentId) paid['payment.stripePaymentIntentId'] = intentId;

    const order = await this.orders.findOneAndUpdate(
      { _id: orderId, 'payment.status': 'pending' },
      { $set: paid },
      { new: true },
    );

    if (!order) {
      // Deux cas très différents sous la même absence de résultat.
      const known = await this.orders.findById(orderId).lean();
      if (!known) {
        this.logger.warn(
          `Webhook ${event.id} : commande ${orderId} introuvable — paiement encaissé sans ` +
            `commande correspondante, à vérifier dans Stripe.`,
        );
        return { received: true, outcome: 'ignoree', message: 'Commande introuvable.' };
      }
      // Rejeu : on ne réécrit rien et surtout on ne republie pas — un second
      // « order.updated » relancerait le bip du KDS pour rien.
      this.logger.log(
        `Webhook ${event.id} : commande ${orderId} déjà « ${known.payment?.status} » — rejeu ignoré.`,
      );
      return {
        received: true,
        outcome: 'deja_payee',
        message: 'Commande déjà réglée — rejeu ignoré.',
      };
    }

    // Montants en centimes des deux côtés : un écart signale un PaymentIntent
    // créé pour un autre panier (remise appliquée après coup, par exemple).
    // L'argent est encaissé, on n'annule rien — on laisse une trace au litige.
    const expectedCents = Number(order.totals?.total ?? 0);
    if (typeof intent.amount === 'number' && intent.amount !== expectedCents) {
      this.logger.warn(
        `Webhook ${event.id} : encaissé ${intent.amount} c pour une commande à ` +
          `${expectedCents} c (n° ${order.number}).`,
      );
    }

    await this.publishOrder(String(order.tenantId), order.toObject());
    this.logger.log(`Commande n° ${order.number} réglée en ligne (webhook ${event.id}).`);
    return {
      received: true,
      outcome: 'payee',
      message: `Commande n° ${order.number} réglée en ligne.`,
    };
  }

  /**
   * Paiement refusé : on journalise et on ne touche à RIEN.
   *
   * La commande reste « en attente » — c'est l'état juste : le client peut
   * retenter avec une autre carte ou payer au comptoir, et la cuisine ne doit
   * pas la voir confirmée.
   */
  private logFailedPayment(event: StripeWebhookEvent): WebhookResult {
    const intent = event.data?.object ?? {};
    const orderId = intent.metadata?.orderId ?? '(inconnue)';
    const reason = intent.last_payment_error?.message ?? 'motif non communiqué par Stripe';
    this.logger.warn(
      `Paiement refusé pour la commande ${orderId} — ${reason}. ` +
        `Commande laissée en attente de règlement.`,
    );
    return {
      received: true,
      outcome: 'echec_paiement',
      message: 'Paiement refusé — commande laissée en attente.',
    };
  }

  /**
   * Diffuse la confirmation sur le canal du tenant, exactement sous la forme
   * qu'`OrdersService` publie déjà (`order.updated` + commande complète) : le
   * KDS et le back-office n'ont rien de nouveau à apprendre.
   *
   * Le `tenantId` vient de la commande relue en base, jamais des métadonnées
   * Stripe — c'est un corps de requête, même signé.
   *
   * Ne lève pas : le paiement est acté en base, et faire échouer la requête
   * ferait rejouer Stripe, dont le rejeu tomberait sur la branche idempotente
   * et ne republierait rien. Un écran en retard se rattrape au rafraîchissement.
   */
  private async publishOrder(tenantId: string, payload: unknown): Promise<void> {
    try {
      const message = JSON.stringify({ event: WS_EVENTS.orderUpdated, payload });
      await this.redis.publish(ordersChannel(tenantId), message);
    } catch (err) {
      this.logger.error(`Diffusion « order.updated » impossible : ${errorMessage(err)}`);
    }
  }
}

/**
 * `stripe-signature: t=1614556800,v1=5257a8…,v1=…`
 *
 * Tolérant sur la forme (espaces, paires inconnues comme `v0`), strict sur le
 * fond : sans `t` ni au moins un `v1`, il n'y a rien à vérifier.
 */
function parseSignatureHeader(header: string): { timestamp: number; signatures: string[] } {
  let timestamp = Number.NaN;
  const signatures: string[] = [];

  for (const part of header.split(',')) {
    const separator = part.indexOf('=');
    if (separator === -1) continue;
    const key = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    if (key === 't') timestamp = Number(value);
    else if (key === 'v1') signatures.push(value);
  }

  if (!Number.isFinite(timestamp) || signatures.length === 0) {
    throw new BadRequestException('En-tête « stripe-signature » illisible.');
  }
  return { timestamp, signatures };
}

/**
 * Comparaison à temps constant de deux empreintes hexadécimales.
 * Un `===` fuirait, par sa durée, le nombre de caractères devinés — de quoi
 * reconstruire une signature valide octet par octet.
 */
function safeEqualHex(candidate: string, expected: string): boolean {
  if (candidate.length !== expected.length) return false;
  try {
    return timingSafeEqual(Buffer.from(candidate, 'hex'), Buffer.from(expected, 'hex'));
  } catch {
    // `candidate` n'est pas de l'hexadécimal : longueurs décodées différentes.
    return false;
  }
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
