import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
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

@Controller()
export class OrdersController {
  constructor(
    private readonly orders: OrdersService,
    private readonly auth: AuthService,
    private readonly tenants: TenantsService,
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
    return this.orders.create(tenantId, body, user.sub);
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
  async createOnline(@Param('slug') slug: string, @Body(zod(CreateOrderSchema)) body: CreateOrder) {
    const tenant = await this.tenants.bySlug(slug);
    // Pause volontaire du gérant OU suspension du compte par Snack Manager :
    // même fermeture propre côté client, messages distincts (le consommateur
    // ne doit jamais lire « impayé » — le litige ne le concerne pas).
    const gate = publicOrderingState(tenant.account, {
      paused: tenant.settings?.onlineOrderingPaused ?? false,
      message: tenant.settings?.pauseMessage ?? null,
    });
    if (gate.paused) return gate;
    // Canal forcé : une commande postée sur la route publique est toujours « online »
    return this.orders.create(String(tenant._id), { ...body, channel: 'online' }, 'online');
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
