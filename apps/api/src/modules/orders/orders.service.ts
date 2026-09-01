import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import Redis from 'ioredis';
import { Money, ordering } from '@sm/domain';
import {
  type CreateOrder,
  plafondRemiseLabel,
  REMISE_PLAFOND_CENTS,
  type StaffRole,
  ORDER_STATUS_RANK,
  type OrderStatus,
  type OrderTracking,
  ordersChannel,
  WS_EVENTS,
} from '@sm/contracts';
import type { Counter, Order, Product, Promotion } from '@sm/db';
import { REDIS_PUB } from '../../redis.module';
import { publishRedisBestEffort } from '../../common/redis-best-effort';
import { AuditService } from '../audit/audit.module';
import { resolvePayment } from './payment';
import { newTrackingToken, trackingFilter } from './tracking';

/**
 * Le document Mongo → la règle que le domaine sait lire.
 *
 * Tolérant aux promotions d'AVANT les bornes : `minSubtotalCents`,
 * `maxDiscountCents` et `maxUsage` sont arrivés avec l'application des
 * promotions, et `.lean()` ne matérialise pas les défauts Mongoose. Absents,
 * ils valent « aucune borne » — ce qui est le comportement qu'avait la
 * promotion quand elle a été créée.
 */
function versRegle(doc: Record<string, unknown>): ordering.PromotionRule {
  const nombre = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  const date = (v: unknown): Date | null => (v instanceof Date ? v : null);
  return {
    id: String(doc._id),
    name: String(doc.name ?? ''),
    kind: doc.kind as ordering.PromotionRule['kind'],
    value: nombre(doc.value),
    code: typeof doc.code === 'string' && doc.code ? doc.code : null,
    channels: Array.isArray(doc.channels) ? (doc.channels as string[]) : [],
    startsAt: date(doc.startsAt),
    endsAt: date(doc.endsAt),
    active: doc.active === true,
    minSubtotalCents: nombre(doc.minSubtotalCents),
    maxDiscountCents: nombre(doc.maxDiscountCents),
    maxUsage: nombre(doc.maxUsage),
    usageCount: nombre(doc.usageCount),
    offeredProductId: doc.offeredProductId ? String(doc.offeredProductId) : null,
  };
}

/**
 * Le plafond de lecture d'une liste de commandes.
 *
 * Deux cents suffit à un service de comptoir ordinaire ; au-delà, la réponse
 * annonce sa troncature plutôt que de laisser croire à un total.
 */
const ORDERS_PAGE_MAX = 200;

@Injectable()
export class OrdersService {
  constructor(
    @InjectModel('Order') private readonly orders: Model<Order>,
    @InjectModel('Product') private readonly products: Model<Product>,
    @InjectModel('Counter') private readonly counters: Model<Counter>,
    @InjectModel('Promotion') private readonly promotions: Model<Promotion>,
    @Inject(REDIS_PUB) private readonly redis: Redis,
    private readonly audit: AuditService,
  ) {}

  private publish(tenantId: string, event: string, payload: unknown) {
    void publishRedisBestEffort(
      this.redis,
      ordersChannel(tenantId),
      JSON.stringify({ event, payload }),
    );
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
    const filtre = code
      ? { tenantId, active: true, code: code.toUpperCase() }
      : { tenantId, active: true, code: null };
    const candidates = await this.promotions.find(filtre).lean();

    if (code && candidates.length === 0) {
      throw new BadRequestException(`Le code « ${code} » ne correspond à aucune offre`);
    }
    if (candidates.length === 0) return null;

    // Le prix unitaire réellement retenu pour chaque produit du panier — c'est
    // lui que vaut un « produit offert », options comprises, et non le prix
    // catalogue. Le MOINS cher quand le produit figure sur plusieurs lignes :
    // offrir le plus cher des exemplaires serait un cadeau qu'on n'a pas promis.
    const prixAuPanier = new Map<string, Money>();
    for (const l of lines) {
      const id = String(l.productId);
      const actuel = prixAuPanier.get(id);
      if (!actuel || l.unitPrice < actuel.cents) prixAuPanier.set(id, Money.fromCents(l.unitPrice));
    }
    const contexte = {
      subtotal: Money.fromCents(subtotal),
      channel: dto.channel,
      code: code ?? null,
      now: new Date(),
      prixAuPanier,
    };

    // La MEILLEURE offre pour le client parmi celles qui passent. Avec un code
    // saisi il n'y en a qu'une ; sans code, en retenir une moins avantageuse
    // qu'une autre également applicable serait un choix qu'on ne saurait pas
    // justifier au comptoir.
    let retenue: { id: unknown; amount: number; reason: string } | null = null;
    let refus: string | null = null;
    for (const brut of candidates) {
      const resultat = ordering.appliquerPromotion(versRegle(brut), contexte);
      if (!resultat.ok) {
        refus ??= resultat.error.message;
        continue;
      }
      const cents = resultat.value.amount.cents;
      if (!retenue || cents > retenue.amount) {
        retenue = { id: brut._id, amount: cents, reason: resultat.value.reason };
      }
    }

    if (!retenue) {
      // Un code SAISI qui ne passe pas doit dire pourquoi : le client l'attend.
      // Une offre d'office qui ne passe pas ne regarde personne — la commande
      // se poursuit au tarif normal.
      if (code) throw new BadRequestException(refus ?? `Le code « ${code} » n’est pas applicable`);
      return null;
    }

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
  async create(tenantId: string, dto: CreateOrder, actor: string) {
    return (await this.createWithOutcome(tenantId, dto, actor)).order;
  }

  /**
   * Variante qui révèle uniquement si CET appel a créé le document.
   *
   * Le contrôleur public s'en sert pour rendre sa réservation anti-abus lors
   * d'une course idempotente. Les autres appelants gardent l'API historique et
   * ne voient que la commande.
   */
  async createWithOutcome(tenantId: string, dto: CreateOrder, actor: string) {
    const existing = await this.orders.findOne({ tenantId, clientId: dto.clientId });
    if (existing) {
      return { order: this.withTrackingToken(existing), created: false as const };
    }

    const ids = [...new Set(dto.lines.map((l) => l.productId))];
    const prods = await this.products.find({ _id: { $in: ids }, tenantId, active: true }).lean();
    const byId = new Map(prods.map((p) => [String(p._id), p]));

    let subtotal = 0;
    const lines = dto.lines.map((line) => {
      const prod = byId.get(line.productId);
      if (!prod) throw new NotFoundException(`Produit ${line.productId} introuvable`);
      if (prod.outOfStock) {
        throw new ConflictException(`« ${prod.name} » est en rupture`);
      }

      let variantName: string | null = null;
      let unitPrice = prod.price;
      if (prod.variants.length > 0) {
        const variant = prod.variants.find((v) => v.key === line.variantKey);
        if (!variant) {
          throw new BadRequestException(`Variante requise pour « ${prod.name} »`);
        }
        variantName = variant.name;
        unitPrice = variant.price;
      }

      const options = line.options.map((sel) => {
        const group = prod.optionGroups.find((g) => g.key === sel.groupKey);
        const choice = group?.choices.find((c) => c.key === sel.choiceKey);
        if (!group || !choice) {
          throw new BadRequestException(`Option inconnue pour « ${prod.name} »`);
        }
        const perVariant =
          line.variantKey && group.perVariant
            ? (group.perVariant as Record<string, { priceDelta?: number }>)[line.variantKey]
            : undefined;
        const priceDelta = perVariant?.priceDelta ?? choice.priceDelta;
        unitPrice += priceDelta;
        return { groupKey: group.key, choiceKey: choice.key, name: choice.name, priceDelta };
      });

      // Groupes obligatoires (min effectif selon la variante)
      for (const group of prod.optionGroups) {
        const rules =
          line.variantKey && group.perVariant
            ? (group.perVariant as Record<string, { min?: number; max?: number }>)[line.variantKey]
            : undefined;
        const min = rules?.min ?? group.min ?? 0;
        const max = rules?.max ?? group.max ?? Infinity;
        const count = options.filter((o) => o.groupKey === group.key).length;
        if (count < min || count > max) {
          throw new BadRequestException(
            `« ${group.name} » : ${min === max ? min : `${min}–${max === Infinity ? '∞' : max}`} choix attendu(s) pour « ${prod.name} »`,
          );
        }
      }

      const lineTotal = unitPrice * line.qty;
      subtotal += lineTotal;
      return {
        productId: prod._id,
        name: prod.name,
        variantKey: line.variantKey ?? null,
        variantName,
        options,
        removed: line.removed,
        note: line.note ?? null,
        qty: line.qty,
        unitPrice,
        lineTotal,
      };
    });

    // LA PROMOTION, RÉSOLUE CÔTÉ SERVEUR comme les prix.
    //
    // Le corps ne porte qu'un CODE : le montant est calculé ici contre la
    // promotion en base. Un client qui enverrait sa propre remise n'obtient
    // rien — même règle que pour les prix, et pour la même raison.
    const promotion = await this.resoudrePromotion(tenantId, dto, subtotal, lines);

    // Ce que le client doit RÉELLEMENT — le seul montant qui fasse autorité
    // pour l'encaissement, le rendu monnaie et le ticket.
    const totalDu = subtotal - (promotion?.discount.amount ?? 0);

    const number = await this.nextNumber(tenantId);
    try {
      const order = await this.orders.create({
        tenantId,
        number,
        clientId: dto.clientId,
        channel: dto.channel,
        type: dto.type,
        lines,
        totals: { subtotal, discount: promotion?.discount ?? null, total: totalDu },
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
      });
      this.publish(tenantId, WS_EVENTS.orderCreated, order.toObject());
      return { order, created: true as const };
    } catch (err: unknown) {
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
      await this.rendreReservation(tenantId, promotion);

      // Course entre deux rejeux simultanés de la même commande offline
      if ((err as { code?: number }).code === 11000) {
        const raced = await this.orders.findOne({ tenantId, clientId: dto.clientId });
        if (raced) {
          return { order: this.withTrackingToken(raced), created: false as const };
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
    const existing = await this.orders.findOne({ tenantId, clientId });
    return existing ? this.withTrackingToken(existing) : null;
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
  async list(tenantId: string, filter: { status?: OrderStatus; since?: string }) {
    const query: Record<string, unknown> = { tenantId };
    if (filter.status) query.status = filter.status;
    if (filter.since) query.createdAt = { $gte: new Date(filter.since) };
    const [rows, total] = await Promise.all([
      this.orders.find(query).sort({ createdAt: -1 }).limit(ORDERS_PAGE_MAX).lean(),
      this.orders.countDocuments(query),
    ]);
    return { rows, total, truncated: total > rows.length };
  }

  async byId(tenantId: string, id: string) {
    const order = await this.orders.findOne({ _id: id, tenantId });
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
    };
  }

  /**
   * Avancement de statut. Règle offline « le plus avancé gagne » :
   * un rejeu vers un statut déjà dépassé est ignoré (renvoie l'état courant).
   */
  async updateStatus(tenantId: string, id: string, status: OrderStatus, actor: string) {
    const order = await this.byId(tenantId, id);
    const current = order.status as OrderStatus;
    if (status === current) return order;
    if (ORDER_STATUS_RANK[status] < ORDER_STATUS_RANK[current]) return order;
    if (current === 'delivered' || current === 'cancelled') return order;

    order.status = status;
    order.statusHistory.push({ status, at: new Date(), by: actor });
    // FILET : une commande REMISE a forcément été réglée.
    //
    // Il ne visait que `method: 'counter'`, et ratait donc le cas le plus
    // fréquent des ennuis de paiement en ligne : le client choisit la carte, la
    // commande naît en `method: 'online'`, Stripe ne se charge pas (bloqueur,
    // réseau d'entreprise) ou le client renonce et règle au comptoir. Son
    // paiement restait « en attente » POUR TOUJOURS — aucun geste du logiciel
    // ne pouvait plus le solder, et le montant grossissait indéfiniment la
    // ligne « à encaisser au retrait » de chaque Z.
    //
    // Un restaurant ne remet pas la marchandise sans être payé : la remise vaut
    // donc encaissement, quel que soit le moyen annoncé au départ. Une commande
    // déjà réglée garde son moyen et son horodatage — on ne la « repaie » pas.
    if (status === 'delivered' && order.payment.status === 'pending') {
      order.payment.status = 'paid';
    }
    await order.save();
    this.publish(tenantId, WS_EVENTS.orderUpdated, order.toObject());
    return order;
  }

  /** Annulation — action sensible : PIN re-validé en amont, journalisée. */
  async cancel(tenantId: string, id: string, staffId: string, reason: string) {
    const order = await this.byId(tenantId, id);
    if (order.status === 'delivered') {
      throw new ConflictException('Commande déjà servie — passer par un remboursement');
    }
    order.status = 'cancelled';
    order.statusHistory.push({ status: 'cancelled', at: new Date(), by: staffId });
    await order.save();
    await this.audit.log({
      tenantId,
      staffId,
      action: 'order.cancel',
      targetId: id,
      meta: { reason, number: order.number, total: order.totals.total },
      pinVerifiedAt: new Date(),
    });
    this.publish(tenantId, WS_EVENTS.orderUpdated, order.toObject());
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
    order.totals.total = order.totals.subtotal - pose.amount;
    await order.save();
    await this.audit.log({
      tenantId,
      staffId: valideur.staffId,
      action: 'order.discount',
      targetId: id,
      // Le RÔLE du valideur au journal : « qui » ne suffit pas à relire un
      // contrôle six mois plus tard, il faut « à quel titre ».
      meta: { amount: pose.amount, reason: pose.reason, role: valideur.role, number: order.number },
      pinVerifiedAt: new Date(pose.pinVerifiedAt),
    });
    this.publish(tenantId, WS_EVENTS.orderUpdated, order.toObject());
    return order;
  }

}
