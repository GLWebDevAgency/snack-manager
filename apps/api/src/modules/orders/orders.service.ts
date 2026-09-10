import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import Redis from 'ioredis';
import { Money, ordering } from '@sm/domain';
import {
  type CreateOrder,
  type JwtPayload,
  orderAccessScope,
  plafondRemiseLabel,
  REMISE_PLAFOND_CENTS,
  type StaffRole,
  ORDER_STATUS_RANK,
  type OrderStatus,
  type OrderLoyaltyEarnStatus,
  type OrderTracking,
  ordersChannel,
  WS_EVENTS,
  StaffOrderAttemptResultSchema,
  StaffPhoneOrderAttemptRequestSchema,
  GuestOrderReorderResponseSchema,
} from '@sm/contracts';
import type { Counter, Order, Product, Promotion, Tenant } from '@sm/db';
import { REDIS_PUB } from '../../redis.module';
import { publishRedisBestEffort } from '../../common/redis-best-effort';
import { AuditService } from '../audit/audit.module';
import { resolvePayment } from './payment';
import { newTrackingToken, trackingFilter } from './tracking';
import { CapacitesService } from '../../common/capacites';
import { priceOrderLines } from './price-order-lines';
import { computeDeliveryForOrder } from '../delivery/delivery-order';
import { PaymentsService } from '../ordering/payments.service';
import { promotionCandidatesFilter, selectCartPromotion } from './cart-promotion';
import { type CustomerOrderCommitAuthority } from './customer-order-owner';
import { CustomerOrderAuthorityLost, CustomerOrderPreparationUnavailable } from './order-admission.errors';
import { prepareCustomerSaleAttribution, type PrepareCustomerSaleAttribution } from './customer-sale-attribution';
import { assertPublicRecoveryReplay, type PublicRecoveryBinding } from './order-recovery';
import { PublicOrderAdmissionService, PublicOrderSnapshotInvalid } from './public-order-admission.service';
import type { OrderAdmissionBinding } from './order-admission-identity';
import { customerOrderReorder } from './customer-order-projection';

/**
 * Le plafond de lecture d'une liste de commandes.
 *
 * Deux cents suffit à un service de comptoir ordinaire ; au-delà, la réponse
 * annonce sa troncature plutôt que de laisser croire à un total.
 */
const ORDERS_PAGE_MAX = 200;
/** La cuisine prépare ; seule une identité de comptoir/gestion confirme la remise. */
const ORDER_HANDOFF_ROLES: readonly JwtPayload['role'][] = ['owner', 'cogerant', 'gerant', 'caisse'];
type OrderReadFilter = Readonly<{ status?: OrderStatus; since?: string }>;

@Injectable()
export class OrdersService {
  constructor(
    @InjectModel('Order') private readonly orders: Model<Order>,
    @InjectModel('Product') private readonly products: Model<Product>,
    @InjectModel('Counter') private readonly counters: Model<Counter>,
    @InjectModel('Promotion') private readonly promotions: Model<Promotion>,
    @Inject(REDIS_PUB) private readonly redis: Redis,
    private readonly audit: AuditService,
    @InjectModel('Tenant') private readonly tenants: Model<Tenant>,
    private readonly capacites: CapacitesService,
    private readonly payments: PaymentsService,
    @Optional() private readonly admissions?: PublicOrderAdmissionService,
  ) {}

  private publish(tenantId: string, event: string, payload: unknown) {
    void publishRedisBestEffort(
      this.redis,
      ordersChannel(tenantId),
      JSON.stringify({ event, payload }),
    );
  }

  async tenantForStaffSlots(tenantId: string) {
    if ((await this.readFilter(tenantId, {})).channel) throw new ForbiddenException('La prise de commande téléphone nécessite la caisse.');
    const tenant = await this.tenants.findById(tenantId).select('_id settings hours closures').lean();
    if (!tenant) throw new NotFoundException('Établissement introuvable');
    return tenant;
  }

  async staffAttempt(tenantId: string, dto: CreateOrder, abandon: boolean) {
    if ((await this.readFilter(tenantId, {})).channel) throw new ForbiddenException('La prise de commande téléphone nécessite la caisse.');
    if (dto.channel !== 'phone' || dto.type !== 'pickup' || !dto.pickup || dto.payment?.method !== 'counter'
      || dto.payment.tender != null || dto.loyaltyMemberId || dto.loyaltyEarnOperationId) throw new BadRequestException('Tentative téléphone invalide.');
    if (!this.admissions) throw new ServiceUnavailableException('La reprise de commande est indisponible.');
    const result = await this.admissions.observeInternal(tenantId, dto, 'staff', abandon);
    return StaffOrderAttemptResultSchema.parse({ ...result, tenantId, clientId: dto.clientId, channel: 'phone',
      ...(result.state === 'created' ? { order: JSON.parse(JSON.stringify(result.order.toObject())) } : {}) });
  }

  /** Filtre tenant et métier unique pour la liste et sa projection count-only. */
  private async readFilter(
    tenantId: string,
    filter: OrderReadFilter,
  ): Promise<Record<string, unknown>> {
    const query: Record<string, unknown> = { tenantId };
    const scope = orderAccessScope(await this.capacites.pourTenant(tenantId));
    if (scope === 'none') throw new ForbiddenException('La gestion des commandes n’est pas incluse dans votre offre.');
    if (scope === 'online') query.channel = 'online';
    if (filter.status) query.status = filter.status;
    if (filter.since) query.createdAt = { $gte: new Date(filter.since) };
    return query;
  }

  /** Défense supplémentaire avant diffusion temps réel vers caisse ET cuisine. */
  private orderEventPayload(order: { toObject(): Record<string, unknown> }) {
    const payload = { ...order.toObject() };
    delete payload.loyaltyMemberId;
    delete payload.loyaltyEarnOperationId;
    delete payload.loyaltyActorRef;
    delete payload.loyaltyDeviceRef;
    delete payload.loyaltyEarnState;
    delete payload.loyaltyEarnAttempts;
    delete payload.loyaltyEarnLastError;
    delete payload.loyaltyEarnCompletedAt;
    delete payload.loyaltyEarnNextAttemptAt;
    delete payload.loyaltyEarnLeaseUntil;
    delete payload.paymentFlow;
    delete payload.counterCollection;
    delete payload.publicRecovery;
    delete payload.customerOwner;
    delete payload.customerSaleAttribution;
    return payload;
  }

  /**
   * Transforme une collision `__v` en conflit métier explicite.
   *
   * `OrderSchema.optimisticConcurrency` empêche deux documents lus au même
   * instant de s'écraser. Sans cette traduction, Mongoose protégerait bien la
   * donnée mais la caisse recevrait un 500 sans savoir qu'elle doit actualiser.
   */
  private async saveWithoutLostUpdate(order: { save(): Promise<unknown> }): Promise<void> {
    try {
      await order.save();
    } catch (error) {
      if (error instanceof Error && error.name === 'VersionError') {
        throw new ConflictException(
          'Commande modifiée en parallèle — actualisez le ticket puis recommencez',
        );
      }
      throw error;
    }
  }

  /**
   * LA PROMOTION APPLICABLE — et son incrément d'usage, atomique.
   *
   * Rien n'appliquait les promotions : `totals.discount` valait `null` en dur
   * et `usageCount` restait à zéro pour toujours. Le back-office savait
   * pourtant les créer, les activer d'un clic et les supprimer — le logiciel
   * avait l'air complet, et le code imprimé sur les flyers n'était accepté
   * nulle part.
   *
   * ── Deux chemins, une seule règle ─────────────────────────────────────
   *
   * Avec un code saisi, on cherche CETTE offre et on dit pourquoi si elle est
   * refusée : le client doit savoir s'il s'est trompé, s'il est trop tôt, ou si
   * son panier est trop petit. Sans code, on applique d'office la meilleure des
   * offres publiques — c'est la seule interprétation défendable de « promotion
   * sans code » du point de vue du client.
   *
   * ── L'incrément est une COURSE, et il est traité comme telle ──────────
   *
   * Deux commandes simultanées sur la dernière utilisation d'un code passeraient
   * toutes deux le contrôle du domaine, qui lit un compteur figé. La garde vit
   * donc dans le `findOneAndUpdate` : c'est Mongo qui arbitre, et le perdant
   * repart sans promotion plutôt qu'avec une remise hors quota.
   */
  private async resoudrePromotion(
    tenantId: string,
    dto: CreateOrder,
    subtotal: number,
    lines: readonly { productId: unknown; unitPrice: number }[],
  ): Promise<{ discount: { amount: number; reason: string; promotionId: unknown } } | null> {
    const code = dto.promoCode?.trim();
    const candidates = await this.promotions.find(promotionCandidatesFilter(tenantId, code)).lean();
    const retenue = selectCartPromotion(candidates, { subtotal, channel: dto.channel, promoCode: code, now: new Date(), lines });
    if (!retenue) return null;

    // Le quota s'arbitre ici, en base. `maxUsage: 0` vaut illimité — la
    // condition doit donc laisser passer ce cas sans le confondre avec un
    // quota épuisé.
    const reserve = await this.promotions.findOneAndUpdate(
      {
        _id: retenue.id,
        tenantId,
        active: true,
        $or: [{ maxUsage: { $lte: 0 } }, { $expr: { $lt: ['$usageCount', '$maxUsage'] } }],
      },
      { $inc: { usageCount: 1 } },
      { new: true },
    );
    if (!reserve) {
      if (code) {
        throw new ConflictException('Cette offre vient d’atteindre son nombre d’utilisations');
      }
      return null;
    }

    return {
      discount: { amount: retenue.amount, reason: retenue.reason, promotionId: retenue.id },
    };
  }

  /** Numéro de retrait : séquence journalière par tenant, atomique (fuseau restaurant). */
  private async nextNumber(tenantId: string): Promise<number> {
    const day = new Intl.DateTimeFormat('fr-CA', { timeZone: 'Europe/Paris' })
      .format(new Date())
      .replace(/-/g, '');
    const doc = await this.counters.findOneAndUpdate(
      { _id: `${tenantId}:${day}` },
      { $inc: { seq: 1 } },
      { new: true, upsert: true },
    );
    return doc!.seq;
  }

  /**
   * Création de commande — POS, téléphone ou en ligne.
   * Les prix sont TOUJOURS résolus côté serveur depuis le menu courant.
   * Idempotente sur {tenantId, clientId} : le rejeu offline renvoie l'existante.
   */
  async create(
    tenantId: string,
    dto: CreateOrder,
    actor: string,
    deviceRef: string | null = null,
  ) {
    if (!['pos', 'phone'].includes(dto.channel)) throw new ForbiddenException('Le canal de cette route est caisse ou téléphone.');
    if (dto.channel === 'phone') {
      const attempt = StaffPhoneOrderAttemptRequestSchema.safeParse(dto);
      if (!attempt.success) throw new BadRequestException('Vérifiez la commande et son créneau téléphone ; encaissez ensuite la commande existante.');
      dto = attempt.data;
    }
    return (await this.createWithOutcome(tenantId, dto, actor, deviceRef, undefined, 'staff')).order;
  }

  /**
   * Variante qui révèle uniquement si CET appel a créé le document.
   *
   * Le contrôleur public s'en sert pour rendre sa réservation anti-abus lors
   * d'une course idempotente. Les autres appelants gardent l'API historique et
   * ne voient que la commande.
   */
  async createWithOutcome(
    tenantId: string,
    dto: CreateOrder,
    actor: string,
    deviceRef: string | null = null,
    recovery?: PublicRecoveryBinding,
    origin: 'legacy' | 'staff' = 'legacy',
    beforeCommit?: CustomerOrderCommitAuthority,
    prepareLoyaltyAttribution?: PrepareCustomerSaleAttribution,
  ) {
    const permitted = await this.readFilter(tenantId, {});
    if (permitted.channel && dto.channel !== permitted.channel) {
      throw new ForbiddenException('Cette offre permet uniquement les commandes en ligne.');
    }
    if (recovery && (!this.admissions || dto.channel !== 'online')) throw new ForbiddenException('Admission publique requise');
    let admissionBinding: OrderAdmissionBinding | undefined = recovery;
    if (!recovery && dto.pickup) {
      if (!this.admissions) throw new ServiceUnavailableException('La réservation des commandes est indisponible.');
      const prepared = await this.admissions.prepareInternal(tenantId, dto, origin);
      if (prepared.order) return { order: await this.withTrackingToken(prepared.order), created: false as const };
      admissionBinding = prepared.binding!;
    } else if (!recovery && this.admissions) {
      // A body which removes its slot must not bypass a previously slotted admission.
      await this.admissions.assertLegacyKeyAvailable(tenantId, dto.clientId);
    }
    const existing = await this.orders.findOne({ ...permitted, clientId: dto.clientId }, '+publicRecovery +customerOwner');
    if (existing) {
      assertPublicRecoveryReplay(existing, recovery);
      return { order: await this.withTrackingToken(existing), created: false as const };
    }

    const candidateId = admissionBinding ? new Types.ObjectId() : undefined;
    let admissionCommitStarted = false;
    let promotion: Awaited<ReturnType<OrdersService['resoudrePromotion']>> = null;
    try {
      const ids = [...new Set(dto.lines.map((l) => l.productId))];
      const prods = await this.products.find({ _id: { $in: ids }, tenantId, active: true }).lean();
      const { subtotal, lines } = priceOrderLines(prods, dto.lines);

    // LA PROMOTION, RÉSOLUE CÔTÉ SERVEUR comme les prix.
    //
    // Le corps ne porte qu'un CODE : le montant est calculé ici contre la
    // promotion en base. Un client qui enverrait sa propre remise n'obtient
    // rien — même règle que pour les prix, et pour la même raison.
      promotion = await this.resoudrePromotion(tenantId, dto, subtotal, lines);

    // Ce que le client doit RÉELLEMENT — le seul montant qui fasse autorité
    // pour l'encaissement, le rendu monnaie et le ticket.
    const subtotalAfterDiscount = subtotal - (promotion?.discount.amount ?? 0);

      const number = await this.nextNumber(tenantId);
      const tenant = dto.type === 'delivery' ? await this.tenants.findById(tenantId).lean() : null;
      if (dto.type === 'delivery' && !tenant) throw new NotFoundException('Établissement introuvable');
      const delivery = computeDeliveryForOrder(tenant ?? {}, dto, subtotalAfterDiscount);
      const totalDu = subtotalAfterDiscount + (delivery?.feeCents ?? 0);
      const customerSaleAttribution = recovery?.customerOwner
        ? await prepareCustomerSaleAttribution(prepareLoyaltyAttribution, Object.freeze({
          tenantRef: tenantId, clientId: dto.clientId, owner: Object.freeze({ ...recovery.customerOwner }),
          totals: Object.freeze({ subtotalCents: subtotal, discountCents: promotion?.discount.amount ?? 0,
            deliveryFeeCents: delivery?.feeCents ?? 0, totalCents: totalDu }),
        })) : null;
      const candidate = {
        ...(candidateId ? { _id: candidateId } : {}),
        tenantId,
        number,
        clientId: dto.clientId,
        customerOwner: recovery?.customerOwner ?? null,
        customerSaleAttribution,
        loyaltyMemberId: dto.loyaltyMemberId ?? null,
        loyaltyEarnOperationId: dto.loyaltyEarnOperationId ?? null,
        loyaltyActorRef: dto.loyaltyMemberId ? actor : null,
        loyaltyDeviceRef: dto.loyaltyMemberId ? deviceRef : null,
        loyaltyEarnState: dto.loyaltyMemberId ? 'pending' : null,
        loyaltyEarnAttempts: 0,
        loyaltyEarnLastError: null,
        loyaltyEarnCompletedAt: null,
        loyaltyEarnNextAttemptAt: null,
        loyaltyEarnLeaseUntil: null,
        channel: dto.channel,
        type: dto.type,
        lines,
        totals: { subtotal, discount: promotion?.discount ?? null, deliveryFee: delivery?.feeCents ?? 0, total: totalDu },
        delivery,
        // LE TOTAL DÛ, remise comprise — jamais le sous-total.
        //
        // Il vient d'être recalculé depuis le menu, pas du corps envoyé par
        // l'appareil. Et il est DIMINUÉ de la promotion : tant que rien ne les
        // appliquait, `discount` valait toujours `null` et les deux montants
        // coïncidaient — passer l'un pour l'autre était sans conséquence.
        //
        // Depuis qu'une promotion peut s'appliquer, ce raccourci ment deux
        // fois : sur une commande de 20 € remisée de 2 €, le client qui tend
        // 18 € se fait refuser « montant reçu insuffisant », et celui qui tend
        // 20 € repart sans son rendu monnaie.
        payment: resolvePayment(dto.channel, dto.payment, totalDu),
        paymentFlow: { version: 1, origin: 'created_v1', phase: 'open', attempt: null, close: null,
          providerStatus: null, providerCheckedAt: null, reviewReason: null },
        trackingToken: newTrackingToken(),
        status: 'new',
        statusHistory: [{ status: 'new', at: new Date(), by: actor }],
        pickup: dto.pickup
          ? {
              slot: new Date(dto.pickup.slot),
              customerName: dto.pickup.customerName,
              customerPhone: dto.pickup.customerPhone ?? null,
            }
          : null,
        note: dto.note ?? null,
      };
      if (admissionBinding) {
        admissionCommitStarted = true;
        const outcome = recovery
          ? await this.admissions!.commit(tenantId, dto.clientId, recovery, candidate, beforeCommit)
          : await this.admissions!.commitInternal(tenantId, dto.clientId, admissionBinding, candidate);
        if (!outcome.created) await this.rendreReservation(tenantId, promotion);
        return outcome;
      }
      const order = await this.orders.create(candidate);
      this.publish(tenantId, WS_EVENTS.orderCreated, this.orderEventPayload(order));
      return { order, created: true as const };
    } catch (err: unknown) {
      if (admissionBinding && !recovery) {
        if (err instanceof BadRequestException || err instanceof ConflictException || err instanceof ForbiddenException || err instanceof NotFoundException) {
          try {
            const winner = await this.admissions!.rejectInternal(tenantId, dto.clientId, admissionBinding,
              err instanceof ForbiddenException ? 'unavailable' : 'invalid_order');
            if (String(winner._id) !== String(candidateId)) await this.rendreReservation(tenantId, promotion);
            return { order: winner, created: String(winner._id) === String(candidateId) };
          } catch (decision) {
            // Un refus de prix avant le CAS reste explicite pour l'utilisateur,
            // mais seulement après preuve durable de la fermeture. Une erreur
            // de lecture ne doit jamais se transformer en faux refus définitif.
            const response = decision instanceof ConflictException ? decision.getResponse() : null;
            err = !admissionCommitStarted && response && typeof response === 'object'
              && (response as { code?: unknown }).code === 'ORDER_ATTEMPT_REJECTED'
              ? new ConflictException({ ...response, message: err.message }) : decision;
          }
        } else if (!admissionCommitStarted) {
          await this.admissions!.releaseInternalValidation(tenantId, dto.clientId, admissionBinding);
        }
      }
      // LA RÉSERVATION EST RENDUE : la commande n'existera pas.
      //
      // `resoudrePromotion` incrémente `usageCount` AVANT la création, et il le
      // faut — c'est ce qui arbitre la course sur la dernière utilisation d'un
      // code. Mais une réservation sans commande grignote le quota pour rien,
      // et le cas n'est pas théorique : un POS qui rejoue sa file offline
      // repasse ici avec le même `clientId`, se fait refuser en doublon (11000),
      // et aurait consommé une utilisation à chaque tentative.
      //
      // Best-effort ASSUMÉ : si la compensation échoue, on ne masque pas
      // l'erreur d'origine, qui est celle qui intéresse l'appelant. Le quota
      // peut alors dériver d'une unité — préjudice sans commune mesure avec une
      // création de commande avalée.
      // Une réponse perdue après committing n'autorise pas à rendre la promo
      // gagnante : son snapshot reste matérialisable par la reprise publique.
      if (!admissionBinding || !admissionCommitStarted || err instanceof PublicOrderSnapshotInvalid || err instanceof CustomerOrderAuthorityLost
        || err instanceof CustomerOrderPreparationUnavailable || await this.admissions!.candidateLost(tenantId, dto.clientId, candidateId)) {
        await this.rendreReservation(tenantId, promotion);
      }

      // Course entre deux rejeux simultanés de la même commande offline
      if ((err as { code?: number }).code === 11000) {
        const raced = await this.orders.findOne({ ...permitted, clientId: dto.clientId }, '+publicRecovery +customerOwner');
        if (raced) {
          assertPublicRecoveryReplay(raced, recovery);
          return { order: await this.withTrackingToken(raced), created: false as const };
        }
      }
      throw err;
    }
  }

  /**
   * Rejeu public avant une preuve Turnstile neuve.
   *
   * Le token fournisseur est a usage unique. Si la reponse de creation s'est
   * perdue, le meme `clientId` doit retrouver la commande existante sans
   * consommer une seconde preuve, un second quota ou un second numero.
   */
  async findByClientId(tenantId: string, clientId: string) {
    const existing = await this.orders.findOne({ ...await this.readFilter(tenantId, {}), clientId });
    return existing ? this.withTrackingToken(existing) : null;
  }

  /** Ancien POST public : ne contourne jamais la preuve des commandes récentes. */
  async findPublicReplay(tenantId: string, clientId: string) {
    const existing = await this.orders.findOne({ ...await this.readFilter(tenantId, {}), clientId }, '+publicRecovery +customerOwner');
    if (!existing) return null;
    if (existing.channel !== 'online') throw new NotFoundException('Commande introuvable');
    assertPublicRecoveryReplay(existing);
    return this.withTrackingToken(existing);
  }

  /**
   * Projection minimale pour que le POS sache si le serveur a réellement
   * crédité le ledger. Aucun membre, operationId, auteur ou détail interne ne
   * franchit cette route.
   */
  async loyaltyEarnStatusByClientId(
    tenantId: string,
    clientId: string,
  ): Promise<OrderLoyaltyEarnStatus | null> {
    const order = await this.orders
      .findOne({ ...await this.readFilter(tenantId, {}), clientId })
      .select('+loyaltyEarnState +loyaltyEarnAttempts +loyaltyEarnLastError')
      .lean<{
        loyaltyEarnState?: string | null;
        loyaltyEarnAttempts?: number | null;
        loyaltyEarnLastError?: string | null;
      } | null>();
    if (!order) return null;

    const state = order.loyaltyEarnState;
    const publicState =
      state === 'pending' ||
      state === 'processing' ||
      state === 'completed' ||
      state === 'failed' ||
      state === 'cancelled'
        ? state
        : 'none';
    const attempts = Number.isSafeInteger(order.loyaltyEarnAttempts)
      ? Math.max(0, Number(order.loyaltyEarnAttempts))
      : 0;
    const errorCode =
      typeof order.loyaltyEarnLastError === 'string' &&
      /^[a-z0-9_]{1,64}$/.test(order.loyaltyEarnLastError)
        ? order.loyaltyEarnLastError
        : null;
    return { state: publicState, attempts, errorCode };
  }

  /**
   * Rend une utilisation réservée dont la commande n'est jamais née.
   *
   * Le décrément est borné à zéro : sans la garde, une compensation jouée deux
   * fois — ou sur une promotion remise à zéro entre-temps par le gérant —
   * rendrait le compteur négatif, et « −1 utilisée » ne veut rien dire sur
   * l'écran des promotions.
   */
  private async rendreReservation(
    tenantId: string,
    promotion: { discount: { promotionId: unknown } } | null,
  ): Promise<void> {
    if (!promotion) return;
    try {
      await this.promotions.updateOne(
        { _id: promotion.discount.promotionId, tenantId, usageCount: { $gt: 0 } },
        { $inc: { usageCount: -1 } },
      );
    } catch {
      /* l'erreur d'origine prime : elle seule intéresse l'appelant */
    }
  }

  /**
   * Garantit un jeton de suivi sur une commande retrouvée.
   *
   * Une commande créée avant l'introduction du champ — ou parquée dans la file
   * offline d'une tablette pas encore mise à jour — n'en a pas. Sans ce
   * rattrapage, son lien de suivi et son ticket seraient définitivement
   * inaccessibles. Écrit en `$set` ciblé : un `save()` revaliderait tout le
   * document, en plein service, pour un champ ajouté après coup.
   */
  private async withTrackingToken(order: Order & { _id: unknown }) {
    if (order.trackingToken) return order;
    const patched = await this.orders.findOneAndUpdate(
      { _id: order._id, $or: [{ trackingToken: null }, { trackingToken: { $exists: false } }] },
      { $set: { trackingToken: newTrackingToken() } },
      { new: true },
    );
    return patched ?? order;
  }

  /**
   * Les commandes du service — plafonnées, et le PLAFOND SE DIT.
   *
   * `total` valait `rows.length`, c'est-à-dire le plafond lui-même dès qu'il
   * était atteint. Le Z de clôture du POS est calculé sur cette liste : un
   * snack qui passe deux cent cinquante tickets dans la journée voyait les
   * cinquante plus anciens disparaître du chiffre d'affaires, des espèces, de
   * la carte et des titres-restaurant — sans qu'aucun écran ne signale la
   * coupe. Le gérant recomptait sa caisse contre un total amputé.
   *
   * `total` est désormais le vrai compte, et `truncated` dit qu'il manque des
   * lignes. Les deux ensemble permettent à l'écran de refuser de conclure,
   * plutôt que de conclure faux.
   */
  async list(tenantId: string, filter: OrderReadFilter) {
    const query = await this.readFilter(tenantId, filter);
    const [rows, total] = await Promise.all([
      this.orders.find(query).sort({ createdAt: -1 }).limit(ORDERS_PAGE_MAX).lean(),
      this.orders.countDocuments(query),
    ]);
    return { rows, total, truncated: total > rows.length };
  }

  async count(
    tenantId: string,
    filter: OrderReadFilter,
  ): Promise<{ total: number }> {
    return { total: await this.orders.countDocuments(await this.readFilter(tenantId, filter)) };
  }

  async byId(tenantId: string, id: string) {
    const order = await this.orders.findOne({ ...await this.readFilter(tenantId, {}), _id: id }).select('+paymentFlow');
    if (!order) throw new NotFoundException('Commande introuvable');
    return order;
  }

  /**
   * Suivi public (page client sans compte) — projection minimale.
   *
   * Exige `?t=<trackingToken>`. Jeton absent ou faux ⇒ 404 et non 403 : un 403
   * confirmerait l'existence de la commande, donc la validité de l'ObjectId
   * deviné, ce que le jeton doit justement empêcher.
   */
  async publicTracking(id: string, token: unknown): Promise<OrderTracking> {
    const filter = trackingFilter(id, token);
    if (!filter) throw new NotFoundException('Commande introuvable');
    const order = await this.orders.findOne(filter).lean();
    if (!order) throw new NotFoundException('Commande introuvable');
    return {
      _id: String(order._id),
      number: Number(order.number ?? 0),
      status: (order.status ?? 'new') as OrderStatus,
      statusHistory: (order.statusHistory ?? []).map((step) => ({
        status: (step.status ?? 'new') as OrderStatus,
        at: new Date(step.at ?? order.createdAt ?? Date.now()).toISOString(),
      })),
      pickupSlot: order.pickup?.slot ? new Date(order.pickup.slot).toISOString() : null,
      payment: {
        status: order.payment.status as 'pending' | 'paid' | 'refunded',
        method: order.payment.method as 'online' | 'counter',
        refundedCents: order.payment.refundedCents ?? 0,
        pendingRefundCents: order.payment.pendingRefundCents ?? 0,
      },
      fulfillment: order.type === 'delivery' ? 'delivery' : 'pickup',
      delivery: order.type === 'delivery' && order.delivery ? {
        dispatchedAt: order.delivery.dispatchedAt ? new Date(order.delivery.dispatchedAt).toISOString() : null,
        deliveredAt: order.delivery.deliveredAt ? new Date(order.delivery.deliveredAt).toISOString() : null,
        estimatedMinutes: order.delivery.estimatedMinutes,
      } : null,
    };
  }

  /** Guest-only, tenant-correlated source. Historical references are projected
   * by the same rules as account reorder; no names are resolved into new IDs. */
  async publicReorder(slug: string, id: string, token: unknown) {
    const filter = trackingFilter(id, token);
    if (!filter || !/^[a-z0-9][a-z0-9_-]{0,127}$/.test(slug)) throw new NotFoundException('Commande introuvable');
    const tenant = await this.tenants.findOne({ slug }).select('_id').read('primary').readConcern('majority').maxTimeMS(10_000).lean();
    if (!tenant) throw new NotFoundException('Commande introuvable');
    const order = await this.orders.findOne({ ...filter, tenantId: tenant._id, customerOwner: null,
      channel: 'online', type: { $in: ['pickup', 'delivery'] } })
      .select('_id number lines.productId lines.name lines.variantKey lines.variantName lines.qty lines.unitPrice lines.options.groupKey lines.options.choiceKey lines.removed')
      .read('primary').readConcern('majority').maxTimeMS(10_000).lean();
    if (!order) throw new NotFoundException('Commande introuvable');
    return GuestOrderReorderResponseSchema.parse({ tenantSlug: slug, ...customerOrderReorder(order) });
  }

  /**
   * Avancement de statut. Règle offline « le plus avancé gagne » :
   * un rejeu vers un statut déjà dépassé est ignoré (renvoie l'état courant).
   * Une NOUVELLE remise exige toutefois `ready`, quel que soit le mode.
   * Les droits se vérifient avant les retours idempotents : un ancien client
   * KDS n'acquiert jamais le droit de confirmer une remise en la rejouant.
   */
  async updateStatus(tenantId: string, id: string, status: OrderStatus, actor: JwtPayload) {
    if (status === 'cancelled') {
      throw new ForbiddenException('Utilisez l’annulation avec confirmation pour fermer le paiement en sécurité.');
    }
    if (actor.tenantId !== tenantId) {
      throw new ForbiddenException('Cette identité ne peut pas agir pour cet établissement.');
    }
    if (status === 'delivered' && !ORDER_HANDOFF_ROLES.includes(actor.role)) {
      throw new ForbiddenException('La remise au client doit être confirmée par la caisse ou le gérant, jamais par la cuisine.');
    }
    const order = await this.byId(tenantId, id);
    // Toutes les livraisons, y compris historiques : seule la remise dédiée
    // possède une preuve ou une dérogation responsable motivée. Le refus
    // précède l'idempotence pour fermer aussi les anciennes files clientes.
    if (order.type === 'delivery' && status === 'delivered') {
      throw new ConflictException({ code: 'DELIVERY_HANDOFF_REQUIRED',
        message: 'Utilisez la remise livraison avec preuve ou la dérogation du responsable.' });
    }
    const current = order.status as OrderStatus;
    if (status === current) return order;
    if (ORDER_STATUS_RANK[status] < ORDER_STATUS_RANK[current]) return order;
    if (current === 'delivered' || current === 'cancelled') return order;

    if (order.paymentFlow && ['closing', 'closed', 'review_required'].includes(order.paymentFlow.phase)) {
      throw new ConflictException('Paiement en cours de fermeture ou à vérifier — actualisez la commande avant de continuer.');
    }

    if (order.payment.status === 'refunded') throw new ConflictException('Cette commande a été remboursée.');
    if (order.type === 'delivery' && order.payment.status !== 'paid') {
      throw new ConflictException('Le paiement en ligne doit être confirmé avant la préparation de la livraison.');
    }

    if (status === 'delivered' && current !== 'ready') {
      throw new ConflictException('La commande doit être prête avant de confirmer sa remise au client.');
    }
    if (status === 'delivered' && order.payment.status !== 'paid') {
      throw new ConflictException('Encaissez cette commande avant de confirmer sa remise au client. Aucun paiement ne sera supposé.');
    }
    order.status = status;
    order.statusHistory.push({ status, at: new Date(), by: actor.sub });
    // Remise et encaissement sont deux gestes distincts. La version protège
    // cette remise d'une fermeture ou d'un remboursement simultané.
    await this.saveWithoutLostUpdate(order);
    this.publish(tenantId, WS_EVENTS.orderUpdated, this.orderEventPayload(order));
    return order;
  }

  /** Annulation — action sensible : PIN re-validé en amont, journalisée. */
  async cancelAsOwner(tenantId: string, id: string, actor: JwtPayload, reason: string) {
    if (actor.role !== 'owner' || actor.kind !== 'user' || actor.tenantId !== tenantId) {
      throw new ForbiddenException('Confirmation réservée au propriétaire.');
    }
    // Cette lecture applique le périmètre commercial AVANT le service bancaire.
    await this.byId(tenantId, id);
    await this.payments.cancelOrder(id, tenantId, actor, reason);
    const order = await this.byId(tenantId, id);
    if (order.status !== 'cancelled') throw new ConflictException('Annulation non confirmée — actualisez la commande.');
    if (order.pickup?.slot && this.admissions) await this.admissions.releaseCancelled(tenantId, order.clientId);
    await this.audit.log({ tenantId, actor, action: 'order.cancel', targetId: id,
      meta: { reason, number: order.number, total: order.totals.total, confirmation: 'owner-password' } });
    this.publish(tenantId, WS_EVENTS.orderUpdated, this.orderEventPayload(order));
    return order;
  }

  /** Annulation — action sensible : PIN re-validé en amont, journalisée. */
  async cancel(
    tenantId: string,
    id: string,
    valideur: { staffId: string; role: StaffRole },
    reason: string,
  ) {
    const { staffId } = valideur;
    if (valideur.role === 'cuisine') {
      throw new ForbiddenException('Ce code ne permet pas d’annuler une commande — demandez à la caisse ou au gérant.');
    }
    await this.byId(tenantId, id);
    await this.payments.cancelOrder(id, tenantId,
      { sub: staffId, tenantId, role: valideur.role, kind: 'staff' }, reason);
    const order = await this.byId(tenantId, id);
    if (order.status !== 'cancelled') throw new ConflictException('Annulation non confirmée — actualisez la commande.');
    if (order.pickup?.slot && this.admissions) await this.admissions.releaseCancelled(tenantId, order.clientId);
    await this.audit.log({
      tenantId,
      staffId,
      // L'AUTEUR est celui dont le PIN vient d'être re-saisi, pas la session
      // ouverte sur la tablette : c'est le gérant qui autorise depuis un
      // comptoir en session « caisse » que le registre doit nommer.
      actor: { sub: staffId, role: valideur.role, kind: 'staff' },
      action: 'order.cancel',
      targetId: id,
      meta: { reason, number: order.number, total: order.totals.total, role: valideur.role },
      pinVerifiedAt: new Date(),
    });
    this.publish(tenantId, WS_EVENTS.orderUpdated, this.orderEventPayload(order));
    return order;
  }

  /**
   * REMISE SUR COMMANDE — le geste qui minore la recette.
   *
   * Passe par le value object du domaine, ce que ce service ne faisait pas :
   * il écrivait directement dans `order.totals.discount`, contournant les trois
   * règles que `Discount` existe pour tenir — motif obligatoire, valideur
   * identifié, et désormais plafond par rôle.
   *
   * Le contrôle du montant vit dans le domaine et non ici : c'est le seul
   * endroit par lequel une remise peut naître, et une règle d'argent posée dans
   * un service finit contournée par le prochain appelant.
   */
  async discount(
    tenantId: string,
    id: string,
    valideur: { staffId: string; role: StaffRole },
    amount: number,
    reason: string,
  ) {
    const order = await this.byId(tenantId, id);
    if (order.status === 'delivered' || order.status === 'cancelled') {
      throw new ConflictException(
        'Commande clôturée — une remise doit être posée avant la remise au client',
      );
    }
    if (order.payment.status !== 'pending') {
      throw new ConflictException('Commande déjà encaissée ou remboursée : son montant ne peut plus être modifié.');
    }
    if (order.payment?.stripePaymentIntentId || order.paymentFlow?.origin !== 'created_v1' ||
      order.paymentFlow.phase !== 'open' || order.paymentFlow.attempt) {
      throw new ConflictException('Le paiement en ligne a déjà été initié. Utilisez un remboursement après confirmation du paiement.');
    }
    if (amount > order.totals.subtotal) {
      throw new BadRequestException(
        'Une remise ne peut pas dépasser le montant de la commande',
      );
    }

    const horloge = { now: () => new Date() };
    const autorisation = ordering.StaffAuthorization.grant(valideur.staffId, horloge);
    if (!autorisation.ok) throw new BadRequestException(autorisation.error.message);

    const remise = ordering.Discount.create({
      amount: Money.fromCents(amount),
      reason,
      authorization: autorisation.value,
      // Ce que CE code autorise. `null` = le gérant, `0` = la cuisine, qui
      // n'accorde aucune remise : elle prépare, elle ne négocie pas.
      plafondCents: REMISE_PLAFOND_CENTS[valideur.role],
    });
    if (!remise.ok) {
      // Un dépassement de plafond n'est pas une erreur de saisie : c'est un
      // refus de droit, et le 403 le dit. La confondre avec un 400 ferait
      // chercher la faute au caissier plutôt qu'au niveau d'autorisation.
      const refus = remise.error;
      throw refus.code === 'authorization.required'
        ? new ForbiddenException(
            `Ce code n’autorise aucune remise (${plafondRemiseLabel(valideur.role)}) — demandez au gérant.`,
          )
        : new BadRequestException(refus.message);
    }

    const pose = remise.value.toJSON();
    order.totals.discount = {
      amount: pose.amount,
      reason: pose.reason,
      staffId: valideur.staffId as never,
      promotionId: null as never,
    };
    order.totals.total = order.totals.subtotal - pose.amount + (order.totals.deliveryFee ?? 0);
    await this.saveWithoutLostUpdate(order);
    await this.audit.log({
      tenantId,
      staffId: valideur.staffId,
      actor: { sub: valideur.staffId, role: valideur.role, kind: 'staff' },
      action: 'order.discount',
      targetId: id,
      // Le RÔLE du valideur au journal : « qui » ne suffit pas à relire un
      // contrôle six mois plus tard, il faut « à quel titre ».
      meta: { amount: pose.amount, reason: pose.reason, role: valideur.role, number: order.number },
      pinVerifiedAt: new Date(pose.pinVerifiedAt),
    });
    this.publish(tenantId, WS_EVENTS.orderUpdated, this.orderEventPayload(order));
    return order;
  }

}
