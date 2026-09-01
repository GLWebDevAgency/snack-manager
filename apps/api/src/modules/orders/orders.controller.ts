import {
  Body,
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
  type OrderStatus,
  publicOrderingState,
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

@Controller()
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
    return this.orders.create(tenantId, body, user.sub, user.deviceId ?? null);
  }

  /** Tout l'équipage lit la file : c'est l'écran de travail du KDS. */
  @Roles('owner', 'gerant', 'caisse', 'cuisine')
  @Get('orders')
  list(
    @TenantId() tenantId: string,
    @Query('status') status?: OrderStatus,
    @Query('since') since?: string,
  ) {
    return this.orders.list(tenantId, { status, since });
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

  @Roles('owner', 'gerant', 'caisse', 'cuisine')
  @Get('orders/:id')
  byId(@TenantId() tenantId: string, @Param('id') id: string) {
    return this.orders.byId(tenantId, id);
  }

  /**
   * Faire avancer une commande EST le métier de la cuisine — cette route lui
   * est ouverte délibérément. Elle ne portait aucun décorateur, ce qui donnait
   * le même résultat par accident : la déclarer transforme un trou en décision.
   */
  @Roles('owner', 'gerant', 'caisse', 'cuisine')
  @Patch('orders/:id/status')
  updateStatus(
    @TenantId() tenantId: string,
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body(zod(UpdateOrderStatusSchema)) body: { status: OrderStatus },
  ) {
    return this.orders.updateStatus(tenantId, id, body.status, user.sub);
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
    return this.orders.cancel(tenantId, id, valideur.staffId, body.reason);
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
    // Pause volontaire du gérant OU suspension du compte par Snack Manager :
    // même fermeture propre côté client, messages distincts (le consommateur
    // ne doit jamais lire « impayé » — le litige ne le concerne pas).
    const gate = publicOrderingState(tenant.account, {
      paused: tenant.settings?.onlineOrderingPaused ?? false,
      message: tenant.settings?.pauseMessage ?? null,
    });
    if (gate.paused) return gate;

    // Un POST dont la reponse s'est perdue garde la meme cle. La commande
    // existe deja : ne pas redemander une preuve Turnstile a usage unique, ni
    // recompter le quota ou la capacite du creneau.
    const tenantId = String(tenant._id);
    const existing = await this.orders.findByClientId(tenantId, body.clientId);
    if (existing) return existing;

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
    await this.slots.exigerDisponible(tenant, body.pickup.slot);

    const proof = await this.publicOrderGate.authorize({
      tenantId,
      tenantSlug: slug,
      turnstileToken: body.turnstileToken,
    });

    // Le jeton anti-robot n'entre jamais dans le document. Canal et type sont
    // des faits de route, impossibles a choisir dans le corps public strict.
    const { turnstileToken: _proof, ...trusted } = body;
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
          await this.slots.exigerDisponible(tenant, body.pickup.slot);

          const outcome = await this.orders.createWithOutcome(
            tenantId,
            {
              ...trusted,
              // `method` devient un fait seulement quand Stripe confirme. La
              // valeur sure avant webhook est le repli au comptoir.
              payment: { method: 'counter' },
              channel: 'online',
              type: 'pickup',
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
