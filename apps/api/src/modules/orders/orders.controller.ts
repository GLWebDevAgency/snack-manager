import {
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  type CreatePublicOrder,
  CreatePublicOrderSchema,
  CreateOrderSchema,
  type OrderCancel,
  OrderCancelSchema,
  type OrderDiscount,
  OrderDiscountSchema,
  type CreateOrder,
  type JwtPayload,
  ORDER_READ_ROLES,
  type OrderStatus,
  publicOrderingState,
  aLaCapacite,
  TrackingTokenQuerySchema,
  type TrackingTokenQuery,
  UpdateOrderStatusSchema,
} from '@sm/contracts';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { zod } from '../../common/zod.pipe';
import { CurrentUser, Public, Roles, TenantId } from '../../common/auth';
import { OrdersService } from './orders.service';
import { AuthService } from '../auth/auth.service';
import { TenantsService } from '../tenants/tenants.service';
import { SlotsService } from '../ordering/slots.service';
import { PublicOrderGate } from './public-order-gate';
import { Fonction } from '../../common/capacites';
import { publicDeliverySettingsOf } from '../delivery/delivery-order';

@Controller()
@Fonction('orders')
export class OrdersController {
  constructor(
    private readonly orders: OrdersService,
    private readonly auth: AuthService,
    private readonly tenants: TenantsService,
    private readonly slots: SlotsService,
    private readonly publicOrderGate: PublicOrderGate,
  ) {}

  // ─── Staff (POS / téléphone) ───
  //
  // AUCUNE de ces routes ne portait de rôle, et l'absence de `@Roles` vaut
  // « tout rôle authentifié » : un code cuisine atteignait la prise de
  // commande, l'annulation et la remise. Chaque route dit désormais qui elle
  // sert, et le dit explicitement — y compris quand la réponse est « tout le
  // monde », qui est une décision et non un oubli.

  /** La cuisine ne prend pas les commandes : elle les prépare. */
  @Roles('owner', 'gerant', 'caisse')
  @Post('orders')
  create(
    @TenantId() tenantId: string,
    @CurrentUser() user: JwtPayload,
    @Body(zod(CreateOrderSchema)) body: CreateOrder,
  ) {
    // Le pilote livre uniquement les commandes passées par le checkout :
    // c'est cette porte qui réserve la capacité et exige le paiement Stripe.
    // Les appareils continuent à lire/préparer ces tickets, sans pouvoir
    // créer une livraison qui contournerait les contrôles du parcours public.
    if (body.type === 'delivery') {
      throw new ForbiddenException('La livraison se réserve depuis le parcours de commande en ligne');
    }
    return this.orders.create(tenantId, body, user.sub, user.deviceId ?? null);
  }

  /** Tout l'équipage lit la file : c'est l'écran de travail du KDS. */
  @Roles(...ORDER_READ_ROLES)
  @Get('orders')
  list(
    @TenantId() tenantId: string,
    @Query('status') status?: OrderStatus,
    @Query('since') since?: string,
  ) {
    return this.orders.list(tenantId, { status, since });
  }

  /** Même périmètre que la liste, sans charger jusqu'à 200 commandes. */
  @Roles(...ORDER_READ_ROLES)
  @Get('orders/count')
  count(
    @TenantId() tenantId: string,
    @Query('status') status?: OrderStatus,
    @Query('since') since?: string,
  ) {
    return this.orders.count(tenantId, { status, since });
  }

  /**
   * Réconciliation exacte d'une vente créée par une caisse hors ligne.
   *
   * La liste opérationnelle est volontairement plafonnée. Elle ne peut donc
   * pas servir de preuve qu'une ancienne commande synchronisée existe encore
   * dans un restaurant à fort débit. Le `clientId` UUID est la clé
   * d'idempotence du poste et la recherche reste strictement tenant-scopée.
   */
  @Roles('owner', 'gerant', 'caisse')
  @Get('orders/by-client/:clientId/loyalty')
  async loyaltyEarnStatus(
    @TenantId() tenantId: string,
    @Param('clientId', new ParseUUIDPipe({ version: '4' })) clientId: string,
  ) {
    const status = await this.orders.loyaltyEarnStatusByClientId(tenantId, clientId);
    if (!status) throw new NotFoundException('Commande introuvable');
    return status;
  }

  @Roles('owner', 'gerant', 'caisse')
  @Get('orders/by-client/:clientId')
  async byClientId(
    @TenantId() tenantId: string,
    @Param('clientId', new ParseUUIDPipe({ version: '4' })) clientId: string,
  ) {
    const order = await this.orders.findByClientId(tenantId, clientId);
    if (!order) throw new NotFoundException('Commande introuvable');
    return order;
  }

  @Roles(...ORDER_READ_ROLES)
  @Get('orders/:id')
  byId(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.orders.byId(tenantId, id);
  }

  /**
   * La cuisine peut préparer et marquer prêt. Le service distingue la remise
   * au client, réservée au comptoir/gestion : transmettre l'identité complète
   * permet de faire ce contrôle avant toute mutation ou réponse idempotente.
   */
  @Roles('owner', 'gerant', 'caisse', 'cuisine')
  @Patch('orders/:id/status')
  updateStatus(
    @TenantId() tenantId: string,
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body(zod(UpdateOrderStatusSchema)) body: { status: OrderStatus },
  ) {
    return this.orders.updateStatus(tenantId, id, body.status, user);
  }

  /**
   * Annulation — exige la re-saisie du PIN (traçabilité NF525).
   *
   * Le rôle du valideur est vérifié EN PLUS du code : annuler une commande la
   * sort de la recette du jour, et c'est un geste de comptoir, pas de cuisine.
   * Re-saisir un code prouve qui agit, jamais que cette personne en a le droit.
   */
  /*
   * Le JETON reste ouvert à tout l'équipage, et c'est voulu : la tablette est
   * en session « caisse » quand le gérant vient taper SON code par-dessus.
   * Restreindre ici empêcherait le gérant d'autoriser quoi que ce soit depuis
   * le comptoir. C'est le PIN re-saisi qui décide, pas la session ouverte.
   */
  @Roles('owner', 'gerant', 'caisse', 'cuisine')
  @HttpCode(200)
  @Post('orders/:id/cancel')
  async cancel(
    @TenantId() tenantId: string,
    @Param('id') id: string,
    @Body(zod(OrderCancelSchema)) body: OrderCancel,
  ) {
    const valideur = await this.auth.verifyPin(tenantId, body.pin);
    if (valideur.role === 'cuisine') {
      throw new ForbiddenException(
        'Ce code ne permet pas d’annuler une commande — demandez à la caisse ou au gérant.',
      );
    }
    return this.orders.cancel(tenantId, id, valideur, body.reason);
  }

  /**
   * Remise — exige la re-saisie du PIN ET le droit d'accorder ce montant.
   *
   * Le corps n'était pas validé, le motif était facultatif, le rôle n'était pas
   * lu et le seul plafond était le sous-total : un code cuisine offrait la
   * commande entière sans motif. Le montant se juge maintenant dans le domaine,
   * contre `REMISE_PLAFOND_CENTS`.
   */
  @Roles('owner', 'gerant', 'caisse', 'cuisine')
  @HttpCode(200)
  @Post('orders/:id/discount')
  async discount(
    @TenantId() tenantId: string,
    @Param('id') id: string,
    @Body(zod(OrderDiscountSchema)) body: OrderDiscount,
  ) {
    const valideur = await this.auth.verifyPin(tenantId, body.pin);
    return this.orders.discount(tenantId, id, valideur, body.amount, body.reason);
  }

  // ─── Public (commande en ligne, sans compte) ───

  @Public()
  // 20 commandes/minute par adresse : aucun client réel n'y touche, un
  // script qui rembourrerait la cuisine de fausses commandes, si.
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post('public/tenants/:slug/orders')
  async createOnline(
    @Param('slug') slug: string,
    @Body(zod(CreatePublicOrderSchema)) body: CreatePublicOrder,
  ) {
    const tenant = await this.tenants.bySlug(slug);
    // Pause volontaire du gérant, suspension du compte par Snack Manager, ou
    // commande en ligne non souscrite : même fermeture propre côté client,
    // messages distincts (le consommateur ne doit jamais lire « impayé » ni
    // « abonnement » — ni le litige ni le contrat ne le concernent).
    //
    // Une capacité manquante passe donc par la MÊME porte que la pause, et pas
    // par un 403 de garde : le client qui valide son panier à 12h15 doit lire
    // une phrase qui lui parle, pas recevoir une erreur.
    const gate = publicOrderingState(
      tenant.account,
      {
        paused: tenant.settings?.onlineOrderingPaused ?? false,
        message: tenant.settings?.pauseMessage ?? null,
      },
      aLaCapacite(tenant, 'online'),
    );
    if (gate.paused) return gate;

    // Un POST dont la reponse s'est perdue garde la meme cle. La commande
    // existe deja : ne pas redemander une preuve Turnstile a usage unique, ni
    // recompter le quota ou la capacite du creneau.
    const tenantId = String(tenant._id);
    const existing = await this.orders.findByClientId(tenantId, body.clientId);
    if (existing) return existing;
    const fulfillment = body.fulfillment ?? 'pickup';
    if (fulfillment === 'delivery' && !publicDeliverySettingsOf(tenant).available) {
      throw new ConflictException('La livraison est momentanément indisponible. Vous pouvez choisir le retrait au restaurant.');
    }

    // LE CRÉNEAU EST VÉRIFIÉ ICI, PAS SEULEMENT PROPOSÉ.
    //
    // `SlotsService.compute` calculait déjà la capacité restante, les
    // fermetures exceptionnelles et le délai de préparation — et rien ne les
    // relisait à l'écriture. Le tunnel grisait les créneaux pleins, ce qui
    // arrête un client honnête et personne d'autre : un appel direct posait
    // vingt commandes à la minute sur un créneau affiché « complet », ou un
    // jour de fermeture. La cuisine recevait des commandes qu'elle avait
    // explicitement déclaré ne pas pouvoir honorer.
    //
    // Le cas du client resté dix minutes sur l'étape paiement se referme du
    // même coup : son créneau est revérifié au moment où il valide, pas au
    // moment où il l'a choisi.
    await this.slots.exigerDisponible(tenant, body.pickup.slot, fulfillment);

    const proof = await this.publicOrderGate.authorize({
      tenantId,
      tenantSlug: slug,
      turnstileToken: body.turnstileToken,
    });

    // Le jeton anti-robot n'entre jamais dans le document. Canal et type sont
    // des faits de route, impossibles a choisir dans le corps public strict.
    const { turnstileToken: _proof, fulfillment: _fulfillment, ...trusted } = body;
    try {
      return await this.publicOrderGate.serializeSlot(
        { tenantId, slot: body.pickup.slot },
        async () => {
          // Siteverify peut prendre plusieurs secondes. Une autre replique a
          // pu prendre la derniere place entre-temps : seconde lecture SOUS
          // verrou distribue, juste avant l'ecriture.
          const raced = await this.orders.findByClientId(tenantId, body.clientId);
          if (raced) {
            await this.publicOrderGate.release(proof);
            return raced;
          }
          await this.slots.exigerDisponible(tenant, body.pickup.slot, fulfillment);

          const outcome = await this.orders.createWithOutcome(
            tenantId,
            {
              ...trusted,
              // `method` devient un fait seulement quand Stripe confirme. La
              // valeur sure avant webhook est le repli au comptoir.
              payment: { method: fulfillment === 'delivery' ? 'online' : 'counter' },
              channel: 'online',
              type: fulfillment,
            },
            'online:turnstile',
          );
          if (!outcome.created) await this.publicOrderGate.release(proof);
          return outcome.order;
        },
      );
    } catch (err) {
      await this.publicOrderGate.release(proof);
      throw err;
    }
  }

  /**
   * Suivi client — exige `?t=<trackingToken>` (remis à la création).
   * Sans jeton valide : 404, jamais 403 (voir `OrdersService.publicTracking`).
   */
  @Public()
  @Get('public/orders/:id')
  tracking(
    @Param('id') id: string,
    @Query(zod(TrackingTokenQuerySchema)) query: TrackingTokenQuery,
  ) {
    return this.orders.publicTracking(id, query.t);
  }
}
